// Package rating_test exercises the rating package against a real
// Postgres (via store.TestPool) at three levels: the repository directly,
// the usecase over a stub repo, and the HTTP routes through
// internal/server.New — the same wiring the web client depends on. It is
// an external test package (rating_test, not rating) so it can only reach
// the exported surface the rest of the API can: if a test here needs
// something unexported, that is a signal the interface is wrong, not that
// the test should move inside the package.
//
// The four named cases are top-level functions and store.TestPool is keyed
// to a *testing.T, so each gets its own disposable container rather than
// sharing one. That is the same deliberate trade internal/course made: a
// few extra seconds per run to keep the named cases independent and
// individually runnable with -run. Supplementary coverage is grouped under
// TestRatingContracts so it costs one more container, not one per case.
package rating_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/rating"
	"github.com/vndee/tuhoc-api/internal/server"
	"github.com/vndee/tuhoc-api/internal/store"
)

const (
	httpTimeoutMS     = 30000
	sessionCookieName = "tuhoc_session"
)

func newTestApp(pool *pgxpool.Pool) *fiber.App {
	return server.New(config.Config{CookieSecure: false}, server.Deps{Pool: pool, LogOutput: io.Discard})
}

// newVoter inserts a real users row and returns its id. course_ratings
// declares user_id as a foreign key into users(id), so repo-level tests
// need genuine users rather than freshly minted uuids; going straight to
// SQL keeps those tests free of any dependency on auth.
func newVoter(t *testing.T, pool *pgxpool.Pool, label string) uuid.UUID {
	t.Helper()

	var id uuid.UUID
	email := fmt.Sprintf("rating-%s-%s@example.test", label, uuid.NewString())
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email, name, pw_hash) VALUES ($1,$2,$3) RETURNING id`,
		email, label, "not-a-real-hash").Scan(&id)
	if err != nil {
		t.Fatalf("create voter %s: %v", label, err)
	}
	return id
}

// registerUser creates a real account through the real /auth/register
// route and returns its session cookie, user id, and email. HTTP-level
// tests need a genuine session (auth.Require validates it against the
// sessions table), which newVoter's straight-to-SQL insert cannot provide.
//
// Callers that register several users against ONE app must watch the
// 10-per-minute rate limiter on /auth/*, whose storage is per-App.
func registerUser(t *testing.T, app *fiber.App, label string) (*http.Cookie, uuid.UUID, string) {
	t.Helper()

	email := fmt.Sprintf("rating-http-%s-%s@example.test", label, uuid.NewString())
	body, err := json.Marshal(map[string]string{
		"email": email, "password": "rating-test-password-1", "name": "NAME-" + label,
	})
	if err != nil {
		t.Fatalf("register %s: marshal: %v", label, err)
	}
	req := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("register %s: %v", label, err)
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("register %s: want 200 got %d body=%s", label, resp.StatusCode, raw)
	}

	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("register %s: unmarshal: %v (body=%s)", label, err, raw)
	}
	id, err := uuid.Parse(out.ID)
	if err != nil {
		t.Fatalf("register %s: bad id %q: %v", label, out.ID, err)
	}

	var cookie *http.Cookie
	for _, ck := range resp.Cookies() {
		if ck.Name == sessionCookieName {
			cookie = ck
		}
	}
	if cookie == nil {
		t.Fatalf("register %s: no session cookie", label)
	}
	return cookie, id, email
}

// do performs one simulated request. body may be nil, a JSON-marshalable
// value, or a raw string (sent verbatim, for malformed-body cases).
func do(t *testing.T, app *fiber.App, method, target string, body any, cookie *http.Cookie, headers map[string]string) (*http.Response, []byte) {
	t.Helper()

	var reader io.Reader
	switch v := body.(type) {
	case nil:
	case string:
		reader = strings.NewReader(v)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			t.Fatalf("%s %s: marshal body: %v", method, target, err)
		}
		reader = bytes.NewReader(b)
	}

	req := httptest.NewRequest(method, target, reader)
	if reader != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}

	resp, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("%s %s: %v", method, target, err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("%s %s: read body: %v", method, target, err)
	}
	resp.Body.Close()
	return resp, raw
}

// putRating votes through the real route.
func putRating(t *testing.T, app *fiber.App, cookie *http.Cookie, registryID string, stars int) (*http.Response, []byte) {
	t.Helper()
	return do(t, app, http.MethodPut, "/ratings/"+registryID, map[string]any{"stars": stars}, cookie, nil)
}

// wireRating mirrors GET /ratings's response shape.
type wireRating struct {
	ID      string  `json:"id"`
	Average float64 `json:"average"`
	Count   int     `json:"count"`
	Mine    int     `json:"mine"`
}

func getRatings(t *testing.T, app *fiber.App, cookie *http.Cookie, ids ...string) []wireRating {
	t.Helper()
	resp, raw := do(t, app, http.MethodGet, "/ratings?ids="+strings.Join(ids, ","), nil, cookie, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /ratings?ids=%v: want 200 got %d body=%s", ids, resp.StatusCode, raw)
	}
	var out []wireRating
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("GET /ratings: unmarshal %s: %v", raw, err)
	}
	return out
}

// starsOf reads one user's stored vote straight out of the table. Every
// "the write was refused" assertion in this file uses it as well as the
// status code: a 400 on its own proves the response was shaped right, not
// that the row was left alone.
func starsOf(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID, registryID string) (int, bool) {
	t.Helper()
	var stars int
	err := pool.QueryRow(context.Background(),
		`SELECT stars FROM course_ratings WHERE user_id = $1 AND registry_id = $2`,
		userID, registryID).Scan(&stars)
	if err != nil {
		return 0, false
	}
	return stars, true
}

func countRowsFor(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM course_ratings WHERE user_id = $1`, userID).Scan(&n); err != nil {
		t.Fatalf("count rows for %s: %v", userID, err)
	}
	return n
}

// countAllRows is countRowsFor's stronger sibling: a write that landed
// under some OTHER user id — the failure mode ruling S1-F12 is about — is
// invisible to a per-user count.
func countAllRows(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM course_ratings`).Scan(&n); err != nil {
		t.Fatalf("count all rows: %v", err)
	}
	return n
}

// ── The four named cases ────────────────────────────────────────────────

// TestUserCannotOverwriteAnotherUsersRating is the repository-level pin on
// the decision the migration calls a security decision rather than a
// normalisation one: user_id is part of the PRIMARY KEY, so two people's
// votes on the same course are different rows BY IDENTITY and the upsert
// cannot reach across accounts.
//
// It goes through the Repo rather than the HTTP layer on purpose. The HTTP
// tests below prove the handler passes the right id; this one proves that
// even a caller who passes the WRONG id — which is what a bug in that
// handler amounts to — cannot destroy someone else's vote, because the
// write is scoped by identity and not by a WHERE clause somebody might
// forget.
func TestUserCannotOverwriteAnotherUsersRating(t *testing.T) {
	pool := store.TestPool(t)
	repo := rating.NewRepo(pool)
	ctx := context.Background()

	alice := newVoter(t, pool, "alice")
	bob := newVoter(t, pool, "bob")
	const course = "so-dau-phay-dong"

	if err := repo.Put(ctx, alice, course, 5); err != nil {
		t.Fatalf("alice put: %v", err)
	}
	if err := repo.Put(ctx, bob, course, 1); err != nil {
		t.Fatalf("bob put: %v", err)
	}

	if got, ok := starsOf(t, pool, alice, course); !ok || got != 5 {
		t.Errorf("alice's vote after bob voted on the same course: want 5, got %d (present=%v)", got, ok)
	}
	// Anti-vacuity, both directions: bob's write DID land, under bob. A
	// repository that silently dropped the second write would satisfy the
	// assertion above and be useless.
	if got, ok := starsOf(t, pool, bob, course); !ok || got != 1 {
		t.Errorf("bob's own vote: want 1, got %d (present=%v)", got, ok)
	}
	if n := countAllRows(t, pool); n != 2 {
		t.Errorf("two people voted on one course: want 2 rows, got %d", n)
	}

	// Editing your own vote replaces it rather than adding a row, and
	// still cannot touch anyone else's.
	if err := repo.Put(ctx, bob, course, 4); err != nil {
		t.Fatalf("bob re-put: %v", err)
	}
	if got, _ := starsOf(t, pool, bob, course); got != 4 {
		t.Errorf("bob's edited vote: want 4, got %d", got)
	}
	if got, _ := starsOf(t, pool, alice, course); got != 5 {
		t.Errorf("alice's vote after bob edited his: want 5, got %d", got)
	}
	if n := countAllRows(t, pool); n != 2 {
		t.Errorf("after an edit: want 2 rows, got %d", n)
	}

	// created_at survives an edit (it records when this person FIRST
	// voted); updated_at moves.
	var createdEqualsUpdated bool
	if err := pool.QueryRow(ctx,
		`SELECT created_at = updated_at FROM course_ratings WHERE user_id = $1 AND registry_id = $2`,
		bob, course).Scan(&createdEqualsUpdated); err != nil {
		t.Fatalf("read timestamps: %v", err)
	}
	if createdEqualsUpdated {
		t.Errorf("after editing a vote, updated_at did not move (or created_at was overwritten)")
	}
}

// TestListReturnsAggregateNotVoters is the privacy pin the plan names in
// Step 5: GET /ratings returns the average, the number of votes, and the
// CALLER'S OWN vote — and nothing that identifies anybody else.
//
// It asserts on the RAW BODY as well as the parsed shape, and on the exact
// set of JSON keys. Parsing into a struct proves only that the four fields
// this test knows about are right; a handler that also emitted a "voters"
// array would satisfy every parsed assertion and leak every voter. The key
// set is what kills that mutant.
func TestListReturnsAggregateNotVoters(t *testing.T) {
	pool := store.TestPool(t)
	const course = "khoa-hoc-cong-khai"

	// One app per user: /auth/* carries a 10-per-minute per-App limiter.
	appA, appB, appC := newTestApp(pool), newTestApp(pool), newTestApp(pool)
	cookieA, idA, emailA := registerUser(t, appA, "voter-a")
	cookieB, idB, emailB := registerUser(t, appB, "voter-b")
	cookieC, idC, emailC := registerUser(t, appC, "voter-c")

	for _, v := range []struct {
		app    *fiber.App
		cookie *http.Cookie
		stars  int
	}{{appA, cookieA, 5}, {appB, cookieB, 3}, {appC, cookieC, 1}} {
		if resp, raw := putRating(t, v.app, v.cookie, course, v.stars); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("PUT rating %d: want 204 got %d body=%s", v.stars, resp.StatusCode, raw)
		}
	}

	// A asks. She must see the aggregate over all three, and HER OWN vote.
	resp, raw := do(t, appA, http.MethodGet, "/ratings?ids="+course, nil, cookieA, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /ratings: want 200 got %d body=%s", resp.StatusCode, raw)
	}

	var parsed []wireRating
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("unmarshal %s: %v", raw, err)
	}
	if len(parsed) != 1 {
		t.Fatalf("want 1 entry, got %d: %s", len(parsed), raw)
	}
	if parsed[0].Count != 3 {
		t.Errorf("count: want 3, got %d", parsed[0].Count)
	}
	if parsed[0].Average != 3 {
		t.Errorf("average of 5,3,1: want 3, got %v", parsed[0].Average)
	}
	if parsed[0].Mine != 5 {
		t.Errorf("mine (A voted 5): want 5, got %d", parsed[0].Mine)
	}

	// Nothing identifying anybody else, anywhere in the bytes.
	for _, secret := range []string{
		idB.String(), idC.String(), emailB, emailC, "NAME-voter-b", "NAME-voter-c",
	} {
		if bytes.Contains(raw, []byte(secret)) {
			t.Errorf("CRITICAL: GET /ratings leaked %q — the response must carry the "+
				"average, the vote count, and the caller's own vote, and no voter "+
				"identity at all: %s", secret, raw)
		}
	}
	// Not even the caller's own id: `mine` is a number, and there is no
	// reason for a user id to appear on this wire in any form.
	if bytes.Contains(raw, []byte(idA.String())) || bytes.Contains(raw, []byte(emailA)) {
		t.Errorf("GET /ratings echoed the CALLER's own identity; the response should "+
			"carry numbers only: %s", raw)
	}

	// The exact key set. This is the assertion that kills a handler which
	// adds a `voters` field: every struct-based check above would still
	// pass.
	var keyed []map[string]json.RawMessage
	if err := json.Unmarshal(raw, &keyed); err != nil {
		t.Fatalf("unmarshal into maps: %v", err)
	}
	want := []string{"average", "count", "id", "mine"}
	for _, entry := range keyed {
		got := make([]string, 0, len(entry))
		for k := range entry {
			got = append(got, k)
		}
		sort.Strings(got)
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Errorf("GET /ratings entry keys: want exactly %v, got %v. A new field here "+
				"is a new thing published about other people's votes; if it is genuinely "+
				"not voter data, add it to `want` deliberately.", want, got)
		}
	}

	// B sees the same aggregate but HIS own vote, which is the other half
	// of "mine is per-caller" — without this, a hardcoded 5 would pass.
	bGot := getRatings(t, appB, cookieB, course)
	if len(bGot) != 1 || bGot[0].Mine != 3 {
		t.Errorf("B's `mine`: want 3, got %+v", bGot)
	}
	if bGot[0].Count != 3 || bGot[0].Average != 3 {
		t.Errorf("B sees a different aggregate than A: %+v", bGot)
	}
}

// TestPostIgnoresClientSuppliedUserID sends a forged user id through every
// channel a request has — JSON body, query string, and headers — while
// authenticated as the attacker, and demands that none of them steer the
// write.
//
// This is the write-path half of ruling S1-F12. The repository takes the
// user as an argument specifically so this is decidable at the call site;
// this test is what proves the call site passes the session's id.
func TestPostIgnoresClientSuppliedUserID(t *testing.T) {
	pool := store.TestPool(t)
	appVictim, appAttacker := newTestApp(pool), newTestApp(pool)

	cookieVictim, victimID, _ := registerUser(t, appVictim, "forge-victim")
	cookieAttacker, attackerID, _ := registerUser(t, appAttacker, "forge-attacker")

	const course = "khoa-hoc-bi-nham"

	if resp, raw := putRating(t, appVictim, cookieVictim, course, 5); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("victim vote: want 204 got %d body=%s", resp.StatusCode, raw)
	}

	// Vector 1: the body. Vector 2: the query string. Vector 3: headers.
	victim := victimID.String()
	resp, raw := do(t, appAttacker, http.MethodPut,
		"/ratings/"+course+"?user_id="+victim+"&userId="+victim+"&uid="+victim,
		map[string]any{
			"stars":       1,
			"user_id":     victim,
			"userId":      victim,
			"uid":         victim,
			"owner_id":    victim,
			"registry_id": "some-other-course",
		},
		cookieAttacker,
		map[string]string{"X-User-Id": victim, "X-Owner-Id": victim, "Authorization": "Bearer " + victim},
	)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("attacker vote: want 204 got %d body=%s", resp.StatusCode, raw)
	}

	if got, ok := starsOf(t, pool, victimID, course); !ok || got != 5 {
		t.Errorf("CRITICAL: the victim's vote was overwritten by a forged user id: "+
			"want 5, got %d (present=%v)", got, ok)
	}
	// Anti-vacuity: the write DID happen — under the attacker's own id.
	if got, ok := starsOf(t, pool, attackerID, course); !ok || got != 1 {
		t.Errorf("the attacker's own row does not hold the attacker's vote: got %d (present=%v)", got, ok)
	}
	// And the forged registry_id in the body did not steer WHICH course
	// was rated: the URL is the only source of that.
	if _, ok := starsOf(t, pool, attackerID, "some-other-course"); ok {
		t.Errorf("a registry_id in the body steered the write away from the URL's course")
	}

	if n := countRowsFor(t, pool, victimID); n != 1 {
		t.Errorf("victim rows: want 1, got %d", n)
	}
	if n := countRowsFor(t, pool, attackerID); n != 1 {
		t.Errorf("attacker rows: want 1, got %d", n)
	}
	if n := countAllRows(t, pool); n != 2 {
		t.Errorf("total rows: want 2, got %d", n)
	}
}

// impersonationHeaders is every header a handler might plausibly be
// tempted to read an identity out of, all carrying the victim's id. They
// are sent together rather than one per case on purpose: the assertion is
// that NONE is read, and a table of eleven single-header requests would
// prove the same thing eleven times more slowly. Same list as
// internal/course's, deliberately — the two invariants are the same
// invariant.
func impersonationHeaders(victimID uuid.UUID) map[string]string {
	id := victimID.String()
	return map[string]string{
		"X-User-Id":           id,
		"X-User-ID":           id,
		"X-Owner-Id":          id,
		"X-Owner":             id,
		"X-Forwarded-User":    id,
		"X-Forwarded-For":     id,
		"X-Impersonate-Owner": id,
		"X-Auth-User":         id,
		"X-Remote-User":       id,
		"Authorization":       "Bearer " + id,
		"From":                id,
	}
}

func impersonationQuery(victimID uuid.UUID) string {
	id := victimID.String()
	return "user_id=" + id + "&userId=" + id + "&uid=" + id + "&owner_id=" + id
}

// TestNoRouteReadsUserFromTheRequest is the structural invariant, and the
// reason it is worth its own container is written into internal/course's
// twin: a review there measured THREE independent mutants that the
// per-endpoint tests all survived — a read route taking owner_id from the
// query, an asset route doing the same, and a write route reading
// X-User-Id. "The code is right today" is not the property worth having;
// "a handler that started reading a user out of the request would fail
// this test" is.
//
// Both rating routes × (query parameters, headers, body), one fiber.App
// shared by both users — stronger than an app each, because an identity
// cached anywhere at the app layer would surface here.
func TestNoRouteReadsUserFromTheRequest(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)

	cookieAlice, aliceID, aliceEmail := registerUser(t, app, "alice")
	cookieBob, bobID, _ := registerUser(t, app, "bob")

	const course = "alice-rated-course"
	if resp, raw := putRating(t, app, cookieAlice, course, 5); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("alice vote: want 204 got %d body=%s", resp.StatusCode, raw)
	}

	headers := impersonationHeaders(aliceID)
	query := impersonationQuery(aliceID)
	secrets := []string{aliceID.String(), aliceEmail, "NAME-alice"}

	assertNoSecret := func(what string, body []byte) {
		t.Helper()
		for _, s := range secrets {
			if bytes.Contains(body, []byte(s)) {
				t.Errorf("CRITICAL: %s leaked %q to another user: %s", what, s, body)
			}
		}
	}

	// READ path. Bob asks about alice's course while claiming to be alice
	// in eleven headers and four query parameters. He must see the
	// aggregate (that is public) and `mine` = 0, because HE has not voted.
	// A handler that read the user from the request would answer 5.
	for _, target := range []string{
		"/ratings?ids=" + course,
		"/ratings?ids=" + course + "&" + query,
	} {
		resp, body := do(t, app, http.MethodGet, target, nil, cookieBob, headers)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("bob GET %s: want 200 got %d body=%s", target, resp.StatusCode, body)
		}
		assertNoSecret("GET "+target, body)

		var got []wireRating
		if err := json.Unmarshal(body, &got); err != nil {
			t.Fatalf("bob GET %s: unmarshal %s: %v", target, body, err)
		}
		if len(got) != 1 {
			t.Fatalf("bob GET %s: want 1 entry got %d: %s", target, len(got), body)
		}
		if got[0].Mine != 0 {
			t.Errorf("CRITICAL: bob GET %s reports mine=%d — the caller's own vote was "+
				"read from the REQUEST rather than from the session. Bob has not voted.",
				target, got[0].Mine)
		}
		if got[0].Count != 1 || got[0].Average != 5 {
			t.Errorf("bob GET %s: aggregate should be public and unchanged, got %+v",
				target, got[0])
		}
	}

	// WRITE path. Bob votes 1 while claiming to be alice through every
	// channel at once.
	resp, raw := do(t, app, http.MethodPut, "/ratings/"+course+"?"+query,
		map[string]any{"stars": 1, "user_id": aliceID.String(), "uid": aliceID.String()},
		cookieBob, headers)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("bob vote: want 204 got %d body=%s", resp.StatusCode, raw)
	}
	if got, ok := starsOf(t, pool, aliceID, course); !ok || got != 5 {
		t.Errorf("CRITICAL: alice's vote after bob's forged write: want 5, got %d (present=%v)", got, ok)
	}
	if n := countRowsFor(t, pool, aliceID); n != 1 {
		t.Errorf("alice rows: want 1, got %d", n)
	}
	if n := countRowsFor(t, pool, bobID); n != 1 {
		t.Errorf("bob rows: want 1, got %d", n)
	}

	// Anti-vacuity. Without this, a handler that answered every request
	// with `mine: 0` and refused every write would pass everything above.
	aliceGot := getRatings(t, app, cookieAlice, course)
	if len(aliceGot) != 1 || aliceGot[0].Mine != 5 {
		t.Errorf("alice cannot see her own vote: %+v", aliceGot)
	}
	if aliceGot[0].Count != 2 {
		t.Errorf("after bob voted: want count 2, got %+v", aliceGot[0])
	}
	bobGot := getRatings(t, app, cookieBob, course)
	if len(bobGot) != 1 || bobGot[0].Mine != 1 {
		t.Errorf("bob's own write did not land under bob: %+v", bobGot)
	}
}

// ── The privacy barrier ─────────────────────────────────────────────────

// TestPrivateCourseNeverAppearsInAnyListing pins the global constraint the
// plan states: a private course must not appear in any leaderboard.
//
// The API cannot tell a registry id from a private course id — it never
// fetches the registry index, and it must not (apps/api product code makes
// no outbound calls; see internal/server/no_key_transit_test.go). So the
// barrier is not validation, it is the ABSENCE OF ENUMERATION: every
// answer this API gives about ratings is scoped to ids the caller already
// named, and those come from the public registry index.
//
// This test therefore checks two different things, because a leak needs
// only one of them to fail:
//
//  1. behaviour — asking without ids is refused rather than answered with
//     everything, and an aggregate query for the public ids does not drag
//     a private id along;
//  2. shape — no route exists that could enumerate. app.GetRoutes is the
//     right tool for exactly this question and the wrong tool for most
//     others: it knows which routes EXIST (which is the claim here), and
//     it knows nothing about what a handler reads (which is why
//     no_key_transit_test.go refuses to use it for that).
func TestPrivateCourseNeverAppearsInAnyListing(t *testing.T) {
	pool := store.TestPool(t)
	appA, appB := newTestApp(pool), newTestApp(pool)

	cookieA, _, _ := registerUser(t, appA, "private-owner")
	cookieB, _, _ := registerUser(t, appB, "stranger")

	const publicCourse = "so-dau-phay-dong"
	const privateCourse = "giao-trinh-rieng-tu-cua-toi"

	if resp, raw := putRating(t, appA, cookieA, publicCourse, 4); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("public vote: want 204 got %d body=%s", resp.StatusCode, raw)
	}
	// A rates a course only she has. The API cannot know it is private —
	// that is the point. What must be true is that the id is inert.
	if resp, raw := putRating(t, appA, cookieA, privateCourse, 5); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("private vote: want 204 got %d body=%s", resp.StatusCode, raw)
	}

	// 1a. There is no "all ratings" answer.
	resp, raw := do(t, appB, http.MethodGet, "/ratings", nil, cookieB, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("GET /ratings with no ids: want 400 got %d body=%s — an empty listing "+
			"here would be indistinguishable from 'nobody has rated anything' and would "+
			"invite somebody to 'fix' it by returning everything", resp.StatusCode, raw)
	}
	if bytes.Contains(raw, []byte(privateCourse)) {
		t.Errorf("CRITICAL: GET /ratings named a private course: %s", raw)
	}

	// 1b. Nor does a query for the public catalog leak it.
	resp, raw = do(t, appB, http.MethodGet, "/ratings?ids="+publicCourse, nil, cookieB, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /ratings?ids=%s: want 200 got %d body=%s", publicCourse, resp.StatusCode, raw)
	}
	if bytes.Contains(raw, []byte(privateCourse)) {
		t.Errorf("CRITICAL: a query for the public catalog returned a private course id: %s", raw)
	}
	var got []wireRating
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal %s: %v", raw, err)
	}
	if len(got) != 1 || got[0].ID != publicCourse {
		t.Errorf("want exactly the requested id back, got %+v", got)
	}
	// Anti-vacuity: the private row EXISTS. Without this, a table that
	// never stored anything would pass every assertion above.
	if n := countAllRows(t, pool); n != 2 {
		t.Fatalf("want 2 stored ratings (one public, one private), got %d — the "+
			"assertions above prove nothing if there is no private row to leak", n)
	}
	// And A herself can still read her own vote on it, by naming it.
	mine := getRatings(t, appA, cookieA, privateCourse)
	if len(mine) != 1 || mine[0].Mine != 5 {
		t.Errorf("the owner cannot read back her own vote on her own course: %+v", mine)
	}

	// 2. No route exists that could enumerate.
	app := newTestApp(pool)
	var ratingRoutes []string
	for _, group := range app.GetRoutes() {
		if strings.HasPrefix(group.Path, "/ratings") {
			ratingRoutes = append(ratingRoutes, group.Method+" "+group.Path)
		}
	}
	sort.Strings(ratingRoutes)
	// fiber registers a HEAD route alongside every GET; both are listed.
	wantRoutes := []string{
		"GET /ratings",
		"HEAD /ratings",
		"PUT /ratings/:registryId",
	}
	if strings.Join(ratingRoutes, " | ") != strings.Join(wantRoutes, " | ") {
		t.Errorf("rating routes: want %v, got %v.\nA new route under /ratings is not a "+
			"small addition: an endpoint that lists rated courses, or a 'top rated' "+
			"endpoint, publishes the id of every private course anyone has rated. If a "+
			"new route genuinely cannot enumerate, add it here deliberately.",
			wantRoutes, ratingRoutes)
	}
}

// ── Usecase layer, over a stub ──────────────────────────────────────────

// stubRepo is a rating.Repo with scripted answers. It exists for the cases
// where the interesting input is a state a real database would take a long
// time to reach — the per-user cap needs MaxRatingsPerUser rows to exist,
// and creating 500 of them to test one branch is a slow way to learn
// nothing extra.
type stubRepo struct {
	count      int
	mine       int
	putCalls   int
	lastUserID uuid.UUID
	lastID     string
	lastStars  int
}

func (s *stubRepo) Put(_ context.Context, userID uuid.UUID, registryID string, stars int) error {
	s.putCalls++
	s.lastUserID, s.lastID, s.lastStars = userID, registryID, stars
	return nil
}

func (s *stubRepo) Aggregates(_ context.Context, _ uuid.UUID, ids []string) ([]rating.Aggregate, error) {
	out := make([]rating.Aggregate, 0, len(ids))
	for _, id := range ids {
		out = append(out, rating.Aggregate{RegistryID: id, Mine: s.mine})
	}
	return out, nil
}

func (s *stubRepo) CountForUser(context.Context, uuid.UUID) (int, error) { return s.count, nil }

// TestUsecaseRules covers the rules layer without a container: the star
// range, the registry-id shape, and the per-user cap.
func TestUsecaseRules(t *testing.T) {
	ctx := context.Background()
	user := uuid.New()

	t.Run("stars outside 1..5 are refused and never reach storage", func(t *testing.T) {
		for _, stars := range []int{-1, 0, 6, 100} {
			repo := &stubRepo{}
			err := rating.NewUsecase(repo).Rate(ctx, user, "a-course", stars)
			if err == nil {
				t.Errorf("stars=%d: want an error, got nil", stars)
			}
			if repo.putCalls != 0 {
				t.Errorf("stars=%d: refused, but Put was still called %d time(s) — a "+
					"rejection that still writes is not a rejection", stars, repo.putCalls)
			}
		}
	})

	t.Run("the session's user id is what reaches Put", func(t *testing.T) {
		repo := &stubRepo{}
		if err := rating.NewUsecase(repo).Rate(ctx, user, "a-course", 4); err != nil {
			t.Fatalf("rate: %v", err)
		}
		if repo.lastUserID != user {
			t.Errorf("Put received user %s, want %s", repo.lastUserID, user)
		}
		if repo.lastID != "a-course" || repo.lastStars != 4 {
			t.Errorf("Put received (%q, %d), want (%q, %d)", repo.lastID, repo.lastStars, "a-course", 4)
		}
	})

	t.Run("registry ids that are not one path segment are refused", func(t *testing.T) {
		for _, id := range []string{
			"",          // empty
			".",         // not a directory name
			"..",        // ditto, and the traversal shape
			"a/b",       // a separator
			`a\b`,       // the other separator
			"%2f",       // the separator, encoded — fiber does not decode params
			"%2e%2e%2f", // "../", encoded
			" leading",  // whitespace
			"trailing ", //
			"a\x00b",    // NUL
			strings.Repeat("x", rating.MaxRegistryIDBytes+1),
		} {
			repo := &stubRepo{}
			if err := rating.NewUsecase(repo).Rate(ctx, user, id, 3); err == nil {
				t.Errorf("registry id %q: want an error, got nil", id)
			}
			if repo.putCalls != 0 {
				t.Errorf("registry id %q: refused, but Put was called", id)
			}
		}
	})

	t.Run("a legitimate registry id is accepted", func(t *testing.T) {
		// Anti-vacuity for the case above: a validator that refused
		// everything would pass it. These are shapes the registry really
		// produces (the sample package's own id, and a decodable escape).
		for raw, want := range map[string]string{
			"so-dau-phay-dong": "so-dau-phay-dong",
			"khoa%20hoc":       "khoa hoc",
			strings.Repeat("x", rating.MaxRegistryIDBytes): strings.Repeat("x", rating.MaxRegistryIDBytes),
		} {
			repo := &stubRepo{}
			if err := rating.NewUsecase(repo).Rate(ctx, user, raw, 3); err != nil {
				t.Errorf("registry id %q: want accepted, got %v", raw, err)
			}
			if repo.lastID != want {
				t.Errorf("registry id %q: Put received %q, want the DECODED form %q",
					raw, repo.lastID, want)
			}
		}
	})

	t.Run("the per-user cap bounds new courses but never blocks an edit", func(t *testing.T) {
		// At the cap, with no existing vote on this course: refused.
		atCap := &stubRepo{count: rating.MaxRatingsPerUser, mine: 0}
		err := rating.NewUsecase(atCap).Rate(ctx, user, "a-new-course", 3)
		if err == nil {
			t.Errorf("at the cap, rating a NEW course: want an error, got nil")
		}
		if atCap.putCalls != 0 {
			t.Errorf("at the cap: refused, but Put was called")
		}

		// At the cap, editing a course already rated: allowed. Otherwise a
		// user at the cap could never correct a mistake, and there is no
		// delete endpoint to get them unstuck.
		editing := &stubRepo{count: rating.MaxRatingsPerUser, mine: 2}
		if err := rating.NewUsecase(editing).Rate(ctx, user, "already-rated", 5); err != nil {
			t.Errorf("at the cap, EDITING an existing vote: want allowed, got %v", err)
		}
		if editing.putCalls != 1 {
			t.Errorf("at the cap, editing: want 1 Put, got %d", editing.putCalls)
		}

		// Below the cap: allowed.
		below := &stubRepo{count: rating.MaxRatingsPerUser - 1}
		if err := rating.NewUsecase(below).Rate(ctx, user, "a-new-course", 3); err != nil {
			t.Errorf("below the cap: want allowed, got %v", err)
		}
	})

	t.Run("List refuses an empty or oversized id set", func(t *testing.T) {
		uc := rating.NewUsecase(&stubRepo{})
		if _, err := uc.List(ctx, user, nil); err == nil {
			t.Errorf("List with no ids: want an error (there is no listing of all rated courses), got nil")
		}
		too := make([]string, rating.MaxIDsPerQuery+1)
		for i := range too {
			too[i] = fmt.Sprintf("course-%d", i)
		}
		if _, err := uc.List(ctx, user, too); err == nil {
			t.Errorf("List with %d ids: want an error, got nil", len(too))
		}
		// Anti-vacuity: the largest legal request is accepted.
		ok := too[:rating.MaxIDsPerQuery]
		if _, err := uc.List(ctx, user, ok); err != nil {
			t.Errorf("List with exactly %d ids: want accepted, got %v", len(ok), err)
		}
	})
}

// ── Everything else, under one container ────────────────────────────────

// TestRatingContracts holds every HTTP case the named tests above do not
// reach, under a single shared container.
func TestRatingContracts(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie, userID, _ := registerUser(t, app, "contracts")

	t.Run("both routes require a session", func(t *testing.T) {
		for _, tc := range []struct {
			method, target string
			body           any
		}{
			{http.MethodGet, "/ratings?ids=a-course", nil},
			{http.MethodPut, "/ratings/a-course", map[string]any{"stars": 3}},
		} {
			resp, raw := do(t, app, tc.method, tc.target, tc.body, nil, nil)
			if resp.StatusCode != http.StatusUnauthorized {
				t.Errorf("%s %s without a cookie: want 401 got %d body=%s",
					tc.method, tc.target, resp.StatusCode, raw)
			}
		}
		if n := countAllRows(t, pool); n != 0 {
			t.Errorf("an unauthenticated PUT stored %d row(s)", n)
		}
	})

	t.Run("a vote round-trips and is editable", func(t *testing.T) {
		const course = "round-trip-course"
		if resp, raw := putRating(t, app, cookie, course, 2); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("first vote: want 204 got %d body=%s", resp.StatusCode, raw)
		}
		got := getRatings(t, app, cookie, course)
		if len(got) != 1 || got[0].Mine != 2 || got[0].Count != 1 || got[0].Average != 2 {
			t.Fatalf("after voting 2: %+v", got)
		}
		if resp, raw := putRating(t, app, cookie, course, 5); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("edit: want 204 got %d body=%s", resp.StatusCode, raw)
		}
		got = getRatings(t, app, cookie, course)
		if len(got) != 1 || got[0].Mine != 5 || got[0].Count != 1 {
			t.Errorf("after editing to 5 the vote count must stay 1: %+v", got)
		}
	})

	t.Run("an unrated course answers with zeros rather than being omitted", func(t *testing.T) {
		got := getRatings(t, app, cookie, "nobody-has-rated-this")
		if len(got) != 1 {
			t.Fatalf("want 1 entry for an unrated course, got %d: %+v", len(got), got)
		}
		if got[0].ID != "nobody-has-rated-this" || got[0].Count != 0 || got[0].Average != 0 || got[0].Mine != 0 {
			t.Errorf("unrated course: want zeros, got %+v", got[0])
		}
	})

	t.Run("every requested id comes back, in order, deduplicated", func(t *testing.T) {
		const a, b = "multi-a", "multi-b"
		if resp, _ := putRating(t, app, cookie, b, 4); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("seed vote")
		}
		got := getRatings(t, app, cookie, a, b, a)
		if len(got) != 2 {
			t.Fatalf("want 2 deduplicated entries, got %d: %+v", len(got), got)
		}
		if got[0].ID != a || got[1].ID != b {
			t.Errorf("want the requested order %q,%q, got %q,%q", a, b, got[0].ID, got[1].ID)
		}
	})

	t.Run("stars outside the range are refused with 400 and store nothing", func(t *testing.T) {
		const course = "range-course"
		for _, stars := range []int{0, 6, -3} {
			resp, raw := putRating(t, app, cookie, course, stars)
			if resp.StatusCode != http.StatusBadRequest {
				t.Errorf("stars=%d: want 400 got %d body=%s", stars, resp.StatusCode, raw)
			}
			if _, ok := starsOf(t, pool, userID, course); ok {
				t.Errorf("stars=%d: refused with %d but a row was written anyway",
					stars, resp.StatusCode)
			}
		}
	})

	t.Run("a malformed body is 400, and a missing stars field is 400 not a zero vote", func(t *testing.T) {
		const course = "malformed-course"
		for _, body := range []any{"not json at all", `{"stars":"five"}`, `{}`, `{"stars":null}`} {
			resp, raw := do(t, app, http.MethodPut, "/ratings/"+course, body, cookie, nil)
			if resp.StatusCode != http.StatusBadRequest {
				t.Errorf("body %v: want 400 got %d body=%s", body, resp.StatusCode, raw)
			}
		}
		if _, ok := starsOf(t, pool, userID, course); ok {
			t.Errorf("a malformed body stored a row")
		}
	})

	t.Run("a registry id that is not one path segment is 400", func(t *testing.T) {
		for _, id := range []string{"%2e%2e%2f", "%2fetc%2fpasswd", "..", "."} {
			resp, raw := do(t, app, http.MethodPut, "/ratings/"+id,
				map[string]any{"stars": 3}, cookie, nil)
			if resp.StatusCode != http.StatusBadRequest {
				t.Errorf("id %q: want 400 got %d body=%s", id, resp.StatusCode, raw)
			}
		}
	})

	t.Run("GET /ratings refuses an oversized id set", func(t *testing.T) {
		ids := make([]string, rating.MaxIDsPerQuery+1)
		for i := range ids {
			ids[i] = fmt.Sprintf("c%d", i)
		}
		resp, raw := do(t, app, http.MethodGet,
			"/ratings?ids="+strings.Join(ids, ","), nil, cookie, nil)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("want 400 got %d body=%s", resp.StatusCode, raw)
		}
	})

	t.Run("the error detail never carries a driver message", func(t *testing.T) {
		// InvalidRatingError's Reason is written from fixed phrases in
		// usecase.go. A detail that ever carried a pgx or Postgres string
		// would be publishing schema internals to a caller.
		resp, raw := putRating(t, app, cookie, "..", 3)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("want 400 got %d", resp.StatusCode)
		}
		for _, leak := range []string{"pgx", "SQLSTATE", "course_ratings", "postgres"} {
			if bytes.Contains(bytes.ToLower(raw), bytes.ToLower([]byte(leak))) {
				t.Errorf("error body leaked %q: %s", leak, raw)
			}
		}
	})
}

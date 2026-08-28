// Package stats_test exercises the stats package end to end, through
// internal/server.New — the same wiring the web client (a later task) will
// depend on — against a real Postgres via store.TestPool. It is an
// external test package (stats_test, not stats) so it can import server
// (which will import stats) without a cycle, mirroring
// internal/sync/sync_test.go's and internal/auth/auth_test.go's own
// approach.
//
// This file is written BEFORE internal/stats/{handler.go,repo.go} exist —
// it drives the RED step of TDD purely through HTTP against the app
// server.New builds, so it needs no direct import of the (not yet
// written) stats package at all: until POST /events/batch and GET /stats
// are mounted, every request below 404s, which is the expected RED
// failure for a brand-new route pair.
package stats_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/server"
	"github.com/vndee/tuhoc-api/internal/stats"
	"github.com/vndee/tuhoc-api/internal/store"
)

const testTimeoutMS = 10000

const sessionCookieName = "tuhoc_session"

// ictOffset is Vietnam's fixed UTC+7 offset (no DST since 1975),
// independently redefined here from the implementation's own icTZ so the
// test asserts against the *specification* of "Vietnam's calendar day",
// not merely against whatever the implementation happens to compute.
var ict = time.FixedZone("ICT", 7*3600)

const dateLayout = "2006-01-02"

func newTestApp(pool *pgxpool.Pool) *fiber.App {
	return server.New(config.Config{CookieSecure: false}, server.Deps{Pool: pool, LogOutput: io.Discard})
}

func uniqueEmail(label string) string {
	return fmt.Sprintf("stats-%s-%s@example.test", label, uuid.NewString())
}

// todayICT returns the start of "today" in Vietnam's fixed UTC+7 offset —
// the day-boundary tests anchor every date assertion to (see the task's
// timezone ruling recorded in handler.go once it exists, and this file's
// own "timezone" subtest below, which is what actually pins the choice).
func todayICT() time.Time {
	now := time.Now().In(ict)
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, ict)
}

// --- generic HTTP helpers, matching sync_test.go's / auth_test.go's doRequest pattern ---

func doRequest(t *testing.T, app *fiber.App, method, path string, body any, cookie *http.Cookie) (*http.Response, []byte) {
	t.Helper()

	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		reader = bytes.NewReader(b)
	}

	req := httptest.NewRequest(method, path, reader)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}

	resp, err := app.Test(req, testTimeoutMS)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("%s %s: read body: %v", method, path, err)
	}
	resp.Body.Close()

	return resp, raw
}

func sessionCookie(resp *http.Response) *http.Cookie {
	for _, c := range resp.Cookies() {
		if c.Name == sessionCookieName {
			return c
		}
	}
	return nil
}

func mustUnmarshal(t *testing.T, raw []byte, v any) {
	t.Helper()
	if err := json.Unmarshal(raw, v); err != nil {
		t.Fatalf("unmarshal %s: %v", raw, err)
	}
}

type apiUser struct {
	ID    string `json:"id"`
	Email string `json:"email"`
}

// registerUser creates a fresh account and returns its session cookie and
// user id. Each subtest gets its own user(s) so subtests never contend
// over the same rows.
func registerUser(t *testing.T, app *fiber.App, label string) (*http.Cookie, string) {
	t.Helper()
	email := uniqueEmail(label)
	resp, raw := doRequest(t, app, http.MethodPost, "/auth/register",
		map[string]string{"email": email, "password": "stats-test-password-1", "name": label}, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("register %s: want 200 got %d body=%s", label, resp.StatusCode, raw)
	}
	var u apiUser
	if err := json.Unmarshal(raw, &u); err != nil {
		t.Fatalf("register %s: unmarshal: %v", label, err)
	}
	cookie := sessionCookie(resp)
	if cookie == nil {
		t.Fatalf("register %s: no session cookie", label)
	}
	return cookie, u.ID
}

// --- events/batch + progress (sync) body builders ---

func heartbeatItem(courseID, chapterID string, at time.Time) map[string]any {
	return map[string]any{
		"courseId":  courseID,
		"chapterId": chapterID,
		"kind":      "heartbeat",
		"meta":      map[string]any{},
		"at":        at.Format(time.RFC3339Nano),
	}
}

func eventItem(courseID, chapterID, kind string, at time.Time) map[string]any {
	return map[string]any{
		"courseId":  courseID,
		"chapterId": chapterID,
		"kind":      kind,
		"meta":      map[string]any{},
		"at":        at.Format(time.RFC3339Nano),
	}
}

func eventsBatchBody(events []map[string]any) map[string]any {
	if events == nil {
		events = []map[string]any{}
	}
	return map[string]any{"events": events}
}

// progressPushItem mirrors sync_test.go's own builder — used here only to
// seed progress rows (via the already-implemented POST /sync) so
// chaptersDone tests exercise a real integration path end to end instead
// of reaching into the database directly.
func progressPushItem(courseID, chapterID, status string, done bool, updatedAt time.Time) map[string]any {
	return map[string]any{
		"courseId":  courseID,
		"chapterId": chapterID,
		"status":    status,
		"done":      done,
		"updatedAt": updatedAt.Format(time.RFC3339Nano),
	}
}

func pushProgress(t *testing.T, app *fiber.App, cookie *http.Cookie, items ...map[string]any) {
	t.Helper()
	resp, raw := doRequest(t, app, http.MethodPost, "/sync",
		map[string]any{"progress": items, "annotations": []map[string]any{}}, cookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("seed progress via POST /sync: want 200 got %d body=%s", resp.StatusCode, raw)
	}
}

// --- response shapes mirroring handler.go's JSON contracts ---

type dayOut struct {
	Date    string  `json:"date"`
	Minutes float64 `json:"minutes"`
}

type courseOut struct {
	CourseID     string  `json:"courseId"`
	Minutes      float64 `json:"minutes"`
	ChaptersDone int64   `json:"chaptersDone"`
}

type courseYearOut struct {
	CourseID string  `json:"courseId"`
	Minutes  float64 `json:"minutes"`
	Share    float64 `json:"share"`
}

type statsOut struct {
	TotalMinutes float64         `json:"totalMinutes"`
	StreakDays   int             `json:"streakDays"`
	Days         []dayOut        `json:"days"`
	Courses      []courseOut     `json:"courses"`
	Years        []int           `json:"years"`
	YearCourses  []courseYearOut `json:"yearCourses"`
}

type eventsBatchOut struct {
	Accepted int `json:"accepted"`
}

func postEvents(t *testing.T, app *fiber.App, cookie *http.Cookie, events []map[string]any) (*http.Response, eventsBatchOut) {
	t.Helper()
	resp, raw := doRequest(t, app, http.MethodPost, "/events/batch", eventsBatchBody(events), cookie)
	var out eventsBatchOut
	if resp.StatusCode == http.StatusOK {
		mustUnmarshal(t, raw, &out)
	}
	return resp, out
}

func getStats(t *testing.T, app *fiber.App, cookie *http.Cookie) statsOut {
	t.Helper()
	resp, raw := doRequest(t, app, http.MethodGet, "/stats", nil, cookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /stats: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	var out statsOut
	mustUnmarshal(t, raw, &out)
	return out
}

// getStatsYear is getStats with `?year=`. A separate helper rather than a
// variadic on getStats: every existing call site asks the DEFAULT question
// (30 days ending today), and that default is a documented contract — making
// it one branch of a shared helper is how a default quietly changes.
func getStatsYear(t *testing.T, app *fiber.App, cookie *http.Cookie, year string) statsOut {
	t.Helper()
	resp, raw := doRequest(t, app, http.MethodGet, "/stats?year="+year, nil, cookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /stats?year=%s: want 200 got %d body=%s", year, resp.StatusCode, raw)
	}
	var out statsOut
	mustUnmarshal(t, raw, &out)
	return out
}

func findDay(days []dayOut, date string) (dayOut, bool) {
	for _, d := range days {
		if d.Date == date {
			return d, true
		}
	}
	return dayOut{}, false
}

func findCourse(courses []courseOut, courseID string) (courseOut, bool) {
	for _, c := range courses {
		if c.CourseID == courseID {
			return c, true
		}
	}
	return courseOut{}, false
}

// TestStatsFlows covers the brief's own pinned case (three seeded days ->
// streak=2 with correct minutes) plus every case this task's decision
// questions call out: timezone day-boundary correctness, the two streak
// edge cases (today-only-required, and studied-yesterday-not-today),
// always-30-zero-filled days, idempotent batch replay, user isolation,
// and the 401 case for both routes (ruling F3). All subtests share one
// store.TestPool container (each gets its own fiber.App instance and its
// own user(s)) to keep the container-spin-up cost to once per run, exactly
// like sync_test.go and auth_test.go.
func TestStatsFlows(t *testing.T) {
	pool := store.TestPool(t)

	// Ruling F3: both routes must reject an unauthenticated request with
	// 401 — the same case sync_test.go pins for /sync, exercised here for
	// stats's own two routes.
	t.Run("401 without a session cookie on both POST /events/batch and GET /stats", func(t *testing.T) {
		app := newTestApp(pool)

		postResp, postRaw := doRequest(t, app, http.MethodPost, "/events/batch",
			eventsBatchBody(nil), nil)
		if postResp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("POST /events/batch without cookie: want 401 got %d body=%s", postResp.StatusCode, postRaw)
		}

		getResp, getRaw := doRequest(t, app, http.MethodGet, "/stats", nil, nil)
		if getResp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("GET /stats without cookie: want 401 got %d body=%s", getResp.StatusCode, getRaw)
		}
	})

	t.Run("POST /events/batch rejects a batch item missing a required field, with zero side effects", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "invalid")

		bad := map[string]any{
			"courseId":  "", // missing
			"chapterId": "ch1",
			"kind":      "heartbeat",
			"meta":      map[string]any{},
			"at":        todayICT().Add(9 * time.Hour).Format(time.RFC3339Nano),
		}
		resp, raw := doRequest(t, app, http.MethodPost, "/events/batch", eventsBatchBody([]map[string]any{bad}), cookie)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("missing courseId: want 400 got %d body=%s", resp.StatusCode, raw)
		}

		got := getStats(t, app, cookie)
		if got.TotalMinutes != 0 {
			t.Fatalf("rejected batch must have zero side effects, got totalMinutes=%v", got.TotalMinutes)
		}
	})

	// The counterpart of internal/sync's own item-cap case, and for the
	// same measured reason: this handler had no cap at all (its own doc
	// comment said so and deferred it), every event becomes one row in a
	// single transaction, and a review confirmed thousands of real rows
	// landing from one request. The route's byte limit cannot stand in for
	// this — an event item can be shrunk far below its realistic size, so
	// the item count is not a function of the body size.
	//
	// The boundary is pinned without ever writing MaxEventsPerBatch rows:
	// the cap is checked before the per-item loop, so exactly the cap with
	// a malformed last item is a 400 (the cap passed it, the parser caught
	// it) and one more is a 413.
	t.Run("a batch over the item cap is refused before any of it is parsed", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "itemcap")

		at := todayICT().Add(9 * time.Hour)
		batch := func(n int) []map[string]any {
			items := make([]map[string]any, 0, n)
			for len(items) < n-1 {
				items = append(items, heartbeatItem("c1", fmt.Sprintf("ch-%d", len(items)), at))
			}
			items = append(items, map[string]any{
				"courseId": "", "chapterId": "ch-last", "kind": "heartbeat",
				"meta": map[string]any{}, "at": at.Format(time.RFC3339Nano),
			})
			return items
		}

		over := batch(stats.MaxEventsPerBatch + 1)
		resp, raw := doRequest(t, app, http.MethodPost, "/events/batch", eventsBatchBody(over), cookie)
		if resp.StatusCode != http.StatusRequestEntityTooLarge {
			t.Fatalf("%d events (cap is %d): want 413 got %d body=%s",
				len(over), stats.MaxEventsPerBatch, resp.StatusCode, raw)
		}

		atCap := batch(stats.MaxEventsPerBatch)
		atResp, atRaw := doRequest(t, app, http.MethodPost, "/events/batch", eventsBatchBody(atCap), cookie)
		if atResp.StatusCode != http.StatusBadRequest {
			t.Fatalf("exactly %d events (cap is %d): want 400 from the parse loop, got %d body=%s",
				len(atCap), stats.MaxEventsPerBatch, atResp.StatusCode, atRaw)
		}

		if got := getStats(t, app, cookie); got.TotalMinutes != 0 {
			t.Errorf("a refused batch had side effects: totalMinutes=%v", got.TotalMinutes)
		}

		// Anti-vacuity: an ordinary batch from the same session applies.
		okResp, okOut := postEvents(t, app, cookie, []map[string]any{heartbeatItem("c1", "ch-ok", at)})
		if okResp.StatusCode != http.StatusOK {
			t.Fatalf("an ordinary batch: want 200 got %d", okResp.StatusCode)
		}
		if okOut.Accepted != 1 {
			t.Errorf("an ordinary batch: want accepted=1 got %d", okOut.Accepted)
		}
	})

	t.Run("POST /events/batch with an empty events array is a 200 no-op", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "empty")

		resp, out := postEvents(t, app, cookie, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("empty batch: want 200 got %d", resp.StatusCode)
		}
		if out.Accepted != 0 {
			t.Fatalf("empty batch: want accepted=0 got %d", out.Accepted)
		}
	})

	// This is the brief's own pinned case (task-8-brief.md step 1): seed
	// events across three days — today, yesterday, and three days ago,
	// with a gap at two-days-ago — and assert streak=2 (the gap breaks
	// it) with minutes correctly converted (0.5 per heartbeat) and summed.
	t.Run("seeded events across three days: streak breaks at the gap, minutes convert and sum correctly", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "seeded3day")

		today := todayICT()
		yesterday := today.AddDate(0, 0, -1)
		threeDaysAgo := today.AddDate(0, 0, -3)

		var events []map[string]any
		// today: 4 heartbeats = 2.0 minutes
		for i := 0; i < 4; i++ {
			events = append(events, heartbeatItem("c1", "ch1", today.Add(time.Duration(9*60+i)*time.Minute)))
		}
		// yesterday: 2 heartbeats = 1.0 minute
		for i := 0; i < 2; i++ {
			events = append(events, heartbeatItem("c1", "ch1", yesterday.Add(time.Duration(9*60+i)*time.Minute)))
		}
		// three days ago: 6 heartbeats = 3.0 minutes (two-days-ago is left empty: the gap)
		for i := 0; i < 6; i++ {
			events = append(events, heartbeatItem("c1", "ch1", threeDaysAgo.Add(time.Duration(9*60+i)*time.Minute)))
		}

		resp, out := postEvents(t, app, cookie, events)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("seed events: want 200 got %d", resp.StatusCode)
		}
		if out.Accepted != 12 {
			t.Fatalf("seed events: want accepted=12 got %d", out.Accepted)
		}

		got := getStats(t, app, cookie)

		if got.StreakDays != 2 {
			t.Fatalf("want streakDays=2 (today+yesterday, broken by the two-days-ago gap), got %d", got.StreakDays)
		}
		if got.TotalMinutes != 6.0 {
			t.Fatalf("want totalMinutes=6.0 (2.0+1.0+3.0), got %v", got.TotalMinutes)
		}

		cases := []struct {
			label string
			date  time.Time
			want  float64
		}{
			{"today", today, 2.0},
			{"yesterday", yesterday, 1.0},
			{"two days ago (the gap)", today.AddDate(0, 0, -2), 0.0},
			{"three days ago", threeDaysAgo, 3.0},
		}
		for _, tc := range cases {
			d, ok := findDay(got.Days, tc.date.Format(dateLayout))
			if !ok {
				t.Fatalf("%s (%s): missing from days[] entirely", tc.label, tc.date.Format(dateLayout))
			}
			if d.Minutes != tc.want {
				t.Fatalf("%s (%s): want minutes=%v got %v", tc.label, tc.date.Format(dateLayout), tc.want, d.Minutes)
			}
		}

		c, ok := findCourse(got.Courses, "c1")
		if !ok {
			t.Fatalf("course c1 missing from courses[]")
		}
		if c.Minutes != 6.0 {
			t.Fatalf("course c1: want minutes=6.0 got %v", c.Minutes)
		}
	})

	// Controller ruling (fix round 1, superseding the original literal
	// reading of "streak = số ngày liên tiếp TÍNH TỪ HÔM NAY"): a user who
	// studied last night and opens the dashboard before studying again
	// today must not see their streak reset to 0 — that makes a number
	// meant to motivate into something demotivating. The rule is now:
	//   - today has activity  -> count the consecutive run ending today.
	//   - today has none, but yesterday does -> count the consecutive run
	//     ending yesterday (the streak survives until a full day passes
	//     with NO activity at all, not merely until the calendar rolls
	//     over).
	//   - neither today nor yesterday has activity -> 0.
	// This subtest pins the middle case: nothing today yet, a heartbeat
	// yesterday -> streak must read 1, not 0.
	t.Run("streak stays alive through yesterday: studied yesterday, nothing today yet, reads as streak=1", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "yesterdayonly")

		yesterday := todayICT().AddDate(0, 0, -1)
		resp, _ := postEvents(t, app, cookie, []map[string]any{
			heartbeatItem("c1", "ch1", yesterday.Add(9*time.Hour)),
		})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("seed yesterday heartbeat: want 200 got %d", resp.StatusCode)
		}

		got := getStats(t, app, cookie)
		if got.StreakDays != 1 {
			t.Fatalf("studied yesterday, nothing today yet: want streakDays=1 (streak survives until today ENDS with no activity, not merely until the calendar rolls over) got %d", got.StreakDays)
		}
		// Yesterday's minutes must still show up in the chart and total —
		// this was never in question, only the streak anchor changed.
		d, ok := findDay(got.Days, yesterday.Format(dateLayout))
		if !ok || d.Minutes != 0.5 {
			t.Fatalf("yesterday's heartbeat must still appear in days[] with minutes=0.5, got %+v (found=%v)", d, ok)
		}
		if got.TotalMinutes != 0.5 {
			t.Fatalf("want totalMinutes=0.5 got %v", got.TotalMinutes)
		}
	})

	// Pins the third branch of the same rule: once a full day has passed
	// with NO activity at all (neither today nor yesterday), the streak is
	// really 0 — this is what actually distinguishes "streak survives
	// through yesterday" from "streak is broken by anything other than
	// today". A fixture with zero events anywhere (as the brand-new-user
	// test uses) cannot tell these apart, because an empty byDay map
	// trivially yields 0 under either interpretation; this fixture seeds
	// genuine older history (3 and 4 days ago) so the "yesterday" check
	// actually has to look at real data and correctly find nothing.
	t.Run("streak resets to 0 once a full day passes with no activity: older history alone does not keep it alive", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "olderhistory")

		threeDaysAgo := todayICT().AddDate(0, 0, -3)
		fourDaysAgo := todayICT().AddDate(0, 0, -4)
		resp, _ := postEvents(t, app, cookie, []map[string]any{
			heartbeatItem("c1", "ch1", threeDaysAgo.Add(9*time.Hour)),
			heartbeatItem("c1", "ch1", fourDaysAgo.Add(9*time.Hour)),
		})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("seed older-history heartbeats: want 200 got %d", resp.StatusCode)
		}

		got := getStats(t, app, cookie)
		if got.StreakDays != 0 {
			t.Fatalf("activity only 3-4 days ago (nothing today or yesterday): want streakDays=0 got %d", got.StreakDays)
		}
		// Confirm this isn't vacuously passing on an empty dataset: the
		// older history must still be visible elsewhere in the response.
		if got.TotalMinutes != 1.0 {
			t.Fatalf("older history must still count toward totalMinutes: want 1.0 got %v", got.TotalMinutes)
		}
	})

	// This is the test that actually PROVES the timezone ruling, not just
	// states it: a heartbeat at 00:30 Vietnam time (ICT, UTC+7) falls at
	// 17:30 the PREVIOUS day in UTC. A server that buckets calendar days
	// by UTC (or by whatever arbitrary zone the deploy host's local clock
	// happens to be in) would attribute this heartbeat to yesterday and
	// this test would fail. Bucketing by Vietnam's fixed UTC+7 offset
	// attributes it to today, which is what the student actually
	// experienced.
	t.Run("timezone: a heartbeat just after midnight ICT lands on today's Vietnam date, not the UTC date", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "tzmidnight")

		today := todayICT()
		justAfterMidnightICT := today.Add(30 * time.Minute) // 00:30 ICT == 17:30 UTC the day before

		// Sanity-check the test's own premise: the naive "bucket by the
		// instant's UTC calendar date" answer (what a server that ignored
		// the Vietnam offset would compute) must actually differ from the
		// correct ICT-bucketed answer (today's date), or this test would
		// pass vacuously regardless of which bucketing the implementation
		// uses.
		naiveUTCDate := justAfterMidnightICT.UTC().Format(dateLayout)
		if naiveUTCDate == today.Format(dateLayout) {
			t.Fatalf("test setup invariant broken: expected the naive UTC-bucketed date (%s) to differ from today's correct ICT date (%s)", naiveUTCDate, today.Format(dateLayout))
		}

		resp, _ := postEvents(t, app, cookie, []map[string]any{
			heartbeatItem("c1", "ch1", justAfterMidnightICT),
		})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("seed midnight-boundary heartbeat: want 200 got %d", resp.StatusCode)
		}

		got := getStats(t, app, cookie)

		todayEntry, ok := findDay(got.Days, today.Format(dateLayout))
		if !ok || todayEntry.Minutes != 0.5 {
			t.Fatalf("want the 00:30 ICT heartbeat attributed to TODAY's Vietnam date (%s) with minutes=0.5, got %+v (found=%v)", today.Format(dateLayout), todayEntry, ok)
		}

		yesterday := today.AddDate(0, 0, -1)
		yesterdayEntry, ok := findDay(got.Days, yesterday.Format(dateLayout))
		if ok && yesterdayEntry.Minutes != 0 {
			t.Fatalf("the heartbeat must NOT be attributed to the UTC calendar date (yesterday, %s): got minutes=%v", yesterday.Format(dateLayout), yesterdayEntry.Minutes)
		}

		if got.StreakDays != 1 {
			t.Fatalf("want streakDays=1 (today has activity per the correct ICT bucketing), got %d", got.StreakDays)
		}
	})

	// The client's outbox retries a batch on failure, which can resend a
	// batch whose events already landed (e.g. the request succeeded but
	// the response was lost). Replaying an identical batch must not
	// double the totals.
	t.Run("idempotent replay: posting an identical batch twice does not double the totals", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "idempotent")

		today := todayICT()
		batch := []map[string]any{
			heartbeatItem("c1", "ch1", today.Add(9*time.Hour)),
			heartbeatItem("c1", "ch1", today.Add(9*time.Hour+30*time.Second)),
		}

		resp1, out1 := postEvents(t, app, cookie, batch)
		if resp1.StatusCode != http.StatusOK {
			t.Fatalf("first post: want 200 got %d", resp1.StatusCode)
		}
		if out1.Accepted != 2 {
			t.Fatalf("first post: want accepted=2 (both new) got %d", out1.Accepted)
		}

		resp2, out2 := postEvents(t, app, cookie, batch)
		if resp2.StatusCode != http.StatusOK {
			t.Fatalf("replay: want 200 got %d", resp2.StatusCode)
		}
		if out2.Accepted != 0 {
			t.Fatalf("replay: want accepted=0 (both already exist) got %d", out2.Accepted)
		}

		got := getStats(t, app, cookie)
		if got.TotalMinutes != 1.0 {
			t.Fatalf("replay must not double totals: want totalMinutes=1.0 (2 heartbeats, not 4) got %v", got.TotalMinutes)
		}
	})

	t.Run("days[] always has exactly 30 zero-filled entries, ascending, ending today, for a brand-new user", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "fresh")

		got := getStats(t, app, cookie)

		if got.TotalMinutes != 0 {
			t.Fatalf("fresh user: want totalMinutes=0 got %v", got.TotalMinutes)
		}
		if got.StreakDays != 0 {
			t.Fatalf("fresh user: want streakDays=0 got %d", got.StreakDays)
		}
		if len(got.Courses) != 0 {
			t.Fatalf("fresh user: want courses=[] got %+v", got.Courses)
		}
		if len(got.Days) != 30 {
			t.Fatalf("want exactly 30 day entries (zero-filled, not just active days), got %d", len(got.Days))
		}

		today := todayICT()
		wantFirst := today.AddDate(0, 0, -29).Format(dateLayout)
		wantLast := today.Format(dateLayout)
		if got.Days[0].Date != wantFirst {
			t.Fatalf("want days[0].date=%s (oldest, ascending order) got %s", wantFirst, got.Days[0].Date)
		}
		if got.Days[29].Date != wantLast {
			t.Fatalf("want days[29].date=%s (today, last) got %s", wantLast, got.Days[29].Date)
		}
		for _, d := range got.Days {
			if d.Minutes != 0 {
				t.Fatalf("fresh user: every day must be zero-filled, got %+v", d)
			}
		}
	})

	// Ruling F5: chaptersDone is a straight count of completed chapters
	// (progress rows with status='read' AND done=true), not a percentage
	// — the server has no notion of a course's total chapter count.
	// Exercise-status rows and done=false rows must not count. courses[]
	// is a UNION of courses seen via heartbeats and via completed
	// chapters, not an intersection: a course with only progress (no
	// heartbeat yet) or only heartbeats (no chapter marked done yet) must
	// still appear, with the missing side defaulting to zero.
	t.Run("chaptersDone counts only status=read done=true rows; courses[] unions heartbeat and progress courses", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "chapters")
		now := todayICT().Add(9 * time.Hour)

		// course "with-heartbeats": 2 completed chapters, 1 exercise
		// (must not count), 1 unmarked (done=false, must not count).
		pushProgress(t, app, cookie,
			progressPushItem("with-heartbeats", "ch1", "read", true, now),
			progressPushItem("with-heartbeats", "ch2", "read", true, now),
			progressPushItem("with-heartbeats", "ch3", "ex:1", true, now),
			progressPushItem("with-heartbeats", "ch4", "read", false, now),
		)
		resp, _ := postEvents(t, app, cookie, []map[string]any{
			heartbeatItem("with-heartbeats", "ch1", now),
		})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("seed heartbeat: want 200 got %d", resp.StatusCode)
		}

		// course "progress-only": 1 completed chapter, no heartbeats at all.
		pushProgress(t, app, cookie,
			progressPushItem("progress-only", "chA", "read", true, now),
		)

		got := getStats(t, app, cookie)

		c1, ok := findCourse(got.Courses, "with-heartbeats")
		if !ok {
			t.Fatalf("course with-heartbeats missing from courses[]")
		}
		if c1.ChaptersDone != 2 {
			t.Fatalf("with-heartbeats: want chaptersDone=2 (ex: and done=false excluded) got %d", c1.ChaptersDone)
		}
		if c1.Minutes != 0.5 {
			t.Fatalf("with-heartbeats: want minutes=0.5 got %v", c1.Minutes)
		}

		c2, ok := findCourse(got.Courses, "progress-only")
		if !ok {
			t.Fatalf("course progress-only missing from courses[] (union must include progress-only courses)")
		}
		if c2.ChaptersDone != 1 {
			t.Fatalf("progress-only: want chaptersDone=1 got %d", c2.ChaptersDone)
		}
		if c2.Minutes != 0 {
			t.Fatalf("progress-only: want minutes=0 (no heartbeats posted) got %v", c2.Minutes)
		}
	})

	t.Run("only kind=heartbeat events convert to minutes; other event kinds are stored but not counted", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "kindfilter")
		now := todayICT().Add(9 * time.Hour)

		resp, _ := postEvents(t, app, cookie, []map[string]any{
			heartbeatItem("c1", "ch1", now),
			eventItem("c1", "ch1", "chapter_complete", now.Add(time.Minute)),
		})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("seed mixed-kind events: want 200 got %d", resp.StatusCode)
		}

		got := getStats(t, app, cookie)
		if got.TotalMinutes != 0.5 {
			t.Fatalf("non-heartbeat kind must not contribute minutes: want totalMinutes=0.5 got %v", got.TotalMinutes)
		}
	})

	t.Run("user isolation: another user's events and completed chapters never appear in my stats", func(t *testing.T) {
		app := newTestApp(pool)
		cookieA, _ := registerUser(t, app, "isoA")
		cookieB, _ := registerUser(t, app, "isoB")
		now := todayICT().Add(9 * time.Hour)

		respA, _ := postEvents(t, app, cookieA, []map[string]any{
			heartbeatItem("c1", "ch1", now),
			heartbeatItem("c1", "ch1", now.Add(30*time.Second)),
		})
		if respA.StatusCode != http.StatusOK {
			t.Fatalf("user A seed events: want 200 got %d", respA.StatusCode)
		}
		pushProgress(t, app, cookieA, progressPushItem("c1", "ch1", "read", true, now))

		gotB := getStats(t, app, cookieB)
		if gotB.TotalMinutes != 0 {
			t.Fatalf("user B must not see user A's minutes: want 0 got %v", gotB.TotalMinutes)
		}
		if gotB.StreakDays != 0 {
			t.Fatalf("user B must not see user A's streak: want 0 got %d", gotB.StreakDays)
		}
		if len(gotB.Courses) != 0 {
			t.Fatalf("user B must not see user A's courses: want [] got %+v", gotB.Courses)
		}

		gotA := getStats(t, app, cookieA)
		if gotA.TotalMinutes != 1.0 {
			t.Fatalf("user A's own stats must be unaffected: want totalMinutes=1.0 got %v", gotA.TotalMinutes)
		}
	})
}

// ══════════════════════════════════════════════════════════════════════════
// GET /stats?year= — lịch cả năm kiểu GitHub
// ══════════════════════════════════════════════════════════════════════════
//
// Người dùng yêu cầu: hiện lịch học như GitHub — cả năm, kèm danh sách năm và
// danh sách khoá học trong năm với trọng số.
//
// Điều kiện đi kèm, và nó là điều kiện đắt nhất: `?year=` phải THÊM VÀO chứ
// không đổi câu trả lời mặc định. Bài "days[] always has exactly 30 entries"
// ở trên là hợp đồng của Bảng điều khiển, và nó phải xanh y nguyên.
func TestStatsYearView(t *testing.T) {
	pool := store.TestPool(t)

	t.Run("không có ?year= thì câu trả lời không đổi: vẫn đúng 30 ngày", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "year-default")

		got := getStats(t, app, cookie)
		if len(got.Days) != 30 {
			t.Fatalf("mặc định phải giữ nguyên 30 ngày, got %d", len(got.Days))
		}
		// Và `yearCourses` rỗng chứ không phải null: một client không hỏi năm
		// nào thì không phải phòng thủ trước `null`.
		if got.YearCourses == nil {
			t.Fatalf("yearCourses phải là mảng rỗng, không phải null")
		}
		if len(got.YearCourses) != 0 {
			t.Fatalf("không hỏi năm thì yearCourses phải rỗng, got %+v", got.YearCourses)
		}
	})

	t.Run("?year= trả cả năm, và năm HIỆN TẠI dừng ở hôm nay chứ không vẽ tương lai", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "year-current")

		today := todayICT()
		year := today.Year()

		got := getStatsYear(t, app, cookie, strconv.Itoa(year))

		wantLen := today.YearDay()
		if len(got.Days) != wantLen {
			t.Fatalf("năm hiện tại phải dừng ở hôm nay: want %d ngày (YearDay), got %d", wantLen, len(got.Days))
		}
		if got.Days[0].Date != time.Date(year, time.January, 1, 0, 0, 0, 0, ict).Format(dateLayout) {
			t.Fatalf("ngày đầu phải là 1 tháng 1, got %s", got.Days[0].Date)
		}
		if last := got.Days[len(got.Days)-1].Date; last != today.Format(dateLayout) {
			t.Fatalf("ngày cuối phải là hôm nay (%s), got %s", today.Format(dateLayout), last)
		}
	})

	t.Run("một năm đã qua chạy trọn 1/1 tới 31/12", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "year-past")

		past := todayICT().Year() - 1
		got := getStatsYear(t, app, cookie, strconv.Itoa(past))

		wantLen := 365
		if past%4 == 0 && (past%100 != 0 || past%400 == 0) {
			wantLen = 366
		}
		if len(got.Days) != wantLen {
			t.Fatalf("năm %d phải có %d ngày, got %d", past, wantLen, len(got.Days))
		}
	})

	t.Run("năm rác không làm sập và không dựng một mảng khổng lồ — nó lùi về mặc định", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "year-garbage")

		// `999999` là ca đáng sợ: không có hàng rào, vòng lặp dựng ~365 triệu
		// phần tử trước khi có ai kịp phản đối.
		for _, raw := range []string{"999999", "abc", "-5", "1899"} {
			got := getStatsYear(t, app, cookie, raw)
			if len(got.Days) != 30 {
				t.Fatalf("year=%q phải lùi về 30 ngày, got %d", raw, len(got.Days))
			}
		}
	})

	t.Run("years[] luôn có năm hiện tại, kể cả tài khoản mới tinh", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "year-list-empty")

		got := getStats(t, app, cookie)
		if len(got.Years) != 1 || got.Years[0] != todayICT().Year() {
			t.Fatalf("tài khoản rỗng vẫn phải có đúng năm hiện tại trong years[], got %+v", got.Years)
		}
	})

	t.Run("yearCourses: đúng khoá của năm ấy, trọng số cộng lại bằng 1, nhiều phút nhất đứng đầu", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "year-courses")

		today := todayICT()
		year := today.Year()

		// c1: 3 nhịp, c2: 1 nhịp — cùng năm nay.
		batch := []map[string]any{
			heartbeatItem("c1", "ch1", today.Add(9*time.Hour)),
			heartbeatItem("c1", "ch1", today.Add(9*time.Hour+30*time.Second)),
			heartbeatItem("c1", "ch2", today.Add(10*time.Hour)),
			heartbeatItem("c2", "ch1", today.Add(11*time.Hour)),
		}
		if resp, _ := postEvents(t, app, cookie, batch); resp.StatusCode != http.StatusOK {
			t.Fatalf("post events: want 200 got %d", resp.StatusCode)
		}

		got := getStatsYear(t, app, cookie, strconv.Itoa(year))
		if len(got.YearCourses) != 2 {
			t.Fatalf("want 2 khoá trong năm, got %+v", got.YearCourses)
		}
		if got.YearCourses[0].CourseID != "c1" {
			t.Fatalf("khoá nhiều phút nhất phải đứng đầu, got %+v", got.YearCourses)
		}

		var sum float64
		for _, c := range got.YearCourses {
			sum += c.Share
		}
		if sum < 0.999 || sum > 1.001 {
			t.Fatalf("trọng số phải cộng lại bằng 1, got %v (%+v)", sum, got.YearCourses)
		}
		if got.YearCourses[0].Share <= got.YearCourses[1].Share {
			t.Fatalf("c1 có 3/4 số nhịp nên trọng số phải lớn hơn c2, got %+v", got.YearCourses)
		}

		// ĐỐI CHỨNG: hỏi một năm KHÔNG có hoạt động thì danh sách rỗng — nếu
		// bộ lọc theo năm hỏng, cả bốn nhịp trên sẽ rơi vào mọi năm.
		empty := getStatsYear(t, app, cookie, strconv.Itoa(year-1))
		if len(empty.YearCourses) != 0 {
			t.Fatalf("năm không có hoạt động phải cho danh sách rỗng, got %+v", empty.YearCourses)
		}

		// Và `courses[]` (LIFETIME) không bị đụng tới — hai cửa sổ, hai con số.
		if len(got.Courses) != 2 {
			t.Fatalf("courses[] lifetime phải vẫn có 2 khoá, got %+v", got.Courses)
		}
	})
}

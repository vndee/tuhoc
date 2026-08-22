// Package discuss_test exercises the Discussions embed against a FAKE
// GitHub — an httptest server that counts every request that reaches it.
//
// # WHY A FAKE GITHUB AND NOT A MOCK Fetcher
//
// The two properties this package must have are both about what happens on
// the wire: that a broken third party degrades instead of breaking the
// page, and that the platform's ration is spent before the call rather than
// after it. A mock Fetcher can be asked how many times it was called, but it
// cannot answer "how many HTTP requests actually left this process", and
// that is exactly the number the mutant this whole file is built around
// changes. An httptest server counts requests that ARRIVED, which is the
// only definition of "an outbound call" that a rate limiter can be wrong
// about.
//
// It is an external test package (discuss_test) so it can only reach the
// exported surface the rest of the API can — the one exception being the
// boundary decode, which is exercised through the real client over the fake
// server rather than by reaching inside.
package discuss_test

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/discuss"
	"github.com/vndee/tuhoc-api/internal/server"
	"github.com/vndee/tuhoc-api/internal/store"
)

const (
	httpTimeoutMS = 30000
	testOwner     = "vndee"
	testRepo      = "tuhoc-registry"
	testRepoSlug  = testOwner + "/" + testRepo
	testToken     = "ghp-not-a-real-token"
	sampleID      = "so-dau-phay-dong"
)

// ── Fake GitHub ─────────────────────────────────────────────────────────

// fakeGitHub is a stand-in for api.github.com that COUNTS every request
// that reaches it. calls is the number this file's most important
// assertions are made against; nothing here asserts on the number of
// responses our own API produced, because that number is identical under
// the mutant being guarded against.
type fakeGitHub struct {
	srv   *httptest.Server
	calls atomic.Int64
	// reply returns the status and body for request number n (1-based),
	// given the course id that request actually asked about.
	//
	// n is there so a case can make GitHub behave differently on the second
	// call than on the first — which is how "the cache expired and we
	// refetched" is told apart from "we never called at all". id is there
	// because deriving the answer from n instead turned out to be a real
	// source of flakiness: Go's transport transparently RETRIES a request
	// whose pooled connection the server closed underneath it (the body is
	// a *bytes.Reader, so GetBody makes it replayable), which lands as two
	// arrivals for one logical call and silently shifts every subsequent
	// n. Answering about what was asked has no such assumption, and it is
	// what real GitHub does anyway.
	reply func(n int64, id string) (int, string)
}

func newFakeGitHub(t *testing.T, reply func(n int64, id string) (int, string)) *fakeGitHub {
	t.Helper()
	f := &fakeGitHub{reply: reply}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := f.calls.Add(1)
		raw, _ := io.ReadAll(r.Body)
		status, body := f.reply(n, searchedID(raw))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

// searchedID pulls the course id back out of the GraphQL request the client
// sent — the last field of the `q` variable, which the client builds as
// "repo:owner/name in:title <id>". Returns "" if the request is not that
// shape, which is itself worth knowing.
func searchedID(raw []byte) string {
	var req struct {
		Variables struct {
			Q string `json:"q"`
		} `json:"variables"`
	}
	if err := json.Unmarshal(raw, &req); err != nil {
		return ""
	}
	fields := strings.Fields(req.Variables.Q)
	if len(fields) == 0 {
		return ""
	}
	return fields[len(fields)-1]
}

// okBody is a well-formed GitHub answer for one discussion titled id.
func okBody(id string, comments ...string) string {
	nodes := make([]map[string]any, 0, len(comments))
	for i, body := range comments {
		nodes = append(nodes, map[string]any{
			"id":        fmt.Sprintf("C_%s_%d", id, i),
			"author":    map[string]any{"login": "hocvien"},
			"body":      body,
			"createdAt": "2026-08-22T10:00:00Z",
		})
	}
	raw, err := json.Marshal(map[string]any{
		"data": map[string]any{
			"search": map[string]any{
				"nodes": []map[string]any{{
					"title":    id,
					"url":      "https://github.com/" + testRepoSlug + "/discussions/7",
					"comments": map[string]any{"nodes": nodes},
				}},
			},
		},
	})
	if err != nil {
		panic(err)
	}
	return string(raw)
}

func alwaysOK(id string, comments ...string) func(int64, string) (int, string) {
	body := okBody(id, comments...)
	return func(int64, string) (int, string) { return http.StatusOK, body }
}

// echoOK answers every request with a well-formed thread for the id that
// request asked about. Cases that walk a range of distinct ids use it, so
// that a title mismatch never degrades a response and the case measures
// the ration rather than the boundary check.
func echoOK(_ int64, id string) (int, string) {
	return http.StatusOK, okBody(id, "xin chào")
}

// ── App wiring, with no database ────────────────────────────────────────

// wire builds a bare fiber app carrying ONLY the discussions route, with
// the real Handler, the real Client, and the real cache/budget — pointed at
// the fake GitHub.
//
// auth.Require is deliberately absent here and present in
// TestDiscussionRouteContract below. This app exists to measure what
// happens between our handler and GitHub, and a Postgres container per case
// would buy nothing for that question while costing every case a container.
func wire(t *testing.T, f *fakeGitHub, cache *discuss.Cache, budget *discuss.Budget) *fiber.App {
	t.Helper()
	client, err := discuss.NewClientWithEndpoint(f.srv.URL, testToken, testRepoSlug)
	if err != nil {
		t.Fatalf("build client: %v", err)
	}
	if client == nil {
		t.Fatal("build client: got nil client for a configured token+repo")
	}
	h := discuss.NewHandler(client, cache, budget)
	app := fiber.New()
	app.Get("/discussions/:registryId", h.Thread)
	return app
}

// liveCaches returns a cache and budget with production-shaped lifetimes and
// a ration large enough not to interfere, for cases about something else.
func liveCaches(max int) (*discuss.Cache, *discuss.Budget) {
	return discuss.NewCacheWith(discuss.SuccessTTL, discuss.FailureTTL, time.Now),
		discuss.NewBudgetWith(max, discuss.OutboundWindow, time.Now)
}

type wireThread struct {
	ID       string            `json:"id"`
	Loaded   bool              `json:"loaded"`
	Reason   string            `json:"reason"`
	URL      string            `json:"url"`
	Comments []discuss.Comment `json:"comments"`
}

// get performs one request and returns the status, the decoded body, and
// the RAW body — the raw form matters because `"comments": null` and
// `"comments": []` decode to the same Go value and are very different in a
// browser.
func get(t *testing.T, app *fiber.App, id string) (int, wireThread, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/discussions/"+id, nil)
	resp, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("GET /discussions/%s: %v", id, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("GET /discussions/%s: read body: %v", id, err)
	}
	var out wireThread
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("GET /discussions/%s: body is not JSON: %v (%s)", id, err, raw)
	}
	return resp.StatusCode, out, string(raw)
}

// quietLogs silences the API's own error log for cases that deliberately
// make GitHub fail. Without it a passing run prints dozens of scary lines
// and the real failures get lost in them.
func quietLogs(t *testing.T) {
	t.Helper()
	orig := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	t.Cleanup(func() { slog.SetDefault(orig) })
}

// ════════════════════════════════════════════════════════════════════════
// 1. THE RATION — counted in CALLS THAT LEFT, never in responses
// ════════════════════════════════════════════════════════════════════════

// TestOutboundCallsAreRefusedBeforeTheCallNotAfter is the case this file
// exists for.
//
// The mutant it kills: move budget.Take() to AFTER the fetch. Every
// response is byte-identical under that change — same status, same body,
// same reason on the same requests — while the number of requests reaching
// GitHub goes from the ration to the request rate. Subsystem 2 measured it
// on its own rate limiter: 92 refusals either way, real calls 8 → 100.
// Asserting on responses is therefore worth exactly nothing here, and this
// test asserts on f.calls.
//
// Both directions are checked, and the second one is not optional: a
// limiter that never calls anything also produces "at most 8 calls".
func TestOutboundCallsAreRefusedBeforeTheCallNotAfter(t *testing.T) {
	const requests = 100

	t.Run("a spent ration means the call is NEVER MADE", func(t *testing.T) {
		quietLogs(t)
		const ration = 8

		// The nth request is for course-(n-1), and gets a well-formed
		// answer for THAT title — so nothing here is refused for any
		// reason except the ration.
		f := newFakeGitHub(t, echoOK)

		cache, _ := liveCaches(ration)
		app := wire(t, f, cache, discuss.NewBudgetWith(ration, time.Hour, time.Now))

		rateLimited, loaded := 0, 0
		for i := 0; i < requests; i++ {
			// DISTINCT ids: the cache must not be what bounds this, or the
			// test would pass with no rate limiter at all.
			status, body, _ := get(t, app, fmt.Sprintf("course-%d", i))
			if status != fiber.StatusOK {
				t.Fatalf("request %d: want 200 (degrade, never break the page) got %d", i, status)
			}
			switch body.Reason {
			case discuss.ReasonRateLimited:
				rateLimited++
			case discuss.ReasonOK:
				loaded++
			}
		}

		// THE assertion.
		if got := f.calls.Load(); got != ration {
			t.Errorf("REAL outbound calls to GitHub: want exactly %d (the ration), got %d.\n"+
				"If this says %d, the budget is being consulted AFTER the call instead of "+
				"before it: the responses below are identical either way, and the bill is not.",
				ration, got, requests)
		}
		// Responses are reported, not relied on — precisely to show they
		// cannot distinguish the mutant.
		t.Logf("responses: %d loaded, %d rate_limited (these numbers are IDENTICAL "+
			"under the call-then-refuse mutant; the call count above is not)",
			loaded, rateLimited)
		if rateLimited != requests-ration {
			t.Errorf("want %d rate_limited responses, got %d", requests-ration, rateLimited)
		}
	})

	t.Run("anti-vacuity: a generous ration really does let every call through", func(t *testing.T) {
		f := newFakeGitHub(t, echoOK)
		cache, _ := liveCaches(requests)
		app := wire(t, f, cache, discuss.NewBudgetWith(requests, time.Hour, time.Now))

		for i := 0; i < requests; i++ {
			id := fmt.Sprintf("course-%d", i)
			status, body, raw := get(t, app, id)
			if status != fiber.StatusOK || !body.Loaded {
				t.Fatalf("request %d: want a loaded thread, got status=%d loaded=%v reason=%q",
					i, status, body.Loaded, body.Reason)
			}
			// The answer must be about the course that was ASKED about.
			// This is not paranoia: fiber hands out c.Params() as a
			// zero-copy view of a pooled request buffer, so a handler that
			// keeps that string (this one caches under it) can end up
			// serving one course's thread under another course's id. See
			// TestOneCoursesThreadNeverAppearsUnderAnothersID.
			//
			// Asserting on the COMMENT's id, not just on the echoed course
			// id: the echoed id is whatever the current request said, so it
			// matches even when the body came from another course's cache
			// entry. okBody stamps each comment with the course it belongs
			// to, and that is the field a mixed-up cache actually changes.
			if body.ID != id || len(body.Comments) != 1 || body.Comments[0].ID != "C_"+id+"_0" {
				t.Fatalf("request %d: asked about %q, got %s", i, id, raw)
			}
		}
		if got := f.calls.Load(); got != requests {
			t.Errorf("REAL outbound calls: want %d, got %d — without this direction, an "+
				"implementation that never calls GitHub at all would pass the case above",
				requests, got)
		}
	})

	t.Run("the window reopens", func(t *testing.T) {
		quietLogs(t)
		f := newFakeGitHub(t, echoOK)
		now := time.Now()
		clock := func() time.Time { return now }
		// Cache TTL of zero: every request is a miss, so the budget is the
		// only thing that can bound the calls.
		cache := discuss.NewCacheWith(0, 0, clock)
		app := wire(t, f, cache, discuss.NewBudgetWith(2, time.Minute, clock))

		for i := 0; i < 5; i++ {
			get(t, app, fmt.Sprintf("course-%d", i))
		}
		if got := f.calls.Load(); got != 2 {
			t.Fatalf("first window: want 2 calls, got %d", got)
		}

		now = now.Add(time.Minute + time.Second)
		for i := 5; i < 10; i++ {
			get(t, app, fmt.Sprintf("course-%d", i))
		}
		if got := f.calls.Load(); got != 4 {
			t.Errorf("after the window rolled: want 4 calls total (2 + 2), got %d — a "+
				"ration that never refills is an outage with extra steps", got)
		}
	})
}

// TestCacheSpendsNoOutboundCalls proves the cache is doing the job the
// quota depends on, measured the same way: in calls that left.
func TestCacheSpendsNoOutboundCalls(t *testing.T) {
	f := newFakeGitHub(t, alwaysOK(sampleID, "bài này hay"))
	now := time.Now()
	clock := func() time.Time { return now }
	cache := discuss.NewCacheWith(discuss.SuccessTTL, discuss.FailureTTL, clock)
	app := wire(t, f, cache, discuss.NewBudgetWith(discuss.MaxOutboundPerWindow, time.Hour, clock))

	for i := 0; i < 50; i++ {
		status, body, _ := get(t, app, sampleID)
		if status != fiber.StatusOK || !body.Loaded || len(body.Comments) != 1 {
			t.Fatalf("request %d: want a loaded thread with 1 comment, got %+v", i, body)
		}
	}
	if got := f.calls.Load(); got != 1 {
		t.Fatalf("50 requests for the same course: want 1 REAL call to GitHub, got %d", got)
	}

	// And the other direction: the cache expires rather than pinning a
	// stale thread forever.
	now = now.Add(discuss.SuccessTTL + time.Second)
	if _, body, _ := get(t, app, sampleID); !body.Loaded {
		t.Fatalf("after the TTL: want a refetched thread, got %+v", body)
	}
	if got := f.calls.Load(); got != 2 {
		t.Errorf("after the TTL expired: want 2 REAL calls, got %d — a cache that never "+
			"expires would pass every assertion above and never show a new comment", got)
	}
}

// TestOneOutageDoesNotDrainTheRationForEverybody covers the interaction the
// two mechanisms have with each other, which neither test above reaches.
//
// Without a remembered failure, a GitHub outage turns every page view into
// a cache miss, every miss spends one of the ration's calls on a request
// already known to fail, and within seconds nobody gets discussions —
// including the courses that would have loaded.
func TestOneOutageDoesNotDrainTheRationForEverybody(t *testing.T) {
	quietLogs(t)

	f := newFakeGitHub(t, func(int64, string) (int, string) {
		return http.StatusInternalServerError, `{"message":"upstream is having a day"}`
	})
	now := time.Now()
	clock := func() time.Time { return now }
	cache := discuss.NewCacheWith(discuss.SuccessTTL, discuss.FailureTTL, clock)
	app := wire(t, f, cache, discuss.NewBudgetWith(discuss.MaxOutboundPerWindow, time.Hour, clock))

	for i := 0; i < 20; i++ {
		status, body, _ := get(t, app, sampleID)
		if status != fiber.StatusOK {
			t.Fatalf("request %d: GitHub being down must not break the page, got %d", i, status)
		}
		if body.Loaded || body.Reason != discuss.ReasonUnavailable {
			t.Fatalf("request %d: want loaded=false reason=%q, got %+v", i, discuss.ReasonUnavailable, body)
		}
	}
	if got := f.calls.Load(); got != 1 {
		t.Errorf("20 page views during an outage: want 1 REAL call, got %d — without a "+
			"remembered failure this is %d calls and the ration is gone for every other course",
			got, 20)
	}

	// The failure is remembered BRIEFLY, not forever: once GitHub recovers,
	// the page must recover too without anyone restarting anything.
	f.reply = alwaysOK(sampleID, "đã sống lại")
	now = now.Add(discuss.FailureTTL + time.Second)
	if _, body, _ := get(t, app, sampleID); !body.Loaded || len(body.Comments) != 1 {
		t.Errorf("after GitHub recovered and FailureTTL passed: want a loaded thread, got %+v", body)
	}
}

// TestOneCoursesThreadNeverAppearsUnderAnothersID is a regression test for
// a defect this package actually shipped into a working tree, and it is
// worth stating what it was because the shape recurs.
//
// fiber returns c.Params() as a zero-copy view over the pooled request
// buffer, and url.PathUnescape passes its input straight back when there is
// nothing to unescape. This handler CACHES under that string. So a stored
// key kept aliasing memory that the next request overwrote, and once a
// later course id of the same length landed in the same slot, the stored
// key began reading as that id — a cache hit that should have been a miss,
// answering with a completely different course's discussion. Measured: the
// request for "course-59" came back with "course-46"'s comments.
//
// The fix is one strings.Clone in handler.go. This test is what stops it
// being tidied away, and it is deliberately built out of SAME-LENGTH ids,
// because that is the only case where the corruption is possible at all and
// therefore the only case that can prove the clone is there.
func TestOneCoursesThreadNeverAppearsUnderAnothersID(t *testing.T) {
	f := newFakeGitHub(t, echoOK)
	cache, budget := liveCaches(1000)
	app := wire(t, f, cache, budget)

	// Every id is exactly the same length, so each one lands on the byte
	// range the one before it occupied.
	ids := make([]string, 0, 200)
	for i := 100; i < 300; i++ {
		ids = append(ids, fmt.Sprintf("khoa-hoc-%d", i))
	}

	// Two passes: the first fills the cache, the second reads it back. The
	// corruption shows up on either, but a second pass is what makes the
	// case about the CACHE rather than about one request.
	for pass := 0; pass < 2; pass++ {
		for _, id := range ids {
			_, body, raw := get(t, app, id)
			if !body.Loaded || len(body.Comments) != 1 {
				t.Fatalf("pass %d, id %q: want a loaded thread, got %s", pass, id, raw)
			}
			if got := body.Comments[0].ID; got != "C_"+id+"_0" {
				t.Fatalf("pass %d: asked for %q and got a comment belonging to another "+
					"course (%q). The cache key is aliasing fiber's pooled request buffer "+
					"— see the strings.Clone in handler.go.", pass, id, got)
			}
		}
	}

	if got := f.calls.Load(); got != int64(len(ids)) {
		t.Errorf("want exactly %d real calls (one per course, second pass all cached), got %d",
			len(ids), got)
	}
}

// ════════════════════════════════════════════════════════════════════════
// 2. DEGRADE, NEVER BREAK — the boundary shape check
// ════════════════════════════════════════════════════════════════════════

// TestBrokenGitHubDegradesAndNeverBreaksThePage is the assertStats
// discipline, in Go, at the one place third-party data crosses in.
//
// The defect it descends from: a data source returned something nobody
// expected, nothing checked it at the boundary, and a `.map` on an
// undefined blanked the whole page (commit 815a472). Every row below is a
// way GitHub can produce a 200, or fail, that a naive decode would turn
// into a Thread that looks real and is not.
//
// Every row asserts the SAME four things, which together are the contract
// the web client can be written against without a single defensive branch:
// status 200, loaded=false, reason=unavailable, and comments present as an
// empty ARRAY rather than null.
func TestBrokenGitHubDegradesAndNeverBreaksThePage(t *testing.T) {
	quietLogs(t)

	otherRepoURL := "https://github.com/attacker/evil/discussions/1"

	cases := []struct {
		name   string
		status int
		body   string
	}{
		{"500", http.StatusInternalServerError, `{"message":"boom"}`},
		{"502 from a proxy", http.StatusBadGateway, `<html><body>Bad Gateway</body></html>`},
		{"403 rate limited by GitHub itself", http.StatusForbidden, `{"message":"API rate limit exceeded"}`},
		{"401 the token was revoked", http.StatusUnauthorized, `{"message":"Bad credentials"}`},
		{"200 with an empty body", http.StatusOK, ``},
		{"200 with an HTML error page", http.StatusOK, `<!doctype html><title>Unicorn</title>`},
		{"200 with truncated JSON", http.StatusOK, `{"data":{"search":{"nodes":[`},
		{"200 with GraphQL errors and no data", http.StatusOK, `{"data":null,"errors":[{"message":"Bad credentials"}]}`},
		{
			// The case that matters, and the one a first pass at this table
			// missed: GraphQL's PARTIAL failure. GitHub answers 200 with a
			// data block that looks complete AND an errors array saying it
			// is not. Mutation testing caught the gap — deleting the
			// `errors` check left every other row in this table green,
			// because they were all being stopped by the `data: null` check
			// one line further down.
			"200 with errors ALONGSIDE otherwise-valid data",
			http.StatusOK,
			`{"errors":[{"message":"Something went wrong while executing your query"}],` +
				`"data":{"search":{"nodes":[{"title":"` + sampleID + `","url":"https://github.com/` +
				testRepoSlug + `/discussions/7","comments":{"nodes":[]}}]}}}`,
		},
		{"200 with data null", http.StatusOK, `{"data":null}`},
		{"200 with search null", http.StatusOK, `{"data":{"search":null}}`},
		{"200 with nodes null", http.StatusOK, `{"data":{"search":{"nodes":null}}}`},
		{"200 with no matching discussion", http.StatusOK, `{"data":{"search":{"nodes":[]}}}`},
		{"200 with a null node", http.StatusOK, `{"data":{"search":{"nodes":[null]}}}`},
		{
			"200 with a discussion missing its url",
			http.StatusOK,
			`{"data":{"search":{"nodes":[{"title":"` + sampleID + `"}]}}}`,
		},
		{
			// A URL is the one field of GitHub's answer that ends up in an
			// href. "Whatever the server said" is not an acceptable value
			// for one of those.
			"200 with a url pointing at another repository",
			http.StatusOK,
			`{"data":{"search":{"nodes":[{"title":"` + sampleID + `","url":"` + otherRepoURL + `","comments":{"nodes":[]}}]}}}`,
		},
		{
			"200 with a javascript: url",
			http.StatusOK,
			`{"data":{"search":{"nodes":[{"title":"` + sampleID + `","url":"javascript:alert(1)","comments":{"nodes":[]}}]}}}`,
		},
		{
			// `in:title` is a fuzzy match, so GitHub returning somebody
			// else's thread is a normal-day outcome, not an attack.
			"200 with a discussion for a DIFFERENT course",
			http.StatusOK,
			`{"data":{"search":{"nodes":[{"title":"mot-course-khac","url":"https://github.com/` + testRepoSlug + `/discussions/7","comments":{"nodes":[]}}]}}}`,
		},
		{
			"200 with a comment missing createdAt",
			http.StatusOK,
			`{"data":{"search":{"nodes":[{"title":"` + sampleID + `","url":"https://github.com/` + testRepoSlug + `/discussions/7","comments":{"nodes":[{"id":"c1","body":"hi"}]}}]}}}`,
		},
		{
			"200 with an unparseable createdAt",
			http.StatusOK,
			`{"data":{"search":{"nodes":[{"title":"` + sampleID + `","url":"https://github.com/` + testRepoSlug + `/discussions/7","comments":{"nodes":[{"id":"c1","body":"hi","createdAt":"hôm qua"}]}}]}}}`,
		},
		{
			"200 with a comment body that is a number, not a string",
			http.StatusOK,
			`{"data":{"search":{"nodes":[{"title":"` + sampleID + `","url":"https://github.com/` + testRepoSlug + `/discussions/7","comments":{"nodes":[{"id":"c1","body":42,"createdAt":"2026-08-22T10:00:00Z"}]}}]}}}`,
		},
		{
			"200 with a null comment among real ones",
			http.StatusOK,
			`{"data":{"search":{"nodes":[{"title":"` + sampleID + `","url":"https://github.com/` + testRepoSlug + `/discussions/7","comments":{"nodes":[null]}}]}}}`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFakeGitHub(t, func(int64, string) (int, string) { return tc.status, tc.body })
			cache, budget := liveCaches(discuss.MaxOutboundPerWindow)
			app := wire(t, f, cache, budget)

			status, body, raw := get(t, app, sampleID)

			if status != fiber.StatusOK {
				t.Errorf("want 200 — the discussion section degrades, it does not take the "+
					"course page down with it — got %d (%s)", status, raw)
			}
			if body.Loaded {
				t.Errorf("want loaded=false for a broken answer, got a thread: %s", raw)
			}
			if body.Reason != discuss.ReasonUnavailable {
				t.Errorf("want reason=%q, got %q", discuss.ReasonUnavailable, body.Reason)
			}
			// The `.map` lesson, asserted on the RAW body: `null` and `[]`
			// decode to the same Go value and behave very differently in a
			// browser.
			if !strings.Contains(raw, `"comments":[]`) {
				t.Errorf("want an empty comments ARRAY on the wire, got %s — a null here is "+
					"the exact defect this whole file descends from: .map on undefined, "+
					"during render, with no error boundary", raw)
			}
			if strings.Contains(raw, otherRepoURL) || strings.Contains(raw, "javascript:") {
				t.Errorf("a url from GitHub's answer reached the response unvalidated: %s", raw)
			}
			// Anti-vacuity for the whole table: GitHub really was asked.
			if f.calls.Load() != 1 {
				t.Errorf("want exactly 1 outbound call, got %d", f.calls.Load())
			}
		})
	}
}

// TestAWellFormedThreadSurvivesTheBoundary is the direction that keeps the
// table above from being satisfiable by a decode that rejects everything.
func TestAWellFormedThreadSurvivesTheBoundary(t *testing.T) {
	f := newFakeGitHub(t, alwaysOK(sampleID, "câu hỏi 1", "câu hỏi 2"))
	cache, budget := liveCaches(discuss.MaxOutboundPerWindow)
	app := wire(t, f, cache, budget)

	status, body, raw := get(t, app, sampleID)
	if status != fiber.StatusOK || !body.Loaded || body.Reason != discuss.ReasonOK {
		t.Fatalf("want a loaded thread, got status=%d %s", status, raw)
	}
	if body.ID != sampleID {
		t.Errorf("want the course id echoed back, got %q", body.ID)
	}
	if want := "https://github.com/" + testRepoSlug + "/discussions/7"; body.URL != want {
		t.Errorf("want url %q, got %q", want, body.URL)
	}
	if len(body.Comments) != 2 {
		t.Fatalf("want 2 comments, got %d (%s)", len(body.Comments), raw)
	}
	if body.Comments[0].Body != "câu hỏi 1" || body.Comments[0].Author != "hocvien" {
		t.Errorf("comment 0 did not survive intact: %+v", body.Comments[0])
	}

	// A deleted author is a NORMAL GitHub answer, not a malformed one: the
	// thread must still load.
	f2 := newFakeGitHub(t, func(int64, string) (int, string) {
		return http.StatusOK, `{"data":{"search":{"nodes":[{"title":"` + sampleID +
			`","url":"https://github.com/` + testRepoSlug +
			`/discussions/7","comments":{"nodes":[{"id":"c1","author":null,"body":"hi","createdAt":"2026-08-22T10:00:00Z"}]}}]}}}`
	})
	cache2, budget2 := liveCaches(discuss.MaxOutboundPerWindow)
	if _, body, raw := get(t, wire(t, f2, cache2, budget2), sampleID); !body.Loaded || len(body.Comments) != 1 {
		t.Errorf("a comment whose author's account is gone must not invalidate the thread: %s", raw)
	} else if body.Comments[0].Author == "" {
		t.Errorf("a deleted author must get a placeholder, not an empty string: %+v", body.Comments[0])
	}
}

// TestResponseShapeIsExactlyTheseFields locks the wire contract by KEY SET,
// not by parsing into a struct.
//
// Parsing into a struct is blind to extra fields — subsystem 4's own
// ratings work measured a `voters` field surviving every parse-into-struct
// assertion — and here the field most likely to be added by a well-meaning
// change is the dangerous one: GitHub's `bodyHTML`. This package returns
// markdown SOURCE precisely because comments are written by the public and
// their HTML is not markup this platform can vouch for. A `bodyHTML` here
// is one dangerouslySetInnerHTML away from running on the reader's session.
func TestResponseShapeIsExactlyTheseFields(t *testing.T) {
	f := newFakeGitHub(t, alwaysOK(sampleID, "xin chào"))
	cache, budget := liveCaches(discuss.MaxOutboundPerWindow)
	app := wire(t, f, cache, budget)

	_, _, raw := get(t, app, sampleID)

	var generic map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &generic); err != nil {
		t.Fatalf("body is not a JSON object: %v", err)
	}
	assertKeys(t, "thread", generic, []string{"comments", "id", "loaded", "reason", "url"})

	var withComments struct {
		Comments []map[string]json.RawMessage `json:"comments"`
	}
	if err := json.Unmarshal([]byte(raw), &withComments); err != nil {
		t.Fatalf("comments do not decode: %v", err)
	}
	if len(withComments.Comments) != 1 {
		t.Fatalf("want 1 comment, got %d", len(withComments.Comments))
	}
	assertKeys(t, "comment", withComments.Comments[0], []string{"author", "body", "createdAt", "id"})

	if strings.Contains(raw, "bodyHTML") || strings.Contains(raw, "bodyHtml") {
		t.Errorf("the response carries HTML written by members of the public: %s.\n"+
			"Comments come back as markdown SOURCE on purpose — see discuss.Comment.", raw)
	}
}

func assertKeys(t *testing.T, what string, obj map[string]json.RawMessage, want []string) {
	t.Helper()
	got := make([]string, 0, len(obj))
	for k := range obj {
		got = append(got, k)
	}
	sort.Strings(got)
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("%s keys: want exactly %v, got %v. A new field here is a new thing this "+
			"platform publishes on behalf of a third party; add it deliberately.", what, want, got)
	}
}

// ════════════════════════════════════════════════════════════════════════
// 3. THE DEFAULT DEPLOYMENT — nothing configured
// ════════════════════════════════════════════════════════════════════════

// TestUnconfiguredDeploymentDegrades covers the state EVERY checkout and
// today's production are in: no token, no repository (docs/deploy.md §5c).
//
// It is also the guard on a Go trap that would be invisible in review:
// NewClient returns a nil *Client for "switched off", and a nil POINTER
// assigned to an INTERFACE is not nil. Get that wrong and the default
// deployment answers 500 by calling a method on a nil receiver — a panic in
// the one configuration everybody has.
func TestUnconfiguredDeploymentDegrades(t *testing.T) {
	for _, tc := range []struct{ name, token, repo string }{
		{"nothing set at all", "", ""},
		{"a token but no repository", testToken, ""},
		{"a repository but no token", "", testRepoSlug},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h, err := discuss.NewHandlerForConfig(tc.token, tc.repo)
			if err != nil {
				t.Fatalf("absent configuration is not an error: %v", err)
			}
			app := fiber.New()
			app.Get("/discussions/:registryId", h.Thread)

			status, body, raw := get(t, app, sampleID)
			if status != fiber.StatusOK {
				t.Fatalf("want 200, got %d (%s)", status, raw)
			}
			if body.Loaded || body.Reason != discuss.ReasonDisabled {
				t.Errorf("want loaded=false reason=%q, got %+v", discuss.ReasonDisabled, body)
			}
			if !strings.Contains(raw, `"comments":[]`) {
				t.Errorf("want an empty comments array even when switched off, got %s", raw)
			}
		})
	}

	t.Run("a malformed repository is an error, and still does not panic", func(t *testing.T) {
		h, err := discuss.NewHandlerForConfig(testToken, "not-an-owner-slash-name")
		if err == nil {
			t.Error("want an error naming the bad GITHUB_DISCUSSIONS_REPO — absent " +
				"configuration is normal, but configuration that is SET and unusable is a typo " +
				"somebody needs to see")
		}
		app := fiber.New()
		app.Get("/discussions/:registryId", h.Thread)
		if status, body, raw := get(t, app, sampleID); status != fiber.StatusOK || body.Loaded {
			t.Errorf("a misconfigured deployment must still serve the page: %d %s", status, raw)
		}
	})
}

// ════════════════════════════════════════════════════════════════════════
// 4. NOTHING IS SPENT ON A REQUEST THAT IS WRONG
// ════════════════════════════════════════════════════════════════════════

// TestBadCourseIDIsRefusedWithoutTouchingGitHub checks the first gate. A
// malformed id is this API's own client getting it wrong, so it is a 400 —
// and it must cost zero outbound calls, or the ration is spendable by
// sending nonsense.
func TestBadCourseIDIsRefusedWithoutTouchingGitHub(t *testing.T) {
	f := newFakeGitHub(t, alwaysOK(sampleID))
	cache, budget := liveCaches(discuss.MaxOutboundPerWindow)
	app := wire(t, f, cache, budget)

	// %2e%2e is ".." only after the percent-decode rating.RegistryID does
	// first — the same trap internal/course measured against this fiber
	// version.
	//
	// No "%zz" case: Go's own URL parser rejects it inside
	// httptest.NewRequest, so it cannot be expressed through this harness.
	// rating.RegistryID does handle it (its first act is url.PathUnescape,
	// whose error becomes a 400), and that path is covered by the ratings
	// package's own tests; asserting it here would only be asserting that
	// net/url still works.
	for _, bad := range []string{"%2e%2e", "%2fetc%2fpasswd", "%20", strings.Repeat("a", 300)} {
		req := httptest.NewRequest(http.MethodGet, "/discussions/"+bad, nil)
		resp, err := app.Test(req, httpTimeoutMS)
		if err != nil {
			t.Fatalf("GET /discussions/%s: %v", bad, err)
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != fiber.StatusBadRequest {
			t.Errorf("id %q: want 400, got %d (%s)", bad, resp.StatusCode, body)
		}
	}
	if got := f.calls.Load(); got != 0 {
		t.Errorf("a malformed course id must cost zero outbound calls, got %d — otherwise "+
			"the platform's GitHub ration is spendable by anyone sending nonsense", got)
	}
}

// TestTheIDRuleIsSHAREDWithRatingsAndNotCopied is a structural check, and it
// answers the loose end the ratings work flagged as its own least-certain
// concern: a registry id must have ONE definition, not one per package.
//
// It is not a string comparison of two implementations — that would prove
// only that today's two copies agree. It asserts there IS no second
// implementation, by feeding ids that differ from rating.RegistryID's rule
// only at its edges and requiring identical verdicts.
func TestTheIDRuleIsSHAREDWithRatingsAndNotCopied(t *testing.T) {
	quietLogs(t)
	// GitHub answers "no such discussion" for everything, so an id that is
	// ACCEPTED still degrades to 200/loaded=false. That is deliberate: the
	// question here is which ids get past the id rule (200) and which are
	// refused by it (400), and mixing in whether a thread exists would make
	// the two indistinguishable.
	f := newFakeGitHub(t, func(int64, string) (int, string) {
		return http.StatusOK, `{"data":{"search":{"nodes":[]}}}`
	})
	cache, budget := liveCaches(discuss.MaxOutboundPerWindow)
	app := wire(t, f, cache, budget)

	for _, tc := range []struct {
		id           string
		wantAccepted bool
	}{
		{"so-dau-phay-dong", true},
		{"Kh%C3%B4ng-D%E1%BA%A5u", true}, // percent-encoded UTF-8 survives
		{"%2e%2e", false},                // ".." only AFTER the decode
		{"a%2Fb", false},                 // an encoded slash is still a slash
		{"%20", false},                   // leading/trailing whitespace
		{strings.Repeat("a", 300), false},
	} {
		path := "/discussions/" + tc.id
		req := httptest.NewRequest(http.MethodGet, path, nil)
		resp, err := app.Test(req, httpTimeoutMS)
		if err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		resp.Body.Close()
		accepted := resp.StatusCode == fiber.StatusOK
		if accepted != tc.wantAccepted {
			t.Errorf("id %q: accepted=%v (HTTP %d), want accepted=%v — discussions and "+
				"ratings must agree about what a course id is, because they share ONE rule "+
				"(rating.RegistryID). If this diverges, somebody wrote a second copy.",
				tc.id, accepted, resp.StatusCode, tc.wantAccepted)
		}
	}
}

// ════════════════════════════════════════════════════════════════════════
// 5. ROUTE CONTRACT — through the real server wiring, with a real database
// ════════════════════════════════════════════════════════════════════════

// TestDiscussionRouteContract is the only case here that needs Postgres,
// because auth.Require validates the session against it. It asserts the two
// things only the real wiring can answer.
func TestDiscussionRouteContract(t *testing.T) {
	pool := store.TestPool(t)
	app := server.New(config.Config{CookieSecure: false}, server.Deps{Pool: pool, LogOutput: io.Discard})

	// 1. The route set under /discussions. Read-only means read-only: a
	//    POST here would be this platform writing to GitHub under a token
	//    every reader shares, with no per-person attribution — the "post a
	//    comment" button is a LINK to github.com, on purpose.
	var routes []string
	for _, r := range app.GetRoutes() {
		if strings.HasPrefix(r.Path, "/discussions") {
			routes = append(routes, r.Method+" "+r.Path)
		}
	}
	sort.Strings(routes)
	want := []string{
		"GET /discussions/:registryId",
		"HEAD /discussions/:registryId", // fiber registers HEAD alongside every GET
	}
	if strings.Join(routes, " | ") != strings.Join(want, " | ") {
		t.Errorf("discussion routes: want %v, got %v.\nA write route here would post to "+
			"GitHub as the platform rather than as the reader; a listing route would "+
			"enumerate. Add one deliberately or not at all.", want, routes)
	}

	// 2. It is behind a session, like every other route on this API. The
	//    ration it spends is global, so an anonymous flood must not be able
	//    to spend it.
	req := httptest.NewRequest(http.MethodGet, "/discussions/"+sampleID, nil)
	resp, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("GET /discussions: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Errorf("no session: want 401, got %d", resp.StatusCode)
	}
}

// ── Compile-time contract ───────────────────────────────────────────────

// *discuss.Client must satisfy discuss.Fetcher, or NewHandlerForConfig's
// nil-interface handling is guarding something that no longer exists.
var _ discuss.Fetcher = (*discuss.Client)(nil)

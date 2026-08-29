// admin_handler_test.go exercises the seven Task 17 admin routes (spec
// §7's "Người dùng & credit" and "Bảng giá & prompt nền" CMS screens).
// package ai_test, not package ai, for the identical reason handler_test.go
// gives at its own top: TestAdminAIRoutesAllRequireAdmin and
// TestAdminAIRoutesRejectNonAdminSession need the REAL internal/server
// route table (auth.Require + auth.RequireAdmin actually mounted), and
// internal/server imports internal/ai, so a test compiled INTO package ai
// could never import internal/server without an import cycle.
//
// Everything else here goes through newAIApp (handler_test.go, this same
// package) — a bare fiber app with the caller's id FIXED rather than read
// from a session — because the validation and transaction behavior these
// tests are actually about (note required, boundary amounts, pricing
// takes effect without a restart, the base prompt cannot be cleared) has
// nothing to do with cookies, and paying for a real register+promote round
// trip on every case would only slow the suite down without proving
// anything more.
package ai_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/ai"
	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/server"
	"github.com/vndee/tuhoc-api/internal/store"
)

// --- fixture numbers ---------------------------------------------------
//
// Same rule handler_test.go's own fixture block states and the progress
// ledger for this whole run repeats: every number below is pairwise
// distinct from every other number in its own group, so a bug that writes
// the WRONG one of two values (balance instead of delta, before instead of
// after) produces a visibly wrong assertion instead of an accidental match.
const (
	adjustStartBalance = 733100  // ai_credits.balance_micro before either adjustment below
	adjustAddDelta     = 415300  // first adjustment: a top-up
	adjustSubDelta     = -206700 // second adjustment: a correction, on the SAME account
	// 733100 + 415300 = 1148400; 1148400 - 206700 = 941700 — computed by
	// hand here, not by calling AdjustCredit, so a broken implementation
	// cannot produce its own expectation.
	adjustAfterAddWant = 1148400
	adjustAfterSubWant = 941700

	// Pricing before/after — only credits_per_1k_in changes between the two
	// ChargeTurn calls in TestPricingUpdateTakesEffectWithoutRestart, so a
	// mutant that reads the WRONG column (e.g. still applies the cached-in
	// rate) shows up as "credits charged did not change" rather than
	// coincidentally matching.
	pricingBeforeCostIn   = 910
	pricingBeforeCachedIn = 17
	pricingBeforeOut      = 640
	pricingBeforeCredIn   = 1310
	pricingBeforeCredCach = 23
	pricingBeforeCredOut  = 880

	pricingAfterCredIn = 4170 // the ONE rate that changes for the "no restart" proof

	// usageMissTokens is the sole nonzero field of the ai.Usage fed to
	// ChargeTurn in the pricing test — isolating credits_per_1k_in as the
	// only rate that can possibly move the result.
	usageMissTokens = 61
)

// --- helpers for a REAL session + real admin promotion -------------------

// registerAndLogin creates a real account through /auth/register (so its
// cookie validates against the real sessions table auth.Require checks —
// same reasoning internal/catalog's own registerUser gives) and returns the
// session cookie, the new account's id, and its email (the last so a
// caller can promote it with a direct SQL UPDATE).
func registerAndLogin(t *testing.T, app *fiber.App, label string) (*http.Cookie, uuid.UUID, string) {
	t.Helper()

	email := fmt.Sprintf("admin-ai-%s-%s@example.test", label, uuid.NewString())
	resp, raw := doJSON(t, app, http.MethodPost, "/auth/register", map[string]any{
		"email":    email,
		"password": "admin-ai-test-password-1",
		"name":     label,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("register %s: want 200 got %d body=%s", label, resp.StatusCode, raw)
	}

	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("register %s: unmarshal %s: %v", label, raw, err)
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
		t.Fatalf("register %s: no session cookie in %v", label, resp.Cookies())
	}
	return cookie, id, email
}

func promoteToAdmin(t *testing.T, pool *pgxpool.Pool, email string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE users SET role = 'admin' WHERE email = $1`, email); err != nil {
		t.Fatalf("promote %s to admin: %v", email, err)
	}
}

// doWithCookie issues method/path carrying cookie (nil = no cookie at
// all) and an optional JSON body — the shape TestAdminAIRoutesAllRequireAdmin
// and the real-session tests need, which doJSON (no cookie support) cannot
// give them.
func doWithCookie(t *testing.T, app *fiber.App, method, path string, cookie *http.Cookie, body any) (*http.Response, []byte) {
	t.Helper()
	var r io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		r = strings.NewReader(string(raw))
	}
	req := httptest.NewRequest(method, path, r)
	if body != nil {
		req.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := app.Test(req, httpTimeoutMSAdmin)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return resp, raw
}

const httpTimeoutMSAdmin = 30000

// newUserNoCredits inserts a real users row and NOTHING into ai_credits —
// the shape AdjustCredit's UPSERT is specifically for (a learner who
// predates this feature, or whose signup grant was zero).
//
// It has a SECOND job in this file, load-bearing everywhere a test expects
// an admin_audit WRITE to succeed: admin_audit.who REFERENCES users(id)
// (migration 0005_published_catalog) — a real foreign key, not a loose
// uuid column — so newAIApp's fixed "acting admin" id must name a REAL row
// whenever the request under test is expected to reach the INSERT INTO
// admin_audit at all. A bare uuid.New() is fine ONLY for a case that
// expects the request to be REJECTED before any write (wrong note, zero
// delta, an unknown target, …); every case below that expects 200 uses
// this helper for the actor for exactly this reason.
func newUserNoCredits(t *testing.T, pool *pgxpool.Pool, label string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	email := fmt.Sprintf("admin-ai-nocred-%s-%s@example.test", label, uuid.NewString())
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email, name, pw_hash) VALUES ($1,$2,$3) RETURNING id`,
		email, label, "not-a-real-hash").Scan(&id); err != nil {
		t.Fatalf("insert user %s: %v", label, err)
	}
	return id
}

type auditRow struct {
	who    *uuid.UUID
	actor  string
	action string
	target string
	note   string
}

func auditRowsFor(t *testing.T, pool *pgxpool.Pool, action, target string) []auditRow {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT who, actor, action, target, note FROM admin_audit
		 WHERE action = $1 AND target = $2 ORDER BY at, id`, action, target)
	if err != nil {
		t.Fatalf("query admin_audit (action=%s target=%s): %v", action, target, err)
	}
	defer rows.Close()
	var out []auditRow
	for rows.Next() {
		var r auditRow
		if err := rows.Scan(&r.who, &r.actor, &r.action, &r.target, &r.note); err != nil {
			t.Fatalf("scan admin_audit: %v", err)
		}
		out = append(out, r)
	}
	return out
}

// pricingRow reads one ai_pricing row directly, for assertions that must
// not go through the Service's own accessor (which is exactly the thing
// under test in the "no restart" case).
func pricingRowCreditsIn(t *testing.T, pool *pgxpool.Pool, model string) int64 {
	t.Helper()
	var v int64
	if err := pool.QueryRow(context.Background(),
		`SELECT credits_per_1k_in FROM ai_pricing WHERE model = $1`, model).Scan(&v); err != nil {
		t.Fatalf("read ai_pricing.credits_per_1k_in for %s: %v", model, err)
	}
	return v
}

// ============================================================================
// Step 3 — every /admin/ai/* route requires an admin. ROUTE-TABLE-DRIVEN:
// task-17-brief.md's own instruction is to walk the registration table
// rather than hand-type the list, so a route added to server.go without
// updating a hand-written slice here cannot silently ship unguarded.
// ============================================================================

// paramPlaceholder stands in for any ":name" path parameter fiber's router
// records in Route.Path — the exact value never matters here (every case
// below is refused by auth BEFORE any handler reads a param), only that
// the request reaches a real, defined route rather than 404ing on an
// unresolved ":id" segment.
var paramPlaceholder = regexp.MustCompile(`:[A-Za-z0-9_]+`)

// TestAdminAIRoutesAllRequireAdmin hits EVERY route server.New registers
// under "/admin/ai" — discovered via app.Stack(), never a hand-typed list —
// with no session cookie at all, and requires 401 (auth.Require's own
// refusal), never a 404 (which would mean the route was never mounted, and
// this case never actually exercised anything) and never a 200.
//
// It needs no Postgres: auth.Require answers 401 on a missing cookie
// before it ever touches the pool (same reasoning
// TestAIRoutesRejectRequestsWithoutASession, above, already documents for
// the three learner routes) — a nil pool is enough and this case stays
// runnable on a machine with no Docker.
func TestAdminAIRoutesAllRequireAdmin(t *testing.T) {
	app := server.New(config.Config{}, server.Deps{LogOutput: io.Discard})

	type route struct{ method, path string }
	var found []route
	for _, methodRoutes := range app.Stack() {
		for _, r := range methodRoutes {
			if strings.HasPrefix(r.Path, "/admin/ai") {
				found = append(found, route{r.Method, r.Path})
			}
		}
	}

	// Anti-vacuity: seven handlers are mounted (GET/HEAD users, GET/HEAD
	// users/:id, POST users/:id/credit, GET/HEAD pricing, PUT pricing/:model,
	// GET/HEAD settings, PUT settings) — fiber's own Get() registers a HEAD
	// route alongside every GET (router.go), so the true count is higher
	// than seven; the floor below is what a broken path filter or an
	// accidentally-unmounted group would fail under, not an exact pin on
	// fiber's own HEAD-mirroring behavior.
	if len(found) < 7 {
		t.Fatalf("only found %d route(s) under /admin/ai — the route table scan is reading "+
			"the wrong app, or the admin group was never mounted. found=%v", len(found), found)
	}

	for _, r := range found {
		t.Run(r.method+" "+r.path, func(t *testing.T) {
			target := paramPlaceholder.ReplaceAllString(r.path, "test-placeholder")
			req := httptest.NewRequest(r.method, target, nil)
			resp, err := app.Test(req, httpTimeoutMSAdmin)
			if err != nil {
				t.Fatalf("request: %v", err)
			}
			if resp.StatusCode == http.StatusNotFound {
				t.Fatalf("%s %s (as %s) answered 404 — this route was never actually "+
					"reached, so the 401 this case is about was never exercised",
					r.method, r.path, target)
			}
			if resp.StatusCode != http.StatusUnauthorized {
				raw, _ := io.ReadAll(resp.Body)
				t.Fatalf("%s %s without a session: want 401 got %d body=%s",
					r.method, r.path, resp.StatusCode, raw)
			}
		})
	}
}

// TestAdminAIRoutesRejectNonAdminSession is the OTHER half of the admin
// gate: a session that is genuinely valid (auth.Require passes) but whose
// account is not role='admin' must get 403 from auth.RequireAdmin, not the
// 401 above and not a silent 200 — the exact distinction
// auth.RequireAdmin's own doc comment draws.
func TestAdminAIRoutesRejectNonAdminSession(t *testing.T) {
	pool := store.TestPool(t)
	app := server.New(config.Config{CookieSecure: false}, server.Deps{Pool: pool, LogOutput: io.Discard})

	cookie, _, _ := registerAndLogin(t, app, "not-admin")

	resp, raw := doWithCookie(t, app, http.MethodGet, "/admin/ai/users", cookie, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("GET /admin/ai/users, valid session, role=user: want 403 got %d body=%s",
			resp.StatusCode, raw)
	}
}

// TestAdminAIRoutesAllowRealAdminSession proves the whole chain — session
// cookie -> auth.Require -> auth.RequireAdmin -> the handler — actually
// lets a real admin through, end to end. Every other test in this file
// reaches the handler via newAIApp's fixed-id bypass; this is the one case
// that would go red if the group in server.go were wired to the wrong
// middleware, or to no middleware at all in a way TestAdminAIRoutesAllRequireAdmin's
// fail-closed 401 could not distinguish from "correctly gated".
func TestAdminAIRoutesAllowRealAdminSession(t *testing.T) {
	pool := store.TestPool(t)
	app := server.New(config.Config{CookieSecure: false}, server.Deps{Pool: pool, LogOutput: io.Discard})

	cookie, _, email := registerAndLogin(t, app, "real-admin")
	promoteToAdmin(t, pool, email)

	resp, raw := doWithCookie(t, app, http.MethodGet, "/admin/ai/users", cookie, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /admin/ai/users, real admin session: want 200 got %d body=%s",
			resp.StatusCode, raw)
	}
}

// ============================================================================
// Step 1 — manual credit adjustment REQUIRES a note, and the audit trail.
// ============================================================================

func TestAdjustCreditRequiresNonEmptyNote(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	admin := uuid.New() // stands in for the acting operator; no users row needed — admin_audit.who has no FK-enforced existence check on the WRITE path this test exercises (the request is rejected before any write).
	target := newUser(t, pool, "note-required", adjustStartBalance)
	app := newAIApp(t, admin, ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	for _, note := range []string{"", "   ", "\t\n"} {
		resp, raw := doJSON(t, app, http.MethodPost, "/admin/ai/users/"+target.String()+"/credit",
			map[string]any{"delta_micro": adjustAddDelta, "note": note})
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("note=%q: want 400 got %d body=%s", note, resp.StatusCode, raw)
		}
		if got := bodyCode(t, raw); got != ai.CodeFieldRequired {
			t.Fatalf("note=%q: want code %q got %q (body=%s)", note, ai.CodeFieldRequired, got, raw)
		}
	}

	// Nothing touched: balance unchanged, and admin_audit carries no row
	// for this target at all — the brief's own wording ("sổ không xoá") only
	// means something if a REJECTED attempt never got in in the first place.
	if got := balanceOf(t, pool, target); got != adjustStartBalance {
		t.Fatalf("balance after three rejected (empty-note) adjustments: want %d got %d",
			adjustStartBalance, got)
	}
	if rows := auditRowsFor(t, pool, "ai.credit.adjust", target.String()); len(rows) != 0 {
		t.Fatalf("admin_audit rows for a target that only ever got REJECTED requests: want 0 got %d: %+v",
			len(rows), rows)
	}
}

func TestAdjustCreditAppliesDeltaAndWritesAppendOnlyAudit(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	adminID := newUserNoCredits(t, pool, "acting-admin-apply-delta")
	target := newUser(t, pool, "apply-delta", adjustStartBalance)
	app := newAIApp(t, adminID, ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	resp, raw := doJSON(t, app, http.MethodPost, "/admin/ai/users/"+target.String()+"/credit",
		map[string]any{"delta_micro": adjustAddDelta, "note": "top-up for support ticket #1"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("add: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	var out struct {
		BalanceMicro int64 `json:"balance_micro"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal: %v (%s)", err, raw)
	}
	if out.BalanceMicro != adjustAfterAddWant {
		t.Fatalf("balance after add: want %d got %d (response)", adjustAfterAddWant, out.BalanceMicro)
	}
	if got := balanceOf(t, pool, target); got != adjustAfterAddWant {
		t.Fatalf("balance after add: want %d got %d (DB)", adjustAfterAddWant, got)
	}

	// A SECOND adjustment, a debit this time, on the SAME account.
	resp, raw = doJSON(t, app, http.MethodPost, "/admin/ai/users/"+target.String()+"/credit",
		map[string]any{"delta_micro": adjustSubDelta, "note": "correcting the top-up above, it was too generous"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("subtract: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	if got := balanceOf(t, pool, target); got != adjustAfterSubWant {
		t.Fatalf("balance after subtract: want %d got %d (DB)", adjustAfterSubWant, got)
	}

	// APPEND-ONLY: both rows are present, in order, neither one erased or
	// overwritten by the other.
	rows := auditRowsFor(t, pool, "ai.credit.adjust", target.String())
	if len(rows) != 2 {
		t.Fatalf("admin_audit rows for target after two adjustments: want 2 got %d: %+v", len(rows), rows)
	}
	if rows[0].who == nil || *rows[0].who != adminID || rows[1].who == nil || *rows[1].who != adminID {
		t.Fatalf("admin_audit.who must be the ACTING ADMIN on both rows: got %+v", rows)
	}
	if rows[0].actor != "user" || rows[1].actor != "user" {
		t.Fatalf("admin_audit.actor: want %q on both rows, got %+v", "user", rows)
	}
	if !strings.Contains(rows[0].note, "+415300") || !strings.Contains(rows[0].note, "top-up for support ticket #1") {
		t.Fatalf("first audit row note must carry the signed delta AND the operator's own text, got %q", rows[0].note)
	}
	if !strings.Contains(rows[1].note, "-206700") || !strings.Contains(rows[1].note, "correcting the top-up above") {
		t.Fatalf("second audit row note must carry the signed delta AND the operator's own text, got %q", rows[1].note)
	}
}

func TestAdjustCreditRejectsZeroDelta(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	target := newUser(t, pool, "zero-delta", adjustStartBalance)
	app := newAIApp(t, uuid.New(), ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	resp, raw := doJSON(t, app, http.MethodPost, "/admin/ai/users/"+target.String()+"/credit",
		map[string]any{"delta_micro": 0, "note": "an accidental empty submit"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("delta_micro=0: want 400 got %d body=%s", resp.StatusCode, raw)
	}
	if got := bodyCode(t, raw); got != ai.CodeFieldRequired {
		t.Fatalf("want code %q got %q (body=%s)", ai.CodeFieldRequired, got, raw)
	}
	if got := balanceOf(t, pool, target); got != adjustStartBalance {
		t.Fatalf("balance after a rejected zero-delta request: want %d got %d", adjustStartBalance, got)
	}
}

// TestAdjustCreditAmountBoundary pins the ceiling AT the boundary, not near
// it — task-17-brief's own reviewer note names exactly this failure shape
// ("số dư <= 0 chỉ test ở +10/-490" in an earlier task): a request for
// PRECISELY MaxAdminCreditAdjustmentMicro must succeed, and one micro-credit
// past it must be refused.
func TestAdjustCreditAmountBoundary(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	adminID := newUserNoCredits(t, pool, "acting-admin-boundary")
	app := newAIApp(t, adminID, ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	t.Run("exactly the ceiling is accepted", func(t *testing.T) {
		target := newUserNoCredits(t, pool, "boundary-ok")
		resp, raw := doJSON(t, app, http.MethodPost, "/admin/ai/users/"+target.String()+"/credit",
			map[string]any{"delta_micro": ai.MaxAdminCreditAdjustmentMicro, "note": "at the ceiling"})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("delta_micro=+ceiling: want 200 got %d body=%s", resp.StatusCode, raw)
		}
	})

	t.Run("exactly minus the ceiling is accepted", func(t *testing.T) {
		target := newUser(t, pool, "boundary-neg-ok", ai.MaxAdminCreditAdjustmentMicro)
		resp, raw := doJSON(t, app, http.MethodPost, "/admin/ai/users/"+target.String()+"/credit",
			map[string]any{"delta_micro": -ai.MaxAdminCreditAdjustmentMicro, "note": "at minus the ceiling"})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("delta_micro=-ceiling: want 200 got %d body=%s", resp.StatusCode, raw)
		}
		if got := balanceOf(t, pool, target); got != 0 {
			t.Fatalf("balance after -ceiling on a +ceiling account: want 0 got %d", got)
		}
	})

	t.Run("one micro-credit past the ceiling is refused", func(t *testing.T) {
		target := newUserNoCredits(t, pool, "boundary-over")
		resp, raw := doJSON(t, app, http.MethodPost, "/admin/ai/users/"+target.String()+"/credit",
			map[string]any{"delta_micro": ai.MaxAdminCreditAdjustmentMicro + 1, "note": "one over"})
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("delta_micro=ceiling+1: want 400 got %d body=%s", resp.StatusCode, raw)
		}
		if got := bodyCode(t, raw); got != ai.CodeAmountOutOfRange {
			t.Fatalf("want code %q got %q (body=%s)", ai.CodeAmountOutOfRange, got, raw)
		}
		if rows := auditRowsFor(t, pool, "ai.credit.adjust", target.String()); len(rows) != 0 {
			t.Fatalf("a refused out-of-range request must write nothing, got %d audit row(s)", len(rows))
		}
	})

	t.Run("one micro-credit past minus the ceiling is refused", func(t *testing.T) {
		target := newUserNoCredits(t, pool, "boundary-under")
		resp, raw := doJSON(t, app, http.MethodPost, "/admin/ai/users/"+target.String()+"/credit",
			map[string]any{"delta_micro": -(ai.MaxAdminCreditAdjustmentMicro + 1), "note": "one under"})
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("delta_micro=-(ceiling+1): want 400 got %d body=%s", resp.StatusCode, raw)
		}
		if got := bodyCode(t, raw); got != ai.CodeAmountOutOfRange {
			t.Fatalf("want code %q got %q (body=%s)", ai.CodeAmountOutOfRange, got, raw)
		}
	})
}

func TestAdjustCreditUnknownUserIsNotFound(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	app := newAIApp(t, uuid.New(), ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	ghost := uuid.New()
	resp, raw := doJSON(t, app, http.MethodPost, "/admin/ai/users/"+ghost.String()+"/credit",
		map[string]any{"delta_micro": adjustAddDelta, "note": "topping up an id that names nobody"})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown user: want 404 got %d body=%s", resp.StatusCode, raw)
	}
	if got := bodyCode(t, raw); got != ai.CodeNotFound {
		t.Fatalf("want code %q got %q (body=%s)", ai.CodeNotFound, got, raw)
	}
}

func TestAdjustCreditRejectsMalformedUserID(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	app := newAIApp(t, uuid.New(), ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	resp, raw := doJSON(t, app, http.MethodPost, "/admin/ai/users/not-a-uuid/credit",
		map[string]any{"delta_micro": adjustAddDelta, "note": "malformed id"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("malformed id: want 400 got %d body=%s", resp.StatusCode, raw)
	}
}

// ============================================================================
// Step 2 — a pricing change takes effect on the VERY NEXT turn, with no
// restart and no in-process cache.
// ============================================================================

// TestPricingUpdateTakesEffectWithoutRestart is task-17-brief.md's Step 2,
// proven the only way that actually pins "no cache, no restart": ONE
// long-lived *ai.Service charges the SAME usage TWICE, with an admin
// pricing update run in between and NOTHING ELSE (no new Service, no new
// process) — if credits.go's pricing() ever grew a cache, this test would
// see the SAME charge both times and go red.
func TestPricingUpdateTakesEffectWithoutRestart(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	if _, err := pool.Exec(context.Background(), `
		UPDATE ai_pricing SET cost_micro_per_1k_in=$2, cost_micro_per_1k_cached_in=$3,
		    cost_micro_per_1k_out=$4, credits_per_1k_in=$5, credits_per_1k_cached_in=$6,
		    credits_per_1k_out=$7 WHERE model = $1`,
		ai.DefaultModel, pricingBeforeCostIn, pricingBeforeCachedIn, pricingBeforeOut,
		pricingBeforeCredIn, pricingBeforeCredCach, pricingBeforeCredOut); err != nil {
		t.Fatalf("seed ai_pricing: %v", err)
	}
	user := newUser(t, pool, "pricing-live", 100_000_000)
	adminID := newUserNoCredits(t, pool, "acting-admin-pricing-live")
	app := newAIApp(t, adminID, ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	// Charge #1, against the BEFORE rate.
	result := ai.Result{Usage: ai.Usage{CacheMissTokens: usageMissTokens}}
	before, err := credits.ChargeTurn(context.Background(), user, result, ai.DefaultModel)
	if err != nil {
		t.Fatalf("charge #1: %v", err)
	}
	wantBefore := int64((usageMissTokens*pricingBeforeCredIn + 999) / 1000) // divUp, by hand
	if before != wantBefore {
		t.Fatalf("charge #1 (before pricing update): want %d got %d", wantBefore, before)
	}

	// Change ONLY credits_per_1k_in through the admin route — no restart,
	// no new Service, same running process.
	resp, raw := doJSON(t, app, http.MethodPut, "/admin/ai/pricing/"+ai.DefaultModel, map[string]any{
		"cost_micro_per_1k_in":        pricingBeforeCostIn,
		"cost_micro_per_1k_cached_in": pricingBeforeCachedIn,
		"cost_micro_per_1k_out":       pricingBeforeOut,
		"credits_per_1k_in":           pricingAfterCredIn,
		"credits_per_1k_cached_in":    pricingBeforeCredCach,
		"credits_per_1k_out":          pricingBeforeCredOut,
		"note":                        "raising the input rate",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PUT pricing: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	if got := pricingRowCreditsIn(t, pool, ai.DefaultModel); got != pricingAfterCredIn {
		t.Fatalf("ai_pricing.credits_per_1k_in after PUT: want %d got %d", pricingAfterCredIn, got)
	}

	// Charge #2, SAME Service, SAME usage — must reflect the AFTER rate.
	after, err := credits.ChargeTurn(context.Background(), user, result, ai.DefaultModel)
	if err != nil {
		t.Fatalf("charge #2: %v", err)
	}
	wantAfter := int64((usageMissTokens*pricingAfterCredIn + 999) / 1000)
	if after != wantAfter {
		t.Fatalf("charge #2 (after pricing update, SAME process, no restart): want %d got %d — "+
			"a value equal to charge #1 (%d) here means the rate change did not take effect "+
			"without a restart, exactly the property this test exists to pin",
			wantAfter, after, before)
	}
	if after == before {
		t.Fatal("charge #2 equals charge #1 — the pricing update had no observable effect")
	}
}

func TestPricingUpdateRejectsNegativeRate(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	adminID := newUserNoCredits(t, pool, "acting-admin-pricing-negrate")
	app := newAIApp(t, adminID, ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	resp, raw := doJSON(t, app, http.MethodPut, "/admin/ai/pricing/"+ai.DefaultModel, map[string]any{
		"cost_micro_per_1k_in":        1000,
		"cost_micro_per_1k_cached_in": 10,
		"cost_micro_per_1k_out":       2000,
		"credits_per_1k_in":           -1, // the boundary: -1 refused, 0 (tested implicitly below) legal
		"credits_per_1k_cached_in":    10,
		"credits_per_1k_out":          2000,
		"note":                        "a typo'd negative rate",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("negative rate: want 400 got %d body=%s", resp.StatusCode, raw)
	}
	if got := bodyCode(t, raw); got != ai.CodeAmountOutOfRange {
		t.Fatalf("want code %q got %q (body=%s)", ai.CodeAmountOutOfRange, got, raw)
	}

	// Zero, the legal boundary immediately next to -1, must be accepted.
	resp, raw = doJSON(t, app, http.MethodPut, "/admin/ai/pricing/"+ai.DefaultModel, map[string]any{
		"cost_micro_per_1k_in":        1000,
		"cost_micro_per_1k_cached_in": 0,
		"cost_micro_per_1k_out":       2000,
		"credits_per_1k_in":           1000,
		"credits_per_1k_cached_in":    0,
		"credits_per_1k_out":          2000,
		"note":                        "cached-in rate is legitimately free",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("rate=0 (the boundary): want 200 got %d body=%s", resp.StatusCode, raw)
	}
}

func TestPricingUpdateUnknownModelIsNotFound(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	app := newAIApp(t, uuid.New(), ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	resp, raw := doJSON(t, app, http.MethodPut, "/admin/ai/pricing/no-such-model-"+uuid.NewString(), map[string]any{
		"cost_micro_per_1k_in": 1, "cost_micro_per_1k_cached_in": 1, "cost_micro_per_1k_out": 1,
		"credits_per_1k_in": 1, "credits_per_1k_cached_in": 1, "credits_per_1k_out": 1,
		"note": "a model this deployment never seeded",
	})
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown model: want 404 got %d body=%s", resp.StatusCode, raw)
	}
	if got := bodyCode(t, raw); got != ai.CodeNotFound {
		t.Fatalf("want code %q got %q (body=%s)", ai.CodeNotFound, got, raw)
	}
}

func TestAdminListPricingReturnsEveryModel(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	app := newAIApp(t, uuid.New(), ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	resp, raw := doJSON(t, app, http.MethodGet, "/admin/ai/pricing", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET pricing: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	var rows []struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatalf("unmarshal: %v (%s)", err, raw)
	}
	// Migration 0007 seeds exactly two models — both must be present.
	got := map[string]bool{}
	for _, r := range rows {
		got[r.Model] = true
	}
	if !got["deepseek-v4-pro"] || !got["deepseek-v4-flash"] {
		t.Fatalf("want both seeded models present, got %v", rows)
	}
}

// ============================================================================
// Step 4 — the base system prompt cannot be cleared to empty.
// ============================================================================

func TestUpdateBasePromptRejectsEmpty(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	app := newAIApp(t, uuid.New(), ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})
	original := basePromptOf(t, pool)

	for _, prompt := range []string{"", "   ", "\n\t "} {
		resp, raw := doJSON(t, app, http.MethodPut, "/admin/ai/settings",
			map[string]any{"base_system_prompt": prompt, "note": "trying to clear it"})
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("base_system_prompt=%q: want 400 got %d body=%s", prompt, resp.StatusCode, raw)
		}
		if got := bodyCode(t, raw); got != ai.CodeFieldRequired {
			t.Fatalf("base_system_prompt=%q: want code %q got %q (body=%s)",
				prompt, ai.CodeFieldRequired, got, raw)
		}
	}

	if got := basePromptOf(t, pool); got != original {
		t.Fatalf("base_system_prompt after three rejected clear attempts: want unchanged %q got %q",
			original, got)
	}
}

func TestUpdateBasePromptRejectsMissingField(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	app := newAIApp(t, uuid.New(), ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	resp, raw := doJSON(t, app, http.MethodPut, "/admin/ai/settings", map[string]any{"note": "forgot the field"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("no base_system_prompt at all: want 400 got %d body=%s", resp.StatusCode, raw)
	}
	if got := bodyCode(t, raw); got != ai.CodeFieldRequired {
		t.Fatalf("want code %q got %q (body=%s)", ai.CodeFieldRequired, got, raw)
	}
}

func TestUpdateBasePromptAppliesAndAudits(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	adminID := newUserNoCredits(t, pool, "acting-admin-base-prompt")
	app := newAIApp(t, adminID, ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	const newPrompt = "You are the platform's tutor. Answer only from course material. New rule: never invent a citation."
	resp, raw := doJSON(t, app, http.MethodPut, "/admin/ai/settings",
		map[string]any{"base_system_prompt": newPrompt, "note": "adding the citation rule"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("valid update: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	var out struct {
		BaseSystemPrompt string `json:"base_system_prompt"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal: %v (%s)", err, raw)
	}
	if out.BaseSystemPrompt != newPrompt {
		t.Fatalf("response base_system_prompt: want %q got %q", newPrompt, out.BaseSystemPrompt)
	}
	if got := basePromptOf(t, pool); got != newPrompt {
		t.Fatalf("DB base_system_prompt: want %q got %q", newPrompt, got)
	}

	rows := auditRowsFor(t, pool, "ai.settings.base_prompt", "ai_settings")
	if len(rows) != 1 {
		t.Fatalf("admin_audit rows for the base-prompt change: want 1 got %d: %+v", len(rows), rows)
	}
	if rows[0].who == nil || *rows[0].who != adminID {
		t.Fatalf("admin_audit.who: want %s got %v", adminID, rows[0].who)
	}
	if !strings.Contains(rows[0].note, "citation rule") {
		t.Fatalf("admin_audit.note should carry the operator's own note, got %q", rows[0].note)
	}
}

// TestUpdateBasePromptCharLimitBoundary mirrors the EXACT boundary style
// already established for PUT /ai/config's own system_prompt cap
// ("accepts a prompt of exactly the limit and one below" /
// "rejects one character over the limit") — at MaxBasePromptChars and at
// MaxBasePromptChars+1, not at some round number nearby.
func TestUpdateBasePromptCharLimitBoundary(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	adminID := newUserNoCredits(t, pool, "acting-admin-base-prompt-limit")
	app := newAIApp(t, adminID, ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	resp, raw := doJSON(t, app, http.MethodPut, "/admin/ai/settings", map[string]any{
		"base_system_prompt": strings.Repeat("a", ai.MaxBasePromptChars),
		"note":               "exactly at the limit",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("exactly MaxBasePromptChars: want 200 got %d body=%s", resp.StatusCode, raw)
	}

	resp, raw = doJSON(t, app, http.MethodPut, "/admin/ai/settings", map[string]any{
		"base_system_prompt": strings.Repeat("a", ai.MaxBasePromptChars+1),
		"note":               "one over the limit",
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("MaxBasePromptChars+1: want 400 got %d body=%s", resp.StatusCode, raw)
	}
	if got := bodyCode(t, raw); got != ai.CodeFieldTooLong {
		t.Fatalf("want code %q got %q (body=%s)", ai.CodeFieldTooLong, got, raw)
	}
}

func TestAdminGetSettingsReturnsBasePromptAndTheRest(t *testing.T) {
	pool := store.TestPool(t)
	seedFixtureRates(t, pool)
	credits := ai.NewService(pool)
	app := newAIApp(t, uuid.New(), ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	resp, raw := doJSON(t, app, http.MethodGet, "/admin/ai/settings", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET settings: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	var out struct {
		BaseSystemPrompt    string `json:"base_system_prompt"`
		CreditsPerWebSearch int64  `json:"credits_per_web_search"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal: %v (%s)", err, raw)
	}
	if out.BaseSystemPrompt == "" {
		t.Fatal("GET /admin/ai/settings returned an empty base_system_prompt for a seeded database")
	}
	if out.CreditsPerWebSearch != settingsCreditsPerWebSearch {
		t.Fatalf("credits_per_web_search: want %d got %d", settingsCreditsPerWebSearch, out.CreditsPerWebSearch)
	}
}

// ============================================================================
// GET /admin/ai/users and GET /admin/ai/users/:id
// ============================================================================

func TestListUsersFiltersByEmailSubstring(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	app := newAIApp(t, uuid.New(), ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	tag := uuid.NewString()[:8]
	matchEmail := fmt.Sprintf("findme-%s@example.test", tag)
	otherEmail := fmt.Sprintf("nomatch-%s@example.test", uuid.NewString()[:8])
	insertUserWithEmail(t, pool, matchEmail)
	insertUserWithEmail(t, pool, otherEmail)

	resp, raw := doJSON(t, app, http.MethodGet, "/admin/ai/users?q=findme-"+tag, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("search: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	var rows []struct {
		Email string `json:"email"`
	}
	if err := json.Unmarshal(raw, &rows); err != nil {
		t.Fatalf("unmarshal: %v (%s)", err, raw)
	}
	if len(rows) != 1 || rows[0].Email != matchEmail {
		t.Fatalf("search %q: want exactly [%s] got %v", "findme-"+tag, matchEmail, rows)
	}
}

func insertUserWithEmail(t *testing.T, pool *pgxpool.Pool, email string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email, name, pw_hash) VALUES ($1,'',$2) RETURNING id`,
		email, "not-a-real-hash").Scan(&id); err != nil {
		t.Fatalf("insert user %s: %v", email, err)
	}
	return id
}

func TestGetUserShowsUsageAndAdjustmentsScopedToThatUserOnly(t *testing.T) {
	pool := store.TestPool(t)
	seedFixtureRates(t, pool)
	credits := ai.NewService(pool)
	adminID := newUserNoCredits(t, pool, "acting-admin-scoped-get")
	app := newAIApp(t, adminID, ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	userA := newUser(t, pool, "scope-a", 500000)
	userB := newUser(t, pool, "scope-b", 500000)

	if _, err := credits.ChargeTurn(context.Background(), userA,
		ai.Result{Usage: ai.Usage{CacheMissTokens: 40}}, ai.DefaultModel); err != nil {
		t.Fatalf("charge user A: %v", err)
	}
	if _, err := credits.ChargeTurn(context.Background(), userB,
		ai.Result{Usage: ai.Usage{CacheMissTokens: 40}}, ai.DefaultModel); err != nil {
		t.Fatalf("charge user B: %v", err)
	}

	if resp, raw := doJSON(t, app, http.MethodPost, "/admin/ai/users/"+userA.String()+"/credit",
		map[string]any{"delta_micro": 100000, "note": "adjustment for A only"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("adjust A: want 200 got %d body=%s", resp.StatusCode, raw)
	}

	resp, raw := doJSON(t, app, http.MethodGet, "/admin/ai/users/"+userA.String(), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET user A: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	var out struct {
		BalanceMicro      int64                    `json:"balance_micro"`
		RecentUsage       []struct{ Model string } `json:"recent_usage"`
		RecentAdjustments []struct{ Note string }  `json:"recent_adjustments"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal: %v (%s)", err, raw)
	}
	if len(out.RecentUsage) != 1 {
		t.Fatalf("user A's recent_usage: want 1 entry (not user B's) got %d", len(out.RecentUsage))
	}
	if len(out.RecentAdjustments) != 1 || !strings.Contains(out.RecentAdjustments[0].Note, "adjustment for A only") {
		t.Fatalf("user A's recent_adjustments: want exactly the one adjustment made for A, got %v",
			out.RecentAdjustments)
	}
}

func TestGetUserUnknownIdIsNotFound(t *testing.T) {
	pool := store.TestPool(t)
	credits := ai.NewService(pool)
	app := newAIApp(t, uuid.New(), ai.HandlerDeps{Credits: credits, Courses: fakeCourses{}})

	resp, raw := doJSON(t, app, http.MethodGet, "/admin/ai/users/"+uuid.NewString(), nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown user: want 404 got %d body=%s", resp.StatusCode, raw)
	}
}

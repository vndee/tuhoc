package auth_test

// signup_credit_test.go pins task 10's second half of spec §3.4: a new
// account is granted ai_credits.balance_micro from ai_settings.
// signup_grant_micro — read live from Postgres on every registration,
// never a constant baked into this binary — and registration is one
// atomic unit with that grant, so a failure in the grant step can never
// leave a real, permanent user account with no credit and no way to ever
// get one (nothing retries a signup grant after the fact).
//
// This lives in package auth_test (not internal/ai) because what is
// under test is auth.Repo.CreateUserWithSignupCredit's OWN atomicity —
// the same reason auth_test.go itself drives everything through
// server.New rather than calling auth's usecase layer directly (see that
// file's own package comment).

import (
	"context"
	"net/http"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/store"
)

// setSignupGrantMicro overwrites ai_settings' one row's signup_grant_micro
// — migration 0007_ai_credits' own schema comment: "Đúng MỘT hàng", so an
// UPDATE with no WHERE clause is safe and always hits exactly that row.
func setSignupGrantMicro(t *testing.T, pool *pgxpool.Pool, micro int64) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE ai_settings SET signup_grant_micro = $1`, micro); err != nil {
		t.Fatalf("update ai_settings.signup_grant_micro: %v", err)
	}
}

// creditRowCountByUser counts ai_credits rows for userID directly — a
// helper independent of whatever code path under test wrote (or failed
// to write) the row.
func creditRowCountByUser(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM ai_credits WHERE user_id = $1`, userID).Scan(&n); err != nil {
		t.Fatalf("count ai_credits for user %s: %v", userID, err)
	}
	return n
}

// creditBalanceOf reads ai_credits.balance_micro for userID. Fails the
// test outright (not "returns 0") if the row does not exist — a missing
// row and a granted balance of 0 are different failure shapes, and this
// helper must not collapse them.
func creditBalanceOf(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) int64 {
	t.Helper()
	var b int64
	if err := pool.QueryRow(context.Background(),
		`SELECT balance_micro FROM ai_credits WHERE user_id = $1`, userID).Scan(&b); err != nil {
		t.Fatalf("read ai_credits.balance_micro for user %s: %v", userID, err)
	}
	return b
}

// registerUser drives POST /auth/register through the real HTTP path
// (server.New, same as auth_test.go's own subtests) and returns the new
// account's id, failing the test if registration itself did not succeed.
func registerUser(t *testing.T, app *fiber.App, email string) uuid.UUID {
	t.Helper()
	resp, body, raw := doJSON(t, app, http.MethodPost, "/auth/register",
		map[string]string{"email": email, "password": "correct-horse-battery-staple", "name": "Signup Credit Test"}, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("register %s: want 200, got %d (body=%s)", email, resp.StatusCode, raw)
	}
	id, err := uuid.Parse(body.ID)
	if err != nil {
		t.Fatalf("register %s: response id %q did not parse as a uuid: %v", email, body.ID, err)
	}
	return id
}

// TestRegisterGrantsSignupCreditFromDBSettingNotAConstant registers two
// users under two DIFFERENT ai_settings.signup_grant_micro values and
// expects each to land with exactly that value — a fixture chosen so
// that only reading the setting LIVE, on every registration, can pass
// it. A value read once and cached, or a constant compiled into the
// binary, would give the second user the first user's amount instead.
func TestRegisterGrantsSignupCreditFromDBSettingNotAConstant(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool, false, nil)

	const grantA int64 = 730000 // arbitrary micro-credits — distinct from grantB and from the migration's own default (0)
	const grantB int64 = 210000 // distinct from grantA and from 0

	setSignupGrantMicro(t, pool, grantA)
	idA := registerUser(t, app, uniqueEmail("grant-a"))
	if got := creditRowCountByUser(t, pool, idA); got != 1 {
		t.Fatalf("ai_credits rows for user A: want exactly 1, got %d", got)
	}
	if got := creditBalanceOf(t, pool, idA); got != grantA {
		t.Fatalf("signup grant for user A: want %d (ai_settings.signup_grant_micro at "+
			"registration time), got %d", grantA, got)
	}

	setSignupGrantMicro(t, pool, grantB)
	idB := registerUser(t, app, uniqueEmail("grant-b"))
	if got := creditRowCountByUser(t, pool, idB); got != 1 {
		t.Fatalf("ai_credits rows for user B: want exactly 1, got %d", got)
	}
	if got := creditBalanceOf(t, pool, idB); got != grantB {
		t.Fatalf("signup grant for user B: want %d (ai_settings.signup_grant_micro changed to "+
			"%d AFTER user A registered, with no deploy in between), got %d — a hardcoded grant "+
			"amount would still show user A's %d here", grantB, grantB, got, grantA)
	}
}

// TestRegisterFailingAtGrantLeavesNoOrphanedCreditOrUser forces the
// signup-credit step to fail — deleting ai_settings' one row means
// GrantSignupCredit's read finds nothing — at the exact point where, if
// the user row and the credit grant were two separate statements, the
// user row would already have committed. It then checks BOTH counts are
// zero afterward, not just ai_credits.
//
// Checking the user row matters as much as checking ai_credits: the
// failure mode task 10 exists to close is "a real, permanent account
// that can log in and use every other route, but whose signup grant
// never landed and never will" (nothing retries a grant after the
// fact) — a SURVIVING user row paired with a MISSING credit row. A test
// that only asserted zero ai_credits rows would stay green even if
// registration rolled back the credit half alone and left the user half
// committed; both counts together are what proves the two inserts share
// one atomic outcome.
func TestRegisterFailingAtGrantLeavesNoOrphanedCreditOrUser(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool, false, nil)

	if _, err := pool.Exec(context.Background(), `DELETE FROM ai_settings`); err != nil {
		t.Fatalf("break ai_settings: %v", err)
	}

	email := uniqueEmail("orphan")
	resp, body, raw := doJSON(t, app, http.MethodPost, "/auth/register",
		map[string]string{"email": email, "password": "correct-horse-battery-staple", "name": "Orphan Test"}, nil)
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("register with no ai_settings row: want 500, got %d (body=%+v raw=%s)", resp.StatusCode, body, raw)
	}

	var userCount int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM users WHERE email = $1`, email).Scan(&userCount); err != nil {
		t.Fatalf("count users: %v", err)
	}
	if userCount != 0 {
		t.Fatalf("user row survived a registration whose credit grant failed: %d rows — the "+
			"grant must run in the SAME transaction as the user insert, or a failed grant "+
			"leaves a real account with no credit, forever", userCount)
	}

	var creditCount int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM ai_credits ac JOIN users u ON u.id = ac.user_id WHERE u.email = $1`,
		email).Scan(&creditCount); err != nil {
		t.Fatalf("count ai_credits joined to the failed email: %v", err)
	}
	if creditCount != 0 {
		t.Fatalf("orphaned ai_credits row survived a failed registration: %d rows", creditCount)
	}
}

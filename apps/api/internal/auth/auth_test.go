// Package auth_test exercises the auth package end to end, through
// internal/server.New — the same wiring Task 7 and Task 8 will build on
// — against a real Postgres via store.TestPool. It is an external test
// package (auth_test, not auth) specifically so it can import server
// (which imports auth) without a cycle, letting these tests prove both
// "auth's own logic is correct" and "server.go wired it up correctly",
// which is the thing later tasks actually depend on.
package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/server"
	"github.com/vndee/tuhoc-api/internal/store"
)

// testTimeoutMS bounds each simulated request. argon2id hashing under the
// library's DefaultParams (64 MiB, NumCPU parallelism) is deliberately
// slow, so this is generous relative to Fiber App.Test's own 1000ms
// default.
const testTimeoutMS = 10000

const sessionCookieName = "tuhoc_session"

func newTestApp(pool *pgxpool.Pool, cookieSecure bool, logOutput io.Writer) *fiber.App {
	if logOutput == nil {
		logOutput = io.Discard
	}
	return server.New(config.Config{CookieSecure: cookieSecure}, server.Deps{Pool: pool, LogOutput: logOutput})
}

func uniqueEmail(label string) string {
	return fmt.Sprintf("auth-%s-%s@example.test", label, uuid.NewString())
}

// apiResponse covers the shape of every JSON body this package's
// handlers return: either {id,email,name} on success or {error} on
// failure. Fields simply stay zero-valued when absent.
type apiResponse struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Error string `json:"error"`
}

// doJSON performs one simulated HTTP request against app and decodes a
// JSON response body (if any) into apiResponse. It returns the raw body
// bytes too, for tests that need byte-for-byte comparison.
func doJSON(t *testing.T, app *fiber.App, method, path string, body any, cookie *http.Cookie) (*http.Response, apiResponse, []byte) {
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

	var parsed apiResponse
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &parsed) // best-effort: e.g. logout has no body
	}

	return resp, parsed, raw
}

func sessionCookie(resp *http.Response) *http.Cookie {
	for _, c := range resp.Cookies() {
		if c.Name == sessionCookieName {
			return c
		}
	}
	return nil
}

// TestAuthFlows covers every case the task brief names (register -> me
// (with cookie) -> logout -> me 401; login with wrong password -> 401;
// register with duplicate email -> 409) plus the cases implied by the
// task's security expectations: non-enumeration of registered emails,
// session-id shape and cookie attributes, logout actually deleting the
// session row, multi-device login, and passwords/hashes never reaching
// the log. All subtests share one store.TestPool container (each gets
// its own fiber.App instance, so per-app state like the rate limiter's
// counters never leaks between them) to keep the container-spin-up cost
// to once per run.
func TestAuthFlows(t *testing.T) {
	pool := store.TestPool(t)

	t.Run("register then me then logout then me401", func(t *testing.T) {
		app := newTestApp(pool, false, nil)
		email := uniqueEmail("flow")

		resp, body, _ := doJSON(t, app, http.MethodPost, "/auth/register",
			map[string]string{"email": email, "password": "correct horse battery staple", "name": "Flow User"}, nil)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("register: want 200 got %d", resp.StatusCode)
		}
		if body.Email != email || body.Name != "Flow User" || body.ID == "" {
			t.Fatalf("register: unexpected body %+v", body)
		}
		cookie := sessionCookie(resp)
		if cookie == nil {
			t.Fatalf("register: no %s cookie set", sessionCookieName)
		}

		meResp, meBody, _ := doJSON(t, app, http.MethodGet, "/me", nil, cookie)
		if meResp.StatusCode != http.StatusOK {
			t.Fatalf("me after register: want 200 got %d", meResp.StatusCode)
		}
		if meBody.ID != body.ID || meBody.Email != email {
			t.Fatalf("me after register: unexpected body %+v", meBody)
		}

		logoutResp, _, _ := doJSON(t, app, http.MethodPost, "/auth/logout", nil, cookie)
		if logoutResp.StatusCode != http.StatusOK {
			t.Fatalf("logout: want 200 got %d", logoutResp.StatusCode)
		}

		me401Resp, _, _ := doJSON(t, app, http.MethodGet, "/me", nil, cookie)
		if me401Resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("me after logout: want 401 got %d", me401Resp.StatusCode)
		}
	})

	t.Run("me without any cookie is 401", func(t *testing.T) {
		// The exact 401-without-cookie case F3 says Task 7/8 must also
		// cover for their own routes; pinned directly here since /me is
		// the first consumer of Require.
		app := newTestApp(pool, false, nil)
		resp, _, _ := doJSON(t, app, http.MethodGet, "/me", nil, nil)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("me without cookie: want 401 got %d", resp.StatusCode)
		}
	})

	t.Run("logout deletes the session row, not just the cookie", func(t *testing.T) {
		app := newTestApp(pool, false, nil)
		email := uniqueEmail("delete-row")

		resp, _, _ := doJSON(t, app, http.MethodPost, "/auth/register",
			map[string]string{"email": email, "password": "another-strong-password-1", "name": "Row"}, nil)
		cookie := sessionCookie(resp)
		if cookie == nil {
			t.Fatalf("register: no cookie")
		}
		sessionID := cookie.Value

		var before int
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM sessions WHERE id = $1`, sessionID).Scan(&before); err != nil {
			t.Fatalf("count sessions before logout: %v", err)
		}
		if before != 1 {
			t.Fatalf("want 1 session row before logout, got %d", before)
		}

		doJSON(t, app, http.MethodPost, "/auth/logout", nil, cookie)

		var after int
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM sessions WHERE id = $1`, sessionID).Scan(&after); err != nil {
			t.Fatalf("count sessions after logout: %v", err)
		}
		if after != 0 {
			t.Fatalf("want session row deleted after logout, still found %d", after)
		}
	})

	t.Run("login wrong password is 401", func(t *testing.T) {
		app := newTestApp(pool, false, nil)
		email := uniqueEmail("wrongpw")

		regResp, _, _ := doJSON(t, app, http.MethodPost, "/auth/register",
			map[string]string{"email": email, "password": "the-real-password-1", "name": "WP"}, nil)
		if regResp.StatusCode != http.StatusOK {
			t.Fatalf("register: want 200 got %d", regResp.StatusCode)
		}

		loginResp, loginBody, _ := doJSON(t, app, http.MethodPost, "/auth/login",
			map[string]string{"email": email, "password": "definitely-not-the-password"}, nil)
		if loginResp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("login wrong password: want 401 got %d", loginResp.StatusCode)
		}
		if loginBody.Error == "" {
			t.Fatalf("login wrong password: want an error body, got %+v", loginBody)
		}
		if sessionCookie(loginResp) != nil {
			t.Fatalf("login wrong password: must not set a session cookie")
		}
	})

	t.Run("register duplicate email (including different case) is 409", func(t *testing.T) {
		app := newTestApp(pool, false, nil)
		email := uniqueEmail("dup")

		first, _, _ := doJSON(t, app, http.MethodPost, "/auth/register",
			map[string]string{"email": email, "password": "first-password-1", "name": "First"}, nil)
		if first.StatusCode != http.StatusOK {
			t.Fatalf("first register: want 200 got %d", first.StatusCode)
		}

		second, secondBody, _ := doJSON(t, app, http.MethodPost, "/auth/register",
			map[string]string{"email": email, "password": "second-password-1", "name": "Second"}, nil)
		if second.StatusCode != http.StatusConflict {
			t.Fatalf("duplicate register: want 409 got %d", second.StatusCode)
		}
		if secondBody.Error == "" {
			t.Fatalf("duplicate register: want an error body, got %+v", secondBody)
		}

		// users.email is citext: an email differing only by case must
		// collide too, not silently create a second account.
		differentCase := strings.ToUpper(email[:1]) + email[1:]
		third, _, _ := doJSON(t, app, http.MethodPost, "/auth/register",
			map[string]string{"email": differentCase, "password": "third-password-1", "name": "Third"}, nil)
		if third.StatusCode != http.StatusConflict {
			t.Fatalf("duplicate register (different case %q): want 409 got %d", differentCase, third.StatusCode)
		}
	})

	t.Run("login against a nonexistent email is indistinguishable from wrong password", func(t *testing.T) {
		app := newTestApp(pool, false, nil)
		email := uniqueEmail("enum-check")

		doJSON(t, app, http.MethodPost, "/auth/register",
			map[string]string{"email": email, "password": "the-real-password-2", "name": "EC"}, nil)

		wrongPwResp, wrongPwBody, wrongPwRaw := doJSON(t, app, http.MethodPost, "/auth/login",
			map[string]string{"email": email, "password": "wrong-password-here"}, nil)

		noSuchUserResp, noSuchUserBody, noSuchUserRaw := doJSON(t, app, http.MethodPost, "/auth/login",
			map[string]string{"email": uniqueEmail("never-registered"), "password": "wrong-password-here"}, nil)

		if wrongPwResp.StatusCode != noSuchUserResp.StatusCode {
			t.Fatalf("status codes differ: wrong-password=%d no-such-user=%d", wrongPwResp.StatusCode, noSuchUserResp.StatusCode)
		}
		if wrongPwResp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("want 401, got %d", wrongPwResp.StatusCode)
		}
		if wrongPwBody.Error != noSuchUserBody.Error {
			t.Fatalf("error messages differ: wrong-password=%q no-such-user=%q", wrongPwBody.Error, noSuchUserBody.Error)
		}
		if !bytes.Equal(wrongPwRaw, noSuchUserRaw) {
			t.Fatalf("response bodies differ byte-for-byte: %q vs %q", wrongPwRaw, noSuchUserRaw)
		}
	})

	t.Run("session cookie attributes: HttpOnly, SameSite=Lax, Secure from config, unguessable id", func(t *testing.T) {
		for _, cookieSecure := range []bool{false, true} {
			app := newTestApp(pool, cookieSecure, nil)
			email := uniqueEmail(fmt.Sprintf("cookie-%v", cookieSecure))

			resp, body, _ := doJSON(t, app, http.MethodPost, "/auth/register",
				map[string]string{"email": email, "password": "cookie-check-password-1", "name": "Cookie"}, nil)
			cookie := sessionCookie(resp)
			if cookie == nil {
				t.Fatalf("no session cookie set")
			}

			if !cookie.HttpOnly {
				t.Fatalf("cookie: want HttpOnly=true")
			}
			if cookie.Secure != cookieSecure {
				t.Fatalf("cookie: want Secure=%v (from cfg.CookieSecure) got %v", cookieSecure, cookie.Secure)
			}
			if cookie.SameSite != http.SameSiteLaxMode {
				t.Fatalf("cookie: want SameSite=Lax got %v", cookie.SameSite)
			}

			sid, err := uuid.Parse(cookie.Value)
			if err != nil {
				t.Fatalf("cookie value is not a UUID: %v (%q)", err, cookie.Value)
			}
			if sid.String() == body.ID {
				t.Fatalf("session id must not equal the user id (cookie must carry only the session id)")
			}

			wantExpiry := time.Now().Add(30 * 24 * time.Hour)
			if diff := cookie.Expires.Sub(wantExpiry); diff < -time.Hour || diff > time.Hour {
				t.Fatalf("cookie Expires not ~30 days out: got %v, want near %v", cookie.Expires, wantExpiry)
			}

			var dbExpiresAt time.Time
			if err := pool.QueryRow(context.Background(), `SELECT expires_at FROM sessions WHERE id = $1`, sid).Scan(&dbExpiresAt); err != nil {
				t.Fatalf("query sessions.expires_at: %v", err)
			}
			if diff := cookie.Expires.Sub(dbExpiresAt); diff < -time.Second || diff > time.Second {
				t.Fatalf("cookie Expires (%v) and sessions.expires_at (%v) disagree", cookie.Expires, dbExpiresAt)
			}
		}
	})

	t.Run("second login from another device does not invalidate the first session", func(t *testing.T) {
		app := newTestApp(pool, false, nil)
		email := uniqueEmail("multidevice")
		password := "multi-device-password-1"

		regResp, _, _ := doJSON(t, app, http.MethodPost, "/auth/register",
			map[string]string{"email": email, "password": password, "name": "MD"}, nil)
		firstCookie := sessionCookie(regResp)
		if firstCookie == nil {
			t.Fatalf("register: no cookie")
		}

		loginResp, _, _ := doJSON(t, app, http.MethodPost, "/auth/login",
			map[string]string{"email": email, "password": password}, nil)
		if loginResp.StatusCode != http.StatusOK {
			t.Fatalf("second login: want 200 got %d", loginResp.StatusCode)
		}
		secondCookie := sessionCookie(loginResp)
		if secondCookie == nil {
			t.Fatalf("second login: no cookie")
		}
		if secondCookie.Value == firstCookie.Value {
			t.Fatalf("second login must issue a distinct session id")
		}

		firstMe, _, _ := doJSON(t, app, http.MethodGet, "/me", nil, firstCookie)
		if firstMe.StatusCode != http.StatusOK {
			t.Fatalf("first session after second login: want 200 got %d", firstMe.StatusCode)
		}
		secondMe, _, _ := doJSON(t, app, http.MethodGet, "/me", nil, secondCookie)
		if secondMe.StatusCode != http.StatusOK {
			t.Fatalf("second session: want 200 got %d", secondMe.StatusCode)
		}
	})

	t.Run("password is never written to the access log", func(t *testing.T) {
		var logBuf bytes.Buffer
		app := newTestApp(pool, false, &logBuf)
		email := uniqueEmail("no-log-leak")
		password := "super-secret-do-not-log-me-1"

		doJSON(t, app, http.MethodPost, "/auth/register",
			map[string]string{"email": email, "password": password, "name": "NoLeak"}, nil)
		doJSON(t, app, http.MethodPost, "/auth/login",
			map[string]string{"email": email, "password": password}, nil)
		doJSON(t, app, http.MethodPost, "/auth/login",
			map[string]string{"email": email, "password": "wrong-" + password}, nil)

		logged := logBuf.String()
		if strings.Contains(logged, password) {
			t.Fatalf("access log contains the plaintext password: %q", logged)
		}
		if strings.Contains(logged, "$argon2id$") {
			t.Fatalf("access log contains an argon2id hash: %q", logged)
		}
	})

	t.Run("register rejects empty email or password", func(t *testing.T) {
		app := newTestApp(pool, false, nil)

		resp1, _, _ := doJSON(t, app, http.MethodPost, "/auth/register",
			map[string]string{"email": "", "password": "something-1", "name": "X"}, nil)
		if resp1.StatusCode != http.StatusBadRequest {
			t.Fatalf("empty email: want 400 got %d", resp1.StatusCode)
		}

		resp2, _, _ := doJSON(t, app, http.MethodPost, "/auth/register",
			map[string]string{"email": uniqueEmail("empty-pw"), "password": "", "name": "X"}, nil)
		if resp2.StatusCode != http.StatusBadRequest {
			t.Fatalf("empty password: want 400 got %d", resp2.StatusCode)
		}
	})

	t.Run("rate limiting: 11th request to /auth/* within a minute is 429", func(t *testing.T) {
		app := newTestApp(pool, false, nil)

		var last *http.Response
		for i := 0; i < 11; i++ {
			last, _, _ = doJSON(t, app, http.MethodPost, "/auth/login",
				map[string]string{"email": uniqueEmail(fmt.Sprintf("rl-%d", i)), "password": "whatever-1"}, nil)
		}
		if last.StatusCode != http.StatusTooManyRequests {
			t.Fatalf("11th /auth request in a minute: want 429 got %d", last.StatusCode)
		}
	})
}

package auth

import (
	"errors"
	"net/mail"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/apilog"
)

// CookieName is the name of the session cookie set by Register/Login and
// cleared by Logout.
const CookieName = "tuhoc_session"

// localsUIDKey is the c.Locals key Require stores the authenticated
// user's id under. It is unexported on purpose: every handler outside
// this package (Tasks 7's sync/events, Task 8's stats, and this
// package's own Me) must go through UID instead of hardcoding the key
// itself, so the key can only ever be set and read from one place.
const localsUIDKey = "uid"

// localsIsAdminKey is the c.Locals key OptionalAdmin stores its verdict
// under. Deliberately a DIFFERENT key from localsUIDKey: a route behind
// OptionalAdmin may have no user at all, and storing uuid.Nil under "uid"
// would make an anonymous request indistinguishable from an authenticated
// one to UID(c) — which several handlers read to attribute writes.
const localsIsAdminKey = "isAdmin"

// Handler holds the HTTP-layer concerns for auth: parsing requests,
// shaping responses, and setting/clearing the session cookie. It owns no
// SQL and no password/session business rules — those live in Usecase.
type Handler struct {
	uc           *Usecase
	cookieSecure bool
}

// NewHandler builds a Handler. cookieSecure comes from cfg.CookieSecure —
// it must never be hardcoded, since local http development and
// production https deployment need different values.
func NewHandler(uc *Usecase, cookieSecure bool) *Handler {
	return &Handler{uc: uc, cookieSecure: cookieSecure}
}

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// meResponse is the shape returned by Register, Login, and Me. It is
// deliberately narrow: id, email, name, role — never pw_hash.
//
// Role is Task 8's addition: the web admin CMS needs to know whether the
// signed-in account can reach /admin/* before it shows the option, and
// every value here is exactly what users.role holds ("user" or "admin"),
// never inferred from anything else.
type meResponse struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
	Role  string `json:"role"`
}

func toMeResponse(u User) meResponse {
	return meResponse{ID: u.ID.String(), Email: u.Email, Name: u.Name, Role: u.Role}
}

// Register handles POST /auth/register {email,password,name}. On success
// it responds 200 with the new user and sets the session cookie (register
// implies being logged in).
// ValidEmail reports whether s is an address this platform will accept as a
// login identifier. Registration accepted anything non-empty until now, so
// "abc" was a valid account.
//
// Three deliberate limits, because over-strict email validation rejects real
// people and is a well-worn way to lose users:
//
//   - `mail.ParseAddress` (RFC 5322) does the parsing. Hand-rolled regexes for
//     this are famously wrong in both directions.
//   - `addr.Address != s` rejects the display-name form: ParseAddress happily
//     accepts `Duy <a@b.co>`, and storing that as the identifier would mean
//     the account's email is not what the user typed.
//   - The domain must contain an interior dot. `a@b` is legal RFC-wise
//     (intranet hosts) but is a typo on a public site, not a mailbox. This is
//     the one rule that trades a little correctness for a lot of typo
//     catching, and it is the only one worth revisiting if someone is ever
//     wrongly refused.
//
// Deliberately NOT checked: length caps, disposable-domain lists, MX lookups.
// The first two refuse valid people; the third turns signup into a network
// call that fails when someone else's DNS is unwell.
func ValidEmail(s string) bool {
	addr, err := mail.ParseAddress(s)
	if err != nil || addr.Address != s {
		return false
	}
	at := strings.LastIndex(s, "@")
	if at < 1 {
		return false
	}
	domain := s[at+1:]
	dot := strings.Index(domain, ".")
	return dot > 0 && dot < len(domain)-1
}

func (h *Handler) Register(c *fiber.Ctx) error {
	var req registerRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	req.Email = strings.TrimSpace(req.Email)

	if req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "email and password are required"})
	}
	if !ValidEmail(req.Email) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "email is not a valid address"})
	}

	user, session, err := h.uc.Register(c.Context(), req.Email, req.Password, req.Name)
	if err != nil {
		if errors.Is(err, ErrEmailTaken) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "email already registered"})
		}
		// Deliberately no err.Error() in the RESPONSE: it could leak
		// internal detail (and must never leak a password/hash — see
		// Usecase.Register, which never returns one to us anyway). The
		// cause is logged server-side instead — see apilog's own doc
		// comment for why both halves are mandatory.
		apilog.Internal(c, "auth.Register", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "registration failed"})
	}

	h.setSessionCookie(c, session)
	return c.Status(fiber.StatusOK).JSON(toMeResponse(user))
}

// Login handles POST /auth/login {email,password}. On success it
// responds 200 with the user and sets a new session cookie, alongside
// whatever sessions the account already has from other devices.
func (h *Handler) Login(c *fiber.Ctx) error {
	var req loginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	req.Email = strings.TrimSpace(req.Email)

	user, session, err := h.uc.Login(c.Context(), req.Email, req.Password)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			// Same status and same body whether the email doesn't exist
			// or the password is wrong — see Usecase.Login.
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "invalid email or password"})
		}
		apilog.Internal(c, "auth.Login", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "login failed"})
	}

	h.setSessionCookie(c, session)
	return c.Status(fiber.StatusOK).JSON(toMeResponse(user))
}

// Logout handles POST /auth/logout. It deletes the session row named by
// the cookie (if any) and clears the cookie. A missing, malformed, or
// already-invalid cookie is not an error — the end state the client
// wants (logged out) is already true — so this always responds 200.
func (h *Handler) Logout(c *fiber.Ctx) error {
	if raw := c.Cookies(CookieName); raw != "" {
		if sessionID, err := uuid.Parse(raw); err == nil {
			if err := h.uc.Logout(c.Context(), sessionID); err != nil {
				apilog.Internal(c, "auth.Logout", err)
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "logout failed"})
			}
		}
	}

	h.clearSessionCookie(c)
	return c.SendStatus(fiber.StatusOK)
}

// Me handles GET /me. It is mounted behind Require, so UID(c) is always
// populated by the time this runs.
func (h *Handler) Me(c *fiber.Ctx) error {
	user, err := h.uc.GetUser(c.Context(), UID(c))
	if err != nil {
		apilog.Internal(c, "auth.Me", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to load user"})
	}
	return c.Status(fiber.StatusOK).JSON(toMeResponse(user))
}

// setSessionCookie sets the tuhoc_session cookie from a freshly issued
// Session. Expires is s.ExpiresAt — the exact same value just written to
// sessions.expires_at (see Repo.CreateSession) — so the cookie and the DB
// row can never disagree about when the session dies. The cookie carries
// only the (unguessable, random) session id: no user id, no expiry
// encoded in the value itself, nothing an attacker could decode.
func (h *Handler) setSessionCookie(c *fiber.Ctx, s Session) {
	c.Cookie(&fiber.Cookie{
		Name:     CookieName,
		Value:    s.ID.String(),
		Path:     "/",
		Expires:  s.ExpiresAt,
		HTTPOnly: true,
		Secure:   h.cookieSecure,
		SameSite: fiber.CookieSameSiteLaxMode,
	})
}

// clearSessionCookie expires the cookie immediately. Its HttpOnly/Secure/
// SameSite attributes must match setSessionCookie's, or some browsers
// will treat this as setting a different cookie rather than clearing the
// existing one.
func (h *Handler) clearSessionCookie(c *fiber.Ctx) {
	c.Cookie(&fiber.Cookie{
		Name:     CookieName,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		HTTPOnly: true,
		Secure:   h.cookieSecure,
		SameSite: fiber.CookieSameSiteLaxMode,
	})
}

// Require is the middleware Tasks 7 and 8 mount every one of their
// routes behind, and the one GET /me is mounted behind here. It reads
// the tuhoc_session cookie, validates that the session exists and has
// not expired, and stores the owning user's id in c.Locals — read it
// back with UID, never the raw "uid" key.
//
// It distinguishes two failure modes, and never calls the next handler
// on either:
//   - no cookie, a malformed value, or a session that is genuinely
//     unknown/expired (ErrNotFound from ValidateSession) — these are all
//     "not authenticated" and get an identical 401, on purpose (see
//     ErrNotFound's own doc comment: expired and nonexistent must not be
//     distinguishable to the caller either).
//   - any other error — a real failure (e.g. the database is
//     unreachable) surfacing from ValidateSession — gets a 500 with a
//     fixed, generic body (never err.Error()). Collapsing this into 401
//     too would make a database outage indistinguishable from "every
//     session expired," which is a worse, misleading signal for anyone
//     consuming this API (including the web client built in Task 9+, and
//     anyone operating the service). Failing closed (never calling
//     c.Next()) and reporting an accurate status code are orthogonal —
//     Login and Logout in this same file already draw exactly this
//     distinction between their own expected-error and unexpected-error
//     cases.
//
// It takes the pool directly (not a pre-built Usecase) so callers like
// Task 7/8's route setup can mount it with nothing more than the
// *pgxpool.Pool they already have — matching the interface named in the
// task brief. server.New, which already builds a Usecase for the auth
// handlers, uses RequireWithUsecase instead to avoid constructing a
// second, equivalent Repo/Usecase pair over the same pool.
func Require(pool *pgxpool.Pool) fiber.Handler {
	return RequireWithUsecase(NewUsecase(NewRepo(pool)))
}

// RequireWithUsecase is Require's implementation, parameterized on an
// already-built Usecase. Require(pool) is (and must stay) the stable,
// documented entry point for callers that only have a pool; this exists
// solely so a caller that already has a Usecase in hand doesn't have to
// build a redundant one just to get the same middleware.
func RequireWithUsecase(uc *Usecase) fiber.Handler {
	return func(c *fiber.Ctx) error {
		raw := c.Cookies(CookieName)
		if raw == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthenticated"})
		}

		sessionID, err := uuid.Parse(raw)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthenticated"})
		}

		uid, err := uc.ValidateSession(c.Context(), sessionID)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthenticated"})
			}
			// A real failure, not "no such session" — see the doc
			// comment above for why this must not also come back as 401.
			apilog.Internal(c, "auth.Require", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "session validation failed"})
		}

		c.Locals(localsUIDKey, uid)
		return c.Next()
	}
}

// UID returns the authenticated user's id, as stored by Require. Call it
// only from a route mounted behind Require: outside one, no value was
// ever stored and UID returns uuid.Nil.
func UID(c *fiber.Ctx) uuid.UUID {
	id, _ := c.Locals(localsUIDKey).(uuid.UUID)
	return id
}

// RequireAdmin is Task 8's admin gate. It MUST be mounted AFTER Require
// (or after any middleware that populates the same "uid" local Require
// does — see server.go's adminOrToken, whose token-authenticated path
// skips both middlewares entirely and never reaches this one): it reads
// UID(c), which is uuid.Nil and belongs to no one if Require never ran, and
// a lookup for uuid.Nil simply finds no such user and is refused the same
// as any other non-admin — never a special-cased bypass.
//
// A session that is valid but not an admin's gets 403, never 401: the
// session itself authenticated correctly (Require already said so), it is
// this specific account that is not allowed past this point. Collapsing
// that into 401 would make "wrong account" indistinguishable from "no
// account at all", which is the same distinction Require's own doc
// comment draws between "not authenticated" and a real failure — the two
// gates protect different facts and must not blur into one status code.
func RequireAdmin(pool *pgxpool.Pool) fiber.Handler {
	return RequireAdminWithUsecase(NewUsecase(NewRepo(pool)))
}

// RequireAdminWithUsecase is RequireAdmin's implementation, parameterized
// on an already-built Usecase — the same reason RequireWithUsecase exists
// beside Require: a caller that already holds a Usecase over this pool
// (server.go's own authUsecase) should not have to build a second,
// equivalent Repo/Usecase pair just to reuse this middleware.
func RequireAdminWithUsecase(uc *Usecase) fiber.Handler {
	return func(c *fiber.Ctx) error {
		isAdmin, err := uc.IsAdmin(c.Context(), UID(c))
		if err != nil {
			apilog.Internal(c, "auth.RequireAdmin", err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "role check failed"})
		}
		if !isAdmin {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "admin access required"})
		}
		return c.Next()
	}
}

// OptionalAdmin resolves the session cookie IF there is one and records
// whether it belongs to an admin, then always calls Next. It is the gate for
// routes that are public but show MORE to an admin — the published catalog,
// where a private course is invisible to everyone else.
//
// It is not Require with the rejection removed. Three differences matter:
//
//  1. **No cookie is not an error.** Anonymous is the ordinary case on these
//     routes; the whole point is that they answer without an account.
//  2. **It fails CLOSED.** A malformed cookie, a dead session, or a database
//     error while checking the role all land on "not an admin". The tempting
//     alternative — surface the error as a 500 — turns a transient database
//     hiccup into an outage of the public catalog, and the tempting other
//     alternative, treating an error as "probably fine", would hand a private
//     course to whoever triggered the error. Only a positive, checked answer
//     opens the door.
//  3. **It stores a bool, not a uid.** See localsIsAdminKey.
//
// Errors are logged rather than swallowed silently: a burst of them means the
// database is unwell, and that should be visible even though no request
// failed because of it.
func OptionalAdmin(pool *pgxpool.Pool) fiber.Handler {
	return OptionalAdminWithUsecase(NewUsecase(NewRepo(pool)))
}

// OptionalAdminWithUsecase is OptionalAdmin's implementation, parameterized
// on an already-built Usecase — same reason RequireWithUsecase exists.
func OptionalAdminWithUsecase(uc *Usecase) fiber.Handler {
	return func(c *fiber.Ctx) error {
		raw := c.Cookies(CookieName)
		if raw == "" {
			return c.Next()
		}
		sessionID, err := uuid.Parse(raw)
		if err != nil {
			return c.Next()
		}
		uid, err := uc.ValidateSession(c.Context(), sessionID)
		if err != nil {
			if !errors.Is(err, ErrNotFound) {
				apilog.Internal(c, "auth.OptionalAdmin.session", err)
			}
			return c.Next()
		}
		isAdmin, err := uc.IsAdmin(c.Context(), uid)
		if err != nil {
			apilog.Internal(c, "auth.OptionalAdmin.role", err)
			return c.Next()
		}
		c.Locals(localsUIDKey, uid)
		c.Locals(localsIsAdminKey, isAdmin)
		return c.Next()
	}
}

// IsAdmin reports whether OptionalAdmin identified this request as an
// admin's. False for every request that did not pass through OptionalAdmin,
// which is the safe direction: a caller that forgets the middleware sees a
// public-only catalog, not a leak.
func IsAdmin(c *fiber.Ctx) bool {
	ok, _ := c.Locals(localsIsAdminKey).(bool)
	return ok
}

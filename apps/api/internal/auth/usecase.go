package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/alexedwards/argon2id"
	"github.com/google/uuid"
)

// SessionTTL is the lifetime of a session from the moment it is created.
// Both the sessions.expires_at row (via CreateSession) and the session
// cookie's Expires attribute (set by handler.go from the Session this
// package returns) are derived from the same time.Now().Add(SessionTTL)
// call, so they can never drift apart.
const SessionTTL = 30 * 24 * time.Hour

// ErrInvalidCredentials is returned by Login for both "no such user" and
// "wrong password". Using one error (and, in handler.go, one response
// body) for both cases is deliberate: a caller must not be able to use
// the response to enumerate which emails are registered.
var ErrInvalidCredentials = errors.New("auth: invalid email or password")

// dummyHash is a precomputed argon2id hash (of a fixed, unused password)
// that Login compares against when the looked-up email does not exist.
// Without this, ComparePasswordAndHash would simply be skipped for
// unknown emails, and the resulting Login would return noticeably faster
// for "email not registered" than for "email registered, wrong password"
// — a timing side channel that lets an attacker enumerate registered
// emails. Comparing against dummyHash keeps the CPU cost (one argon2id
// verification) the same on both paths. It is computed once at package
// init with the library's own DefaultParams, matching the cost of a real
// verification.
var dummyHash = mustDummyHash()

func mustDummyHash() string {
	// The password value here is never checked against anything and never
	// displayed; it only exists to give CreateHash something to hash.
	h, err := argon2id.CreateHash("tuhoc-timing-mitigation-unused", argon2id.DefaultParams)
	if err != nil {
		panic(fmt.Sprintf("auth: precompute dummy hash: %v", err))
	}
	return h
}

// Usecase holds auth's business rules: password hashing, session
// issuance/expiry, and the anti-enumeration behavior of Login. It talks
// to Postgres only through Repo, never directly.
type Usecase struct {
	repo *Repo
}

// NewUsecase builds a Usecase over repo.
func NewUsecase(repo *Repo) *Usecase {
	return &Usecase{repo: repo}
}

// Register hashes password with argon2id (library defaults), creates the
// user row, and immediately issues a session for it (register implies
// being logged in — the brief's contract is 200 + set-cookie).
func (uc *Usecase) Register(ctx context.Context, email, password, name string) (User, Session, error) {
	hash, err := argon2id.CreateHash(password, argon2id.DefaultParams)
	if err != nil {
		return User{}, Session{}, fmt.Errorf("auth: hash password: %w", err)
	}

	user, err := uc.repo.CreateUser(ctx, email, name, hash)
	if err != nil {
		// ErrEmailTaken is returned as-is (not wrapped further) so
		// handler.go can errors.Is against it directly; any other repo
		// error is already wrapped by repo.go.
		return User{}, Session{}, err
	}

	session, err := uc.repo.CreateSession(ctx, user.ID, time.Now().Add(SessionTTL))
	if err != nil {
		return User{}, Session{}, err
	}

	return user, session, nil
}

// Login verifies email+password and, on success, issues a new session —
// on top of any sessions that already exist for the user. A second login
// from another device deliberately does not revoke the first: Register
// and Login sessions are independent rows, so signing in on a phone
// while already signed in on a laptop keeps both working, matching how
// the rest of the platform (progress/annotation sync across devices) is
// expected to behave. Logout only ever removes the one session named by
// its cookie.
//
// On failure it always returns ErrInvalidCredentials, regardless of
// whether the email doesn't exist or the password is wrong — see
// dummyHash's comment for why both paths also cost the same CPU time.
func (uc *Usecase) Login(ctx context.Context, email, password string) (User, Session, error) {
	user, err := uc.repo.FindUserByEmail(ctx, email)
	found := err == nil
	if err != nil && !errors.Is(err, ErrNotFound) {
		return User{}, Session{}, err
	}

	hashToCompare := dummyHash
	if found {
		hashToCompare = user.PwHash
	}

	// Always run the comparison, even when the account doesn't exist, so
	// this call's latency does not depend on whether email is registered.
	match, cmpErr := argon2id.ComparePasswordAndHash(password, hashToCompare)
	if cmpErr != nil {
		return User{}, Session{}, fmt.Errorf("auth: compare password: %w", cmpErr)
	}

	if !found || !match {
		return User{}, Session{}, ErrInvalidCredentials
	}

	session, err := uc.repo.CreateSession(ctx, user.ID, time.Now().Add(SessionTTL))
	if err != nil {
		return User{}, Session{}, err
	}

	return user, session, nil
}

// Logout deletes sessionID's row. Deleting a session id that is already
// gone (or was never valid) is not an error — see repo.go's
// DeleteSession — so Logout is idempotent and safe to call with a stale
// cookie.
func (uc *Usecase) Logout(ctx context.Context, sessionID uuid.UUID) error {
	return uc.repo.DeleteSession(ctx, sessionID)
}

// ValidateSession is what Require calls on every request to a protected
// route: it returns the owning user's id if sessionID names a session
// that exists and has not expired, and ErrNotFound otherwise (expired
// and nonexistent are indistinguishable to the caller, by construction
// of FindValidSession's query).
func (uc *Usecase) ValidateSession(ctx context.Context, sessionID uuid.UUID) (uuid.UUID, error) {
	s, err := uc.repo.FindValidSession(ctx, sessionID)
	if err != nil {
		return uuid.Nil, err
	}
	return s.UserID, nil
}

// GetUser loads a user by id, for GET /me. It is a thin pass-through
// today, but lives in the usecase layer (not called directly from
// handler.go against repo) so any future business rule about what /me
// exposes has a natural home.
func (uc *Usecase) GetUser(ctx context.Context, id uuid.UUID) (User, error) {
	return uc.repo.FindUserByID(ctx, id)
}

// IsAdmin is what RequireAdmin gates on: id names a user whose role is
// exactly "admin". A user row that has been deleted out from under a still
// -valid session (ErrNotFound) is reported as "not admin" rather than
// propagated as an error — the caller gets a definite yes/no rather than
// a third state to invent a policy for, and "the account is gone" is never
// a reason to grant an elevated permission.
func (uc *Usecase) IsAdmin(ctx context.Context, id uuid.UUID) (bool, error) {
	role, err := uc.repo.FindRole(ctx, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return false, nil
		}
		return false, err
	}
	return role == "admin", nil
}

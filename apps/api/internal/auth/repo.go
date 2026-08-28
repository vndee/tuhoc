// Package auth implements registration, login, logout, session
// validation, and the Require middleware every later authenticated route
// (Tasks 7's /sync, /events/batch and Task 8's /stats) mounts behind. The
// package is split by concern: this file (repo.go) is the only one that
// speaks SQL — usecase.go holds business rules (hashing, session
// lifetime, the anti-enumeration timing fix) and handler.go holds HTTP
// concerns (request/response shapes, cookies, status codes).
package auth

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/ai"
)

// User is the subset of the users row auth exposes to its own usecase and
// handler layers. PwHash is included because Login needs it to verify a
// password — handler.go must never put it in a response.
//
// Role is included for the same reason meResponse now carries it (Task 8):
// the web admin CMS (a later task) needs to know whether the signed-in
// account can reach the admin routes at all before it tries, and
// RequireAdmin needs the same column to enforce it server-side. It is one
// of "user"/"admin" (users.role's own CHECK constraint), never read as
// anything more privileged than what the database says.
type User struct {
	ID     uuid.UUID
	Email  string
	Name   string
	Role   string
	PwHash string
}

// Session is the subset of the sessions row auth needs to issue and
// validate the session cookie.
type Session struct {
	ID        uuid.UUID
	UserID    uuid.UUID
	ExpiresAt time.Time
}

// ErrEmailTaken is returned by CreateUserWithSignupCredit when the email
// already exists. users.email is citext (case-insensitive) and UNIQUE, so
// this also covers a collision that only differs by case.
var ErrEmailTaken = errors.New("auth: email already registered")

// ErrNotFound is returned by lookups that find no matching row — used for
// both "no such user" and "no such (unexpired) session", so callers that
// must not distinguish those cases (see usecase.go's Login and
// ValidateSession) get a single error to branch on.
var ErrNotFound = errors.New("auth: not found")

// Repo is the SQL-backed persistence layer for auth. It holds no business
// rules — every method is a direct, single-purpose query.
type Repo struct {
	pool *pgxpool.Pool
}

// NewRepo builds a Repo over pool. pool may be nil in tests that never
// exercise a method that reaches the database (constructing a Repo does
// not itself touch it).
func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

// CreateUserWithSignupCredit inserts a new user row with an
// already-hashed password AND grants the signup credit (ai.Service.
// GrantSignupCredit, spec §3.4) in ONE transaction. Hashing is the
// usecase's job, not the repo's — this method only ever sees pwHash,
// never a plaintext password.
//
// Before this method existed (task 9), the user row and the credit grant
// would have been two separate statements — exactly the failure shape
// internal/ai/credits.go's own package comment warns ChargeTurn's
// deduct-plus-ledger pair against: a process death, or a later statement
// failing, between the two lands only one side. Here the two directions
// that split could go wrong:
//
//   - the user row commits but the grant fails afterward: a real,
//     permanent account that can log in and use every other route, but
//     whose ai_credits row never lands and never will — nothing retries a
//     signup grant after the fact, so EnsureCredit (credits.go) would
//     treat this account as insufficient forever, not "new".
//   - a credit row surviving a rolled-back user insert cannot happen even
//     without this fix — ai_credits.user_id is a foreign key to
//     users(id), so Postgres refuses that INSERT on its own — but the
//     FIRST direction above is exactly the "credit mồ côi" this method
//     exists to close, and wrapping both inserts in one transaction is
//     what closes it: if the grant fails, Postgres rolls the user row
//     back too, and the failed registration leaves nothing behind for
//     that email to retry against.
//
// It builds its own ai.Service over r.pool rather than taking one as a
// parameter: GrantSignupCredit never reads that Service's pool field (it
// runs entirely against the tx passed to it), so threading an *ai.Service
// through NewUsecase/Require/RequireAdmin — none of which have any other
// use for one — would only add a parameter nothing else in this package
// needs.
func (r *Repo) CreateUserWithSignupCredit(ctx context.Context, email, name, pwHash string) (User, int64, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return User{}, 0, fmt.Errorf("auth: create user: begin tx: %w", err)
	}
	// Rollback after a successful Commit is a documented pgx no-op
	// (mirrors internal/ai/credits.go's ChargeTurn) — this defer is the
	// safety net for every OTHER return path below, including a panic
	// unwinding through this function.
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var u User
	err = tx.QueryRow(ctx,
		`INSERT INTO users (email, name, pw_hash) VALUES ($1, $2, $3)
		 RETURNING id, email, name, role, pw_hash`,
		email, name, pwHash,
	).Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.PwHash)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgerrcode.UniqueViolation {
			return User{}, 0, ErrEmailTaken
		}
		return User{}, 0, fmt.Errorf("auth: create user: %w", err)
	}

	grantMicro, err := ai.NewService(r.pool).GrantSignupCredit(ctx, tx, u.ID)
	if err != nil {
		return User{}, 0, fmt.Errorf("auth: create user: grant signup credit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return User{}, 0, fmt.Errorf("auth: create user: commit: %w", err)
	}
	return u, grantMicro, nil
}

// FindUserByEmail looks up a user by email (case-insensitive, via
// citext). Returns ErrNotFound if no such user exists.
func (r *Repo) FindUserByEmail(ctx context.Context, email string) (User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`SELECT id, email, name, role, pw_hash FROM users WHERE email = $1`,
		email,
	).Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.PwHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return User{}, ErrNotFound
		}
		return User{}, fmt.Errorf("auth: find user by email: %w", err)
	}
	return u, nil
}

// FindUserByID looks up a user by id, for GET /me. Returns ErrNotFound if
// no such user exists (e.g. deleted between session validation and this
// call — an edge case, not the common path).
func (r *Repo) FindUserByID(ctx context.Context, id uuid.UUID) (User, error) {
	var u User
	err := r.pool.QueryRow(ctx,
		`SELECT id, email, name, role, pw_hash FROM users WHERE id = $1`,
		id,
	).Scan(&u.ID, &u.Email, &u.Name, &u.Role, &u.PwHash)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return User{}, ErrNotFound
		}
		return User{}, fmt.Errorf("auth: find user by id: %w", err)
	}
	return u, nil
}

// FindRole returns just users.role for id, without paying for pw_hash or
// name — the one column RequireAdmin actually needs on every gated
// request. ErrNotFound covers a session whose user row was deleted between
// Require validating the session and this call (the same edge case
// FindUserByID's own doc comment names for GET /me).
func (r *Repo) FindRole(ctx context.Context, id uuid.UUID) (string, error) {
	var role string
	err := r.pool.QueryRow(ctx, `SELECT role FROM users WHERE id = $1`, id).Scan(&role)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("auth: find role: %w", err)
	}
	return role, nil
}

// CreateSession inserts a new session row. expiresAt is computed by the
// caller (usecase.go) so the exact same value can be used for the
// session cookie's Expires attribute — the two must never disagree.
// sessions.id defaults to gen_random_uuid() (pgcrypto), a
// cryptographically random v4 UUID, so the returned session id is
// unguessable and is the only thing the cookie will carry.
func (r *Repo) CreateSession(ctx context.Context, userID uuid.UUID, expiresAt time.Time) (Session, error) {
	s := Session{UserID: userID, ExpiresAt: expiresAt}
	err := r.pool.QueryRow(ctx,
		`INSERT INTO sessions (user_id, expires_at) VALUES ($1, $2) RETURNING id`,
		userID, expiresAt,
	).Scan(&s.ID)
	if err != nil {
		return Session{}, fmt.Errorf("auth: create session: %w", err)
	}
	return s, nil
}

// FindValidSession looks up a session by id and returns it only if it has
// not expired. A missing row and an expired row both return ErrNotFound —
// Require must react identically to a stale session id as to a garbage
// one, so the query itself collapses the two cases rather than leaving
// the caller to check ExpiresAt separately (which would be easy to get
// wrong once, and this is the one check every future authenticated route
// depends on).
func (r *Repo) FindValidSession(ctx context.Context, id uuid.UUID) (Session, error) {
	var s Session
	err := r.pool.QueryRow(ctx,
		`SELECT id, user_id, expires_at FROM sessions WHERE id = $1 AND expires_at > now()`,
		id,
	).Scan(&s.ID, &s.UserID, &s.ExpiresAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Session{}, ErrNotFound
		}
		return Session{}, fmt.Errorf("auth: find valid session: %w", err)
	}
	return s, nil
}

// DeleteSession removes a session row (logout). Deleting — rather than
// e.g. marking it inactive — means a stolen/cached cookie value stops
// working the instant logout happens, with no lingering row to reason
// about. Deleting a session id that does not exist is not an error: it
// means the client is already logged out, which is the state the caller
// wanted anyway.
func (r *Repo) DeleteSession(ctx context.Context, id uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM sessions WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("auth: delete session: %w", err)
	}
	return nil
}

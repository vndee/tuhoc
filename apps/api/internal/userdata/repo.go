// Package userdata implements the REST replacement for the progress half
// of the old sync protocol: GET /progress and PUT /progress. Like sync
// (and auth before it), it is split by concern: this file (repo.go) is the
// only one that speaks SQL — usecase.go holds validation and handler.go
// holds HTTP concerns.
//
// The defining difference from internal/sync's PushBatch is who assigns
// updated_at. sync's client carries its own updated_at because a row may
// have sat in a local outbox for days before it was pushed — the client's
// timestamp is the only honest record of "when this actually happened".
// This package's caller is not local-first: there is no outbox, so
// "when" is simply "whenever the server received the write", and the
// server stamps it with now() rather than trusting a client-supplied
// value — see UpsertProgress and upsertProgressSQL below.
package userdata

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ProgressRow is the subset of a progress row this package reads and
// writes. UserID is deliberately absent — the caller already knows it
// (it's the authenticated user, from auth.UID) and it is always passed as
// a separate argument, never taken from client input.
type ProgressRow struct {
	CourseID  string
	ChapterID string
	Status    string
	Done      bool
	UpdatedAt time.Time
}

// Repo is the SQL-backed persistence layer for userdata's progress
// resource. It holds no business rules.
type Repo struct {
	pool *pgxpool.Pool
}

// NewRepo builds a Repo over pool.
func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

// upsertProgressSQL is internal/sync/repo.go's own upsertProgressSQL,
// copied rather than imported (the two packages must not import each
// other — see this package's doc comment), with exactly one change: the
// updated_at VALUES slot is now() instead of a bound parameter. Every
// other clause — the conflict target, the SET list, and the
// EXCLUDED.updated_at > progress.updated_at guard — is unchanged, so the
// guard still compares two real timestamps (this call's now() against
// whatever now() the previous call stored), it just never trusts a client
// to supply either side of that comparison.
const upsertProgressSQL = `
INSERT INTO progress (user_id,course_id,chapter_id,status,done,updated_at)
VALUES ($1,$2,$3,$4,$5,now())
ON CONFLICT (user_id,course_id,chapter_id,status) DO UPDATE
SET done=EXCLUDED.done, updated_at=EXCLUDED.updated_at
WHERE EXCLUDED.updated_at > progress.updated_at;
`

// ListProgress returns every progress row belonging to userID.
func (r *Repo) ListProgress(ctx context.Context, userID uuid.UUID) ([]ProgressRow, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT course_id, chapter_id, status, done, updated_at
		 FROM progress
		 WHERE user_id = $1
		 ORDER BY updated_at ASC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("userdata: list progress: %w", err)
	}
	defer rows.Close()

	out := []ProgressRow{}
	for rows.Next() {
		var p ProgressRow
		if err := rows.Scan(&p.CourseID, &p.ChapterID, &p.Status, &p.Done, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("userdata: scan progress row: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("userdata: list progress: %w", err)
	}
	return out, nil
}

// UpsertProgress writes one progress row for userID, stamping updated_at
// with the server's own clock (see upsertProgressSQL) rather than
// row.UpdatedAt, which is why row is accepted by value here but its
// UpdatedAt field is never read.
func (r *Repo) UpsertProgress(ctx context.Context, userID uuid.UUID, row ProgressRow) error {
	if _, err := r.pool.Exec(ctx, upsertProgressSQL,
		userID, row.CourseID, row.ChapterID, row.Status, row.Done,
	); err != nil {
		return fmt.Errorf("userdata: upsert progress (course=%s chapter=%s status=%s): %w", row.CourseID, row.ChapterID, row.Status, err)
	}
	return nil
}

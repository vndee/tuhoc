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
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5/pgconn"
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

// AnnotationRow is the subset of an annotations row this package reads and
// writes. Unlike ProgressRow, ID is present and is CLIENT-generated: a
// reader assigns a uuid the moment a learner highlights text, before the
// row has ever touched this server (see CreateAnnotation) — the server
// never invents one, only stamps CreatedAt/UpdatedAt. Anchor is carried as
// json.RawMessage end to end (HTTP body -> here -> jsonb column and back)
// without ever being unmarshaled into a Go struct — this package has no
// reason to understand its shape, exactly as internal/sync's own
// AnnotationRow does it. There is deliberately no DeletedAt field:
// migration 0009 dropped annotations.deleted_at, and this package's
// DeleteAnnotation is a real SQL DELETE, not a tombstone write.
type AnnotationRow struct {
	ID        uuid.UUID
	CourseID  string
	ChapterID string
	Anchor    json.RawMessage
	Note      string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// ErrDuplicateAnnotation is returned by CreateAnnotation when row.ID
// already names an existing row. annotations.id is the primary key and is
// client-generated (see AnnotationRow's doc comment), so a collision is a
// real scenario — a retry after a dropped response — rather than a
// programmer error. It is checked with errors.Is by handler.go to produce
// 409, never a silent overwrite: two tabs generating the same uuid must
// not let one clobber the other's note with no error at all.
var ErrDuplicateAnnotation = errors.New("userdata: annotation id already exists")

// ListAnnotations returns every annotation row belonging to userID,
// optionally filtered to one courseID. courseID == "" means "every
// course" — the reader needs one course's worth, while
// pages/Progress.tsx, progress/recent.ts and pages/Dashboard.tsx read
// across every course (see the task brief's own grep pointer). The filter
// is one SQL statement, comparing $2 against the SQL empty string with OR
// course_id = $2, rather than two branches building different query text:
// course_id is `text NOT NULL` and a real course id is never the empty
// string, so the two conditions never collide.
func (r *Repo) ListAnnotations(ctx context.Context, userID uuid.UUID, courseID string) ([]AnnotationRow, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT id, course_id, chapter_id, anchor, note, created_at, updated_at
		 FROM annotations
		 WHERE user_id = $1 AND ($2 = '' OR course_id = $2)
		 ORDER BY updated_at ASC`,
		userID, courseID,
	)
	if err != nil {
		return nil, fmt.Errorf("userdata: list annotations: %w", err)
	}
	defer rows.Close()

	out := []AnnotationRow{}
	for rows.Next() {
		var a AnnotationRow
		if err := rows.Scan(&a.ID, &a.CourseID, &a.ChapterID, &a.Anchor, &a.Note, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, fmt.Errorf("userdata: scan annotation row: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("userdata: list annotations: %w", err)
	}
	return out, nil
}

const createAnnotationSQL = `
INSERT INTO annotations (id,user_id,course_id,chapter_id,anchor,note,created_at,updated_at)
VALUES ($1,$2,$3,$4,$5,$6,now(),now());
`

// CreateAnnotation inserts row under userID's identity, stamping
// created_at and updated_at with the server's own clock — the same
// reasoning as UpsertProgress: this caller is not local-first, so "when"
// is simply "whenever the server received the write" (see this file's own
// doc comment). row.ID is trusted as given (client-generated); there is
// deliberately no ON CONFLICT clause, so a collision with an existing id
// surfaces as a real error (23505 unique_violation) that this method
// translates into ErrDuplicateAnnotation rather than silently overwriting.
func (r *Repo) CreateAnnotation(ctx context.Context, userID uuid.UUID, row AnnotationRow) error {
	_, err := r.pool.Exec(ctx, createAnnotationSQL,
		row.ID, userID, row.CourseID, row.ChapterID, row.Anchor, row.Note,
	)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgerrcode.UniqueViolation {
			return ErrDuplicateAnnotation
		}
		return fmt.Errorf("userdata: create annotation (id=%s): %w", row.ID, err)
	}
	return nil
}

const patchAnnotationSQL = `
UPDATE annotations
SET note = COALESCE($3, note), anchor = COALESCE($4, anchor), updated_at = now()
WHERE id = $1 AND user_id = $2;
`

// PatchAnnotation updates note and/or anchor on the row identified by id,
// scoped to userID, and re-stamps updated_at with the server's own clock.
// note == nil leaves the note column untouched (a present-but-empty
// *string still overwrites it with "", since only a nil pointer means
// "not provided"); anchor == nil (the zero value of json.RawMessage)
// leaves the anchor column untouched, same rule.
//
// The "AND user_id = $2" clause is what makes this owner-scoped: id alone
// is a client-generated uuid with no per-user structure to it, so nothing
// else stops a request from naming an id that belongs to someone else.
// The returned bool is exactly RowsAffected() > 0, which handler.go turns
// into 404 rather than 403 on false — a 403 would confirm to the caller
// that the id exists and belongs to someone else, a leak against a
// guessable id.
func (r *Repo) PatchAnnotation(ctx context.Context, userID, id uuid.UUID, note *string, anchor json.RawMessage) (bool, error) {
	tag, err := r.pool.Exec(ctx, patchAnnotationSQL, id, userID, note, anchor)
	if err != nil {
		return false, fmt.Errorf("userdata: patch annotation (id=%s): %w", id, err)
	}
	return tag.RowsAffected() > 0, nil
}

const deleteAnnotationSQL = `DELETE FROM annotations WHERE id = $1 AND user_id = $2;`

// DeleteAnnotation hard-deletes the row identified by id, scoped to
// userID — same ownership reasoning and 404-not-403 return contract as
// PatchAnnotation. This is a REAL delete: migration 0009 dropped
// annotations.deleted_at, so there is no tombstone column left for this
// package to write even if it wanted one.
func (r *Repo) DeleteAnnotation(ctx context.Context, userID, id uuid.UUID) (bool, error) {
	tag, err := r.pool.Exec(ctx, deleteAnnotationSQL, id, userID)
	if err != nil {
		return false, fmt.Errorf("userdata: delete annotation (id=%s): %w", id, err)
	}
	return tag.RowsAffected() > 0, nil
}

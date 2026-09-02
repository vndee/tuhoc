// Package sync implements POST /sync — the one route this package has
// left — and the last-write-wins (LWW) conflict rule it applies. It used
// to implement GET /sync too; Pha 3 Task 3 deleted that route, along with
// this package's cursor machinery, because the browser stopped polling it
// (see handler.go's package note for why this package still exists at
// all, and the schedule for when it won't). Like auth, it is split by
// concern: this file (repo.go) is the only one that speaks SQL — usecase.go
// holds validation/orchestration and handler.go holds HTTP concerns.
//
// Naming note: this package's own name ("sync") intentionally matches its
// directory, per the task brief and this repo's existing convention (see
// internal/auth). That collides, by name only, with the standard library's
// "sync" package (sync.Mutex etc.) — a file that needs both would have two
// things trying to claim the bare identifier "sync". This package itself
// never needs stdlib sync (pgxpool.Pool is already safe for concurrent
// use), so there is no collision inside this package's own files. Every
// external importer of this package (internal/server/server.go) imports it
// under the explicit alias "appsync" specifically so a future stdlib
// "sync" import in that file (e.g. for a WaitGroup) can never collide with
// it silently — see server.go's import block.
package sync

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ProgressRow is the subset of a progress row this package writes via
// PushBatch (it used to also carry Pull's read results — see repo.go's
// package note; that reader is gone now). UserID is deliberately absent
// from the struct itself: PushBatch takes it as a separate argument, never
// taken from client input — see that method.
type ProgressRow struct {
	CourseID  string
	ChapterID string
	Status    string
	Done      bool
	UpdatedAt time.Time
}

// AnnotationRow is the subset of an annotations row this package writes
// via PushBatch (it used to also carry Pull's read results — see repo.go's
// package note; that reader is gone now). Anchor is carried as
// json.RawMessage end to end (HTTP body -> here -> jsonb column) without
// ever being unmarshaled into a Go struct, since this package has no
// reason to understand its shape.
//
// DeletedAt's meaning changed under Pha 3 Task 2 (migration 0009 dropped
// annotations.deleted_at — see internal/userdata, the REST replacement
// this column's removal was actually for). It used to be a literal
// tombstone column value round-tripped end to end (written by PushBatch,
// read back by PullAnnotations); now — with PullAnnotations deleted
// alongside the rest of GET /sync (Pha 3 Task 3) — it exists ONLY on the
// way IN, as what handler.go's Push parses out of an incoming batch item.
// A non-nil DeletedAt on an item PushBatch receives means "the client says
// this row is deleted" and is translated into a real SQL DELETE (see
// deleteAnnotationSQL below) rather than written anywhere — there is no
// column left to write it to, and no pull path left to read it back out
// of either way.
type AnnotationRow struct {
	ID        uuid.UUID
	CourseID  string
	ChapterID string
	Anchor    json.RawMessage
	Note      string
	CreatedAt time.Time
	UpdatedAt time.Time
	DeletedAt *time.Time
}

// Repo is the SQL-backed persistence layer for sync. It holds no business
// rules — every method is a direct, single-purpose query, and PushBatch's
// two upserts were originally copied verbatim from the task brief
// (byte-for-byte, including the ON CONFLICT ... WHERE guards) rather than
// reconstructed, since that SQL *is* the conflict-resolution rule that
// task existed to implement. upsertAnnotationSQL no longer mentions
// deleted_at (Pha 3 Task 2's migration 0009 dropped the column), and
// PushBatch now routes a deleted item to deleteAnnotationSQL instead — see
// both consts' own doc comments below for the full reasoning.
type Repo struct {
	pool *pgxpool.Pool
}

// NewRepo builds a Repo over pool.
func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

// upsertProgressSQL is verbatim from the task brief. The conflict target
// (user_id, course_id, chapter_id, status) is progress's actual primary
// key, and critically includes user_id: a row can only ever conflict with
// another row that already belongs to the same user, because user_id is
// part of the identity Postgres uses to detect the conflict in the first
// place. There is no way for user A's push to collide with user B's
// progress row — not because of a WHERE clause (there isn't one here, unlike
// the annotations upsert below), but because the primary key itself makes
// such a collision impossible: (A, courseX, chapterY, statusZ) and
// (B, courseX, chapterY, statusZ) are simply different keys. Combined with
// userID always coming from auth.UID (never client input — see
// usecase.go's Push), this is what makes progress writes user-isolated.
const upsertProgressSQL = `
INSERT INTO progress (user_id,course_id,chapter_id,status,done,updated_at)
VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT (user_id,course_id,chapter_id,status) DO UPDATE
SET done=EXCLUDED.done, updated_at=EXCLUDED.updated_at
WHERE EXCLUDED.updated_at > progress.updated_at;
`

// upsertAnnotationSQL was originally verbatim from the task brief; Pha 3
// Task 2's migration 0009 dropped annotations.deleted_at, so the
// deleted_at column and its EXCLUDED.deleted_at slot are gone from both
// the column list and the SET clause — everything else, including the
// WHERE guard below, is unchanged. PushBatch only ever runs this
// statement for an item whose DeletedAt is nil; one that carries a
// DeletedAt is routed to deleteAnnotationSQL instead (see PushBatch).
//
// Unlike progress, annotations conflict on id alone — id is a
// client-generated uuid, not scoped to a user in the primary key — so
// nothing at the schema level stops a request from naming an id that
// already belongs to another user. The "AND annotations.user_id =
// EXCLUDED.user_id" clause is what closes that hole: EXCLUDED.user_id is
// always the authenticated caller's own id (see usecase.go's Push), so if
// the existing row's owner differs, the WHERE fails, zero rows are
// affected, and the request silently no-ops instead of overwriting (or
// revealing the existence of) another user's annotation.
const upsertAnnotationSQL = `
INSERT INTO annotations (id,user_id,course_id,chapter_id,anchor,note,created_at,updated_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
ON CONFLICT (id) DO UPDATE
SET anchor=EXCLUDED.anchor, note=EXCLUDED.note,
    updated_at=EXCLUDED.updated_at
WHERE EXCLUDED.updated_at > annotations.updated_at
  AND annotations.user_id = EXCLUDED.user_id;
`

// deleteAnnotationSQL is PushBatch's translation of an incoming tombstone
// (an item whose DeletedAt != nil) now that annotations.deleted_at is
// gone (migration 0009): rather than writing a marker column, the row is
// hard-deleted for real.
//
// "id = $1 AND user_id = $2" is owner-scoped for the same reason
// upsertAnnotationSQL's WHERE clause is: id alone carries no per-user
// structure, so nothing else stops a request from naming another user's
// annotation id.
//
// "$3 > updated_at" ($3 is the incoming item's UpdatedAt) is the same LWW
// guard upsertAnnotationSQL applies, translated to a DELETE: a delete
// queued on a device before a newer edit committed elsewhere (on another
// device, or through internal/userdata's own PATCH /annotations/:id) must
// not be able to win and erase that edit just because it happens to be
// pushed later. Symmetrically, if the row was never pushed to the server
// in the first place — created and deleted offline before ever syncing —
// this simply matches zero rows: there is nothing to resurrect, because
// there was never anything here for anyone to see.
const deleteAnnotationSQL = `
DELETE FROM annotations
WHERE id = $1 AND user_id = $2 AND $3 > updated_at;
`

// PushBatch applies every progress and annotation item in one transaction:
// either the whole batch commits or none of it does, so a client's outbox
// never has to reason about a request that partially applied. It returns
// the number of items that were actually written — an insert always
// counts (nothing to conflict with yet), but an update only counts when
// the ON CONFLICT ... WHERE guard's timestamp comparison passed; an item
// that lost the LWW comparison (or, for annotations, named another user's
// id) affects zero rows and is not counted. That also makes retrying an
// identical batch safe: replaying a batch whose rows are already the
// current, stored versions re-evaluates EXCLUDED.updated_at > <table>.updated_at
// as false (equal, not greater) for every item, so nothing is rewritten
// and the returned count drops to 0 on the replay — the caller can tell a
// genuine write from a no-op retry, but either way the stored data ends up
// identical.
//
// An annotation item whose DeletedAt != nil is routed to
// deleteAnnotationSQL instead of upsertAnnotationSQL — a real hard delete,
// since migration 0009 dropped annotations.deleted_at and there is no
// tombstone column left to upsert into. This is the one caller left that
// still needs to accept a client-supplied deletedAt at all: a browser
// upgrading off the old local-first outbox (apps/web's IndexedDB queue)
// flushes it through POST /sync exactly once, and a queued item in that
// flush can legitimately carry deletedAt != null — meaning "the learner
// deleted this note" — which this method must not drop on the floor
// (that would resurrect a note the learner deleted). Every OTHER counted
// write in this function is a fresh insert or a genuine LWW-guarded
// update; a delete is counted by the exact same rule
// (tag.RowsAffected() summed below), via deleteAnnotationSQL's own LWW
// guard (see that const's doc comment) rather than
// upsertAnnotationSQL's.
func (r *Repo) PushBatch(ctx context.Context, userID uuid.UUID, progress []ProgressRow, annotations []AnnotationRow) (int, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("sync: begin push transaction: %w", err)
	}
	// Rollback is a no-op once Commit has succeeded (pgx tracks tx state
	// and returns pgx.ErrTxClosed, which we deliberately ignore here); this
	// defer only matters on an early return, where it guarantees the
	// transaction never sits open holding whatever partial work happened
	// before the error.
	defer func() { _ = tx.Rollback(ctx) }()

	applied := 0
	for _, p := range progress {
		tag, err := tx.Exec(ctx, upsertProgressSQL,
			userID, p.CourseID, p.ChapterID, p.Status, p.Done, p.UpdatedAt)
		if err != nil {
			return 0, fmt.Errorf("sync: upsert progress (course=%s chapter=%s status=%s): %w", p.CourseID, p.ChapterID, p.Status, err)
		}
		applied += int(tag.RowsAffected())
	}

	for _, a := range annotations {
		var (
			tag pgconn.CommandTag
			err error
		)
		if a.DeletedAt != nil {
			tag, err = tx.Exec(ctx, deleteAnnotationSQL, a.ID, userID, a.UpdatedAt)
		} else {
			tag, err = tx.Exec(ctx, upsertAnnotationSQL,
				a.ID, userID, a.CourseID, a.ChapterID, a.Anchor, a.Note, a.CreatedAt, a.UpdatedAt)
		}
		if err != nil {
			return 0, fmt.Errorf("sync: apply annotation (id=%s): %w", a.ID, err)
		}
		applied += int(tag.RowsAffected())
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("sync: commit push transaction: %w", err)
	}
	return applied, nil
}

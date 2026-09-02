package sync

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ErrInvalidBatch is returned by Push when a batch item is missing a
// required field. It is checked with errors.Is by handler.go to produce a
// 400 (client's malformed request) rather than the 500 a genuine repo/DB
// failure gets.
var ErrInvalidBatch = errors.New("sync: invalid batch item")

// Usecase holds sync's business rules: batch validation for Push. It talks
// to Postgres only through Repo, never directly.
//
// Before Pha 3 Task 3 cut GET /sync (see handler.go's package note), this
// type also held Pull's cursor computation and the SyncSafetyLag constant
// it was built on — a commit-ordering race in the pull cursor that no
// longer exists because there is no cursor left to compute. That machinery
// is gone along with Pull itself, not adapted; if a future change ever
// needs a safety-lagged watermark again, TestSyncFlows/a_late-committing_row...
// in sync_test.go's git history (removed by this same commit) documents
// the race and its fix in full.
type Usecase struct {
	repo *Repo
}

// NewUsecase builds a Usecase over repo.
func NewUsecase(repo *Repo) *Usecase {
	return &Usecase{repo: repo}
}

// Push validates and applies one batch under userID's identity. userID
// comes from auth.UID (the handler's job to supply, from the authenticated
// session) — it is never taken from the request body, which is exactly
// what makes the user-isolation argument in repo.go's SQL comments hold:
// EXCLUDED.user_id in both upserts is always this value.
//
// Validation happens before anything touches the database, so a malformed
// item anywhere in the batch rejects the whole request with zero side
// effects — a client can't end up in a state where "some of my batch
// applied, some didn't" because of a typo in one item; either every item
// was well-formed and PushBatch's single transaction ran, or nothing did.
//
// Clock clamping: each item's UpdatedAt is stored as
// min(clientUpdatedAt, now) — see clampFuture. FUTURE timestamps only;
// past-dated ones are stored exactly as sent, because that is what makes
// offline editing work at all (see clampFuture's own doc comment).
//
// Note that this mutates the caller's slices in place rather than copying
// them. That is intentional and safe here: handler.go builds both slices
// fresh, per request, from the parsed body and hands them straight to this
// method — there is no other holder of them to surprise. Copying two
// slices per request to avoid a side effect nobody can observe would be
// pure ceremony.
func (uc *Usecase) Push(ctx context.Context, userID uuid.UUID, progress []ProgressRow, annotations []AnnotationRow) (int, error) {
	for _, p := range progress {
		if p.CourseID == "" || p.ChapterID == "" || p.Status == "" || p.UpdatedAt.IsZero() {
			return 0, fmt.Errorf("%w: progress item (course=%q chapter=%q status=%q) missing a required field", ErrInvalidBatch, p.CourseID, p.ChapterID, p.Status)
		}
	}
	for _, a := range annotations {
		if a.ID == uuid.Nil || a.CourseID == "" || a.ChapterID == "" || a.CreatedAt.IsZero() || a.UpdatedAt.IsZero() {
			return 0, fmt.Errorf("%w: annotation item (id=%s) missing a required field", ErrInvalidBatch, a.ID)
		}
	}

	if len(progress) == 0 && len(annotations) == 0 {
		return 0, nil
	}

	// One `now` for the whole batch, read after validation and before any
	// database work: two items in the same request must not be clamped to
	// two different instants just because the loop took a moment.
	now := time.Now().UTC()
	for i := range progress {
		progress[i].UpdatedAt = clampFuture(progress[i].UpdatedAt, now)
	}
	for i := range annotations {
		annotations[i].UpdatedAt = clampFuture(annotations[i].UpdatedAt, now)
	}

	return uc.repo.PushBatch(ctx, userID, progress, annotations)
}

// clampFuture returns t, or now if t is after now. One-sided on purpose.
//
// Why the future must be clamped: `updated_at` arrives from the CLIENT
// (handler.go parses it out of the request body) and is stored verbatim
// once accepted — it is what upsertProgressSQL/upsertAnnotationSQL compare
// under `WHERE EXCLUDED.updated_at > <table>.updated_at` to decide whether
// a write wins. An unclamped future value would let that row win against
// every genuinely later edit — pushed from another device, or written
// through PUT /progress / the /annotations verbs — until wall-clock time
// caught up to it, which could be arbitrarily long. A wrong clock is a
// mundane environmental fault — a flat CMOS battery, a phone with
// automatic time off, a VM resuming from suspend — not an attack, and it
// must not be able to freeze a row's LWW position that far into the
// future.
//
// (Before Pha 3 Task 3 cut GET /sync, this same clamp also protected
// Pull's returned cursor, which every one of a user's devices polled
// with — an unclamped future timestamp poisoned that shared watermark for
// all of them at once. That cursor is gone along with Pull; the clamp
// stays, because the LWW-poisoning reason above never depended on it.)
//
// Why the PAST must NOT be clamped: past-dated timestamps are load-bearing
// and correct. `setProgress` (apps/web/src/db/local.ts) stamps an edit at
// the instant it happens, deliberately NOT when the outbox eventually
// flushes, so that a device that was offline for an hour does not have its
// hour-old edit dishonestly beat a genuinely newer edit made elsewhere in
// the meantime. Clamping the past — or, worse, replacing every timestamp
// with `now` — would break last-write-wins for exactly the offline case
// the whole design exists to support.
func clampFuture(t, now time.Time) time.Time {
	if t.After(now) {
		return now
	}
	return t
}

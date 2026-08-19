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

// Usecase holds sync's business rules: cursor computation for Pull and
// batch validation for Push. It talks to Postgres only through Repo, never
// directly.
type Usecase struct {
	repo *Repo
}

// NewUsecase builds a Usecase over repo.
func NewUsecase(repo *Repo) *Usecase {
	return &Usecase{repo: repo}
}

// Pull returns every progress and annotation row for userID changed
// strictly after since, plus a cursor the caller can pass as the next
// call's since.
//
// cursor semantics (deliberately chosen so a client can always safely use
// the returned value as its next `since` without either endpoint of a
// polling loop having to special-case emptiness):
//   - if this call found any rows, cursor is the maximum updated_at across
//     both result sets — moving the client's watermark forward exactly as
//     far as it's safe to move it.
//   - if this call found nothing new, cursor is echoed back as the input
//     since unchanged — never advanced past it, and never blank just
//     because nothing changed. That keeps the cursor monotonic: a client
//     that stores "cursor" and sends it back as "since" next time can
//     never skip a window, whether or not anything happened in between.
//
// Known limitation (documented, not fixed here — see repo.go's SQL, which
// is required verbatim by the task brief): because Pull uses a strict `>`
// against a client-supplied wall-clock timestamp, a row committed by a
// concurrent PushBatch with an updated_at that exactly equals another
// row's updated_at already returned as this call's cursor could be missed
// by a future call using that cursor as since (ties are excluded, not
// included). This is inherent to timestamp-based LWW without a separate
// monotonic sequence column, which the schema (Task 5) does not have,
// and is exceedingly unlikely at real timestamp precision but not
// impossible if two devices' clocks (or a naive client) produce identical
// updated_at values. A future schema revision could close this by adding a
// tiebreaker (e.g. a bigserial revision column) to both the sync indexes
// and this comparison.
func (uc *Usecase) Pull(ctx context.Context, userID uuid.UUID, since time.Time) (progress []ProgressRow, annotations []AnnotationRow, cursor time.Time, err error) {
	progress, err = uc.repo.PullProgress(ctx, userID, since)
	if err != nil {
		return nil, nil, time.Time{}, err
	}

	annotations, err = uc.repo.PullAnnotations(ctx, userID, since)
	if err != nil {
		return nil, nil, time.Time{}, err
	}

	cursor = since
	for _, p := range progress {
		if p.UpdatedAt.After(cursor) {
			cursor = p.UpdatedAt
		}
	}
	for _, a := range annotations {
		if a.UpdatedAt.After(cursor) {
			cursor = a.UpdatedAt
		}
	}

	return progress, annotations, cursor, nil
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

	return uc.repo.PushBatch(ctx, userID, progress, annotations)
}

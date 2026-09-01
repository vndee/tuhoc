package userdata

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

// ErrInvalidProgress is returned by Usecase.PutProgress when a required
// field is empty. It is checked with errors.Is by handler.go to produce a
// 400 (client's malformed request) rather than the 500 a genuine repo/DB
// failure gets — the same split sync.ErrInvalidBatch draws for POST /sync.
var ErrInvalidProgress = errors.New("userdata: invalid progress item")

// Usecase holds userdata's business rules: field validation for
// PutProgress. It talks to Postgres only through Repo, never directly.
type Usecase struct {
	repo *Repo
}

// NewUsecase builds a Usecase over repo.
func NewUsecase(repo *Repo) *Usecase {
	return &Usecase{repo: repo}
}

// ListProgress returns every progress row belonging to userID.
func (uc *Usecase) ListProgress(ctx context.Context, userID uuid.UUID) ([]ProgressRow, error) {
	return uc.repo.ListProgress(ctx, userID)
}

// PutProgress validates row and, if valid, writes it under userID's
// identity. userID comes from auth.UID (the handler's job to supply, from
// the authenticated session) — it is never taken from the request body.
//
// CourseID, ChapterID, and Status must all be non-empty before anything
// touches the database: an identifier missing any of these three could
// never be looked back up, and would sit in the progress table as a row
// no client can ever address again.
func (uc *Usecase) PutProgress(ctx context.Context, userID uuid.UUID, row ProgressRow) error {
	if row.CourseID == "" || row.ChapterID == "" || row.Status == "" {
		return fmt.Errorf("%w: (course=%q chapter=%q status=%q) missing a required field", ErrInvalidProgress, row.CourseID, row.ChapterID, row.Status)
	}
	return uc.repo.UpsertProgress(ctx, userID, row)
}

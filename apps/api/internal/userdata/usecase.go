package userdata

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"unicode/utf8"

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

// ErrInvalidAnnotation is returned by Usecase.CreateAnnotation when a
// required field is missing or row.ID is the zero uuid. It is checked
// with errors.Is by handler.go to produce a 400, the same split
// ErrInvalidProgress draws for PUT /progress.
var ErrInvalidAnnotation = errors.New("userdata: invalid annotation item")

// MaxNoteChars caps one annotation's note, in CHARACTERS (runes), and is
// enforced by both CreateAnnotation and PatchAnnotation below.
//
// It exists because until the final whole-branch review there was no bound
// at all: CreateAnnotation checked id/course/chapter/anchor for PRESENCE and
// PatchAnnotation validated nothing, so the only ceiling on a note was the
// HTTP body limit — which these routes had inherited from the app-wide
// 21 MiB one meant for course packages (see internal/server's route table).
// /annotations is not rate limited either, so "how much can one account
// write into this table" had no answer anywhere in the stack.
//
// WHY 4000 SPECIFICALLY, in three parts:
//
//  1. It is the same number as ai.MaxSystemPromptChars, which is this
//     platform's existing answer to "the longest free-form paragraph a
//     learner may store on the server". A note is that kind of field, and
//     giving it a different ceiling would be inventing a second answer to
//     a question already answered.
//  2. internal/ai's read_my_notes tool reads EVERY note of a course back
//     into the model's context under one 12,000-rune cap
//     (maxNotesToolOutputRunes) — billed to that same learner's credit. At
//     4,000 a single note cannot swallow that whole budget; at, say,
//     20,000 one note would truncate away every other note the learner
//     wrote, silently.
//  3. It is far above anything a margin note actually is. 4,000 characters
//     is roughly two pages of prose attached to one highlighted sentence.
//     A cap that a real learner can reach is a bug report; this one cannot
//     be reached by writing about a passage, only by pasting at it.
//
// RUNES, not bytes, for the reason MaxSystemPromptChars and
// maxNotesToolOutputRunes each give for themselves: this platform is
// bilingual, and a byte cap silently gives an English writer about three
// times the characters a Vietnamese writer gets.
const MaxNoteChars = 4000

// noteTooLong reports whether note exceeds MaxNoteChars characters. One
// function, called from both write paths, so the two cannot drift into
// disagreeing about how long a note may be — the shape of bug this
// codebase has already paid for elsewhere (clearLocalData's eight
// hand-copied copies).
func noteTooLong(note string) bool {
	return utf8.RuneCountInString(note) > MaxNoteChars
}

// ListAnnotations returns every annotation row belonging to userID,
// optionally filtered to one courseID (courseID == "" means every
// course — see Repo.ListAnnotations).
func (uc *Usecase) ListAnnotations(ctx context.Context, userID uuid.UUID, courseID string) ([]AnnotationRow, error) {
	return uc.repo.ListAnnotations(ctx, userID, courseID)
}

// isMissingAnchor reports whether anchor counts as "not provided" for
// CreateAnnotation's validation. Two client shapes must both be rejected:
// the key absent entirely (BodyParser leaves req.Anchor as its zero value,
// a nil json.RawMessage — len 0) and the key present but explicitly
// null (json.RawMessage captures the literal 4 bytes `null`, which is
// non-nil and non-empty, so a bare len-check alone would let it through).
// `{}` is neither of these — it is 2 non-null bytes — and is correctly
// accepted: this package carries anchor opaquely (see AnnotationRow's doc
// comment) and has no business judging its shape beyond "present".
func isMissingAnchor(anchor json.RawMessage) bool {
	trimmed := bytes.TrimSpace(anchor)
	return len(trimmed) == 0 || string(trimmed) == "null"
}

// CreateAnnotation validates row and, if valid, writes it under userID's
// identity. userID comes from auth.UID (the handler's job to supply, from
// the authenticated session) — it is never taken from the request body,
// same as PutProgress.
//
// row.ID must not be uuid.Nil: an annotation whose id could never be
// looked back up (or, worse, one that every client forgetting to generate
// an id collides on) is unaddressable in exactly the way an empty
// CourseID/ChapterID is for progress.
//
// row.Anchor must not be missing (see isMissingAnchor): annotations.anchor
// is `jsonb NOT NULL` with no default (migration 0001), so a request that
// omits it — or sends an explicit null — would otherwise pass this
// function, reach Repo.CreateAnnotation's INSERT, and fail there with a
// 23502 not_null_violation that CreateAnnotation does not special-case
// (unlike the 23505 it already catches for ErrDuplicateAnnotation) and so
// falls through as a wrapped, unrecognized error — apilog.Internal logs it
// and the client gets a fabricated 500 for what is, plainly, a malformed
// request. Catching it here, the same way CourseID/ChapterID/ID are
// caught, is what keeps a client mistake a 400 instead — the same split
// PutProgress already draws for every field annotations' sibling table
// (progress) requires non-null.
//
// ErrDuplicateAnnotation from the repo layer is returned as-is, not
// wrapped further, mirroring auth.Usecase.Register's handling of
// ErrEmailTaken, so handler.go can errors.Is against it directly.
func (uc *Usecase) CreateAnnotation(ctx context.Context, userID uuid.UUID, row AnnotationRow) error {
	if row.ID == uuid.Nil || row.CourseID == "" || row.ChapterID == "" || isMissingAnchor(row.Anchor) {
		return fmt.Errorf("%w: (id=%s course=%q chapter=%q anchorMissing=%t) missing a required field", ErrInvalidAnnotation, row.ID, row.CourseID, row.ChapterID, isMissingAnchor(row.Anchor))
	}
	if noteTooLong(row.Note) {
		return fmt.Errorf("%w: note is %d characters, the limit is %d", ErrInvalidAnnotation, utf8.RuneCountInString(row.Note), MaxNoteChars)
	}
	return uc.repo.CreateAnnotation(ctx, userID, row)
}

// PatchAnnotation applies the ONE business rule an edit can break —
// MaxNoteChars — and otherwise passes straight through to the repo layer:
// the owner scoping is the repo's own WHERE clause (see
// Repo.PatchAnnotation), and note/anchor's "nil means leave untouched"
// contract is a repo-layer SQL detail, not a usecase rule.
//
// This function validated NOTHING until the final whole-branch review, and
// the asymmetry was the defect: CreateAnnotation's checks are worth nothing
// if the very next request may PATCH the same row into a shape create would
// have refused. A nil note means "leave it untouched" and is not measured;
// only a note actually being written is.
func (uc *Usecase) PatchAnnotation(ctx context.Context, userID, id uuid.UUID, note *string, anchor json.RawMessage) (bool, error) {
	if note != nil && noteTooLong(*note) {
		return false, fmt.Errorf("%w: note is %d characters, the limit is %d", ErrInvalidAnnotation, utf8.RuneCountInString(*note), MaxNoteChars)
	}
	return uc.repo.PatchAnnotation(ctx, userID, id, note, anchor)
}

// DeleteAnnotation passes straight through to the repo layer — same
// reasoning as PatchAnnotation above.
func (uc *Usecase) DeleteAnnotation(ctx context.Context, userID, id uuid.UUID) (bool, error) {
	return uc.repo.DeleteAnnotation(ctx, userID, id)
}

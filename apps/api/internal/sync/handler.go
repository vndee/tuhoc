package sync

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/vndee/tuhoc-api/internal/apilog"
	"github.com/vndee/tuhoc-api/internal/auth"
)

// timeLayout is the wire format for every timestamp this package reads or
// writes: RFC3339Nano. time.Parse with this exact layout constant gets
// Go's dedicated RFC3339 fast path, which accepts any number of fractional
// digits (including none) and any valid zone offset — so a client sending
// "2026-08-19T10:00:00Z" (second precision) or
// "2026-08-19T10:00:00.123456789+07:00" (nanosecond precision, non-UTC
// zone) both parse correctly into the same kind of time.Time, and are
// compared as absolute instants everywhere downstream (Go's time.Time
// comparisons and Postgres timestamptz alike) — never as strings. Output
// is always normalized to UTC before formatting, purely for readability;
// it carries no correctness meaning (an equivalent-instant, differently-
// zoned string would compare identically wherever it matters).
const timeLayout = time.RFC3339Nano

// Handler holds the HTTP-layer concerns for sync: parsing requests,
// shaping responses, and status codes. It owns no SQL (that's repo.go) and
// no LWW/validation business rules (that's usecase.go).
type Handler struct {
	uc *Usecase
}

// NewHandler builds a Handler over uc.
func NewHandler(uc *Usecase) *Handler {
	return &Handler{uc: uc}
}

type progressItem struct {
	CourseID  string `json:"courseId"`
	ChapterID string `json:"chapterId"`
	Status    string `json:"status"`
	Done      bool   `json:"done"`
	UpdatedAt string `json:"updatedAt"`
}

type annotationItem struct {
	ID        string          `json:"id"`
	CourseID  string          `json:"courseId"`
	ChapterID string          `json:"chapterId"`
	Anchor    json.RawMessage `json:"anchor"`
	Note      string          `json:"note"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
	DeletedAt *string         `json:"deletedAt"`
}

type pushRequest struct {
	Progress    []progressItem   `json:"progress"`
	Annotations []annotationItem `json:"annotations"`
}

type pushResponse struct {
	Applied int `json:"applied"`
}

type pullResponse struct {
	Progress    []progressItem   `json:"progress"`
	Annotations []annotationItem `json:"annotations"`
	Cursor      string           `json:"cursor"`
}

// Pull handles GET /sync?since=<RFC3339Nano>. It is mounted behind
// auth.Require, so auth.UID(c) is always populated by the time this runs.
//
// since being absent or the empty string means "the beginning of time":
// every row the user has ever written is returned, and is how a device
// syncing for the first time (or after local storage was wiped) bootstraps
// its full state. A since value that is present but fails to parse as
// RFC3339Nano is a client error (400), not treated the same as absent —
// silently falling back to "everything" on a typo would let a broken
// client's every request quietly become a full resync without ever
// noticing.
func (h *Handler) Pull(c *fiber.Ctx) error {
	since := time.Time{}
	if raw := c.Query("since"); raw != "" {
		parsed, err := time.Parse(timeLayout, raw)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid since: must be RFC3339Nano"})
		}
		since = parsed
	}

	progress, annotations, cursor, err := h.uc.Pull(c.Context(), auth.UID(c), since)
	if err != nil {
		apilog.Internal(c, "sync.Pull", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "sync pull failed"})
	}

	resp := pullResponse{
		Progress:    make([]progressItem, len(progress)),
		Annotations: make([]annotationItem, len(annotations)),
	}
	for i, p := range progress {
		resp.Progress[i] = progressItem{
			CourseID:  p.CourseID,
			ChapterID: p.ChapterID,
			Status:    p.Status,
			Done:      p.Done,
			UpdatedAt: p.UpdatedAt.UTC().Format(timeLayout),
		}
	}
	for i, a := range annotations {
		resp.Annotations[i] = annotationItem{
			ID:        a.ID.String(),
			CourseID:  a.CourseID,
			ChapterID: a.ChapterID,
			Anchor:    a.Anchor,
			Note:      a.Note,
			CreatedAt: a.CreatedAt.UTC().Format(timeLayout),
			UpdatedAt: a.UpdatedAt.UTC().Format(timeLayout),
			DeletedAt: formatOptionalTime(a.DeletedAt),
		}
	}
	if !cursor.IsZero() {
		resp.Cursor = cursor.UTC().Format(timeLayout)
	}

	return c.Status(fiber.StatusOK).JSON(resp)
}

// Push handles POST /sync {"progress":[...],"annotations":[...]}. It is
// mounted behind auth.Require, so auth.UID(c) is always populated by the
// time this runs.
//
// Every progress/annotation item is parsed and validated before any
// database work happens (see the parse loop below and Usecase.Push's own
// validation): a malformed item anywhere in the batch rejects the whole
// request with 400 and zero side effects, rather than applying a prefix of
// the batch and failing partway through.
func (h *Handler) Push(c *fiber.Ctx) error {
	var req pushRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	progressRows := make([]ProgressRow, len(req.Progress))
	for i, item := range req.Progress {
		updatedAt, err := time.Parse(timeLayout, item.UpdatedAt)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid updatedAt in progress item: must be RFC3339Nano"})
		}
		progressRows[i] = ProgressRow{
			CourseID:  item.CourseID,
			ChapterID: item.ChapterID,
			Status:    item.Status,
			Done:      item.Done,
			UpdatedAt: updatedAt,
		}
	}

	annotationRows := make([]AnnotationRow, len(req.Annotations))
	for i, item := range req.Annotations {
		id, err := uuid.Parse(item.ID)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id in annotation item: must be a uuid"})
		}
		createdAt, err := time.Parse(timeLayout, item.CreatedAt)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid createdAt in annotation item: must be RFC3339Nano"})
		}
		updatedAt, err := time.Parse(timeLayout, item.UpdatedAt)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid updatedAt in annotation item: must be RFC3339Nano"})
		}
		var deletedAt *time.Time
		if item.DeletedAt != nil {
			d, err := time.Parse(timeLayout, *item.DeletedAt)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid deletedAt in annotation item: must be RFC3339Nano"})
			}
			deletedAt = &d
		}

		annotationRows[i] = AnnotationRow{
			ID:        id,
			CourseID:  item.CourseID,
			ChapterID: item.ChapterID,
			Anchor:    item.Anchor,
			Note:      item.Note,
			CreatedAt: createdAt,
			UpdatedAt: updatedAt,
			DeletedAt: deletedAt,
		}
	}

	applied, err := h.uc.Push(c.Context(), auth.UID(c), progressRows, annotationRows)
	if err != nil {
		if errors.Is(err, ErrInvalidBatch) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid batch item"})
		}
		apilog.Internal(c, "sync.Push", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "sync push failed"})
	}

	return c.Status(fiber.StatusOK).JSON(pushResponse{Applied: applied})
}

func formatOptionalTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(timeLayout)
	return &s
}

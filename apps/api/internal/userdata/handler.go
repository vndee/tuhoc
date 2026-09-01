package userdata

import (
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/vndee/tuhoc-api/internal/apilog"
	"github.com/vndee/tuhoc-api/internal/auth"
)

// timeLayout is the wire format for the updatedAt this package emits:
// RFC3339Nano. Unlike internal/sync, this package never PARSES a
// client-supplied timestamp (PUT /progress carries none — see repo.go's
// doc comment), so this constant is only ever used on the way out.
const timeLayout = time.RFC3339Nano

// Handler holds the HTTP-layer concerns for userdata's progress resource:
// parsing requests, shaping responses, and status codes. It owns no SQL
// (that's repo.go) and no validation business rules (that's usecase.go).
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

type listProgressResponse struct {
	Progress []progressItem `json:"progress"`
}

// putProgressRequest deliberately has no UpdatedAt field: the client never
// supplies one (see repo.go's doc comment for why), so there is nothing
// here to parse or validate against a wire timestamp format.
type putProgressRequest struct {
	CourseID  string `json:"courseId"`
	ChapterID string `json:"chapterId"`
	Status    string `json:"status"`
	Done      bool   `json:"done"`
}

// ListProgress handles GET /progress. It is mounted behind auth.Require,
// so auth.UID(c) is always populated by the time this runs.
func (h *Handler) ListProgress(c *fiber.Ctx) error {
	rows, err := h.uc.ListProgress(c.Context(), auth.UID(c))
	if err != nil {
		apilog.Internal(c, "userdata.ListProgress", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "list progress failed"})
	}

	resp := listProgressResponse{Progress: make([]progressItem, len(rows))}
	for i, p := range rows {
		resp.Progress[i] = progressItem{
			CourseID:  p.CourseID,
			ChapterID: p.ChapterID,
			Status:    p.Status,
			Done:      p.Done,
			UpdatedAt: p.UpdatedAt.UTC().Format(timeLayout),
		}
	}
	return c.Status(fiber.StatusOK).JSON(resp)
}

// PutProgress handles PUT /progress
// {"courseId":"c","chapterId":"c1","status":"read","done":true} -> 204, no
// body. It is mounted behind auth.Require, so auth.UID(c) is always
// populated by the time this runs.
func (h *Handler) PutProgress(c *fiber.Ctx) error {
	var req putProgressRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	err := h.uc.PutProgress(c.Context(), auth.UID(c), ProgressRow{
		CourseID:  req.CourseID,
		ChapterID: req.ChapterID,
		Status:    req.Status,
		Done:      req.Done,
	})
	if err != nil {
		if errors.Is(err, ErrInvalidProgress) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid progress item"})
		}
		apilog.Internal(c, "userdata.PutProgress", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "put progress failed"})
	}

	return c.SendStatus(fiber.StatusNoContent)
}

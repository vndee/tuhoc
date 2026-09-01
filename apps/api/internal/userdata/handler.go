package userdata

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

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

type annotationItem struct {
	ID        string          `json:"id"`
	CourseID  string          `json:"courseId"`
	ChapterID string          `json:"chapterId"`
	Anchor    json.RawMessage `json:"anchor"`
	Note      string          `json:"note"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
}

type listAnnotationsResponse struct {
	Annotations []annotationItem `json:"annotations"`
}

// createAnnotationRequest carries an ID field, unlike putProgressRequest:
// annotations.id is client-generated (see repo.go's AnnotationRow doc
// comment), so the client supplies it up front rather than the server
// returning one after the fact.
type createAnnotationRequest struct {
	ID        string          `json:"id"`
	CourseID  string          `json:"courseId"`
	ChapterID string          `json:"chapterId"`
	Anchor    json.RawMessage `json:"anchor"`
	Note      string          `json:"note"`
}

// patchAnnotationRequest's two fields are both optional and independently
// nilable: Note is a pointer so "omitted" (nil) is distinguishable from
// "set to empty string", and Anchor's zero value (nil json.RawMessage) is
// already "omitted" for a byte slice — see Repo.PatchAnnotation's own doc
// comment for how each nil is read as "leave this column untouched".
type patchAnnotationRequest struct {
	Note   *string         `json:"note"`
	Anchor json.RawMessage `json:"anchor"`
}

// ListAnnotations handles GET /annotations (every course) and
// GET /annotations?course=<courseId> (one course). It is mounted behind
// auth.Require, so auth.UID(c) is always populated by the time this runs.
func (h *Handler) ListAnnotations(c *fiber.Ctx) error {
	rows, err := h.uc.ListAnnotations(c.Context(), auth.UID(c), c.Query("course"))
	if err != nil {
		apilog.Internal(c, "userdata.ListAnnotations", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "list annotations failed"})
	}

	resp := listAnnotationsResponse{Annotations: make([]annotationItem, len(rows))}
	for i, a := range rows {
		resp.Annotations[i] = annotationItem{
			ID:        a.ID.String(),
			CourseID:  a.CourseID,
			ChapterID: a.ChapterID,
			Anchor:    a.Anchor,
			Note:      a.Note,
			CreatedAt: a.CreatedAt.UTC().Format(timeLayout),
			UpdatedAt: a.UpdatedAt.UTC().Format(timeLayout),
		}
	}
	return c.Status(fiber.StatusOK).JSON(resp)
}

// CreateAnnotation handles POST /annotations
// {"id":"<uuid client sinh>","courseId":"c","chapterId":"c1","anchor":{...},"note":""}
// -> 201, no body. It is mounted behind auth.Require, so auth.UID(c) is
// always populated by the time this runs.
func (h *Handler) CreateAnnotation(c *fiber.Ctx) error {
	var req createAnnotationRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	id, err := uuid.Parse(req.ID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id: must be a uuid"})
	}

	err = h.uc.CreateAnnotation(c.Context(), auth.UID(c), AnnotationRow{
		ID:        id,
		CourseID:  req.CourseID,
		ChapterID: req.ChapterID,
		Anchor:    req.Anchor,
		Note:      req.Note,
	})
	if err != nil {
		if errors.Is(err, ErrInvalidAnnotation) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid annotation item"})
		}
		if errors.Is(err, ErrDuplicateAnnotation) {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "annotation id already exists"})
		}
		apilog.Internal(c, "userdata.CreateAnnotation", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "create annotation failed"})
	}

	return c.SendStatus(fiber.StatusCreated)
}

// PatchAnnotation handles PATCH /annotations/:id, body {"note":"..."}
// and/or {"anchor":{...}} -> 204, no body. 404 (never 403 — see
// repo.go's PatchAnnotation doc comment) when :id does not exist or does
// not belong to the caller. Mounted behind auth.Require.
func (h *Handler) PatchAnnotation(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id: must be a uuid"})
	}

	var req patchAnnotationRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	found, err := h.uc.PatchAnnotation(c.Context(), auth.UID(c), id, req.Note, req.Anchor)
	if err != nil {
		apilog.Internal(c, "userdata.PatchAnnotation", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "patch annotation failed"})
	}
	if !found {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "annotation not found"})
	}

	return c.SendStatus(fiber.StatusNoContent)
}

// DeleteAnnotation handles DELETE /annotations/:id -> 204, no body. Same
// 404-not-403 contract as PatchAnnotation. Mounted behind auth.Require.
func (h *Handler) DeleteAnnotation(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id: must be a uuid"})
	}

	found, err := h.uc.DeleteAnnotation(c.Context(), auth.UID(c), id)
	if err != nil {
		apilog.Internal(c, "userdata.DeleteAnnotation", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "delete annotation failed"})
	}
	if !found {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "annotation not found"})
	}

	return c.SendStatus(fiber.StatusNoContent)
}

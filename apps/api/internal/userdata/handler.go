package userdata

import (
	"encoding/json"
	"errors"
	"net/url"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/vndee/tuhoc-api/internal/apilog"
	"github.com/vndee/tuhoc-api/internal/auth"
)

// MaxWriteBytes is the ceiling on the request body of every /progress and
// /annotations WRITE route, applied as route-scoped middleware in
// internal/server (bodyLimit) rather than as fiber's app-wide BodyLimit.
//
// It is fiber's own 4 MiB default, restored. The app-wide ceiling is raised
// to ~21 MiB for exactly one route — PUT /admin/courses/:slug, which
// accepts a course package — and every other route inherits that number
// unless it says otherwise, because BodyLimit is a per-APP setting in fiber
// v2. internal/sync's MaxPushBytes and internal/stats's MaxBatchBytes each
// say otherwise for the same reason and with the same number; these four
// routes, added in Pha 3 as the REST replacement for the two halves of
// POST /sync, were simply never given theirs. So a single annotation write
// — one note about one highlighted sentence — was allowed five times the
// body the BATCH endpoint it replaced is allowed.
//
// This bounds BYTES ON THE WIRE and nothing else. The bound that actually
// matters for what one learner can store is MaxNoteChars (usecase.go), for
// the reason internal/sync's own comment gives about MaxItemsPerPush: a
// byte ceiling cannot express "how much of this is content".
const MaxWriteBytes int64 = 4 << 20

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
//
// Found by Task 13 of Pha 3's e2e work (`apps/web/e2e/p2.spec.ts`), not
// anticipated: the success path used to end in `c.SendStatus(201)`, which
// this comment's own "no body" was WRONG about. `fiber.Ctx.SendStatus`
// fills in `utils.StatusMessage(status)` as the body whenever nothing has
// written to it yet — for a status the HTTP spec allows a body on (201
// is, unlike 204), that is a real, non-empty body: literally the seven
// bytes `"Created"`, `Content-Type: text/plain` (confirmed with a raw
// curl against the running server, not assumed from reading Fiber's
// source). The web client's `api/client.ts` `request()` parses every
// non-empty 2xx body and rejects one that is not a JSON object
// (`NotJsonError` — a deliberate guard against an SPA host answering an
// unknown API path with `index.html`, see that file's own doc), so THIS
// response tripped that guard on every single annotation a reader ever
// created: the row was written correctly (confirmed — `useAnnotations`'
// own query-cache invalidation immediately re-fetched it and painted the
// real highlight), but `create()` still threw, rolling back the
// optimistic paint and showing the reader a false "could not save"
// toast. `PatchAnnotation`/`DeleteAnnotation` right below never hit this:
// 204 is a true no-body status by the HTTP spec, so fasthttp strips
// whatever `SendStatus` would have written before it ever reaches the
// wire. `c.Status(...)` (no `Send*`) is what actually leaves the body
// untouched for a status that permits one.
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

	c.Status(fiber.StatusCreated)
	return nil
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
		// Same split CreateAnnotation draws, and for the same reason: a
		// note past MaxNoteChars is the client's malformed request, not
		// this server failing. Without this branch the usecase's new
		// length check would surface as a fabricated 500.
		if errors.Is(err, ErrInvalidAnnotation) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid annotation item"})
		}
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

type enrollmentItem struct {
	CourseID  string `json:"courseId"`
	CreatedAt string `json:"createdAt"`
}

// Object có khoá, không phải mảng trần — cùng hình dạng listProgressResponse
// và listAnnotationsResponse. api/client.ts phía web mặc định TỪ CHỐI một thân
// 2xx parse ra mảng, và chỉ mở ngoại lệ cho đúng một lời gọi; đi mảng trần ở
// đây là buộc phải mở thêm một ngoại lệ nữa mà không có lý do gì.
type listEnrollmentsResponse struct {
	Enrollments []enrollmentItem `json:"enrollments"`
}

type createEnrollmentRequest struct {
	CourseID string `json:"courseId"`
}

// ListEnrollments handles GET /enrollments. Mounted behind auth.Require, so
// auth.UID(c) is always populated by the time this runs.
func (h *Handler) ListEnrollments(c *fiber.Ctx) error {
	rows, err := h.uc.ListEnrollments(c.Context(), auth.UID(c))
	if err != nil {
		apilog.Internal(c, "userdata.ListEnrollments", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "list enrollments failed"})
	}

	// make(..., len) chứ không phải slice nil: encoding/json biến nil thành
	// null, và một client gọi .map() trên null sẽ ném lỗi. Cùng lý do,
	// cùng cách viết, như ListProgress ở trên.
	resp := listEnrollmentsResponse{Enrollments: make([]enrollmentItem, len(rows))}
	for i, e := range rows {
		resp.Enrollments[i] = enrollmentItem{
			CourseID:  e.CourseID,
			CreatedAt: e.CreatedAt.UTC().Format(timeLayout),
		}
	}
	return c.Status(fiber.StatusOK).JSON(resp)
}

// CreateEnrollment handles POST /enrollments {"courseId":"c"} -> 201, no body.
//
// 201 on the second identical call too: the repo's ON CONFLICT DO NOTHING
// makes this idempotent, and a caller who pressed a button twice has the
// result they wanted either way. Distinguishing "created" from "already
// there" would hand the UI a difference it has no use for.
func (h *Handler) CreateEnrollment(c *fiber.Ctx) error {
	var req createEnrollmentRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	err := h.uc.CreateEnrollment(c.Context(), auth.UID(c), req.CourseID)
	if errors.Is(err, ErrEmptyCourseID) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "courseId must not be empty"})
	}
	if err != nil {
		apilog.Internal(c, "userdata.CreateEnrollment", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "create enrollment failed"})
	}
	return c.SendStatus(fiber.StatusCreated)
}

// urlCourseID decodes the ":courseId" path parameter of DELETE
// /enrollments/:courseId, the same way catalog.Handler's urlSlug decodes
// ":slug" and for the identical reason: fiber's UnescapePath is off
// (server.New's fiber.Config never sets it), so a percent-encoded byte in
// the URL arrives at c.Params verbatim, still encoded. POST /enrollments
// stores courseId straight from the JSON body — already decoded by
// encoding/json, e.g. "khoa/a" — and apps/web/src/api/enrollments.ts's
// DELETE call encodeURIComponent()s that same string into the path, e.g.
// "khoa%2Fa". Without decoding here, the two never compare equal: the
// lookup finds no row, Repo.DeleteEnrollment's idempotent "0 rows affected
// is still success" reports 204 regardless, and the caller is left thinking
// they un-enrolled when the row is still there.
func urlCourseID(c *fiber.Ctx) (string, error) {
	return url.PathUnescape(c.Params("courseId"))
}

// DeleteEnrollment handles DELETE /enrollments/:courseId -> 204, no body.
// 204 even when nothing was there to delete: see Repo.DeleteEnrollment's own
// comment for why there is no 404 to give here.
func (h *Handler) DeleteEnrollment(c *fiber.Ctx) error {
	courseID, err := urlCourseID(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "courseId is not valid percent-encoding"})
	}

	err = h.uc.DeleteEnrollment(c.Context(), auth.UID(c), courseID)
	if errors.Is(err, ErrEmptyCourseID) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "courseId must not be empty"})
	}
	if err != nil {
		apilog.Internal(c, "userdata.DeleteEnrollment", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "delete enrollment failed"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

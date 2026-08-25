package catalog

import (
	"errors"
	"net/url"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/vndee/tuhoc-api/internal/apilog"
	"github.com/vndee/tuhoc-api/internal/auth"
	"github.com/vndee/tuhoc-api/internal/pkgcheck"
)

// Handler owns the HTTP-layer concerns for the admin catalog API: parsing
// requests, shaping responses, and status codes. It holds no SQL (repo.go)
// and no publish/rollback rules (usecase.go).
type Handler struct {
	uc *Usecase
}

// NewHandler builds a Handler over uc.
func NewHandler(uc *Usecase) *Handler {
	return &Handler{uc: uc}
}

// actorLocalsKey is the c.Locals key server.go's adminOrToken sets when a
// request authenticates via the shared ADMIN_TOKEN rather than a user
// session. Unexported so only MarkTokenActor can set it and only who can
// read it — the same one-doorway shape auth.localsUIDKey uses for the
// session-authenticated uid.
const actorLocalsKey = "catalog_actor_is_token"

// MarkTokenActor records that the current request authenticated via the
// shared admin token, not a user session. server.go's adminOrToken calls
// this — and ONLY this, never auth.Require — on that path, so who(c) below
// reports the "acted via CLI token" case correctly rather than reading
// auth.UID(c) (which would return uuid.Nil, a value that is emphatically
// NOT "no one": it is the zero UUID, and treating it as a real actor would
// be exactly the ambiguity migration 0005's actor column exists to remove).
func MarkTokenActor(c *fiber.Ctx) {
	c.Locals(actorLocalsKey, true)
}

// who resolves the authenticated actor for an admin route: nil for the
// shared-token path (MarkTokenActor was called), otherwise a pointer to
// auth.UID(c) — the session's own user id, populated by auth.Require
// earlier in the same chain. This is the ONLY place catalog decides who is
// acting, and it is never read from anything the request body carries.
func who(c *fiber.Ctx) *uuid.UUID {
	if isToken, _ := c.Locals(actorLocalsKey).(bool); isToken {
		return nil
	}
	uid := auth.UID(c)
	return &uid
}

// urlSlug decodes the ":slug" path parameter, the same way
// internal/course's pathSafeParam decodes its own path params: fiber's
// UnescapePath is off (server.New's fiber.Config never sets it, and false
// is the zero value), so a percent-encoded byte in the URL arrives at
// c.Params verbatim, still encoded. pkgcheck.Package.Slug — read out of
// the zip's own manifest — is never encoded at all, so comparing an
// undecoded URL segment against it would report a false mismatch for any
// manifest id containing a character encodeURIComponent would have
// escaped (Task 4's CLI builds the request URL with exactly that call).
// Nothing in this codebase currently restricts what a manifest's "id" may
// contain beyond "non-empty string" (see pkgcheck's checkManifestFields),
// so this is a real case, not a hypothetical one.
func urlSlug(c *fiber.Ctx) (string, error) {
	return url.PathUnescape(c.Params("slug"))
}

// publishedResponse is PUT and POST .../rollback's 201 body — the wire
// contract Task 4's CLI already reads: {"slug", "version"}, version being
// the publish-sequence integer this server owns, never the manifest's own
// semver.
type publishedResponse struct {
	Slug    string `json:"slug"`
	Version int    `json:"version"`
}

// rejectionResponse is every 400 body's shape: an English sentence (see
// i18n_server_speaks_codes_test.go — this server never writes Vietnamese
// into a response) plus the findings that caused it. Findings is always a
// concrete (possibly empty) slice, never omitted or null: Task 4's CLI
// does `Array.isArray(body.findings)` before trusting it, and an omitted
// field would be indistinguishable from a malformed response to a stricter
// future client.
type rejectionResponse struct {
	Error    string             `json:"error"`
	Findings []pkgcheck.Finding `json:"findings"`
}

func badRequest(c *fiber.Ctx, message string, findings []pkgcheck.Finding) error {
	if findings == nil {
		findings = []pkgcheck.Finding{}
	}
	return c.Status(fiber.StatusBadRequest).JSON(rejectionResponse{Error: message, Findings: findings})
}

// Publish handles PUT /admin/courses/:slug: body is the raw .zip bytes,
// Content-Type application/zip. Mounted behind adminOrToken in server.go.
func (h *Handler) Publish(c *fiber.Ctx) error {
	slug, err := urlSlug(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "slug is not valid percent-encoding"})
	}

	body := c.Body()
	if int64(len(body)) > pkgcheck.MaxUploadBytes {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
			"error": "package upload is too large",
		})
	}
	// c.Body() may return a buffer fasthttp reuses across requests; the
	// bytes are about to be stored verbatim in course_versions and read
	// back by a later Rollback, so this call must own an unaliased copy —
	// the same reasoning internal/course's Post applies to its own upload.
	zipBytes := append([]byte(nil), body...)

	resSlug, version, findings, err := h.uc.Publish(c.Context(), who(c), slug, zipBytes)
	switch {
	case errors.Is(err, ErrSlugMismatch):
		return badRequest(c, err.Error(), nil)
	case err != nil:
		apilog.Internal(c, "catalog.Publish", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "publish failed"})
	case len(findings) > 0:
		return badRequest(c, "invalid course package", findings)
	}

	return c.Status(fiber.StatusCreated).JSON(publishedResponse{Slug: resSlug, Version: version})
}

// adminCourseResponse is one row of GET /admin/courses's array body.
type adminCourseResponse struct {
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Version     int    `json:"version"`
	PublishedAt string `json:"published_at"`
	Versions    []int  `json:"versions"`
}

// List handles GET /admin/courses: every currently-live published course,
// each with its full course_versions history. Mounted behind adminOrToken.
func (h *Handler) List(c *fiber.Ctx) error {
	rows, err := h.uc.AdminList(c.Context())
	if err != nil {
		apilog.Internal(c, "catalog.List", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "catalog list failed"})
	}

	// make(..., len) rather than a nil slice: encoding/json turns a nil
	// slice into `null`, and a client that calls .map() on the response
	// would throw on an empty catalog.
	out := make([]adminCourseResponse, len(rows))
	for i, r := range rows {
		versions := r.Versions
		if versions == nil {
			versions = []int{}
		}
		out[i] = adminCourseResponse{
			Slug:        r.Slug,
			Title:       r.Title,
			Version:     r.Version,
			PublishedAt: r.PublishedAt.Format(rfc3339Milli),
			Versions:    versions,
		}
	}
	return c.Status(fiber.StatusOK).JSON(out)
}

// rfc3339Milli is the timestamp format every response in this handler
// uses for published_at: RFC 3339 with a fixed millisecond fraction, so
// two rows never differ in field WIDTH depending on how many trailing
// zeros time.Time's default formatting happens to trim.
const rfc3339Milli = "2006-01-02T15:04:05.000Z07:00"

// Unpublish handles DELETE /admin/courses/:slug. Mounted behind
// adminOrToken.
func (h *Handler) Unpublish(c *fiber.Ctx) error {
	slug, err := urlSlug(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "slug is not valid percent-encoding"})
	}

	err = h.uc.Unpublish(c.Context(), who(c), slug)
	switch {
	case errors.Is(err, ErrNotFound):
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
	case err != nil:
		apilog.Internal(c, "catalog.Unpublish", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "unpublish failed"})
	}
	return c.Status(fiber.StatusOK).JSON(fiber.Map{"slug": slug})
}

// rollbackRequest is POST .../rollback's body: the version to roll back
// to. Named "version" (not "to" or "toVersion") to keep the wire vocabulary
// to the one word this whole API already uses for the publish-sequence
// integer.
type rollbackRequest struct {
	Version int `json:"version"`
}

// Rollback handles POST /admin/courses/:slug/rollback, body
// {"version": N}. Mounted behind adminOrToken.
func (h *Handler) Rollback(c *fiber.Ctx) error {
	slug, err := urlSlug(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "slug is not valid percent-encoding"})
	}

	var req rollbackRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if req.Version <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "\"version\" must be a positive integer"})
	}

	version, findings, err := h.uc.Rollback(c.Context(), who(c), slug, req.Version)
	switch {
	case errors.Is(err, ErrNotFound):
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
	case err != nil:
		apilog.Internal(c, "catalog.Rollback", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "rollback failed"})
	case len(findings) > 0:
		return badRequest(c, "invalid course package", findings)
	}

	return c.Status(fiber.StatusCreated).JSON(publishedResponse{Slug: slug, Version: version})
}

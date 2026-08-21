package course

import (
	"errors"
	"io"

	"github.com/gofiber/fiber/v2"

	"github.com/vndee/tuhoc-api/internal/apilog"
	"github.com/vndee/tuhoc-api/internal/auth"
)

// assetContentType is what EVERY file served out of a package is labelled,
// manifest included.
//
// This origin holds the session cookie. A chapter served as text/html
// would, on a plain browser navigation, RENDER here — running the package
// author's markup, with its scripts and its event handlers, against that
// cookie. Course packages are not trusted content: a user can be talked
// into importing one, and the HTML rules that would have caught the
// hostile parts run at the registry, on the registry's submissions, not
// on a private import (see usecase.go's file comment). Labelling every
// asset as opaque bytes, with sniffing off, means nothing in a package can
// execute on this origin no matter what it contains.
//
// It costs the client nothing: the reader fetches these files and decides
// what to do with the bytes itself, and Response.json()/.text() ignore the
// content type entirely.
const assetContentType = "application/octet-stream"

// Handler owns the HTTP-layer concerns for courses: parsing requests,
// shaping responses, and status codes. It holds no SQL (repo.go) and no
// package rules (usecase.go).
//
// One rule outranks the rest here and is worth stating where it can be
// seen: the owner of every operation is auth.UID(c) — the id auth.Require
// put in the request's locals after validating the session cookie — and
// nothing else. Not a form field, not a query parameter, not anything in
// the manifest. Repo.Put was moved to take the owner as an argument
// exactly so this decision would be made in the open at the call site
// (ruling S1-F12); the argument is only as good as what is passed to it,
// and this file is what passes it.
type Handler struct {
	uc *Usecase
}

// NewHandler builds a Handler over uc.
func NewHandler(uc *Usecase) *Handler {
	return &Handler{uc: uc}
}

// courseSummary is GET /courses's wire shape.
//
// It exists so no course.Package is ever marshalled to a client:
// ListForOwner returns that type with Blob deliberately nil (a listing
// must not drag every package body into memory), so a handler that
// serialized it straight would publish `"blob": null` and a client would
// reasonably read that as "this package is empty". The manifest and the
// owner id would go out with it, on a page that displays neither.
type courseSummary struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Lang     string   `json:"lang"`
	Tier     string   `json:"tier"`
	Versions []string `json:"versions"`
	Pinned   string   `json:"pinned"`
}

type createdResponse struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}

// List handles GET /courses: every course the AUTHENTICATED user holds,
// and no other. Mounted behind auth.Require, so auth.UID(c) is populated.
//
// This is the endpoint P1 left unbuilt (debt C-2 in docs/carried-forward.md):
// the spec listed it, no task was assigned it, and the web Dashboard had
// to hardcode a course id to have anything to show. It is the catalog now.
func (h *Handler) List(c *fiber.Ctx) error {
	items, err := h.uc.List(c.Context(), auth.UID(c))
	if err != nil {
		apilog.Internal(c, "course.List", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "course list failed"})
	}

	// make(..., len) and not a nil slice: encoding/json turns a nil slice
	// into `null`, and every client that calls .map() on the response
	// would throw on an empty library.
	out := make([]courseSummary, len(items))
	for i, s := range items {
		out[i] = courseSummary{
			ID:       s.CourseID,
			Title:    s.Title,
			Lang:     s.Lang,
			Tier:     s.Tier,
			Versions: s.Versions,
			Pinned:   s.Pinned,
		}
	}
	return c.Status(fiber.StatusOK).JSON(out)
}

// Post handles POST /courses: multipart/form-data with the package .zip in
// field "package".
//
// The owner is auth.UID(c). Any owner_id the request carries — form field,
// query parameter, or a key inside the manifest — is not read here, which
// is a stronger property than being read and overwritten: there is no
// variable for it to land in. TestPostIgnoresClientSuppliedOwnerID sends
// all three at once.
func (h *Handler) Post(c *fiber.Ctx) error {
	fh, err := c.FormFile("package")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "missing the multipart form field \"package\" holding the .zip",
		})
	}
	if fh.Size > MaxUploadBytes {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
			"error": "package upload is too large",
		})
	}

	f, err := fh.Open()
	if err != nil {
		apilog.Internal(c, "course.Post", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "course import failed"})
	}
	defer f.Close()

	// LimitReader rather than a bare ReadAll: fh.Size is the multipart
	// header's claim about the part, and a claim is not a bound.
	body, err := io.ReadAll(io.LimitReader(f, MaxUploadBytes+1))
	if err != nil {
		apilog.Internal(c, "course.Post", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "course import failed"})
	}
	if int64(len(body)) > MaxUploadBytes {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
			"error": "package upload is too large",
		})
	}

	courseID, version, err := h.uc.Import(c.Context(), auth.UID(c), body)
	switch {
	case errors.Is(err, ErrTooLarge):
		// 413, not 400: the package is well-formed and simply too big
		// once expanded, which is a different thing to fix.
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
			"error":  "package contents exceed the size ceiling once expanded",
			"detail": err.Error(),
		})
	case errors.Is(err, ErrQuotaExceeded):
		// 507, not 413. Both mean "this will not be stored", but they are
		// different problems with different fixes: 413 says shrink this
		// package, 507 says the library is full. err.Error() names the
		// numbers, and they are the caller's own — how much of their own
		// library they have used.
		return c.Status(fiber.StatusInsufficientStorage).JSON(fiber.Map{
			"error":  "the library is full",
			"detail": err.Error(),
		})
	case errors.Is(err, ErrInvalidPackage):
		// The reason is written by usecase.go from fixed phrases (see
		// InvalidPackageError), never by a driver, so it is safe to
		// return — and it is the difference between an author who can fix
		// their package and one who cannot.
		var reason *InvalidPackageError
		detail := ""
		if errors.As(err, &reason) {
			detail = reason.Reason
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":  "invalid course package",
			"detail": detail,
		})
	case err != nil:
		apilog.Internal(c, "course.Post", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "course import failed"})
	}

	return c.Status(fiber.StatusCreated).JSON(createdResponse{ID: courseID, Version: version})
}

// Manifest handles GET /courses/:id/@:version/manifest.json.
//
// It serves the manifest out of the stored .zip, not out of the jsonb
// column, so the bytes a client receives are the bytes the author packed.
// jsonb keeps a parsed document: key order is not preserved, whitespace is
// dropped, and duplicate keys are collapsed silently (repo.go documents
// all three as measured). None of that changes the manifest's MEANING, but
// serving the archive's own bytes means there is one source for a
// package's contents rather than two that agree only approximately.
func (h *Handler) Manifest(c *fiber.Ctx) error {
	return h.serveAsset(c, manifestPath)
}

// Asset handles GET /courses/:id/@:version/* — any file inside the
// package.
func (h *Handler) Asset(c *fiber.Ctx) error {
	return h.serveAsset(c, c.Params("*"))
}

func (h *Handler) serveAsset(c *fiber.Ctx, rawName string) error {
	data, err := h.uc.Asset(c.Context(), auth.UID(c), c.Params("id"), c.Params("version"), rawName)
	switch {
	case errors.Is(err, ErrInvalidPackage):
		// A path that escapes the package (or is not decodable) is a
		// malformed request, not a missing file: 400 says "this request
		// can never work", where a 404 would invite the client to retry
		// with a different name.
		var reason *InvalidPackageError
		detail := ""
		if errors.As(err, &reason) {
			detail = reason.Reason
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":  "invalid asset path",
			"detail": detail,
		})
	case errors.Is(err, ErrNotFound):
		// The same answer for "you do not have this package", "this
		// version does not exist" and "no such file inside it". Splitting
		// them would let a caller confirm that another user holds a
		// package — the exact distinction repo.go's ErrNotFound erases.
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
	case err != nil:
		apilog.Internal(c, "course.Asset", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "course asset failed"})
	}

	c.Set(fiber.HeaderContentType, assetContentType)
	c.Set("X-Content-Type-Options", "nosniff")
	return c.Status(fiber.StatusOK).Send(data)
}

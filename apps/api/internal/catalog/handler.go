package catalog

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"net/url"
	"path"
	"strings"

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

// urlChapterID decodes the ":chapterId" path parameter the same way urlSlug
// decodes ":slug", and for the identical reason: nothing in
// checkManifestFields restricts a manifest chapter's "id" to URL-safe
// characters beyond "non-empty string", so a chapter id containing a
// character encodeURIComponent would escape must still resolve to the same
// undecoded row a client's own encoding call produced.
func urlChapterID(c *fiber.Ctx) (string, error) {
	return url.PathUnescape(c.Params("chapterId"))
}

// urlAssetPath decodes the "*" wildcard segment of GET
// /courses/:slug/assets/*, for the same underlying fact urlSlug's own
// comment names: fiber's UnescapePath is off (server.New's fiber.Config
// never sets it, and false is the zero value), so a percent-encoded byte in
// the URL arrives at c.Params("*") verbatim, still encoded.
//
// Unlike internal/course's own asset route (deleted by Task 9), decoding
// this string is not a security-relevant step here: there is no filesystem
// underneath it to escape. published_assets is a Postgres table keyed by
// the exact string (slug, path) — a decoded "../../etc/passwd" is simply a
// string that (correctly) matches no row and 404s, exactly like any other
// unknown path would. Decoding exists so a real asset whose
// package-relative path needs percent-encoding in a URL (a space, a
// Vietnamese diacritic) round-trips to the same key it was stored under —
// not to prevent a traversal that a database lookup was never exposed to in
// the first place.
func urlAssetPath(c *fiber.Ctx) (string, error) {
	return url.PathUnescape(c.Params("*"))
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

// visibilityRequest is PUT .../visibility's body.
type visibilityRequest struct {
	Visibility string `json:"visibility"`
}

// SetVisibility handles PUT /admin/courses/:slug/visibility, body
// {"visibility": "public"|"private"}. Mounted behind adminOrToken.
//
// A bad value is 400 with the two legal values named, not a 500 from the
// column's CHECK: the caller mistyped, and the response should say what to
// type instead.
func (h *Handler) SetVisibility(c *fiber.Ctx) error {
	slug, err := urlSlug(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "slug is not valid percent-encoding"})
	}

	var body visibilityRequest
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "body must be JSON"})
	}

	err = h.uc.SetVisibility(c.Context(), who(c), slug, body.Visibility)
	switch {
	case errors.Is(err, ErrInvalidVisibility):
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": `visibility must be "public" or "private"`,
		})
	case errors.Is(err, ErrNotFound):
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
	case err != nil:
		apilog.Internal(c, "catalog.SetVisibility", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "set visibility failed"})
	}
	return c.Status(fiber.StatusOK).JSON(fiber.Map{"slug": slug, "visibility": body.Visibility})
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

// ---------------------------------------------------------------------
// Task 9: the public read path.
//
// Every handler below answers with NO auth in front of it (see server.go's
// route wiring) — that is spec §2.4's own decision, not an oversight: a
// course is free and public to read, and the four routes here are the
// entire read side of that promise. Nothing below ever calls who(c) or
// auth.UID(c); there is no actor to resolve on a route nobody has to be
// signed in to reach.
// ---------------------------------------------------------------------

// --- ETags ---------------------------------------------------------------
//
// weakCourseETag is the brief's own format, `W/"<slug>-<version>"`, for the
// two routes that answer about exactly one course: PublicManifest and
// PublicChapter (and reused by PublicAsset — see that handler's own note on
// why an asset's ETag is keyed on its COURSE's version, not on the asset's
// own bytes). It is a WEAK validator (the W/ prefix) because this handler
// never promises byte-identical output for a given version — GetPublished's
// manifest comes back through jsonb, which does not preserve whitespace or
// key order (see PublicCourse's own doc comment) — only that two responses
// carrying the same ETag mean the same thing, which is exactly what a weak
// validator is for.
//
// version is what makes this ETag change on republish, and ONLY on
// republish: Publish always assigns the next integer in course_versions's
// own sequence (repo.go's nextVersionSQL), so two publishes of one slug can
// never share a version, and one version can never mean two different
// manifests. The lifecycle this buys: a client caches a response under
// version N's ETag; the course is republished and the live version becomes
// N+1; the client's next request sends `If-None-Match: W/"<slug>-N"`, which
// does not match `W/"<slug>-(N+1)"`, so the stale cache is never served as
// current — the client gets a fresh 200 with the new body and the new ETag.
// A course that is NOT republished keeps answering 304 to that same
// cached validator forever, without this handler re-reading or
// re-serializing anything past the one query needed to learn the version
// has not moved.
func weakCourseETag(slug string, version int) string {
	return fmt.Sprintf(`W/"%s-%d"`, slug, version)
}

// weakCoursesETag is GET /courses's own ETag. The brief's per-course format
// names a single slug; a listing has no one slug to put there, so this
// hashes every (slug, version) pair the listing actually returned, in the
// order ListPublished's own query already returns them (`ORDER BY slug`),
// so two reads of the identical catalog state hash identically. The result
// changes under exactly the conditions that change the listing's own body:
// a course published, unpublished, or republished to a new version.
//
// sha256 is not a security control here — nothing about this value is
// secret, and nothing verifies anything against it beyond a client handing
// it back unchanged — it is used only because it is already in the standard
// library and collision-free enough that two DIFFERENT catalog states will
// never collapse onto the same 304. Truncated to 8 bytes (16 hex chars) to
// keep the header short; a hash of a hash is a hash either way.
func weakCoursesETag(items []PublicCourse) string {
	h := sha256.New()
	for _, c := range items {
		fmt.Fprintf(h, "%s@%d\n", c.Slug, c.Version)
	}
	return fmt.Sprintf(`W/"courses-%x"`, h.Sum(nil)[:8])
}

// etagMatches reports whether ifNoneMatch — the raw If-None-Match header,
// which HTTP allows to carry several comma-separated validators, or the
// literal "*" — matches etag. Plain string equality against each candidate
// is enough here: every ETag this API ever emits has exactly one of the two
// shapes above, so a client that stores and replays what it was given can
// only ever produce a byte-identical match or none at all — there is no
// weak/strong equivalence class to reason about beyond the W/ prefix this
// handler already bakes into every value it hands out.
func etagMatches(ifNoneMatch, etag string) bool {
	if ifNoneMatch == "" {
		return false
	}
	if ifNoneMatch == "*" {
		return true
	}
	for _, candidate := range strings.Split(ifNoneMatch, ",") {
		if strings.TrimSpace(candidate) == etag {
			return true
		}
	}
	return false
}

// respondETag sets the ETag response header and, if the request's
// If-None-Match already names it, finishes the response as 304 (empty
// body, per RFC 9110 — fiber's SendStatus with no prior Send does not write
// one). Every one of the four public handlers below calls this in the same
// place: after the data is fetched (the ETag needs the version a fetch just
// read) and before the body is built (a 304 must not pay for JSON
// marshaling or a byte copy it will not send).
func respondETag(c *fiber.Ctx, etag string) (notModified bool) {
	c.Set(fiber.HeaderETag, etag)
	if etagMatches(c.Get(fiber.HeaderIfNoneMatch), etag) {
		c.SendStatus(fiber.StatusNotModified)
		return true
	}
	return false
}

// --- asset Content-Type ---------------------------------------------------
//
// octetStreamContentType is what EVERY package asset is labelled unless its
// extension is on the bitmap allowlist just below — ported here, in full,
// from internal/course/handler.go's own assetContentType before Task 9
// deletes that file, because the reasoning is load-bearing and must not die
// with the file it came from:
//
// This origin holds the session cookie. A chapter — or any other file out
// of a package — served with a real, browser-recognised content type would,
// on a plain browser navigation (an <a href> straight to the asset URL, a
// bookmark, a pasted link), RENDER here: running the package author's
// markup, with its scripts and its event handlers, against that cookie.
// Publishing does run pkgcheck.Validate's full rule set over a package
// before it is ever stored — unlike internal/course's private imports,
// which ran no HTML rule set at all — but that scan runs ONCE, at publish
// time, and a hostile package that somehow gets published (a bug in
// pkgcheck, a rule that is subtly wrong) would otherwise be served back to
// every anonymous reader as executable HTML forever after, with nothing
// left to catch it a second time. Labelling every asset as opaque bytes,
// with sniffing off, means nothing a package contains can execute on this
// origin no matter what pkgcheck did or did not catch — a second,
// independent layer under the one Task 6/7 already built, not a
// replacement for it.
//
// The one narrow exception: a small allowlist of bitmap image formats
// (png/jpg/jpeg/gif/webp) may be served with their real Content-Type. A
// bitmap has no document structure for a browser to interpret as markup or
// script — decoding pixels is not executing anything — so labelling one
// correctly costs nothing this rule exists to prevent, and it is what lets
// an <img src="..."> pointed at this route actually render. SVG is
// deliberately NOT on that list despite being "an image": SVG is a full XML
// document format that can carry <script> and event-handler attributes, and
// a browser asked to navigate to one directly renders it as a document — by
// the identical reasoning that keeps a chapter off text/html, an SVG stays
// octet-stream too. Everything not on the five-extension allowlist — SVG
// included — gets this constant plus X-Content-Type-Options: nosniff, which
// stops a browser from second-guessing the label via content sniffing.
//
// It costs a legitimate reader nothing beyond those five formats: a client
// fetches these bytes and decides what to do with them itself, and
// Response.json()/.text() ignore Content-Type entirely — the same closing
// argument internal/course's own comment made, still true here.
const octetStreamContentType = "application/octet-stream"

// bitmapContentTypes is the allowlist assetContentType consults, keyed by
// lower-cased file extension including the leading dot.
var bitmapContentTypes = map[string]string{
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".webp": "image/webp",
}

// assetContentType returns the Content-Type PublicAsset should answer with
// for assetPath, and whether that type is trusted enough to skip nosniff
// (true only for the bitmap allowlist above — see octetStreamContentType's
// own doc for why every other extension, SVG included, answers false).
func assetContentType(assetPath string) (contentType string, sniffable bool) {
	if ct, ok := bitmapContentTypes[strings.ToLower(path.Ext(assetPath))]; ok {
		return ct, true
	}
	return octetStreamContentType, false
}

// publicCourseSummary is one row of GET /courses's array body — the wire
// contract Task 10's web client (`fetchCatalog`) reads.
type publicCourseSummary struct {
	Slug        string `json:"slug"`
	Title       string `json:"title"`
	Lang        string `json:"lang"`
	Description string `json:"description"`
	Version     int    `json:"version"`
}

// PublicList handles GET /courses: every currently-live published course.
func (h *Handler) PublicList(c *fiber.Ctx) error {
	items, err := h.uc.ListPublished(c.Context(), auth.IsAdmin(c))
	if err != nil {
		apilog.Internal(c, "catalog.PublicList", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "catalog list failed"})
	}

	if respondETag(c, weakCoursesETag(items)) {
		return nil
	}

	// make(..., len) rather than a nil slice: encoding/json turns a nil
	// slice into `null`, and a client that calls .map() on the response
	// would throw on an empty catalog — the identical reasoning the admin
	// List handler above already applies to its own array.
	out := make([]publicCourseSummary, len(items))
	for i, it := range items {
		out[i] = publicCourseSummary{
			Slug:        it.Slug,
			Title:       it.Title,
			Lang:        it.Lang,
			Description: it.Description,
			Version:     it.Version,
		}
	}
	return c.Status(fiber.StatusOK).JSON(out)
}

// PublicManifest handles GET /courses/:slug: manifest.json's own content,
// UNWRAPPED — the response body IS the manifest, never `{"manifest": ...}`
// around it, matching what Task 10's `fetchManifest` reads with a plain
// `.json()`. 404 for an unknown or unpublished slug — see GetPublished's
// own doc for why that is one answer, not two.
func (h *Handler) PublicManifest(c *fiber.Ctx) error {
	slug, err := urlSlug(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "slug is not valid percent-encoding"})
	}

	course, err := h.uc.GetPublished(c.Context(), slug, auth.IsAdmin(c))
	switch {
	case errors.Is(err, ErrNotFound):
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
	case err != nil:
		apilog.Internal(c, "catalog.PublicManifest", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "manifest read failed"})
	}

	if respondETag(c, weakCourseETag(course.Slug, course.Version)) {
		return nil
	}

	// Content-Type is set explicitly rather than left to c.JSON: the body
	// is already a []byte holding valid JSON (course.ManifestJSON, straight
	// out of jsonb), and running it back through encoding/json would only
	// re-serialize bytes that are already the wire format this route
	// promises.
	c.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	return c.Status(fiber.StatusOK).Send(course.ManifestJSON)
}

// chapterResponse is GET /courses/:slug/chapters/:chapterId's body — the
// `ChapterPayload` shape Task 10's web client reads.
type chapterResponse struct {
	HTML    string           `json:"html"`
	Widgets []widgetResponse `json:"widgets"`
}

// widgetResponse is one element of chapterResponse's "widgets" array.
type widgetResponse struct {
	Name string `json:"name"`
	HTML string `json:"html"`
}

// PublicChapter handles GET /courses/:slug/chapters/:chapterId. 404 for an
// unknown slug or an unknown chapter within a real slug alike — see
// GetPublishedChapter's own doc. There is no version anywhere in this URL,
// unlike internal/course's own per-user routes (deleted by Task 9): every
// live slug has exactly one published version at a time
// (published_courses.slug is a PRIMARY KEY, not part of one), so "the
// chapter" always means the one that version currently ships.
func (h *Handler) PublicChapter(c *fiber.Ctx) error {
	slug, err := urlSlug(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "slug is not valid percent-encoding"})
	}
	chapterID, err := urlChapterID(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "chapter id is not valid percent-encoding"})
	}

	html, widgets, version, err := h.uc.GetChapter(c.Context(), slug, chapterID, auth.IsAdmin(c))
	switch {
	case errors.Is(err, ErrNotFound):
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
	case err != nil:
		apilog.Internal(c, "catalog.PublicChapter", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "chapter read failed"})
	}

	if respondETag(c, weakCourseETag(slug, version)) {
		return nil
	}

	out := chapterResponse{HTML: html, Widgets: make([]widgetResponse, len(widgets))}
	for i, w := range widgets {
		out.Widgets[i] = widgetResponse{Name: w.Name, HTML: w.HTML}
	}
	return c.Status(fiber.StatusOK).JSON(out)
}

// PublicAsset handles GET /courses/:slug/assets/*: one file's bytes out of
// the package, labelled per assetContentType's own security reasoning.
//
// Its ETag is keyed on the COURSE's version (h.uc.GetAsset's second return,
// joined from published_courses — see repo.go's GetPublishedAsset), not on
// a hash of the asset's own bytes. That is a deliberate, coarser choice: an
// asset has no version of its own to key on (published_assets carries none
// — it is wholesale replaced on every republish, same as
// published_chapters), so the finest-grained truthful signal available is
// "this is whatever this route served under the course's current publish".
// The cost is a cache invalidated by ANY republish of the course, even one
// that touched only a different chapter's prose and left this exact image
// byte-for-byte unchanged; the alternative (hashing each asset's own bytes
// for a per-asset validator) would catch that case, but nothing in the
// task's own contract asked for it, and it would mean computing and storing
// a second, redundant identity for data Postgres already versions at the
// COURSE granularity. See this task's own report for the full trade-off.
func (h *Handler) PublicAsset(c *fiber.Ctx) error {
	slug, err := urlSlug(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "slug is not valid percent-encoding"})
	}
	assetPath, err := urlAssetPath(c)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "asset path is not valid percent-encoding"})
	}

	data, version, err := h.uc.GetAsset(c.Context(), slug, assetPath, auth.IsAdmin(c))
	switch {
	case errors.Is(err, ErrNotFound):
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
	case err != nil:
		apilog.Internal(c, "catalog.PublicAsset", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "asset read failed"})
	}

	if respondETag(c, weakCourseETag(slug, version)) {
		return nil
	}

	contentType, sniffable := assetContentType(assetPath)
	c.Set(fiber.HeaderContentType, contentType)
	if !sniffable {
		c.Set("X-Content-Type-Options", "nosniff")
	}
	return c.Status(fiber.StatusOK).Send(data)
}

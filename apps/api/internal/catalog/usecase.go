// This file holds catalog's rules: what makes a zip publishable, the
// slug-vs-manifest identity check, and the fact that rollback is a re-read
// of a stored archive through the exact same validate-then-write path a
// fresh publish uses — never a second, differently-behaved write. repo.go
// deliberately holds none of these; it is storage, following the split
// internal/course and internal/sync already use in this codebase.
package catalog

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/vndee/tuhoc-api/internal/pkgcheck"
)

// ErrSlugMismatch is returned by Publish when the URL's slug and the
// manifest's own "id" field disagree. It carries no dynamic detail beyond
// what errors.Is needs; the actual values are formatted into the wrapping
// error's message by publishZip, which the handler surfaces as the 400
// body's "error" string (English — see i18n_server_speaks_codes_test.go;
// this is not a pkgcheck.Finding, so it travels as a plain sentence with
// an empty findings array, not a finding code).
var ErrSlugMismatch = errors.New("catalog: url slug does not match the manifest's id")

// ErrInvalidVisibility is returned for any value that is neither "public"
// nor "private". Its own error rather than a generic one so handler.go can
// map it to 400 without string-matching.
var ErrInvalidVisibility = errors.New("catalog: visibility must be \"public\" or \"private\"")

// Usecase holds catalog's rules. It reaches storage only through Repo.
type Usecase struct {
	repo Repo
}

// NewUsecase builds a Usecase over repo.
func NewUsecase(repo Repo) *Usecase {
	return &Usecase{repo: repo}
}

// publishZip is the one door onto Repo.Publish. Publish and Rollback both
// call it — this is the "not a second writing path" the task brief
// insists on: Rollback's only job is to find the right zipBytes and hand
// them to the exact same validate-then-write sequence a fresh publish
// runs, including a FRESH pkgcheck.Validate call (never a shortcut that
// trusts course_versions's stored bytes because they passed once — see
// pkgcheck's own duplicate-entry hardening, which exists precisely because
// this archive is read more than once, at different times).
//
// urlSlug is checked against the manifest's own id BEFORE any write is
// attempted (pkg.Slug != urlSlug returns ErrSlugMismatch and nothing is
// written) — that ordering is what makes "a mismatch is a 400" also mean
// "a mismatch never touches the database", not merely "a mismatch is
// reported after the fact".
func (u *Usecase) publishZip(ctx context.Context, who *uuid.UUID, urlSlug string, zipBytes []byte, action string, fromVersion int) (slug string, version int, findings []pkgcheck.Finding, err error) {
	findings, pkg, verr := pkgcheck.Validate(zipBytes)
	if verr != nil {
		return "", 0, nil, verr
	}
	if len(findings) > 0 {
		return "", 0, findings, nil
	}
	if pkg.Slug != urlSlug {
		return "", 0, nil, fmt.Errorf("%w: url names %q, manifest id is %q", ErrSlugMismatch, urlSlug, pkg.Slug)
	}

	in := PublishInput{
		Slug:         pkg.Slug,
		Title:        pkg.Title,
		Lang:         pkg.Lang,
		Description:  pkg.Description,
		ManifestJSON: pkg.ManifestJSON,
		Chapters:     pkg.Chapters,
		Widgets:      pkg.Widgets,
		Assets:       pkg.Assets,
		ZipBytes:     zipBytes,
		Action:       action,
		FromVersion:  fromVersion,
	}
	newVersion, werr := u.repo.Publish(ctx, who, in)
	if werr != nil {
		return "", 0, nil, werr
	}
	return pkg.Slug, newVersion, nil, nil
}

// Publish validates zipBytes against every format-v2 rule and, if it
// passes AND its manifest's "id" equals urlSlug, writes it as the next
// publish-sequence version for that slug — replacing whatever was
// previously live, if anything, and preserving every version that came
// before it in course_versions.
//
// who is the authenticated actor: nil means the shared ADMIN_TOKEN path
// (server.go's adminOrToken never resolves a user for that request), a
// non-nil pointer means the session's own user id. Never read from
// anything the request body carries — there is no field in PublishInput
// or Package a caller could set to forge either.
func (u *Usecase) Publish(ctx context.Context, who *uuid.UUID, urlSlug string, zipBytes []byte) (slug string, version int, findings []pkgcheck.Finding, err error) {
	return u.publishZip(ctx, who, urlSlug, zipBytes, "publish", 0)
}

// Unpublish removes slug's live row. See Repo.Unpublish's own doc comment
// for why course_versions survives this untouched.
func (u *Usecase) Unpublish(ctx context.Context, who *uuid.UUID, slug string) error {
	return u.repo.Unpublish(ctx, who, slug)
}

// Rollback reads the zip stored for (slug, toVersion) and republishes it
// through publishZip — the exact path Publish uses, including a fresh
// pkgcheck.Validate over the stored bytes. It is a re-read, not a reverse
// write: the new version is the next integer in the sequence (toVersion
// itself is never resurrected, and no course_versions or published_* row
// is mutated or deleted to "undo" anything), so the sequence stays
// monotonic and the full history stays intact no matter how many times a
// course is rolled back.
//
// findings non-empty here means a format rule tightened SINCE toVersion
// was originally published now rejects it — the stored bytes have not
// changed, but the rules validating them may have. That is reported the
// same way an ordinary Publish rejection is, not treated as a system
// error: the archive is exactly what it always was, still an untrusted
// input to be re-checked, never grandfathered in because it passed once.
func (u *Usecase) Rollback(ctx context.Context, who *uuid.UUID, slug string, toVersion int) (version int, findings []pkgcheck.Finding, err error) {
	zipBytes, err := u.repo.VersionZip(ctx, slug, toVersion)
	if err != nil {
		return 0, nil, err
	}
	_, version, findings, err = u.publishZip(ctx, who, slug, zipBytes, "rollback", toVersion)
	return version, findings, err
}

// AdminList returns the admin catalog listing.
func (u *Usecase) AdminList(ctx context.Context) ([]AdminCourseRow, error) {
	return u.repo.AdminList(ctx)
}

// --- Task 9: the public read path ---------------------------------------

// Widget is one widget resolved for a chapter response: the wire shape
// GET /courses/:slug/chapters/:chapterId's "widgets" array serializes.
type Widget struct {
	Name, HTML string
}

// ListPublished returns every currently-live published course. There is no
// rule here beyond "ask the repo" — unlike Publish, a read has nothing to
// validate and no actor to check, which is why this and the three methods
// below are thin: the interesting decisions on this path (what a 404 must
// not distinguish, what content type an asset gets) are HTTP-shape
// decisions and belong to handler.go, not to this file.
func (u *Usecase) ListPublished(ctx context.Context, v Viewer) ([]PublicCourse, error) {
	return u.repo.ListPublished(ctx, v)
}

// GetPublished returns slug's live course, or ErrNotFound.
func (u *Usecase) GetPublished(ctx context.Context, slug string, v Viewer) (PublicCourse, error) {
	return u.repo.GetPublished(ctx, slug, v)
}

// GetChapter returns one chapter's HTML together with its widgets, each
// resolved to the HTML the package shipped for it — the join
// GetPublishedChapter and GetPublishedWidgets do not do for each other, done
// here instead of in two repo round trips the handler would otherwise have
// to sequence itself.
//
// The returned slice preserves ch.WidgetNames's own order — first-seen order
// in the chapter's own HTML, per pkgcheck.Chapter.WidgetNames's doc — rather
// than the incidental order a map over published_widgets would produce: Go
// map iteration is randomized, and a reader re-requesting the same chapter
// must not see its widgets reshuffle between one response and the next.
//
// A name in ch.WidgetNames absent from the resolved map is silently skipped
// rather than surfaced as an error. It should never happen: pkgcheck's
// WIDGET_MISSING rule refuses, at publish time, any package whose chapter
// references a widget the package does not ship, so every name stored in a
// live chapter's widget_names is guaranteed to have a published_widgets row
// alongside it. Skipping rather than erroring means a future gap between
// that guarantee and reality (a hand-edited row, a migration that lets the
// two drift) costs a reader one missing widget on an otherwise-good
// chapter, not a 500 for a page that is mostly fine.
func (u *Usecase) GetChapter(ctx context.Context, slug, chapterID string, v Viewer) (html string, widgets []Widget, version int, err error) {
	ch, version, err := u.repo.GetPublishedChapter(ctx, slug, chapterID, v)
	if err != nil {
		return "", nil, 0, err
	}

	// Same includePrivate, deliberately: the chapter read above already
	// refused a private course, but a widget fetch that trusted that instead
	// of asking again would break the moment anything else calls this.
	byName, err := u.repo.GetPublishedWidgets(ctx, slug, ch.WidgetNames, v)
	if err != nil {
		return "", nil, 0, err
	}

	// make(..., 0, len) rather than a nil slice: a chapter with widgets
	// that all happened to be skipped (see the doc above) must still come
	// back as an empty array on the wire, not JSON null, matching Publish's
	// own "never null" rule for API arrays (see handler.go's rejectionResponse
	// and the admin List's own comment).
	widgets = make([]Widget, 0, len(ch.WidgetNames))
	for _, name := range ch.WidgetNames {
		html, ok := byName[name]
		if !ok {
			continue
		}
		widgets = append(widgets, Widget{Name: name, HTML: html})
	}
	return ch.HTML, widgets, version, nil
}

// GetAsset returns one asset's bytes for slug, plus the course's current
// publish-sequence version (handler.go's ETag input), or ErrNotFound.
func (u *Usecase) GetAsset(ctx context.Context, slug, assetPath string, v Viewer) ([]byte, int, error) {
	return u.repo.GetPublishedAsset(ctx, slug, assetPath, v)
}

// SetVisibility flips one live course between public and private. The value
// is validated HERE, before the repo, so an invalid one is a named 400 from
// the handler rather than a constraint violation surfacing as a 500.
func (u *Usecase) SetVisibility(ctx context.Context, who *uuid.UUID, slug, visibility string) error {
	if !ValidVisibility(visibility) {
		return ErrInvalidVisibility
	}
	return u.repo.SetVisibility(ctx, who, slug, visibility)
}

// GrantAccess / RevokeAccess / ListAccess are thin on purpose — the rules
// (course must exist, account must exist, granting twice is fine) belong to
// the transaction that enforces them, not to a second copy up here.
func (u *Usecase) GrantAccess(ctx context.Context, who *uuid.UUID, slug, email string) error {
	return u.repo.GrantAccess(ctx, who, slug, email)
}

func (u *Usecase) RevokeAccess(ctx context.Context, who *uuid.UUID, slug, email string) error {
	return u.repo.RevokeAccess(ctx, who, slug, email)
}

func (u *Usecase) ListAccess(ctx context.Context, slug string) ([]AccessRow, error) {
	return u.repo.ListAccess(ctx, slug)
}

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

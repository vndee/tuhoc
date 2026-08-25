// Package catalog owns the admin write path for the public course catalog:
// publish, unpublish, rollback, and the admin listing — the schema Task 5
// laid down (published_courses/_chapters/_assets/_widgets, course_versions,
// admin_audit) and the validation gate Tasks 6-7 built (pkgcheck.Validate).
// This file is the persistence layer and, following internal/course and
// internal/sync's own split, is the only place that speaks SQL; usecase.go
// holds the rules (what pkgcheck says, whether a slug matches, how rollback
// re-reads a stored zip) and handler.go holds the HTTP shapes.
//
// Task 9 deletes internal/course and mounts the PUBLIC read side of this
// same schema; this package is its admin-write sibling and does not read
// course_packages or anything internal/course owns.
package catalog

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/pkgcheck"
)

// ErrNotFound is returned by Unpublish when slug names no live published
// course, and by VersionZip when (slug, version) names no stored archive.
// Deliberately one sentinel for both: a caller mapping it to an HTTP status
// (404) does not need two names for "there is nothing here".
var ErrNotFound = errors.New("catalog: not found")

// PublishInput is everything one Publish write needs, already validated:
// pkgcheck.Validate has run, findings is empty, and every field below comes
// straight out of the resulting *pkgcheck.Package (plus the raw zip, which
// pkgcheck does not carry but course_versions must store verbatim).
//
// Action and FromVersion exist only to shape the audit row's note, and only
// for "rollback": PublishInput.Action == "rollback" makes Publish's SQL
// record which stored version was re-read (FromVersion) alongside the new
// version number the write lands on — a number that is not known until
// this same transaction computes it (see the version-numbering SQL below),
// so the note is built here rather than handed in pre-formatted by a
// caller that could not yet know the second half of what it says.
type PublishInput struct {
	Slug, Title, Lang, Description string
	ManifestJSON                   []byte
	Chapters                       []pkgcheck.Chapter
	Widgets                        map[string]string
	Assets                         map[string][]byte
	ZipBytes                       []byte

	Action      string // "publish" or "rollback"
	FromVersion int    // only meaningful when Action == "rollback"
}

// AdminCourseRow is one row of the admin listing: a live published course,
// its current publish sequence number, and the full history of versions
// ever published for its slug (course_versions may hold more entries than
// "the current one", including versions an unpublish left behind — see
// Unpublish's own doc comment on why that table survives unpublish).
type AdminCourseRow struct {
	Slug        string
	Title       string
	Version     int
	PublishedAt time.Time
	Versions    []int
}

// Repo is the storage interface the catalog usecase depends on.
type Repo interface {
	// Publish performs the ENTIRE publish write — the new course_versions
	// row, the wholesale replace of published_courses/_chapters/_assets/
	// _widgets, and the admin_audit row — as one transaction. See the
	// PostgresRepo method for why each step is ordered the way it is.
	Publish(ctx context.Context, who *uuid.UUID, in PublishInput) (version int, err error)
	// Unpublish removes slug's live row (and, via ON DELETE CASCADE, its
	// chapters/assets/widgets) and records the audit row, as one
	// transaction. ErrNotFound if slug has no live row; course_versions is
	// never touched.
	Unpublish(ctx context.Context, who *uuid.UUID, slug string) error
	// VersionZip returns the raw zip stored for (slug, version) at the time
	// it was published — never a re-derivation, always the exact bytes
	// course_versions.zip holds. ErrNotFound if no such row exists.
	VersionZip(ctx context.Context, slug string, version int) ([]byte, error)
	// AdminList returns one AdminCourseRow per live published course,
	// ordered by slug.
	AdminList(ctx context.Context) ([]AdminCourseRow, error)
}

// PostgresRepo is the Postgres-backed Repo.
type PostgresRepo struct {
	pool *pgxpool.Pool
}

// Compile-time proof the concrete type satisfies Repo, so a signature drift
// is a build error here rather than a confusing failure at the call site.
var _ Repo = (*PostgresRepo)(nil)

// NewRepo builds a PostgresRepo over pool.
func NewRepo(pool *pgxpool.Pool) *PostgresRepo {
	return &PostgresRepo{pool: pool}
}

// actorAndWho turns the caller's *uuid.UUID into admin_audit's two actor
// columns. who == nil means the request authenticated via the shared
// ADMIN_TOKEN (server.go's adminOrToken never populates a uid local on
// that path) rather than via any user session — so the audit row's who
// column is NULL from the moment it is written, not merely nulled later by
// a deleted user (that ambiguity is exactly what migration 0005's amended
// `actor` column exists to remove; see its own comment).
func actorAndWho(who *uuid.UUID) (actor string, whoParam any) {
	if who == nil {
		return "cli", nil
	}
	return "user", *who
}

// nextVersionSQL computes the next publish-sequence integer for slug and
// inserts the version's own archive in ONE statement: COALESCE(MAX,0)+1
// runs against course_versions inside the same INSERT, so there is no
// separate read-then-write round trip for two concurrent publishes of the
// same slug to race between. A genuine simultaneous collision (two admins
// publishing the same slug in the same instant) still cannot corrupt
// anything: (slug, version) is course_versions's PRIMARY KEY, so the loser
// of that race gets a unique-violation error, not a silently-skipped or
// duplicated version number. Admin publishes are rare, human-operated
// events; the acceptable failure mode for that vanishingly unlikely race is
// "retry", the same bar internal/course's own Import comment sets for an
// analogous quota race.
const nextVersionSQL = `
INSERT INTO course_versions (slug, version, zip, bytes)
SELECT $1, COALESCE(MAX(version), 0) + 1, $2, $3
FROM course_versions WHERE slug = $1
RETURNING version;
`

// Publish is the brief's own ordering, verbatim: version row first, then
// DELETE the live row (cascading through the three child tables), then
// insert all four published_* tables fresh, then the audit row — all
// inside one transaction, so a half-published course (new chapters against
// old assets, or a version row with no matching published_courses row) can
// never be observed by a reader: either every statement below lands, or
// none of them do.
func (r *PostgresRepo) Publish(ctx context.Context, who *uuid.UUID, in PublishInput) (int, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("catalog: begin publish transaction: %w", err)
	}
	// A no-op once Commit succeeds (pgx returns pgx.ErrTxClosed, ignored
	// here); on any early return it guarantees the transaction never sits
	// open holding a partial write.
	defer func() { _ = tx.Rollback(ctx) }()

	var version int
	if err := tx.QueryRow(ctx, nextVersionSQL, in.Slug, in.ZipBytes, len(in.ZipBytes)).Scan(&version); err != nil {
		return 0, fmt.Errorf("catalog: insert course_versions (slug=%s): %w", in.Slug, err)
	}

	// Cascades into published_chapters/published_assets/published_widgets
	// via their own ON DELETE CASCADE — a first publish finds no row here
	// and this is simply a no-op delete.
	if _, err := tx.Exec(ctx, `DELETE FROM published_courses WHERE slug = $1`, in.Slug); err != nil {
		return 0, fmt.Errorf("catalog: clear published_courses (slug=%s): %w", in.Slug, err)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO published_courses (slug, version, title, lang, description, manifest)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		in.Slug, version, in.Title, in.Lang, in.Description, in.ManifestJSON,
	); err != nil {
		return 0, fmt.Errorf("catalog: insert published_courses (slug=%s): %w", in.Slug, err)
	}

	for _, ch := range in.Chapters {
		// widget_names is NOT NULL DEFAULT '{}': a chapter that references
		// no widget gets pkgcheck.Chapter.WidgetNames == nil (an absent
		// Go slice, never allocated), and pgx encodes a nil []string as SQL
		// NULL, not as an empty array — the two are different values to
		// the wire protocol even though Go's own nil-slice-is-empty
		// convention treats them the same. Substituting an empty,
		// non-nil slice here is what makes an ordinary chapter (most
		// chapters carry no widget) satisfy the column's own NOT NULL.
		widgetNames := ch.WidgetNames
		if widgetNames == nil {
			widgetNames = []string{}
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO published_chapters (slug, chapter_id, file, html, widget_names)
			 VALUES ($1, $2, $3, $4, $5)`,
			in.Slug, ch.ID, ch.File, ch.HTML, widgetNames,
		); err != nil {
			return 0, fmt.Errorf("catalog: insert published_chapters (slug=%s chapter=%s): %w", in.Slug, ch.ID, err)
		}
	}

	for name, html := range in.Widgets {
		if _, err := tx.Exec(ctx,
			`INSERT INTO published_widgets (slug, name, html) VALUES ($1, $2, $3)`,
			in.Slug, name, html,
		); err != nil {
			return 0, fmt.Errorf("catalog: insert published_widgets (slug=%s name=%s): %w", in.Slug, name, err)
		}
	}

	for path, data := range in.Assets {
		if _, err := tx.Exec(ctx,
			`INSERT INTO published_assets (slug, path, bytes) VALUES ($1, $2, $3)`,
			in.Slug, path, data,
		); err != nil {
			return 0, fmt.Errorf("catalog: insert published_assets (slug=%s path=%s): %w", in.Slug, path, err)
		}
	}

	note := ""
	if in.Action == "rollback" {
		note = fmt.Sprintf("rolled back to version %d, republished as version %d", in.FromVersion, version)
	}
	actor, whoParam := actorAndWho(who)
	if _, err := tx.Exec(ctx,
		`INSERT INTO admin_audit (who, actor, action, target, note) VALUES ($1, $2, $3, $4, $5)`,
		whoParam, actor, in.Action, in.Slug, note,
	); err != nil {
		return 0, fmt.Errorf("catalog: insert admin_audit (action=%s slug=%s): %w", in.Action, in.Slug, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("catalog: commit publish transaction (slug=%s): %w", in.Slug, err)
	}
	return version, nil
}

// Unpublish deletes slug's live row and writes the audit entry as one
// transaction. course_versions is never touched here — it has no foreign
// key back to published_courses (Task 5's own migration comment; see the
// task brief's "Unpublish removes the live course but must not destroy
// history") specifically so this DELETE cannot cascade the archive away.
//
// ErrNotFound (no live row) rolls back without writing an audit row: an
// operation that changed nothing is not an admin action worth logging, and
// this repo's Rollback callers already reserve ErrNotFound for "nothing to
// act on" elsewhere (VersionZip below).
func (r *PostgresRepo) Unpublish(ctx context.Context, who *uuid.UUID, slug string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("catalog: begin unpublish transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `DELETE FROM published_courses WHERE slug = $1`, slug)
	if err != nil {
		return fmt.Errorf("catalog: delete published_courses (slug=%s): %w", slug, err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}

	actor, whoParam := actorAndWho(who)
	if _, err := tx.Exec(ctx,
		`INSERT INTO admin_audit (who, actor, action, target) VALUES ($1, $2, 'unpublish', $3)`,
		whoParam, actor, slug,
	); err != nil {
		return fmt.Errorf("catalog: insert admin_audit (action=unpublish slug=%s): %w", slug, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("catalog: commit unpublish transaction (slug=%s): %w", slug, err)
	}
	return nil
}

// VersionZip returns the raw archive course_versions stored for (slug,
// version) — the exact bytes a client PUT at publish time, never
// re-derived from published_* (which hold only what pkgcheck extracted,
// not the original zip). Rollback reads this and hands it straight back
// into the same publish path pkgcheck.Validate and Publish already are —
// no second zip reader, no shortcut that trusts these bytes because they
// passed once.
func (r *PostgresRepo) VersionZip(ctx context.Context, slug string, version int) ([]byte, error) {
	var zipBytes []byte
	err := r.pool.QueryRow(ctx,
		`SELECT zip FROM course_versions WHERE slug = $1 AND version = $2`,
		slug, version,
	).Scan(&zipBytes)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("catalog: read course_versions (slug=%s version=%d): %w", slug, version, err)
	}
	return zipBytes, nil
}

// AdminList joins published_courses (the live catalog) with course_versions
// (every version ever published) via two plain queries rather than one
// query with array_agg: the admin listing is operator-facing and expected
// to hold at most a few dozen rows, so the extra round trip costs nothing
// worth avoiding, and it sidesteps having to agree with pgx's array-decode
// rules for int4[] at all.
func (r *PostgresRepo) AdminList(ctx context.Context) ([]AdminCourseRow, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT slug, title, version, published_at FROM published_courses ORDER BY slug`)
	if err != nil {
		return nil, fmt.Errorf("catalog: list published_courses: %w", err)
	}
	out := []AdminCourseRow{}
	index := map[string]int{}
	for rows.Next() {
		var row AdminCourseRow
		if err := rows.Scan(&row.Slug, &row.Title, &row.Version, &row.PublishedAt); err != nil {
			rows.Close()
			return nil, fmt.Errorf("catalog: scan published_courses row: %w", err)
		}
		index[row.Slug] = len(out)
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("catalog: list published_courses: %w", err)
	}
	rows.Close()

	vrows, err := r.pool.Query(ctx,
		`SELECT slug, version FROM course_versions ORDER BY slug, version`)
	if err != nil {
		return nil, fmt.Errorf("catalog: list course_versions: %w", err)
	}
	defer vrows.Close()
	for vrows.Next() {
		var slug string
		var version int
		if err := vrows.Scan(&slug, &version); err != nil {
			return nil, fmt.Errorf("catalog: scan course_versions row: %w", err)
		}
		// A slug with version history but no live row (unpublished) has no
		// entry in index — its history is real but there is no
		// AdminCourseRow to attach it to; AdminList only lists LIVE
		// courses, per its own doc comment.
		if i, ok := index[slug]; ok {
			out[i].Versions = append(out[i].Versions, version)
		}
	}
	if err := vrows.Err(); err != nil {
		return nil, fmt.Errorf("catalog: list course_versions: %w", err)
	}

	return out, nil
}

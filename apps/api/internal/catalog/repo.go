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
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/htmltext"

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

// PublicCourse is the read shape Task 9's public routes serve: a
// currently-live published course, as any anonymous reader may see it.
// There is no owner field anywhere on this type — unlike course.Package
// (deleted by Task 9; see that package's own file comments while they still
// exist in git history), a published course has no owner to keep separate
// from anyone else's, because publishing is exactly the act of making a
// course the same for every reader.
type PublicCourse struct {
	Slug, Title, Lang, Description string
	Version                        int

	// ManifestJSON is nil on a result from ListPublished — see that
	// method's own doc for why a listing must not carry it — and populated
	// on a result from GetPublished, where it is manifest.json's content,
	// unwrapped: the response body IS this value, not an envelope around
	// it (GET /courses/:slug's own contract). It comes back through
	// jsonb, so — same caveat repo.go's admin-write half already documents
	// for course_versions — it is semantically the manifest the author
	// packed but not necessarily byte-identical to it (key order,
	// whitespace and numeric formatting are not preserved by jsonb). That
	// distinction is invisible to every consumer here: the web client
	// only ever calls .json() on this body, which parses by value, never
	// by bytes.
	ManifestJSON json.RawMessage
}

// PublicChapter is the read shape for one chapter of a published course,
// before its widget references are resolved to HTML (see Usecase.GetChapter,
// which is where that resolution happens).
type PublicChapter struct {
	HTML string
	// WidgetNames is exactly published_chapters.widget_names: every
	// data-widget name this chapter references, in the order pkgcheck first
	// saw it, deduplicated. Never nil on a real row (the column is NOT
	// NULL DEFAULT '{}'), but always checked as a length rather than a
	// nilness by every caller, so a driver that ever did hand back nil
	// costs nothing.
	WidgetNames []string
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

	// --- Task 9: the public read path -----------------------------------
	//
	// Every method below reads published_courses/_chapters/_widgets/_assets
	// only — the same four tables Publish writes — and none of them takes
	// an actor or an owner, because there is nothing left to check one
	// against: a published course is public by construction, and "the
	// reader is allowed to see this" is not a question these queries ask.

	// ListPublished returns every currently-live published course, ordered
	// by slug — GET /courses's wire shape. ManifestJSON is left nil: a
	// listing must not drag every course's manifest into memory for a page
	// that displays none of it (the same reasoning course.Repo's own,
	// now-deleted ListForOwner applied to Blob).
	ListPublished(ctx context.Context) ([]PublicCourse, error)
	// GetPublished returns slug's live course, manifest included, or
	// ErrNotFound if slug names no currently-published course.
	GetPublished(ctx context.Context, slug string) (PublicCourse, error)
	// GetPublishedChapter returns one chapter of slug's live course, plus
	// the course's CURRENT version (handler.go's ETag input, joined here
	// rather than in a second round trip — the same reason
	// GetPublishedAsset joins it), or ErrNotFound — for an unknown slug and
	// an unknown chapter within a real slug alike. There is no private data
	// behind that distinction (every published course is public), but a
	// response that told the two apart would still leak "this slug exists"
	// for no reason a public catalog has any use for.
	GetPublishedChapter(ctx context.Context, slug, chapterID string) (chapter PublicChapter, version int, err error)
	// GetPublishedWidgets returns the HTML of every widget named in names
	// that slug's live course actually ships, keyed by name. A name with no
	// matching row is simply absent from the result rather than an error —
	// see Usecase.GetChapter for why a caller can lean on this without
	// leaning on the guarantee that makes it true.
	GetPublishedWidgets(ctx context.Context, slug string, names []string) (map[string]string, error)
	// GetPublishedAsset returns one asset's bytes for (slug, assetPath),
	// plus the course's CURRENT publish-sequence version (the caller's ETag
	// input — see handler.go), or ErrNotFound.
	GetPublishedAsset(ctx context.Context, slug, assetPath string) (data []byte, version int, err error)
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
		// plain_text dựng NGAY ĐÂY, cùng lý do widget_names được trích ở
		// đúng chỗ này (xem chú thích của nó trong 0005): thứ mỗi lượt đọc
		// cần thì tính một lần lúc ghi, không tính lại mỗi lượt đọc. Đây là
		// đường ghi DUY NHẤT vào published_chapters, nên không có chỗ thứ hai
		// nào có thể để trống cột này.
		if _, err := tx.Exec(ctx,
			`INSERT INTO published_chapters (slug, chapter_id, file, html, widget_names, plain_text)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			in.Slug, ch.ID, ch.File, ch.HTML, widgetNames, htmltext.Strip(ch.HTML),
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

// --- Task 9: the public read path ---------------------------------------

// ListPublished reads slug/title/lang/description/version off
// published_courses only — never the manifest column, which is the whole
// reason this is a distinct query from GetPublished rather than that method
// called once per row: a catalog listing must stay cheap regardless of how
// large any one course's manifest is.
func (r *PostgresRepo) ListPublished(ctx context.Context) ([]PublicCourse, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT slug, title, lang, description, version
		 FROM published_courses ORDER BY slug`)
	if err != nil {
		return nil, fmt.Errorf("catalog: list published courses: %w", err)
	}
	defer rows.Close()

	out := []PublicCourse{}
	for rows.Next() {
		var c PublicCourse
		if err := rows.Scan(&c.Slug, &c.Title, &c.Lang, &c.Description, &c.Version); err != nil {
			return nil, fmt.Errorf("catalog: scan published_courses row: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("catalog: list published courses: %w", err)
	}
	return out, nil
}

// GetPublished returns slug's live row in full, manifest included.
func (r *PostgresRepo) GetPublished(ctx context.Context, slug string) (PublicCourse, error) {
	var c PublicCourse
	err := r.pool.QueryRow(ctx,
		`SELECT slug, title, lang, description, version, manifest
		 FROM published_courses WHERE slug = $1`,
		slug,
	).Scan(&c.Slug, &c.Title, &c.Lang, &c.Description, &c.Version, &c.ManifestJSON)
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicCourse{}, ErrNotFound
	}
	if err != nil {
		return PublicCourse{}, fmt.Errorf("catalog: get published course (slug=%s): %w", slug, err)
	}
	return c, nil
}

// GetPublishedChapter returns one chapter row joined against
// published_courses for its CURRENT version — published_chapters carries no
// version of its own (migration 0005 never gave it one; a chapter belongs
// to whichever version is currently live, full stop) — in one query rather
// than two, the same choice GetPublishedAsset makes for the identical
// reason.
func (r *PostgresRepo) GetPublishedChapter(ctx context.Context, slug, chapterID string) (PublicChapter, int, error) {
	var ch PublicChapter
	var version int
	err := r.pool.QueryRow(ctx,
		`SELECT pch.html, pch.widget_names, pc.version
		 FROM published_chapters pch
		 JOIN published_courses pc ON pc.slug = pch.slug
		 WHERE pch.slug = $1 AND pch.chapter_id = $2`,
		slug, chapterID,
	).Scan(&ch.HTML, &ch.WidgetNames, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return PublicChapter{}, 0, ErrNotFound
	}
	if err != nil {
		return PublicChapter{}, 0, fmt.Errorf("catalog: get published chapter (slug=%s chapter=%s): %w", slug, chapterID, err)
	}
	return ch, version, nil
}

// GetPublishedWidgets returns every one of names that slug currently ships,
// keyed by name. An empty result (never an error) for a chapter that
// references no widget — the ordinary case — is why this returns early on
// len(names) == 0 rather than sending Postgres a query with an empty ANY($2)
// array for no reason.
func (r *PostgresRepo) GetPublishedWidgets(ctx context.Context, slug string, names []string) (map[string]string, error) {
	out := map[string]string{}
	if len(names) == 0 {
		return out, nil
	}

	rows, err := r.pool.Query(ctx,
		`SELECT name, html FROM published_widgets WHERE slug = $1 AND name = ANY($2)`,
		slug, names,
	)
	if err != nil {
		return nil, fmt.Errorf("catalog: get published widgets (slug=%s): %w", slug, err)
	}
	defer rows.Close()

	for rows.Next() {
		var name, html string
		if err := rows.Scan(&name, &html); err != nil {
			return nil, fmt.Errorf("catalog: scan published_widgets row (slug=%s): %w", slug, err)
		}
		out[name] = html
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("catalog: get published widgets (slug=%s): %w", slug, err)
	}
	return out, nil
}

// GetPublishedAsset returns one asset's bytes, plus the course's CURRENT
// version — joined from published_courses in the same query, rather than a
// second round trip, because the version is only ever used alongside the
// bytes (see handler.go's ETag) and never on its own here.
//
// The join is also what makes "no such slug" and "no such asset under a
// real, currently-published slug" collapse into the same ErrNotFound
// without any extra code: published_assets carries a
// REFERENCES published_courses(slug) ON DELETE CASCADE, so an unpublished
// course's asset rows are already gone by the time this runs — but the join
// condition would refuse them even if they somehow survived, since an
// asset whose course is not (or no longer) live has no published_courses
// row to join against.
func (r *PostgresRepo) GetPublishedAsset(ctx context.Context, slug, assetPath string) ([]byte, int, error) {
	var data []byte
	var version int
	err := r.pool.QueryRow(ctx,
		`SELECT pa.bytes, pc.version
		 FROM published_assets pa
		 JOIN published_courses pc ON pc.slug = pa.slug
		 WHERE pa.slug = $1 AND pa.path = $2`,
		slug, assetPath,
	).Scan(&data, &version)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, 0, ErrNotFound
	}
	if err != nil {
		return nil, 0, fmt.Errorf("catalog: get published asset (slug=%s path=%s): %w", slug, assetPath, err)
	}
	return data, version, nil
}

// BackfillPlainText dẫn xuất published_chapters.plain_text cho mọi hàng còn
// NULL, tức mọi chương publish TRƯỚC migration 0012.
//
// Ở trong Go chứ không trong migration, và đó là một ràng buộc chứ không phải
// một sở thích: gỡ thẻ đúng nghĩa cần tokenizer HTML5 (bảng mười thẻ raw-text
// của internal/htmltext), và một bản dựng bằng regexp_replace trong SQL sẽ là
// ĐỊNH NGHĨA THỨ HAI cho "văn bản của một chương" — đúng thứ mà việc tách
// internal/htmltext ra khỏi internal/ai tồn tại để tránh. Migration 0012 ghi
// lại lập luận này ở chính chỗ nó không backfill.
//
// CHẠY LẠI ĐƯỢC: `WHERE plain_text IS NULL` khiến lần thứ hai không đụng hàng
// nào. Nó cũng không bao giờ GHI ĐÈ một giá trị đã có — một chương vừa
// publish lại mang bản dẫn xuất mới nhất, và hàm này không được phép lùi nó.
//
// Trả về số hàng đã điền, để chỗ gọi nói ra một con số thay vì "xong".
func (r *PostgresRepo) BackfillPlainText(ctx context.Context) (int, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT slug, chapter_id, html FROM published_chapters WHERE plain_text IS NULL`)
	if err != nil {
		return 0, fmt.Errorf("catalog: select chapters needing plain_text: %w", err)
	}

	type pending struct{ slug, chapterID, text string }
	todo := []pending{}
	for rows.Next() {
		var slug, chapterID, html string
		if err := rows.Scan(&slug, &chapterID, &html); err != nil {
			rows.Close()
			return 0, fmt.Errorf("catalog: scan chapter for plain_text: %w", err)
		}
		todo = append(todo, pending{slug, chapterID, htmltext.Strip(html)})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("catalog: select chapters needing plain_text: %w", err)
	}

	// Gỡ thẻ SAU khi đã đóng rows, không phải trong lúc duyệt: một UPDATE
	// gửi đi giữa chừng trên cùng một kết nối sẽ đụng con trỏ đang mở.
	n := 0
	for _, p := range todo {
		tag, err := r.pool.Exec(ctx,
			`UPDATE published_chapters SET plain_text = $3
			  WHERE slug = $1 AND chapter_id = $2 AND plain_text IS NULL`,
			p.slug, p.chapterID, p.text)
		if err != nil {
			return n, fmt.Errorf("catalog: backfill plain_text (slug=%s chapter=%s): %w", p.slug, p.chapterID, err)
		}
		n += int(tag.RowsAffected())
	}
	return n, nil
}

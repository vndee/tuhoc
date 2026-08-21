// Package course owns server-side storage of course packages: the .zip a
// user imports, its manifest, and the metadata needed to list and serve
// it. This file is the persistence layer and, following internal/sync's
// split, is the only place that speaks SQL; the usecase and HTTP layers
// that will sit on top of it belong to a later task and are deliberately
// absent here.
//
// Two rules in this file are load-bearing and easy to undo by accident:
//
//  1. Every query is keyed on owner_id, and owner_id is part of the
//     table's primary key. Each user holds their own copy of every
//     package. See the migration (0002_course_packages.up.sql) for the
//     trade-off; the consequence for this file is that no method takes a
//     (courseID, version) pair without an ownerID beside it, and none
//     ever should. That ownerID is always an *argument* of the method,
//     including on the write path — never a field of the value being
//     written. See Repo below for why the distinction is the whole point.
//
//  2. Version ordering happens in Go, not in SQL. `ORDER BY version` is a
//     string sort, which puts 1.10.0 before 1.9.0 — wrong, with no error
//     and no visible symptom. See compareSemver below.
package course

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned by Get when no package matches the requested
// (ownerID, courseID, version). It is deliberately the *only* signal the
// caller gets: a package that belongs to a different owner is reported
// exactly as one that does not exist at all, so no caller — and no HTTP
// response derived from one — can distinguish "not yours" from "not
// there" and thereby confirm that another user holds a given package.
var ErrNotFound = errors.New("course: package not found")

// Package is one stored course package: the compressed bundle plus the
// metadata needed to list it and serve its contents.
type Package struct {
	CourseID string
	Version  string

	// OwnerID is filled in on values coming *out* of Get and
	// ListForOwner, and is ignored on the way in: Put stores its ownerID
	// argument and never reads this field. It is not a second way to say
	// who is writing — there is no second way, deliberately. A request
	// body that names an owner_id (or a handler that binds a body
	// straight into a Package) therefore cannot reach a row.
	OwnerID uuid.UUID

	Tier  string // "content" or "interactive" (enforced by a CHECK constraint)
	Lang  string
	Title string

	// Manifest is carried as raw JSON end to end (request body -> here ->
	// jsonb column and back) and is never unmarshaled into a Go struct by
	// this package, which has no reason to understand its shape.
	//
	// jsonb stores a parsed document, not the bytes handed to it. What
	// comes back is semantically equivalent but rarely byte-identical:
	// key order is not preserved, insignificant whitespace is dropped,
	// numbers are renormalised (1e2 comes back as 100), and — measured on
	// a real database, not assumed — DUPLICATE KEYS ARE COLLAPSED
	// SILENTLY: {"a":1,"a":2} is stored as {"a":2}, no error, no warning.
	// Callers must therefore compare manifests by value, never by bytes.
	//
	// The consequence for the tasks that follow: an integrity hash of a
	// package must be taken over Blob, which round-trips byte for byte,
	// and NEVER over a manifest that has been through jsonb. Such a hash
	// changes between write and read for reasons that look like data
	// corruption and are not.
	//
	// jsonb is also stricter than encoding/json rather than merely
	// lossier: a manifest that json.Valid accepts can be rejected
	// outright. The measured case is a \u0000 escape inside a string —
	// Postgres answers SQLSTATE 22P05, "unsupported Unicode escape
	// sequence" — which Put surfaces as a wrapped driver error, since this
	// layer has no typed error for a caller-supplied payload it cannot
	// store.
	Manifest json.RawMessage

	// Blob is the package .zip exactly as uploaded, byte for byte.
	//
	// It is nil on results from ListForOwner — see that method's doc.
	Blob []byte

	// Bytes is the UNCOMPRESSED total size of the package contents. It is
	// NOT len(Blob), and must never be derived from it: the size ceiling
	// applied at ingest exists to stop a zip bomb, which is by definition
	// small compressed and huge expanded, so a ceiling checked against the
	// compressed size would let exactly the payload it exists to block
	// straight through. This layer stores whatever the caller computed
	// while expanding the archive and enforces no limit of its own; the
	// limit belongs at the ingest boundary, where the number is produced.
	//
	// The schema does pin the one invariant that duplicates no policy
	// number: CHECK (bytes >= 0). A negative size is not a small package,
	// it is a corrupt row that quietly falsifies every later SUM over a
	// user's library, and a review measured -1 being stored without
	// complaint before the constraint existed.
	Bytes int64

	// CreatedAt is assigned by the database when the row is first
	// inserted. Put ignores whatever a caller puts here — a client must
	// not be able to backdate its own import — and re-importing an
	// existing version leaves the original value intact, since this is
	// when the package first entered the user's library, not when it was
	// last written.
	CreatedAt time.Time
}

// Repo is the storage interface the HTTP layer depends on. Every method,
// the single write included, takes ownerID as its own argument rather
// than reading it from a Package field, so a handler physically cannot
// pass a caller-supplied owner by forgetting to overwrite one: the owner
// comes from the authenticated session at the call site, in the open.
// This is the same shape sync.Repo.PushBatch uses, for the same reason.
//
// This comment once made that claim while Put alone took the owner from
// p.OwnerID. A review measured the gap rather than reading it: an
// attacker who declared the victim's id in that field overwrote the
// victim's row whole, err=<nil>. The fix was to move Put to the shape the
// comment described, not to soften the comment — an authenticated
// identity must never be read out of attacker-controlled data.
type Repo interface {
	// Put stores p under ownerID, replacing any package that owner
	// already has at the same (courseID, version). p.OwnerID is ignored.
	Put(ctx context.Context, ownerID uuid.UUID, p Package) error
	// Get returns one package, or ErrNotFound.
	Get(ctx context.Context, ownerID uuid.UUID, courseID, version string) (Package, error)
	// ListForOwner returns every package ownerID holds, without blobs.
	ListForOwner(ctx context.Context, ownerID uuid.UUID) ([]Package, error)
	// ListVersions returns ownerID's versions of courseID, oldest first
	// by semver precedence.
	ListVersions(ctx context.Context, ownerID uuid.UUID, courseID string) ([]string, error)
	// UsedBytesExcluding returns the total uncompressed bytes ownerID
	// holds, NOT counting (courseID, version) — the row a Put of that
	// package would replace rather than add.
	UsedBytesExcluding(ctx context.Context, ownerID uuid.UUID, courseID, version string) (int64, error)
}

// PostgresRepo is the Postgres-backed Repo. Like internal/sync's
// repository it holds no business rules: no size limits, no manifest
// validation, no tier policy. Those belong to the layer above, which can
// reject a request before it ever reaches storage.
type PostgresRepo struct {
	pool *pgxpool.Pool
}

// Compile-time proof that the concrete type satisfies the interface the
// HTTP layer will depend on, so a signature drift is a build error here
// rather than a confusing failure in the package that consumes it.
var _ Repo = (*PostgresRepo)(nil)

// NewRepo builds a PostgresRepo over pool.
func NewRepo(pool *pgxpool.Pool) *PostgresRepo {
	return &PostgresRepo{pool: pool}
}

// upsertPackageSQL replaces the owner's existing copy of a version rather
// than rejecting it: each row is one user's private copy of a package, and
// re-importing a package they already hold is an ordinary thing for a user
// to do, not an error worth surfacing.
//
// The safety of DO UPDATE here rests entirely on the conflict target being
// the full primary key, owner_id included. A row can only ever conflict
// with a row that already has the same owner_id, because owner_id is part
// of the identity Postgres uses to detect the conflict in the first place:
// (A, courseX, 1.0.0) and (B, courseX, 1.0.0) are simply different keys.
// One user's import therefore cannot overwrite another's — not because of
// a WHERE guard, but because such a collision cannot be expressed. Narrow
// the conflict target and that property is silently lost.
//
// $1 is Put's ownerID argument, the authenticated caller. It is never
// p.OwnerID: that would make the row's identity a function of the payload
// being written, which is exactly what the property above is protecting.
//
// created_at is absent from both the column list and the SET clause: the
// column default supplies it on insert, and a replacement deliberately
// leaves the original in place.
const upsertPackageSQL = `
INSERT INTO course_packages (owner_id,course_id,version,tier,lang,title,manifest,blob,bytes)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT (owner_id,course_id,version) DO UPDATE
SET tier=EXCLUDED.tier, lang=EXCLUDED.lang, title=EXCLUDED.title,
    manifest=EXCLUDED.manifest, blob=EXCLUDED.blob, bytes=EXCLUDED.bytes;
`

// Put stores p for ownerID — the authenticated caller — replacing that
// owner's existing package at the same (CourseID, Version) if there is
// one. p.OwnerID is ignored: whatever it holds, the row is written under
// ownerID, so a forged owner in the payload has no effect at all rather
// than an effect nobody notices.
func (r *PostgresRepo) Put(ctx context.Context, ownerID uuid.UUID, p Package) error {
	_, err := r.pool.Exec(ctx, upsertPackageSQL,
		ownerID, p.CourseID, p.Version, p.Tier, p.Lang, p.Title, p.Manifest, p.Blob, p.Bytes)
	if err != nil {
		return fmt.Errorf("course: put package (owner=%s course=%s version=%s): %w",
			ownerID, p.CourseID, p.Version, err)
	}
	return nil
}

// UsedBytesExcluding sums the uncompressed sizes of everything ownerID
// holds except (courseID, version).
//
// The exclusion is what makes it usable as a quota input. Put is an
// upsert, so re-importing a version the owner already has REPLACES a row
// rather than adding one; counting the row about to be overwritten would
// charge an owner twice for a package they hold once, and an owner near
// the ceiling could then never re-import anything (there is no delete
// endpoint to get them unstuck). Pass "" for both to get the plain total —
// no row has an empty course_id.
//
// This method carries no policy of its own: it answers "how much" and the
// caller owns "how much is too much" (see usecase.go's MaxOwnerBytes),
// keeping this file free of business rules the way the rest of it is.
//
// COALESCE because SUM over no rows is NULL, not 0 — a brand-new owner
// would otherwise fail the Scan rather than report an empty library.
func (r *PostgresRepo) UsedBytesExcluding(ctx context.Context, ownerID uuid.UUID, courseID, version string) (int64, error) {
	var total int64
	err := r.pool.QueryRow(ctx,
		`SELECT COALESCE(SUM(bytes), 0) FROM course_packages
		 WHERE owner_id = $1 AND NOT (course_id = $2 AND version = $3)`,
		ownerID, courseID, version).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("course: used bytes for owner %s: %w", ownerID, err)
	}
	return total, nil
}

// Get returns the single package identified by (ownerID, courseID,
// version), or ErrNotFound if this owner has no such package — including
// the case where another owner does. The zero Package is returned
// alongside the error so a caller that ignores the error still cannot
// read a field holding somebody else's data.
func (r *PostgresRepo) Get(ctx context.Context, ownerID uuid.UUID, courseID, version string) (Package, error) {
	var p Package
	err := r.pool.QueryRow(ctx,
		`SELECT owner_id, course_id, version, tier, lang, title, manifest, blob, bytes, created_at
		 FROM course_packages
		 WHERE owner_id = $1 AND course_id = $2 AND version = $3`,
		ownerID, courseID, version,
	).Scan(&p.OwnerID, &p.CourseID, &p.Version, &p.Tier, &p.Lang, &p.Title,
		&p.Manifest, &p.Blob, &p.Bytes, &p.CreatedAt)

	if errors.Is(err, pgx.ErrNoRows) {
		return Package{}, ErrNotFound
	}
	if err != nil {
		return Package{}, fmt.Errorf("course: get package (owner=%s course=%s version=%s): %w",
			ownerID, courseID, version, err)
	}
	return p, nil
}

// ListForOwner returns every package belonging to ownerID, ordered by
// course id and then by semver precedence within a course.
//
// Blob is left nil on every result: this method exists to build listings,
// and a user with a modest library would otherwise pull tens of megabytes
// of package bodies into memory to render a page that shows none of them.
// Callers that need the bytes ask for one package by name via Get.
func (r *PostgresRepo) ListForOwner(ctx context.Context, ownerID uuid.UUID) ([]Package, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT owner_id, course_id, version, tier, lang, title, manifest, bytes, created_at
		 FROM course_packages
		 WHERE owner_id = $1`,
		ownerID,
	)
	if err != nil {
		return nil, fmt.Errorf("course: list packages for owner %s: %w", ownerID, err)
	}
	defer rows.Close()

	out := []Package{}
	for rows.Next() {
		var p Package
		if err := rows.Scan(&p.OwnerID, &p.CourseID, &p.Version, &p.Tier, &p.Lang, &p.Title,
			&p.Manifest, &p.Bytes, &p.CreatedAt); err != nil {
			return nil, fmt.Errorf("course: scan package row: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("course: list packages for owner %s: %w", ownerID, err)
	}

	// Ordered here rather than in SQL for the same reason ListVersions is:
	// ORDER BY version would sort 1.10.0 below 1.9.0.
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CourseID != out[j].CourseID {
			return out[i].CourseID < out[j].CourseID
		}
		return compareSemver(out[i].Version, out[j].Version) < 0
	})
	return out, nil
}

// ListVersions returns every version of courseID that ownerID holds,
// ordered oldest to newest by semver precedence.
//
// The ordering is applied in Go, deliberately. `ORDER BY version` in SQL
// compares text: it reports 1.10.0 < 1.9.0 because '1' sorts before '9' at
// the third character. That is wrong, and wrong silently — no error, no
// warning, just a caller that picks up an older package believing it is
// the newest.
func (r *PostgresRepo) ListVersions(ctx context.Context, ownerID uuid.UUID, courseID string) ([]string, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT version FROM course_packages WHERE owner_id = $1 AND course_id = $2`,
		ownerID, courseID,
	)
	if err != nil {
		return nil, fmt.Errorf("course: list versions (owner=%s course=%s): %w", ownerID, courseID, err)
	}
	defer rows.Close()

	out := []string{}
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, fmt.Errorf("course: scan version row: %w", err)
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("course: list versions (owner=%s course=%s): %w", ownerID, courseID, err)
	}

	sort.SliceStable(out, func(i, j int) bool { return compareSemver(out[i], out[j]) < 0 })
	return out, nil
}

// --- semver precedence -------------------------------------------------
//
// This is the ordering rule the two list methods apply, kept beside them
// because "how versions are ordered" is the single thing about this
// package most likely to be quietly broken by moving it into SQL.
// Implemented here rather than pulled in as a dependency: the rule is
// short, the project has no semver module today, and golang.org/x/mod's
// version of it requires a leading "v" these versions do not carry.

// parsedVersion is a semantic version decomposed for comparison.
type parsedVersion struct {
	// valid is false for anything that is not strictly major.minor.patch
	// with optional prerelease/build. Invalid versions are ordered *below*
	// every valid one (see compareSemver) — the fail-safe direction, since
	// a caller that takes the last element as "newest" must never be handed
	// a string nobody could parse.
	valid bool
	core  [3]uint64
	// hasPre distinguishes "1.0.0" from "1.0.0-rc.1"; a version with a
	// prerelease has lower precedence than the release sharing its core.
	hasPre bool
	pre    []string
}

// parseSemver decomposes v. It never panics and never reports an error:
// anything it cannot parse comes back with valid=false, which
// compareSemver handles as a total order of its own.
func parseSemver(v string) parsedVersion {
	s := v

	// Build metadata is ignored for precedence (semver spec §10).
	if i := strings.IndexByte(s, '+'); i >= 0 {
		s = s[:i]
	}

	var p parsedVersion
	// The core cannot contain '-', so the first one separates the
	// prerelease.
	if i := strings.IndexByte(s, '-'); i >= 0 {
		pre := s[i+1:]
		s = s[:i]
		if pre == "" {
			return p // "1.0.0-" is not a version
		}
		p.hasPre = true
		p.pre = strings.Split(pre, ".")
		for _, id := range p.pre {
			if id == "" {
				return parsedVersion{} // empty identifier, e.g. "1.0.0-rc..1"
			}
		}
	}

	parts := strings.Split(s, ".")
	if len(parts) != 3 {
		return parsedVersion{}
	}
	for i, part := range parts {
		n, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			return parsedVersion{}
		}
		p.core[i] = n
	}

	p.valid = true
	return p
}

// compareSemver reports whether a sorts before (<0), with (0), or after
// (>0) b under semantic-version precedence. The result is a total order:
// versions of equal precedence that are not the same string (they differ
// only in build metadata) fall back to a byte comparison so sorting is
// deterministic rather than dependent on input order.
func compareSemver(a, b string) int {
	pa, pb := parseSemver(a), parseSemver(b)

	if pa.valid != pb.valid {
		if !pa.valid {
			return -1
		}
		return 1
	}
	if !pa.valid {
		return strings.Compare(a, b)
	}

	for i := 0; i < 3; i++ {
		if pa.core[i] != pb.core[i] {
			if pa.core[i] < pb.core[i] {
				return -1
			}
			return 1
		}
	}

	// A prerelease has lower precedence than the release it precedes.
	if pa.hasPre != pb.hasPre {
		if pa.hasPre {
			return -1
		}
		return 1
	}

	if pa.hasPre {
		if c := comparePrerelease(pa.pre, pb.pre); c != 0 {
			return c
		}
	}

	return strings.Compare(a, b)
}

// comparePrerelease applies semver's prerelease rules (spec §11.4):
// identifiers are compared left to right; all-numeric identifiers compare
// numerically and rank below alphanumeric ones; if every shared identifier
// is equal, the shorter list has lower precedence.
func comparePrerelease(a, b []string) int {
	n := len(a)
	if len(b) < n {
		n = len(b)
	}

	for i := 0; i < n; i++ {
		av, aNum := numericIdentifier(a[i])
		bv, bNum := numericIdentifier(b[i])

		switch {
		case aNum && bNum:
			if av != bv {
				if av < bv {
					return -1
				}
				return 1
			}
		case aNum != bNum:
			// Numeric identifiers always have lower precedence.
			if aNum {
				return -1
			}
			return 1
		default:
			if c := strings.Compare(a[i], b[i]); c != 0 {
				return c
			}
		}
	}

	switch {
	case len(a) < len(b):
		return -1
	case len(a) > len(b):
		return 1
	default:
		return 0
	}
}

// numericIdentifier reports whether id is an all-digit prerelease
// identifier and, if so, its value. Identifiers too long to fit a uint64
// are treated as alphanumeric rather than overflowing into a wrong number.
func numericIdentifier(id string) (uint64, bool) {
	for i := 0; i < len(id); i++ {
		if id[i] < '0' || id[i] > '9' {
			return 0, false
		}
	}
	n, err := strconv.ParseUint(id, 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

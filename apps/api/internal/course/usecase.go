// This file holds the business rules for course packages: the ingest
// ceiling, the structural checks a package must pass before it is stored,
// and the grouping that turns stored rows into a catalog. repo.go
// deliberately holds none of these — it is storage, and a size limit or a
// manifest rule living in two places is a size limit or a manifest rule
// that will one day disagree with itself.
//
// The consequence, stated plainly because it is the single most
// load-bearing fact about this file: THIS IS THE ONLY PLACE THE 20 MiB
// CEILING EXISTS. A review measured what happens without it — a package
// declaring Bytes = 5 GiB stored successfully, err=<nil> — so the ceiling
// is not a defensive nicety layered on top of some other check. Remove it
// and nothing else stops the write.
//
// # What Go checks, and what it deliberately does not
//
// Four structural things, and only four:
//
//  1. the total UNCOMPRESSED size is at most MaxUncompressedBytes,
//  2. manifest.json is at the package root, parses, and carries the
//     fields this server needs in order to store, list and serve it,
//     validated further below,
//  3. no path — zip entry name or manifest chapter.file — escapes the
//     package root,
//  4. every chapter.file the manifest names actually exists in the zip.
//
// It does NOT run the HTML rule set (SCRIPT_TAG, EVENT_HANDLER_ATTR,
// JAVASCRIPT_URL, EMBEDDED_FRAME, FORM_TAG, ...) that
// packages/course-format/src/validate.ts applies. That rule set exists to
// protect readers from a course a STRANGER wrote and published; the path
// it guards is the registry, where CI runs the TypeScript rules on the
// submission. A package a user uploads into their own private library is
// their own markup, served back only to them — porting the scan here
// would buy no safety and would put a second, drifting copy of a rule set
// in a second language. Likewise the registry-facing manifest fields
// (license, authors, generatedBy, runtime, description, semver and
// runtime-range syntax): validate.ts owns those, `tuhoc pack` enforces
// them before a package is ever built, and duplicating the table here
// would mean two lists to keep in step. See docs/course-format.md §10,
// which says outright that validate.ts is the rule and the prose is the
// copy.
//
// If a future change seems to need the HTML scan on this side, that is a
// scope decision to raise, not a patch to write. TestCourseHTTPContracts
// pins it with a test so the boundary cannot erode silently.
package course

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5/pgconn"
)

// MaxUncompressedBytes is the ingest ceiling: the total size of a
// package's contents AFTER expansion, matching docs/course-format.md's
// TOO_LARGE rule (20 MiB = 20 × 1024 × 1024 bytes) and
// packages/course-format's own limit.
//
// It is applied to the expanded size and never to the upload size,
// because a zip bomb is by definition tiny compressed and enormous
// expanded: a ceiling checked against the bytes on the wire would admit
// precisely the payload the ceiling exists to stop. The number that is
// checked here is also the number stored in course_packages.bytes, so the
// limit and the recorded size can never describe different things.
const MaxUncompressedBytes int64 = 20 * 1024 * 1024

// MaxUploadBytes is the ceiling on the REQUEST BODY, a different quantity
// from the one above and a much weaker check. It exists only to stop the
// server buffering an unbounded upload before it can be inspected; a
// package that squeezes under it can still be rejected by the real
// ceiling a moment later, and usually is.
//
// It has to be larger than MaxUncompressedBytes rather than equal to it:
// a package full of already-compressed material (images, mostly) barely
// shrinks, and its .zip carries per-entry headers and a central directory
// on top. The 1 MiB of slack is for that overhead and the multipart
// framing around it, not for extra content.
const MaxUploadBytes int64 = MaxUncompressedBytes + (1 << 20)

// manifestPath is where a manifest must live: the package ROOT. A
// manifest one directory down is a package that was zipped from one level
// too high, and is rejected rather than searched for — see
// docs/course-format.md §2, and MANIFEST_MISSING's "fix" note, which
// tells the author to pack the inner directory.
const manifestPath = "manifest.json"

// ErrTooLarge means the package's expanded contents exceed
// MaxUncompressedBytes. It is separate from ErrInvalidPackage because the
// two deserve different HTTP statuses (413 vs 400) and, more usefully,
// different advice: a too-large package is well-formed and needs its
// images shrinking, not its JSON fixing.
var ErrTooLarge = errors.New("course: package exceeds the uncompressed size ceiling")

// ErrInvalidPackage is the sentinel behind every structural rejection.
// Match it with errors.Is; to show the caller WHICH rule failed, pull out
// an *InvalidPackageError with errors.As.
var ErrInvalidPackage = errors.New("course: invalid course package")

// InvalidPackageError names the single rule a package broke.
//
// Reason is written by this file, never by a driver and never by a
// library: it is safe to put on the wire, which is the whole point of
// having a typed error rather than handing back whatever error came to
// hand. Where a Reason quotes a path it quotes one the client itself
// supplied, so it discloses nothing the client did not already know.
type InvalidPackageError struct {
	Reason string
}

func (e *InvalidPackageError) Error() string { return "course: invalid package: " + e.Reason }

// Unwrap makes errors.Is(err, ErrInvalidPackage) true for every one of
// these, so callers that only need the class do not have to know the type.
func (e *InvalidPackageError) Unwrap() error { return ErrInvalidPackage }

func invalid(format string, args ...any) error {
	return &InvalidPackageError{Reason: fmt.Sprintf(format, args...)}
}

// Summary is one course in a user's library, collapsed across the
// versions they hold.
//
// It exists so the HTTP layer never marshals a course.Package: that type
// carries a Blob field that ListForOwner leaves nil by design, plus the
// whole manifest and the owner id, none of which a catalog page wants and
// the first two of which are actively misleading on the wire (a client
// reading `blob: null` would conclude the package was empty). A dedicated
// type at the boundary makes the listing's shape a decision instead of a
// side effect of the storage struct.
type Summary struct {
	CourseID string
	Title    string
	Lang     string
	Tier     string

	// Versions holds every version the owner has, oldest first by SEMVER
	// precedence — 1.9.0 before 1.10.0, which a string sort gets backwards.
	Versions []string

	// Pinned is the version a reader should open: the newest by the same
	// precedence, i.e. the last element of Versions. It is computed rather
	// than stored because nothing in this system lets a user pin an older
	// version yet; when something does, this is the field it sets, and
	// every client already reads it.
	Pinned string
}

// Usecase holds the rules above. It reaches storage only through Repo —
// including in tests, where a Repo that fails on demand is the only way
// to reach the driver-error classification below.
type Usecase struct {
	repo Repo
}

// NewUsecase builds a Usecase over repo.
func NewUsecase(repo Repo) *Usecase {
	return &Usecase{repo: repo}
}

// Import validates zipBytes and stores it as ownerID's package, returning
// the course id and version taken FROM THE MANIFEST.
//
// ownerID is the authenticated caller and the only owner this write can
// land under: it is passed straight through to Repo.Put's ownerID
// argument, and the Package built below never has its OwnerID field set,
// so there is nothing for a forged owner in the request to attach itself
// to. (Repo.Put ignores that field anyway — this is the second lock on
// the same door, and ruling S1-F12 is about the case where the first lock
// is fine and the caller hands over the wrong key.)
//
// Nothing is written until every check has passed. A rejected package
// leaves no row, not even a partial one, because the single write happens
// after the last return above it.
func (uc *Usecase) Import(ctx context.Context, ownerID uuid.UUID, zipBytes []byte) (string, string, error) {
	p, err := validatePackage(zipBytes)
	if err != nil {
		return "", "", err
	}

	stored := Package{
		CourseID: p.courseID,
		Version:  p.version,
		Tier:     p.tier,
		Lang:     p.lang,
		Title:    p.title,
		Manifest: p.manifest,
		Blob:     zipBytes,
		// The uncompressed total this file just counted while expanding
		// the archive — never len(zipBytes). See MaxUncompressedBytes.
		Bytes: p.uncompressed,
	}

	if err := uc.repo.Put(ctx, ownerID, stored); err != nil {
		return "", "", classifyStorageError(err)
	}
	return p.courseID, p.version, nil
}

// List returns one Summary per course ownerID holds.
//
// The version ordering is computed here with compareSemver rather than
// inherited from ListForOwner's own ordering. Both apply the same rule
// today, but the catalog's "pinned" field is the one a reader follows,
// and it must not become wrong because a query's ORDER BY changed
// somewhere below.
func (uc *Usecase) List(ctx context.Context, ownerID uuid.UUID) ([]Summary, error) {
	pkgs, err := uc.repo.ListForOwner(ctx, ownerID)
	if err != nil {
		return nil, err
	}

	order := []string{}
	byCourse := map[string]*Summary{}
	for _, p := range pkgs {
		s, ok := byCourse[p.CourseID]
		if !ok {
			s = &Summary{CourseID: p.CourseID}
			byCourse[p.CourseID] = s
			order = append(order, p.CourseID)
		}
		s.Versions = append(s.Versions, p.Version)

		// Metadata is taken from the pinned version, not from whichever
		// row happened to arrive first: title, language and tier can all
		// change between versions of a course, and the catalog should
		// describe the one a reader would open.
		if s.Pinned == "" || compareSemver(p.Version, s.Pinned) > 0 {
			s.Pinned = p.Version
			s.Title = p.Title
			s.Lang = p.Lang
			s.Tier = p.Tier
		}
	}

	out := make([]Summary, 0, len(order))
	sort.Strings(order)
	for _, id := range order {
		s := byCourse[id]
		sort.SliceStable(s.Versions, func(i, j int) bool {
			return compareSemver(s.Versions[i], s.Versions[j]) < 0
		})
		out = append(out, *s)
	}
	return out, nil
}

// Asset returns the bytes of one file inside (courseID, version) as
// ownerID holds it.
//
// rawName arrives straight off the URL and is treated as hostile:
// fiber is configured with UnescapePath off, which means it does NOT
// collapse dot segments before routing, so "../../etc/passwd" reaches
// this function verbatim and a percent-encoded traversal reaches it still
// encoded. Both are unescaped and then checked here; see assetName.
//
// A package another owner holds is reported as ErrNotFound, never as a
// permission error — the distinction repo.go's ErrNotFound was built to
// erase would come straight back if this layer reintroduced it.
func (uc *Usecase) Asset(ctx context.Context, ownerID uuid.UUID, courseID, version, rawName string) ([]byte, error) {
	name, err := assetName(rawName)
	if err != nil {
		return nil, err
	}
	id, err := pathSafeParam("course id", courseID)
	if err != nil {
		return nil, err
	}
	v, err := pathSafeParam("version", version)
	if err != nil {
		return nil, err
	}

	p, err := uc.repo.Get(ctx, ownerID, id, v)
	if err != nil {
		return nil, err
	}

	zr, err := zip.NewReader(bytes.NewReader(p.Blob), int64(len(p.Blob)))
	if err != nil {
		// A stored package that will not open is not the caller's fault
		// and must not be reported as one: it is corruption on our side,
		// and it should reach the log as such.
		return nil, fmt.Errorf("course: stored package %s@%s is not a readable zip: %w", id, v, err)
	}

	// The FIRST entry whose name matches. That is only unambiguous because
	// validatePackage refuses a package carrying two entries under one
	// name — see the duplicate check there. Drop that check and this loop
	// silently starts serving a different file than the one the checks
	// ran over.
	for _, f := range zr.File {
		if f.Name != name {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("course: open %q in stored package %s@%s: %w", name, id, v, err)
		}
		defer rc.Close()

		// Capped even though the package passed the ceiling on the way
		// in: this decompresses data from the database, and "it was
		// checked once, years ago, by code that has since changed" is not
		// a reason to hand an unbounded reader to io.ReadAll.
		var buf bytes.Buffer
		n, err := io.Copy(&buf, io.LimitReader(rc, MaxUncompressedBytes+1))
		if err != nil {
			return nil, fmt.Errorf("course: read %q in stored package %s@%s: %w", name, id, v, err)
		}
		if n > MaxUncompressedBytes {
			return nil, fmt.Errorf("course: stored package %s@%s expands past the ceiling at %q", id, v, name)
		}
		return buf.Bytes(), nil
	}

	return nil, ErrNotFound
}

// --- validation --------------------------------------------------------

// parsedPackage is what validatePackage extracts: the columns a row
// needs, plus the manifest bytes exactly as they were packed.
type parsedPackage struct {
	courseID     string
	version      string
	title        string
	lang         string
	tier         string
	manifest     json.RawMessage
	uncompressed int64
}

// manifestDoc is the SUBSET of a manifest this server reads. Everything
// else in the document is carried through untouched — this struct is not
// a schema, and adding a field to it because docs/course-format.md lists
// one is how the second copy of validate.ts's rule table gets built by
// accident. Only add a field here if the server itself needs it.
type manifestDoc struct {
	ID      string `json:"id"`
	Title   string `json:"title"`
	Lang    string `json:"lang"`
	Version string `json:"version"`
	Tier    string `json:"tier"`
	Parts   []struct {
		Chapters []struct {
			File string `json:"file"`
		} `json:"chapters"`
	} `json:"parts"`
}

// validatePackage applies all four checks and returns what a row needs.
func validatePackage(zipBytes []byte) (parsedPackage, error) {
	var out parsedPackage

	zr, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return out, invalid("the upload is not a readable .zip archive")
	}

	// Every entry is walked exactly once. The running total is the
	// authoritative size: the per-entry sizes recorded in a zip's central
	// directory are attacker-supplied numbers, and a bomb that under-
	// declares them would sail past any check that trusted them. Counting
	// the bytes as they actually decompress cannot be lied to, and costs
	// nothing extra here because the loop has to read them anyway to know
	// whether the manifest is present.
	//
	// Work stays bounded even for an enormous bomb: the moment the total
	// passes the ceiling this returns, so at most MaxUncompressedBytes+1
	// bytes are ever expanded, whatever the archive claims to hold.
	// seen holds EVERY entry name, directories included; names holds only
	// the file entries a chapter.file may point at. They are two maps
	// because they answer two different questions and merging them would
	// weaken the second: a manifest naming "chapters/" as a chapter file
	// would start passing the existence check below.
	seen := make(map[string]struct{}, len(zr.File))
	names := make(map[string]struct{}, len(zr.File))
	var manifestBytes []byte
	haveManifest := false

	for _, f := range zr.File {
		if err := checkPackagePath(f.Name); err != nil {
			return out, err
		}
		// A zip may carry two entries under one name, and this loop and
		// Usecase.Asset would then disagree about which one the package
		// contains: this loop reads every entry (so the LAST manifest.json
		// is the one validated and stored), while Asset returns the FIRST
		// entry whose name matches (so the first is the one served). A
		// review measured the gap — [dirty manifest][chapter][clean
		// manifest] was accepted 201 with clean database columns and then
		// served a manifest declaring "file": "../../../etc/passwd", a
		// path no check had ever seen; the same two documents in the
		// reverse order were rejected 400.
		//
		// Refusing the duplicate here is what makes "the bytes that were
		// checked" and "the bytes that are served" the SAME bytes, by
		// construction. The alternative — a second check on the serving
		// side — would leave two rules that have to keep agreeing with
		// each other forever, which is the shape of this defect, not its
		// fix. (It is also the second time this subsystem has been bitten
		// by one datum with two readings: Task 2's C1 was a zip whose
		// central directory and local header named different files.)
		if _, dup := seen[f.Name]; dup {
			return out, invalid("the package contains two entries named %q; a name must identify one file, or the file that is checked is not the file that is served", f.Name)
		}
		seen[f.Name] = struct{}{}

		if strings.HasSuffix(f.Name, "/") {
			// A directory entry: no content, and nothing that a
			// chapter.file could ever point at.
			continue
		}
		names[f.Name] = struct{}{}

		rc, err := f.Open()
		if err != nil {
			return out, invalid("entry %q cannot be read", f.Name)
		}

		var dst io.Writer = io.Discard
		var manifestBuf bytes.Buffer
		if f.Name == manifestPath {
			dst = &manifestBuf
		}

		remaining := MaxUncompressedBytes - out.uncompressed
		n, copyErr := io.Copy(dst, io.LimitReader(rc, remaining+1))
		closeErr := rc.Close()
		out.uncompressed += n

		if out.uncompressed > MaxUncompressedBytes {
			return out, fmt.Errorf("%w: expanded contents exceed %d bytes", ErrTooLarge, MaxUncompressedBytes)
		}
		if copyErr != nil || closeErr != nil {
			return out, invalid("entry %q is corrupt", f.Name)
		}
		if f.Name == manifestPath {
			manifestBytes = manifestBuf.Bytes()
			haveManifest = true
		}
	}

	if !haveManifest {
		return out, invalid("no %s at the package root (a manifest inside a subdirectory does not count: pack that subdirectory instead)", manifestPath)
	}

	if !json.Valid(manifestBytes) {
		return out, invalid("%s is not valid JSON", manifestPath)
	}
	// json.Unmarshal into a struct ignores unknown fields and, more to the
	// point here, is happy with a JSON array. The explicit object check is
	// what turns `["not","an","object"]` into a manifest error rather than
	// a manifest full of empty strings.
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(manifestBytes, &probe); err != nil {
		return out, invalid("%s is not a JSON object", manifestPath)
	}
	var doc manifestDoc
	if err := json.Unmarshal(manifestBytes, &doc); err != nil {
		return out, invalid("%s does not have the shape of a manifest", manifestPath)
	}

	// The fields this server needs to store, list and serve the package.
	// Everything validate.ts additionally requires of a REGISTRY
	// submission (license, authors, generatedBy, runtime, description, and
	// the semver/caret-range syntax rules) is intentionally absent — see
	// the file comment.
	for _, req := range []struct{ name, value string }{
		{"id", doc.ID},
		{"title", doc.Title},
		{"lang", doc.Lang},
		{"version", doc.Version},
		{"tier", doc.Tier},
	} {
		if req.value == "" {
			return out, invalid("%s is missing a non-empty %q", manifestPath, req.name)
		}
	}

	// id and version become path segments in every URL that serves this
	// package, so they are held to the same rule as any other path.
	courseID, err := pathSafeParam("manifest id", doc.ID)
	if err != nil {
		return out, err
	}
	version, err := pathSafeParam("manifest version", doc.Version)
	if err != nil {
		return out, err
	}

	// tier drives a CHECK constraint one layer down. Catching it here
	// turns an opaque SQLSTATE 23514 into a sentence that names the two
	// legal values.
	if doc.Tier != "content" && doc.Tier != "interactive" {
		return out, invalid("%s declares tier %q; it must be %q or %q", manifestPath, doc.Tier, "content", "interactive")
	}

	if len(doc.Parts) == 0 {
		return out, invalid("%s has no parts", manifestPath)
	}
	for i, part := range doc.Parts {
		if len(part.Chapters) == 0 {
			return out, invalid("%s: part %d has no chapters", manifestPath, i+1)
		}
		for _, ch := range part.Chapters {
			if ch.File == "" {
				return out, invalid("%s: a chapter has no file", manifestPath)
			}
			if err := checkPackagePath(ch.File); err != nil {
				return out, err
			}
			if _, ok := names[ch.File]; !ok {
				return out, invalid("%s names chapter file %q, which is not in the package", manifestPath, ch.File)
			}
		}
	}

	out.courseID = courseID
	out.version = version
	out.title = doc.Title
	out.lang = doc.Lang
	out.tier = doc.Tier
	out.manifest = json.RawMessage(manifestBytes)
	return out, nil
}

// checkPackagePath is the PATH_ESCAPE rule, and it is deliberately the
// same four clauses as packages/course-format/src/validate.ts's
// escapesPackage — empty, contains a backslash, starts with "/", or has a
// ".." segment — so a package `tuhoc pack` produced cannot be rejected
// here for a reason pack never warned about.
//
// Note the last clause tests SEGMENTS, not a substring: a file honestly
// named "notes..draft.html" contains ".." and escapes nothing. Being
// stricter than pack is the dangerous direction (it rejects packages that
// were built correctly); being equal is the point.
func checkPackagePath(p string) error {
	if p == "" {
		return invalid("the package contains an entry with an empty path")
	}
	if strings.Contains(p, "\x00") {
		return invalid("path %q contains a NUL byte", p)
	}
	if strings.Contains(p, `\`) {
		return invalid("path %q uses backslashes; package paths are relative and use %q", p, "/")
	}
	if strings.HasPrefix(p, "/") {
		return invalid("path %q is absolute; package paths are relative to the package root", p)
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return invalid("path %q walks outside the package root", p)
		}
	}
	return nil
}

// assetName turns the raw wildcard segment of an asset URL into a name to
// look up inside the package, or refuses.
//
// The unescape happens FIRST and is not optional. Fiber's UnescapePath is
// off, so "%2e%2e%2f" arrives as those nine literal characters — a name
// that contains no ".." at all until it is decoded, and would sail past a
// check applied to the raw string. This was measured against this fiber
// version rather than assumed; see TestGetAssetCannotEscapePackage, which
// sends both the plain and the encoded form.
func assetName(raw string) (string, error) {
	name, err := url.PathUnescape(raw)
	if err != nil {
		return "", invalid("the asset path is not valid percent-encoding")
	}
	if err := checkPackagePath(name); err != nil {
		return "", err
	}
	return name, nil
}

// pathSafeParam guards the two URL segments that identify a package. They
// are database keys rather than filesystem paths, so nothing here can
// traverse a directory — but they are also interpolated into every asset
// URL, and an id containing a slash would produce links that address a
// different package than the one they name.
func pathSafeParam(what, raw string) (string, error) {
	v, err := url.PathUnescape(raw)
	if err != nil {
		return "", invalid("the %s is not valid percent-encoding", what)
	}
	if v == "" {
		return "", invalid("the %s is empty", what)
	}
	if v == "." || v == ".." || strings.ContainsAny(v, `/\`) || strings.Contains(v, "\x00") {
		return "", invalid("the %s %q cannot appear in a URL path", what, v)
	}
	return v, nil
}

// --- storage failures --------------------------------------------------

// classifyStorageError turns whatever Repo.Put returned into an error the
// HTTP layer can map to a status. There are five paths, and ruling S1-F13
// is about the two in the middle: `CHECK (bytes >= 0)` and
// `CHECK (tier IN (...))` are both SQLSTATE 23514 and have nothing else
// in common, so a classifier that keyed on the code alone would answer a
// user who sent a strange tier and a server that computed a nonsense size
// with the same meaningless sentence.
//
//  1. 23514 on the tier constraint — the sender declared a tier that is
//     not one of the two legal values. Their fault: 400. (Import checks
//     tier itself, so this is the second lock, reachable only if the two
//     lists ever disagree.)
//  2. 23514 on anything else — today that is `bytes >= 0`, a column this
//     file computes and the client never touches. A negative value there
//     is a bug in the counting above, not a bad upload: 500, and it
//     belongs in the log with the rest of our own mistakes.
//  3. 23503, the owner_id foreign key — the authenticated user's row is
//     gone (deleted mid-request). Nothing the client can fix: 500.
//  4. 22P05 — a payload Postgres cannot represent. The measured case is a
//     NUL escape inside the manifest, which encoding/json accepts and
//     jsonb refuses (see repo.go's Manifest doc). The client's bytes, so:
//     400.
//  5. anything else — a real infrastructure failure: 500.
//
// Constraint names are matched by substring rather than in full because
// Postgres generates them from the table and column names, and pinning
// the generated spelling here would be pinning an implementation detail
// of the database. TestCourseHTTPContracts checks the substrings against
// the names a real Postgres reports, so a rename cannot silently move a
// case from path 1 to path 2.
func classifyStorageError(err error) error {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return err // path 5
	}

	switch pgErr.Code {
	case pgerrcode.CheckViolation:
		if strings.Contains(pgErr.ConstraintName, "tier") {
			return invalid("the manifest's tier is not one this server stores") // path 1
		}
		return err // path 2
	case pgerrcode.ForeignKeyViolation:
		return err // path 3
	case pgerrcode.UntranslatableCharacter:
		// path 4
		return invalid("%s contains a character the database cannot store (most often a \\u0000 escape inside a string)", manifestPath)
	default:
		return err // path 5
	}
}

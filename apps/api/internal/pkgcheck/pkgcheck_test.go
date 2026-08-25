// Unit tests for rules and behaviour the shared fixtures/format-v2 corpus
// does not exercise: FORM_TAG and TAG_ATTR_FLOOD have no hostile/<case>
// directory of their own (contract_test.go's own file comment explains the
// corpus split — six content cases plus valid-course belong to this task,
// the five widget-* cases to Task 7, and neither list names a form-tag or
// tag-attr-flood case, because none exists). The two widget exemptions the
// task brief calls out as security-critical are covered directly here too,
// rather than resting only on valid-course's indirect coverage.
package pkgcheck

import (
	"archive/zip"
	"bytes"
	"fmt"
	"strings"
	"testing"
)

// buildZip packages files (path -> content) into zip bytes, for tests that
// need a specific hostile shape the fixture corpus does not carry.
func buildZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zw.Create(%q): %v", name, err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatalf("write %q: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("closing zip writer: %v", err)
	}
	return buf.Bytes()
}

// zipEntry is one (name, content) pair for buildZipFromEntries — a slice,
// not buildZip's map, specifically so a test can write two entries under
// the same name. A Go map cannot hold a duplicate key, which is exactly
// the shape TestDuplicateEntryIsFlagged needs to build.
type zipEntry struct {
	name, content string
}

// buildZipFromEntries is buildZip's sibling for tests that need entries in
// a specific order or sharing a name — archive/zip.Writer does not itself
// refuse a repeated name; it is Validate's job to.
func buildZipFromEntries(t *testing.T, entries []zipEntry) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		w, err := zw.Create(e.name)
		if err != nil {
			t.Fatalf("zw.Create(%q): %v", e.name, err)
		}
		if _, err := w.Write([]byte(e.content)); err != nil {
			t.Fatalf("write %q: %v", e.name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("closing zip writer: %v", err)
	}
	return buf.Bytes()
}

// minimalManifest is a manifest that passes every package-shape rule on
// its own, so a test built on top of it isolates the ONE rule it means to
// exercise.
const minimalManifest = `{
  "id": "unit-test",
  "title": "Unit test package",
  "description": "",
  "lang": "vi",
  "version": "1.0.0",
  "runtime": "^1",
  "license": "CC0-1.0",
  "authors": [{"name": "test"}],
  "generatedBy": "ai",
  "parts": [{"title": "Part", "chapters": [
    {"id": "c1", "num": "1", "title": "C1", "short": "C1", "file": "chapters/c1.html"}
  ]}]
}`

func hasCode(findings []Finding, code string) bool {
	for _, f := range findings {
		if f.Code == code {
			return true
		}
	}
	return false
}

func TestFormTagIsFlagged(t *testing.T) {
	findings, pkg, err := Validate(buildZip(t, map[string]string{
		"manifest.json":    minimalManifest,
		"chapters/c1.html": `<form action="/x"><input name="y"></form>`,
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if pkg != nil {
		t.Fatal("a package carrying <form> must be rejected, got a non-nil Package")
	}
	if !hasCode(findings, "FORM_TAG") {
		t.Fatalf("expected FORM_TAG among findings, got %+v", findings)
	}
}

func TestTagAttrFloodIsFlagged(t *testing.T) {
	var b strings.Builder
	b.WriteString("<div")
	for i := 0; i <= maxAttrsPerTag; i++ {
		fmt.Fprintf(&b, ` data-a%d="1"`, i)
	}
	b.WriteString("></div>")

	findings, pkg, err := Validate(buildZip(t, map[string]string{
		"manifest.json":    minimalManifest,
		"chapters/c1.html": b.String(),
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if pkg != nil {
		t.Fatal("a package carrying a flooded tag must be rejected, got a non-nil Package")
	}
	if !hasCode(findings, "TAG_ATTR_FLOOD") {
		t.Fatalf("expected TAG_ATTR_FLOOD among findings, got %+v", findings)
	}
}

func TestTagAttrFloodDoesNotFireBelowCeiling(t *testing.T) {
	var b strings.Builder
	b.WriteString("<div")
	for i := 0; i < maxAttrsPerTag; i++ {
		fmt.Fprintf(&b, ` data-a%d="1"`, i)
	}
	b.WriteString("></div>")

	findings, _, err := Validate(buildZip(t, map[string]string{
		"manifest.json":    minimalManifest,
		"chapters/c1.html": b.String(),
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if hasCode(findings, "TAG_ATTR_FLOOD") {
		t.Fatalf("a tag at exactly maxAttrsPerTag must not flood, got %+v", findings)
	}
}

// TestWidgetDirExemptFromJSFileInPackage is the first of the two widget
// exemptions the task brief calls "deliberate" and "must reproduce": a
// path under widgets/<name>/, at any depth, does not trigger
// JS_FILE_IN_PACKAGE even though it is unmistakably a .js file.
func TestWidgetDirExemptFromJSFileInPackage(t *testing.T) {
	findings, _, err := Validate(buildZip(t, map[string]string{
		"manifest.json":           minimalManifest,
		"chapters/c1.html":        `<p>hi</p>`,
		"widgets/demo/index.html": `<!doctype html><html><body>ok</body></html>`,
		"widgets/demo/extra.js":   `console.log("a widget's own script, shipped on purpose");`,
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if hasCode(findings, "JS_FILE_IN_PACKAGE") {
		t.Fatalf("widgets/demo/extra.js must be exempt from JS_FILE_IN_PACKAGE, got %+v", findings)
	}
}

// TestWidgetExtraFileStillContentScanned is the documented ASYMMETRY: the
// JS_FILE_IN_PACKAGE exemption for widgets/<name>/ does not extend to the
// content scan. A non-index file under a widget directory is still read
// by scanHTMLText like any other package entry — Task 7's WIDGET_EXTRA_FILE
// is what is meant to catch a bad file living there, and this test only
// proves the content scan has not ALSO been silenced for that path, which
// would be the wrong direction to over-trust a widget's own directory.
func TestWidgetExtraFileStillContentScanned(t *testing.T) {
	findings, _, err := Validate(buildZip(t, map[string]string{
		"manifest.json":           minimalManifest,
		"chapters/c1.html":        `<p>hi</p>`,
		"widgets/demo/index.html": `<!doctype html><html><body>ok</body></html>`,
		// Not valid JavaScript, but that is irrelevant: scanHTMLText reads
		// EVERY package entry as bytes that might contain markup, with no
		// extension list and no "looks binary" skip (see content.go).
		"widgets/demo/other.js": `var s = "<script>evil()</script>";`,
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if !hasCode(findings, "SCRIPT_TAG") {
		t.Fatalf("widgets/demo/other.js must still go through the content scan (over-report is the documented posture here), got %+v", findings)
	}
}

// TestWidgetIndexExemptFromContentScan is the second of the two widget
// exemptions: widgets/<name>/index.html, and ONLY that exact file, is
// skipped by the content scan — it is expected to carry the <script> a
// widget needs, and Task 7's rules read it instead.
func TestWidgetIndexExemptFromContentScan(t *testing.T) {
	findings, _, err := Validate(buildZip(t, map[string]string{
		"manifest.json":    minimalManifest,
		"chapters/c1.html": `<p>hi</p>`,
		"widgets/demo/index.html": `<!doctype html><html><body>
<script>console.log("a widget's own script is expected here");</script>
</body></html>`,
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if hasCode(findings, "SCRIPT_TAG") {
		t.Fatalf("widgets/demo/index.html must be exempt from the content scan, got %+v", findings)
	}
}

// TestManifestExemptFromContentScan pins the OTHER content-scan exemption:
// manifest.json's fields are rendered as text by the catalog, so markup
// inside them (a title or description that happens to contain the literal
// text "<script>") must not trip the content rules.
func TestManifestExemptFromContentScan(t *testing.T) {
	manifest := `{
  "id": "unit-test",
  "title": "A course about <script> tags",
  "description": "",
  "lang": "vi",
  "version": "1.0.0",
  "runtime": "^1",
  "license": "CC0-1.0",
  "authors": [{"name": "test"}],
  "generatedBy": "ai",
  "parts": [{"title": "Part", "chapters": [
    {"id": "c1", "num": "1", "title": "C1", "short": "C1", "file": "chapters/c1.html"}
  ]}]
}`
	findings, pkg, err := Validate(buildZip(t, map[string]string{
		"manifest.json":    manifest,
		"chapters/c1.html": `<p>hi</p>`,
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if hasCode(findings, "SCRIPT_TAG") {
		t.Fatalf("manifest.json must be exempt from the content scan, got %+v", findings)
	}
	if pkg == nil {
		t.Fatalf("expected a clean package, got findings %+v", findings)
	}
	if pkg.Title != "A course about <script> tags" {
		t.Errorf("Package.Title should carry the manifest's title verbatim, got %q", pkg.Title)
	}
}

// TestChapterWidgetNamesDedupesInOrder pins Chapter.WidgetNames's own
// documented contract — deduplicated, in the order first seen — which
// deliberately differs from validate.ts's extractWidgetRefs (that
// function does NOT dedupe; see this field's doc comment in pkgcheck.go
// for why the two have different jobs).
func TestChapterWidgetNamesDedupesInOrder(t *testing.T) {
	findings, pkg, err := Validate(buildZip(t, map[string]string{
		"manifest.json": minimalManifest,
		"chapters/c1.html": `<p>one</p>
<div data-widget="b"></div>
<div data-widget="a"></div>
<div data-widget="b"></div>`,
		"widgets/a/index.html": `<!doctype html><html><body>a</body></html>`,
		"widgets/b/index.html": `<!doctype html><html><body>b</body></html>`,
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if pkg == nil {
		t.Fatalf("expected a clean package, got findings %+v", findings)
	}
	if len(pkg.Chapters) != 1 {
		t.Fatalf("expected 1 chapter, got %d", len(pkg.Chapters))
	}
	got := pkg.Chapters[0].WidgetNames
	want := []string{"b", "a"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("WidgetNames = %v, want %v (first-seen order, deduplicated)", got, want)
	}
}

func TestEmptyZipIsEmptyPackage(t *testing.T) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	if err := zw.Close(); err != nil {
		t.Fatalf("closing empty zip writer: %v", err)
	}

	findings, pkg, err := Validate(buf.Bytes())
	if err != nil {
		t.Fatalf("an empty zip is hostile input, not a system error: %v", err)
	}
	if pkg != nil {
		t.Fatal("an empty package must not produce a Package")
	}
	if !hasCode(findings, "EMPTY_PACKAGE") {
		t.Fatalf("expected EMPTY_PACKAGE, got %+v", findings)
	}
}

func TestNotAZipIsReportedAsFindingNotError(t *testing.T) {
	findings, pkg, err := Validate([]byte("this is not a zip file at all"))
	if err != nil {
		t.Fatalf("garbage bytes are hostile input, not a system error — Validate's own contract says so: %v", err)
	}
	if pkg != nil {
		t.Fatal("garbage bytes must not produce a Package")
	}
	if len(findings) == 0 {
		t.Fatal("expected at least one finding for unreadable input")
	}
}

func TestPathEscapeInZipEntry(t *testing.T) {
	findings, pkg, err := Validate(buildZip(t, map[string]string{
		"manifest.json":       minimalManifest,
		"chapters/c1.html":    `<p>hi</p>`,
		"../../../etc/passwd": "root:x:0:0::/root:/bin/sh",
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if pkg != nil {
		t.Fatal("a package with a path-escaping entry must be rejected")
	}
	if !hasCode(findings, "PATH_ESCAPE") {
		t.Fatalf("expected PATH_ESCAPE, got %+v", findings)
	}
}

// TestDuplicateEntryIsFlagged pins the fix for review round 1's finding 1:
// a repeated zip entry name used to resolve silently to "last one wins"
// (ordinary Go map assignment), on the reasoning that the map Validate
// builds is the only copy of the bytes anyone reads again. That premise
// was false — Task 8 stores the raw zip and Task 9's rollback path
// re-parses it later — and the shape is exactly the one
// internal/course/usecase.go's own comment names as a MEASURED exploit
// against the code this package replaces: a
// [dirty manifest][chapter][clean manifest] archive accepted with a 201
// and then served a manifest naming a path no check had ever seen. This
// test reproduces that shape directly rather than a minimal two-entries
// case, so a future change that "fixes" the general check but leaves this
// specific ordering alone still fails loudly.
//
// DUPLICATE_ENTRY has no member in validate.ts's FINDING_CODES; it is an
// UnsafeArchiveCode there (course-format/src/zip.ts), the archive-reading
// layer's own code, not the rule layer's. Go's Validate collapses both
// layers into one function, so this is reported as a Finding here the
// same way PATH_ESCAPE and TOO_LARGE already are — see the comment at the
// duplicate-name check in pkgcheck.go for the full reasoning, and
// TestHostileCorpusIsFullyAccountedFor / TestGoOnlyCodesAreNotDoubleCounted
// in contract_test.go for where that split is pinned as a test rather
// than left as a comment only.
func TestDuplicateEntryIsFlagged(t *testing.T) {
	dirtyManifest := strings.Replace(minimalManifest, `"file": "chapters/c1.html"`, `"file": "../../../etc/passwd"`, 1)
	if dirtyManifest == minimalManifest {
		t.Fatal("test fixture bug: the chapter-file replacement did not match minimalManifest")
	}

	findings, pkg, err := Validate(buildZipFromEntries(t, []zipEntry{
		{"manifest.json", dirtyManifest},
		{"chapters/c1.html", `<p>hi</p>`},
		{"manifest.json", minimalManifest}, // the "clean" manifest, written last
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if pkg != nil {
		t.Fatal("a package with two manifest.json entries must be rejected outright, regardless of which one a naive reader would pick")
	}
	if !hasCode(findings, "DUPLICATE_ENTRY") {
		t.Fatalf("expected DUPLICATE_ENTRY, got %+v", findings)
	}
}

// --- package-shape rules the shared corpus does not cover -----------------
//
// fixtures/format-v2/hostile/ holds only the six content cases and Task 7's
// five widget cases (see contract_test.go's own file comment). None of the
// eleven package-shape codes below has a corpus fixture, so — the same
// reasoning that produced TestFormTagIsFlagged/TestTagAttrFloodIsFlagged
// above — each gets its own direct test rather than resting on "the corpus
// happens to exercise it".

func TestManifestMissingIsFlagged(t *testing.T) {
	findings, pkg, err := Validate(buildZip(t, map[string]string{
		"chapters/c1.html": `<p>a package with no manifest.json at all</p>`,
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if pkg != nil {
		t.Fatal("a package with no manifest.json must be rejected")
	}
	if !hasCode(findings, "MANIFEST_MISSING") {
		t.Fatalf("expected MANIFEST_MISSING, got %+v", findings)
	}
}

func TestManifestParseInvalidJSON(t *testing.T) {
	findings, pkg, err := Validate(buildZip(t, map[string]string{
		"manifest.json": `{not valid json`,
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if pkg != nil {
		t.Fatal("a package with unparseable manifest.json must be rejected")
	}
	if !hasCode(findings, "MANIFEST_PARSE") {
		t.Fatalf("expected MANIFEST_PARSE, got %+v", findings)
	}
}

// TestManifestParseNull pins the fix for a hostile input the corpus does
// not carry and the original fidelity review missed: manifest.json
// containing exactly the JSON literal null. json.Unmarshal into a
// map[string]any returns no error and leaves the map nil for that one
// input (see the comment at the null check in Validate), so without an
// explicit check this fell through into checkManifestFields, which read
// the nil map as "every field absent" and reported roughly nine
// MANIFEST_FIELD findings instead of the single MANIFEST_PARSE
// validate.ts's isRecord (v !== null) reports for the same input.
func TestManifestParseNull(t *testing.T) {
	findings, pkg, err := Validate(buildZip(t, map[string]string{
		"manifest.json": `null`,
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if pkg != nil {
		t.Fatal("a package whose manifest.json is the JSON literal null must be rejected")
	}
	if !hasCode(findings, "MANIFEST_PARSE") {
		t.Fatalf("expected MANIFEST_PARSE, got %+v", findings)
	}
	if hasCode(findings, "MANIFEST_FIELD") {
		t.Fatalf("a null manifest must stop at MANIFEST_PARSE, matching validate.ts, not fall through to per-field checks — got %+v", findings)
	}
}

func TestManifestFieldMissingRequiredFields(t *testing.T) {
	findings, pkg, err := Validate(buildZip(t, map[string]string{
		"manifest.json": `{"id": "x"}`,
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if pkg != nil {
		t.Fatal("a manifest missing title/lang/version/runtime/license/authors/parts must be rejected")
	}
	if !hasCode(findings, "MANIFEST_FIELD") {
		t.Fatalf("expected MANIFEST_FIELD, got %+v", findings)
	}
}

func TestSemverIsFlagged(t *testing.T) {
	manifest := strings.Replace(minimalManifest, `"version": "1.0.0",`, `"version": "not-a-semver",`, 1)
	if manifest == minimalManifest {
		t.Fatal("test fixture bug: the version replacement did not match minimalManifest")
	}
	findings, pkg, err := Validate(buildZip(t, map[string]string{
		"manifest.json":    manifest,
		"chapters/c1.html": `<p>hi</p>`,
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if pkg != nil {
		t.Fatal("a manifest with a non-semver version must be rejected")
	}
	if !hasCode(findings, "SEMVER") {
		t.Fatalf("expected SEMVER, got %+v", findings)
	}
}

func TestRuntimeRangeIsFlagged(t *testing.T) {
	manifest := strings.Replace(minimalManifest, `"runtime": "^1",`, `"runtime": ">=1",`, 1)
	if manifest == minimalManifest {
		t.Fatal("test fixture bug: the runtime replacement did not match minimalManifest")
	}
	findings, pkg, err := Validate(buildZip(t, map[string]string{
		"manifest.json":    manifest,
		"chapters/c1.html": `<p>hi</p>`,
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if pkg != nil {
		t.Fatal("a manifest with a non-caret-range runtime must be rejected")
	}
	if !hasCode(findings, "RUNTIME_RANGE") {
		t.Fatalf("expected RUNTIME_RANGE, got %+v", findings)
	}
}

const duplicateChapterIDManifest = `{
  "id": "unit-test",
  "title": "Unit test package",
  "description": "",
  "lang": "vi",
  "version": "1.0.0",
  "runtime": "^1",
  "license": "CC0-1.0",
  "authors": [{"name": "test"}],
  "generatedBy": "ai",
  "parts": [{"title": "Part", "chapters": [
    {"id": "c1", "num": "1", "title": "C1a", "short": "C1a", "file": "chapters/c1.html"},
    {"id": "c1", "num": "2", "title": "C1b", "short": "C1b", "file": "chapters/c2.html"}
  ]}]
}`

func TestDuplicateChapterIDIsFlagged(t *testing.T) {
	findings, pkg, err := Validate(buildZip(t, map[string]string{
		"manifest.json":    duplicateChapterIDManifest,
		"chapters/c1.html": `<p>one</p>`,
		"chapters/c2.html": `<p>two</p>`,
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if pkg != nil {
		t.Fatal("a manifest with two chapters sharing one id must be rejected")
	}
	if !hasCode(findings, "DUPLICATE_CHAPTER_ID") {
		t.Fatalf("expected DUPLICATE_CHAPTER_ID, got %+v", findings)
	}
	// Both chapter files genuinely exist — isolates DUPLICATE_CHAPTER_ID
	// from CHAPTER_FILE_MISSING so this test fails only if THIS rule breaks.
	if hasCode(findings, "CHAPTER_FILE_MISSING") {
		t.Fatalf("test fixture bug: both chapter files exist, CHAPTER_FILE_MISSING should not fire — got %+v", findings)
	}
}

func TestChapterFileMissingIsFlagged(t *testing.T) {
	findings, pkg, err := Validate(buildZip(t, map[string]string{
		"manifest.json": minimalManifest,
		// chapters/c1.html deliberately absent: the manifest names it, the
		// package does not carry it.
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if pkg != nil {
		t.Fatal("a manifest naming a chapter file the package does not carry must be rejected")
	}
	if !hasCode(findings, "CHAPTER_FILE_MISSING") {
		t.Fatalf("expected CHAPTER_FILE_MISSING, got %+v", findings)
	}
}

func TestTooLargeIsFlagged(t *testing.T) {
	// Highly compressible on purpose: DEFLATE squeezes MaxUncompressedBytes
	// of one repeated byte down to a few KiB, so the test zip stays small
	// and fast to build even though it must decompress past the budget.
	big := strings.Repeat("a", MaxUncompressedBytes+4096)
	findings, pkg, err := Validate(buildZip(t, map[string]string{
		"manifest.json":    minimalManifest,
		"chapters/c1.html": big,
	}))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if pkg != nil {
		t.Fatal("a package whose decompressed size exceeds the budget must be rejected")
	}
	if !hasCode(findings, "TOO_LARGE") {
		t.Fatalf("expected TOO_LARGE, got %+v", findings)
	}
}

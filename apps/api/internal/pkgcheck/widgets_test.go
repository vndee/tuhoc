// Unit tests for the eight widget rules (widgets.go) beyond what
// fixtures/format-v2/hostile/ covers via contract_test.go's
// TestHostileWidgetCases.
//
// Three rules need GENERATED content the corpus deliberately does not
// carry in git — a 128 KiB widget, a 500-byte line, an over-length name —
// mirroring how TestFormTagIsFlagged/TestTagAttrFloodIsFlagged in
// pkgcheck_test.go cover FORM_TAG/TAG_ATTR_FLOOD, the two content rules
// with no hostile/<case> directory of their own either.
//
// The rest of this file pins the "details that bite" the task brief calls
// out by name: isRealWidget's directory-with-only-a-stray-file distinction
// (widgets.ts's own review round 1 finding), WIDGET_MISSING's per-chapter
// dedup, an empty data-widget="" getting its own detail sentence instead of
// naming a widget called "", data-widget read case-insensitively, and the
// path-sorted (not name-sorted) order groupWidgetFiles produces.
package pkgcheck

import (
	"fmt"
	"strings"
	"testing"
)

// validWidgetHTML is the task brief's own "must validate clean" example: a
// self-contained counter button, nothing minified, nothing networked.
// Matches packages/course-format/src/widgets.test.ts's VALID_WIDGET_HTML so
// a failure in one rule's test can't be blamed on an unrelated one.
const validWidgetHTML = `<style>button{font-size:2rem}</style>
<button id="b">0</button>
<script>
  let n = 0;
  document.getElementById('b').addEventListener('click', () => {
    n += 1;
    document.getElementById('b').textContent = String(n);
  });
</script>`

// mustValidate runs Validate over files (built with buildZip) and fails the
// test on any unexpected system error — every test below is exercising a
// hostile PACKAGE, never a Go-level failure, so a non-nil err is always a
// test-harness bug, not the thing under test.
func mustValidate(t *testing.T, files map[string]string) []Finding {
	t.Helper()
	findings, _, err := Validate(buildZip(t, files))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	return findings
}

func findByCode(findings []Finding, code string) *Finding {
	for i := range findings {
		if findings[i].Code == code {
			return &findings[i]
		}
	}
	return nil
}

// --- WIDGET_TOO_LARGE: generated content, no fixture --------------------

func TestWidgetTooLargeGenerated(t *testing.T) {
	atCap := mustValidate(t, map[string]string{
		"manifest.json":        minimalManifest,
		"chapters/c1.html":     `<div data-widget="w"></div>`,
		"widgets/w/index.html": strings.Repeat("a", widgetMaxBytes),
	})
	if hasCode(atCap, "WIDGET_TOO_LARGE") {
		t.Fatalf("exactly widgetMaxBytes must not trip WIDGET_TOO_LARGE, got %+v", atCap)
	}

	overCap := mustValidate(t, map[string]string{
		"manifest.json":        minimalManifest,
		"chapters/c1.html":     `<div data-widget="w"></div>`,
		"widgets/w/index.html": strings.Repeat("a", widgetMaxBytes+1),
	})
	f := findByCode(overCap, "WIDGET_TOO_LARGE")
	if f == nil {
		t.Fatalf("widgetMaxBytes+1 must trip WIDGET_TOO_LARGE, got %+v", overCap)
	}
	if f.Path != "widgets/w/index.html" {
		t.Errorf("WIDGET_TOO_LARGE path = %q, want widgets/w/index.html", f.Path)
	}
	if !strings.Contains(f.Detail, fmt.Sprintf("%d", widgetMaxBytes+1)) {
		t.Errorf("detail should name the actual byte count %d, got %q", widgetMaxBytes+1, f.Detail)
	}
}

// --- WIDGET_LINE_TOO_LONG: generated content, no fixture -----------------

func TestWidgetLineTooLongGenerated(t *testing.T) {
	atCap := mustValidate(t, map[string]string{
		"manifest.json":        minimalManifest,
		"chapters/c1.html":     `<p>a</p>`,
		"widgets/w/index.html": strings.Repeat("a", widgetMaxLineBytes),
	})
	if hasCode(atCap, "WIDGET_LINE_TOO_LONG") {
		t.Fatalf("a line at exactly widgetMaxLineBytes must not trip WIDGET_LINE_TOO_LONG, got %+v", atCap)
	}

	longLine := strings.Repeat("a", widgetMaxLineBytes+1)
	overCap := mustValidate(t, map[string]string{
		"manifest.json":           minimalManifest,
		"chapters/c1.html":        `<div data-widget="long"></div>`,
		"widgets/long/index.html": "<p>ok</p>\n" + longLine + "\n<p>ok too</p>",
	})
	f := findByCode(overCap, "WIDGET_LINE_TOO_LONG")
	if f == nil {
		t.Fatalf("widgetMaxLineBytes+1 must trip WIDGET_LINE_TOO_LONG, got %+v", overCap)
	}
	// The long line is line 2 (1-based): line 1 is "<p>ok</p>".
	if !strings.Contains(f.Detail, "line 2") {
		t.Errorf("detail should name line 2, got %q", f.Detail)
	}

	// A Vietnamese line SHORTER than the cap in RUNE COUNT but LONGER in
	// BYTE COUNT ('ơ' is 2 bytes in UTF-8) must still be caught — pins the
	// byte-not-character measurement the task brief calls out explicitly,
	// mirroring widgets.test.ts's own pinned diacritics test.
	vnLine := strings.Repeat("ơ", widgetMaxLineBytes/2+1)
	if len([]rune(vnLine)) >= widgetMaxLineBytes {
		t.Fatalf("test fixture bug: vnLine has %d runes, must be under widgetMaxLineBytes to prove the byte-not-rune point", len([]rune(vnLine)))
	}
	if len(vnLine) <= widgetMaxLineBytes {
		t.Fatalf("test fixture bug: vnLine has %d bytes, must be OVER widgetMaxLineBytes to prove the byte-not-rune point", len(vnLine))
	}
	vnFindings := mustValidate(t, map[string]string{
		"manifest.json":        minimalManifest,
		"chapters/c1.html":     `<p>a</p>`,
		"widgets/w/index.html": vnLine,
	})
	if !hasCode(vnFindings, "WIDGET_LINE_TOO_LONG") {
		t.Fatalf("a Vietnamese line shorter in RUNES but longer in BYTES than widgetMaxLineBytes must still trip WIDGET_LINE_TOO_LONG — got %+v", vnFindings)
	}
}

// --- WIDGET_BAD_NAME: generated content, no fixture -----------------------

func TestWidgetBadNameGenerated(t *testing.T) {
	tooLong := strings.Repeat("a", widgetNameMax+1)
	findings := mustValidate(t, map[string]string{
		"manifest.json":                      minimalManifest,
		"chapters/c1.html":                   `<p>a</p>`,
		"widgets/" + tooLong + "/index.html": validWidgetHTML,
	})
	if !hasCode(findings, "WIDGET_BAD_NAME") {
		t.Fatalf("a name over widgetNameMax characters must trip WIDGET_BAD_NAME, got %+v", findings)
	}

	atCapName := strings.Repeat("a", widgetNameMax)
	findings = mustValidate(t, map[string]string{
		"manifest.json":                        minimalManifest,
		"chapters/c1.html":                     fmt.Sprintf(`<div data-widget="%s"></div>`, atCapName),
		"widgets/" + atCapName + "/index.html": validWidgetHTML,
	})
	if hasCode(findings, "WIDGET_BAD_NAME") {
		t.Fatalf("a name at exactly widgetNameMax characters must not trip WIDGET_BAD_NAME, got %+v", findings)
	}

	findings = mustValidate(t, map[string]string{
		"manifest.json":               minimalManifest,
		"chapters/c1.html":            `<p>a</p>`,
		"widgets/Bad_Name/index.html": validWidgetHTML,
	})
	f := findByCode(findings, "WIDGET_BAD_NAME")
	if f == nil {
		t.Fatalf("uppercase/underscore in a widget name must trip WIDGET_BAD_NAME, got %+v", findings)
	}
	if !strings.Contains(f.Detail, "Bad_Name") {
		t.Errorf("detail should name the offending name, got %q", f.Detail)
	}
}

// --- WIDGET_FORBIDDEN_API: all four APIs, not only the one the fixture --
// --- corpus happens to use (localStorage) ------------------------------

func TestWidgetForbiddenAPIAllFourCaught(t *testing.T) {
	for _, api := range widgetForbiddenAPIs {
		api := api
		t.Run(api, func(t *testing.T) {
			name := "w-" + sanitizeForWidgetName(api)
			findings := mustValidate(t, map[string]string{
				"manifest.json":                   minimalManifest,
				"chapters/c1.html":                fmt.Sprintf(`<div data-widget="%s"></div>`, name),
				"widgets/" + name + "/index.html": fmt.Sprintf("<script>%s</script>", api),
			})
			f := findByCode(findings, "WIDGET_FORBIDDEN_API")
			if f == nil {
				t.Fatalf("API %q must be caught, got %+v", api, findings)
			}
			if !strings.Contains(f.Detail, api) {
				t.Errorf("detail should name the API %q, got %q", api, f.Detail)
			}
		})
	}
}

func sanitizeForWidgetName(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// --- WIDGET_EXTRA_FILE: even nested in a subdirectory --------------------

func TestWidgetExtraFileCaughtEvenInSubdirectory(t *testing.T) {
	findings := mustValidate(t, map[string]string{
		"manifest.json":             minimalManifest,
		"chapters/c1.html":          `<div data-widget="w"></div>`,
		"widgets/w/index.html":      validWidgetHTML,
		"widgets/w/assets/chart.js": `export function draw() {}`,
	})
	f := findByCode(findings, "WIDGET_EXTRA_FILE")
	if f == nil {
		t.Fatalf("expected WIDGET_EXTRA_FILE, got %+v", findings)
	}
	if f.Path != "widgets/w/assets/chart.js" {
		t.Errorf("WIDGET_EXTRA_FILE path = %q, want widgets/w/assets/chart.js", f.Path)
	}
}

// --- isRealWidget: a directory with ONLY a stray file is not a widget ---
// widgets.ts's own review round 1 finding, both directions.

func TestWidgetDirWithOnlyStrayFileIsNotARealWidget(t *testing.T) {
	t.Run("referenced by a chapter still reports WIDGET_MISSING", func(t *testing.T) {
		findings := mustValidate(t, map[string]string{
			"manifest.json":         minimalManifest,
			"chapters/c1.html":      `<div data-widget="foo"></div>`,
			"widgets/foo/notes.txt": "not an index.html",
		})
		missing := findByCode(findings, "WIDGET_MISSING")
		if missing == nil {
			t.Fatalf("a widgets/foo/ directory with no index.html is not a real widget — a chapter referencing it must still get WIDGET_MISSING, got %+v", findings)
		}
		if missing.Path != "chapters/c1.html" {
			t.Errorf("WIDGET_MISSING path = %q, want chapters/c1.html", missing.Path)
		}
		if !hasCode(findings, "WIDGET_EXTRA_FILE") {
			t.Errorf("notes.txt is still a stray file, independent of WIDGET_MISSING — got %+v", findings)
		}
	})

	t.Run("unreferenced does NOT report WIDGET_ORPHAN", func(t *testing.T) {
		findings := mustValidate(t, map[string]string{
			"manifest.json":         minimalManifest,
			"chapters/c1.html":      `<p>no widget mentioned here</p>`,
			"widgets/foo/notes.txt": "not an index.html",
		})
		if hasCode(findings, "WIDGET_ORPHAN") {
			t.Fatalf("widgets/foo/index.html was never created — there is nothing to be \"orphaned\"; WIDGET_EXTRA_FILE alone is the right diagnosis, got %+v", findings)
		}
		if !hasCode(findings, "WIDGET_EXTRA_FILE") {
			t.Fatalf("expected WIDGET_EXTRA_FILE, got %+v", findings)
		}
	})
}

// --- WIDGET_MISSING: per-chapter dedup, and the empty-name placeholder --

func TestWidgetMissingDedupedPerChapterReference(t *testing.T) {
	findings := mustValidate(t, map[string]string{
		"manifest.json":    minimalManifest,
		"chapters/c1.html": `<div data-widget="khong-co"></div><div data-widget="khong-co"></div>`,
	})
	count := 0
	for _, f := range findings {
		if f.Code == "WIDGET_MISSING" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("a chapter referencing the same missing widget twice must report WIDGET_MISSING once, not %d — got %+v", count, findings)
	}
}

func TestWidgetMissingEmptyDataWidgetGetsPlaceholderDetail(t *testing.T) {
	findings := mustValidate(t, map[string]string{
		"manifest.json":    minimalManifest,
		"chapters/c1.html": `<div data-widget=""></div>`,
	})
	f := findByCode(findings, "WIDGET_MISSING")
	if f == nil {
		t.Fatalf("expected WIDGET_MISSING, got %+v", findings)
	}
	// Must not read like a widget literally named "" living at
	// widgets//index.html — that is not a diagnosis of the chapter's
	// actual mistake (an unfinished placeholder), it just looks broken.
	if strings.Contains(f.Detail, "widgets//index.html") {
		t.Fatalf("an empty data-widget must not be reported as a reference to widgets//index.html — got detail %q", f.Detail)
	}
}

// --- data-widget is read case-insensitively, via content.go's tokenizer -

func TestWidgetMissingReadsDataWidgetCaseInsensitively(t *testing.T) {
	findings := mustValidate(t, map[string]string{
		"manifest.json":    minimalManifest,
		"chapters/c1.html": `<div DATA-WIDGET="khong-co"></div>`,
	})
	if !hasCode(findings, "WIDGET_MISSING") {
		t.Fatalf("DATA-WIDGET (uppercase attribute name) must be read the same as data-widget — HTML attribute names are case-insensitive, got %+v", findings)
	}
}

// --- WIDGET_ORPHAN: referenced by either of two chapters is not orphan --

const twoChapterWidgetManifest = `{
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
    {"id": "c1", "num": "1", "title": "C1", "short": "C1", "file": "chapters/c1.html"},
    {"id": "c2", "num": "2", "title": "C2", "short": "C2", "file": "chapters/c2.html"}
  ]}]
}`

func TestWidgetReferencedByEitherOfTwoChaptersIsNotOrphan(t *testing.T) {
	findings := mustValidate(t, map[string]string{
		"manifest.json":             twoChapterWidgetManifest,
		"chapters/c1.html":          `<p>no widget here</p>`,
		"chapters/c2.html":          `<div data-widget="shared"></div>`,
		"widgets/shared/index.html": validWidgetHTML,
	})
	if hasCode(findings, "WIDGET_ORPHAN") {
		t.Fatalf("a widget referenced by ONE of two chapters must not be reported orphan, got %+v", findings)
	}
	if len(findings) != 0 {
		t.Fatalf("expected zero findings, got %+v", findings)
	}
}

// --- Ordering: groupWidgetFiles preserves PATH-sorted order, not --------
// --- alphabetical NAME order ---------------------------------------------

// TestWidgetFindingOrderFollowsSortedPathsNotSortedNames pins the subtle
// fact documented on groupWidgetFiles: "widgets/Big-Two/" sorts BEFORE
// "widgets/Big/" as byte strings ('-' is 0x2D, '/' is 0x2F), even though
// "Big" sorts before "Big-Two" as bare strings. If groupWidgetFiles were
// changed to sort widget names directly instead of preserving path-walk
// order, this test would catch the regression by seeing the two
// WIDGET_BAD_NAME findings swap places.
func TestWidgetFindingOrderFollowsSortedPathsNotSortedNames(t *testing.T) {
	findings := mustValidate(t, map[string]string{
		"manifest.json":              minimalManifest,
		"chapters/c1.html":           `<p>a</p>`,
		"widgets/Big/index.html":     validWidgetHTML,
		"widgets/Big-Two/index.html": validWidgetHTML,
	})
	var order []string
	for _, f := range findings {
		if f.Code == "WIDGET_BAD_NAME" {
			order = append(order, f.Path)
		}
	}
	want := []string{"widgets/Big-Two", "widgets/Big"}
	if len(order) != 2 || order[0] != want[0] || order[1] != want[1] {
		t.Fatalf("WIDGET_BAD_NAME order = %v, want %v (path-sorted first-seen order, not name-sorted)", order, want)
	}
}

// --- Zero findings for a correctly-shipped widget -------------------------

func TestPackageWithValidWidgetAndCorrectReferenceHasZeroFindings(t *testing.T) {
	findings := mustValidate(t, map[string]string{
		"manifest.json":          minimalManifest,
		"chapters/c1.html":       `<p>Before.</p><div data-widget="dem"></div><p>After.</p>`,
		"widgets/dem/index.html": validWidgetHTML,
	})
	if len(findings) != 0 {
		t.Fatalf("expected zero findings for a valid widget correctly referenced, got %+v", findings)
	}
}

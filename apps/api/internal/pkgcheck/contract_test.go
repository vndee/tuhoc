// The contract test: proves fixtures/format-v2/ and this package still
// agree with packages/course-format/src/contract.test.ts, the TypeScript
// half of the same requirement.
//
// Task 3 of the server-side pivot built fixtures/format-v2/ — real package
// directories on disk, hostile/<case>/ plus valid-course/ — that BOTH
// implementations of the rule set (that TypeScript module, and this Go
// port) are required to run against. A case directory is a MINIMAL package
// (a valid v2 manifest plus exactly one file carrying its violation) and
// one expect.json, shaped {"codes": ["SCRIPT_TAG"]}, that sits OUTSIDE the
// package contents — read directly by this file, but excluded when the
// case directory is zipped into package bytes.
//
// The contract is SUBSET, not equality: expected.codes must be a subset of
// the codes Validate actually returns. The scanner deliberately
// over-reports (see content.go's own header), so a case may legitimately
// trip more rules than the one it was built to name. valid-course is the
// one exception, checked for EQUALITY with the empty set: it is the
// package a later task serves to a real browser, so it must be flawless.
//
// This file covers the CONTENT cases only — script-tag, event-handler-attr,
// javascript-url, embedded-frame, tier-field, loose-js — because Task 7
// adds the eight WIDGET_* rules and owns the remaining five hostile cases
// (widget-extra-file, widget-orphan, widget-external-url, widget-missing,
// widget-forbidden-api). contentCases below is an EXPLICIT slice, not a
// directory listing: globbing every hostile/* directory and silently
// skipping the ones this task does not cover would mean a renamed or
// newly-added case fails to get its own test with no signal that it was
// ever supposed to. wantAllHostileCasesCovered documents (and checks) that
// the two lists partition the whole hostile/ corpus between this task and
// Task 7, so a case neither list names fails loudly instead of quietly
// being skipped by both.
package pkgcheck

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

const fixturesRoot = "../../../../fixtures/format-v2"

const expectFile = "expect.json"

// contentCases is the explicit, non-glob list this task is responsible
// for. See the file comment for why this may not become a directory scan.
var contentCases = []string{
	"script-tag",
	"event-handler-attr",
	"javascript-url",
	"embedded-frame",
	"tier-field",
	"loose-js",
}

// widgetCases is Task 7's five, named here ONLY so
// TestHostileCorpusIsFullyAccountedFor can prove contentCases plus
// widgetCases covers every directory under hostile/ — not to run them:
// running them is that task's job, against rules this package does not
// implement yet.
var widgetCases = []string{
	"widget-extra-file",
	"widget-orphan",
	"widget-external-url",
	"widget-missing",
	"widget-forbidden-api",
}

type expectedFindings struct {
	Codes []string `json:"codes"`
}

// readExpect reads and validates one case's expect.json. Fails the test
// loudly (never skips) when the file is missing or malformed — an
// undeclared case is a corpus defect, not a reason to say nothing.
func readExpect(t *testing.T, dir string) expectedFindings {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(dir, expectFile))
	if err != nil {
		t.Fatalf("%s: missing %s — every hostile case MUST declare its expected codes (e.g. {\"codes\": [\"SCRIPT_TAG\"]}); a case without this file must not be silently skipped: %v", dir, expectFile, err)
	}
	var got expectedFindings
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("%s/%s: invalid JSON: %v", dir, expectFile, err)
	}
	if len(got.Codes) == 0 {
		t.Fatalf("%s/%s: \"codes\" must be a non-empty array", dir, expectFile)
	}
	return got
}

// zipDir zips every file under dir into package bytes, package-relative
// paths using "/" regardless of host OS, EXCLUDING expect.json wherever it
// sits — the one file a case directory keeps outside its own package
// contents. This round-trips through a real archive/zip.Writer, the same
// door a real package arrives by, rather than building a files map by
// hand and skipping the zip layer.
func zipDir(t *testing.T, dir string) []byte {
	t.Helper()

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if d.Name() == expectFile {
			return nil
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)

		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		w, err := zw.Create(rel)
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		return err
	})
	if err != nil {
		t.Fatalf("zipDir(%s): %v", dir, err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zipDir(%s): closing zip writer: %v", dir, err)
	}
	return buf.Bytes()
}

// codeSet runs Validate over dir's zipped contents and returns the set of
// codes it reported.
func codeSet(t *testing.T, dir string) map[string]bool {
	t.Helper()
	findings, _, err := Validate(zipDir(t, dir))
	if err != nil {
		t.Fatalf("Validate(%s): unexpected system error: %v", dir, err)
	}
	set := make(map[string]bool, len(findings))
	for _, f := range findings {
		set[f.Code] = true
	}
	return set
}

func TestHostileContentCases(t *testing.T) {
	if len(contentCases) == 0 {
		// If this ever loses its entries, every case below is a t.Run
		// that never runs — a describe-block-shaped false green, exactly
		// what contract.test.ts's "kho hostile khong rong" guards against
		// on the TypeScript side. Keep the analogous guard here too.
		t.Fatal("contentCases is empty — this test would silently pass without checking anything")
	}

	for _, name := range contentCases {
		t.Run(name, func(t *testing.T) {
			dir := filepath.Join(fixturesRoot, "hostile", name)
			if _, err := os.Stat(dir); err != nil {
				t.Fatalf("listed in contentCases but not found on disk: %v", err)
			}

			expected := readExpect(t, dir)
			codes := codeSet(t, dir)

			var missing []string
			for _, code := range expected.Codes {
				if !codes[code] {
					missing = append(missing, code)
				}
			}
			if len(missing) > 0 {
				var got []string
				for c := range codes {
					got = append(got, c)
				}
				sort.Strings(got)
				t.Errorf("hostile/%s: missing expected code(s) %v in findings — got %v", name, missing, got)
			}
		})
	}
}

func TestValidCourseHasZeroFindings(t *testing.T) {
	findings, pkg, err := Validate(zipDir(t, filepath.Join(fixturesRoot, "valid-course")))
	if err != nil {
		t.Fatalf("unexpected system error: %v", err)
	}
	if len(findings) != 0 {
		t.Fatalf("valid-course must be perfectly clean, but got %d finding(s): %+v", len(findings), findings)
	}
	// findings empty implies pkg != nil — Validate's own documented
	// invariant, checked here rather than assumed.
	if pkg == nil {
		t.Fatal("Validate returned zero findings but a nil *Package — violates its own documented invariant")
	}
	if len(pkg.Chapters) != 2 {
		t.Errorf("valid-course has 2 chapters in its manifest, got %d", len(pkg.Chapters))
	}
	if _, ok := pkg.Widgets["dem-so"]; !ok {
		t.Errorf("valid-course ships widgets/dem-so/index.html, but Package.Widgets has no \"dem-so\" entry (got keys %v)", widgetKeys(pkg.Widgets))
	}
}

func widgetKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// TestHostileCorpusIsFullyAccountedFor proves contentCases and widgetCases
// together name every directory under hostile/ — neither more (a stale
// name for a deleted case) nor fewer (a new case neither list has caught
// up with, which would otherwise run under neither task's test file).
func TestHostileCorpusIsFullyAccountedFor(t *testing.T) {
	entries, err := os.ReadDir(filepath.Join(fixturesRoot, "hostile"))
	if err != nil {
		t.Fatalf("reading hostile/: %v", err)
	}

	onDisk := make(map[string]bool, len(entries))
	for _, e := range entries {
		if e.IsDir() {
			onDisk[e.Name()] = true
		}
	}
	if len(onDisk) == 0 {
		t.Fatal("fixtures/format-v2/hostile/ has no case directories at all")
	}

	accounted := make(map[string]bool, len(contentCases)+len(widgetCases))
	for _, name := range contentCases {
		accounted[name] = true
	}
	for _, name := range widgetCases {
		accounted[name] = true
	}

	for name := range onDisk {
		if !accounted[name] {
			t.Errorf("hostile/%s exists on disk but is in neither contentCases (this task) nor widgetCases (Task 7) — it would silently run under no test", name)
		}
	}
	for name := range accounted {
		if !onDisk[name] {
			t.Errorf("%q is listed in contentCases/widgetCases but has no hostile/%s directory on disk", name, name)
		}
	}
}

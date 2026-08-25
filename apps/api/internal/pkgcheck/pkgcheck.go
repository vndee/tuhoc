// Package pkgcheck is the Go port of packages/course-format/src/validate.ts
// — the manifest and content rules a course package must pass before this
// server will store or serve it.
//
// # Why this package exists, twice
//
// The rule set already lives in TypeScript and runs in the packaging CLI
// (tuhoc pack) on the author's own machine. That copy exists to give an
// author fast feedback; it cannot be the gate, because the CLI is
// something anyone can skip — a package can be curl'd straight at the
// publish endpoint without ever touching tuhoc pack. The server holds the
// origin a reader's login session lives on, and a package is untrusted
// content rendered into that origin with innerHTML (apps/web's reader).
// This package is therefore the rule set that actually protects a reader:
// weakening a rule here, or getting one subtly wrong, is a hole nothing
// else in the system covers.
//
// Task 7 adds the eight WIDGET_* rules on top of what is here. This
// package covers the manifest/package-shape rules and the seven content
// rules a real HTML tokenizer decides — see content.go.
//
// # Format v2, briefly
//
// Format v2 has no "tier" any more: every package is what tier: "content"
// used to mean, and a manifest that still carries the tier key is refused
// outright (TIER_REMOVED) rather than read for what value it holds. The
// old escape hatch for free-running JavaScript — tier: "interactive",
// vouched for by a human registry reviewer — is gone; the one door left
// for interactive content is a widget under widgets/<name>/index.html,
// sandboxed at read time (Task 7's territory).
package pkgcheck

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
)

// Finding is one rule violation. Code is one of the constants documented
// alongside contentRuleOrder (content.go) and the package-shape rules
// below; Path names the package entry it is about, or packageRoot for a
// finding about the package as a whole; Detail is a human-readable
// sentence, not meant to be matched on.
type Finding struct {
	Code   string `json:"code"`
	Path   string `json:"path"`
	Detail string `json:"detail"`
}

// Chapter is one manifest chapter, resolved against the package's files.
type Chapter struct {
	ID, File, HTML string

	// WidgetNames is every data-widget attribute value found in HTML, in
	// the order first seen, DEDUPLICATED.
	//
	// This differs on purpose from validate.ts's extractWidgetRefs, which
	// deliberately does NOT dedupe: that function feeds a renderer that
	// draws one iframe per occurrence, so a chapter placing the same
	// widget twice needs both entries. This field feeds a different
	// question — Task 7's cross-reference between what a chapter ASKS FOR
	// and what widgets the package SHIPS (WIDGET_MISSING/WIDGET_ORPHAN) —
	// which only cares about distinct names.
	WidgetNames []string
}

// Package is a course package that passed every v2 rule: findings empty
// implies Validate's pkg return is non-nil, and vice versa.
type Package struct {
	// Slug is the manifest's "id" field. The manifest's own JSON key is
	// "id", not "slug" — this field is named Slug because Task 8/9 use it
	// as the URL-safe course identifier, and giving it that name here
	// means nobody reading this struct has to remember that "id" in the
	// manifest and "Slug" on the Go side are the same value read under two
	// different names.
	Slug, Title, Lang, Description string

	// ManifestJSON is manifest.json's bytes, verbatim, exactly as packed.
	//
	// Deliberately the only place this package exposes the manifest's own
	// "version" field: that is the AUTHOR's semver, checked by SEMVER
	// below, and it is NOT a publish-sequence number — Task 8 owns a
	// separate integer for that and must read it from its own column, not
	// from this JSON. There is no field on Package named Version, and
	// that absence is deliberate: a future field with that name must not
	// be filled in with the manifest's semver without making which
	// "version" it means unambiguous in the name itself.
	ManifestJSON []byte

	// Chapters is every chapter Validate could resolve, in the order the
	// manifest lists them: part by part, then chapter by chapter within
	// each part.
	Chapters []Chapter

	// Widgets maps a widget's name (the <name> in widgets/<name>/index.html)
	// to that file's HTML, verbatim.
	Widgets map[string]string

	// Assets is every package entry that is none of the above: not
	// manifest.json, not a chapter's own file, not a widget's index.html.
	// Keyed by the full package-relative path.
	Assets map[string][]byte
}

// MaxUploadBytes is the ceiling Task 8's HTTP layer should apply to the
// REQUEST BODY before it ever reaches Validate — a different, weaker
// quantity than MaxUncompressedBytes. It exists only so the server does
// not buffer an unbounded upload before inspecting it; a payload under
// this ceiling can still be refused a moment later by the real one.
//
// Larger than MaxUncompressedBytes, not equal to it, for the same reason
// internal/course's MaxUploadBytes was: a package of already-compressed
// material (images, mostly) barely shrinks, and its .zip carries per-entry
// headers and a central directory on top of the content.
const MaxUploadBytes = 21 * 1024 * 1024

// MaxUncompressedBytes is the ingest ceiling: the total size of every
// entry's content AFTER decompression, never the size of the zip on the
// wire. Matches course-format's own MAX_UNCOMPRESSED_BYTES (20 MiB) —
// TS and Go must refuse the same zip bomb at the same size, and there is
// only one number to keep in step, not two.
//
// Enforced DURING decompression in Validate, not after: a zip bomb is by
// definition tiny compressed and enormous expanded, so a check applied to
// the fully-inflated result would have already paid for the bomb by the
// time it ran. See Validate's inflation loop.
const MaxUncompressedBytes = 20 * 1024 * 1024

// packageRoot is the Path a Finding carries when it is about the package
// as a whole rather than about one entry.
const packageRoot = "."

// manifestPath is where the manifest must live: the package root. A
// manifest one directory down is a package zipped from one level too
// high, and is rejected rather than searched for.
const manifestPath = "manifest.json"

// widgetDirRE is WIDGET_DIR_RE ported unchanged from validate.ts: any path
// under a widget's own directory, at any depth. A PREFIX match on purpose
// — a widget may ship its JS as a file next to its index.html
// (widgets/graph/index.html + widgets/graph/chart.js), and only Task 7's
// widget rules get to decide what belongs in there.
var widgetDirRE = regexp.MustCompile(`^widgets/[^/]+/`)

// widgetIndexRE is WIDGET_INDEX_RE ported unchanged: a widget's entry
// document, exactly. Narrower than widgetDirRE on purpose — see that
// variable's comment for what does and does not follow from each.
var widgetIndexRE = regexp.MustCompile(`^widgets/[^/]+/index\.html$`)

// jsFileRE is JS_FILE_RE ported unchanged: files that are executable in a
// browser by being loaded. .mjs/.cjs/.jsx alongside .js for the same
// reason validate.ts includes them — same executable content, different
// suffix. .ts is deliberately absent: a browser cannot load it directly.
var jsFileRE = regexp.MustCompile(`(?i)\.(js|mjs|cjs|jsx)$`)

// drivePrefixRE matches a Windows drive letter at the very start of a
// path ("C:"), absolute or drive-relative. Part of escapesPackage — see
// that function's comment for why this is its own check.
var drivePrefixRE = regexp.MustCompile(`^[a-zA-Z]:`)

// semverRE is https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string,
// ported unchanged from validate.ts's SEMVER_RE.
var semverRE = regexp.MustCompile(`^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$`)

// runtimeRangeRE is RUNTIME_RANGE_RE ported unchanged: the only shape
// "runtime" may take — a caret range over 1-3 numeric parts, e.g. ^1,
// ^1.2, ^1.2.3. Deliberately narrower than npm's range grammar.
var runtimeRangeRE = regexp.MustCompile(`^\^(0|[1-9]\d*)(?:\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?)?$`)

func finding(code, path, detail string) Finding {
	return Finding{Code: code, Path: path, Detail: detail}
}

// escapesPackage is escapesPackage ported from validate.ts, unioned with
// the extra NUL-byte check course/usecase.go's checkPackagePath already
// carries (see this package's own doc note on zip path safety in
// Validate). Every clause can only ever REJECT more than either source
// alone would, which is the safe direction for a function whose whole job
// is deciding what a hostile path may not do.
//
// True when a package-relative path could resolve outside the package
// root once a consumer joins it to a destination directory: the empty
// path, a NUL byte, any backslash, a leading "/", a Windows drive prefix
// ("C:", in either slash direction — see validate.ts's own comment on why
// this is not folded into the backslash check), or a ".." path segment.
//
// Misses percent-encoded traversal and Unicode look-alikes, same as the
// TypeScript sibling: those are for whoever decodes them to catch, not
// this function — a caller must never URL-decode an entry name before
// using it.
func escapesPackage(p string) bool {
	if p == "" {
		return true
	}
	if strings.Contains(p, "\x00") {
		return true
	}
	if strings.Contains(p, `\`) {
		return true
	}
	if strings.HasPrefix(p, "/") {
		return true
	}
	if drivePrefixRE.MatchString(p) {
		return true
	}
	for _, seg := range strings.Split(p, "/") {
		if seg == ".." {
			return true
		}
	}
	return false
}

// widgetNameFromIndexPath extracts <name> from a path already confirmed
// by widgetIndexRE to be widgets/<name>/index.html.
func widgetNameFromIndexPath(path string) string {
	rest := strings.TrimPrefix(path, "widgets/")
	return strings.TrimSuffix(rest, "/index.html")
}

// Validate reads zipBytes as a course package and runs every format v2
// rule this package and content.go know about.
//
// findings is empty if and only if pkg is non-nil: a package with any
// finding is rejected outright and Validate does not hand back a partial
// Package for a caller to use by mistake.
//
// err is reserved for genuine system failures — there are none in this
// implementation's normal operation, since reading zipBytes is pure and
// in-memory. A zip that fails to parse, is empty, carries a path that
// escapes the package, or exceeds the byte ceiling is NOT a system
// failure: it is exactly the kind of thing an attacker controls, so it is
// reported as findings like every other rule violation, never as err.
// EMPTY_PACKAGE stands in for "not a readable zip at all" as well as for
// a genuinely empty one — course-format has no dedicated code for a
// corrupt archive, and a zip this package cannot even open contributes no
// readable files either way.
func Validate(zipBytes []byte) (findings []Finding, pkg *Package, err error) {
	zr, zerr := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if zerr != nil {
		return []Finding{finding("EMPTY_PACKAGE", packageRoot, fmt.Sprintf("not a readable zip archive: %v", zerr))}, nil, nil
	}
	if len(zr.File) == 0 {
		return []Finding{finding("EMPTY_PACKAGE", packageRoot, "package contains no files")}, nil, nil
	}

	// Path safety AND duplicate-name detection first, over every entry
	// NAME, before a single byte is inflated — cheapest and most decisive
	// first, same ordering and same two checks course-format's zip.ts
	// runs in its onfile callback (escapesPackage, then the
	// already-announced-name check), in the same order, before either
	// module inflates anything.
	//
	// DUPLICATE_ENTRY is a Go finding code with no member in validate.ts's
	// FindingCode/FINDING_CODES — and that is correct, not a gap to close
	// there. TypeScript splits this into two layers: zip.ts is the
	// archive-reading layer, and it raises UnsafeArchiveError with an
	// UnsafeArchiveCode (PATH_ESCAPE, DUPLICATE_ENTRY, TOO_LARGE,
	// MALFORMED) before validate.ts's rule layer ever runs; validate.ts
	// produces Findings with FindingCodes for what is already a
	// clean, decompressed file map. This Go Validate collapses both
	// layers into one function and one []Finding return, which is why it
	// already reports PATH_ESCAPE and TOO_LARGE — both ALSO members of
	// UnsafeArchiveCode in TypeScript, not of FindingCode — as findings.
	// DUPLICATE_ENTRY joins them by the identical logic: an archive-layer
	// refusal reported through the one return type this function has,
	// not a new member of the rule layer's own code list. Adding it to
	// validate.ts's FINDING_CODES would be the wrong fix, not merely an
	// unnecessary one — that array is a different, smaller set of
	// concerns than what this function's zip-reading half has to decide.
	//
	// Unlike TypeScript's duplicateKey (NFC-normalized, lower-cased, so
	// APFS/NTFS-style filesystem folding is caught too), this compares
	// entry names byte-for-byte. That fold exists in zip.ts because its
	// archives eventually get extracted onto a real, possibly
	// case/normalization-folding filesystem (the browser import path);
	// this reader never writes to a filesystem at all — every entry's
	// bytes live in the in-memory `files` map below, keyed by the exact
	// string archive/zip handed back, read and served by the same map in
	// the same process. An exact-name collision is the shape that
	// actually reproduces the bug this closes (internal/course/
	// usecase.go's measured [dirty manifest][chapter][clean manifest]
	// exploit turned on two entries named identically, not on a case or
	// normalization variant), so that is the fold this function commits
	// to. If a future caller extracts this package's Assets/Widgets/
	// Chapters onto a case-folding filesystem, that caller inherits the
	// same question zip.ts answers for the browser import path, and
	// should answer it the same way there — not by asking this function
	// to guess at a destination filesystem it never touches.
	seenNames := make(map[string]bool, len(zr.File))
	for _, f := range zr.File {
		if escapesPackage(f.Name) {
			findings = append(findings, finding("PATH_ESCAPE", f.Name, "entry path escapes the package root"))
		}
		if seenNames[f.Name] {
			findings = append(findings, finding(
				"DUPLICATE_ENTRY", f.Name,
				"two entries share this name; which one is \"the\" file is not decidable",
			))
		}
		seenNames[f.Name] = true
	}

	// Inflate every entry that did not already fail path safety, bounded
	// by MaxUncompressedBytes DURING inflation — mirrors
	// internal/course/usecase.go's validatePackage loop (deleted by Task
	// 9; read before it goes) rather than course-format's zip.ts, because
	// archive/zip already reads the archive's central directory (the
	// robust end) rather than walking local headers the way zip.ts's
	// streaming reader has to, so the polyglot/local-vs-central mismatch
	// defenses zip.ts carries do not apply to this reader the same way.
	//
	// A repeated name already produced a DUPLICATE_ENTRY finding above,
	// so this loop's own tie-break (ordinary Go map assignment: the LAST
	// entry with a given name wins) never reaches a caller — findings
	// non-empty already makes Validate return pkg == nil before anything
	// built from `files` is handed back. It is left as "last wins" rather
	// than restructured to skip the second occurrence because there is
	// nothing left for that choice to protect once the package is
	// rejected outright.
	//
	// An entry that fails to open or copy is treated as absent rather
	// than given its own finding: course-format has no code for "corrupt
	// zip entry" either, and MANIFEST_MISSING or CHAPTER_FILE_MISSING
	// already say the right thing about whatever that entry was supposed
	// to be.
	files := make(map[string][]byte, len(zr.File))
	var total int64
	for _, f := range zr.File {
		if strings.HasSuffix(f.Name, "/") {
			continue // directory marker: no content
		}
		if escapesPackage(f.Name) {
			continue // already reported above; do not inflate a hostile path's content
		}

		rc, openErr := f.Open()
		if openErr != nil {
			continue
		}
		remaining := MaxUncompressedBytes - total
		var buf bytes.Buffer
		n, copyErr := io.Copy(&buf, io.LimitReader(rc, remaining+1))
		closeErr := rc.Close()
		total += n

		if total > MaxUncompressedBytes {
			// Bound the work: stop reading the archive the moment the
			// ceiling is crossed, mid-entry if that is where it happens,
			// rather than finishing the read first and checking after.
			// This is NOT a deliberate divergence from the real TypeScript
			// pipeline — it is what that pipeline does too. CLI, CI and the
			// browser all read a package through course-format's zip.ts
			// BEFORE validatePackage ever sees it, and zip.ts bounds
			// decompression itself and throws its own TOO_LARGE mid-archive
			// (see zip.ts's onfile/ondata: the claimed-size check and the
			// running-total check both fire before a byte reaches
			// validatePackage). validatePackage's own overBudget branch,
			// which keeps running its cheap manifest/duplicate/JS-path
			// checks against an already-decompressed map, is reachable only
			// by calling that function directly with a synthetic map that
			// skips zip.ts entirely — a shape validatePackage's own unit
			// tests use, not a shape any real caller produces. So there is
			// no real pipeline for this Go code to have chosen a different
			// finding set from: stopping here matches what course-format
			// actually does end to end.
			return append(findings, finding(
				"TOO_LARGE", packageRoot,
				fmt.Sprintf("uncompressed size exceeds the %d byte budget", MaxUncompressedBytes),
			)), nil, nil
		}
		if copyErr != nil || closeErr != nil {
			continue
		}
		files[f.Name] = buf.Bytes()
	}

	manifestBytes, haveManifest := files[manifestPath]
	if !haveManifest {
		findings = append(findings, finding("MANIFEST_MISSING", manifestPath, "package has no manifest.json at its root"))
		return findings, nil, nil
	}

	// map[string]any (rather than a typed struct) mirrors validate.ts's
	// own approach directly: checkManifestFields walks a dynamically-typed
	// JSON value so it can tell "field absent" apart from "field present
	// with the wrong type" — exactly the distinction a Go struct's zero
	// values erase. json.Unmarshal into a map ALMOST rejects a top-level
	// JSON array or scalar on its own (Go: "cannot unmarshal array/number
	// into Go value of type map[string]interface {}"), which is most of
	// what gives MANIFEST_PARSE both "invalid JSON syntax" and "valid JSON
	// but not an object" through the one error path, matching validate.ts's
	// separate isRecord check folded into one — EXCEPT for the JSON literal
	// null, which encoding/json treats as "no error, set the destination to
	// its zero value" for a map exactly as it would for a pointer. A
	// manifest.json containing exactly `null` therefore parses with
	// jsonErr == nil and manifest == nil, and the explicit nil check right
	// below is what turns that back into MANIFEST_PARSE instead of letting
	// it fall through to checkManifestFields, which would otherwise read a
	// nil map as "every field absent" and report a pile of MANIFEST_FIELD
	// findings for a document validate.ts's isRecord(v) — v !== null — has
	// always refused in one step (see TestManifestParseNull).
	var manifest map[string]any
	if jsonErr := json.Unmarshal(manifestBytes, &manifest); jsonErr != nil {
		findings = append(findings, finding("MANIFEST_PARSE", manifestPath, fmt.Sprintf("invalid JSON: %v", jsonErr)))
		return findings, nil, nil
	}
	if manifest == nil {
		findings = append(findings, finding("MANIFEST_PARSE", manifestPath, "top-level value must be a JSON object, not null"))
		return findings, nil, nil
	}

	findings = append(findings, checkManifestFields(manifest)...)
	findings = append(findings, checkVersionAndRuntime(manifest)...)

	located := locateChapters(manifest)
	seenChapterIDs := make(map[string]bool, len(located))
	for _, lc := range located {
		if seenChapterIDs[lc.id] {
			findings = append(findings, finding(
				"DUPLICATE_CHAPTER_ID", lc.pointer+"/id",
				fmt.Sprintf("chapter id %q is used twice", lc.id),
			))
		}
		seenChapterIDs[lc.id] = true

		// A chapter.file that walks out of the package is worth flagging
		// even though the next check also reports it missing: a consumer
		// that resolves the manifest against a directory rather than
		// against the inflated map would follow it.
		if escapesPackage(lc.file) {
			findings = append(findings, finding(
				"PATH_ESCAPE", lc.pointer+"/file",
				fmt.Sprintf("chapter file escapes the package root: %q", lc.file),
			))
		}
		if _, ok := files[lc.file]; !ok {
			findings = append(findings, finding(
				"CHAPTER_FILE_MISSING", lc.pointer+"/file",
				fmt.Sprintf("no such file in package: %q", lc.file),
			))
		}
	}

	// Deterministic iteration for everything below: archive/zip preserves
	// the archive's own entry order in zr.File, but the files map built
	// above does not, and Go map iteration order is randomized. Sorting
	// once here — cheap, O(entries log entries) against a package already
	// bounded to MaxUncompressedBytes — makes two runs over the same
	// package list their findings in the same order, matching the
	// property validate.ts gets for free from packZip always writing
	// entries in sorted order.
	paths := make([]string, 0, len(files))
	for p := range files {
		paths = append(paths, p)
	}
	sort.Strings(paths)

	// JS_FILE_IN_PACKAGE: every path, indexed by name only, so this is
	// O(entries) rather than O(bytes) and — like validate.ts — is not
	// gated on the byte ceiling.
	for _, path := range paths {
		if widgetDirRE.MatchString(path) {
			continue // Task 7's territory: a widget ships JS on purpose
		}
		if jsFileRE.MatchString(path) {
			findings = append(findings, finding(
				"JS_FILE_IN_PACKAGE", path,
				"loose JavaScript has no run path left in format v2: package it as a widget under widgets/<name>/index.html instead",
			))
		}
	}

	// The seven content rules, over every entry except manifest.json (its
	// fields are rendered as text, not markup — see content.go and
	// validate.ts's own note on why that exclusion is safe only as long
	// as no consumer ever feeds a manifest string to innerHTML) and every
	// widget's own index.html (Task 7 reads those instead — see
	// widgetIndexRE).
	for _, path := range paths {
		if path == manifestPath {
			continue
		}
		if widgetIndexRE.MatchString(path) {
			continue
		}
		data := files[path]
		if !bytes.ContainsRune(data, '<') {
			// A start tag cannot exist without a U+003C, and every
			// content rule reads start tags — see validate.ts's own
			// comment on this shortcut for the proof. Keeps a large
			// binary asset out of the tokenizer entirely.
			continue
		}
		findings = append(findings, scanHTMLText(path, data)...)
	}

	if len(findings) > 0 {
		return findings, nil, nil
	}

	pkg = &Package{
		Slug:         stringField(manifest, "id"),
		Title:        stringField(manifest, "title"),
		Lang:         stringField(manifest, "lang"),
		Description:  stringField(manifest, "description"),
		ManifestJSON: manifestBytes,
		Widgets:      map[string]string{},
		Assets:       map[string][]byte{},
	}

	chapterFiles := make(map[string]bool, len(located))
	for _, lc := range located {
		chapterFiles[lc.file] = true
		htmlBytes := files[lc.file]
		pkg.Chapters = append(pkg.Chapters, Chapter{
			ID:          lc.id,
			File:        lc.file,
			HTML:        string(htmlBytes),
			WidgetNames: extractWidgetNames(htmlBytes),
		})
	}

	for _, path := range paths {
		switch {
		case path == manifestPath:
			// carried on Package.ManifestJSON already
		case widgetIndexRE.MatchString(path):
			pkg.Widgets[widgetNameFromIndexPath(path)] = string(files[path])
		case chapterFiles[path]:
			// carried on the matching Chapter.HTML already
		default:
			pkg.Assets[path] = files[path]
		}
	}

	return nil, pkg, nil
}

func stringField(m map[string]any, key string) string {
	s, _ := m[key].(string)
	return s
}

// nonEmptyString reports whether v is a string and it is not empty —
// isNonEmptyString ported unchanged from validate.ts, and doing the same
// job Go's zero-valued struct fields cannot: telling "absent" apart from
// "present but wrong type" apart from "present, right type, empty".
func nonEmptyString(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok && s != ""
}

// checkManifestFields is checkManifestFields ported field-by-field from
// validate.ts, in the same order, over a manifest already known to be a
// JSON object (Validate's json.Unmarshal into map[string]any is what
// establishes that, mirroring validate.ts's isRecord guard). Returns
// every problem, not the first, so a contributor fixing a package sees
// the whole list in one pass.
func checkManifestFields(value map[string]any) []Finding {
	var out []Finding
	at := func(pointer string) string { return manifestPath + "#/" + pointer }
	bad := func(pointer, detail string) {
		out = append(out, finding("MANIFEST_FIELD", at(pointer), detail))
	}

	for _, key := range []string{"id", "title", "lang", "version", "runtime", "license"} {
		if _, ok := nonEmptyString(value[key]); !ok {
			bad(key, fmt.Sprintf("missing or not a non-empty string: %q", key))
		}
	}
	// description may be empty — a course with nothing to add beyond its
	// title is allowed to say so — but it must be present and a string.
	if _, ok := value["description"].(string); !ok {
		bad("description", `missing or not a string: "description"`)
	}

	// tier is not a field to validate any more — it is a field to refuse.
	// Format v2 killed the choice it named: every package is what
	// tier: "content" used to mean, so a manifest that still carries the
	// key — with ANY value, including a once-valid one — is authored
	// against the old format. The presence check (not the value) is what
	// matters, which is why this reads for the key with the comma-ok form
	// rather than comparing value["tier"] to anything.
	if _, hasTier := value["tier"]; hasTier {
		out = append(out, finding(
			"TIER_REMOVED", manifestPath,
			`format v2 removed the "tier" field: delete it from the manifest; interactive content is now a widget (docs/course-format.md #4)`,
		))
	}

	generatedBy, _ := value["generatedBy"].(string)
	if generatedBy != "ai" && generatedBy != "human" && generatedBy != "mixed" {
		bad("generatedBy", `must be exactly "ai", "human" or "mixed"`)
	}

	authors, ok := value["authors"].([]any)
	if !ok || len(authors) == 0 {
		bad("authors", "must be a non-empty array of { name, url? }")
	} else {
		for i, a := range authors {
			author, ok := a.(map[string]any)
			if !ok {
				bad(fmt.Sprintf("authors/%d/name", i), `author must be an object with a non-empty "name"`)
				continue
			}
			if _, ok := nonEmptyString(author["name"]); !ok {
				bad(fmt.Sprintf("authors/%d/name", i), `author must be an object with a non-empty "name"`)
				continue
			}
			if u, present := author["url"]; present {
				if _, ok := nonEmptyString(u); !ok {
					bad(fmt.Sprintf("authors/%d/url", i), `optional "url" must be a non-empty string when present`)
				}
			}
		}
	}

	// Optional strings: absent is fine, present-and-wrong is not.
	for _, key := range []string{"translationOf", "registryId"} {
		if v, present := value[key]; present {
			if _, ok := nonEmptyString(v); !ok {
				bad(key, fmt.Sprintf("optional %q must be a non-empty string when present", key))
			}
		}
	}

	parts, ok := value["parts"].([]any)
	if !ok || len(parts) == 0 {
		bad("parts", "must be a non-empty array of parts")
		return out
	}
	for p, pRaw := range parts {
		part, ok := pRaw.(map[string]any)
		if !ok {
			bad(fmt.Sprintf("parts/%d", p), "part must be an object")
			continue
		}
		if _, ok := nonEmptyString(part["title"]); !ok {
			bad(fmt.Sprintf("parts/%d/title", p), `missing or not a non-empty string: "title"`)
		}
		chapters, ok := part["chapters"].([]any)
		if !ok || len(chapters) == 0 {
			bad(fmt.Sprintf("parts/%d/chapters", p), "must be a non-empty array of chapters")
			continue
		}
		for c, cRaw := range chapters {
			chapter, ok := cRaw.(map[string]any)
			if !ok {
				bad(fmt.Sprintf("parts/%d/chapters/%d", p, c), "chapter must be an object")
				continue
			}
			for _, key := range []string{"id", "title", "short", "file"} {
				if _, ok := nonEmptyString(chapter[key]); !ok {
					bad(fmt.Sprintf("parts/%d/chapters/%d/%s", p, c, key), fmt.Sprintf("missing or not a non-empty string: %q", key))
				}
			}
			// num is a DISPLAY label ("0.1", "2.3") and may be the empty
			// string for a chapter that carries no number — the reader
			// already branches on that. What is required is that the key
			// is present and is a string, not that it is non-empty.
			if _, ok := chapter["num"].(string); !ok {
				bad(fmt.Sprintf("parts/%d/chapters/%d/num", p, c), `missing or not a string: "num" (may be empty for an unnumbered chapter)`)
			}
		}
	}

	return out
}

// checkVersionAndRuntime is checkVersionAndRuntime ported unchanged: SEMVER
// and RUNTIME_RANGE, split out because both Validate's direct manifest
// check and any future consumer that only has a candidate manifest (no
// package around it yet) need the same two checks. A missing or blank
// value is left to MANIFEST_FIELD above; reporting it twice would be noise.
func checkVersionAndRuntime(value map[string]any) []Finding {
	var out []Finding
	if v, ok := nonEmptyString(value["version"]); ok && !semverRE.MatchString(v) {
		out = append(out, finding("SEMVER", manifestPath+"#/version", fmt.Sprintf("not a semver version: %q", v)))
	}
	if r, ok := nonEmptyString(value["runtime"]); ok && !runtimeRangeRE.MatchString(r) {
		out = append(out, finding("RUNTIME_RANGE", manifestPath+"#/runtime", fmt.Sprintf("not a caret range like \"^1\": %q", r)))
	}
	return out
}

// locatedChapter is a chapter that survived checkManifestFields well
// enough to be walked further: it has a non-empty id and file, and
// pointer is the manifest JSON-pointer-ish path to it (used by
// DUPLICATE_CHAPTER_ID, PATH_ESCAPE and CHAPTER_FILE_MISSING).
type locatedChapter struct {
	id, file, pointer string
}

// locateChapters is locateChapters ported unchanged: walks parts[].chapters[]
// and returns only the entries whose id and file are present and
// non-empty, silently skipping anything else — a malformed chapter was
// already reported by checkManifestFields, and this function's callers
// need chapters they can actually look up in the files map, not a second
// report of the same defect.
func locateChapters(value map[string]any) []locatedChapter {
	var out []locatedChapter
	parts, ok := value["parts"].([]any)
	if !ok {
		return out
	}
	for p, pRaw := range parts {
		part, ok := pRaw.(map[string]any)
		if !ok {
			continue
		}
		chapters, ok := part["chapters"].([]any)
		if !ok {
			continue
		}
		for c, cRaw := range chapters {
			chapter, ok := cRaw.(map[string]any)
			if !ok {
				continue
			}
			id, idOK := nonEmptyString(chapter["id"])
			file, fileOK := nonEmptyString(chapter["file"])
			if !idOK || !fileOK {
				continue
			}
			out = append(out, locatedChapter{
				id:      id,
				file:    file,
				pointer: fmt.Sprintf("%s#/parts/%d/chapters/%d", manifestPath, p, c),
			})
		}
	}
	return out
}

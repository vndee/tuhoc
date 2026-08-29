// Task 7 of the server-side pivot: the eight WIDGET_* rules — the Go
// mirror of packages/course-format/src/widgets.ts, which is this file's
// single source of truth for what each rule catches, why the specific
// thresholds are what they are (measured against the sample courses, not
// guessed — see that file's own header and the task brief), and what
// Vietnamese sentence each finding carries there.
//
// # What these eight rules are for, and what they are NOT for
//
// A widget is one self-contained widgets/<name>/index.html that a later
// task renders inside <iframe srcdoc sandbox="allow-scripts"> — no
// allow-same-origin, so an opaque origin with no cookies, no storage and no
// reach into the reader's session. THAT sandbox is what makes a widget safe
// to execute. Nothing below inspects widget JS for what it could do to the
// page it runs in, because inside its own opaque origin there is nothing to
// do. What the sandbox does not buy is a widget a human can actually
// review before it merges: a 128 KB widget with one enormous minified line
// is not reviewable by anyone in the time a PR review actually gets. So
// the axis these eight rules measure is READABILITY and SELF-CONTAINMENT,
// not execution safety — small enough and plain enough to read, and
// carrying nothing that only makes sense with a network or a cookie jar
// the sandbox has already taken away. For each rule below, the doc comment
// answers the same question: what does a reviewer or reader lose if this
// rule were absent?
//
// # Detail text is English here. Not a style choice — a hard rule with a
// tripwire, and this paragraph exists to stop the next person from
// "fixing" it to Vietnamese and rediscovering why the hard way.
//
// It is tempting to read Finding.Code as the boring, load-bearing part and
// Finding.Detail as free text a Go file can set however it pleases,
// especially since widgets.ts's OWN Detail text — the file this one is
// otherwise a line-for-line port of — is Vietnamese. Resist that reading.
// The two fields answer different questions and follow different rules:
//
//   - Code is the cross-implementation CONTRACT. fixtures/format-v2/ pins
//     it — both this package and widgets.ts must agree on which Code a
//     hostile input produces, checked by the shared corpus. Nothing about
//     WHERE either implementation runs changes what a Code means.
//   - Detail's language is a property of WHERE THE CODE RUNS, not of which
//     rule fired. widgets.ts runs in `tuhoc pack`, ON THE AUTHOR'S OWN
//     MACHINE — it may say whatever helps that one specific person, in
//     whatever language helps them, because it is a local CLI tool with
//     one Vietnamese-speaking user in front of it. This package runs ON
//     THE SERVER, which is a different machine talking to readers with NO
//     KNOWN LANGUAGE PREFERENCE: no request header, no field anywhere in
//     this platform's protocol carries a reader's chosen language to the
//     server (the choice is deliberately device-local — see
//     apps/api/internal/server/i18n_server_speaks_codes_test.go, which
//     measured this: no file under apps/web/src reads a response body to
//     decide anything, because the client already translates by HTTP
//     STATUS CODE alone). A Vietnamese sentence written into ANY response
//     this package's caller sends reaches an English-reading user in
//     silence, and no other gate in this repo can catch that — the
//     bilingual system's hardcoded-string check scans only TypeScript/
//     JavaScript under apps/web, nothing server-side.
//
// apps/api/internal/server/i18n_server_speaks_codes_test.go enforces this
// with a token-level scan of every non-test .go file under apps/api,
// TestServerSpeaksNoVietnamese — deliberately with NO per-package
// exemption, and its own header explains why: a "this package is
// different" carve-out is exactly the shape the key-transit gate that used
// to sit next to it already rejected once (that file,
// no_key_transit_test.go, was deleted at Task 11 — its successor
// provider_key_never_leaks_test.go carries the same no-per-package-exemption
// rule forward). Adding one here — even with a
// justification attached to allowedVietnameseInProduction — would make
// this the SECOND file to try that argument, not the first, and it would
// still fail for the same reason: this Finding.Detail can reach a reader
// through a path Code alone does not, the moment a caller forwards it
// verbatim into a response.
//
// This is not a loss for the Vietnamese-speaking course AUTHOR `tuhoc
// publish` is for: the architecture already has a place for that
// translation, and it is not here. The server sends {code, path, detail} —
// English detail, for logs and bug reports — and `tuhoc publish` renders
// Code through the CLI's own Vietnamese FIX_HINTS table. The author still
// reads Vietnamese; it is produced by the process running on their own
// machine, the same one widgets.ts already runs in, not manufactured
// server-side and shipped to a reader who never asked for it.
//
// content.go's seven content rules and pkgcheck.go's manifest/package-shape
// rules are English for the identical reason, not merely for consistency
// with this file — every Finding this package emits runs the same "where
// does this run" test, and every one of them runs on the server.
//
// # Sizes and line lengths: BYTES, not characters
//
// WIDGET_TOO_LARGE and WIDGET_LINE_TOO_LONG are measured in bytes. Go's
// len() on a []byte is already a byte count — there is no character/rune
// step to accidentally take, the way widgets.test.ts's Vietnamese-diacritic
// test pins against on the TypeScript side (a rune like 'ơ' is one rune but
// two UTF-8 bytes; a length check keyed on rune count would let a
// too-long-in-bytes Vietnamese line through). Said explicitly here, in a
// comment, because a Go reader coming from a language where "length" more
// often means "character count" will otherwise wonder whether len(data)
// needed a utf8.RuneCountInString next to it. It does not: this file reads
// raw bytes throughout (data []byte, never a decoded string), which keeps
// every len() and bytes.Contains call in it a byte-level operation by
// construction. For WIDGET_TOO_LARGE this is an exact match with
// widgets.ts, which also measures raw byteLength there. For
// WIDGET_LINE_TOO_LONG the two sides can genuinely diverge on invalid
// UTF-8 input specifically — see checkWidgetIndex's own comment for where,
// why, and why Go's raw count is the one to keep.
package pkgcheck

import (
	"bytes"
	"fmt"
	"regexp"
)

// widgetMaxBytes is WIDGET_MAX_BYTES ported unchanged: the byte ceiling on
// one widget's index.html. Past this, a reviewer is not reading a widget in
// one sitting — the fix is to trim the widget, not to raise the number.
const widgetMaxBytes = 131072

// widgetMaxLineBytes is WIDGET_MAX_LINE_BYTES ported unchanged: the
// anti-minification fence. Minified JS is characteristically one enormous
// line; a per-line byte cap catches that shape directly rather than trying
// to detect "minified-ness" some cleverer, more guessable way. An author
// who wraps their code normally never approaches this; one who runs it
// through a minifier hits it on the first line.
const widgetMaxLineBytes = 500

// widgetNameRE is WIDGET_NAME_RE ported unchanged: a widget's name becomes
// a path segment a later task serves over HTTP (widgets/<name>/index.html)
// — lowercase, digits and hyphens only, starting with an alphanumeric so it
// can never be mistaken for a flag or a hidden/relative segment. The same
// shape a URL slug or an npm package name uses, for the same reason: it is
// unambiguous wherever it is later dropped into a path.
var widgetNameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// widgetNameMax is WIDGET_NAME_MAX ported unchanged: paired with
// widgetNameRE, a name that matches the shape but runs on forever is still
// not a usable path segment.
const widgetNameMax = 64

// widgetForbiddenAPIs is WIDGET_FORBIDDEN_APIS ported unchanged: substrings
// that mean "this code expects storage or a cookie jar" — and a widget's
// iframe (allow-scripts, deliberately NOT allow-same-origin) has neither.
// Calling any of these throws at runtime inside the sandbox, so
// WIDGET_FORBIDDEN_API catches the mistake at pack time instead of leaving
// an author to discover it from a broken widget in production. A plain
// substring match, not a parse of the JS, for the identical reason
// widgets.ts gives: the point is not to prove the API is reachable (an
// author who works around this list is just choosing to ship a widget that
// throws), it is to catch code written assuming a normal browser tab,
// which is what every widget's iframe is not.
var widgetForbiddenAPIs = []string{"document.cookie", "localStorage", "sessionStorage", "indexedDB"}

// widgetsPrefix is WIDGETS_PREFIX ported unchanged — deliberately its own
// copy, local to this file, not shared with manifestPath or any other
// constant in pkgcheck.go: widgets.ts makes the identical choice, keeping
// its own WIDGETS_PREFIX local rather than importing one from validate.ts.
const widgetsPrefix = "widgets/"

// widgetGroup is what was found under one widgets/<name>/ directory —
// WidgetGroup ported unchanged, field for field.
type widgetGroup struct {
	// hasIndex and indexBytes together stand in for widgets.ts's optional
	// indexBytes?: Uint8Array. A bare []byte cannot distinguish "no
	// index.html" from "an index.html that happens to be zero bytes" —
	// both would be a nil/empty slice — so hasIndex carries that
	// distinction explicitly instead of leaning on a Go zero value that
	// cannot make it.
	hasIndex   bool
	indexBytes []byte
	// extraPaths is every OTHER path under this widget's directory, full
	// package-relative path — WidgetGroup.extraPaths ported unchanged.
	extraPaths []string
}

// widgetNameFromDirPath extracts <name> from a path already confirmed by
// widgetDirRE to start with "widgets/<name>/". Distinct from
// widgetNameFromIndexPath in pkgcheck.go on purpose: that function's
// contract is narrower (its caller already knows the path is EXACTLY
// widgets/<name>/index.html, matched by widgetIndexRE), while this one
// must also handle widgets/<name>/ paths at any further depth
// (widgets/x/assets/chart.js) — the shape groupWidgetFiles walks every
// widget-directory entry through, not only its index.html.
func widgetNameFromDirPath(path string) string {
	rest := path[len(widgetsPrefix):]
	// widgetDirRE (^widgets/[^/]+/) already proved there is a '/' after
	// the prefix, so this Index cannot return -1 — the same fact
	// widgets.ts's groupWidgetFiles comment makes about its own indexOf.
	for i := 0; i < len(rest); i++ {
		if rest[i] == '/' {
			return rest[:i]
		}
	}
	return rest
}

// groupWidgetFiles groups every widgets/… entry in paths by widget name,
// splitting each into its index.html (if any) and everything else —
// groupWidgetFiles ported from widgets.ts, with one addition: it also
// returns names, the distinct widget names in FIRST-ENCOUNTER order while
// walking paths.
//
// paths is expected to already be Validate's own sorted path list (see
// Validate's own "Deterministic iteration" comment), so names ends up in
// the package's global sorted-PATH order — which is subtly NOT the same as
// sorting the bare widget names themselves. Two widget names where one is
// a hyphen-suffixed extension of the other sort differently by path than
// by name: "widgets/big-two/" sorts BEFORE "widgets/big/" as byte strings
// ('-' is 0x2D, '/' is 0x2F, and 0x2D < 0x2F), while "big" sorts before
// "big-two" as bare strings (a strict prefix is shorter, and a shorter
// string sorts first when it is a prefix of a longer one). This function
// deliberately preserves the PATH-sorted order — matching widgets.ts's own
// groupWidgetFiles, whose Map iterates in the order entries were inserted
// while walking `files`, which is itself the package's sorted-path order
// per packZip's own guarantee — rather than the alphabetically-simpler but
// wrong-order alternative of sorting names directly. See
// TestWidgetFindingOrderFollowsSortedPathsNotSortedNames for this pinned as
// a test, not left as a comment only.
func groupWidgetFiles(files map[string][]byte, paths []string) (byName map[string]*widgetGroup, names []string) {
	byName = make(map[string]*widgetGroup)
	for _, path := range paths {
		if !widgetDirRE.MatchString(path) {
			continue
		}
		name := widgetNameFromDirPath(path)

		group, ok := byName[name]
		if !ok {
			group = &widgetGroup{}
			byName[name] = group
			names = append(names, name)
		}

		if widgetIndexRE.MatchString(path) {
			group.hasIndex = true
			group.indexBytes = files[path]
		} else {
			group.extraPaths = append(group.extraPaths, path)
		}
	}
	return byName, names
}

// isRealWidget reports whether name names a widget that can actually
// render: a directory with an index.html in it — isRealWidget ported
// unchanged. A widgets/<name>/ directory holding only stray files (no
// index.html — already flagged WIDGET_EXTRA_FILE for each stray file by
// checkOneWidget) is NOT a real widget as far as the missing/orphan
// cross-reference is concerned, even though byName[name] != nil is true
// for it.
//
// Getting this wrong in both directions was widgets.ts's review round 1
// finding: a chapter referencing such a directory got no WIDGET_MISSING
// (the directory "existed"), and an unreferenced one got a WIDGET_ORPHAN
// pointing at an index.html that was never created. See
// TestWidgetDirWithOnlyStrayFileIsNotARealWidget below, which reproduces
// both directions directly rather than resting on the shared corpus alone.
func isRealWidget(byName map[string]*widgetGroup, name string) bool {
	g, ok := byName[name]
	return ok && g.hasIndex
}

// checkWidgetIndex runs the four content checks on one widget's
// index.html: size, line length, forbidden APIs, external URLs —
// checkWidgetIndex ported unchanged, same order (WIDGET_TOO_LARGE first,
// then every over-long line, then every forbidden API, then the URL
// check), operating on the SAME raw bytes throughout. A widget is capped
// at widgetMaxBytes (128 KiB), so unlike content.go's package-wide scan
// there is no proportional-cost reason to skip any of these checks even
// when an earlier one already fired.
//
// # WIDGET_TOO_LARGE and the forbidden-API/URL substring checks: exact
// agreement with widgets.ts, provably
//
// WIDGET_TOO_LARGE measures len(data) directly — the same quantity
// widgets.ts measures (bytes.byteLength, the raw Uint8Array's own length,
// never decoded). No divergence is possible here for any input.
//
// WIDGET_FORBIDDEN_API and WIDGET_EXTERNAL_URL read data directly with
// bytes.Contains, where widgets.ts decodes first (TextDecoder('utf-8'),
// which replaces invalid byte sequences with U+FFFD) and searches the
// decoded string. These agree on EVERY input, not only well-formed ones:
// U+FFFD's own UTF-8 encoding (0xEF 0xBF 0xBD) contains no ASCII byte, so
// no invalid byte sequence — however a decoder chops it up — can ever be
// replaced INTO, or have a byte silently dropped FROM, one of these
// pure-ASCII needles ("document.cookie", "https://", …). That is a proof,
// not an empirical claim: it holds for adversarial invalid-UTF-8 input
// exactly as it holds for well-formed input. Operating on
// bytes.Contains(data, …) directly just means this Go port never has to
// invoke that proof at runtime to get the right answer — it is correct by
// construction, with no decode step to reason about at all.
//
// # WIDGET_LINE_TOO_LONG: the one place this file's measurement CAN
// genuinely diverge from widgets.ts's, and why the divergent direction is
// the safe one to have kept
//
// Go measures len(line) where line is bytes.Split(data, []byte{'\n'})'s
// output — the exact raw bytes between two '\n' bytes in the file as it
// will actually be stored and served inside the widget's iframe.
//
// widgets.ts measures something else: decoder.decode(bytes) ONCE over the
// WHOLE file (TextDecoder('utf-8'), replacing every invalid byte sequence
// with U+FFFD), THEN text.split('\n') on the resulting string, THEN
// encoder.encode(line).byteLength — re-encoding each already-replaced line
// back to UTF-8. For well-formed UTF-8 — every realistic widget's HTML/
// CSS/JS, Vietnamese comments included — decode-then-re-encode is lossless
// and idempotent, so this produces the identical byte count Go's raw split
// does, on every line, always: no divergence for any input a real widget
// author would ever write.
//
// For a line containing genuinely INVALID UTF-8 byte sequences, agreement
// is not guaranteed, and the difference can run in EITHER direction. A
// single invalid byte standing alone typically decodes to one U+FFFD,
// which re-encodes to 3 bytes — INFLATING TS's count relative to Go's for
// that byte. A longer invalid or overlong multi-byte attempt (4-6 raw
// bytes) can instead be consumed as one "maximal subpart" by the decoder
// and likewise collapse to a single 3-byte U+FFFD — DEFLATING TS's count
// below the true raw byte count of that run. The second direction is the
// one that matters for what this rule exists to stop: it means TS's own
// measured number can be made to UNDERSTATE the true number of bytes a
// line actually contains once served, by padding it with invalid
// multi-byte junk engineered to collapse under decode. Go's raw count
// cannot be fooled this way, for the simple reason that it never takes a
// decode step at all — len(line) IS the number of bytes that will be
// read, byte for byte, by whatever renders widgets/<name>/index.html.
// That is the more principled quantity for a rule whose entire point (see
// this file's header) is bounding what a human reviewer actually has to
// read, so keeping Go's direct measurement — rather than matching TS's
// lossy proxy for it — is the safe direction: it cannot be made to
// under-report a line's true size the way a decode-based measurement can.
//
// This divergence is real but UNEXERCISED BY ANY TEST, Go or TypeScript:
// no legitimate widget author's editor emits invalid UTF-8, and neither
// this package's test suite nor widgets.test.ts constructs an
// invalid-UTF-8 input to pin the two sides' actual behavior against each
// other on this specific axis. Said explicitly here so a future reader
// does not read "ported unchanged" at the top of this comment as a claim
// that covers this case too — it does not.
func checkWidgetIndex(path string, data []byte) []Finding {
	var out []Finding

	if len(data) > widgetMaxBytes {
		out = append(out, finding("WIDGET_TOO_LARGE", path, fmt.Sprintf(
			"index.html is %d bytes, over the %d byte ceiling for one widget — trim the content, or move large images/data out of the widget",
			len(data), widgetMaxBytes,
		)))
	}

	for i, line := range bytes.Split(data, []byte{'\n'}) {
		if len(line) > widgetMaxLineBytes {
			out = append(out, finding("WIDGET_LINE_TOO_LONG", path, fmt.Sprintf(
				"line %d is %d bytes, over the %d byte/line ceiling — this looks minified or crammed onto one line; rewrap it across multiple lines so a reviewer can read it",
				i+1, len(line), widgetMaxLineBytes,
			)))
		}
	}

	for _, api := range widgetForbiddenAPIs {
		if bytes.Contains(data, []byte(api)) {
			out = append(out, finding("WIDGET_FORBIDDEN_API", path, fmt.Sprintf(
				"contains %q — a widget's sandboxed iframe has no cookies or storage, so calling this only throws at runtime; remove it from the widget",
				api,
			)))
		}
	}

	if bytes.Contains(data, []byte("http://")) || bytes.Contains(data, []byte("https://")) {
		out = append(out, finding("WIDGET_EXTERNAL_URL", path,
			"a widget must be self-contained: it may not load anything from the network, not even inside a comment — remove the URL"))
	}

	return out
}

// checkOneWidget runs WIDGET_BAD_NAME and WIDGET_EXTRA_FILE for one widget
// directory, plus the content checks on its index.html if it has one —
// checkOneWidget ported unchanged, same order (name, then every extra
// file, then index content).
func checkOneWidget(name string, group *widgetGroup) []Finding {
	var out []Finding
	widgetDir := widgetsPrefix + name

	if !widgetNameRE.MatchString(name) || len(name) > widgetNameMax {
		out = append(out, finding("WIDGET_BAD_NAME", widgetDir, fmt.Sprintf(
			"widget name %q is not valid: only lowercase a-z, digits 0-9 and hyphens, starting with a letter or digit, at most %d characters — rename the %s/ directory",
			name, widgetNameMax, widgetDir,
		)))
	}

	for _, extraPath := range group.extraPaths {
		out = append(out, finding("WIDGET_EXTRA_FILE", extraPath, fmt.Sprintf(
			"a widget may carry exactly one file — %s/index.html; fold this file's content into index.html, or delete it",
			widgetDir,
		)))
	}

	if group.hasIndex {
		out = append(out, checkWidgetIndex(widgetDir+"/index.html", group.indexBytes)...)
	}

	return out
}

// checkWidgets runs all eight widget rules over a package: per-widget
// shape/size/content checks, plus the cross-reference between what
// chapters ask for (data-widget="…") and what widgets the package actually
// ships — checkWidgets ported from widgets.ts, adapted to the types
// Validate already has in hand rather than the (files, chapterFiles)
// signature widgets.ts takes, for one reason: this function needs each
// chapter's OWN html bytes to find its data-widget references, and
// Validate already has those in files keyed by lc.file — located gives
// exactly the (id, file) pairs widgets.ts's chapterFiles is built from
// (locatedChapters.map(({chapter}) => chapter.file)), in the same manifest
// order, so passing located plays the same role here without needing a
// second, Go-only "chapter file list" type.
//
// A ref found via extractWidgetNames (content.go, Task 6) rather than a
// second, hand-rolled scanner — reusing that function is what makes
// data-widget read case-insensitively for free (golang.org/x/net/html's
// TagAttr already lower-cases attribute keys) and keeps this file from
// growing a second HTML tokenizer pass for something content.go's already
// covers. extractWidgetNames also already deduplicates PER CHAPTER, in
// first-seen order — which is exactly the granularity WIDGET_MISSING needs
// (a chapter placing the same missing widget five times must report once,
// not five times) and exactly what widgets.ts's own per-chapter
// `reportedMissing` Set achieves by a different route (that function
// dedupes at the finding-emission layer using undeduplicated
// extractWidgetRefs; this one gets the same per-chapter dedup for free one
// layer earlier, from the field content.go already computes for
// Chapter.WidgetNames). The two approaches produce the identical set and
// order of (chapterPath, ref) pairs: both are "first occurrence of each
// distinct name in this chapter, in the order it first appears".
//
// referenced accumulates every ref seen across every chapter (repeats
// across DIFFERENT chapters, unlike within one chapter, are exactly what
// must all count — two chapters both referencing one widget must both mark
// it non-orphan), so WIDGET_ORPHAN below is decided correctly regardless
// of which chapter did the referencing.
//
// An empty data-widget="" gets its own detail sentence rather than being
// reported as a reference to the widget named "" — see the ref == "" branch
// below. This can never collide with a REAL widget: byName can never hold
// the empty string as a key, because widgetDirRE (^widgets/[^/]+/) requires
// at least one character between the two slashes, so there is no directory
// path an empty name could ever have come from.
func checkWidgets(files map[string][]byte, paths []string, located []locatedChapter) []Finding {
	var out []Finding
	byName, names := groupWidgetFiles(files, paths)

	for _, name := range names {
		out = append(out, checkOneWidget(name, byName[name])...)
	}

	referenced := make(map[string]bool)
	for _, lc := range located {
		data, ok := files[lc.file]
		if !ok {
			// Already reported CHAPTER_FILE_MISSING by Validate's own
			// chapter loop — nothing more to say about a file that is not
			// in the package at all.
			continue
		}
		for _, ref := range extractWidgetNames(data) {
			referenced[ref] = true
			if isRealWidget(byName, ref) {
				continue
			}
			var detail string
			if ref == "" {
				detail = `this chapter has a data-widget="" that names no widget — give it a real name, e.g. data-widget="dem-so", matching a widgets/dem-so/ directory`
			} else {
				detail = fmt.Sprintf(
					"this chapter references widget %q via data-widget, but the package has no %s%s/index.html",
					ref, widgetsPrefix, ref,
				)
			}
			out = append(out, finding("WIDGET_MISSING", lc.file, detail))
		}
	}

	for _, name := range names {
		if !isRealWidget(byName, name) || referenced[name] {
			continue
		}
		out = append(out, finding("WIDGET_ORPHAN", widgetsPrefix+name+"/index.html", fmt.Sprintf(
			"widget %q is not referenced by any chapter via data-widget=%q — delete this widget directory if it is no longer used, or add data-widget=%q to the chapter that needs it",
			name, name, name,
		)))
	}

	return out
}

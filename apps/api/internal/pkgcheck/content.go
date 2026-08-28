package pkgcheck

// The seven content rules — the part of format v2's rule set that a real
// HTML tokenizer decides, not a JSON-shape check. Ported from
// packages/course-format/src/validate.ts's scanHtmlText, which is the
// single source of truth for what each rule catches and misses; that
// file's own header records the measurements behind every decision below,
// and this file carries the same reasoning rather than re-deriving it.
//
// # Why a real tokenizer, and why golang.org/x/net/html's Tokenizer type
// specifically
//
// A regex trying to reproduce where an HTML tokenizer thinks one attribute
// stops and the next starts loses to real markup — validate.ts's header
// names three measured bypasses (a "/"-separated attribute, a ">" inside a
// quoted value, a scan keyed on file extension) that a text scan could not
// see and a tokenizer sees for free, because it is not guessing at
// boundaries, it is reading them off the byte stream the way a browser
// does. html.NewTokenizer is the low-level token stream, not html.Parse's
// tree builder: a tree is built for one insertion context and drops
// attributes that only apply in another (see validate.ts's header for the
// "<body onload>" / bare "<td onclick>" / "<select><img onerror>"
// examples), so the token stream — a superset of every context — is the
// one that cannot under-report by construction.
//
// # The one place golang.org/x/net/html and parse5 disagree, and how this
// file closes it
//
// parse5's Tokenizer, used WITHOUT a tree builder (exactly how
// scanHtmlText drives it), never leaves the default "Data" state: it does
// not know to treat "<script>...</script>", "<style>...</style>" and
// similar bodies as raw text, because that state switch is normally the
// tree builder's job. validate.ts calls this out as a deliberate
// over-approximation — content inside those bodies is tokenized as markup
// too, which can only add findings, never miss one.
//
// golang.org/x/net/html's Tokenizer does NOT share that default: reading a
// "<script>", "<style>", "<textarea>", "<title>", "<iframe>", "<noembed>",
// "<noframes>", "<noscript>", "<plaintext>" or "<xmp>" start tag switches
// it into raw-text mode on its own (see (*Tokenizer).readStartTag), and
// content up to the matching end tag is then returned as one opaque text
// token — never re-tokenized as markup. Left alone, that is a real gap
// relative to the TypeScript sibling: "<noscript><img src=x
// onerror=alert(1)></noscript>" would tokenize the "<img onerror>" as text
// in Go and as a start tag in TypeScript, and "noscript" is not one of
// embeddedFrameTags or "script", so nothing else here would catch it.
//
// The package documents its own way out: "it is the responsibility of the
// user of a tokenizer to call NextIsNotRawText as appropriate" —
// (*Tokenizer).NextIsNotRawText exists for exactly this. scanHTMLText and
// extractWidgetNames both call it after every token, unconditionally,
// which keeps this tokenizer in the same always-Data-state posture
// parse5's has without a tree builder attached — closing the gap rather
// than merely noting it.
//
// # Attribute handling
//
// (*Tokenizer).TagName lower-cases the tag name and (*Tokenizer).TagAttr
// lower-cases each attribute key and returns its value already unescaped
// (character references decoded), matching parse5's tokenizer exactly on
// the two properties EVENT_HANDLER_ATTR and JAVASCRIPT_URL depend on: a
// handler name is matched case-insensitively, and a "javascript:" scheme
// is decided after entity decoding, not before it.
//
// validate.ts needed a custom BoundedTokenizer subclass to make attribute
// deduplication O(1) instead of O(n^2) — parse5's own duplicate-attribute
// check re-scans the attribute list already built, once per attribute, and
// that quadratic blowup was measured to hang every consumer of that module
// on a single enormous tag. golang.org/x/net/html's (*Tokenizer).readTag
// already dedups with a map (z.attrNames[key]), so no equivalent subclass
// is needed here: the DoS that BoundedTokenizer exists to close was never
// present in this library. maxAttrsPerTag below exists only for parity
// with TAG_ATTR_FLOOD as a finding — a document that carries one tag with
// more than a handful of attributes is not a document, whatever tokenizer
// reads it — not to fix a bug this implementation does not have.
import (
	"bytes"
	"fmt"
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

// maxAttrsPerTag mirrors validate.ts's MAX_ATTRS_PER_TAG: 4x the largest
// attribute count that module's measurements found on any benign input
// (a real hand-authored SVG topped out at 7) and comfortably clear of what
// minified JavaScript tokenized as markup produces by accident (257, on a
// real minified bundle). See that constant's own doc comment in
// validate.ts for the full measurement table; the number is carried across
// unchanged rather than re-derived — TS and Go must reject the same input
// on this axis, and there is only one axis: "measured, not guessed" is a
// claim about the number, not about which language holds it.
const maxAttrsPerTag = 1024

// embeddedFrameTags is EMBEDDED_FRAME_TAGS ported unchanged from
// validate.ts: the five start tags whose mere presence embeds something
// this format has no way to sandbox at scan time.
var embeddedFrameTags = map[string]bool{
	"iframe":   true,
	"object":   true,
	"embed":    true,
	"frame":    true,
	"frameset": true,
}

// eventHandlerNameRE is EVENT_HANDLER_NAME_RE ported unchanged: every event
// handler content attribute HTML defines is "on" followed by two or more
// ASCII letters and nothing else. TagAttr already lower-cases the key
// (case-insensitivity for free — ONERROR arrives here as onerror), so this
// need not fold case itself.
var eventHandlerNameRE = regexp.MustCompile(`^on[a-z]{2,}$`)

// contentRule pairs a finding code with the fixed detail sentence
// scanHTMLText reports it with.
type contentRule struct {
	code   string
	detail string
}

// contentRuleOrder is CONTENT_TIER_RULES ported unchanged: a fixed report
// order, so two runs over the same file list their findings the same way
// regardless of where in the document each violation was seen.
var contentRuleOrder = []contentRule{
	{"SCRIPT_TAG", "must not contain a <script> tag"},
	{"EVENT_HANDLER_ATTR", "must not contain an inline on*= event handler"},
	{"JAVASCRIPT_URL", "must not contain a javascript: URL"},
	{"EMBEDDED_FRAME", "must not embed a frame (<iframe>/<object>/<embed>)"},
	{"FORM_TAG", "must not contain a <form> tag"},
	{"TAG_ATTR_FLOOD", fmt.Sprintf(
		"a single start tag carries more than %d attributes, which no document does by accident",
		maxAttrsPerTag,
	)},
}

// scanHTMLText runs the six start-tag-driven content rules over one
// package entry's decoded bytes. Only START TAGS and self-closing tags are
// inspected — text, comments, doctypes and end tags carry nothing a
// browser executes, which is the distinction that lets a chapter that
// TEACHES html (via an escaped example) stay clean; see validate.ts's
// scanHtmlText doc comment for the measured table of what each rule
// catches and misses, and for the three shapes of false positive and the
// one true escape hatch (escape the whole tag).
//
// path is carried through unchanged into every Finding so a caller can
// point at the offending package entry.
func scanHTMLText(path string, data []byte) []Finding {
	seen := make(map[string]bool, len(contentRuleOrder))

	z := html.NewTokenizer(bytes.NewReader(data))
	for {
		tt := z.Next()
		// See the file-level comment: this is what keeps the tokenizer in
		// the always-Data-state posture the TypeScript sibling has by
		// construction (no tree builder attached). Unconditional and after
		// every token, not just ones that turn out to matter, because the
		// call has to land BEFORE the next Next() would otherwise honor a
		// raw-text switch that Next() just recorded.
		z.NextIsNotRawText()

		if tt == html.ErrorToken {
			// bytes.Reader never reports an I/O error other than io.EOF, so
			// this is always "end of input", never a lost tail of the file.
			break
		}
		if tt != html.StartTagToken && tt != html.SelfClosingTagToken {
			continue
		}

		name, hasAttr := z.TagName()
		switch string(name) {
		case "script":
			seen["SCRIPT_TAG"] = true
		case "form":
			seen["FORM_TAG"] = true
		}
		if embeddedFrameTags[string(name)] {
			seen["EMBEDDED_FRAME"] = true
		}
		if !hasAttr {
			continue
		}

		attrCount := 0
		for {
			key, val, more := z.TagAttr()
			attrCount++
			if eventHandlerNameRE.Match(key) {
				seen["EVENT_HANDLER_ATTR"] = true
			}
			if isJavascriptURLValue(string(val)) {
				seen["JAVASCRIPT_URL"] = true
			}
			if !more {
				break
			}
		}
		// Unlike validate.ts's BoundedTokenizer, nothing here stops reading
		// attributes once the ceiling is crossed — see the file comment on
		// why no such cap is needed for this tokenizer's own performance.
		// The consequence is a strictly SAFER direction than the
		// TypeScript sibling: a handler placed after the 1024th attribute
		// on a flooded tag is still inspected here, where BoundedTokenizer
		// would have silently stopped storing attributes at that point and
		// relied on TAG_ATTR_FLOOD alone to reject the package.
		if attrCount > maxAttrsPerTag {
			seen["TAG_ATTR_FLOOD"] = true
		}
	}

	var out []Finding
	for _, rule := range contentRuleOrder {
		if seen[rule.code] {
			out = append(out, Finding{Code: rule.code, Path: path, Detail: rule.detail})
		}
	}
	return out
}

// jsWhitespaceRunes and jsWhitespaceRangeLo/Hi together encode the exact
// character class ECMAScript's bare \s metacharacter matches — the
// WhiteSpace and LineTerminator productions, used the way
// validate.ts's isJavascriptUrlValue uses it, without the "u" flag:
// value.replace(/[\s\u0000-\u001f]/g, "").
//
// This is deliberately NOT unicode.IsSpace: JS's bare \s includes U+FEFF
// (byte-order mark / zero-width no-break space) and excludes U+0085 (NEL),
// while Go's unicode.IsSpace is the other way around on both. The two rule
// sets have to agree on a hostile input, so the codepoints are reproduced
// by value here (as \u escapes, not as literal characters, so the source
// file stays unambiguous byte-for-byte) rather than approximated with the
// nearest stdlib check.
var jsWhitespaceRunes = map[rune]bool{
	'\t':     true, // U+0009 CHARACTER TABULATION
	'\n':     true, // U+000A LINE FEED
	'\v':     true, // U+000B LINE TABULATION
	'\f':     true, // U+000C FORM FEED
	'\r':     true, // U+000D CARRIAGE RETURN
	' ':      true, // SPACE
	'\u00a0': true, // NO-BREAK SPACE
	'\u1680': true, // OGHAM SPACE MARK
	'\u2028': true, // LINE SEPARATOR
	'\u2029': true, // PARAGRAPH SEPARATOR
	'\u202f': true, // NARROW NO-BREAK SPACE
	'\u205f': true, // MEDIUM MATHEMATICAL SPACE
	'\u3000': true, // IDEOGRAPHIC SPACE
	'\ufeff': true, // ZERO WIDTH NO-BREAK SPACE / BOM
}

// jsWhitespaceRangeLo/Hi is U+2000 EN QUAD .. U+200A HAIR SPACE, the one
// contiguous run in ECMAScript's \s production that is cheaper to check as
// a range than to list rune by rune.
const (
	jsWhitespaceRangeLo = '\u2000'
	jsWhitespaceRangeHi = '\u200a'
)

// isJSWhitespaceOrControl reports whether r is stripped by
// isJavascriptURLValue before the scheme check: a C0 control character
// (U+0000-U+001F), one of jsWhitespaceRunes, or inside the
// U+2000-U+200A run of Unicode spaces.
func isJSWhitespaceOrControl(r rune) bool {
	if r <= '\x1f' {
		return true
	}
	if r >= jsWhitespaceRangeLo && r <= jsWhitespaceRangeHi {
		return true
	}
	return jsWhitespaceRunes[r]
}

// isJavascriptURLValue is isJavascriptUrlValue ported unchanged: strip the
// whitespace and C0 controls a URL parser ignores, lower-case what is left,
// and check the scheme. Character references are already decoded by the
// time a value reaches here (TagAttr does that, matching parse5), which is
// what makes both "&#106;avascript:" and prose that merely starts with the
// word (see validate.ts's false-positive table, case 3) fall out of this
// the same way they do in the TypeScript sibling.
func isJavascriptURLValue(value string) bool {
	var b strings.Builder
	b.Grow(len(value))
	for _, r := range value {
		if isJSWhitespaceOrControl(r) {
			continue
		}
		b.WriteRune(r)
	}
	return strings.HasPrefix(strings.ToLower(b.String()), "javascript:")
}

// extractWidgetNames collects every data-widget attribute value from a
// chapter's HTML, in the order first seen, deduplicated — see
// Chapter.WidgetNames's own doc comment for why this field dedupes where
// validate.ts's extractWidgetRefs deliberately does not (that function
// feeds a per-occurrence renderer; this field feeds Task 7's
// cross-reference between what a chapter asks for and what the package
// ships).
//
// Driven by the same tokenizer as scanHTMLText and for the same reason
// widgets.ts's extractWidgetRefs reuses validate.ts's BoundedTokenizer
// rather than a second, regex-based pass: an attribute boundary is a
// tokenizer state, not a character class, and a chapter fragment is
// exactly the untrusted input that fact matters for.
func extractWidgetNames(data []byte) []string {
	seen := make(map[string]bool)
	var names []string

	z := html.NewTokenizer(bytes.NewReader(data))
	for {
		tt := z.Next()
		z.NextIsNotRawText() // see scanHTMLText's file-level comment
		if tt == html.ErrorToken {
			break
		}
		if tt != html.StartTagToken && tt != html.SelfClosingTagToken {
			continue
		}
		_, hasAttr := z.TagName()
		if !hasAttr {
			continue
		}
		for {
			key, val, more := z.TagAttr()
			if string(key) == "data-widget" {
				name := string(val)
				if !seen[name] {
					seen[name] = true
					names = append(names, name)
				}
			}
			if !more {
				break
			}
		}
	}
	return names
}

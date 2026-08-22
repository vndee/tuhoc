/**
 * The course-package rule set — **the single copy**.
 *
 * Three places must agree on what a valid package is:
 *   1. the packaging CLI (`tools/`, task 3) — refuses to emit a bad package;
 *   2. registry CI (subsystem 3) — refuses to accept a bad package;
 *   3. the browser (`apps/web`, task 8) — refuses to import a bad package.
 *
 * A second implementation of these rules is a *drifted copy*: the CLI blesses
 * what CI rejects, or the browser accepts what neither saw. All three import
 * THIS module. If a rule needs to change, it changes here, once.
 *
 * ## Scope, stated plainly
 *
 * This module is a **first fence, not the only fence**. For `tier: 'content'`
 * it makes a mechanical promise (no executable code paths it knows how to
 * spot). For `tier: 'interactive'` it makes no promise about the JavaScript at
 * all — that tier's guarantee comes from human review at the registry. Read
 * {@link scanHtmlText} for exactly what the content-tier scan catches and what
 * it misses; that list is written down so nobody mistakes this for a
 * sanitizer.
 *
 * ## Why an HTML parser, and why the tokenizer specifically
 *
 * The first version of this file scanned with regexes, because the package runs
 * in Node (CLI, CI) as well as in the browser and there is no `DOMParser` in
 * either half of that intersection. Three independent bypasses were then
 * measured against it, each one running real JavaScript in Chromium through the
 * reader's own `container.innerHTML = html`:
 *
 *   1. `<img/onerror=…>` and `<img src="x"onerror=…>` — HTML separates
 *      attributes with `/` and with a closing quote, not only with whitespace;
 *   2. `<img title="a>b" onerror=x src=y>` — a `>` inside a quoted value ends
 *      the tag as far as `[^>]*` is concerned, and it never sees the handler;
 *   3. renaming `chapter.file` to `c1.txt` — the scan was keyed on the file
 *      extension, so the rules simply did not run.
 *
 * (1) and (2) are the same bug twice: a text scan trying to reproduce where the
 * HTML tokenizer thinks one attribute stops and the next starts. Patching the
 * regex a third time would buy the next round of bypasses, not the last one.
 * So the boundaries are no longer guessed — they come from `parse5`, the HTML5
 * parser `jsdom` is built on: plain JavaScript, no DOM, no Node built-ins, and
 * measured running unchanged in Chromium — the whole rule set was bundled for
 * the browser and re-run there, zero page errors, same findings (see
 * `task-1-report.md`, "vòng sửa 1").
 *
 * We use parse5's **tokenizer**, not its tree builder, and that is a decision
 * with a measurement behind it. A tree is built for one insertion context, and
 * every context drops something different: fragment parsing discards
 * `<body onload=…>` (which runs when a chapter file is opened directly as a
 * document), document parsing discards a bare `<td onclick=…>`, and both
 * discard `<select><img onerror=…></select>`. Neither is a superset of the
 * other. The token stream is a superset of both — every attribute the HTML
 * tokenizer builds, in every context, with character references already
 * decoded exactly as a browser decodes them. Over-approximating is the right
 * direction here: this tier's promise is that the package *cannot* execute
 * code, so a miss is fatal and a false positive costs one reviewer glance.
 *
 * The cost is that `Tokenizer` is marked `@internal` by parse5 even though it
 * is exported and typed from the package root, and {@link BoundedTokenizer}
 * goes one level further in by overriding three of its `protected` methods.
 * `parse5` is therefore pinned to an exact version in `package.json`; `tsc -b`
 * is a real gate over this file, so a changed member signature is a red build
 * rather than a silent miss; and the C1/C2, duplicate-attribute and N1 timing
 * tests in `validate.test.ts` are what would go red if a future version changed
 * the behaviour behind an unchanged signature.
 *
 * ## What this module does NOT promise about resources
 *
 * It is synchronous and it runs to completion. Even a well-behaved package at
 * the full {@link MAX_UNCOMPRESSED_BYTES} budget was measured at 2.8–4.2 s of
 * blocked main thread on a slow machine, which is a frozen tab. Task 8 must
 * call this off the main thread (a Worker) or slice it per entry with a yield.
 * {@link MAX_ATTRS_PER_TAG} removes the *super-linear* case, not the linear
 * one: the caller still owes this module a byte budget, applied BEFORE the
 * bytes get here — the same debt the `MAX_UNCOMPRESSED_BYTES` comment names for
 * zip bombs.
 */

import { Tokenizer } from 'parse5';
import type { Token, TokenHandler } from 'parse5';

import type { Chapter, Manifest } from './types';

export interface Finding {
  readonly code: string;
  readonly path: string;
  readonly detail: string;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly findings: readonly Finding[];
}

/**
 * Every code this module can emit. Exported so a consumer can render a legend,
 * and so `validate.test.ts` can assert that no code exists without a test.
 */
export const FINDING_CODES = [
  // --- every tier -------------------------------------------------------
  'EMPTY_PACKAGE',
  'TOO_LARGE',
  'PATH_ESCAPE',
  'MANIFEST_MISSING',
  'MANIFEST_PARSE',
  'MANIFEST_FIELD',
  'SEMVER',
  'RUNTIME_RANGE',
  'DUPLICATE_CHAPTER_ID',
  'CHAPTER_FILE_MISSING',
  // --- tier: 'content' only ---------------------------------------------
  'SCRIPT_TAG',
  'EVENT_HANDLER_ATTR',
  'JAVASCRIPT_URL',
  'EMBEDDED_FRAME',
  'FORM_TAG',
  'JS_FILE_IN_PACKAGE',
  'TAG_ATTR_FLOOD',
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

/**
 * Budget for the **decoded** size of a package: the sum of every entry's byte
 * length after decompression, never the size of the zip on disk. A zip bomb is
 * a few kilobytes compressed; checking the compressed size would wave it
 * through. The caller inflates first, then asks this module.
 */
export const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;

/**
 * Ceiling on the number of attributes **one start tag** may carry.
 *
 * ## Why there has to be a ceiling
 *
 * `parse5` implements the spec's "drop duplicate attributes" rule by scanning
 * the attribute list built so far, once per attribute
 * (`tokenizer/index.js:336`, `getTokenAttr`). That is O(n²) in the attributes
 * on a single tag, and it was measured to hang every consumer of this module:
 * 64,000 attributes — 552 KiB, **2.6% of {@link MAX_UNCOMPRESSED_BYTES}** —
 * took 6.0 s on the Chromium main thread, i.e. a dead tab, while the *same
 * byte count* spread over ordinary small tags took 28 ms. Total size is
 * therefore not the discriminator and `TOO_LARGE` cannot fence this;
 * attributes-per-tag is the axis, so that is the axis with a limit on it.
 *
 * ## What the ceiling is for, and what it is NOT for
 *
 * It is **not** what makes the scan fast. {@link BoundedTokenizer} removes the
 * quadratic itself, and once that is gone the ceiling barely moves the clock:
 * measured on the worst adversarial payload that fits the 20 MiB budget — every
 * tag stuffed to exactly the ceiling, i.e. an attacker deliberately staying
 * one attribute under the rule — 1024 costs 1,114 ms and 65,536 costs 1,242 ms.
 * For comparison a *benign* 20 MiB tag-dense package costs 797 ms, so the
 * attacker's remaining leverage is ~1.3×, not the 14,000× N1 measured.
 *
 * What it does buy is **memory**, and that is a DoS of its own. 1,747,285
 * attributes on one tag — a single 17.3 MiB entry, inside this module's own
 * budget — peaks at 1,322 MiB of RSS with no ceiling and 733 MiB with this one,
 * while also running 2,049 ms instead of 875 ms. A gigabyte of attribute
 * objects is an out-of-memory kill on a phone or a CI container.
 *
 * Second, it turns "this is not a document" into a finding a human can read
 * rather than a slow success.
 *
 * ## Where the number comes from
 *
 * Measured, not guessed — the largest attribute count on any single start tag
 * across every real corpus at hand:
 *
 * | corpus                                                    | max attrs on one tag |
 * |-----------------------------------------------------------|---------------------|
 * | the 44 shipping chapters of a real packed textbook         |   **2**             |
 * | `favicon.svg` (real hand-authored SVG)                     |   **7**             |
 * | the whole real package, incl. `viz.js` (176 KB, minified)  |  **70**             |
 * | that textbook's 1.9 MiB single-file v1 source              | **141**             |
 * | `apps/web/dist` (376 KB minified JS + 398 KB CSS)          | **257**             |
 *
 * Note where the big numbers come from: not from markup, but from minified
 * JavaScript, which this scan tokenizes as markup on purpose (see
 * {@link scanHtmlText}, "deliberate over-approximation") and which turns
 * `for(i=0;i<o;++c){var …}` into a pseudo start tag with 257 "attributes".
 * Real HTML tops out at 7.
 *
 * 1024 is **4× the largest value any benign input produced** and ~150× the
 * largest that genuine markup produced. A document does not reach it by being
 * long, only by being built to. It is a round number on purpose: a limit that
 * looks derived invites someone to re-derive it from one new sample.
 */
export const MAX_ATTRS_PER_TAG = 1024;

/** Path used by findings that are about the package as a whole, not one file. */
const PACKAGE_ROOT = '.';

export const MANIFEST_PATH = 'manifest.json';

/** https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string */
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * The only shape `runtime` may take: a caret range over 1–3 numeric parts,
 * e.g. `^1`, `^1.2`, `^1.2.3`. Deliberately narrower than npm's range grammar —
 * a manifest that says `>=1 <3 || 4.x` is asking a question this platform has
 * no reason to answer, and every extra operator is another thing three
 * implementations would have to agree about.
 */
const RUNTIME_RANGE_RE = /^\^(0|[1-9]\d*)(?:\.(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?)?$/;

/**
 * Files that are executable in a browser by being loaded. `.mjs`/`.cjs`/`.jsx`
 * are included alongside the `*.js` the rule names — same executable content,
 * different suffix, and leaving them out would be a hole with no upside.
 * `.ts` is NOT here: a browser cannot load it directly, and a package shipping
 * uncompiled sources next to nothing that runs them is odd, not dangerous.
 */
const JS_FILE_RE = /\.(?:js|mjs|cjs|jsx)$/i;

const decoder = new TextDecoder('utf-8');

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function finding(code: FindingCode, path: string, detail: string): Finding {
  return { code, path, detail };
}

/**
 * True when a package-relative path could resolve outside the package once a
 * consumer joins it to a destination directory.
 *
 * Catches: any `..` segment, a leading `/` (absolute POSIX), a drive-letter
 * prefix in either slash direction, a UNC prefix and every other use of `\` (a
 * backslash is never a legitimate separator here, and on Windows it IS one),
 * and the empty path.
 *
 * The drive-letter rule is its own line and not a side effect of the backslash
 * rule, because that is exactly how it was missed: `C:\windows\evil.txt` was
 * refused — by the backslash — while `C:/evil.txt` was allowed, and
 * `path.win32.resolve('C:\\pkg', 'C:/evil.txt')` is `C:\evil.txt`, outside the
 * package. Same shape as the lesson this file already carries elsewhere: a rule
 * written against one *spelling* of a thing, standing in for the thing.
 * `C:evil.txt` (drive-RELATIVE) resolves to `C:\pkg\evil.txt` and does not
 * escape, and is refused anyway: where it lands depends on that drive's current
 * directory at extraction time, and a package may not carry a name whose
 * meaning is decided by the reader's machine. A colon elsewhere in a name
 * (`ghi chú: bản 2.txt`) is an ordinary POSIX filename and stays allowed.
 *
 * Misses: percent-encoded traversal (`%2e%2e/`) and Unicode look-alikes. Those
 * are decoded by whoever decodes them, not by this module — a consumer must
 * never URL-decode an entry name before extraction.
 *
 * Exported because `zip.ts` asks the same question of a zip entry name before
 * it inflates it, and two implementations of "does this path leave the package"
 * is one answer too many — the whole reason this file is the single copy.
 */
export function escapesPackage(path: string): boolean {
  if (path.length === 0) return true;
  if (path.includes('\\')) return true;
  if (path.startsWith('/')) return true;
  if (DRIVE_PREFIX_RE.test(path)) return true;
  return path.split('/').some((segment) => segment === '..');
}

/** `C:` at the very start — a Windows drive, absolute or drive-relative. */
const DRIVE_PREFIX_RE = /^[a-zA-Z]:/;

/** Tags whose mere presence is `EMBEDDED_FRAME`. */
const EMBEDDED_FRAME_TAGS = new Set(['iframe', 'object', 'embed', 'frame', 'frameset']);

/**
 * An event-handler attribute NAME. The tokenizer lowercases attribute names, so
 * `ONERROR` arrives here as `onerror`.
 *
 * Every event handler content attribute HTML defines is `on` + two or more
 * ASCII letters and nothing else, so this matches all of them, and no
 * non-handler attribute in HTML or SVG is spelled that way. A name written with
 * a character reference (`&#111;nclick=`) is NOT matched and is NOT a bypass:
 * parsers decode character references in attribute VALUES, never in attribute
 * NAMES — the browser builds an attribute literally called `&#111;nclick`, and
 * never runs it.
 */
const EVENT_HANDLER_NAME_RE = /^on[a-z]{2,}$/;

/**
 * `JAVASCRIPT_URL`, decided the way a browser decides it: drop the whitespace
 * and C0 controls a URL parser ignores, then look at the scheme.
 *
 * Character references are already gone by the time a value reaches here —
 * parse5 decodes them during tokenization exactly as a browser does, which is
 * what makes `&#106;avascript:` **and** the named `java&Tab;script:` fall out of
 * this for free, without the ~2,200-entry named table the old hand-rolled
 * decoder refused to carry.
 *
 * Applied to EVERY attribute value, not to a list of URL-bearing attribute
 * names. The list would have had to include `<animate to="javascript:…">`,
 * which rewrites an `<a href>` at run time, and then whatever the next such
 * attribute turns out to be. Checking them all costs nothing and cannot be
 * out-of-date. Its one false positive — prose that starts an attribute value
 * with the word, `title="javascript: ngôn ngữ…"` — is case 3 in the table
 * below, and note there that escaping is NOT the way out of that one: the
 * decoding described above is exactly why `title="&#106;avascript: …"` is
 * flagged as well.
 */
function isJavascriptUrlValue(value: string): boolean {
  return value.replace(/[\s\u0000-\u001f]/g, '').toLowerCase().startsWith('javascript:');
}

/**
 * Fixed report order, so two runs over the same file list their findings the
 * same way regardless of where in the document each one was seen.
 */
const CONTENT_TIER_RULES: readonly (readonly [FindingCode, string])[] = [
  ['SCRIPT_TAG', 'tier "content" must not contain a <script> tag'],
  ['EVENT_HANDLER_ATTR', 'tier "content" must not contain an inline on*= event handler'],
  ['JAVASCRIPT_URL', 'tier "content" must not contain a javascript: URL'],
  ['EMBEDDED_FRAME', 'tier "content" must not embed a frame (<iframe>/<object>/<embed>)'],
  ['FORM_TAG', 'tier "content" must not contain a <form> tag'],
  [
    'TAG_ATTR_FLOOD',
    `a single start tag carries more than ${MAX_ATTRS_PER_TAG} attributes, which no document does by accident`,
  ],
];

/**
 * `parse5`'s tokenizer with its duplicate-attribute check made O(1) and with a
 * ceiling on attributes per tag. Both halves of review round 2's N1.
 *
 * ### What is replaced, and why it cannot stay
 *
 * The base class runs, once per attribute:
 *
 * ```js
 * if (getTokenAttr(token, this.currentAttr.name) === null) token.attrs.push(this.currentAttr);
 * else this._err(ERR.duplicateAttribute);
 * ```
 *
 * `getTokenAttr` is a linear walk of `token.attrs`, so a tag with *n*
 * attributes costs n²/2 string comparisons. That is the entire DoS: 552 KiB of
 * one tag = 6.0 s in Chromium, 19.2 s in Bun, versus 28 ms for the same bytes
 * as ordinary tags. A `Set` of names decides the identical question — "have I
 * already got an attribute with this name?" — in constant time, which makes the
 * scan linear in the input for every shape of input.
 *
 * The **semantics are unchanged and that is testable**: HTML keeps the FIRST
 * occurrence of a repeated attribute name and discards the rest, which is what
 * `getTokenAttr(...) === null` decides and what `seen.has(name)` decides.
 * `validate.test.ts` pins it from the outside (a `javascript:` value hidden in a
 * *second* `alt=` is dropped by a browser, so it is dropped here too).
 *
 * Only the ceiling changes behaviour: past {@link MAX_ATTRS_PER_TAG}, further
 * attributes on that tag are neither stored nor inspected, and
 * {@link attrFlood} goes true. That is a real gap in the scan and it is closed
 * by the report rather than by the scan: `TAG_ATTR_FLOOD` is itself a finding,
 * so a package that floods a tag fails validation whatever else the tag hides.
 * The tier's promise ("this package cannot execute code") is kept by rejecting
 * it, not by understanding it.
 *
 * ### The parse5 coupling
 *
 * This subclass reaches one level deeper into `parse5` than calling the
 * tokenizer does: it overrides three `protected` members and touches
 * `currentToken`/`currentAttr`. `parse5` is pinned to an exact version and
 * `tsc -b` is a real gate over this file, so a changed signature is a red
 * build, not a silent miss; a changed *meaning* (when `_leaveAttrName` fires)
 * is what the duplicate-attribute and C1/C2 tests are for.
 */
class BoundedTokenizer extends Tokenizer {
  /** Attribute names already accepted for the tag currently being built. */
  private readonly seenAttrNames = new Set<string>();

  /** True once any one tag in this run went past {@link MAX_ATTRS_PER_TAG}. */
  public attrFlood = false;

  protected override _createStartTagToken(): void {
    this.seenAttrNames.clear();
    super._createStartTagToken();
  }

  protected override _createEndTagToken(): void {
    this.seenAttrNames.clear();
    super._createEndTagToken();
  }

  protected override _leaveAttrName(): void {
    const token = this.currentToken;
    // Narrowing for the type checker: `_leaveAttrName` is only ever reached
    // with a tag token current.
    if (token === null || !('attrs' in token)) return;

    const name = this.currentAttr.name;
    if (this.seenAttrNames.has(name)) return; // duplicate — HTML keeps the first
    if (this.seenAttrNames.size >= MAX_ATTRS_PER_TAG) {
      this.attrFlood = true;
      return;
    }
    this.seenAttrNames.add(name);
    token.attrs.push(this.currentAttr);
    // The base method also records a source location here. This module builds
    // its tokenizer with `{}`, so `sourceCodeLocationInfo` is off, `location`
    // is null and that branch is unreachable — nothing is being dropped.
  }
}

/**
 * The content-tier rules, run over parse5's token stream.
 *
 * Only START TAGS are inspected. Text, comments, doctypes and end tags carry
 * nothing a browser executes: measured in Chromium, `<div id=t>x</div
 * onclick="…">` builds an element whose attribute list is exactly `["id"]` and
 * clicking it runs nothing, and a comment's contents are inert. That single
 * distinction — markup vs. text — is what a regex could not draw and what makes
 * a chapter that *teaches* HTML publishable at this tier (see the table).
 *
 * Every row below was **measured**, not assumed: each is a case that was run
 * through this function and observed, and the false-positive rows were run
 * through it twice, once escaped and once not.
 *
 * | rule                 | catches                                                                      | misses                                                                     |
 * |----------------------|------------------------------------------------------------------------------|----------------------------------------------------------------------------|
 * | `SCRIPT_TAG`         | a `<script` START tag, any case, with or without attributes, anywhere in any  | a lone `</script>` end tag — it starts nothing; `<script` written as text   |
 * |                      | entry of the package, including unescaped inside `<pre><code>`               | (`&lt;script`), which is exactly what a chapter about HTML wants            |
 * | `EVENT_HANDLER_ATTR` | any attribute named `on`+letters on any start tag, however it is separated    | a handler NAME written with a character reference (`&#111;nclick=`) — not a |
 * |                      | from the previous one (space, newline, `/`, a closing quote), quoted or bare, | bypass: measured in Chromium, the element keeps an attribute literally      |
 * |                      | upper or lower case, behind a `>` trapped in a quoted value, on `<body>`/     | named `&#111;nerror` and does not fire; a handler attached from script      |
 * |                      | `<html>` (which run when a chapter file is opened directly as a document)     | (`el.onclick = …`), which needs the JavaScript this tier already forbids    |
 * | `JAVASCRIPT_URL`     | any attribute value on any start tag whose scheme normalizes to               | a `javascript:` URL that is not at the START of the value, notably CSS      |
 * |                      | `javascript:` — numeric and named character references, whitespace- and       | `style="background:url(javascript:…)"` (no current browser executes it);    |
 * |                      | control-split schemes, unquoted values, `xlink:href`, and attributes that are | `data:text/html` URLs, which have no code in this rule set at all           |
 * |                      | not URLs by name at all (`<animate attributeName=href to=javascript:…>`)      |                                                                             |
 * | `EMBEDDED_FRAME`     | a start tag named `iframe`/`object`/`embed`/`frame`/`frameset`                | nothing known for those start tags                                          |
 * | `FORM_TAG`           | a `<form` start tag                                                          | nothing known                                                               |
 * | `TAG_ATTR_FLOOD`     | one start tag past {@link MAX_ATTRS_PER_TAG} attributes. A resource fence,    | nothing — it is not a rule about what executes. It does SWALLOW the four    |
 * |                      | not a rule about content: see {@link BoundedTokenizer} for the DoS it closes  | rules above on that one tag, whose remaining attributes are never read; the |
 * |                      |                                                                              | package still fails, under this code instead of theirs                      |
 * | *non-HTML entries*   | there is no such rule and that is the point: the five rules above read EVERY  | — see "the false positives" below, case 2                                   |
 * |                      | entry, so a `.md` source, a `.json` data file or a `.css` comment is markup   |                                                                             |
 * |                      | if it looks like markup                                                      |                                                                             |
 *
 * **Where it looks:** every entry in the package, decoded as UTF-8 with
 * replacement — no extension list, no "this one looks binary" skip. Round 1 of
 * review broke the old extension-keyed scan by renaming `chapter.file` to
 * `c1.txt`, and any content-sniffing skip is the same hole wearing a hat: a PNG
 * with live markup in a `tEXt` chunk is still a package entry a consumer may
 * decide to render. Tokenizing a few megabytes of image bytes is cheap, and
 * random bytes cannot spell `<img … onerror=` by accident.
 *
 * **The one entry it does NOT look at is `manifest.json`** — see the comment at
 * the call site in {@link validatePackage}. Short version: the manifest is JSON
 * data whose fields the reader renders as text, markup in them is therefore
 * inert, and scanning it produced false positives with no correct spelling
 * available to the author. That is an exception about what the bytes *are*, not
 * about what they are called: every other `.json` entry is still scanned.
 *
 * **Deliberate over-approximation.** The tokenizer is run in its default state,
 * so the raw-text bodies the TREE builder would switch on — `<script>`,
 * `<style>`, `<textarea>`, `<title>` — are tokenized as markup here. That can
 * only ever over-report (a `<textarea>` containing `<img onerror=…>` is flagged
 * although a browser would show it as text), never under-report, and
 * over-reporting is the direction this tier can afford.
 *
 * **The false positives, and the way out of each.** There is no single escape;
 * an earlier draft of this comment claimed there was, and review round 2
 * measured that claim false (N4). Three distinct shapes, all measured on this
 * code:
 *
 *   1. *Live markup written as an example.* `<button onclick="chao()">` in a
 *      chapter is flagged. **Escaping works**, and it is the escape a chapter
 *      needs anyway in order to render: `&lt;button onclick="chao()"&gt;` is a
 *      character token, not a start tag, and is clean.
 *   2. *A non-HTML entry whose own format does not escape.* A markdown source
 *      shipped beside the built chapter is flagged for a fenced ```html block,
 *      a `.json` data file for an HTML snippet it carries as a string, and a
 *      `.css` file for markup inside a comment — the scan sees a package entry,
 *      not a fenced block or a comment in some other language. **Escaping is
 *      not available**: escaping a markdown fence changes what markdown
 *      renders. Ship the built output without the sources, or publish at tier
 *      `interactive`. (Measured clean next to those: CSS
 *      `a[href^="javascript:"]`, CSS `content:"<"`, real SVG including an
 *      export with `<style>`, plain-text LICENSE/CHANGELOG, and an escaped
 *      `.md`.) This is the price of C3's lesson that a scan may not be keyed on
 *      a file extension, and it is the right side to err on.
 *   3. *Prose that merely begins an attribute VALUE with the word.*
 *      `<abbr title="javascript: một ngôn ngữ">` is flagged `JAVASCRIPT_URL`,
 *      and **escaping does not help here**: character references in an
 *      attribute value are decoded during tokenization exactly as a browser
 *      decodes them, so `title="&#106;avascript: …"` is flagged too (measured).
 *      The ways out are to escape the WHOLE tag so it stops being a tag
 *      (measured clean), to move the word out of the attribute into the text
 *      (prose is a character token and is never read as an attribute), or to
 *      reword so the value does not START with the scheme.
 *
 * **Not covered by any rule**, and therefore still the registry reviewer's job:
 * `<meta http-equiv="refresh">` redirects, external `<link>`/`<img>`/CSS
 * `url()` references (not executable, but still a network call the reader never
 * asked for), `data:` URLs, a `.js` file renamed to an extension `JS_FILE_RE`
 * does not know (harmless at this tier only because loading it would need a
 * `<script>` tag, which is flagged), and an entry that is not UTF-8 — a UTF-16
 * chapter is decoded to mojibake here and reads as clean, which is safe only
 * for as long as every consumer decodes it as UTF-8 too, exactly as
 * `Response.text()` and this module both do.
 */
function scanHtmlText(path: string, text: string): Finding[] {
  const seen = new Set<FindingCode>();
  const ignore = (): void => {};

  const handler: TokenHandler = {
    onStartTag(token: Token.TagToken): void {
      if (token.tagName === 'script') seen.add('SCRIPT_TAG');
      if (EMBEDDED_FRAME_TAGS.has(token.tagName)) seen.add('EMBEDDED_FRAME');
      if (token.tagName === 'form') seen.add('FORM_TAG');
      for (const attr of token.attrs) {
        if (EVENT_HANDLER_NAME_RE.test(attr.name)) seen.add('EVENT_HANDLER_ATTR');
        if (isJavascriptUrlValue(attr.value)) seen.add('JAVASCRIPT_URL');
      }
    },
    onEndTag: ignore,
    onComment: ignore,
    onDoctype: ignore,
    onCharacter: ignore,
    onNullCharacter: ignore,
    onWhitespaceCharacter: ignore,
    onEof: ignore,
  };

  const tokenizer = new BoundedTokenizer({}, handler);
  tokenizer.write(text, true);
  if (tokenizer.attrFlood) seen.add('TAG_ATTR_FLOOD');

  const out: Finding[] = [];
  for (const [code, detail] of CONTENT_TIER_RULES) {
    if (seen.has(code)) out.push(finding(code, path, detail));
  }
  return out;
}

/** Field-by-field check of a parsed manifest. Returns every problem, not the first. */
function checkManifestFields(value: unknown): Finding[] {
  const out: Finding[] = [];
  const at = (pointer: string) => `${MANIFEST_PATH}#/${pointer}`;
  const bad = (pointer: string, detail: string) => out.push(finding('MANIFEST_FIELD', at(pointer), detail));

  if (!isRecord(value)) {
    // Reached only through parseManifest's own guard; validatePackage reports
    // a non-object manifest as MANIFEST_PARSE before it gets here.
    out.push(finding('MANIFEST_FIELD', MANIFEST_PATH, 'manifest must be a JSON object'));
    return out;
  }

  for (const key of ['id', 'title', 'lang', 'version', 'runtime', 'license'] as const) {
    if (!isNonEmptyString(value[key])) bad(key, `missing or not a non-empty string: "${key}"`);
  }
  // `description` may be empty — a course with nothing to add beyond its title
  // is allowed to say so — but it must be present and a string.
  if (typeof value['description'] !== 'string') bad('description', 'missing or not a string: "description"');

  if (value['tier'] !== 'content' && value['tier'] !== 'interactive') {
    bad('tier', 'must be exactly "content" or "interactive"');
  }
  if (value['generatedBy'] !== 'ai' && value['generatedBy'] !== 'human' && value['generatedBy'] !== 'mixed') {
    bad('generatedBy', 'must be exactly "ai", "human" or "mixed"');
  }

  const authors = value['authors'];
  if (!Array.isArray(authors) || authors.length === 0) {
    bad('authors', 'must be a non-empty array of { name, url? }');
  } else {
    authors.forEach((author, i) => {
      if (!isRecord(author) || !isNonEmptyString(author['name'])) {
        bad(`authors/${i}/name`, 'author must be an object with a non-empty "name"');
        return;
      }
      if (author['url'] !== undefined && !isNonEmptyString(author['url'])) {
        bad(`authors/${i}/url`, 'optional "url" must be a non-empty string when present');
      }
    });
  }

  // Optional strings: absent is fine, present-and-wrong is not.
  for (const key of ['translationOf', 'registryId'] as const) {
    if (value[key] !== undefined && !isNonEmptyString(value[key])) {
      bad(key, `optional "${key}" must be a non-empty string when present`);
    }
  }

  const parts = value['parts'];
  if (!Array.isArray(parts) || parts.length === 0) {
    bad('parts', 'must be a non-empty array of parts');
  } else {
    parts.forEach((part, p) => {
      if (!isRecord(part)) {
        bad(`parts/${p}`, 'part must be an object');
        return;
      }
      if (!isNonEmptyString(part['title'])) bad(`parts/${p}/title`, 'missing or not a non-empty string: "title"');
      const chapters = part['chapters'];
      if (!Array.isArray(chapters) || chapters.length === 0) {
        bad(`parts/${p}/chapters`, 'must be a non-empty array of chapters');
        return;
      }
      chapters.forEach((chapter, c) => {
        if (!isRecord(chapter)) {
          bad(`parts/${p}/chapters/${c}`, 'chapter must be an object');
          return;
        }
        for (const key of ['id', 'title', 'short', 'file'] as const) {
          if (!isNonEmptyString(chapter[key])) {
            bad(`parts/${p}/chapters/${c}/${key}`, `missing or not a non-empty string: "${key}"`);
          }
        }
        // `num` is a DISPLAY label ("0.1", "2.3"), and an unnumbered chapter is
        // a supported case, not a defect: the appendix of
        // `fixtures/courses/so-dau-phay-dong` ships `"num": ""` today, and the reader
        // already branches on it in five places — four ternaries in
        // ChapterView.tsx (385, 485, 511, 520) and `chapter.num || '·'` at
        // CourseNav.tsx:46. (An earlier draft of this comment said six; the
        // sixth hit was a `useEffect` dependency array, which handles nothing.
        // Counted again by hand for review round 1.) Requiring a
        // non-empty value here would have forced the packaging CLI to invent a
        // number that the UI then has to render. Found by running this rule set
        // against the real package (task brief, step 5) — the rule was wrong,
        // the data was right.
        if (typeof chapter['num'] !== 'string') {
          bad(`parts/${p}/chapters/${c}/num`, 'missing or not a string: "num" (may be empty for an unnumbered chapter)');
        }
      });
    });
  }

  return out;
}

/**
 * `SEMVER` + `RUNTIME_RANGE`. Split out of {@link checkManifestFields} because
 * both entry points need it and a second copy is how the two would drift.
 * A missing/blank value is left to `MANIFEST_FIELD`; reporting it twice under
 * two codes would just be noise.
 */
function checkVersionAndRuntime(value: Record<string, unknown>): Finding[] {
  const out: Finding[] = [];
  const version = value['version'];
  if (isNonEmptyString(version) && !SEMVER_RE.test(version)) {
    out.push(finding('SEMVER', `${MANIFEST_PATH}#/version`, `not a semver version: "${version}"`));
  }
  const runtime = value['runtime'];
  if (isNonEmptyString(runtime) && !RUNTIME_RANGE_RE.test(runtime)) {
    out.push(finding('RUNTIME_RANGE', `${MANIFEST_PATH}#/runtime`, `not a caret range like "^1": "${runtime}"`));
  }
  return out;
}

/** Chapters that survived {@link checkManifestFields} well enough to be walked. */
interface LocatedChapter {
  chapter: Chapter;
  pointer: string;
}

function locateChapters(value: Record<string, unknown>): LocatedChapter[] {
  const out: LocatedChapter[] = [];
  const parts = value['parts'];
  if (!Array.isArray(parts)) return out;
  parts.forEach((part: unknown, p) => {
    if (!isRecord(part)) return;
    const chapters = part['chapters'];
    if (!Array.isArray(chapters)) return;
    chapters.forEach((chapter: unknown, c) => {
      if (!isRecord(chapter)) return;
      if (!isNonEmptyString(chapter['id']) || !isNonEmptyString(chapter['file'])) return;
      out.push({
        chapter: chapter as unknown as Chapter,
        pointer: `${MANIFEST_PATH}#/parts/${p}/chapters/${c}`,
      });
    });
  });
  return out;
}

/**
 * Parse `manifest.json` and check it as a document, ignoring the rest of the
 * package.
 *
 * Returns only the FIRST problem, because the signature only has room for one.
 * {@link validatePackage} is the complete gate and reports every problem at
 * once; reach for this when you have a manifest and no package — for example
 * to read `id`/`title` out of a candidate file before deciding what to do with
 * it.
 */
export function parseManifest(raw: string): { manifest: Manifest } | { error: Finding } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { error: finding('MANIFEST_PARSE', MANIFEST_PATH, `invalid JSON: ${(e as Error).message}`) };
  }
  if (!isRecord(parsed)) {
    return { error: finding('MANIFEST_PARSE', MANIFEST_PATH, 'top-level value must be a JSON object') };
  }
  const problems = [...checkManifestFields(parsed), ...checkVersionAndRuntime(parsed)];
  const first = problems[0];
  if (first !== undefined) return { error: first };
  return { manifest: parsed as unknown as Manifest };
}

/**
 * Check a whole course package.
 *
 * `files` is the complete, already-decompressed content of the package, keyed
 * by package-relative path.
 *
 * **Every** problem is reported, never just the first: a contributor fixing a
 * package should see the whole list in one pass instead of discovering it one
 * rebuild at a time. Two exceptions, both about work that cannot pay for
 * itself: an empty package returns `EMPTY_PACKAGE` alone, because every other
 * rule would only restate that one fact; and a package over the byte budget
 * skips the per-entry content scan, because that scan is the only rule here
 * whose cost is proportional to the very quantity being refused — see the
 * comment on the loop itself for the measurements.
 *
 * Tier-specific rules run only when the manifest parsed and named a tier. A
 * package with no readable manifest already fails; guessing a tier for it would
 * add noise, not safety.
 */
export function validatePackage(files: ReadonlyMap<string, Uint8Array>): ValidationResult {
  const findings: Finding[] = [];

  if (files.size === 0) {
    return { ok: false, findings: [finding('EMPTY_PACKAGE', PACKAGE_ROOT, 'package contains no files')] };
  }

  let totalBytes = 0;
  for (const bytes of files.values()) totalBytes += bytes.byteLength;
  const overBudget = totalBytes > MAX_UNCOMPRESSED_BYTES;
  if (overBudget) {
    findings.push(
      finding(
        'TOO_LARGE',
        PACKAGE_ROOT,
        `uncompressed size ${totalBytes} exceeds the ${MAX_UNCOMPRESSED_BYTES} byte budget`,
      ),
    );
  }

  for (const path of files.keys()) {
    if (escapesPackage(path)) {
      findings.push(finding('PATH_ESCAPE', path, 'entry path escapes the package root'));
    }
  }

  const manifestBytes = files.get(MANIFEST_PATH);
  if (manifestBytes === undefined) {
    findings.push(finding('MANIFEST_MISSING', MANIFEST_PATH, 'package has no manifest.json at its root'));
    return { ok: false, findings };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(manifestBytes));
  } catch (e) {
    findings.push(finding('MANIFEST_PARSE', MANIFEST_PATH, `invalid JSON: ${(e as Error).message}`));
    return { ok: false, findings };
  }
  if (!isRecord(parsed)) {
    findings.push(finding('MANIFEST_PARSE', MANIFEST_PATH, 'top-level value must be a JSON object'));
    return { ok: false, findings };
  }

  findings.push(...checkManifestFields(parsed), ...checkVersionAndRuntime(parsed));

  const seenChapterIds = new Set<string>();
  for (const { chapter, pointer } of locateChapters(parsed)) {
    if (seenChapterIds.has(chapter.id)) {
      findings.push(finding('DUPLICATE_CHAPTER_ID', `${pointer}/id`, `chapter id "${chapter.id}" is used twice`));
    }
    seenChapterIds.add(chapter.id);

    // A `file` that walks out of the package is worth flagging even though the
    // next check will also report it missing: a consumer that resolves the
    // manifest against a directory rather than against `files` would follow it.
    if (escapesPackage(chapter.file)) {
      findings.push(finding('PATH_ESCAPE', `${pointer}/file`, `chapter file escapes the package root: "${chapter.file}"`));
    }
    if (!files.has(chapter.file)) {
      findings.push(
        finding('CHAPTER_FILE_MISSING', `${pointer}/file`, `no such file in package: "${chapter.file}"`),
      );
    }
  }

  if (parsed['tier'] === 'content') {
    for (const path of files.keys()) {
      if (JS_FILE_RE.test(path)) {
        findings.push(finding('JS_FILE_IN_PACKAGE', path, 'tier "content" must not ship JavaScript files'));
      }
    }
    // EVERY entry, with no extension list and no binary skip — see
    // {@link scanHtmlText}. The previous version read only `.html?/.xhtml/.svg`
    // and nothing constrains the extension of `chapter.file`, so renaming a
    // chapter to `c1.txt` switched all five rules off at once.
    //
    // The ONE exception is `manifest.json`, and it is an exception about what
    // the bytes ARE, not about what they are called. Every other entry is a
    // file some consumer may decide to render; the manifest is a JSON document
    // whose shape THIS module defines, and whose fields the reader renders as
    // TEXT — `{manifest.title}` / `{manifest.description}` in
    // `apps/web/src/pages/CourseHome.tsx:46-47` and `Dashboard.tsx:250`, plus
    // `aria-label={manifest.title}`. React escapes all of those. Running markup
    // rules over them was a category error with no way out for the author: a
    // course about web forms could not put `<form>` in its own description
    // (FORM_TAG), and writing `&lt;form&gt;` to get past the gate only made the
    // catalog display the literal string `&lt;form&gt;`, because nothing ever
    // un-escapes it. Both halves measured in review round 2 (N2).
    //
    // THE INVARIANT THIS RESTS ON: manifest fields are rendered as text. If a
    // consumer ever feeds `manifest.title`/`description` — or any other
    // manifest string — to `innerHTML`, `dangerouslySetInnerHTML` or an
    // equivalent, this exclusion becomes a hole, and closing it here again is
    // not the fix: the fix is that the consumer escapes what it injects. Task 7
    // touches `loader.ts` and carries the note to put the matching fence on the
    // `apps/web` side.
    //
    // Structural manifest rules are UNAFFECTED: MANIFEST_MISSING,
    // MANIFEST_PARSE, MANIFEST_FIELD, SEMVER, RUNTIME_RANGE,
    // DUPLICATE_CHAPTER_ID, CHAPTER_FILE_MISSING and PATH_ESCAPE all still read
    // this file. Only the five HTML rules stop looking at it.
    // Skipped once the package is over the byte budget, and this is the one
    // place `validatePackage` stops short of reporting everything.
    //
    // The line it draws is not "the first finding wins" but "no more work
    // proportional to the quantity that has already been refused". Every other
    // rule in this function costs O(entries) or O(manifest); this loop alone
    // costs O(bytes) — it decodes and tokenizes each entry — and bytes is
    // exactly what TOO_LARGE says there are too many of. Measured on packages
    // of binary assets: 25 MB took 1,494 ms, 64 MB 3,532 ms, 256 MB 13,195 ms,
    // and the Task 3 reviewer measured 2 GB at over ten minutes. All of it
    // spent on a package that is already refused.
    //
    // What a contributor loses: the five content rules and TAG_ATTR_FLOOD, for
    // a package they must shrink before it can ship at all — and after they
    // shrink it, the content is different content, which the next run reads.
    // What they keep: everything cheap, in the same one pass — PATH_ESCAPE,
    // MANIFEST_*, SEMVER, RUNTIME_RANGE, DUPLICATE_CHAPTER_ID,
    // CHAPTER_FILE_MISSING, JS_FILE_IN_PACKAGE. The tier's promise is kept the
    // way TAG_ATTR_FLOOD keeps it a few lines up: by refusing the file, not by
    // understanding it.
    //
    // Note what this does NOT fix, so nobody reads a bigger claim into it: a
    // package UNDER the budget still pays full price — a valid 19 MB package of
    // images measured 1,045 ms here (7 s on the reviewer's machine), because
    // binary bytes contain `<` and go through the tokenizer. That is the "no
    // binary skip" decision above, and it is a separate question from this one.
    if (!overBudget) {
      for (const [path, bytes] of files) {
        if (path === MANIFEST_PATH) continue;
        // The one shortcut taken, and it is a proof rather than a heuristic: a
        // start tag cannot exist without a U+003C, 0x3C is that character and
        // nothing else in UTF-8 (continuation bytes are all >= 0x80), a
        // character reference decodes to a character token and never re-enters
        // the tag-open state, and an invalid byte decodes to U+FFFD. No `<`
        // byte therefore means no start tag, and every content rule reads start
        // tags. It is what keeps a 20 MB image out of the tokenizer.
        if (!bytes.includes(0x3c)) continue;
        findings.push(...scanHtmlText(path, decoder.decode(bytes)));
      }
    }
  }

  return { ok: findings.length === 0, findings };
}

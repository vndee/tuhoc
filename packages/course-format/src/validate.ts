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
 * is exported and typed from the package root. `parse5` is therefore pinned to
 * an exact version in `package.json`, and the C1/C2 tests in `validate.test.ts`
 * are what would go red if a future version changed the contract.
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
] as const;

export type FindingCode = (typeof FINDING_CODES)[number];

/**
 * Budget for the **decoded** size of a package: the sum of every entry's byte
 * length after decompression, never the size of the zip on disk. A zip bomb is
 * a few kilobytes compressed; checking the compressed size would wave it
 * through. The caller inflates first, then asks this module.
 */
export const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;

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
 * Catches: any `..` segment, a leading `/` (absolute POSIX), a drive-letter or
 * UNC prefix and every other use of `\` (a backslash is never a legitimate
 * separator here, and on Windows it IS one), and the empty path.
 *
 * Misses: percent-encoded traversal (`%2e%2e/`) and Unicode look-alikes. Those
 * are decoded by whoever decodes them, not by this module — a consumer must
 * never URL-decode an entry name before extraction.
 */
function escapesPackage(path: string): boolean {
  if (path.length === 0) return true;
  if (path.includes('\\')) return true;
  if (path.startsWith('/')) return true;
  return path.split('/').some((segment) => segment === '..');
}

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
 * with the word, `title="javascript: ngôn ngữ…"` — is in the table below.
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
];

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
 *
 * **Where it looks:** every entry in the package, decoded as UTF-8 with
 * replacement — no extension list, no "this one looks binary" skip. Round 1 of
 * review broke the old extension-keyed scan by renaming `chapter.file` to
 * `c1.txt`, and any content-sniffing skip is the same hole wearing a hat: a PNG
 * with live markup in a `tEXt` chunk is still a package entry a consumer may
 * decide to render. Tokenizing a few megabytes of image bytes is cheap, and
 * random bytes cannot spell `<img … onerror=` by accident.
 *
 * **Deliberate over-approximation.** The tokenizer is run in its default state,
 * so the raw-text bodies the TREE builder would switch on — `<script>`,
 * `<style>`, `<textarea>`, `<title>` — are tokenized as markup here. That can
 * only ever over-report (a `<textarea>` containing `<img onerror=…>` is flagged
 * although a browser would show it as text), never under-report, and
 * over-reporting is the direction this tier can afford. Two more, both
 * measured: `manifest.json` is scanned like every other entry, so a course
 * whose *title* contains a raw `<script>` is flagged; and an attribute value
 * that merely begins with the word — `title="javascript: một ngôn ngữ"` — is
 * flagged as `JAVASCRIPT_URL`. The escape from all of these is the same one a
 * chapter needs anyway to render: escape the markup.
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

  new Tokenizer({}, handler).write(text, true);

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
        // `courses/***REMOVED***` ships `"num": ""` today, and the reader
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
 * rebuild at a time. The single exception is an empty package, which returns
 * `EMPTY_PACKAGE` alone — every other rule would only be restating that one
 * fact.
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
  if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
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
    for (const [path, bytes] of files) {
      // The one shortcut taken, and it is a proof rather than a heuristic: a
      // start tag cannot exist without a U+003C, 0x3C is that character and
      // nothing else in UTF-8 (continuation bytes are all >= 0x80), a
      // character reference decodes to a character token and never re-enters
      // the tag-open state, and an invalid byte decodes to U+FFFD. No `<` byte
      // therefore means no start tag, and every content rule reads start tags.
      // It is what keeps a 20 MB image out of the tokenizer.
      if (!bytes.includes(0x3c)) continue;
      findings.push(...scanHtmlText(path, decoder.decode(bytes)));
    }
  }

  return { ok: findings.length === 0, findings };
}

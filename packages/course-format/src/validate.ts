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
 * ## Why text scanning and not DOM parsing
 *
 * This package runs in Node (CLI, CI) as well as in the browser, so there is no
 * `DOMParser` to lean on and no dependency is worth adding for one. Every HTML
 * rule below is therefore a regex over decoded text. That is a real trade: it
 * over-matches inside `<pre>` samples and comments, and it under-matches
 * against deliberate obfuscation. Both directions are documented at each rule.
 */

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

/** Files the content-tier text scan reads. `.svg` is in the list because SVG carries script and event handlers too. */
const SCANNED_MARKUP_RE = /\.(?:html?|xhtml|svg)$/i;

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

/**
 * Decode **numeric** character references only — `&#106;` and `&#x6a;`.
 *
 * Named references (`&colon;`, `&Tab;`, `&NewLine;`) are deliberately NOT
 * decoded: the full named table is ~2,200 entries and this module refuses to
 * carry a dependency. The gap is listed in the miss table below rather than
 * papered over, because a partial decoder that pretends to be complete is worse
 * than one that says what it does.
 */
function decodeNumericEntities(s: string): string {
  return s.replace(/&#(x[0-9a-f]+|\d+);?/gi, (whole: string, body: string) => {
    const cp = body[0]?.toLowerCase() === 'x' ? Number.parseInt(body.slice(1), 16) : Number.parseInt(body, 10);
    if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff) return whole;
    return String.fromCodePoint(cp);
  });
}

/**
 * `JAVASCRIPT_URL`: pull each URL-bearing attribute value out and normalize it
 * the way a browser would before deciding it is a scheme — decode numeric
 * entities, drop whitespace and C0 control characters — then look at the
 * scheme. Testing the raw text for the literal string `javascript:` would miss
 * `java&#9;script:` and `&#106;avascript:`, which are the two oldest filter
 * bypasses there are.
 */
function hasJavascriptUrl(text: string): boolean {
  const attr = /\b(?:href|src|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (let m = attr.exec(text); m !== null; m = attr.exec(text)) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    // `\s` covers tab/newline/form-feed; the explicit range adds the rest of
    // the C0 controls, which browsers also ignore inside a URL.
    const normalized = decodeNumericEntities(raw)
      .replace(/[\s\u0000-\u001f]/g, '')
      .toLowerCase();
    if (normalized.startsWith('javascript:')) return true;
  }
  return false;
}

/**
 * The content-tier text rules, kept in one function so the catch/miss table
 * stays next to the regexes it describes.
 *
 * Every row below was **measured**, not assumed — each is a case that was run
 * through this function and observed.
 *
 * | rule                 | catches                                                                     | misses                                                       |
 * |----------------------|-----------------------------------------------------------------------------|--------------------------------------------------------------|
 * | `SCRIPT_TAG`         | `<script` in any case, with or without attributes; also inside `.svg`        | nothing known for the literal tag                            |
 * | `EVENT_HANDLER_ATTR` | `on*=` inside an opening tag; across newlines; uppercase; after a `>` that   | a handler whose *name* is entity-escaped (`&#111;nclick=`) —  |
 * |                      | sits inside a quoted attribute value; `<svg onload=>`                       | not a real bypass: parsers do not decode attribute NAMES     |
 * | `JAVASCRIPT_URL`     | `href`/`src`/`action`/`formaction`/`xlink:href`, quoted or bare, with the    | named entities (`java&Tab;script:`); `data:text/html` URLs,  |
 * |                      | scheme split by whitespace/controls or written with numeric entities        | which have no code in this rule set at all                   |
 * | `EMBEDDED_FRAME`     | `<iframe`/`<object`/`<embed`/`<frame`/`<frameset`                           | nothing known for the literal tags                           |
 * | `FORM_TAG`           | `<form`                                                                     | nothing known                                                |
 *
 * **Not covered by any rule**, and therefore the registry reviewer's job:
 * `<meta http-equiv="refresh">` redirects, external `<link>`/`<img>`/CSS
 * `url()` references (not executable, but still a network call the reader never
 * asked for), and `data:` URLs.
 *
 * On false positives: they are accepted on purpose. `EVENT_HANDLER_ATTR` in
 * particular fires on any `on*="…"` in the file, so a chapter that quotes
 * handler markup *unescaped* is flagged. That is the right way round — a
 * `content` package's whole promise is that it cannot execute code, so a
 * missed handler breaks the tier outright while a false positive costs one
 * reviewer glance. A chapter that needs to *show* such markup escapes it
 * (`&lt;div onclick=…`), which it had to do to render correctly anyway, and the
 * escaped form is not flagged.
 */
function scanHtmlText(path: string, text: string): Finding[] {
  const out: Finding[] = [];

  if (/<script\b/i.test(text)) {
    out.push(finding('SCRIPT_TAG', path, 'tier "content" must not contain a <script> tag'));
  }

  // Two patterns, because one is not enough:
  //  (a) inside an opening tag — `<div onclick=x>`, including unquoted values,
  //      but it stops at the first `>`, so it misses
  //      `<div title="a>b" onclick="x()">`;
  //  (b) any `on*=` assigned a QUOTED value, anywhere in the file — which
  //      catches exactly that case, at the cost of also flagging quoted handler
  //      markup written out in prose.
  const inOpeningTag = /<[a-z][^>]*?\son[a-z]{2,}\s*=/is;
  const quotedHandler = /\son[a-z]{2,}\s*=\s*["']/i;
  if (inOpeningTag.test(text) || quotedHandler.test(text)) {
    out.push(
      finding('EVENT_HANDLER_ATTR', path, 'tier "content" must not contain an inline on*= event handler'),
    );
  }

  if (hasJavascriptUrl(text)) {
    out.push(finding('JAVASCRIPT_URL', path, 'tier "content" must not contain a javascript: URL'));
  }
  if (/<(?:iframe|object|embed|frame|frameset)\b/i.test(text)) {
    out.push(
      finding('EMBEDDED_FRAME', path, 'tier "content" must not embed a frame (<iframe>/<object>/<embed>)'),
    );
  }
  if (/<form\b/i.test(text)) {
    out.push(finding('FORM_TAG', path, 'tier "content" must not contain a <form> tag'));
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
        // already branches on it in six places (`chapter.num ? … : ''` in
        // ChapterView.tsx, `chapter.num || '·'` in CourseNav.tsx). Requiring a
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
    for (const [path, bytes] of files) {
      if (!SCANNED_MARKUP_RE.test(path)) continue;
      findings.push(...scanHtmlText(path, decoder.decode(bytes)));
    }
  }

  return { ok: findings.length === 0, findings };
}

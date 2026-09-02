/// <reference types="node" />
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * NO DATA A COURSE PACKAGE CONTROLS MAY BECOME MARKUP IN CODE WE SHIP.
 *
 * Relocated verbatim out of `db/local.ts`'s test file by Task 10 (the Dexie
 * removal), which deleted that file. This scan has nothing to do with
 * Dexie or `localStorage` — it reuses the same AST-walking shape those
 * tripwires do, which is presumably how it ended up sharing a file with
 * them, but its subject is unrelated and it must not be lost along with
 * the file it happened to live in.
 *
 * WHAT THIS SCAN IS ABOUT, AND WHY THE HEADING ABOVE CHANGED (history kept
 * for the next reader, unedited by Task 10).
 *
 * It used to say "a manifest field must never become markup", and its
 * jurisdiction was `appSourceFiles()` — ONE DIRECTORY (`apps/web/src`) and
 * TWO EXTENSIONS (`.ts`, `.tsx`) — while the test that asserted the
 * jurisdiction called itself "is looking at the whole app". It was not. The
 * gap was written down in prose, and the prose was TRUE BUT IRRELEVANT:
 * `packages/course-kit/runtime.js` was exempted because "it never sees a
 * manifest field". That is correct. It is also beside the point, because
 * `runtime.js:340` concatenated a CHAPTER field — `data-viz`, typed by the
 * course author — straight into `innerHTML` on the LIVE document.
 *
 * Measured, in real Chromium, on a package that `tuhoc pack` exits 0 on and
 * `validatePackage` returns `ok: true, findings: []` for, declaring the tier
 * that promises readers "không có JavaScript":
 *
 *     img after container.innerHTML = chapter : 0
 *     img after CourseKit.initViz(container)  : 1
 *     typeof img.onerror                      : function
 *     handler ACTUALLY RAN (count)            : 1
 *     request that left the browser           : 1
 *
 * So the rule is restated one level up, where it was always supposed to be:
 *
 *     NO DATA A COURSE PACKAGE CONTROLS MAY BECOME MARKUP IN CODE WE SHIP.
 *
 * A manifest field is one KIND of package-controlled data. A chapter's
 * attribute values are another. Framing the rule around the kind instead of
 * the class is what let this through fourteen tasks and five gates.
 *
 * And the jurisdiction is restated as a LAYER rather than as a path shape:
 * every FIRST-PARTY file that runs inside the reader's page, whatever
 * directory it lives in and whatever extension it carries. `.tsx` modules,
 * a classic `<script src>`, an inline `<script>` in the shell — same page,
 * same origin, same access, therefore same rule.
 *
 * WHAT IS DELIBERATELY OUT OF JURISDICTION, and this one IS a real
 * distinction rather than a path accident: `courses/<id>/viz.js`. That file
 * is not code we ship — it is the PAYLOAD, and `tier: "interactive"` exists
 * precisely to let a package execute code (spec §1.2). Reporting its
 * `innerHTML` calls would produce violations with no correct resolution,
 * which is the category error ruling S1-F8 refused. What governs a payload
 * is the tier gate and the rule set, not this scan. What governs OUR code is
 * this scan.
 */
const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(SRC_DIR, '../../..');
const INDEX_HTML = resolve(SRC_DIR, '../index.html');

/** Repo-relative, so a violation names the file the way a person would open it. */
function label(file: string): string {
  return relative(REPO_ROOT, file);
}

/**
 * Files this scan does NOT read, and why each one is safe to skip.
 *
 * `*.test.ts(x)` — a test's job includes seeding and observing the very
 * stores production code must not multiply.
 *
 * `test/setup.ts` — installs the in-memory `Storage` that stands in for
 * the one Bun's runtime breaks under vitest. It is the harness, not the
 * app; it ships in no bundle.
 */
function isProductionSource(relativePath: string): boolean {
  if (/\.test\.tsx?$/.test(relativePath)) return false;
  return relativePath !== join('test', 'setup.ts');
}

function appSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && isProductionSource(relative(SRC_DIR, full))) out.push(full);
    }
  };
  walk(SRC_DIR);
  return out.sort();
}

/** Every `.js` under `dir`, skipping `vendor/` (KaTeX, third-party) and `node_modules/`. */
function jsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string): void => {
    if (!existsSync(at)) return;
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === 'vendor' || entry.name === 'node_modules') continue;
      const full = join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

const COURSE_KIT_DIR = resolve(REPO_ROOT, 'packages', 'course-kit');

const BROWSER_CODE_ROOTS: readonly {
  /** How a person would name this root. */
  readonly name: string;
  /** The files it contributes, already absolute. */
  readonly files: () => string[];
  /** Why code here runs in the reader's page. */
  readonly why: string;
}[] = [
  {
    name: 'apps/web/src/**/*.ts(x)',
    files: appSourceFiles,
    why: 'the React application itself',
  },
  {
    name: 'packages/course-kit/**/*.js (minus vendor/)',
    files: () => jsFilesUnder(COURSE_KIT_DIR),
    why: 'the reader runtime, loaded as a classic <script src> on every reader route (reader/useCourseKit.ts) — same origin, same document, and the file C1 was hiding in',
  },
];

/** Every first-party file that runs in the reader's browser. */
function browserCodeFiles(): string[] {
  return BROWSER_CODE_ROOTS.flatMap((root) => root.files()).sort();
}

/**
 * The bodies of the inline `<script>` blocks in the app shell, as source
 * text the same AST scanner can read.
 *
 * `apps/web/index.html` carries the synchronous theme bootstrap. It is
 * first-party code, it runs in the reader's page before anything else does,
 * and it lives in a file with neither of the two extensions the old
 * jurisdiction accepted — which is exactly the kind of thing a
 * directory-and-extension rule cannot see and a LAYER rule must.
 */
function inlineShellScripts(): { readonly label: string; readonly source: string }[] {
  const html = readFileSync(INDEX_HTML, 'utf-8');
  const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  return blocks.map((m, i) => ({ label: `${relative(REPO_ROOT, INDEX_HTML)} <script> #${i + 1}`, source: m[1] }));
}

/**
 * Names of the HTML SINKS — the expressions that turn a STRING into
 * MARKUP — actually reached by CODE in `source`, one entry per occurrence,
 * in source order. Comments and string literals do not count, which is
 * why this reads an AST rather than grepping.
 *
 * Reads are deliberately not sinks. `reader/getContext.ts` concatenates
 * `node.outerHTML` to build the "copy this section" payload; reading
 * markup out of the DOM is the opposite of injecting a string into it,
 * and a rule that could not tell the two apart would either have to
 * exempt that file — weakening it for the real case — or be argued with
 * every time somebody serializes a node.
 *
 * Known blind spot, written down rather than papered over: a sink reached
 * through a computed member (`el[k] = s`) or spread into JSX
 * (`<div {...props} />`) is invisible here. Both are unusual enough that
 * catching the ordinary spelling is worth having; neither appears in this
 * codebase today.
 */
function htmlSinksUsedIn(fileName: string, source: string): string[] {
  const found: string[] = [];
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  /** The property name being ASSIGNED to (`=` or `+=`), or null — a read returns null. */
  const assignedProperty = (node: ts.Node): string | null => {
    if (!ts.isBinaryExpression(node)) return null;
    const op = node.operatorToken.kind;
    if (op !== ts.SyntaxKind.EqualsToken && op !== ts.SyntaxKind.PlusEqualsToken) return null;
    return ts.isPropertyAccessExpression(node.left) ? node.left.name.text : null;
  };

  /** The method name being CALLED on some object, or null. */
  const calledMethod = (node: ts.Node): string | null =>
    ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null;

  const isDocumentCall = (node: ts.Node): boolean =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'document';

  const propertyName = (node: ts.Node): string | null => {
    if (ts.isJsxAttribute(node)) return ts.isIdentifier(node.name) ? node.name.text : null;
    if (ts.isPropertyAssignment(node)) {
      return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : null;
    }
    if (ts.isShorthandPropertyAssignment(node)) return node.name.text;
    return null;
  };

  const walk = (node: ts.Node): void => {
    const assigned = assignedProperty(node);
    if (assigned === 'innerHTML' || assigned === 'outerHTML') found.push(assigned);

    const called = calledMethod(node);
    if (called === 'insertAdjacentHTML' || called === 'createContextualFragment') found.push(called);
    if ((called === 'write' || called === 'writeln') && isDocumentCall(node)) found.push('document.write');

    if (propertyName(node) === 'dangerouslySetInnerHTML') found.push('dangerouslySetInnerHTML');

    ts.forEachChild(node, walk);
  };
  walk(parsed);
  return found;
}

/** Every HTML sink this app is allowed to contain, where, and how many times. */
const HTML_SINKS_ALLOWED: readonly {
  readonly sink: string;
  readonly file: string;
  readonly times: number;
  readonly why: string;
}[] = [
  {
    sink: 'innerHTML',
    file: join('apps', 'web', 'src', 'reader', 'ChapterView.tsx'),
    times: 1,
    why: 'the chapter fragment — the one string in this app that IS markup, and the only one a course author is allowed to write',
  },
  // `course/version.ts`'s `innerHTML` entry ĐÃ XOÁ Ở ĐÂY — the file is gone
  // (Task 13: the update-impact preview it belonged to has no course-package
  // model left to compare versions of). Its entry carried RULING S1-F30, a
  // real measurement worth restating rather than letting vanish with the
  // file: an image/media element's `onerror` fires because the load is
  // started by the `src` ATTRIBUTE, not because the element sits in a
  // rendered tree — so parsing a chapter into a `document.implementation.
  // createHTMLDocument()` INERT document does NOT, by itself, stop a
  // package's own `onerror` from running there. An earlier version of this
  // entry claimed the opposite ("detached, so no handler can ever fire") and
  // that claim was measured false in Chromium. Nothing left in this app
  // parses chapter HTML into a detached/inert document any more (verified:
  // `grep -rn "createHTMLDocument" apps/web/src` now matches only this
  // comment) — but if that pattern ever returns, "inert" is not itself a
  // safety argument; only running it through the same rule set that gates
  // ChapterView's own `innerHTML` (SCRIPT_TAG, EVENT_HANDLER_ATTR, …) is.
  {
    sink: 'innerHTML',
    file: join('packages', 'course-kit', 'runtime.js'),
    times: 2,
    // Brought INTO jurisdiction by the C1 fix. There were four `innerHTML`
    // assignments here and the scan could not see any of them. Two are gone
    // (`initViz`'s two notices now go through `vizNotice` → `textContent`,
    // which is what closed C1); these two remain, and each is allowed on a
    // REACHABILITY argument, which is the only kind of argument this file
    // accepts after ruling S1-F30 — a claim about what code CAN be reached,
    // not a claim about what a string happens to contain.
    //
    //   `el(tag, {html})`      — line ~19
    //   `Plot#showTip(px,py,html)` — line ~259
    //
    // The argument, and it is checkable rather than asserted: the ONLY place
    // in this file that reads package-authored DATA is `initViz`, and the only
    // datum it reads is `node.dataset.viz` (measured: `grep -n 'dataset\|
    // getAttribute' runtime.js` returns lines 337/338/341 and nothing else).
    // That path now ends in `textContent`. Everything that feeds these two
    // sinks — `readout`, `button`, tooltip bodies — is called BY a course's
    // `viz.js`, and `viz.js` is loaded only for `tier: "interactive"`
    // (`course/loader.ts`'s `resolveVizScriptUrl`). A `tier: "content"`
    // package cannot reach them, because reaching them requires executing
    // JavaScript, which is the exact thing that tier does not get. An
    // `interactive` package can reach them and gains nothing by it: it is
    // already running its own code in this page, by design (spec §1.2).
    //
    // WHAT WOULD MAKE THIS ENTRY WRONG, so the next reader knows where to
    // look instead of trusting this paragraph: a second reader of
    // package-authored data appearing in this file (another `dataset.*`,
    // a `getAttribute`, a `textContent` read off the chapter), or `el` /
    // `Plot` being called from `initViz`'s own branch. Either one breaks the
    // reachability claim and this entry has to be re-argued, not renumbered.
    why: 'two markup affordances for `viz.js` (el({html}), Plot#showTip) — reachable only by executing package code, i.e. only by `tier: "interactive"`, which already runs its own code by design',
  },
];

/**
 * THE FLOOR RULING S1-F8 STANDS ON.
 *
 * The shared rule set (`packages/course-format/src/validate.ts`) scans a
 * package's HTML with the markup rules and deliberately does NOT scan
 * `manifest.json` with them. That was the right call, and it is worth
 * restating why: a manifest is DATA. Running `<script>` / `on*=` /
 * `javascript:` detectors over a JSON document reports a course whose
 * DESCRIPTION happens to mention `<script>` — a false positive with no fix
 * available to the author, since that sentence is simply what their course
 * is about. Refusing to make that category error is what ruling S1-F8
 * decided.
 *
 * But the decision is CONDITIONAL, and this is the condition: it holds
 * exactly as long as no manifest field ever reaches an HTML sink. Today the
 * app satisfies that with room to spare — every manifest string (`title`,
 * `description`, part and chapter titles, `num`) is rendered as a React
 * text node in `Dashboard`, `CourseHome`, `Sidebar`, `Reader` and
 * `ChapterView`'s breadcrumb, and React escapes text nodes. That is not a
 * property anyone had written down, though; it is a property that happened
 * to be true — the kind that stops being true in a hurry once manifests
 * arrive from strangers' packages instead of from this repo.
 *
 * A manifest is a stranger's data — `api/catalog.ts` fetches it fresh off
 * the server's public catalog for every course, published by whoever ran
 * `tuhoc publish`. So the ruling's floor still gets a test.
 *
 * If this goes red, the fix is almost never "add the file to the
 * allowlist." It is: render the string as text. And if some future feature
 * genuinely must inject markup built from a manifest, then S1-F8 has to be
 * REOPENED in the same commit — at that moment the manifest stops being
 * data the reader only ever reads, and the validator's decision not to scan
 * it stops being free.
 *
 * AND THE MANIFEST IS ONLY HALF OF IT. C1 was a CHAPTER field — an attribute
 * value the rule set passes through as data, correctly, because it only reads
 * start tags — reaching `innerHTML` in `runtime.js`. Everything above about
 * manifests is still true; it is just not the whole rule. The whole rule is
 * the class both belong to: NO DATA A COURSE PACKAGE CONTROLS BECOMES MARKUP
 * IN CODE WE SHIP. See `BROWSER_CODE_ROOTS` for the jurisdiction that follows
 * from it.
 */
describe('no package-controlled data becomes markup in code we ship to the reader', () => {
  it('reads its own instrument correctly: writing markup counts, reading it does not', () => {
    const decoyed = [
      '// el.innerHTML = manifest.title — a mention, not a use',
      '/** dangerouslySetInnerHTML, insertAdjacentHTML, document.write in prose */',
      'const notARealUse = "innerHTML";',
      'export const serialized = node.outerHTML;',
      'export const current = el.innerHTML;',
      'export const same = el.innerHTML === other.innerHTML;',
    ].join('\n');
    expect(htmlSinksUsedIn('decoy.ts', decoyed)).toEqual([]);

    const real = [
      'el.innerHTML = m.title;',
      'el.outerHTML = m.description;',
      'el.innerHTML += m.title;',
      'el.insertAdjacentHTML("beforeend", m.title);',
      'document.write(m.title);',
      'range.createContextualFragment(m.title);',
    ].join('\n');
    expect(htmlSinksUsedIn('real.ts', real).sort()).toEqual([
      'createContextualFragment',
      'document.write',
      'innerHTML',
      'innerHTML',
      'insertAdjacentHTML',
      'outerHTML',
    ]);

    expect(
      htmlSinksUsedIn('real.tsx', 'export const V = () => <div dangerouslySetInnerHTML={{ __html: m.title }} />;'),
    ).toEqual(['dangerouslySetInnerHTML']);
  });

  /**
   * THE SELF-CHECK, and it is the point of this test rather than a preamble
   * to it.
   *
   * The shape that has now cost this project five separate blind gates is: a
   * gate measures what it can reach, and is SILENT where it cannot. A scan
   * whose roots quietly resolve to nothing reports zero violations and looks
   * identical to a codebase with zero violations. So every root must be
   * asserted non-empty INDIVIDUALLY — a total-count floor is not enough,
   * because `apps/web/src` alone clears any total floor while
   * `packages/course-kit` silently contributes nothing, which is precisely
   * the state this suite was in while C1 shipped.
   */
  it('scans every root of first-party reader-page code, and goes red if any root scans nothing', () => {
    for (const root of BROWSER_CODE_ROOTS) {
      const count = root.files().length;
      expect(count, `${root.name} scanned 0 files — this scan is now blind there (${root.why})`).toBeGreaterThan(0);
    }
    expect(inlineShellScripts().length, 'no inline <script> found in the app shell').toBeGreaterThan(0);

    const seen = browserCodeFiles().map(label);
    expect(seen.length).toBeGreaterThan(20);

    // Named on purpose, not left to a glob: this is the file the previous
    // jurisdiction missed, and a rename or a move must reopen the argument
    // rather than silently drop it out of scope.
    expect(seen).toContain(join('packages', 'course-kit', 'runtime.js'));

    for (const allowed of HTML_SINKS_ALLOWED) expect(seen).toContain(allowed.file);

    // Not vacuous: the allowlisted sink is genuinely found where it is
    // allowed. A scanner that quietly stopped matching anything would
    // otherwise keep this suite green while protecting nothing.
    for (const allowed of HTML_SINKS_ALLOWED) {
      const file = resolve(REPO_ROOT, allowed.file);
      const used = htmlSinksUsedIn(file, readFileSync(file, 'utf-8')).filter((s) => s === allowed.sink);
      expect(used).toHaveLength(allowed.times);
    }
  });

  it('has no HTML sink anywhere else — no package-controlled string can become markup', () => {
    const violations: string[] = [];
    const scanned: { where: string; source: string }[] = [
      ...browserCodeFiles().map((file) => ({ where: label(file), source: readFileSync(file, 'utf-8') })),
      ...inlineShellScripts().map((s) => ({ where: s.label, source: s.source })),
    ];

    for (const { where, source } of scanned) {
      const sinks = htmlSinksUsedIn(where, source);
      for (const sink of new Set(sinks)) {
        const allowed = HTML_SINKS_ALLOWED.find((a) => a.sink === sink && a.file === where);
        const times = sinks.filter((s) => s === sink).length;
        if (!allowed) {
          violations.push(
            `${where} turns a string into markup via ${sink} — this code runs in the reader's page, where a stranger's package supplies the manifest AND every chapter attribute, and neither is scanned for markup by the rule set (ruling S1-F8 reads start tags only); build a node and assign textContent instead`,
          );
        } else if (times !== allowed.times) {
          violations.push(`${where} uses ${sink} ${times}× (expected ${allowed.times}: ${allowed.why})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

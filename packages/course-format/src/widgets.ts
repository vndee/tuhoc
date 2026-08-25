/**
 * Task 2 of the server-side pivot: the widget rule set.
 *
 * Task 1 abolished `tier: 'interactive'` — no package may ship free-running
 * JavaScript into a chapter any more, and `validate.ts`'s seven content rules
 * (`SCRIPT_TAG`, `EVENT_HANDLER_ATTR`, …) run on every package unconditionally.
 * A **widget** is the one door left for interactive content: a single
 * self-contained `widgets/<name>/index.html`, which a later task renders
 * inside `<iframe srcdoc sandbox="allow-scripts">` — no `allow-same-origin`,
 * so an opaque origin with no cookies, no storage and no reach into the
 * session (spec `docs/superpowers/specs/2026-08-25-server-side-pivot.md`
 * §2.3, §6).
 *
 * ## What these eight rules are for, and what they are NOT for
 *
 * The sandbox is what makes a widget safe to run. These rules do not
 * duplicate that job — nothing here inspects widget JS for what it could do
 * to the page it runs in, because inside its own opaque origin there is
 * nothing to do. What the sandbox does NOT buy is a widget a human can
 * actually review: format v2 keeps the same human-review gate over anything
 * that runs (spec §6, "duyệt tay JS widget vẫn giữ"), and a 4 MB widget with
 * one 900 KB minified line is not reviewable by anyone in the time a PR
 * review actually gets. So the axis these rules measure is READABILITY and
 * SELF-CONTAINMENT — small enough and plain enough to read before merging,
 * and carrying nothing that only makes sense with a network or a cookie jar
 * the sandbox has already taken away.
 *
 * The specific numbers (`WIDGET_MAX_BYTES`, `WIDGET_MAX_LINE_BYTES`,
 * `WIDGET_NAME_MAX`) are fixed by the plan this task implements, not derived
 * in this file — see the task brief and the spec's §6 note that thresholds
 * come from measuring the sample courses, not from guessing a round number.
 *
 * ## Why this file, and why the import cycle with `validate.ts`
 *
 * `validate.ts` is already ~44 KB and is the single copy of the rule set
 * three other subsystems import; the task brief keeps the widget rules in
 * their own file rather than growing that one further. That means this
 * module and `validate.ts` import from each other: `validate.ts` calls
 * {@link checkWidgets} at the end of `validatePackage`, and this file reuses
 * `validate.ts`'s `BoundedTokenizer` (the O(1)-dedup, `MAX_ATTRS_PER_TAG`
 * hardened tokenizer — review round 2's N1) and its `WIDGET_DIR_RE` /
 * `WIDGET_INDEX_RE` constants rather than a second copy of either. The cycle
 * is between two `export`s that are only ever CALLED from inside a function
 * body (`checkWidgets`, `new BoundedTokenizer(…)`), never touched while
 * either module is still initializing, so ES module live bindings resolve it
 * the same way Node/Vite/`tsc -b` resolve any other same-package cycle.
 * `validate.ts` explains its half at the top of its own `import`.
 */

import type { Token, TokenHandler } from 'parse5';

import { BoundedTokenizer, WIDGET_DIR_RE, WIDGET_INDEX_RE, type Finding, type FindingCode } from './validate';

/**
 * Byte ceiling on a widget's `index.html`. Past this, a reviewer is not
 * reading a widget in one sitting — the fix is to trim the widget, not to
 * raise the number.
 */
export const WIDGET_MAX_BYTES = 131072;

/**
 * Byte ceiling on a SINGLE LINE of `index.html`. This is the anti-minification
 * fence: minified JS is characteristically one enormous line, and a line
 * length cap catches that shape directly instead of trying to detect
 * "minified-ness" some cleverer, more guessable way. A widget author who
 * wraps their code normally never approaches this; one who runs it through a
 * minifier hits it on the first line.
 */
export const WIDGET_MAX_LINE_BYTES = 500;

/**
 * A widget's name becomes a path segment a later task serves over HTTP
 * (`widgets/<name>/index.html`, spec §6) — lowercase, digits and hyphens
 * only, and starting with an alphanumeric so it can never be mistaken for a
 * flag or a hidden/relative segment. The same shape a URL slug or an npm
 * package name uses, for the same reason: it is unambiguous wherever it is
 * later dropped into a path.
 */
export const WIDGET_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Paired with {@link WIDGET_NAME_RE}: a name that matches the shape but runs on forever is still not a usable path segment. */
export const WIDGET_NAME_MAX = 64;

/**
 * Substrings that mean "this code expects storage or a cookie jar" — and a
 * widget's iframe (`allow-scripts`, deliberately NOT `allow-same-origin`) has
 * neither. Calling any of these throws at runtime inside the sandbox, so
 * `WIDGET_FORBIDDEN_API` catches the mistake at pack time instead of leaving
 * an author to discover it from a broken widget in production. A plain
 * substring match, not a parse of the JS: the point is not to prove the API
 * is reachable (an author who works around this list is just choosing to
 * ship a widget that throws), it is to catch the code an author writes
 * assuming a normal browser tab, which is what every widget's iframe is not.
 */
export const WIDGET_FORBIDDEN_APIS = ['document.cookie', 'localStorage', 'sessionStorage', 'indexedDB'] as const;

const WIDGETS_PREFIX = 'widgets/';

const decoder = new TextDecoder('utf-8');
const encoder = new TextEncoder();

function finding(code: FindingCode, path: string, detail: string): Finding {
  return { code, path, detail };
}

/**
 * Every `data-widget="…"` value in a chapter fragment, in the order they
 * appear, WITHOUT deduplicating — a chapter that places the same widget
 * twice (e.g. one quiz shown after two different sections) has two real
 * placeholders, and a caller that renders one `<iframe>` per occurrence (a
 * later task) needs both.
 *
 * Goes through `validate.ts`'s {@link BoundedTokenizer} rather than a regex
 * over the raw HTML, for the identical reason `scanHtmlText` does: an
 * attribute boundary is a tokenizer state, not a character class. A regex
 * hunting for `data-widget="([^"]*)"` misses `<div data-widget=demo/other>`
 * (unquoted, `/`-separated — the exact C1 bypass shape `validate.ts`'s own
 * header measures) and would need to reinvent the tokenizer's quote-handling
 * to avoid it. Attribute NAMES are ASCII-lowercased during tokenization
 * (same fact the `EVENT_HANDLER_ATTR` rule relies on for `ONERROR`), so
 * `DATA-WIDGET` and `Data-Widget` are both read as `data-widget` here with no
 * extra casing logic of this function's own.
 */
export function extractWidgetRefs(chapterHtml: string): string[] {
  const refs: string[] = [];
  const ignore = (): void => {};

  const handler: TokenHandler = {
    onStartTag(token: Token.TagToken): void {
      for (const attr of token.attrs) {
        if (attr.name === 'data-widget') refs.push(attr.value);
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
  tokenizer.write(chapterHtml, true);
  return refs;
}

/** What was found under one `widgets/<name>/` directory. */
interface WidgetGroup {
  /** Bytes of `widgets/<name>/index.html`, when that file exists. */
  indexBytes?: Uint8Array;
  /** Every OTHER path under this widget's directory, full package-relative path. */
  extraPaths: string[];
}

/**
 * Groups every `widgets/…` entry by widget name, splitting each into its
 * `index.html` (if any) and everything else. One pass over `files` rather
 * than one `WIDGET_DIR_RE.test` per widget name × per rule — the rules below
 * all need the same grouping, so it is done once.
 */
function groupWidgetFiles(files: ReadonlyMap<string, Uint8Array>): Map<string, WidgetGroup> {
  const byName = new Map<string, WidgetGroup>();
  for (const [path, bytes] of files) {
    if (!WIDGET_DIR_RE.test(path)) continue;
    // WIDGET_DIR_RE already proved there is a '/' after the prefix, so this
    // indexOf cannot return -1.
    const nameEnd = path.indexOf('/', WIDGETS_PREFIX.length);
    const name = path.slice(WIDGETS_PREFIX.length, nameEnd);

    let group = byName.get(name);
    if (group === undefined) {
      group = { extraPaths: [] };
      byName.set(name, group);
    }

    if (WIDGET_INDEX_RE.test(path)) {
      group.indexBytes = bytes;
    } else {
      group.extraPaths.push(path);
    }
  }
  return byName;
}

/**
 * The four content checks on one widget's `index.html`: size, line length,
 * forbidden APIs, external URLs. All four read the SAME decoded text once —
 * a widget is capped at {@link WIDGET_MAX_BYTES} (128 KiB), so unlike
 * `validate.ts`'s package-wide scan there is no proportional-cost reason to
 * skip any of them, even when an earlier one already fired.
 */
function checkWidgetIndex(path: string, bytes: Uint8Array): Finding[] {
  const out: Finding[] = [];

  if (bytes.byteLength > WIDGET_MAX_BYTES) {
    out.push(
      finding(
        'WIDGET_TOO_LARGE',
        path,
        `index.html nặng ${bytes.byteLength} byte, vượt trần ${WIDGET_MAX_BYTES} byte của một widget — cắt bớt nội dung, hoặc tách ảnh/dữ liệu lớn ra khỏi widget`,
      ),
    );
  }

  const text = decoder.decode(bytes);

  text.split('\n').forEach((line, i) => {
    const lineBytes = encoder.encode(line).byteLength;
    if (lineBytes > WIDGET_MAX_LINE_BYTES) {
      out.push(
        finding(
          'WIDGET_LINE_TOO_LONG',
          path,
          `dòng ${i + 1} dài ${lineBytes} byte, vượt trần ${WIDGET_MAX_LINE_BYTES} byte/dòng — mã có vẻ đã bị minify hoặc dồn hết vào một dòng; viết lại thành nhiều dòng cho người duyệt đọc được`,
        ),
      );
    }
  });

  for (const api of WIDGET_FORBIDDEN_APIS) {
    if (text.includes(api)) {
      out.push(
        finding(
          'WIDGET_FORBIDDEN_API',
          path,
          `chứa "${api}" — widget chạy trong iframe sandbox không có cookie/storage, gọi API này chỉ ném lỗi lúc chạy; bỏ nó khỏi widget`,
        ),
      );
    }
  }

  if (text.includes('http://') || text.includes('https://')) {
    out.push(
      finding(
        'WIDGET_EXTERNAL_URL',
        path,
        'widget phải tự chứa: không tải gì từ mạng, kể cả trong chú thích — bỏ URL đi',
      ),
    );
  }

  return out;
}

/** `WIDGET_BAD_NAME` and `WIDGET_EXTRA_FILE` for one widget directory, plus the content checks on its `index.html` if it has one. */
function checkOneWidget(name: string, group: WidgetGroup): Finding[] {
  const out: Finding[] = [];
  const widgetDir = `${WIDGETS_PREFIX}${name}`;

  if (!WIDGET_NAME_RE.test(name) || name.length > WIDGET_NAME_MAX) {
    out.push(
      finding(
        'WIDGET_BAD_NAME',
        widgetDir,
        `tên widget "${name}" không hợp lệ: chỉ được dùng chữ thường a-z, số 0-9 và dấu gạch ngang, bắt đầu bằng chữ hoặc số, tối đa ${WIDGET_NAME_MAX} ký tự — đổi tên thư mục ${widgetDir}/`,
      ),
    );
  }

  for (const extraPath of group.extraPaths) {
    out.push(
      finding(
        'WIDGET_EXTRA_FILE',
        extraPath,
        `một widget chỉ được có đúng một tệp — ${widgetDir}/index.html; gộp nội dung của tệp này vào index.html, hoặc xoá nó`,
      ),
    );
  }

  if (group.indexBytes !== undefined) {
    out.push(...checkWidgetIndex(`${widgetDir}/index.html`, group.indexBytes));
  }

  return out;
}

/**
 * True when `name` names a widget that can actually render: a directory with
 * an `index.html` in it. A `widgets/<name>/` directory holding only stray
 * files (no `index.html` — already flagged `WIDGET_EXTRA_FILE` for each
 * stray file by {@link checkOneWidget}) is NOT a real widget as far as the
 * missing/orphan cross-reference is concerned, even though `byName.has(name)`
 * is true for it. Getting this wrong in both directions was review round 1's
 * finding: a chapter referencing such a directory got no `WIDGET_MISSING`
 * (the directory "existed"), and an unreferenced one got a `WIDGET_ORPHAN`
 * pointing at an `index.html` that was never created.
 */
function isRealWidget(byName: ReadonlyMap<string, WidgetGroup>, name: string): boolean {
  return byName.get(name)?.indexBytes !== undefined;
}

/**
 * Runs all eight widget rules over a package: per-widget shape/size/content
 * checks, plus the cross-reference between what chapters ask for
 * (`data-widget="…"`) and what widgets the package actually ships.
 *
 * `chapterFiles` is the list of `chapter.file` paths from the manifest — the
 * caller (`validate.ts`) already has this from walking `parts`, and asking
 * for it here rather than a whole `Manifest` keeps this function's contract
 * to exactly what it needs. A `chapterFile` missing from `files` (already
 * reported as `CHAPTER_FILE_MISSING` by `validate.ts`) is skipped rather than
 * re-reported here.
 *
 * `WIDGET_MISSING` is deduplicated per (chapter, widget name): a chapter that
 * places the same missing widget five times would otherwise print the same
 * sentence five times, which helps nobody find the other four problems in
 * their package. `extractWidgetRefs` itself stays undeduplicated — see its
 * own doc comment for why a RENDERER needs every occurrence even though a
 * FINDING does not.
 *
 * An empty `data-widget=""` gets its own sentence rather than being reported
 * as a reference to the widget named `""`: naming the empty string as a
 * widget and pointing at `widgets//index.html` reads like this tool is
 * broken, not like a diagnosis of the chapter's actual mistake — a
 * placeholder nobody finished writing.
 */
export function checkWidgets(
  files: ReadonlyMap<string, Uint8Array>,
  chapterFiles: readonly string[],
): Finding[] {
  const out: Finding[] = [];
  const byName = groupWidgetFiles(files);

  for (const [name, group] of byName) {
    out.push(...checkOneWidget(name, group));
  }

  const referenced = new Set<string>();
  for (const chapterPath of chapterFiles) {
    const bytes = files.get(chapterPath);
    if (bytes === undefined) continue;

    const reportedMissing = new Set<string>();
    for (const ref of extractWidgetRefs(decoder.decode(bytes))) {
      referenced.add(ref);
      if (isRealWidget(byName, ref) || reportedMissing.has(ref)) continue;
      reportedMissing.add(ref);
      const detail =
        ref === ''
          ? 'chương này có một data-widget="" không mang tên widget nào — đặt tên cụ thể, ví dụ data-widget="dem-so", khớp với thư mục widgets/dem-so/'
          : `chương này tham chiếu widget "${ref}" qua data-widget, nhưng gói không có ${WIDGETS_PREFIX}${ref}/index.html`;
      out.push(finding('WIDGET_MISSING', chapterPath, detail));
    }
  }

  for (const name of byName.keys()) {
    if (!isRealWidget(byName, name) || referenced.has(name)) continue;
    out.push(
      finding(
        'WIDGET_ORPHAN',
        `${WIDGETS_PREFIX}${name}/index.html`,
        `widget "${name}" không được chương nào tham chiếu qua data-widget="${name}" — xoá thư mục widget này nếu không còn dùng, hoặc thêm data-widget="${name}" vào chương cần nó`,
      ),
    );
  }

  return out;
}

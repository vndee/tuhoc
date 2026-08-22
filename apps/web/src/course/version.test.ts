/**
 * Task 10: what an update would cost, measured before anything is committed.
 *
 * Three things this file exists to hold down, in order of how expensive they
 * would be to get wrong:
 *
 *  1. `previewUpdate` writes NOTHING. Proved twice over — a full before/after
 *     snapshot of every Dexie table, and a spy on every mutating method of
 *     every table, because a snapshot alone cannot tell "never wrote" apart
 *     from "wrote and put it back".
 *  2. A note that loses its anchor is not deleted. `applyUpdate` never touches
 *     `db.annotations` at all; the rows are still there, tombstone-free, and
 *     the orphan panel (P2 Task 7) is where they surface.
 *  3. The three groups are counted against the NEW content, with maps built on
 *     the NEW content (ruling P2-F8).
 *
 * The anchors here are not hand-written. Every one is produced by
 * `selectionToAnchor` over the v1.0 DOM, exactly as Task 5's toolbar would
 * have produced it when the reader dragged across that paragraph — so what is
 * being measured is the real stored shape, not a plausible-looking literal.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { anchorToRange, selectionToAnchor } from '../annotations/anchor';
import { normalizeContainer } from '../annotations/normalize';
import { type AnnotationRow, db, type PackageRow } from '../db/local';
import { readRealCourseFile, REAL_COURSE_ID } from '../test/realCourse';
import { loadManifest } from './loader';
import { applyUpdate, CourseKitUnavailableError, parseChapterInert, previewUpdate } from './version';

/**
 * `version.ts` asks `useCourseKit` to inject the runtime trio when
 * `window.CourseKit` is not already attached. jsdom does not fetch
 * `<script src>` at all — neither `load` nor `error` ever fires — so the real
 * singleton would hang rather than fail, which is a property of the test
 * environment and not of the code. Mocked so the "what happens when the
 * renderer cannot be had" tests can answer in finite time; every other test
 * attaches the REAL runtime to `window.CourseKit` (see `loadCourseKit`), so the
 * mock is never consulted on the happy path.
 */
const ensureCourseKitRuntime = vi.hoisted(() => vi.fn(async (): Promise<void> => {}));
vi.mock('../reader/useCourseKit', () => ({ ensureCourseKitRuntime }));

const COURSE = 'demo';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const encode = (text: string) => new TextEncoder().encode(text);

/* ------------------------------------------------------------------ *
 * The real chapter renderer
 * ------------------------------------------------------------------ */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../..');

/**
 * The genuine `window.CourseKit`, evaluated out of `packages/course-kit` the
 * way `annotations/anchor.test.ts` and `annotations/painter.test.ts` already
 * do for KaTeX.
 *
 * A hand-rolled stub would defeat the purpose of these tests. What is being
 * checked is that a preview projects a chapter to the SAME string the reader's
 * page projected it to when the note was anchored, and the only thing that can
 * establish that is the same renderer with the same options — `runtime.js`'s
 * `renderKatex` carries its own delimiter list, `strict: false` and two macros,
 * none of which a stub would reproduce by accident.
 */
let kitLoaded = false;
function loadCourseKit(): void {
  if (kitLoaded) return;
  for (const file of ['vendor/katex.js', 'vendor/auto-render.js', 'runtime.js']) {
    new Function(readFileSync(resolve(REPO, 'packages/course-kit', file), 'utf8')).call(globalThis);
  }
  kitLoaded = true;
}

/** A chapter's DOM as `ChapterView` builds it: `innerHTML`, then `renderKatex`. */
function renderChapter(html: string): HTMLDivElement {
  loadCourseKit();
  const host = document.createElement('div');
  host.innerHTML = html;
  window.CourseKit?.renderKatex(host);
  return host;
}

/* ------------------------------------------------------------------ *
 * Two versions of one chapter, differing in exactly the three ways a
 * content rebuild can differ.
 * ------------------------------------------------------------------ */

const C1_V10 = `
<h1 class="ch-title">Vì sao chạy thử không kết luận được</h1>
<p id="p1">Bất biến của một vòng lặp là một mệnh đề về các biến chương trình, đúng tại đầu mỗi lần kiểm tra điều kiện lặp.</p>
<p id="p2">Kiểm thử là lấy mẫu từ không gian đầu vào; con số mười nghìn đo được công sức bỏ ra, không đo được phần không gian đã phủ.</p>
<p id="p3">Đoạn này biến mất hoàn toàn ở bản 1.1, nên ghi chú neo vào nó không còn chỗ nào để bám.</p>
`;

// p1 byte-identical (→ exact). p2 gains the word "chỉ" and loses "được" twice
// (→ fuzzy: a handful of edits in a ~120-character quote). p3 is gone (→ orphan).
const C1_V11 = `
<h1 class="ch-title">Vì sao chạy thử không kết luận được</h1>
<p id="p1">Bất biến của một vòng lặp là một mệnh đề về các biến chương trình, đúng tại đầu mỗi lần kiểm tra điều kiện lặp.</p>
<p id="p2">Kiểm thử là lấy mẫu từ không gian đầu vào; con số mười nghìn chỉ đo công sức bỏ ra, không đo phần không gian đã phủ.</p>
`;

function manifestFor(version: string): Record<string, unknown> {
  return {
    id: COURSE,
    title: 'Bất biến vòng lặp',
    description: '',
    lang: 'vi',
    version,
    runtime: '^1',
    tier: 'content',
    parts: [
      {
        title: 'Phần I',
        chapters: [{ id: 'c1', num: '1.1', title: 'Chương một', short: 'Một', file: 'chapters/c1.html' }],
      },
    ],
  };
}

function packageRow(version: string, chapterHtml: string, pinnedAt: string): PackageRow {
  const manifest = manifestFor(version);
  return {
    key: `${COURSE}@${version}`,
    courseId: COURSE,
    version,
    manifest,
    files: {
      'manifest.json': encode(JSON.stringify(manifest)),
      'chapters/c1.html': encode(chapterHtml),
    },
    pinnedAt,
  };
}

/* ------------------------------------------------------------------ *
 * Anchors, produced the way the toolbar produces them
 * ------------------------------------------------------------------ */

/** The anchor Task 5 would have stored for a drag across `selector`'s text in `html`. */
function anchorOver(html: string, selector: string): unknown {
  const root = renderChapter(html);
  const target = root.querySelector(selector);
  if (!target) throw new Error(`test fixture: no "${selector}" in this chapter`);
  const range = document.createRange();
  range.selectNodeContents(target);
  const anchor = selectionToAnchor(normalizeContainer(root), range, 'y');
  if (!anchor) throw new Error(`test fixture: "${selector}" did not yield an anchor`);
  return anchor;
}

function note(id: string, anchor: unknown, chapterId = 'c1'): AnnotationRow {
  return {
    id,
    courseId: COURSE,
    chapterId,
    anchor,
    note: `ghi chú ${id}`,
    createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-08-20T09:00:00.000Z',
    deletedAt: null,
  };
}

/** The three notes the brief's counts are about: one survives verbatim, one
 * drifts, one loses its paragraph. */
async function seedThreeNotes(): Promise<void> {
  await db.annotations.bulkPut([
    note('n-exact', anchorOver(C1_V10, '#p1')),
    note('n-fuzzy', anchorOver(C1_V10, '#p2')),
    note('n-orphan', anchorOver(C1_V10, '#p3')),
  ]);
}

async function seedBothVersions(): Promise<void> {
  await db.packages.bulkPut([
    packageRow('1.0.0', C1_V10, '2026-08-20T08:00:00.000Z'),
    packageRow('1.1.0', C1_V11, '2026-08-19T08:00:00.000Z'),
  ]);
}

/* ------------------------------------------------------------------ *
 * Whole-database snapshot
 * ------------------------------------------------------------------ */

/** Every row of every table, keyed by table name. `Uint8Array`s compare
 * element-wise under `toEqual`, so a package's bytes are part of this. */
async function snapshotDb(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const table of db.tables) {
    out[table.name] = await table.toArray();
  }
  return out;
}

/** Every mutating method of every table, spied. A snapshot proves the database
 * ENDED unchanged; this proves nothing ever tried to change it. */
const MUTATORS = ['add', 'put', 'bulkAdd', 'bulkPut', 'delete', 'bulkDelete', 'clear', 'update'] as const;

type Mutator = (...args: never[]) => unknown;

/**
 * The spies go on `db.<name>`, NOT on the objects `db.tables` hands back.
 *
 * They are not the same objects — measured, after a mutation test walked
 * straight past a version of this helper that spied on `db.tables`:
 * `db.tables.find(t => t.name === 'packages') === db.packages` is FALSE in
 * Dexie 4. Every module in this app writes through `db.packages` / `db.outbox`
 * / `db.annotations`, so those are the objects that have to be watched; a spy
 * on the other copy records nothing and reports a clean `[]` for a function
 * that wrote to the database on every call.
 *
 * The names still come from `db.tables`, so a sixth table added to the schema
 * is watched without anyone remembering to come back here.
 */
function spyOnEveryWrite(): { name: string; calls: () => number }[] {
  const spies: { name: string; calls: () => number }[] = [];
  for (const { name } of db.tables) {
    const holder = (db as unknown as Record<string, Record<string, Mutator>>)[name];
    for (const method of MUTATORS) {
      if (typeof holder?.[method] !== 'function') continue;
      const spy = vi.spyOn(holder, method);
      spies.push({ name: `${name}.${method}`, calls: () => spy.mock.calls.length });
    }
  }
  return spies;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  ensureCourseKitRuntime.mockReset();
  ensureCourseKitRuntime.mockResolvedValue(undefined);
  loadCourseKit();
  await Promise.all(db.tables.map((table) => table.clear()));
});

/* ------------------------------------------------------------------ *
 * 1. The dry run writes nothing
 * ------------------------------------------------------------------ */

describe('previewUpdate — a dry run', () => {
  it('bộ dò ghi đọc đúng chính nó: một lần ghi cố ý phải bị bắt', async () => {
    // Without this, "no write method was called" is a sentence about a spy that
    // may be watching the wrong object, and it stays green forever. It did:
    // an earlier version of `spyOnEveryWrite` watched `db.tables`'s copies and
    // let a `db.packages.put` through untouched.
    const spies = spyOnEveryWrite();

    await db.meta.put({ key: 'probe', value: '1' });
    await db.annotations.bulkPut([]);

    expect(spies.filter((entry) => entry.calls() > 0).map((entry) => entry.name).sort()).toEqual([
      'annotations.bulkPut',
      'meta.put',
    ]);
  });

  it('chạy thử KHÔNG ghi gì: Dexie và outbox y nguyên', async () => {
    await seedBothVersions();
    await seedThreeNotes();
    await db.outbox.add({ table: 'annotations', row: { id: 'n-exact' } });
    await db.meta.put({ key: 'syncCursor', value: 'abc' });

    const before = await snapshotDb();
    await previewUpdate(COURSE, '1.0.0', '1.1.0');

    expect(await snapshotDb()).toEqual(before);
  });

  it('không một phương thức ghi nào của bất kỳ bảng nào được gọi', async () => {
    await seedBothVersions();
    await seedThreeNotes();

    const spies = spyOnEveryWrite();
    await previewUpdate(COURSE, '1.0.0', '1.1.0');

    const called = spies.filter((entry) => entry.calls() > 0).map((entry) => entry.name);
    expect(called).toEqual([]);
  });

  it('không ghim lại phiên bản: loadManifest vẫn trả về bản cũ sau khi chạy thử', async () => {
    await seedBothVersions();
    await seedThreeNotes();

    await previewUpdate(COURSE, '1.0.0', '1.1.0');

    await expect(loadManifest(COURSE)).resolves.toMatchObject({ version: '1.0.0' });
  });

  it('tải bản mới từ máy chủ khi máy chưa có, mà vẫn không lưu nó vào Dexie', async () => {
    await db.packages.put(packageRow('1.0.0', C1_V10, '2026-08-20T08:00:00.000Z'));
    await seedThreeNotes();

    const manifest = manifestFor('1.1.0');
    server.use(
      http.get(`/courses/${COURSE}/@1.1.0/manifest.json`, () =>
        new HttpResponse(encode(JSON.stringify(manifest))),
      ),
      http.get(`/courses/${COURSE}/@1.1.0/chapters/c1.html`, () =>
        new HttpResponse(encode(C1_V11)),
      ),
    );

    // Spied here as well as in the test above, and not out of tidiness: the
    // download path is a DIFFERENT path, and it is the one with something to
    // cache. Caching what it fetched is the obvious optimisation and would
    // leave the first two tests of this block perfectly green, because in
    // those the package is already on the device and nothing is fetched at all.
    const spies = spyOnEveryWrite();
    const impact = await previewUpdate(COURSE, '1.0.0', '1.1.0');

    expect(impact.total).toBe(3);
    expect(spies.filter((entry) => entry.calls() > 0).map((entry) => entry.name)).toEqual([]);
    expect(await db.packages.toArray()).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * 2. The three groups
 * ------------------------------------------------------------------ */

describe('previewUpdate — the three groups', () => {
  it('đếm đúng ba nhóm: nguyên vẹn / dịch nhẹ / mất neo', async () => {
    await seedBothVersions();
    await seedThreeNotes();

    const impact = await previewUpdate(COURSE, '1.0.0', '1.1.0');

    expect(impact).toMatchObject({ total: 3, exact: 1, fuzzy: 1 });
    expect(impact.orphaned).toHaveLength(1);
  });

  it('nêu tên ghi chú mất neo, chương của nó, và nguyên văn đoạn đã mất', async () => {
    await seedBothVersions();
    await seedThreeNotes();

    const impact = await previewUpdate(COURSE, '1.0.0', '1.1.0');

    expect(impact.orphaned[0]).toMatchObject({ id: 'n-orphan', chapterId: 'c1' });
    expect(impact.orphaned[0].exact).toContain('Đoạn này biến mất hoàn toàn');
  });

  it('ba nhóm cộng lại đúng bằng tổng', async () => {
    await seedBothVersions();
    await seedThreeNotes();

    const impact = await previewUpdate(COURSE, '1.0.0', '1.1.0');

    expect(impact.exact + impact.fuzzy + impact.orphaned.length).toBe(impact.total);
  });

  it('bỏ qua ghi chú đã xoá (tombstone) và ghi chú của khoá học khác', async () => {
    await seedBothVersions();
    await seedThreeNotes();
    await db.annotations.bulkPut([
      { ...note('n-deleted', anchorOver(C1_V10, '#p3')), deletedAt: '2026-08-21T00:00:00.000Z' },
      { ...note('n-other', anchorOver(C1_V10, '#p3')), courseId: 'khoa-hoc-khac' },
    ]);

    const impact = await previewUpdate(COURSE, '1.0.0', '1.1.0');

    expect(impact.total).toBe(3);
  });

  it('ghi chú của một chương đã bị xoá khỏi mục lục là mất neo, không phải lỗi', async () => {
    await seedBothVersions();
    await db.annotations.put(note('n-gone-chapter', anchorOver(C1_V10, '#p1'), 'c9'));

    const impact = await previewUpdate(COURSE, '1.0.0', '1.1.0');

    expect(impact).toMatchObject({ total: 1, exact: 0, fuzzy: 0 });
    expect(impact.orphaned[0]).toMatchObject({ id: 'n-gone-chapter', chapterId: 'c9' });
  });

  it('phân biệt ghi chú VỐN ĐÃ mất neo với ghi chú do bản cập nhật làm mất', async () => {
    await seedBothVersions();
    await db.annotations.bulkPut([
      note('n-orphan', anchorOver(C1_V10, '#p3')),
      // Anchored to text that is in NEITHER version: already an orphan at 1.0.0,
      // so staying on 1.0.0 does not save it.
      note('n-was-already-lost', {
        exact: 'một câu chưa từng có trong bất kỳ phiên bản nào của chương này',
        prefix: '',
        suffix: '',
        color: 'y',
      }),
    ]);

    const impact = await previewUpdate(COURSE, '1.0.0', '1.1.0');

    expect(impact.orphaned).toHaveLength(2);
    const byId = Object.fromEntries(impact.orphaned.map((row) => [row.id, row.alreadyOrphaned]));
    expect(byId).toEqual({ 'n-orphan': false, 'n-was-already-lost': true });
  });
});

/* ------------------------------------------------------------------ *
 * 3. Applying it
 * ------------------------------------------------------------------ */

describe('applyUpdate', () => {
  it('sau khi áp dụng, ghi chú mất neo VẪN CÒN, chỉ là mồ côi', async () => {
    await seedBothVersions();
    await seedThreeNotes();

    await applyUpdate(COURSE, '1.1.0');

    const rows = await db.annotations.toArray();
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.deletedAt === null)).toBe(true);
  });

  it('ghim bản mới: loadManifest chuyển sang 1.1.0', async () => {
    await seedBothVersions();

    await applyUpdate(COURSE, '1.1.0');

    await expect(loadManifest(COURSE)).resolves.toMatchObject({ version: '1.1.0' });
  });

  it('giữ lại bản cũ trên máy — cập nhật không phải là xoá', async () => {
    await seedBothVersions();

    await applyUpdate(COURSE, '1.1.0');

    expect(await db.packages.get(`${COURSE}@1.0.0`)).toBeDefined();
  });

  it('không xếp hàng gì vào outbox: ghim phiên bản là lựa chọn của MÁY NÀY', async () => {
    await seedBothVersions();
    await seedThreeNotes();

    await applyUpdate(COURSE, '1.1.0');

    expect(await db.outbox.toArray()).toEqual([]);
  });

  it('tải bản mới từ máy chủ nếu máy chưa có, rồi mới ghim', async () => {
    await db.packages.put(packageRow('1.0.0', C1_V10, '2026-08-20T08:00:00.000Z'));
    const manifest = manifestFor('1.1.0');
    server.use(
      http.get(`/courses/${COURSE}/@1.1.0/manifest.json`, () =>
        new HttpResponse(encode(JSON.stringify(manifest))),
      ),
      http.get(`/courses/${COURSE}/@1.1.0/chapters/c1.html`, () =>
        new HttpResponse(encode(C1_V11)),
      ),
    );

    await applyUpdate(COURSE, '1.1.0');

    const stored = await db.packages.get(`${COURSE}@1.1.0`);
    expect(stored).toBeDefined();
    await expect(loadManifest(COURSE)).resolves.toMatchObject({ version: '1.1.0' });
  });
});

/* ------------------------------------------------------------------ *
 * 4. The renderer is not optional
 * ------------------------------------------------------------------ */

describe('previewUpdate — the chapter renderer', () => {
  it('từ chối đo khi không dựng được chương như người đọc đã thấy', async () => {
    await seedBothVersions();
    await seedThreeNotes();

    const kit = window.CourseKit;
    delete (window as { CourseKit?: unknown }).CourseKit;
    ensureCourseKitRuntime.mockRejectedValue(new Error('offline'));
    try {
      await expect(previewUpdate(COURSE, '1.0.0', '1.1.0')).rejects.toBeInstanceOf(CourseKitUnavailableError);
    } finally {
      window.CourseKit = kit;
    }
  });

  it('không đụng tới runtime khi khoá học chưa có ghi chú nào', async () => {
    await seedBothVersions();

    const impact = await previewUpdate(COURSE, '1.0.0', '1.1.0');

    expect(impact).toEqual({ total: 0, exact: 0, fuzzy: 0, orphaned: [] });
    expect(ensureCourseKitRuntime).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ *
 * 5. A REAL chapter of the real course
 * ------------------------------------------------------------------ *
 *
 * Everything above runs on four hand-written paragraphs, and four hand-written
 * paragraphs cannot tell the truth about this: they contain no mathematics, and
 * this course is a mathematics textbook. 29 of the 30 anchors below quote a
 * formula, and a formula is ONE character (`'￼'`) in the projection an anchor
 * is stored in — but only after `CourseKit.renderKatex` has run over the DOM.
 * Reading a package's chapter and normalizing it directly, which is the obvious
 * implementation and was the first one written here, projects `$H(X)$` as six
 * literal characters instead. The fixture suite above passes either way.
 *
 * This one does not. Measured on `courses/***REMOVED***/chapters/p1-5.html`
 * with 20 paragraphs left alone, 6 copy-edited and 4 deleted — the second row
 * is this block run with `resolveChapter`'s `renderKatex(root)` call removed:
 *
 *     with renderKatex     20 exact ·  6 fuzzy ·  4 orphan
 *     without               1 exact ·  3 fuzzy · 26 orphan
 *
 * 17 of those 26 phantom orphans are paragraphs the update does not touch, 5
 * are the copy-edited ones, 4 are the genuinely deleted ones.
 */

// Chương THẬT, không phải fixture — và từ task 11 nó không nằm trong repo nữa.
// `readRealCourseFile` đọc trong thư mục làm việc `courses/`, và ném ra câu chỉ
// đúng lệnh phải chạy khi gói chưa được nạp về. Xem apps/web/src/test/realCourse.ts.
const REAL_HTML = readRealCourseFile('chapters/p1-5.html');
const REAL_COURSE = REAL_COURSE_ID;

function realManifest(version: string): Record<string, unknown> {
  return {
    id: REAL_COURSE,
    title: 'Lý thuyết thông tin',
    description: '',
    lang: 'vi',
    version,
    runtime: '^1',
    parts: [
      {
        title: 'Phần I',
        chapters: [{ id: 'p1-5', num: '1.5', title: 'Chương thật', short: 'Thật', file: 'chapters/p1-5.html' }],
      },
    ],
  };
}

function realPackage(version: string, html: string, pinnedAt: string): PackageRow {
  const manifest = realManifest(version);
  return {
    key: `${REAL_COURSE}@${version}`,
    courseId: REAL_COURSE,
    version,
    manifest,
    files: { 'manifest.json': encode(JSON.stringify(manifest)), 'chapters/p1-5.html': encode(html) },
    pinnedAt,
  };
}

/**
 * Which characters of `data` belong to a `$…$` or `$$…$$` span, delimiters
 * included.
 *
 * Written the long way rather than as `data.split('$')` with an even/odd rule,
 * because the short way is wrong on display maths and wrong in the direction
 * that hides a bug: `$$D_\alpha(p\Vert q)$$` splits into
 * `[before, '', 'D_\alpha…', '', after]`, so the formula BODY lands on an even
 * index and reads as prose. That is not hypothetical — it is what the first
 * version of this fixture did, and it put one of the six copy-edits inside a
 * display formula, where the projection cannot see it (see the last test in
 * this block). The suite then reported 21 exact / 5 fuzzy and looked like an
 * implementation bug for as long as it took to find the real cause.
 */
function mathMask(data: string): boolean[] {
  const mask = new Array<boolean>(data.length).fill(false);
  let i = 0;
  while (i < data.length) {
    if (data[i] !== '$') {
      i++;
      continue;
    }
    const delimiter = data[i + 1] === '$' ? '$$' : '$';
    const close = data.indexOf(delimiter, i + delimiter.length);
    const end = close < 0 ? data.length : close + delimiter.length;
    for (let k = i; k < end; k++) mask[k] = true;
    i = end;
  }
  return mask;
}

/**
 * A place in `p`'s text where a copy-edit lands in PROSE rather than in LaTeX
 * source: a run of at least 40 unmasked characters, with a word boundary well
 * inside it.
 *
 * The distinction has to be made per-CHARACTER rather than per-text-node. Only
 * ONE of p1-5's 32 long paragraphs is free of `$` altogether, so "pick a text
 * node with no maths in it" finds four candidates where six are needed; masking
 * finds 31.
 */
function proseSpot(p: Element): { node: Text; at: number } | null {
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const mask = mathMask(text.data);
    let runStart = -1;
    for (let i = 0; i <= text.data.length; i++) {
      const inRun = i < text.data.length && !mask[i];
      if (inRun && runStart < 0) runStart = i;
      if (!inRun && runStart >= 0) {
        if (i - runStart >= 40) {
          const at = text.data.indexOf(' ', runStart + 6);
          if (at > 0 && at < i - 6) return { node: text, at };
        }
        runStart = -1;
      }
    }
  }
  return null;
}

/** Paragraph indices of the real chapter, split into the three groups. */
function realTargets(): { intact: number[]; drift: number[]; gone: number[] } {
  const host = document.createElement('div');
  host.innerHTML = REAL_HTML;
  const ps = Array.from(host.querySelectorAll('p'));
  const usable = ps.map((_, i) => i).filter((i) => (ps[i].textContent ?? '').trim().length >= 120);

  const drift = usable.filter((i) => proseSpot(ps[i]) !== null).slice(-6);
  const rest = usable.filter((i) => !drift.includes(i));
  const gone = rest.slice(-4);
  const intact = rest.filter((i) => !gone.includes(i)).slice(0, 20);
  return { intact, drift, gone };
}

/** v1.1 of the real chapter: `drift` gets a copy-edit, `gone` is deleted. */
function buildRealV11(drift: readonly number[], gone: readonly number[]): { html: string; edited: number } {
  const host = document.createElement('div');
  host.innerHTML = REAL_HTML;
  const ps = Array.from(host.querySelectorAll('p'));

  let edited = 0;
  for (const i of drift) {
    const spot = proseSpot(ps[i]);
    if (!spot) continue;
    spot.node.data = `${spot.node.data.slice(0, spot.at)} thật sự${spot.node.data.slice(spot.at)}`;
    edited++;
  }
  for (const i of gone) ps[i].remove();
  return { html: host.innerHTML, edited };
}

function realNote(id: string, anchor: unknown): AnnotationRow {
  return {
    id,
    courseId: REAL_COURSE,
    chapterId: 'p1-5',
    anchor,
    note: 'x',
    createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-08-20T09:00:00.000Z',
    deletedAt: null,
  };
}

/** Anchors over the listed paragraphs of the RENDERED v1.0, as the toolbar makes them. */
function anchorParagraphs(groups: Record<string, readonly number[]>): AnnotationRow[] {
  const rendered = renderChapter(REAL_HTML);
  const map = normalizeContainer(rendered);
  const ps = Array.from(rendered.querySelectorAll('p'));

  const rows: AnnotationRow[] = [];
  for (const [group, indices] of Object.entries(groups)) {
    for (const i of indices) {
      const range = document.createRange();
      range.selectNodeContents(ps[i]);
      const anchor = selectionToAnchor(map, range, 'y');
      if (anchor) rows.push(realNote(`${group}-${i}`, anchor));
    }
  }
  return rows;
}

describe('previewUpdate — a real chapter of courses/***REMOVED***', () => {
  it('đếm đúng ba nhóm trên nội dung THẬT, với công thức đã dựng', async () => {
    const { intact, drift, gone } = realTargets();
    const built = buildRealV11(drift, gone);
    expect(built.edited).toBe(6); // the fixture itself did what it claims

    const rows = anchorParagraphs({ intact, drift, gone });
    expect(rows).toHaveLength(30);

    await db.packages.bulkPut([
      realPackage('1.0.0', REAL_HTML, '2026-08-20T08:00:00.000Z'),
      realPackage('1.1.0', built.html, '2026-08-19T08:00:00.000Z'),
    ]);
    await db.annotations.bulkPut(rows);

    const impact = await previewUpdate(REAL_COURSE, '1.0.0', '1.1.0');

    expect(impact).toMatchObject({ total: 30, exact: 20, fuzzy: 6 });
    expect(impact.orphaned.map((row) => row.id).sort()).toEqual(gone.map((i) => `gone-${i}`).sort());
    // Every orphan is caused BY this update: each one resolves fine on 1.0.0.
    expect(impact.orphaned.some((row) => row.alreadyOrphaned)).toBe(false);
  });

  it('sửa NGUỒN LaTeX bên trong một công thức không làm ghi chú xê dịch', async () => {
    // A formula is ONE stand-in character in the projection an anchor is stored
    // in, whatever its source says — so a rebuild that only rewrites LaTeX has
    // not changed the reader's quote by a single character, and the note must
    // stay exactly where it was. Stated as a test because the first real-data
    // run produced it as a surprise: an edit that was meant to drift a note
    // landed inside a `$$…$$` body and the note came back `exact`.
    const host = document.createElement('div');
    host.innerHTML = REAL_HTML;
    const target = Array.from(host.querySelectorAll('p')).findIndex(
      (p) => /\$\$?[^$]{8,}\$/.test(p.textContent ?? '') && (p.textContent ?? '').trim().length >= 120,
    );
    expect(target).toBeGreaterThanOrEqual(0);

    const edited = document.createElement('div');
    edited.innerHTML = REAL_HTML;
    const walker = document.createTreeWalker(Array.from(edited.querySelectorAll('p'))[target], NodeFilter.SHOW_TEXT);
    let touched = false;
    for (let node = walker.nextNode(); node && !touched; node = walker.nextNode()) {
      const text = node as Text;
      const match = /\$\$?([^$]{8,})\$/.exec(text.data);
      if (!match) continue;
      // Four characters INTO the formula body, well clear of both delimiters.
      const at = match.index + match[0].indexOf(match[1]) + 4;
      text.data = `${text.data.slice(0, at)}\\,${text.data.slice(at)}`;
      touched = true;
    }
    expect(touched).toBe(true);

    const rows = anchorParagraphs({ math: [target] });
    expect(rows).toHaveLength(1);

    await db.packages.bulkPut([
      realPackage('1.0.0', REAL_HTML, '2026-08-20T08:00:00.000Z'),
      realPackage('1.1.0', edited.innerHTML, '2026-08-19T08:00:00.000Z'),
    ]);
    await db.annotations.bulkPut(rows);

    await expect(previewUpdate(REAL_COURSE, '1.0.0', '1.1.0')).resolves.toMatchObject({
      total: 1,
      exact: 1,
      fuzzy: 0,
    });
  });
});

/* ------------------------------------------------------------------ *
 * 6. Ruling S1-F30 — the container a not-yet-taken version is parsed into
 * ------------------------------------------------------------------ *
 *
 * `previewUpdate` parses markup written by whoever published the version the
 * reader is only LOOKING at, and `UpdateDialog` starts it on mount — so this
 * parse happens before any consent, from a package that is allowed to carry
 * JavaScript if it declares `tier: "interactive"`. The validator cannot save
 * this case (an interactive package is ENTITLED to its handlers), so the
 * container is the whole defence.
 *
 * **What jsdom can and cannot say here.** jsdom fetches no subresources at all,
 * so "the `onerror` did not fire" would be green in jsdom no matter how this
 * file parsed — a vacuous test, and vacuous is exactly how the old, false
 * "no handler on it can ever fire" comment survived review twice. So this block
 * asserts the CAUSE instead of the symptom: the document the markup lands in
 * has no browsing context, checked in both directions so it cannot pass by
 * accident. The symptom (0 handlers and 0 requests leaving the browser, against
 * 3 and 7 for the old shape) is measured in real Chromium — see
 * `.superpowers/sdd/2026-08-21-s1-course-packages/fix-9-10-report.md`.
 */

describe('parseChapterInert — ruling S1-F30', () => {
  it('đọc đúng chính nó: container CŨ (div rời) nằm trong tài liệu CÓ browsing context', () => {
    // The two-way control. Without this row the assertion below is only
    // "some document somewhere has no window", which would stay green for an
    // instrument that had quietly stopped looking at anything.
    const old = document.createElement('div');
    old.innerHTML = '<p>x</p>';
    expect(old.ownerDocument).toBe(document);
    expect(old.ownerDocument.defaultView).not.toBeNull();
  });

  it('container MỚI nằm trong tài liệu KHÔNG có browsing context — và đó mới là thứ làm nó trơ', () => {
    const root = parseChapterInert('<p>Định nghĩa</p><img src="https://evil.example/leak" onerror="fetch(1)">');

    expect(root.ownerDocument).not.toBe(document);
    expect(root.ownerDocument.defaultView).toBeNull();

    // The markup really was parsed — a container that silently parsed nothing
    // would satisfy the line above while protecting nothing.
    expect(root.querySelectorAll('img')).toHaveLength(1);
    expect(root.querySelector('img')?.getAttribute('onerror')).toBe('fetch(1)');
    expect(root.textContent).toContain('Định nghĩa');
  });

  it('KHÔNG kéo nội dung trở lại tài liệu của trang — đó chính là cái bẫy của <template>', () => {
    // `<template>` + `appendChild` reads as the safe idiom and is not one here:
    // adopting the nodes into this document re-runs the img element's "update
    // the image data" steps, and the Chromium measurement gives that shape the
    // same 3 handlers / 7 requests as the old detached div. Anything that moves
    // these nodes back into the page's document undoes the fix, so the test
    // names the failure rather than leaving it to a comment.
    const root = parseChapterInert('<p>x</p><img src="https://evil.example/leak">');
    const nodes = Array.from(root.querySelectorAll('*'));
    expect(nodes.length).toBeGreaterThan(1);
    for (const node of nodes) expect(node.ownerDocument.defaultView).toBeNull();
  });

  it('phép chiếu KHÔNG đổi khi đi qua ranh giới tài liệu — trên chương THẬT', () => {
    // The one real cost of an inert document: `normalizeContainer` calls
    // `document.createTreeWalker` and `flatToDom` calls `document.createRange`,
    // and both now receive nodes belonging to another document. Both are
    // defined for that; this pins it as a checked property rather than tacit
    // knowledge, because the entire value of `previewUpdate` is that it
    // projects a chapter to the SAME string the reader's page projected.
    const live = renderChapter(REAL_HTML);
    const inert = parseChapterInert(REAL_HTML);
    loadCourseKit();
    window.CourseKit?.renderKatex(inert);

    const liveMap = normalizeContainer(live);
    const inertMap = normalizeContainer(inert);

    expect(inertMap.flat).toBe(liveMap.flat);
    expect(inertMap.segs.length).toBe(liveMap.segs.length);
    expect(inertMap.flat.length).toBeGreaterThan(1000); // not two empty strings

    // And an anchor made on the reader's own page still resolves inside it.
    const paragraph = live.querySelectorAll('p')[3];
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const anchor = selectionToAnchor(liveMap, range, 'y');
    expect(anchor).not.toBeNull();
    const hit = anchorToRange(inertMap, anchor as never);
    expect(hit).not.toBeNull();
    expect(hit?.range.toString()).toBe(paragraph.textContent);
  });
});

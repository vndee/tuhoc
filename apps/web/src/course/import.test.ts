/// <reference types="node" />
import { packZip, FINDING_CODES } from '@tuhoc/course-format';
import { http, HttpResponse } from 'msw';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/local';
import { describeFinding, IMPORT_FINDING_CODES, MAX_GIT_FILES, importCourse, type ImportStage } from './import';
import { loadChapter, loadManifest } from './loader';
import { t as lookup, type Translate } from '../i18n';

/**
 * `t` đã gắn tiếng Việt.
 *
 * `describeFinding`, `describeCourseError`, `describeAuthError` và
 * `importCourse` nhận ngôn ngữ bằng THAM SỐ từ Task 5 — chúng không phải
 * component và cố ý không có context nào để đọc. Bơm `t` vào từ đây là cách
 * duy nhất một bài kiểm chứng minh chúng dùng cái được truyền vào.
 */
const t: Translate = (key, ...args) => lookup('vi', key, ...args);


/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const COURSE_ID = 'bat-bien-vong-lap';

const encode = (text: string) => new TextEncoder().encode(text);

/**
 * A manifest shaped like `fixtures/courses/bat-bien-vong-lap/manifest.json`,
 * which is the package `tools/tuhoc-cli` actually emits — not a hand-made
 * imitation of what one might look like. Every field
 * `packages/course-format`'s `checkManifestFields` requires is present, so a
 * test that fails here fails for the reason it names rather than for a
 * missing `license`.
 */
function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: COURSE_ID,
    title: 'Bất biến vòng lặp',
    description: 'Ba chương về cách chứng minh một vòng lặp đúng cho MỌI đầu vào.',
    lang: 'vi',
    version: '1.0.0',
    runtime: '^1',
    tier: 'content',
    license: 'CC-BY-4.0',
    authors: [{ name: 'tuhoc course-authoring skill' }],
    generatedBy: 'ai',
    parts: [
      {
        title: 'Phần I · Từ chạy thử đến chứng minh',
        chapters: [
          { id: 'c1', num: '1.1', title: 'Vì sao chạy thử không kết luận được', short: 'Vì sao', file: 'chapters/c1.html' },
        ],
      },
    ],
    ...overrides,
  };
}

const CHAPTER_HTML = '<h1 class="ch-title">Vì sao chạy thử không kết luận được</h1><p>Một vòng lặp…</p>';

/** The package files, keyed the way `unpackZip` keys them. */
function packageFiles(
  manifestValue: Record<string, unknown> = manifest(),
  chapterHtml = CHAPTER_HTML,
): Map<string, Uint8Array> {
  return new Map([
    ['manifest.json', encode(JSON.stringify(manifestValue, null, 2))],
    ['chapters/c1.html', encode(chapterHtml)],
  ]);
}

function validZip(): Uint8Array {
  return packZip(packageFiles());
}

function zipFile(bytes: Uint8Array, name = 'khoa-hoc.zip'): File {
  // `Uint8Array` is a valid BlobPart; the cast keeps TS's DOM lib happy about
  // the ArrayBufferLike generic without copying the bytes.
  return new File([bytes as BlobPart], name, { type: 'application/zip' });
}

/** The brief's own name for it: a package whose chapter carries a `<script>`. */
function fileWithScriptTag(): File {
  return zipFile(
    packZip(packageFiles(manifest(), '<h1>Chương một</h1><script>fetch("/tien-cua-ban")</script>')),
  );
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

beforeEach(() => db.packages.clear());

/* ====================================================================== *
 * The three cases the task brief names, verbatim
 * ====================================================================== */

it('import gói hợp lệ từ tệp → vào thư viện, đọc được ngay', async () => {
  const r = await importCourse({ kind: 'file', file: zipFile(validZip()) }, { t });

  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.courseId).toBe(COURSE_ID);
  expect(r.version).toBe('1.0.0');

  // "đọc được ngay" is the whole claim: the reader's own two entry points
  // answer from the row this just wrote, with the network untouched. No msw
  // handler is registered here and the server runs with
  // `onUnhandledRequest: 'error'`, so a stray request would fail loudly; the
  // spy says the thing out loud anyway.
  const fetchSpy = vi.spyOn(globalThis, 'fetch');
  await expect(loadManifest(COURSE_ID)).resolves.toMatchObject({ title: 'Bất biến vòng lặp' });
  await expect(loadChapter(COURSE_ID, 'chapters/c1.html')).resolves.toContain('Một vòng lặp');
  expect(fetchSpy).not.toHaveBeenCalled();
});

it('import gói KHÔNG hợp lệ → KHÔNG ghi gì vào Dexie và trả về mọi finding', async () => {
  const before = await db.packages.count();
  const r = await importCourse({ kind: 'file', file: fileWithScriptTag() }, { t });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.findings.map((f) => f.code)).toContain('SCRIPT_TAG');
  expect(await db.packages.count()).toBe(before); // không ghi một phần
});

it('URL git riêng tư → thông báo GIẢI THÍCH ĐƯỢC, không phải lỗi 404 trần trụi', async () => {
  // GitHub answers 404 for a private repo AND for one that does not exist —
  // it refuses to confirm a private repo's existence to an anonymous caller.
  // Measured against the real endpoint, not assumed. This handler reproduces
  // exactly that.
  server.use(
    http.get('https://api.github.com/repos/ai-do/repo-rieng-tu/git/trees/HEAD', () =>
      HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
    ),
  );

  const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/repo-rieng-tu' }, { t });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.findings[0].detail).toMatch(/công khai|tải \.zip/i);
});

/* ====================================================================== *
 * Nothing is written unless everything passed
 * ====================================================================== */

describe('một lần ghi, hoặc không lần nào', () => {
  it('trả về MỌI finding cùng lúc, không phải cái đầu tiên', async () => {
    // Three independent problems in one package. A validator that stopped at
    // the first would send the author back for three more rebuilds.
    const broken = packZip(
      new Map([
        ['manifest.json', encode(JSON.stringify(manifest({ version: 'khong-phai-semver' })))],
        ['chapters/c1.html', encode('<h1>a</h1><script>x()</script>')],
        ['viz.js', encode('console.log(1)')],
      ]),
    );

    const r = await importCourse({ kind: 'file', file: zipFile(broken) }, { t });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const codes = r.findings.map((f) => f.code);
    expect(codes).toContain('SEMVER');
    expect(codes).toContain('SCRIPT_TAG');
    expect(codes).toContain('JS_FILE_IN_PACKAGE');
  });

  it('không ghi gì khi việc TẢI hỏng, không chỉ khi việc KIỂM hỏng', async () => {
    server.use(http.get('https://vi-du.test/goi.zip', () => new HttpResponse(null, { status: 500 })));

    const before = await db.packages.count();
    const r = await importCourse({ kind: 'zipUrl', url: 'https://vi-du.test/goi.zip' }, { t });
    expect(r.ok).toBe(false);
    expect(await db.packages.count()).toBe(before);
  });

  it('ghi ĐÚNG MỘT dòng cho một gói, và dòng đó mang đủ tệp của gói', async () => {
    await importCourse({ kind: 'file', file: zipFile(validZip()) }, { t });

    expect(await db.packages.count()).toBe(1);
    const row = await db.packages.get(`${COURSE_ID}@1.0.0`);
    expect(row).toBeDefined();
    expect(Object.keys(row!.files).sort()).toEqual(['chapters/c1.html', 'manifest.json']);
    expect(row!.courseId).toBe(COURSE_ID);
    expect(row!.version).toBe('1.0.0');
    expect(Date.parse(row!.pinnedAt)).not.toBeNaN();
  });
});

/* ====================================================================== *
 * The waiting state
 * ====================================================================== */

describe('onStage', () => {
  it('kể đủ bốn chặng, đúng thứ tự', async () => {
    const seen: ImportStage[] = [];
    await importCourse({ kind: 'file', file: zipFile(validZip()) }, { t, onStage: (s) => seen.push(s) });

    expect(seen).toEqual(['fetching', 'unpacking', 'checking', 'saving']);
  });

  it('nhường một LƯỢT THẬT của vòng lặp sự kiện sau mỗi chặng, không chỉ một microtask', async () => {
    // A resolved promise's continuation runs inside the SAME task, so
    // `await Promise.resolve()` would satisfy an `await` and give the browser
    // no chance to draw. The proof that this is a macrotask boundary: a
    // `setTimeout(…, 0)` queued from inside the callback runs BEFORE the
    // import gets to its next phase. jsdom can check the ordering; only a
    // real browser can check that a paint follows — see task-8-report.md.
    const order: string[] = [];
    await importCourse(
      { kind: 'file', file: zipFile(validZip()) },
      {
        t,
        onStage: (s) => {
          order.push(`stage:${s}`);
          if (s === 'checking') setTimeout(() => order.push('macrotask-after-checking'), 0);
        },
      },
    );

    expect(order.indexOf('macrotask-after-checking')).toBeGreaterThan(-1);
    expect(order.indexOf('macrotask-after-checking')).toBeLessThan(order.indexOf('stage:saving'));
  });
});

/* ====================================================================== *
 * Archives produced by tools that are not this repo's CLI
 * ====================================================================== */

/**
 * Every case below was MEASURED against a real archive from a real tool
 * before it was written down here — see task-8-report.md's table. These
 * tests exist so the measurement does not have to be repeated by hand the
 * next time `unpackZip` or this importer changes.
 */
describe('gói do công cụ khác đóng', () => {
  it('nhận gói mà mọi tệp nằm dưới MỘT thư mục gốc (zipball của GitHub, "Compress" của Finder)', async () => {
    // `ditto -c -k --keepParent` (what Finder's "Compress" runs) and every
    // GitHub zipball put the whole tree under one directory. Measured: the
    // fixture package zipped that way fails `MANIFEST_MISSING` without this
    // rule, which is a message about the wrong thing entirely.
    const nested = new Map<string, Uint8Array>();
    for (const [name, bytes] of packageFiles()) nested.set(`${COURSE_ID}-main/${name}`, bytes);
    // Finder also parks AppleDouble sidecars in a SECOND top level directory,
    // so "there is exactly one top-level entry" is not the rule that works.
    nested.set('__MACOSX/bat-bien-vong-lap-main/._manifest.json', new Uint8Array([0x00, 0x05, 0x16, 0x07]));

    const r = await importCourse({ kind: 'file', file: zipFile(packZip(nested)) }, { t });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.courseId).toBe(COURSE_ID);

    const row = await db.packages.get(`${COURSE_ID}@1.0.0`);
    // Re-rooted, and the sidecar directory did not come along.
    expect(Object.keys(row!.files).sort()).toEqual(['chapters/c1.html', 'manifest.json']);
  });

  it('NÓI RA rằng gói nằm trong một thư mục con, và bao nhiêu tệp bị bỏ lại', async () => {
    // Ruling: re-rooting stays at the import layer "nhưng phải HIỆN RA cho
    // người dùng… không được im lặng". Measured in review on a real browser
    // with a real Finder-Compress archive: the whole page said "Đã nhập
    // bat-bien-vong-lap phiên bản 1.0.0" and not one word about the folder it
    // had been unwrapped from or the four files it had thrown away —
    // `ImportResult` had nowhere to put either.
    const nested = new Map<string, Uint8Array>();
    for (const [name, bytes] of packageFiles()) nested.set(`${COURSE_ID}/${name}`, bytes);
    nested.set('__MACOSX/bat-bien-vong-lap/._manifest.json', new Uint8Array([0x00, 0x05, 0x16, 0x07]));
    nested.set('__MACOSX/bat-bien-vong-lap/._c1.html', new Uint8Array([0x00, 0x05, 0x16, 0x07]));

    const r = await importCourse({ kind: 'file', file: zipFile(packZip(nested)) }, { t });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rerootedFrom).toBe(COURSE_ID);
    expect(r.droppedFiles).toBe(2);
  });

  it('không nói gì khi KHÔNG có gì để nói — gói đã ở gốc kho', async () => {
    // The complement. A note that appears on every import is a note nobody
    // reads, and "we moved your package" is a lie when nothing was moved.
    const r = await importCourse({ kind: 'file', file: zipFile(validZip()) }, { t });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rerootedFrom).toBeUndefined();
    expect(r.droppedFiles).toBeUndefined();
  });

  it('tìm được gói LỒNG HAI TẦNG (repo giữ khoá học trong thư mục con, rồi tải zipball)', async () => {
    // `repo-main/khoa/manifest.json`. Measured in review as `MANIFEST_MISSING`
    // — "Gói thiếu manifest.json ở thư mục gốc" — which is a true sentence
    // about entirely the wrong thing: the package HAS a manifest, two levels
    // down. A repo that keeps its course in a subdirectory and gets zipballed
    // is exactly this shape.
    const nested = new Map<string, Uint8Array>();
    for (const [name, bytes] of packageFiles()) nested.set(`repo-main/khoa/${name}`, bytes);

    const r = await importCourse({ kind: 'file', file: zipFile(packZip(nested)) }, { t });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rerootedFrom).toBe('repo-main/khoa');
  });

  it('dừng tìm ở một độ sâu có lý do, thay vì lục cả kho', async () => {
    // Four levels. The bound is not squeamishness: each level of the search
    // is a level of "this archive is not shaped like a package and we are
    // guessing", and the deeper it goes the more likely the thing it finds is
    // a sample, a fixture, or a vendored copy rather than the course. Three
    // is what the real world produces — a zipball prefix, plus a Finder
    // wrapper, plus one subdirectory — so four is where guessing stops and
    // `MANIFEST_MISSING` gets to say what it means.
    const deep = new Map<string, Uint8Array>();
    for (const [name, bytes] of packageFiles()) deep.set(`a/b/c/d/${name}`, bytes);

    const r = await importCourse({ kind: 'file', file: zipFile(packZip(deep)) }, { t });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.code)).toContain('MANIFEST_MISSING');
  });

  it('gốc NÔNG NHẤT thắng — một gói mang theo khoá học mẫu vẫn nhập được', async () => {
    // `repo-main/manifest.json` plus `repo-main/vi-du/manifest.json`. Both
    // are candidates once the search goes deeper than one level, and calling
    // that ambiguous would break a perfectly ordinary layout. The shallower
    // one is the package; anything below it is content.
    const withSample = new Map<string, Uint8Array>();
    for (const [name, bytes] of packageFiles()) {
      withSample.set(`repo-main/${name}`, bytes);
      withSample.set(`repo-main/vi-du/${name}`, bytes);
    }

    const r = await importCourse({ kind: 'file', file: zipFile(packZip(withSample)) }, { t });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rerootedFrom).toBe('repo-main');
  });

  it('KHÔNG nhận một thư mục ẩn làm gốc gói — đường zip và đường git phải cùng một luật', async () => {
    // `.pkg/manifest.json` imported successfully before this: the repo path
    // filters every dot-prefixed segment (`isHidden`, same rule as
    // `tuhoc pack`) and the archive path did not, so the two doors disagreed
    // about what a package even is. A course does not live in a hidden
    // directory; `.git/`, `.github/` and `.vscode/` do.
    const hidden = new Map<string, Uint8Array>();
    for (const [name, bytes] of packageFiles()) hidden.set(`.pkg/${name}`, bytes);

    const r = await importCourse({ kind: 'file', file: zipFile(packZip(hidden)) }, { t });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.code)).toContain('MANIFEST_MISSING');
    expect(await db.packages.count()).toBe(0);
  });

  it('`__MACOSX/manifest.json` không biến một gói hợp lệ thành gói nhập nhằng', async () => {
    // Finder parks AppleDouble sidecars under `__MACOSX/`, mirroring the
    // package's own tree — so a package whose root holds `manifest.json` gets
    // a `__MACOSX/manifest.json` beside it. That is metadata, never a course,
    // and counting it as a second candidate turned a valid archive into
    // `PACKAGE_ROOT_AMBIGUOUS ("2 khóa học (__MACOSX, khoa)")`.
    const finder = new Map<string, Uint8Array>();
    for (const [name, bytes] of packageFiles()) finder.set(`khoa/${name}`, bytes);
    finder.set('__MACOSX/manifest.json', new Uint8Array([0x00, 0x05, 0x16, 0x07]));

    const r = await importCourse({ kind: 'file', file: zipFile(packZip(finder)) }, { t });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rerootedFrom).toBe('khoa');
  });

  it('từ chối — chứ không đoán — khi HAI thư mục đều có manifest.json', async () => {
    const two = new Map<string, Uint8Array>();
    for (const [name, bytes] of packageFiles()) {
      two.set(`khoa-a/${name}`, bytes);
      two.set(`khoa-b/${name}`, bytes);
    }

    const r = await importCourse({ kind: 'file', file: zipFile(packZip(two)) }, { t });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.code)).toContain('PACKAGE_ROOT_AMBIGUOUS');
    expect(describeFinding(r.findings[0], t)).toMatch(/khoa-a|khoa-b|hai|nhiều/i);
  });

  it('kho `zip -r -fz` THẬT nhập được — đo lại tại HEAD, không phải nhớ lại từ nhánh cũ', async () => {
    // `apps/web/fixtures/zip64-forced-package.zip`, sinh bằng:
    //   cd fixtures/courses/bat-bien-vong-lap
    //   zip -r -fz -X ../../../apps/web/fixtures/zip64-forced-package.zip . -x '.*'
    //
    // Task 8 measured this archive as REFUSED and wrote a `ZIP64_UNSUPPORTED`
    // message around that measurement. The measurement was honest and is now
    // wrong: `0273c88` (Task 2's zip64 fix) is NOT an ancestor of the commit
    // Task 8 was built on — the two met at the merge — so at HEAD
    // `centralDirectoryNames` reads the zip64 record and this archive opens.
    // A test that keeps saying otherwise is a test pinning a fiction.
    const zip = fixture('zip64-forced-package.zip');
    // The fixture has to actually BE the shape being claimed, or this passes
    // for the wrong reason: the footer's index offset is the 0xFFFFFFFF
    // sentinel, i.e. "the real offset is in the zip64 record".
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint32(zip.length - 22 + 16, true)).toBe(0xffffffff);

    const r = await importCourse({ kind: 'file', file: zipFile(zip) }, { t });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.courseId).toBe(COURSE_ID);
  });

  it('kho zip64 tuhoc THẬT SỰ chưa đọc được vẫn được giải thích bằng chữ "zip64"', async () => {
    // Which archives are those, now that `zip -fz` opens? The ones whose
    // zip64 record says something `unpackZip` refuses to guess at: over
    // 65,535 entries (the entry count becomes the 0xFFFF sentinel), an index
    // starting past 4 GiB, or a v2 record with an extensible data sector.
    //
    // This is the first of those, and every byte except two comes from the
    // real Info-ZIP archive above — patching the count is how an archive with
    // 65,536 entries looks at the exact place the decision is made, without
    // committing an archive with 65,536 entries.
    const zip = fixture('zip64-forced-package.zip');
    new DataView(zip.buffer, zip.byteOffset, zip.byteLength).setUint16(zip.length - 22 + 10, 0xffff, true);

    const r = await importCourse({ kind: 'file', file: zipFile(zip) }, { t });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.code)).toContain('ZIP64_UNSUPPORTED');
    expect(r.findings[0].detail).toMatch(/zip64/i);
    // And it must NOT still be telling people to stop using `-fz`: that was
    // true when it was written and is now advice about the wrong thing.
    expect(r.findings[0].detail).not.toMatch(/-fz|force-zip64/);
    expect(await db.packages.count()).toBe(0);
  });

  it('kho chứa TỆP NÉN LỒNG NHAU: nói đúng chuyện, và không trích một đường dẫn KHÔNG CÓ trong gói', async () => {
    // `apps/web/fixtures/nested-archive.zip` — see `nested-archive.py` next to
    // it for exactly how it is written and why both of its properties are
    // ordinary. It passes `unzip -t` and `python -m zipfile --test`.
    //
    // Ruling S1-F26 kept the byte-counting fence but required the message to
    // say "gói chứa tệp nén lồng nhau" rather than a bare MALFORMED. What was
    // measured in review instead was WORSE than a bare code, twice over: the
    // sentence said the file "is not a readable .zip", which is false and
    // sends the reader off to re-download it forever; and it quoted
    // `[Content_Types].xml`, a path that exists only INSIDE their Word
    // document and nowhere in their package, so they go hunting for a file
    // that is not there.
    const r = await importCourse({ kind: 'file', file: zipFile(fixture('nested-archive.zip')) }, { t });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.code)).toContain('ARCHIVE_INDEX_MISMATCH');

    const shown = describeFinding(r.findings[0], t);
    expect(shown).toMatch(/tệp nén lồng nhau/i);
    expect(shown).not.toMatch(/không phải là một tệp \.zip/i);
    expect(shown).not.toContain('[Content_Types].xml');
    expect(await db.packages.count()).toBe(0);
  });

  it('nói "đây không phải tệp .zip" cho một tệp không phải zip, không ném UnsafeArchiveError ra ngoài', async () => {
    const r = await importCourse({ kind: 'file', file: zipFile(encode('%PDF-1.7 …'), 'khoa-hoc.pdf') }, { t });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.code)).toContain('NOT_A_ZIP');
    expect(describeFinding(r.findings[0], t)).toMatch(/\.zip/i);
  });
});

/* ====================================================================== *
 * From a URL
 * ====================================================================== */

describe('nhập từ URL', () => {
  it('tải và nhập một .zip qua HTTP', async () => {
    server.use(
      http.get('https://vi-du.test/goi.zip', () => new HttpResponse(validZip() as BlobPart)),
    );

    const r = await importCourse({ kind: 'zipUrl', url: 'https://vi-du.test/goi.zip' }, { t });
    expect(r.ok).toBe(true);
    expect(await db.packages.count()).toBe(1);
  });

  it('nói rõ mã HTTP khi máy chủ từ chối', async () => {
    server.use(http.get('https://vi-du.test/goi.zip', () => new HttpResponse(null, { status: 404 })));

    const r = await importCourse({ kind: 'zipUrl', url: 'https://vi-du.test/goi.zip' }, { t });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('HTTP_ERROR');
    expect(r.findings[0].detail).toContain('404');
  });

  it('nhắc tới CORS khi fetch tự nó hỏng — đó là lý do thường gặp nhất, và trình duyệt không nói ra', async () => {
    server.use(http.get('https://vi-du.test/goi.zip', () => HttpResponse.error()));

    const r = await importCourse({ kind: 'zipUrl', url: 'https://vi-du.test/goi.zip' }, { t });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('FETCH_FAILED');
    expect(r.findings[0].detail).toMatch(/CORS|mạng/i);
  });

  it('từ chối một URL không phải http(s) thay vì đưa nó cho fetch', async () => {
    const r = await importCourse({ kind: 'zipUrl', url: 'javascript:alert(1)' }, { t });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('BAD_URL');
  });
});

/* ====================================================================== *
 * The connection dies AFTER the headers — the commonest network failure
 * there is, and the one that produced a blank screen
 * ====================================================================== */

/**
 * Every one of these drives a failure that happens **after** an `await` has
 * already succeeded, which is the shape the first version of this module got
 * wrong: `fetch()` was inside a `try` and `res.arrayBuffer()` was not, so a
 * body that stopped arriving rejected out of `importCourse` entirely. In a
 * real browser that reached the page as an `unhandledrejection` and drew
 * nothing at all — no error, no explanation, the button simply enabled itself
 * again. Measured in review against a server that answered `HTTP/1.1 200` with
 * a correct `Content-Length` and then `RST` the connection at 200 000 bytes
 * (`curl` agrees: `size_download=200000`, exit 56).
 *
 * The claim each test makes is the module's own documented contract — it
 * RESOLVES, it does not throw — so each one asserts a finding rather than
 * merely "no crash": a rejected promise fails these, and so does an empty
 * `findings` list.
 */
describe('kết nối chết giữa chừng — không ca nào được ném ra ngoài', () => {
  it('thân phản hồi bị cắt giữa chừng (tải dở 20 MB trên 4G)', async () => {
    server.use(http.get('https://vi-du.test/goi.zip', () => new HttpResponse(cutOffBody())));

    const r = await importCourse({ kind: 'zipUrl', url: 'https://vi-du.test/goi.zip' }, { t });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('FETCH_FAILED');
    expect(describeFinding(r.findings[0], t).length).toBeGreaterThan(20);
    expect(await db.packages.count()).toBe(0);
  });

  it('blob của repo bị cắt giữa chừng, không chỉ tệp .zip đơn lẻ', async () => {
    const manifestJson = JSON.stringify(manifest(), null, 2);
    server.use(
      http.get('https://api.github.com/repos/ai-do/khoa-hoc/git/trees/HEAD', () =>
        HttpResponse.json({
          sha: 'HEAD',
          truncated: false,
          tree: [{ path: 'manifest.json', type: 'blob', mode: '100644', size: manifestJson.length }],
        }),
      ),
      http.get('https://raw.githubusercontent.com/ai-do/khoa-hoc/HEAD/manifest.json', () =>
        new HttpResponse(cutOffBody()),
      ),
    );

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' }, { t });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('FETCH_FAILED');
  });

  it('cổng đăng nhập Wi-Fi trả HTML ở chỗ đợi JSON — `res.json()` hỏng', async () => {
    // A captive portal answers 200 with its own login page for every request,
    // `content-type` and all. `res.json()` on that rejects with a SyntaxError,
    // and that rejection used to leave the page blank the same way.
    server.use(
      http.get('https://api.github.com/repos/ai-do/khoa-hoc/git/trees/HEAD', () =>
        new HttpResponse('<html><body>Đăng nhập Wi-Fi khách sạn</body></html>', {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' }, { t });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('GIT_BAD_RESPONSE');
    expect(describeFinding(r.findings[0], t)).toMatch(/wi-?fi|đăng nhập|không đọc được/i);
  });

  it('tệp trên máy không đọc được nữa (rút USB, tệp bị sửa sau khi chọn)', async () => {
    const file = zipFile(validZip());
    // What Chromium actually throws when the bytes behind a picked File are
    // gone by the time they are asked for.
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.reject(new DOMException('The requested file could not be read', 'NotReadableError')),
    });

    const r = await importCourse({ kind: 'file', file }, { t });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('FILE_READ_FAILED');
    expect(describeFinding(r.findings[0], t)).toMatch(/không đọc được/i);
  });

  it('kể cả khi `onStage` của NGƯỜI GỌI tự ném — trang gọi nó trong flushSync, và một render hỏng ném ở đúng đó', async () => {
    // The last net. `flushSync(() => setStage(next))` runs React's render
    // synchronously inside this module's `await`, so a component that throws
    // throws HERE. Without the net that is once again an unhandled rejection
    // and once again a blank screen.
    const r = await importCourse(
      { kind: 'file', file: zipFile(validZip()) },
      {
        t,
        onStage: () => {
          throw new Error('render hỏng trong flushSync');
        },
      },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('UNEXPECTED');
    expect(describeFinding(r.findings[0], t)).toMatch(/render hỏng trong flushSync/);
  });
});

/* ====================================================================== *
 * From a public git repo
 * ====================================================================== */

describe('nhập từ repo GitHub công khai', () => {
  const TREE = 'https://api.github.com/repos/ai-do/khoa-hoc/git/trees/HEAD';
  const RAW = 'https://raw.githubusercontent.com/ai-do/khoa-hoc/HEAD';

  function serveRepo(
    tree: { path: string; type: string; mode: string; size?: number }[],
    blobs: Record<string, string>,
  ) {
    server.use(
      http.get(TREE, () => HttpResponse.json({ sha: 'x', truncated: false, tree })),
      ...Object.entries(blobs).map(([path, body]) =>
        http.get(`${RAW}/${path}`, () => new HttpResponse(encode(body) as BlobPart)),
      ),
    );
  }

  it('đọc cây của repo MỘT lần rồi tải từng blob — không cần token', async () => {
    const manifestJson = JSON.stringify(manifest(), null, 2);
    serveRepo(
      [
        { path: 'manifest.json', type: 'blob', mode: '100644', size: manifestJson.length },
        { path: 'chapters', type: 'tree', mode: '040000' },
        { path: 'chapters/c1.html', type: 'blob', mode: '100644', size: CHAPTER_HTML.length },
      ],
      { 'manifest.json': manifestJson, 'chapters/c1.html': CHAPTER_HTML },
    );

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' }, { t });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.courseId).toBe(COURSE_ID);
    expect(await db.packages.count()).toBe(1);
  });

  it('bỏ qua mục ẩn (.github/, .gitignore) như `tuhoc pack` bỏ qua chúng', async () => {
    // The CLI's own directory walk skips every dot-prefixed entry at any
    // depth, and says how many (tools/tuhoc-cli/src/readdir.ts). A repo import
    // reads a directory tree too, so it follows the same rule — otherwise a
    // perfectly ordinary course repo fails on its own `.github/workflows`.
    const manifestJson = JSON.stringify(manifest(), null, 2);
    serveRepo(
      [
        { path: '.github/workflows/ci.yml', type: 'blob', mode: '100644', size: 10 },
        { path: '.gitignore', type: 'blob', mode: '100644', size: 5 },
        { path: 'manifest.json', type: 'blob', mode: '100644', size: manifestJson.length },
        { path: 'chapters/c1.html', type: 'blob', mode: '100644', size: CHAPTER_HTML.length },
      ],
      { 'manifest.json': manifestJson, 'chapters/c1.html': CHAPTER_HTML },
    );

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' }, { t });
    expect(r.ok).toBe(true);
    const row = await db.packages.get(`${COURSE_ID}@1.0.0`);
    expect(Object.keys(row!.files).sort()).toEqual(['chapters/c1.html', 'manifest.json']);
  });

  it('áp trần dung lượng TRƯỚC khi tải, từ kích thước cây khai báo', async () => {
    // `validatePackage`'s own comment names this debt: the caller owes it a
    // byte budget applied BEFORE the bytes arrive. Here that is free — the
    // tree API states every blob's size.
    serveRepo(
      [{ path: 'manifest.json', type: 'blob', mode: '100644', size: 40 * 1024 * 1024 }],
      {},
    );

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' }, { t });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.code)).toContain('TOO_LARGE');
  });

  it('từ chối symlink trong repo, giống UnpackableEntryError của CLI', async () => {
    const manifestJson = JSON.stringify(manifest(), null, 2);
    serveRepo(
      [
        { path: 'manifest.json', type: 'blob', mode: '100644', size: manifestJson.length },
        { path: 'chapters/c1.html', type: 'blob', mode: '120000', size: 12 },
      ],
      { 'manifest.json': manifestJson },
    );

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' }, { t });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.code)).toContain('UNPACKABLE_ENTRY');
  });

  it('nói rõ khi cây bị cắt bớt, thay vì nhập nửa repo', async () => {
    server.use(http.get(TREE, () => HttpResponse.json({ sha: 'x', truncated: true, tree: [] })));

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' }, { t });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.code)).toContain('GIT_TREE_TRUNCATED');
  });

  it('phân biệt hết hạn mức API với repo không mở được', async () => {
    server.use(
      http.get(TREE, () =>
        HttpResponse.json({ message: 'API rate limit exceeded' }, { status: 403 }),
      ),
    );

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' }, { t });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('GIT_RATE_LIMITED');
  });

  it('nhận URL có nhánh (/tree/<nhánh>) và URL kết thúc bằng .git', async () => {
    const manifestJson = JSON.stringify(manifest(), null, 2);
    server.use(
      http.get('https://api.github.com/repos/ai-do/khoa-hoc/git/trees/v2', () =>
        HttpResponse.json({
          sha: 'x',
          truncated: false,
          tree: [
            { path: 'manifest.json', type: 'blob', mode: '100644', size: manifestJson.length },
            { path: 'chapters/c1.html', type: 'blob', mode: '100644', size: CHAPTER_HTML.length },
          ],
        }),
      ),
      http.get('https://raw.githubusercontent.com/ai-do/khoa-hoc/v2/manifest.json', () =>
        new HttpResponse(encode(manifestJson) as BlobPart),
      ),
      http.get('https://raw.githubusercontent.com/ai-do/khoa-hoc/v2/chapters/c1.html', () =>
        new HttpResponse(encode(CHAPTER_HTML) as BlobPart),
      ),
    );

    await expect(
      importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc/tree/v2' }, { t }),
    ).resolves.toMatchObject({ ok: true });
    expect(await db.packages.count()).toBe(1);
  });

  it('từ chối SUBMODULE thật sự — không bỏ nó đi im lặng rồi nhập nửa gói', async () => {
    // A submodule appears in `git/trees` with `type: "commit"`, and the old
    // filter kept only `type === 'blob'` BEFORE testing the mode — so the
    // `160000` check below it could never run and the whole rejection was
    // dead code. Measured on `WebAssembly/wabt` (7 submodules declared in
    // `.gitmodules`): `byType { blob: 1877, commit: 7, tree: 82 }`, and the
    // import answered `GIT_TOO_MANY_FILES`, not `UNPACKABLE_ENTRY`.
    //
    // Why it matters is this test's own shape: the package below VALIDATES.
    // `validatePackage` only checks chapter files the manifest names, not
    // assets, so a course keeping its images in a submodule imported
    // successfully with the images silently missing — "a course that opens,
    // lists forty chapters, and 404s on chapter nine forever", which this
    // module's own header promises to rule out.
    const manifestJson = JSON.stringify(manifest(), null, 2);
    serveRepo(
      [
        { path: 'manifest.json', type: 'blob', mode: '100644', size: manifestJson.length },
        { path: 'chapters/c1.html', type: 'blob', mode: '100644', size: CHAPTER_HTML.length },
        { path: 'assets', type: 'commit', mode: '160000' },
      ],
      { 'manifest.json': manifestJson, 'chapters/c1.html': CHAPTER_HTML },
    );

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' }, { t });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.code)).toContain('UNPACKABLE_ENTRY');
    expect(r.findings[0].path).toBe('assets');
    expect(await db.packages.count()).toBe(0);
  });

  it('`UNPACKABLE_ENTRY` nêu lối đi thay thế — nó bắn trên repo của người khác, mà người đọc không sửa được', async () => {
    // Measured on the real public `github/gitignore`: three symlinks, so a
    // reader who pastes that link gets this finding about a repo they do not
    // own and cannot change. `GIT_TOO_MANY_FILES` and `GIT_TREE_TRUNCATED`
    // both name the way out; this one did not.
    const manifestJson = JSON.stringify(manifest(), null, 2);
    serveRepo(
      [
        { path: 'manifest.json', type: 'blob', mode: '100644', size: manifestJson.length },
        { path: 'chapters/c1.html', type: 'blob', mode: '120000', size: 12 },
      ],
      { 'manifest.json': manifestJson },
    );

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' }, { t });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(describeFinding(r.findings[0], t)).toMatch(/\.zip/i);
  });

  it('URL thư mục con của GitHub (nút "copy link" khi đang xem một thư mục) nhập được', async () => {
    // Measured in review against the real public repo `github/gitignore`:
    //   https://github.com/github/gitignore/tree/main/Global
    //   → { ref: "main/Global" } → git/trees/main%2FGlobal → 404
    //   → "Không mở được repo này. tuhoc chỉ nhập được từ repo Git CÔNG KHAI…"
    // A public repo, told it is private. And the layout it describes — the
    // course living in a subdirectory — could not be imported by the repo
    // route at all.
    const manifestJson = JSON.stringify(manifest(), null, 2);
    server.use(
      // The whole ref, tried first, is not a branch.
      http.get('https://api.github.com/repos/ai-do/kho/git/trees/main%2Fkhoa', () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
      http.get('https://api.github.com/repos/ai-do/kho/git/trees/main', () =>
        HttpResponse.json({
          sha: 'x',
          truncated: false,
          tree: [
            { path: 'README.md', type: 'blob', mode: '100644', size: 9 },
            { path: 'khoa/manifest.json', type: 'blob', mode: '100644', size: manifestJson.length },
            { path: 'khoa/chapters/c1.html', type: 'blob', mode: '100644', size: CHAPTER_HTML.length },
          ],
        }),
      ),
      http.get('https://raw.githubusercontent.com/ai-do/kho/main/khoa/manifest.json', () =>
        new HttpResponse(encode(manifestJson) as BlobPart),
      ),
      http.get('https://raw.githubusercontent.com/ai-do/kho/main/khoa/chapters/c1.html', () =>
        new HttpResponse(encode(CHAPTER_HTML) as BlobPart),
      ),
    );

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/kho/tree/main/khoa' }, { t });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.courseId).toBe(COURSE_ID);
    // Said out loud, like every other re-rooting: `README.md` did not come
    // along, and the reader is told which folder was used.
    expect(r.rerootedFrom).toBe('khoa');
    const row = await db.packages.get(`${COURSE_ID}@1.0.0`);
    expect(Object.keys(row!.files).sort()).toEqual(['chapters/c1.html', 'manifest.json']);
  });

  it('nhánh có dấu `/` trong tên vẫn được thử TRƯỚC — không đánh đổi ca cũ lấy ca mới', async () => {
    // `release/2026` is one branch, not a branch plus a folder, and GitHub's
    // URL cannot tell the two apart. Trying the whole thing first means a
    // repo that works today still works, and the split is only ever a
    // FALLBACK after a 404. The counter is the assertion: one API call.
    const manifestJson = JSON.stringify(manifest(), null, 2);
    let treeCalls = 0;
    server.use(
      http.get('https://api.github.com/repos/ai-do/kho/git/trees/release%2F2026', () => {
        treeCalls += 1;
        return HttpResponse.json({
          sha: 'x',
          truncated: false,
          tree: [
            { path: 'manifest.json', type: 'blob', mode: '100644', size: manifestJson.length },
            { path: 'chapters/c1.html', type: 'blob', mode: '100644', size: CHAPTER_HTML.length },
          ],
        });
      }),
      http.get('https://raw.githubusercontent.com/ai-do/kho/release/2026/manifest.json', () =>
        new HttpResponse(encode(manifestJson) as BlobPart),
      ),
      http.get('https://raw.githubusercontent.com/ai-do/kho/release/2026/chapters/c1.html', () =>
        new HttpResponse(encode(CHAPTER_HTML) as BlobPart),
      ),
    );

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/kho/tree/release/2026' }, { t });

    expect(r.ok).toBe(true);
    expect(treeCalls).toBe(1);
  });

  it('thư mục con KHÔNG TỒN TẠI được nói đúng tên, chứ không bị gọi là "repo riêng tư"', async () => {
    server.use(
      http.get('https://api.github.com/repos/ai-do/kho/git/trees/main%2Fkhong-co', () =>
        HttpResponse.json({ message: 'Not Found' }, { status: 404 }),
      ),
      http.get('https://api.github.com/repos/ai-do/kho/git/trees/main', () =>
        HttpResponse.json({
          sha: 'x',
          truncated: false,
          tree: [{ path: 'README.md', type: 'blob', mode: '100644', size: 9 }],
        }),
      ),
    );

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/kho/tree/main/khong-co' }, { t });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('GIT_PATH_NOT_FOUND');
    expect(describeFinding(r.findings[0], t)).toContain('khong-co');
    expect(describeFinding(r.findings[0], t)).not.toMatch(/riêng tư/i);
  });

  /* ------------------------------------------------------------------ *
   * The cost of one request per file, and what a reader is given while
   * it is being paid
   * ------------------------------------------------------------------ */

  /** A repo of `count` one-byte files plus a valid package, served wholesale. */
  function serveManyFiles(count: number): void {
    const manifestJson = JSON.stringify(manifest(), null, 2);
    const tree = [
      { path: 'manifest.json', type: 'blob', mode: '100644', size: manifestJson.length },
      { path: 'chapters/c1.html', type: 'blob', mode: '100644', size: CHAPTER_HTML.length },
      ...Array.from({ length: count }, (_, i) => ({
        path: `assets/${i}.txt`,
        type: 'blob',
        mode: '100644',
        size: 1,
      })),
    ];
    server.use(
      http.get(TREE, () => HttpResponse.json({ sha: 'x', truncated: false, tree })),
      http.get(`${RAW}/manifest.json`, () => new HttpResponse(encode(manifestJson) as BlobPart)),
      http.get(`${RAW}/chapters/c1.html`, () => new HttpResponse(encode(CHAPTER_HTML) as BlobPart)),
      http.get(`${RAW}/assets/:name`, () => new HttpResponse(encode('x') as BlobPart)),
    );
  }

  it('kể tiến độ theo TỆP, không để người dùng nhìn một dòng tĩnh suốt hai mươi giây', async () => {
    // Measured in review, real network, real Chromium, this exact loop shape:
    // 25 tệp → 3,67 s; 313 tệp → 20,04 s for 188 KB of data. The cost is
    // almost entirely round trips, so it scales with FILE COUNT and there is
    // nothing to make it fast. What there is, is telling the truth about it.
    const seen: [number, number][] = [];
    serveManyFiles(20);

    const r = await importCourse(
      { kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' },
      { t, onProgress: (done, total) => seen.push([done, total]) },
    );

    expect(r.ok).toBe(true);
    expect(seen.length).toBeGreaterThan(1);
    expect(seen[seen.length - 1]).toEqual([22, 22]);
    // Monotonic, and never claiming more than there are.
    for (const [i, [done, total]] of seen.entries()) {
      expect(total).toBe(22);
      expect(done).toBeGreaterThan(i === 0 ? 0 : seen[i - 1][0]);
      expect(done).toBeLessThanOrEqual(total);
    }
  });

  it('huỷ được giữa chừng — và không để lại gì trong Dexie', async () => {
    // Every control on the page is `disabled={busy}`, so before this there
    // was no way to stop a 313-file import except closing the tab.
    serveManyFiles(40);
    const controller = new AbortController();

    const r = await importCourse(
      { kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' },
      { t, signal: controller.signal, onProgress: () => controller.abort() },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('CANCELLED');
    expect(await db.packages.count()).toBe(0);
  });

  it('trần số tệp là một CHỐT, không phải một con số trong comment', async () => {
    // Without the fence this repo imports cleanly: the manifest and its one
    // chapter are both served, and the rest is padding. So a green test here
    // means the ceiling really refused, not that something else went wrong.
    serveManyFiles(MAX_GIT_FILES);

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' }, { t });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('GIT_TOO_MANY_FILES');
    expect(r.findings[0].detail).toContain(String(MAX_GIT_FILES));
    expect(describeFinding(r.findings[0], t)).toMatch(/\.zip/i);
    expect(await db.packages.count()).toBe(0);
  });

  it('ngay dưới trần thì vẫn nhập — trần là một hàng rào, không phải một cái bẫy', async () => {
    serveManyFiles(MAX_GIT_FILES - 2);

    await expect(
      importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' }, { t }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('một cú nấc mạng ở giữa được thử lại, thay vì vứt bỏ cả công sức đã tải', async () => {
    // The measured shape of this failure: 313 files, 20 seconds, and one
    // blob failing at file 300 threw all of it away because `fetchGitHubRepo`
    // returned on the first error. Across hundreds of requests a transient
    // failure is not an edge case, it is the expected case.
    const manifestJson = JSON.stringify(manifest(), null, 2);
    let attempts = 0;
    server.use(
      http.get(TREE, () =>
        HttpResponse.json({
          sha: 'x',
          truncated: false,
          tree: [
            { path: 'manifest.json', type: 'blob', mode: '100644', size: manifestJson.length },
            { path: 'chapters/c1.html', type: 'blob', mode: '100644', size: CHAPTER_HTML.length },
          ],
        }),
      ),
      http.get(`${RAW}/manifest.json`, () => new HttpResponse(encode(manifestJson) as BlobPart)),
      http.get(`${RAW}/chapters/c1.html`, () => {
        attempts += 1;
        return attempts === 1 ? HttpResponse.error() : new HttpResponse(encode(CHAPTER_HTML) as BlobPart);
      }),
    );

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' }, { t });

    expect(r.ok).toBe(true);
    expect(attempts).toBe(2);
  });

  it('KHÔNG thử lại một câu trả lời DỨT KHOÁT — 404 lần hai vẫn là 404', async () => {
    // Retrying a deterministic answer just multiplies the wait before the
    // same message. Only a rejected `fetch` — the one that means "the network
    // did not carry this" — is worth a second go.
    const manifestJson = JSON.stringify(manifest(), null, 2);
    let attempts = 0;
    server.use(
      http.get(TREE, () =>
        HttpResponse.json({
          sha: 'x',
          truncated: false,
          tree: [{ path: 'manifest.json', type: 'blob', mode: '100644', size: manifestJson.length }],
        }),
      ),
      http.get(`${RAW}/manifest.json`, () => {
        attempts += 1;
        return new HttpResponse(null, { status: 404 });
      }),
    );

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' }, { t });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('HTTP_ERROR');
    expect(attempts).toBe(1);
  });

  it('từ chối một máy chủ git KHÁC GitHub, và nói ra lối đi thay thế', async () => {
    const r = await importCourse({ kind: 'gitUrl', url: 'https://gitlab.com/ai-do/khoa-hoc' }, { t });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('GIT_HOST_UNSUPPORTED');
    expect(describeFinding(r.findings[0], t)).toMatch(/\.zip/i);
  });
});

/* ====================================================================== *
 * Every finding a reader can be shown has a Vietnamese sentence
 * ====================================================================== */

describe('describeFinding', () => {
  it('có câu tiếng Việt cho MỌI mã mà hai lớp dưới có thể phát ra', () => {
    // `FINDING_CODES` is exported by `packages/course-format` precisely so a
    // consumer can render a legend. This is that legend, and this test is
    // what stops a new rule over there from reaching a reader as a bare
    // SCREAMING_CODE over here.
    for (const code of [...FINDING_CODES, ...IMPORT_FINDING_CODES]) {
      const text = describeFinding({ code, path: 'chapters/c1.html', detail: 'chi tiết kỹ thuật' }, t);
      expect(text, `mã ${code} chưa có câu tiếng Việt`).not.toContain(code);
      expect(text.length, `mã ${code} chưa có câu tiếng Việt`).toBeGreaterThan(20);
    }
  });

  it('không rò một chữ tiếng Anh nào của lớp dưới ra màn hình', () => {
    // `packages/course-format` writes its `detail` for a CLI diff and a CI
    // log — "not a semver version: …", "package has no manifest.json at its
    // root". Appending that to the Vietnamese sentence was the FIRST version
    // of this file and it looked fine in every test, because no test read
    // the rendered line as a sentence. Looking at the real screen did:
    //
    //   Số phiên bản của khóa học không đúng dạng X.Y.Z.
    //   (manifest.json#/version) not a semver version: "khong-phai-semver"
    const ENGLISH = 'not a semver version: "khong-phai-semver"';
    for (const code of FINDING_CODES) {
      const rendered = describeFinding({ code, path: 'manifest.json#/version', detail: ENGLISH }, t);
      expect(rendered, `mã ${code} kéo theo chi tiết tiếng Anh ra màn hình`).not.toContain(ENGLISH);
      // The pointer stays: it is what tells the author WHERE to look, and it
      // is not prose in any language.
      expect(rendered).toContain('manifest.json#/version');
    }
  });

  it('vẫn trả về câu đọc được cho một mã chưa biết', () => {
    expect(describeFinding({ code: 'MA_LA', path: '.', detail: 'chi tiết' }, t)).toMatch(/[a-zà-ỹ]{4,}/i);
  });
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * A response body that starts arriving and then stops — the network failure
 * a `Content-Length` cannot protect you from.
 *
 * A stream rather than a shorter body on purpose: a body that is merely
 * SHORT resolves `arrayBuffer()` happily and fails later, at the unzip. The
 * failure being reproduced here is the one where `arrayBuffer()` itself
 * rejects, which is what a dropped connection does, and which is what used
 * to escape this module entirely.
 */
function cutOffBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1024));
      controller.error(new Error('kết nối bị cắt giữa chừng'));
    },
  });
}

/* ====================================================================== *
 * The `onStage` + `flushSync` contract, enforced instead of documented
 * ====================================================================== */

/**
 * `ImportOptions.onStage` says a React caller MUST commit synchronously, and
 * `stageAnnouncer` explains why with a measurement. Neither made it true.
 *
 * Independent mutation testing replaced `flushSync(() => setStage(next))`
 * with a bare `setStage(next)` and ran the whole suite: **632 passed**, while
 * the same build in real Chromium drew only the first of the four stages —
 * the exact §5.1 failure the `flushSync` was added to fix, reproducing at
 * 100 % behind a suite that was 100 % green. jsdom has no compositor and no
 * long tasks, so no behavioural test in this repo can ever see it.
 *
 * What CAN see it is the source, and this repo already does exactly this
 * twice: `auth/session.test.ts` and `db/local.test.ts` both parse every
 * production file with the TypeScript compiler to enforce "if you call this,
 * you must also do that". This is the same instrument aimed at the same kind
 * of rule, and — the reason it is possible at all — it needs nothing from
 * `react-dom` inside `course/import.ts`, which is what made the contract look
 * unenforceable when it was written.
 */
describe('mọi lời gọi importCourse có onStage đều cam kết đồng bộ', () => {
  it('đọc đúng công cụ của chính nó: mã tính, bình luận và chuỗi thì không', () => {
    // The classic way a scan like this goes quietly blind is by matching
    // prose. `ImportCourse.tsx` and `import.ts` both discuss `flushSync` at
    // length in comments, so a grep would pass on a file that never calls it.
    const decoy = [
      'import { importCourse } from "../course/import";',
      '// this one uses flushSync, honestly it does',
      'const label = "flushSync";',
      'export const go = () => importCourse(src, { onStage: (s) => setStage(s) });',
    ].join('\n');
    expect(flushSyncViolations('decoy.ts', decoy)).toHaveLength(1);

    const real = [
      'import { flushSync } from "react-dom";',
      'const announce = (s) => { flushSync(() => setStage(s)); };',
      'export const go = () => importCourse(src, { onStage: announce });',
    ].join('\n');
    expect(flushSyncViolations('real.ts', real)).toEqual([]);

    // No `onStage` at all is not a violation — there is no commit to order.
    expect(flushSyncViolations('bare.ts', 'go(() => importCourse(src));')).toEqual([]);
  });

  it('đang nhìn vào cả ứng dụng, không phải vào hư không', () => {
    const seen = productionSourceFiles().map((f) => relative(SRC_DIR, f));
    expect(seen.length).toBeGreaterThan(20);
    expect(seen).toContain(join('pages', 'ImportCourse.tsx'));
    expect(seen).toContain(join('course', 'import.ts'));
    expect(seen).not.toContain(join('course', 'import.test.ts'));
  });

  it('không tệp sản phẩm nào gọi importCourse với onStage ngoài flushSync', () => {
    const violations = productionSourceFiles().flatMap((file) =>
      flushSyncViolations(relative(SRC_DIR, file), readFileSync(file, 'utf-8')),
    );
    // If this fails: the stage line will be committed in the same task as the
    // work it announces, and the reader will watch a frozen page showing the
    // PREVIOUS stage. That is not a style rule — it was measured, twice, in
    // a real browser. See `course/import.ts`'s `stageAnnouncer`.
    expect(violations).toEqual([]);
  });

  it('và có ít nhất một nơi thật sự dùng nó — luật chỉ biết cấm thì xoá hết là xong', () => {
    // The complement of the scan. Without this, deleting the `onStage`
    // argument from the one real call site would leave the rule green while
    // removing the waiting state entirely.
    const callers = productionSourceFiles()
      .filter((file) => namesOnStageAt(readFileSync(file, 'utf-8')))
      .map((file) => relative(SRC_DIR, file));
    expect(callers).toEqual([join('pages', 'ImportCourse.tsx')]);
  });
});

const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every `.ts`/`.tsx` under `src/` that ships, tests excluded. */
function productionSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
    }
  };
  walk(SRC_DIR);
  return out.sort();
}

/** True if this source calls `importCourse` and hands it an `onStage`. */
function namesOnStageAt(source: string): boolean {
  let found = false;
  forEachOnStageValue(ts.createSourceFile('x.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), () => {
    found = true;
  });
  return found;
}

/**
 * Complaints about `importCourse(…, { onStage })` callbacks that do not
 * commit synchronously.
 *
 * The callback is followed either inline or through a `const` in the same
 * file (`ImportCourse.tsx` wraps its in a `useCallback`, which is why
 * resolving one level of indirection is required rather than optional). An
 * `onStage` whose value comes from somewhere this scan cannot follow is
 * reported too: "I cannot check this" and "this is fine" are different
 * answers, and a checker that conflates them is how the last version of this
 * contract came to be enforced by nothing at all.
 */
function flushSyncViolations(fileName: string, source: string): string[] {
  const parsed = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const declared = new Map<string, ts.Node>();
  const collectDeclarations = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      declared.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(parsed);

  const violations: string[] = [];
  forEachOnStageValue(parsed, (value) => {
    let body = value;
    if (ts.isIdentifier(body)) {
      const declaration = declared.get(body.text);
      if (declaration === undefined) {
        violations.push(`${fileName}: onStage là \`${body.text}\`, không lần được về nơi khai báo`);
        return;
      }
      body = declaration;
    }
    if (!callsFlushSync(body)) {
      violations.push(`${fileName}: callback onStage không nằm trong flushSync`);
    }
  });
  return violations;
}

/** Runs `visit` on the value of every `onStage:` passed to `importCourse`. */
function forEachOnStageValue(root: ts.SourceFile, visit: (value: ts.Node) => void): void {
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeName(node.expression) === 'importCourse') {
      const options = node.arguments[1];
      if (options !== undefined && ts.isObjectLiteralExpression(options)) {
        for (const property of options.properties) {
          const name = property.name !== undefined ? propertyName(property.name) : undefined;
          if (ts.isPropertyAssignment(property) && name === 'onStage') visit(property.initializer);
          else if (ts.isShorthandPropertyAssignment(property) && name === 'onStage') visit(property.name);
        }
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(root);
}

function calleeName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

function callsFlushSync(node: ts.Node): boolean {
  let found = false;
  const walk = (inner: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(inner) && calleeName(inner.expression) === 'flushSync') {
      found = true;
      return;
    }
    ts.forEachChild(inner, walk);
  };
  walk(node);
  return found;
}

/* ------------------------------------------------------------------ *
 * Real bytes from real tools
 * ------------------------------------------------------------------ */

/**
 * An archive written by a tool that is not this repo's CLI, read from
 * `apps/web/fixtures/`.
 *
 * vitest runs with cwd = `apps/web` (its config lives there), the same
 * arrangement `packages/course-format`'s own `fixture()` relies on. The
 * command or program that produced each file is written at the case that
 * uses it, because a hand-built imitation only ever proves that the
 * imitation is readable — which is exactly how this file previously came to
 * pin a zip64 archive shape that no tool on earth emits.
 *
 * A fresh copy per call: two of these cases patch the bytes they are given.
 */
function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(`fixtures/${name}`));
}

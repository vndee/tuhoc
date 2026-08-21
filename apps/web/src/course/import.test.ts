import { packZip, FINDING_CODES } from '@tuhoc/course-format';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/local';
import { describeFinding, IMPORT_FINDING_CODES, importCourse, type ImportStage } from './import';
import { loadChapter, loadManifest } from './loader';

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
  const r = await importCourse({ kind: 'file', file: zipFile(validZip()) });

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
  const r = await importCourse({ kind: 'file', file: fileWithScriptTag() });
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

  const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/repo-rieng-tu' });
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

    const r = await importCourse({ kind: 'file', file: zipFile(broken) });
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
    const r = await importCourse({ kind: 'zipUrl', url: 'https://vi-du.test/goi.zip' });
    expect(r.ok).toBe(false);
    expect(await db.packages.count()).toBe(before);
  });

  it('ghi ĐÚNG MỘT dòng cho một gói, và dòng đó mang đủ tệp của gói', async () => {
    await importCourse({ kind: 'file', file: zipFile(validZip()) });

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
    await importCourse({ kind: 'file', file: zipFile(validZip()) }, { onStage: (s) => seen.push(s) });

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

    const r = await importCourse({ kind: 'file', file: zipFile(packZip(nested)) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.courseId).toBe(COURSE_ID);

    const row = await db.packages.get(`${COURSE_ID}@1.0.0`);
    // Re-rooted, and the sidecar directory did not come along.
    expect(Object.keys(row!.files).sort()).toEqual(['chapters/c1.html', 'manifest.json']);
  });

  it('từ chối — chứ không đoán — khi HAI thư mục đều có manifest.json', async () => {
    const two = new Map<string, Uint8Array>();
    for (const [name, bytes] of packageFiles()) {
      two.set(`khoa-a/${name}`, bytes);
      two.set(`khoa-b/${name}`, bytes);
    }

    const r = await importCourse({ kind: 'file', file: zipFile(packZip(two)) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.code)).toContain('PACKAGE_ROOT_AMBIGUOUS');
    expect(describeFinding(r.findings[0])).toMatch(/khoa-a|khoa-b|hai|nhiều/i);
  });

  it('giải thích được kho zip64 bị từ chối, thay vì nói "archive index is not readable"', async () => {
    // `zip -fz` (Info-ZIP, forced zip64) writes a zip64 end-of-central-
    // directory record and a zip64 locator between the index and the footer,
    // and sets the footer's index offset to the 0xFFFFFFFF sentinel.
    // `unpackZip` refuses that archive — deliberately; it is the security
    // gate of Task 2 and is not being loosened here. What IS this module's
    // business is that the reader gets a sentence they can act on.
    const r = await importCourse({ kind: 'file', file: zipFile(withZip64Tail(validZip())) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.code)).toContain('ZIP64_UNSUPPORTED');
    expect(r.findings[0].detail).toMatch(/zip64/i);
    expect(await db.packages.count()).toBe(0);
  });

  it('nói "đây không phải tệp .zip" cho một tệp không phải zip, không ném UnsafeArchiveError ra ngoài', async () => {
    const r = await importCourse({ kind: 'file', file: zipFile(encode('%PDF-1.7 …'), 'khoa-hoc.pdf') });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.code)).toContain('NOT_A_ZIP');
    expect(describeFinding(r.findings[0])).toMatch(/\.zip/i);
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

    const r = await importCourse({ kind: 'zipUrl', url: 'https://vi-du.test/goi.zip' });
    expect(r.ok).toBe(true);
    expect(await db.packages.count()).toBe(1);
  });

  it('nói rõ mã HTTP khi máy chủ từ chối', async () => {
    server.use(http.get('https://vi-du.test/goi.zip', () => new HttpResponse(null, { status: 404 })));

    const r = await importCourse({ kind: 'zipUrl', url: 'https://vi-du.test/goi.zip' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('HTTP_ERROR');
    expect(r.findings[0].detail).toContain('404');
  });

  it('nhắc tới CORS khi fetch tự nó hỏng — đó là lý do thường gặp nhất, và trình duyệt không nói ra', async () => {
    server.use(http.get('https://vi-du.test/goi.zip', () => HttpResponse.error()));

    const r = await importCourse({ kind: 'zipUrl', url: 'https://vi-du.test/goi.zip' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('FETCH_FAILED');
    expect(r.findings[0].detail).toMatch(/CORS|mạng/i);
  });

  it('từ chối một URL không phải http(s) thay vì đưa nó cho fetch', async () => {
    const r = await importCourse({ kind: 'zipUrl', url: 'javascript:alert(1)' });
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

    const r = await importCourse({ kind: 'zipUrl', url: 'https://vi-du.test/goi.zip' });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('FETCH_FAILED');
    expect(describeFinding(r.findings[0]).length).toBeGreaterThan(20);
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

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' });

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

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('GIT_BAD_RESPONSE');
    expect(describeFinding(r.findings[0])).toMatch(/wi-?fi|đăng nhập|không đọc được/i);
  });

  it('tệp trên máy không đọc được nữa (rút USB, tệp bị sửa sau khi chọn)', async () => {
    const file = zipFile(validZip());
    // What Chromium actually throws when the bytes behind a picked File are
    // gone by the time they are asked for.
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => Promise.reject(new DOMException('The requested file could not be read', 'NotReadableError')),
    });

    const r = await importCourse({ kind: 'file', file });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('FILE_READ_FAILED');
    expect(describeFinding(r.findings[0])).toMatch(/không đọc được/i);
  });

  it('kể cả khi `onStage` của NGƯỜI GỌI tự ném — trang gọi nó trong flushSync, và một render hỏng ném ở đúng đó', async () => {
    // The last net. `flushSync(() => setStage(next))` runs React's render
    // synchronously inside this module's `await`, so a component that throws
    // throws HERE. Without the net that is once again an unhandled rejection
    // and once again a blank screen.
    const r = await importCourse(
      { kind: 'file', file: zipFile(validZip()) },
      {
        onStage: () => {
          throw new Error('render hỏng trong flushSync');
        },
      },
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('UNEXPECTED');
    expect(describeFinding(r.findings[0])).toMatch(/render hỏng trong flushSync/);
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

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' });
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

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' });
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

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' });
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

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings.map((f) => f.code)).toContain('UNPACKABLE_ENTRY');
  });

  it('nói rõ khi cây bị cắt bớt, thay vì nhập nửa repo', async () => {
    server.use(http.get(TREE, () => HttpResponse.json({ sha: 'x', truncated: true, tree: [] })));

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' });
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

    const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc' });
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
      importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/khoa-hoc/tree/v2' }),
    ).resolves.toMatchObject({ ok: true });
    expect(await db.packages.count()).toBe(1);
  });

  it('từ chối một máy chủ git KHÁC GitHub, và nói ra lối đi thay thế', async () => {
    const r = await importCourse({ kind: 'gitUrl', url: 'https://gitlab.com/ai-do/khoa-hoc' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.findings[0].code).toBe('GIT_HOST_UNSUPPORTED');
    expect(describeFinding(r.findings[0])).toMatch(/\.zip/i);
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
      const text = describeFinding({ code, path: 'chapters/c1.html', detail: 'chi tiết kỹ thuật' });
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
      const rendered = describeFinding({ code, path: 'manifest.json#/version', detail: ENGLISH });
      expect(rendered, `mã ${code} kéo theo chi tiết tiếng Anh ra màn hình`).not.toContain(ENGLISH);
      // The pointer stays: it is what tells the author WHERE to look, and it
      // is not prose in any language.
      expect(rendered).toContain('manifest.json#/version');
    }
  });

  it('vẫn trả về câu đọc được cho một mã chưa biết', () => {
    expect(describeFinding({ code: 'MA_LA', path: '.', detail: 'chi tiết' })).toMatch(/[a-zà-ỹ]{4,}/i);
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

/* ------------------------------------------------------------------ *
 * Helpers that build byte layouts measured from real archives
 * ------------------------------------------------------------------ */

/**
 * Re-writes a zip the way Info-ZIP's `zip -fz` does: a zip64
 * end-of-central-directory record (`PK\x06\x06`, 56 bytes) and a zip64
 * locator (`PK\x06\x07`, 20 bytes) are spliced in between the index and the
 * footer, and the footer's "offset of central directory" field is replaced
 * by the 0xFFFFFFFF sentinel that says "read it from the zip64 record".
 *
 * Copied from a hexdump of a REAL `zip -r -fz` archive of
 * `fixtures/courses/bat-bien-vong-lap` — see task-8-report.md. Only the
 * shape matters to the reader under test (it stops at the sentinel offset),
 * so the two records' bodies are zero-filled rather than filled in.
 */
function withZip64Tail(zip: Uint8Array): Uint8Array {
  const EOCD_SIZE = 22;
  const eocd = zip.length - EOCD_SIZE;
  const out = new Uint8Array(zip.length + 56 + 20);
  out.set(zip.subarray(0, eocd), 0);

  const view = new DataView(out.buffer);
  // zip64 end of central directory record
  view.setUint32(eocd, 0x06064b50, true);
  view.setUint32(eocd + 4, 44, true); // size of the remainder of this record
  // zip64 end of central directory locator
  view.setUint32(eocd + 56, 0x07064b50, true);
  view.setUint32(eocd + 56 + 8, eocd, true); // relative offset of the zip64 EOCD record

  // The original footer, with its index offset replaced by the sentinel.
  out.set(zip.subarray(eocd), eocd + 56 + 20);
  view.setUint32(eocd + 56 + 20 + 16, 0xffffffff, true);
  return out;
}

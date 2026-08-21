import { describe, expect, it } from 'vitest';
import { FINDING_CODES, MAX_UNCOMPRESSED_BYTES, parseManifest, validatePackage } from './validate';

const enc = (s: string) => new TextEncoder().encode(s);
const MANIFEST = (over: Record<string, unknown> = {}) => enc(JSON.stringify({
  id: 'demo', title: 'Demo', description: 'd', lang: 'vi', version: '1.0.0',
  runtime: '^1', tier: 'content', license: 'CC-BY-4.0',
  authors: [{ name: 'A' }], generatedBy: 'human',
  parts: [{ title: 'P', chapters: [{ id: 'c1', num: '1', title: 'T', short: 'T', file: 'chapters/c1.html' }] }],
  ...over,
}));

/** A content package that is valid except for whatever `chapter` says. */
const withChapter = (chapter: string, over: Record<string, unknown> = {}) =>
  new Map([
    ['manifest.json', MANIFEST(over)],
    ['chapters/c1.html', enc(chapter)],
  ]);

const codesOf = (files: ReadonlyMap<string, Uint8Array>) => validatePackage(files).findings.map((f) => f.code);

// ---------------------------------------------------------------------------
// The five cases from the task brief, verbatim.
// ---------------------------------------------------------------------------

it('gói content hợp lệ thì ok', () => {
  const r = validatePackage(new Map([
    ['manifest.json', MANIFEST()],
    ['chapters/c1.html', enc('<p>Xin chào</p>')],
  ]));
  expect(r).toEqual({ ok: true, findings: [] });
});

it('hạng content KHÔNG được chứa <script>', () => {
  const r = validatePackage(new Map([
    ['manifest.json', MANIFEST()],
    ['chapters/c1.html', enc('<p>a</p><script>alert(1)</script>')],
  ]));
  expect(r.ok).toBe(false);
  expect(r.findings.map(f => f.code)).toContain('SCRIPT_TAG');
});

it('hạng interactive ĐƯỢC chứa JS — đây là điểm khác biệt của hai hạng', () => {
  const r = validatePackage(new Map([
    ['manifest.json', MANIFEST({ tier: 'interactive' })],
    ['chapters/c1.html', enc('<p>a</p>')],
    ['viz.js', enc('export function draw() {}')],
  ]));
  expect(r.ok).toBe(true);
});

it('đường dẫn thoát ra ngoài gói bị chặn', () => {
  const r = validatePackage(new Map([
    ['manifest.json', MANIFEST()],
    ['chapters/c1.html', enc('<p>a</p>')],
    ['../ngoai.txt', enc('x')],
  ]));
  expect(r.findings.map(f => f.code)).toContain('PATH_ESCAPE');
});

it('manifest trỏ tới chương không tồn tại', () => {
  const r = validatePackage(new Map([['manifest.json', MANIFEST()]]));
  expect(r.findings.map(f => f.code)).toContain('CHAPTER_FILE_MISSING');
});

// ---------------------------------------------------------------------------
// Nhóm chung — mọi hạng
// ---------------------------------------------------------------------------

describe('luật chung', () => {
  it('EMPTY_PACKAGE: gói rỗng chỉ báo đúng một finding, không kéo theo MANIFEST_MISSING', () => {
    const r = validatePackage(new Map());
    expect(r.ok).toBe(false);
    // Deliberate: an empty package is ONE fact. Reporting the manifest missing
    // as well would just restate it.
    expect(r.findings.map((f) => f.code)).toEqual(['EMPTY_PACKAGE']);
  });

  it('TOO_LARGE: tính trên tổng byte ĐÃ GIẢI NÉN, không phải kích thước zip', () => {
    const huge = new Uint8Array(MAX_UNCOMPRESSED_BYTES + 1);
    expect(codesOf(new Map([
      ['manifest.json', MANIFEST()],
      ['chapters/c1.html', enc('<p>a</p>')],
      ['big.bin', huge],
    ]))).toContain('TOO_LARGE');
  });

  it('TOO_LARGE: đúng ngưỡng thì KHÔNG báo (biên là > chứ không phải >=)', () => {
    const manifest = MANIFEST();
    const chapter = enc('<p>a</p>');
    const slack = MAX_UNCOMPRESSED_BYTES - manifest.byteLength - chapter.byteLength;
    const r = validatePackage(new Map([
      ['manifest.json', manifest],
      ['chapters/c1.html', chapter],
      ['pad.bin', new Uint8Array(slack)],
    ]));
    expect(r.findings.map((f) => f.code)).not.toContain('TOO_LARGE');
  });

  it('PATH_ESCAPE: đường dẫn tuyệt đối và dấu gạch ngược cũng bị chặn', () => {
    expect(codesOf(withChapter('<p>a</p>').set('/etc/passwd', enc('x')))).toContain('PATH_ESCAPE');
    expect(codesOf(withChapter('<p>a</p>').set('a\\b.txt', enc('x')))).toContain('PATH_ESCAPE');
  });

  it('PATH_ESCAPE: chapter.file thoát ra ngoài cũng bị chặn, không chỉ tên entry', () => {
    const over = {
      parts: [{ title: 'P', chapters: [{ id: 'c1', num: '1', title: 'T', short: 'T', file: '../ngoai.html' }] }],
    };
    const findings = validatePackage(new Map([['manifest.json', MANIFEST(over)]])).findings;
    const escape = findings.find((f) => f.code === 'PATH_ESCAPE');
    expect(escape?.path).toBe('manifest.json#/parts/0/chapters/0/file');
  });

  it('PATH_ESCAPE: "..." hay "..a" trong tên KHÔNG bị nhầm là thoát', () => {
    const r = validatePackage(new Map([
      ['manifest.json', MANIFEST()],
      ['chapters/c1.html', enc('<p>a</p>')],
      ['assets/...ba-cham.png', enc('x')],
    ]));
    expect(r).toEqual({ ok: true, findings: [] });
  });

  it('MANIFEST_MISSING: không có manifest.json ở gốc', () => {
    const r = validatePackage(new Map([['chapters/c1.html', enc('<p>a</p>')]]));
    expect(r.findings.map((f) => f.code)).toEqual(['MANIFEST_MISSING']);
  });

  it('MANIFEST_PARSE: JSON hỏng, và JSON hợp lệ nhưng không phải object', () => {
    expect(codesOf(new Map([['manifest.json', enc('{ khong phai json')]]))).toContain('MANIFEST_PARSE');
    expect(codesOf(new Map([['manifest.json', enc('[1, 2, 3]')]]))).toContain('MANIFEST_PARSE');
  });

  it('MANIFEST_FIELD: thiếu trường bắt buộc, kèm con trỏ tới đúng trường', () => {
    const noTier = JSON.parse(new TextDecoder().decode(MANIFEST())) as Record<string, unknown>;
    delete noTier['tier'];
    const findings = validatePackage(new Map([
      ['manifest.json', enc(JSON.stringify(noTier))],
      ['chapters/c1.html', enc('<p>a</p>')],
    ])).findings;
    expect(findings.map((f) => f.code)).toContain('MANIFEST_FIELD');
    expect(findings.find((f) => f.code === 'MANIFEST_FIELD')?.path).toBe('manifest.json#/tier');
  });

  it('MANIFEST_FIELD: sai KIỂU cũng bị bắt, không chỉ thiếu', () => {
    expect(codesOf(withChapter('<p>a</p>', { version: 1 }))).toContain('MANIFEST_FIELD');
    expect(codesOf(withChapter('<p>a</p>', { authors: [] }))).toContain('MANIFEST_FIELD');
    expect(codesOf(withChapter('<p>a</p>', { authors: [{ name: 'A', url: 3 }] }))).toContain('MANIFEST_FIELD');
    expect(codesOf(withChapter('<p>a</p>', { generatedBy: 'robot' }))).toContain('MANIFEST_FIELD');
    expect(codesOf(withChapter('<p>a</p>', { tier: 'CONTENT' }))).toContain('MANIFEST_FIELD');
    expect(codesOf(withChapter('<p>a</p>', { translationOf: 7 }))).toContain('MANIFEST_FIELD');
    expect(codesOf(withChapter('<p>a</p>', { parts: [] }))).toContain('MANIFEST_FIELD');
  });

  it('chapter.num RỖNG là hợp lệ — chương không đánh số (phụ lục) là ca được hỗ trợ', () => {
    // Regression from step 5: the real course ships `"num": ""` for its
    // appendix and the reader renders it as `·`. An earlier draft of this rule
    // demanded a non-empty `num` and flagged the shipping package. Do not
    // "tighten" this back.
    const over = {
      parts: [{
        title: 'Phụ lục',
        chapters: [{ id: 'appx', num: '', title: 'Sổ tay công thức', short: 'Sổ tay', file: 'chapters/c1.html' }],
      }],
    };
    expect(validatePackage(withChapter('<p>a</p>', over))).toEqual({ ok: true, findings: [] });
  });

  it('chapter.num sai KIỂU vẫn bị bắt — "được rỗng" không có nghĩa là "được bỏ"', () => {
    const over = {
      parts: [{
        title: 'P',
        chapters: [{ id: 'c1', num: 1, title: 'T', short: 'T', file: 'chapters/c1.html' }],
      }],
    };
    const findings = validatePackage(withChapter('<p>a</p>', over)).findings;
    expect(findings.map((f) => f.path)).toEqual(['manifest.json#/parts/0/chapters/0/num']);
    expect(findings[0]?.code).toBe('MANIFEST_FIELD');
  });

  it('MANIFEST_FIELD: trường tuỳ chọn vắng mặt thì KHÔNG bị báo', () => {
    // translationOf/registryId are optional; a package without them is fine.
    expect(validatePackage(withChapter('<p>a</p>')).ok).toBe(true);
    expect(validatePackage(withChapter('<p>a</p>', { translationOf: 'goc', registryId: 'r1' })).ok).toBe(true);
  });

  it('SEMVER: version phải là semver đầy đủ', () => {
    expect(codesOf(withChapter('<p>a</p>', { version: '1.0' }))).toContain('SEMVER');
    expect(codesOf(withChapter('<p>a</p>', { version: 'v1.0.0' }))).toContain('SEMVER');
    expect(validatePackage(withChapter('<p>a</p>', { version: '1.0.0-rc.1+build.5' })).ok).toBe(true);
  });

  it('RUNTIME_RANGE: chỉ chấp nhận dải caret', () => {
    expect(codesOf(withChapter('<p>a</p>', { runtime: '>=1' }))).toContain('RUNTIME_RANGE');
    expect(codesOf(withChapter('<p>a</p>', { runtime: '1.0.0' }))).toContain('RUNTIME_RANGE');
    expect(codesOf(withChapter('<p>a</p>', { runtime: '~1.2' }))).toContain('RUNTIME_RANGE');
    for (const runtime of ['^1', '^1.2', '^1.2.3', '^0.3.0']) {
      expect(validatePackage(withChapter('<p>a</p>', { runtime })).ok).toBe(true);
    }
  });

  it('DUPLICATE_CHAPTER_ID: trùng id qua hai phần khác nhau vẫn bị bắt', () => {
    const over = {
      parts: [
        { title: 'P1', chapters: [{ id: 'c1', num: '1', title: 'T', short: 'T', file: 'chapters/c1.html' }] },
        { title: 'P2', chapters: [{ id: 'c1', num: '2', title: 'U', short: 'U', file: 'chapters/c2.html' }] },
      ],
    };
    const findings = validatePackage(new Map([
      ['manifest.json', MANIFEST(over)],
      ['chapters/c1.html', enc('<p>a</p>')],
      ['chapters/c2.html', enc('<p>b</p>')],
    ])).findings;
    expect(findings.map((f) => f.code)).toEqual(['DUPLICATE_CHAPTER_ID']);
    expect(findings[0]?.path).toBe('manifest.json#/parts/1/chapters/0/id');
  });

  it('CHAPTER_FILE_MISSING: chỉ ra đúng chương nào thiếu', () => {
    const findings = validatePackage(new Map([['manifest.json', MANIFEST()]])).findings;
    const missing = findings.find((f) => f.code === 'CHAPTER_FILE_MISSING');
    expect(missing?.path).toBe('manifest.json#/parts/0/chapters/0/file');
    expect(missing?.detail).toContain('chapters/c1.html');
  });

  it('trả về TẤT CẢ finding trong một lượt, không dừng ở cái đầu tiên', () => {
    const codes = codesOf(new Map([
      ['manifest.json', MANIFEST({ version: '1.0', runtime: 'latest' })],
      ['chapters/c1.html', enc('<p>a</p><script>x</script><form></form>')],
      ['../ngoai.txt', enc('x')],
    ]));
    // Four independent problems, four different fences: nobody should have to
    // rebuild once per finding.
    expect(new Set(codes)).toEqual(new Set(['SEMVER', 'RUNTIME_RANGE', 'SCRIPT_TAG', 'FORM_TAG', 'PATH_ESCAPE']));
  });
});

// ---------------------------------------------------------------------------
// Nhóm chỉ áp cho tier: 'content'
// ---------------------------------------------------------------------------

describe("luật riêng của hạng 'content'", () => {
  it('EVENT_HANDLER_ATTR: on*= trong thẻ bị bắt, kể cả khi thẻ xuống dòng', () => {
    expect(codesOf(withChapter('<div onclick="x()">a</div>'))).toContain('EVENT_HANDLER_ATTR');
    expect(codesOf(withChapter('<div\n  onmouseover = "x()">a</div>'))).toContain('EVENT_HANDLER_ATTR');
  });

  it('EVENT_HANDLER_ATTR: văn xuôi nhắc tới "onclick =" NGOÀI thẻ thì không bị bắt', () => {
    // The regex anchors inside an opening tag on purpose — a chapter that
    // *writes about* event handlers is the common case in a course.
    const r = validatePackage(withChapter('<p>Thuộc tính onclick = mã chạy khi bấm.</p>'));
    expect(r).toEqual({ ok: true, findings: [] });
  });

  it('EVENT_HANDLER_ATTR: handler nấp sau dấu ">" trong giá trị thuộc tính có nháy', () => {
    // Measured miss of the first draft: `[^>]*` stops at the `>` inside
    // `title="a>b"`, so the handler after it was never seen. The second,
    // looser pattern (any `on*="…"`) exists for exactly this.
    expect(codesOf(withChapter('<div title="a>b" onclick="x()">z</div>'))).toContain('EVENT_HANDLER_ATTR');
  });

  it('EVENT_HANDLER_ATTR: mã ví dụ ĐÃ escape thì không bị bắt', () => {
    // The escape hatch a chapter about HTML would actually use.
    expect(validatePackage(withChapter('<p>&lt;div onclick=&quot;x()&quot;&gt;</p>')).ok).toBe(true);
  });

  it('JAVASCRIPT_URL: href="javascript:" bị bắt, kể cả không có nháy', () => {
    expect(codesOf(withChapter('<a href="javascript:alert(1)">x</a>'))).toContain('JAVASCRIPT_URL');
    expect(codesOf(withChapter('<a href=javascript:alert(1)>x</a>'))).toContain('JAVASCRIPT_URL');
  });

  it('JAVASCRIPT_URL: hai kiểu lách cổ điển — cắt bằng khoảng trắng và entity số', () => {
    expect(codesOf(withChapter('<a href="java\tscript:alert(1)">x</a>'))).toContain('JAVASCRIPT_URL');
    expect(codesOf(withChapter('<a href="&#106;avascript:alert(1)">x</a>'))).toContain('JAVASCRIPT_URL');
    expect(codesOf(withChapter('<a href="&#x6a;avascript:alert(1)">x</a>'))).toContain('JAVASCRIPT_URL');
    expect(codesOf(withChapter('<a href=" javascript:alert(1)">x</a>'))).toContain('JAVASCRIPT_URL');
    expect(codesOf(withChapter('<svg><a xlink:href="javascript:x">l</a></svg>'))).toContain('JAVASCRIPT_URL');
  });

  it('URL vô hại vẫn đi qua — không phải cứ có href là báo', () => {
    expect(validatePackage(withChapter(
      '<a href="https://vi.wikipedia.org/wiki/Entropy">Entropy</a> <a href="#muc-2">mục 2</a>',
    )).ok).toBe(true);
  });

  it('EMBEDDED_FRAME: iframe, object, embed', () => {
    expect(codesOf(withChapter('<iframe src="https://x"></iframe>'))).toContain('EMBEDDED_FRAME');
    expect(codesOf(withChapter('<object data="x.swf"></object>'))).toContain('EMBEDDED_FRAME');
    expect(codesOf(withChapter('<embed src="x.svg">'))).toContain('EMBEDDED_FRAME');
  });

  it('FORM_TAG: <form> bị chặn', () => {
    expect(codesOf(withChapter('<form action="/x"><input name="a"></form>'))).toContain('FORM_TAG');
  });

  it('JS_FILE_IN_PACKAGE: bất kỳ tệp JS nào, kể cả .mjs/.cjs', () => {
    for (const name of ['viz.js', 'a/b.mjs', 'c.cjs']) {
      expect(codesOf(withChapter('<p>a</p>').set(name, enc('x')))).toContain('JS_FILE_IN_PACKAGE');
    }
  });

  it('quét cả .svg — SVG cũng mang được script và on*=', () => {
    const files = withChapter('<p>a</p>').set('hinh.svg', enc('<svg><script>x</script></svg>'));
    expect(codesOf(files)).toContain('SCRIPT_TAG');
  });

  it("hạng 'interactive' bỏ qua TOÀN BỘ nhóm luật này", () => {
    const files = new Map([
      ['manifest.json', MANIFEST({ tier: 'interactive' })],
      ['chapters/c1.html', enc(
        '<script>x</script><div onclick="y()"></div><a href="javascript:z">l</a>'
        + '<iframe src="q"></iframe><form></form>',
      )],
      ['viz.js', enc('export const a = 1;')],
    ]);
    expect(validatePackage(files)).toEqual({ ok: true, findings: [] });
  });

  it('LỖ HỔNG ĐÃ BIẾT: không luật nào phủ meta-refresh, ảnh ngoài, hay data: URL', () => {
    // Pinned deliberately. These are NOT flagged, there is no `code` for them
    // in the brief's rule list, and the registry's human review is what covers
    // them. Written down as a passing test so the gap is visible to whoever
    // reads this file next, instead of being an absence nobody notices.
    // If a future task adds a code for one of these, this test goes red — which
    // is the correct way to find out.
    expect(validatePackage(withChapter('<meta http-equiv="refresh" content="0;url=https://x">')).ok).toBe(true);
    expect(validatePackage(withChapter('<img src="https://theo-doi.example/px.gif">')).ok).toBe(true);
    expect(validatePackage(withChapter('<a href="data:text/html;base64,PHA+eDwvcD4=">x</a>')).ok).toBe(true);
  });

  it('manifest không đọc được ⇒ không đoán hạng ⇒ không chạy luật riêng hạng', () => {
    // Documented behaviour, not an oversight: the package already fails, and a
    // guessed tier would only add noise to the report.
    const codes = codesOf(new Map([
      ['manifest.json', enc('{ hong')],
      ['chapters/c1.html', enc('<script>alert(1)</script>')],
    ]));
    expect(codes).toEqual(['MANIFEST_PARSE']);
  });
});

// ---------------------------------------------------------------------------
// parseManifest
// ---------------------------------------------------------------------------

describe('parseManifest', () => {
  it('trả manifest khi hợp lệ', () => {
    const raw = new TextDecoder().decode(MANIFEST());
    const r = parseManifest(raw);
    expect('manifest' in r && r.manifest.id).toBe('demo');
  });

  it('trả error MANIFEST_PARSE khi JSON hỏng', () => {
    const r = parseManifest('{ hong');
    expect('error' in r && r.error.code).toBe('MANIFEST_PARSE');
  });

  it('trả error MANIFEST_FIELD khi thiếu trường v2', () => {
    const r = parseManifest(JSON.stringify({ id: 'a', title: 'b', description: 'c', lang: 'vi' }));
    expect('error' in r && r.error.code).toBe('MANIFEST_FIELD');
  });

  it('trả error SEMVER khi version sai dạng', () => {
    const raw = new TextDecoder().decode(MANIFEST({ version: '1.0' }));
    const r = parseManifest(raw);
    expect('error' in r && r.error.code).toBe('SEMVER');
  });
});

// ---------------------------------------------------------------------------
// v1 → v2
// ---------------------------------------------------------------------------

describe('manifest v1 hiện có', () => {
  it('chỉ hụt đúng bốn trường mới của v2 — không hỏng ở trường nào của v1', () => {
    // The exact shape of `courses/***REMOVED***/manifest.json` today.
    // This encodes the v1→v2 gap as a test so task 11 knows precisely what it
    // has to add, and so a future edit that breaks a v1 field is visible here.
    const v1 = enc(JSON.stringify({
      id: '***REMOVED***', title: '***REMOVED***', description: 'x',
      lang: 'vi', version: '1.0.0', runtime: '^1',
      parts: [
        { title: 'Phần 0', chapters: [{ id: 'p0-1', num: '0.1', title: 'T', short: 'S', file: 'chapters/p0-1.html' }] },
        // The real package's unnumbered appendix, included on purpose: this
        // test is the stand-in for step 5's on-disk run.
        { title: 'Phụ lục', chapters: [{ id: 'appx', num: '', title: 'Sổ tay', short: 'Sổ tay', file: 'chapters/appx.html' }] },
      ],
    }));
    const findings = validatePackage(new Map([
      ['manifest.json', v1],
      ['chapters/p0-1.html', enc('<p>a</p>')],
      ['chapters/appx.html', enc('<p>b</p>')],
    ])).findings;
    expect(findings.map((f) => f.path)).toEqual([
      'manifest.json#/license',
      'manifest.json#/tier',
      'manifest.json#/generatedBy',
      'manifest.json#/authors',
    ]);
    expect(new Set(findings.map((f) => f.code))).toEqual(new Set(['MANIFEST_FIELD']));
  });
});

// ---------------------------------------------------------------------------
// Không có luật nào không được kiểm
// ---------------------------------------------------------------------------

it('ok LUÔN là "findings rỗng" — không có đường trả về nào tự nhận là ok', () => {
  // `ok` is derived, and a derived field is exactly the kind that drifts from
  // what it derives from on one branch and not the others. Pin it on every
  // return path: the early ones (empty / no manifest / bad JSON) and the main
  // one.
  const fixtures: ReadonlyMap<string, Uint8Array>[] = [
    new Map(),
    new Map([['chapters/c1.html', enc('<p>a</p>')]]),
    new Map([['manifest.json', enc('{ hong')]]),
    new Map([['manifest.json', enc('[]')]]),
    withChapter('<p>a</p>'),
    withChapter('<script>a</script>'),
    withChapter('<p>a</p>', { version: '1.0' }),
    withChapter('<p>a</p>').set('../x.txt', enc('x')),
    new Map([['manifest.json', MANIFEST()]]),
  ];
  for (const files of fixtures) {
    const r = validatePackage(files);
    expect(r.ok, `ok must equal (findings.length === 0); got ${r.ok} with ${r.findings.length}`)
      .toBe(r.findings.length === 0);
  }
});

it('mọi code trong FINDING_CODES đều được ít nhất một fixture sinh ra', () => {
  // A code that no fixture can produce is either dead or unreachable — both are
  // bugs, and both are invisible without this check.
  const produced = new Set<string>();
  const feed = (files: ReadonlyMap<string, Uint8Array>) => {
    for (const f of validatePackage(files).findings) produced.add(f.code);
  };

  feed(new Map());
  feed(new Map([['chapters/c1.html', enc('<p>a</p>')]]));
  feed(new Map([['manifest.json', enc('{ hong')]]));
  feed(new Map([['manifest.json', MANIFEST({ tier: undefined, version: '1.0', runtime: 'latest' })]]));
  feed(withChapter('<p>a</p>').set('../x.txt', enc('x')).set('big.bin', new Uint8Array(MAX_UNCOMPRESSED_BYTES + 1)));
  feed(withChapter(
    '<script>a</script><div onclick="b()"></div><a href="javascript:c">l</a><iframe src="d"></iframe><form></form>',
  ).set('e.js', enc('x')));
  feed(new Map([
    ['manifest.json', MANIFEST({
      parts: [
        { title: 'P1', chapters: [{ id: 'dup', num: '1', title: 'T', short: 'T', file: 'chapters/c1.html' }] },
        { title: 'P2', chapters: [{ id: 'dup', num: '2', title: 'U', short: 'U', file: 'chapters/c1.html' }] },
      ],
    })],
    ['chapters/c1.html', enc('<p>a</p>')],
  ]));

  expect([...produced].sort()).toEqual([...FINDING_CODES].sort());
});

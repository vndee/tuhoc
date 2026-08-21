import { describe, expect, it } from 'vitest';
import {
  FINDING_CODES,
  MAX_ATTRS_PER_TAG,
  MAX_UNCOMPRESSED_BYTES,
  parseManifest,
  validatePackage,
} from './validate';

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

/**
 * `<img a0=1 a1=1 … >` — n attributes with DISTINCT names on exactly one start
 * tag. Distinct matters: HTML drops a repeat of a name it already has, so
 * `'a=1 '.repeat(n)` is one attribute n times and reaches no ceiling at all.
 */
const tagWithAttrs = (n: number, extra = ''): string => {
  const attrs = new Array<string>(n);
  for (let i = 0; i < n; i++) attrs[i] = `a${i}=1`;
  return `<img ${attrs.join(' ')}${extra}>`;
};

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

  it('MAX_UNCOMPRESSED_BYTES là ĐÚNG 20 MiB — con số, không phải quan hệ', () => {
    // Both threshold tests above compute their fixtures FROM this constant, so
    // they measure the boundary rule and not the budget: raising the constant
    // to 200 MiB left the whole suite green (review round 1, mutant M14).
    // This line is what makes the number itself a decision somebody has to
    // change on purpose.
    expect(MAX_UNCOMPRESSED_BYTES).toBe(20 * 1024 * 1024);
  });

  it('MANIFEST_FIELD: chuỗi bắt buộc RỖNG bị bắt, không chỉ chuỗi vắng mặt', () => {
    // Mutating `isNonEmptyString` down to `typeof v === 'string'` also left the
    // suite green (review round 1, mutant M23): every existing fixture omitted
    // the field instead of setting it to "". An empty `license` or `id` is the
    // shape a generator produces when a template variable does not resolve.
    for (const key of ['id', 'title', 'lang', 'version', 'runtime', 'license'] as const) {
      const findings = validatePackage(withChapter('<p>a</p>', { [key]: '' })).findings;
      expect(findings.map((f) => f.path), `empty "${key}" must be rejected`)
        .toContain(`manifest.json#/${key}`);
    }
    expect(codesOf(withChapter('<p>a</p>', { authors: [{ name: '' }] }))).toContain('MANIFEST_FIELD');
    // …and the deliberate exception stays: `description` MAY be empty.
    expect(validatePackage(withChapter('<p>a</p>', { description: '' })).ok).toBe(true);
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
    // Prose that talks *about* event handlers is the common case in a course,
    // and the parser settles it without a rule of its own: this is a character
    // token, not a start tag with an attribute.
    const r = validatePackage(withChapter('<p>Thuộc tính onclick = mã chạy khi bấm.</p>'));
    expect(r).toEqual({ ok: true, findings: [] });
  });

  it('EVENT_HANDLER_ATTR: handler nấp sau dấu ">" trong giá trị thuộc tính có nháy', () => {
    // Measured miss of the first draft: `[^>]*` stops at the `>` inside
    // `title="a>b"`, so the handler after it was never seen. Patched once with
    // a second pattern that required the handler value to be QUOTED, which
    // review round 1 then walked around by dropping the quotes — see the C2
    // block below. A tokenizer knows a `>` inside a quoted value is not the
    // end of the tag, and needs no pattern for it at all.
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
// Review round 1 — the three measured bypasses of the regex scan, verbatim.
//
// Every case below was run in Chromium through `container.innerHTML = html`
// (the reader's real injection path, ChapterView.tsx:335) and OBSERVED TO
// EXECUTE while `validatePackage` returned zero findings. They are the reason
// this module parses HTML instead of guessing where one attribute ends and the
// next begins. Do not "simplify" the scan back to a regex.
// ---------------------------------------------------------------------------

describe('C1 — HTML separates attributes with more than whitespace', () => {
  // `<img/onerror=…>`: `/` in a start tag is a parse error
  // (`unexpected-solidus-in-tag`) and the character is REPROCESSED in the
  // before-attribute-name state, so the handler is a real attribute.
  it('dấu "/" tách thuộc tính: <img/onerror=…>', () => {
    expect(codesOf(withChapter('<img/onerror=window.C1() src="no-1.png">'))).toContain('EVENT_HANDLER_ATTR');
  });

  // `…"onerror=…`: the closing quote of a value also ends the attribute
  // (`missing-whitespace-between-attributes`, likewise reprocessed).
  it('nháy đóng tách thuộc tính: <img src="x"onerror=…>', () => {
    expect(codesOf(withChapter('<img src="no-2.png"onerror=window.C2()>'))).toContain('EVENT_HANDLER_ATTR');
  });

  it('cả hai cùng lúc trong SVG: <svg/onload=…>', () => {
    expect(codesOf(withChapter('<svg/onload=window.C5()></svg>'))).toContain('EVENT_HANDLER_ATTR');
  });
});

describe('C2 — an UNQUOTED handler behind a ">" trapped in an attribute value', () => {
  it('nháy kép: <img title="a>b" onerror=… src=…>', () => {
    expect(codesOf(withChapter('<img title="a>b" onerror=window.C8() src="no-3.png">'))).toContain('EVENT_HANDLER_ATTR');
  });

  it('nháy đơn: <img title=\'a>b\' onerror=… src=…>', () => {
    expect(codesOf(withChapter("<img title='a>b' onerror=window.C9() src='no-4.png'>"))).toContain('EVENT_HANDLER_ATTR');
  });
});

describe('C3 — the scan may not be keyed on a file extension', () => {
  // The old scan only read `.html?/.xhtml/.svg`. No rule constrains the
  // extension of `chapter.file`, and `loadChapter` fetches whatever the
  // manifest names, so renaming the chapter turned off all five content rules.
  const payload = '<script>a()</script><img src=x onerror="a()">';
  const chapterNamed = (file: string) =>
    new Map([
      ['manifest.json', MANIFEST({
        parts: [{ title: 'P', chapters: [{ id: 'c1', num: '1', title: 'T', short: 'T', file }] }],
      })],
      [file, enc(payload)],
    ]);

  for (const file of [
    'chapters/c1.txt', 'chapters/c1.md', 'chapters/c1.xhtm',
    'chapters/c1.html.bak', 'chapters/c1.htmlx', 'chapters/c1',
  ]) {
    it(`đổi tên chương thành "${file}" KHÔNG tắt được luật nào`, () => {
      const codes = codesOf(chapterNamed(file));
      expect(codes).toContain('SCRIPT_TAG');
      expect(codes).toContain('EVENT_HANDLER_ATTR');
    });
  }

  it('tệp không phải chương cũng được quét — không có danh sách đuôi nào cả', () => {
    // `assets/notes.md` is never fetched by today's reader, but "today's
    // reader" is not a rule. Scanning every entry is what makes the scope
    // impossible to rename around.
    const codes = codesOf(withChapter('<p>a</p>').set('assets/notes.md', enc(payload)));
    expect(codes).toContain('SCRIPT_TAG');
    expect(codes).toContain('EVENT_HANDLER_ATTR');
  });

  it('tệp NHỊ PHÂN cũng đi qua bộ quét, không bị bỏ vì "trông giống ảnh"', () => {
    // A PNG whose tEXt chunk carries live markup is a real shape: the byte
    // scan must not skip an entry because it has NUL bytes or an image
    // extension. Decoding is lossy on purpose — a byte that is not UTF-8 can
    // never be part of `<img … onerror=`, so the replacement character costs
    // nothing here.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      ...enc('<img src=x onerror="a()">'),
      0x00, 0xff, 0xfe,
    ]);
    expect(codesOf(withChapter('<p>a</p>').set('assets/hinh.png', png))).toContain('EVENT_HANDLER_ATTR');
  });
});

describe('B — a chapter that TEACHES HTML must be publishable at tier content', () => {
  // The documented escape hatch ("escape it and it is not flagged") did not
  // work: escaping only `<`/`>` — what every HTML generator does, and the only
  // form used by the 44 chapters that ship today — still left ` onclick="` in
  // the text, and the regex had no way to tell text from markup. A parser
  // does: escaped markup is a character token, live markup is a start tag.
  const teaching = [
    '<h2>Sự kiện trong HTML</h2>',
    '<p>Muốn chạy mã khi người dùng bấm, ta viết:</p>',
    '<pre><code>&lt;button onclick="chao()"&gt;Bấm tôi&lt;/button&gt;</code></pre>',
    '<pre><code>&lt;a href="javascript:void(0)"&gt;Không đi đâu cả&lt;/a&gt;</code></pre>',
  ].join('\n');

  it('escape kiểu thường (chỉ < và >) là ĐỦ — 0 finding', () => {
    expect(validatePackage(withChapter(teaching))).toEqual({ ok: true, findings: [] });
  });

  it('escape bằng nháy đơn cũng đủ', () => {
    expect(validatePackage(withChapter("<pre><code>&lt;button onclick='go()'&gt;x&lt;/button&gt;</code></pre>")).ok)
      .toBe(true);
  });

  it('văn xuôi nhắc javascript: trong <code> KHÔNG bị báo', () => {
    expect(validatePackage(withChapter('<p>Đừng viết <code>href="javascript:void(0)"</code>.</p>')).ok).toBe(true);
  });

  it('ĐỐI CHỨNG: đúng nội dung đó KHÔNG escape thì vẫn bị chặn', () => {
    // The other half of the measurement. "Escaped is clean" only means
    // something if "unescaped is flagged" is measured next to it.
    expect(codesOf(withChapter('<p><button onclick="chao()">Bấm tôi</button></p>'))).toContain('EVENT_HANDLER_ATTR');
    expect(codesOf(withChapter('<p><a href="javascript:void(0)">x</a></p>'))).toContain('JAVASCRIPT_URL');
  });

  it('ĐỐI CHỨNG: payload thô nhét trong <code> vẫn bị chặn — vùng code KHÔNG được miễn trừ', () => {
    // A tempting cheap fix was "ignore whatever is inside <pre>/<code>". That
    // is a hole: markup inside <code> that is NOT escaped is live markup.
    // Parsing gets both halves right without any region rule.
    expect(codesOf(withChapter('<pre><code><img src=x onerror="a()"></code></pre>')))
      .toContain('EVENT_HANDLER_ATTR');
  });
});

// ---------------------------------------------------------------------------
// Review round 2 — N1: the fix for the regex bypasses bought a DoS.
//
// parse5 drops duplicate attributes by scanning the attribute list it has built
// so far, once per attribute (`tokenizer/index.js:336`, `getTokenAttr`). That is
// O(n²) in the number of attributes on ONE start tag. Measured on HEAD 64c6459,
// before this block existed: 64,000 attributes = 552 KiB = 2.6% of the 20 MiB
// budget took 19,228 ms in Bun and 6,030 ms on the Chromium main thread, while
// the SAME byte count spread over many small tags took 38 ms / 28 ms. Size is
// not the discriminator, so TOO_LARGE cannot fence it; the old regex scan did
// the 4.7 MiB version in 21 ms.
//
// The budget assertions below are the point of these tests. Do not relax them
// into a plain "expect(codes).toContain(...)": a rule that is correct and takes
// six seconds is the bug this block exists to catch.
// ---------------------------------------------------------------------------

describe('N1 — một thẻ mở nhồi thuộc tính không được làm treo bộ kiểm định', () => {
  /**
   * Đo `validatePackage` trên đúng một chương, trả về mã finding + mili giây.
   *
   * `Date.now()` and not `performance.now()`: this package's `env.d.ts`
   * declares only the two Encoding globals on purpose, and the difference
   * being measured here is 8,500 ms against 1,000 ms — a clock with 1 ms
   * resolution has three digits to spare.
   */
  const timed = (chapter: string): { codes: string[]; ms: number } => {
    const files = withChapter(chapter);
    const t0 = Date.now();
    const codes = codesOf(files);
    return { codes, ms: Date.now() - t0 };
  };

  // The timeout is deliberately far above the budget: when this regresses the
  // failure should read "took 19228 ms, expected < 1000" and not "test timed
  // out", because the number is the finding.
  it('64.000 thuộc tính trên MỘT thẻ (552 KiB) bị chặn TRONG ngân sách thời gian', { timeout: 120_000 }, () => {
    const { codes, ms } = timed(tagWithAttrs(64_000));
    expect(codes, 'thẻ nhồi thuộc tính phải sinh finding').toContain('TAG_ATTR_FLOOD');
    expect(ms, `mất ${ms.toFixed(0)} ms — bậc hai đã quay lại`).toBeLessThan(1000);
  });

  it('CÙNG số byte trải trên NHIỀU thẻ vẫn tuyến tính và vẫn sạch', { timeout: 120_000 }, () => {
    // The control that proves the fence is on the right axis. This payload is
    // the same size as the one above and is legitimate markup; if a "fix" ever
    // fences total bytes or total attributes instead of attributes-per-tag,
    // this row is what goes red.
    const unit = '<img a=1 b=2 c=3 d=4>';
    const { codes, ms } = timed(unit.repeat(Math.ceil((533 * 1024) / unit.length)));
    expect(codes).toEqual([]);
    expect(ms, `mất ${ms.toFixed(0)} ms`).toBeLessThan(1000);
  });

  it('MAX_ATTRS_PER_TAG là ĐÚNG 1024 — con số, không phải quan hệ', () => {
    // Every other test here computes its fixture FROM the constant, so they
    // measure the boundary rule and would stay green with the ceiling raised to
    // a million — which would restore the DoS. This line is what makes the
    // number itself something a person has to change on purpose. It was chosen
    // from measured corpora (see the constant's own doc comment): the largest
    // attribute count any real input produced was 257, from minified JS
    // tokenized as markup; real HTML topped out at 7.
    expect(MAX_ATTRS_PER_TAG).toBe(1024);
  });

  it('biên: ĐÚNG trần thì sạch, trần + 1 thì báo', () => {
    expect(codesOf(withChapter(tagWithAttrs(MAX_ATTRS_PER_TAG)))).toEqual([]);
    expect(codesOf(withChapter(tagWithAttrs(MAX_ATTRS_PER_TAG + 1)))).toEqual(['TAG_ATTR_FLOOD']);
  });

  it('biên rộng: 257 thuộc tính — ca lành LỚN NHẤT đo được — vẫn sạch', () => {
    // `apps/web/dist/assets/index-*.js`, 376 KB of minified JavaScript, yields
    // one pseudo start tag with 257 "attributes" when tokenized as markup, and
    // this scan tokenizes every entry on purpose. A ceiling below that would
    // reject a package for shipping a normal bundle.
    expect(codesOf(withChapter(tagWithAttrs(257)))).toEqual([]);
  });

  it('thuộc tính TRÙNG TÊN không tính vào trần — HTML vốn vứt bản trùng đi', () => {
    // `'a=1 '.repeat(n)` is ONE attribute written n times, not n attributes.
    // Counting the discarded repeats would make the ceiling trivially reachable
    // by a document that is merely sloppy.
    expect(codesOf(withChapter(`<img ${'a=1 '.repeat(MAX_ATTRS_PER_TAG * 4)}>`))).toEqual([]);
  });

  it('khử trùng lặp giữ bản ĐẦU TIÊN — đúng như trình duyệt, nên bản sau là đồ chết', () => {
    // The O(1) name set replaces parse5's linear `getTokenAttr` scan, so the
    // rule it encodes is now this module's to keep: HTML keeps the FIRST
    // occurrence of a repeated attribute name. Measured consequence, pinned
    // here from the outside — a `javascript:` URL hidden in a SECOND `alt=`
    // never reaches the DOM, so it is correctly not reported…
    expect(validatePackage(withChapter('<img alt="an toàn" alt="javascript:alert(1)">')).ok).toBe(true);
    // …while the same value in the FIRST `alt=` is the live one, and is.
    expect(codesOf(withChapter('<img alt="javascript:alert(1)" alt="an toàn">'))).toContain('JAVASCRIPT_URL');
    // A duplicate name must not stop the attributes AFTER it being read.
    expect(codesOf(withChapter('<div id="a" id="b" onclick="x()">z</div>'))).toContain('EVENT_HANDLER_ATTR');
  });

  it('vượt trần NUỐT các luật khác trên CHÍNH thẻ đó — nhưng gói vẫn hỏng', () => {
    // The honest gap, written down instead of left to be discovered. Past the
    // ceiling the attributes are neither stored nor inspected, so an `onerror=`
    // hidden behind 1024 filler attributes is NOT reported as
    // EVENT_HANDLER_ATTR. It does not need to be: TAG_ATTR_FLOOD is itself a
    // finding, so `ok` is false and the package is refused. The tier's promise
    // is kept by rejecting the file, not by understanding it.
    const r = validatePackage(withChapter(tagWithAttrs(MAX_ATTRS_PER_TAG + 1, ' onerror=alert(1)')));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toEqual(['TAG_ATTR_FLOOD']);
  });

  it('trần áp cho MỖI thẻ, không phải cho cả tệp', () => {
    // Ten tags each just under the ceiling is a lot of attributes and still not
    // a flood: a per-file total would flag this, and it is legitimate.
    const many = Array.from({ length: 10 }, () => tagWithAttrs(MAX_ATTRS_PER_TAG - 1)).join('\n');
    expect(codesOf(withChapter(many))).toEqual([]);
  });

  it('sổ tên thuộc tính được ĐẶT LẠI ở mỗi thẻ — không rò từ thẻ này sang thẻ kia', () => {
    // The O(1) name set is per-tag state, and per-tag state that is not reset
    // is a miss, not just untidiness: without the reset the second `alt=` below
    // looks like a duplicate of the first tag's and is dropped unexamined, so a
    // live `javascript:` URL goes unreported.
    expect(codesOf(withChapter('<img alt="an toàn"><img alt="javascript:alert(1)">'))).toContain('JAVASCRIPT_URL');
    // …and the mirror image: a full tag must not spend the NEXT tag's budget.
    expect(validatePackage(withChapter(`${tagWithAttrs(MAX_ATTRS_PER_TAG)}<p b=1>`)).ok).toBe(true);
    expect(validatePackage(withChapter(`${tagWithAttrs(MAX_ATTRS_PER_TAG)}</p a=1>`)).ok).toBe(true);
  });

  it('THẺ ĐÓNG nhồi thuộc tính cũng bị chặn — cùng một đường tokenize', { timeout: 120_000 }, () => {
    // End tags carry nothing a browser executes, so no CONTENT rule reads them
    // (pinned elsewhere) — but the tokenizer still builds their attribute list,
    // so the quadratic ran there too. The resource fence is not a content rule
    // and does apply.
    const attrs = new Array<string>(64_000);
    for (let i = 0; i < 64_000; i++) attrs[i] = `a${i}=1`;
    const { codes, ms } = timed(`</p ${attrs.join(' ')}>`);
    expect(codes).toContain('TAG_ATTR_FLOOD');
    expect(ms, `mất ${ms.toFixed(0)} ms`).toBeLessThan(1000);
  });

  it("hạng 'interactive' không tokenize gì cả, nên không có đường DoS này", { timeout: 120_000 }, () => {
    // Where the fence is NOT needed, and why: `validatePackage` only tokenizes
    // for tier "content". Pinned so that a future task moving the scan out of
    // that branch has to look at this line first.
    const files = new Map([
      ['manifest.json', MANIFEST({ tier: 'interactive' })],
      ['chapters/c1.html', enc(tagWithAttrs(64_000))],
    ]);
    const t0 = Date.now();
    const r = validatePackage(files);
    expect(r).toEqual({ ok: true, findings: [] });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
// Review round 2 — N2: manifest.json is DATA, and scanning data for markup is a
// category error. Mutant M40 ("stop excluding manifest.json") survived the whole
// suite before this block existed, so the behaviour was pinned in neither
// direction. It is pinned in both here.
// ---------------------------------------------------------------------------

describe('N2 — manifest.json được LOẠI TRỪ khỏi luật markup, CÓ CHỦ Ý', () => {
  it('CÓ CHỦ Ý, KHÔNG PHẢI SƠ SUẤT: <script>/<form>/<iframe> trong tiêu đề & mô tả KHÔNG bị báo', () => {
    // Why this is safe: `manifest.title` and `manifest.description` reach the
    // screen as React text nodes (CourseHome.tsx:46-47, Dashboard.tsx:250) and
    // as `aria-label`, never as innerHTML — the string is inert.
    // Why the old behaviour had to go: a course ABOUT web forms could not name
    // the tags it teaches, and there was no escape. `&lt;form&gt;` passed the
    // gate and then rendered as the literal characters `&lt;form&gt;` in the
    // catalog, because a text node is never un-escaped. Flagging it left the
    // author with no correct spelling at all.
    for (const description of [
      'Khoá học về thẻ <form> và cách gửi dữ liệu',
      'Nhúng nội dung bằng <iframe> và <object>',
      'Vì sao <script> lại nằm cuối <body>',
    ]) {
      expect(validatePackage(withChapter('<p>a</p>', { description })).ok, description).toBe(true);
    }
    expect(validatePackage(withChapter('<p>a</p>', { title: 'Thẻ <script> trong HTML' })).ok).toBe(true);
    // …including a payload that WOULD be live markup in a chapter file.
    expect(validatePackage(withChapter('<p>a</p>', {
      description: '<img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>',
    })).ok).toBe(true);
  });

  it('loại trừ là theo ĐƯỜNG DẪN manifest.json, không phải theo đuôi .json', () => {
    // The exception is about one file whose meaning this module defines, not
    // about a file type. Any other entry — `.json` included — is still content
    // some consumer may render, and C3 is the lesson about keying on names.
    expect(codesOf(withChapter('<p>a</p>').set('data/cauhoi.json', enc('{"q":"<img src=x onerror=a()>"}'))))
      .toContain('EVENT_HANDLER_ATTR');
    expect(codesOf(withChapter('<p>a</p>').set('chapters/manifest.json', enc('<script>a</script>'))))
      .toContain('SCRIPT_TAG');
  });

  it('luật CẤU TRÚC của manifest thì KHÔNG được nới — chỉ năm luật HTML thôi nghỉ đọc nó', () => {
    // The other half of the decision. Excluding the manifest from the markup
    // rules must not quietly exclude it from the rules that are actually about
    // it; if a future edit skips the file too early, this is what goes red.
    expect(codesOf(new Map([['manifest.json', enc('{ hong')]]))).toContain('MANIFEST_PARSE');
    expect(codesOf(withChapter('<p>a</p>', { license: '' }))).toContain('MANIFEST_FIELD');
    expect(codesOf(withChapter('<p>a</p>', { version: '1.0' }))).toContain('SEMVER');
    expect(codesOf(withChapter('<p>a</p>', { runtime: 'latest' }))).toContain('RUNTIME_RANGE');
    expect(codesOf(new Map([['manifest.json', MANIFEST()]]))).toContain('CHAPTER_FILE_MISSING');
  });
});

describe('N3/N4 — ba dạng dương tính giả, và lối thoát KHÁC NHAU của từng dạng', () => {
  it('dạng 1 — ví dụ markup sống: escape LÀ lối thoát và nó chạy được', () => {
    expect(codesOf(withChapter('<p><button onclick="chao()">Bấm</button></p>'))).toContain('EVENT_HANDLER_ATTR');
    expect(validatePackage(withChapter('<p>&lt;button onclick="chao()"&gt;Bấm&lt;/button&gt;</p>')).ok).toBe(true);
  });

  it('dạng 2 — entry KHÔNG PHẢI HTML bị chặn oan, và KHÔNG có escape nào', () => {
    // Markdown, JSON data and CSS comments do not escape HTML, because in their
    // own formats there is nothing to escape. The scan reads package entries,
    // not fenced blocks. Deliberate — the alternative is C3's hole — but it was
    // missing from the table, so pin the rows.
    const md = '# Bài\n\n```html\n<iframe src="x"></iframe>\n<form></form>\n```\n';
    expect(codesOf(withChapter('<p>a</p>').set('src/c1.md', enc(md)))).toEqual(['EMBEDDED_FRAME', 'FORM_TAG']);
    expect(codesOf(withChapter('<p>a</p>').set('data/q.json', enc('{"q":"<img src=x onerror=\\"a()\\">"}'))))
      .toEqual(['EVENT_HANDLER_ATTR']);
    expect(codesOf(withChapter('<p>a</p>').set('css/x.css', enc('/* <img src=x onerror="a()"> */\n.a{color:red}'))))
      .toEqual(['EVENT_HANDLER_ATTR']);

    // The other half: entries that look markup-ish and are correctly clean.
    const clean: [string, string][] = [
      ['css/y.css', 'a[href^="javascript:"]{color:red}'],
      ['css/z.css', '.a::before{content:"<"}'],
      ['h.svg', '<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:red}</style><rect class="a"/></svg>'],
      ['LICENSE', 'MIT License\n\nCopyright (c) 2026\n'],
      ['ok.md', 'Viết `&lt;form&gt;` để hiện chữ.\n'],
    ];
    for (const [path, body] of clean) {
      expect(validatePackage(withChapter('<p>a</p>').set(path, enc(body))).ok, path).toBe(true);
    }
  });

  it('dạng 3 — văn xuôi trong GIÁ TRỊ thuộc tính: escape KHÔNG cứu được', () => {
    // The sentence this replaces promised "escape the markup" for every false
    // positive. Measured false: the tokenizer decodes character references
    // inside attribute values exactly as a browser does, so the escaped form is
    // flagged too.
    expect(codesOf(withChapter('<abbr title="javascript: ngôn ngữ">JS</abbr>'))).toContain('JAVASCRIPT_URL');
    expect(codesOf(withChapter('<abbr title="&#106;avascript: ngôn ngữ">JS</abbr>'))).toContain('JAVASCRIPT_URL');
    expect(codesOf(withChapter('<img alt="javascript: ví dụ" src="a.png">'))).toContain('JAVASCRIPT_URL');

    // The three ways out that DO work, each measured.
    expect(validatePackage(withChapter('<p>&lt;abbr title="javascript: ngôn ngữ"&gt;</p>')).ok).toBe(true);
    expect(validatePackage(withChapter('<p>javascript: là một scheme</p>')).ok).toBe(true);
    expect(validatePackage(withChapter('<abbr title="ngôn ngữ javascript:">JS</abbr>')).ok).toBe(true);
  });
});

describe('những gì bộ quét cũ bỏ sót vì nó không phải parser', () => {
  it('entity CÓ TÊN trong URL: java&Tab;script: — parser giải mã, regex thì không', () => {
    expect(codesOf(withChapter('<a href="java&Tab;script:alert(1)">x</a>'))).toContain('JAVASCRIPT_URL');
  });

  it('<body onload=…> — chạy khi mở thẳng tệp chương như một tài liệu', () => {
    expect(codesOf(withChapter('<body onload=alert(1)>hi'))).toContain('EVENT_HANDLER_ATTR');
  });

  it('<!--> đóng comment sớm rồi tiêm markup sống', () => {
    expect(codesOf(withChapter('<!--><img src=x onerror=alert(1)>-->'))).toContain('EVENT_HANDLER_ATTR');
  });

  it('comment THẬT thì không bị báo — nội dung trong comment không chạy', () => {
    expect(validatePackage(withChapter('<!-- <img src=x onerror=alert(1)> -->')).ok).toBe(true);
  });

  it('thuộc tính trên THẺ ĐÓNG không bị báo — trình duyệt vứt chúng đi', () => {
    // Only START tags are inspected, and that is a decision, not an oversight:
    // measured in Chromium, `<div id=t>x</div onclick="…">` builds an element
    // whose attribute list is exactly ["id"] — the end tag's attributes are a
    // parse error the tree builder discards, and clicking it runs nothing.
    // Without this line the mutant "treat end tags like start tags" survives:
    // the whole suite stays green because that mutation only over-reports.
    expect(validatePackage(withChapter('<div id="t">x</div onclick="alert(1)">')).ok).toBe(true);
  });

  it('javascript: ở thuộc tính KHÔNG phải href/src cũng bị bắt (<animate to=…>)', () => {
    // The SVG animation route to a javascript: URL: `<animate>` rewrites the
    // <a> element's href at run time. Scanning every attribute value costs
    // nothing and closes it.
    expect(codesOf(withChapter('<svg><a><animate attributeName="href" to="javascript:alert(1)"/><text>x</text></a></svg>')))
      .toContain('JAVASCRIPT_URL');
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
  feed(withChapter(tagWithAttrs(MAX_ATTRS_PER_TAG + 1)));
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

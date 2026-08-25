import { describe, expect, it } from 'vitest';
import { validatePackage } from './validate';
import {
  WIDGET_FORBIDDEN_APIS,
  WIDGET_MAX_BYTES,
  WIDGET_MAX_LINE_BYTES,
  WIDGET_NAME_MAX,
  extractWidgetRefs,
} from './widgets';
import { codesOf, enc, withChapter } from './test-fixtures';

/**
 * The widget the task brief gives as the "this must validate clean" example:
 * a counter button, self-contained, nothing minified, nothing networked.
 * Reused across every test here that needs a widget with no complaints of its
 * own, so a failure in an unrelated rule's test can't be this snippet's fault.
 */
const VALID_WIDGET_HTML = `<style>button{font-size:2rem}</style>
<button id="b">0</button>
<script>
  let n = 0;
  document.getElementById('b').addEventListener('click', () => {
    n += 1;
    document.getElementById('b').textContent = String(n);
  });
</script>`;

describe('checkWidgets — tám luật', () => {
  it('WIDGET_TOO_LARGE: index.html của một widget vượt trần WIDGET_MAX_BYTES', () => {
    const files = withChapter('<div data-widget="big"></div>')
      .set('widgets/big/index.html', new Uint8Array(WIDGET_MAX_BYTES + 1));
    const findings = validatePackage(files).findings;
    const f = findings.find((x) => x.code === 'WIDGET_TOO_LARGE');
    expect(f?.path).toBe('widgets/big/index.html');
    expect(f?.detail).toContain(String(WIDGET_MAX_BYTES + 1));
  });

  it('WIDGET_TOO_LARGE: ĐÚNG trần thì sạch, trần + 1 thì báo', () => {
    const atCap = withChapter('<div data-widget="w"></div>')
      .set('widgets/w/index.html', enc('a'.repeat(WIDGET_MAX_BYTES)));
    expect(codesOf(atCap)).not.toContain('WIDGET_TOO_LARGE');
    const overCap = withChapter('<div data-widget="w"></div>')
      .set('widgets/w/index.html', enc('a'.repeat(WIDGET_MAX_BYTES + 1)));
    expect(codesOf(overCap)).toContain('WIDGET_TOO_LARGE');
  });

  it('WIDGET_LINE_TOO_LONG: một dòng vượt trần WIDGET_MAX_LINE_BYTES byte, detail nêu đúng số dòng', () => {
    const longLine = 'a'.repeat(WIDGET_MAX_LINE_BYTES + 1);
    const files = withChapter('<div data-widget="long"></div>')
      .set('widgets/long/index.html', enc(`<p>ok</p>\n${longLine}\n<p>ok nữa</p>`));
    const findings = validatePackage(files).findings;
    const f = findings.find((x) => x.code === 'WIDGET_LINE_TOO_LONG');
    expect(f?.path).toBe('widgets/long/index.html');
    // Dòng dài là dòng thứ 2 (1-based): dòng 1 là "<p>ok</p>", dòng 3 thì sạch.
    expect(f?.detail).toContain('dòng 2');
  });

  it('WIDGET_LINE_TOO_LONG: không báo khi mọi dòng đều dưới trần', () => {
    expect(codesOf(
      withChapter('<div data-widget="ok"></div>').set('widgets/ok/index.html', enc(VALID_WIDGET_HTML)),
    )).not.toContain('WIDGET_LINE_TOO_LONG');
  });

  it('WIDGET_LINE_TOO_LONG: ĐÚNG trần thì sạch, trần + 1 thì báo — tính theo BYTE, không theo ký tự', () => {
    const atCap = withChapter('<p>a</p>').set('widgets/w/index.html', enc('a'.repeat(WIDGET_MAX_LINE_BYTES)));
    expect(codesOf(atCap)).not.toContain('WIDGET_LINE_TOO_LONG');
    const overCap = withChapter('<p>a</p>').set('widgets/w/index.html', enc('a'.repeat(WIDGET_MAX_LINE_BYTES + 1)));
    expect(codesOf(overCap)).toContain('WIDGET_LINE_TOO_LONG');
    // Một dòng tiếng Việt NGẮN HƠN trần theo SỐ KÝ TỰ nhưng DÀI HƠN trần theo SỐ
    // BYTE ('ơ' chiếm 2 byte UTF-8) vẫn phải bị bắt — nếu luật lỡ đếm theo
    // `.length` (UTF-16 code unit) thay vì byte, ca này xanh oan.
    const vietnameseLine = 'ơ'.repeat(Math.floor(WIDGET_MAX_LINE_BYTES / 2) + 1);
    expect(vietnameseLine.length).toBeLessThan(WIDGET_MAX_LINE_BYTES);
    expect(codesOf(withChapter('<p>a</p>').set('widgets/w/index.html', enc(vietnameseLine)))).toContain('WIDGET_LINE_TOO_LONG');
  });

  it('WIDGET_BAD_NAME: tên có chữ hoa/gạch dưới bị bắt', () => {
    const files = withChapter('<p>a</p>').set('widgets/Bad_Name/index.html', enc(VALID_WIDGET_HTML));
    const findings = validatePackage(files).findings;
    const f = findings.find((x) => x.code === 'WIDGET_BAD_NAME');
    expect(f?.detail).toContain('Bad_Name');
  });

  it('WIDGET_BAD_NAME: tên dài quá WIDGET_NAME_MAX ký tự bị bắt, tên hợp lệ thì không', () => {
    const tooLong = 'a'.repeat(WIDGET_NAME_MAX + 1);
    expect(codesOf(
      withChapter('<p>a</p>').set(`widgets/${tooLong}/index.html`, enc(VALID_WIDGET_HTML)),
    )).toContain('WIDGET_BAD_NAME');
    const atCap = 'a'.repeat(WIDGET_NAME_MAX);
    expect(codesOf(
      withChapter('<p>a</p>').set(`widgets/${atCap}/index.html`, enc(VALID_WIDGET_HTML)),
    )).not.toContain('WIDGET_BAD_NAME');
  });

  it('WIDGET_FORBIDDEN_API: document.cookie/localStorage/sessionStorage/indexedDB đều bị bắt', () => {
    for (const api of WIDGET_FORBIDDEN_APIS) {
      const name = `w-${api.replace(/[^a-z]/gi, '').toLowerCase()}`;
      const files = withChapter(`<div data-widget="${name}"></div>`)
        .set(`widgets/${name}/index.html`, enc(`<script>${api}</script>`));
      const findings = validatePackage(files).findings;
      const f = findings.find((x) => x.code === 'WIDGET_FORBIDDEN_API');
      expect(f?.detail, `API "${api}" phải bị bắt`).toContain(api);
    }
  });

  it('WIDGET_FORBIDDEN_API: widget không đụng bốn API đó thì không bị báo', () => {
    expect(codesOf(
      withChapter('<div data-widget="ok"></div>').set('widgets/ok/index.html', enc(VALID_WIDGET_HTML)),
    )).not.toContain('WIDGET_FORBIDDEN_API');
  });

  it('WIDGET_EXTERNAL_URL: URL http(s):// bị bắt, kể cả nằm trong chú thích', () => {
    const files = withChapter('<div data-widget="net"></div>')
      .set('widgets/net/index.html', enc('<!-- https://evil.example/track.js -->'));
    const findings = validatePackage(files).findings;
    const f = findings.find((x) => x.code === 'WIDGET_EXTERNAL_URL');
    expect(f?.path).toBe('widgets/net/index.html');
    // Detail lấy nguyên văn từ task brief.
    expect(f?.detail).toBe('widget phải tự chứa: không tải gì từ mạng, kể cả trong chú thích — bỏ URL đi');
  });

  it('WIDGET_EXTRA_FILE: một tệp thứ hai cạnh index.html bị bắt, kể cả trong thư mục con', () => {
    const files = withChapter('<div data-widget="w"></div>')
      .set('widgets/w/index.html', enc(VALID_WIDGET_HTML))
      .set('widgets/w/assets/chart.js', enc('export function draw() {}'));
    const findings = validatePackage(files).findings;
    const f = findings.find((x) => x.code === 'WIDGET_EXTRA_FILE');
    expect(f?.path).toBe('widgets/w/assets/chart.js');
  });

  it('WIDGET_MISSING: chương tham chiếu widget không có trong gói, path là chương chứa ref', () => {
    const files = withChapter('<div data-widget="khong-co"></div>');
    const findings = validatePackage(files).findings;
    const f = findings.find((x) => x.code === 'WIDGET_MISSING');
    expect(f?.path).toBe('chapters/c1.html');
    expect(f?.detail).toContain('khong-co');
  });

  it('WIDGET_ORPHAN: widget có thật nhưng không chương nào tham chiếu, path là widgets/<tên>/index.html', () => {
    const files = withChapter('<p>không nhắc tới widget nào</p>')
      .set('widgets/mo-coi/index.html', enc(VALID_WIDGET_HTML));
    const findings = validatePackage(files).findings;
    const f = findings.find((x) => x.code === 'WIDGET_ORPHAN');
    expect(f?.path).toBe('widgets/mo-coi/index.html');
  });

  // Fix round 1, finding 1: một thư mục widgets/<tên>/ CHỈ có tệp thừa (không
  // có index.html) không phải một widget THẬT — dù `byName.has(name)` vẫn
  // đúng cho nó. Trước bản sửa này, chương tham chiếu một thư mục như vậy
  // không hề bị WIDGET_MISSING (thư mục "có tồn tại"), còn nếu không được
  // tham chiếu thì lại bị WIDGET_ORPHAN trỏ tới một index.html chưa từng
  // được tạo ra. Cả hai đều là báo sai.
  it('WIDGET_MISSING: thư mục widget CHỈ có tệp thừa, không có index.html, mà chương tham chiếu tới — vẫn phải báo thiếu', () => {
    const files = withChapter('<div data-widget="foo"></div>')
      .set('widgets/foo/notes.txt', enc('không phải index.html'));
    const findings = validatePackage(files).findings;
    expect(findings.map((f) => f.code)).toContain('WIDGET_MISSING');
    expect(findings.map((f) => f.code)).toContain('WIDGET_EXTRA_FILE'); // notes.txt vẫn là tệp thừa, độc lập với WIDGET_MISSING
    const missing = findings.find((f) => f.code === 'WIDGET_MISSING');
    expect(missing?.path).toBe('chapters/c1.html');
  });

  it('WIDGET_ORPHAN: thư mục widget CHỈ có tệp thừa, không có index.html, không được tham chiếu — KHÔNG được báo mồ côi', () => {
    const files = withChapter('<p>không nhắc tới widget nào</p>')
      .set('widgets/foo/notes.txt', enc('không phải index.html'));
    const findings = validatePackage(files).findings;
    // Không có index.html thì không có gì để "mồ côi" — path widgets/foo/index.html
    // chưa từng tồn tại trong gói. WIDGET_EXTRA_FILE là đủ để chỉ ra vấn đề thật.
    expect(findings.map((f) => f.code)).not.toContain('WIDGET_ORPHAN');
    expect(findings.map((f) => f.code)).toContain('WIDGET_EXTRA_FILE');
  });

  it('WIDGET_MISSING: data-widget="" không mang tên — detail phải nói đó là ô trống, không phải bịa ra một tên widget rỗng', () => {
    const files = withChapter('<div data-widget=""></div>');
    const findings = validatePackage(files).findings;
    const f = findings.find((x) => x.code === 'WIDGET_MISSING');
    expect(f?.path).toBe('chapters/c1.html');
    // Không được đọc như một cái tên widget hợp lệ tên là "" — câu phải nói
    // đây là một ô/placeholder chưa được điền tên, không phải trỏ tới
    // "widgets//index.html".
    expect(f?.detail).not.toContain('widgets//index.html');
    expect(f?.detail).toMatch(/không mang tên|chưa.*tên|placeholder/i);
  });
});

describe('extractWidgetRefs', () => {
  it('đọc được data-widget dù thuộc tính viết hoa/lẫn lộn (DATA-WIDGET)', () => {
    // parse5's tokenizer ASCII-lowercases every attribute NAME as part of
    // tokenizing (same fact `validate.ts`'s EVENT_HANDLER_NAME_RE comment
    // relies on for ONERROR) — so this is really a test that extractWidgetRefs
    // goes through that tokenizer rather than a hand-rolled, case-sensitive
    // string search.
    expect(extractWidgetRefs('<div DATA-WIDGET="demo"></div>')).toEqual(['demo']);
    expect(extractWidgetRefs('<div Data-Widget="demo2"></div>')).toEqual(['demo2']);
  });
});

it('gói có widget hợp lệ + chương trỏ đúng → 0 finding', () => {
  const files = withChapter('<p>Trước đó.</p><div data-widget="dem"></div><p>Sau đó.</p>')
    .set('widgets/dem/index.html', enc(VALID_WIDGET_HTML));
  expect(validatePackage(files)).toEqual({ ok: true, findings: [] });
});

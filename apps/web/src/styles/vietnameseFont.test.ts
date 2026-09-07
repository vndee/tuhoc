/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const READER_CSS = join(HERE, '../../../../packages/course-kit/reader.css');
const TOKENS_CSS = join(HERE, 'tokens.css');
const INDEX_CSS = join(HERE, 'index.css');
const STORIES_CSS = join(HERE, 'stories.css');

/**
 * DẤU TIẾNG VIỆT TRONG CHƯƠNG — và vì sao một cổng đọc CSS là chỗ đúng cho nó.
 *
 * Lỗi người đọc báo (07/09/2026): "chương" hiện thành "chuóng" — mất râu của
 * ư/ơ. Nguyên nhân không phải font xấu mà là DẢI FONT SAI: `reader.css` mở đầu
 * `--serif` bằng "Iowan Old Style", một font HỆ THỐNG của macOS, và không hề
 * nhắc Charis SIL — dù ứng dụng đã tải sẵn font ấy kèm subset `vietnamese`.
 *
 * Ba tính chất khiến lỗi này sống lâu, và cả ba đều nói rằng test phải nằm ở
 * TẦNG NGUỒN chứ không phải tầng render:
 *
 *   1. Nó phụ thuộc máy. Máy không có Iowan Old Style rơi xuống Georgia và
 *      hiện đúng, nên "trên máy tôi vẫn ổn" là câu trả lời thật thà mà vô ích.
 *   2. jsdom không tải font và không dựng chữ, nên KHÔNG một test render nào
 *      — cũ hay mới — có thể thấy được nó.
 *   3. Ảnh chụp màn hình cũng không cứu: nó chỉ chụp máy chạy CI.
 *
 * Nên cái đo được ở đây là điều kiện cần và kiểm được: dải font của trình đọc
 * phải DẪN ĐẦU bằng một font repo này thật sự đóng gói.
 */
describe('dải font của trình đọc phải dẫn đầu bằng font đóng gói', () => {
  const serifOf = (css: string, prop: string) => {
    const line = css.split('\n').find((l) => l.trim().startsWith(`${prop}:`));
    expect(line, `không tìm thấy ${prop}`).toBeDefined();
    return (line as string).slice((line as string).indexOf(':') + 1).replace(/;.*$/, '').trim();
  };

  const firstFamily = (stack: string) => stack.split(',')[0].trim().replace(/^['"]|['"]$/g, '');

  it('reader.css: --serif dẫn đầu bằng Charis SIL, không phải một font hệ máy', () => {
    const stack = serifOf(readFileSync(READER_CSS, 'utf-8'), '--serif');
    expect(firstFamily(stack)).toBe('Charis SIL');
    // Font hệ thống vẫn được giữ Ở SAU: tệp này còn phục vụ cả bản dựng không
    // có @font-face của ứng dụng, nơi thà xấu còn hơn không có chữ.
    expect(stack).toContain('serif');
  });

  it('reader.css và tokens.css không được nói hai điều khác nhau', () => {
    const reader = firstFamily(serifOf(readFileSync(READER_CSS, 'utf-8'), '--serif'));
    const app = firstFamily(serifOf(readFileSync(TOKENS_CSS, 'utf-8'), '--font-serif'));
    // Hai tệp từng lệch nhau chính xác theo kiểu này, và đó LÀ lỗi: vỏ ứng
    // dụng dùng Charis SIL trong khi chữ chương thì không.
    expect(reader).toBe(app);
  });

  it('font dẫn đầu ấy thật sự được nhập, không phải một cái tên hy vọng máy có', () => {
    const index = readFileSync(INDEX_CSS, 'utf-8');
    expect(index).toContain('@fontsource/charis-sil');
  });
});

/**
 * SERIF LÀ VĂN XUÔI, SANS LÀ NHÃN — một luật, hai thế giới.
 *
 * Trước 07/09/2026 hai thế giới dùng đúng hai mặt chữ ấy ở HAI VAI NGƯỢC NHAU:
 * trang chương có tiêu đề sans trên thân serif, trang đặc san có tiêu đề serif
 * trên thân sans. Không bên nào sai một mình — cái sai chỉ hiện ra khi người
 * đọc đi từ bên này sang bên kia và thấy chữ lộn vai.
 *
 * Lý do nó xảy ra là cấu trúc, nên nó sẽ tái diễn nếu không có cổng: mỗi thế
 * giới có một NỀN THỪA KẾ khác nhau, và mỗi tệp CSS chỉ làm đúng một việc là
 * ghi đè tiêu đề ngược lại nền của nó.
 */
describe('serif là văn xuôi, sans là nhãn', () => {
  /** Đọc `font-family: var(--x)` bên trong ĐÚNG khối của selector.
   *  Cắt tới dấu `}` chứ không cắt theo một số ký tự cố định: bản đầu lấy 400
   *  ký tự và trả về null cho chính khối vừa sửa, vì khối ấy mở đầu bằng một
   *  đoạn chú thích dài hơn thế. Một helper đo hụt sẽ báo đỏ ở chỗ code đúng,
   *  và lần sau người ta sửa code thay vì sửa helper. */
  const decl = (css: string, selector: string) => {
    const i = css.indexOf(selector);
    expect(i, `không tìm thấy ${selector}`).toBeGreaterThan(-1);
    const end = css.indexOf('}', i);
    const block = css.slice(i, end === -1 ? undefined : end);
    const m = block.match(/font-family\s*:\s*var\(--([a-z-]+)\)/);
    return m ? m[1] : null;
  };

  it('bốn cấp tiêu đề của chương dùng serif, không phải sans', () => {
    const css = readFileSync(READER_CSS, 'utf-8');
    for (const sel of ['h1.ch-title{', 'h2{', 'h3{', 'h4{']) {
      expect(decl(css, sel), `${sel} phải là var(--serif)`).toBe('serif');
    }
  });

  it('nhãn trong chương VẪN là sans — luật này không nuốt cả nhãn', () => {
    const css = readFileSync(READER_CSS, 'utf-8');
    // `.ch-eyebrow` in hoa, giãn chữ: nhãn, không phải tiêu đề. Nếu một đợt
    // "thống nhất font" sau này kéo luôn nó sang serif thì cổng này đỏ.
    expect(decl(css, '.ch-eyebrow{')).toBe('sans');
    expect(decl(css, '.box .box-h{')).toBe('sans');
  });

  it('đặc san khai font thân bài tường minh, không thừa kế vỏ app', () => {
    const css = readFileSync(STORIES_CSS, 'utf-8');
    // Thân bài đặc san từng là sans chỉ vì không ai khai gì và nó thừa kế vỏ
    // app. Một mặt chữ quyết định bởi thừa kế sẽ lật khi vỏ đổi.
    expect(decl(css, '.story-shell-theme-scope {')).toBe('font-serif');
    // Còn thanh trên là giao diện, nên nó phải lấy lại sans — thiếu dòng ấy
    // thì "Trở lại các số đặc san" thành serif.
    expect(decl(css, '.story-shell-header {')).toBe('font-sans');
  });
});

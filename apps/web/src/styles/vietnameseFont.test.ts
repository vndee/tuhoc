/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const READER_CSS = join(HERE, '../../../../packages/course-kit/reader.css');
const TOKENS_CSS = join(HERE, 'tokens.css');
const INDEX_CSS = join(HERE, 'index.css');

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

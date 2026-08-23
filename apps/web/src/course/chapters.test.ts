import { describe, expect, it } from 'vitest';
import { countChapters, flatChapters, nextChapter } from './chapters';
import type { Manifest } from './types';

/**
 * `flatChapters` là mẫu số của mọi thanh tiến độ trong ứng dụng, và nó nhận
 * `unknown` vì `course/loader.ts`'s `isManifestShape` chỉ hứa
 * `Array.isArray(m.parts)` — không hứa gì về `part.chapters`, không hứa gì về
 * từng chương. Một gói người dùng tự nhập không đi qua registry nào, nên hình
 * dạng bên dưới là đường THẬT chứ không phải một giả thiết.
 */

function manifest(parts: Manifest['parts']): Manifest {
  return { id: 'c', title: 'T', description: '', lang: 'vi', version: '1.0.0', runtime: '^1', parts };
}

describe('flatChapters', () => {
  it('phẳng hoá theo đúng thứ tự đọc, xuyên qua nhiều phần', () => {
    const m = manifest([
      { title: 'P1', chapters: [{ id: 'a', num: '1', title: 'A', short: 'A', file: 'a.html' }] },
      {
        title: 'P2',
        chapters: [
          { id: 'b', num: '2', title: 'B', short: 'B', file: 'b.html' },
          { id: 'c', num: '3', title: 'C', short: 'C', file: 'c.html' },
        ],
      },
    ]);
    expect(flatChapters(m).map((chapter) => chapter.id)).toEqual(['a', 'b', 'c']);
    expect(countChapters(m)).toBe(3);
  });

  it('một `part` không mang `chapters` KHÔNG ném — mã cũ của trang chủ thì có', () => {
    // `manifest.parts.reduce((sum, part) => sum + part.chapters.length, 0)` là
    // nguyên văn phép đếm cũ, và nó ném `TypeError` giữa lúc vẽ ở đây.
    expect(() => flatChapters({ parts: [{ title: 'P' }] })).not.toThrow();
    expect(countChapters({ parts: [{ title: 'P' }, { title: 'Q', chapters: null }] })).toBe(0);
  });

  it('chương thiếu `id` bị bỏ qua, không được cấp id giả', () => {
    // `id` là thứ `/c/:courseId/:chapterId` mang đi. Một liên kết tới chương
    // không tồn tại là ngõ cụt đội lốt hành động.
    const chapters = flatChapters({
      parts: [{ chapters: [{ num: '1', title: 'Không id' }, { id: '', title: 'Rỗng' }, { id: 'ok', title: 'Được' }] }],
    });
    expect(chapters.map((chapter) => chapter.id)).toEqual(['ok']);
  });

  it('trường chữ thiếu hoặc sai kiểu lùi về giá trị dùng được, không lùi về undefined', () => {
    const [chapter] = flatChapters({ parts: [{ chapters: [{ id: 'x', num: 7, title: null }] }] });
    expect(chapter).toEqual({ id: 'x', num: '', title: 'x', short: 'x', file: '' });
  });

  it('mọi thứ không phải manifest đều cho ra danh sách rỗng, không ném', () => {
    for (const value of [undefined, null, 0, 'manifest', {}, { parts: 'không phải mảng' }, { parts: [null, 3] }]) {
      expect(flatChapters(value), String(value)).toEqual([]);
    }
  });
});

describe('nextChapter', () => {
  const chapters = flatChapters(
    manifest([
      {
        title: 'P',
        chapters: ['a', 'b', 'c'].map((id) => ({ id, num: id, title: id, short: id, file: `${id}.html` })),
      },
    ]),
  );

  it('là chương ĐẦU TIÊN chưa đọc, không phải chương sau chương vừa đọc', () => {
    // Người học nhảy cóc xuống `c` rồi quay lại: luật "chương kế tiếp" sẽ đẩy
    // họ ra khỏi khoá học, luật này đưa họ về đúng chỗ hổng.
    expect(nextChapter(chapters, new Set(['c']))?.id).toBe('a');
    expect(nextChapter(chapters, new Set(['a']))?.id).toBe('b');
    expect(nextChapter(chapters, new Set())?.id).toBe('a');
  });

  it('đọc hết là `undefined` — một trạng thái, chỗ gọi vẫn phải cho ra nút bấm được', () => {
    expect(nextChapter(chapters, new Set(['a', 'b', 'c']))).toBeUndefined();
    expect(nextChapter([], new Set())).toBeUndefined();
  });
});

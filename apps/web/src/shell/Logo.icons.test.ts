/**
 * Buộc tệp biểu tượng đã ship phải khớp hình học của component.
 *
 * VÌ SAO BÀI NÀY TỒN TẠI: trong chính vòng dựng mark, `favicon.svg` và
 * `Logo.tsx` đã trôi ra khỏi nhau HAI lần. Lần một là di sản — favicon là
 * một tia sét tím không liên quan gì tới mark trên thanh điều hướng. Lần hai
 * là do một lượt sửa đổi hình trong component rồi quên sinh lại tệp. Cả hai
 * lần không gì báo, và `docs/icons.md` vẫn khẳng định chúng cùng một hình
 * học. Một lời khẳng định không ai kiểm là một lời khẳng định sẽ sai.
 *
 * Bài này đỏ khi ai đó đổi `MARK` mà quên chạy `node scripts/gen-icons.mjs`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Logo, MARK, MARK_ICON_GROUND, MARK_ICON_INK } from './Logo';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = path.join(WEB, 'public');
const ICONS = ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
const favicon = fs.readFileSync(path.join(PUBLIC, 'favicon.svg'), 'utf8');

const attr = (tag: string, name: string): string => {
  const m = tag.match(new RegExp(`${name}="([^"]+)"`));
  if (m === null) throw new Error(`favicon.svg: thẻ thiếu thuộc tính ${name} — ${tag}`);
  return m[1];
};
const rects = favicon.match(/<rect[^>]*\/>/g) ?? [];

/** `noUncheckedIndexedAccess` bật, nên chỉ số phải được thu hẹp tường minh —
 *  và một thẻ thiếu là một lỗi đáng nói ra chứ không phải `undefined` trôi đi. */
const rect = (i: number): string => {
  const r = rects[i];
  if (r === undefined) throw new Error(`favicon.svg: thiếu <rect> thứ ${i + 1}`);
  return r;
};

/**
 * MẮT XÍCH CÒN THIẾU. Ba bài dưới kia buộc TỆP vào `MARK`; bài này buộc
 * COMPONENT vào `MARK`. Thiếu nó thì chuỗi đứt đúng chỗ nguy hiểm nhất: JSX
 * từng gõ lại các con số thành hằng chữ, nên đổi `MARK` sẽ đổi favicon và bốn
 * PNG mà KHÔNG đổi thứ người dùng nhìn thấy trên thanh điều hướng — và mọi
 * bài test vẫn xanh.
 */
describe('component vẽ đúng hình học của MARK', () => {
  const markup = renderToStaticMarkup(createElement(Logo, { size: 64 }));

  it('khung lấy toạ độ, kích thước và độ mờ từ MARK', () => {
    expect(markup).toContain(`x="${MARK.frame.x}"`);
    expect(markup).toContain(`y="${MARK.frame.y}"`);
    expect(markup).toContain(`width="${MARK.frame.w}"`);
    expect(markup).toContain(`height="${MARK.frame.h}"`);
    expect(markup).toContain(`opacity="${MARK.frame.opacity}"`);
  });

  it('nét lấy tâm và chiều dài từ MARK', () => {
    const m = markup.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="currentColor"/);
    expect(m, 'không tìm thấy <rect> của nét trong markup').not.toBeNull();
    const [, x, y, w, h] = m as RegExpMatchArray;
    expect(Number(x) + Number(w) / 2).toBeCloseTo(MARK.bar.cx, 5);
    expect(Number(y)).toBe(MARK.bar.y);
    expect(Number(h)).toBe(MARK.bar.h);
  });

  it('dạng app icon dùng inset của MARK, không phải một số gõ tay', () => {
    const boxed = renderToStaticMarkup(createElement(Logo, { size: 64, boxed: true }));
    expect(boxed).toContain(`scale(${MARK.inset.boxed})`);
    expect(boxed).toContain(MARK_ICON_GROUND);
  });
});

describe('favicon.svg khớp hình học của Logo', () => {
  it('có đúng ba <rect>: nền, khung, nét', () => {
    expect(rects).toHaveLength(3);
  });

  it('nền dùng đúng màu bảng đá của dạng app icon', () => {
    expect(attr(rect(0), 'fill')).toBe(MARK_ICON_GROUND);
  });

  it('khung khớp MARK.frame, kể cả độ mờ đã tính để đạt 3:1', () => {
    const f = rect(1);
    expect(Number(attr(f, 'x'))).toBe(MARK.frame.x);
    expect(Number(attr(f, 'y'))).toBe(MARK.frame.y);
    expect(Number(attr(f, 'width'))).toBe(MARK.frame.w);
    expect(Number(attr(f, 'height'))).toBe(MARK.frame.h);
    expect(Number(attr(f, 'opacity'))).toBe(MARK.frame.opacity);
    expect(attr(f, 'stroke')).toBe(MARK_ICON_INK);
  });

  it('nét nằm CHẾCH BÊN TRONG khung, không đè lên mép trái', () => {
    const b = rect(2);
    const x = Number(attr(b, 'x'));
    const w = Number(attr(b, 'width'));
    expect(x + w / 2).toBeCloseTo(MARK.bar.cx, 5);
    expect(Number(attr(b, 'y'))).toBe(MARK.bar.y);
    expect(Number(attr(b, 'height'))).toBe(MARK.bar.h);
    expect(x).toBeGreaterThan(MARK.frame.x);
  });

  it('nét vượt ra ngoài cả mép trên lẫn mép dưới của khung — đó là luận đề', () => {
    const b = rect(2);
    const top = Number(attr(b, 'y'));
    const bottom = top + Number(attr(b, 'height'));
    expect(top).toBeLessThan(MARK.frame.y);
    expect(bottom).toBeGreaterThan(MARK.frame.y + MARK.frame.h);
  });

  it('bốn tệp PNG tồn tại và không rỗng', () => {
    for (const n of ICONS) {
      expect(fs.statSync(path.join(PUBLIC, n)).size).toBeGreaterThan(400);
    }
  });

  /**
   * "Tồn tại và không rỗng" KHÔNG bắt được lỗi đã thật sự xảy ra: sửa hình
   * trong component rồi quên sinh lại — bốn tệp PNG vẫn tồn tại, vẫn không
   * rỗng, và vẫn mang hình cũ. Bài dưới đây sinh lại vào thư mục tạm rồi so
   * TỪNG BYTE, nên hình học của PNG bị buộc vào `MARK` y như favicon.
   *
   * Bỏ qua khi máy không có `rsvg-convert` (phụ thuộc hệ thống, không nằm
   * trong package.json) — và nói ra là đã bỏ qua, chứ không lặng lẽ xanh.
   */
  it('bốn tệp PNG khớp từng byte với bản sinh lại từ MARK', () => {
    const hasRsvg = (() => {
      try { execFileSync('rsvg-convert', ['--version'], { stdio: 'ignore' }); return true; }
      catch { return false; }
    })();
    if (!hasRsvg) {
      console.warn('[Logo.icons] bỏ qua so byte: máy này không có rsvg-convert');
      return;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tuhoc-icons-'));
    try {
      execFileSync('node', [path.join(WEB, 'scripts', 'gen-icons.mjs')], {
        env: { ...process.env, ICON_OUT: tmp },
        stdio: 'ignore',
      });
      for (const n of ICONS) {
        expect(
          fs.readFileSync(path.join(PUBLIC, n)).equals(fs.readFileSync(path.join(tmp, n))),
          `${n} khác bản sinh lại — chạy \`node scripts/gen-icons.mjs\``,
        ).toBe(true);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

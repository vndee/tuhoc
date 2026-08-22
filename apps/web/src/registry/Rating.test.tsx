import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { RatingSummary } from '../api/ratings';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { Rating } from './Rating';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const summary = (over: Partial<RatingSummary> = {}): RatingSummary => ({
  id: 'so-dau-phay-dong',
  average: 4.5,
  count: 12,
  mine: 0,
  ...over,
});

function renderRating(s: RatingSummary) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LanguageProvider>
        <Rating registryId={s.id} summary={s} />
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

/** Chữ mà một người đọc thật sự nhìn thấy. */
const visible = () => document.body.textContent ?? '';

/* ====================================================================== *
 * RÀNG BUỘC 2 — TRUNG BÌNH ĐI KÈM SỐ PHIẾU, LUÔN LUÔN
 * ====================================================================== */

describe('con số được vẽ ra', () => {
  it('vẽ CẢ trung bình lẫn số phiếu', () => {
    renderRating(summary({ average: 4.5, count: 12 }));
    expect(visible()).toContain('4,5');
    expect(visible()).toContain('12');
  });

  /**
   * BÀI CHỊU LỰC của ràng buộc 2.
   *
   * Không viết dưới dạng "có chứa số 200", vì một màn hình chỉ vẽ trung bình
   * vẫn có thể tình cờ chứa con số ấy ở chỗ khác. Viết dưới dạng **hai màn
   * hình phải KHÁC NHAU**: nếu chúng bằng nhau thì số phiếu không có mặt,
   * bất kể nó được vẽ thế nào.
   */
  it('5 sao / 1 phiếu KHÔNG trông giống 5 sao / 200 phiếu', () => {
    const { unmount } = renderRating(summary({ average: 5, count: 1 }));
    const motPhieu = visible();
    unmount();

    renderRating(summary({ average: 5, count: 200 }));
    const haiTramPhieu = visible();

    expect(motPhieu).not.toBe(haiTramPhieu);
    expect(motPhieu).toContain('1');
    expect(haiTramPhieu).toContain('200');
  });

  it('chưa ai chấm → nói ra điều đó, KHÔNG vẽ "0,0/5"', () => {
    renderRating(summary({ average: 0, count: 0 }));
    expect(visible()).toMatch(/chưa có phiếu nào/i);
    expect(visible()).not.toContain('0,0');
  });
});

/* ====================================================================== *
 * PHIẾU CỦA CHÍNH NGƯỜI GỌI — và không của ai khác
 * ====================================================================== */

describe('ô chấm sao', () => {
  it('có năm ô, dùng được bằng bàn phím (radio, có tên đọc được)', () => {
    renderRating(summary());
    const stars = screen.getAllByRole('radio');
    expect(stars).toHaveLength(5);
    expect(screen.getByRole('radio', { name: '3 sao' })).toBeInTheDocument();
  });

  it('phiếu CỦA MÌNH được đánh dấu sẵn; `mine = 0` nghĩa là chưa chấm', () => {
    const { unmount } = renderRating(summary({ mine: 4 }));
    expect(screen.getByRole('radio', { name: '4 sao' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '5 sao' })).not.toBeChecked();
    unmount();

    renderRating(summary({ mine: 0 }));
    expect(screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked)).toEqual([]);
  });

  it('bấm một sao → PUT /ratings/:registryId với ĐÚNG {"stars"}', async () => {
    let seen: { path: string; body: unknown } | null = null;
    server.use(
      http.put('/ratings/:id', async ({ request, params }) => {
        seen = { path: String(params.id), body: await request.json() };
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderRating(summary({ mine: 0 }));
    await userEvent.click(screen.getByRole('radio', { name: '4 sao' }));

    await waitFor(() => expect(seen).not.toBeNull());
    expect(seen).toEqual({ path: 'so-dau-phay-dong', body: { stars: 4 } });
  });

  it('SỬA ĐƯỢC: chấm lại một điểm khác gửi đi điểm mới', async () => {
    const sent: number[] = [];
    server.use(
      http.put('/ratings/:id', async ({ request }) => {
        sent.push(((await request.json()) as { stars: number }).stars);
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderRating(summary({ mine: 5 }));
    await userEvent.click(screen.getByRole('radio', { name: '2 sao' }));

    await waitFor(() => expect(sent).toEqual([2]));
  });
});

/* ====================================================================== *
 * HỎNG THÌ NÓI RA — không im lặng, không giả vờ đã lưu
 * ====================================================================== */

describe('khi máy chủ từ chối', () => {
  it('507 (đã chấm quá nhiều course) → câu nói rõ, KHÔNG phải "đã lưu"', async () => {
    server.use(
      http.put('/ratings/:id', () =>
        HttpResponse.json({ error: 'too many rated courses' }, { status: 507 }),
      ),
    );

    renderRating(summary({ mine: 0 }));
    await userEvent.click(screen.getByRole('radio', { name: '3 sao' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/quá nhiều/i);
    expect(visible()).not.toMatch(/đã lưu/i);
  });

  it('400 → câu khác hẳn câu của 507; hai lỗi không bị gộp làm một', async () => {
    server.use(http.put('/ratings/:id', () => HttpResponse.json({ error: 'invalid rating' }, { status: 400 })));
    renderRating(summary({ mine: 0 }));
    await userEvent.click(screen.getByRole('radio', { name: '3 sao' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent ?? '').not.toMatch(/quá nhiều/i);
    expect(alert.textContent ?? '').not.toBe('');
  });

  it('mạng chết → vẫn nói ra, và KHÔNG ném ra ngoài (trang không hỏng)', async () => {
    server.use(http.put('/ratings/:id', () => HttpResponse.error()));
    renderRating(summary({ mine: 0 }));
    await userEvent.click(screen.getByRole('radio', { name: '3 sao' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  });
});

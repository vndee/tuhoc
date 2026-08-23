import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, getConfig, render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { meQueryKey } from '../api/useMe';
import type { Manifest } from '../course/types';
import { clearLocalData, db } from '../db/local';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { Progress } from '../pages/Progress';
import { isoOfDayIndex, dayIndexOf } from '../progress/heat';

/**
 * `/progress` — **Tiến độ**, nơi các con số THUỘC VỀ.
 *
 * Ba tính chất mà đặc tả IA gọi tên, và mỗi tính chất là một lý do trang này
 * tồn tại tách khỏi trang chủ:
 *
 *  1. **Con số kể chuyện bằng CÂU.** Không phải hai ô đếm rời — đó chính là
 *     hình dạng đã biến màn hình đầu tiên của người dùng mới thành hai số 0.
 *  2. **Lịch nhiệt bảy tuần**, không phải một hộp gạch đứt.
 *  3. **Tiến độ theo khoá học**, có thanh và số chương từng phần.
 *
 * Và một tính chất KHÔNG nằm trong đặc tả nhưng nằm trong lịch sử repo này:
 * phần trăm mỗi khoá vẫn tính từ tiến độ CỤC BỘ (ruling F5), nên trang này
 * đúng cả khi `/stats` không về.
 */

const OVERSUBSCRIBED_WAIT_MS = 15_000;
const OVERSUBSCRIBED_MS = 30_000;

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const defaultAsyncUtilTimeout = getConfig().asyncUtilTimeout;
beforeAll(() => configure({ asyncUtilTimeout: OVERSUBSCRIBED_WAIT_MS }));
afterAll(() => configure({ asyncUtilTimeout: defaultAsyncUtilTimeout }));

beforeEach(clearLocalData);
afterEach(clearLocalData);

function demoManifest(chapterCount: number): Manifest {
  return {
    id: 'demo',
    title: 'Khóa học demo',
    description: 'Mô tả demo',
    lang: 'vi',
    version: '1.0.0',
    runtime: '^1',
    parts: [
      {
        title: 'Phần A',
        chapters: Array.from({ length: chapterCount }, (_, i) => ({
          id: `ch-${i + 1}`,
          num: `${i + 1}`,
          title: `Chương ${i + 1}`,
          short: `Chương ${i + 1}`,
          file: `chapters/ch-${i + 1}.html`,
        })),
      },
    ],
  };
}

/** Đúng hình dạng `GET /stats` trả về: 30 mục, cũ trước, hôm nay cuối. */
function thirtyDays(lastIso: string, minutesOf: (index: number) => number) {
  const last = dayIndexOf(lastIso) as number;
  return Array.from({ length: 30 }, (_, i) => ({ date: isoOfDayIndex(last - 29 + i), minutes: minutesOf(i) }));
}

const EMPTY_STATS = { totalMinutes: 0, streakDays: 0, days: [], courses: [] };

function stub(stats: Record<string, unknown>, courses: Record<string, unknown>[] = []) {
  server.use(http.get('/stats', () => HttpResponse.json(stats)));
  server.use(http.get('/courses', () => HttpResponse.json(courses)));
}

function renderProgress() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(meQueryKey, { id: 'u1', email: 'hoc@vien.vn', name: 'Người học' });
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <MemoryRouter initialEntries={['/progress']}>
          <Progress />
        </MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>,
  );
}

/** Ô của LƯỚI, không tính năm ô mẫu trong chú giải (chúng nằm ngoài `.prog-heat`). */
function heatCells(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.prog-heat .prog-heat-cell'));
}

describe('Tiến độ — con số kể thành CÂU', () => {
  it('một câu hoàn chỉnh, không phải hai ô đếm rời', async () => {
    stub({ ...EMPTY_STATS, totalMinutes: 42.4, streakDays: 3 });

    renderProgress();

    expect(await screen.findByText('Bạn đã học 42 phút, với chuỗi 3 ngày liên tục.')).toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);

  it('chuỗi 0 ngày được nói bằng một câu KHÁC — "với chuỗi 0 ngày liên tục" không ai nói thế', async () => {
    stub({ ...EMPTY_STATS, totalMinutes: 90, streakDays: 0 });

    renderProgress();

    expect(await screen.findByText(/Bạn đã học 90 phút\./)).toBeInTheDocument();
    expect(screen.queryByText(/chuỗi 0 ngày/)).not.toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);

  it('chưa học phút nào thì mời bắt đầu, không thông báo rằng bạn đã học 0 phút', async () => {
    stub(EMPTY_STATS);

    renderProgress();

    expect(await screen.findByText(/Chưa có phút học nào được ghi lại/)).toBeInTheDocument();
    expect(screen.queryByText(/0 phút/)).not.toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);

  it('/stats hỏng thì nói ra, và nói rằng phần này cần mạng', async () => {
    server.use(http.get('/stats', () => new HttpResponse(null, { status: 500 })));
    server.use(http.get('/courses', () => HttpResponse.json([])));

    renderProgress();

    expect(await screen.findByText(/cần mạng/i)).toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);

  it('/stats trả HTML (SPA fallback khi API chết) không làm trắng trang', async () => {
    server.use(http.get('/stats', () => HttpResponse.html('<!doctype html>\n<html lang="vi"><body></body></html>')));
    server.use(http.get('/courses', () => HttpResponse.json([])));

    renderProgress();

    expect(await screen.findByRole('heading', { name: /tiến độ/i })).toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);
});

describe('Tiến độ — lịch nhiệt bảy tuần', () => {
  it('bảy tuần là 49 ô, một ô một ngày', async () => {
    stub({ ...EMPTY_STATS, totalMinutes: 60, streakDays: 1, days: thirtyDays('2026-08-30', () => 0) });

    renderProgress();

    await waitFor(() => expect(heatCells()).toHaveLength(49));
  }, OVERSUBSCRIBED_MS);

  it('ô đậm là ngày CÓ học; ngày ngoài cửa sổ 30 ngày được vẽ khác hẳn ngày 0 phút', async () => {
    // 19 ô còn lại của lưới không có dữ liệu. Tô chúng như "ngày không học" là
    // báo với người đọc rằng họ đã nghỉ ba tuần, trong khi không ai hỏi.
    stub({
      ...EMPTY_STATS,
      totalMinutes: 120,
      streakDays: 2,
      days: thirtyDays('2026-08-30', (i) => (i === 29 ? 60 : 0)),
    });

    renderProgress();

    await waitFor(() => expect(heatCells()).toHaveLength(49));
    const cells = heatCells();
    expect(cells.filter((cell) => cell.classList.contains('prog-heat-unknown'))).toHaveLength(19);
    expect(cells.filter((cell) => cell.classList.contains('prog-heat-l0'))).toHaveLength(29);
    expect(cells.filter((cell) => cell.classList.contains('prog-heat-l4'))).toHaveLength(1);

    // Con số của từng ngày không mất — nó nằm trong `title`, nên nó tới được cả
    // chuột lẫn cây accessibility mà không bắt ai nghe đọc 49 ngày liên tiếp.
    const busiest = cells.find((cell) => cell.classList.contains('prog-heat-l4')) as HTMLElement;
    expect(busiest.getAttribute('title')).toBe('2026-08-30: 60 phút');
    const outside = cells.find((cell) => cell.classList.contains('prog-heat-unknown')) as HTMLElement;
    expect(outside.getAttribute('title')).toMatch(/ngoài phạm vi/);
  }, OVERSUBSCRIBED_MS);

  it('lưới có MỘT nhãn cho cả lịch, không phải 49 phần tử đọc được riêng lẻ', async () => {
    stub({ ...EMPTY_STATS, days: thirtyDays('2026-08-30', () => 0) });

    renderProgress();

    expect(await screen.findByRole('img', { name: /bảy tuần gần nhất, mỗi ô là một ngày/i })).toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);
});

describe('Tiến độ — theo khoá học', () => {
  it('thanh + số chương từng phần, và số chương đến từ tiến độ CỤC BỘ (ruling F5)', async () => {
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(demoManifest(4))));
    // Máy chủ nói 1 chương; máy nói 3. Ruling F5: cái đúng là cái trên máy —
    // đánh dấu đã đọc là một phép ghi cục bộ, và một thanh chỉ nhích sau khi
    // outbox flush được là một thanh nói dối trong mọi phiên offline.
    stub(
      {
        ...EMPTY_STATS,
        totalMinutes: 120,
        streakDays: 1,
        courses: [{ courseId: 'demo', minutes: 75.4, chaptersDone: 1 }],
      },
      [{ id: 'demo', title: 'Khóa học demo', lang: 'vi', tier: 'content', versions: ['1.0.0'], pinned: '1.0.0' }],
    );
    for (const id of ['ch-1', 'ch-2', 'ch-3']) {
      await db.progress.put({ courseId: 'demo', chapterId: id, status: 'read', done: true, updatedAt: '2026-08-20T00:00:00Z' });
    }

    renderProgress();

    const row = (await screen.findByRole('listitem')) as HTMLElement;
    // `findBy*`: `useProgress` là một `liveQuery` của Dexie, nên hàng xuất hiện
    // TRƯỚC khi số chương cục bộ về. Chờ ở đây là chờ đúng chuỗi ấy.
    expect(await within(row).findByText('3/4 chương')).toBeInTheDocument();
    expect(within(row).getByRole('img', { name: '75% hoàn thành' })).toBeInTheDocument();
    // `minutes` thì ngược lại — nó CHỈ tồn tại ở máy chủ, nên nó tới từ /stats.
    expect(within(row).getByText('75 phút đã học')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Khóa học demo' })).toHaveAttribute('href', '/c/demo');
  }, OVERSUBSCRIBED_MS);

  it('liệt kê khoá mà CHỈ máy này biết — danh sách khoá học là useOwnedCourses, không phải stats.courses', async () => {
    // `stats.courses[]` chỉ chứa khoá máy chủ đã thấy nhịp học hoặc chương hoàn
    // thành. Một khoá vừa nhập, hay một khoá đọc offline chưa kịp đồng bộ, sẽ
    // biến mất khỏi trang tiến độ trong khi `/courses` vẫn liệt kê nó — đúng
    // "hai màn hình, hai công thức, một câu hỏi" mà S1-F31 chấm dứt.
    server.use(http.get('/courses/demo/manifest.json', () => HttpResponse.json(demoManifest(2))));
    stub(EMPTY_STATS, []);
    await db.progress.put({ courseId: 'demo', chapterId: 'ch-1', status: 'read', done: true, updatedAt: '2026-08-20T00:00:00Z' });

    renderProgress();

    const row = (await screen.findByRole('listitem')) as HTMLElement;
    expect(await within(row).findByText('1/2 chương')).toBeInTheDocument();
    // Máy chủ không biết khoá này, nên không có số phút nào để in — và không
    // in `0 phút`, vì "không biết" khác "bằng không".
    expect(within(row).queryByText(/phút đã học/)).not.toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);

  it('manifest không về thì hàng vẫn hiện, với số chương đã đọc và KHÔNG có mẫu số đoán bừa', async () => {
    // `0/0` sẽ vẽ ra một thanh rỗng cho một người đã đọc mười chương.
    server.use(http.get('/courses/demo/manifest.json', () => new HttpResponse(null, { status: 404 })));
    stub(EMPTY_STATS, []);
    await db.progress.put({ courseId: 'demo', chapterId: 'ch-1', status: 'read', done: true, updatedAt: '2026-08-20T00:00:00Z' });
    await db.progress.put({ courseId: 'demo', chapterId: 'ch-2', status: 'read', done: true, updatedAt: '2026-08-20T00:00:00Z' });

    renderProgress();

    const row = (await screen.findByRole('listitem')) as HTMLElement;
    expect(await within(row).findByText('2 chương đã đọc')).toBeInTheDocument();
    expect(within(row).queryByText(/\d+\s*\/\s*0/)).not.toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);

  it('chưa có khoá nào là một HÀNH ĐỘNG, không phải một dòng chữ cụt', async () => {
    stub(EMPTY_STATS, []);

    renderProgress();

    expect(await screen.findByText(/Chưa có khoá học nào để đo/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /khoá học/i })).toHaveAttribute('href', '/courses');
  }, OVERSUBSCRIBED_MS);

  it('KHÔNG nháy "chưa có khoá nào" khi GET /courses còn đang bay', async () => {
    server.use(http.get('/stats', () => HttpResponse.json(EMPTY_STATS)));
    server.use(http.get('/courses', () => new Promise(() => {})));

    renderProgress();

    expect(await screen.findByText(/Chưa có phút học nào được ghi lại/)).toBeInTheDocument();
    expect(screen.queryByText(/Chưa có khoá học nào để đo/)).not.toBeInTheDocument();
  }, OVERSUBSCRIBED_MS);
});

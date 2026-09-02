/**
 * MỘT TRÌNH DUYỆT, HAI TÀI KHOẢN — cái outbox cũ không được gửi dưới cookie
 * của người khác.
 *
 * `db/legacyDrain.ts` là đường thoát một lần của thời Dexie: nó đọc cơ sở
 * dữ liệu `'tuhoc'` mà một bản dựng CŨ để lại và đẩy những hàng chưa gửi
 * lên `POST /sync`. `App.tsx` bắn nó đúng một lần mỗi lần tải trang, với
 * `[]` deps, và doc comment ở đó ghi rõ việc KHÔNG chặn theo phiên là cố ý:
 * *"một trình duyệt đã đăng xuất từ lâu, hay cookie đã hết hạn, vẫn cần
 * được xả cái outbox cũ của nó"*. Chính lập luận ấy đẻ ra lỗ rò.
 *
 * VÌ SAO PHÍA MÁY CHỦ KHÔNG CỨU ĐƯỢC. `sync/handler.go` gán `auth.UID(c)`
 * cho mọi hàng nhận được, và `upsertAnnotationSQL`'s
 * `AND annotations.user_id = EXCLUDED.user_id` chỉ nổ khi ĐỤNG KHOÁ CHÍNH —
 * mà một hàng outbox CHƯA GỬI, theo định nghĩa, chưa có hàng nào phía máy
 * chủ để đụng. Nó được INSERT: nguyên văn ghi chú của A, nằm dưới
 * `user_id` của B.
 *
 * ĐƯỜNG ĐI: trình duyệt của A còn một `'tuhoc'` với hàng chưa gửi (outbox
 * khác rỗng chính vì máy đã từng mất mạng). `clearSession()` không đụng tới
 * cơ sở dữ liệu ấy — bước xoá bảng Dexie đã đi cùng `clearLocalData()` khi
 * Task 10 gỡ Dexie — nên nó sống sót qua mọi lần đăng xuất. B đăng nhập
 * trên cùng máy; `Login.tsx` điều hướng phía client nên bộ rút không chạy
 * lại trong lần tải ấy. Tới LẦN TẢI TRANG SAU của B, bộ rút bắn, đẩy dưới
 * cookie của B, rồi `deleteLegacyDatabase()` xoá sạch tang chứng.
 *
 * HAI KHOÁ, hai bài kiểm, vì đường cũ có hai thứ đường mới không có:
 *
 *  1. `App.tsx`'s `useSyncLifecycle` chỉ khởi động engine cho một người
 *     ĐANG đăng nhập → bộ rút giờ cũng chỉ chạy khi `useMe` đã ngã ngũ và
 *     có người đăng nhập.
 *  2. `runCycle` hỏi `sessionWasSuperseded()` → bộ rút giờ cũng hỏi, ngay
 *     trước mỗi lần gửi (`db/legacyDrain.test.ts` giữ nửa ấy, ở mức đơn vị,
 *     nơi dựng được đúng thời điểm một tab khác chiếm phiên).
 *
 * Và một điều thứ ba, không phải "khoá" mà là trả lại một thứ đã mất: cơ
 * sở dữ liệu cũ LÀ nội dung của người dùng còn sót trên máy, đúng hình dạng
 * mà `SESSION_CLEARERS` sinh ra để canh — nên `clearSession()` xoá nó, y
 * như `clearLocalData()` của bản dựng cũ vẫn xoá bảng `outbox` ở cả hai
 * cửa đăng nhập/đăng xuất.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { useLegacyDrain } from '../App';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { Login } from '../pages/Login';
import { ThemeProvider } from '../theme/ThemeContext';

const A = { id: 'u-a', email: 'a@example.com', name: 'A' };
const B = { id: 'u-b', email: 'b@example.com', name: 'B' };

const LEGACY_DB_NAME = 'tuhoc';
const LEGACY_OUTBOX_STORE = 'outbox';

/** Ghi chú riêng của A, chưa bao giờ rời khỏi máy này. Đặc trưng đủ để mọi rò rỉ sang B là không thể nhầm. */
const A_PRIVATE = 'chỗ này mình vẫn chưa hiểu, thấy mình dốt quá';

/** Ai đang là chủ cookie ở thời điểm một request được phục vụ — cùng mô hình thời gian `test/accountHandoff.test.tsx` dùng. */
let currentAccount: typeof A | typeof B | null;
/** Mọi thân `POST /sync` mà "máy chủ" này từng nhận, kèm tài khoản của cookie mang nó. */
let pushes: { accountId: string; body: unknown }[];

const server = setupServer(
  http.get('/me', () => (currentAccount === null ? new HttpResponse(null, { status: 401 }) : HttpResponse.json(currentAccount))),
  http.post('/auth/login', () => {
    currentAccount = B;
    return HttpResponse.json(B);
  }),
  http.post('/sync', async ({ request }) => {
    pushes.push({ accountId: currentAccount?.id ?? 'anonymous', body: await request.json() });
    return HttpResponse.json({ applied: 0 });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

beforeEach(async () => {
  pushes = [];
  await deleteLegacyDatabase();
});

afterEach(async () => {
  server.resetHandlers();
  await deleteLegacyDatabase();
});

/** Dựng đúng thứ một bản dựng Dexie cũ để lại: `'tuhoc'`/`outbox` thô, không qua Dexie (nó đã rời khỏi cây phụ thuộc). Cùng helper `db/legacyDrain.test.ts` dùng. */
function seedLegacyOutbox(entries: { table: string; row: unknown }[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const openReq = indexedDB.open(LEGACY_DB_NAME, 1);
    openReq.onupgradeneeded = () => {
      openReq.result.createObjectStore(LEGACY_OUTBOX_STORE, { keyPath: 'seq', autoIncrement: true });
    };
    openReq.onsuccess = () => {
      const db = openReq.result;
      const tx = db.transaction(LEGACY_OUTBOX_STORE, 'readwrite');
      for (const entry of entries) tx.objectStore(LEGACY_OUTBOX_STORE).add(entry);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
    openReq.onerror = () => reject(openReq.error);
  });
}

function deleteLegacyDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

async function legacyDatabaseExists(): Promise<boolean> {
  return (await indexedDB.databases()).some((entry) => entry.name === LEGACY_DB_NAME);
}

/** A's unsent annotation row, exactly the shape `sync/handler.go` binds. */
function aUnsentNote() {
  return [
    {
      table: 'annotations',
      row: { id: '11111111-1111-4111-8111-111111111111', courseId: 'toan-roi-rac', chapterId: 'ch1', anchor: { exact: 'entropy' }, note: A_PRIVATE, updatedAt: '2026-08-01T00:00:00.000Z' },
    },
  ];
}

/**
 * MỘT LẦN TẢI TRANG. `useLegacyDrain` là hook THẬT, nhập từ `App.tsx` —
 * không phải một bản sao dựng trong tệp kiểm: cả giá trị của bài kiểm này
 * lẫn khả năng đột biến nó nằm ở chỗ nó khoá đúng đoạn dây thật.
 */
function PageLoad({ at = '/' }: { at?: string }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LanguageProvider>
          <MemoryRouter initialEntries={[at]}>
            <Drain />
            <Routes>
              <Route path="/" element={<p>Trang đọc</p>} />
              <Route path="/login" element={<Login />} />
            </Routes>
          </MemoryRouter>
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function Drain() {
  useLegacyDrain();
  return null;
}

/** B điền đúng biểu mẫu đăng nhập thật — cùng helper `test/eventQueueHandoff.test.tsx` dùng. */
async function bSignsIn(): Promise<void> {
  const user = userEvent.setup();
  await screen.findByLabelText(/email/i);
  await user.type(screen.getByLabelText(/email/i), B.email);
  await user.type(screen.getByLabelText(/^mật khẩu$/i), 'secret123');
  await user.click(screen.getByRole('button', { name: /đăng nhập/i }));
}

describe('outbox cũ của A không đi theo cookie của B', () => {
  it('ĐỐI CHỨNG: A còn đăng nhập trên chính máy này ⇒ outbox của A được xả, dưới tài khoản A, rồi cơ sở dữ liệu cũ bị xoá', async () => {
    currentAccount = A;
    await seedLegacyOutbox(aUnsentNote());

    render(<PageLoad />);

    await waitFor(() => expect(pushes).toHaveLength(1));
    expect(pushes[0].accountId).toBe('u-a');
    await waitFor(async () => expect(await legacyDatabaseExists()).toBe(false));
  });

  it('không ai đăng nhập ⇒ không gửi gì cả, và cơ sở dữ liệu cũ vẫn còn nguyên để chờ đúng chủ của nó', async () => {
    currentAccount = null;
    await seedLegacyOutbox(aUnsentNote());

    render(<PageLoad at="/login" />);
    await screen.findByLabelText(/email/i);

    // Đủ lâu để một `useEffect` không bị chặn đã kịp bắn và đi hết vòng
    // indexedDB → `POST /sync` (đối chứng ở trên hoàn tất trong cùng khoảng).
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(pushes).toEqual([]);
    expect(await legacyDatabaseExists()).toBe(true);
  });

  it('B đăng nhập trên máy của A, rồi tải lại trang: ghi chú của A không bao giờ tới máy chủ dưới tài khoản B', async () => {
    currentAccount = null;
    await seedLegacyOutbox(aUnsentNote());

    // LẦN TẢI 1 — khách vãng lai đứng ở màn đăng nhập, rồi B đăng nhập
    // thật (qua `<Login>` thật, tức `clearSession()` thật).
    const first = render(<PageLoad at="/login" />);
    await bSignsIn();
    await waitFor(() => expect(screen.getByText('Trang đọc')).toBeInTheDocument());
    first.unmount();

    // LẦN TẢI 2 — B mở lại ứng dụng. Đây là lần tải mà bản chưa sửa đẩy
    // outbox của A đi, dưới cookie của B.
    render(<PageLoad />);
    await waitFor(() => expect(screen.getByText('Trang đọc')).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(pushes.filter((p) => p.accountId === 'u-b')).toEqual([]);
    expect(JSON.stringify(pushes)).not.toContain(A_PRIVATE);
  });
});

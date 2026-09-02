/**
 * MỘT TRÌNH DUYỆT, HAI TAB, HAI TÀI KHOẢN — nửa mà Task 10 làm rơi.
 *
 * `sync/engine.ts`'s `runCycle` mở đầu bằng đúng một câu hỏi:
 *
 *     if (sessionWasSuperseded()) { stopSync(); return; }
 *
 * Đó là NƠI DUY NHẤT trong cả ứng dụng hỏi *dữ liệu này của ai* trước khi
 * gửi dữ liệu của một người học đi. Task 10 xoá engine ấy; hai người ghi
 * mới thế chỗ nó — bộ xả nhịp học (`api/events.ts`) và bộ rút outbox cũ
 * (`db/legacyDrain.ts`, xem `test/legacyDrainHandoff.test.tsx`) — và không
 * ai trong hai người hỏi câu ấy nữa. `auth/sessionIdentity.ts` vẫn còn,
 * vẫn chạy; nó chỉ mất hết người đọc.
 *
 * ĐƯỜNG ĐI CỦA LỖI, đúng như bản rà soát toàn nhánh mô tả:
 *
 *  1. Tab 2 đứng trên `/c/:courseId/:chapterId` — route CÔNG KHAI, cố ý
 *     nằm ngoài `<RequireAuth>` (`routes.tsx`). `useMe` đang cache là A
 *     (`staleTime: 60_000`, tab không focus), nên `AuthedReaderExtras` vẫn
 *     mount và `startHeartbeat` cứ 30s lại nối một sự kiện vào hàng đợi
 *     module.
 *  2. Ở tab 1, A đăng xuất và B đăng nhập. `clearSession()` chỉ chạy TRONG
 *     TAB 1 — nó là thứ cục bộ theo tab theo đúng thiết kế. Cái duy nhất
 *     tới được tab 2 là `announceSessionUser(null)` qua `BroadcastChannel`,
 *     và nó chỉ bật `superseded = true`.
 *  3. `startEventFlusher` bắn vô điều kiện trên nhịp 90 giây của nó, và
 *     `api/client.ts`'s `send()` luôn gửi `credentials: 'include'` — tức
 *     cookie của B.
 *  4. `stats.EventsBatch` ghi MỌI hàng bằng `auth.UID(c)` — B.
 *
 * Phút học của A được ghi vào tài khoản B, lặp đi lặp lại.
 *
 * HAI CỬA SỔ RÒ, hai bài kiểm riêng, vì chúng hỏng theo hai cách khác nhau:
 *
 *  - trong lúc còn `superseded`: mọi nhịp mới tab 2 xếp hàng (người đọc vẫn
 *    đang cuộn trang của A) vẫn sẽ được gửi đi dưới cookie của B;
 *  - SAU khi tab 2 tự làm mới `GET /me` và biết mình giờ là B: `superseded`
 *    bị xoá (đúng thiết kế — `announceSessionUser` xoá nó), nhưng hàng đợi
 *    thì KHÔNG ai xoá — `resetEventQueue()` chỉ được gọi từ
 *    `clearSession()`, và `clearSession()` không bao giờ chạy ở tab này.
 *
 * HAI TAB LÀ HAI ĐỒ THỊ MODULE THẬT, không phải stub — cùng cơ chế
 * `auth/supersededScreen.test.tsx` đã dựng: `vi.resetModules()` cho mỗi tab
 * một bản `sessionIdentity` (và, ở tab 2, một bản `api/events`) riêng, còn
 * `BroadcastChannel` là global của jsdom nên nó ĐƯỢC CHIA SẺ, đúng như hai
 * tab thật. Theo chuẩn, một `BroadcastChannel` không nhận thông điệp của
 * chính nó, nên một bài kiểm gọi `announceSessionUser` trong cùng một
 * module sẽ không bao giờ đo được điều nó định đo.
 */
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudyEvent } from '../api/events';

/** Tab 1 — chỉ công bố danh tính, không render gì. */
let tab1: typeof import('../auth/sessionIdentity');
/** Tab 2 — tab nền còn mở trên trang đọc của A. */
let tab2Identity: typeof import('../auth/sessionIdentity');
let tab2Events: typeof import('../api/events');

/** Mọi `POST /events/batch` mà "máy chủ" này từng nhận. */
let batches: StudyEvent[][];

const server = setupServer(
  http.post('/events/batch', async ({ request }) => {
    const body = (await request.json()) as { events: StudyEvent[] };
    batches.push(body.events);
    return HttpResponse.json({ accepted: body.events.length });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

beforeEach(async () => {
  batches = [];

  vi.resetModules();
  tab1 = await import('../auth/sessionIdentity');

  vi.resetModules();
  tab2Identity = await import('../auth/sessionIdentity');
  tab2Events = await import('../api/events');
});

afterEach(() => {
  tab1.__resetSessionIdentityForTests();
  tab2Identity.__resetSessionIdentityForTests();
  server.resetHandlers();
});

/** Nhịp học của A — `courseId` đặc trưng để mọi rò rỉ sang B là không thể nhầm. */
function aHeartbeat(at: string): StudyEvent {
  return { courseId: 'course-belongs-to-a', chapterId: 'ch1', kind: 'heartbeat', meta: {}, at };
}

/** Tab 1 làm trọn một lần bàn giao: A đăng xuất (`clearSession()` công bố `null`) rồi B đăng nhập. */
async function tab1HandsOverToB(): Promise<void> {
  tab1.announceSessionUser(null);
  tab1.announceSessionUser('u-b');
  await vi.waitFor(() => expect(tab2Identity.sessionWasSuperseded()).toBe(true));
}

describe('tab nền bị thay phiên: nhịp học của A không được ghi vào tài khoản B', () => {
  it('ĐỐI CHỨNG: chưa ai chiếm phiên thì nhịp của A vẫn được gửi bình thường', async () => {
    tab2Identity.announceSessionUser('u-a');
    tab2Events.queueEvent(aHeartbeat('2026-09-01T00:00:00.000Z'));

    await tab2Events.flushEvents();

    expect(batches).toHaveLength(1);
    expect(batches[0].map((e) => e.courseId)).toEqual(['course-belongs-to-a']);
  });

  it('trong lúc bị thay phiên: không một byte nào rời tab này, kể cả nhịp vừa xếp hàng sau bàn giao', async () => {
    tab2Identity.announceSessionUser('u-a');
    tab2Events.queueEvent(aHeartbeat('2026-09-01T00:00:00.000Z'));

    await tab1HandsOverToB();

    // Người đọc ở tab 2 vẫn đang cuộn trang của A: `startHeartbeat` không
    // biết gì về phiên và cứ 30s lại nối thêm một nhịp nữa.
    tab2Events.queueEvent(aHeartbeat('2026-09-01T00:00:30.000Z'));

    // Một nhịp của bộ xả (`startEventFlusher`'s `setInterval` gọi đúng hàm
    // này), gọi thẳng cho tất định thay vì chờ 90 giây đồng hồ thật.
    await tab2Events.flushEvents();

    expect(batches).toEqual([]);
  });

  it('sau khi tab này tự biết mình đã là B: hàng đợi của A bị bỏ, không đi theo cookie của B', async () => {
    tab2Identity.announceSessionUser('u-a');
    tab2Events.queueEvent(aHeartbeat('2026-09-01T00:00:00.000Z'));

    await tab1HandsOverToB();

    // Tab 2 quay lại tiền cảnh: `useMe` hết hạn, `GET /me` trả về B, và
    // `api/useMe.ts` công bố danh tính mới — thao tác này XOÁ cờ
    // `superseded` (đúng thiết kế: tab này vừa tự tay xác lập chủ mới của
    // trình duyệt). Từ giây đó, một guard chỉ đọc `sessionWasSuperseded()`
    // không còn thấy gì bất thường nữa — nhưng hàng đợi thì vẫn là của A.
    tab2Identity.announceSessionUser('u-b');
    expect(tab2Identity.sessionWasSuperseded()).toBe(false);

    await tab2Events.flushEvents();

    expect(batches).toEqual([]);
  });

  it('và phiên MỚI vẫn gửi được nhịp của chính nó — guard này chặn dữ liệu lạc chủ, không chặn cả bộ xả', async () => {
    tab2Identity.announceSessionUser('u-a');
    tab2Events.queueEvent(aHeartbeat('2026-09-01T00:00:00.000Z'));

    await tab1HandsOverToB();
    tab2Identity.announceSessionUser('u-b');

    tab2Events.queueEvent({
      courseId: 'course-belongs-to-b',
      chapterId: 'ch1',
      kind: 'heartbeat',
      meta: {},
      at: '2026-09-01T00:05:00.000Z',
    });
    await tab2Events.flushEvents();

    expect(batches).toHaveLength(1);
    expect(batches[0].map((e) => e.courseId)).toEqual(['course-belongs-to-b']);
  });
});

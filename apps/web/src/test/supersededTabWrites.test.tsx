/**
 * CHỖ THỨ NĂM — và lý do nó là chỗ CUỐI CÙNG thuộc loại này.
 *
 * Ba vòng sửa trước vá ba nơi gửi dữ liệu người học: `sync/engine.ts`'s
 * `runCycle` (đã xoá cùng Task 10), `api/events.ts`'s bộ xả nhịp học, và
 * `db/legacyDrain.ts`. Cả ba đều hỏi cùng một câu — *dữ liệu này của ai* —
 * và cả ba đều tự hỏi lấy. Cách ấy không mở rộng được: bản rà soát bước 5
 * tìm ra người ghi thứ tư, `reader/ChapterView.tsx`'s `AuthedReaderExtras`,
 * dựng trên route CÔNG KHAI `/c/:courseId/:chapterId` và mang theo cả
 * `useAnnotations` (POST/PATCH/DELETE) lẫn `useProgress` (PUT). Vá tại chỗ
 * lần thứ tư là chấp nhận rằng sẽ có lần thứ năm.
 *
 * Nên guard chuyển về ĐÚNG MỘT NƠI: `useMe()` — thứ mà mọi
 * `confirmedLoggedIn` trong ứng dụng này đã đọc sẵn — trả lời "không có ai"
 * ngay khi tab bị thay phiên. Đó chính là hình dạng của `runCycle`: một chỗ
 * hỏi phiên này của ai, mọi chỗ khác thừa hưởng.
 *
 * Tệp này đo BA điều: cổng thật sự lật (1), nó KHÔNG phải một cái khoá vĩnh
 * viễn làm kẹt người dùng mới (2), và người ghi DUY NHẤT không đi qua
 * `useMe` — panel AI, vốn cố ý công khai — có guard riêng ngay tại chỗ gửi
 * (3). `reader/ChapterView.test.tsx` giữ nửa còn lại: chính component thật
 * tháo lớp ghi của nó ra.
 *
 * HAI TAB LÀ HAI ĐỒ THỊ MODULE THẬT — cùng cơ chế
 * `auth/supersededScreen.test.tsx` và `test/supersededTabHandoff.test.tsx`
 * dựng: `BroadcastChannel` không bao giờ trả thông điệp về cho chính object
 * đã gửi, nên một bài kiểm gọi `announceSessionUser` trong cùng một module
 * sẽ không bao giờ đo được điều nó định đo.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { meQueryKey, useMe } from '../api/useMe';
import { chat, ServerAIError } from '../ai/serverClient';
import { announceSessionUser, sessionWasSuperseded, __resetSessionIdentityForTests } from '../auth/sessionIdentity';

const A = { id: 'u-a', email: 'a@example.com', name: 'A' };
const B = { id: 'u-b', email: 'b@example.com', name: 'B' };

/** Ai đang trả lời `GET /me` — đổi giữa bài để mô phỏng tab 2 tự làm mới. */
let meAnswer: typeof A | typeof B;
/** Mọi lần `POST /ai/chat` thật sự rời khỏi tab này. */
let chatCalls: unknown[];

const server = setupServer(
  http.get('/me', () => HttpResponse.json(meAnswer)),
  http.post('/ai/chat', async ({ request }) => {
    chatCalls.push(await request.json());
    return new HttpResponse('event: done\ndata: {}\n\n', {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

beforeEach(() => {
  meAnswer = A;
  chatCalls = [];
  __resetSessionIdentityForTests();
});

afterEach(() => {
  __resetSessionIdentityForTests();
  server.resetHandlers();
});

/**
 * Tab 1 — một đồ thị module RIÊNG, chỉ để công bố. `vi.resetModules()` cho
 * nó một bản `sessionIdentity` khác với bản mà cây React dưới đây dùng, còn
 * `BroadcastChannel` là global của jsdom nên hai bản nghe thấy nhau.
 */
async function tab1HandsOverToB(): Promise<void> {
  vi.resetModules();
  const tab1 = await import('../auth/sessionIdentity');
  tab1.announceSessionUser(null); // A đăng xuất: `clearSession()` công bố `null`
  tab1.announceSessionUser('u-b'); // B đăng nhập
  // Giao thông điệp qua `BroadcastChannel` là BẤT ĐỒNG BỘ. Chờ ở đây, một
  // lần, thay vì để mỗi bài tự đoán: một bài gọi thẳng `chat()` (không
  // `waitFor` nào cho DOM) sẽ chạy TRƯỚC khi tin nhắn tới và đo nhầm.
  await vi.waitFor(() => expect(sessionWasSuperseded()).toBe(true));
}

/**
 * Đúng phép suy ra mà `ChapterView`, `CourseHome` và `Sidebar` đều viết
 * bằng cùng một dòng — và là dòng quyết định lớp GHI của trang đọc có được
 * dựng hay không.
 */
function SessionProbe() {
  const me = useMe();
  const confirmedLoggedIn = me.isSuccess && me.data != null;
  return <span data-testid="probe">{confirmedLoggedIn ? `signed-in:${me.data?.id}` : 'nobody'}</span>;
}

/** The tab's own query client, held by the test so it can drive the ONE
 * thing a real refocus does: refetch `GET /me`. */
function Tab2({ client }: { client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <SessionProbe />
    </QueryClientProvider>
  );
}

function newTab2Client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe('chỗ thứ năm: một tab bị thay phiên không còn được coi là đang đăng nhập', () => {
  it('ĐỐI CHỨNG: chưa ai chiếm phiên thì tab này vẫn là A', async () => {
    render(<Tab2 client={newTab2Client()} />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('signed-in:u-a'));
  });

  it('tab khác chiếm phiên ⇒ `useMe` trả lời "không có ai", nên MỌI `confirmedLoggedIn` tắt cùng lúc', async () => {
    render(<Tab2 client={newTab2Client()} />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('signed-in:u-a'));

    await tab1HandsOverToB();

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('nobody'));
  });

  it('KHÔNG phải một cái khoá vĩnh viễn: khi tab này tự hỏi lại và biết mình là B, nó lại đăng nhập bình thường', async () => {
    const client = newTab2Client();
    render(<Tab2 client={client} />);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('signed-in:u-a'));

    await tab1HandsOverToB();
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('nobody'));

    // Tab 2 quay lại tiền cảnh. Không có `announceSessionUser` thủ công nào
    // ở đây: thứ duy nhất bài kiểm làm là điều một lần `GET /me` MỚI, đúng
    // như một lần refetch thật (`staleTime` hết hạn, cửa sổ được focus lại).
    // `api/useMe.ts`'s hiệu ứng công bố tự lo phần còn lại, và chính nó là
    // thứ xoá cờ `superseded` — vì tab này vừa TỰ TAY xác lập chủ mới của
    // trình duyệt. Một guard làm kẹt luôn B ở đây sẽ là lỗi tệ hơn thứ nó vá.
    meAnswer = B;
    await client.invalidateQueries({ queryKey: meQueryKey });

    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('signed-in:u-b'));
  });
});

describe('panel AI công khai: người ghi duy nhất không đi qua `useMe`', () => {
  it('ĐỐI CHỨNG: phiên bình thường thì câu hỏi vẫn đi', async () => {
    announceSessionUser('u-a');
    await chat({ question: 'entropy là gì?', courseSlug: 'toan-roi-rac' }, () => {});
    expect(chatCalls).toHaveLength(1);
  });

  it('tab bị thay phiên ⇒ câu hỏi của A không bao giờ rời máy, và không tiêu credit của B', async () => {
    announceSessionUser('u-a');
    await tab1HandsOverToB();

    const failure = await chat({ question: 'entropy là gì?', courseSlug: 'toan-roi-rac' }, () => {}).then(
      () => null,
      (e: unknown) => e,
    );

    expect(chatCalls).toEqual([]);
    expect(failure).toBeInstanceOf(ServerAIError);
    // `Unauthenticated` chứ không phải một mã mới: `useAI.ts`'s
    // `describeFailure` đã dịch mã ấy thành đúng câu người học cần đọc
    // ("phiên đã hết hạn, đăng nhập lại để hỏi tiếp"), và với TAB NÀY thì
    // đó chính xác là điều vừa xảy ra.
    expect((failure as ServerAIError).code).toBe('Unauthenticated');
  });
});

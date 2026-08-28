import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { chat, ServerAIError } from './serverClient';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/**
 * Một stream SSE điều khiển được TỪ BÊN NGOÀI: mỗi bài đẩy đúng byte nó muốn,
 * đúng lúc nó muốn, thay vì để `msw` phát nguyên cả thân một lần — cùng lý do
 * `useAI.test.tsx` (Pha 1) không dùng `waitFor`: phép đo streaming CHỈ có ý
 * nghĩa nếu bài kiểm tự tay điều khiển được cả TỐC ĐỘ tới của từng mảnh.
 */
function controllableSSE() {
  const encoder = new TextEncoder();
  let ctrl!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  return {
    stream,
    event: (kind: string, payload: { text?: string; code?: string }) => {
      ctrl.enqueue(encoder.encode(`event: ${kind}\ndata: ${JSON.stringify(payload)}\n\n`));
    },
    raw: (text: string) => {
      ctrl.enqueue(encoder.encode(text));
    },
    error: (e: unknown) => {
      ctrl.error(e);
    },
    close: () => {
      ctrl.close();
    },
  };
}

function sseResponse(stream: ReadableStream<Uint8Array>): HttpResponse<ReadableStream<Uint8Array>> {
  return new HttpResponse(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}

describe('chat() — thân request và đường dây trước-stream', () => {
  it('POST /ai/chat với đúng thân {question, course_slug}, cookie phiên, Content-Type', async () => {
    let captured: { method: string; credentials: string; body: unknown; contentType: string | null } | null = null;
    server.use(
      http.post('/ai/chat', async ({ request }) => {
        captured = {
          method: request.method,
          credentials: request.credentials,
          body: await request.json(),
          contentType: request.headers.get('content-type'),
        };
        const s = controllableSSE();
        s.event('done', {});
        s.close();
        return sseResponse(s.stream);
      }),
    );

    await chat({ question: 'Entropy là gì?', courseSlug: 'so-dau-phay-dong' }, vi.fn());

    expect(captured).not.toBeNull();
    expect(captured!.method).toBe('POST');
    expect(captured!.credentials).toBe('include');
    expect(captured!.contentType).toContain('application/json');
    expect(captured!.body).toEqual({ question: 'Entropy là gì?', course_slug: 'so-dau-phay-dong' });
  });

  it('course_slug rỗng vẫn hợp lệ — server chỉ dùng nó làm ngữ cảnh, không bắt buộc', async () => {
    let body: unknown = null;
    server.use(
      http.post('/ai/chat', async ({ request }) => {
        body = await request.json();
        const s = controllableSSE();
        s.event('done', {});
        s.close();
        return sseResponse(s.stream);
      }),
    );
    await chat({ question: 'hỏi', courseSlug: '' }, vi.fn());
    expect(body).toEqual({ question: 'hỏi', course_slug: '' });
  });

  it('402 NoCredit TRƯỚC khi stream bắt đầu — không phải một sự kiện SSE', async () => {
    server.use(
      http.post('/ai/chat', () =>
        HttpResponse.json({ code: 'NoCredit', error: 'no AI credit remaining' }, { status: 402 }),
      ),
    );
    const err = await chat({ question: 'hỏi', courseSlug: '' }, vi.fn()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerAIError);
    expect((err as ServerAIError).code).toBe('NoCredit');
  });

  it('401 Unauthenticated cũng là một lỗi trước-stream có mã', async () => {
    server.use(
      http.post('/ai/chat', () => HttpResponse.json({ code: 'Unauthenticated', error: 'unauthenticated' }, { status: 401 })),
    );
    const err = await chat({ question: 'hỏi', courseSlug: '' }, vi.fn()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerAIError);
    expect((err as ServerAIError).code).toBe('Unauthenticated');
  });

  it('mã lạ trong thân lỗi trước-stream ⇒ rơi về Internal, không ném trần', async () => {
    server.use(
      http.post('/ai/chat', () => HttpResponse.json({ code: 'SomethingFutureVersionAdded', error: 'x' }, { status: 400 })),
    );
    const err = await chat({ question: 'hỏi', courseSlug: '' }, vi.fn()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerAIError);
    expect((err as ServerAIError).code).toBe('Internal');
  });
});

describe('chat() — chảy chữ và kết thúc', () => {
  it('gọi onChunk cho từng mảnh delta THEO ĐÚNG THỨ TỰ, resolve khi done', async () => {
    const s = controllableSSE();
    server.use(http.post('/ai/chat', () => sseResponse(s.stream)));
    const chunks: string[] = [];

    const promise = chat({ question: 'hỏi', courseSlug: '' }, (t) => chunks.push(t));
    // Hai mảnh, hai lần đẩy RIÊNG — nếu cài đặt gom cả thân rồi mới phát thì
    // bài dưới vẫn xanh (chỉ khẳng định kết quả CUỐI), nên bài "giữa chừng"
    // trong `useAI.test.tsx`/`AskPanel.test.tsx` mới là bài chịu lực cho tính
    // chất "chảy", còn ở đây khẳng định thứ tự CỘNG DỒN là đủ cho tầng dây.
    s.event('delta', { text: 'Entropy ' });
    s.event('delta', { text: 'là số bit.' });
    s.event('done', {});
    s.close();

    await expect(promise).resolves.toBeUndefined();
    expect(chunks).toEqual(['Entropy ', 'là số bit.']);
  });

  it('sự kiện "tool" bị bỏ qua — không gọi onChunk, không chặn delta/done sau nó', async () => {
    const s = controllableSSE();
    server.use(http.post('/ai/chat', () => sseResponse(s.stream)));
    const chunks: string[] = [];

    const promise = chat({ question: 'hỏi', courseSlug: '' }, (t) => chunks.push(t));
    s.event('delta', { text: 'trước ' });
    s.event('tool', { text: 'read_course' });
    s.event('delta', { text: 'sau' });
    s.event('done', {});
    s.close();

    await promise;
    expect(chunks).toEqual(['trước ', 'sau']);
  });

  it('record SSE bị cắt ngang giữa hai lần đọc mạng vẫn ráp lại đúng', async () => {
    const s = controllableSSE();
    server.use(http.post('/ai/chat', () => sseResponse(s.stream)));
    const chunks: string[] = [];

    const promise = chat({ question: 'hỏi', courseSlug: '' }, (t) => chunks.push(t));
    // Cắt NGAY GIỮA thân JSON — một `read()` mạng thật không hứa cắt ở ranh
    // giới dòng.
    s.raw('event: delta\ndata: {"te');
    s.raw('xt":"ráp lại"}\n\n');
    s.event('done', {});
    s.close();

    await promise;
    expect(chunks).toEqual(['ráp lại']);
  });
});

describe('chat() — mã lỗi GIỮA stream, và vì sao NoCredit không lẫn vào đây', () => {
  /**
   * BÀI CHỊU LỰC của Step 2. `NoCredit` chỉ tới bằng đường 402 TRƯỚC stream
   * (xem describe trên) — Go không bao giờ phát nó như một sự kiện `error`
   * giữa dòng (`errorEnvelope`, handler.go, chỉ trả `ProviderFailed` hoặc
   * `ToolBudgetExhausted`). Bài này khẳng định NGAY CẢ NẾU một sự kiện lỗi
   * giữa dòng xảy ra, mã của nó KHÔNG BAO GIỜ là `NoCredit` — hai đường không
   * lẫn vào nhau.
   */
  it('lỗi ProviderFailed giữa dòng mang ĐÚNG mã đó, khác NoCredit', async () => {
    const s = controllableSSE();
    server.use(http.post('/ai/chat', () => sseResponse(s.stream)));

    const promise = chat({ question: 'hỏi', courseSlug: '' }, vi.fn());
    s.event('delta', { text: 'một nửa' });
    s.event('error', { code: 'ProviderFailed', text: 'the AI provider could not complete this turn' });
    s.close();

    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerAIError);
    expect((err as ServerAIError).code).toBe('ProviderFailed');
    expect((err as ServerAIError).code).not.toBe('NoCredit');
  });

  it('ToolBudgetExhausted giữ NGUYÊN mã của nó, không rơi thành ProviderFailed', async () => {
    const s = controllableSSE();
    server.use(http.post('/ai/chat', () => sseResponse(s.stream)));

    const promise = chat({ question: 'hỏi', courseSlug: '' }, vi.fn());
    s.event('error', { code: 'ToolBudgetExhausted', text: 'this turn used its whole tool budget without producing an answer' });
    s.close();

    const err = await promise.catch((e: unknown) => e);
    expect((err as ServerAIError).code).toBe('ToolBudgetExhausted');
  });
});

describe('chat() — SSE đứt giữa chừng GIỮ LẠI phần đã nhận', () => {
  /**
   * BÀI CHỊU LỰC của Step 3. Đo bằng đột biến (task-13-report.md): xoá lệnh
   * gọi `onChunk` bên trong nhánh `delta` của vòng lặp đọc trong
   * `serverClient.ts` ⇒ bài này phải ĐỎ, vì `chunks` sẽ vẫn rỗng lúc `close()`
   * cắt kết nối.
   */
  it('kết nối ĐÓNG mà không có done/error ⇒ hỏng, nhưng chunk ĐÃ TỚI vẫn được giao', async () => {
    const s = controllableSSE();
    server.use(http.post('/ai/chat', () => sseResponse(s.stream)));
    const chunks: string[] = [];

    const promise = chat({ question: 'hỏi', courseSlug: '' }, (t) => chunks.push(t));
    s.event('delta', { text: 'người học đã đọc được nửa câu' });
    s.close(); // KHÔNG có 'done', KHÔNG có 'error' — mô phỏng máy chủ chết.

    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerAIError);
    expect((err as ServerAIError).code).toBe('Network');
    // ĐÂY LÀ ĐIỀU BÀI NÀY CANH: mảnh đã tới KHÔNG bị vứt đi vì lượt hỏng sau
    // đó. `useAI.ts` thừa hưởng bất biến này để không xoá `turn.answer`.
    expect(chunks).toEqual(['người học đã đọc được nửa câu']);
  });

  it('kết nối MẠNG LỖI (không phải đóng sạch) cũng giữ chunk đã tới', async () => {
    const s = controllableSSE();
    server.use(http.post('/ai/chat', () => sseResponse(s.stream)));
    const chunks: string[] = [];

    const promise = chat({ question: 'hỏi', courseSlug: '' }, (t) => chunks.push(t));
    s.event('delta', { text: 'một nửa khác' });
    // Một tick thật, không phải cho đẹp: `ReadableStreamDefaultController
    // .error()` XOÁ hàng đợi bên trong stream theo đặc tả WHATWG — gọi nó
    // NGAY sau `enqueue()` trong cùng vi-tác-vụ làm rơi mất mảnh vừa đẩy
    // trước khi `reader.read()` đang treo kịp nhận nó (đo được: bài này ĐỎ
    // với `chunks` rỗng nếu bỏ dòng chờ dưới đây). Một tick nhường cho lần
    // đọc đang treo đó hoàn tất trước khi stream chuyển sang trạng thái lỗi —
    // đúng thứ tự một kết nối mạng thật cũng tôn trọng: byte đã tới trước khi
    // rớt mạng thì vẫn đã tới.
    await new Promise((r) => setTimeout(r, 0));
    s.error(new Error('ECONNRESET'));

    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerAIError);
    expect((err as ServerAIError).code).toBe('Network');
    expect(chunks).toEqual(['một nửa khác']);
  });

  it('record cuối cùng bị cắt DỞ DANG (không có \\n\\n) khi đóng ⇒ bị bỏ, không được đoán mò', async () => {
    const s = controllableSSE();
    server.use(http.post('/ai/chat', () => sseResponse(s.stream)));
    const chunks: string[] = [];

    const promise = chat({ question: 'hỏi', courseSlug: '' }, (t) => chunks.push(t));
    s.event('delta', { text: 'trọn vẹn' });
    s.raw('event: delta\ndata: {"text":"dang do'); // không có \n\n — chưa đủ một record.
    s.close();

    const err = await promise.catch((e: unknown) => e);
    expect((err as ServerAIError).code).toBe('Network');
    expect(chunks).toEqual(['trọn vẹn']);
  });
});

describe('chat() — huỷ THẬT bằng AbortSignal, không cần thông điệp huỷ riêng', () => {
  it('signal đã abort TRƯỚC khi gửi ⇒ ném ngay, không gửi request nào', async () => {
    let requested = false;
    server.use(
      http.post('/ai/chat', () => {
        requested = true;
        return HttpResponse.json({ code: 'Internal', error: 'unreachable' }, { status: 500 });
      }),
    );
    const ac = new AbortController();
    ac.abort();

    const err = await chat({ question: 'hỏi', courseSlug: '' }, vi.fn(), ac.signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerAIError);
    expect((err as ServerAIError).code).toBe('Aborted');
    expect(requested).toBe(false);
  });

  it('abort GIỮA CHỪNG cũng cho mã Aborted, không phải Network', async () => {
    const s = controllableSSE();
    server.use(http.post('/ai/chat', () => sseResponse(s.stream)));
    const ac = new AbortController();

    const promise = chat({ question: 'hỏi', courseSlug: '' }, vi.fn(), ac.signal);
    ac.abort();

    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerAIError);
    expect((err as ServerAIError).code).toBe('Aborted');
  });
});

import { act, renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReactNode } from 'react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { useAI } from './useAI';

/**
 * CỔNG CẤU TRÚC, không phải hành vi — Task 13 Step 1.
 *
 * Một import còn sót giữ cả `apps/vault` sống trong bundle của trang chính,
 * và đó là điều một cổng HÀNH VI không bắt được: `useAI`/`AskPanel`/
 * `DeepDive` có thể hoạt động đúng ở mọi bài kiểm khác trong khi vẫn kéo
 * theo `vaultClient.ts`/`VaultFrame.tsx` vào cây phụ thuộc.
 *
 * PHẠM VI HẸP CÓ CHỦ Ý. Tại thời điểm Task 13, MƯỜI tệp dưới `src/ai/` còn
 * nhắc "vault" (`vaultClient.ts` + test, `noKeyLeak.test.ts`,
 * `protocolAlias.test.ts`, `promptsCorpus.test.ts`, và chú thích rải rác ở
 * vài tệp khác) — Task 13 chỉ SỞ HỮU bốn. Sáu tệp kia là việc của Task 16
 * (gỡ `apps/vault`), và một cổng quét CẢ THƯ MỤC ở đây sẽ đỏ vì mã Task 13
 * không được phép sửa. Task 16 Step 7 thay danh sách bốn tệp cứng dưới đây
 * bằng một glob quét cả `src/ai/**`, ĐÚNG lúc sáu tệp kia đã bị xoá — nên có
 * một cổng THẬT ở CẢ HAI mốc, và không mốc nào khẳng định điều chưa đúng.
 */
const THUOC_TASK_13 = ['useAI.ts', 'serverClient.ts', 'AskPanel.tsx', 'DeepDive.tsx'];

/**
 * `dirname(fileURLToPath(import.meta.url))` rồi ghép ĐƯỜNG DẪN CHUỖI, không
 * `new URL('./x', import.meta.url)` truyền thẳng cho `readFile` như brief gợi
 * ý — đo được: dưới cấu hình vitest/jsdom của repo này, việc import
 * `node:fs/promises` LÀM `import.meta.url` của CHÍNH tệp này đổi từ
 * `file:///...` thành `http://localhost:3000/...` (một hiệu ứng phụ của
 * pipeline transform, tái lập được ở mọi lần chạy), và `readFile` từ chối một
 * URL không mang scheme `file:` với `ERR_INVALID_URL_SCHEME`. `readFileSync`
 * + `fileURLToPath` mà `DeepDive.test.tsx` đã dùng để nạp KaTeX vendor không
 * dính lỗi này, nên cổng ở đây theo đúng khuôn đã đo là chạy được.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

describe('cổng cấu trúc — bốn tệp Task 13 sở hữu không còn nhắc vault', () => {
  it('bốn mô-đun Task 13 sở hữu không còn nhắc vault', async () => {
    for (const f of THUOC_TASK_13) {
      const src = await readFile(join(HERE, f), 'utf8');
      expect(src, f).not.toMatch(/vault/i);
    }
  });
});

/**
 * PHA 2: `useAI` nói với MÁY CHỦ THẬT (`POST /ai/chat`) qua `fetch`, không
 * còn `postMessage` tới một `<iframe>` kho khoá. Bài kiểm này theo đúng quy
 * ước đã có của `apps/web/src` — msw chặn `fetch` thật, xem `api/client.
 * test.ts`, `api/useMe.test.tsx`, `sync/engine.test.ts` — thay vì mock riêng
 * `./serverClient`: không tệp nào khác trong repo mock sát-mô-đun kiểu đó
 * cho tầng lấy dữ liệu, và giữ nguyên quy ước nghĩa là stream ở đây đi qua
 * ĐÚNG mã phân tích SSE thật của `serverClient.ts`, không phải một giả định
 * về nó.
 *
 * VÌ SAO VẪN KHÔNG DÙNG `waitFor`. Lý do gốc (`useAI.test.tsx` Pha 1) không
 * đổi: `setState` từ một callback ngoài hệ thống sự kiện React rơi vào một
 * commit sau thao tác mệnh lệnh, và Scheduler chỉ nhả khi hết ngân sách.
 * Mỗi bước bơm dữ liệu vào stream nằm trong `act(async () => {…})`, cộng một
 * `await` nhường vòng lặp sự kiện thật (không phải timer giả) — cần thiết ở
 * đây vì `ReadableStreamDefaultController.enqueue()` chỉ giải quyết một
 * `reader.read()` đang treo qua một VI TÁC VỤ của CHÍNH pipeline `fetch`, và
 * `act()` một mình không hứa nhường đủ số vòng cho một chuỗi microtask
 * không phải do chính callback của nó tạo ra — `serverClient.test.ts` đo
 * được y hệt bẫy này ở tầng dây (bài "kết nối MẠNG LỖI").
 */
function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

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
    close: () => {
      ctrl.close();
    },
  };
}

interface Captured {
  readonly question: string;
  readonly course_slug: string;
  readonly signal: AbortSignal;
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Đăng ký MỘT lần trả lời cho `/ai/chat`, và giao lại cả thân request LẪN
 *  stream điều khiển được để bài kiểm tự tay bơm chunk. */
function nextChat(): { requests: Captured[]; sse: ReturnType<typeof controllableSSE> } {
  const requests: Captured[] = [];
  const sse = controllableSSE();
  server.use(
    http.post(
      '/ai/chat',
      async ({ request }) => {
        const body = (await request.json()) as { question: string; course_slug: string };
        requests.push({ ...body, signal: request.signal });
        return new HttpResponse(sse.stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      },
      { once: true },
    ),
  );
  return { requests, sse };
}

function wrapper({ children }: { children: ReactNode }) {
  return <LanguageProvider>{children}</LanguageProvider>;
}

function lastAnswer(r: { turns: readonly { answer: string }[] }): string {
  return r.turns.length === 0 ? '' : r.turns[r.turns.length - 1].answer;
}

describe('useAI — một đường, thẳng tới máy chủ', () => {
  it('gửi ĐÚNG thân {question, course_slug}; question HIỂN THỊ vẫn ngắn dù system dài', async () => {
    const { requests, sse } = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });

    act(() => {
      void result.current.ask('Số mũ lệch là gì?', { system: 'TRÍCH CHƯƠNG:\nSố mũ lệch 127.', courseSlug: 'so-dau-phay-dong' });
    });
    expect(result.current.state).toBe('streaming');
    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].question).toBe('TRÍCH CHƯƠNG:\nSố mũ lệch 127.\n\nSố mũ lệch là gì?');
    expect(requests[0].course_slug).toBe('so-dau-phay-dong');
    // Hiển thị cho người đọc vẫn là câu NGẮN họ gõ — không phải khối ngữ cảnh
    // đã ghép vào để gửi đi.
    expect(result.current.turns[0].question).toBe('Số mũ lệch là gì?');
  });

  it('courseSlug vắng ⇒ course_slug rỗng trên dây, không phải "undefined"', async () => {
    const { requests, sse } = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('hỏi');
    });
    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });
    expect(requests[0].course_slug).toBe('');
    expect(requests[0].question).toBe('hỏi');
  });

  it('cộng dồn chunk vào một chuỗi và kết ở state "done"', async () => {
    const { sse } = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('Giải thích entropy');
    });

    await act(async () => {
      sse.event('delta', { text: 'Entropy ' });
      await flush();
    });
    expect(lastAnswer(result.current)).toBe('Entropy ');
    expect(result.current.state).toBe('streaming');

    await act(async () => {
      sse.event('delta', { text: 'là số bit.' });
      await flush();
    });
    expect(lastAnswer(result.current)).toBe('Entropy là số bit.');

    await act(async () => {
      sse.event('done', {});
      sse.close();
      await flush();
    });
    expect(result.current.state).toBe('done');
    expect(result.current.error).toBeNull();
  });

  /**
   * Bài này TỪNG khẳng định điều ngược lại ở Pha 1 — "một câu hỏi mới xoá câu
   * trả lời cũ" — và nó xanh khi hook chỉ giữ một chuỗi. Nay hai lượt là hai
   * mục riêng trong `turns`, và cả hai đo được cùng lúc.
   */
  it('câu hỏi mới mở một LƯỢT mới; lượt cũ ở nguyên đó', async () => {
    const first = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('Giải thích entropy');
    });
    await act(async () => {
      first.sse.event('delta', { text: 'cũ' });
      first.sse.event('done', {});
      first.sse.close();
      await flush();
    });

    const second = nextChat();
    act(() => {
      void result.current.ask('câu khác');
    });
    await act(async () => {
      second.sse.event('delta', { text: 'mới' });
      await flush();
    });

    expect(result.current.turns.map((turn) => [turn.question, turn.answer])).toEqual([
      ['Giải thích entropy', 'cũ'],
      ['câu khác', 'mới'],
    ]);
  });

  /**
   * BÀI CHỊU LỰC của quyết định sản phẩm "không lịch sử hội thoại trên dây".
   * Pha 1 có một bài đối xứng khẳng định ĐIỀU NGƯỢC LẠI ("lượt sau mang theo
   * cả hội thoại trước") — dấu vết rõ nhất trong bộ kiểm này rằng Pha 2 đã
   * đổi hợp đồng, không chỉ đổi đường vận chuyển.
   *
   * Đột biến (task-13-report.md): nối `history` giả vào `wireQuestion` trong
   * `useAI.ts` ⇒ bài này phải ĐỎ.
   */
  it('lượt sau KHÔNG mang theo lượt trước — mỗi lượt là một request độc lập', async () => {
    const first = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('Giải thích entropy');
    });
    await act(async () => {
      first.sse.event('delta', { text: 'Là số bit.' });
      first.sse.event('done', {});
      first.sse.close();
      await flush();
    });

    const second = nextChat();
    act(() => {
      void result.current.ask('Rõ hơn được không?');
    });
    await act(async () => {
      await flush();
    });

    expect(second.requests[0].question).toBe('Rõ hơn được không?');
    expect(second.requests[0].question).not.toContain('entropy');
    expect(second.requests[0].question).not.toContain('Là số bit.');
  });

  it('lượt hỏng cũng không mang sang lượt sau', async () => {
    const first = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('Giải thích entropy');
    });
    await act(async () => {
      first.sse.event('error', { code: 'ProviderFailed', text: 'the AI provider could not complete this turn' });
      first.sse.close();
      await flush();
    });
    expect(result.current.state).toBe('error');

    const second = nextChat();
    act(() => {
      void result.current.ask('Thử lại');
    });
    await act(async () => {
      await flush();
    });
    expect(second.requests[0].question).toBe('Thử lại');
  });
});

describe('useAI — SSE đứt giữa chừng giữ lại phần đã nhận', () => {
  /**
   * BÀI CHỊU LỰC của Step 3, ở TẦNG HOOK (bổ sung cho tầng dây đã đo ở
   * `serverClient.test.ts`). Đo bằng đột biến (task-13-report.md): trong
   * nhánh `catch` của `ask()`, đổi `({ ...t0, failure: … })` thành
   * `{ ...t0, answer: '', failure: … }` ⇒ bài này phải ĐỎ.
   */
  it('kết nối đứt giữa chừng: answer đã nhận CÒN NGUYÊN, failure được gắn thêm', async () => {
    const { sse } = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('hỏi');
    });
    await act(async () => {
      sse.event('delta', { text: 'người học đã đọc được nửa câu' });
      await flush();
    });
    expect(lastAnswer(result.current)).toBe('người học đã đọc được nửa câu');

    await act(async () => {
      sse.close(); // đóng mà KHÔNG có done/error — mất kết nối giữa chừng.
      await flush();
    });

    expect(lastAnswer(result.current)).toBe('người học đã đọc được nửa câu');
    expect(result.current.state).toBe('error');
    expect(result.current.error?.code).toBe('Network');
  });
});

describe('useAI — mã lỗi có nghĩa RIÊNG, không hiện "thử lại sau" cho người chỉ cần nạp credit', () => {
  it('NoCredit và ProviderFailed dẫn tới HAI câu KHÁC NHAU', async () => {
    // NoCredit chỉ tới bằng đường 402 TRƯỚC-stream ở đời thật
    // (`serverClient.ts`'s doc comment) — mô phỏng đúng hình dạng đó thay vì
    // gửi nó như một sự kiện SSE.
    server.use(
      http.post('/ai/chat', () => HttpResponse.json({ code: 'NoCredit', error: 'no AI credit remaining' }, { status: 402 })),
    );
    const { result: r1 } = renderHook(() => useAI(), { wrapper });
    await act(async () => {
      await r1.current.ask('hỏi');
    });
    const noCreditError = r1.current.error;

    const b = nextChat();
    const { result: r2 } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void r2.current.ask('hỏi');
    });
    await act(async () => {
      b.sse.event('error', { code: 'ProviderFailed', text: 'the AI provider could not complete this turn' });
      b.sse.close();
      await flush();
    });
    const providerFailedError = r2.current.error;

    expect(noCreditError?.code).toBe('NoCredit');
    expect(providerFailedError?.code).toBe('ProviderFailed');
    expect(noCreditError?.code).not.toBe(providerFailedError?.code);
    // ĐÂY LÀ KHẲNG ĐỊNH THẬT SỰ CHỊU LỰC: không chỉ mã khác nhau, CÂU HIỆN
    // RA cũng phải khác nhau — nếu không, một cổng chỉ so `code` có thể xanh
    // trong khi UI vẫn hiện đúng MỘT thông điệp cho cả hai.
    expect(noCreditError?.message).not.toBe(providerFailedError?.message);
  });

  it('ToolBudgetExhausted có câu RIÊNG, không mượn câu của ProviderFailed', async () => {
    const { sse } = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('hỏi');
    });
    await act(async () => {
      sse.event('error', { code: 'ToolBudgetExhausted', text: 'this turn used its whole tool budget without producing an answer' });
      sse.close();
      await flush();
    });
    expect(result.current.error?.code).toBe('ToolBudgetExhausted');
  });

  it('không có response nào tới (mất mạng) ⇒ mã Network', async () => {
    server.use(http.post('/ai/chat', () => HttpResponse.error()));
    const { result } = renderHook(() => useAI(), { wrapper });
    await act(async () => {
      await result.current.ask('hỏi');
    });
    expect(result.current.state).toBe('error');
    expect(result.current.error?.code).toBe('Network');
  });
});

describe('useAI — cancel() huỷ THẬT bằng AbortSignal', () => {
  it('cancel() abort đúng tín hiệu đã gửi cho fetch của lượt đang chạy', async () => {
    const { requests, sse } = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('hỏi');
    });
    await act(async () => {
      sse.event('delta', { text: 'một nửa' });
      await flush();
    });

    await act(async () => {
      result.current.cancel();
      await flush();
    });

    expect(requests[0].signal.aborted).toBe(true);
    expect(result.current.state).toBe('idle');
    expect(lastAnswer(result.current)).toBe('một nửa');
  });

  it('huỷ KHÔNG bị coi là lỗi', async () => {
    const { sse } = nextChat();
    const { result } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('hỏi');
    });
    await act(async () => {
      sse.event('delta', { text: 'x' });
      await flush();
    });
    await act(async () => {
      result.current.cancel();
      await flush();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.state).not.toBe('error');
  });

  it('tháo component cũng huỷ THẬT — signal của lời gọi đang chạy bị abort', async () => {
    const { requests, sse } = nextChat();
    const { result, unmount } = renderHook(() => useAI(), { wrapper });
    act(() => {
      void result.current.ask('hỏi');
    });
    await act(async () => {
      sse.event('delta', { text: 'x' });
      await flush();
    });

    unmount();
    await flush();
    expect(requests[0].signal.aborted).toBe(true);
  });
});

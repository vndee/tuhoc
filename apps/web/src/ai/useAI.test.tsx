import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@vault-protocol';
import { VaultClient } from './vaultClient';
import { VaultFrameContext } from '../shell/VaultFrame';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { useAI } from './useAI';

/**
 * Câu trả lời của lượt CUỐI. Hook nay giữ cả cuộc hội thoại (`turns`) thay vì
 * một chuỗi `text` duy nhất — xem `AITurn`; những bài dưới đây chỉ quan tâm
 * lượt vừa hỏi, nên chúng hỏi qua đây thay vì đọc chỉ số bằng tay.
 */
function lastAnswer(r: { turns: readonly { answer: string }[] }): string {
  return r.turns.length === 0 ? '' : r.turns[r.turns.length - 1].answer;
}

const VAULT = 'http://localhost:5174';

/**
 * VÌ SAO TỆP NÀY KHÔNG DÙNG `waitFor` MỘT LẦN NÀO.
 *
 * `useAI` đặt trạng thái từ một listener `message` — tức là NGOÀI hệ thống sự
 * kiện của React. Dự án này đã mất một vòng vì đúng chỗ đó (ruling P2, Task 5):
 * `setState` trong thân effect rơi vào một commit SAU so với thao tác DOM mệnh
 * lệnh, và React Scheduler chỉ nhả khi đã tiêu hết ngân sách 5 ms
 * (`shouldYieldToHost`). Trên máy nhàn, cả hai lọt vào cùng một host task và
 * `waitFor` thắng — không phải vì đúng, mà vì Scheduler chưa kịp nhả. Dưới tải
 * (`--maxWorkers=24`) nó thua **10/20 lần**.
 *
 * Nên phép chờ đúng ở đây không phải là chờ lâu hơn, mà là KHÔNG CHỜ: mọi lần
 * bơm thông điệp nằm trong `act()`, và `act()` xả hàng đợi của Scheduler một
 * cách đồng bộ. Sau khi `act()` trả về, `result.current` LÀ trạng thái đã
 * commit — theo cấu trúc, không theo may rủi.
 */

interface Harness {
  post: ReturnType<typeof vi.fn>;
  client: VaultClient;
  wrapper: (p: { children: ReactNode }) => ReactNode;
  sent(n: number): { id: string; kind: string; [k: string]: unknown };
  reply(data: unknown, origin?: string): void;
}

const live: VaultClient[] = [];

function harness(): Harness {
  const post = vi.fn();
  const client = new VaultClient({
    lang: 'vi',
    vaultOrigin: VAULT,
    target: { postMessage: post } as unknown as Window,
    timeoutMs: 10_000,
  });
  live.push(client);
  return {
    post,
    client,
    wrapper: ({ children }) => (
      <LanguageProvider><VaultFrameContext.Provider
        value={{ client, origin: VAULT, expanded: false, setExpanded: () => {} }}
      >
        {children}
      </VaultFrameContext.Provider></LanguageProvider>
    ),
    sent: (n) => post.mock.calls[n]?.[0],
    reply: (data, origin = VAULT) => {
      window.dispatchEvent(new MessageEvent('message', { origin, data }));
    },
  };
}

afterEach(() => {
  while (live.length) live.pop()!.dispose();
});

const CONFIGURED = { kind: 'status', configured: true, providerId: 'deepseek', model: 'deepseek-chat' };

/** Đưa hook tới đúng lúc kho khoá đã nhận yêu cầu `chat`. Trả về id của nó. */
async function askUntilChat(h: Harness, result: { current: ReturnType<typeof useAI> }, prompt = 'Giải thích entropy'): Promise<string> {
  act(() => {
    void result.current.ask(prompt);
  });
  await act(async () => {
    h.reply({ v: 1, id: h.sent(0).id, ...CONFIGURED });
  });
  return h.sent(1).id;
}

describe('useAI — dòng chữ chảy về', () => {
  it('ask() hỏi kho khoá đã cấu hình chưa TRƯỚC, rồi mới gửi lời nhắc', async () => {
    const h = harness();
    const { result } = renderHook(() => useAI(), { wrapper: h.wrapper });

    expect(result.current.state).toBe('idle');
    act(() => {
      void result.current.ask('Giải thích entropy');
    });

    expect(h.sent(0)).toMatchObject({ v: PROTOCOL_VERSION, kind: 'status' });
    expect(result.current.state).toBe('streaming');

    await act(async () => {
      h.reply({ v: 1, id: h.sent(0).id, ...CONFIGURED });
    });

    expect(h.sent(1)).toMatchObject({
      v: PROTOCOL_VERSION,
      kind: 'chat',
      providerId: 'deepseek',
      model: 'deepseek-chat',
    });
    // Lời nhắc của người học đi vào `messages`; trang chính không tự chọn mô
    // hình — nó dùng đúng cái kho khoá nói là đang được cấu hình.
    expect(h.sent(1).messages).toEqual([{ role: 'user', content: 'Giải thích entropy' }]);
  });

  it('cộng dồn chunk vào một chuỗi và kết ở state "done"', async () => {
    const h = harness();
    const { result } = renderHook(() => useAI(), { wrapper: h.wrapper });
    const id = await askUntilChat(h, result);

    await act(async () => {
      h.reply({ v: 1, id, kind: 'chunk', text: 'Entropy ' });
    });
    expect(lastAnswer(result.current)).toBe('Entropy ');
    expect(result.current.state).toBe('streaming');

    await act(async () => {
      h.reply({ v: 1, id, kind: 'chunk', text: 'là số bit.' });
    });
    expect(lastAnswer(result.current)).toBe('Entropy là số bit.');

    await act(async () => {
      h.reply({ v: 1, id, kind: 'done' });
    });
    expect(result.current.state).toBe('done');
    expect(result.current.error).toBeNull();
  });

  /**
   * Bài này TỪNG khẳng định điều ngược lại — "một câu hỏi mới xoá câu trả lời
   * cũ" — và nó xanh, vì hook khi ấy chỉ giữ một chuỗi. Đó chính là lỗi người
   * dùng báo: hỏi câu thứ hai thì câu thứ nhất biến mất.
   *
   * Điều đáng canh thì KHÔNG đổi, chỉ chuyển chỗ: mẩu chữ của lời gọi mới không
   * được nối vào câu trả lời cũ. Nay hai lượt là hai mục riêng, nên cả hai đều
   * đo được cùng lúc.
   */
  it('câu hỏi mới mở một LƯỢT mới; lượt cũ ở nguyên đó', async () => {
    const h = harness();
    const { result } = renderHook(() => useAI(), { wrapper: h.wrapper });
    const first = await askUntilChat(h, result);
    await act(async () => {
      h.reply({ v: 1, id: first, kind: 'chunk', text: 'cũ' });
      h.reply({ v: 1, id: first, kind: 'done' });
    });

    act(() => {
      void result.current.ask('câu khác');
    });
    await act(async () => {
      h.reply({ v: 1, id: h.sent(2).id, ...CONFIGURED });
    });
    const second = h.sent(3).id;
    await act(async () => {
      h.reply({ v: 1, id: second, kind: 'chunk', text: 'mới' });
    });

    expect(result.current.turns.map((turn) => [turn.question, turn.answer])).toEqual([
      ['Giải thích entropy', 'cũ'],
      ['câu khác', 'mới'],
    ]);
  });

  /**
   * "Hỏi tiếp" chỉ có nghĩa nếu mô hình THẤY được lượt trước. Trước thay đổi
   * này mỗi lời gọi chỉ mang `[system, user]`, nên lượt thứ hai là một cuộc trò
   * chuyện mới — người dùng gõ "giải thích rõ hơn" và nhận lại một câu trả lời
   * về một chủ đề mà mô hình vừa quên.
   */
  it('lượt sau mang theo CẢ hội thoại trước đó', async () => {
    const h = harness();
    const { result } = renderHook(() => useAI(), { wrapper: h.wrapper });
    const first = await askUntilChat(h, result);
    await act(async () => {
      h.reply({ v: 1, id: first, kind: 'chunk', text: 'Là số bit.' });
      h.reply({ v: 1, id: first, kind: 'done' });
    });

    act(() => {
      void result.current.ask('Rõ hơn được không?');
    });
    await act(async () => {
      h.reply({ v: 1, id: h.sent(2).id, ...CONFIGURED });
    });

    expect(h.sent(3).messages).toEqual([
      { role: 'user', content: 'Giải thích entropy' },
      { role: 'assistant', content: 'Là số bit.' },
      { role: 'user', content: 'Rõ hơn được không?' },
    ]);
  });

  /**
   * Một lượt hỏng KHÔNG vào lịch sử: gửi một câu hỏi kèm một câu trả lời rỗng
   * dạy mô hình rằng im lặng là một câu trả lời hợp lệ.
   */
  it('lượt hỏng không được mang sang lượt sau', async () => {
    const h = harness();
    const { result } = renderHook(() => useAI(), { wrapper: h.wrapper });
    const first = await askUntilChat(h, result);
    await act(async () => {
      h.reply({ v: 1, id: first, kind: 'error', code: 'provider_error', message: 'hỏng' });
    });

    act(() => {
      void result.current.ask('Thử lại');
    });
    await act(async () => {
      h.reply({ v: 1, id: h.sent(2).id, ...CONFIGURED });
    });

    expect(h.sent(3).messages).toEqual([{ role: 'user', content: 'Thử lại' }]);
  });

  it('CHỮ GIẢ từ origin lạ KHÔNG lọt vào câu trả lời', async () => {
    const h = harness();
    const { result } = renderHook(() => useAI(), { wrapper: h.wrapper });
    const id = await askUntilChat(h, result);

    await act(async () => {
      h.reply({ v: 1, id, kind: 'chunk', text: 'thật' });
      // Một trang bất kỳ mở bằng `window.open` gửi về, mượn đúng id đang chạy.
      h.reply({ v: 1, id, kind: 'chunk', text: 'GIA-MAO' }, 'https://evil.example');
    });

    expect(lastAnswer(result.current)).toBe('thật');
  });
});

describe('useAI — lỗi có mã, không phải một câu cụt', () => {
  it('kho khoá chưa cắm key ⇒ state "error" mang mã not_configured', async () => {
    const h = harness();
    const { result } = renderHook(() => useAI(), { wrapper: h.wrapper });
    act(() => {
      void result.current.ask('hỏi');
    });
    await act(async () => {
      h.reply({ v: 1, id: h.sent(0).id, kind: 'status', configured: false });
    });
    expect(result.current.state).toBe('error');
    expect(result.current.error?.code).toBe('not_configured');
    // Không gửi lời gọi `chat` nào: hỏi nhà cung cấp mà không có key là một
    // vòng mạng chắc chắn hỏng.
    expect(h.post).toHaveBeenCalledTimes(1);
  });

  it('lỗi giữa dòng giữ nguyên mã của kho khoá', async () => {
    const h = harness();
    const { result } = renderHook(() => useAI(), { wrapper: h.wrapper });
    const id = await askUntilChat(h, result);
    await act(async () => {
      h.reply({ v: 1, id, kind: 'error', code: 'bad_key', message: 'Key bị từ chối.' });
    });
    expect(result.current.state).toBe('error');
    expect(result.current.error?.code).toBe('bad_key');
  });

  it('bản dựng KHÔNG có kho khoá ⇒ mã "unavailable", KHÁC với "chưa cắm key"', async () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LanguageProvider><VaultFrameContext.Provider
        value={{ client: null, origin: null, expanded: false, setExpanded: () => {} }}
      >
        {children}
      </VaultFrameContext.Provider></LanguageProvider>
    );
    const { result } = renderHook(() => useAI(), { wrapper });
    await act(async () => {
      await result.current.ask('hỏi');
    });
    expect(result.current.state).toBe('error');
    // KHÔNG phải `not_configured`: "vào cấu hình để cắm key" chỉ là lời khuyên
    // đúng khi có chỗ để cắm. Gộp hai mã lại là gửi người học đi vào một trang
    // cấu hình không giải quyết được gì.
    expect(result.current.error?.code).toBe('unavailable');
  });
});

describe('useAI — cancel() huỷ THẬT', () => {
  it('gửi thông điệp huỷ vào kho khoá, kèm id của lời gọi đang chạy', async () => {
    const h = harness();
    const { result } = renderHook(() => useAI(), { wrapper: h.wrapper });
    const chatId = await askUntilChat(h, result);

    await act(async () => {
      result.current.cancel();
    });

    expect(h.sent(2)).toMatchObject({ kind: 'cancel', cancelId: chatId });
    expect(h.post.mock.calls[2][1]).toBe(VAULT);
    expect(result.current.state).toBe('idle');
  });

  it('sau khi huỷ, chunk tới muộn không đổi được chữ trên màn hình', async () => {
    const h = harness();
    const { result } = renderHook(() => useAI(), { wrapper: h.wrapper });
    const id = await askUntilChat(h, result);
    await act(async () => {
      h.reply({ v: 1, id, kind: 'chunk', text: 'một nửa' });
    });
    await act(async () => {
      result.current.cancel();
    });
    await act(async () => {
      h.reply({ v: 1, id, kind: 'chunk', text: 'KHONG-DUOC-CO' });
    });
    expect(lastAnswer(result.current)).toBe('một nửa');
    expect(result.current.state).toBe('idle');
  });

  it('huỷ KHÔNG bị coi là lỗi', async () => {
    const h = harness();
    const { result } = renderHook(() => useAI(), { wrapper: h.wrapper });
    await askUntilChat(h, result);
    await act(async () => {
      result.current.cancel();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.state).not.toBe('error');
  });

  it('tháo component cũng huỷ THẬT — không để lời gọi chạy tiếp và tính tiền', async () => {
    const h = harness();
    const { result, unmount } = renderHook(() => useAI(), { wrapper: h.wrapper });
    const chatId = await askUntilChat(h, result);
    unmount();
    expect(h.sent(2)).toMatchObject({ kind: 'cancel', cancelId: chatId });
  });
});

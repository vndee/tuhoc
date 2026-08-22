import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VaultFrameContext } from '../shell/VaultFrame';
import { AskPanel } from './AskPanel';
import { VaultClient } from './vaultClient';

const VAULT = 'http://localhost:5174';

/**
 * VÌ SAO TỆP NÀY KHÔNG DÙNG `waitFor` MỘT LẦN NÀO — nguyên văn lập luận của
 * `useAI.test.tsx`, và nó áp vào đây mạnh hơn vì panel này có THÊM một vòng
 * `setState` trong thân effect (phép hỏi trạng thái lúc mở).
 *
 * `setState` trong thân effect rơi vào commit SAU so với thao tác mệnh lệnh,
 * và React Scheduler chỉ nhả sau ngân sách 5 ms. Trên máy nhàn `waitFor` thắng
 * vì Scheduler chưa kịp nhả, không phải vì đúng; dưới tải nó thua. Phép chờ
 * đúng là KHÔNG CHỜ: mọi lần bơm thông điệp nằm trong `act()`, và `act()` xả
 * hàng đợi Scheduler đồng bộ.
 */

interface Harness {
  post: ReturnType<typeof vi.fn>;
  client: VaultClient;
  wrap: (node: ReactNode) => ReactNode;
  sent(n: number): { id: string; kind: string; [k: string]: unknown };
  reply(data: unknown, origin?: string): void;
}

const live: VaultClient[] = [];

function harness(): Harness {
  const post = vi.fn();
  const client = new VaultClient({
    vaultOrigin: VAULT,
    target: { postMessage: post } as unknown as Window,
    timeoutMs: 10_000,
  });
  live.push(client);
  return {
    post,
    client,
    wrap: (node) => (
      <MemoryRouter>
        <VaultFrameContext.Provider
          value={{ client, origin: VAULT, expanded: false, setExpanded: () => {} }}
        >
          {node}
        </VaultFrameContext.Provider>
      </MemoryRouter>
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

/** Trả lời phép hỏi trạng thái lúc panel mở. */
async function settleProbe(h: Harness, status: object = CONFIGURED): Promise<void> {
  await act(async () => {
    h.reply({ v: 1, id: h.sent(0).id, ...status });
  });
}

function typeQuestion(text: string): void {
  const box = screen.getByLabelText('Câu hỏi của bạn');
  act(() => {
    Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(box, text);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const SYSTEM = 'KHOÁ HỌC:\nSố dấu phẩy động\n\nTRÍCH CHƯƠNG:\nSố mũ lệch 127.';

describe('AskPanel — chưa cắm key thì MỜI đi cấu hình', () => {
  it('mở panel khi chưa cắm key ⇒ thấy LỜI MỜI kèm đường tới trang cấu hình', async () => {
    const h = harness();
    render(h.wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));

    // Panel HỎI trạng thái ngay khi mở — người học không phải gõ một câu hỏi
    // rồi mới biết là chưa cắm key. Đó là khác biệt giữa "lời mời" và "lỗi cụt".
    expect(h.sent(0)).toMatchObject({ kind: 'status' });
    await settleProbe(h, { kind: 'status', configured: false });

    const invite = screen.getByTestId('ai-needs-setup');
    expect(invite).toBeInTheDocument();
    expect(invite.querySelector('a')?.getAttribute('href')).toBe('/settings');
    // KHÔNG có ô nhập câu hỏi: mời người ta gõ một câu chắc chắn hỏng là bẫy.
    expect(screen.queryByLabelText('Câu hỏi của bạn')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('bản dựng KHÔNG có kho khoá ⇒ câu khác, và KHÔNG mời đi một trang vô ích', async () => {
    const wrap = (node: ReactNode) => (
      <MemoryRouter>
        <VaultFrameContext.Provider
          value={{ client: null, origin: null, expanded: false, setExpanded: () => {} }}
        >
          {node}
        </VaultFrameContext.Provider>
      </MemoryRouter>
    );
    await act(async () => {
      render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    });

    expect(screen.getByTestId('ai-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-needs-setup')).toBeNull();
  });

  it('khung CHƯA gắn xong (origin có, client chưa) ⇒ KHÔNG nói dối là bản dựng thiếu kho khoá', async () => {
    // `shell/VaultFrame.tsx` đã đo và ghi lại: `client` chỉ dựng được sau khi
    // `<iframe>` vào DOM, nên nó rơi vào commit SAU. Một panel đọc `client` để
    // trả lời "bản dựng này có kho khoá không" sẽ nhoáng lên một câu SAI ở mỗi
    // lần mở, rồi tự sửa — kiểu hỏng khó thấy nhất trong một bài kiểm chỉ nhìn
    // trạng thái cuối.
    const wrap = (node: ReactNode) => (
      <MemoryRouter>
        <VaultFrameContext.Provider
          value={{ client: null, origin: VAULT, expanded: false, setExpanded: () => {} }}
        >
          {node}
        </VaultFrameContext.Provider>
      </MemoryRouter>
    );
    await act(async () => {
      render(wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    });

    expect(screen.queryByTestId('ai-unavailable')).toBeNull();
    expect(screen.queryByTestId('ai-needs-setup')).toBeNull();
    expect(screen.getByRole('button', { name: 'Hỏi' })).toBeDisabled();
  });
});

describe('AskPanel — hỏi, chảy chữ, huỷ', () => {
  it('gửi NGỮ CẢNH CHƯƠNG vào vai system và câu hỏi vào vai user', async () => {
    const h = harness();
    render(h.wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    await settleProbe(h);

    typeQuestion('Số mũ lệch là gì?');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
    });
    await act(async () => {
      h.reply({ v: 1, id: h.sent(1).id, ...CONFIGURED });
    });

    expect(h.sent(2)).toMatchObject({ kind: 'chat' });
    expect(h.sent(2).messages).toEqual([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Số mũ lệch là gì?' },
    ]);
  });

  it('chữ CHẢY VỀ TỪNG MẢNH — màn hình đổi giữa chừng, không đợi hết mới hiện', async () => {
    const h = harness();
    render(h.wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    await settleProbe(h);
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
    });
    await act(async () => {
      h.reply({ v: 1, id: h.sent(1).id, ...CONFIGURED });
    });
    const chatId = h.sent(2).id;

    await act(async () => {
      h.reply({ v: 1, id: chatId, kind: 'chunk', text: 'Số mũ ' });
    });
    // Khẳng định GIỮA CHỪNG. Một cài đặt gom hết rồi mới vẽ vẫn xanh nếu chỉ
    // khẳng định ở cuối — đó là toàn bộ khác biệt giữa "streaming" và "chậm".
    expect(screen.getByTestId('ai-answer')).toHaveTextContent('Số mũ');
    expect(screen.getByRole('button', { name: 'Dừng' })).toBeInTheDocument();

    await act(async () => {
      h.reply({ v: 1, id: chatId, kind: 'chunk', text: 'lệch 127.' });
      h.reply({ v: 1, id: chatId, kind: 'done' });
    });
    expect(screen.getByTestId('ai-answer')).toHaveTextContent('Số mũ lệch 127.');
    expect(screen.queryByRole('button', { name: 'Dừng' })).toBeNull();
  });

  it('bấm Dừng gửi thông điệp HUỶ mang id lời gọi, và giữ phần chữ đã nhận', async () => {
    const h = harness();
    render(h.wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    await settleProbe(h);
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
    });
    await act(async () => {
      h.reply({ v: 1, id: h.sent(1).id, ...CONFIGURED });
    });
    const chatId = h.sent(2).id;
    await act(async () => {
      h.reply({ v: 1, id: chatId, kind: 'chunk', text: 'một nửa' });
    });

    await act(async () => {
      screen.getByRole('button', { name: 'Dừng' }).click();
    });

    expect(h.sent(3)).toMatchObject({ kind: 'cancel', cancelId: chatId });
    expect(h.post.mock.calls[3][1]).toBe(VAULT);
    expect(screen.getByTestId('ai-answer')).toHaveTextContent('một nửa');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ĐÓNG panel giữa chừng cũng huỷ THẬT — không để lời gọi chạy tiếp và tính tiền', async () => {
    const h = harness();
    const { unmount } = render(
      h.wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />),
    );
    await settleProbe(h);
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
    });
    await act(async () => {
      h.reply({ v: 1, id: h.sent(1).id, ...CONFIGURED });
    });
    const chatId = h.sent(2).id;

    unmount();
    expect(h.sent(3)).toMatchObject({ kind: 'cancel', cancelId: chatId });
  });

  it('key bị từ chối GIỮA CHỪNG cũng thành lời mời, không phải một mã lỗi trần', async () => {
    const h = harness();
    render(h.wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    await settleProbe(h);
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
    });
    // Người học gỡ key trong khung kho khoá ngay sau khi panel hỏi trạng thái:
    // lời gọi thật vẫn hỏi lại và lần này nhận `configured: false`.
    await act(async () => {
      h.reply({ v: 1, id: h.sent(1).id, kind: 'status', configured: false });
    });

    expect(screen.getByTestId('ai-needs-setup')).toBeInTheDocument();
  });

  it('lỗi của NHÀ CUNG CẤP hiện ra như lỗi, KHÔNG giả làm lời mời cấu hình', async () => {
    const h = harness();
    render(h.wrap(<AskPanel heading="Hỏi về chương" system={SYSTEM} onClose={() => {}} />));
    await settleProbe(h);
    typeQuestion('hỏi');
    await act(async () => {
      screen.getByRole('button', { name: 'Hỏi' }).click();
    });
    await act(async () => {
      h.reply({ v: 1, id: h.sent(1).id, ...CONFIGURED });
    });
    await act(async () => {
      h.reply({
        v: 1,
        id: h.sent(2).id,
        kind: 'error',
        code: 'provider_error',
        message: 'Nhà cung cấp trả 500.',
      });
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Nhà cung cấp trả 500.');
    expect(screen.queryByTestId('ai-needs-setup')).toBeNull();
  });

  it('`autoAsk` hỏi NGAY khi mở — "Đào sâu" không bắt người học gõ lại câu hỏi', async () => {
    const h = harness();
    render(
      h.wrap(
        <AskPanel
          heading="Đào sâu"
          system={SYSTEM}
          initialQuestion="Giải thích kỹ đoạn này giúp tôi."
          autoAsk
          onClose={() => {}}
        />,
      ),
    );
    await settleProbe(h);
    await act(async () => {
      h.reply({ v: 1, id: h.sent(1).id, ...CONFIGURED });
    });

    expect(h.sent(2)).toMatchObject({ kind: 'chat' });
    expect(h.sent(2).messages).toEqual([
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Giải thích kỹ đoạn này giúp tôi.' },
    ]);
  });

  it('`autoAsk` KHÔNG hỏi khi chưa cắm key — không đốt một vòng chắc chắn hỏng', async () => {
    const h = harness();
    render(
      h.wrap(
        <AskPanel heading="Đào sâu" system={SYSTEM} initialQuestion="x" autoAsk onClose={() => {}} />,
      ),
    );
    await settleProbe(h, { kind: 'status', configured: false });

    expect(h.post).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('ai-needs-setup')).toBeInTheDocument();
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VaultFrameContext } from '../shell/VaultFrame';
import { AskPanel } from './AskPanel';
import { VaultClient } from './vaultClient';
import { LanguageProvider } from '../i18n/LanguageProvider';

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
    lang: 'vi',
    vaultOrigin: VAULT,
    target: { postMessage: post } as unknown as Window,
    timeoutMs: 10_000,
  });
  live.push(client);
  return {
    post,
    client,
    wrap: (node) => (
      <LanguageProvider><MemoryRouter>
        <VaultFrameContext.Provider
          value={{ client, origin: VAULT, expanded: false, setExpanded: () => {} }}
        >
          {node}
        </VaultFrameContext.Provider>
      </MemoryRouter></LanguageProvider>
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
      <LanguageProvider><MemoryRouter>
        <VaultFrameContext.Provider
          value={{ client: null, origin: null, expanded: false, setExpanded: () => {} }}
        >
          {node}
        </VaultFrameContext.Provider>
      </MemoryRouter></LanguageProvider>
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
      <LanguageProvider><MemoryRouter>
        <VaultFrameContext.Provider
          value={{ client: null, origin: VAULT, expanded: false, setExpanded: () => {} }}
        >
          {node}
        </VaultFrameContext.Provider>
      </MemoryRouter></LanguageProvider>
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

/* ═══════════════════════════════════════════════════════════════════════════ *
 * KÉO ĐỔI CỠ
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Bài này canh MỘT lỗi cụ thể, và nó là lỗi người dùng bắt được sau khi tôi báo
 * xong: kéo một lần rồi buông chuột, sau đó chỉ cần rê chuột ngang tay kéo là
 * panel lại chạy theo chuột.
 *
 * Nguyên nhân không nằm ở logic đổi cỡ mà ở một tính chất của React:
 * `e.currentTarget` chỉ có giá trị TRONG lúc React phát sự kiện, rồi về `null`.
 * Lệnh gỡ listener nằm trong `onUp` — chạy sau đó rất lâu — nên nó nổ vào `null`
 * và `pointermove` ở lại trên phần tử vĩnh viễn.
 *
 * Không có bài này thì lần refactor sau viết lại đúng như thế mà vẫn xanh: mọi
 * bài khác chỉ đo lúc ĐANG kéo, còn lỗi thì chỉ hiện ra SAU khi buông.
 */
describe('AskPanel — kéo đổi cỡ', () => {
  function panelBox(): HTMLElement {
    return screen.getByRole('dialog');
  }

  function grip(): HTMLElement {
    return screen.getByLabelText('Kéo để đổi cỡ khung');
  }

  /**
   * jsdom trả `getBoundingClientRect()` toàn số 0 cho MỌI phần tử, và điều đó
   * âm thầm làm hỏng một bài kiểm đổi cỡ: bề rộng mới tính từ `rect.width`, nên
   * với `rect.width === 0` mọi phép kéo đều rơi xuống dưới chặn dưới 320px và
   * bị kẹp về đúng 320. Hai lần kéo khác nhau ra cùng một con số, và bài kiểm
   * không phân biệt được "listener đã gỡ" với "chưa gỡ".
   *
   * Tôi đã viết bài kiểm ấy và nó XANH cả khi lỗi còn nguyên; phép thử đột biến
   * là thứ chỉ ra. Cho panel một cỡ thật thì số học lại có nghĩa.
   */
  function stubPanelSize(el: HTMLElement, width: number, height: number) {
    el.getBoundingClientRect = () =>
      ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  }

  /** jsdom không cài Pointer Capture API; panel chỉ cần nó không ném. */
  function stubPointerCapture(el: HTMLElement) {
    const captured = new Set<number>();
    Object.assign(el, {
      setPointerCapture: (id: number) => captured.add(id),
      releasePointerCapture: (id: number) => captured.delete(id),
      hasPointerCapture: (id: number) => captured.has(id),
    });
  }

  it('buông chuột xong thì rê chuột KHÔNG còn đổi cỡ nữa', () => {
    const h = harness();
    render(h.wrap(<AskPanel heading="Hỏi" system="ngữ cảnh" onClose={() => undefined} />));

    const g = grip();
    stubPointerCapture(g);
    stubPanelSize(panelBox(), 480, 400);

    // Panel chưa có cỡ inline nào: CSS đang quyết định.
    expect(panelBox().style.width).toBe('');

    fireEvent.pointerDown(g, { pointerId: 1, clientX: 500, clientY: 500 });
    // Kéo lên–trái là rộng ra và cao lên: 480 + 100 = 580px.
    act(() => {
      g.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 400, bubbles: true }));
    });
    const afterDrag = panelBox().style.width;
    expect(afterDrag, 'kéo mà cỡ không đổi — bài này đang đo nhầm thứ').toBe('580px');

    fireEvent.pointerUp(g, { pointerId: 1 });

    // ĐÂY là lời khẳng định thật: rê chuột sau khi đã buông. Toạ độ chọn sao
    // cho nếu listener CÒN sống thì con số ra khác hẳn (480 + 300 = 780px), chứ
    // không rơi vào cùng một mức bị kẹp.
    act(() => {
      g.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: 200, bubbles: true }));
    });
    expect(panelBox().style.width, 'panel vẫn chạy theo chuột sau khi đã buông').toBe(afterDrag);
  });

  it('thao tác bị cắt ngang (pointercancel) cũng gỡ được listener', () => {
    const h = harness();
    render(h.wrap(<AskPanel heading="Hỏi" system="ngữ cảnh" onClose={() => undefined} />));

    const g = grip();
    stubPointerCapture(g);
    stubPanelSize(panelBox(), 480, 400);

    fireEvent.pointerDown(g, { pointerId: 1, clientX: 500, clientY: 500 });
    act(() => {
      g.dispatchEvent(new MouseEvent('pointermove', { clientX: 420, clientY: 420, bubbles: true }));
    });
    const afterDrag = panelBox().style.width;
    expect(afterDrag).toBe('560px');

    fireEvent.pointerCancel(g, { pointerId: 1 });
    act(() => {
      g.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 100, bubbles: true }));
    });
    expect(panelBox().style.width).toBe(afterDrag);
  });

  /**
   * Một cỡ inline thắng mọi luật CSS, nên sau một lần kéo thì nút "mở rộng" im
   * lặng không làm gì — lỗi thứ hai người dùng bắt được trong cùng một vòng.
   */
  it('bấm mở rộng trả quyền quyết định cỡ lại cho CSS', () => {
    const h = harness();
    render(h.wrap(<AskPanel heading="Hỏi" system="ngữ cảnh" onClose={() => undefined} />));

    const g = grip();
    stubPointerCapture(g);
    stubPanelSize(panelBox(), 480, 400);
    fireEvent.pointerDown(g, { pointerId: 1, clientX: 500, clientY: 500 });
    act(() => {
      g.dispatchEvent(new MouseEvent('pointermove', { clientX: 400, clientY: 400, bubbles: true }));
    });
    fireEvent.pointerUp(g, { pointerId: 1 });
    expect(panelBox().style.width).not.toBe('');

    fireEvent.click(screen.getByLabelText('Mở rộng khung hỏi–đáp'));
    expect(panelBox().style.width).toBe('');
  });
});

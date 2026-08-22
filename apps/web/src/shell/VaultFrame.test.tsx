import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider, useLanguage } from '../i18n/LanguageProvider';
import { VaultFrameProvider, useVaultFrame } from './VaultFrame';
import { Shell } from './Shell';

const VAULT = 'http://localhost:5174';

/**
 * `<LanguageProvider>` bọc ngoài vì `VaultFrameProvider` đọc ngôn ngữ hiện tại
 * để **nhắn** cho kho khoá biết người đọc đang dùng tiếng gì — đó là đường duy
 * nhất kho khoá biết được (`apps/vault/src/lang.ts`). `useLanguage()` ném ngoài
 * provider, có chủ ý, nên chỗ bọc này là bắt buộc chứ không phải trang trí.
 */
function withLang(node: ReactNode) {
  return <LanguageProvider>{node}</LanguageProvider>;
}

/**
 * Mọi thông điệp mà khung nhận được, theo thứ tự.
 *
 * Bẫy đặt vào `contentWindow.postMessage` của chính phần tử khung: đó là đường
 * `VaultClient` gửi ra, và trong jsdom nó là một hàm thật thay được. Không có
 * bẫy này thì mọi chốt về `setLang` chỉ là "hàm có được gọi không", chứ không
 * phải "cái gì thật sự rời trang chính".
 */
function tapFrameMessages(): { sent: Array<{ data: unknown; targetOrigin: unknown }>; frame: HTMLIFrameElement } {
  const frame = frames()[0];
  const sent: Array<{ data: unknown; targetOrigin: unknown }> = [];
  const win = frame.contentWindow;
  if (!win) throw new Error('khung không có contentWindow — mọi chốt dưới đây rỗng');
  win.postMessage = ((data: unknown, targetOrigin: unknown) => {
    sent.push({ data, targetOrigin });
  }) as Window['postMessage'];
  return { sent, frame };
}

function Probe() {
  const { client, origin } = useVaultFrame();
  return (
    <div>
      <span data-testid="has-client">{client ? 'có' : 'không'}</span>
      <span data-testid="origin">{origin ?? 'không'}</span>
    </div>
  );
}

function frames(): HTMLIFrameElement[] {
  return Array.from(document.querySelectorAll('iframe'));
}

/**
 * `LanguageProvider` CẤT lựa chọn vào `localStorage`, nên một bài đổi sang
 * tiếng Anh sẽ để lại tiếng Anh cho bài chạy sau nó. Đo được: bài "gửi lại khi
 * khung nạp xong" nhận `lang: 'en'` thay vì `'vi'` chỉ vì thứ tự chạy. Một bộ
 * test phụ thuộc thứ tự là một bộ test nói dối ở đúng lúc nó được tin nhất.
 */
beforeEach(() => {
  localStorage.clear();
});

describe('VaultFrameProvider — khung ẩn, MỘT khung cho cả ứng dụng', () => {
  it('gắn đúng MỘT khung', () => {
    render(
      withLang(
        <VaultFrameProvider origin={VAULT}>
          <Probe />
        </VaultFrameProvider>,
      ),
    );
    expect(frames()).toHaveLength(1);
  });

  it('khung trỏ vào origin kho khoá, không phải một đường dẫn trên origin trang chính', () => {
    render(
      withLang(
        <VaultFrameProvider origin={VAULT}>
          <Probe />
        </VaultFrameProvider>,
      ),
    );
    // Cùng cổng = CÙNG origin = trình duyệt KHÔNG cách ly localStorage, và toàn
    // bộ hệ thống con này mất tác dụng. Cổng phải khác.
    //
    // So-bằng-đúng CẢ CHUỖI, và đó là chỗ bài này gánh nặng nhất: `src` phải là
    // một HẰNG SỐ, không tham số, không mảnh nào đổi theo trạng thái. Bất cứ thứ
    // gì gắn vào đây mà đổi được đều làm trình duyệt nạp lại tài liệu ở origin
    // kho khoá — và tài liệu ấy chứa ô dán key đang gõ dở. Đó đúng là lỗi mà
    // `?lang=` gây ra và Task 7 đo được.
    expect(frames()[0].getAttribute('src')).toBe(`${VAULT}/`);
  });

  it('sandbox đúng hai cờ — và `allow-same-origin` ở đây là same-origin với CHÍNH KHO KHOÁ', () => {
    render(
      withLang(
        <VaultFrameProvider origin={VAULT}>
          <Probe />
        </VaultFrameProvider>,
      ),
    );
    // Thiếu `allow-same-origin` thì khung nhận một origin mờ đục và
    // `localStorage` của nó NÉM — kho khoá không cất được gì. Có nó mà khung
    // lại CÙNG origin với trang chính thì sandbox vô nghĩa; ở đây khác origin
    // nên nó chỉ trả lại cho kho khoá đúng origin của chính nó.
    expect(frames()[0].getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
  });

  it('khung ẩn khỏi mắt VÀ khỏi cây trợ năng khi chưa mở rộng', () => {
    render(
      withLang(
        <VaultFrameProvider origin={VAULT}>
          <Probe />
        </VaultFrameProvider>,
      ),
    );
    const f = frames()[0];
    expect(f).not.toBeVisible();
    expect(f.getAttribute('aria-hidden')).toBe('true');
  });

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * NGÔN NGỮ ĐI BẰNG THÔNG ĐIỆP, VÀ KHUNG KHÔNG NẠP LẠI. Bài chịu lực.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Task 5 gắn `?lang=` vào `src` với lập luận rằng ngôn ngữ hiển thị không
   * đáng một thay đổi giao thức. Task 7 đo cái giá: `src` đổi ⇒ khung nạp lại
   * ⇒ **ô dán key đang gõ dở trống trơn**, không một lời cảnh báo. Bài này
   * ghim cả ba nửa của cách sửa, và cả ba đều cần thiết:
   *
   *   1. lựa chọn ngôn ngữ THẬT SỰ tới được kho khoá — nếu không, khung nói
   *      tiếng Việt cho người đã chọn tiếng Anh, mãi mãi, không triệu chứng;
   *   2. nó tới bằng **thông điệp**, kèm `targetOrigin` tường minh;
   *   3. **`src` KHÔNG đổi** — đó là toàn bộ lý do sửa. Chốt này là thứ đỏ nếu
   *      ai đó "tiện tay" gắn lại một tham số vào `src`.
   */
  it('đổi ngôn ngữ ⇒ một thông điệp `setLang`, và `src` ĐỨNG YÊN', () => {
    function Switcher() {
      const { setLang } = useLanguage();
      return (
        <button type="button" onClick={() => { setLang('en'); }}>
          en
        </button>
      );
    }
    render(
      withLang(
        <VaultFrameProvider origin={VAULT}>
          <Switcher />
        </VaultFrameProvider>,
      ),
    );

    const { sent, frame } = tapFrameMessages();
    const srcBefore = frame.getAttribute('src');
    expect(srcBefore).toBe(`${VAULT}/`);

    act(() => {
      screen.getByRole('button', { name: 'en' }).click();
    });

    expect(sent).toEqual([
      { data: { v: 1, id: expect.any(String), kind: 'setLang', lang: 'en' }, targetOrigin: VAULT },
    ]);
    // `'*'` không được xuất hiện ở đây, ở bất kỳ chiều nào.
    expect(sent[0]?.targetOrigin).not.toBe('*');

    // VÀ ĐÂY LÀ CHỐT ĐẮT NHẤT: `src` không nhúc nhích, nên trình duyệt không có
    // lý do nào để nạp lại tài liệu ở origin kho khoá — nên không có gì xoá ô
    // key đang gõ dở.
    expect(frame.getAttribute('src')).toBe(srcBefore);
  });

  /**
   * Lần gửi ĐẦU TIÊN không thể là lần gửi lúc dựng client: khung chưa nạp xong
   * thì chưa có trình nghe nào, và một `postMessage` vào đó rơi vào hư không mà
   * không báo lỗi. Nên `VaultFrame` gửi lại ở sự kiện `load` của khung, và bài
   * này đo đúng điều đó — không có nó, kho khoá kẹt ở ngôn ngữ mặc định cho một
   * người đã chọn tiếng Anh, và triệu chứng duy nhất là chữ sai tiếng.
   */
  it('gửi lại `setLang` mỗi lần khung nạp xong', () => {
    render(
      withLang(
        <VaultFrameProvider origin={VAULT}>
          <Probe />
        </VaultFrameProvider>,
      ),
    );

    const { sent, frame } = tapFrameMessages();
    expect(sent, 'chưa nạp xong thì chưa có gì để đo').toEqual([]);

    act(() => {
      frame.dispatchEvent(new Event('load'));
    });

    expect(sent).toEqual([
      { data: { v: 1, id: expect.any(String), kind: 'setLang', lang: 'vi' }, targetOrigin: VAULT },
    ]);
  });

  it('cấp một VaultClient dùng được cho cả cây con', () => {
    render(
      withLang(
        <VaultFrameProvider origin={VAULT}>
          <Probe />
        </VaultFrameProvider>,
      ),
    );
    expect(screen.getByTestId('has-client')).toHaveTextContent('có');
    expect(screen.getByTestId('origin')).toHaveTextContent(VAULT);
  });

  it('KHÔNG cấu hình origin ⇒ không khung, không client — giáo trình vẫn đọc được', () => {
    render(
      withLang(
        <VaultFrameProvider origin={null}>
          <Probe />
        </VaultFrameProvider>,
      ),
    );
    expect(frames()).toHaveLength(0);
    expect(screen.getByTestId('has-client')).toHaveTextContent('không');
  });
});

describe('Shell gắn khung — điểm vào có thật, không phải mã chết', () => {
  /**
   * Cổng mù #4 của `docs/carried-forward.md`: một tính năng không có điểm vào
   * xanh trọn vẹn ở mọi cổng. `VaultClient` + `useAI` chỉ có giá trị nếu có
   * một khung thật được gắn một lần cho cả ứng dụng, và `Shell` là thứ duy
   * nhất trong repo này được dựng đúng một lần cho mọi route.
   */
  it('Shell dựng khung kho khoá', () => {
    render(
      withLang(
        <Shell sidebar={null} topbar={null} vaultOrigin={VAULT}>
          <p>nội dung</p>
        </Shell>,
      ),
    );
    expect(frames()).toHaveLength(1);
  });

  it('KHÔNG đụng tới bộ khung DOM mà reader.css bám vào', () => {
    // `Shell` được chép lại từng byte để `packages/course-kit/reader.css` áp
    // được mà không sửa. Khung kho khoá là con của thứ BAO NGOÀI `#app`, không
    // phải con của `#app` — nên danh sách con của `#app` không đổi.
    render(
      withLang(
        <Shell sidebar={<i>sb</i>} topbar={<i>tb</i>} rail={<i>rl</i>} vaultOrigin={VAULT}>
          <p>nội dung</p>
        </Shell>,
      ),
    );
    const app = document.getElementById('app');
    expect(app).not.toBeNull();
    expect(Array.from(app!.children).map((c) => c.id)).toEqual(['sidebar', 'main']);
    expect(app!.querySelector('iframe')).toBeNull();
    for (const id of ['sidebar', 'main', 'topbar', 'progwrap', 'progbar', 'scroller', 'content-wrap', 'content', 'rail']) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
  });
});

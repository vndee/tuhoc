import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VaultFrameProvider, useVaultFrame } from './VaultFrame';
import { Shell } from './Shell';

const VAULT = 'http://localhost:5174';

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

describe('VaultFrameProvider — khung ẩn, MỘT khung cho cả ứng dụng', () => {
  it('gắn đúng MỘT khung', () => {
    render(
      <VaultFrameProvider origin={VAULT}>
        <Probe />
      </VaultFrameProvider>,
    );
    expect(frames()).toHaveLength(1);
  });

  it('khung trỏ vào origin kho khoá, không phải một đường dẫn trên origin trang chính', () => {
    render(
      <VaultFrameProvider origin={VAULT}>
        <Probe />
      </VaultFrameProvider>,
    );
    // Cùng cổng = CÙNG origin = trình duyệt KHÔNG cách ly localStorage, và toàn
    // bộ hệ thống con này mất tác dụng. Cổng phải khác.
    expect(frames()[0].getAttribute('src')).toBe(`${VAULT}/`);
  });

  it('sandbox đúng hai cờ — và `allow-same-origin` ở đây là same-origin với CHÍNH KHO KHOÁ', () => {
    render(
      <VaultFrameProvider origin={VAULT}>
        <Probe />
      </VaultFrameProvider>,
    );
    // Thiếu `allow-same-origin` thì khung nhận một origin mờ đục và
    // `localStorage` của nó NÉM — kho khoá không cất được gì. Có nó mà khung
    // lại CÙNG origin với trang chính thì sandbox vô nghĩa; ở đây khác origin
    // nên nó chỉ trả lại cho kho khoá đúng origin của chính nó.
    expect(frames()[0].getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
  });

  it('khung ẩn khỏi mắt VÀ khỏi cây trợ năng khi chưa mở rộng', () => {
    render(
      <VaultFrameProvider origin={VAULT}>
        <Probe />
      </VaultFrameProvider>,
    );
    const f = frames()[0];
    expect(f).not.toBeVisible();
    expect(f.getAttribute('aria-hidden')).toBe('true');
  });

  it('cấp một VaultClient dùng được cho cả cây con', () => {
    render(
      <VaultFrameProvider origin={VAULT}>
        <Probe />
      </VaultFrameProvider>,
    );
    expect(screen.getByTestId('has-client')).toHaveTextContent('có');
    expect(screen.getByTestId('origin')).toHaveTextContent(VAULT);
  });

  it('KHÔNG cấu hình origin ⇒ không khung, không client — giáo trình vẫn đọc được', () => {
    render(
      <VaultFrameProvider origin={null}>
        <Probe />
      </VaultFrameProvider>,
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
      <Shell sidebar={null} topbar={null} vaultOrigin={VAULT}>
        <p>nội dung</p>
      </Shell>,
    );
    expect(frames()).toHaveLength(1);
  });

  it('KHÔNG đụng tới bộ khung DOM mà reader.css bám vào', () => {
    // `Shell` được chép lại từng byte để `packages/course-kit/reader.css` áp
    // được mà không sửa. Khung kho khoá là con của thứ BAO NGOÀI `#app`, không
    // phải con của `#app` — nên danh sách con của `#app` không đổi.
    render(
      <Shell sidebar={<i>sb</i>} topbar={<i>tb</i>} rail={<i>rl</i>} vaultOrigin={VAULT}>
        <p>nội dung</p>
      </Shell>,
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

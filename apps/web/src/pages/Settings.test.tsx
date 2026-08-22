import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { t } from '../i18n';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { VaultFrameProvider } from '../shell/VaultFrame';
import { Settings } from './Settings';

const VAULT = 'http://localhost:5174';

/**
 * `<LanguageProvider>` là BẮT BUỘC từ khi trang này đọc catalog, và nó không
 * phải một chi tiết của harness: `useLanguage()` NÉM ngoài provider, có chủ ý
 * (xem `i18n/LanguageProvider.tsx`). Một mặc định lặng lẽ ở đó sẽ cho ra một
 * trang hai thứ tiếng mà không bài kiểm nào đỏ.
 */
function renderSettings(origin: string | null = VAULT) {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <VaultFrameProvider origin={origin}>
          <Settings />
        </VaultFrameProvider>
      </LanguageProvider>
    </MemoryRouter>,
  );
}

function frames(): HTMLIFrameElement[] {
  return Array.from(document.querySelectorAll('iframe'));
}

describe('Trang cấu hình AI của TRANG CHÍNH', () => {
  /**
   * BÀI KIỂM TRUNG TÂM CỦA TASK NÀY, và lý do nó được viết trước mọi thứ khác.
   *
   * Ô nhập bí mật PHẢI nằm trong khung của kho khoá, không phải một ô trên
   * trang chính rồi gửi vào. Một ô trên trang chính đi qua DOM của trang chính,
   * và một course độc đọc được nó bằng đúng một listener `input` — tức là toàn
   * bộ kiến trúc hai origin (Task 1–5) trở thành trang trí.
   *
   * Khẳng định mạnh nhất viết được ở phía này là **không có một `<input>` nào**,
   * chứ không phải "không có input nào tên là bí mật": một ô tên `q` vẫn đọc
   * được y hệt. Trang này không có gì để người dùng gõ; nó chỉ giải thích và
   * mở khung ra.
   */
  it('KHÔNG chứa một <input>, <textarea> hay [contenteditable] nào', () => {
    const { container } = renderSettings();
    expect(container.querySelectorAll('input')).toHaveLength(0);
    expect(container.querySelectorAll('textarea')).toHaveLength(0);
    expect(container.querySelectorAll('[contenteditable]')).toHaveLength(0);
  });

  /**
   * Chốt chống bẫy-không-cắm (kỹ thuật của Task 2): bài kiểm trên khẳng định
   * một danh sách RỖNG, và một trang không render gì cũng cho ra danh sách
   * rỗng. Bài này hỏi câu mà một trang chết không trả lời được.
   */
  it('có render thật — tiêu đề và phần giải thích đều có mặt', () => {
    renderSettings();
    expect(screen.getByRole('heading', { name: t('vi', 'settings.ai.title') })).toBeInTheDocument();
    expect(screen.getByTestId('vault-explainer')).toHaveTextContent(t('vi', 'settings.ai.blurbVault'));
  });

  /**
   * `<strong>kho khoá</strong>` nằm GIỮA câu — ca đã chốt QĐ-2. Bài này khẳng
   * định hai chuyện mà một `toHaveTextContent` đơn thuần không nói:
   *
   *   1. phần tử được chèn ĐÚNG CHỖ, không bị đẩy ra đầu hay cuối câu;
   *   2. câu vẫn là MỘT câu liền — `textContent` khớp nguyên văn bản dịch, nên
   *      một `tNode` nuốt mất mảnh chữ hay bỏ sót chỗ trống đều đỏ.
   */
  it('phần giải thích có <strong> nằm GIỮA câu, và câu không bị cắt rời', () => {
    renderSettings();
    const p = screen.getByTestId('vault-explainer');
    const strong = p.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe(t('vi', 'settings.ai.blurbVault'));
    expect(p.textContent).toBe(t('vi', 'settings.ai.blurb', t('vi', 'settings.ai.blurbVault')));
    // Không ở đầu, không ở cuối: có chữ ở cả hai phía của phần tử.
    expect(p.textContent?.indexOf(t('vi', 'settings.ai.blurbVault'))).toBeGreaterThan(0);
    expect(p.textContent?.endsWith(t('vi', 'settings.ai.blurbVault'))).toBe(false);
  });

  /**
   * Điểm vào của cổng mù #4 (S1-F29). Khung kho khoá vẽ sẵn bảng xác nhận của
   * Task 9 và form cấu hình của task này, nhưng cả hai chỉ NHÌN THẤY được khi
   * trang chính mở rộng khung ra. Trước task này việc đó không tồn tại, nên
   * `needs_consent` là ngõ cụt.
   */
  it('MỞ RỘNG khung kho khoá khi vào trang — nếu không, form nằm trong khung ẩn', () => {
    renderSettings();
    const f = frames()[0];
    expect(f).toBeVisible();
    expect(f.getAttribute('aria-hidden')).toBeNull();
  });

  it('đóng lại khi rời trang — khung không được che giáo trình ở route khác', () => {
    const { unmount } = renderSettings();
    expect(frames()[0]).toBeVisible();
    unmount();
    render(
      <MemoryRouter>
        <VaultFrameProvider origin={VAULT}>
          <p>route khác</p>
        </VaultFrameProvider>
      </MemoryRouter>,
    );
    expect(frames()[0]).not.toBeVisible();
  });

  it('đóng được bằng nút, rồi mở lại được — không kẹt ở màn trắng', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole('button', { name: /đóng/i }));
    expect(frames()[0]).not.toBeVisible();

    await user.click(screen.getByRole('button', { name: t('vi', 'settings.ai.open') }));
    expect(frames()[0]).toBeVisible();
  });

  /**
   * Bản dựng không có kho khoá phải NÓI RA điều đó. `unavailable` tách khỏi
   * `not_configured` ở Task 5 vì đúng lý do này: mời người học "vào cấu hình để
   * cắm key" chỉ đúng khi có chỗ để cắm.
   */
  it('nói thẳng khi bản dựng này KHÔNG có kho khoá, thay vì hiện một khung rỗng', () => {
    renderSettings(null);
    expect(frames()).toHaveLength(0);
    expect(screen.getByTestId('vault-unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('vi', 'settings.ai.open') })).toBeNull();
  });
});

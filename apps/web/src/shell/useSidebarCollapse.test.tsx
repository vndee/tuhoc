import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { Shell } from './Shell';
import { TopNav } from './TopNav';
import { useSidebarCollapse } from './useSidebarCollapse';

/**
 * THU GỌN THANH BÊN — người dùng yêu cầu: "The left navigation sidebar should
 * be collapsible."
 *
 * ## Bài kiểm này đo được gì, và KHÔNG đo được gì
 *
 * Luật ẩn thật sự là CSS treo dưới `@media (min-width: 981px)`
 * (`styles/shell-modes.css`). jsdom không tính media query và không tính bố
 * cục, nên ở đây **không thể** hỏi "thanh bên có ẩn không" — mọi khẳng định
 * kiểu ấy sẽ xanh vĩnh viễn bất kể CSS đúng hay sai, tức một tripwire chết.
 *
 * Nên tầng này đo đúng phần nó thấy được: cờ trạng thái, lớp trên `#app`,
 * `aria-expanded`, và tính bền qua tải lại. Phần "mắt nhìn thấy" thuộc
 * `e2e/s5.spec.ts`, chạy trên trình duyệt thật với CSS thật.
 */
beforeEach(() => {
  localStorage.clear();
});

describe('useSidebarCollapse', () => {
  it('mặc định KHÔNG thu gọn — thanh bên hiện là trạng thái nghỉ', () => {
    const { result } = renderHook(() => useSidebarCollapse());
    expect(result.current.collapsed).toBe(false);
  });

  it('bật rồi tắt lại được', () => {
    const { result } = renderHook(() => useSidebarCollapse());

    act(() => {
      result.current.toggle();
    });
    expect(result.current.collapsed).toBe(true);

    act(() => {
      result.current.toggle();
    });
    expect(result.current.collapsed).toBe(false);
  });

  it('nhớ lựa chọn qua lần dựng sau — đây là điểm khác ngăn kéo của màn hẹp', () => {
    const first = renderHook(() => useSidebarCollapse());
    act(() => {
      first.result.current.toggle();
    });
    first.unmount();

    // Ngăn kéo (`useMobileNav`) đóng lại ở mọi lần đổi route; thu gọn thì
    // không — nó là một lựa chọn về cửa sổ, không phải một trạng thái tạm.
    const second = renderHook(() => useSidebarCollapse());
    expect(second.result.current.collapsed).toBe(true);
  });

  it('ghi vào ĐÚNG khoá đã phân loại ở db/local.ts', () => {
    // Khoá này nằm trong `DEVICE_PREFERENCE_KEYS`, nên `clearLocalData()` cố ý
    // không xoá nó. Bản đầu của hook gọi thẳng `localStorage` và cổng "no third
    // place for user data to hide" đỏ ngay — bài này ghim lại đường đã sửa.
    const { result } = renderHook(() => useSidebarCollapse());
    act(() => {
      result.current.toggle();
    });
    expect(localStorage.getItem('itbook-nav-collapsed')).toBe('true');
  });
});

describe('lớp trên #app', () => {
  // `<LanguageProvider>` là bắt buộc: `<Shell>` dựng `<VaultFrameProvider>`,
  // và `useLanguage()` NÉM ngoài provider — có chủ ý, xem `LanguageProvider.tsx`.
  const shell = (props: { reading?: boolean; navCollapsed?: boolean }) =>
    render(
      <LanguageProvider>
        <Shell sidebar={<nav />} topbar={<span />} vaultOrigin={null} {...props}>
          <p>nội dung</p>
        </Shell>
      </LanguageProvider>,
    );

  it('không có lớp nào khi ở chế độ thư viện và thanh bên đang hiện', () => {
    const { container } = shell({});
    expect(container.querySelector('#app')?.className).toBe('');
  });

  it('đặt nav-collapsed khi thu gọn', () => {
    const { container } = shell({ navCollapsed: true });
    expect(container.querySelector('#app')?.classList.contains('nav-collapsed')).toBe(true);
  });

  it('hai lớp CHỒNG được nhau — đọc một chương với thanh bên đã thu gọn từ trước', () => {
    // Chúng độc lập: chế độ đọc là nơi nào ta đang ở, thu gọn là lựa chọn của
    // người dùng. Nếu một lớp nuốt lớp kia thì thoát khỏi chương sẽ bung lại
    // một thanh bên mà người dùng đã cố ý thu.
    const { container } = shell({ reading: true, navCollapsed: true });
    const app = container.querySelector('#app');
    expect(app?.classList.contains('reading')).toBe(true);
    expect(app?.classList.contains('nav-collapsed')).toBe(true);
  });
});

/**
 * Nút thu gọn ĐÃ CHUYỂN TỆP: từ `<Topbar>` sang `<TopNav>`.
 *
 * Nó từng đứng ngay sau ba mục điều hướng và đọc như một mục thứ tư. Nay nó ở
 * mép trái thanh trên, ngay phía trên cột nó thu gọn — chỗ shadcn đặt
 * `SidebarTrigger`. Đổi tệp chứ không đổi `order` trong CSS, vì `order` sẽ vẽ
 * nó ở mép trái trong khi thứ tự TAB vẫn để nó sau ba mục.
 *
 * Câu hỏi của ba bài dưới đây không đổi một chữ; chỉ chỗ dựng đổi. `TopNav`
 * đọc `useMe()` nên nó cần `QueryClientProvider` — đó là toàn bộ khác biệt.
 */
describe('nút thu gọn nói ra trạng thái của mình', () => {
  const renderNav = (navExpanded: boolean, onMenuClick: () => void = () => {}) =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <LanguageProvider>
            <TopNav onMenuClick={onMenuClick} navExpanded={navExpanded} />
          </LanguageProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

  const topbar = (navExpanded: boolean) => renderNav(navExpanded);

  it('aria-expanded đi theo trạng thái, và trỏ vào đúng vùng nó điều khiển', () => {
    topbar(true);
    const button = document.getElementById('menu-btn');
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    // Không có `aria-controls` thì một nút "☰" chỉ là một ký tự với trình đọc
    // màn hình — nó không nói được nó bật/tắt CÁI GÌ.
    expect(button?.getAttribute('aria-controls')).toBe('sidebar');
  });

  it('nói "đóng" khi đã thu gọn', () => {
    topbar(false);
    expect(document.getElementById('menu-btn')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('vẫn bấm được bằng bàn phím', async () => {
    const user = userEvent.setup();
    let clicks = 0;
    renderNav(true, () => {
      clicks += 1;
    });

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { expanded: true }));
    await user.keyboard('{Enter}');
    expect(clicks).toBe(1);
  });
});

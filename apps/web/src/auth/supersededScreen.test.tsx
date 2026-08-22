import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Nửa MÀN HÌNH của C-1.
 *
 * Nửa **dữ liệu** đã đóng ở `sync/crossTabSession.test.tsx`: tab bị thay thế
 * ngừng đồng bộ, nên không hàng nào của A tới server dưới cookie của B. Nhưng
 * tab ấy vẫn **hiển thị** cây đã render của A cho tới khi `useMe` của chính nó
 * làm mới. A rời máy, B đăng nhập ở tab khác ⇒ B **nhìn thấy ghi chú và tiến
 * độ của A**. Không dữ liệu nào chảy đi, nhưng đó là thứ người dùng nhìn thấy.
 *
 * **Hai tab là hai đồ thị module thật**, không phải stub — `vi.resetModules()`
 * cho mỗi tab một bản `sessionIdentity` riêng, còn `BroadcastChannel` là global
 * của jsdom nên nó **được chia sẻ**, đúng như hai tab thật. Điều này quan trọng:
 * theo chuẩn, một `BroadcastChannel` **không nhận thông điệp của chính nó**, nên
 * một bài kiểm gọi `announceSessionUser` trong cùng một module sẽ **không bao
 * giờ** đo được điều nó định đo. Bản đầu của bài này mắc đúng lỗi ấy.
 */

let tab1: typeof import('./sessionIdentity');
let tab2Identity: typeof import('./sessionIdentity');
let RequireAuth: typeof import('./RequireAuth').RequireAuth;
let meQueryKey: typeof import('../api/useMe').meQueryKey;
/**
 * `LanguageProvider` NHẬP ĐỘNG, trong cùng `vi.resetModules()` với
 * `RequireAuth` — không phải ở đầu tệp.
 *
 * Mỗi "tab" ở đây là một ĐỒ THỊ MODULE riêng (đó là toàn bộ cơ chế của bài
 * kiểm này). Một `LanguageProvider` nhập tĩnh dựng `LanguageContext` của đồ thị
 * GỐC, trong khi `<RequireAuth>` vừa nhập đọc context của đồ thị MỚI — hai
 * object khác nhau, nên provider không với tới được và `useLanguage()` ném.
 * Cùng cái bẫy, cùng cách sửa như `sync/crossTabSession.test.tsx`.
 */
let LanguageProvider: typeof import('../i18n/LanguageProvider').LanguageProvider;

beforeEach(async () => {
  vi.resetModules();
  tab1 = await import('./sessionIdentity'); // tab 1 — chỉ công bố, không render

  vi.resetModules();
  tab2Identity = await import('./sessionIdentity'); // tab 2 — tab được render
  RequireAuth = (await import('./RequireAuth')).RequireAuth;
  meQueryKey = (await import('../api/useMe')).meQueryKey;
  LanguageProvider = (await import('../i18n/LanguageProvider')).LanguageProvider;
});

afterEach(() => {
  tab1.__resetSessionIdentityForTests();
  tab2Identity.__resetSessionIdentityForTests();
});

function renderTab2() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(meQueryKey, { id: 'A', email: 'a@x.vn', name: 'Người A' });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider><MemoryRouter initialEntries={['/c/demo/p1']}>
        <Routes>
          <Route
            path="/c/:courseId/:chapterId"
            element={<RequireAuth><p>Ghi chú riêng của A</p></RequireAuth>}
          />
          <Route path="/login" element={<p>Màn đăng nhập</p>} />
        </Routes>
      </MemoryRouter></LanguageProvider>
    </QueryClientProvider>,
  );
}

describe('C-1 nửa màn hình', () => {
  it('ĐỐI CHỨNG: chưa ai chiếm phiên thì nội dung của A vẫn hiện', async () => {
    tab2Identity.announceSessionUser('A');
    renderTab2();
    expect(await screen.findByText('Ghi chú riêng của A')).toBeInTheDocument();
    expect(screen.queryByText('Màn đăng nhập')).toBeNull();
  });

  it('tab khác đăng nhập thành B ⇒ tab này rời khỏi nội dung của A', async () => {
    tab2Identity.announceSessionUser('A');
    renderTab2();
    // Đối chứng dương TRƯỚC: nội dung của A đang thật sự hiện.
    expect(await screen.findByText('Ghi chú riêng của A')).toBeInTheDocument();

    tab1.announceSessionUser('B');

    expect(await screen.findByText('Màn đăng nhập')).toBeInTheDocument();
    expect(screen.queryByText('Ghi chú riêng của A')).toBeNull();
  });

  it('tab khác ĐĂNG XUẤT cũng đẩy tab này ra — không riêng ca đổi tài khoản', async () => {
    tab2Identity.announceSessionUser('A');
    renderTab2();
    expect(await screen.findByText('Ghi chú riêng của A')).toBeInTheDocument();

    tab1.announceSessionUser(null);

    expect(await screen.findByText('Màn đăng nhập')).toBeInTheDocument();
  });
});

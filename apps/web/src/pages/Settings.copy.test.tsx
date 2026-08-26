import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { meQueryKey, type Me } from '../api/useMe';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { VaultFrameProvider } from '../shell/VaultFrame';
import { ThemeProvider } from '../theme/ThemeContext';
import { Settings } from './Settings';

/**
 * TỆP RIÊNG, KHÔNG PHẢI THÊM VÀO `Settings.test.tsx` — có chủ ý.
 *
 * task-14 fix-round-2: `Settings.tsx` VÀ `Settings.test.tsx` đang mang việc
 * dở dang chưa commit của người dùng (`git status` xác nhận cả hai đều
 * modified lúc tệp này được viết). Sửa một trong hai file đó — kể cả chỉ để
 * thêm một bài kiểm — là đụng vào việc đang làm dở của người khác. Một tệp
 * MỚI thì không đụng gì cả: nó không tồn tại trước đó, nên không có "bản của
 * ai" để va chạm. Đây là lối đi mà fix-round-1 không thấy.
 *
 * Bài kiểm harness ở dưới CHỦ Ý lặp lại `Settings.test.tsx`'s (provider
 * stack, `me` gieo thẳng vào cache) thay vì import nó — cùng lý do: import
 * một hàm từ tệp đang có việc dở dang vẫn là một điểm chạm, dù không sửa chữ
 * nào trong đó.
 */

const SIGNED_IN: Me = { id: 'u1', email: 'hoc@vidu.vn', name: 'Người học' };

function renderSettings() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(meQueryKey, SIGNED_IN);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/settings']}>
        <LanguageProvider>
          <ThemeProvider>
            <VaultFrameProvider origin="http://localhost:5174">
              <Settings />
            </VaultFrameProvider>
          </ThemeProvider>
        </LanguageProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Cùng cái bẫy `Settings.test.tsx` đã ghi lại: giao diện/ngôn ngữ cất vào `localStorage` và sống sót qua các bài. */
beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

/**
 * BẢO VỆ CHỐNG TÁI PHẠM (spec `2026-08-25-server-side-pivot.md` §0.2, §1).
 *
 * `/settings` đã mang lời hứa sai này HAI LẦN trong đúng một pha:
 * `settings.localData.blurb` ("Gói khoá học và ghi chú nằm trong trình
 * duyệt này") và `settings.account.signOutWarning` ("...gói đã tải, ghi
 * chú...") — cả hai bị sửa ở fix-round-1 sau khi review tự đi kiểm tra
 * `Settings.tsx` render ra gì, chứ không phải vì bài kiểm nào bắt được.
 * Trang này là trang đáng có cổng nhất trong cả task, đúng như review đã
 * nói.
 *
 * Quét NGUYÊN VĂN `document.body.textContent`, giống hệt cách
 * `Login.test.tsx` canh trang đăng nhập — không so khớp một khoá cụ thể,
 * nên nó vẫn đỏ nếu lời hứa cũ quay lại qua bất kỳ khoá nào khác, kể cả một
 * khoá mới không ai đặt tên trước.
 *
 * Hai cụm dưới đây là NGUYÊN VĂN của bản lỗi cũ (chữ hoa, thứ tự từ đúng
 * như nó từng đứng) — không phải "gói" nói chung, vì bản ĐÃ SỬA vẫn nhắc tới
 * "gói" một cách hợp lệ (phủ định nó: "không tải gói nào về máy"). Một bộ
 * lọc rộng hơn sẽ tự đỏ ngay trên chính bản đã sửa.
 */
describe('Cài đặt — không còn hứa gói khoá học nằm trên máy (task-14, fix-round-2)', () => {
  it('không chứa "gói đã tải" hay "Gói khoá học" ở bất cứ đâu trên trang', async () => {
    renderSettings();

    // Chốt chống-vacuous: hai khối mang hai câu từng sai phải THẬT SỰ có mặt
    // trước khi phép quét "không chứa" có nghĩa gì.
    expect(await screen.findByRole('heading', { name: 'Tài khoản' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Dữ liệu trên máy' })).toBeInTheDocument();

    const rendered = document.body.textContent ?? '';
    expect(rendered.toLowerCase()).not.toContain('gói đã tải');
    expect(rendered.toLowerCase()).not.toContain('gói khoá học');
  });
});

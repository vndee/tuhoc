import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { meQueryKey, type Me } from '../api/useMe';
import { t } from '../i18n';
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
 * BẢO VỆ CHỐNG TÁI PHẠM (spec `2026-08-25-server-side-pivot.md` §0.2, §0.1, §1).
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
 * DANH SÁCH GỘP với `Login.test.tsx` (cùng nội dung, LẶP LẠI KHÔNG IMPORT —
 * xem đầu tệp này cho lý do không dùng chung harness giữa hai tệp). Bốn mục
 * đầu là NGUYÊN VĂN hai bản lỗi cũ của CHÍNH trang này lẫn của `/login`
 * (task-14) — không phải "gói" nói chung, vì bản ĐÃ SỬA vẫn nhắc tới "gói"
 * một cách hợp lệ (phủ định nó: "không tải gói nào về máy"); một bộ lọc rộng
 * hơn sẽ tự đỏ ngay trên chính bản đã sửa. Hai mục cuối là lời hứa thứ BA —
 * trợ lý AI từng chạy bằng key riêng của người học, không đi qua máy chủ —
 * sai từ khi AI chuyển hẳn lên máy chủ (task-15, spec §0.1). Trang này
 * không tự render `login.point.ownKey`, nhưng canh nó ở đây vẫn có nghĩa:
 * `settings.ai.blurb` nói về CHÍNH đường AI đó, và một biên tập lại lỡ mượn
 * câu chữ Pha 1 khi viết lại mục Trợ lý AI sẽ bị bắt ngay tại đây.
 *
 * GIỚI HẠN ĐÃ ĐO, KHÔNG SUY ĐOÁN (xem `Login.test.tsx` cho bản đầy đủ): đây
 * là so khớp CỤM CỐ ĐỊNH, không phải so khớp NGỮ NGHĨA — một câu diễn đạt
 * LẠI cùng nghĩa nhưng né cả sáu cụm dưới đây đi qua MÀ KHÔNG BỊ BẮT (đo
 * được ở task-15-report.md). Vẫn chọn cách này vì so khớp ngữ nghĩa không
 * làm được trong một unit test đồng bộ không gọi mô hình, và cụm cố định
 * vẫn bắt được ca hồi quy THỰC TẾ NHẤT — ai đó khôi phục lại NGUYÊN VĂN câu
 * cũ.
 */
const LOI_HUA_DA_CHET_VI = [
  /ngoại tuyến/i,
  /trên máy bạn/i,
  /gói đã tải/i,
  /gói khoá học/i,
  /key của chính bạn/i,
  /không đi qua máy chủ/i,
];

describe('Cài đặt — không còn hứa gói khoá học nằm trên máy, hay trợ lý AI chạy bằng key riêng (task-14, task-15)', () => {
  it('không chứa bất kỳ lời hứa nào trong danh sách LOI_HUA_DA_CHET_VI ở bất cứ đâu trên trang', async () => {
    renderSettings();

    // Chốt chống-vacuous: hai khối mang hai câu từng sai phải THẬT SỰ có mặt
    // trước khi phép quét "không chứa" có nghĩa gì.
    expect(await screen.findByRole('heading', { name: 'Tài khoản' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Dữ liệu trên máy' })).toBeInTheDocument();

    const rendered = document.body.textContent ?? '';
    for (const loiHua of LOI_HUA_DA_CHET_VI) {
      expect(rendered).not.toMatch(loiHua);
    }
  });

  /**
   * CÙNG CỔNG, PHÍA TIẾNG ANH — xem lý giải đầy đủ ở `Login.test.tsx`'s bài
   * song sinh. `try`/`finally` xoá `itbook-lang` để không rò rỉ tiếng Anh
   * sang bài kiểm khác trong tệp: khoá này là tuỳ chọn THIẾT BỊ, nên
   * `localStorage.clear()` ở `beforeEach` bên dưới mới là thứ thật sự dọn nó
   * — nhưng dọn TRƯỚC khi bài chạy, không phải sau, nên vẫn cần tự dọn ở đây.
   */
  it('bản tiếng Anh cũng không còn hứa "your own key" hay "never passes through our servers"', async () => {
    localStorage.setItem('itbook-lang', 'en');
    try {
      renderSettings();

      expect(await screen.findByRole('heading', { name: t('en', 'settings.section.account') })).toBeInTheDocument();
      expect(
        await screen.findByRole('heading', { name: t('en', 'settings.section.localData') }),
      ).toBeInTheDocument();

      const rendered = document.body.textContent ?? '';
      expect(rendered).not.toMatch(/your own key/i);
      expect(rendered).not.toMatch(/never passes through our servers/i);
    } finally {
      localStorage.removeItem('itbook-lang');
    }
  });
});

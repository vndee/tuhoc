import { useCallback, useEffect, useState } from 'react';
import { readLocalStorage, writeLocalStorage } from '../db/local';

/**
 * Khoá đã được phân loại là TUỲ CHỌN CỦA THIẾT BỊ ở `db/local.ts` — cùng hạng
 * với `itbook-theme` và `itbook-lang`, không phải nội dung của người dùng, nên
 * `clearLocalData()` cố ý không xoá nó: đăng xuất không nên đổi bố cục cửa sổ.
 *
 * Bản đầu của tệp này gọi thẳng `localStorage` và cổng "no third place for user
 * data to hide" (`db/local.test.ts`) đỏ ngay — đúng việc nó tồn tại để làm. Mọi
 * lệnh đọc/ghi đi qua hai hàm dưới đây, và chúng cũng đã tự nuốt ngoại lệ của
 * chế độ riêng tư.
 */
const STORAGE_KEY = 'itbook-nav-collapsed';

/**
 * Ngưỡng "màn rộng", khớp ĐÚNG với `@media (max-width:980px)` của
 * `packages/course-kit/reader.css` — dưới ngưỡng ấy `#sidebar` đã là một ngăn
 * kéo trượt (`body.nav-open`), nên thu gọn ở đó là thu gọn một thứ vốn đã ẩn.
 *
 * Viết `min-width: 981px` chứ không `min-width: 980.02px`: reader.css dùng số
 * nguyên nên hai luật khít nhau ở mọi bề rộng nguyên, và bề rộng phân số chỉ
 * xuất hiện khi trình duyệt thu phóng — ở đó lệch một luật là không vẽ gì cả
 * trong một dải rộng dưới 1px.
 */
export const WIDE_QUERY = '(min-width: 981px)';

function readStored(): boolean {
  return readLocalStorage(STORAGE_KEY) === 'true';
}

/**
 * THU GỌN THANH BÊN — trạng thái BỀN, khác hẳn ngăn kéo của màn hẹp.
 *
 * Hai cơ chế, cố ý không gộp, vì mặc định của chúng ngược nhau:
 *
 *   · dưới 981px `#sidebar` MẶC ĐỊNH ẩn và `body.nav-open` mở tạm nó ra —
 *     `useMobileNav` đóng lại khi đổi route, khi bấm ra ngoài, khi bấm Escape;
 *   · từ 981px trở lên `#sidebar` MẶC ĐỊNH hiện, và thu gọn là một lựa chọn
 *     người dùng cố ý, nên nó phải SỐNG QUA đổi route và qua tải lại trang.
 *
 * Gộp hai thứ vào một cờ sẽ cho ra hành vi sai ở cả hai đầu: hoặc ngăn kéo của
 * điện thoại tự mở lại sau mỗi lần điều hướng, hoặc lựa chọn thu gọn trên máy
 * bàn bị xoá mỗi lần bấm sang chương khác.
 *
 * Chỉ có MỘT nút cho cả hai (`#menu-btn`), vì với người dùng thì đó là cùng
 * một câu: "cho tôi thấy / đừng cho tôi thấy thanh điều hướng". Nút chọn cơ
 * chế theo bề rộng ngay lúc bấm — xem `App.tsx`.
 */
export function useSidebarCollapse(): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState(readStored);

  useEffect(() => {
    writeLocalStorage(STORAGE_KEY, String(collapsed));
  }, [collapsed]);

  const toggle = useCallback(() => {
    setCollapsed((value) => !value);
  }, []);

  return { collapsed, toggle };
}

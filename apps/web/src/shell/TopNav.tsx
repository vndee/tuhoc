import { NavLink, useLocation } from 'react-router-dom';
import { useMe } from '../api/useMe';
import { useLanguage } from '../i18n/LanguageProvider';
import { Logo } from './Logo';

/**
 * ĐIỀU HƯỚNG CHUNG, nay ở thanh trên chứ không ở thanh bên.
 *
 * Người dùng yêu cầu: "navigation không nên nằm cùng sidebar với mục lục, chỗ
 * đó nên cho mục lục thôi."
 *
 * Repo đã tự đi tới kết luận này một lần rồi, chỉ chưa áp ra ngoài chế độ đọc.
 * `styles/reader-layout.css` viết thẳng ở đầu tệp: "`#sidebar` biến mất. Cùng
 * với nó là mô hình điều hướng THỨ HAI mà trang chương vẫn mang (năm liên kết
 * phẳng + mục lục khoá học)." Cái mới chỉ là mở rộng đúng luật ấy ra cả app —
 * thanh bên có MỘT nghĩa và chỉ một: bạn đang ở trong một khoá, đây là mục lục
 * của nó.
 *
 * ── VÌ SAO Ở ĐÂY MÀ KHÔNG PHẢI TRONG `<Topbar>` ──────────────────────────
 * Cùng lý do `<LanguageSwitcher>` không ở trong ấy, và `App.tsx` đã ghi lại:
 * `<Topbar>` nhận mọi thứ qua props và được ba tệp test dựng TRỰC TIẾP, nên
 * cho nó đọc `useMe()` (tức là cần QueryClientProvider) sẽ bắt ba tệp ấy phải
 * dựng provider mà chẳng đo thêm được gì. Ở đây các điều khiển vẫn nằm trong
 * `#topbar` thật vì `App.tsx` gắn chúng vào cùng một khe.
 *
 * ── BA ĐÍCH, MỘT HÀNG NGANG ──────────────────────────────────────────────
 * Chỉ có ba nơi chốn nên chúng vừa một hàng, không cần cả một cột dọc để
 * chứa. Nếu số đích tăng thì hàng ngang sẽ chật và đó là lúc phải tính lại —
 * chứ không phải lúc lặng lẽ thêm mục thứ tư vào đây.
 */

// Khớp `/c/:courseId/:chapterId`. Bản sao thứ năm của biểu thức này, và cố ý
// không dùng chung — lý do ở doc của `Topbar`: đây là chrome dựng CẠNH
// `<AppRoutes>` chứ không nằm trong một `<Route>` đã khớp, nên nó chỉ thấy
// được pathname.
const CHAPTER_ROUTE = /^\/c\/[^/]+\/[^/]+/;

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex items-center h-9 px-3 rounded-sm text-sm no-underline transition-colors',
    isActive
      ? 'bg-brand-50 text-brand-700 font-semibold'
      : 'text-gray-600 font-medium hover:bg-gray-50 hover:text-gray-900',
  ].join(' ');
}

/**
 * Nhãn hiệu + ba đích. Dựng ở ĐẦU `#topbar`, nên nó cũng là thứ đầu tiên
 * trong thứ tự tab — khớp với thứ tự mắt đọc.
 */
export function TopNav() {
  const meQuery = useMe();
  const location = useLocation();
  const { t } = useLanguage();

  // Chế độ đọc KHÔNG có điều hướng chung. Đọc là một chế độ có lối ra, không
  // phải một trang trong menu — `#reader-nav` ngay bên cạnh mang "Thoát" và
  // "Mục lục", và một hàng menu đứng cạnh một nút Thoát là hai câu trả lời cho
  // cùng một câu hỏi.
  if (CHAPTER_ROUTE.test(location.pathname)) return null;

  // HAI PHẦN TỬ ANH EM, không phải một hộp bọc cả hai — và đó là điều kiện để
  // màn hẹp dùng được.
  //
  // `#topbar` là một flex container. Bọc nhãn hiệu và thanh điều hướng trong
  // MỘT `<div>` thì chúng là một flex item duy nhất, và ở 375px cái item ấy
  // rộng hơn cả thanh: đo được là logo 28 + ba mục ~270 + điều khiển bên phải
  // ~200 ≈ 520px trên một màn 375px. Không có cách nào xuống dòng vì không có
  // đường nối nào để cắt. Tách ra thì `flex-wrap` ở `shell-modes.css` đẩy được
  // riêng thanh điều hướng xuống hàng dưới.
  //
  // e2e bắt được đúng chỗ này: `s1.spec.ts` §5 đối chứng màn hẹp bấm "Khoá
  // học" ở 375px và hết giờ, vì liên kết bị đẩy ra ngoài thanh.
  return (
    <>
      <div className="tn-brand flex items-center gap-2.5 font-sans">
        <Logo size={28} color="var(--color-brand-600)" />
        <span className="tn-wordmark text-[15px] font-semibold tracking-[-0.01em] text-gray-900">
          {t('app.name')}
        </span>
      </div>

      {/* Ẩn khi chưa đăng nhập: `AppShell` dựng cả trên `/login`, và mời một
          liên kết chỉ có thể quẳng người ta về đúng trang đang đứng thì tệ hơn
          là không mời gì. `useMe` là chính truy vấn `RequireAuth` đọc, nên hỏi
          ở đây không tốn thêm một request nào. */}
      {meQuery.data && (
        <nav aria-label={t('nav.aria.main')} className="tn-nav flex items-center gap-1 font-sans">
          <NavLink to="/" end className={navClass}>
            {t('nav.continue')}
          </NavLink>
          <NavLink to="/courses" className={navClass}>
            {t('nav.courses')}
          </NavLink>
          <NavLink to="/progress" className={navClass}>
            {t('nav.progress')}
          </NavLink>
        </nav>
      )}
    </>
  );
}

/**
 * Tài khoản, ở mép phải thanh trên.
 *
 * Nó KHÔNG phải trang trí: `Cài đặt` vốn sống ở đáy thanh bên, và thanh bên
 * nay không tồn tại ngoài một khoá. Không có chip này thì `/settings` chỉ tới
 * được bằng cách gõ URL — đúng hình dạng "cổng mù #4" mà chính route ấy sinh
 * ra để vá, và `Sidebar.tsx` đã ghi lại nguyên văn.
 *
 * Một liên kết chứ chưa phải một menu: hôm nay nó chỉ cần mang đúng một việc
 * (mở Cài đặt) và mang nó bằng một cú bấm. "Đăng xuất" vẫn ở chỗ cũ trên Bảng
 * điều khiển; gom cả hai vào một menu là việc của bước dựng lại màn Cài đặt.
 */
export function AccountChip() {
  const meQuery = useMe();
  const location = useLocation();
  const { t } = useLanguage();

  if (!meQuery.data) return null;
  if (CHAPTER_ROUTE.test(location.pathname)) return null;

  const email = meQuery.data.email;
  const initials = (meQuery.data.name || email).slice(0, 2).toUpperCase();

  return (
    <NavLink
      to="/settings"
      title={email}
      aria-label={t('account.settings')}
      className={({ isActive }) =>
        [
          'flex items-center gap-2 h-9 pl-1 pr-3 rounded-full no-underline transition-colors font-sans',
          isActive
            ? 'bg-brand-50 text-brand-700'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
        ].join(' ')
      }
    >
      <span
        aria-hidden="true"
        className="flex items-center justify-center w-7 h-7 rounded-full bg-brand-100 text-brand-700 text-[11px] font-semibold"
      >
        {initials}
      </span>
      <span className="text-sm font-medium">{t('account.settings')}</span>
    </NavLink>
  );
}

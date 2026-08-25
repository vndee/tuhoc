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
      ? 'bg-brand-50 text-brand-700 font-semibold dark:bg-brand-600/15 dark:text-brand-300'
      : 'text-gray-600 font-medium hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-50',
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
        <Logo size={28} boxed />
        <span className="tn-wordmark text-[15px] font-semibold tracking-[-0.01em] text-gray-900 dark:text-gray-50">
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
 * Ô TÌM KIẾM — bản dựng có, app thì chưa từng có.
 *
 * Hôm nay nó là một MẶT TIỀN chưa nối dây: bấm vào không mở gì cả, và điều đó
 * được nói ra bằng `disabled` chứ không bằng một ô nhập trông dùng được nhưng
 * nuốt chữ. Repo này đã có một lần như thế — ô "Tìm chương…" ở thanh bên nằm
 * `disabled` suốt nhiều vòng, và nó hiện cả trên những màn không có chương nào
 * để tìm.
 *
 * Ở đây khác một chỗ: nó CHỈ hiện khi đã đăng nhập và ngoài chế độ đọc, tức
 * đúng những màn mà một ngày nào đó nó sẽ tìm được thật.
 */
export function TopSearch() {
  const meQuery = useMe();
  const location = useLocation();
  const { t } = useLanguage();

  if (!meQuery.data) return null;
  if (CHAPTER_ROUTE.test(location.pathname)) return null;

  return (
    <div
      className="tn-search hidden md:flex items-center gap-2 h-9 w-56 px-3 rounded-md border border-gray-300 bg-white shadow-xs font-sans dark:border-gray-700 dark:bg-gray-900"
      aria-hidden="true"
    >
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
        <circle cx="9" cy="9" r="6.25" stroke="currentColor" strokeWidth="1.5" className="text-gray-400" />
        <path d="M17.5 17.5L13.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-gray-400" />
      </svg>
      <span className="text-sm text-gray-400 flex-1 truncate">{t('topbar.searchPlaceholder')}</span>
      <span className="text-[11px] font-medium text-gray-400 border border-gray-200 rounded-xs px-1.5 py-px bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
        ⌘K
      </span>
    </div>
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

  // MỘT ĐĨA TRÒN ĐẶC, không phải một chip có chữ "Cài đặt" bên cạnh.
  //
  // Bản đầu vẽ cả chữ, và trên máy thật nó đọc như một mục điều hướng thứ tư
  // đứng lạc ở mép phải — đúng thứ bậc phẳng mà cả cuộc thiết kế lại này tồn
  // tại để gỡ. Bản dựng cho tài khoản một đĩa tròn: nó là DANH TÍNH, không
  // phải một nơi chốn, nên nó không được trông giống ba nơi chốn kia.
  //
  // Chữ vẫn còn cho trình đọc màn hình qua `aria-label`, và `title` mang email
  // đầy đủ cho con trỏ chuột — hai chữ cái không đủ để nhận ra mình là ai.
  return (
    <NavLink
      to="/settings"
      title={`${email} — ${t('account.settings')}`}
      aria-label={t('account.settings')}
      className={({ isActive }) =>
        [
          'tn-account flex items-center justify-center w-9 h-9 rounded-full text-[12px] font-semibold no-underline transition-shadow',
          'bg-brand-100 text-brand-700 dark:bg-brand-600/25 dark:text-brand-200',
          isActive ? 'shadow-[0_0_0_3px_var(--color-brand-200)] dark:shadow-[0_0_0_3px_var(--color-brand-800)]' : '',
        ].join(' ')
      }
    >
      <span aria-hidden="true">{initials}</span>
    </NavLink>
  );
}

export interface SidebarTriggerProps {
  /** Mở/đóng ngăn kéo mục lục (`body.nav-open`, xem `useMobileNav`). */
  onMenuClick: () => void;
  /** Ngăn kéo có đang mở không, cho `aria-expanded`. */
  navExpanded?: boolean;
}

/**
 * NÚT MỤC LỤC CỦA MÀN HẸP — và CHỈ của màn hẹp.
 *
 * ── VÌ SAO NÓ KHÔNG CÒN LÀ NÚT THU GỌN ───────────────────────────────────
 * Nút này đã đi qua bốn chỗ: sau ba mục điều hướng (đọc như mục thứ tư), mép
 * trái thanh trên (vẫn nằm TRÊN một dải chạy suốt bề ngang), một hàng riêng
 * dưới thanh trên (đẩy cả trang xuống), rồi cùng hàng với hàng badge (đè lên
 * nội dung). Người dùng bác cả bốn, và câu cuối là: "bỏ nút đó ở trang này
 * luôn".
 *
 * Điều đó ĐÚNG, và lý do đọc được từ chính sản phẩm: thu gọn mục lục tồn tại
 * để lấy thêm bề ngang khi đang học — mà lúc đang học thì `#app.reading` đã
 * gỡ hẳn thanh bên đi rồi. Chỗ duy nhất còn nút là TRANG KHOÁ HỌC, nơi nội
 * dung là một bản tóm tắt ngắn và bề ngang thừa chứ không thiếu. Một điều
 * khiển chỉ xuất hiện ở nơi nó vô ích thì không phải một tính năng.
 *
 * Nên thu gọn-bền bị gỡ (`useSidebarCollapse` không còn), và nút này lui về
 * đúng việc v1 giao cho nó: mở NGĂN KÉO mục lục dưới 981px, nơi `#sidebar`
 * mặc định trượt ra ngoài màn hình và không còn cách nào khác để gọi nó ra.
 * `reader.css` đã tự lo phần hiện/ẩn ấy (`#menu-btn{display:none}` mặc định,
 * `display:inline-flex !important` dưới `max-width:980px`), nên bản này không
 * cần một luật nào để chỉ có mặt trên điện thoại.
 *
 * `id="menu-btn"` giữ nguyên qua cả bốn lần: `reader.css`, `shell-modes.css`,
 * `useMobileNav` và ba tệp e2e đều định vị theo nó.
 */
export function SidebarTrigger({ onMenuClick, navExpanded = true }: SidebarTriggerProps) {
  const { t } = useLanguage();

  return (
    <button
      id="menu-btn"
      type="button"
      className="tb-btn"
      aria-label={t('topbar.menu')}
      aria-expanded={navExpanded}
      aria-controls="sidebar"
      onClick={onMenuClick}
    >
      {/* `PanelLeft` — một khung với vách ngăn bên trái, đúng icon shadcn dùng
          cho nút này. Hamburger nói "có một menu ở đây"; icon này nói "có một
          CỘT bật tắt được", tức đúng việc nút này làm. */}
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 3.75v12.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </button>
  );
}

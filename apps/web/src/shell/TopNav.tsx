import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useMe, accountInitials } from '../api/useMe';
import { useLogout } from '../auth/useLogout';
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
 * Ô TÌM KIẾM — MỘT BIỂU TƯỢNG BUNG RA, không phải một hộp luôn mở.
 *
 * Bản dựng đặt ở đây một nút tròn mang kính lúp; bấm vào thì nó dài ra thành
 * một ô nhập. Bản trước dựng thẳng cái hộp 224px và để nó mở suốt — chiếm một
 * phần tư nhóm phải của thanh trên cho một thứ chưa làm được việc gì.
 *
 * ── NÓ VẪN CHƯA TÌM ĐƯỢC GÌ, VÀ ĐIỀU ĐÓ ĐƯỢC NÓI RA ─────────────────────
 * Sản phẩm này chưa có chỉ mục tìm kiếm. Một ô nhập trông dùng được nhưng nuốt
 * chữ là đúng cái bẫy repo đã dính một lần (ô "Tìm chương…" ở thanh bên nằm
 * `disabled` suốt nhiều vòng), nên ô ở đây `disabled` thật, có `title` nói ra
 * lý do, và dòng "sắp có" hiện ngay dưới khi nó mở.
 *
 * Cái BUNG RA thì thật: chiều rộng chạy bằng `transition`, `aria-expanded` nói
 * đúng trạng thái, Escape đóng lại. Khi có chỉ mục thật, chỗ duy nhất phải sửa
 * là bỏ `disabled` và nối `onChange`.
 */
export function TopSearch() {
  const meQuery = useMe();
  const location = useLocation();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Mở ra thì con trỏ phải nhảy vào ô — nếu không, người dùng bấm xong vẫn
  // phải bấm lần nữa. `disabled` không nhận focus, nên đây là chỗ DUY NHẤT
  // trong tệp sẽ phải đổi khi ô được nối dây thật.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!meQuery.data) return null;
  if (CHAPTER_ROUTE.test(location.pathname)) return null;

  return (
    <div className={open ? 'tn-search-wrap is-open' : 'tn-search-wrap'}>
      <button
        type="button"
        className="tb-btn tn-search-btn"
        aria-label={t(open ? 'topbar.searchClose' : 'topbar.searchOpen')}
        aria-expanded={open}
        aria-controls="topbar-search"
        onClick={() => setOpen((on) => !on)}
      >
        <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="9" cy="9" r="6.25" stroke="currentColor" strokeWidth="1.6" />
          <path d="M17.5 17.5L13.5 13.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>

      {/*
        Ô nhập LUÔN Ở TRONG CÂY, chỉ bị bóp về bề rộng 0 — không phải dựng lại
        mỗi lần mở. Một phần tử vừa được thêm vào DOM không có trạng thái "bề
        rộng cũ" để `transition` chạy từ đó, nên bản dựng-lại sẽ nhảy phịch
        thay vì trượt ra.
      */}
      <div className="tn-search-field" id="topbar-search">
        <input
          ref={inputRef}
          type="search"
          className="tn-search-input"
          placeholder={t('topbar.searchPlaceholder')}
          title={t('topbar.searchSoon')}
          aria-label={t('topbar.searchPlaceholder')}
          disabled
          tabIndex={open ? 0 : -1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
          }}
        />
        <span className="tn-search-kbd" aria-hidden="true">
          ⌘K
        </span>
      </div>
    </div>
  );
}

/**
 * Tài khoản, ở mép phải thanh trên — MỘT MENU, không còn là một liên kết.
 *
 * Bản dựng vẽ đĩa tròn kèm một mũi tên xuống, và mũi tên ấy là một lời hứa:
 * bấm vào thì có một danh sách. Bản trước là `<NavLink to="/settings">` không
 * mũi tên, đúng với việc nó chỉ mang một đích.
 *
 * Điều kiện cũ vẫn được giữ NGUYÊN VẸN: `Cài đặt` phải tới được — đó là ruling
 * S1-F29 / cổng mù #4, vì thanh bên (chỗ ở cũ của nó) không tồn tại ngoài một
 * khoá. Nay nó là mục đầu tiên trong menu.
 *
 * "Đăng xuất" vào cùng menu, và đó là chỗ ĐÚNG chứ không phải một cánh cửa thứ
 * hai bừa bãi: nó là hành động về TÀI KHOẢN, và menu tài khoản là nơi mọi sản
 * phẩm đặt nó. Bản trên trang Cài đặt ở lại vì nó đi kèm câu cảnh báo dài về
 * dữ liệu trên máy — thứ không nhét vào một menu được.
 */
export function AccountChip() {
  const meQuery = useMe();
  const location = useLocation();
  const { t } = useLanguage();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Bấm ra ngoài và Escape đều đóng. Đăng ký MỘT lần, và tự gỡ khi component
  // rời đi — cùng hình dạng với `useMobileNav`.
  useEffect(() => {
    if (!open) return;
    function onDocPointer(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Đổi trang thì đóng menu — nếu không, mục "Cài đặt" vừa bấm sẽ để lại một
  // menu lơ lửng trên trang mới.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  if (!meQuery.data) return null;
  if (CHAPTER_ROUTE.test(location.pathname)) return null;

  const { name, email } = meQuery.data;

  return (
    <div className="tn-account-wrap" ref={wrapRef}>
      <button
        type="button"
        className="tn-account"
        aria-label={t('account.menuAria')}
        aria-haspopup="menu"
        aria-expanded={open}
        title={email}
        onClick={() => setOpen((on) => !on)}
      >
        <span className="tn-account-disc" aria-hidden="true">
          {accountInitials(name, email)}
        </span>
        <svg className="tn-account-caret" width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M6 8.5l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="tn-menu" role="menu" aria-label={t('account.menuAria')}>
          {/*
            Danh tính đứng đầu menu và KHÔNG phải một mục bấm được: hai chữ cái
            trên đĩa tròn không đủ để nhận ra mình là ai, nhất là trên một máy
            hai người dùng chung — đúng ca mà cả `auth/RequireAuth.tsx` và
            `test/accountHandoff.test.tsx` tồn tại vì nó.
          */}
          <p className="tn-menu-id">
            {name !== '' && <span className="tn-menu-name">{name}</span>}
            <span className="tn-menu-email">{email}</span>
          </p>
          <Link to="/settings" role="menuitem" className="tn-menu-item">
            {t('account.settings')}
          </Link>
          <button
            type="button"
            role="menuitem"
            className="tn-menu-item tn-menu-danger"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            {t('account.logout')}
          </button>
        </div>
      )}
    </div>
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

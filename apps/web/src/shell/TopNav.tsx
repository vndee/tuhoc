import { useEffect, useRef, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  fetchSearch,
  isQueryLongEnough,
  searchQueryKey,
  type ChapterHit,
  type SearchResults,
} from '../api/search';
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

// Lớp NGỮ NGHĨA, không phải chuỗi utility: kiểu của running head nằm ở
// `styles/shell-modes.css` (`#topbar .tn-link`), nơi nó đứng cạnh luật của
// chính `#topbar` — một chỗ để đổi, không phải hai. Viên nền tím cho mục đang
// chọn đã đi cùng kit cũ; mục đang chọn nay là màu nhấn + một gạch chân hairline.
function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'tn-link is-active' : 'tn-link';
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
      <div className="tn-brand flex items-center gap-2.5">
        {/* KHÔNG `boxed` nữa (vòng 1, 03/09/2026). Ô vuông bo góc 7px tô
            `--color-brand-600` là mảnh cuối cùng của kit Untitled UI còn đứng
            trên màn: trong thế giới "một bàn tay, hai mặt viết" không có góc
            bo và không có khối tô nền, nên nó là màu lạ duy nhất trên trang.
            HÌNH của mark không đổi — nó là quyết định của chủ dự án
            (PRODUCT.md, Brand Commitments), chỉ cái hộp quanh nó đi. */}
        <Logo size={26} />
        <span className="tn-wordmark">
          {t('app.name')}
        </span>
      </div>

      {/* Ẩn khi chưa đăng nhập: `AppShell` dựng cả trên `/login`, và mời một
          liên kết chỉ có thể quẳng người ta về đúng trang đang đứng thì tệ hơn
          là không mời gì. `useMe` là chính truy vấn `RequireAuth` đọc, nên hỏi
          ở đây không tốn thêm một request nào. */}
      {meQuery.data && (
        <nav aria-label={t('nav.aria.main')} className="tn-nav flex items-center">
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
 * Ô TÌM KIẾM — MỘT BIỂU TƯỢNG BUNG RA, và từ 04/09/2026 nó tìm được thật.
 *
 * Bản dựng đặt ở đây một nút tròn mang kính lúp; bấm vào thì nó dài ra thành
 * một ô nhập. Bản trước dựng thẳng cái hộp 224px và để nó mở suốt — chiếm một
 * phần tư nhóm phải của thanh trên cho một thứ chưa làm được việc gì.
 *
 * ── LỜI HỨA ĐÃ ĐƯỢC THU ──────────────────────────────────────────────────
 * Ô này từng `disabled` thật, với `title` nói "Tìm kiếm chưa nối dây — sắp
 * có." Đó là lựa chọn ĐÚNG khi chưa có chỉ mục: một ô nhập trông dùng được
 * nhưng nuốt chữ là đúng cái bẫy repo đã dính một lần (ô "Tìm chương…" ở
 * thanh bên nằm `disabled` suốt nhiều vòng). Nay có `GET /search`
 * (`apps/api/internal/search`), nên `disabled` đi, và chuỗi "sắp có" bị xoá
 * khỏi cả hai bảng ngôn ngữ chứ không để lại làm hoá thạch.
 *
 * Gợi ý `⌘K` in cạnh ô cũng vậy: nó nằm đó từ lâu mà không có handler nào
 * đứng sau. Một phím tắt được QUẢNG CÁO mà không tồn tại thì tệ hơn không
 * quảng cáo gì.
 *
 * ── VÌ SAO KHÔNG TỰ TÔ SÁNG CHỖ KHỚP ─────────────────────────────────────
 * Máy chủ trả đoạn trích đã cắt sẵn ba mảnh (`before`/`match`/`after`) và nơi
 * này chỉ việc bọc mảnh giữa. Cách kia — tìm lại chuỗi truy vấn trong đoạn
 * trích rồi tô — sai ở hai chỗ cùng lúc: chỗ khớp thật nằm trong văn bản ĐÃ
 * GỠ THẺ mà client không có, và phép so khớp không phân biệt hoa thường theo
 * Unicode ở JavaScript không nhất thiết trùng với phép của Go.
 */
export function TopSearch() {
  const meQuery = useMe();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Truy vấn HOÃN LẠI, tách khỏi `term`. Ô nhập phải phản hồi từng phím —
  // đó là `term`; còn thứ đi ra mạng chỉ đổi khi người dùng ngừng gõ. Gộp
  // hai thứ vào một state nghĩa là mỗi phím một request.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(term), 200);
    return () => window.clearTimeout(id);
  }, [term]);

  const enabled = open && isQueryLongEnough(debounced);
  const results = useQuery({
    queryKey: searchQueryKey(debounced, PANEL_LIMIT),
    queryFn: () => fetchSearch(debounced, PANEL_LIMIT),
    enabled,
  });

  // Mở ra thì con trỏ phải nhảy vào ô — nếu không, người dùng bấm xong vẫn
  // phải bấm lần nữa.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // ⌘K / Ctrl+K: mở ô và đưa con trỏ vào. Gắn ở `document` chứ không ở một
  // phần tử nào, vì phím tắt phải chạy dù con trỏ đang ở đâu — đó là toàn bộ
  // ý nghĩa của một phím tắt toàn cục.
  //
  // `preventDefault` để không rơi vào hộp thoại tìm-trong-trang của trình
  // duyệt (Firefox nối ⌘K vào thanh địa chỉ).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Bấm ra ngoài thì đóng. Nghe ở `pointerdown` chứ không `click`: một cú bấm
  // vào một liên kết trong bảng sẽ điều hướng đi, và `click` tới sau
  // `pointerdown` đủ muộn để bảng đã kịp biến mất giữa chừng.
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Danh sách PHẲNG của mọi đích bấm được, đúng thứ tự chúng hiện ra — ↑/↓ đi
  // qua nó, không qua hai nhóm riêng. Người dùng thấy một danh sách; bàn phím
  // phải đồng ý với mắt.
  const items: { key: string; to: string }[] = [
    ...(results.data?.courses ?? []).map((c) => ({ key: `course:${c.slug}`, to: `/c/${encodeURIComponent(c.slug)}` })),
    ...(results.data?.chapters ?? []).map((c) => ({
      key: `chapter:${c.slug}:${c.chapterId}`,
      to: `/c/${encodeURIComponent(c.slug)}/${encodeURIComponent(c.chapterId)}`,
    })),
  ];

  // Kết quả đổi thì lựa chọn cũ vô nghĩa — giữ lại nó sẽ khiến Enter mở một
  // thứ người dùng không còn nhìn thấy.
  useEffect(() => setActive(-1), [debounced]);

  function go(to: string) {
    setOpen(false);
    setTerm('');
    navigate(to);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      // Escape MỘT lần xoá chữ (bảng biến mất theo, vì bảng chỉ hiện khi có
      // đủ chữ), lần nữa mới đóng ô. Đóng thẳng cả hai thì một cú Escape để
      // bỏ bảng cũng cuốn theo thứ vừa gõ, và người dùng phải gõ lại từ đầu.
      if (term !== '') setTerm('');
      else setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (items.length === 0) return;
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      // Một vòng tròn qua `items.length + 1` chỗ: chỗ thứ nhất là "chưa chọn
      // gì" (-1), rồi tới từng hit. Nhờ nó ↓ từ hit cuối quay về "chưa chọn
      // gì" — chứ không kẹt ở đáy — và ↑ từ đó nhảy thẳng xuống hit cuối,
      // đúng thói quen của một danh sách bung ra từ trên xuống.
      setActive((i) => ((i + 1 + step + items.length + 1) % (items.length + 1)) - 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && items[active]) go(items[active].to);
      else if (isQueryLongEnough(term)) go(`/search?q=${encodeURIComponent(term.trim())}`);
    }
  }

  if (!meQuery.data) return null;
  if (CHAPTER_ROUTE.test(location.pathname)) return null;

  const showPanel = open && isQueryLongEnough(debounced);

  return (
    <div className={open ? 'tn-search-wrap is-open' : 'tn-search-wrap'} ref={wrapRef}>
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
          aria-label={t('topbar.searchPlaceholder')}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          tabIndex={open ? 0 : -1}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls="topbar-search-results"
          aria-activedescendant={active >= 0 && items[active] ? `tn-hit-${active}` : undefined}
          autoComplete="off"
          onKeyDown={onKeyDown}
        />
        <span className="tn-search-kbd" aria-hidden="true">
          ⌘K
        </span>
      </div>

      {showPanel && (
        <div className="tn-search-panel">
          <SearchPanelBody
            results={results}
            term={debounced}
            items={items}
            active={active}
            onPick={go}
          />
        </div>
      )}
    </div>
  );
}

/** Số hit mỗi loại trong BẢNG THẢ XUỐNG. Trang `/search` xin nhiều hơn — xem
 *  `pages/SearchResults.tsx`. Đủ để thấy có gì, không đủ để phải cuộn trong
 *  một bảng nổi. */
const PANEL_LIMIT = 8;

interface PanelProps {
  results: UseQueryResult<SearchResults>;
  term: string;
  items: { key: string; to: string }[];
  active: number;
  onPick: (to: string) => void;
}

/**
 * Thân bảng thả xuống. Tách khỏi `TopSearch` vì nó có bốn trạng thái thật
 * (đang tải / lỗi / rỗng / có kết quả) và nhét cả bốn vào giữa JSX của ô nhập
 * sẽ làm mất dấu cái quan trọng nhất: LỖI PHẢI HIỆN RA. Một lượt tìm hỏng mà
 * vẽ như "không có kết quả" là nói với người dùng rằng thứ họ tìm không tồn
 * tại — một câu trả lời sai, không phải một câu trả lời thiếu.
 */
function SearchPanelBody({ results, term, items, active, onPick }: PanelProps) {
  const { t } = useLanguage();

  if (results.isError) {
    return (
      <p className="tn-search-note" role="alert">
        {t('topbar.searchError')}
      </p>
    );
  }
  if (!results.data) {
    return <p className="tn-search-note">{t('topbar.searchLoading')}</p>;
  }

  const { courses, chapters, truncated } = results.data;
  if (courses.length === 0 && chapters.length === 0) {
    return <p className="tn-search-note">{t('topbar.searchEmpty', term)}</p>;
  }

  // Chỉ số PHẲNG chạy xuyên hai nhóm, khớp `items` ở `TopSearch` — nếu hai
  // cách đánh số lệch nhau thì ↓ tô sáng một dòng và Enter mở một dòng khác.
  let i = -1;
  const seeAll = `/search?q=${encodeURIComponent(term)}`;

  return (
    <>
      {/*
        `role="listbox"` chỉ bọc ĐÚNG những phần tử là `option`, không bọc gì
        khác. Bản đầu của tệp này để cả dòng ghi chú và liên kết "Xem tất cả"
        nằm trong nó: một listbox có con không phải option là một cây a11y
        nói dối — trình đọc màn hình đếm số lựa chọn theo cấu trúc ấy, và nó
        sẽ đọc ra một con số không khớp thứ ↑/↓ đi qua.
        Nhóm thì được: `role="group"` là con hợp lệ của listbox.
      */}
      <div id="topbar-search-results" role="listbox" aria-label={t('topbar.searchResultsAria')}>
        {courses.length > 0 && (
          <div className="tn-search-group" role="group" aria-labelledby="tn-group-courses">
            <p className="tn-search-group-label" id="tn-group-courses">
              {t('topbar.searchGroupCourses')}
            </p>
            {courses.map((c) => {
              i += 1;
              const index = i;
              return (
                <SearchRow
                  key={c.slug}
                  index={index}
                  active={active === index}
                  to={items[index]?.to ?? seeAll}
                  onPick={onPick}
                  title={c.title}
                />
              );
            })}
          </div>
        )}

        {chapters.length > 0 && (
          <div className="tn-search-group" role="group" aria-labelledby="tn-group-chapters">
            <p className="tn-search-group-label" id="tn-group-chapters">
              {t('topbar.searchGroupChapters')}
            </p>
            {chapters.map((c) => {
              i += 1;
              const index = i;
              return (
                <SearchRow
                  key={`${c.slug}:${c.chapterId}`}
                  index={index}
                  active={active === index}
                  to={items[index]?.to ?? seeAll}
                  onPick={onPick}
                  title={c.chapterTitle}
                  subtitle={t('search.inCourse', c.courseTitle)}
                  snippet={c}
                />
              );
            })}
          </div>
        )}
      </div>

      {truncated && (
        <Link className="tn-search-all" to={seeAll} onClick={() => onPick(seeAll)}>
          {t('topbar.searchSeeAll')}
        </Link>
      )}
    </>
  );
}

interface RowProps {
  index: number;
  active: boolean;
  to: string;
  onPick: (to: string) => void;
  title: string;
  subtitle?: string;
  snippet?: ChapterHit;
}

function SearchRow({ index, active, to, onPick, title, subtitle, snippet }: RowProps) {
  return (
    <Link
      id={`tn-hit-${index}`}
      role="option"
      aria-selected={active}
      className={active ? 'tn-search-hit is-active' : 'tn-search-hit'}
      to={to}
      onClick={(e) => {
        e.preventDefault();
        onPick(to);
      }}
    >
      <span className="tn-search-hit-title">{title}</span>
      {subtitle && <span className="tn-search-hit-sub">{subtitle}</span>}
      {snippet && (
        <span className="tn-search-hit-snippet">
          {snippet.before}
          <mark>{snippet.match}</mark>
          {snippet.after}
        </span>
      )}
    </Link>
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

import type { ReactNode } from 'react';
import { VaultFrameProvider } from './VaultFrame';

export interface ShellProps {
  /** Rendered inside `<aside id="sidebar">`. */
  sidebar: ReactNode;
  /** Rendered inside `<div id="topbar">`. */
  topbar: ReactNode;
  /** Rendered inside `<main id="content">`. */
  children: ReactNode;
  /** Rendered inside `<aside id="rail">`. Optional — not every route has one. */
  rail?: ReactNode;
  /**
   * Origin của kho khoá (`apps/vault`). `undefined` ⇒ lấy từ cấu hình build,
   * là đường đi thật; truyền tường minh là chỗ để test bơm giá trị vào, và
   * `null` là "cố ý không có kho khoá".
   */
  vaultOrigin?: string | null;
  /**
   * Người dùng đã thu gọn thanh điều hướng trên màn rộng (`useSidebarCollapse`).
   * Đặt `.nav-collapsed` lên `#app`; luật ẩn nằm ở `styles/shell-modes.css` và
   * treo dưới `@media (min-width: 981px)` — dưới ngưỡng ấy `#sidebar` vốn đã là
   * ngăn kéo, nên cờ này không nói gì ở đó.
   */
  navCollapsed?: boolean;
  /**
   * `true` on `/c/:courseId/:chapterId` — the READING mode of the two this
   * product has (đặc tả: `docs/superpowers/specs/2026-08-23-ia-redesign.md`).
   * It puts `.reading` on `#app` and nothing else; every difference between
   * the two modes is a rule in `styles/reader-layout.css` hanging off that
   * one class.
   *
   * A class rather than a different tree on purpose. The reading view is the
   * SAME `#app > #sidebar + #main(...)` skeleton — `reader.css` is a
   * byte-for-byte port of v1 and every id in it is load-bearing, `#rail` is
   * where the annotation phase's two reading surfaces live, and `#content`
   * is what three e2e files point at. Rendering a second skeleton for
   * reading mode would fork all of that in order to hide one column.
   */
  reading?: boolean;
  /**
   * `true` trên `/c/:courseId` và `/c/:courseId/:chapterId` — tức là người
   * đọc đang Ở TRONG một khoá. Đặt `.in-course` lên `#app`.
   *
   * Nó điều khiển đúng một thứ: `#sidebar` có chiếm chỗ hay không. Thanh bên
   * nay chỉ mang mục lục (`shell/Sidebar.tsx`), nên ngoài một khoá thì nó
   * không có gì để mang và luật ở `styles/shell-modes.css` thu nó về 0.
   *
   * Một lớp trên `#app` chứ không phải một cây DOM khác, cùng lý do `.reading`
   * đã ghi ngay trên: khung `#app > #sidebar + #main(…)` là thứ reader.css
   * (bản port từng byte của v1) bám vào từng id, và ba tệp e2e trỏ thẳng vào
   * `#content`.
   *
   * ĐỘC LẬP với `reading`, không suy ra được nhau theo chiều nào có ích:
   * đang đọc thì cũng đang trong khoá, nhưng chế độ đọc giấu thanh bên vì một
   * lý do KHÁC (mục lục thành ngăn kéo, xem `reader-layout.css`), nên gộp hai
   * cờ sẽ làm mất lý do của một trong hai.
   */
  inCourse?: boolean;
}

/**
 * The v1 reader DOM skeleton, reproduced exactly so packages/course-kit's
 * reader.css (ported byte-for-byte from the original single-file app)
 * applies without modification:
 *
 *   #app
 *     aside#sidebar
 *     div#main
 *       div#topbar
 *       div#progwrap > div#progbar
 *       div#scroller
 *         div#content-wrap
 *           main#content
 *           aside#rail
 *
 * This component only owns structure/ids — it renders whatever its callers
 * hand it. Sidebar/topbar/rail *content* (nav data, buttons that do
 * something, progress) is intentionally out of scope for this task.
 *
 * Hệ thống con 2 thêm đúng một thứ: `<VaultFrameProvider>` bọc BÊN NGOÀI
 * `#app`. Đây là component duy nhất trong repo được dựng đúng một lần cho mọi
 * route, nên nó là chỗ đúng để gắn khung kho khoá — và vì provider bọc ngoài
 * chứ không lồng vào, DANH SÁCH CON CỦA `#app` KHÔNG ĐỔI và reader.css (chép
 * lại từng byte từ bản v1 một-tệp) vẫn áp đúng. `VaultFrame.test.tsx` khoá
 * chính tính chất đó lại.
 */
export function Shell({
  sidebar,
  topbar,
  children,
  rail,
  vaultOrigin,
  reading = false,
  navCollapsed = false,
  inCourse = false,
}: ShellProps) {
  // Hai lớp độc lập trên cùng một nút, không phải một enum: chế độ đọc là nơi
  // NÀO ta đang ở, thu gọn là lựa chọn của người dùng — chúng chồng nhau được
  // (đọc một chương với thanh bên đã thu gọn từ trước) và không lớp nào suy ra
  // được lớp kia.
  const appClass = [
    reading ? 'reading' : null,
    navCollapsed ? 'nav-collapsed' : null,
    inCourse ? 'in-course' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <VaultFrameProvider origin={vaultOrigin}>
      <div id="app" className={appClass === '' ? undefined : appClass}>
        <aside id="sidebar">{sidebar}</aside>
        <div id="main">
          <div id="topbar">{topbar}</div>
          <div id="progwrap">
            <div id="progbar" />
          </div>
          <div id="scroller">
            <div id="content-wrap">
              <main id="content">{children}</main>
              <aside id="rail">{rail}</aside>
            </div>
          </div>
        </div>
      </div>
    </VaultFrameProvider>
  );
}

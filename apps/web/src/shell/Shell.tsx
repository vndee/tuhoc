import type { ReactNode } from 'react';

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
  /**
   * `true` trên `/login`, và trên `/` khi chưa có phiên (03/09/2026) — hai
   * màn hình TRƯỚC-TÀI-KHOẢN, thứ KHÔNG có thanh trên. Landing mang thế giới
   * hình riêng và tự dựng nhãn hiệu cùng hai điều khiển thiết bị của nó
   * (`pages/Landing.tsx`), đúng như trang đăng nhập đã làm.
   *
   * Người dùng yêu cầu: "bỏ top shell ra khỏi trang đăng nhập". Nó đúng ở một
   * mức sâu hơn thẩm mỹ: thanh trên mang nhãn hiệu, ba đích điều hướng, ô tìm
   * kiếm và chip tài khoản — bốn thứ mà một người CHƯA ĐĂNG NHẬP không dùng
   * được cái nào. `TopNav` đã tự ẩn phần điều hướng khi chưa đăng nhập, nên
   * thứ còn lại là một dải 64px chỉ để chứa hai điều khiển; hai điều khiển ấy
   * nay nằm trong chính panel của trang (`pages/Login.tsx`).
   *
   * `App.tsx` truyền `topbar={null}` cùng lúc, và đó là VẾ BẮT BUỘC chứ không
   * phải tối ưu: ẩn `#topbar` bằng CSS mà vẫn dựng nội dung của nó sẽ để lại
   * MỘT bộ chọn ngôn ngữ thứ hai trong cây — cùng `id`, cùng nhãn trợ năng —
   * và `getByLabelText('Ngôn ngữ giao diện')` sẽ ném lỗi "nhiều phần tử".
   */
  authScreen?: boolean;
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
 * KHÔNG CÓ GÌ BỌC NGOÀI `#app`, và điều đó lại đúng kể từ Task 16. Hệ thống
 * con 2 (Pha 1) treo ở đây một provider bọc BÊN NGOÀI `#app`, giữ khung ẩn của
 * kho khoá: đây là component duy nhất trong repo được dựng đúng một lần cho
 * mọi route, nên nó là chỗ đúng cho một khung phải sống sót qua mọi lần đổi
 * route. Pha 2 chuyển AI lên máy chủ và không còn origin thứ hai nào để treo,
 * nên phần tử gốc mà component này trả về lại đúng là `#app` — hình dạng mà
 * `reader.css` (chép từng byte từ bản v1 một-tệp) được viết cho.
 */
export function Shell({
  sidebar,
  topbar,
  children,
  rail,
  reading = false,
  inCourse = false,
  authScreen = false,
}: ShellProps) {
  // Hai lớp độc lập, không phải một enum: `in-course` là "có một khoá đang
  // mở", `reading` là "đang ở trong một chương của nó". Cái sau kéo theo cái
  // trước, nhưng chúng điều khiển hai thứ khác nhau — xem doc của từng prop.
  const appClass = [
    reading ? 'reading' : null,
    inCourse ? 'in-course' : null,
    authScreen ? 'auth-screen' : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
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
  );
}

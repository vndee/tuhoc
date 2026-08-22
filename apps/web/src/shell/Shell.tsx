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
export function Shell({ sidebar, topbar, children, rail, vaultOrigin }: ShellProps) {
  return (
    <VaultFrameProvider origin={vaultOrigin}>
      <div id="app">
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

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
 */
export function Shell({ sidebar, topbar, children, rail }: ShellProps) {
  return (
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
  );
}

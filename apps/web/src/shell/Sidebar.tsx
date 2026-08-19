/**
 * Sidebar chrome for the v1 skeleton: `.sb-head` (title/subtitle/search),
 * `.sb-prog`, and `nav#nav`. This task only builds the shape — a real course
 * outline, live progress numbers, and working search are Task 10/13's job.
 * `nav#nav` renders reader.css's own `.nav-empty` state, which exists in the
 * original stylesheet for exactly this "nothing loaded yet" case.
 */
export function Sidebar() {
  return (
    <>
      <div className="sb-head">
        <p className="sb-title">
          <svg
            className="mark"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <rect width="20" height="20" rx="5" fill="var(--accent)" />
            <path d="M5 10.5L8.5 14L15 6.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Tự học
        </p>
        <p className="sb-sub">***REMOVED***</p>
        <div className="sb-search">
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
            <path d="M18 18L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input id="nav-search" type="text" placeholder="Tìm chương…" disabled />
        </div>
      </div>
      <div className="sb-prog">Tiến độ sẽ hiện ở đây</div>
      <nav id="nav">
        <p className="nav-empty">Chưa có khóa học nào được tải.</p>
      </nav>
    </>
  );
}

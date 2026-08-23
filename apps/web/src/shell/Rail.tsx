import { useLocation } from 'react-router-dom';

// Matches the `/c/:courseId/:chapterId` route — deliberately not
// `useParams` (see Sidebar's own `courseIdFromPathname` for the same
// reasoning): <Rail> is chrome rendered by <AppShell> alongside
// <AppRoutes>, not inside a matched <Route>, so it only sees the pathname.
const CHAPTER_ROUTE = /^\/c\/[^/]+\/[^/]+/;

/**
 * Right-rail chrome. On chapter pages, `ChapterView` (Task 11) portals its
 * own in-page TOC directly into `#rail` — built from the chapter's own
 * h2/h3s, which this component has no way to know about — so this renders
 * nothing there and gets out of the way. Everywhere else it is a static
 * placeholder so `aside#rail` exists in the DOM skeleton from day one.
 */
export function Rail() {
  const location = useLocation();
  if (CHAPTER_ROUTE.test(location.pathname)) return null;

  // Ở CHẾ ĐỘ THƯ VIỆN cũng không vẽ gì.
  //
  // Trước đây đây là một giữ chỗ tĩnh ("TRONG CHƯƠNG · chưa có nội dung") để
  // `aside#rail` tồn tại trong khung DOM từ ngày đầu — một quyết định dựng
  // khung của P1 đã hết lý do tồn tại. Đặc tả IA nói hai chế độ **cần trông
  // khác nhau**, mà một cột trống mang nhan đề "TRONG CHƯƠNG" trên Bảng điều
  // khiển là chrome của chế độ đọc rò sang chế độ thư viện: nó chiếm chỗ, và
  // nó nói về một chương không tồn tại.
  //
  // Phần tử `aside#rail` vẫn do `<Shell>` dựng, nên đường portal của
  // `ChapterView` không đổi. CSS ở `reader-layout.css`/`home.css` thu cột về 0
  // khi `#app` không có `.reading`.
  return null;
}

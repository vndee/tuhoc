import { useMe } from '../api/useMe';
import { Dashboard } from './Dashboard';
import { Landing } from './Landing';

/**
 * `/` — hai trang trên một đường dẫn, chọn theo phiên.
 *
 * Trước 02/09/2026, `/` bọc trong `<RequireAuth>`: khách chưa đăng nhập bị
 * đẩy sang `/login`, và trang đăng nhập gánh luôn vai giới thiệu sản phẩm.
 * Nay khách gõ tên miền là gặp landing (`Landing.tsx`), còn người đã đăng
 * nhập vẫn thấy Học tiếp (`Dashboard.tsx`) — cùng URL, vì với cả hai đây đều
 * là "trang đầu".
 *
 * Ba trạng thái của `useMe()`:
 *  - có `data`: Học tiếp;
 *  - đang chờ (`isPending`): không vẽ gì — vẽ landing rồi đổi sang Học tiếp
 *    là một cú nháy với mọi người dùng đã đăng nhập, ở màn đầu tiên;
 *  - còn lại (401 thành `null`, hoặc lỗi mạng): landing. Một người đã đăng
 *    nhập mà mất mạng ngay lúc tải sẽ thấy landing thay vì câu báo mạng của
 *    `RequireAuth`; landing vẫn đọc được và mọi liên kết trong nó đều công
 *    khai, nên đó là bậc suy giảm tử tế hơn một trang trắng.
 *
 * Các route cần phiên khác (`/settings`, `/progress`…) vẫn qua `<RequireAuth>`;
 * cổng này chỉ thuộc về `/`.
 */
export function HomeGate() {
  const me = useMe();
  if (me.data) return <Dashboard />;
  if (me.isPending) return null;
  return <Landing />;
}

export default HomeGate;

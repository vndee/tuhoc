/**
 * Mark của Tự học — chữ T dựng từ mép sách.
 *
 * Hình đã duyệt: khung "Logo" trên canvas thiết kế, trang Nền tảng.
 *
 * ── CÁI NÓ THAY, VÀ VÌ SAO ───────────────────────────────────────────────
 * Mark cũ là một hình vuông bo góc màu xanh với dấu tích trắng, nằm trong
 * `.sb-title` của thanh bên. Ba vấn đề, và cái thứ ba mới là cái giết nó:
 *
 *   · Sai nghĩa. Dấu tích nghĩa là "xong việc". Sản phẩm này nói về ĐỌC và
 *     GIỮ một gói giáo trình, không về gạch đầu dòng đã hoàn thành.
 *   · Không của riêng ai. Vuông bo góc + tích trắng + xanh mặc định là hình
 *     có sẵn trong hàng nghìn ứng dụng.
 *   · Đọc nhầm ở cỡ thật. Nó render ở 20px, và ở 20px mắt thấy MỘT Ô ĐÃ
 *     TICK — một điều khiển biểu mẫu, không phải một thương hiệu.
 *
 * ── VÌ SAO NÉT DÀY LÊN KHI THU NHỎ ───────────────────────────────────────
 * Đây là chỗ mark cũ hỏng mà không ai sửa được bằng cách chọn hình khác: nó
 * giữ NGUYÊN một tệp SVG ở mọi cỡ, nên nét mảnh dần theo tỉ lệ cho tới khi
 * chi tiết dính vào nhau. `strokeFor` trả về nét theo cỡ render — 2.8 ở 16px
 * xuống 1.9 ở 44px — nên mark giữ được cùng một ĐỘ ĐẬM THỊ GIÁC ở cả hai đầu
 * thang cỡ, thay vì cùng một tỉ lệ hình học.
 *
 * Và ở 16px hai đường lượn chân trang BỊ BỎ HẲN, chỉ còn chữ T. Giữ chúng
 * lại thì ba nét cách nhau chưa tới 2px, chúng nhoè thành một vệt xám và làm
 * bẩn mark — đúng cái cách dấu tích cũ nhoè thành một ô vuông.
 */

export interface LogoProps {
  /** Cạnh của mark tính bằng px. Mặc định 28 — cỡ nó đứng trên thanh trên. */
  size?: number;
  /**
   * Màu nét chữ T. Mặc định `currentColor` để mark ăn theo màu chữ của chỗ
   * đặt nó, kể cả trong giao diện tối.
   */
  color?: string;
  /** Màu hai đường lượn chân trang. Mặc định mờ đi một bậc so với `color`. */
  pageColor?: string;
  className?: string;
}

/**
 * Nét theo cỡ render, không theo tỉ lệ. Bốn bậc là bốn cỡ mark này thực sự
 * xuất hiện trong app (16 favicon, 20 thanh bên cũ, 28 thanh trên, 44 màn
 * đăng nhập); giữa các bậc thì bậc gần nhất phía trên là đủ gần.
 */
function strokeFor(size: number): { stem: number; pages: number } {
  if (size <= 16) return { stem: 2.8, pages: 2.2 };
  if (size <= 20) return { stem: 2.5, pages: 1.9 };
  if (size <= 32) return { stem: 2.1, pages: 1.6 };
  return { stem: 1.9, pages: 1.5 };
}

export function Logo({ size = 28, color = 'currentColor', pageColor, className }: LogoProps) {
  const { stem, pages } = strokeFor(size);
  // Dưới 18px thì bỏ hẳn hai đường lượn — xem đầu tệp.
  const showPages = size >= 18;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M8 9.5h12M14 9.5V20"
        stroke={color}
        strokeWidth={stem}
        strokeLinecap="round"
      />
      {showPages && (
        <path
          d="M8 20c2-1.3 4-1.3 6 0 2-1.3 4-1.3 6 0"
          stroke={pageColor ?? color}
          strokeWidth={pages}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={pageColor === undefined ? 0.38 : undefined}
        />
      )}
    </svg>
  );
}

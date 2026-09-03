/**
 * Mark của sản phẩm — "Nét vượt mép".
 *
 * Hợp đồng hướng: `.impeccable/surfaces/apps-web-src-shell-logo-tsx.md`
 * (seed d402f7c9, chủ dự án chọn sau vòng gieo lại thang bạo).
 * Bộ biểu tượng sinh ra từ ĐÚNG hình học dưới đây — cách sinh lại và
 * nguồn gốc từng tệp: `docs/icons.md`. Sửa hình ở đây rồi sinh lại; đừng
 * sửa PNG bằng trình đồ hoạ.
 *
 * ── Ý ────────────────────────────────────────────────────────────────────
 * Khung mảnh là ĐOẠN VĂN. Nét đặc là VỆT BẠN ĐỂ LẠI — và nó dài hơn chỗ
 * được đánh dấu, vượt ra ngoài cả mép trên lẫn mép dưới. Đó là cơ chế của
 * sản phẩm vẽ thành một hình: ghi chú neo vào đoạn văn, và cái bạn viết ra
 * là thứ ở lại.
 *
 * ── CÁI NÓ THAY, VÀ VÌ SAO ───────────────────────────────────────────────
 * Mark cũ là chữ T dựng từ mép sách. Ba vấn đề:
 *
 *   · Nó là một CHỮ CÁI. PRODUCT.md ghi tên "Tự học" là chỗ giữ chỗ và việc
 *     đặt tên thuộc về chủ dự án — một mark mang chữ T sẽ chết cùng ngày
 *     tên đổi. Mark này mang NGHĨA, không mang chữ.
 *   · Dưới 18px nó bỏ hai đường lượn chân trang và còn lại một chữ T trần.
 *     Một chữ cái trần không phải một dấu hiệu.
 *   · Nó không đứng cùng favicon. Tab trình duyệt đang là một tia sét tím
 *     với 16 lớp mờ — không màu nào trong đó có trong bảng màu app. Hai thứ
 *     ấy là hai sản phẩm khác nhau đối với người nhìn.
 *
 * ── VÌ SAO NÉT DÀY LÊN KHI THU NHỎ ───────────────────────────────────────
 * Giữ nguyên một tệp SVG ở mọi cỡ thì nét mảnh dần theo tỉ lệ cho tới khi
 * khung nhoè vào nét. `weightFor` trả về bề dày theo cỡ RENDER, nên mark
 * giữ cùng một độ đậm thị giác ở 16px và ở 512px, thay vì cùng một tỉ lệ
 * hình học.
 *
 * KHÔNG có bản "bỏ khung ở cỡ nhỏ". Khung là một nửa của hình — bỏ nó thì
 * còn lại một thanh dọc, đúng cái bẫy mark cũ rơi vào. Ở 16px khung dày lên
 * thay vì biến mất; đã kiểm bằng mắt ở đúng cỡ ấy.
 */

export interface LogoProps {
  /** Cạnh của mark tính bằng px. Mặc định 26 — cỡ nó đứng trên thanh trên. */
  size?: number;
  /**
   * Vẽ mark trên nền bảng đá, nét kem — dạng "app icon".
   *
   * Nền tối là quyết định về BỐI CẢNH DÙNG, không phải thẩm mỹ: biểu tượng
   * này nằm giữa ba mươi biểu tượng khác trên màn hình chính, và phần lớn
   * chúng nền sáng. Đây cũng đúng là một trong hai mặt viết của thế giới
   * app — mark ở đây là mặt bảng.
   *
   * Đất nung KHÔNG dùng ở dạng này: `#a94f2b` trên `#26312e` chỉ đạt ~2.4:1.
   * Nó sống ở khung app, nơi nó có nền kem để đứng.
   */
  boxed?: boolean;
  /** Màu nét. Mặc định `currentColor` để mark ăn theo màu chữ chỗ đặt nó. */
  color?: string;
  /** Màu khung. Mặc định cùng `color`, mờ đi — khung là nền của nét, không cạnh tranh. */
  frameColor?: string;
  className?: string;
}

/**
 * Bề dày theo cỡ render, không theo tỉ lệ. Bốn bậc là bốn cỡ mark này thực
 * sự xuất hiện: 16 (favicon), 26 (thanh trên), 32 (màn đăng nhập), 180+
 * (apple-touch và icon PWA).
 */
function weightFor(size: number): { bar: number; frame: number } {
  if (size <= 18) return { bar: 2.8, frame: 1.2 };
  if (size <= 32) return { bar: 2.9, frame: 1.3 };
  if (size <= 96) return { bar: 2.9, frame: 1.4 };
  return { bar: 2.8, frame: 1.4 };
}

/**
 * HÌNH HỌC — MỘT NGUỒN SỰ THẬT.
 *
 * Component dưới đây và `scripts/gen-icons.mjs` cùng đọc hằng số này, và
 * `Logo.icons.test.ts` canh rằng `public/favicon.svg` khớp nó. Trong chính
 * vòng dựng mark này, tệp biểu tượng và component đã trôi ra khỏi nhau HAI
 * LẦN mà không gì báo — `docs/icons.md` khẳng định chúng cùng một hình học,
 * và lời khẳng định ấy không có ai kiểm. Đây là chỗ kiểm nó.
 */
export const MARK = {
  /** Khung: đoạn văn được đánh dấu. */
  frame: { x: 3.4, y: 3.4, w: 9.4, h: 9.2, opacity: 0.5 },
  /** Nét: vệt người đọc để lại. `cx` là TÂM, không phải mép trái. */
  bar: { cx: 6.2, y: 0.9, h: 14.2 },
  /** Mark thu nhỏ bao nhiêu trong ô app icon, và trong bản maskable. */
  /** MỘT con số cho mọi dạng có nền, không hai. Trước đây favicon dựng ở
   *  0.78 còn bốn tệp PNG ở 0.74 — chênh 5%, vô hình với mắt và vô hình với
   *  bài test, nhưng vẫn là hai hình học cho một mark. `maskable` khác là có
   *  lý do đo được: Android cắt tròn, vùng an toàn ~80% đường kính. */
  inset: { boxed: 0.78, icon: 0.78, maskable: 0.52 },
} as const;

/** Nền và nét của dạng app icon — xem `boxed` ở trên cho lý do. */
export const MARK_ICON_GROUND = '#26312e';
export const MARK_ICON_INK = '#f4f1e8';

export function Logo({
  size = 26,
  color = 'currentColor',
  frameColor,
  boxed = false,
  className,
}: LogoProps) {
  // Trong ô, mark chỉ chiếm phần lõi chứ không tràn sát mép, nên nét tính
  // theo cỡ NHỎ HƠN cỡ ô để bù lại độ đậm thị giác.
  const { bar, frame } = weightFor(boxed ? size * 0.66 : size);
  const ink = boxed ? MARK_ICON_INK : color;
  const rule = boxed ? MARK_ICON_INK : (frameColor ?? color);

  const mark = (
    <>
      {/* Khung: đoạn văn. Mờ hơn nét vì nó là thứ ĐƯỢC đánh dấu, không phải
          dấu. */}
      <rect
        x={MARK.frame.x}
        y={MARK.frame.y}
        width={MARK.frame.w}
        height={MARK.frame.h}
        fill="none"
        stroke={rule}
        strokeWidth={frame}
        // 0.50, khong phai mot con so cho dep: o 0.42 khung chi dat 2.49:1
        // tren nen kem — dung con so da loai dat nung khoi app icon (2.4:1).
        // Giu chinh minh o cung nguong: 0.50 cho 3.09:1 tren kem va 3.9:1
        // tren bang da, mot gia tri qua nguong o ca hai mat viet.
        opacity={MARK.frame.opacity}
      />
      {/* Nét: vệt người đọc để lại. Nằm CHẾCH BÊN TRONG khung, không đè lên
          mép trái: khung phải đọc ra một khung KÍN bốn cạnh — nó là đoạn văn.
          Một lượt sửa từng dời thanh ra đúng mép trái để mở lòng khung ở
          16px; cạnh trái biến mất sau thanh và hình thành một cái ngoặc ba
          cạnh, mất luôn cái ý "khung là thứ được đánh dấu". Chủ dự án bác,
          và đúng. Lòng khung ở cỡ nhỏ được mở bằng cách làm MẢNH nét khung,
          không phải bằng cách dời thanh. */}
      <rect x={MARK.bar.cx - bar / 2} y={MARK.bar.y} width={bar} height={MARK.bar.h} fill={ink} />
    </>
  );

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      {boxed ? (
        <>
          <rect width="16" height="16" fill={MARK_ICON_GROUND} />
          <g transform={`translate(8,8) scale(${MARK.inset.boxed}) translate(-8,-8)`}>{mark}</g>
        </>
      ) : (
        mark
      )}
    </svg>
  );
}

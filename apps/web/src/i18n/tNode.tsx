import { t, type Lang, type MessageArgs, type MessageKey, type Messages } from '@tuhoc/i18n';
import { Fragment, type ReactNode } from 'react';

/**
 * CÂU CÓ THẺ NẰM GIỮA CHỪNG — hàm thứ hai, hợp đồng thứ hai (QĐ-2).
 *
 * `t()` giữ nguyên `string`, và điều đó không thương lượng: `aria-label`,
 * `title`, `placeholder`, `document.title`, và mọi `throw new Error(...)` chỉ
 * nhận chuỗi. Đổi `t()` sang `ReactNode` biến từng chỗ ấy thành một chỗ phải
 * thu hẹp kiểu bằng tay — 9 trong 20 tệp `.tsx` của sổ có thẻ nội tuyến, nhưng
 * *mọi* tệp đều có ít nhất một ngữ cảnh chỉ-nhận-chuỗi.
 *
 * ⇒ Hai hàm:
 *
 *   `t(key)`            → `string`   — dùng được ở mọi nơi cần chuỗi
 *   `tNode(key, …parts)` → `ReactNode` — CHỈ cho câu có thẻ giữa chừng
 *
 * ## Vì sao khoá của `tNode` là một HÀM chứ không phải chuỗi có `{0}`
 *
 * Bản dịch vẫn là **một câu liền mạch trong catalog**, không phải ba mảnh ghép
 * lại ở chỗ vẽ:
 *
 * ```ts
 * 'ann.orphan.barWhat': (quote: string) => `Gắn lại: ${quote}`,
 * 'ann.orphan.barWhat': (quote: string) => `Reattaching: ${quote}`,
 * ```
 *
 * Ba lợi ích, và cả ba đều mất nếu cắt câu thành `barWhat.part1/part2`:
 *
 *   1. **trật tự từ đổi được theo ngôn ngữ** — chỗ trống nằm ở đâu là việc của
 *      bản dịch, không phải của JSX;
 *   2. **`tsc` đếm chỗ trống hộ**: số tham số của hàm nằm trong `Messages`, nên
 *      `en.ts` không thể khai cùng khoá ấy với số chỗ trống khác, và chỗ gọi
 *      không thể truyền thiếu;
 *   3. dịch giả đọc được **cả câu**.
 *
 * ## Cơ chế
 *
 * Hàm bản dịch được gọi với những **thẻ đánh dấu** (`\u0000{i}\u0000` — ký tự
 * NUL không xuất hiện trong văn bản giao diện), rồi chuỗi kết quả được cắt tại
 * đúng những thẻ ấy và các `ReactNode` được chèn vào chỗ trống. Không có phân
 * tích cú pháp nào trên bản dịch, và một bản dịch quên chỗ trống chỉ đơn giản
 * là mất mảnh ấy — thấy được ngay lúc nhìn.
 *
 * KHOẢNG MÙ, ghi ra chứ không giấu: nếu một bản dịch dùng tham số vào việc
 * KHÁC hơn là chèn thẳng (`count === 1 ? … : …`), thẻ đánh dấu sẽ đi vào nhánh
 * sai. Kiểu chặn phần lớn ca đó — `SlotArgs` chỉ nhận khoá mà MỌI tham số là
 * `string`, nên `library.courseCount` (tham số `number`, có luật số nhiều)
 * không gọi được `tNode` và `tsc` nói ra điều đó.
 */

/** Tuple `[a: string, b: string]` → `[ReactNode, ReactNode]`; mọi thứ khác → `never`. */
export type SlotArgs<A> = A extends readonly string[] ? { [I in keyof A]: ReactNode } : never;

const MARK = '\u0000';

/** `\u00003\u0000` → chỗ trống số 3. Cắt bằng nhóm bắt, nên chỉ số về nguyên vẹn. */
const SPLIT = /\u0000(\d+)\u0000/;

export function tNode<K extends MessageKey>(
  lang: Lang,
  key: K,
  ...parts: SlotArgs<MessageArgs<Messages[K]>>
): ReactNode {
  const marks = parts.map((_, i) => `${MARK}${String(i)}${MARK}`) as unknown as MessageArgs<Messages[K]>;
  const rendered = t(lang, key, ...marks);

  // `split` với một nhóm bắt xen kẽ chữ và chỉ số: ['Key của bạn ', '0', ' — một trang riêng.'].
  const pieces = rendered.split(SPLIT);
  return pieces.map((piece, i) =>
    i % 2 === 1 ? (
      <Fragment key={`slot-${piece}`}>{(parts as readonly ReactNode[])[Number(piece)]}</Fragment>
    ) : (
      <Fragment key={`text-${String(i)}`}>{piece}</Fragment>
    ),
  );
}

/** `tNode()` đã gắn `lang` — thứ `useLanguage()` trả về, song song với `t`. */
export type TranslateNode = <K extends MessageKey>(
  key: K,
  ...parts: SlotArgs<MessageArgs<Messages[K]>>
) => ReactNode;

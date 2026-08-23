/**
 * Lịch nhiệt của `/progress`: bảy tuần, mỗi ô một ngày, ô đậm là ngày có học.
 *
 * Viết THUẦN (không React, không Dexie, không đồng hồ trừ khi được truyền vào)
 * vì phần khó ở đây là lịch chứ không phải giao diện: một ô lệch một ngày là
 * thứ mắt không bắt được nhưng vẫn sai, và cách duy nhất để biết là chạy nó
 * trên những ngày cụ thể.
 *
 * ## Vì sao 49 ô mà máy chủ chỉ trả 30 ngày
 *
 * `GET /stats` trả **đúng 30 mục** `days[]`, cũ trước, hôm nay cuối
 * (apps/api/internal/stats/handler.go's `statsWindowDays`). Bảy tuần là 49
 * ngày. Chênh lệch ấy KHÔNG được vẽ như "ngày không học" — một ô nhạt ở đó nói
 * dối rằng người này đã bỏ 19 ngày. Nên ô nằm ngoài cửa sổ mang trạng thái
 * RIÊNG (`known: false`) và được vẽ khác hẳn ô "có dữ liệu, số phút bằng 0".
 *
 * ## Vì sao `days` vào đây dưới dạng `unknown[]`
 *
 * `assertStats` (api/stats.ts) bảo đảm `days` LÀ MỘT MẢNG và không bảo đảm gì
 * thêm — nó là "shape check, not schema validation", và chú thích của chính nó
 * nói vậy. Một phần tử là `null`, là số, hay là một hình dạng của phiên bản
 * sau đều tới được đây qua dây mạng. Đọc từng trường một cách phòng thủ ở đây
 * là rẻ; một `TypeError` giữa lúc vẽ thì đã một lần làm trắng cả trang
 * (xem `MalformedStatsError`).
 *
 * ## Múi giờ
 *
 * Máy chủ cắt ngày theo UTC+7 cố định (`icTZOffset`), không theo UTC và không
 * theo giờ máy chủ. `todayIctIso()` dưới đây làm đúng phép ấy, nên cái mốc
 * "hôm nay" của lịch này trùng với cái mốc mà `days[]` được dựng lên — nếu
 * không, một người học lúc 1 giờ sáng sẽ thấy ô hôm nay nằm sai cột.
 */

const DAY_MS = 86_400_000;

/** UTC+7 cố định, đúng bằng `icTZOffset` của apps/api/internal/stats/handler.go. */
const ICT_OFFSET_MS = 7 * 60 * 60 * 1000;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Số ngày kể từ 1970-01-01, hoặc `null` cho thứ không phải một ngày lịch. */
export function dayIndexOf(iso: string): number | null {
  const parts = ISO_DATE.exec(iso);
  if (parts === null) return null;
  const ms = Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (Number.isNaN(ms)) return null;
  // Vòng lại: `Date.UTC(2026, 1, 31)` là một ngày HỢP LỆ (2026-03-03) chứ không
  // phải lỗi, nên "parse được" chưa đủ — chỉ chuỗi mô tả đúng chính nó mới tính.
  return isoOfDayIndex(Math.floor(ms / DAY_MS)) === iso ? Math.floor(ms / DAY_MS) : null;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isoOfDayIndex(index: number): string {
  const at = new Date(index * DAY_MS);
  return `${at.getUTCFullYear()}-${pad2(at.getUTCMonth() + 1)}-${pad2(at.getUTCDate())}`;
}

/**
 * Thứ trong tuần với THỨ HAI = 0.
 *
 * `index === 0` là 1970-01-01, một ngày thứ Năm (thứ-hai-đầu-tuần ⇒ 3), nên
 * phép dịch là `+3`. `% 7` hai lần để chỉ số âm (trước 1970) không cho ra số âm.
 */
export function weekdayMondayFirst(index: number): number {
  return (((index + 3) % 7) + 7) % 7;
}

/** Hôm nay theo đúng ranh giới ngày mà máy chủ dùng (UTC+7). */
export function todayIctIso(now: number = Date.now()): string {
  return isoOfDayIndex(Math.floor((now + ICT_OFFSET_MS) / DAY_MS));
}

export interface HeatCell {
  readonly date: string;
  /** `false` ⇒ ngày này nằm ngoài cửa sổ máy chủ trả về. KHÔNG phải "0 phút". */
  readonly known: boolean;
  readonly minutes: number;
}

export interface HeatCalendar {
  /** `weeks[cột][hàng]` — cột là một tuần, hàng là thứ Hai…Chủ nhật. */
  readonly weeks: readonly (readonly HeatCell[])[];
  /** Số phút của ngày cao nhất có dữ liệu; 0 khi không có ngày nào. */
  readonly maxMinutes: number;
}

/**
 * `days[]` → bảng `weeks × 7`, kết thúc ở tuần chứa ngày mới nhất có dữ liệu.
 *
 * Mốc cuối là ngày LỚN NHẤT đọc được trong `days`, không phải phần tử cuối
 * mảng: thứ tự trên dây là một quy ước của máy chủ, còn "ngày nào mới nhất" là
 * một sự thật đọc được từ chính dữ liệu.
 */
export function buildHeatCalendar(days: unknown, weeks: number, todayIso: string): HeatCalendar {
  const byDate = new Map<string, number>();
  let latest: number | null = null;

  // `Array.isArray` chứ không tin kiểu: xem chú thích đầu tệp.
  if (Array.isArray(days)) {
    for (const entry of days as readonly unknown[]) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as { date?: unknown; minutes?: unknown };
      if (typeof record.date !== 'string') continue;
      const index = dayIndexOf(record.date);
      if (index === null) continue;
      const minutes = typeof record.minutes === 'number' && Number.isFinite(record.minutes) ? record.minutes : 0;
      byDate.set(record.date, minutes);
      if (latest === null || index > latest) latest = index;
    }
  }

  const anchor = latest ?? dayIndexOf(todayIso) ?? Math.floor(Date.now() / DAY_MS);
  // Cột cuối chạy hết tuần của mốc, kể cả những ngày còn chưa tới — một lịch
  // cụt nửa tuần đọc như một lỗi vẽ, và những ngày ấy tự nhận là `known: false`.
  const lastCell = anchor + (6 - weekdayMondayFirst(anchor));
  const firstCell = lastCell - (weeks * 7 - 1);

  const grid: HeatCell[][] = [];
  let maxMinutes = 0;
  for (let week = 0; week < weeks; week += 1) {
    const column: HeatCell[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const date = isoOfDayIndex(firstCell + week * 7 + weekday);
      const minutes = byDate.get(date);
      column.push({ date, known: minutes !== undefined, minutes: minutes ?? 0 });
      if (minutes !== undefined && minutes > maxMinutes) maxMinutes = minutes;
    }
    grid.push(column);
  }

  return { weeks: grid, maxMinutes };
}

/**
 * Bậc đậm nhạt 0–4.
 *
 * Bậc 0 là "có dữ liệu và bằng không", KHÔNG dùng cho ô ngoài cửa sổ — chỗ vẽ
 * phải phân biệt hai thứ ấy bằng `HeatCell.known` trước khi hỏi tới bậc.
 * Chia theo `max` của chính người này chứ không theo một ngưỡng phút cố định:
 * một người học 15 phút mỗi ngày phải thấy được nhịp của mình, không phải bảy
 * tuần nhạt như nhau vì ai đó khác học ba tiếng.
 */
export function heatLevel(minutes: number, maxMinutes: number): 0 | 1 | 2 | 3 | 4 {
  if (!(minutes > 0) || !(maxMinutes > 0)) return 0;
  const share = minutes / maxMinutes;
  if (share <= 0.25) return 1;
  if (share <= 0.5) return 2;
  if (share <= 0.75) return 3;
  return 4;
}

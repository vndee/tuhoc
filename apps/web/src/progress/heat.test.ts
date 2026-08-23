import { describe, expect, it } from 'vitest';
import { buildHeatCalendar, dayIndexOf, heatLevel, isoOfDayIndex, todayIctIso, weekdayMondayFirst } from './heat';

/**
 * Lịch nhiệt của `/progress`, đo bằng những ngày CỤ THỂ.
 *
 * Một ô lệch một ngày là loại lỗi mắt không bắt được: lưới vẫn 7×7, vẫn có ô
 * đậm ô nhạt, và vẫn sai. Cách duy nhất để biết là chạy phép dựng lịch trên
 * những ngày biết trước câu trả lời — nên tệp này không dựng React và không
 * chạm vào Dexie.
 */

/** Thứ trong tuần theo `Date` của nền tảng, 0 = Chủ nhật — một công thức ĐỘC LẬP
 *  với công thức đang được kiểm, để bài này không tự chứng minh chính nó. */
function platformWeekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function cellsOf(weeks: readonly (readonly { date: string }[])[]): string[] {
  return weeks.flatMap((week) => week.map((cell) => cell.date));
}

describe('phép lịch', () => {
  it('dayIndexOf ↔ isoOfDayIndex đi được cả hai chiều', () => {
    expect(isoOfDayIndex(0)).toBe('1970-01-01');
    expect(dayIndexOf('1970-01-01')).toBe(0);
    expect(dayIndexOf('2026-08-23')).toBe(Math.floor(Date.UTC(2026, 7, 23) / 86_400_000));
    expect(isoOfDayIndex(dayIndexOf('2024-02-29') as number)).toBe('2024-02-29');
  });

  it('từ chối thứ không phải một ngày lịch — kể cả thứ mà Date.UTC vẫn nhận', () => {
    expect(dayIndexOf('')).toBeNull();
    expect(dayIndexOf('2026-8-3')).toBeNull();
    expect(dayIndexOf('hôm qua')).toBeNull();
    // `Date.UTC(2026, 1, 31)` KHÔNG lỗi — nó vòng sang 2026-03-03. "Parse được"
    // vì thế chưa đủ; chỉ chuỗi mô tả đúng chính nó mới được nhận.
    expect(dayIndexOf('2026-02-31')).toBeNull();
    expect(dayIndexOf('2025-02-29')).toBeNull();
    expect(dayIndexOf('2024-02-29')).not.toBeNull();
  });

  it('weekdayMondayFirst khớp với lịch của nền tảng, thứ Hai = 0', () => {
    for (const iso of ['2026-08-17', '2026-08-20', '2026-08-23', '1970-01-01', '2024-02-29']) {
      expect(weekdayMondayFirst(dayIndexOf(iso) as number), iso).toBe((platformWeekday(iso) + 6) % 7);
    }
  });

  it('todayIctIso cắt ngày theo UTC+7, đúng ranh giới máy chủ dùng', () => {
    // 17:30Z là 00:30 hôm sau ở Việt Nam. Một lịch cắt theo UTC sẽ đặt phiên
    // học lúc nửa đêm ấy vào ô NGÀY HÔM TRƯỚC, lệch với `days[]` mà máy chủ gửi.
    expect(todayIctIso(Date.parse('2026-08-23T17:30:00Z'))).toBe('2026-08-24');
    expect(todayIctIso(Date.parse('2026-08-23T16:59:59Z'))).toBe('2026-08-23');
    expect(todayIctIso(Date.parse('2026-08-23T00:00:00Z'))).toBe('2026-08-23');
  });
});

describe('buildHeatCalendar', () => {
  /** Đúng hình dạng `GET /stats` trả về: 30 mục, cũ trước, hôm nay cuối. */
  function thirtyDaysEnding(lastIso: string, minutesOf: (index: number) => number) {
    const last = dayIndexOf(lastIso) as number;
    return Array.from({ length: 30 }, (_, i) => ({
      date: isoOfDayIndex(last - 29 + i),
      minutes: minutesOf(i),
    }));
  }

  it('bảy tuần là 7 cột × 7 hàng, liên tục, không trùng, không hụt ngày nào', () => {
    const calendar = buildHeatCalendar(thirtyDaysEnding('2026-08-30', () => 0), 7, '2026-08-30');
    const dates = cellsOf(calendar.weeks);

    expect(calendar.weeks).toHaveLength(7);
    expect(dates).toHaveLength(49);
    expect(new Set(dates).size).toBe(49);
    const first = dayIndexOf(dates[0]) as number;
    dates.forEach((iso, i) => expect(iso).toBe(isoOfDayIndex(first + i)));
  });

  it('cột cuối chạy hết tuần của ngày mới nhất — ô cuối cùng là Chủ nhật', () => {
    const calendar = buildHeatCalendar(thirtyDaysEnding('2026-08-26', () => 0), 7, '2026-08-26');
    const dates = cellsOf(calendar.weeks);

    // Mỗi cột bắt đầu bằng thứ Hai.
    for (const week of calendar.weeks) expect(platformWeekday(week[0].date)).toBe(1);
    // Ô cuối cùng của lưới là Chủ nhật, và là Chủ nhật của tuần chứa 2026-08-26.
    const last = dates[dates.length - 1];
    expect(platformWeekday(last)).toBe(0);
    const gap = (dayIndexOf(last) as number) - (dayIndexOf('2026-08-26') as number);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(7);
  });

  it('ngày ngoài cửa sổ 30 ngày là "KHÔNG BIẾT", không phải "0 phút"', () => {
    // 49 ô, 30 ngày dữ liệu ⇒ ít nhất 19 ô không có gì để nói. Tô chúng như
    // ngày không học là báo với người đọc rằng họ đã nghỉ ba tuần.
    const calendar = buildHeatCalendar(thirtyDaysEnding('2026-08-30', () => 0), 7, '2026-08-30');
    const flat = calendar.weeks.flat();

    const known = flat.filter((cell) => cell.known);
    expect(known).toHaveLength(30);
    expect(known.map((cell) => cell.date)).toContain('2026-08-30');
    expect(known.map((cell) => cell.date)).toContain('2026-08-01');
    expect(flat.filter((cell) => !cell.known).length).toBe(19);
    // Và ô "không biết" mang 0 phút chỉ vì phải mang một số nào đó — `known` là
    // thứ chỗ vẽ phải hỏi trước.
    expect(flat.filter((cell) => !cell.known).every((cell) => cell.minutes === 0)).toBe(true);
  });

  it('gắn số phút vào đúng ngày, và maxMinutes là ngày cao nhất', () => {
    const calendar = buildHeatCalendar(
      [
        { date: '2026-08-28', minutes: 12 },
        { date: '2026-08-30', minutes: 48 },
        { date: '2026-08-29', minutes: 0 },
      ],
      7,
      '2026-08-30',
    );
    const byDate = new Map(calendar.weeks.flat().map((cell) => [cell.date, cell]));

    expect(byDate.get('2026-08-28')).toEqual({ date: '2026-08-28', known: true, minutes: 12 });
    expect(byDate.get('2026-08-29')).toEqual({ date: '2026-08-29', known: true, minutes: 0 });
    expect(byDate.get('2026-08-30')).toEqual({ date: '2026-08-30', known: true, minutes: 48 });
    expect(calendar.maxMinutes).toBe(48);
  });

  it('mốc là ngày LỚN NHẤT đọc được, không phải phần tử cuối mảng', () => {
    const shuffled = [
      { date: '2026-08-30', minutes: 5 },
      { date: '2026-08-12', minutes: 5 },
      { date: '2026-08-25', minutes: 5 },
    ];
    const dates = cellsOf(buildHeatCalendar(shuffled, 7, '2020-01-01').weeks);
    expect(dates).toContain('2026-08-30');
  });

  /**
   * `assertStats` (api/stats.ts) bảo đảm `days` LÀ MẢNG và KHÔNG bảo đảm gì về
   * phần tử — nó tự gọi mình là "shape check, not schema validation". Mọi hình
   * dạng dưới đây đi được qua dây mạng, và một `TypeError` giữa lúc vẽ đã một
   * lần làm trắng cả trang.
   */
  it('thân /stats méo mó không ném, không dựng ô giả', () => {
    const junk = [null, 42, 'hôm nay', {}, { date: 5 }, { date: '2026-08-30' }, { date: '2026-08-29', minutes: 'nhiều' }, { date: '2026-13-40', minutes: 9 }];
    const calendar = buildHeatCalendar(junk, 7, '2026-08-30');
    const known = calendar.weeks.flat().filter((cell) => cell.known);

    expect(known.map((cell) => cell.date).sort()).toEqual(['2026-08-29', '2026-08-30']);
    // `minutes` thiếu hoặc sai kiểu ⇒ 0, không phải `NaN` (một chiều rộng
    // `NaN%` là một thanh không vẽ ra gì và không có lỗi nào được ghi lại).
    expect(known.every((cell) => Number.isFinite(cell.minutes))).toBe(true);
    expect(calendar.maxMinutes).toBe(0);
  });

  it('days không phải mảng, hoặc mảng rỗng, vẫn cho ra một lưới đầy đủ', () => {
    for (const days of [undefined, null, 'nope', {}, []]) {
      const calendar = buildHeatCalendar(days, 7, '2026-08-30');
      expect(cellsOf(calendar.weeks)).toHaveLength(49);
      expect(calendar.weeks.flat().some((cell) => cell.known)).toBe(false);
      // Không có dữ liệu ⇒ mốc lùi về `todayIso` được truyền vào.
      expect(cellsOf(calendar.weeks)).toContain('2026-08-30');
    }
  });
});

describe('heatLevel', () => {
  it('0 chỉ dành cho "có dữ liệu và bằng không"', () => {
    expect(heatLevel(0, 60)).toBe(0);
    expect(heatLevel(-3, 60)).toBe(0);
    expect(heatLevel(Number.NaN, 60)).toBe(0);
    expect(heatLevel(10, 0)).toBe(0);
  });

  it('chia bốn bậc theo mức cao nhất CỦA CHÍNH NGƯỜI ẤY, không theo ngưỡng phút cố định', () => {
    // Một người học 15 phút mỗi ngày phải thấy được nhịp của mình, không phải
    // bảy tuần nhạt như nhau vì ai đó khác học ba tiếng.
    expect(heatLevel(4, 16)).toBe(1);
    expect(heatLevel(8, 16)).toBe(2);
    expect(heatLevel(12, 16)).toBe(3);
    expect(heatLevel(16, 16)).toBe(4);
    // Cùng bậc, thang khác hẳn.
    expect(heatLevel(180, 180)).toBe(4);
    expect(heatLevel(1, 4)).toBe(1);
  });
});

/// <reference types="node" />
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * CỔNG CẤU TRÚC CHO BIỂU ĐỊNH KIỂU — và nó tồn tại vì CÙNG MỘT LỖI ĐÃ XẢY RA
 * HAI LẦN TRONG CÙNG MỘT TỆP, cách nhau nhiều tháng, và **không lần nào bị bắt
 * bởi bất cứ thứ gì**.
 *
 * Lần 1 (`c1aacde` → Task 16 vòng sửa 1). `settings-auth.css` có một dấu ĐÓNG
 * chú thích không có dấu mở. Bộ phân tích CSS coi đoạn rác ấy là phần đầu của
 * một quy tắc và nuốt luôn khối `{…}` kế tiếp: `.page-settings { max-width:
 * 54rem }` biến mất khỏi bản dựng.
 *
 * Lần 2 (Task 16 vòng sửa 1, trong CHÍNH commit viết ra luật cấm lỗi ấy). Một
 * đoạn văn nháp còn sót lại thành CSS thật; nó mở một `{` không bao giờ đóng,
 * và **khoảng 20 quy tắc** từ đó tới cuối tệp — `.set-title`, `.set-select`,
 * `.auth-pw`, `.auth-switch-link`, và cả khối `@media (max-width: 47rem)` giữ
 * bố cục màn hẹp cho `/login` — biến mất khỏi bản dựng.
 *
 * ĐIỂM CHUNG, VÀ LÝ DO KHÔNG CỔNG NÀO BẮT ĐƯỢC: **`bun run build` XANH ở cả
 * hai lần.** Bộ phân tích CSS được viết để KHÔI PHỤC sau lỗi, không phải để
 * dừng lại — nó bỏ thứ nó không hiểu rồi đi tiếp. Một quy tắc bị bỏ trong im
 * lặng không phải lỗi cú pháp; nó là một quy tắc không tồn tại. Và vitest thì
 * không bao giờ nạp CSS, nên 1023 bài kiểm cũng xanh.
 *
 * HAI PHÉP KIỂM DƯỚI ĐÂY, mỗi phép bắt đúng một trong hai lần:
 *
 *   · một dấu ĐÓNG chú thích (`*` rồi `/`) khi KHÔNG ở trong chú thích → lần 1;
 *   · ngoặc nhọn không cân                                            → lần 2.
 *
 * (Đoạn trên KHÔNG viết ra hai ký tự ấy liền nhau, và đó không phải cầu kỳ:
 * bản đầu của tệp này có viết, dấu đóng ấy kết thúc SỚM chính khối JSDoc đang
 * mô tả nó, và `oxc` từ chối dịch tệp — lần thứ BA của cùng một lỗi trong cùng
 * một chuyến. Khác biệt đáng nhớ: ở TypeScript nó ỒN ÀO (build đỏ ngay), ở CSS
 * thì im lặng. Đó chính xác là lý do cổng này chỉ cần tồn tại cho CSS.)
 *
 * ĐÂY KHÔNG PHẢI MỘT BỘ PHÂN TÍCH CSS, và không cố là. Nó là một phép kiểm
 * hình dạng: chú thích đóng mở đúng cặp, ngoặc về 0 và không bao giờ âm. Nó
 * KHÔNG bắt được một selector gõ sai, một thuộc tính không tồn tại, hay một
 * quy tắc bị một quy tắc khác ghi đè — xem "KHÔNG BẮT ĐƯỢC GÌ" ở cuối tệp.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

/** Sàn: 9 tệp `.css` lúc viết cổng này. 6 để một lần dọn dẹp hợp lệ không làm
 *  đỏ cổng; chốt THẬT là `ANCHORS` bên dưới. */
const MIN_FILES = 6;

/**
 * Tệp gọi ĐÍCH DANH, vì một sàn đếm một mình vẫn xanh khi ai đó thêm một tệp
 * và xoá một tệp khác — cùng lập luận `db/local.test.ts` viết cho năm bảng
 * Dexie. `settings-auth.css` có mặt vì nó là tệp đã hỏng hai lần.
 */
const ANCHORS = ['settings-auth.css', 'index.css', 'app-screens.css', 'reader-layout.css'];

function cssFiles(): string[] {
  return readdirSync(HERE)
    .filter((n) => n.endsWith('.css'))
    .sort();
}

export interface Finding {
  readonly kind: 'stray-close' | 'unbalanced' | 'negative' | 'brace-in-string';
  /** Dòng 1-based, để thông báo hỏng chỉ thẳng vào chỗ phải sửa. */
  readonly line: number;
  readonly detail: string;
}

/**
 * Quét MỘT lượt, đồng thời theo dõi cả hai bất biến.
 *
 * ─── VÌ SAO HÀM NÀY KHÔNG BỎ QUA CHUỖI, DÙ ĐÓ LÀ ĐIỀU "ĐÚNG" ────────────────
 *
 * `content: "}"` là CSS hoàn toàn hợp lệ, nên một bộ đếm ngoặc "đúng" phải bỏ
 * qua nội dung chuỗi. Bản đầu của hàm này làm đúng như thế — **và nó KHÔNG bắt
 * được lần 2**, tức chính cái lỗi nó sinh ra để bắt.
 *
 * Đo, không đoán: chạy cả hai biến thể trên đúng tệp hỏng
 * (`git show 4c59fdc:apps/web/src/styles/settings-auth.css`):
 *
 *     có bỏ qua chuỗi    →  []                       ← MÙ
 *     không bỏ qua chuỗi →  [unbalanced, dòng 860]   ← bắt được
 *
 * Lý do: đoạn văn nháp chứa `'.page-settings{'` — một dấu nháy đơn của VĂN
 * XUÔI, không phải của CSS. Bộ đếm "đúng" vào chế độ chuỗi tại đó và nuốt luôn
 * dấu `{` lẻ ngay sau. Nói cách khác, phép xử lý chuỗi chỉ đúng khi tệp ĐÃ là
 * CSS hợp lệ — mà đó chính là điều cổng này đang nghi ngờ.
 *
 * Nên hàm đếm THÔ, và cái giá của nó được đóng bằng một phép kiểm thứ hai:
 * `brace-in-string`. Đo ngày 2026-08-29, cả chín tệp `.css` dưới thư mục này:
 * **0 chuỗi nào chứa ngoặc nhọn** (tổng 77 chuỗi). Ngày ai đó viết
 * `content: "}"`, cổng ĐỎ với `brace-in-string` — không phải vì dòng ấy sai,
 * mà vì bộ đếm thô không còn tin được nữa, và người viết phải quyết định
 * (tách tệp, hay dạy hàm này hiểu chuỗi kèm một cách khác để bắt lần 2). Đó là
 * fail-closed, cùng tư thế `selectFiles` của `ai/useAI.test.tsx` có với thư
 * mục con.
 */
export function scanCss(source: string): Finding[] {
  const findings: Finding[] = [];
  let depth = 0;
  let line = 1;
  let inComment = false;

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '\n') line += 1;

    if (inComment) {
      if (c === '*' && next === '/') {
        inComment = false;
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      inComment = true;
      i += 1;
      continue;
    }
    if (c === '*' && next === '/') {
      findings.push({
        kind: 'stray-close',
        line,
        detail: 'dấu đóng chú thích khi không ở trong chú thích nào',
      });
      i += 1;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth < 0) {
        findings.push({ kind: 'negative', line, detail: 'dấu `}` thừa' });
        depth = 0;
      }
    }
  }

  if (depth !== 0) {
    findings.push({
      kind: 'unbalanced',
      line,
      detail: `${String(depth)} dấu \`{\` chưa được đóng ở cuối tệp`,
    });
  }
  return findings;
}

/**
 * Điều kiện để tin `scanCss`: không chuỗi CSS nào chứa ngoặc nhọn. Xem khối
 * chú thích trên cho lý do đây là một phép kiểm chứ không phải một giả định.
 *
 * Chỉ soi phần NGOÀI chú thích — văn xuôi tiếng Việt của repo này đầy dấu nháy
 * và dấu ngoặc, và tất cả đều vô hại vì `scanCss` đã bỏ qua chú thích.
 */
export function bracesInsideStrings(source: string): Finding[] {
  const outsideComments = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const findings: Finding[] = [];
  const re = /"[^"\n]*"|'[^'\n]*'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(outsideComments)) !== null) {
    if (!/[{}]/.test(m[0])) continue;
    findings.push({
      kind: 'brace-in-string',
      line: outsideComments.slice(0, m.index).split('\n').length,
      detail: `chuỗi ${m[0]} chứa ngoặc nhọn — bộ đếm thô của scanCss không còn tin được`,
    });
  }
  return findings;
}

describe('cấu trúc biểu định kiểu', () => {
  /**
   * BÀI ĐỌC-ĐỒNG-HỒ. Bài dưới nó khẳng định "không tìm thấy gì", và một phép
   * quét đọc 0 tệp cho ra ĐÚNG cùng một màu xanh.
   */
  it('cổng có răng: quét thật, và bộ dò bắt được ĐÚNG hai lần đã xảy ra', () => {
    const files = cssFiles();
    expect(files.length).toBeGreaterThanOrEqual(MIN_FILES);
    expect(ANCHORS.filter((a) => !files.includes(a))).toEqual([]);

    // LẦN 1, dựng lại nguyên hình dạng: một dấu đóng chú thích lạc ở cấp cao
    // nhất, ngay trước một quy tắc thật.
    const lan1 = ['   `/settings` — CÀI ĐẶT', '   ─────── */', '', '.page-settings {', '  max-width: 54rem;', '}'].join('\n');
    expect(scanCss(lan1).map((f) => f.kind)).toEqual(['stray-close']);

    /*
     * LẦN 2 — CHÉP NGUYÊN VĂN từ `git show 4c59fdc:apps/web/src/styles/
     * settings-auth.css`, dòng 536-544, chứ không phải một bản diễn đạt lại.
     *
     * Lý do là một lần ĐỎ có thật: bản đầu của bài kiểm này dùng một bản rút
     * gọn hai dòng, và bản ấy CÂN BẰNG — `{` rồi `}` — nên cổng không bắt được
     * và bài kiểm đỏ. Thứ làm hỏng tệp thật là ba dấu `{` LẺ nằm rải trong văn
     * xuôi: một trong chuỗi `'.page-settings{'` của câu lệnh grep, một ở
     * `#content:has(.page-settings) {`, và một mở đầu. Một bản diễn đạt lại
     * đánh mất đúng thứ gây ra lỗi — nên bài kiểm này chép byte.
     */
    const lan2 = [
      '.page-settings { max-width:',
      "   54rem }` KHÔNG có trong bản dựng** (`grep -F '.page-settings{'",
      '   dist/assets/*.css` → 0 kết quả, trong khi `.set-title` ngay sau đó thì có).',
      '',
      '   Vì sao không ai thấy: `app-screens.css` có `#content:has(.page-settings) {',
      '   max-width: 54rem }` — cùng con số, khác selector — nên bề rộng trang Cài đặt',
      '   vẫn đúng.',
      '',
      '.set-title {',
      '  margin: 0;',
      '}',
    ].join('\n');
    expect(scanCss(lan2).map((f) => f.kind)).toEqual(['unbalanced']);

    // CHIỀU XANH — một bộ dò bắt tất cả cũng vô dụng như một bộ dò không bắt gì.
    expect(scanCss('/* chú thích có `*` và một dấu gạch bên trong */\n.a { color: red; }')).toEqual([]);
    // Văn xuôi có dấu nháy TRONG CHÚ THÍCH không làm lệch bộ đếm — đây đúng là
    // chỗ bản đầu (có bỏ qua chuỗi) đã mù.
    expect(scanCss("/* `grep -F '.page-settings{'` trong một câu */\n.a { color: red; }")).toEqual([]);
    // `@media` lồng một cấp vẫn cân.
    expect(scanCss('@media (max-width: 47rem) {\n  .a { color: red; }\n}')).toEqual([]);
    // `}` thừa cũng phải bị bắt, không chỉ `{` thừa.
    expect(scanCss('.a { color: red; }\n}').map((f) => f.kind)).toEqual(['negative']);

    // Số dòng có thật, không phải hằng 0 — thông báo hỏng phải chỉ đúng chỗ.
    expect(scanCss('.a { color: red; }\n\n\n}')[0]?.line).toBe(4);

    // ĐIỀU KIỆN ĐỂ TIN BỘ ĐẾM THÔ, cả hai chiều.
    expect(bracesInsideStrings('.a::after { content: "}"; }').map((f) => f.kind)).toEqual([
      'brace-in-string',
    ]);
    expect(bracesInsideStrings('.a { background: url("x.svg"); }')).toEqual([]);
    // Dấu nháy trong CHÚ THÍCH không tính — nếu tính thì cổng thành tiếng ồn
    // ngay lập tức, vì văn xuôi của repo này đầy dấu nháy.
    expect(bracesInsideStrings("/* `'.page-settings{'` */\n.a { color: red; }")).toEqual([]);
  });

  it('không tệp .css nào có chú thích hở hay ngoặc nhọn không cân', () => {
    const offenders = cssFiles()
      .map((name) => {
        const src = readFileSync(join(HERE, name), 'utf-8');
        return { name, findings: [...scanCss(src), ...bracesInsideStrings(src)] };
      })
      .filter((e) => e.findings.length > 0);
    expect(offenders).toEqual([]);
  });
});

/**
 * ─── CỔNG NÀY KHÔNG BẮT ĐƯỢC GÌ ─────────────────────────────────────────────
 *
 *   1. **Selector gõ sai, thuộc tính không tồn tại, giá trị sai đơn vị.** Nó
 *      không hiểu CSS; nó đếm ký tự. `.page-setttings { max-width: 54rem }` là
 *      hợp lệ với cổng này.
 *   2. **Một quy tắc bị quy tắc khác ghi đè.** Chính là thứ đã che lần 1 suốt
 *      nhiều tháng (`#content:has(.page-settings)` ở `app-screens.css` mang
 *      cùng con số) — cổng này không so hai tệp với nhau.
 *   3. **Quy tắc có trong nguồn nhưng rơi khỏi `dist/`** vì bất kỳ lý do nào
 *      khác hai lý do trên. Phép đo thật cho câu ấy là `bun run build` rồi
 *      `grep` bản dựng, và nó KHÔNG chạy ở đây: vitest không dựng bundle. Đó
 *      là một món nợ có tên, ghi ở `docs/carried-forward.md`.
 *   4. **CSS ngoài `src/styles/`.** `packages/course-kit/reader.css` không đi
 *      qua đây — nó là bản chép từng byte từ v1 và có luật riêng.
 *
 *   5. **Một chuỗi CSS dùng dấu nháy escape (`\'`, `\"`) ngay trước một ngoặc
 *      thật.** Cả hai bất biến ở đây đều mù trước nó, theo cả hai chiều — đo
 *      ngày 2026-08-29, không phải suy luận:
 *
 *        - `content: 'foo \' { bar'` là CSS HỢP LỆ, nhưng `scanCss` đếm cái
 *          `{` ấy và báo `unbalanced` → cổng đỏ oan.
 *        - Nguy hơn: một tệp hỏng THẬT (thiếu một `}`) mà bù lại bằng một `}`
 *          giấu trong đúng loại chuỗi ấy thì lọt CẢ HAI phép kiểm — vì regex
 *          của `bracesInsideStrings` cũng không hiểu `\'`, nên nó không thấy
 *          chuỗi đó chứa ngoặc.
 *
 *      Đây là cùng một lớp mù mà chú thích ở `bracesInsideStrings` cảnh báo,
 *      chỉ khác chỗ đứng. Lý do không đóng: đóng đúng cần một trình quét
 *      chuỗi hiểu escape, tức là bắt đầu viết một parser CSS — mà toàn bộ giá
 *      trị của cổng này nằm ở chỗ nó KHÔNG phải parser và vẫn chạy được trên
 *      tệp đã hỏng. Lưới thật cho ca này vẫn còn: `bun run build` — Lightning
 *      CSS ném `CssSyntaxError: Missing closing }` ngay. Cổng ở đây là lớp
 *      phòng thủ thứ hai, và ở đúng ca này nó thủng.
 */

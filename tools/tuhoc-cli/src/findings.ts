/**
 * Turning a `Finding` into something a contributor can act on.
 *
 * ## This file does not decide anything
 *
 * `validatePackage` decides what is wrong. This file only decides how to say
 * it. {@link FIX_HINTS} is keyed by finding code and typed
 * `Record<FindingCode, string>` on purpose: when the rule set grows a code, THIS
 * FILE STOPS COMPILING until someone writes the sentence that tells a
 * contributor what to do about it. `pack.test.ts` asserts the same thing at
 * runtime, for the day someone widens the type instead of filling it in.
 *
 * No hint may restate the rule ("bỏ thẻ script vì thẻ script bị cấm"). Each one
 * has to name the next action, and where a rule has a legitimate way out —
 * `tier: "interactive"` for the five JavaScript rules — the hint says so,
 * because a contributor who does not know that exists will assume the platform
 * simply cannot host their course.
 */

import type { Finding, FindingCode } from './course-format.ts';

/**
 * What to DO about each code. Vietnamese, because the contributor is; the rule
 * set's own English `detail` is printed verbatim right above it and is never
 * paraphrased away — it carries the specifics (which field, which byte count,
 * which duplicate id) that no fixed sentence can.
 *
 * `{{cmd}}` stands for however this program was actually started, filled in by
 * {@link renderFindings}. A hint that tells a contributor to run something has
 * to name a command that exists — see `invocation.ts`.
 */
export const FIX_HINTS: Record<FindingCode, string> = {
  EMPTY_PACKAGE:
    'Thư mục không có tệp nào để đóng gói. Chạy `{{cmd}} init <thư-mục>` để dựng khung, hoặc kiểm tra lại đường dẫn.',
  TOO_LARGE:
    'Gói vượt trần 20 MB (tính theo kích thước ĐÃ giải nén). Nén ảnh, bỏ tệp không dùng, hoặc tách thành nhiều course.',
  PATH_ESCAPE:
    'Đường dẫn này đi ra ngoài gói (có "..", "\\", hoặc bắt đầu bằng "/"). Mọi đường dẫn phải tương đối so với gốc gói và dùng dấu "/".',
  MANIFEST_MISSING:
    'Gói phải có manifest.json ngay ở gốc thư mục. Nếu nó nằm trong thư mục con, hãy pack thư mục con đó.',
  MANIFEST_PARSE:
    'manifest.json không phải JSON hợp lệ. Thường là dấu phẩy thừa ở cuối danh sách hoặc thiếu dấu ngoặc kép.',
  // Longest hint in the table on purpose: this is the code a v1 manifest hits,
  // it hits it four times at once, and "sửa trường mà pointer chỉ tới" alone
  // would leave a contributor staring at four identical paragraphs. The four
  // fields named here are exactly the ones v2 added — measured against the real
  // package, `courses/***REMOVED***`, which fails on all four and nothing
  // else.
  MANIFEST_FIELD:
    'Sửa đúng trường mà JSON pointer ở dòng "vị trí" chỉ tới.\n' +
    'Bốn trường v2 hay thiếu nhất, kèm ví dụ giá trị hợp lệ:\n' +
    '  "tier": "content"            (hoặc "interactive" nếu course cần JavaScript)\n' +
    '  "license": "CC-BY-4.0"       (giấy phép bạn phát hành course)\n' +
    '  "generatedBy": "human"       (hoặc "ai", "mixed" — phải trung thực)\n' +
    '  "authors": [{ "name": "Tên bạn" }]\n' +
    'Mô tả đầy đủ từng trường: docs/course-format.md.',
  SEMVER: 'Trường "version" phải là semver ba số, ví dụ "1.0.0" hoặc "0.2.1-beta.1".',
  RUNTIME_RANGE:
    'Trường "runtime" chỉ nhận dải caret 1–3 số, ví dụ "^1", "^1.2", "^1.2.3". Không dùng ">=", "||" hay "x".',
  DUPLICATE_CHAPTER_ID:
    'Hai chương đang mang cùng "id". "id" là khoá dùng để lưu tiến độ đọc, nên phải là duy nhất trong cả course — đổi một trong hai.',
  CHAPTER_FILE_MISSING:
    'manifest.json trỏ tới một tệp không có trong thư mục. Kiểm tra chính tả và nhớ rằng đường dẫn tính từ gốc gói (ví dụ "chapters/c1.html"), phân biệt hoa thường.',
  SCRIPT_TAG:
    'Bỏ thẻ script khỏi tệp này. Nếu course thật sự cần JavaScript, đổi "tier" trong manifest.json thành "interactive" — đổi lại, gói hạng interactive phải chờ người duyệt tay ở registry thay vì merge gần như tự động.',
  EVENT_HANDLER_ATTR:
    'Bỏ thuộc tính on... (onclick, onerror, ...) khỏi thẻ này — đây là luật DUY NHẤT thật sự ngăn mã chạy khi trình đọc nạp chương bằng innerHTML. Cần tương tác thì chuyển sang "tier": "interactive".',
  JAVASCRIPT_URL:
    'Thay URL "javascript:" bằng một liên kết thật, hoặc bỏ hẳn liên kết đó. Cần chạy mã thì chuyển sang "tier": "interactive".',
  EMBEDDED_FRAME:
    'Bỏ iframe/object/embed/frame — nội dung nhúng từ nơi khác không kiểm định được nên hạng "content" không nhận. Nhúng ảnh, hoặc chuyển sang "tier": "interactive".',
  FORM_TAG:
    'Bỏ thẻ form. Hạng "content" là tài liệu đọc, không gửi dữ liệu đi đâu. Cần thu thập câu trả lời thì chuyển sang "tier": "interactive".',
  JS_FILE_IN_PACKAGE:
    'Xoá tệp JavaScript này khỏi gói, hoặc đổi "tier" trong manifest.json thành "interactive" nếu course thật sự cần nó.',
  TAG_ATTR_FLOOD:
    'Một thẻ đơn lẻ trong tệp này mang quá 1024 thuộc tính. Gần như chắc chắn đây không phải HTML thật — hay gặp nhất là JavaScript đã minify bị đặt nhầm đuôi .html.',
};

/** Label for a finding's `path`, which may be a file, a JSON pointer, or `.` for the package as a whole. */
function locationLabel(path: string): string {
  if (path === '.') return 'cả gói';
  return path;
}

/**
 * The full report, as lines.
 *
 * Every finding is printed — `validatePackage` returns all of them precisely so
 * a contributor can fix the package in one pass instead of one rebuild at a
 * time, and dropping any of them here would throw that away. Each entry carries
 * all three fields the rule set produced: the `code` (so it can be looked up),
 * the `path` (so the contributor knows WHICH file), and the `detail` verbatim
 * (so they know WHAT about it) — plus the hint, which says what to do next.
 *
 * The hint, and ONLY the hint, is printed once per code rather than once per
 * finding. Measured on the real package: `courses/***REMOVED***` produces
 * four `MANIFEST_FIELD` findings, and repeating the seven-line hint four times
 * made the report worse than the bare codes it replaced — the reader stops
 * reading a wall that repeats itself, which is the exact failure this whole
 * command exists to avoid. `vị trí` and `vấn đề` are still printed in full for
 * every finding, because those are what differ.
 */
export function renderFindings(dir: string, findings: readonly Finding[], self: string): string[] {
  const lines: string[] = [];
  const n = findings.length;
  lines.push('');
  lines.push(`tuhoc pack: gói KHÔNG hợp lệ — ${n} vấn đề trong ${dir}`);
  lines.push('');

  /** code → the 1-based number of the finding whose entry carries the full hint. */
  const hintShownAt = new Map<string, number>();

  findings.forEach((f, i) => {
    const num = i + 1;
    lines.push(`  ${num}) ${f.code}`);
    lines.push(`     vị trí:   ${locationLabel(f.path)}`);
    lines.push(`     vấn đề:   ${f.detail}`);

    const shownAt = hintShownAt.get(f.code);
    if (shownAt !== undefined) {
      lines.push(`     Cách sửa: như mục ${shownAt}) ở trên — cùng mã ${f.code}.`);
      lines.push('');
      return;
    }
    hintShownAt.set(f.code, num);

    // A code with no hint should be impossible (the type and the test both say
    // so). If one ever gets here anyway, say so out loud rather than printing a
    // bare code and letting the contributor guess.
    const hint = (
      FIX_HINTS[f.code as FindingCode] ?? `(chưa có gợi ý cho mã "${f.code}" — báo lỗi này cho maintainer)`
    ).replaceAll('{{cmd}}', self);
    // Multi-line hints are indented to line up under the first line, so a long
    // one reads as one block rather than as new findings.
    const [head, ...tail] = hint.split('\n');
    lines.push(`     Cách sửa: ${head}`);
    for (const cont of tail) lines.push(`               ${cont}`);
    lines.push('');
  });

  lines.push('Không có tệp .zip nào được ghi. Giải thích từng mã lỗi: docs/course-format.md');
  return lines;
}

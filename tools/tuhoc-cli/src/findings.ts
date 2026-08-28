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
 * a widget, `widgets/<name>/index.html`, for the six JavaScript-related rules —
 * the hint says so, because a contributor who does not know that exists will
 * assume the platform simply cannot host their course. `tier: "interactive"`
 * was that escape hatch under format v1; format v2 refuses the field outright
 * (`TIER_REMOVED`, below) and a widget is the only door left, so no hint may
 * name `tier` as something to set.
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
  // it hits it three times at once, and "sửa trường mà pointer chỉ tới" alone
  // would leave a contributor staring at three identical paragraphs. The three
  // fields named here are exactly the ones v2 added — measured against a real
  // v1 package, which fails on all three and nothing else. `tier` is NOT one
  // of them: v2 does not require it, v2 REFUSES it outright (`TIER_REMOVED`,
  // below), so it has no place in a list of values to fill in here.
  MANIFEST_FIELD:
    'Sửa đúng trường mà JSON pointer ở dòng "vị trí" chỉ tới.\n' +
    'Ba trường v2 hay thiếu nhất, kèm ví dụ giá trị hợp lệ:\n' +
    '  "license": "CC-BY-4.0"       (giấy phép bạn phát hành course)\n' +
    '  "generatedBy": "human"       (hoặc "ai", "mixed" — phải trung thực)\n' +
    '  "authors": [{ "name": "Tên bạn" }]\n' +
    'Mô tả đầy đủ từng trường: docs/course-format.md.',
  // format v2 xoá hẳn khái niệm "hạng" — không còn "content" lẫn "interactive"
  // để chọn. Hint này CHỈ nói xoá trường, không nói đổi giá trị: xem
  // WIDGET_* bên dưới cho đường thay thế của phần tương tác.
  TIER_REMOVED:
    'Xoá hẳn trường "tier" khỏi manifest.json, dù nó đang mang giá trị gì. Định dạng mới không còn khái niệm "hạng" — mọi course đều là nội dung tĩnh; phần cần chạy mã (đếm điểm, vẽ biểu đồ tương tác…) tách ra thành widget riêng dưới widgets/<tên>/index.html. Xem docs/course-format.md §4.',
  SEMVER: 'Trường "version" phải là semver ba số, ví dụ "1.0.0" hoặc "0.2.1-beta.1".',
  RUNTIME_RANGE:
    'Trường "runtime" chỉ nhận dải caret 1–3 số, ví dụ "^1", "^1.2", "^1.2.3". Không dùng ">=", "||" hay "x".',
  DUPLICATE_CHAPTER_ID:
    'Hai chương đang mang cùng "id". "id" là khoá dùng để lưu tiến độ đọc, nên phải là duy nhất trong cả course — đổi một trong hai.',
  CHAPTER_FILE_MISSING:
    'manifest.json trỏ tới một tệp không có trong thư mục. Kiểm tra chính tả và nhớ rằng đường dẫn tính từ gốc gói (ví dụ "chapters/c1.html"), phân biệt hoa thường.',
  SCRIPT_TAG:
    'Bỏ thẻ script khỏi tệp này. Nếu course thật sự cần JavaScript, chuyển đoạn mã đó vào widgets/<tên>/index.html — widget là nơi DUY NHẤT một gói được phép mang mã chạy được, và nó vẫn phải chờ người duyệt tay ở registry thay vì merge gần như tự động.',
  EVENT_HANDLER_ATTR:
    'Bỏ thuộc tính on... (onclick, onerror, ...) khỏi thẻ này — đây là luật DUY NHẤT thật sự ngăn mã chạy khi trình đọc nạp chương bằng innerHTML. Cần tương tác thì chuyển mã đó vào widgets/<tên>/index.html.',
  JAVASCRIPT_URL:
    'Thay URL "javascript:" bằng một liên kết thật, hoặc bỏ hẳn liên kết đó. Cần chạy mã thì chuyển đoạn đó vào widgets/<tên>/index.html.',
  EMBEDDED_FRAME:
    'Bỏ iframe/object/embed/frame — nội dung nhúng từ nơi khác không kiểm định được nên không chương nào được mang nó. Nhúng ảnh thay vào đó, hoặc nếu cần thứ chạy được, viết nó thành widgets/<tên>/index.html.',
  FORM_TAG:
    'Bỏ thẻ form. Một chương là tài liệu đọc, không gửi dữ liệu đi đâu. Cần thu thập câu trả lời thì viết một widgets/<tên>/index.html — widget được phép mang cả script lẫn form.',
  JS_FILE_IN_PACKAGE:
    'Xoá tệp JavaScript rời này khỏi gói. Nếu course thật sự cần nó, chuyển nội dung vào widgets/<tên>/index.html — một tệp JS đứng riêng ngoài widgets/ không còn đường chạy nào trong định dạng v2.',
  TAG_ATTR_FLOOD:
    'Một thẻ đơn lẻ trong tệp này mang quá 1024 thuộc tính. Gần như chắc chắn đây không phải HTML thật — hay gặp nhất là JavaScript đã minify bị đặt nhầm đuôi .html.',
  // Tám hint dưới đây là của Task 2 (luật widget). KHÔNG nhắc "tier" — hạng đã
  // bị xoá (xem TIER_REMOVED ở trên); phần tương tác nay LUÔN là widget, không
  // còn hai đường để chọn.
  WIDGET_TOO_LARGE:
    'widgets/<tên>/index.html của widget này nặng hơn mức cho phép. Cắt bớt nội dung, viết CSS/JS gọn hơn (không minify — xem WIDGET_LINE_TOO_LONG), hoặc bỏ hẳn phần nặng (ảnh, dữ liệu lớn): widget không tải được gì từ mạng nên không có chỗ nào để "chuyển ra ngoài" mà vẫn dùng được.',
  WIDGET_LINE_TOO_LONG:
    'Một dòng trong widgets/<tên>/index.html dài hơn mức cho phép — dấu hiệu quen thuộc của mã đã bị minify hoặc dồn hết vào một dòng. Viết lại thành nhiều dòng bình thường, thụt lề rõ ràng: người duyệt phải đọc được mã này bằng mắt, không chỉ máy chạy được.',
  WIDGET_BAD_NAME:
    'Tên thư mục widget không hợp lệ. Chỉ dùng chữ thường a-z, số 0-9 và dấu gạch ngang, bắt đầu bằng chữ hoặc số, tối đa 64 ký tự — ví dụ "widgets/dem-so/index.html", không phải "widgets/Dem_So/index.html" hay "widgets/_demo/index.html".',
  WIDGET_FORBIDDEN_API:
    'widgets/<tên>/index.html gọi document.cookie, localStorage, sessionStorage hoặc indexedDB. Widget chạy trong iframe sandbox không có cookie hay bộ nhớ trình duyệt — gọi những API này chỉ ném lỗi lúc chạy, không phải lúc "vị trí" chỉ ra. Bỏ hẳn đoạn mã đó; cần nhớ trạng thái thì giữ nó trong một biến JavaScript sống trong phiên đọc.',
  WIDGET_EXTERNAL_URL:
    'widgets/<tên>/index.html có một địa chỉ http:// hoặc https:// — kể cả khi nó chỉ nằm trong chú thích. Widget phải tự chứa hoàn toàn, không tải gì từ mạng. Xoá đường dẫn đó; nhúng trực tiếp nội dung cần thiết vào widget nếu bản quyền cho phép, hoặc bỏ tính năng đó.',
  WIDGET_EXTRA_FILE:
    'Một widget chỉ được có đúng một tệp: widgets/<tên>/index.html. Gộp nội dung của tệp thừa ("vị trí" ở trên) — CSS, JS, ảnh nhỏ — trực tiếp vào index.html (inline <style>/<script>, hoặc data: URL cho ảnh), rồi xoá tệp đó đi.',
  WIDGET_MISSING:
    'Một chương dùng <div data-widget="…"> trỏ tới một widget mà gói không có (hoặc thư mục widget đó không có index.html). Kiểm tra tên trong data-widget khớp đúng tên thư mục widgets/<tên>/, hoặc thêm widgets/<tên>/index.html còn thiếu vào gói.',
  WIDGET_ORPHAN:
    'Gói mang một widgets/<tên>/index.html mà không chương nào tham chiếu qua data-widget. Xoá cả thư mục widget này nếu không còn dùng, hoặc thêm <div data-widget="<tên>"></div> vào chương cần nó.',
};

/** Label for a finding's `path`, which may be a file, a JSON pointer, or `.` for the package as a whole. */
function locationLabel(path: string): string {
  if (path === '.') return 'cả gói';
  return path;
}

/**
 * The finding-by-finding body of a validation report, as lines — every
 * numbered item, nothing before the first one and nothing after the last.
 *
 * Two callers share this: `pack` (a directory checked locally against
 * `validatePackage`) and `publish` (a server's 400 response, produced by the
 * SAME rule set re-run on the far end — see `publish.ts`). Both hand this
 * function the identical `Finding[]` shape and get the identical rendering,
 * which is the whole point of sharing it: an author should not have to learn
 * two report formats for the same information depending on which command
 * caught the problem.
 *
 * What is deliberately NOT here is the header ("N vấn đề trong …") and the
 * footer ("Không có tệp .zip nào được ghi…" / "Chưa gói nào được lưu…") —
 * those differ between the two callers because they are stating two different
 * true things ("nothing was written to disk" vs. "nothing was stored on the
 * server"), and a shared function that guessed at one wrong sentence would not
 * be reuse, it would be a borrowed sentence that happens to compile. Each
 * caller writes its own two lines around this function's output; see
 * `pack.ts` and `publish.ts` for the two shapes.
 *
 * Every finding is printed — `validatePackage` returns all of them precisely so
 * a contributor can fix the package in one pass instead of one rebuild at a
 * time, and dropping any of them here would throw that away. Each entry carries
 * all three fields the rule set produced: the `code` (so it can be looked up),
 * the `path` (so the contributor knows WHICH file), and the `detail` verbatim
 * (so they know WHAT about it) — plus the hint, which says what to do next.
 *
 * The hint, and ONLY the hint, is printed once per code rather than once per
 * finding. Measured on a real v1 package: it produces exactly three
 * `MANIFEST_FIELD` findings, and repeating a multi-line hint three times made
 * the report worse than the bare codes it replaced — the reader stops reading
 * a wall that repeats itself, which is the exact failure this whole command
 * exists to avoid. `vị trí` and `vấn đề` are still printed in full for every
 * finding, because those are what differ.
 */
export function renderFindings(findings: readonly Finding[], self: string): string[] {
  const lines: string[] = [];

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

  return lines;
}

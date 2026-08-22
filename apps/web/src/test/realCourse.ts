/**
 * Đường tới **nội dung course thật** cho các test cần nó — và câu phải nói khi
 * nó chưa được nạp về.
 *
 * ## Vì sao dữ liệu vẫn phải là thật
 *
 * Task 11 bóc `courses/***REMOVED***/` ra khỏi repo (spec §2B.1: giáo
 * trình riêng tư không được nằm trong repo sắp publish). Bốn tệp test đọc thẳng
 * một chương của nó:
 *
 *   - `src/annotations/painter.test.ts`
 *   - `src/annotations/anchor.test.ts`
 *   - `src/annotations/SelectionToolbar.test.tsx`
 *   - `src/course/version.test.ts`
 *
 * Cách rẻ là thay bằng HTML viết tay. Cách đó bị cấm, và không phải vì khẩu
 * hiệu: trong hệ thống con này, chạy trên gói thật đã **bác bỏ bảy phép đo sai**
 * mà fixture thủ công cho xanh hết. Gần nhất là chính `version.test.ts` — 17
 * fixture prose viết tay đều xanh cả khi bỏ `renderKatex`, trong khi chương
 * thật cho **26/30 orphan giả** (xem khối chú thích ngay trên `previewUpdate`
 * ở tệp đó). Một chương thật dài, có công thức, có ký tự Việt, có đúng những
 * hình dạng đoạn văn mà tay không nghĩ ra được.
 *
 * ## Nên nó đi đâu
 *
 * Ra một kho **ngoài cây git**, dạng `.zip` do `tuhoc pack` ghi. `make courses`
 * bung ngược vào `courses/` — một thư mục làm việc bị `.gitignore` bỏ qua toàn
 * bộ. Test vẫn đọc đúng tệp đó, vẫn là byte thật, chỉ khác chỗ cất.
 *
 * ## Vắng gói thì sao
 *
 * **Đỏ, không phải xanh, và không phải bỏ qua.** Một test đọc dữ liệu thật mà
 * tự chuyển sang dữ liệu giả khi không tìm thấy dữ liệu thật thì đã thôi là
 * chính nó; một test tự `skip` thì im lặng, và im lặng ở đây trông y hệt lúc
 * mọi thứ đều tốt. Cái tệp này thêm vào chỉ là **câu chữ**: `ENOENT` cũng đỏ,
 * nhưng nó không nói cho ai biết phải gõ gì.
 *
 * Bản clone mới của người khác sẽ đỏ bốn tệp này, và đó là trạng thái đúng:
 * gói là của tác giả, riêng tư, họ không có nó. Xem `docs/publishing.md`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/web/src/test/ → gốc repo là bốn tầng lên. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * `id` trong manifest của giáo trình, tức tên thư mục `make courses` bung ra.
 * Không tham số hoá được: nội dung của ĐÚNG course này là thứ các phép đo ở
 * bốn tệp kia dựa vào.
 */
export const REAL_COURSE_ID = '***REMOVED***';

const COURSE_DIR = resolve(REPO_ROOT, 'courses', REAL_COURSE_ID);

function missing(rel: string, abs: string): Error {
  return new Error(
    [
      `Chưa có nội dung course thật: ${abs}`,
      '',
      `Test này chạy trên chương thật của "${REAL_COURSE_ID}", không phải fixture — xem đầu`,
      'apps/web/src/test/realCourse.ts để biết vì sao. Course không nằm trong repo nữa;',
      'nó là một gói .zip trong kho ngoài repo.',
      '',
      'Nạp về:',
      '    make courses',
      '',
      `Chưa có gói: pack lại từ thư mục course rồi đặt .zip vào kho (mặc định`,
      '~/Documents/claude/tuhoc-courses, đổi bằng TUHOC_COURSE_STORE):',
      '    bun tools/tuhoc-cli/src/index.ts pack <thư-mục> -o <kho>/<tên>.zip',
      '',
      `Không có gói này thì bốn tệp test đọc chương thật sẽ đỏ. Đó là trạng thái đúng,`,
      'không phải thứ để vá bằng dữ liệu bịa. (rel: ' + rel + ')',
    ].join('\n'),
  );
}

/** Đường tuyệt đối tới một tệp trong gói đã bung. Ném nếu chưa nạp về. */
export function realCourseFile(rel: string): string {
  const abs = resolve(COURSE_DIR, rel);
  if (!existsSync(abs)) throw missing(rel, abs);
  return abs;
}

/** Nội dung UTF-8 của một tệp trong gói đã bung. Ném nếu chưa nạp về. */
export function readRealCourseFile(rel: string): string {
  return readFileSync(realCourseFile(rel), 'utf8');
}

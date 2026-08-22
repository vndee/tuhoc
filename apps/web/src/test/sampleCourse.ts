/**
 * Đường tới **nội dung course thật** cho các test cần nó — và câu phải nói khi
 * nó chưa được bung ra.
 *
 * ## Vì sao dữ liệu vẫn phải là một GÓI, không phải HTML viết trong tệp test
 *
 * Bốn tệp test dưới đây đọc thẳng một chương của một course đã đóng gói:
 *
 *   - `src/annotations/painter.test.ts`
 *   - `src/annotations/anchor.test.ts`
 *   - `src/annotations/SelectionToolbar.test.tsx`
 *   - `src/course/version.test.ts`
 *
 * Cách rẻ là thay bằng vài đoạn HTML viết tay ngay trong tệp test. Cách đó bị
 * cấm, và không phải vì khẩu hiệu: trong hệ thống con này, chạy trên gói thật
 * đã **bác bỏ bảy phép đo sai** mà fixture thủ công cho xanh hết. Gần nhất là
 * chính `version.test.ts` — 17 fixture prose viết tay đều xanh cả khi bỏ
 * `renderKatex`, trong khi một chương thật cho **26/30 orphan giả** (xem khối
 * chú thích ngay trên `previewUpdate` ở tệp đó). Một chương thật thì dài, có
 * công thức nằm giữa câu, có ký tự Việt hai byte, có khối `<details>` gập lại,
 * và có đúng những hình dạng đoạn văn mà tay không nghĩ ra được.
 *
 * ## Course nào, và vì sao đổi
 *
 * Task 11 bóc `courses/***REMOVED***/` ra khỏi repo: nó là giáo trình
 * riêng tư của tác giả, repo thì sắp publish (spec §2B.1). Hệ quả là mười tệp
 * test — sáu đơn vị, bốn e2e — chỉ chạy được trên máy có gói đó, tức đỏ trên
 * mọi bản clone của người khác.
 *
 * Task 13 thay dữ liệu test bằng **`so-dau-phay-dong`**, một course mẫu **công
 * khai** do repo này soạn, `tuhoc pack` ghi ra, và commit ở
 * `fixtures/courses/`. Nó không phải đồ chơi: nó được dựng để mang đúng những
 * hình dạng đã bắt lỗi thật, ở tỉ lệ đo được từ giáo trình cũ — công thức
 * KaTeX nằm giữa câu văn (1 457 cái, 182 mỗi chương), tiếng Việt có dấu
 * (20 835 ký tự đa byte), `<details>` gập được (30), tham chiếu chéo giữa các
 * chương (64), `viz.js` thật với canvas thật, và hạng `interactive`. Bảng đối
 * chiếu đầy đủ, kèm những hình dạng **cố ý không** tái tạo, nằm ở
 * `.superpowers/sdd/2026-08-21-s1-course-packages/task-13-sample-course-report.md`.
 *
 * ## Nó nằm ở đâu trên đĩa
 *
 * `courses/<id>/`, một thư mục làm việc bị `.gitignore` bỏ qua toàn bộ.
 * `make courses` bung nó ra từ `fixtures/courses/*.zip` (gói mẫu, trong repo)
 * và từ kho ngoài cây git (gói riêng, nếu có). Test đọc đúng byte mà
 * `tuhoc pack` đã ghi, không đọc thư mục nguồn — nên nếu ai sửa nguồn mà quên
 * đóng gói lại, test vẫn đo trên gói, và đó là chủ ý: gói là thứ người dùng
 * nhận được.
 *
 * ## Chưa bung thì sao
 *
 * **Đỏ, không phải xanh, và không phải bỏ qua.** Một test đọc dữ liệu thật mà
 * tự chuyển sang dữ liệu giả khi không tìm thấy dữ liệu thật thì đã thôi là
 * chính nó; một test tự `skip` thì im lặng, và im lặng ở đây trông y hệt lúc
 * mọi thứ đều tốt. Cái tệp này thêm vào chỉ là **câu chữ**: `ENOENT` cũng đỏ,
 * nhưng nó không nói cho ai biết phải gõ gì.
 *
 * Khác với trước task 13, đây bây giờ là một trạng thái **sửa được bằng một
 * lệnh** trên mọi bản clone: gói nằm trong repo. Xem `docs/publishing.md`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/web/src/test/ → gốc repo là bốn tầng lên. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * `id` trong manifest của course mẫu, tức tên thư mục `make courses` bung ra.
 * Không tham số hoá được: nội dung của ĐÚNG course này là thứ các phép đo ở
 * bốn tệp kia dựa vào.
 */
export const SAMPLE_COURSE_ID = 'so-dau-phay-dong';

/**
 * Chương mà cả bốn tệp dùng làm ngữ liệu.
 *
 * `p1-3` ("Làm tròn, và định lý nửa ULP") được chọn bằng phép đo, không bằng
 * cảm tính. Đo trên chính tệp, so với `p1-5.html` cũ — chương mà những phép đo
 * này ra đời trên đó:
 *
 *                                        p1-5 (cũ)   p1-3 (nay)   cần ít nhất
 *     đoạn văn ≥120 ký tự                    32          55            30
 *     trong đó có chỗ sửa ngoài LaTeX        31          48             6
 *     công thức KaTeX (ký tự '￼')          263         239             —
 *     độ dài projection `flat`                —      15.917         10.000
 */
export const SAMPLE_CHAPTER = 'chapters/p1-3.html';

const COURSE_DIR = resolve(REPO_ROOT, 'courses', SAMPLE_COURSE_ID);

function missing(rel: string, abs: string): Error {
  return new Error(
    [
      `Chưa bung nội dung course mẫu: ${abs}`,
      '',
      `Test này chạy trên một chương thật của gói "${SAMPLE_COURSE_ID}", không phải HTML viết`,
      'trong tệp test — xem đầu apps/web/src/test/sampleCourse.ts để biết vì sao.',
      '',
      'Gói NẰM TRONG repo (fixtures/courses/so-dau-phay-dong.zip); `courses/` chỉ là thư',
      'mục làm việc, bị .gitignore bỏ qua. Bung ra:',
      '    make courses',
      '',
      'Nếu vừa sửa nguồn ở fixtures/courses/so-dau-phay-dong/ thì đóng gói lại trước:',
      '    bun tools/tuhoc-cli/src/index.ts pack fixtures/courses/so-dau-phay-dong \\',
      '      -o fixtures/courses/so-dau-phay-dong.zip',
      '',
      '(rel: ' + rel + ')',
    ].join('\n'),
  );
}

/** Đường tuyệt đối tới một tệp trong gói đã bung. Ném nếu chưa bung. */
export function sampleCourseFile(rel: string): string {
  const abs = resolve(COURSE_DIR, rel);
  if (!existsSync(abs)) throw missing(rel, abs);
  return abs;
}

/** Nội dung UTF-8 của một tệp trong gói đã bung. Ném nếu chưa bung. */
export function readSampleCourseFile(rel: string): string {
  return readFileSync(sampleCourseFile(rel), 'utf8');
}

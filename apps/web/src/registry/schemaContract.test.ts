/// <reference types="node" />
import { describe, expect, it } from 'vitest';
// Nhập GIÁ TRỊ, và CHỈ ở tệp test này.
//
// `tools/registry/src/build-index.ts` kéo theo `node:child_process`,
// `node:fs/promises` và cả `tools/tuhoc-cli/src/readdir.ts`. Không thứ nào
// trong số đó được phép vào bundle của trình duyệt, nên mã sản phẩm ở
// `./types.ts` chỉ nhập KIỂU (`import type`, bị xoá sạch lúc dịch). Test thì
// chạy trong Node, nên nó — và chỉ nó — đọc được con số thật.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, INDEX_SCHEMA } from '../../../../tools/registry/src/build-index.ts';
import { SUPPORTED_INDEX_SCHEMA } from './index.ts';

/**
 * Cổng TRÔI DẠT giữa bên sinh `index.json` và bên đọc nó.
 *
 * Kế hoạch nói `RegistryEntry`/`RegistryIndex` được định nghĩa MỘT LẦN ở
 * `tools/registry` và nền tảng nhập lại — "một định nghĩa, không hai bản trôi
 * dạt", đúng bài học *một bộ luật, ba bản, bất đồng 7/12 hàng*. Nửa KIỂU của
 * lời hứa ấy do `./types.ts` giữ và `tsc -b` cưỡng chế.
 *
 * Nửa còn lại là con SỐ schema, và nó không đi cùng kiểu được: `INDEX_SCHEMA`
 * là một giá trị, và nhập giá trị từ đó là nhập cả `node:child_process` vào
 * trình duyệt. Nên nền tảng khai lại con số, và bài này giữ hai con số bằng
 * nhau.
 *
 * Vì sao điều đó đáng một cổng riêng: Task 2 bump `INDEX_SCHEMA` lên 2 là một
 * việc hoàn toàn hợp lý ở phía registry, và nếu nền tảng không biết thì cái
 * người dùng gặp là màn "cần cập nhật nền tảng" ngay sau một lần deploy bình
 * thường — thông báo đúng, nguyên nhân sai. Bài này biến chuyện đó thành một
 * cổng ĐỎ lúc dịch thay vì một lỗi lúc chạy ở máy người khác.
 */
describe('hợp đồng schema giữa tools/registry và nền tảng', () => {
  it('SUPPORTED_INDEX_SCHEMA của nền tảng bằng đúng INDEX_SCHEMA của bên sinh index', () => {
    expect(SUPPORTED_INDEX_SCHEMA).toBe(INDEX_SCHEMA);
  });

  it('và nó là một số nguyên dương — không phải `undefined` lọt qua bằng cách bằng chính nó', () => {
    // Không có bài này thì hai `undefined` cũng "bằng nhau" và cổng trên xanh
    // trong khi cả hai đầu đều hỏng. Đúng khuôn cổng mù thứ sáu.
    expect(Number.isInteger(SUPPORTED_INDEX_SCHEMA)).toBe(true);
    expect(SUPPORTED_INDEX_SCHEMA).toBeGreaterThan(0);
  });

  /**
   * Cổng ĐẦU-CUỐI của hợp đồng, trên BYTES THẬT.
   *
   * Hai bài trên so hai con số. Bài này chạy **bên sinh index thật** trên **hai
   * gói mẫu công khai đã commit**, rồi ném kết quả qua **chốt ranh giới của
   * nền tảng**. Không fixture nào do test này tự bịa ra.
   *
   * Vì sao nó đáng tiền: kiểu dùng chung (`./types.ts`) bắt được trôi dạt lúc
   * DỊCH, nhưng nó không nói gì về BYTES — `RegistryEntry` mô tả cái
   * `build-index.ts` hứa, còn `assertRegistryIndex` kiểm cái nó thật sự viết
   * ra. Hai thứ ấy lệch nhau được, và lệch một cách im lặng: mọi test khác
   * trong thư mục này ăn fixture do chính chúng viết, nên tất cả sẽ cùng xanh
   * trong khi danh mục thật không đọc nổi.
   *
   * `updatedAt`/`generatedAt` được tiêm để bài không phụ thuộc mtime — xem
   * `BuildIndexOptions` của `build-index.ts` cho lý do đầy đủ.
   *
   * **Hiện đang KHÔNG đi qua được, có chủ ý và có ghi sổ.** Format v2 (task 1
   * của server-side pivot) bỏ hạng `tier` và chạy bảy luật content vô điều
   * kiện; `fixtures/courses/so-dau-phay-dong` là gói v1 hạng `interactive`
   * cũ, 19,7 KB `viz.js` của nó giờ ăn `JS_FILE_IN_PACKAGE` thật — nội dung
   * cần viết lại thành widget (Task 2+), không phải lỗi ở luật hay ở bài test
   * này. Task 1's fix round 1 xác nhận đúng MỘT phát hiện này (khớp
   * `validate-pr.ts --root fixtures/courses`) và cố ý KHÔNG xoá fixture,
   * KHÔNG stub tệp, KHÔNG nới luật để bài dưới xanh giả. Khi `viz.js` thành
   * widget, đổi `expect(...).rejects` dưới đây lại thành đường THÀNH CÔNG cũ
   * (còn trong lịch sử git) và test lại đủ cả khối `for` trên từng trường.
   */
  it('index sinh từ fixtures/courses THẬT: đúng MỘT lỗi đã biết, đúng chỗ, không hơn không kém', async () => {
    const HERE = dirname(fileURLToPath(import.meta.url));
    const fixtures = resolve(HERE, '../../../../fixtures/courses');

    await expect(
      buildIndex(fixtures, {
        updatedAt: async () => '2026-08-22T00:00:00.000Z',
        generatedAt: () => '2026-08-22T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({
      findings: [
        expect.objectContaining({
          code: 'JS_FILE_IN_PACKAGE',
          path: 'viz.js',
          courseDir: expect.stringContaining('so-dau-phay-dong'),
        }),
      ],
    });
  });
});

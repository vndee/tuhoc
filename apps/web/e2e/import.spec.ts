import { expect, test } from '@playwright/test';
import { COURSE_TITLE, PASSWORD, expectVizRendered, freshEmail, isBenignAuthCheck401, realCoursePackageZip, registerNewUser } from './helpers';

/**
 * Cổng nghiệm thu của hệ thống con 1: **gói thật, qua đường import thật**.
 *
 * Task 11 bóc `courses/***REMOVED***/` ra khỏi repo và biến nó thành gói
 * import đầu tiên của chính tác giả; task 13 thay ngữ liệu ấy bằng gói mẫu
 * công khai `so-dau-phay-dong` để bản clone của người khác cũng chạy được cổng
 * này. Cả hai lần, điều được kiểm không đổi: đường import chỉ có nghĩa nếu nó
 * **được dùng thật**, chứ không được ưu ái bằng một lối đi riêng. Ba tệp e2e
 * kia (`p1`, `p2`, `viz`) đều đọc course qua `/courses/<id>/...`, tức thư mục
 * tĩnh mà app này ship — không tệp nào trong số đó đi qua `db.packages`. Nên
 * chúng xanh trong khi đường import gãy, và **đã** như vậy một lần:
 *
 * `loader.ts`'s `resolveVizScriptUrl` trả `null` cho **mọi** gói cục bộ, kể cả
 * hạng `interactive`. Đo trên chính giáo trình sau khi nó thành gói import:
 * văn xuôi render bình thường, **0 canvas, 0 viz đăng ký, `viz.js` không hề
 * được yêu cầu**. Bốn cổng xanh, tính năng chính của cả hệ thống con không tồn
 * tại. Tệp này là thứ khiến lần sau đỏ.
 *
 * ## Nó chứng minh gì mà tệp khác không
 *
 * 1. Người dùng thật chọn tệp `.zip` thật ở màn hình `/import` — `setInputFiles`
 *    đi qua đúng `<input type="file">` và đúng handler `onChange`.
 * 2. Thư viện gắn đúng nhãn hạng `interactive` (§1.2 — nhãn an ninh, không phải
 *    thể loại).
 * 3. Chương đọc được **và mô phỏng chạy** — kiểm bằng pixel thật trên canvas,
 *    không phải bằng sự tồn tại của một thẻ.
 * 4. **Xuất xứ**: script chạy là `blob:` sinh từ chính gói, và trong suốt bài
 *    kiểm **không có request nào tới `/courses/<id>/viz.js`**. Nếu thiếu chốt
 *    này, bài kiểm vẫn xanh khi app lặng lẽ đọc thư mục tĩnh — mà thư mục tĩnh
 *    thì có mặt trên máy dev (xem `make courses`) và không có mặt trên máy
 *    người đọc.
 * 5. Ghi chú P2 vẫn hoạt động trên nội dung đến từ gói.
 *
 * ## Vắng gói thì tệp này ĐỎ
 *
 * Không skip. Một cổng nghiệm thu tự tắt khi không có dữ liệu để nghiệm thu
 * thì im lặng đúng lúc nó phải lên tiếng. `realCoursePackageZip` ném ra câu chỉ
 * đúng việc phải làm. Khác với trước task 13, gói bây giờ **được commit**
 * (`fixtures/courses/so-dau-phay-dong.zip`), nên vắng nó nghĩa là cây làm việc
 * hỏng, không phải "máy này không phải máy của tác giả". Xem
 * docs/publishing.md §1.3.
 */

const COURSE_ID = 'so-dau-phay-dong';
/** Chương p2-2 — cùng chương `p2.spec.ts` dùng, vì nó có cả mô phỏng lẫn đoạn văn xuôi thuần. */
const CHAPTER_ID = 'p2-2';
/**
 * Số `defineViz(...)` trong viz.js của gói. Đếm trên tệp, không phỏng đoán;
 * `viz.spec.ts` đọc lại con số này TỪ MÁY CHỦ và so bằng tập hợp, nên hai chỗ
 * không thể trôi khác nhau mà không có cái nào đỏ.
 */
const REGISTERED_VIZ_COUNT = 9;
/** Mô phỏng của p2-2; `p1.spec.ts` cũng dùng nó, với cùng ngưỡng pixel riêng. */
const CHAPTER_VIZ = 'sum-drift';
/**
 * Một `<p>` cấp cao nhất của p2-2, và ba điều kiện — cả ba đo trên tệp, và
 * điều kiện thứ ba do chính lượt chạy đầu của gói này dạy ra:
 *
 *  1. **Không nằm trong `<details>` gấp lại.** Xem chú thích ở `p2.spec.ts`.
 *  2. **Không có `$…$`.** Công thức thu về một ký tự `'￼'` trong phép chiếu
 *     mà neo sống trong đó, nên một đoạn toàn công thức không neo được.
 *  3. **Không có thẻ con nào** — không `<b>`, không `<code>`. Cử chỉ ở đây là
 *     triple-click, tức chọn TRỌN đoạn, và `paintAll` tạo một `<mark>` cho
 *     mỗi mạch chữ liền nhau. Đoạn có `<b>` ở giữa cho **ba** `<mark>` chứ
 *     không phải một, và khẳng định "một ghi chú → một vệt tô" bên dưới đỏ.
 *     Đó là hành vi đúng của painter; điều kiện thuộc về đoạn văn được chọn.
 */
const PARA = 'Có Mệnh đề 2.4, thuật toán Kahan là bốn dòng';

test.describe('gói thật đi qua màn hình Import (cổng nghiệm thu hệ thống con 1)', () => {
  // Import gồm: đọc ~67 KB từ đĩa, giải nén 10 tệp, tokenize từng byte, ghi
  // IndexedDB — rồi mới tới render chương và một vòng vẽ canvas. Gói mẫu nhỏ
  // hơn giáo trình riêng cũ (440 KB, 46 tệp) nên ngân sách này rộng rãi hơn
  // trước, và nó được giữ nguyên có chủ ý: nó là ngân sách CHẠY, không phải
  // một khẳng định về tốc độ, và siết nó lại chỉ đổi lấy một cổng hay đỏ vì
  // máy bận. 90s mặc định của config là cho p1.spec.ts.
  test.setTimeout(180_000);

  test('nhập .zip từ máy → thư viện gắn nhãn interactive → chương đọc được, mô phỏng chạy từ CHÍNH gói, ghi chú hoạt động', async ({ page }) => {
    const zipPath = realCoursePackageZip();

    const noise: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      if (isBenignAuthCheck401(msg)) return;
      noise.push(msg.text());
    });
    page.on('pageerror', (err) => noise.push(`pageerror: ${err.message}`));

    // Xuất xứ, ghi từ trước khi có request nào: nếu app đọc thư mục tĩnh thì
    // nó sẽ hiện ở đây. `make courses` để thư mục ấy TỒN TẠI trên máy chạy
    // test, nên "không request" là một khẳng định có nội dung, không phải hệ
    // quả của việc tệp không có.
    const staticCourseRequests: string[] = [];
    page.on('request', (req) => {
      const { pathname } = new URL(req.url());
      if (pathname.startsWith(`/courses/${COURSE_ID}/`)) staticCourseRequests.push(pathname);
    });

    await page.goto('/login');
    await registerNewUser(page, freshEmail(), PASSWORD);

    // ---- 1. nhập gói -------------------------------------------------------
    await page.goto('/import');
    await expect(page.getByRole('heading', { name: 'Nhập khóa học' })).toBeVisible();
    await page.locator('.import-file input[type="file"]').setInputFiles(zipPath);

    const ok = page.locator('.import-ok');
    await expect(ok, 'gói thật không nhập được — findings ở .import-findings').toBeVisible({ timeout: 120_000 });
    await expect(ok).toContainText(COURSE_ID);
    await expect(ok).toContainText('1.0.0');
    // `tuhoc pack` không lồng gói dưới thư mục nào, nên không được có thông báo
    // tái định gốc. Nếu có, tức gói trong kho không do CLI này ghi ra.
    // Chỉ trong khối trạng thái: mục "từ repo GitHub" luôn có một `.import-note`
    // riêng của nó, và nó không nói gì về gói vừa nhập.
    await expect(page.locator('.import-status .import-note')).toHaveCount(0);

    // ---- 2. thư viện, và nhãn hạng ----------------------------------------
    await page.goto('/library');
    const row = page.getByRole('list', { name: 'Khóa học của bạn' }).locator('li').filter({ hasText: COURSE_TITLE });
    await expect(row, 'gói đã nhập không xuất hiện trong thư viện').toHaveCount(1);
    await expect(
      row.locator('.lib-tier'),
      'gói khai tier "interactive" nhưng thư viện không gắn nhãn đó — nhãn này là phân loại AN NINH (§1.2), không phải trang trí',
    ).toContainText('interactive');

    // ---- 3. chương đọc được ------------------------------------------------
    await page.goto(`/c/${COURSE_ID}/${CHAPTER_ID}`);
    await expect(page.locator('.fade-in p').first()).toBeVisible({ timeout: 60_000 });
    await expect(
      page.locator('.katex').first(),
      'KaTeX chưa chạy trên nội dung đến từ gói — bộ ba runtime không nạp',
    ).toBeVisible();

    // ---- 4. mô phỏng chạy, và chạy TỪ GÓI ---------------------------------
    await expectVizRendered(page, CHAPTER_VIZ);

    const registered = await page.evaluate(
      () => Object.keys((window as unknown as { CourseKit?: { VIZ?: Record<string, unknown> } }).CourseKit?.VIZ ?? {}).length,
    );
    expect(
      registered,
      `viz.js của gói phải đăng ký ${REGISTERED_VIZ_COUNT} mô phỏng; đếm được ${registered}. 0 nghĩa là viz.js chưa từng chạy — đúng lỗi mà tệp này sinh ra để bắt.`,
    ).toBe(REGISTERED_VIZ_COUNT);

    const vizSrcs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]'))
        .map((s) => (s as HTMLScriptElement).src)
        .filter((src) => src.startsWith('blob:')),
    );
    expect(vizSrcs.length, 'viz.js của gói phải được phục vụ từ chính gói qua blob URL').toBe(1);

    expect(
      staticCourseRequests,
      `app đã đọc thư mục tĩnh /courses/${COURSE_ID}/ — gói đã nhập phải là nguồn duy nhất, và trên máy người đọc thư mục đó không tồn tại`,
    ).toEqual([]);

    // ---- 5. ghi chú P2 trên nội dung từ gói -------------------------------
    // Triple-click: cử chỉ thật, chọn trọn một đoạn. Đoạn được chọn là văn
    // xuôi thuần (xem PARA) nên neo không rơi vào công thức.
    const para = page.locator('.fade-in p').filter({ hasText: PARA }).first();
    await expect(para, `không tìm thấy đoạn mở đầu bằng "${PARA}" trong chương đến từ gói`).toBeVisible();
    await para.scrollIntoViewIfNeeded();
    await para.click({ clickCount: 3 });

    const toolbar = page.locator('.ann-tb');
    await expect(toolbar, 'bôi chọn trên nội dung từ gói không mở được thanh công cụ ghi chú').toBeVisible();
    await toolbar.getByRole('button', { name: 'Ghi chú', exact: true }).click();

    await expect(page.locator('mark.ann.ann-y[data-ann-id]')).toHaveCount(1);
    await page.getByLabel('Nội dung ghi chú').fill('ghi chú trên gói đã nhập');
    await page.getByRole('button', { name: 'Xong' }).click();
    await expect(page.locator('.ann-card-note')).toHaveText('ghi chú trên gói đã nhập');

    // Sống sót qua một lần tải lại: neo phải giải lại được trên chương mà
    // loader đọc từ `db.packages`, không phải trên DOM còn sót trong bộ nhớ.
    await page.reload();
    await expect(page.locator('mark.ann.ann-y[data-ann-id]')).toHaveCount(1, { timeout: 60_000 });

    expect(noise, `console/page errors trong lượt import: ${noise.join(' | ')}`).toEqual([]);
  });
});

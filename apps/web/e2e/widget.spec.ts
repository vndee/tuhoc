import { expect, test } from '@playwright/test';

/**
 * Task 16 — the widget sandbox gate, spec §8's own line item: "e2e: iframe
 * widget KHÔNG allow-same-origin; từ trong widget không đọc được
 * cookie/phiên."
 *
 * `reader/WidgetFrame.tsx` (Task 11) is the entire security boundary format
 * v2 rests on: a widget is free-running JavaScript, and the ONE thing that
 * makes shipping it safe is `sandbox="allow-scripts"` with no
 * `allow-same-origin` next to it — an OPAQUE origin, so the widget can never
 * read this reader's session cookie, never reach `window.parent`, never see
 * anything the platform knows about whoever is reading. Every unit test that
 * asserts this (`WidgetFrame.test.tsx`, `ChapterView.test.tsx`) does it
 * against jsdom, which does not implement the sandbox attribute at all — it
 * can check the STRING `sandbox="allow-scripts"` is what got rendered, but
 * it cannot prove a real browser actually enforces what that string means.
 * This file is the one gate in the whole repo that runs a widget in a real
 * Chromium sandbox and reads back what the sandbox itself decided.
 *
 * Three things, and none of the three is provable by the other two:
 *
 *   1. `sandbox` is EXACTLY `"allow-scripts"` — an equality check, never
 *      `toContain`. `toContain('allow-scripts')` is satisfied by
 *      `"allow-scripts allow-same-origin"` too, which is precisely the
 *      regression that would undo this whole design while looking green.
 *   2. The widget ACTUALLY RUNS — not just that an `<iframe>` tag exists in
 *      the DOM (a cage around a dead widget proves nothing about the cage).
 *      The fixture's `dem-so` counter (`fixtures/format-v2/valid-course/
 *      widgets/dem-so/index.html`) has a button `#b` that starts at `0`;
 *      clicking it must move the text to `1`, a real click handled by real
 *      JavaScript executing inside the frame.
 *   3. From INSIDE the frame, `window.origin` is the string `'null'` (the
 *      opaque-origin serialization RFC 6454 defines — not the parent's
 *      origin, not `about:blank`'s, literally the four-character string
 *      `"null"`) and `document.cookie` is `''`. This is the property the
 *      whole design rests on: no reach into the reader's session, measured
 *      from the one vantage point that would show a leak if the sandbox
 *      attribute were ever weakened. `page.frameLocator(...).locator(...).
 *      evaluate(...)` runs the callback INSIDE the sandboxed frame's own
 *      JS context — Playwright can do this even though the frame is opaque
 *      to the PARENT page's own script, because Playwright drives the
 *      browser out-of-band (CDP), not through `window.parent` the way a
 *      same-origin check would have to.
 *
 * Navigated to directly, `/c/mau-hop-le/c2` — no login. That is not
 * incidental to what this file tests: reading is public since Task 12 (spec
 * §2.4), and a security gate that only ran for a signed-in reader would be
 * gating the wrong door. `mau-hop-le`/`c1`/`c2`/`dem-so` are pinned ids
 * shared across this phase's tasks (course-format's shared fixture corpus,
 * ruling D5 — see docs/superpowers/specs/2026-08-25-server-side-pivot.md),
 * seeded onto the real server by `scripts/test-e2e.sh` before this suite
 * ever runs; nothing in this file builds or uploads a package itself.
 */

test.describe('Widget sandbox gate — spec §8', () => {
  test('widget bị nhốt: origin mờ, không cookie, không allow-same-origin', async ({ page }) => {
    // KHÔNG đăng nhập — không có bước register/login nào ở đây, có chủ ý.
    const response = await page.goto('/c/mau-hop-le/c2');
    expect(response?.status(), 'GET /c/mau-hop-le/c2 (public deep link)').toBe(200);
    // Đọc chương công khai không bị bật về /login — đúng lời hứa của spec §2.4,
    // và là điều đáng khẳng định riêng chứ không chỉ ngầm định từ việc trang
    // vẽ ra được.
    await expect(page).toHaveURL(/\/c\/mau-hop-le\/c2$/);

    const iframe = page.locator('iframe.widget-frame');
    await expect(iframe, 'widget "dem-so" không mount ở đúng data-widget="dem-so" của chương c2').toBeVisible();

    // (1) So BẰNG, không `toContain` — xem chú thích đầu tệp.
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');

    // (2) Widget chạy THẬT: bấm nút #b của widget mẫu dem-so, số phải tăng.
    const frame = page.frameLocator('iframe.widget-frame');
    const counter = frame.locator('#b');
    await expect(counter).toHaveText('0');
    await counter.click();
    await expect(counter).toHaveText('1');

    // (3) Origin mờ, đo TỪ BÊN TRONG khung: window.origin === 'null'. Đây là
    // chính tài sản bản thiết kế này dựa vào — không phải suy luận từ thuộc
    // tính `sandbox`, mà đọc thẳng những gì trình duyệt thật quyết định bên
    // trong khung cô lập.
    //
    // `document.cookie` — đo được, nhưng KHÔNG phải bằng cách đọc nó ra một
    // chuỗi rồi so `''`. Chạy thật lộ ra một điều bản kế hoạch giả định sai:
    // trên một origin mờ (`sandbox="allow-scripts"`, không `allow-same-origin`),
    // getter của `document.cookie` NÉM `SecurityError` — "document sandboxed và
    // thiếu cờ allow-same-origin" — nó không lặng lẽ trả về chuỗi rỗng. Đây là
    // hành vi đúng của Chromium cho một origin mờ (không có gì để gắn cookie
    // vào), và nó là một bằng chứng CHẶT hơn chuỗi rỗng: không phải "không có
    // cookie nào ở đây", mà là "không có cách nào hỏi câu đó ở đây". Bài này đo
    // đúng cái ném ấy thay vì giả định một chuỗi rỗng không bao giờ xảy ra thật.
    //
    // Bắt ĐÚNG loại ngoại lệ, không phải "có gì đó đã ném": try/catch quanh MỘT
    // câu lệnh vẫn có thể bắt nhầm một lỗi khác (một thay đổi API tương lai, một
    // lỗi runtime không liên quan) và vẫn coi là "đúng, origin mờ đã chặn" — nên
    // ở TRONG khung, trước khi giá trị rời biên sang Playwright, kiểm luôn
    // `e instanceof DOMException` và `e.name`, và so sánh CHẶT với `'SecurityError'`
    // — đúng tên đo được từ Chromium thật (xem chú thích trên), không phải một
    // hằng số đoán trước.
    const inside = await frame.locator('body').evaluate(() => {
      let cookieValue: string | null = null;
      let cookieError: { isDOMException: boolean; name: string } | null = null;
      try {
        cookieValue = document.cookie;
      } catch (e) {
        cookieError = { isDOMException: e instanceof DOMException, name: e instanceof DOMException ? e.name : '(not a DOMException)' };
      }
      return { origin: window.origin, cookieValue, cookieError };
    });
    expect(inside.origin, 'window.origin bên trong khung phải là chuỗi mờ "null"').toBe('null');
    expect(
      inside.cookieValue,
      `document.cookie đọc được một chuỗi (${JSON.stringify(inside.cookieValue)}) thay vì ném lỗi — origin mờ phải làm getter đó ném, không trả về rỗng lặng lẽ`,
    ).toBeNull();
    expect(inside.cookieError, 'document.cookie không ném gì cả').not.toBeNull();
    expect(
      inside.cookieError,
      `document.cookie ném, nhưng không phải DOMException("SecurityError") — có thể là một lỗi khác không liên quan tới origin mờ: ${JSON.stringify(inside.cookieError)}`,
    ).toEqual({ isDOMException: true, name: 'SecurityError' });
  });
});

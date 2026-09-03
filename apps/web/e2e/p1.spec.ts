import { expect, test, type Page } from '@playwright/test';
import {
  COURSE_TITLE,
  PASSWORD,
  REAL_COURSE_ID,
  courseHomeChapterLink,
  freshEmail,
  isBenignAuthCheck401,
  loginExistingUser,
  registerNewUser,
} from './helpers';

/** Chương của `mau-hop-le` có cả công thức KaTeX VÀ widget — xem chú thích ở đầu describe block bên dưới. */
const CHAPTER_ID = 'c2';
/** `data-widget` mà chương c2 tham chiếu — bộ đếm mẫu widget.spec.ts cũng lái. */
const CHAPTER_WIDGET = 'dem-so';

/** Nơi API THẬT lắng nghe — cùng phép tính với `playwright.config.ts`. (`s3`/`s4.spec.ts` từng có bản riêng của phép tính này nữa; cả hai đã bị xoá ở Task 16 của server-side pivot. Bản `s2.spec.ts` GỐC — Pha 1, kho khoá — cũng có một bản riêng, xoá cùng tệp ở Task 16 của Pha 2; bản `s2.spec.ts` HIỆN TẠI, viết lại quanh credit ở Task 18, có bản riêng CỦA CHÍNH NÓ — xem tệp đó — nên phép tính này hiện sống ở BA nơi, không phải một.) */
const API_ORIGIN = (
  process.env.VITE_API_URL ?? `http://localhost:${process.env.TUHOC_E2E_API_PORT ?? '8089'}`
).replace(/\/+$/, '');

/**
 * Task 17 (original) / Task 16 of the server-side pivot (this revision) —
 * the P1 end-to-end gate. This is the only test in this file that ever
 * exercises the real stack together: real Postgres (via
 * apps/api/compose.e2e.yml, brought up by scripts/test-e2e.sh before this
 * suite runs), the real Go API, the real PRODUCTION web bundle (`vite build`
 * + `vite preview` — see playwright.config.ts), the real course-kit runtime
 * (KaTeX), and two genuinely separate browser profiles standing in for two
 * devices. Every other test in this codebase mocks at least one of those
 * boundaries; this one is the proof that the seams actually line up.
 *
 * The phase's definition of done, verbatim from the original task brief, is
 * what this test is FOR — not "does `make test-e2e` exit 0":
 *
 *   A learner signs in, reads a chapter with its mathematics and
 *   interactive visualizations intact, marks it read on one device, and
 *   sees that progress on a second device. The reading experience is not
 *   worse than the original single-file textbook.
 *
 * "Interactive visualizations" now reads as "widgets" — format v2 (this
 * phase) retired the course-wide `viz.js`/`data-viz` mechanism (Task 11
 * removed `initViz`/`REDRAWS` from `ChapterView.tsx` entirely) in favor of
 * one-file widgets sandboxed in `<iframe sandbox="allow-scripts">`. The
 * definition of done did not change; what satisfies "interactive" did.
 *
 * Chapter/selector choice. The original test named one chapter of the
 * private textbook, and the `[data-viz]` simulation inside it, as the
 * contractual selectors earlier tasks were told to preserve. Task 13 moved
 * the ngữ liệu to the public sample package `so-dau-phay-dong`
 * (`p2-2`/`sum-drift`) — but that package is format v1 (`tier: interactive`)
 * and can no longer be PUBLISHED at all under v2's rules (`TIER_REMOVED`),
 * so it stopped being reachable through the real server this test now reads
 * from (`GET /courses/so-dau-phay-dong` 404s — confirmed by actually running
 * this suite before this revision, see task-16-report.md). This revision
 * picks `mau-hop-le`'s chapter `c2` ("Bộ đếm phản ứng với một sự kiện") by
 * the SAME criterion, restated for v2: it is the chapter that has BOTH a
 * widget (`data-widget="dem-so"`, the exact counter `widget.spec.ts` also
 * drives) and substantial KaTeX math ($n$ appears throughout), and it is a
 * REAL package — the shared TS/Go fixture corpus's own zero-finding case
 * (ruling D5) — seeded onto the real server by `scripts/test-e2e.sh`, not a
 * fixture built to make this test pass.
 */

test.describe('P1 definition-of-done gate', () => {
  /**
   * I2 — this suite used to run against `bun run dev`, so the entire
   * production path (`tsc -b && vite build`, the `courseAssets` plugin's
   * `closeBundle` copy of /course-kit and /courses into `dist/`, the SPA
   * fallback for deep links) had no automated coverage anywhere in the
   * repo. Pointing `webServer` at `build && preview` fixes that; this test
   * is what stops it silently reverting, because "we are testing the built
   * artifact" is otherwise a claim in a config comment rather than a fact
   * anything checks.
   *
   * Cheap on purpose — four requests, no browser interaction — so the DoD
   * gate stays fast.
   */
  test('the gate is serving the built artifact, and the course assets resolve from it', async ({ page, request }) => {
    // A built index.html references hashed bundles under /assets/; a dev
    // server's references its unbundled entry module. This is the
    // discriminator, and it fails loudly the moment someone puts `dev`
    // back in playwright.config.ts.
    const indexHtml = await (await request.get('/')).text();
    expect(indexHtml, 'index.html looks like a dev-server document, not a build — is webServer running `vite dev` again?').not.toContain('/src/main.tsx');
    expect(indexHtml, 'index.html does not reference a hashed /assets/ bundle, so this is not `vite build` output').toMatch(/\/assets\/[^"']+\.js/);

    // The two prefixes the plugin is responsible for. These are classic
    // scripts and data loaded at runtime via <script src>/fetch — they are
    // outside Vite's module graph entirely, so nothing else in the build
    // would notice if they stopped resolving.
    const runtime = await request.get('/course-kit/runtime.js');
    expect(runtime.status(), 'GET /course-kit/runtime.js').toBe(200);
    expect(await runtime.text()).toContain('window.CourseKit');

    // Task 16: this used to check `/courses/${REAL_COURSE_ID}/manifest.json`
    // at the WEB origin — the courseAssets plugin's static copy of whatever
    // `make courses` had unpacked locally. That mechanism is retired for
    // real course content (Task 9-13: the server is the only source, spec
    // §2.4), and `test-e2e` no longer runs `make courses` at all (see the
    // Makefile's own comment on `test-e2e`'s dropped `courses`
    // prerequisite) — a course now exists only because
    // `scripts/test-e2e.sh` published it to the real API. So the check that
    // actually matters is that the BUILT bundle correctly reaches that API:
    // `VITE_API_URL` (playwright.config.ts's `webServer.env`) is baked in at
    // build time, and this asks the API directly, the same way the reader
    // running inside the built page does.
    const manifest = await request.get(`${API_ORIGIN}/courses/${REAL_COURSE_ID}`);
    expect(manifest.status(), `GET ${API_ORIGIN}/courses/${REAL_COURSE_ID}`).toBe(200);
    expect((await manifest.json()).id).toBe(REAL_COURSE_ID);

    // SPA fallback: a deep link must return the app document, not a 404.
    // (`vite preview` does this itself; `public/_redirects` arranges the
    // same on Cloudflare Pages. Same behaviour, different mechanism — this
    // asserts the behaviour, and cannot see a broken `_redirects`.)
    const deepLink = await page.goto(`/c/${REAL_COURSE_ID}/${CHAPTER_ID}`);
    expect(deepLink?.status(), 'deep link must be served the SPA document').toBe(200);
  });

  test('read a chapter, mark it read, see it read on a second device', async ({ browser }) => {
    // Judgment 4 — console/page-error policy, part 1. `pageerror` fires
    // for any uncaught exception in page JS — nothing is excluded there,
    // ever. `console.error` additionally catches the class of failure
    // this app's own code deliberately routes through console.error on a
    // caught-but-still-real failure (e.g. useCourseKit.ts's "failed to
    // load" branch, runtime.js's own `initViz` catch), MINUS the one
    // precisely-scoped, browser-generated, by-design case
    // `isBenignAuthCheck401` names above (status 401 AND path `/me` —
    // not any status, not any path). Both listeners are attached on BOTH
    // devices — a bug that only manifests on the second context (e.g. a
    // state-sharing leak) must not be invisible just because the brief's
    // own sketch only wired this up on device 1.
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    function watch(page: Page, device: 'device1' | 'device2'): void {
      page.on('pageerror', (err) => pageErrors.push(`[${device}] ${err.stack ?? err.message}`));
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        if (isBenignAuthCheck401(msg)) return;
        consoleErrors.push(`[${device}] ${msg.text()}`);
      });
    }

    const email = freshEmail();

    // ---------------------------------------------------------------
    // Device 1: register, open the chapter, verify math + widget are real.
    // ---------------------------------------------------------------
    const deviceA = await browser.newContext();
    const p1 = await deviceA.newPage();
    watch(p1, 'device1');

    await p1.goto('/login');
    await registerNewUser(p1, email, PASSWORD);

    await p1.goto(`/c/${REAL_COURSE_ID}/${CHAPTER_ID}`);
    await expect(p1.locator('.katex').first()).toBeVisible();
    // The chapter's widget, actually running — not just present in the DOM.
    // `widget.spec.ts` is the dedicated gate for the SECURITY boundary this
    // rests on (sandbox equality, opaque origin, no cookie reach); this
    // assertion's job is narrower and different: prove that "interactive
    // parts intact" — the DoD's own words, see this file's header comment —
    // still holds for a signed-in reader on the real built artifact, the
    // same way the KaTeX check above does for the math half.
    const widgetCounter = p1.frameLocator(`iframe.widget-frame[title="${CHAPTER_WIDGET}"]`).locator('#b');
    await expect(widgetCounter).toHaveText('0');
    await widgetCounter.click();
    await expect(widgetCounter).toHaveText('1');

    // `#progwrap` — dải tiến độ đọc — phải Ở LẠI trên màn hình khi chương cuộn.
    // Con số nó báo luôn đúng (`reader/readingProgress.ts` có bài kiểm riêng cho
    // phép tính), nhưng nó nằm trong luồng thường ngay dưới một `#topbar`
    // STICKY, nên nó trôi mất khỏi đỉnh và người đọc chỉ thấy nó ở màn đầu
    // tiên. Chủ dự án báo 03/09/2026: "thanh progress khi đọc 1 trang không
    // chạy theo" — lỗi có sẵn từ trước, không phải hồi quy, và đây là hàng rào
    // giữ cho nó được ghim. Đo ở giữa chương chứ không ở đỉnh: ở đỉnh thì một
    // dải trôi tự do vẫn nằm trong khung nhìn, nên bài kiểm sẽ xanh vô nghĩa.
    await p1.evaluate(() => {
      window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * 0.5);
    });
    await expect(p1.locator('#progwrap')).toBeInViewport();
    await expect
      .poll(() => p1.evaluate(() => document.getElementById('progbar')?.style.width))
      .not.toBe('0%');

    // ---------------------------------------------------------------
    // Judgment 3 — what a "second device" must not share. `browser.
    // newContext()` gives a genuinely separate cookie jar, localStorage,
    // and IndexedDB origin-partition — NOT a second tab/page in the same
    // context, which would share all three via Dexie's `tuhoc` database
    // and the browser's own per-context cookie store. This is verified
    // here, not just assumed from the API.
    //
    // Task 16: the ORIGINAL proof of "no shared session cookie" sent
    // `deviceB` to the COURSE route before ever logging in and expected a
    // bounce to `/login` — that was true before Task 12 (spec §2.4) made
    // `/c/:courseId` public. It no longer bounces anybody, logged in or
    // not, which is the whole point of that route now — so a redirect
    // there would prove the OPPOSITE of a regression. `/progress` is still
    // wrapped in `<RequireAuth>` (routes.tsx: it shows a specific reader's
    // own numbers, not a course's public content) and serves exactly the
    // same purpose the course route used to: a page `deviceB` can only
    // reach by carrying device A's session cookie, which a fresh context
    // never does.
    //
    // The second half is unchanged: signed in with the SAME real account,
    // but before device 1 has marked anything read, `deviceB` must show
    // nothing as done on the (public) course route — proving no shared
    // local IndexedDB/localStorage state. Doing this check before device 1
    // marks the chapter read is what makes it meaningful: after marking,
    // "device 2 shows nothing done" would be genuinely ambiguous between
    // "isolated, correctly" and "sync just hasn't run yet." Checking it
    // here, when there is truly nothing to sync yet, removes that
    // ambiguity.
    // ---------------------------------------------------------------
    const deviceB = await browser.newContext();
    const p2 = await deviceB.newPage();
    watch(p2, 'device2');

    await p2.goto('/progress');
    await expect(p2).toHaveURL(/\/login/);

    await loginExistingUser(p2, email, PASSWORD);
    await p2.goto(`/c/${REAL_COURSE_ID}`);
    await expect(courseHomeChapterLink(p2, COURSE_TITLE, CHAPTER_ID)).not.toHaveClass(/\bdone\b/);

    // ---------------------------------------------------------------
    // Back to device 1: mark the chapter read. Pha 3 rewired `useProgress`
    // straight onto the server (`PUT /progress`, optimistic with rollback —
    // see useProgress.ts's own doc): the click flips `#mark-btn` the instant
    // this returns, but the write to the server is still an async request in
    // flight, `mutate()`-fired-and-forgotten, not awaited by the click
    // itself. `waitForResponse` is registered BEFORE the click for the same
    // reason `helpers.ts`'s `submitAuthForm` registers its listener before
    // `submit()`: the response can land before `click()` even resolves, and
    // a listener attached after the fact can miss it.
    // ---------------------------------------------------------------
    await p1.bringToFront();
    const markReadPut = p1.waitForResponse(
      (r) => new URL(r.url()).pathname === '/progress' && r.request().method() === 'PUT',
    );
    await p1.click('#mark-btn');
    await expect(p1.locator('#mark-btn.on')).toBeVisible();
    await markReadPut;

    // ---------------------------------------------------------------
    // Task 13 of Pha 3 — device 2 sees it on a reload, with no window to
    // wait out at all. This assertion used to poll for up to 45s: the task
    // brief's own sketch used a fixed 16s sleep (already too short for a
    // WORKING sync path — see the git history of this comment for the
    // arithmetic this replaced), and this file's own fix used
    // `expect(locator).toBeVisible({ timeout: 45_000 })` as a true poll
    // instead of a sleep, because two independent 15s timers were in play
    // and neither was synchronized with this test: device 1's own 15s push
    // timer and device 2's own independent 15s pull timer (`sync/engine.ts`'s
    // `SYNC_INTERVAL_MS`, on both sides), worst case close to two full
    // periods plus network and container overhead.
    //
    // Both timers, and the local-first Dexie/outbox layer they belonged to,
    // are deleted — there is nothing left to poll FOR. Device 1's PUT above
    // is already confirmed to have reached the server before this line
    // runs, so device 2's own next `GET /progress` (a plain reload; nothing
    // here is cached client-side across a full navigation) reads the
    // current row on the first try. If this assertion ever needs to wait —
    // a bumped timeout, a retry loop, anything — that is not "sync being
    // slow," because there is no sync left to be slow: it means something
    // is still happening in the background that should not be, and that is
    // a regression this assertion exists to catch, not paper over.
    // ---------------------------------------------------------------
    await p2.bringToFront();
    await p2.reload();
    await expect(courseHomeChapterLink(p2, COURSE_TITLE, CHAPTER_ID)).toHaveClass(/\bdone\b/);

    expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    expect(consoleErrors, `console.error output:\n${consoleErrors.join('\n')}`).toEqual([]);

    await deviceA.close();
    await deviceB.close();
  });
});

/**
 * §5 — MỤC LỤC: NGĂN KÉO Ở MÀN HẸP, CỘT CỐ ĐỊNH Ở MÀN RỘNG
 *
 * Chuyển từ `e2e/s1.spec.ts` (Task 13, spec
 * `2026-08-25-server-side-pivot.md` §1). Tệp ấy bị xoá vì MỌI kịch bản khác
 * trong nó — §2 gói xấu bị từ chối, §3 riêng tư là riêng tư, §4 cập nhật gói
 * có báo cáo thiệt hại — đi qua `/import` và `pages/Library.tsx`, cả hai đã
 * chết cùng luồng nhập gói của người đọc. Kịch bản NÀY thì khác hình dạng:
 * nó không kiểm gì về import hay thư viện, nó kiểm mục lục khoá học ở
 * `/c/:courseId` — một màn hình vẫn còn nguyên, đọc thẳng từ máy chủ.
 *
 * `enterCourse` dưới đây SỬA đúng một chỗ so với bản gốc: trước đây nó vẫn đi
 * qua `/import` để đưa `REAL_COURSE_ID` (course công khai, đã ở sẵn trên máy
 * chủ và đọc được thẳng — xem đầu tệp này) vào máy trước khi mở `/c/…`, dù
 * bước ấy chưa từng cần thiết cho course công khai. Bỏ bước ấy đi là xoá một
 * đường vòng, không phải đổi việc kịch bản này kiểm.
 *
 * ── TÍNH NĂNG THU GỌN ĐÃ BỊ GỠ, VÀ VÌ SAO ────────────────────────────────
 * Mục này TỪNG canh câu "The left navigation sidebar should be collapsible".
 * Tính năng ấy không còn, theo yêu cầu của chính người dùng ("bỏ nút đó ở
 * trang này luôn"), và lý do đọc được từ sản phẩm: thu gọn mục lục tồn tại để
 * lấy thêm bề ngang khi đang học — mà lúc đang học thì `#app.reading` đã gỡ
 * hẳn thanh bên đi rồi. Chỗ duy nhất còn nút là TRANG KHOÁ HỌC, nơi nội dung
 * là một bản tóm tắt ngắn và bề ngang thừa chứ không thiếu. Lập luận đầy đủ ở
 * `src/shell/TopNav.tsx`.
 *
 * Nên hai bài dưới đây đổi việc chứ không biến mất, và việc mới của chúng là
 * canh đúng ba câu còn lại:
 *
 *   · màn rộng: mục lục là một CỘT CỐ ĐỊNH, và KHÔNG có nút nào bật tắt nó —
 *     đây là răng của bản dựng đã duyệt, thứ mà một lần "khôi phục" vô ý sẽ
 *     bẻ gãy trong im lặng;
 *   · ngoài một khoá: `#sidebar` phải VẮNG MẶT, chứ không hiện ra rỗng;
 *   · màn hẹp: `#menu-btn` vẫn là ngăn kéo cũ — ở đó nó là cách DUY NHẤT gọi
 *     mục lục ra, vì `reader.css` đẩy `#sidebar` ra ngoài khung nhìn.
 *
 * Đây vẫn là tầng duy nhất nói được ba câu ấy: luật ẩn/hiện là CSS treo dưới
 * `@media`, mà jsdom không tính media query và không tính bố cục.
 */
test.describe('§5 — mục lục: ngăn kéo ở màn hẹp, cột cố định ở màn rộng', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /**
   * HAI CÁCH ẨN KHÁC NHAU, và phải đo bằng hai phép khác nhau.
   *
   * · `display:none` → Playwright gọi là `hidden`.
   * · Ngăn kéo của màn hẹp ẩn bằng `transform: translateX(-100%)`
   *   (reader.css) → phần tử BỊ ĐẨY RA NGOÀI màn hình nhưng Playwright vẫn
   *   gọi nó là `visible`, vì `toBeHidden()` đo display/visibility/opacity/
   *   kích thước, KHÔNG đo vị trí.
   *
   * Bản đầu của bài kiểm này dùng `toBeHidden()` cho cả hai và đỏ ở ca thứ
   * hai — đúng, và đó là lý do hàm dưới đây tồn tại thay vì một lời khẳng định
   * chung chung.
   */
  async function offScreenLeft(page: Page): Promise<boolean> {
    const box = await page.locator('#sidebar').boundingBox();
    return box === null || box.x + box.width <= 0;
  }

  /**
   * Đứng TRONG khoá công khai `REAL_COURSE_ID` — nơi duy nhất còn thanh bên.
   *
   * Task 16 — KHÔNG đăng ký/đăng nhập nữa, có chủ ý: `/c/:courseId` công khai
   * từ Task 12 (spec §2.4, `routes.tsx` không còn bọc nó trong
   * `<RequireAuth>`), và mục lục khoá học (`Sidebar`/`CourseNav`) không đọc
   * gì từ phiên — nó chỉ vẽ cây chương của manifest. Bản trước của hàm này đi
   * qua `/login` chỉ vì đó là thói quen thừa kế từ trước khi đọc công khai
   * tồn tại (xem chú thích của khối describe này); bỏ bước ấy không đổi việc
   * hai bài dưới đây kiểm, và tự nó là một khẳng định: đọc mục lục không cần
   * tài khoản.
   */
  async function enterCourse(page: Page): Promise<void> {
    await page.goto(`/c/${REAL_COURSE_ID}`);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.locator('#sidebar')).toBeVisible();
  }

  test('màn rộng: mục lục là cột cố định, không có nút bật tắt, và vắng mặt ngoài một khoá', async ({
    page,
  }) => {
    await enterCourse(page);

    // Cột có mặt và ĐỨNG YÊN: không nút nào trên trang thu nó lại.
    await expect(page.locator('#sidebar')).toBeVisible();
    await expect(
      page.locator('#menu-btn'),
      'màn rộng không được có nút bật tắt mục lục — bản dựng đã duyệt không có nút nào ở đó',
    ).toBeHidden();

    // Và sống qua tải lại: một cột cố định thì không có trạng thái để mất.
    await page.reload();
    await expect(page.locator('#sidebar')).toBeVisible();
    await expect(page.locator('#menu-btn')).toBeHidden();

    // NGOÀI một khoá thì không có cột nào cả. Không có chốt này, một bản bỏ sót
    // `#app:not(.in-course)` vẫn xanh.
    await page.goto('/courses');
    await expect(page.locator('#sidebar')).toBeHidden();
  });

  test('màn hẹp: `#menu-btn` xuất hiện và là ngăn kéo cũ', async ({ page }) => {
    await enterCourse(page);
    await page.setViewportSize({ width: 375, height: 800 });

    // Nút CHỈ tồn tại ở đây, và ở đây nó không tuỳ chọn: `reader.css` đẩy
    // `#sidebar` ra ngoài khung nhìn dưới 981px, nên không có nút thì mục lục
    // không có cửa nào để vào.
    await expect(page.locator('#menu-btn')).toBeVisible();

    // Dưới 981px thanh bên là ngăn kéo: nó Ở TRONG tài liệu và Playwright gọi
    // là `visible`, chỉ nằm ngoài khung nhìn. Nên hỏi VỊ TRÍ, không hỏi hiện/ẩn.
    await expect(page.locator('#sidebar')).toBeVisible();
    // `poll`, không phải một phép đo một-lần: `reader.css` đặt
    // `transition: transform .22s ease` trên `#sidebar`, và bài này vừa đổi khổ
    // từ 1440 xuống 375 — tức thanh bên đang TRƯỢT từ vị trí cũ sang -100% ngay
    // lúc câu khẳng định chạy. Bản đầu đo một lần và đỏ với `x` nằm giữa chừng.
    await expect
      .poll(async () => offScreenLeft(page), { message: 'ngăn kéo phải nằm ngoài màn hình khi đóng' })
      .toBe(true);

    await page.locator('#menu-btn').click();
    await expect
      .poll(async () => offScreenLeft(page), { message: 'ngăn kéo phải trượt vào' })
      .toBe(false);

    // Đổi route ĐÓNG ngăn kéo lại — hành vi cũ của `useMobileNav`, và là chỗ
    // hai cơ chế khác nhau rõ nhất. Nếu bản thu gọn lỡ gộp vào đây thì đỏ.
    //
    // BẤM MỘT CHƯƠNG TRONG CHÍNH NGĂN KÉO, không bấm mục điều hướng trên thanh
    // trên — và đây là điều e2e dạy lại tôi chứ không phải một lựa chọn phong
    // cách. Khi ngăn kéo mở, `reader.css` phủ `body.nav-open::after` lên cả
    // trang; mục điều hướng nằm ở thanh trên nên nó nằm DƯỚI lớp phủ ấy và
    // Playwright chờ "visible, enabled and stable" 173 lần rồi hết giờ. Trước
    // vòng thiết kế lại, mục điều hướng nằm TRONG ngăn kéo nên câu hỏi này
    // không tồn tại.
    //
    // Đường của người dùng thật khi ngăn kéo đang mở cũng đúng là đường này:
    // thứ duy nhất bấm được là một chương.
    //
    // ĐO BẰNG `body.nav-open`, KHÔNG bằng vị trí thanh bên: đích là một chương,
    // mà chế độ đọc ẩn hẳn `#sidebar` vì một lý do KHÁC. Đo vị trí ở đó sẽ xanh
    // dù `useMobileNav` ngừng hoạt động hoàn toàn — hai nguyên nhân cho cùng
    // một phép đo. `body.nav-open` là trạng thái chính hook ấy sở hữu.
    await page.locator('#nav a.nav-item').first().click();
    await expect(page).toHaveURL(new RegExp(`/c/${REAL_COURSE_ID}/`));
    await expect(page.locator('body')).not.toHaveClass(/nav-open/);

    // Quay lại trang khoá học, nơi có cột để mà đo: ngăn kéo phải đang ĐÓNG, và
    // thanh bên KHÔNG bị `display:none` — một luật ẩn nào đó rò xuống dưới
    // ngưỡng sẽ làm ngăn kéo không mở được nữa.
    await page.goto(`/c/${REAL_COURSE_ID}`);
    await expect(page.locator('#sidebar')).toBeVisible();
    await expect
      .poll(async () => offScreenLeft(page), { message: 'ngăn kéo phải đang đóng' })
      .toBe(true);
  });
});

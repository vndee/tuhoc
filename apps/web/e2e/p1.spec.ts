import { expect, test, type Page } from '@playwright/test';
import {
  COURSE_TITLE,
  PASSWORD,
  REAL_COURSE_ID,
  courseHomeChapterLink,
  expectVizCanvasDrawn,
  freshEmail,
  isBenignAuthCheck401,
  loginExistingUser,
  registerNewUser,
} from './helpers';

/** Chương dùng ở cả bốn tệp e2e: nó có mô phỏng VÀ có đoạn văn xuôi thuần. */
const CHAPTER_ID = 'p2-2';
/** Mô phỏng của p2-2. Nó dựng HAI `Plot` trong một host — xem expectVizCanvasDrawn. */
const CHAPTER_VIZ = 'sum-drift';

/**
 * Task 17 — the P1 end-to-end gate. This is the only test in this repo
 * that ever exercises the real stack together: real Postgres (via
 * apps/api/compose.e2e.yml, brought up by scripts/test-e2e.sh before this
 * suite runs), the real Go API, the real Vite dev server, the real
 * course-kit runtime (KaTeX + the viz engine), and two genuinely separate
 * browser profiles standing in for two devices. Every other test in this
 * codebase mocks at least one of those boundaries; this one is the proof
 * that the seams actually line up.
 *
 * The phase's definition of done, verbatim from the task brief, is what
 * this test is FOR — not "does `make test-e2e` exit 0":
 *
 *   A learner signs in, reads a chapter with its mathematics and
 *   interactive visualizations intact, marks it read on one device, and
 *   sees that progress on a second device. The reading experience is not
 *   worse than the original single-file textbook.
 *
 * Chapter/selector choice. Task 17 named p2-10 ("Kênh Gaussian và
 * water-filling") and `[data-viz="waterfill"]` of the private textbook as the
 * contractual selectors earlier tasks were told to preserve. Task 13 moved the
 * ngữ liệu to the public sample package `so-dau-phay-dong`, and picked its
 * replacement by the same criterion rather than by convenience: p2-2 ("Cộng
 * một triệu số") is the chapter that has BOTH an interactive simulation and
 * substantial plain-prose paragraphs, which is what makes one chapter serve
 * this file, `p2.spec.ts` and `import.spec.ts` at once. Verified against the
 * packed course before writing this: `chapters/p2-2.html` contains exactly
 * `data-viz="sum-drift"`, and `manifest.json` lists p2-2 under
 * "Phần II · Sai số dồn" — so this test is exercising a real chapter of a real
 * package, not a fixture built to make the test pass.
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

    const manifest = await request.get(`/courses/${REAL_COURSE_ID}/manifest.json`);
    expect(manifest.status(), `GET /courses/${REAL_COURSE_ID}/manifest.json`).toBe(200);
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
    // Device 1: register, open the chapter, verify math + viz are real.
    // ---------------------------------------------------------------
    const deviceA = await browser.newContext();
    const p1 = await deviceA.newPage();
    watch(p1, 'device1');

    await p1.goto('/login');
    await registerNewUser(p1, email, PASSWORD);

    await p1.goto(`/c/${REAL_COURSE_ID}/${CHAPTER_ID}`);
    await expect(p1.locator('.katex').first()).toBeVisible();
    // 0.02 explicitly, not the sweep's general MIN_PAINTED_RATIO floor:
    // `sum-drift` draws axes plus a filled area under the running-error curve
    // on BOTH of its plots, so this gate can afford to be far stricter than a
    // threshold that has to hold for every viz in the package. Measured in the
    // task-13 sweep before being pinned here — see the report.
    await expectVizCanvasDrawn(p1, CHAPTER_VIZ, 0.02);

    // ---------------------------------------------------------------
    // Judgment 3 — what a "second device" must not share. `browser.
    // newContext()` gives a genuinely separate cookie jar, localStorage,
    // and IndexedDB origin-partition — NOT a second tab/page in the same
    // context, which would share all three via Dexie's `tuhoc` database
    // and the browser's own per-context cookie store. This is verified
    // here, not just assumed from the API: `deviceB` visits the course
    // route BEFORE ever logging in and must bounce to /login exactly like
    // a brand-new browser would (proves no shared session cookie), and
    // then — signed in with the SAME real account, but before device 1
    // has marked anything read — must show nothing as done (proves no
    // shared local IndexedDB/localStorage state). Doing this check before
    // device 1 marks the chapter read is what makes it meaningful: after
    // marking, "device 2 shows nothing done" would be genuinely ambiguous
    // between "isolated, correctly" and "sync just hasn't run yet."
    // Checking it here, when there is truly nothing to sync yet, removes
    // that ambiguity.
    // ---------------------------------------------------------------
    const deviceB = await browser.newContext();
    const p2 = await deviceB.newPage();
    watch(p2, 'device2');

    await p2.goto(`/c/${REAL_COURSE_ID}`);
    await expect(p2).toHaveURL(/\/login/);

    await loginExistingUser(p2, email, PASSWORD);
    await p2.goto(`/c/${REAL_COURSE_ID}`);
    await expect(courseHomeChapterLink(p2, COURSE_TITLE, CHAPTER_ID)).not.toHaveClass(/\bdone\b/);

    // ---------------------------------------------------------------
    // Back to device 1: mark the chapter read. `useProgress`'s write is
    // local-first (Ruling F5 — see useProgress.ts), so the UI reflects it
    // immediately; the sync engine's 15s timer is what carries it to the
    // server afterwards.
    // ---------------------------------------------------------------
    await p1.bringToFront();
    await p1.click('#mark-btn');
    await expect(p1.locator('#mark-btn.on')).toBeVisible();

    // ---------------------------------------------------------------
    // Judgment 2 — waiting for sync without flake. The task brief's own
    // sketch uses a fixed 16s sleep. That is exactly the anti-pattern its
    // own instructions warn against: long enough to be safe today, and
    // long enough to hide a regression that made sync noticeably slower
    // without ever failing the test. Two real timers are in play and
    // neither is synchronized with this test: device 1's own 15s push
    // timer (up to ~15s before it even SENDS the mark-read row — it was
    // just started fresh by `useSyncLifecycle` on login, not primed to
    // fire immediately) and device 2's own independent 15s pull timer
    // (same story). Worst case is close to two full periods plus network
    // and container overhead, not one.
    //
    // Instead: `expect(locator).toBeVisible({ timeout })` is a true poll
    // — Playwright re-checks the DOM on its own internal cadence up to
    // the bound, so a working sync path resolves this the moment the
    // condition becomes true (often well under the bound), while a
    // genuinely broken/slower sync path fails loudly once the bound is
    // exceeded, rather than the test having silently waited far longer
    // than necessary either way. `bringToFront()` first: Chromium
    // throttles timers in backgrounded pages, and device 2's page has
    // been sitting unfocused since the isolation check above — bringing
    // it forward before the wait removes that as a confound, so a
    // timeout here means the SYNC path is slow/broken, not that the
    // browser deprioritized an inactive tab's timers.
    // ---------------------------------------------------------------
    await p2.bringToFront();
    await expect(courseHomeChapterLink(p2, COURSE_TITLE, CHAPTER_ID)).toHaveClass(/\bdone\b/, { timeout: 45_000 });

    expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    expect(consoleErrors, `console.error output:\n${consoleErrors.join('\n')}`).toEqual([]);

    await deviceA.close();
    await deviceB.close();
  });
});

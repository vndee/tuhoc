import { expect, test, type ConsoleMessage, type Locator, type Page } from '@playwright/test';

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
 * Chapter/selector choice: p2-10 ("Kênh Gaussian và water-filling") and
 * `[data-viz="waterfill"]` are not arbitrary — they are named directly in
 * the task-17 brief as the contractual selectors earlier tasks were told
 * to preserve. Verified against the actual course package before writing
 * this file: `courses/***REMOVED***/chapters/p2-10.html` contains
 * exactly `data-viz="waterfill"` and `data-viz="shannon-limit"`, and
 * `courses/***REMOVED***/manifest.json` lists p2-10 under
 * "Phần II · Kênh có nhiễu" (chapter id `p2-10`) — so this test is
 * exercising a real chapter, not a fixture built to make the test pass.
 */

const PASSWORD = 'secret123';
/** courses/***REMOVED***/manifest.json's `title` — also the `<nav aria-label>` CourseHome renders it into (see courseHomeChapterLink below). */
const COURSE_TITLE = '***REMOVED***';

/** A unique account per run (down to the millisecond) — this suite runs against a fresh, empty database each time (see compose.e2e.yml's no-volume policy), but uniqueness costs nothing and protects a developer running it twice against a stack they forgot to tear down. */
function freshEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@tuhoc.dev`;
}

/**
 * Fills and submits the register form on `/login`'s "Đăng ký" tab, and
 * waits for the post-register redirect (Login.tsx's `redirectTarget`
 * sends a bare `/login` visit — no `state.from` — to `/`) to actually
 * happen before returning, so callers never race the navigation.
 */
async function registerNewUser(page: Page, email: string, password: string): Promise<void> {
  await page.getByRole('tab', { name: 'Đăng ký' }).click();
  await page.getByLabel('Tên').fill('E2E Learner');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

/** Same idea as `registerNewUser`, for the default "Đăng nhập" tab (no tab click needed — it's the initial tab). */
async function loginExistingUser(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

/**
 * `CourseNav` (apps/web/src/course/CourseNav.tsx) is shared markup: it
 * renders BOTH inside `CourseHome`'s in-page table of contents (`<nav
 * aria-label={manifest.title}>`) AND inside the persistent `<Sidebar>` —
 * by design, per that component's own doc comment. On `/c/:courseId` both
 * are mounted at once, so a bare `page.locator('[data-ch="..."]')` always
 * matches two elements there and Playwright's strict-mode locators
 * correctly refuse to guess which one an assertion means (this was
 * caught by the suite's own first real run — see task report). Scoping to
 * the course-home page's own `<nav>` by its accessible name is what the
 * task brief's "tiến độ hiện trên 'thiết bị 2'" (progress shows on
 * "device 2") is actually pointing at — the page content, not
 * incidentally-also-updated chrome — so that is what this resolves to,
 * rather than reaching for `.first()` and never being sure which copy
 * that picked.
 */
function courseHomeChapterLink(page: Page, courseTitle: string, chapterId: string): Locator {
  return page.getByRole('navigation', { name: courseTitle }).locator(`[data-ch="${chapterId}"]`);
}

/**
 * Judgment 1 — "what does 'the visualization works' mean in a test?"
 *
 * A `<canvas>` existing in the DOM proves almost nothing: `initViz`
 * (packages/course-kit/runtime.js) creates the `<canvas>` element
 * unconditionally as part of `new Plot(...)`, BEFORE the viz function's
 * own `render()` ever runs — a `[data-viz] canvas` selector matching is
 * exactly as true whether or not a single pixel was ever painted onto it.
 *
 * What this asserts instead: that a *meaningful fraction* of the canvas's
 * own pixel buffer is non-transparent. `Plot.resize()` always calls
 * `this.render()` once, on construction, via `requestAnimationFrame`, and
 * `waterfill`'s own `render()` (courses/***REMOVED***/viz.js) always
 * draws axes/gridlines via `Plot.axes()` plus six filled subcarrier bars
 * via `ctx.fillRect` — comfortably covering well over a quarter of the
 * canvas on first paint, with zero user interaction required. So:
 *
 *   - if KaTeX/runtime.js/viz.js failed to load, or `initViz` threw
 *     (caught in runtime.js's own try/catch, which replaces the node's
 *     innerHTML with an error message), the `canvas` locator itself would
 *     never resolve — a DIFFERENT, earlier failure than this check.
 *   - if the canvas exists but `render()` never actually ran (a broken
 *     `ResizeObserver`/`requestAnimationFrame` path, a JS exception
 *     inside `render()` itself that isn't caught anywhere) the canvas
 *     stays exactly as `clearRect` (or the browser's own default) leaves
 *     it: fully transparent, alpha 0 at every pixel. THIS is what the
 *     ratio check below actually catches, and a DOM-presence-only check
 *     would not.
 *   - what this does NOT catch: whether the drawing is *correct* (right
 *     numbers, right colors, right axis labels) — only that the runtime
 *     executed and produced real pixel output. Pixel-perfect correctness
 *     is a job for a visual-regression tool, not a fast e2e gate; reading
 *     `getImageData` here is the cheap, dependency-free middle ground
 *     between "element exists" (proves nothing) and a full screenshot
 *     diff (expensive, brittle across renderers/fonts).
 *
 * `expect.poll` rather than a single read: `render()`'s first call is
 * scheduled via `requestAnimationFrame` inside `Plot`'s constructor, not
 * synchronous with `initViz` returning — a single evaluate() immediately
 * after the canvas becomes visible could legitimately race that one
 * frame. Polling (bounded at 10s, far more than one frame ever needs) is
 * the fix; a longer FIXED wait here would be the same anti-pattern the
 * task brief warns about for the cross-device sync wait below, just on a
 * smaller scale.
 */
async function expectVizCanvasDrawn(page: Page, dataViz: string): Promise<void> {
  const canvas: Locator = page.locator(`[data-viz="${dataViz}"] canvas`);
  await expect(canvas).toBeVisible();

  const readNonBlankRatio = () =>
    canvas.evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const { width, height } = c;
      if (width === 0 || height === 0) return 0;
      const ctx = c.getContext('2d');
      if (!ctx) return 0;
      const { data } = ctx.getImageData(0, 0, width, height);
      let nonBlank = 0;
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 0) nonBlank += 1;
      }
      return nonBlank / (width * height);
    });

  await expect
    .poll(readNonBlankRatio, {
      timeout: 10_000,
      message: `[data-viz="${dataViz}"] canvas never painted a non-transparent pixel — the viz runtime likely failed silently`,
    })
    .toBeGreaterThan(0.02);
}

/**
 * Judgment 4 — console/page-error policy, part 2. Found by actually running
 * this suite, not anticipated up front (see task report for the full
 * story, including fix-round-1): Chromium logs a `console.error`-level
 * "Failed to load resource: the server responded with a status of NNN"
 * line for EVERY non-2xx fetch/XHR response — this is the browser's own
 * network-activity mirror, emitted regardless of whether application code
 * handles that response. It is NOT something the app's own code calls
 * `console.error(...)` for.
 *
 * This app deliberately triggers exactly ONE instance of this, twice, by
 * design, in this test's own normal flow: `GET /me` returning 401 is the
 * documented mechanism `useMe()` (src/api/useMe.ts) uses to mean "nobody
 * is signed in yet" — `App.tsx`'s `useSyncLifecycle` calls `useMe()` on
 * EVERY route including `/login`, so device 1's very first page load
 * fires one, and device 2's pre-login visit in this test's own isolation
 * check (Judgment 3, above) fires the other — the redirect to `/login`
 * that follows IS this test's assertion that the 401 happened, not a
 * symptom of it.
 *
 * fix-round-1 finding: the first draft of this filter matched the
 * message TEXT alone (`status of \d+` — any status, any URL), which is
 * broader than anything actually verified — a real 500 from `/sync` or a
 * broken `/events/batch` produces the identical text and would have been
 * silently dropped too. `ConsoleMessage.location()` was checked directly
 * (a one-off debug run: `console.log(JSON.stringify(msg.location()))`
 * against this exact message) and DOES carry the failing resource's own
 * URL for this browser-generated log class — not the call-site URL a
 * `console.error(...)` from application code would carry —
 * `{"url":"http://localhost:8089/me","line":0,"column":0}` was the actual
 * observed value. `isBenignAuthCheck401` below is scoped to exactly what
 * that run verified: status 401 (not any status) AND path `/me` (not any
 * path). A 500 anywhere, or a 401 anywhere other than `/me`, now fails
 * the suite — as it should; if narrowing this ever turns the suite red,
 * that is real information about a real fault, not a reason to widen the
 * pattern back.
 */
function isBenignAuthCheck401(msg: ConsoleMessage): boolean {
  if (!/^Failed to load resource: the server responded with a status of 401\b/.test(msg.text())) return false;
  try {
    return new URL(msg.location().url).pathname === '/me';
  } catch {
    return false;
  }
}

test.describe('P1 definition-of-done gate', () => {
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

    await p1.goto('/c/***REMOVED***/p2-10');
    await expect(p1.locator('.katex').first()).toBeVisible();
    await expectVizCanvasDrawn(p1, 'waterfill');

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

    await p2.goto('/c/***REMOVED***');
    await expect(p2).toHaveURL(/\/login/);

    await loginExistingUser(p2, email, PASSWORD);
    await p2.goto('/c/***REMOVED***');
    await expect(courseHomeChapterLink(p2, COURSE_TITLE, 'p2-10')).not.toHaveClass(/\bdone\b/);

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
    await expect(courseHomeChapterLink(p2, COURSE_TITLE, 'p2-10')).toHaveClass(/\bdone\b/, { timeout: 45_000 });

    expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    expect(consoleErrors, `console.error output:\n${consoleErrors.join('\n')}`).toEqual([]);

    await deviceA.close();
    await deviceB.close();
  });
});

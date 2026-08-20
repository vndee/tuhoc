import { expect, type ConsoleMessage, type Locator, type Page } from '@playwright/test';

/**
 * Shared fixtures for the two Playwright suites in this directory:
 * `p1.spec.ts` (the fast definition-of-done gate) and `viz.spec.ts` (the
 * slow, exhaustive visualization sweep). Extracted rather than copied:
 * `isBenignAuthCheck401` in particular is a deliberately NARROW filter
 * whose exact scope was established by a one-off debug run (see its own
 * doc comment) — two hand-maintained copies of a rule like that drift, and
 * the drift shows up as a suite that stops failing when it should.
 *
 * Not itself a spec file: Playwright's default `testMatch` only picks up
 * `*.spec.ts`/`*.test.ts`, and vitest excludes `./e2e/**` wholesale (see
 * vite.config.ts), so nothing tries to run this as a test.
 */

export const PASSWORD = 'secret123';
/** courses/***REMOVED***/manifest.json's `title` — also the `<nav aria-label>` CourseHome renders it into (see courseHomeChapterLink below). */
export const COURSE_TITLE = '***REMOVED***';

/** A unique account per run (down to the millisecond) — this suite runs against a fresh, empty database each time (see compose.e2e.yml's no-volume policy), but uniqueness costs nothing and protects a developer running it twice against a stack they forgot to tear down. */
export function freshEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@tuhoc.dev`;
}

/**
 * Fills and submits the register form on `/login`'s "Đăng ký" tab, and
 * waits for the post-register redirect (Login.tsx's `redirectTarget`
 * sends a bare `/login` visit — no `state.from` — to `/`) to actually
 * happen before returning, so callers never race the navigation.
 */
export async function registerNewUser(page: Page, email: string, password: string): Promise<void> {
  await page.getByRole('tab', { name: 'Đăng ký' }).click();
  await page.getByLabel('Tên').fill('E2E Learner');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

/** Same idea as `registerNewUser`, for the default "Đăng nhập" tab (no tab click needed — it's the initial tab). */
export async function loginExistingUser(page: Page, email: string, password: string): Promise<void> {
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
export function courseHomeChapterLink(page: Page, courseTitle: string, chapterId: string): Locator {
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
/**
 * The general "this canvas was painted at all" floor, used by the
 * all-59 sweep. Chosen from measurement, not taste: a one-off diagnostic
 * run read `getImageData` for all 70 canvases the course's 58
 * chapter-referenced visualizations create, and the LOWEST real render was
 * `huffman` at 0.0170 (a sparse tree diagram — thin edges and small labels
 * on a 736x300 canvas), with the next lowest `kle` at 0.0329 and the
 * highest `eval-curves` at 0.594.
 *
 * 0.005 sits ~3.4x below the lowest observed real render and ~1100 px above
 * nothing. It is a floor against the actual failure mode — `clearRect`
 * leaves alpha 0 at EVERY pixel, so a viz whose `render()` never ran scores
 * exactly 0 — not a claim about how much any particular viz ought to draw.
 *
 * Deliberately NOT the 0.02 `p1.spec.ts` uses for `waterfill`: that number
 * is a property of waterfill specifically (six filled bars plus axes, well
 * over a quarter of its canvas), which is why that call site keeps passing
 * it explicitly rather than being relaxed to this floor. Applying one
 * viz's shape as a universal threshold is what made `huffman` — a working
 * visualization — fail the sweep's first run.
 */
export const MIN_PAINTED_RATIO = 0.005;

export async function expectVizCanvasDrawn(page: Page, dataViz: string, minPaintedRatio = MIN_PAINTED_RATIO): Promise<void> {
  const canvases: Locator = page.locator(`[data-viz="${dataViz}"] canvas`);
  await expect(canvases.first()).toBeVisible();

  // EVERY canvas, not the first. 16 of the course's 59 visualizations
  // build two or three `Plot`s in one host (`entropy-lab` and
  // `eval-curves` build three) — found by running the sweep in viz.spec.ts
  // across all of them rather than assumed. Asserting only `.first()`
  // would leave a second, blank plot invisible to this check; passing the
  // multi-match locator straight to `toBeVisible` would instead be a
  // Playwright strict-mode violation, which is how this surfaced.
  const total = await canvases.count();
  for (let i = 0; i < total; i += 1) {
    const canvas = canvases.nth(i);
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
        for (let j = 3; j < data.length; j += 4) {
          if (data[j] !== 0) nonBlank += 1;
        }
        return nonBlank / (width * height);
      });

    await expect
      .poll(readNonBlankRatio, {
        timeout: 10_000,
        message: `[data-viz="${dataViz}"] canvas ${i + 1}/${total} painted less than ${minPaintedRatio * 100}% of its pixels — the viz runtime likely failed silently (a canvas whose render() never ran scores exactly 0)`,
      })
      .toBeGreaterThan(minPaintedRatio);
  }
}

/** The message `runtime.js`'s `initViz` puts in a node when the viz function THREW — the friendly in-page degradation that makes a broken viz invisible unless something looks for it. */
export const VIZ_THREW_TEXT = 'Không dựng được mô phỏng này';
/** The message `initViz` puts in a node whose `data-viz` name is not registered in viz.js at all. */
export const VIZ_UNREGISTERED_TEXT = 'chưa sẵn sàng';

/**
 * "This visualization actually ran" — the assertion the spec's §10 exit
 * gate needs, for ALL 59, not just the canvas-drawing ones.
 *
 * Three things are checked, and the third has two shapes:
 *
 *  1. `initViz` reached the node at all (`data-done="1"`, which it sets
 *     immediately before invoking the viz function).
 *  2. The node does not carry either of `initViz`'s two failure texts.
 *     This is the check that matters most: a viz whose implicit dependency
 *     went missing during the extraction from the v1 shell throws, is
 *     CAUGHT by initViz, and is replaced with a polite Vietnamese message
 *     — no exception escapes, and the page looks fine to a passing glance.
 *  3. It produced real output:
 *       - canvas-based viz (57 of 59) → every canvas painted pixels, via
 *         expectVizCanvasDrawn at the measured MIN_PAINTED_RATIO floor.
 *       - `twenty-q` and `grouping` build no canvas at all: they are DOM
 *         widgets (`distEditor`'s bar divs, sliders, segmented controls).
 *         For those, "it ran" means it built its interactive controls.
 *         This branch is narrower than the canvas one and says so — it is
 *         chosen by what the viz IS, not to make a failing case pass.
 */
export async function expectVizRendered(page: Page, dataViz: string): Promise<void> {
  const node = page.locator(`[data-viz="${dataViz}"]`);
  await expect(node, `[data-viz="${dataViz}"] is not on the page`).toBeVisible();
  await expect(node, `[data-viz="${dataViz}"]: initViz never initialized this node`).toHaveAttribute('data-done', '1');

  const text = (await node.innerText()).trim();
  expect(text, `[data-viz="${dataViz}"]: initViz caught an exception from this viz and replaced it with its fallback message — a genuinely broken visualization, degrading quietly`).not.toContain(VIZ_THREW_TEXT);
  expect(text, `[data-viz="${dataViz}"]: this name is not registered in viz.js`).not.toContain(VIZ_UNREGISTERED_TEXT);

  if ((await node.locator('canvas').count()) > 0) {
    await expectVizCanvasDrawn(page, dataViz);
    return;
  }

  const controls = await node.locator('input, button').count();
  expect(
    controls,
    `[data-viz="${dataViz}"]: no canvas and no interactive controls — it produced nothing`,
  ).toBeGreaterThan(0);
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
export function isBenignAuthCheck401(msg: ConsoleMessage): boolean {
  if (!/^Failed to load resource: the server responded with a status of 401\b/.test(msg.text())) return false;
  try {
    return new URL(msg.location().url).pathname === '/me';
  } catch {
    return false;
  }
}

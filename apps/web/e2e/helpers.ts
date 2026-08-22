import { expect, type ConsoleMessage, type Locator, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
/** fixtures/courses/so-dau-phay-dong/manifest.json's `title` — also the `<nav aria-label>` CourseHome renders it into (see courseHomeChapterLink below). */
export const COURSE_TITLE = 'Số dấu phẩy động';

/** `manifest.id` của gói mẫu — cũng là tên thư mục `make courses` bung ra. */
export const REAL_COURSE_ID = 'so-dau-phay-dong';

/** apps/web/e2e/ → gốc repo là ba tầng lên. Xuất ra vì `s1.spec.ts` cũng đọc `fixtures/courses/` từ đĩa, và hai bản sao của phép tính này thì trôi. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Đường tới tệp `.zip` của gói course dùng làm ngữ liệu cho cả bốn tệp e2e.
 *
 * ## Nó ở TRONG repo, và đó là điểm đổi của task 13
 *
 * Task 11 đưa giáo trình riêng tư ra một kho ngoài cây git (spec §2B.1 — giáo
 * trình riêng trong một repo sắp publish, và xoá ở commit sau không cứu được).
 * Hệ quả là bốn tệp e2e này chỉ chạy được trên máy của tác giả.
 *
 * Task 13 thay ngữ liệu bằng `fixtures/courses/so-dau-phay-dong.zip` — một gói
 * mẫu **công khai**, do repo này soạn, `tuhoc pack` ghi ra, và commit. `p1`,
 * `p2` và `viz` đọc bản đã bung ở `courses/` (`make courses` bung hộ, và
 * `make test-e2e` gọi nó trước); `import.spec.ts` cần chính tệp `.zip`, vì thứ
 * nó kiểm là người dùng chọn tệp ở màn hình Import.
 *
 * Ném — không skip — khi tệp không có. Đó vẫn là hành vi đúng, chỉ khác là bây
 * giờ nó là một trạng thái sửa được trên mọi bản clone. Xem đầu
 * `import.spec.ts`.
 */
export function realCoursePackageZip(): string {
  const zip = resolve(REPO_ROOT, 'fixtures', 'courses', `${REAL_COURSE_ID}.zip`);
  if (!existsSync(zip)) {
    throw new Error(
      [
        `Không tìm thấy gói mẫu: ${zip}`,
        '',
        'Cổng nghiệm thu này chạy trên GÓI THẬT do `tuhoc pack` ghi ra, không phải một',
        'zip dựng trong lúc chạy test — xem đầu import.spec.ts.',
        '',
        'Tệp này ĐƯỢC COMMIT. Nếu nó biến mất, đóng gói lại từ nguồn cạnh nó:',
        `    bun tools/tuhoc-cli/src/index.ts pack fixtures/courses/${REAL_COURSE_ID} \\`,
        `      -o fixtures/courses/${REAL_COURSE_ID}.zip`,
      ].join('\n'),
    );
  }
  return zip;
}

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
 * `sum-drift`'s own `render()` (courses/so-dau-phay-dong/viz.js) always
 * draws axes/gridlines via `Plot.axes()` plus a filled area under the
 * running-error curve via `Plot.area()`, with zero user interaction
 * required. So:
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
 * The general "this canvas was painted at all" floor, used by the sweep over
 * every registered viz.
 *
 * Chosen from measurement, not taste. On the private textbook (task 17) a
 * one-off diagnostic read `getImageData` for all 70 canvases its 58
 * chapter-referenced visualizations created: the LOWEST real render was
 * `huffman` at 0.0170 (a sparse tree diagram — thin edges and small labels on
 * a 736x300 canvas), the next lowest `kle` at 0.0329, the highest
 * `eval-curves` at 0.594.
 *
 * Task 13 swapped the ngữ liệu to the public sample package
 * `so-dau-phay-dong`, whose 8 canvas-drawing viz build 10 canvases. Its own
 * sweep is recorded in the task-13 report; the floor is kept at the SAME
 * number rather than re-derived downward, because the number is not a claim
 * about how much any viz ought to draw — it is a floor against the actual
 * failure mode. `clearRect` leaves alpha 0 at EVERY pixel, so a viz whose
 * `render()` never ran scores exactly 0, and 0.005 is ~1100 px above nothing
 * on a 736x300 canvas.
 *
 * Deliberately NOT the stricter number `p1.spec.ts` passes for its own one
 * viz: that is a property of that viz specifically, which is why the call
 * site keeps passing it explicitly rather than being relaxed to this floor.
 * Applying one viz's shape as a universal threshold is what made `huffman` —
 * a working visualization — fail the sweep's first run.
 */
export const MIN_PAINTED_RATIO = 0.005;

export async function expectVizCanvasDrawn(page: Page, dataViz: string, minPaintedRatio = MIN_PAINTED_RATIO): Promise<void> {
  const canvases: Locator = page.locator(`[data-viz="${dataViz}"] canvas`);
  await expect(canvases.first()).toBeVisible();

  // EVERY canvas, not the first. On the private textbook, 16 of its 59
  // visualizations built two or three `Plot`s in one host; the sample package
  // that replaced it keeps that shape deliberately — `bit-lab` and `sum-drift`
  // each build two — because asserting only `.first()` would leave a second,
  // blank plot invisible to this check, and a package where no host holds two
  // plots stops exercising this loop at all. Passing the multi-match locator
  // straight to `toBeVisible` would instead be a Playwright strict-mode
  // violation, which is how this surfaced.
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
 * gate needs, for EVERY registered viz, not just the canvas-drawing ones.
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
 *       - canvas-based viz (8 of the sample package's 9) → every canvas
 *         painted pixels, via expectVizCanvasDrawn at the measured
 *         MIN_PAINTED_RATIO floor.
 *       - `nextafter-walk` builds no canvas at all: it is a DOM widget
 *         (a readout plus a segmented control and two buttons). For it,
 *         "it ran" means it built its interactive controls. This branch is
 *         narrower than the canvas one and says so — it is chosen by what
 *         the viz IS, not to make a failing case pass. The private textbook
 *         had two such viz (`twenty-q`, `grouping`) and the sample package
 *         keeps one on purpose, so this branch still has something to run.
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

/* ====================================================================== *
 * The two gestures that reach the annotation surfaces
 *
 * Both lived in `p2.spec.ts` until task 12, which needed the identical
 * gesture from `s1.spec.ts` (its update scenario writes six notes before it
 * measures what an update would cost them). They moved here rather than
 * being copied for the reason at the top of this file: `selectParagraphByDrag`
 * in particular is a pile of hard-won details about layout and hit testing,
 * and two hand-maintained copies of that drift — the drift showing up as a
 * suite that stops failing when it should.
 * ====================================================================== */

/**
 * The rail opens on its "Trong chương" tab; the notes live behind the other
 * one. Idempotent, so a caller does not have to know whether something else
 * already brought it forward (`ChapterView`'s `focusCard` does, whenever a
 * card is opened from the chapter).
 */
export async function openNotesTab(page: Page): Promise<void> {
  const tab = page.locator('#rail-tab-notes');
  await expect(tab, 'the rail has no notes tab — is #rail hidden at this viewport width?').toBeVisible();
  if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

/**
 * Selects the first `chars` characters of the paragraph whose text starts
 * with `startsWith`, with a REAL mouse drag, and returns what the browser
 * ended up selecting.
 *
 * A drag rather than a programmatic `Selection`, because "select some words
 * and a toolbar appears" is the gesture the annotation phase is built on, and
 * it is the layer that a component test with jsdom (no layout engine, no hit
 * testing) is structurally unable to reach.
 *
 * Drags are also the single easiest thing in an e2e suite to get wrong in a
 * way that still passes or that fails for the wrong reason. Three specific
 * traps, all of which bit while `p2.spec.ts` was being written, and each of
 * which is closed here rather than left to luck:
 *
 *  1. **Smooth scrolling.** `packages/course-kit/reader.css` sets
 *     `html{scroll-behavior:smooth}`, so a plain `scrollIntoView()` is still
 *     ANIMATING when the rect is read and when the mouse moves. The measured
 *     result was an empty selection. `behavior: 'instant'` is required, not
 *     stylistic.
 *  2. **Collapsed `<details>`.** Eleven paragraphs of the chapter p2 drives
 *     are inside `<details class="deriv">` blocks that are closed by default,
 *     and one of those still returned a rect — 437px BELOW the viewport, where
 *     the drag became a click-and-drag off the bottom edge that selected the
 *     rest of the chapter. Refused up front.
 *  3. **A rect that is not where the mouse will land.** The sticky topbar,
 *     an unfinished scroll, a floating toolbar left over from a previous
 *     selection — any of them puts a different element under the two
 *     endpoints. `document.elementFromPoint` is asked about both, before the
 *     mouse moves, and both must land inside the intended paragraph.
 *
 * The return value is what `getSelection()` actually holds afterwards, not
 * what was asked for — callers assert against THAT, so an off-by-one at
 * either end of the drag can never make an assertion vacuous. `s1.spec.ts`
 * leans on that property harder than `p2.spec.ts` does: it builds the NEXT
 * version of the chapter by doing string surgery on exactly the text this
 * returned, so an edit it intends to land inside a reader's quote cannot miss.
 */
export async function selectParagraphByDrag(page: Page, startsWith: string, chars: number): Promise<string> {
  const prep = await page.evaluate(
    ({ startsWith: prefix, chars: n }: { startsWith: string; chars: number }) => {
      const root = document.querySelector('.fade-in') as HTMLElement | null;
      if (!root) return { ok: false as const, why: 'no chapter container on the page' };
      const paragraphs = Array.from(root.querySelectorAll('p'));
      const index = paragraphs.findIndex((p) => (p.textContent ?? '').startsWith(prefix));
      if (index < 0) return { ok: false as const, why: `no paragraph starts with "${prefix}"` };
      const target = paragraphs[index];
      if (target.closest('details:not([open])')) {
        return { ok: false as const, why: `"${prefix}" is inside a collapsed <details> — its rect is not where it is drawn` };
      }
      target.scrollIntoView({ block: 'center', behavior: 'instant' });
      const node = document.createTreeWalker(target, NodeFilter.SHOW_TEXT).nextNode() as Text | null;
      if (!node) return { ok: false as const, why: `"${prefix}" has no text node to drag across` };
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(n, node.data.length));
      // The FIRST client rect: one per line the range wraps onto, and a drag
      // has to stay on one line to mean anything.
      const rect = range.getClientRects()[0];
      if (!rect) return { ok: false as const, why: `"${prefix}" is not drawn anywhere` };
      return {
        ok: true as const,
        index,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        viewportHeight: window.innerHeight,
      };
    },
    { startsWith, chars },
  );
  expect(prep.ok, prep.ok ? '' : prep.why).toBe(true);
  if (!prep.ok) throw new Error(prep.why); // narrowing; `expect` above already failed the test

  const y = prep.y + prep.height / 2;
  const x1 = prep.x + 1;
  const x2 = prep.x + prep.width - 1;
  expect(
    y > 0 && y < prep.viewportHeight,
    `the drag line for "${startsWith}" is at y=${y.toFixed(0)} in a ${prep.viewportHeight}px viewport — it never came into view`,
  ).toBe(true);

  const landed = await page.evaluate(
    ({ index, points }: { index: number; points: readonly [number, number][] }) => {
      const root = document.querySelector('.fade-in') as HTMLElement;
      const target = Array.from(root.querySelectorAll('p'))[index];
      return points.map(([x, yy]) => {
        const hit = document.elementFromPoint(x, yy);
        return hit !== null && (hit === target || target.contains(hit));
      });
    },
    { index: prep.index, points: [[x1, y], [x2, y]] as readonly [number, number][] },
  );
  expect(
    landed,
    `the drag endpoints for "${startsWith}" do not land on that paragraph (start=${landed[0]}, end=${landed[1]}) — something is covering it`,
  ).toEqual([true, true]);

  await page.mouse.move(x1, y);
  await page.mouse.down();
  await page.mouse.move(x2, y, { steps: 12 });
  await page.mouse.up();

  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '');
  expect(selected.trim().length, `the drag over "${startsWith}" selected nothing`).toBeGreaterThan(10);
  expect(
    startsWith.startsWith(selected.trim().slice(0, 20)),
    `the drag over "${startsWith}" selected something else: "${selected.slice(0, 60)}"`,
  ).toBe(true);
  return selected;
}

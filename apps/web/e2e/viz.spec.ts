import { expect, test, type Page } from '@playwright/test';
import { COURSE_TITLE, PASSWORD, expectVizRendered, freshEmail, isBenignAuthCheck401, registerNewUser } from './helpers';

/**
 * I6 — the design spec's §10 risk table names "tách viz khỏi shell v1 sót
 * phụ thuộc ngầm" (extracting the visualizations from the original
 * single-file shell may have missed an implicit dependency) as the phase's
 * top risk, and sets one exit gate against it: "validate 59 viz chạy không
 * lỗi console trong reader mới trước khi coi P1 xong."
 *
 * That gate was never met. `docs/parity-notes.md` drives one visualization
 * in each of three chapters, and `p1.spec.ts` exercises exactly one
 * (`waterfill`). 54 of the 59 had never been executed in the new runtime
 * at all — and `runtime.js`'s `initViz` catches exceptions into a friendly
 * in-page message ("Không dựng được mô phỏng này trong trình duyệt hiện
 * tại"), so a missing implicit dependency degrades QUIETLY rather than
 * failing loudly. That is precisely the failure mode the gate existed to
 * catch, which is why "nobody reported a broken chart" was never evidence
 * of anything.
 *
 * This file is that gate. It is deliberately SEPARATE from p1.spec.ts:
 *
 *   - a red run here means "a visualization regressed", a red run there
 *     means "sync/auth/the build regressed" — two different investigations,
 *     and collapsing them into one file would make the failure message the
 *     only thing distinguishing them;
 *   - the DoD gate stays fast (seconds). This one walks every chapter of the
 *     course and is minutes. See the run duration recorded in the final fix
 *     report.
 *
 * The coverage assertion is set equality, not a count: the set of names
 * actually exercised must equal the set `defineViz(...)` registers in
 * courses/so-dau-phay-dong/viz.js. A count would let a viz silently
 * drop out of a chapter and be replaced in the tally by a duplicate
 * somewhere else; set equality means a viz that stops being REACHABLE
 * fails this suite just as loudly as one that throws.
 *
 * ## Task 13 — ngữ liệu đổi, hình dạng thì không
 *
 * The private textbook this file was written against left the repo, so from
 * task 13 the sweep runs on the public sample package `so-dau-phay-dong`: 9
 * registered viz across 8 chapters instead of 59 across 44. That is a real
 * reduction in surface and it is stated as such in the task-13 report rather
 * than papered over. What the sample package was BUILT to keep is every shape
 * this file actually reasons about — one viz referenced by no chapter, one
 * viz that builds no canvas at all, two viz that build more than one `Plot` in
 * a single host, and a chapter with no viz — because a package missing any of
 * those turns the corresponding branch below into dead code that still reads
 * as covered.
 */

const COURSE_ID = 'so-dau-phay-dong';
/** Số chương trong manifest của gói. Nó là một khẳng định, không phải một tham số: một chương lặng lẽ rơi ra khỏi manifest phải làm bài này đỏ. */
const CHAPTER_COUNT = 8;
/** Số `defineViz(...)` trong viz.js. `import.spec.ts` giữ cùng con số này, đọc theo đường khác. */
const REGISTERED_VIZ_COUNT = 9;

/**
 * `cover-hero` is registered in viz.js but referenced by no chapter — it
 * belongs to a cover page the reader does not have. It is still one of the
 * registered set, and "it isn't on any page" is not the same claim as "it
 * still works", so it is mounted directly into the live runtime instead of
 * being excused (see `mountThroughRuntime`). This list is spelled out rather
 * than derived so that a SECOND name quietly falling out of the chapters fails
 * the coverage assertion below rather than joining an ever-growing exemption
 * list.
 *
 * The sample package carries such a name **on purpose** (the private textbook
 * had `home-hero`): with none, `mountThroughRuntime` and this whole branch
 * would never run, and nobody would notice until the next package needed them.
 */
const NOT_REFERENCED_BY_ANY_CHAPTER = ['cover-hero'];

interface ChapterRef {
  id: string;
  title: string;
}

/** Every `defineViz('name', ...)` registration in the course's viz.js, read from the SERVER (so this measures what the app can actually load, not what is on disk next to it). */
function parseRegisteredVizNames(vizSource: string): string[] {
  return [...vizSource.matchAll(/^defineViz\('([^']+)'/gm)].map((m) => m[1]);
}

/**
 * Mounts one viz through the page's own live `CourseKit.initViz` — the
 * same entry point `ChapterView` uses — for a name no chapter references.
 * This is not a shortcut around the reader: `runtime.js` and the course's
 * `viz.js` are already loaded in this page by the reader itself, so the
 * viz runs against exactly the globals, CSS custom properties and canvas
 * setup a chapter's own viz gets.
 *
 * `initViz` is handed `document.body` rather than the new node: it selects
 * `[data-viz]` DESCENDANTS of what it is given, so passing the node itself
 * would match nothing. Re-scanning the body is harmless — every viz the
 * chapter already initialized carries `dataset.done` and is skipped.
 */
async function mountThroughRuntime(page: Page, name: string): Promise<void> {
  await page.evaluate((vizName) => {
    const kit = (window as unknown as { CourseKit?: { initViz: (root: Element) => void } }).CourseKit;
    if (!kit) throw new Error('window.CourseKit is not loaded on this page');
    const host = document.createElement('div');
    host.setAttribute('data-viz', vizName);
    document.body.appendChild(host);
    kit.initViz(document.body);
  }, name);
}

test.describe('every visualization runs in the new reader (spec §10 exit gate)', () => {
  // A full page load of the reader plus KaTeX plus the viz bundle per chapter,
  // plus a pixel read per canvas. The per-test default (90s,
  // playwright.config.ts) is for the DoD gate's shape of work, not this one's.
  // Kept at 15 minutes after task 13 shrank the walk from 44 chapters to 8:
  // this is a RUN budget, not a claim about speed, and the run now finishes far
  // inside it.
  test.setTimeout(15 * 60 * 1000);

  test('every registered viz renders in the reader and produces no console errors', async ({ page, request }) => {
    const startedAt = Date.now();

    // --- what the course claims to contain -------------------------------
    const manifestResp = await request.get(`/courses/${COURSE_ID}/manifest.json`);
    expect(manifestResp.status(), `GET /courses/${COURSE_ID}/manifest.json`).toBe(200);
    const manifest = (await manifestResp.json()) as { title: string; parts: { chapters: ChapterRef[] }[] };
    expect(manifest.title).toBe(COURSE_TITLE);
    const chapters = manifest.parts.flatMap((part) => part.chapters);
    expect(chapters.length, 'the manifest should list every chapter of the course').toBe(CHAPTER_COUNT);

    const vizResp = await request.get(`/courses/${COURSE_ID}/viz.js`);
    expect(vizResp.status(), `GET /courses/${COURSE_ID}/viz.js`).toBe(200);
    const registered = parseRegisteredVizNames(await vizResp.text());
    expect(
      registered.length,
      `viz.js should register ${REGISTERED_VIZ_COUNT} visualizations — import.spec.ts pins the same number off the imported package, so the two disagreeing means one of them is reading a stale build`,
    ).toBe(REGISTERED_VIZ_COUNT);

    // --- failure collection ----------------------------------------------
    // Attributed to a chapter, because "a console error happened somewhere
    // in 44 page loads" is not an actionable failure message.
    let currentChapter = '(before the first chapter)';
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('pageerror', (err) => pageErrors.push(`[${currentChapter}] ${err.stack ?? err.message}`));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      if (isBenignAuthCheck401(msg)) return;
      consoleErrors.push(`[${currentChapter}] ${msg.text()}`);
    });

    // --- a real signed-in reader -----------------------------------------
    // Chapter routes are behind <RequireAuth>; this suite reads the course
    // exactly the way a learner does, not through some bypass.
    await page.goto('/login');
    await registerNewUser(page, freshEmail(), PASSWORD);

    // --- walk every chapter ----------------------------------------------
    const exercised = new Set<string>();
    const chaptersWithoutViz: string[] = [];

    for (const chapter of chapters) {
      currentChapter = chapter.id;
      await page.goto(`/c/${COURSE_ID}/${chapter.id}`);

      // The chapter's own content really rendered — otherwise "this
      // chapter had no [data-viz] elements" below would pass for a
      // chapter that simply failed to load.
      await expect(page.locator('h1.ch-title'), `${chapter.id}: chapter body did not render`).toBeVisible();

      const names = await page.locator('[data-viz]').evaluateAll((nodes) =>
        nodes.map((n) => (n as HTMLElement).dataset.viz ?? ''),
      );
      if (names.length === 0) {
        chaptersWithoutViz.push(chapter.id);
        continue;
      }

      for (const name of names) {
        expect(name, `${chapter.id}: a [data-viz] element with no name`).not.toBe('');
        await expectVizRendered(page, name);
        exercised.add(name);
      }
    }

    // --- the names no chapter references ---------------------------------
    // Run last, on whatever page is currently loaded (a real chapter, with
    // the real runtime already initialized).
    for (const name of NOT_REFERENCED_BY_ANY_CHAPTER) {
      currentChapter = `${name} (mounted through CourseKit.initViz — no chapter references it)`;
      await mountThroughRuntime(page, name);
      await expectVizRendered(page, name);
      exercised.add(name);
    }

    // --- coverage: exactly the registered set, no more, no less ----------
    const missing = registered.filter((name) => !exercised.has(name)).sort();
    expect(
      missing,
      `these registered visualizations were never executed — either a chapter stopped referencing them, or ${NOT_REFERENCED_BY_ANY_CHAPTER.length > 0 ? `they joined \`${NOT_REFERENCED_BY_ANY_CHAPTER.join('`, `')}\` in being unreachable` : 'they became unreachable'}. Either way this suite no longer covers them:`,
    ).toEqual([]);

    const unregistered = [...exercised].filter((name) => !registered.includes(name)).sort();
    expect(
      unregistered,
      'these [data-viz] names appear in a chapter but are not registered in viz.js, so they render the runtime\'s "chưa sẵn sàng" placeholder:',
    ).toEqual([]);

    // --- no console noise anywhere ---------------------------------------
    expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    expect(consoleErrors, `console.error output:\n${consoleErrors.join('\n')}`).toEqual([]);

    console.log(
      `[viz sweep] ${exercised.size} visualizations across ${chapters.length} chapters in ${((Date.now() - startedAt) / 1000).toFixed(1)}s` +
        (chaptersWithoutViz.length > 0 ? ` (chapters with no visualization: ${chaptersWithoutViz.join(', ')})` : ''),
    );
  });
});

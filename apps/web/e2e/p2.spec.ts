import { expect, test, type BrowserContext, type ConsoleMessage, type Page } from '@playwright/test';
import {
  PASSWORD,
  freshEmail,
  isBenignAuthCheck401,
  loginExistingUser,
  openNotesTab,
  registerNewUser,
  selectParagraphByDrag,
} from './helpers';

/**
 * P2 — the annotation phase's own end-to-end gate, rewritten for Pha 3
 * (Task 13, `.superpowers/sdd/2026-09-01-pha3-du-lieu-len-may-chu/
 * task-13-brief.md`).
 *
 * ---------------------------------------------------------------------
 * Why this was quarantined, and why it no longer needs to be
 * ---------------------------------------------------------------------
 * Removed from `playwright.config.ts`'s `testIgnore` by this task — see
 * that file's own history of the entry. The reason it was ever there:
 * this file's old `COURSE_ID` was `so-dau-phay-dong`, a course
 * `scripts/test-e2e.sh` never seeds (it only ever publishes `mau-hop-le`,
 * chapters `c1`/`c2`) — so every scenario 404d before it ever reached the
 * annotation behaviour it meant to test. That was a missing fixture, not
 * a real failure of the annotation feature, and Pha 2's final whole-branch
 * review quarantined the file rather than leave a permanently-red spec in
 * the gate. `COURSE_ID`/`CHAPTER_ID` below now name what the seed step
 * actually publishes.
 *
 * ---------------------------------------------------------------------
 * Why this is a rewrite, not just a retarget
 * ---------------------------------------------------------------------
 * Pha 3 deleted the entire local-first data layer this file's old four
 * scenarios were built to prove wrong or right: Dexie, the outbox,
 * `sync/engine.ts`'s two independent 15s push/pull timers, all of it (see
 * `useAnnotations.ts`'s own header comment). `useAnnotations` now reads and
 * writes `GET/POST/PATCH/DELETE /annotations` straight through TanStack
 * Query, optimistically, with a rollback and a visible `role="alert"` on
 * failure — the same shape Task 6 of this phase established for progress
 * in `useProgress.ts`. The old "two devices, eventually consistent, poll
 * up to 60s for a sync tick to land" story has nothing left to poll FOR:
 * the server is the only source of truth, and a second device sees a
 * write on its own next read. §1 below says that in two lines each way.
 * §2 is this phase's actual new promise to a reader — a write that fails
 * is SAID, not swallowed — which the old file, written when annotations
 * were local-first and (short of a full outage) did not fail, had no
 * reason to test at all.
 *
 * What this revision does NOT re-test, and why that is a reported gap
 * rather than a silent one: the old file's §3 (a note orphaned when the
 * chapter's text changes underneath it) and §4 (rescuing an orphan back,
 * including the formula-selection refusal) are not local-first/sync
 * concerns in the first place — `useAnnotations.ts`'s own doc ("orphans
 * are data") says that logic is untouched by this phase's server-side
 * pivot — but this task's own brief scopes `p2.spec.ts` to exactly the two
 * rewritten cross-device lines below plus one new failure-path scenario
 * (its own accounting: "7 bài: p1×4, p2×1, s2×1, widget×1"). Orphan/rescue
 * logic keeps its extensive unit coverage (`OrphanPanel.test.tsx`,
 * `useAnnotations.test.tsx`) but has no e2e gate after this revision.
 */

const COURSE_ID = 'mau-hop-le';
/**
 * `c1`, not `c2`: `c2` carries the `dem-so` counter widget `widget.spec.ts`
 * already drives end to end, and mixing that concern into this file's own
 * gate would make a future widget regression show up here too, for no
 * reason that belongs to annotations.
 *
 * `c1` has enough non-collapsed prose for `selectParagraphByDrag` — checked
 * against `fixtures/format-v2/valid-course/chapters/c1.html`, not assumed:
 * of its top-level `<p>` elements, only the last one (inside a
 * `<details class="deriv">` "Lời giải" block, closed by default) is
 * collapsed, and neither `PARA_A` nor `PARA_B` below is that one.
 */
const CHAPTER_ID = 'c1';
const CHAPTER_PATH = `/c/${COURSE_ID}/${CHAPTER_ID}`;

/**
 * Two paragraphs of `c1.html`, picked for the property `p2.spec.ts` has
 * always needed: each is a plain, un-collapsed `<p>` whose OPENING
 * characters carry no inline KaTeX. (`normalize.ts` collapses a rendered
 * formula to a single object-replacement character — a `$…$` inside the
 * dragged span would make the selection read back as something other than
 * this literal prefix, and `selectParagraphByDrag` would refuse it.)
 */
const PARA_A = 'Đếm nghe như việc dễ nhất trên đời';
const PARA_B = 'Đoạn mã sau định đếm số phần tử âm';

test.describe('P2 — annotations against the real server', () => {
  test('một ghi chú viết ở thiết bị A đọc thẳng được từ máy chủ ở thiết bị B, và một lần ghi thất bại thì lùi lại kèm thông báo', async ({
    browser,
  }) => {
    // Same policy as `p1.spec.ts`'s Judgment 4: `pageerror` is never
    // excused; `console.error` is excused for exactly the browser's own
    // benign `/me` 401 mirror (`isBenignAuthCheck401`). §2 below
    // deliberately breaks the network for ONE request and produces the
    // app's own `console.error` about it on purpose — that trace is the
    // promise this scenario exists to prove, not a bug to hide — so
    // `consoleErrors` is only asserted empty for §1, the quiet half of
    // this test, before the network is ever touched.
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    function watch(page: Page, device: 'device1' | 'device2'): void {
      page.on('pageerror', (err) => pageErrors.push(`[${device}] ${err.stack ?? err.message}`));
      page.on('console', (msg: ConsoleMessage) => {
        if (msg.type() !== 'error') return;
        if (isBenignAuthCheck401(msg)) return;
        consoleErrors.push(`[${device}] ${msg.text()}`);
      });
    }

    const email = freshEmail();

    // Viewport: 1440x900 on both contexts. `packages/course-kit/reader.css`
    // hides `#rail` outright below 1241px, and `#rail` is where the note
    // cards this file reads live (see `openNotesTab`'s own doc in
    // helpers.ts for the fuller reasoning).
    const deviceA: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageA = await deviceA.newPage();
    watch(pageA, 'device1');
    await pageA.goto('/login');
    await registerNewUser(pageA, email, PASSWORD);
    await pageA.goto(CHAPTER_PATH);
    await expect(pageA.locator('.katex').first()).toBeVisible();

    const deviceB: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pageB = await deviceB.newPage();
    watch(pageB, 'device2');
    await pageB.goto('/login');
    await loginExistingUser(pageB, email, PASSWORD);

    /* ================================================================ *
     * §1 — a note written on device A is read straight off the server on
     * device B. No wait, no retry: the old two-device scenario here
     * polled for up to 60s across two independent 15s sync timers (see
     * this file's own header) — both are gone. A `reload`, not a poll: if
     * this ever needs one, something is still syncing in the background
     * that should not be.
     * ================================================================ */
    const quote = await selectParagraphByDrag(pageA, PARA_A, 40);
    const toolbar = pageA.locator('.ann-tb');
    await expect(toolbar, 'the selection toolbar did not appear for a real drag over a real paragraph').toBeVisible();
    await toolbar.getByRole('button', { name: 'Ghi chú', exact: true }).click();

    const editor = pageA.getByLabel('Nội dung ghi chú');
    await expect(editor, '"Ghi chú" painted a highlight but opened no card to write in').toBeVisible();
    await editor.fill('viết ở A');

    // "Xong" closes the card and, via its `onFocusChange(null)` cleanup
    // effect, flushes the draft deterministically (`MarginCards.tsx`'s
    // `flush`). Not Escape: that file only wires Escape to close-and-flush
    // in the NARROW (`!wide`) sheet layout — at 1440x900 the note lives in
    // the wide column, where Escape inside the textarea does nothing at
    // all (no keydown handler there, and `ChapterView.tsx`'s own global
    // Escape handler explicitly ignores keystrokes while a TEXTAREA has
    // focus). The debounced autosave would eventually write this note on
    // its own even with no button press, but asserting through the
    // deterministic "Xong" path is the stronger check, not a weaker one —
    // and `waitForResponse` below is what turns "eventually" into "before
    // device B ever looks."
    const noteSaved = pageA.waitForResponse(
      (r) => /\/annotations\/[^/]+$/.test(new URL(r.url()).pathname) && r.request().method() === 'PATCH',
    );
    await pageA.getByRole('button', { name: 'Xong' }).click();
    await noteSaved;
    await expect(pageA.locator('.ann-card-note')).toHaveText('viết ở A');

    await pageB.goto(CHAPTER_PATH);
    await expect(pageB.locator('.katex').first()).toBeVisible();
    await openNotesTab(pageB);
    await expect(
      pageB.locator('mark.ann.ann-y[data-ann-id]'),
      'the highlight never reached device 2 on a plain reload — it is not being read straight from the server',
    ).toHaveText(quote.trim());
    await expect(pageB.getByText('viết ở A')).toBeVisible();

    // Quiet so far — asserted HERE, before §2 deliberately breaks the
    // network, so a fault is attributed to the half of this test that
    // actually caused it (same reasoning the old file's `expectQuiet`
    // used per-scenario).
    expect(pageErrors, `uncaught page errors (§1):\n${pageErrors.join('\n')}`).toEqual([]);
    expect(consoleErrors, `console.error output (§1):\n${consoleErrors.join('\n')}`).toEqual([]);

    /* ================================================================ *
     * §2 — a write that fails is SAID, not swallowed. This phase's new
     * promise to a reader (Tasks 6/7 of Pha 3 built the rollback and the
     * alert for progress and annotations respectively; this is the first
     * place either is exercised end to end — see `useAnnotations.ts`'s
     * doc on `saveError` and `SelectionToolbar.tsx`'s
     * `SAVE_FAILED`/`role="alert"`, both pre-existing, not invented here).
     * ================================================================ */
    // Only the CREATE `POST /annotations` matches this glob and method:
    // `fetchAnnotations` always appends `?course=...` (a different string
    // to match against `**/annotations`), and `PATCH`/`DELETE` target
    // `/annotations/:id` (a different path) — so this leaves device A's
    // own read path (and §1's already-completed writes) alone and breaks
    // only the one write this scenario is about. The explicit method
    // guard below is redundant with that glob analysis but cheap, and
    // makes the intent readable without re-deriving it.
    //
    // The abort is DELAYED, not immediate. `createFrom` (SelectionToolbar.tsx)
    // paints the highlight optimistically and rolls it back in the SAME
    // async continuation that sends the request; an immediate abort can
    // settle before this test's own assertion gets a turn to observe the
    // paint, which would make "it was rolled back" indistinguishable from
    // "it was never painted at all". The delay is a deliberately generous
    // window to observe the optimistic state before it is taken back — the
    // assertions below still poll, they do not sleep for it.
    await pageA.route('**/annotations', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.abort();
    });

    await selectParagraphByDrag(pageA, PARA_B, 35);
    const toolbarB = pageA.locator('.ann-tb');
    await expect(toolbarB).toBeVisible();
    await toolbarB.getByRole('button', { name: 'Ghi chú', exact: true }).click();

    // Optimistic: the colour is on the page before the (now-doomed)
    // request even answers.
    await expect(
      pageA.locator('mark.ann[data-ann-id^="pending-"]'),
      'the write did not paint optimistically — there is nothing here for a rollback to prove',
    ).toHaveCount(1);

    // Rollback: once the aborted request settles, the optimistic mark is
    // gone — not left on the page for the reader to discover is fake on
    // their next reload.
    await expect(
      pageA.locator('mark.ann[data-ann-id^="pending-"]'),
      'a failed write was not rolled back — the highlight is still on the page',
    ).toHaveCount(0);

    // Said out loud: a visible role="alert" naming the failure, not only a
    // console.error a developer might never see. Scoped to
    // `SelectionToolbar`'s OWN alert (`ann.saveFailed`, `.ann-tb-error`) —
    // the surface `useAnnotations.ts`'s own doc names as `create`'s
    // failure path — rather than a bare `getByRole('alert')`: a create
    // failure ALSO trips `useAnnotations`' single shared `mutation.isError`
    // (the same flag `updateNote`/`remove`/`reattach` share), so
    // `ChapterView.tsx` renders ITS OWN separate `notes.saveFailed` alert
    // at the same moment — two real, independent alerts for one failure,
    // "harmlessly", exactly as that file's own comment documents. A bare
    // role query would therefore match two elements and fail on
    // ambiguity, not on substance.
    const alert = pageA.locator('.ann-tb-error[role="alert"]');
    await expect(alert, 'a failed write must tell the reader, not swallow it').toBeVisible();
    await expect(alert).toContainText('Không lưu được ghi chú');

    // §2's own quiet check is narrower than §1's on purpose: an uncaught
    // exception is still never excused (a broken request must not crash
    // the page), but `consoleErrors` is not asserted empty here — the
    // app's own `console.error('SelectionToolbar: could not store the
    // annotation', ...)` (and very likely Chromium's own network-failure
    // mirror for the aborted request) are the EXPECTED trace of the
    // promise this scenario is proving, not a bug to filter out.
    expect(pageErrors, `uncaught page errors (§2):\n${pageErrors.join('\n')}`).toEqual([]);

    await deviceA.close();
    await deviceB.close();
  });
});

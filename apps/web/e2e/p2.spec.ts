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
 * P2 Task 8 — the annotation phase's end-to-end gate.
 *
 * `p1.spec.ts` next to this file is the reader's gate; this is the notes'.
 * Everything below runs against the same real stack that file describes:
 * real Postgres and the real Go API from `apps/api/compose.e2e.yml` (brought
 * up, ALWAYS with `--build`, by `scripts/test-e2e.sh`), the real PRODUCTION
 * web bundle served by `vite preview`, the real course-kit runtime (KaTeX +
 * the viz engine), and — for the two sync scenarios — two genuinely separate
 * browser contexts standing in for two devices.
 *
 * Seven tasks of P2 are covered by 515 unit tests that mock at least one of
 * those boundaries. That suite is green and deterministic, and it has still
 * missed a real bug on SIX consecutive rounds — every one of them found by
 * opening the thing in a browser. The three promises this phase actually made
 * to a reader cannot be checked anywhere else at all:
 *
 *   1. a note made on one device shows up on the other one;
 *   2. a note made with no network still gets there when the network returns;
 *   3. a note is not lost when the chapter's text changes underneath it, and
 *      it can be put back.
 *
 * ---------------------------------------------------------------------
 * Why these scenarios are ONE serial chain rather than four fresh tests
 * ---------------------------------------------------------------------
 * They are one story, and the interesting states are downstream of each
 * other: the note that goes offline in §2 is stored beside the one that
 * crossed devices in §1, the orphan in §3 is that same note after the chapter
 * was rebuilt, and the rescue in §4 is that orphan being put back. Re-driving
 * a register + login + two chapter loads before each of them would cost four
 * times the sync waiting and would ALSO test something weaker — a browser
 * profile with exactly one note in it, which is not what any of these
 * failures look like. `test.describe.serial` keeps the chain honest: a
 * failure stops the run instead of reporting three more failures that are
 * really the first one's aftermath.
 *
 * ---------------------------------------------------------------------
 * Viewport: 1440x900, set explicitly on both contexts
 * ---------------------------------------------------------------------
 * `packages/course-kit/reader.css` hides `#rail` outright below 1241px
 * (`@media (max-width:1240px){#rail{display:none}}`), and `#rail` is where
 * BOTH of this phase's reading surfaces live — the note cards and the orphan
 * panel (ruling P2-F19 is exactly about what a phone therefore cannot do).
 * Playwright's `devices['Desktop Chrome']` is 1280x720, which clears that
 * line by 39px. Depending on a 39px margin for whether half the feature
 * exists is not a thing to leave implicit, so both contexts below say what
 * they need.
 */

const COURSE_ID = 'so-dau-phay-dong';
const CHAPTER_ID = 'p2-2';
const CHAPTER_PATH = `/c/${COURSE_ID}/${CHAPTER_ID}`;

/**
 * The chapter fragment `course/loader.ts`'s `loadChapter` fetches
 * (`/courses/<courseId>/<file>`). §3 intercepts it to stand in for a content
 * rebuild — see that test for why interception rather than a DOM edit.
 */
const CHAPTER_ASSET = `**/courses/${COURSE_ID}/chapters/${CHAPTER_ID}.html`;

/**
 * The three paragraphs this suite drags across, by their opening words.
 *
 * All three are top-level `<p>` elements of `courses/so-dau-phay-dong/
 * chapters/p2-2.html` — checked against the file, not assumed. Two properties
 * are load-bearing and both were measured before these three were picked.
 *
 * **Top-level.** That chapter has five `<details class="deriv">` blocks whose
 * paragraphs are collapsed by default, and a collapsed `<details>` still hands
 * `Range.getClientRects()` a plausible-looking rect at a scroll offset the
 * element is not actually at. A drag aimed at one of those silently selects a
 * completely different (and enormous) span of the chapter.
 * `selectParagraphByDrag` refuses one on purpose; these three are chosen so it
 * never has to.
 *
 * **Free of `$…$`.** The projection an anchor lives in collapses each KaTeX
 * formula to a single `'￼'`, so a quote made of formula would fail
 * `hasFindableText` and §4's rescue would be refused for the wrong reason.
 * These three are plain prose end to end — which is a real constraint in a
 * package averaging 182 inline formulas per chapter, and the reason p2-2 was
 * chosen over the denser chapters.
 *
 * §3 also does string surgery on the raw HTML looking for `<p>` immediately
 * followed by these openings, so they must be the literal first characters
 * inside an attribute-less `<p>` tag.
 */
const PARA_YELLOW = 'Thứ tự cộng không phải chi tiết cài đặt';
const PARA_GREEN = 'Cận tuyến tính có một cách đọc rất thô nhưng đúng';
const PARA_RESCUE = 'Muốn tổng đúng tới bit cuối, phải giữ lại phần bị mất';

/** What §3's rebuilt chapter puts where the two annotated paragraphs were. */
const REBUILT_MARKER = 'Đoạn này đã được viết lại trong bản chương mới.';

/**
 * The first words of `OrphanPanel.tsx`'s `REATTACH_NO_WORDS`. Deliberately a
 * substring rather than an import: that constant is module-private there, and
 * this file asserting on the reader-visible SENTENCE is the point — a
 * refusal the reader cannot read is not a refusal.
 */
const NO_WORDS_PREFIX = 'Đoạn bạn chọn chỉ gồm công thức';

/** How long a note may take to travel device→server→device. */
const SYNC_TIMEOUT_MS = 60_000;

/**
 * Rationale, because a number this big has to have one. Two independent 15s
 * timers stand between the two devices (`sync/engine.ts`'s `SYNC_INTERVAL_MS`
 * — the sender's push tick and the receiver's pull tick), neither of them
 * synchronized with this test or with each other, so ~30s is the ordinary
 * worst case before network and container overhead. Measured on this machine
 * while writing this suite: 13,6s for the first hop and 28,5s for the reply.
 * 60s is that worst case plus room, and — as in `p1.spec.ts` — it is a POLL
 * bound, not a sleep: a working sync resolves it as soon as the row lands
 * (often in a few seconds), while a broken or genuinely-slower one fails
 * loudly instead of the suite having waited a fixed 60s either way.
 *
 * Deliberately NOT shortened by dispatching a synthetic `online` event to
 * make `startSync`'s listener fire a cycle immediately. That would be using a
 * real product mechanism to hide a broken timer, and the timer is half of
 * what "notes sync across devices" means.
 */

test.describe.serial('P2 definition-of-done gate — annotations', () => {
  let deviceA: BrowserContext;
  let deviceB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  /**
   * Same policy as `p1.spec.ts`'s Judgment 4, and the same filter object, so
   * the two gates cannot drift about what counts as a real failure:
   * `pageerror` is never excused, and `console.error` is excused for exactly
   * one browser-generated case — a 401 on `/me`, which is how `useMe()` asks
   * "is anyone signed in" — and nothing else.
   *
   * Not widened for §2's offline window even though that is the obvious place
   * a `net::ERR_INTERNET_DISCONNECTED` line would appear. Measured instead:
   * across the offline window this suite opens, the app makes ZERO requests
   * (`runCycle` returns early on `navigator.onLine === false`, and `useMe`'s
   * 60s `staleTime` covers the rest), and the run produced exactly the two
   * expected `/me` 401s and nothing else. §2 asserts that zero-request fact
   * directly rather than pre-forgiving a class of message; if a disconnected
   * fetch ever does show up here, that is news, and the suite should say so.
   */
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

  /** Asserted at the end of every scenario, not only at the end of the file, so a fault is attributed to the step that caused it. */
  function expectQuiet(): void {
    expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
    expect(consoleErrors, `console.error output:\n${consoleErrors.join('\n')}`).toEqual([]);
  }

  test.beforeAll(async ({ browser }) => {
    const email = freshEmail();

    deviceA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    pageA = await deviceA.newPage();
    watch(pageA, 'device1');
    await pageA.goto('/login');
    await registerNewUser(pageA, email, PASSWORD);
    await pageA.goto(CHAPTER_PATH);
    await expect(pageA.locator('.katex').first()).toBeVisible();

    // A second BROWSER CONTEXT, not a second tab: a tab would share the
    // cookie jar and — decisively for this suite — the same IndexedDB
    // origin partition, i.e. the same Dexie `tuhoc` database, so every
    // "the note travelled" assertion below would be reading the writer's
    // own local row. `p1.spec.ts` proves the isolation itself (device 2
    // bounces to /login before signing in, and sees nothing done after);
    // this file relies on it rather than repeating it.
    deviceB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    pageB = await deviceB.newPage();
    watch(pageB, 'device2');
    await pageB.goto('/login');
    await loginExistingUser(pageB, email, PASSWORD);
    await pageB.goto(CHAPTER_PATH);
    await expect(pageB.locator('.katex').first()).toBeVisible();
    await openNotesTab(pageB);
  });

  test.afterAll(async () => {
    await deviceA?.close();
    await deviceB?.close();
  });

  /* ================================================================== *
   * §1 — two devices
   * ================================================================== */
  test('a highlight and its note made on one device appear on a second device, and an edit there comes back', async () => {
    // Two sync hops at up to 60s each, plus chapter loads. The 90s default in
    // playwright.config.ts is sized for p1.spec.ts's single hop.
    test.setTimeout(210_000);

    // The counter-check that gives every later assertion its meaning: before
    // device 1 writes anything, device 2 — signed into the SAME account, with
    // the same chapter open — has nothing. Made here, when there is genuinely
    // nothing to sync, for the same reason p1.spec.ts makes its isolation
    // check before marking anything read: afterwards, "device 2 shows
    // nothing" is ambiguous between isolated and not-yet-arrived.
    await expect(pageB.locator('mark.ann')).toHaveCount(0);
    await expect(pageB.locator('#rail-tab-notes')).toHaveText('Ghi chú (0)');

    // ---- device 1: drag, then "Ghi chú" ----------------------------------
    const quote = await selectParagraphByDrag(pageA, PARA_YELLOW, 40);

    const toolbar = pageA.locator('.ann-tb');
    await expect(toolbar, 'the selection toolbar did not appear for a real drag over a real paragraph').toBeVisible();
    await toolbar.getByRole('button', { name: 'Ghi chú', exact: true }).click();

    // "Ghi chú" is the one control that does both halves of this phase's
    // promise at once: it paints the highlight AND opens a card to write in.
    // `NOTE_COLOR` in SelectionToolbar.tsx is 'y', so the mark must be yellow
    // — asserted rather than assumed, because the colour is stored INSIDE the
    // anchor and is what §4 later checks survived a rescue.
    const yellow = pageA.locator('mark.ann.ann-y[data-ann-id]');
    await expect(yellow).toHaveCount(1);
    await expect(yellow).toHaveText(quote.trim());

    const editor = pageA.getByLabel('Nội dung ghi chú');
    await expect(editor, '"Ghi chú" painted a highlight but opened no card to write in').toBeVisible();
    await editor.fill('xem lại');
    await pageA.getByRole('button', { name: 'Xong' }).click();
    await expect(pageA.locator('.ann-card-note')).toHaveText('xem lại');

    // ---- device 2: it arrives ---------------------------------------------
    // `bringToFront` first, as p1.spec.ts does and for its reason: Chromium
    // deprioritizes timers in a backgrounded page, and device 2's pull timer
    // is exactly what this wait is measuring. A timeout here should mean sync
    // is broken, not that the browser throttled an inactive window.
    await pageB.bringToFront();
    await expect(
      pageB.locator('mark.ann.ann-y[data-ann-id]'),
      'the highlight never reached device 2 — the annotation outbox → POST /sync → GET /sync path is broken',
    ).toHaveCount(1, { timeout: SYNC_TIMEOUT_MS });
    // The colour travelled inside `anchor`, and it was PAINTED there, not
    // merely stored: this locator is `mark.ann.ann-y`, an element the painter
    // created in device 2's own DOM from an anchor it resolved itself.
    await expect(pageB.locator('mark.ann.ann-y')).toHaveText(quote.trim());
    await expect(pageB.locator('.ann-card-note'), 'the highlight crossed but the note text did not').toHaveText('xem lại', {
      timeout: 15_000,
    });
    await expect(pageB.locator('#rail-tab-notes')).toHaveText('Ghi chú (1)');

    // ---- device 2 edits, device 1 receives ---------------------------------
    await pageB.locator('.ann-card-open').click();
    await pageB.getByLabel('Nội dung ghi chú').fill('đã hiểu');
    await pageB.getByRole('button', { name: 'Xong' }).click();

    await pageA.bringToFront();
    await openNotesTab(pageA);
    await expect(
      pageA.locator('.ann-card-note'),
      "device 2's edit never came back to device 1 — this is the direction that also proves last-write-wins picked the newer row",
    ).toHaveText('đã hiểu', { timeout: SYNC_TIMEOUT_MS });

    expectQuiet();
  });

  /* ================================================================== *
   * §2 — offline
   * ================================================================== */
  test('a highlight made with no network reaches the other device once the network comes back', async () => {
    test.setTimeout(210_000);

    // Counting the API requests device 1 makes is what turns "it arrived
    // eventually" into "it was genuinely queued while offline". Without it,
    // a run where `setOffline` silently did nothing would look identical to a
    // working outbox.
    const apiCalls: string[] = [];
    const countApiCall = (url: string): void => {
      if (url.includes(`/${COURSE_ID}/`)) return; // static course assets, not the API
      if (/^https?:\/\/localhost:\d+\/(me|sync|events|auth)/.test(url)) apiCalls.push(url);
    };
    pageA.on('request', (req) => countApiCall(req.url()));

    await deviceA.setOffline(true);

    const quote = await selectParagraphByDrag(pageA, PARA_GREEN, 45);
    const toolbar = pageA.locator('.ann-tb');
    await expect(toolbar).toBeVisible();
    // A colour swatch, not "Ghi chú": the offline promise is about the
    // highlight itself surviving, and a note with no text is the smaller,
    // stricter thing to carry. `data-color` is the attribute
    // `SelectionToolbar` puts on each swatch; the accessible name is the
    // reader-facing half of the same button.
    await toolbar.getByRole('button', { name: 'Tô màu xanh lá' }).click();

    // Painted locally, with no network anywhere in the path — this is
    // `SelectionToolbar`'s optimistic paint plus the store taking it over.
    await expect(pageA.locator('mark.ann.ann-g[data-ann-id]')).toHaveCount(1);
    await expect(pageA.locator('mark.ann.ann-g')).toHaveText(quote.trim());

    // Long enough for at least one full 15s sync tick to have come and gone
    // while offline. What is being asserted is a NEGATIVE, so it needs a real
    // window: the tick must have fired and declined to do anything.
    await pageA.waitForTimeout(20_000);
    expect(
      apiCalls,
      `device 1 talked to the API while offline: ${apiCalls.join(', ')} — either setOffline did not take, or the engine's navigator.onLine gate is gone`,
    ).toEqual([]);
    await expect(
      pageB.locator('mark.ann.ann-g'),
      'the offline highlight reached device 2 without a network — this assertion is the control for the one below it',
    ).toHaveCount(0);

    await deviceA.setOffline(false);

    await pageB.bringToFront();
    await expect(
      pageB.locator('mark.ann.ann-g[data-ann-id]'),
      'a highlight created offline never arrived after the network came back — P1\'s outbox is not draining',
    ).toHaveCount(1, { timeout: SYNC_TIMEOUT_MS });
    await expect(pageB.locator('#rail-tab-notes')).toHaveText('Ghi chú (2)');

    expectQuiet();
  });

  /* ================================================================== *
   * §3 — the chapter is rebuilt under both notes
   * ================================================================== */
  test('when the chapter text changes underneath them, the notes are not lost — they are filed as orphans, with every word intact', async () => {
    test.setTimeout(120_000);

    /**
     * Standing in for a content rebuild by intercepting the chapter asset,
     * NOT by editing the live DOM.
     *
     * The brief's sketch is "`page.evaluate` away the paragraph, then
     * reload". The reload is the part that makes that impossible: a reload
     * re-fetches `/courses/.../p2-2.html` from the server and re-runs
     * `innerHTML =`, so a DOM edit made beforehand is gone before any anchor
     * is resolved against it — the test would pass or fail for reasons that
     * have nothing to do with anchoring. Without the reload there is no fresh
     * resolve pass to observe at all.
     *
     * What actually orphans a note in production is the chapter's TEXT being
     * different the next time it loads, which is precisely what serving a
     * rewritten body does. `rewrites` is counted, and the two assertions
     * after the reload check the page really did change, so this cannot
     * quietly become a no-op that "passes".
     */
    let rewrites = 0;
    await pageA.route(CHAPTER_ASSET, async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      for (const opening of [PARA_YELLOW, PARA_GREEN]) {
        const from = body.indexOf(`<p>${opening}`);
        if (from < 0) continue;
        const to = body.indexOf('</p>', from);
        if (to < 0) continue;
        body = `${body.slice(0, from)}<p>${REBUILT_MARKER}</p>${body.slice(to + '</p>'.length)}`;
        rewrites += 1;
      }
      await route.fulfill({ response, body });
    });

    await pageA.bringToFront();
    await pageA.reload();
    await expect(pageA.locator('.katex').first()).toBeVisible();

    expect(rewrites, 'the interception did not rewrite both paragraphs — this test would be asserting nothing').toBe(2);
    // Read as `textContent`, not `innerText`: `innerText` applies
    // `text-transform`, and this chapter uppercases several headings — a
    // probe that answers "absent" for the wrong reason is worse than none
    // (the same trap `OrphanPanel.tsx`'s own doc, section 6, records).
    const rendered = await pageA.evaluate(() => document.querySelector('.fade-in')?.textContent ?? '');
    expect(rendered.split(REBUILT_MARKER).length - 1, 'the rebuilt chapter did not reach the page').toBe(2);
    expect(rendered, 'the first annotated paragraph is still on the page').not.toContain(PARA_YELLOW);
    expect(rendered, 'the second annotated paragraph is still on the page').not.toContain(PARA_GREEN);

    await openNotesTab(pageA);

    // Nothing could be placed, so nothing is painted.
    await expect(pageA.locator('mark.ann')).toHaveCount(0);

    const orphans = pageA.locator('.ann-orphan');
    await expect(
      pageA.locator('.ann-orphans-h'),
      'neither note was filed as an orphan — a note that cannot be placed must still be reachable',
    ).toHaveText('Mồ côi (2)', { timeout: 20_000 });
    await expect(orphans).toHaveCount(2);

    // Every word intact: the edited note and the empty one, each still
    // showing exactly what the reader left there.
    await expect(orphans.filter({ hasText: 'đã hiểu' })).toHaveCount(1);
    await expect(orphans.filter({ hasText: '(chưa có nội dung)' })).toHaveCount(1);

    // The two things a real browser found in Task 7 that 498 unit tests did
    // not, pinned at the top level so they cannot come back:
    //
    //  - the tab is the ONLY door to this panel, and it used to count only
    //    what got painted — so a reader whose notes had all just orphaned was
    //    invited in by a label reading "Ghi chú (0)", which also looks
    //    exactly like the data loss this phase exists to prevent;
    //  - the card column announced "Chưa có ghi chú nào trong chương này"
    //    directly above those same notes.
    await expect(pageA.locator('#rail-tab-notes')).toHaveText('Ghi chú (2)');
    await expect(
      pageA.locator('.ann-cards-empty'),
      'the card column says this chapter has no notes, above two of them',
    ).toHaveCount(0);

    // And the statement that makes "orphan" mean what this phase says it
    // means: the notes are a fact about DEVICE 1's build of the chapter, not
    // about the notes. Device 2, still serving the original text, has both of
    // them placed and painted.
    await expect(pageB.locator('mark.ann')).toHaveCount(2);
    await expect(pageB.locator('.ann-orphans')).toHaveCount(0);

    expectQuiet();
  });

  /* ================================================================== *
   * §4 — putting an orphan back
   * ================================================================== */
  test('an orphan can be re-anchored, keeping its words and its colour — and a rescue onto a formula is refused without costing it its quote', async () => {
    test.setTimeout(120_000);

    const row = pageA.locator('.ann-orphan').filter({ hasText: 'đã hiểu' });
    await expect(row).toHaveCount(1);

    // `exact` is the reader's last clue about where the note belonged, and
    // what "Xem exact gốc" hands back so they can go hunting for it by hand.
    // Read before the rescue starts, and read again after the refusal below.
    await row.getByRole('button', { name: 'Xem exact gốc' }).click();
    const exactField = pageA.getByLabel('Đoạn văn gốc của ghi chú');
    const exactBefore = await exactField.inputValue();
    expect(exactBefore, 'the stored quote is empty — nothing after this point would mean anything').not.toBe('');

    await row.getByRole('button', { name: 'Gắn lại' }).click();
    const bar = pageA.locator('.ann-reattach');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('Bôi chọn đoạn văn mới trong chương.');

    /* ---- the case the plan did not have: rescue onto a FORMULA ---------- *
     *
     * This is the Critical fixed in `5211e40`, at the top level, because it
     * is the one path where the RESCUE destroys the thing it is rescuing.
     * `normalize.ts` stands a whole `.katex` subtree in for a single '￼', so
     * a reader who drags across the equation their note is about — the first
     * thing anyone tries in a course about information theory — would trade
     * their 38 characters of prose for one character that matches all 263
     * other formulas in the chapter equally well. The note would then LEAVE
     * `orphans`, taking "Gắn lại" and "Xem exact gốc" with it, with nothing
     * findable stored, no undo, and one outbox row of that to every other
     * device.
     *
     * The selection is made through the Selection API rather than by dragging
     * because the claim is about a selection that lies ENTIRELY inside one
     * `.katex` subtree, and a mouse drag across a rendered formula cannot be
     * held to that boundary reliably — one pixel of overshoot picks up a
     * neighbouring word, `hasFindableText` correctly says yes, and the test
     * fails for a reason that has nothing to do with the code under it. The
     * browser's own selection is still a real selection: the same
     * `selectionchange` listener, the same `getSelection()`, the same
     * `rangeToFlat`. §1, §2 and the rescue below are the drags.
     */
    const formulaText = await pageA.evaluate(() => {
      const root = document.querySelector('.fade-in') as HTMLElement | null;
      const formula = root?.querySelector('.katex-display .katex') as HTMLElement | null;
      if (!formula) return null;
      formula.scrollIntoView({ block: 'center', behavior: 'instant' });
      const range = document.createRange();
      range.selectNodeContents(formula);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return selection?.toString() ?? '';
    });
    expect(formulaText, 'no display formula in this chapter to select').not.toBeNull();
    expect(formulaText?.length ?? 0, 'the formula selection is empty').toBeGreaterThan(0);

    await expect(bar, 'the reader is not told why their formula selection cannot be used').toContainText(NO_WORDS_PREFIX);
    await expect(
      pageA.locator('.ann-reattach-ok'),
      'the confirm button is offered for a selection the write path will refuse — inviting a press and then saying no',
    ).toHaveCount(0);
    // Reattach mode wins over the new-note toolbar (`suspended`): the reader
    // must not get a colour picker on top of the paragraph they are trying to
    // re-anchor.
    await expect(pageA.locator('.ann-tb')).toHaveCount(0);

    // The whole point: nothing was written. Same quote, still an orphan,
    // still rescuable.
    await expect(exactField).toHaveValue(exactBefore);
    await expect(pageA.locator('.ann-orphans-h')).toHaveText('Mồ côi (2)');

    /* ---- and now a real paragraph -------------------------------------- */
    const rescued = await selectParagraphByDrag(pageA, PARA_RESCUE, 45);
    await expect(bar).toContainText(rescued.trim().slice(0, 30));

    const confirm = pageA.locator('.ann-reattach-ok');
    await expect(confirm).toHaveCount(1);
    await confirm.click();

    await expect(pageA.locator('.ann-orphans-h'), 'the rescued note is still filed as an orphan').toHaveText('Mồ côi (1)', {
      timeout: 15_000,
    });

    // Back on the page, in its own colour, with its own words. `reattach`
    // patches `anchor` + `updatedAt` and nothing else; these three assertions
    // are what "and nothing else" looks like from the reader's side.
    const mark = pageA.locator('mark.ann.ann-y[data-ann-id]');
    await expect(mark, 'the rescued note came back the wrong colour, or did not come back').toHaveCount(1);
    await expect(mark).toHaveText(rescued.trim());
    const card = pageA.locator('article.ann-card');
    await expect(card).toHaveCount(1);
    await expect(card).toHaveClass(/\bann-card-y\b/);
    await expect(card.locator('.ann-card-note'), 'the rescue cost the note its text').toHaveText('đã hiểu');

    expectQuiet();
  });
});

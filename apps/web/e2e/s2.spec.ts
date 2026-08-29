import { expect, test, type ConsoleMessage, type Locator } from '@playwright/test';
import { PASSWORD, REAL_COURSE_ID, freshEmail, isBenignAuthCheck401, registerNewUser } from './helpers';

/**
 * Task 18 — `s2.spec.ts`, REBUILT around CREDIT rather than the Pha-1 key
 * vault this filename used to gate. The old file drove `apps/vault`, a
 * second-origin app the learner plugged their own DeepSeek key into; Pha 2
 * moved AI to the server, paid for in credit, and Task 16 deleted that app
 * along with every test that drove it. NOTHING below is lifted from that
 * file: the old harness built, served and drove a second origin that no
 * longer exists, so every assertion here is new, written directly against
 * the credit architecture spec §3.4/§8 describe. See `docs/testing.md`'s
 * `s2.spec.ts` section for the current, living description of this gate.
 *
 * WHAT THIS PROVES — spec §8's own words: "số dư hiện, trừ đúng, hết chặn,
 * config giữ" (the balance displays, deducts correctly, blocks when empty,
 * personal config survives a reload). It does NOT re-prove `p1.spec.ts`'s
 * reader assertions or `widget.spec.ts`'s sandbox boundary — this file's
 * only job is the AI/credit surface neither of those touches.
 *
 * NO REAL DEEPSEEK CALL, EVER — see `scripts/fake_deepseek.py`'s own header
 * comment for the full reasoning and the exact derivation of
 * `ONE_TURN_MICRO`/`SEED_MICRO` below. Two things worth restating here so a
 * green run is not read as promising more than it does: this proves
 * `apps/api`'s OWN cost math end to end through a real HTTP round trip, NOT
 * that DeepSeek's real API behaves the way `client_test.go`/`stream_test.go`
 * assume (`docs/deepseek-measured.md` is where that gets checked); and the
 * tool loop never runs here (the fake reply never emits `tool_calls`), so
 * Go's own tool-loop coverage is what stands behind that path, not this
 * file.
 *
 * ROUND-1 SELF-REVIEW ("M-1", "M-2") — two mutations survived the first
 * version of this gate, both because a fixture made two DIFFERENT-meaning
 * numbers EQUAL:
 *
 *   - M-1: `ai_pricing`'s COST columns (what DeepSeek bills the platform)
 *     and CREDITS columns (what the platform bills the learner) were seeded
 *     EQUAL for deepseek-v4-pro (migration 0007's own comment: Pha 2 sells
 *     at cost, the real ratio is a Pha 4 decision). A `ChargeTurn` bug that
 *     deducted/recorded the COST instead of the CREDITS was therefore
 *     invisible — same numbers either way. Fixed in
 *     `scripts/test-e2e.sh`'s "seeding ai_pricing's COST columns" step,
 *     which gives the two sets of columns DIFFERENT values; the assertions
 *     below did not need to change, only the fixture that was hiding a real
 *     bug from them.
 *   - M-2: seeding a learner with EXACTLY one turn's cost (the first
 *     version's `SEED_MICRO`) cannot tell correct subtraction apart from a
 *     bug that floors the result at zero instead of letting it go negative
 *     (spec §3.4 explicitly allows the turn that crosses zero to finish and
 *     go negative — `credits.go`'s `ChargeTurn` doc comment: "never refuses
 *     to charge because the result would be negative"). Both produce
 *     `balance_micro === 0` after one turn. Fixed below: `SEED_MICRO` is
 *     now `ONE_TURN_MICRO + 1000`, and scenario 2 runs TWO turns — the
 *     second one charges MORE than the balance left after the first,
 *     driving it NEGATIVE, and the exact negative number is asserted.
 *
 * Both were verified as real, not just reasoned about: patching
 * `credits.go` to reproduce each mutation (M-1: deduct/record `costMicro`
 * instead of `credits`; M-2: `balance_micro - LEAST($2, balance_micro)`)
 * turns THIS spec red with the fixes below in place, and reverting the
 * patch turns it back green — see `task-18-report.md` for the transcripts.
 *
 * ONE SEED, THREE TURNS, ONE LEARNER, IN ORDER. This file registers ONE
 * fresh account and runs every scenario as sequential steps of a single
 * test — the balance a later scenario needs as its starting point is
 * exactly the balance the previous one left behind. That also keeps this
 * file's contribution to `helpers.ts`'s shared `/auth/*` rate-limit budget
 * to exactly one register call.
 */

/** Same computation `playwright.config.ts` and `p1.spec.ts` already use for the real API's origin. */
const API_ORIGIN = (
  process.env.VITE_API_URL ?? `http://localhost:${process.env.TUHOC_E2E_API_PORT ?? '8089'}`
).replace(/\/+$/, '');

/**
 * MUST equal `scripts/fake_deepseek.py`'s derived ONE_TURN_MICRO — three
 * usage figures (cache_hit=137, cache_miss=1583, completion=421 tokens)
 * against `ai_pricing`'s seeded deepseek-v4-pro CREDITS columns
 * (credits_per_1k_in=1320, credits_per_1k_cached_in=44,
 * credits_per_1k_out=3960), run through `cost.go`'s `divUp` (ceiling
 * division). See that script's header comment for the full derivation —
 * chosen, since round-1 self-review, so EVERY term rounds a genuine
 * fraction (not just one), so a "tidier" fixture number cannot silently
 * delete the only case exercising divUp's rounding direction.
 */
const ONE_TURN_MICRO = 3765;

/**
 * `ONE_TURN_MICRO + 1000` — see this file's own top comment, "M-2", for why
 * exactly-one-turn's-cost cannot tell real subtraction apart from a
 * floor-at-zero bug, and why 1000 specifically (round, and small enough
 * that the SECOND turn's charge exceeds what is left after the first,
 * which is the whole point). MUST equal `scripts/test-e2e.sh`'s
 * `AI_SIGNUP_GRANT_MICRO` default.
 */
const SEED_MICRO = ONE_TURN_MICRO + 1000;

/** A chapter of the seeded course with no widget (that pairing is `p1.spec.ts`/`widget.spec.ts`'s job — `c2`) — plain prose + KaTeX is enough for the AI entry point this file drives. */
const CHAPTER_ID = 'c1';

/**
 * MUST equal `scripts/fake_deepseek.py`'s `ANSWER_TEXT` verbatim. Round-1
 * self-review found the first version of this spec only asserted a ~42
 * character PREFIX via `toContainText`, ending inside the second of six
 * streamed fragments — a bug that lost, duplicated or reordered anything
 * past that point would have passed silently. Every assertion against the
 * rendered answer below checks this FULL string exactly.
 */
const FULL_ANSWER_TEXT =
  'Đây là câu trả lời cố định từ DeepSeek giả, dùng cho bộ kiểm e2e của Task 18. Không có lời gọi mạng thật nào tới DeepSeek trong lần chạy này.';

/**
 * The one console line this file EXPECTS, once: scenario 3's blocked ask
 * makes the browser itself log a "Failed to load resource … 402" line for
 * `POST /ai/chat` — the same browser-generated, by-design noise
 * `isBenignAuthCheck401` (`helpers.ts`) already carves out for `/me`'s 401,
 * scoped here just as narrowly (status 402 AND path `/ai/chat`, not any
 * status on any path) so a REAL regression elsewhere still fails loudly.
 */
function isBenignNoCreditConsoleError(msg: ConsoleMessage): boolean {
  if (!/^Failed to load resource: the server responded with a status of 402\b/.test(msg.text())) return false;
  try {
    return new URL(msg.location().url).pathname === '/ai/chat';
  } catch {
    return false;
  }
}

/**
 * Polls `locator`'s text until it is a non-empty, INCOMPLETE prefix of
 * `full` at least once, or throws. This is the ACTUAL observation that
 * makes `fake_deepseek.py`'s inter-chunk delay mean something — round-1
 * self-review found a prior version of that delay's doc comment claimed it
 * made "streamed" distinguishable from "painted once at the end" with no
 * assertion anywhere that ever looked at an intermediate state; a client
 * that buffered the whole SSE body and painted once at "done" would have
 * passed identically. This is the closest live equivalent to what the
 * now-deleted `instrument` helper's answer-box tracking used to prove (git
 * show 390931e:apps/web/e2e/s2.spec.ts) — not the same mechanism, but the
 * same property, actually checked.
 */
async function expectStreamedIncrementally(locator: Locator, full: string): Promise<void> {
  await expect
    .poll(
      async () => {
        if ((await locator.count()) === 0) return false;
        const t = (await locator.textContent()) ?? '';
        return t.length > 0 && t.length < full.length;
      },
      {
        timeout: 3_000,
        intervals: [25],
      },
    )
    .toBe(true);
}

test.describe('S2 — AI credit gate', () => {
  test('balance displays, deducts by fake usage × price (including going negative), blocks at zero, personal config survives reload', async ({
    page,
  }) => {
    const unexpectedConsoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      if (isBenignAuthCheck401(msg)) return;
      if (isBenignNoCreditConsoleError(msg)) return;
      unexpectedConsoleErrors.push(msg.text());
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.stack ?? err.message));

    const email = freshEmail();
    await page.goto('/login');
    await registerNewUser(page, email, PASSWORD);

    await test.step('scenario 1: the seeded balance displays correctly', async () => {
      await page.goto('/settings');
      const balance = page.getByTestId('credit-balance');
      await expect(balance).not.toHaveText('—');

      // Computed IN the browser (same V8/ICU that rendered the panel), not
      // hand-formatted in Node. NOTE what this DOES and does NOT prove:
      // `toLocaleString(..., { maximumFractionDigits: 4 })` rounds to the
      // nearest 100 micro-credits REGARDLESS of magnitude, so this check
      // alone cannot tell SEED_MICRO apart from a balance a few dozen
      // micro-credits off — it proves the panel paints SOMETHING derived
      // from the live API value with no stale cache, not exact-value
      // accuracy. The `GET /ai/credits` assertion right below reads the raw
      // integer with no rounding, and THAT is the real proof of "số dư hiện
      // đúng" — this DOM check is a (real, but coarser) second witness, not
      // a replacement for it.
      const expectedText = await page.evaluate(
        (micro) => (micro / 1_000_000).toLocaleString('vi-VN', { maximumFractionDigits: 4 }),
        SEED_MICRO,
      );
      await expect(balance).toHaveText(expectedText);

      const res = await page.request.get(`${API_ORIGIN}/ai/credits`);
      expect(res.ok(), `GET /ai/credits -> ${res.status()}`).toBe(true);
      const body = (await res.json()) as { balance_micro: number; recent_usage: unknown[] };
      expect(body.balance_micro).toBe(SEED_MICRO);
      expect(body.recent_usage).toEqual([]);
    });

    await test.step('scenario 2: two turns drain the balance PAST zero — proves real subtraction, not a floor-at-0 clamp (M-2)', async () => {
      await page.goto(`/c/${REAL_COURSE_ID}/${CHAPTER_ID}`);
      const askButton = page.getByRole('button', { name: 'Hỏi AI về chương này' });
      // Disabled until the chapter's own content div is mounted
      // (ChapterView.tsx: `disabled={annotationContent.root === null}`) —
      // waiting for "enabled" here is the precise readiness signal this
      // button's own code depends on, not a proxy for it.
      await expect(askButton).toBeEnabled();
      await askButton.click();

      const dialog = page.getByRole('dialog', { name: 'Hỏi về chương' });
      await expect(dialog).toBeVisible();
      const answer = dialog.getByTestId('ai-answer');

      // ── Turn A: balance 4765 -> 1000. Charge (3765) < balance (4765), so
      // this alone cannot distinguish real subtraction from a clamp — it
      // only proves a turn was billed for something close to the right
      // amount. The DISCRIMINATING step is turn B, below.
      await dialog.getByLabel('Câu hỏi của bạn').fill('Chương này nói về điều gì?');
      await dialog.getByRole('button', { name: 'Hỏi', exact: true }).click();

      // The actual observation behind "chảy từng chữ" — see
      // expectStreamedIncrementally's own doc comment.
      await expectStreamedIncrementally(answer, FULL_ANSWER_TEXT);

      // Generous timeout on this one assertion, not the suite default: it
      // waits on a REAL multi-hop round trip (EnsureCredit + Settings +
      // AgentConfig reads, the SSE turn itself, a TCP round trip to
      // deepseek-fake) rather than a pure client-side state change — same
      // reasoning `playwright.config.ts` gives for its own inline
      // overrides, not a blanket bump.
      await expect(answer).toHaveText(FULL_ANSWER_TEXT, { timeout: 20_000 });
      // Streaming finished: "Dừng" (cancel) reverted to "Hỏi" (submit) —
      // `useAI.ts`'s `state` left `'streaming'` for `'done'`.
      await expect(dialog.getByRole('button', { name: 'Hỏi', exact: true })).toBeVisible();

      const resA = await page.request.get(`${API_ORIGIN}/ai/credits`);
      const bodyA = (await resA.json()) as { balance_micro: number; recent_usage: unknown[] };
      expect(bodyA.balance_micro).toBe(SEED_MICRO - ONE_TURN_MICRO); // 4765 - 3765 = 1000
      expect(bodyA.recent_usage).toHaveLength(1);

      // ── Turn B: balance 1000 -> -2765. Charge (3765) > balance (1000):
      // correct code lets this go NEGATIVE (spec §3.4); a
      // `LEAST($2, balance_micro)`-style clamp would instead floor it at 0
      // — the exact mutation M-2's top-comment names, and the exact
      // assertion below is what turns that mutation red.
      await dialog.getByLabel('Câu hỏi của bạn').fill('Một câu hỏi khác, cùng phiên.');
      await dialog.getByRole('button', { name: 'Hỏi', exact: true }).click();
      // `answer` now refers to the SECOND turn — AskPanel.tsx tags
      // `data-testid="ai-answer"` on the LAST turn only, so the locator
      // (unchanged) automatically follows.
      await expect(answer).toHaveText(FULL_ANSWER_TEXT, { timeout: 20_000 });

      const resB = await page.request.get(`${API_ORIGIN}/ai/credits`);
      const bodyB = (await resB.json()) as {
        balance_micro: number;
        recent_usage: {
          model: string;
          in_tokens: number;
          cached_in_tokens: number;
          out_tokens: number;
          tool_calls: number;
          web_searches: number;
          credits_charged: number;
        }[];
      };
      // -2765, NOT 0 or clamp(0) — see the paragraph above. This is the
      // single assertion M-2's mutation cannot survive.
      expect(bodyB.balance_micro).toBe(SEED_MICRO - 2 * ONE_TURN_MICRO); // 4765 - 2*3765 = -2765
      expect(bodyB.recent_usage).toHaveLength(2);
      for (const entry of bodyB.recent_usage) {
        expect(entry).toMatchObject({
          model: 'deepseek-v4-pro',
          in_tokens: 1583,
          cached_in_tokens: 137,
          out_tokens: 421,
          tool_calls: 0,
          web_searches: 0,
          credits_charged: ONE_TURN_MICRO,
        });
      }
    });

    await test.step('scenario 3: balance below 0 blocks the next turn, and says what to do instead', async () => {
      await page.goto(`/c/${REAL_COURSE_ID}/${CHAPTER_ID}`);
      await page.getByRole('button', { name: 'Hỏi AI về chương này' }).click();
      const dialog = page.getByRole('dialog', { name: 'Hỏi về chương' });
      await dialog.getByLabel('Câu hỏi của bạn').fill('Lượt thứ ba — tài khoản đã âm.');
      await dialog.getByRole('button', { name: 'Hỏi', exact: true }).click();

      // Refused BEFORE the stream starts (handler.go's Chat: EnsureCredit
      // runs ahead of `c.Status(fiber.StatusOK)`), so this is a plain 402
      // JSON response, not an SSE "error" event — `useAI.ts`'s `error.code
      // === 'NoCredit'` flips `AskPanel`'s `needsSetup`/`blocked`.
      await expect(dialog.getByTestId('ai-needs-setup')).toContainText('Tài khoản đã hết credit AI');
      // The ask form itself is gone from the DOM while blocked
      // (`AskPanel.tsx`: `{!blocked && (<form className="ai-panel-ask">…)`)
      // — not merely hidden, so a learner cannot type into a form that
      // will just be refused again.
      await expect(dialog.locator('.ai-panel-ask')).toHaveCount(0);
      // The invite still links to Settings' AI section, but for what is
      // ACTUALLY there — a balance and a spend ledger, not a top-up form.
      //
      // THIS ASSERTION CAUGHT THE COPY CHANGE, which is the point of having
      // it: E1 of the whole-branch review renamed this link because the old
      // label ("Mở trang cấu hình") borrowed its meaning from a sentence
      // above it that promised a top-up which has never existed —
      // `CreditPanel.tsx` draws a balance and a usage table — no top-up
      // button, no form, no outbound link. (An earlier draft of this comment
      // cited a `topup|payment|checkout|stripe` grep as the proof. Measured:
      // `checkout` matches 9 product lines and `payment` matches 2, all of
      // them unrelated — GitHub Discussions and config prose. The grep was
      // never the evidence; reading CreditPanel.tsx is.)
      // Billing is Pha 4 (spec §7).
      await expect(dialog.getByRole('link', { name: 'Xem số dư và sổ dùng' })).toBeVisible();

      // And the invite must not have quietly grown the promise back. Same
      // fixed-phrase scan `AskPanel.test.tsx` keeps at the unit layer, run
      // here against the REAL rendered panel in a real browser — the two are
      // not redundant: this one proves the production build ships it.
      const inviteText = (await dialog.getByTestId('ai-needs-setup').innerText()).toLowerCase();
      expect(inviteText).not.toContain('nạp thêm');
      expect(inviteText).toContain('liên hệ quản trị viên');

      const res = await page.request.get(`${API_ORIGIN}/ai/credits`);
      const body = (await res.json()) as { balance_micro: number; recent_usage: unknown[] };
      // Unchanged from scenario 2's end (-2765), and the ledger has no
      // THIRD row: a refused turn was never run, so ChargeTurn never ran
      // either.
      expect(body.balance_micro).toBe(SEED_MICRO - 2 * ONE_TURN_MICRO);
      expect(body.recent_usage).toHaveLength(2);
    });

    await test.step('scenario 4: a personal prompt survives a reload', async () => {
      const myPrompt = `e2e s2.spec.ts personal prompt ${Date.now().toString()}`;
      await page.goto('/settings');
      const promptBox = page.locator('#agent-config-prompt');
      await expect(promptBox).toBeVisible();
      await promptBox.fill(myPrompt);
      await page.getByRole('button', { name: 'Lưu cấu hình' }).click();
      await expect(page.getByText('Đã lưu.')).toBeVisible();

      // A fresh document load, not client-side navigation: this is the
      // property spec §8 actually names ("tải lại trang thì nó còn đó") —
      // proving the value survived a REQUEST round trip
      // (`GET /ai/config`), not merely surviving in React state that a
      // real reload would have wiped regardless.
      await page.reload();
      await expect(page.locator('#agent-config-prompt')).toHaveValue(myPrompt);

      const res = await page.request.get(`${API_ORIGIN}/ai/config`);
      expect((await res.json()).system_prompt).toBe(myPrompt);
    });

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    expect(unexpectedConsoleErrors, unexpectedConsoleErrors.join('\n')).toEqual([]);
  });
});

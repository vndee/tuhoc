import { expect, test, type ConsoleMessage } from '@playwright/test';
import { PASSWORD, REAL_COURSE_ID, freshEmail, isBenignAuthCheck401, registerNewUser } from './helpers';

/**
 * Task 18 — `s2.spec.ts`, REBUILT around CREDIT rather than the Pha-1 key
 * vault this filename used to gate. The old file drove `apps/vault`, a
 * second-origin app the learner plugged their own DeepSeek key into; Pha 2
 * moved AI to the server, paid for in credit, and Task 16 deleted that app
 * along with every test that drove it (`git log` on this path, or
 * `docs/testing.md`'s former "Reading s2.spec.ts back" section — folded
 * into this comment now that the rewrite it was written for has landed).
 * NOTHING below is lifted from that file: the old harness built, served and
 * drove a second origin that no longer exists, so every assertion here is
 * new, written directly against the credit architecture spec §3.4/§8
 * describe.
 *
 * WHAT THIS PROVES — spec §8's own words for this gate: "số dư hiện, trừ
 * đúng, hết chặn, config giữ" (the balance displays, deducts correctly,
 * blocks when empty, personal config survives a reload). It does NOT
 * re-prove `p1.spec.ts`'s reader assertions (KaTeX, widgets, cross-device
 * sync) or `widget.spec.ts`'s sandbox boundary — this file's only job is
 * the AI/credit surface neither of those touches.
 *
 * NO REAL DEEPSEEK CALL, EVER. `scripts/test-e2e.sh` points
 * `DEEPSEEK_BASE_URL` (`apps/api/compose.e2e.yml`) at a small HTTP server,
 * `scripts/fake_deepseek.py`, run as its own compose service — it answers
 * the exact wire shape `apps/api/internal/ai/stream.go`'s `CompleteStream`
 * parses, with a FIXED reply and FIXED usage, regardless of what was asked.
 * See that script's own header comment for the full reasoning and the exact
 * derivation of `SEED_MICRO` below. Two consequences worth stating up
 * front, so a green run here is not read as promising more than it does:
 *
 *   - This proves apps/api's OWN cost math (`cost.go`'s `Charge`,
 *     `credits.go`'s `ChargeTurn`, the SSE relay in `handler.go`'s
 *     `streamTurn`) end to end through a real HTTP round trip — the
 *     machinery a real DeepSeek call would exercise identically. It does
 *     NOT prove DeepSeek's real API behaves the way `client_test.go`/
 *     `stream_test.go` assume; `docs/deepseek-measured.md` is the one place
 *     that gets checked against the live API, deliberately not in a suite
 *     that runs on every push.
 *   - The tool loop never runs here (the fake reply never emits a
 *     `tool_calls` entry — see `fake_deepseek.py`'s own "NO TOOL CALLS"
 *     note), so every turn finishes in exactly one round. That is what
 *     makes the credit math below EXACT rather than "usually close" — Go's
 *     own tool-loop coverage (`agent_test.go`, `stream_test.go`,
 *     `tool_course_test.go`) already exists and does not need re-proving
 *     through a real browser.
 *
 * SEED_MICRO = 2972. `scripts/test-e2e.sh` sets
 * `ai_settings.signup_grant_micro` to this exact value (its own
 * `AI_SIGNUP_GRANT_MICRO`, default 2972, overridable via
 * `TUHOC_E2E_AI_SIGNUP_GRANT_MICRO`) before ANY user in this e2e run
 * registers — `ai.Service.GrantSignupCredit` reads that column FRESH on
 * every signup (`credits.go`'s own doc comment: never cached, never a
 * compiled-in constant), so THIS test's freshly-registered learner starts
 * with EXACTLY one fake turn's worth of credit. `fake_deepseek.py`'s header
 * comment derives 2972 from its own fixed usage (cache_hit=40,
 * cache_miss=1200, completion=350 tokens) against `ai_pricing`'s seeded
 * `deepseek-v4-pro` row (`migrations/0007_ai_credits.up.sql`) — KEEP ALL
 * THREE NUMBERS IN SYNC BY HAND; there is no fourth place any of the three
 * files could read a shared value from without a build step none of them
 * otherwise needs (same tension `playwright.config.ts` already documents
 * for `CORS_ORIGIN`). A mismatch here fails LOUDLY — a balance assertion
 * off by the exact difference — not silently.
 *
 * ONE SEED, FOUR SCENARIOS, ONE LEARNER, IN ORDER. §8's four checks are
 * statefully dependent on each other (the balance the second scenario
 * expects to end at is exactly the balance the third scenario needs as its
 * starting point), so this file registers ONE fresh account and runs all
 * four as sequential steps of a single test — not four independent tests
 * each re-registering their own account. That also keeps this file's
 * contribution to `helpers.ts`'s shared `/auth/*` rate-limit budget (see
 * that file's own doc comment) to exactly one register call.
 */

/** Same computation `playwright.config.ts` and `p1.spec.ts` already use for the real API's origin. */
const API_ORIGIN = (
  process.env.VITE_API_URL ?? `http://localhost:${process.env.TUHOC_E2E_API_PORT ?? '8089'}`
).replace(/\/+$/, '');

/**
 * MUST equal `scripts/test-e2e.sh`'s `AI_SIGNUP_GRANT_MICRO` AND
 * `scripts/fake_deepseek.py`'s derived one-turn cost — see this file's own
 * top comment for the full accounting of why 2972 and why it lives in three
 * places by hand.
 */
const SEED_MICRO = 2972;

/** A chapter of the seeded course with no widget (that pairing is `p1.spec.ts`/`widget.spec.ts`'s job — `c2`) — plain prose + KaTeX is enough for the AI entry point this file drives. */
const CHAPTER_ID = 'c1';

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

test.describe('S2 — AI credit gate', () => {
  test('balance displays, deducts by fake usage × price, blocks at zero, personal config survives reload', async ({
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

      // Computed IN the browser (same V8/ICU that rendered the panel),
      // not hand-formatted in Node — this sidesteps any doubt about
      // whether Node's own Intl data would render `vi-VN` identically to
      // Chromium's, and it is what `CreditPanel.tsx`'s `formatCredits`
      // (../src/ai/money.ts) actually computes.
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

    await test.step('scenario 2: asking one question deducts exactly usage × price', async () => {
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
      await dialog.getByLabel('Câu hỏi của bạn').fill('Chương này nói về điều gì?');
      await dialog.getByRole('button', { name: 'Hỏi', exact: true }).click();

      // Generous timeout on this one assertion, not the suite default: it
      // waits on a REAL multi-hop round trip (EnsureCredit + Settings +
      // AgentConfig reads, the SSE turn itself, a TCP round trip to
      // deepseek-fake) rather than a pure client-side state change — same
      // reasoning `playwright.config.ts` gives for its own inline
      // overrides, not a blanket bump.
      const answer = dialog.getByTestId('ai-answer');
      await expect(answer).toContainText('Đây là câu trả lời cố định từ DeepSeek giả', { timeout: 20_000 });
      // Streaming finished: "Dừng" (cancel) reverted to "Hỏi" (submit) —
      // `useAI.ts`'s `state` left `'streaming'` for `'done'`.
      await expect(dialog.getByRole('button', { name: 'Hỏi', exact: true })).toBeVisible();

      const res = await page.request.get(`${API_ORIGIN}/ai/credits`);
      const body = (await res.json()) as {
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
      // Zero, not "SEED_MICRO minus something computed here": one turn
      // against the fake provider costs EXACTLY SEED_MICRO by construction
      // (see this file's own top comment), so the fresh signup grant is
      // drained to the last micro-credit.
      expect(body.balance_micro).toBe(0);
      expect(body.recent_usage).toHaveLength(1);
      expect(body.recent_usage[0]).toMatchObject({
        model: 'deepseek-v4-pro',
        in_tokens: 1200,
        cached_in_tokens: 40,
        out_tokens: 350,
        tool_calls: 0,
        web_searches: 0,
        credits_charged: SEED_MICRO,
      });
    });

    await test.step('scenario 3: balance 0 blocks the next turn with a top-up invite', async () => {
      await page.goto(`/c/${REAL_COURSE_ID}/${CHAPTER_ID}`);
      await page.getByRole('button', { name: 'Hỏi AI về chương này' }).click();
      const dialog = page.getByRole('dialog', { name: 'Hỏi về chương' });
      await dialog.getByLabel('Câu hỏi của bạn').fill('Một câu hỏi khác — tài khoản đã hết credit.');
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
      // The invite links to Settings' AI section — spec §8's "kèm lời mời nạp".
      await expect(dialog.getByRole('link', { name: 'Mở trang cấu hình' })).toBeVisible();

      const res = await page.request.get(`${API_ORIGIN}/ai/credits`);
      const body = (await res.json()) as { balance_micro: number; recent_usage: unknown[] };
      // Unchanged, and the ledger has no SECOND row: a refused turn was
      // never run, so ChargeTurn never ran either.
      expect(body.balance_micro).toBe(0);
      expect(body.recent_usage).toHaveLength(1);
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

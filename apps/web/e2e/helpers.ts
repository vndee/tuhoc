import { expect, test, type ConsoleMessage, type Locator, type Page } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shared fixtures for the Playwright suites in this directory —
 * `p1.spec.ts` (the fast definition-of-done gate), `p2.spec.ts` (the
 * annotation phase's own gate) and `s2.spec.ts`. (`viz.spec.ts`, once a
 * third consumer, was deleted by Task 11 of the server-side pivot alongside
 * course-wide `viz.js` — see the Makefile's `test-e2e` comment.) Extracted
 * rather than copied: `isBenignAuthCheck401` in particular is a deliberately
 * NARROW filter whose exact scope was established by a one-off debug run
 * (see its own doc comment) — two hand-maintained copies of a rule like that
 * drift, and the drift shows up as a suite that stops failing when it
 * should.
 *
 * Not itself a spec file: Playwright's default `testMatch` only picks up
 * `*.spec.ts`/`*.test.ts`, and vitest excludes `./e2e/**` wholesale (see
 * vite.config.ts), so nothing tries to run this as a test.
 */

export const PASSWORD = 'secret123';
/**
 * `fixtures/format-v2/valid-course/manifest.json`'s `title` — also the
 * `<nav aria-label>` CourseHome renders it into (see courseHomeChapterLink
 * below).
 *
 * Task 16: was `so-dau-phay-dong`/`'Số dấu phẩy động'`, a format-v1 package
 * (`tier: interactive`, course-wide `viz.js`) that `make courses` unpacked
 * into a local `courses/` directory the built web app served statically.
 * Both halves of that are gone — format v2 abolished `tier` (Task 1) and
 * course content now comes from the server, not a static directory (Task
 * 9-13) — and a v1 package could not even be PUBLISHED under v2's rules
 * (`TIER_REMOVED`) if something tried. `mau-hop-le` is the shared TS/Go
 * fixture corpus's own zero-finding v2 package (ruling D5); this suite's
 * `scripts/test-e2e.sh` seed step is what puts it on the real server before
 * any of these tests run.
 */
export const COURSE_TITLE = 'Biến đếm: từ vòng lặp đến sự kiện';

/** `manifest.id` của gói mẫu — cũng là slug được publish lên server bởi bước seed trong `scripts/test-e2e.sh` (xem chú thích của COURSE_TITLE). */
export const REAL_COURSE_ID = 'mau-hop-le';

/** apps/web/e2e/ → gốc repo là ba tầng lên. Xuất ra vì `s2.spec.ts` cũng đọc theo đường dẫn tuyệt đối từ gốc repo, và hai bản sao của phép tính này thì trôi. (`s3`/`s4.spec.ts` từng đọc nó nữa — cả hai đã bị xoá ở Task 16 của server-side pivot, xem commit "Cổng e2e mới".) */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * `realCoursePackageZip()` ĐÃ XOÁ Ở ĐÂY (Task 13, spec
 * `2026-08-25-server-side-pivot.md` §1). Nó trả về đường tới chính tệp `.zip`
 * của `fixtures/courses/so-dau-phay-dong`, dùng bởi hai tệp e2e — cả hai đã
 * gỡ: `import.spec.ts` (kiểm màn hình Import chọn tệp) và phần §5 cũ của
 * `s1.spec.ts` (dùng nó chỉ để đưa course công khai này vào máy trước khi mở
 * — một bước chưa từng cần thiết, và `p1.spec.ts`'s bản kế thừa của §5 đã bỏ
 * nó). `p1`/`p2`/`viz` không cần TỆP `.zip` — chúng đọc bản đã BUNG ở
 * `courses/` (`make courses` bung hộ trước khi `make test-e2e` chạy), nên
 * không còn lời gọi nào tới hàm này để giữ nó lại.
 */

/** A unique account per run (down to the millisecond) — this suite runs against a fresh, empty database each time (see compose.e2e.yml's no-volume policy), but uniqueness costs nothing and protects a developer running it twice against a stack they forgot to tear down. */
export function freshEmail(): string {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@tuhoc.dev`;
}

/**
 * VÁCH ĐÁ SỨC CHỨA `/auth/*`, VÀ VÌ SAO NÓ ĐƯỢC XỬ Ở ĐÂY CHỨ KHÔNG Ở TỪNG BÀI.
 *
 * API giới hạn `/auth/*` ở **10 lời gọi mỗi phút mỗi IP** (`server.go`:
 * `authRateLimitMax = 10`, `authRateLimitExpiration = time.Minute`, cửa sổ CỐ
 * ĐỊNH của `fiber/middleware/limiter`), và **cả bộ e2e đi ra từ ĐÚNG MỘT IP** —
 * cổng của docker, `192.168.65.1`. Giới hạn ấy là một tính năng an ninh thật
 * (chống dò mật khẩu và dò tài khoản), không phải một phiền toái để nới.
 *
 * `s2.spec.ts` đã ghi lại triệu chứng: ở **17 bài**, `viz.spec.ts` — bài cuối,
 * chẳng liên quan gì tới đăng nhập — hỏng ở `registerNewUser` với `waitForURL`
 * hết giờ 15 s, và log API có **đúng một dòng** `429 POST /auth/register`. Bỏ
 * BẤT KỲ bài nào ra để còn 16 thì cả bộ xanh. Task 7 thêm 7 bài (tổng **24**)
 * và một lời gọi đăng ký; vách đá đổ đúng chỗ cũ, và lần này nó đổ vì **tổng
 * sức chứa**, không vì một bài nào sai.
 *
 * Ba đường đã cân:
 *
 *   a. **Nới giới hạn ở máy chủ cho e2e** — loại. Cổng khi ấy chạy trên một
 *      cấu hình mà production không có, và `auth_test.go` sẽ đang khoá một số
 *      mà không ai chạy.
 *   b. **Đếm và giữ tổng số bài dưới 16** — loại. Đó là một trần đếm được, tức
 *      là đúng thứ mà kế hoạch này gọi tên là "cổng mù thứ sáu": nó vẫn xanh
 *      khi ai đó bỏ một bài và thêm một bài, và nó biến "thêm một khẳng định"
 *      thành một quyết định ngân sách.
 *   c. **Đồ nghề TÔN TRỌNG bộ giới hạn** ✅ — đọc `Retry-After` mà chính
 *      `limiter` gửi kèm 429, đợi hết cửa sổ, rồi gửi lại. Không khẳng định nào
 *      bị nới; một bài chỉ chạy CHẬM hơn ở đúng lần nó chạm trần.
 *
 * Vì sao ở helper chứ không ở từng bài: 15 lời gọi `/auth/*` nằm rải trong bảy
 * tệp spec, và bài BỊ 429 gần như không bao giờ là bài đã tiêu suất cuối cùng.
 * Một phép sửa ở chỗ gọi chỉ dời vách đá sang bài kế tiếp.
 */
const AUTH_RETRY_ATTEMPTS = 3;
/** Cửa sổ của `limiter` là một phút; cộng biên khi máy chủ không gửi `Retry-After`. */
const AUTH_WINDOW_FALLBACK_S = 61;

/**
 * ĐỢI TRƯỚC, KHÔNG PHẢI THỬ LẠI SAU — và vì sao cần CẢ HAI.
 *
 * Vòng chạy đầu tiên có phép thử lại (và chỉ có nó) đã sống sót qua 429, nhưng
 * `viz.spec.ts` vẫn ĐỎ, vì một lý do đáng ghi: bài ấy khoá **console không một
 * lỗi nào**, và trình duyệt tự ghi `Failed to load resource: … 429` NGAY KHI
 * phản hồi về — trước khi bất cứ phép thử lại nào kịp thành công. Một 429 đã
 * được xử lý êm vẫn để lại dấu vết trong console, và bài kia đọc dấu vết ấy.
 *
 * Nên phép đếm nằm ở ĐÂY, phía khách: bộ e2e giữ sổ của chính nó trên cùng cái
 * ngân sách mà máy chủ cưỡng chế (10 lời gọi / 60 s), và **đợi trước khi gửi**
 * khi sổ đã đầy. Máy chủ khi ấy không bao giờ phải nói 429, nên console sạch.
 *
 * Giữ lại một suất (9 chứ không 10): cửa sổ của `fiber/middleware/limiter` là
 * cửa sổ CỐ ĐỊNH còn sổ này là cửa sổ TRƯỢT, nên hai bên không bao giờ trùng
 * mốc. Một suất dự phòng là cái đệm cho chỗ lệch ấy — và phép thử lại phía dưới
 * vẫn ở nguyên làm lưới cuối, vì một sổ phía khách chỉ đếm được **các lời gọi
 * đi qua tệp này** (`workers: 1` làm nó đầy đủ hôm nay; một ngày nào đó
 * `playwright.config.ts` tăng `workers` thì mỗi worker có sổ riêng và sổ ấy
 * thiếu).
 */
const AUTH_BUDGET_MAX = 9;
const AUTH_BUDGET_WINDOW_MS = 60_000;
/** Mốc thời gian của mọi lời gọi `/auth/*` mà tệp này đã gửi trong worker này. */
const authCallsAt: number[] = [];

/** Nới hạn giờ của bài đang chạy đúng bằng thời gian sắp đợi. */
function grantTimeBudget(waitMs: number): void {
  try {
    const info = test.info();
    info.setTimeout(info.timeout + waitMs + 15_000);
  } catch {
    // Ngoài ngữ cảnh một bài (ví dụ trong `beforeAll`): hạn giờ do hook tự đặt.
  }
}

/** Chờ tới lúc còn suất trong ngân sách `/auth/*`, rồi ghi sổ một suất. */
async function reserveAuthSlot(page: Page, what: string): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (authCallsAt.length > 0 && now - (authCallsAt[0] as number) >= AUTH_BUDGET_WINDOW_MS) {
      authCallsAt.shift();
    }
    if (authCallsAt.length < AUTH_BUDGET_MAX) {
      authCallsAt.push(now);
      return;
    }
    const waitMs = AUTH_BUDGET_WINDOW_MS - (now - (authCallsAt[0] as number)) + 500;
    grantTimeBudget(waitMs);
    console.log(
      `[e2e] ${what}: ngân sách /auth/* đã dùng ${String(authCallsAt.length)}/${String(AUTH_BUDGET_MAX)} ` +
        `trong 60 s. Đợi ${String(Math.round(waitMs / 1000))} s để KHÔNG phải nhận một 429 ` +
        '(một 429 đã xử lý vẫn để lại dòng lỗi trong console, và viz.spec.ts đọc nó).',
    );
    await page.waitForTimeout(waitMs);
  }
}

/**
 * Gửi một form `/auth/*` và, CHỈ KHI máy chủ trả 429, đợi hết cửa sổ rồi gửi
 * lại. Mọi mã trạng thái khác đi thẳng về cho chỗ gọi — một 409 "email đã tồn
 * tại" phải hỏng ồn ào như trước, không được biến thành ba lần thử im lặng.
 */
async function submitAuthForm(page: Page, what: string, submit: () => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    await reserveAuthSlot(page, what);

    // Đăng ký NGHE TRƯỚC khi bấm: `fetch` của trang có thể trả lời xong trước
    // khi `submit()` trả về, và một `waitForResponse` gắn sau cú bấm sẽ bỏ lỡ.
    const answered = page.waitForResponse(
      (r) => new URL(r.url()).pathname.startsWith('/auth/') && r.request().method() === 'POST',
      { timeout: 20_000 },
    );
    await submit();
    const res = await answered;
    if (res.status() !== 429) return;

    if (attempt >= AUTH_RETRY_ATTEMPTS) {
      throw new Error(
        `${what}: máy chủ trả 429 sau ${String(attempt)} lần thử. Bộ e2e đang tiêu ` +
          'quá 10 lời gọi /auth/* mỗi phút trên MỘT IP. Xem chú thích trên ' +
          '`submitAuthForm` — nếu bộ test đã lớn tới mức một lần đợi trọn cửa sổ ' +
          'vẫn không đủ, thì cái phải sửa là số lần ĐĂNG KÝ, không phải số lần thử.',
      );
    }

    const header = Number(res.headers()['retry-after']);
    const waitMs = (Number.isFinite(header) && header > 0 ? header + 1 : AUTH_WINDOW_FALLBACK_S) * 1000;

    // Sổ phía khách vừa nói "còn suất" mà máy chủ nói không — hai cửa sổ lệch
    // mốc. Vứt sổ đi và đếm lại từ đầu, thay vì tin một sổ vừa sai.
    authCallsAt.length = 0;
    grantTimeBudget(waitMs);

    console.log(
      `[e2e] ${what}: 429 (hạn mức /auth/* 10 lời gọi/phút/IP). ` +
        `Đợi ${String(Math.round(waitMs / 1000))} s rồi thử lại (lần ${String(attempt + 1)}/${String(AUTH_RETRY_ATTEMPTS)}).`,
    );
    await page.waitForTimeout(waitMs);
  }
}

/**
 * Fills and submits the register form on `/login`'s "Đăng ký" tab, and
 * waits for the post-register redirect (Login.tsx's `redirectTarget`
 * sends a bare `/login` visit — no `state.from` — to `/`) to actually
 * happen before returning, so callers never race the navigation.
 */
export async function registerNewUser(page: Page, email: string, password: string): Promise<void> {
  await submitAuthForm(page, 'đăng ký', async () => {
    // Hai tab "Đăng nhập / Đăng ký" đã bỏ — đường tới form đăng ký nay là dòng
    // ở chân cột, đúng một cú bấm như trước. Xem `pages/Login.tsx`.
    await page.getByRole('button', { name: 'Tạo tài khoản', exact: true }).click();
    await page.getByLabel('Tên').fill('E2E Learner');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  });
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
}

/** Same idea as `registerNewUser`, for the default "Đăng nhập" tab (no tab click needed — it's the initial tab). */
export async function loginExistingUser(page: Page, email: string, password: string): Promise<void> {
  await submitAuthForm(page, 'đăng nhập', async () => {
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  });
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
 * Makes sure the notes surface is showing, and leaves it showing.
 *
 * ── Cùng câu hỏi, hình dạng điều khiển đã đổi (chế độ đọc, hướng A) ────────
 * The rail used to open on a "Trong chương" tab with the notes behind a
 * second one, and this helper's job was to click that second tab. Reading
 * mode takes the tabs apart: the chapter's outline moved into the
 * table-of-contents drawer, and `#rail` became the notes MARGIN, on by
 * default. The control is now a toggle in the topbar — same id, same visible
 * text, `aria-pressed` instead of `aria-selected`.
 *
 * The postcondition this helper guarantees is unchanged, which is why every
 * caller is unchanged: after it returns, the reader's notes and the orphan
 * panel are on screen. It stays idempotent for the same reason it always was
 * — a caller does not have to know whether something else already brought
 * them forward (`ChapterView`'s `focusCard` does, whenever a card is opened
 * from the chapter), and in the new layout the common case is that nothing
 * had to be clicked at all.
 *
 * The id is deliberately still `#rail-tab-notes`: `p2.spec.ts` (×4) and
 * `s1.spec.ts` (×2) read it directly, and those are the gates that exist to
 * notice when something about notes changes. See the comment on the button
 * itself in `src/reader/ChapterView.tsx`.
 */
export async function openNotesTab(page: Page): Promise<void> {
  const toggle = page.locator('#rail-tab-notes');
  await expect(toggle, 'the topbar has no notes control — is the reader chrome rendered at all?').toBeVisible();
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // The margin itself, not just the button that governs it: `aria-pressed` is
  // a claim about state, and this is the thing every caller's next assertion
  // reads notes out of. Asserted as "mounted and not `hidden`" rather than
  // with `toBeVisible`, because a margin holding no notes yet is correctly a
  // zero-height box — which `toBeVisible` calls invisible, and which is the
  // right state for "chỉ hiện nơi có ghi chú" to be in.
  await expect(page.locator('#reader-notes-margin:not([hidden])')).toHaveCount(1);
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

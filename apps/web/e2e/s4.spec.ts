import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { extname, join, relative, resolve } from 'node:path';
import { zipSync } from 'fflate';
import { PASSWORD, REPO_ROOT, freshEmail, isBenignAuthCheck401, registerNewUser } from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HỆ THỐNG CON 4 — CỔNG NGHIỆM THU ĐẦU-CUỐI (Task 6)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Bốn kịch bản, **đi qua giao diện thật** (ruling S1-F29): một trình duyệt
 * thật, hai origin thật (ứng dụng · registry tĩnh), một API thật trong docker
 * trên một Postgres thật, và một bản dựng PRODUCTION. Không một hàm nào của
 * `apps/web/src/registry/**` hay `apps/web/src/api/**` được gọi thẳng ở tệp
 * này: mọi phiếu chấm đi qua một cú bấm vào một `<input type="radio">` thật.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 1. HAI CÂU HỎI MÀ HAI TẦNG DƯỚI **KHÔNG HỎI ĐƯỢC**
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Hàng rào riêng tư và hàng rào danh tính đều đã có cổng ở tầng dưới. Tệp này
 * chỉ đáng tồn tại nếu nó hỏi phần mà những cổng ấy **không với tới**:
 *
 *   a. **"Course riêng tư có ô chấm sao không?"** `ratingFence.test.tsx` có
 *      hai nửa — hành vi (jsdom, `<App/>`) và quét AST (sổ ba tệp). Cả hai
 *      chạy trên **mã nguồn và một DOM giả**. Câu chúng không hỏi được là:
 *      *người dùng thật, trình duyệt thật, bản dựng production, CSS thật —
 *      trên màn hình có course riêng tư, có ô chấm nào không?* Kịch bản 2
 *      hỏi đúng câu ấy, trên **ba màn hình** (`/library`, `/c/:id`, `/`),
 *      và mở đầu bằng **đối chứng dương**: cùng người đọc, cùng trình duyệt,
 *      trên `/catalog` thì ô chấm **có** — nếu không, "không có ô chấm" là
 *      một khẳng định đúng cả khi tính năng chấm sao hỏng hoàn toàn.
 *
 *   b. **"Có gì mang danh tính người chấm ra khỏi máy chủ không?"**
 *      `assertRatings` **dựng lại** đối tượng từ đúng bốn trường, nên một
 *      `voters` gửi lên dây **bị rơi ở ranh giới** — và đúng vì thế, không
 *      một bài đơn vị nào ở phía web có thể thấy nó. Nó vẫn đã đi qua mạng,
 *      vẫn đã nằm trong bộ nhớ trình duyệt của người khác. Kịch bản 3 vì thế
 *      đo **ở tầng mạng**: B chấm sao, A tải trang, và **mọi thân hồi đáp**
 *      mà trình duyệt của A nhận được từ API bị soi — không được chứa email
 *      của B, không được chứa id người dùng của B, và mỗi mục của `/ratings`
 *      phải có **đúng tập khoá** `{id, average, count, mine}`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 2. KỊCH BẢN 4 ĐƯỢC DỰNG QUANH TRẠNG THÁI **THẬT CỦA HÔM NAY**, TRƯỚC
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `task-5-go-report.md` §7 nói thẳng: **hôm nay `reason` LUÔN là `"disabled"`**
 * trên mọi checkout và trên production — chưa có repo registry công khai
 * (`docs/deploy.md` §5c), chưa có token. `NewHandlerForConfig` nhận
 * `fetcher = nil` và trả `{loaded:false, reason:"disabled", url:"", comments:[]}`
 * cho mọi yêu cầu.
 *
 * Nên **kịch bản 4a** là trạng thái ấy, đi qua **toàn bộ stack thật**: bấm nút
 * "Thảo luận" → một request thật rời trình duyệt → API thật trong docker trả
 * lời → câu tiếng Việt hiện ra → **và phần còn lại của trang vẫn dùng được**
 * (vẫn chấm sao được, nút Kéo về vẫn bấm được, không `role="alert"`, không
 * liên kết dẫn đi đâu cả).
 *
 * **Kịch bản 4b — GitHub trả 500 — KHÔNG đi hết được đầu-cuối, và tôi nói ra
 * thay vì giả vờ.** `discuss.APIURL` là một **hằng số trong mã nguồn**
 * (`https://api.github.com/graphql`), cố ý: `no_key_transit_test.go` đòi tệp
 * được cho phép gọi ra ngoài phải **tự khai đích đến** thành hằng grep được,
 * và đột biến M12 của Task 5 giết bản đọc base URL từ biến môi trường. Hệ quả
 * cho cổng này: **không có cách nào trỏ API thật vào một GitHub giả mà không
 * bịa hạ tầng** (một hằng số biên dịch sẵn, một chứng chỉ TLS cho
 * `api.github.com`, hoặc một biến môi trường mà chính hệ 2 cấm). Con đường
 * duy nhất còn lại — cấu hình `GITHUB_TOKEN` rồi để GitHub thật trả 401 —
 * **đánh mất trạng thái `disabled`** (một tiến trình, một cấu hình), tức đổi
 * kịch bản 4a lấy 4b, và buộc cổng phụ thuộc vào đường ra internet.
 *
 * ⇒ 4b **mô phỏng ở ranh giới API**, bằng `page.route`, với **đúng thân** mà
 * `internal/discuss` sinh ra trên đường hỏng. Chuỗi bằng chứng, nói rõ để
 * không ai đọc nhầm cổng này:
 *
 *     GitHub 500  →(22 ca ở `TestBrokenGitHubDegradesAndNeverBreaksThePage`)→
 *     thân `{loaded:false, reason:"unavailable", …}`  →(bài này)→  màn hình
 *
 * Mắt xích đầu do tầng Go giữ, mắt xích thứ hai do bài này giữ, và **không
 * bài nào trong repo giữ cả hai cùng lúc**. Xem "cổng này mù ở đâu" trong
 * `task-6-report.md`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 3. HAI LẦN ĐĂNG KÝ CHO CẢ NĂM BÀI — VÀ VÌ SAO PHẢI ĐẾM
 * ───────────────────────────────────────────────────────────────────────────
 *
 * API chặn `/auth/*` ở **10 lời gọi mỗi phút mỗi IP** và cả bộ e2e đi ra từ
 * ĐÚNG MỘT IP (cổng docker). `helpers.ts` đã có kế toán phía khách (đợi TRƯỚC
 * khi gửi, vì `viz.spec.ts` khoá "không lỗi console nào" và trình duyệt ghi
 * 429 trước khi phép thử lại kịp chạy). Tệp này **mượn phiên**: đăng ký đúng
 * **hai** lần trong `beforeAll` (A và B — kịch bản 3 cần hai người thật, một
 * người không chứng minh được gì về việc thấy phiếu của người khác) và mọi
 * bài dùng lại `storageState`. Tổng chi phí `/auth/*` của cả tệp: **2**.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 4. "TÔI CÓ ĐANG NHÌN ĐÚNG TRANG KHÔNG" — VÀ ĐÚNG MÁY CHỦ KHÔNG
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Trên máy này cổng 8089 đang bị một tiến trình **LẠ** chiếm, và nó là **một
 * bản tuhoc API khác**: `GET http://localhost:8089/healthz` trả `{"ok":true}`.
 * Ba agent đã suýt kết luận sai vì Playwright lái nhầm ứng dụng của người
 * khác, và ở đây cái bẫy còn tệ hơn — một máy chủ *đúng hình dạng* nhưng
 * **sai cơ sở dữ liệu** sẽ làm "chưa ai chấm khóa này" thành một khẳng định
 * ngẫu nhiên.
 *
 * Nên `beforeAll` không chỉ hỏi `/healthz`. Nó hỏi ba câu mà chỉ **stack vừa
 * dựng của chính lần chạy này** trả lời đúng được:
 *
 *   · tài khoản A vừa đăng ký, `GET /courses` phải là **mảng rỗng** — một API
 *     chạy lâu ngày của người khác gần như chắc chắn không rỗng;
 *   · `GET /ratings?ids=…` cho ba id của lần chạy này phải trả **count = 0**
 *     ở cả ba — đây đúng là tiền đề mà kịch bản 1 và 3 dựa vào;
 *   · bundle vừa dựng phải **chứa** origin registry của lần chạy này.
 *
 * Và mỗi kịch bản mở đầu bằng `expectRightApp(page)`.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 5. BA GÓI REGISTRY + MỘT GÓI RIÊNG TƯ, MỖI CÁI LÀ MỘT PHÉP ĐO
 * ───────────────────────────────────────────────────────────────────────────
 *
 *   · `s4-cham-sao-<RUN>`  (registry, nội dung của `so-dau-phay-dong`) —
 *     kịch bản 1 chấm và sửa trên hàng này
 *   · `s4-hai-nguoi-<RUN>` (registry, nội dung của `bat-bien-vong-lap`) —
 *     kịch bản 3: hàng mà **hai người** chấm
 *   · `s4-thao-luan-<RUN>` (registry, nội dung của `bat-bien-vong-lap`) —
 *     kịch bản 4 mở thảo luận trên hàng này
 *   · `s4-rieng-tu-<RUN>`  (**KHÔNG** trên registry; đẩy lên `POST /courses`
 *     của A) — kịch bản 2
 *
 * Ba id registry **rời nhau theo kịch bản** là có chủ ý: các bài chạy tuần tự
 * trên **cùng một cơ sở dữ liệu** (`workers: 1`), nên dùng chung một id sẽ
 * biến "5,0/5 · 1 phiếu" của bài này thành hàm số của bài kia, và một bài đỏ
 * sẽ kéo theo ba bài đỏ ở những chỗ chẳng liên quan. `<RUN>` là vân tay của
 * lần chạy — xem chú thích tại chỗ khai báo cho lý do đầy đủ.
 *
 * Gói riêng tư mang **id KHÁC** mọi id registry, cũng có chủ ý: nếu nó trùng,
 * "không có ô chấm cho course riêng tư" sẽ nhập nhằng với "id này có trên
 * registry nên chấm được", và mutant nào cũng có đường sống.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 6. KHÔNG MỘT TỆP ĐƯỢC GIT THEO DÕI NÀO BỊ CHẠM (S1-F9)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Cây registry và bản sao lưu `dist/` đều nằm dưới `apps/web/node_modules/`
 * — đã `.gitignore`, và **cùng hệ tệp** với `dist/`, nên `renameSync` lúc
 * khôi phục là thao tác nguyên tử (cùng lý do `s2.spec.ts`/`s3.spec.ts` ghi).
 * `afterAll` khôi phục `dist/` và **chứng minh** đã khôi phục bằng vân tay
 * sha256 hai đầu: `viz.spec.ts` chạy ngay sau tệp này (thứ tự chữ cái) và có
 * chốt "không một lỗi console nào" — một `/catalog` trỏ vào một máy chủ
 * registry đã đóng sẽ nổ `ERR_CONNECTION_REFUSED` trong console của nó.
 */

// ───────────────────────── hằng số của cổng ─────────────────────────

/** Cùng phép tính với `playwright.config.ts`, `s2.spec.ts` và `s3.spec.ts`. */
const WEB_ORIGIN = `http://localhost:${process.env.TUHOC_E2E_WEB_PORT ?? '5183'}`;

const API_ORIGIN = (
  process.env.VITE_API_URL ?? `http://localhost:${process.env.TUHOC_E2E_API_PORT ?? '8089'}`
).replace(/\/+$/, '');

/**
 * VÌ SAO MỌI ID CỦA CỔNG NÀY MANG VÂN TAY CỦA LẦN CHẠY.
 *
 * `count` mà `GET /ratings` trả về là **tổng số phiếu của mọi người dùng** cho
 * một `registry_id` — nó không thuộc về ai cả. Với id cố định, `"5,0/5 · 1
 * phiếu"` chỉ đúng trên một cơ sở dữ liệu **hoàn toàn mới**, và một lần chạy
 * thứ hai trên cùng stack (điều một người sửa mutant làm hàng chục lần) đọc ra
 * `2 phiếu` ở đúng chỗ bài kiểm nói `1`. Cổng khi ấy đỏ vì **lịch sử**, không
 * vì mã — và đó là đúng lớp nhiễu làm người ta bắt đầu bỏ qua màu đỏ.
 *
 * Với vân tay, mỗi lần chạy nói về những course **chưa từng tồn tại**, nên mọi
 * con số trên màn hình là hàm của **chỉ lần chạy này**. `compose.e2e.yml` vẫn
 * dựng cơ sở dữ liệu mới mỗi lần (nó không có volume), nên đây là **đai an
 * toàn thứ hai**, không phải cái cớ để bỏ cái thứ nhất — và `beforeAll` vẫn
 * giữ chốt "thư viện máy chủ của A chứa ĐÚNG một gói".
 *
 * Nội dung ba gói vẫn là **gói thật trong `fixtures/courses/`**, chép nguyên;
 * chỉ `id` và `title` của manifest đổi (cùng cách `s3.spec.ts` dựng gói thứ ba
 * của nó). `manifest.id` phải bằng tên thư mục — `tools/registry/src/tree.ts`
 * báo `REGISTRY_ID_MISMATCH` nếu không.
 */
const RUN = `${String(Date.now())}${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`;

/** Chép từ `fixtures/courses/so-dau-phay-dong` (`tier: interactive`) — hàng của kịch bản 1. */
const RATED_ID = `s4-cham-sao-${RUN}`;
const RATED_TITLE = `Số dấu phẩy động (s4-${RUN})`;
const RATED_FROM = 'so-dau-phay-dong';

/** Chép từ `fixtures/courses/bat-bien-vong-lap` — hàng mà HAI người chấm (kịch bản 3). */
const SHARED_ID = `s4-hai-nguoi-${RUN}`;
const SHARED_TITLE = `Bất biến vòng lặp (s4-${RUN})`;
const SHARED_FROM = 'bat-bien-vong-lap';

/** Chép từ `bat-bien-vong-lap` — hàng mà kịch bản 4 mở thảo luận. */
const DISCUSS_ID = `s4-thao-luan-${RUN}`;
const DISCUSS_TITLE = `Thảo luận khóa học (s4-${RUN})`;
const DISCUSS_FROM = 'bat-bien-vong-lap';

/** Gói RIÊNG TƯ của kịch bản 2 — **không** có trên registry, chỉ trong thư viện của A. */
const PRIVATE_ID = `s4-rieng-tu-${RUN}`;
const PRIVATE_TITLE = `Giáo trình riêng của tôi (s4-${RUN})`;
const PRIVATE_FROM = 'bat-bien-vong-lap';

/**
 * Chữ mà NGƯỜI ĐỌC nhìn thấy, ghim **nguyên văn**.
 *
 * Chép từ `packages/i18n/src/messages/vi.ts` chứ **không nhập vào** — cùng
 * lựa chọn `s2.spec.ts` và `s3.spec.ts` đã làm, và cùng lý do: một bài e2e
 * nhập chính bảng chữ mà nó đang kiểm sẽ **xanh** khi ai đó đổi một câu thành
 * chuỗi rỗng.
 */
const VI = {
  navMain: 'Điều hướng chính',
  navCourses: 'Khoá học',
  tabsAria: 'Hai kho khoá học',
  tabYours: 'Của bạn',
  tabRegistry: 'Kho cộng đồng',
  navDashboard: 'Bảng điều khiển',
  catalogTitle: 'Danh mục khóa học',
  catalogListAria: 'Khóa học trên registry',
  libraryListAria: 'Khóa học của bạn',
  sourcePrivate: 'riêng tư',
  pullAction: 'Kéo về thư viện',
  /** `<legend>` của `<fieldset>` chấm sao — tên có thể truy cập của `role="group"`. */
  ratingLegend: 'Đánh giá của bạn',
  ratingNone: 'Chưa có phiếu nào',
  ratingSaved: 'Đã lưu điểm của bạn.',
  discussToggle: 'Thảo luận',
  discussPost: 'Đăng bình luận trên GitHub',
  /** Mảnh RIÊNG của `discuss.reason.disabled` — không xuất hiện ở ba câu lý do kia. */
  discussDisabled: 'Nền tảng chưa được nối với repo thảo luận',
  /** Mảnh RIÊNG của `discuss.reason.unavailable`. */
  discussUnavailable: 'Chưa tải được thảo luận từ GitHub.',
  /** Mảnh RIÊNG của `discuss.error` — máy chủ CỦA TA trả thứ không đọc được. */
  discussBrokenAnswer: 'Không đọc được câu trả lời của máy chủ.',
  boundaryTitle: 'Màn hình này gặp lỗi',
} as const;

/** `rating.summary` của tiếng Việt: `${average(1 chữ số, dấu PHẨY)}/5 · ${count} phiếu`. */
function summaryText(average: string, count: number): string {
  return `${average}/5 · ${String(count)} phiếu`;
}

/**
 * Thân mà `internal/discuss` trả **khi GitHub hỏng** — chép từ `threadResponse`
 * và `handler.go`'s `reply(…, false, ReasonUnavailable, h.fetcher.RepoURL(), nil)`.
 *
 * `url` là `RepoURL()`, tức `githubWebHost + owner + "/" + repo + "/discussions"`.
 * `comments` là `[]` chứ **không** `null` — `reply` bảo đảm điều đó ở mọi lối
 * ra, và đột biến M4 của Task 5 giết bản không bảo đảm.
 */
const REPO_DISCUSSIONS_URL = 'https://github.com/vndee/tuhoc-registry/discussions';

// ───────────────────────── trạng thái dựng ở beforeAll ─────────────────────────

const WEB_DIR = resolve(REPO_ROOT, 'apps', 'web');
const WEB_DIST = resolve(WEB_DIR, 'dist');
const SCRATCH = resolve(WEB_DIR, 'node_modules', '.s4-registry');
const REGISTRY_ROOT = join(SCRATCH, 'root');
const REGISTRY_SITE = join(SCRATCH, 'site');
const WEB_DIST_BACKUP = resolve(WEB_DIR, 'node_modules', '.s4-dist-backup');

let registryOrigin = '';
let registryServer: Server | null = null;
let distFingerprintBefore = '';

interface Account {
  readonly email: string;
  readonly userId: string;
  readonly state: Awaited<ReturnType<BrowserContext['storageState']>>;
}

let accountA: Account | null = null;
let accountB: Account | null = null;

// ───────────────────────── tiện ích hạ tầng ─────────────────────────

/** Cổng còn trống, **hỏi hệ điều hành** chứ không đoán — xem mục 4. */
async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createNetServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => {
        if (port) res(port);
        else rej(new Error('không lấy được cổng trống'));
      });
    });
  });
}

/** Vân tay của một cây thư mục — kỷ luật `shasum` hai chiều của S1-F9, áp cho `dist/`. */
function fingerprint(dir: string): string {
  const rows: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else rows.push(`${relative(dir, p)}\t${String(st.size)}`);
    }
  };
  walk(dir);
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}

function build(cwd: string, env: Record<string, string>, what: string): void {
  try {
    execFileSync('bun', ['run', 'build'], { cwd, env: { ...process.env, ...env }, stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    throw new Error(`dựng ${what} hỏng.\n--- stdout ---\n${err.stdout ?? ''}\n--- stderr ---\n${err.stderr ?? ''}`);
  }
}

/** Chạy một công cụ của `tools/registry` đúng như workflow publish chạy nó. */
function runRegistryTool(script: string, args: string[]): string {
  try {
    return execFileSync('bun', [join('tools', 'registry', 'src', script), ...args], {
      cwd: REPO_ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    throw new Error(`${script} hỏng.\n--- stdout ---\n${err.stdout ?? ''}\n--- stderr ---\n${err.stderr ?? ''}`);
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Máy chủ tĩnh cho `_site` của registry — cùng khuôn `s3.spec.ts`.
 *
 * `access-control-allow-origin: *` và **không gì khác**: một `fetch` không đặt
 * header nào là CORS ĐƠN GIẢN, không preflight — đúng thứ GitHub Pages phục
 * vụ được. Không SPA fallback: một fallback biến "thiếu tệp" thành "200 kèm
 * HTML" ở mọi đường dẫn và giấu mất một đường dẫn sai.
 */
function serveRegistry(rootDir: string, port: number): Promise<Server> {
  const srv = createServer((req, res) => {
    const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0] as string);
    const rel = rawPath === '/' ? 'index.json' : rawPath.replace(/^\/+/, '');
    const file = resolve(rootDir, rel);
    if (!file.startsWith(rootDir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, {
        'content-type': 'text/plain; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      res.end(`không có ${rel}`);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    });
    res.end(readFileSync(file));
  });
  return new Promise((ok, no) => {
    srv.once('error', no);
    srv.listen(port, '127.0.0.1', () => {
      ok(srv);
    });
  });
}

function closeServer(srv: Server | null): Promise<void> {
  if (!srv) return Promise.resolve();
  return new Promise((ok) => {
    srv.closeAllConnections();
    srv.close(() => {
      ok();
    });
  });
}

// ───────────────────────── dựng gói ─────────────────────────

const MANIFEST_FILE = 'manifest.json';
const decodeUtf8 = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes);
const encodeUtf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * Đọc gói nguồn từ đĩa thành `đường dẫn trong gói → bytes`.
 *
 * Đọc **thư mục** và **đệ quy theo thư mục thật** thay vì liệt kê tên tệp, để
 * một chương mới thêm vào gói mẫu không âm thầm bị bỏ ra ngoài. Cùng khuôn
 * `s1.spec.ts` — chép chứ không nhập, vì nhập một tệp `*.spec.ts` khác sẽ
 * **đăng ký lại toàn bộ bài kiểm của tệp ấy** vào tệp này.
 */
function readPackageDir(dir: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (abs: string, rel: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childAbs = join(abs, entry.name);
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile()) out.set(childRel, new Uint8Array(readFileSync(childAbs)));
    }
  };
  walk(dir, '');
  expect(
    out.has(MANIFEST_FILE),
    `không đọc được gói mẫu ở ${dir} — cổng này chạy trên gói CÔNG KHAI trong repo, không trên một gói dựng bằng tay`,
  ).toBe(true);
  return out;
}

/** Đóng `files` thành `.zip` — cùng hình dạng `packZip` ghi ra (tên sắp xếp, `level: 9`). */
function packToZip(files: ReadonlyMap<string, Uint8Array>): Buffer {
  const zippable: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  for (const name of [...files.keys()].sort()) zippable[name] = files.get(name) as Uint8Array;
  return Buffer.from(zipSync(zippable, { level: 9 }));
}

/**
 * Thay **đúng một** lần xuất hiện. "Đúng một" được **khẳng định**, không được
 * giả định: 0 chỗ khớp nghĩa là biến thể giống hệt bản gốc và cả một kịch bản
 * trở thành phép kiểm rằng không có gì xảy ra.
 */
function replaceOnce(files: Map<string, Uint8Array>, name: string, from: string, to: string): void {
  const before = files.get(name);
  expect(before, `gói mẫu không có tệp ${name}`).toBeDefined();
  const text = decodeUtf8(before as Uint8Array);
  const hits = text.split(from).length - 1;
  expect(hits, `phép sửa "${from.slice(0, 48)}…" trong ${name} khớp ${String(hits)} chỗ, phải đúng 1`).toBe(1);
  files.set(name, encodeUtf8(text.replace(from, to)));
}

/**
 * Cây course của registry cho lần chạy này. Đọc `fixtures/courses/` và **GHI
 * vào scratch** — không một byte nào của `fixtures/` bị sửa (`cpSync` chỉ đọc
 * bên nguồn).
 *
 * `manifest.id` phải bằng tên thư mục — `tools/registry/src/tree.ts` báo
 * `REGISTRY_ID_MISMATCH` nếu không, và `packSite` từ chối đóng gói.
 */
function buildRegistryTree(): void {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(REGISTRY_ROOT, { recursive: true });
  mkdirSync(REGISTRY_SITE, { recursive: true });

  const fixtures = resolve(REPO_ROOT, 'fixtures', 'courses');
  for (const spec of [
    { id: RATED_ID, title: RATED_TITLE, from: RATED_FROM },
    { id: SHARED_ID, title: SHARED_TITLE, from: SHARED_FROM },
    { id: DISCUSS_ID, title: DISCUSS_TITLE, from: DISCUSS_FROM },
  ]) {
    const from = join(fixtures, spec.from);
    expect(
      existsSync(from),
      `không tìm thấy gói mẫu ${from} — cổng này chạy trên gói CÔNG KHAI trong repo, không trên một cây dựng lúc chạy test`,
    ).toBe(true);
    const dir = join(REGISTRY_ROOT, spec.id);
    cpSync(from, dir, { recursive: true });
    const manifestPath = join(dir, MANIFEST_FILE);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    manifest.id = spec.id;
    manifest.title = spec.title;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

/** Gói RIÊNG TƯ của kịch bản 2 — id và tiêu đề khác mọi gói registry. */
function buildPrivatePackage(): Buffer {
  const files = readPackageDir(resolve(REPO_ROOT, 'fixtures', 'courses', PRIVATE_FROM));
  replaceOnce(files, MANIFEST_FILE, `"id": "${PRIVATE_FROM}"`, `"id": "${PRIVATE_ID}"`);
  replaceOnce(files, MANIFEST_FILE, '"title": "Bất biến vòng lặp"', `"title": "${PRIVATE_TITLE}"`);
  return packToZip(files);
}

// ───────────────────────── dựng / dọn ─────────────────────────

/** `GET /me` **từ trong trang** — cookie thật, origin thật, CORS thật. */
async function readMe(page: Page): Promise<{ id: string; email: string }> {
  return page.evaluate(
    async ({ apiUrl }: { apiUrl: string }) => {
      const res = await fetch(`${apiUrl}/me`, { credentials: 'include' });
      const body = (await res.json()) as { id?: unknown; email?: unknown };
      return { id: String(body.id), email: String(body.email) };
    },
    { apiUrl: API_ORIGIN },
  );
}

/**
 * Đẩy một gói lên thư viện máy chủ của người đang đăng nhập ở `page`.
 *
 * Bằng `fetch` **từ trong trang**, không bằng `page.request`: cái sau là một
 * client HTTP của Playwright dùng chung lọ cookie, cái này đi qua cookie của
 * trình duyệt, origin thật của ứng dụng và CORS thật — nên một `CORS_ORIGIN`
 * đặt sai hỏng **ở đây**, ồn ào, chứ không âm thầm thành công. Cùng lý do
 * `s1.spec.ts` ghi cho `uploadPackageToServer`.
 *
 * Đây là **dựng bối cảnh** ("người đọc này có một giáo trình riêng"), không
 * phải đi vòng qua giao diện đang được kiểm: thứ đang được kiểm ở kịch bản 2
 * là **màn hình thư viện**, và mọi khẳng định ở đó đọc màn hình.
 */
async function uploadPrivatePackage(page: Page, zip: Buffer): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ apiUrl, base64 }: { apiUrl: string; base64: string }) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const form = new FormData();
      form.append('package', new Blob([bytes], { type: 'application/zip' }), 'course.zip');
      const res = await fetch(`${apiUrl}/courses`, { method: 'POST', body: form, credentials: 'include' });
      return { status: res.status, body: await res.text() };
    },
    { apiUrl: API_ORIGIN, base64: zip.toString('base64') },
  );
}

interface ServerState {
  coursesStatus: number;
  courseIds: string[];
  ratingsStatus: number;
  ratings: { id: string; count: number; average: number; mine: number }[];
}

/** `GET /courses` và `GET /ratings?ids=…` từ trong trang — ba chốt tiền đề của mục 4. */
async function readServerState(page: Page, ids: readonly string[]): Promise<ServerState> {
  return page.evaluate(
    async ({ apiUrl, wanted }: { apiUrl: string; wanted: string[] }) => {
      const courses = await fetch(`${apiUrl}/courses`, { credentials: 'include' });
      const courseBody: unknown = await courses.json();
      const ratings = await fetch(`${apiUrl}/ratings?ids=${encodeURIComponent(wanted.join(','))}`, {
        credentials: 'include',
      });
      const ratingBody: unknown = await ratings.json();
      return {
        coursesStatus: courses.status,
        courseIds: Array.isArray(courseBody)
          ? courseBody.map((row: { id?: unknown }) => String(row.id))
          : ['(hồi đáp không phải một mảng)'],
        ratingsStatus: ratings.status,
        ratings: (Array.isArray(ratingBody) ? ratingBody : []) as ServerState['ratings'],
      };
    },
    { apiUrl: API_ORIGIN, wanted: [...ids] },
  );
}

/** Đăng ký một tài khoản MỚI qua chính màn hình đăng ký, và giữ lại phiên của nó. */
async function registerAccount(
  browser: Browser,
): Promise<{ account: Account; context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: WEB_ORIGIN });
  const page = await context.newPage();
  const email = freshEmail();
  await page.goto(`${WEB_ORIGIN}/login`);
  await registerNewUser(page, email, PASSWORD);
  const me = await readMe(page);
  expect(me.email, 'GET /me không trả về email vừa đăng ký').toBe(email);
  expect(me.id, 'GET /me không trả về một id người dùng').not.toBe('undefined');
  const state = await context.storageState();
  expect(state.cookies.length, 'đăng ký xong mà không có cookie phiên nào').toBeGreaterThan(0);
  return { account: { email, userId: me.id, state }, context, page };
}

test.beforeAll(async ({ browser }) => {
  // Hai lệnh `bun` cộng một lần `tsc -b && vite build`: đây là ngân sách hạ
  // tầng, không phải một chốt nào đang chờ.
  test.setTimeout(900_000);

  const registryPort = await freePort();
  registryOrigin = `http://127.0.0.1:${String(registryPort)}`;

  buildRegistryTree();

  // ĐÚNG hai lệnh mà `.github/workflows/registry.yml` chạy, cùng thứ tự.
  const packOut = runRegistryTool('pack-site.ts', ['--root', REGISTRY_ROOT, '--out', REGISTRY_SITE]);
  const indexOut = runRegistryTool('build-index.ts', [
    '--root',
    REGISTRY_ROOT,
    '--out',
    join(REGISTRY_SITE, 'index.json'),
  ]);

  // ── CHỐT CHỐNG CỔNG MÙ #1: registry có ĐÚNG ba gói ta nghĩ nó có ────────
  // Không có khối này, một `pack-site` sinh 0 gói hiện ra ở mọi kịch bản dưới
  // dạng "không tìm thấy hàng" — trông y hệt một hồi quy của mã ứng dụng.
  const index = JSON.parse(readFileSync(join(REGISTRY_SITE, 'index.json'), 'utf8')) as {
    schema: number;
    courses: { id: string; latest: string }[];
  };
  expect(index.schema, `schema lạ trong index.json vừa sinh\n${indexOut}`).toBe(1);
  expect(
    index.courses.map((c) => c.id).sort(),
    `index.json vừa sinh không có ba gói mong đợi\n${indexOut}`,
  ).toEqual([RATED_ID, SHARED_ID, DISCUSS_ID].sort());
  for (const c of index.courses) {
    expect(
      existsSync(join(REGISTRY_SITE, 'courses', c.id, `${c.latest}.zip`)),
      `pack-site không ghi gói của ${c.id}\n${packOut}`,
    ).toBe(true);
  }

  // ── dựng lại bundle với VITE_REGISTRY_URL của lần chạy này ──────────────
  expect(
    existsSync(WEB_DIST),
    `${WEB_DIST} chưa tồn tại — webServer của playwright.config.ts đã dựng chưa?`,
  ).toBe(true);
  rmSync(WEB_DIST_BACKUP, { recursive: true, force: true });
  cpSync(WEB_DIST, WEB_DIST_BACKUP, { recursive: true });
  distFingerprintBefore = fingerprint(WEB_DIST_BACKUP);

  build(WEB_DIR, { VITE_REGISTRY_URL: registryOrigin, VITE_API_URL: API_ORIGIN }, 'apps/web (có VITE_REGISTRY_URL)');

  // ── CHỐT CHỐNG CỔNG MÙ #2: biến môi trường VÀO ĐƯỢC bundle ─────────────
  const bundles = readdirSync(join(WEB_DIST, 'assets'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(WEB_DIST, 'assets', f), 'utf8'));
  expect(
    bundles.some((b) => b.includes(registryOrigin)),
    `bundle vừa dựng không chứa ${registryOrigin} — VITE_REGISTRY_URL không vào được bản dựng, ` +
      'và mọi kịch bản dưới sẽ đo một catalog rỗng',
  ).toBe(true);

  registryServer = await serveRegistry(REGISTRY_SITE, registryPort);

  const probe = await fetch(`${registryOrigin}/index.json`);
  expect(probe.status, `${registryOrigin}/index.json không trả 200`).toBe(200);
  expect(probe.headers.get('access-control-allow-origin')).toBe('*');

  // ── hai lần đăng ký cho cả năm bài (xem mục 3) ──────────────────────────
  const a = await registerAccount(browser);
  const b = await registerAccount(browser);
  accountA = a.account;
  accountB = b.account;
  expect(accountA.userId, 'A và B nhận cùng một id người dùng').not.toBe(accountB.userId);
  expect(accountA.email).not.toBe(accountB.email);
  await b.context.close();

  // ── giáo trình RIÊNG TƯ của A ──────────────────────────────────────────
  const uploaded = await uploadPrivatePackage(a.page, buildPrivatePackage());
  expect(uploaded.status, `POST /courses trả ${String(uploaded.status)}: ${uploaded.body}`).toBe(201);
  expect(uploaded.body, 'POST /courses không nhắc tới id vừa đẩy lên').toContain(PRIVATE_ID);

  // ── CHỐT CHỐNG CỔNG MÙ #3: "TÔI CÓ ĐANG NÓI CHUYỆN VỚI ĐÚNG API KHÔNG" ──
  // Cổng 8089 trên máy này đang bị một bản tuhoc API LẠ chiếm và nó trả
  // `{"ok":true}` cho `/healthz`. `/healthz` vì thế **không** phân biệt được
  // stack của lần chạy này với stack của người khác. Ba câu dưới thì có.
  const serverState = await readServerState(a.page, [RATED_ID, SHARED_ID, DISCUSS_ID]);
  expect(serverState.coursesStatus).toBe(200);
  expect(
    serverState.courseIds,
    `thư viện máy chủ của A phải chứa ĐÚNG gói riêng vừa đẩy lên, không hơn — nhận: ${serverState.courseIds.join(', ')}. ` +
      'Nhiều hơn nghĩa là cơ sở dữ liệu này KHÔNG phải cơ sở dữ liệu vừa dựng của lần chạy này.',
  ).toEqual([PRIVATE_ID]);
  expect(serverState.ratingsStatus, 'GET /ratings?ids=… không trả 200').toBe(200);
  expect(
    serverState.ratings.map((r) => `${r.id}=${String(r.count)}`).sort(),
    'GET /ratings phải trả về ĐỦ BA id được hỏi (kể cả id chưa ai chấm — chúng vẫn được trả về với ' +
      'count 0, để catalog dựng được đủ hàng) và cả ba phải chưa có phiếu nào. Đây là tiền đề của ' +
      'kịch bản 1 và 3, và với id mang vân tay lần chạy nó cũng là phép kiểm rằng vân tay ấy thật sự MỚI.',
  ).toEqual([`${RATED_ID}=0`, `${SHARED_ID}=0`, `${DISCUSS_ID}=0`].sort());

  await a.context.close();
});

test.afterAll(async () => {
  await closeServer(registryServer);
  registryServer = null;

  // Trả `dist/` về nguyên trạng, và CHỨNG MINH đã trả về — xem mục 6.
  if (existsSync(WEB_DIST_BACKUP)) {
    rmSync(WEB_DIST, { recursive: true, force: true });
    renameSync(WEB_DIST_BACKUP, WEB_DIST);
    expect(fingerprint(WEB_DIST), 'dist/ KHÔNG được trả về nguyên trạng').toBe(distFingerprintBefore);
  }
  rmSync(SCRATCH, { recursive: true, force: true });
});

// ───────────────────────── đồ nghề dùng chung ─────────────────────────

interface ApiEcho {
  readonly url: string;
  readonly status: number;
  readonly body: string;
}

interface Session {
  readonly context: BrowserContext;
  readonly page: Page;
  /** Mọi URL request mà trình duyệt phát ra, theo thứ tự. */
  readonly requests: string[];
  /**
   * Thân của **mọi** hồi đáp đến từ API — không chỉ `/ratings`.
   *
   * Kịch bản 3 hỏi *"có request nào của A mang danh tính của B về không"*, và
   * "request nào" phải nghĩa là **request nào cũng được**: một `voters` gắn
   * nhầm vào `/stats`, `/courses` hay `/sync` rò rỉ đúng bằng một `voters`
   * gắn vào `/ratings`. Lọc trước theo đường dẫn là tự chọn chỗ để nhìn.
   */
  readonly apiBodies: ApiEcho[];
  /** Lỗi console/pageerror, đã lọc 401 lành tính của `GET /me`. */
  readonly noise: string[];
  /** Đợi mọi phép đọc thân hồi đáp đang bay xong, trước khi khẳng định trên `apiBodies`. */
  settle: () => Promise<void>;
}

/**
 * Một context ĐÃ ĐĂNG NHẬP, **mượn phiên** của `beforeAll` — 0 lời gọi `/auth/*`.
 *
 * Mỗi bài lấy một context RIÊNG (lọ cookie riêng, phân vùng IndexedDB riêng)
 * dựng từ `storageState` đã lưu, nên "A không thấy phiếu của B" không bao giờ
 * có thể là "A đọc bản lưu của chính A từ bài trước".
 */
async function signedIn(browser: Browser, account: Account): Promise<Session> {
  const context = await browser.newContext({ baseURL: WEB_ORIGIN, storageState: account.state });
  const requests: string[] = [];
  const apiBodies: ApiEcho[] = [];
  const noise: string[] = [];
  const inFlight: Promise<void>[] = [];

  context.on('request', (r) => {
    requests.push(r.url());
  });
  context.on('response', (r) => {
    if (!r.url().startsWith(API_ORIGIN)) return;
    inFlight.push(
      r
        .text()
        .then((body) => {
          apiBodies.push({ url: r.url(), status: r.status(), body });
        })
        .catch(() => {
          // Một hồi đáp không đọc lại được thân (redirect, bị huỷ) — ghi lại
          // sự thật ấy thay vì bỏ qua im lặng, để phép quét ở kịch bản 3
          // không tưởng nó đã đọc mọi thứ.
          apiBodies.push({ url: r.url(), status: r.status(), body: '(không đọc lại được thân)' });
        }),
    );
  });

  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (isBenignAuthCheck401(msg)) return;
    noise.push(msg.text());
  });
  page.on('pageerror', (err) => noise.push(`pageerror: ${err.message}`));

  return {
    context,
    page,
    requests,
    apiBodies,
    noise,
    settle: async () => {
      await Promise.all([...inFlight]);
    },
  };
}

/**
 * *"Tôi có đang nhìn đúng trang không"* — trả lời **trước** khi đo bất cứ gì.
 *
 * Ba agent đã suýt kết luận sai vì Playwright lái nhầm một ứng dụng đang giữ
 * một cổng quen thuộc. Hai chốt, vì một mình chốt origin không đủ: một máy chủ
 * lạ ở đúng cổng ấy cũng cho origin đúng.
 */
async function expectRightApp(page: Page): Promise<void> {
  expect(page.url().startsWith(WEB_ORIGIN), `trang đang mở là ${page.url()}`).toBe(true);
  await expect(page.getByRole('navigation', { name: VI.navMain })).toBeVisible();
}

/**
 * Vào kho cộng đồng BẰNG CÁCH BẤM, không bằng cách gõ URL (ruling S1-F29).
 *
 * Hai cú bấm chứ không còn một: kho cộng đồng nay là TAB bên trong `/courses`,
 * không phải một mục thanh bên (đặc tả IA). Đường đi dài thêm một bước nhưng
 * câu hỏi thì không đổi — người đọc có tới được đây mà không phải gõ URL không.
 */
async function openCatalogByClicking(page: Page): Promise<void> {
  await page.goto(`${WEB_ORIGIN}/`);
  await expectRightApp(page);
  await page
    .getByRole('navigation', { name: VI.navMain })
    .getByRole('link', { name: VI.navCourses })
    .click();
  await page.waitForURL((url) => url.pathname === '/courses');
  await page
    .getByRole('navigation', { name: VI.tabsAria })
    .getByRole('link', { name: VI.tabRegistry })
    .click();
  await page.waitForURL((url) => url.pathname === '/courses' && url.searchParams.get('tab') === 'registry');
  await expect(page.getByRole('heading', { name: VI.catalogTitle })).toBeVisible();
}

function catalogList(page: Page) {
  return page.getByRole('list', { name: VI.catalogListAria });
}

function catalogRow(page: Page, title: string) {
  return catalogList(page).locator('li.lib-item', { hasText: title });
}

/**
 * Câu tóm tắt điểm của một hàng — `Rating.tsx`'s `data-testid`.
 *
 * Một `data-testid` chứ không phải một phép tìm theo chữ, và có lý do: chữ ở
 * đây **là thứ đang được khẳng định** ("4,0/5 · 1 phiếu"), nên tìm phần tử
 * bằng chính chữ ấy sẽ biến mọi khẳng định thành phép lặp. `testid` định vị,
 * `toHaveText` mới là phép đo — và nó là phép so **bằng ĐÚNG cả chuỗi**, nên
 * một bản chỉ vẽ trung bình mà bỏ số phiếu cũng đỏ.
 */
function ratingSummary(page: Page, registryId: string) {
  return page.getByTestId(`rating-summary-${registryId}`);
}

/** Ô chấm `n` sao của một hàng — `<label>` bọc `<input type="radio">`, nên tên = "n sao". */
function starOf(page: Page, title: string, stars: number) {
  return catalogRow(page, title).getByRole('radio', { name: `${String(stars)} sao` });
}

/**
 * Bấm một ngôi sao và **đợi phép ghi thật rời trình duyệt và được trả lời**.
 *
 * Nghe TRƯỚC khi bấm: `fetch` của trang có thể trả lời xong trước khi `click()`
 * trả về, và một `waitForResponse` gắn sau cú bấm sẽ bỏ lỡ (cùng cái bẫy mà
 * `helpers.ts`'s `submitAuthForm` đã ghi lại).
 */
async function clickStar(page: Page, title: string, registryId: string, stars: number): Promise<number> {
  const answered = page.waitForResponse(
    (r) => r.url() === `${API_ORIGIN}/ratings/${registryId}` && r.request().method() === 'PUT',
    { timeout: 20_000 },
  );
  await starOf(page, title, stars).click();
  const res = await answered;
  return res.status();
}

/** Đường dẫn (không origin) của mọi request tới API kể từ `from`, đã lọc trùng và sắp xếp. */
function apiPathsSince(requests: readonly string[], from: number): string[] {
  const seen = new Set<string>();
  for (const url of requests.slice(from)) {
    if (url.startsWith(API_ORIGIN)) seen.add(url.slice(API_ORIGIN.length));
  }
  return [...seen].sort();
}

/** Chỉ những đường dẫn `/ratings…` — dùng cho hàng rào riêng tư ở kịch bản 2. */
function ratingsPathsSince(requests: readonly string[], from: number): string[] {
  return apiPathsSince(requests, from).filter((p) => p.startsWith('/ratings'));
}

/**
 * Bốn phép đo ĐỘC LẬP cho *"màn hình này không có ô chấm sao nào"*.
 *
 * Bốn chứ không một, vì một cài đặt có thể vẽ ô chấm mà thiếu một trong bốn
 * dấu vết: một `<fieldset>` không `<legend>` mất `role="group"`, một hàng nút
 * thay cho radio mất `role="radio"`, một bản sao chép lớp CSS mất
 * `.rating-star`. Cái thứ tư — **không một lời gọi `/ratings` nào** — là cái
 * duy nhất còn đúng khi ô chấm được vẽ *ẩn*.
 */
async function expectNoStarsAnywhere(page: Page, requests: readonly string[], from: number, where: string): Promise<void> {
  await expect(page.getByRole('radio'), `${where}: có ô chấm sao (role=radio) trên một màn hình KHÔNG phải catalog`).toHaveCount(0);
  await expect(
    page.getByRole('group', { name: VI.ratingLegend }),
    `${where}: có nhóm "${VI.ratingLegend}" trên một màn hình KHÔNG phải catalog`,
  ).toHaveCount(0);
  await expect(page.locator('.rating-star'), `${where}: có phần tử .rating-star`).toHaveCount(0);
  await expect(page.locator('.rating'), `${where}: có phần tử .rating`).toHaveCount(0);
  expect(
    ratingsPathsSince(requests, from),
    `${where}: màn hình này đã hỏi /ratings. Tầng Go KHÔNG phân biệt được id registry với id ` +
      'course riêng tư (nó không bao giờ đọc index.json, và TestAPIProductCodeMakesNoOutboundCall ' +
      'là lý do nó không bao giờ đọc được), nên hàng rào của nó là "không route nào LIỆT KÊ" — ' +
      'và tính chất ấy chỉ đúng chừng nào không client nào gửi id riêng tư đi.',
  ).toEqual([]);
}

// ═══════════════════════════════════════════════════════════════════════════
// KỊCH BẢN 1 — CHẤM SAO → TẢI LẠI → PHIẾU CÒN ĐÓ → SỬA ĐƯỢC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ba tính chất, và cái thứ ba là cái duy nhất chỉ đo được đầu-cuối.
 *
 *   1. **Phiếu sống sót qua một lần tải lại.** Không phải "state của React còn
 *      đó" — một lần `reload()` xoá sạch bộ nhớ của TanStack Query, nên ngôi
 *      sao được tô lại chỉ có thể đến từ `mine` mà máy chủ vừa trả về.
 *   2. **Sửa được, và sửa KHÔNG phải thêm phiếu.** Đây là chỗ khẳng định trên
 *      **số phiếu** làm việc thật: sau lần chấm thứ hai, màn hình phải nói
 *      *"2,0/5 · 1 phiếu"*. Một cài đặt ghi thêm hàng mới cho mỗi cú bấm cho
 *      ra **cùng một trung bình** ở lần sửa đầu tiên nếu chỉ nhìn trung bình
 *      — `PRIMARY KEY (user_id, registry_id)` là thứ giữ con số ấy ở 1, và
 *      đây là chỗ duy nhất trong repo mà khoá chính ấy được nhìn **từ phía
 *      người dùng**.
 *   3. **Hàng KHÁC không đổi.** Một cài đặt vẽ cùng một tóm tắt cho mọi hàng
 *      (một `useQuery` không khoá theo id, một `Map` tra nhầm) đi qua được cả
 *      hai tính chất trên. Nó chết ở đây.
 */
test('kịch bản 1 — chấm sao một course registry, tải lại, phiếu còn đó, và sửa được', async ({ browser }) => {
  test.setTimeout(180_000);
  const s = await signedIn(browser, accountA as Account);
  try {
    await openCatalogByClicking(s.page);

    // ── đối chứng: ba hàng, và chưa ai chấm gì ────────────────────────────
    await expect(catalogList(s.page).locator('li.lib-item')).toHaveCount(3);
    await expect(
      ratingSummary(s.page, RATED_ID),
      'hàng này đã có phiếu trước khi bài bắt đầu — tiền đề của kịch bản 1 hỏng',
    ).toHaveText(VI.ratingNone);
    await expect(ratingSummary(s.page, SHARED_ID)).toHaveText(VI.ratingNone);
    await expect(
      starOf(s.page, RATED_TITLE, 4),
      'ô chấm sao KHÔNG có trên màn hình — mọi khẳng định dưới đây sẽ rỗng',
    ).toBeVisible();
    await expect(starOf(s.page, RATED_TITLE, 4)).not.toBeChecked();

    // ── chấm 4 sao ────────────────────────────────────────────────────────
    expect(await clickStar(s.page, RATED_TITLE, RATED_ID, 4), 'PUT /ratings không trả 204').toBe(204);
    await expect(s.page.getByText(VI.ratingSaved)).toBeVisible();
    await expect(ratingSummary(s.page, RATED_ID)).toHaveText(summaryText('4,0', 1));
    await expect(
      ratingSummary(s.page, SHARED_ID),
      'chấm một hàng làm đổi tóm tắt của hàng KHÁC — điểm đang được tra nhầm khoá',
    ).toHaveText(VI.ratingNone);

    // ── TẢI LẠI: phiếu còn đó, và nó đến từ máy chủ ───────────────────────
    await s.page.reload();
    await expectRightApp(s.page);
    await expect(ratingSummary(s.page, RATED_ID)).toHaveText(summaryText('4,0', 1));
    await expect(
      starOf(s.page, RATED_TITLE, 4),
      'sau khi tải lại, ngôi sao của người đọc KHÔNG được tô — `mine` không đi qua được ranh giới, ' +
        'hoặc phép ghi không lưu lại gì',
    ).toBeChecked();
    // Câu "Đã lưu điểm của bạn." là trạng thái của MỘT lần bấm, không phải một
    // nhãn dán vĩnh viễn: nếu nó còn sau khi tải lại thì nó không nói gì cả.
    await expect(s.page.getByText(VI.ratingSaved)).toHaveCount(0);

    // ── SỬA: 4 → 2, và số phiếu VẪN LÀ 1 ──────────────────────────────────
    expect(await clickStar(s.page, RATED_TITLE, RATED_ID, 2), 'PUT sửa điểm không trả 204').toBe(204);
    await expect(
      ratingSummary(s.page, RATED_ID),
      'sau khi sửa, màn hình phải nói "2,0/5 · 1 phiếu". Hai cách hỏng đều rơi vào chốt này, và chúng ' +
        'là hai lỗi khác nhau: SỐ PHIẾU tăng nghĩa là mỗi cú bấm ghi một hàng mới thay vì đè lên hàng ' +
        'cũ (khoá chính `(user_id, registry_id)` là thứ phải giữ con số ấy ở 1); TRUNG BÌNH không đổi ' +
        'nghĩa là phép ghi đè im lặng không xảy ra (`ON CONFLICT … DO NOTHING`), tức "sửa được" là lời ' +
        'hứa suông — máy chủ vẫn trả 204 trong cả hai trường hợp.',
    ).toHaveText(summaryText('2,0', 1));

    await s.page.reload();
    await expectRightApp(s.page);
    await expect(ratingSummary(s.page, RATED_ID)).toHaveText(summaryText('2,0', 1));
    await expect(starOf(s.page, RATED_TITLE, 2)).toBeChecked();
    await expect(starOf(s.page, RATED_TITLE, 4), 'ngôi sao CŨ vẫn còn được tô sau khi sửa').not.toBeChecked();

    expect(s.noise, `console/page errors: ${s.noise.join(' | ')}`).toEqual([]);
  } finally {
    await s.context.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// KỊCH BẢN 2 — COURSE RIÊNG TƯ KHÔNG CÓ Ô CHẤM SAO NÀO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hàng rào riêng tư **ở tầng cao nhất**, và ba lý do bài này không thừa.
 *
 * 1. **Nó mở đầu bằng ĐỐI CHỨNG DƯƠNG, trên cùng người đọc và cùng trình
 *    duyệt.** `/catalog` phải có **đúng ba** nhóm chấm sao trước khi bất kỳ
 *    khẳng định "không có ô chấm" nào được tin. Không có nó, bài này xanh
 *    trọn vẹn trên một bản dựng mà tính năng chấm sao hỏng hoàn toàn — đúng
 *    hình dạng cổng mù mà dự án đã ghi năm lần.
 *
 * 2. **Nó đi qua BA màn hình mà người đọc thật sự tới**, và tới bằng cách
 *    **bấm**: tab "Của bạn" của `/courses`, rồi nhan đề của chính course
 *    riêng tư → `/c/:courseId`, rồi thanh điều hướng → `/`. `ratingFence`
 *    dựng ba màn hình ấy trong jsdom; ở đây chúng là bản dựng production,
 *    CSS thật, router thật.
 *
 *    Từ khi ba màn cũ gộp vào `/courses` (đặc tả IA), bước đầu tiên đo thêm
 *    một điều: đối chứng dương ở ngay trên đứng trên TAB BÊN CẠNH, nên "không
 *    ô chấm nào" ở đây chỉ đúng nếu đổi tab thật sự THÁO `Catalog` khỏi cây.
 *
 * 3. **Nó hỏi ở TẦNG MẠNG, không chỉ ở tầng DOM.** `expectNoStarsAnywhere`
 *    đòi **không một lời gọi `/ratings` nào** rời khỏi những màn hình ấy —
 *    tính chất mà tầng Go **phải** dựa vào (§2.5 của `task-2-3-report.md`:
 *    hàng rào ở đó là *không route nào liệt kê*, và nó chỉ đúng chừng nào
 *    không client nào gửi id riêng tư đi). Một ô chấm được vẽ **ẩn** vẫn hỏi.
 */
test('kịch bản 2 — course riêng tư không có ô chấm sao nào, trên ba màn hình thật', async ({ browser }) => {
  test.setTimeout(180_000);
  const s = await signedIn(browser, accountA as Account);
  try {
    // ── ĐỐI CHỨNG DƯƠNG: cùng người đọc, /catalog CÓ ô chấm ───────────────
    await openCatalogByClicking(s.page);
    await expect(
      s.page.getByRole('group', { name: VI.ratingLegend }),
      'catalog KHÔNG có ô chấm sao nào — mọi khẳng định "không có ô chấm" dưới đây sẽ là khẳng định rỗng',
    ).toHaveCount(3);

    // ── (a) thư viện của người đọc — tab "Của bạn" của /courses ───────────
    // Rời tab kho cộng đồng bằng cách bấm chính cái tab bên cạnh: đó là đường
    // người đọc thật đi, và nó cũng chứng minh `Catalog` THÔI được dựng — nếu
    // hai tab cùng nằm trên cây thì ba ô chấm sao của đối chứng dương ngay
    // trên kia vẫn còn đó, và mọi khẳng định "không ô chấm nào" dưới đây thành
    // ra đo nhầm màn hình.
    await s.page
      .getByRole('navigation', { name: VI.tabsAria })
      .getByRole('link', { name: VI.tabYours })
      .click();
    await s.page.waitForURL((url) => url.pathname === '/courses' && url.searchParams.get('tab') === null);

    const libraryRow = s.page
      .getByRole('list', { name: VI.libraryListAria })
      .locator('li.lib-item', { hasText: PRIVATE_TITLE });
    await expect(libraryRow, 'giáo trình riêng của A không có trong thư viện — bối cảnh của bài này chưa dựng xong').toHaveCount(1);
    // Và nó THẬT SỰ là riêng tư, không phải một hàng registry nhìn nhầm.
    await expect(
      libraryRow.locator('.lib-source-private'),
      'hàng này không mang nhãn nguồn "riêng tư" — bài đang đo nhầm loại course',
    ).toHaveText(VI.sourcePrivate);
    const afterLibrary = s.requests.length;
    await expectNoStarsAnywhere(s.page, s.requests, afterLibrary, '/courses (tab "Của bạn")');

    // ── (b) /c/:courseId của chính course riêng tư ────────────────────────
    await libraryRow.getByRole('link', { name: PRIVATE_TITLE }).click();
    await s.page.waitForURL((url) => url.pathname === `/c/${PRIVATE_ID}`);
    // Đối chứng dương: course RIÊNG TƯ ấy thật sự mở ra được. Một trang trắng
    // cũng "không có ô chấm nào".
    await expect(
      s.page.getByRole('navigation', { name: PRIVATE_TITLE }),
      'trang course riêng tư không mở ra — "không có ô chấm" ở đây sẽ là một khẳng định rỗng',
    ).toBeVisible({ timeout: 30_000 });
    const afterCourse = s.requests.length;
    await expectNoStarsAnywhere(s.page, s.requests, afterCourse, `/c/${PRIVATE_ID}`);

    // ── (c) bảng điều khiển ───────────────────────────────────────────────
    await s.page
      .getByRole('navigation', { name: VI.navMain })
      .getByRole('link', { name: VI.navDashboard })
      .click();
    await s.page.waitForURL((url) => url.pathname === '/');
    await expect(
      s.page.getByText(PRIVATE_TITLE).first(),
      'bảng điều khiển không nhắc tới course riêng tư — không có gì để không-chấm-sao ở đây',
    ).toBeVisible({ timeout: 30_000 });
    const afterDashboard = s.requests.length;
    await expectNoStarsAnywhere(s.page, s.requests, afterDashboard, '/');

    expect(s.noise, `console/page errors: ${s.noise.join(' | ')}`).toEqual([]);
  } finally {
    await s.context.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// KỊCH BẢN 3 — B KHÔNG THẤY ĐƯỢC AI ĐÃ CHẤM GÌ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Phép đo nằm ở **TẦNG MẠNG**, và đó là toàn bộ lý do bài này tồn tại.
 *
 * `assertRatings` **dựng lại** đối tượng từ đúng bốn trường. Hệ quả đúng —
 * sau ranh giới, `voters` không tồn tại — nhưng cũng có nghĩa là **không một
 * bài đơn vị nào ở phía web nhìn thấy được một `voters` đã đi qua dây**. Nó
 * vẫn rời khỏi máy chủ, vẫn nằm trong bộ nhớ trình duyệt của người lạ, vẫn
 * vào devtools của họ. `Rating.test.tsx` không thấy; `ratingFence` không thấy;
 * `TestListReturnsAggregateNotVoters` phía Go thấy — nhưng nó là **một tiến
 * trình khác, một ngôn ngữ khác, một chu kỳ triển khai khác**, đúng lý do mà
 * `db/local.test.ts` từ chối lập luận "chỗ khác đã kiểm rồi".
 *
 * Nên bài này soi **thân thô của MỌI hồi đáp API** mà trình duyệt của A nhận
 * được — không lọc trước theo đường dẫn — và đòi ba điều:
 *
 *   · không thân nào chứa **email của B**;
 *   · không thân nào chứa **id người dùng của B**;
 *   · mỗi mục của `/ratings` có **đúng tập khoá** `{id, average, count, mine}`
 *     (so tập khoá, không phải parse-vào-struct: đó đúng là bài học `voters`
 *     mà đột biến M4 của Task 3 dạy — mọi khẳng định phân tích-vào-struct đều
 *     sống sót trước nó).
 *
 * Và **chốt chống cổng mù**: email của **chính A** phải xuất hiện ít nhất một
 * lần trong đống thân ấy (`GET /me` trả nó). Không có chốt đó, một phép quét
 * đọc nhầm chỗ — hay đọc không được thân nào — cho ra đúng cùng một màu xanh.
 */
test('kịch bản 3 — hai người chấm cùng một course: A thấy trung bình, số phiếu, phiếu CỦA MÌNH, và không gì khác', async ({
  browser,
}) => {
  test.setTimeout(180_000);

  // ── B chấm trước, trong context RIÊNG của B ────────────────────────────
  const b = await signedIn(browser, accountB as Account);
  try {
    await openCatalogByClicking(b.page);
    await expect(ratingSummary(b.page, SHARED_ID)).toHaveText(VI.ratingNone);
    expect(await clickStar(b.page, SHARED_TITLE, SHARED_ID, 5), 'phiếu của B không được nhận').toBe(204);
    await expect(ratingSummary(b.page, SHARED_ID)).toHaveText(summaryText('5,0', 1));
    expect(b.noise, `console/page errors (B): ${b.noise.join(' | ')}`).toEqual([]);
  } finally {
    await b.context.close();
  }

  // ── A mở catalog, trong một context KHÁC (lọ cookie khác, Dexie khác) ──
  const a = await signedIn(browser, accountA as Account);
  try {
    await openCatalogByClicking(a.page);

    // A thấy phiếu của B trong TRUNG BÌNH…
    await expect(
      ratingSummary(a.page, SHARED_ID),
      'A không thấy phiếu của B trong tổng hợp — hoặc phép ghi của B hỏng, hoặc /ratings đang trả về ' +
        'phiếu của riêng người gọi thay vì tổng hợp',
    ).toHaveText(summaryText('5,0', 1));
    // …nhưng KHÔNG ngôi sao nào của A được tô: A chưa chấm.
    for (const stars of [1, 2, 3, 4, 5]) {
      await expect(
        starOf(a.page, SHARED_TITLE, stars),
        `phiếu của B hiện ra như phiếu CỦA A (${String(stars)} sao được tô) — "mine" đang đọc từ hàng của người khác`,
      ).not.toBeChecked();
    }

    // A chấm 1 sao → trung bình (5+1)/2 = 3,0 trên HAI phiếu.
    expect(await clickStar(a.page, SHARED_TITLE, SHARED_ID, 1)).toBe(204);
    await expect(ratingSummary(a.page, SHARED_ID)).toHaveText(summaryText('3,0', 2));
    await expect(starOf(a.page, SHARED_TITLE, 1)).toBeChecked();
    await expect(starOf(a.page, SHARED_TITLE, 5), 'phiếu 5 sao của B được tô trên màn hình của A').not.toBeChecked();

    await a.page.reload();
    await expectRightApp(a.page);
    await expect(ratingSummary(a.page, SHARED_ID)).toHaveText(summaryText('3,0', 2));
    await expect(starOf(a.page, SHARED_TITLE, 1)).toBeChecked();
    await expect(starOf(a.page, SHARED_TITLE, 5)).not.toBeChecked();

    // ── TẦNG MẠNG ─────────────────────────────────────────────────────────
    await a.settle();
    const bAccount = accountB as Account;
    const aAccount = accountA as Account;

    expect(a.apiBodies.length, 'không bắt được một thân hồi đáp API nào — phép quét dưới đây sẽ rỗng').toBeGreaterThan(0);
    // Chốt chống cổng mù: một email CÓ THỂ xuất hiện trong đống thân này, và
    // phép quét đọc được nó. (`GET /me` trả email của người gọi.)
    expect(
      a.apiBodies.some((r) => r.body.includes(aAccount.email)),
      'email của CHÍNH A không xuất hiện trong bất kỳ thân hồi đáp nào — phép quét không đọc được thân, ' +
        'nên "không thấy email của B" không chứng minh điều gì',
    ).toBe(true);

    for (const echo of a.apiBodies) {
      expect(
        echo.body.includes(bAccount.email),
        `hồi đáp ${echo.url} (HTTP ${String(echo.status)}) mang EMAIL của người chấm khác về trình duyệt của A`,
      ).toBe(false);
      expect(
        echo.body.includes(bAccount.userId),
        `hồi đáp ${echo.url} (HTTP ${String(echo.status)}) mang ID NGƯỜI DÙNG của người chấm khác về trình duyệt của A`,
      ).toBe(false);
    }

    const ratingEchoes = a.apiBodies.filter((r) => r.url.startsWith(`${API_ORIGIN}/ratings?`));
    expect(ratingEchoes.length, 'trình duyệt của A chưa hề gọi GET /ratings — bài này chưa đo gì').toBeGreaterThan(0);
    for (const echo of ratingEchoes) {
      const rows = JSON.parse(echo.body) as Record<string, unknown>[];
      expect(Array.isArray(rows), `${echo.url}: thân không phải một mảng`).toBe(true);
      for (const row of rows) {
        expect(
          Object.keys(row).sort(),
          `${echo.url}: một mục của /ratings mang thêm trường. Mỗi trường mới ở đây là một điều mới ` +
            'được công bố về phiếu của người khác — và `assertRatings` DỰNG LẠI đối tượng nên không ' +
            'bài đơn vị nào phía web thấy được nó.',
        ).toEqual(['average', 'count', 'id', 'mine']);
      }
      const shared = rows.find((r) => r.id === SHARED_ID);
      expect(shared, `${echo.url}: không có mục nào cho ${SHARED_ID}`).toBeDefined();
    }

    // Mục cuối cùng A nhận được về course ấy: hai phiếu, và `mine` là phiếu CỦA A.
    const last = ratingEchoes[ratingEchoes.length - 1] as ApiEcho;
    const lastShared = (JSON.parse(last.body) as { id: string; count: number; mine: number }[]).find(
      (r) => r.id === SHARED_ID,
    ) as { count: number; mine: number };
    expect(lastShared.count, 'số phiếu trên dây không phải 2').toBe(2);
    expect(lastShared.mine, '`mine` trên dây không phải phiếu của A (1 sao)').toBe(1);

    // Và trên MÀN HÌNH: không chỗ nào trong trang nhắc tới B.
    const shown = await a.page.locator('body').innerText();
    expect(shown.includes(bAccount.email), 'email của B hiện ra trên màn hình của A').toBe(false);
    expect(shown.includes(bAccount.userId), 'id người dùng của B hiện ra trên màn hình của A').toBe(false);

    expect(a.noise, `console/page errors (A): ${a.noise.join(' | ')}`).toEqual([]);
  } finally {
    await a.context.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// KỊCH BẢN 4 — THẢO LUẬN HỎNG, TRANG VẪN ĐỌC ĐƯỢC
// ═══════════════════════════════════════════════════════════════════════════

/** Mọi đường dẫn `/discussions/…` mà trình duyệt đã gọi, kể từ `from`. */
function discussionPathsSince(requests: readonly string[], from: number): string[] {
  return apiPathsSince(requests, from).filter((p) => p.startsWith('/discussions'));
}

/**
 * **4a — TRẠNG THÁI THẬT CỦA HÔM NAY**, đi qua toàn bộ stack thật.
 *
 * `task-5-go-report.md` §7: chưa có repo registry công khai, chưa có token,
 * nên `NewHandlerForConfig` nhận `fetcher = nil` và **mọi** yêu cầu nhận
 * `{loaded:false, reason:"disabled", url:"", comments:[]}`. Đây không phải một
 * ca dựng sẵn — đây là thứ production trả về hôm nay, nên nó là ca **đầu
 * tiên** phải xanh.
 *
 * Ba tính chất, và tính chất giữa là tính chất mà chỉ một trình duyệt thật
 * đếm được:
 *
 *   1. **`disabled` được nói ra bằng CÂU**, không phải bằng mã lý do, không
 *      phải bằng một `role="alert"` (đây không phải lỗi), và không kèm một
 *      liên kết dẫn đi đâu cả (`url` là `""`, nên `githubHref` trả `null` và
 *      nút "đăng bình luận" **biến mất** thay vì trở thành một liên kết chết).
 *   2. **KHÔNG một lời gọi `/discussions` nào rời trang cho tới khi người đọc
 *      MỞ một luồng** — và rồi **đúng một** lời gọi, cho **đúng hàng được
 *      mở**. Hạn ngạch GitHub là **toàn cục** (`MaxOutboundPerWindow = 30`
 *      cho mọi người), nên một catalog tải sẵn 20 hàng tiêu hai phần ba hạn
 *      ngạch của người khác trong một lần xem trang. Bản tải-sẵn-rồi-giấu vẽ
 *      ra màn hình **y hệt**: chỉ số lời gọi phân biệt được chúng (bài học
 *      S2 Task 9, và đột biến M12 của báo cáo web).
 *   3. **Phần còn lại của trang vẫn dùng được** — chấm sao vẫn ghi được, nút
 *      Kéo về vẫn bấm được, ba hàng vẫn còn.
 */
test('kịch bản 4a — chưa nối repo thảo luận (trạng thái THẬT hôm nay): trang vẫn đọc được, và phần thảo luận nói rõ', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const s = await signedIn(browser, accountA as Account);
  try {
    const beforeCatalog = s.requests.length;
    await openCatalogByClicking(s.page);
    await expect(catalogList(s.page).locator('li.lib-item')).toHaveCount(3);

    // ── chưa ai mở gì: KHÔNG một lời gọi /discussions nào ─────────────────
    expect(
      discussionPathsSince(s.requests, beforeCatalog),
      'catalog tải thảo luận SẴN cho các hàng. Hạn ngạch GitHub là toàn cục, nên một lần xem trang ' +
        'tiêu hết lượt của mọi người khác — và màn hình trông y hệt, nên chỉ phép đếm này thấy.',
    ).toEqual([]);

    const row = catalogRow(s.page, DISCUSS_TITLE);
    const beforeOpen = s.requests.length;
    const answered = s.page.waitForResponse(
      (r) => r.url() === `${API_ORIGIN}/discussions/${DISCUSS_ID}`,
      { timeout: 20_000 },
    );
    await row.getByRole('button', { name: VI.discussToggle }).click();
    const res = await answered;

    // ── hợp đồng dây, đọc trên THÂN THÔ ───────────────────────────────────
    expect(res.status(), 'GET /discussions không trả 200. Một 5xx trao cho đường xử-lý-lỗi chung một thất bại nó có lý do coi là chí mạng.').toBe(200);
    const body = JSON.parse(await res.text()) as Record<string, unknown>;
    expect(body.id).toBe(DISCUSS_ID);
    expect(body.loaded).toBe(false);
    expect(
      body.reason,
      'lý do không phải "disabled". Nếu triển khai này ĐÃ được nối với một repo thật thì bài 4a đang ' +
        'đo một trạng thái khác trạng thái nó nói nó đang đo — xem báo cáo Task 5 §7.',
    ).toBe('disabled');
    // `[]` chứ không `null`: hai thứ ấy là cùng một giá trị Go và rất khác
    // nhau trong trình duyệt (`.map` trên `null` là cú trắng trang `815a472`).
    expect(await res.text()).toContain('"comments":[]');

    // ── và người đọc thấy một CÂU ─────────────────────────────────────────
    await expect(row.getByText(VI.discussDisabled)).toBeVisible();
    await expect(row.getByRole('alert'), '"chưa được nối" bị vẽ như một LỖI').toHaveCount(0);
    await expect(
      row.getByRole('link', { name: VI.discussPost }),
      'có liên kết "đăng bình luận" trong khi `url` là rỗng — một liên kết dẫn đi đâu?',
    ).toHaveCount(0);

    // ── đúng MỘT lời gọi, cho ĐÚNG hàng được mở ───────────────────────────
    expect(discussionPathsSince(s.requests, beforeOpen)).toEqual([`/discussions/${DISCUSS_ID}`]);

    // ── phần còn lại của trang vẫn dùng được ──────────────────────────────
    await expect(s.page.getByRole('heading', { name: VI.catalogTitle })).toBeVisible();
    await expect(catalogList(s.page).locator('li.lib-item')).toHaveCount(3);
    await expect(row.getByRole('button', { name: VI.pullAction })).toBeEnabled();
    expect(await clickStar(s.page, DISCUSS_TITLE, DISCUSS_ID, 3), 'không chấm sao được trong khi phần thảo luận trống').toBe(204);
    await expect(ratingSummary(s.page, DISCUSS_ID)).toHaveText(summaryText('3,0', 1));

    expect(s.noise, `console/page errors: ${s.noise.join(' | ')}`).toEqual([]);
  } finally {
    await s.context.close();
  }
});

/**
 * **4b — GITHUB HỎNG. MÔ PHỎNG Ở RANH GIỚI API, VÀ TÔI NÓI RÕ ĐIỀU ĐÓ.**
 *
 * Không một byte nào trong bài này đi tới GitHub, và **không thể**. Lý do đo
 * được, không phải một sự lười:
 *
 *   · `discuss.APIURL` là **hằng số trong mã nguồn** (`https://api.github.com/graphql`).
 *     Nó là hằng số **có chủ ý**: `no_key_transit_test.go` chỉ cho `client.go`
 *     nhập `net/http` với điều kiện tệp ấy **tự khai đích đến thành hằng
 *     grep được**, và đột biến M12 của Task 5 giết bản đọc base URL từ biến
 *     môi trường. Trỏ API thật vào một GitHub giả vì thế đòi hoặc một bản
 *     dựng riêng, hoặc một chứng chỉ TLS cho `api.github.com` — tức **bịa hạ
 *     tầng**.
 *   · Con đường còn lại — cấu hình `GITHUB_TOKEN` để GitHub thật từ chối —
 *     **đánh mất `disabled`** (một tiến trình, một cấu hình), tức đổi bài 4a
 *     lấy bài này, và cột cổng vào đường ra internet của máy chạy test.
 *
 * ⇒ `page.route` trả **đúng thân** mà `internal/discuss` sinh ra trên đường
 * hỏng (`reply(…, false, ReasonUnavailable, RepoURL(), nil)`). Chuỗi bằng
 * chứng có **hai mắt xích do hai cổng khác nhau giữ**:
 *
 *     GitHub 500 →(`TestBrokenGitHubDegradesAndNeverBreaksThePage`, 22 ca)→
 *     thân này →(bài này)→ màn hình
 *
 * **Không cổng nào trong repo giữ cả hai cùng lúc.** Đó là chỗ cổng này mù,
 * và nó được ghi ra ở đây chứ không chỉ trong báo cáo.
 *
 * Bài còn đo một ca thứ hai mà tầng Go **không** sinh ra được: **máy chủ của
 * chính ta trả 500**. `internal/discuss` hứa luôn trả 200 — nhưng một proxy,
 * một lần triển khai hỏng, hay một `apps/api` chết cho ra 5xx thật, và câu
 * người đọc phải nhận khi ấy (`discuss.error`) là một câu **khác**.
 */
test('kịch bản 4b — thảo luận không tải được: trang course vẫn đọc được, và phần thảo luận nói rõ (MÔ PHỎNG ở ranh giới API)', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const s = await signedIn(browser, accountA as Account);
  try {
    /** Trạng thái mà `page.route` đang giả lập cho `/discussions/:id`. */
    let mode: 'unavailable' | 'serverError' = 'unavailable';

    await s.page.route(
      (url) => url.href.startsWith(`${API_ORIGIN}/discussions/`),
      async (route) => {
        // CORS thật: request đi kèm `credentials: 'include'` xuyên origin, nên
        // `*` KHÔNG dùng được — trình duyệt đòi đích danh origin cộng
        // `allow-credentials`. Một stub thiếu hai header này hỏng ở đúng chỗ
        // một máy chủ cấu hình sai hỏng, và bài sẽ đo nhầm thứ.
        const headers = {
          'content-type': 'application/json; charset=utf-8',
          'access-control-allow-origin': WEB_ORIGIN,
          'access-control-allow-credentials': 'true',
        };
        if (mode === 'serverError') {
          await route.fulfill({ status: 500, headers, body: JSON.stringify({ error: 'internal error' }) });
          return;
        }
        const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() as string);
        await route.fulfill({
          status: 200,
          headers,
          body: JSON.stringify({
            id,
            loaded: false,
            reason: 'unavailable',
            url: REPO_DISCUSSIONS_URL,
            comments: [],
          }),
        });
      },
    );

    await openCatalogByClicking(s.page);
    await expect(catalogList(s.page).locator('li.lib-item')).toHaveCount(3);

    // ── (a) GitHub hỏng → "chưa tải được", KÈM đường sang GitHub ──────────
    const broken = catalogRow(s.page, DISCUSS_TITLE);
    const stubbed = s.page.waitForResponse(
      (r) => r.url() === `${API_ORIGIN}/discussions/${DISCUSS_ID}`,
      { timeout: 20_000 },
    );
    await broken.getByRole('button', { name: VI.discussToggle }).click();
    await stubbed;
    // "Trang vẫn đọc được" TRƯỚC "câu chữ đúng" — xem chú thích ở nhánh (b).
    await expect(
      s.page.getByText(VI.boundaryTitle),
      'một thảo luận không tải được đã kéo cả màn hình vào ErrorBoundary — đúng hình dạng lỗi trắng ' +
        'trang (815a472) dựng lại cao hơn một tầng',
    ).toHaveCount(0);
    await expect(s.page.getByRole('heading', { name: VI.catalogTitle })).toBeVisible();
    await expect(broken.getByText(VI.discussUnavailable)).toBeVisible();

    // Nút "đăng bình luận" DẪN SANG GitHub — ở API này không có route ghi nào.
    const post = broken.getByRole('link', { name: VI.discussPost });
    await expect(post, 'thảo luận hỏng mà vẫn phải còn đường sang GitHub để đăng bài').toBeVisible();
    await expect(post).toHaveAttribute('href', REPO_DISCUSSIONS_URL);
    await expect(post).toHaveAttribute('target', '_blank');
    await expect(post, 'thiếu rel=noopener: trang được mở giữ được `window.opener` và lái được trang này').toHaveAttribute(
      'rel',
      'noopener noreferrer',
    );

    // ── TRANG VẪN ĐỌC ĐƯỢC — đây là phần chính của kịch bản 4 ─────────────
    await expect(catalogList(s.page).locator('li.lib-item')).toHaveCount(3);
    await expect(catalogRow(s.page, RATED_TITLE).getByRole('button', { name: VI.pullAction })).toBeEnabled();
    // …và vẫn chấm sao được: A sửa phiếu 2 sao của kịch bản 1 thành 5 sao.
    expect(await clickStar(s.page, RATED_TITLE, RATED_ID, 5), 'không chấm sao được khi thảo luận hỏng').toBe(204);
    await expect(ratingSummary(s.page, RATED_ID)).toHaveText(summaryText('5,0', 1));

    // ── (b) máy chủ CỦA TA trả 500 → trang vẫn sống, và một câu KHÁC ──────
    mode = 'serverError';
    const other = catalogRow(s.page, SHARED_TITLE);
    const failed = s.page.waitForResponse(
      (r) => r.url() === `${API_ORIGIN}/discussions/${SHARED_ID}` && r.status() === 500,
      { timeout: 20_000 },
    );
    await other.getByRole('button', { name: VI.discussToggle }).click();
    await failed;

    // Chốt "trang vẫn đọc được" đứng TRƯỚC chốt câu chữ, và thứ tự ấy là một
    // quyết định: một cài đặt NÉM thay vì nói (thứ đúng bằng cách sửa một
    // dòng) làm cả hai chốt đỏ, nhưng chỉ chốt đứng trước gọi đúng TÊN của
    // điều đã hỏng — *"trang course vẫn đọc được"* là chính kịch bản 4, còn
    // "thiếu một câu" là triệu chứng. Cùng bài học mà báo cáo Task 6 của hệ 3
    // ghi lại: một cổng đỏ ở chỗ khớp nhầm nhãn không nói được nó vừa thấy gì.
    await expect(
      s.page.getByText(VI.boundaryTitle),
      'một thảo luận không tải được đã kéo cả màn hình vào ErrorBoundary — người đọc mất luôn danh ' +
        'mục và nút Kéo về vì API của một phần phụ trả 500',
    ).toHaveCount(0);
    await expect(s.page.getByRole('heading', { name: VI.catalogTitle })).toBeVisible();
    await expect(catalogList(s.page).locator('li.lib-item')).toHaveCount(3);
    await expect(
      other.getByText(VI.discussBrokenAnswer),
      '"máy chủ của ta hỏng" phải là một câu KHÁC "GitHub hỏng" — gộp chúng lại là nói với người đọc ' +
        'rằng hai nguyên nhân khác hẳn nhau đều là "lỗi"',
    ).toBeVisible();
    // Câu của hàng kia KHÔNG bị thay đổi: hai luồng, hai khoá cache riêng.
    await expect(broken.getByText(VI.discussUnavailable)).toBeVisible();

    // ── tiếng ồn console: một 500 CÓ để lại dấu vết, nhưng không được có ──
    // một ngoại lệ nào chưa bắt. `pageerror` mới là dấu hiệu "trang đã vỡ".
    const crashes = s.noise.filter((n) => n.startsWith('pageerror:'));
    expect(crashes, `ngoại lệ chưa bắt trên trang: ${crashes.join(' | ')}`).toEqual([]);
    const unexpected = s.noise.filter(
      (n) => !/^Failed to load resource: the server responded with a status of 500\b/.test(n),
    );
    expect(unexpected, `lỗi console ngoài cái 500 đã cố ý dựng: ${unexpected.join(' | ')}`).toEqual([]);
  } finally {
    await s.context.close();
  }
});

import {
  expect,
  test,
  type BrowserContext,
  type Frame,
  type Page,
  type Request as PWRequest,
} from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cpSync, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { extname, join, relative, resolve } from 'node:path';
import { PASSWORD, REAL_COURSE_ID, REPO_ROOT, freshEmail, registerNewUser } from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HỆ THỐNG CON 2 — CỔNG NGHIỆM THU ĐẦU-CUỐI (Task 10)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Bốn kịch bản, tất cả ĐI QUA GIAO DIỆN THẬT. Không một hàm nào của
 * `apps/web/src/ai/**` hay `apps/vault/src/**` được gọi thẳng ở tệp này: mọi
 * thứ xảy ra qua chuột, bàn phím, và hai origin thật trong một trình duyệt
 * thật. Ruling S1-F29 sinh ra vì cổng đơn vị không hỏi được câu *"người dùng
 * có bấm tới được không"*; tệp này hỏi được, nhưng chỉ khi nó thật sự bấm.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 1. VÌ SAO TỆP NÀY PHẢI TỰ DỰNG LẠI BẢN BUILD — phát hiện quan trọng nhất
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `VITE_VAULT_ORIGIN` được Vite thay bằng HẰNG SỐ lúc dịch. `apps/web/.env.development`
 * đặt nó, nhưng tệp ấy CHỈ được nạp bởi `vite dev` — `vite build` không đọc nó.
 * `playwright.config.ts` dựng bằng `bun run build` và chỉ truyền `VITE_API_URL`.
 *
 * ⇒ **Bản dựng mà cổng e2e phục vụ hôm nay KHÔNG có kho khoá.**
 *   `resolveVaultOrigin` trả `null`, `aiReady` là `false`, nút "Hỏi AI về chương
 *   này" **không được vẽ ra**, và `<iframe data-testid="vault-frame">` không tồn
 *   tại. Đo được: `grep -o "localhost:5174" apps/web/dist/assets/*.js` không có
 *   một hit nào sau `bun run build` mặc định.
 *
 * Một cổng chạy trên bản dựng ấy sẽ **xanh vĩnh viễn mà không kiểm được gì** —
 * đúng hình dạng cổng mù. Nên `beforeAll` dưới đây dựng LẠI `apps/web/dist` với
 * `VITE_VAULT_ORIGIN` trỏ vào kho khoá của chính nó, dựng `apps/vault` với
 * `VITE_APP_ORIGIN` trỏ ngược lại, và **trả `dist/` về nguyên trạng ở
 * `afterAll`** (sao lưu thư mục + đối chiếu vân tay hai chiều) để `viz.spec.ts`
 * — chạy sau tệp này và có chốt "không lỗi console nào" — không nhận một bản
 * dựng khác với bản nó được viết cho.
 *
 * **Cái mà điều này KHÔNG chứng minh, nói thẳng:** cổng này chứng minh tính
 * năng chạy KHI ĐƯỢC CẤU HÌNH. Nó **không** chứng minh bản deploy thật có cấu
 * hình ấy — `docs/deploy.md` chưa nhắc `VITE_VAULT_ORIGIN` một lần nào và
 * không có bước deploy nào cho `apps/vault`. Xem "cổng mù" trong báo cáo.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 2. BA MÁY CHỦ, TẤT CẢ CHẠY TRONG CHÍNH TIẾN TRÌNH NÀY
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Kho khoá và nhà cung cấp giả được phục vụ bằng `node:http` **trong worker của
 * Playwright**, không phải bằng `bunx vite preview` chạy nền. Lý do là một cạm
 * bẫy đã đo: `kill $!` không với tới tiến trình con của `bunx`, và Task 6 đã rò
 * một tiến trình vite vì đúng chuyện đó. Một máy chủ trong tiến trình chết cùng
 * worker, không cần giết theo cổng, và không bao giờ tranh cổng với ai.
 *
 * Cổng đều được **cấp phát động** (`listen(0)` rồi đóng), không hằng số: trên
 * chính máy này, 5173 đang bị một tiến trình lạ giữ và 8089 cũng vậy. Một cổng
 * viết cứng là cách nhanh nhất để lái Playwright vào ứng dụng của người khác —
 * Task 4 và Task 6 đều suýt kết luận sai vì thế.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 3. SHIM DUY NHẤT, VÀ CÁI GIÁ CỦA NÓ
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `openaiCompatible` viết cứng `https://api.deepseek.com/v1`. Không có biến môi
 * trường nào đổi được nó, nên "máy chủ giả đóng vai nhà cung cấp" cần một cách
 * để nhận được lời gọi. Ba đường đã cân:
 *
 *   a. `route.fulfill` của Playwright — **loại**: nó trả TOÀN BỘ thân một lần,
 *      nên không có khe thời gian nào, và "chữ chảy về từng mảnh" trở thành một
 *      chốt không phân biệt được với "hiện một lần". Đó chính là thứ kịch bản 2
 *      phải đo.
 *   b. `route.continue({url})` + máy chủ giả chạy HTTPS tự ký — đúng nhất
 *      (không đụng vào trang), nhưng kéo theo `openssl`, chứng chỉ, và
 *      `ignoreHTTPSErrors`.
 *   c. **Đã chọn:** viết lại URL ở tầng `fetch` **bên trong khung kho khoá**,
 *      bằng `addInitScript`. Ba dòng, không phụ thuộc ngoài, và lời gọi vẫn là
 *      một `fetch` THẬT ra một máy chủ THẬT — thân, header `authorization` và
 *      khe thời gian giữa các mảnh đều thật.
 *
 * **Cái giá:** cổng này không chứng minh kho khoá gọi đúng TÊN MIỀN của nhà
 * cung cấp. Chốt ấy tồn tại ở tầng đơn vị (`providers.test.ts` dựng `new URL`
 * trên URL mà `fetch` thật sự nhận và kiểm host), nên nó không phải một lỗ
 * không ai canh — nhưng nó **không** được canh ở đây.
 */

// ───────────────────────── hằng số của cổng ─────────────────────────

/** Cùng phép tính với `playwright.config.ts`. Một chốt trong kịch bản 1 khẳng
 *  định trang đang mở thật sự ở origin này — "tôi có đang nhìn đúng trang
 *  không" phải là một câu hỏi được TRẢ LỜI, không phải một giả định. */
const WEB_ORIGIN = `http://localhost:${process.env.TUHOC_E2E_WEB_PORT ?? '5183'}`;

/** API thật mà `scripts/test-e2e.sh` đã dựng. Kịch bản 3 quét mọi request tới
 *  đây và khẳng định không cái nào mang key. */
const API_ORIGIN = (
  process.env.VITE_API_URL ?? `http://localhost:${process.env.TUHOC_E2E_API_PORT ?? '8089'}`
).replace(/\/+$/, '');

const CHAPTER_ID = 'p2-2';

/** Nhà cung cấp mặc định của registry (đứng đầu, spec §3.3 gợi ý DeepSeek). */
const PROVIDER_BASE = 'https://api.deepseek.com';

/**
 * Key giả. **Duy nhất theo từng lần chạy** — một hằng số cố định sống sót qua
 * các lần chạy trong `localStorage` của kho khoá và biến "không rò" thành một
 * chốt có thể xanh vì một lần chạy TRƯỚC, không phải vì lần này.
 */
const FAKE_KEY = `sk-s2gate-${randomBytes(9).toString('hex')}`;

/** Sáu mảnh, mỗi mảnh một sự kiện SSE riêng, cách nhau `CHUNK_GAP_MS`. */
const CHUNKS = ['Mảnh ', 'chảy ', 'về ', 'từng ', 'phần — ', 'S2GATE-XONG'];
const FULL_ANSWER = CHUNKS.join('');
const CHUNK_GAP_MS = 140;

// ───────────────────────── trạng thái dựng ở beforeAll ─────────────────────────

interface ProviderCall {
  readonly url: string;
  readonly authorization: string;
  readonly body: string;
}

let vaultPort = 0;
let providerPort = 0;
let vaultOrigin = '';
let providerOrigin = '';
let vaultServer: Server | null = null;
let providerServer: Server | null = null;
const providerCalls: ProviderCall[] = [];

const WEB_DIR = resolve(REPO_ROOT, 'apps', 'web');
const VAULT_DIR = resolve(REPO_ROOT, 'apps', 'vault');
const WEB_DIST = resolve(WEB_DIR, 'dist');
/**
 * Bản sao lưu của `dist/` nằm DƯỚI `node_modules/` vì đúng một lý do: đó là
 * thư mục đã được `.gitignore` bỏ qua VÀ nằm cùng hệ tệp với `dist/` — nên
 * `renameSync` lúc khôi phục là một thao tác nguyên tử, không phải một phép
 * chép có thể hỏng giữa chừng. Đặt ở `/tmp` thì `rename` ném `EXDEV` khi hai
 * nơi khác ổ đĩa; đặt cạnh `dist/` thì một lần chạy hỏng sẽ để lại rác KHÔNG
 * được git bỏ qua, và rác ấy trông y hệt một tệp ai đó quên xoá.
 */
const WEB_DIST_BACKUP = resolve(WEB_DIR, 'node_modules', '.s2-dist-backup');
let distFingerprintBefore = '';

// ───────────────────────── tiện ích hạ tầng ─────────────────────────

/** Cổng còn trống, hỏi hệ điều hành chứ không đoán. */
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

/**
 * Vân tay của một cây thư mục: đường dẫn tương đối + kích thước, đã sắp xếp.
 * Dùng để chứng minh `dist/` được trả về ĐÚNG như trước, hai chiều — cùng kỷ
 * luật `shasum` mà S1-F9 đòi cho tệp được git theo dõi, áp cho một thư mục.
 */
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
    execFileSync('bun', ['run', 'build'], {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    throw new Error(
      `dựng ${what} hỏng.\n--- stdout ---\n${err.stdout ?? ''}\n--- stderr ---\n${err.stderr ?? ''}`,
    );
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

/** Máy chủ tĩnh tối giản cho `apps/vault/dist`. Không SPA fallback: kho khoá là
 *  một trang duy nhất, và một fallback ở đây sẽ biến "thiếu tệp" thành "trang
 *  trắng im lặng". */
function serveStatic(rootDir: string, port: number): Promise<Server> {
  const srv = createServer((req, res) => {
    const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const rel = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
    const file = resolve(rootDir, rel);
    if (!file.startsWith(rootDir) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`không có ${rel}`);
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
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

/**
 * NHÀ CUNG CẤP GIẢ — một máy chủ SSE thật, với khe thời gian thật.
 *
 * `CHUNK_GAP_MS` giữa hai lần `write` là thứ làm cho "chảy về từng mảnh" thành
 * một câu ĐO ĐƯỢC: mỗi mảnh rơi vào một macrotask riêng, nên React commit riêng
 * và `MutationObserver` của kịch bản 2 thấy sáu trạng thái thay vì một. Bỏ khe
 * thời gian đi thì một bản cài đặt gom hết rồi vẽ một lần **cũng xanh** — và
 * lúc ấy chốt không còn đo thứ nó nói nó đo (bài học S2-F, Task 9).
 */
function serveProvider(port: number): Promise<Server> {
  const srv = createServer((req, res) => {
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-max-age': '600',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    let body = '';
    req.on('data', (d: Buffer) => {
      body += d.toString('utf8');
    });
    req.on('end', () => {
      providerCalls.push({
        url: req.url ?? '',
        authorization: String(req.headers.authorization ?? ''),
        body,
      });
      res.writeHead(200, {
        ...cors,
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.flushHeaders();
      let i = 0;
      const tick = (): void => {
        if (i >= CHUNKS.length) {
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: CHUNKS[i] } }] })}\n\n`);
        i += 1;
        setTimeout(tick, CHUNK_GAP_MS);
      };
      setTimeout(tick, CHUNK_GAP_MS);
    });
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

// ───────────────────────── dựng / dọn ─────────────────────────

test.beforeAll(async () => {
  // `tsc -b && vite build` hai lần + dựng kho khoá: đây là ngân sách hạ tầng,
  // không phải một chốt nào đang chờ.
  test.setTimeout(600_000);

  vaultPort = await freePort();
  providerPort = await freePort();
  vaultOrigin = `http://localhost:${String(vaultPort)}`;
  providerOrigin = `http://127.0.0.1:${String(providerPort)}`;

  expect(existsSync(WEB_DIST), `${WEB_DIST} chưa tồn tại — webServer của playwright.config.ts đã dựng chưa?`).toBe(true);
  rmSync(WEB_DIST_BACKUP, { recursive: true, force: true });
  cpSync(WEB_DIST, WEB_DIST_BACKUP, { recursive: true });
  distFingerprintBefore = fingerprint(WEB_DIST_BACKUP);

  // Kho khoá tin ĐÚNG origin mà Playwright sẽ mở, và trang chính tin đúng origin
  // kho khoá. Hai nửa đối xứng; lệch một ký tự thì mọi `postMessage` bị bỏ theo
  // đúng thiết kế và triệu chứng duy nhất là "AI không trả lời".
  build(VAULT_DIR, { VITE_APP_ORIGIN: WEB_ORIGIN }, 'apps/vault');
  build(
    WEB_DIR,
    { VITE_VAULT_ORIGIN: vaultOrigin, VITE_API_URL: API_ORIGIN },
    'apps/web (có VITE_VAULT_ORIGIN)',
  );

  // CHỐT CHỐNG CỔNG MÙ: nếu biến môi trường không vào được bundle thì mọi kịch
  // bản dưới đây sẽ hỏng với "không tìm thấy nút", một triệu chứng trông y hệt
  // một hồi quy của mã ứng dụng. Hỏi thẳng ở đây, một lần.
  const bundleHasOrigin = readdirSync(join(WEB_DIST, 'assets'))
    .filter((f) => f.endsWith('.js'))
    .some((f) => readFileSync(join(WEB_DIST, 'assets', f), 'utf8').includes(vaultOrigin));
  expect(bundleHasOrigin, `bundle vừa dựng không chứa ${vaultOrigin} — VITE_VAULT_ORIGIN không vào được bản dựng`).toBe(true);

  vaultServer = await serveStatic(resolve(VAULT_DIR, 'dist'), vaultPort);
  providerServer = await serveProvider(providerPort);

  // "Tôi có đang phục vụ đúng thứ tôi vừa dựng không" — hỏi trước khi đo bất cứ gì.
  const probe = await fetch(`${vaultOrigin}/`);
  expect(probe.status, `${vaultOrigin}/ không trả 200`).toBe(200);
  expect(await probe.text()).toContain('vault-ui');
});

test.afterAll(async () => {
  await closeServer(vaultServer);
  await closeServer(providerServer);
  vaultServer = null;
  providerServer = null;

  // Trả `dist/` về nguyên trạng, và CHỨNG MINH đã trả về — `viz.spec.ts` chạy
  // sau tệp này và có chốt "không lỗi console nào"; một `<iframe>` kho khoá trỏ
  // vào một cổng đã đóng sẽ nổ ERR_CONNECTION_REFUSED trong console của nó.
  if (existsSync(WEB_DIST_BACKUP)) {
    rmSync(WEB_DIST, { recursive: true, force: true });
    renameSync(WEB_DIST_BACKUP, WEB_DIST);
    const after = fingerprint(WEB_DIST);
    expect(after, 'dist/ KHÔNG được trả về nguyên trạng').toBe(distFingerprintBefore);
  }
});

// ───────────────────────── đồ nghề dùng chung ─────────────────────────

interface Recorded {
  readonly requests: PWRequest[];
}

/**
 * Gắn ba máy ghi vào context TRƯỚC mọi lần điều hướng:
 *
 *  1. **viết lại URL nhà cung cấp** (xem mục 3 ở đầu tệp);
 *  2. **mọi `message` trang chính NHẬN được** — kịch bản 3 quét nó. Đây là bề
 *     mặt rò rỉ có thật nhất: giao thức là thứ duy nhất nối hai origin, và
 *     S2-F8 đã ghi rằng không phép quét chữ nào đóng được nó ở tầng nguồn;
 *  3. **mọi trạng thái của ô trả lời** — kịch bản 2 đọc nó để phân biệt "chảy
 *     về từng mảnh" với "hiện một lần". `waitFor` **về cấu trúc không bao giờ
 *     đủ** cho câu hỏi này: nó chỉ thấy trạng thái CUỐI, và một bản cài đặt gom
 *     hết rồi vẽ một lần vẫn cho nó đúng cái nó chờ.
 */
async function instrument(context: BrowserContext): Promise<Recorded> {
  await context.addInitScript(
    ({ from, to }: { from: string; to: string }) => {
      const orig = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(from)) return orig(to + url.slice(from.length), init);
        return orig(input, init);
      };
    },
    { from: PROVIDER_BASE, to: providerOrigin },
  );

  await context.addInitScript(() => {
    const w = window as unknown as { __msgs: { origin: string; data: string }[] };
    w.__msgs = [];
    window.addEventListener(
      'message',
      (e: MessageEvent) => {
        let data: string;
        try {
          data = JSON.stringify(e.data);
        } catch {
          data = String(e.data);
        }
        w.__msgs.push({ origin: e.origin, data });
      },
      true,
    );
  });

  await context.addInitScript(() => {
    const w = window as unknown as { __frames: { text: string; at: number }[] };
    w.__frames = [];
    const snap = (): void => {
      const el = document.querySelector('[data-testid="ai-answer"]');
      if (!el) return;
      const text = el.textContent ?? '';
      const last = w.__frames[w.__frames.length - 1];
      if (!last || last.text !== text) w.__frames.push({ text, at: performance.now() });
    };
    const start = (): void => {
      new MutationObserver(snap).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  });

  const requests: PWRequest[] = [];
  context.on('request', (r) => {
    requests.push(r);
  });
  providerCalls.length = 0;
  return { requests };
}

/**
 * Phiên đăng nhập của bài kiểm gần nhất, để bài kiểm khác MƯỢN LẠI.
 *
 * ── VÌ SAO PHẢI TIẾT KIỆM ĐĂNG KÝ — một cạm bẫy đã đo, không phải tối ưu ──
 * API giới hạn `/auth/*` ở **10 lời gọi mỗi phút mỗi IP** (`auth_test.go`:
 * *"11th request to /auth/* within a minute is 429"*), và **cả bộ e2e đi ra từ
 * ĐÚNG MỘT IP** — cổng của docker, `192.168.65.1`. Mỗi `registerNewUser` tiêu
 * một suất.
 *
 * Hệ quả đã đo được ba lần: khi cả bộ chạy **17 bài kiểm**, `viz.spec.ts` (bài
 * cuối) hỏng ở `registerNewUser` với `waitForURL` hết giờ 15 s. Log của API có
 * **đúng một dòng** `429 POST /auth/register`. Bỏ BẤT KỲ bài nào ra để còn 16
 * thì cả bộ xanh — bỏ bài "màn hẹp" xanh, bỏ bài "đào sâu" (giữ "màn hẹp")
 * cũng xanh. Nên đây **không phải** lỗi của một bài kiểm nào: đó là một **vách
 * đá về sức chứa** của cả bộ, và triệu chứng của nó đổ lên đầu một bài kiểm
 * chẳng liên quan gì tới đăng nhập.
 *
 * Cho nên bài "màn hẹp" **mượn phiên** thay vì đăng ký thêm: nó tốn 0 suất
 * `/auth/*`. Ai thêm bài kiểm mới vào bộ này nên làm y hệt, hoặc chuẩn bị gặp
 * một lỗi trông như lỗi ứng dụng nhưng thật ra là hạn mức.
 */
let borrowedSession: Awaited<ReturnType<BrowserContext['storageState']>> | null = null;

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await registerNewUser(page, freshEmail(), PASSWORD);
  borrowedSession = await page.context().storageState();
}

/** Khung kho khoá, dưới dạng `Frame` (để `evaluate` được vào `localStorage` của
 *  origin kia) — không chỉ `FrameLocator`. */
async function vaultFrame(page: Page): Promise<Frame> {
  await expect(page.locator('[data-testid="vault-frame"]')).toHaveAttribute('src', `${vaultOrigin}/`);
  await expect
    .poll(() => page.frames().some((f) => f.url().startsWith(vaultOrigin)), {
      message: `không có frame nào ở ${vaultOrigin} — kho khoá có nạp được không?`,
      timeout: 15_000,
    })
    .toBe(true);
  return page.frames().find((f) => f.url().startsWith(vaultOrigin)) as Frame;
}

/** Mở trang cấu hình và khẳng định đang nhìn ĐÚNG kho khoá của lần chạy này. */
async function openVault(page: Page) {
  await page.goto('/settings');
  const ui = page.frameLocator('[data-testid="vault-frame"]');
  await expect(ui.locator('h2')).toHaveText('Trợ lý AI chạy bằng key của chính bạn');
  return ui;
}

/** Dán key vào ô nằm TRONG khung kho khoá và lưu. Ô này ở origin kho khoá — nếu
 *  một ngày nào đó nó chuyển ra trang chính thì `frameLocator` dưới đây không
 *  tìm thấy nó và cổng đỏ, đó là chủ ý. */
async function plugKey(page: Page): Promise<void> {
  const ui = await openVault(page);
  await expect(ui.locator('[data-role="current"]')).toHaveText('Máy này chưa có key nào.');
  await ui.locator('[data-role="secret"]').fill(FAKE_KEY);
  await ui.locator('[data-role="save"]').click();
  await expect(ui.locator('[data-role="current"]')).toContainText('deepseek');
}

async function openChapter(page: Page): Promise<void> {
  await page.goto(`/c/${REAL_COURSE_ID}/${CHAPTER_ID}`);
  await expect(page.locator('.katex').first()).toBeVisible();
}

function askPanel(page: Page) {
  return page.getByRole('dialog', { name: 'Hỏi về chương' });
}

async function askAboutChapter(page: Page, question: string) {
  await page.getByRole('button', { name: 'Hỏi AI về chương này' }).click();
  const panel = askPanel(page);
  await expect(panel).toBeVisible();
  await panel.locator('#ai-question').fill(question);
  await panel.getByRole('button', { name: 'Hỏi', exact: true }).click();
  return panel;
}

/** Mọi giá trị `localStorage` của origin đang mở, gộp thành một chuỗi. */
async function allLocalStorage(scope: Page | Frame): Promise<string> {
  return scope.evaluate(() => {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k !== null) out.push(`${k}=${localStorage.getItem(k) ?? ''}`);
    }
    return out.join('\n');
  });
}

/** Mọi bản ghi của mọi object store của mọi database IndexedDB, gộp thành JSON. */
async function allIndexedDB(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? [];
    const out: unknown[] = [];
    for (const info of dbs) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase | null>((res) => {
        const req = indexedDB.open(info.name as string);
        req.onsuccess = () => {
          res(req.result);
        };
        req.onerror = () => {
          res(null);
        };
        req.onblocked = () => {
          res(null);
        };
      });
      if (!db) continue;
      for (const store of Array.from(db.objectStoreNames)) {
        const rows = await new Promise<unknown[]>((res) => {
          try {
            const req = db.transaction(store, 'readonly').objectStore(store).getAll();
            req.onsuccess = () => {
              res(req.result as unknown[]);
            };
            req.onerror = () => {
              res([]);
            };
          } catch {
            res([]);
          }
        });
        out.push({ db: info.name, store, rows });
      }
      db.close();
    }
    return JSON.stringify(out);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// KỊCH BẢN 1 — CHƯA CẮM KEY: LỜI MỜI ĐI CẤU HÌNH, KHÔNG PHẢI LỖI CỤT
// ═══════════════════════════════════════════════════════════════════════════

test('chưa cắm key: panel hỏi–đáp mời đi cấu hình, không phải lỗi cụt', async ({
  page,
  context,
}) => {
  await instrument(context);
  await signIn(page);

  // "Tôi có đang nhìn đúng trang không" — trả lời trước khi đo.
  expect(page.url().startsWith(WEB_ORIGIN), `trang đang mở là ${page.url()}`).toBe(true);

  await openChapter(page);
  await expect(page.locator('[data-testid="vault-frame"]')).toHaveAttribute('src', `${vaultOrigin}/`);

  // Kho khoá RỖNG THẬT — không phải "chưa kịp nạp". Nếu chốt dưới xanh vì máy
  // này tình cờ đã có key từ một lần chạy khác thì nó xanh vì lý do sai.
  const frame = await vaultFrame(page);
  expect(await allLocalStorage(frame)).not.toContain('tuhoc.vault.key');

  await page.getByRole('button', { name: 'Hỏi AI về chương này' }).click();
  const panel = askPanel(page);
  await expect(panel).toBeVisible();

  // LỜI MỜI, ngay lúc mở — người học không phải gõ một câu hỏi rồi mới biết.
  const invite = panel.locator('[data-testid="ai-needs-setup"]');
  await expect(invite).toBeVisible();
  await expect(invite).toContainText('chưa có key nào');

  // Và KHÔNG phải một lỗi cụt: không có `role=alert`, không có "bản dựng này
  // không có kho khoá" (câu ấy sẽ có nghĩa là bản dựng sai, không phải chưa cắm
  // key), và không có ô nhập câu hỏi dẫn người ta đi vào ngõ cụt.
  await expect(panel.getByRole('alert')).toHaveCount(0);
  await expect(panel.locator('[data-testid="ai-unavailable"]')).toHaveCount(0);
  await expect(panel.locator('#ai-question')).toHaveCount(0);

  // Lời mời phải CÓ một lối đi, và lối đi ấy phải trỏ đúng chỗ. Việc nó có
  // thật sự tới nơi hay không là chốt riêng ngay bên dưới — xem ở đó vì sao.
  await expect(invite.getByRole('link', { name: 'Mở trang cấu hình' })).toHaveAttribute(
    'href',
    '/settings',
  );

  // Và trang cấu hình ấy, khi tới được, có ô dán key nằm TRONG khung — không
  // phải trên trang chính. Đây là ràng buộc quyết định cả hệ thống con; nếu ô
  // chuyển ra ngoài thì mọi thứ Task 1–5 dựng lên thành trang trí. Không phải
  // "không có ô tên là key" — KHÔNG CÓ Ô NÀO, vì một ô tên `q` cũng đọc được y
  // hệt bằng một listener `input`.
  const ui = await openVault(page);
  await expect(ui.locator('[data-role="secret"]')).toBeVisible();
  await expect(page.locator('.page-settings input, .page-settings textarea')).toHaveCount(0);
});

/**
 * ═══ DÂY BẪY — LỐI ĐI TỪ LỜI MỜI HIỆN KHÔNG TỚI NƠI ═══════════════════════
 *
 * Kịch bản 1 ở trên dừng ở "có lời mời, và nó trỏ đúng `/settings`". Chốt này
 * đi tiếp một bước — **bấm** vào nó — và bước ấy ĐANG HỎNG.
 *
 * ── Đo được, 2026-08-22 ──────────────────────────────────────────────────
 * Bấm bất kỳ liên kết nội bộ nào **trong khi đang đọc một chương**: URL đổi
 * (`location.pathname === '/settings'`, không nạp lại trang — cờ trên `window`
 * sống sót, `performance` chỉ có MỘT navigation entry), nhưng nội dung route
 * **không đổi**: `.page-settings` không xuất hiện, chữ của chương vẫn còn, và
 * khung kho khoá vẫn `display: none`. Console nói vì sao:
 *
 *     NotFoundError: Failed to execute 'removeChild' on 'Node':
 *     The node to be removed is not a child of this node.
 *     → ErrorBoundary bắt được lỗi render
 *
 * ── VÀ NÓ KHÔNG PHẢI LỖI CỦA HỆ THỐNG CON 2 ─────────────────────────────
 * Đã đo hai chiều để không đổ oan:
 *   · rời chương sang `/library` (không dính gì tới AI) — **hỏng y hệt**;
 *   · trên **bản dựng gốc KHÔNG có `VITE_VAULT_ORIGIN`** (không có khung kho
 *     khoá nào trong DOM, `frameStyle === null`) — **vẫn hỏng y hệt, cùng lỗi**;
 *   · đi từ **bảng điều khiển** sang `/settings` — **chạy đúng**.
 * ⇒ Lỗi nằm ở đường THÁO của trình đọc chương, có sẵn từ trước, không phải thứ
 *   hệ thống con này dựng lên.
 *
 * ── ĐÃ SỬA, 2026-08-22 — `test.fail()` ĐÃ ĐƯỢC GỠ ────────────────────────
 * Dây bẫy hai chiều đã làm đúng việc của nó: nó ĐỎ ("expected to fail but
 * passed") ngay khi trình đọc được sửa, và dòng `test.fail(...)` được gỡ ở
 * cùng lần sửa ấy. Từ đây chốt này là một chốt ĐỎ bình thường.
 *
 * Nguyên nhân, định vị bằng một phép đo ba nhánh (xem
 * `.superpowers/sdd/2026-08-22-fixes/nav-from-chapter-report.md`): `<Topbar>`
 * dựng `<div id="crumb">{!isChapterRoute && 'Tuhoc'}</div>`, còn
 * `<ChapterView>` portal breadcrumb của chương vào **đúng nút DOM ấy**. Rời
 * chương ⇒ `children` của `#crumb` đổi từ `false` sang một CHUỖI, và react-dom
 * commit `children` kiểu chuỗi bằng `setTextContent(node, …)` — tức
 * `node.textContent = …` — thứ xoá sạch mọi con, kể cả con của portal. Commit
 * kế tiếp React tháo portal, gọi `removeChild` trên một nút đã không còn là
 * con, và ném GIỮA giai đoạn commit ⇒ lần chuyển route bị bỏ dở.
 *
 * Điều đó khớp từng chi tiết với ba phép đo ở trên: `/library` cũng hỏng (mọi
 * route KHÔNG-chương đều bật chuỗi ấy lên), bản dựng không có kho khoá cũng
 * hỏng (`#crumb` không dính gì tới AI), và đi từ bảng điều khiển thì chạy đúng
 * (`#crumb` đã là `'Tuhoc'` sẵn, không có portal nào để xoá).
 *
 * Bản sửa nằm ở `apps/web/src/reader/ChapterView.tsx`: portal vào một
 * `<span data-chapter-crumb>` do chính `ChapterView` tạo và treo dưới
 * `#crumb`, nên nút bị `textContent` tách ra NGUYÊN VẸN và `removeChild` của
 * React vẫn tìm thấy đúng cha. Chốt đơn vị đi kèm — đo đúng câu "bấm liên kết
 * từ trong chương thì nội dung route ĐỔI", và khẳng định thêm rằng
 * `<ErrorBoundary>` KHÔNG bị chạm tới — ở
 * `apps/web/src/reader/leaveChapter.test.tsx`.
 *
 * **Hệ quả người dùng, nói thẳng:** panel AI **chỉ tồn tại trong chương**, nên
 * đây đúng là chỗ lời mời được bấm. Người học chưa cắm key bấm "Mở trang cấu
 * hình" nay tới được trang cấu hình thật.
 */
test('bấm lời mời phải mở được trang cấu hình', async ({ page, context }) => {
  // Mọi bước giữ hạn NGẮN và TƯỜNG MINH, và giữ nguyên sau khi `test.fail` đã
  // được gỡ. Lý do cũ vẫn còn giá trị dưới dạng khác: hạn ngắn làm hỏng-thật
  // hiện ra ở ĐÚNG bước hỏng thay vì ở một lần hết giờ 90 s không nói gì. Đo
  // được hồi còn ghim: dưới mutant M1 chốt này hết 90 s rồi tính là hỏng thật,
  // làm bẩn kết quả của một mutant nó không liên quan gì.
  test.setTimeout(45_000);
  await instrument(context);
  await signIn(page);
  await openChapter(page);
  await page.getByRole('button', { name: 'Hỏi AI về chương này' }).click({ timeout: 8_000 });
  await page
    .getByRole('dialog', { name: 'Hỏi về chương' })
    .locator('[data-testid="ai-needs-setup"]')
    .getByRole('link', { name: 'Mở trang cấu hình' })
    .click({ timeout: 8_000 });
  await expect(page).toHaveURL(/\/settings$/, { timeout: 8_000 });
  await expect(page.locator('.page-settings')).toBeVisible({ timeout: 8_000 });
  await expect(
    page.frameLocator('[data-testid="vault-frame"]').locator('[data-role="secret"]'),
  ).toBeVisible({ timeout: 8_000 });
});

/**
 * ═══ MÀN HẸP — PANEL PHẢI NẰM TRÊN CÙNG ════════════════════════════════════
 *
 * Không nằm trong bốn kịch bản của kế hoạch. Nó có ở đây vì báo cáo bàn giao
 * nêu đích danh **"panel z-index trên màn hẹp chưa kiểm"**, và một câu như thế
 * chỉ có hai kết cục: có người đo, hoặc nó ở lại danh sách mãi mãi.
 *
 * Phép đo là **hit-test thật**, không phải `toBeVisible`. `toBeVisible` chỉ hỏi
 * "phần tử có hộp không" — một panel bị thanh công cụ chương hay khung kho khoá
 * phủ lên **vẫn** có hộp, vẫn "visible", và vẫn không bấm được. Câu hỏi đúng là
 * *"bấm vào giữa panel thì trúng cái gì"*, và `elementFromPoint` trả lời đúng
 * câu ấy — nó chạy qua đúng phép xếp lớp mà con chuột chạy qua.
 *
 * ── GIỚI HẠN, ĐO ĐƯỢC, ĐỪNG TIN QUÁ CHỐT NÀY ────────────────────────────
 * Mutant M6 (`.ai-panel { z-index: 85 }` → `z-index: 1`) **SỐNG SÓT**: chốt này
 * vẫn xanh. Nên nó **KHÔNG ghim thứ tự xếp lớp**; thứ nó ghim là *"ở 375×812,
 * không có gì phủ lên panel"*. Lý do hai câu ấy khác nhau: panel nằm cố định ở
 * góc dưới-phải, và ở khung nhìn ấy **không có phần tử nào khác vẽ vào đúng ô
 * chữ nhật đó** — nên `z-index` không quan sát được từ đây, và hôm nay con số
 * 85 không chịu tải ở khung nhìn này.
 *
 * Ghi ra thay vì để người sau tưởng chốt này canh `z-index`: đó đúng là bài học
 * S2 Task 9 — *một dây bẫy còn xanh không có nghĩa nó còn đo đúng thứ nó từng
 * đo*. Muốn ghim `z-index` thật thì cần một phần tử KHÁC cùng chồng lên ô ấy,
 * và hôm nay không có cái nào.
 */
test('màn hẹp: panel hỏi–đáp nằm trong khung nhìn và không bị gì phủ lên', async ({ browser }) => {
  // MỘT CONTEXT RIÊNG với khung nhìn hẹp, và **MƯỢN PHIÊN** của bài kiểm trước
  // thay vì đăng ký thêm một tài khoản — xem `borrowedSession` để biết vì sao
  // đúng một lần đăng ký nữa làm ĐỎ một bài kiểm ở tệp khác.
  //
  // `baseURL` phải truyền TAY: một context dựng bằng `browser.newContext()`
  // KHÔNG thừa hưởng khối `use` của `playwright.config.ts`, nên thiếu nó thì
  // đường dẫn tương đối không có gốc.
  expect(
    borrowedSession,
    'chưa có phiên nào để mượn — bài kiểm này phải chạy SAU một bài có đăng nhập',
  ).not.toBeNull();
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    baseURL: WEB_ORIGIN,
    storageState: borrowedSession ?? undefined,
  });
  const page = await context.newPage();
  await instrument(context);
  await openChapter(page);

  await page.getByRole('button', { name: 'Hỏi AI về chương này' }).click();
  const panel = askPanel(page);
  await expect(panel).toBeVisible();

  const box = await panel.boundingBox();
  expect(box, 'panel không có hộp nào').not.toBeNull();
  const b = box as { x: number; y: number; width: number; height: number };

  // Nằm TRONG khung nhìn: một panel vẽ tràn ra ngoài mép ở 375px là một panel
  // người dùng điện thoại không đọc hết được.
  expect(b.width, `panel rộng ${String(b.width)}px trong khung nhìn 375px`).toBeLessThanOrEqual(375);
  expect(b.x, 'panel bắt đầu ở bên trái mép trái').toBeGreaterThanOrEqual(0);
  expect(b.x + b.width, 'panel tràn qua mép phải').toBeLessThanOrEqual(375 + 1);

  // Và TRÊN CÙNG ở ba điểm, không chỉ một: một góc bị phủ vẫn là một góc không
  // bấm được, và chỗ hay bị phủ nhất là mép trên (thanh topbar dính).
  const probes = [
    { name: 'trên', x: b.x + b.width / 2, y: b.y + 6 },
    { name: 'giữa', x: b.x + b.width / 2, y: b.y + b.height / 2 },
    { name: 'dưới', x: b.x + b.width / 2, y: b.y + b.height - 6 },
  ];
  for (const p of probes) {
    const hit = await page.evaluate(
      ({ x, y }: { x: number; y: number }) => {
        const el = document.elementFromPoint(x, y);
        const panelEl = document.querySelector('.ai-panel');
        return {
          inside: !!(el && panelEl && (panelEl === el || panelEl.contains(el))),
          got: el ? `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}` : 'null',
        };
      },
      { x: p.x, y: p.y },
    );
    expect(hit.inside, `điểm "${p.name}" của panel bị ${hit.got} phủ lên`).toBe(true);
  }

  await context.close();
});

// ═══════════════════════════════════════════════════════════════════════════
// KỊCH BẢN 2 — CẮM KEY → HỎI → BỊ ĐÒI XÁC NHẬN → BẤM → CHỮ CHẢY VỀ TỪNG MẢNH
// ═══════════════════════════════════════════════════════════════════════════

test('cắm key rồi hỏi: bị đòi xác nhận, bấm xong thì chữ chảy về từng mảnh', async ({
  page,
  context,
}) => {
  await instrument(context);
  await signIn(page);
  await plugKey(page);

  // ── nửa thứ nhất: lời gọi ĐẦU PHIÊN bị người gác chặn ────────────────────
  await openChapter(page);
  let panel = await askAboutChapter(page, 'Định lý 2.3 nói gì?');

  const alert = panel.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('xác nhận');

  // VÌ SAO nó xanh: người gác dừng lời gọi TRƯỚC khi chạm mạng. Không có chốt
  // này thì "bị đòi xác nhận" cũng xanh khi lời gọi đã đi ra rồi mới bị chặn —
  // tức là đúng thứ cần chặn đã xảy ra.
  expect(providerCalls, 'lời gọi đã ra tới nhà cung cấp DÙ chưa xác nhận').toHaveLength(0);
  await expect(panel.locator('[data-testid="ai-answer"]')).toHaveCount(0);

  // ── cú bấm: nó xảy ra ở ORIGIN KHO KHOÁ, JS trang chính không giả được ────
  const ui = await openVault(page);
  const consent = ui.locator('[data-role="consent"]');
  await expect(consent).toBeVisible();
  await consent.click();
  await expect(consent).toHaveCount(0);

  // ── nửa thứ hai: hỏi lại, và chữ phải CHẢY ───────────────────────────────
  await openChapter(page);
  panel = await askAboutChapter(page, 'Định lý 2.3 nói gì?');

  const answer = panel.locator('[data-testid="ai-answer"]');
  await expect(answer).toHaveText(FULL_ANSWER, { timeout: 30_000 });

  // Máy chủ giả đã nhận ĐÚNG một lời gọi, mang key trong ĐÚNG một header.
  expect(providerCalls).toHaveLength(1);
  expect(providerCalls[0].url).toBe('/v1/chat/completions');
  expect(providerCalls[0].authorization).toBe(`Bearer ${FAKE_KEY}`);
  expect(JSON.parse(providerCalls[0].body).stream).toBe(true);

  // ── ĐÂY LÀ CHỐT CỦA KỊCH BẢN NÀY ─────────────────────────────────────────
  // Không phải "có chữ hiện ra" — mà "chữ hiện ra NHIỀU LẦN, mỗi lần dài hơn
  // lần trước". Một bản cài đặt gom hết rồi vẽ một lần vượt qua mọi chốt ở
  // trên và chết ở đây.
  const frames = await page.evaluate(
    () => (window as unknown as { __frames: { text: string; at: number }[] }).__frames,
  );
  const shown = frames.filter((f) => f.text.length > 0);
  expect(
    shown.length,
    `ô trả lời chỉ đổi ${String(shown.length)} lần — chữ hiện MỘT LẦN, không chảy về từng mảnh`,
  ).toBeGreaterThanOrEqual(4);

  for (let i = 1; i < shown.length; i += 1) {
    expect(
      shown[i].text.startsWith(shown[i - 1].text),
      `trạng thái ${String(i)} không phải phần nối dài của trạng thái trước`,
    ).toBe(true);
  }
  expect(shown[shown.length - 1].text).toBe(FULL_ANSWER);

  // Và chúng cách nhau THẬT trong thời gian, không phải sáu commit trong cùng
  // một khung hình.
  expect(shown[shown.length - 1].at - shown[0].at).toBeGreaterThan(CHUNK_GAP_MS * 2);
});

// ═══════════════════════════════════════════════════════════════════════════
// KỊCH BẢN 3 — KEY KHÔNG RÒ RA KHỎI ORIGIN KHO KHOÁ
// ═══════════════════════════════════════════════════════════════════════════

test('key không rò: không ở localStorage/IndexedDB trang chính, không trong postMessage, không trong request tới API của ta', async ({
  page,
  context,
}) => {
  const rec = await instrument(context);
  await signIn(page);
  await plugKey(page);

  // Cắm key xong thì DÙNG nó: một phép quét chạy trước khi key từng được dùng
  // sẽ xanh mà không chứng minh gì cả.
  const ui = await openVault(page);
  await ui.locator('[data-role="consent"]').click();
  await openChapter(page);
  const panel = await askAboutChapter(page, 'Tóm tắt chương này.');
  await expect(panel.locator('[data-testid="ai-answer"]')).toHaveText(FULL_ANSWER, {
    timeout: 30_000,
  });

  // ── ĐỐI CHỨNG: key CÓ THẬT, và nó ở ĐÚNG chỗ phải ở ──────────────────────
  // Không có hai chốt này thì mọi chốt "không chứa key" ở dưới xanh một cách
  // rỗng — đúng bài học S2 Task 9: hỏi *nó xanh VÌ ĐIỀU GÌ*.
  const frame = await vaultFrame(page);
  expect(await allLocalStorage(frame), 'key KHÔNG có trong kho khoá — mọi chốt dưới đây rỗng').toContain(FAKE_KEY);
  expect(providerCalls[0].authorization, 'key chưa từng được dùng thật').toBe(`Bearer ${FAKE_KEY}`);

  // ── 1. `localStorage` của ORIGIN TRANG CHÍNH ─────────────────────────────
  expect(await allLocalStorage(page)).not.toContain(FAKE_KEY);

  // ── 2. IndexedDB (Dexie: năm bảng, kể cả outbox đồng bộ) ─────────────────
  const idb = await allIndexedDB(page);
  expect(idb).not.toContain(FAKE_KEY);

  // ── 3. Mọi `message` TRANG CHÍNH NHẬN ĐƯỢC ───────────────────────────────
  // Bề mặt rò rỉ thật nhất: giao thức là thứ duy nhất nối hai origin, và S2-F8
  // ghi rằng không phép quét chữ nào ở tầng nguồn đóng được nó.
  const msgs = await page.evaluate(
    () => (window as unknown as { __msgs: { origin: string; data: string }[] }).__msgs,
  );
  expect(msgs.length, 'không nhận được thông điệp nào — máy ghi chưa chạy').toBeGreaterThan(0);
  for (const m of msgs) {
    expect(m.data, `một thông điệp từ ${m.origin} mang key về trang chính`).not.toContain(FAKE_KEY);
  }

  // ── 4. Mạng: mọi request KHÔNG PHẢI tới nhà cung cấp ─────────────────────
  let scanned = 0;
  let toApi = 0;
  for (const r of rec.requests) {
    const url = r.url();
    if (url.startsWith(providerOrigin)) continue;
    scanned += 1;
    if (url.startsWith(API_ORIGIN)) toApi += 1;
    expect(url, 'key nằm trong URL').not.toContain(FAKE_KEY);
    const post = r.postData();
    if (post) expect(post, `key nằm trong thân request tới ${url}`).not.toContain(FAKE_KEY);
    // `headers()`, KHÔNG `allHeaders()`: bản `all…` chờ request được gửi xong,
    // và một request còn treo (ví dụ một luồng chưa đóng) treo luôn cả phép
    // quét — đo được ở lần chạy đầu, hết 90 s ngay tại dòng này.
    const headers = r.headers();
    for (const [k, v] of Object.entries(headers)) {
      expect(v, `key nằm trong header ${k} của ${url}`).not.toContain(FAKE_KEY);
    }
  }
  expect(scanned, 'không quét được request nào').toBeGreaterThan(0);
  expect(toApi, `không có request nào tới API của ta (${API_ORIGIN}) — phép quét không chạm tới thứ nó nói nó quét`).toBeGreaterThan(0);
});

// ═══════════════════════════════════════════════════════════════════════════
// KỊCH BẢN 4 — "ĐÀO SÂU" GIỮ ĐƯỢC CÔNG THỨC
// ═══════════════════════════════════════════════════════════════════════════

test('đào sâu một đoạn có công thức: lời nhắc gửi đi mang LaTeX gốc', async ({ page, context }) => {
  await instrument(context);
  await signIn(page);
  await plugKey(page);
  const ui = await openVault(page);
  await ui.locator('[data-role="consent"]').click();
  await openChapter(page);

  // Một đoạn văn CÓ công thức nội dòng, có nguồn TeX, không nằm trong `<details>`
  // đang đóng (rect của nó không ở chỗ nó được vẽ — bẫy đã ghi ở helpers.ts).
  // KHÔNG đặt thuộc tính đánh dấu lên DOM chương: `NormMap` của P2 mô tả đúng
  // cây ấy, và một phép đo phải không được sửa thứ nó sắp đo. Trả về CHỈ SỐ.
  //
  // ĐIỂM BẤM PHẢI NẰM NGOÀI CÔNG THỨC — đo được, không phải đề phòng.
  // `locator.click({clickCount:3})` bấm vào TÂM phần tử, và ở đoạn văn được
  // chọn thì tâm rơi vào giữa một `<span class="katex">`. KaTeX dựng ba cây
  // chồng lên nhau (MathML ẩn, nguồn TeX, cây glyph), nên bấm ba lần bên trong
  // nó không chọn cả đoạn văn mà chọn một nút con tí xíu: lần chạy đầu tiên trả
  // về vùng chọn đúng **một ký tự** (`"i"`), và chốt LaTeX bên dưới đỏ vì một
  // lý do không liên quan gì tới LaTeX.
  //
  // Nên: tìm một nút chữ THƯỜNG (ngoài mọi `.katex`) trong đúng đoạn ấy, lấy
  // hình chữ nhật của nó, rồi bấm ba lần tại đó — bấm ba lần trong văn bản
  // thường chọn cả khối, và cả khối thì có công thức.
  const target = await page.evaluate(() => {
    const root = document.querySelector('.fade-in');
    if (!root) return null;
    const paras = Array.from(root.querySelectorAll('p'));
    for (const p of paras) {
      if (p.closest('details:not([open])')) continue;
      const kx = Array.from(p.querySelectorAll('.katex')).find(
        (k) => !k.classList.contains('katex-display'),
      );
      const tex = kx?.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
      if (!kx || !tex || tex.length < 4) continue;
      const len = (p.textContent ?? '').length;
      if (len < 60 || len > 1500) continue;

      // `behavior: 'instant'` bắt buộc: `reader.css` đặt `scroll-behavior: smooth`,
      // và một phép cuộn còn đang chạy trả về hình chữ nhật ở chỗ khác với chỗ
      // con chuột sẽ hạ xuống (bẫy đã ghi ở `helpers.ts`).
      p.scrollIntoView({ block: 'center', behavior: 'instant' });

      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode() as Text | null;
      while (node) {
        const plain = !node.parentElement?.closest('.katex');
        if (plain && node.data.trim().length >= 8) break;
        node = walker.nextNode() as Text | null;
      }
      if (!node) continue;

      const r = document.createRange();
      r.setStart(node, 0);
      r.setEnd(node, Math.min(6, node.data.length));
      const rect = r.getClientRects()[0];
      if (!rect) continue;
      return {
        tex,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        viewportHeight: window.innerHeight,
      };
    }
    return null;
  });
  expect(target, 'không tìm thấy đoạn văn nào có công thức nội dòng trong chương này').not.toBeNull();
  const { tex, x, y, viewportHeight } = target as {
    tex: string;
    x: number;
    y: number;
    viewportHeight: number;
  };
  expect(y > 0 && y < viewportHeight, `điểm bấm ở y=${String(y)} ngoài khung nhìn`).toBe(true);

  // Bôi đen bằng một cử chỉ THẬT, không phải `Selection` dựng bằng mã: thứ cổng
  // này hỏi là "người dùng có bấm tới được không".
  await page.mouse.click(x, y, { clickCount: 3 });

  // Vùng chọn CÓ THẬT chứa công thức — nếu không, chốt LaTeX ở dưới xanh rỗng.
  const selectionHasMath = await page.evaluate(() => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    return sel.getRangeAt(0).cloneContents().querySelector('.katex') !== null;
  });
  expect(selectionHasMath, 'bôi đen không chứa công thức nào').toBe(true);

  await page.locator('.ann-tb-dive').click();

  const panel = page.getByRole('dialog', { name: 'Đào sâu' });
  await expect(panel).toBeVisible();

  // "Đào sâu" tự hỏi ngay khi mở — không cần gõ gì.
  await expect(panel.locator('[data-testid="ai-answer"]')).toHaveText(FULL_ANSWER, {
    timeout: 30_000,
  });

  // ── CHỐT: LaTeX GỐC nằm trong lời nhắc ĐÃ RỜI MÁY ────────────────────────
  // Đo trên thân request mà nhà cung cấp giả thật sự nhận, không phải trên một
  // giá trị nội bộ của React.
  expect(providerCalls).toHaveLength(1);
  const sent = JSON.parse(providerCalls[0].body) as {
    messages: { role: string; content: string }[];
  };
  const system = sent.messages.find((m) => m.role === 'system');
  expect(system, 'lời nhắc gửi đi không có vai system').toBeTruthy();
  expect(
    (system as { content: string }).content,
    `lời nhắc gửi đi không mang LaTeX gốc ${JSON.stringify(`$${tex}$`)}`,
  ).toContain(`$${tex}$`);

  // Và thứ hiện lại cho người học là ĐÚNG thứ đã gửi.
  await expect(panel.locator('[data-testid="ai-quote"]')).toContainText(`$${tex}$`);
});

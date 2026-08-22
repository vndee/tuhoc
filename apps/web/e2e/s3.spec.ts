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
import { PASSWORD, REPO_ROOT, freshEmail, registerNewUser } from './helpers';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HỆ THỐNG CON 3 — CỔNG NGHIỆM THU ĐẦU-CUỐI (Task 7)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Năm kịch bản, tất cả ĐI QUA GIAO DIỆN THẬT: một trình duyệt thật, ba origin
 * thật (ứng dụng · registry tĩnh · kho khoá), một API thật trong docker, và
 * một bản dựng PRODUCTION. Không một hàm nào của `apps/web/src/registry/**`
 * được gọi thẳng ở tệp này. Ruling S1-F29 sinh ra vì cổng đơn vị không hỏi
 * được câu *"người dùng có bấm tới được không"*; tệp này hỏi được, nhưng **chỉ
 * khi nó thật sự bấm**.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 1. VÌ SAO TỆP NÀY DỰNG LẠI BUNDLE — và vì sao chỉ index.json là KHÔNG ĐỦ
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `VITE_REGISTRY_URL` được Vite thay bằng HẰNG SỐ lúc dịch, và
 * `playwright.config.ts` chỉ truyền `VITE_API_URL` vào `bun run build`. Trên
 * bản dựng mặc định `configuredRegistryBase()` NÉM (`PUBLIC_REGISTRY_BASE` là
 * `null`, có chủ ý — xem `registry/index.ts`), nên `/catalog` chỉ vẽ được đúng
 * một câu: *"Chưa có địa chỉ registry"*. Một cổng chạy trên bản dựng ấy xanh
 * vĩnh viễn mà không kiểm được gì.
 *
 * Báo cáo Task 6 §10 để lại một việc cụ thể cho task này, và nó là nửa dễ bị
 * bỏ sót: `VITE_REGISTRY_URL` phải trỏ vào một `index.json` **VÀ** một cây
 * `courses/<id>/<version>.zip`. **Chỉ index thôi là không đủ** — cửa import
 * nhận BYTE CỦA MỘT ZIP (`ImportSource` biến thể `zipUrl`), không nhận một thư
 * mục tệp rời trên máy chủ tĩnh. `tools/registry/src/pack-site.ts` sinh ra cây
 * ấy, và `beforeAll` dưới đây gọi **đúng hai lệnh mà workflow publish gọi**:
 *
 *     bun tools/registry/src/pack-site.ts   --root <root> --out  <site>
 *     bun tools/registry/src/build-index.ts --root <root> --out  <site>/index.json
 *
 * Chạy chính hai lệnh ấy (thay vì viết tay một `index.json` trong test) là thứ
 * làm cho kịch bản 2 đo được **hợp đồng giữa hai dự án**: nếu `pack-site` đổi
 * bố cục đường dẫn mà `registryPackagePath` không đổi theo, cổng này đỏ ở tầng
 * mạng, đúng nơi người đọc gặp nó.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 2. CÂY COURSE CỦA REGISTRY CÓ BA GÓI, VÀ GÓI THỨ BA LÀ MỘT PHÉP ĐO
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `fixtures/courses/` có đúng hai gói và **cả hai đều `lang: "vi"`**. Dựng
 * catalog trên riêng hai gói ấy để lại một lỗ đọc được bằng mắt: một cài đặt
 * vẽ nhãn ngôn ngữ bằng hằng số `'vi'` sẽ **xanh trọn vẹn**. Nên cây registry
 * của lần chạy này được dựng trong scratch (`node_modules/.s3-registry/`, đã
 * `.gitignore`) từ ba nguồn:
 *
 *   · `so-dau-phay-dong`  — chép nguyên, `lang: vi`, `tier: interactive`
 *   · `bat-bien-vong-lap` — chép nguyên, `lang: vi`, `tier: content`
 *   · `loop-invariants`   — chép từ gói trên, manifest đổi `id`/`lang`/`title`
 *
 * Gói thứ ba mua hai thứ, và cả hai đều là "cổng này xanh VÌ ĐIỀU GÌ":
 *
 *   a. **hai nhãn ngôn ngữ KHÁC NHAU trên hai hàng khác nhau**, nên nhãn viết
 *      cứng chết;
 *   b. **một id mà origin của ứng dụng KHÔNG phục vụ**. `course/loader.ts` có
 *      NGUỒN 2 — thư mục tĩnh `/courses/<id>/` ship trong `dist/` — nên kéo
 *      `so-dau-phay-dong` về rồi mở chương của nó sẽ xanh **kể cả khi nút kéo
 *      về không làm gì cả**. Kịch bản 2 vì thế kéo `loop-invariants`, và mở
 *      đầu bằng một ĐỐI CHỨNG: trước khi kéo, `/c/loop-invariants` nói *"Không
 *      tìm thấy khóa học."*
 *
 * `manifest.id` phải bằng tên thư mục — `tools/registry/src/tree.ts` báo
 * `REGISTRY_ID_MISMATCH` nếu không, và `packSite` từ chối đóng gói. Nên gói
 * thứ ba đổi cả hai, cùng một chỗ.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 3. HAI MÁY CHỦ TĨNH, TRONG CHÍNH TIẾN TRÌNH NÀY, TRÊN CỔNG ĐỘNG
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Cùng lý do `s2.spec.ts` đã ghi: `kill $!` không với tới tiến trình con của
 * `bunx` (đã rò một lần), còn một máy chủ `node:http` trong worker chết cùng
 * worker. Và cổng **hỏi hệ điều hành** chứ không viết cứng: trên máy này 5173
 * và 8089 đang bị hai tiến trình LẠ giữ, và ba agent đã suýt kết luận sai vì
 * Playwright lái nhầm ứng dụng của người khác. Mỗi kịch bản dưới đây vì thế mở
 * đầu bằng `expectRightApp(page)` — *"tôi có đang nhìn đúng trang không"* là
 * một câu hỏi được TRẢ LỜI, không phải một giả định.
 *
 * Máy chủ registry gửi `access-control-allow-origin: *` và **không gửi header
 * nào khác cần preflight**, đúng hình dạng GitHub Pages. Đó là thứ Task 6 §9.2
 * ghi là *"suy luận, không phải phép đo"*: từ đây trở đi, một `fetch` zip
 * xuyên origin trong một trình duyệt thật được ĐO. Nó vẫn không phải Pages —
 * xem "cổng này mù ở đâu" trong báo cáo.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * 4. MỘT LẦN ĐĂNG KÝ CHO CẢ NĂM KỊCH BẢN
 * ───────────────────────────────────────────────────────────────────────────
 *
 * API chặn `/auth/*` ở **10 lời gọi mỗi phút mỗi IP**, và cả bộ e2e đi ra từ
 * ĐÚNG MỘT IP (cổng docker). `s2.spec.ts` đã ghi vách đá ấy: ở 17 bài,
 * `viz.spec.ts` — bài cuối, chẳng liên quan gì tới đăng nhập — hỏng ở
 * `registerNewUser`. Tệp này thêm **5 bài**, nên nó đăng ký **đúng một lần**
 * trong `beforeAll` và mọi kịch bản mượn lại `storageState`. Tổng chi phí
 * `/auth/*` của cả tệp: **1**.
 */

// ───────────────────────── hằng số của cổng ─────────────────────────

/** Cùng phép tính với `playwright.config.ts` và `s2.spec.ts`. */
const WEB_ORIGIN = `http://localhost:${process.env.TUHOC_E2E_WEB_PORT ?? '5183'}`;

const API_ORIGIN = (
  process.env.VITE_API_URL ?? `http://localhost:${process.env.TUHOC_E2E_API_PORT ?? '8089'}`
).replace(/\/+$/, '');

/** `fixtures/courses/so-dau-phay-dong` — `lang: vi`, `tier: interactive`. */
const VI_INTERACTIVE_ID = 'so-dau-phay-dong';
const VI_INTERACTIVE_TITLE = 'Số dấu phẩy động';

/** `fixtures/courses/bat-bien-vong-lap` — `lang: vi`, `tier: content`. */
const VI_CONTENT_ID = 'bat-bien-vong-lap';
const VI_CONTENT_TITLE = 'Bất biến vòng lặp';

/** Gói thứ ba, dựng trong scratch — `lang: en`, `tier: content`. Xem mục 2. */
const EN_CONTENT_ID = 'loop-invariants';
const EN_CONTENT_TITLE = 'Loop invariants';
const EN_CONTENT_VERSION = '1.0.0';
/** `manifest.parts[0].chapters[0].id` của gói được chép — không đổi. */
const EN_FIRST_CHAPTER_ID = 'c1';

/**
 * Chữ mà NGƯỜI ĐỌC nhìn thấy, ghim nguyên văn.
 *
 * Chép từ `packages/i18n/src/messages/{vi,en}.ts` chứ không nhập vào: một bài
 * e2e nhập chính catalog mà nó đang kiểm sẽ xanh khi ai đó đổi một câu thành
 * chuỗi rỗng. Đây đúng là chỗ chép có ích — cùng lựa chọn `s2.spec.ts` làm với
 * *"Trợ lý AI chạy bằng key của chính bạn"*.
 */
const VI = {
  navCatalog: 'Danh mục registry',
  navMain: 'Điều hướng chính',
  catalogTitle: 'Danh mục khóa học',
  catalogListAria: 'Khóa học trên registry',
  filterLangLabel: 'Ngôn ngữ của khóa học',
  filterAllLangs: 'Tất cả ngôn ngữ',
  tierInteractive: 'interactive — chạy mã JavaScript',
  interactiveWarning: 'Gói này được phép chạy JavaScript trong trình duyệt của bạn khi bạn mở nó.',
  pullAction: 'Kéo về thư viện',
  pullOpen: 'Mở khóa học',
  courseNotFound: 'Không tìm thấy khóa học.',
  langSwitcher: 'Ngôn ngữ giao diện',
  boundaryTitle: 'Màn hình này gặp lỗi',
  /** Mảnh RIÊNG của `registry.error.notJson` — không xuất hiện ở bốn câu lỗi kia. */
  notJsonFragment: 'trả về một trang web chứ không phải danh mục',
  vaultHeading: 'Trợ lý AI chạy bằng key của chính bạn',
} as const;

const EN = {
  catalogTitle: 'Course catalog',
  catalogListAria: 'Courses on the registry',
  tierInteractive: 'interactive — runs JavaScript',
  /** Nhãn của CHÍNH bộ chọn ngôn ngữ cũng được dịch — xem kịch bản 3. */
  langSwitcher: 'Interface language',
} as const;

/** Key gõ DỞ của kịch bản 5. Không bao giờ được lưu — nó chỉ nằm trong ô nhập. */
const HALF_TYPED_KEY = 'sk-s3gate-nua-chung';

// ───────────────────────── trạng thái dựng ở beforeAll ─────────────────────────

const WEB_DIR = resolve(REPO_ROOT, 'apps', 'web');
const VAULT_DIR = resolve(REPO_ROOT, 'apps', 'vault');
const WEB_DIST = resolve(WEB_DIR, 'dist');

/**
 * Bản sao lưu `dist/` và cây registry của lần chạy này, cả hai DƯỚI
 * `node_modules/` — cùng lý do `s2.spec.ts` ghi: thư mục ấy đã được
 * `.gitignore` bỏ qua VÀ nằm cùng hệ tệp với `dist/`, nên `renameSync` lúc
 * khôi phục là một thao tác nguyên tử. Không một tệp được git theo dõi nào bị
 * chạm tới ở tệp này (S1-F9).
 */
const SCRATCH = resolve(WEB_DIR, 'node_modules', '.s3-registry');
const REGISTRY_ROOT = join(SCRATCH, 'root');
const REGISTRY_SITE = join(SCRATCH, 'site');
const WEB_DIST_BACKUP = resolve(WEB_DIR, 'node_modules', '.s3-dist-backup');

let registryPort = 0;
let vaultPort = 0;
let registryOrigin = '';
let vaultOrigin = '';
let registryServer: Server | null = null;
let vaultServer: Server | null = null;
let distFingerprintBefore = '';
let borrowedSession: Awaited<ReturnType<BrowserContext['storageState']>> | null = null;

/**
 * Kịch bản 4 cần `index.json` trả về HTML. `VITE_REGISTRY_URL` là hằng số lúc
 * dịch, nên không dựng được một origin thứ hai mà không dựng lại bundle — máy
 * chủ đổi CHẾ ĐỘ thay vì đổi địa chỉ.
 *
 * An toàn vì `playwright.config.ts` đặt `fullyParallel: false` và
 * `workers: 1`: các bài chạy tuần tự trong một tiến trình. Bài duy nhất bật
 * chế độ này tắt nó lại trong `finally`, và mọi phản hồi mang
 * `cache-control: no-store` nên không lần bấm nào đọc trúng bản cũ.
 */
type RegistryMode = 'ok' | 'html';
let registryMode: RegistryMode = 'ok';

/** Thân mà một máy chủ tĩnh trả cho đường dẫn nó không có — hình dạng `815a472`. */
const PAGES_404_HTML =
  '<!DOCTYPE html><html lang="en"><head><title>Site not found</title></head>' +
  '<body><h1>404</h1><p>There is not a GitHub Pages site here.</p></body></html>';

// ───────────────────────── tiện ích hạ tầng ─────────────────────────

/** Cổng còn trống, hỏi hệ điều hành chứ không đoán (xem mục 3). */
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
    throw new Error(
      `${script} hỏng.\n--- stdout ---\n${err.stdout ?? ''}\n--- stderr ---\n${err.stderr ?? ''}`,
    );
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
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
 * Máy chủ tĩnh cho `_site` của registry.
 *
 * `access-control-allow-origin: *` và **không gì khác**: một `fetch` không đặt
 * header nào là một CORS ĐƠN GIẢN, không preflight — đúng thứ GitHub Pages
 * phục vụ được và đúng thứ `fetchRegistryIndex`/`fetchBytes` gửi. Thêm một
 * `access-control-allow-headers` ở đây sẽ làm cổng này dễ hơn thực tế.
 *
 * Không SPA fallback. Một fallback biến "thiếu tệp" thành "200 kèm HTML" ở
 * MỌI đường dẫn, tức là biến kịch bản 4 thành hành vi mặc định và giấu mất một
 * đường dẫn zip sai.
 */
function serveRegistry(rootDir: string, port: number): Promise<Server> {
  const srv = createServer((req, res) => {
    const rawPath = decodeURIComponent((req.url ?? '/').split('?')[0]);

    if (rawPath === '/index.json' && registryMode === 'html') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      res.end(PAGES_404_HTML);
      return;
    }

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

/** Máy chủ tĩnh cho `apps/vault/dist` — cùng khuôn `s2.spec.ts`, không fallback. */
function serveVault(rootDir: string, port: number): Promise<Server> {
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

function closeServer(srv: Server | null): Promise<void> {
  if (!srv) return Promise.resolve();
  return new Promise((ok) => {
    srv.closeAllConnections();
    srv.close(() => {
      ok();
    });
  });
}

/**
 * Cây course của registry cho lần chạy này. Xem mục 2 ở đầu tệp.
 *
 * Đọc `fixtures/courses/` và GHI vào scratch. Không một byte nào của
 * `fixtures/` bị sửa — `cpSync` chỉ đọc bên nguồn.
 */
function buildRegistryTree(): void {
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(REGISTRY_ROOT, { recursive: true });
  mkdirSync(REGISTRY_SITE, { recursive: true });

  const fixtures = resolve(REPO_ROOT, 'fixtures', 'courses');
  for (const id of [VI_INTERACTIVE_ID, VI_CONTENT_ID]) {
    const from = join(fixtures, id);
    if (!existsSync(from)) {
      throw new Error(
        `Không tìm thấy gói mẫu ${from}. Cổng này chạy trên GÓI THẬT trong repo, ` +
          'không phải một cây dựng trong lúc chạy test.',
      );
    }
    cpSync(from, join(REGISTRY_ROOT, id), { recursive: true });
  }

  // Gói thứ ba: cùng nội dung, manifest khác ba trường. `id` PHẢI bằng tên thư
  // mục — `tree.ts` báo `REGISTRY_ID_MISMATCH` nếu không, và `packSite` bỏ gói.
  const enDir = join(REGISTRY_ROOT, EN_CONTENT_ID);
  cpSync(join(fixtures, VI_CONTENT_ID), enDir, { recursive: true });
  const manifestPath = join(enDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.id = EN_CONTENT_ID;
  manifest.lang = 'en';
  manifest.title = EN_CONTENT_TITLE;
  manifest.description = 'Three chapters on proving a loop correct for every input.';
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

// ───────────────────────── dựng / dọn ─────────────────────────

test.beforeAll(async ({ browser }) => {
  // Ba lệnh `bun` cộng hai lần `tsc -b && vite build`: đây là ngân sách hạ
  // tầng, không phải một chốt nào đang chờ.
  test.setTimeout(900_000);

  registryPort = await freePort();
  vaultPort = await freePort();
  registryOrigin = `http://127.0.0.1:${String(registryPort)}`;
  vaultOrigin = `http://localhost:${String(vaultPort)}`;

  buildRegistryTree();

  // ĐÚNG hai lệnh mà `.github/workflows/registry.yml` chạy, cùng thứ tự.
  const packOut = runRegistryTool('pack-site.ts', ['--root', REGISTRY_ROOT, '--out', REGISTRY_SITE]);
  const indexOut = runRegistryTool('build-index.ts', [
    '--root',
    REGISTRY_ROOT,
    '--out',
    join(REGISTRY_SITE, 'index.json'),
  ]);

  // ── CHỐT CHỐNG CỔNG MÙ #1: registry có ĐÚNG thứ ta nghĩ nó có ────────────
  // Không có khối này, một `pack-site` sinh 0 gói sẽ hiện ra ở kịch bản 2 dưới
  // dạng "không tìm thấy nút" — một triệu chứng trông y hệt hồi quy mã ứng dụng.
  const index = JSON.parse(readFileSync(join(REGISTRY_SITE, 'index.json'), 'utf8')) as {
    schema: number;
    courses: { id: string; lang: string; tier: string; latest: string }[];
  };
  expect(index.schema, `schema lạ trong index.json vừa sinh\n${indexOut}`).toBe(1);
  expect(
    index.courses.map((c) => `${c.id} ${c.lang} ${c.tier} ${c.latest}`).sort(),
    `index.json vừa sinh không có ba gói mong đợi\n${indexOut}`,
  ).toEqual([
    `${VI_CONTENT_ID} vi content 1.0.0`,
    `${EN_CONTENT_ID} en content ${EN_CONTENT_VERSION}`,
    `${VI_INTERACTIVE_ID} vi interactive 1.0.0`,
  ].sort());
  for (const c of index.courses) {
    const zip = join(REGISTRY_SITE, 'courses', c.id, `${c.latest}.zip`);
    expect(existsSync(zip), `pack-site không ghi ${zip}\n${packOut}`).toBe(true);
  }

  // ── dựng lại hai bundle ─────────────────────────────────────────────────
  expect(
    existsSync(WEB_DIST),
    `${WEB_DIST} chưa tồn tại — webServer của playwright.config.ts đã dựng chưa?`,
  ).toBe(true);
  rmSync(WEB_DIST_BACKUP, { recursive: true, force: true });
  cpSync(WEB_DIST, WEB_DIST_BACKUP, { recursive: true });
  distFingerprintBefore = fingerprint(WEB_DIST_BACKUP);

  // Kho khoá cần cho kịch bản 5; nó tin ĐÚNG origin Playwright sẽ mở.
  build(VAULT_DIR, { VITE_APP_ORIGIN: WEB_ORIGIN }, 'apps/vault');
  build(
    WEB_DIR,
    {
      VITE_REGISTRY_URL: registryOrigin,
      VITE_VAULT_ORIGIN: vaultOrigin,
      VITE_API_URL: API_ORIGIN,
    },
    'apps/web (có VITE_REGISTRY_URL + VITE_VAULT_ORIGIN)',
  );

  // ── CHỐT CHỐNG CỔNG MÙ #2: hai biến môi trường VÀO ĐƯỢC bundle ──────────
  const bundles = readdirSync(join(WEB_DIST, 'assets'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(WEB_DIST, 'assets', f), 'utf8'));
  expect(
    bundles.some((b) => b.includes(registryOrigin)),
    `bundle vừa dựng không chứa ${registryOrigin} — VITE_REGISTRY_URL không vào được bản dựng`,
  ).toBe(true);
  expect(
    bundles.some((b) => b.includes(vaultOrigin)),
    `bundle vừa dựng không chứa ${vaultOrigin} — VITE_VAULT_ORIGIN không vào được bản dựng`,
  ).toBe(true);

  registryServer = await serveRegistry(REGISTRY_SITE, registryPort);
  vaultServer = await serveVault(resolve(VAULT_DIR, 'dist'), vaultPort);

  // ── "tôi có đang phục vụ đúng thứ tôi vừa dựng không" ───────────────────
  const probe = await fetch(`${registryOrigin}/index.json`);
  expect(probe.status, `${registryOrigin}/index.json không trả 200`).toBe(200);
  expect(probe.headers.get('access-control-allow-origin')).toBe('*');
  const zipProbe = await fetch(
    `${registryOrigin}/courses/${EN_CONTENT_ID}/${EN_CONTENT_VERSION}.zip`,
  );
  expect(zipProbe.status, 'gói .zip của registry không phục vụ được').toBe(200);
  expect((await zipProbe.arrayBuffer()).byteLength).toBeGreaterThan(1000);
  const vaultProbe = await fetch(`${vaultOrigin}/`);
  expect(vaultProbe.status, `${vaultOrigin}/ không trả 200`).toBe(200);
  expect(await vaultProbe.text()).toContain('vault-ui');

  // ── một lần đăng ký cho cả năm kịch bản (xem mục 4) ─────────────────────
  const context = await browser.newContext({ baseURL: WEB_ORIGIN });
  const page = await context.newPage();
  await page.goto(`${WEB_ORIGIN}/login`);
  await registerNewUser(page, freshEmail(), PASSWORD);
  borrowedSession = await context.storageState();
  await context.close();
  expect(borrowedSession.cookies.length, 'đăng ký xong mà không có cookie phiên nào').toBeGreaterThan(0);
});

test.afterAll(async () => {
  await closeServer(registryServer);
  await closeServer(vaultServer);
  registryServer = null;
  vaultServer = null;

  // Trả `dist/` về nguyên trạng, và CHỨNG MINH đã trả về: `viz.spec.ts` chạy
  // sau tệp này (thứ tự chữ cái) và có chốt "không lỗi console nào" — một
  // `<iframe>` kho khoá trỏ vào cổng đã đóng sẽ nổ ERR_CONNECTION_REFUSED
  // trong console của nó, và một `/catalog` trỏ vào registry đã đóng cũng thế.
  if (existsSync(WEB_DIST_BACKUP)) {
    rmSync(WEB_DIST, { recursive: true, force: true });
    renameSync(WEB_DIST_BACKUP, WEB_DIST);
    const after = fingerprint(WEB_DIST);
    expect(after, 'dist/ KHÔNG được trả về nguyên trạng').toBe(distFingerprintBefore);
  }
  rmSync(SCRATCH, { recursive: true, force: true });
});

// ───────────────────────── đồ nghề dùng chung ─────────────────────────

interface Session {
  readonly context: BrowserContext;
  readonly page: Page;
  /** Mọi URL request mà trình duyệt phát ra, theo thứ tự. */
  readonly requests: string[];
}

/** Một context ĐÃ ĐĂNG NHẬP, mượn phiên của `beforeAll` — 0 lời gọi `/auth/*`. */
async function signedIn(browser: Browser): Promise<Session> {
  const context = await browser.newContext({
    baseURL: WEB_ORIGIN,
    storageState: borrowedSession ?? undefined,
  });
  const requests: string[] = [];
  context.on('request', (r) => {
    requests.push(r.url());
  });
  const page = await context.newPage();
  return { context, page, requests };
}

/**
 * *"Tôi có đang nhìn đúng trang không"* — trả lời trước khi đo bất cứ gì.
 *
 * Ba agent đã suýt kết luận sai vì Playwright lái nhầm một ứng dụng đang giữ
 * một cổng quen thuộc. Hai chốt, vì một mình chốt origin không đủ: một máy chủ
 * lạ ở đúng cổng ấy cũng cho origin đúng.
 */
async function expectRightApp(page: Page): Promise<void> {
  expect(page.url().startsWith(WEB_ORIGIN), `trang đang mở là ${page.url()}`).toBe(true);
  await expect(page.getByRole('navigation', { name: VI.navMain })).toBeVisible();
}

/** Vào `/catalog` BẰNG CÁCH BẤM, không bằng cách gõ URL (S1-F29). */
async function openCatalogByClicking(page: Page): Promise<void> {
  await page.goto(`${WEB_ORIGIN}/`);
  await expectRightApp(page);
  await page.getByRole('navigation', { name: VI.navMain }).getByRole('link', { name: VI.navCatalog }).click();
  await page.waitForURL((url) => url.pathname === '/catalog');
}

function catalogList(page: Page) {
  return page.getByRole('list', { name: VI.catalogListAria });
}

function catalogRow(page: Page, title: string) {
  return catalogList(page).locator('li.lib-item', { hasText: title });
}

/** Nhan đề của mọi hàng đang hiện, theo thứ tự — dùng cho so-bằng-ĐÚNG cả mảng. */
async function shownTitles(page: Page): Promise<string[]> {
  return catalogList(page).locator('.lib-item-title').allInnerTexts();
}

/** Đường dẫn (không origin) của mọi request tới registry, đã lọc trùng và sắp xếp. */
function registryPaths(requests: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const url of requests) {
    if (url.startsWith(registryOrigin)) seen.add(url.slice(registryOrigin.length));
  }
  return [...seen].sort();
}

// ═══════════════════════════════════════════════════════════════════════════
// KỊCH BẢN 1 — DUYỆT CATALOG: NHÃN NGÔN NGỮ VÀ NHÃN HẠNG, TRƯỚC KHI BẤM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hạng là một quyết định AN NINH, không phải một phân loại nội dung: hạng
 * `interactive` được phép chạy JavaScript trong trình duyệt của người đọc. Nên
 * bài này không hỏi *"có một cái nhãn không"* mà hỏi **ba** câu, và câu thứ ba
 * là câu mà một mutant từng sống sót:
 *
 *   1. nhãn hạng nói ra HẬU QUẢ (`interactive — chạy mã JavaScript`), không chỉ
 *      chữ `interactive`;
 *   2. câu cảnh báo có mặt ở hàng `interactive`;
 *   3. **và VẮNG MẶT ở hai hàng `content`.**
 *
 * Vòng đo mutant của Task 6 ghi lại đúng chỗ này: một mutant dán cảnh báo lên
 * MỌI hàng vẫn để 72/72 test xanh, vì đối chứng khớp nhầm chữ của nhãn hạng
 * thay vì chữ của cảnh báo. Hai chuỗi ở đây là hai hằng số riêng và bài đo
 * cả hai chiều.
 */
test('duyệt catalog: mỗi hàng nói ngôn ngữ và HẠNG của nó, trước khi có ai bấm', async ({
  browser,
}) => {
  const s = await signedIn(browser);
  try {
    await openCatalogByClicking(s.page);
    await expect(s.page.getByRole('heading', { name: VI.catalogTitle })).toBeVisible();

    // So-bằng-ĐÚNG cả mảng: `toContain` cũng đúng với một catalog vẽ thêm hàng
    // từ đâu đó khác, hoặc thiếu một hàng.
    await expect(catalogList(s.page).locator('li.lib-item')).toHaveCount(3);
    expect((await shownTitles(s.page)).sort()).toEqual(
      [VI_INTERACTIVE_TITLE, VI_CONTENT_TITLE, EN_CONTENT_TITLE].sort(),
    );

    // ── nhãn NGÔN NGỮ: hai giá trị khác nhau trên hai hàng khác nhau ───────
    // Một cài đặt vẽ `'vi'` viết cứng chết ở hàng thứ ba, và chỉ ở đó.
    const rowLang = async (title: string): Promise<string> =>
      (await catalogRow(s.page, title).locator('.lib-meta-part').first().innerText()).trim();
    expect(await rowLang(VI_INTERACTIVE_TITLE)).toBe('vi');
    expect(await rowLang(VI_CONTENT_TITLE)).toBe('vi');
    expect(await rowLang(EN_CONTENT_TITLE)).toBe('en');

    // ── nhãn HẠNG ─────────────────────────────────────────────────────────
    const interactiveRow = catalogRow(s.page, VI_INTERACTIVE_TITLE);
    const contentRow = catalogRow(s.page, VI_CONTENT_TITLE);
    const enRow = catalogRow(s.page, EN_CONTENT_TITLE);

    await expect(interactiveRow.locator('.lib-tier')).toHaveText(VI.tierInteractive);
    await expect(contentRow.locator('.lib-tier')).toHaveText('content');
    await expect(enRow.locator('.lib-tier')).toHaveText('content');

    // ── câu cảnh báo an ninh: CÓ ở đúng một hàng, VẮNG ở hai hàng kia ──────
    // Hai chuỗi RIÊNG BIỆT, và một chốt khẳng định chúng là hai node khác nhau
    // — không có nó, một bài "thấy cảnh báo" có thể đang thấy nhãn hạng.
    const warning = interactiveRow.getByText(VI.interactiveWarning);
    await expect(warning).toBeVisible();
    await expect(interactiveRow.locator('.lib-tier')).not.toHaveText(VI.interactiveWarning);
    await expect(contentRow.getByText(VI.interactiveWarning)).toHaveCount(0);
    await expect(enRow.getByText(VI.interactiveWarning)).toHaveCount(0);

    // ── nhãn nằm TRÊN nút, trên MÀN HÌNH — câu chỉ e2e hỏi được ────────────
    // Thứ tự DOM đã được `Catalog.test.tsx` ghim. Cái mà bài đơn vị KHÔNG hỏi
    // được là bố cục thật: một `position: absolute` đặt cảnh báo xuống dưới nút,
    // hoặc ra ngoài khung nhìn, vẫn giữ nguyên thứ tự DOM.
    const pullButton = interactiveRow.getByRole('button', { name: VI.pullAction });
    await expect(pullButton).toBeVisible();
    const warnBox = await warning.boundingBox();
    const btnBox = await pullButton.boundingBox();
    const badgeBox = await interactiveRow.locator('.lib-tier').boundingBox();
    expect(warnBox, 'câu cảnh báo không có hình chữ nhật nào — nó không được vẽ').not.toBeNull();
    expect(btnBox).not.toBeNull();
    expect(badgeBox).not.toBeNull();
    expect(
      (warnBox as { y: number }).y,
      'câu cảnh báo bị vẽ DƯỚI nút kéo về — người đọc bấm trước khi đọc',
    ).toBeLessThan((btnBox as { y: number }).y);
    expect((badgeBox as { y: number }).y).toBeLessThan((btnBox as { y: number }).y);

    // ── và chưa có gì được kéo về ─────────────────────────────────────────
    expect(registryPaths(s.requests), 'chưa ai bấm mà đã tải gói về').toEqual(['/index.json']);
  } finally {
    await s.context.close();
  }
});

/**
 * HC-3, nửa "lọc" — kế hoạch đo được rằng trước hệ thống con này `lang` chỉ để
 * VẼ CHỮ, không có dòng nào đọc nó để quyết định gì.
 *
 * Bộ chọn phải liệt kê ngôn ngữ **có trong dữ liệu**, không phải hai ngôn ngữ
 * của giao diện: một course tiếng Pháp phải tới được. Cây registry của lần chạy
 * này có `en` và `vi`, và cả hai đều là nhãn của COURSE — trùng tên với hai
 * ngôn ngữ giao diện là tình cờ, nên bài này cũng khẳng định số lựa chọn là 3
 * (`Tất cả` + 2) chứ không nhiều hơn.
 */
test('lọc theo ngôn ngữ: lựa chọn đến từ dữ liệu, và không giấu gì im lặng', async ({
  browser,
}) => {
  const s = await signedIn(browser);
  try {
    await openCatalogByClicking(s.page);
    const select = s.page.getByLabel(VI.filterLangLabel);
    await expect(select).toBeVisible();

    expect(await select.locator('option').allInnerTexts()).toEqual([VI.filterAllLangs, 'en', 'vi']);
    await expect(s.page.getByTestId('catalog-filter-count')).toHaveText('Đang hiện 3 trong 3 khóa học.');

    await select.selectOption('en');
    expect(await shownTitles(s.page)).toEqual([EN_CONTENT_TITLE]);
    await expect(s.page.getByTestId('catalog-filter-count')).toHaveText('Đang hiện 1 trong 3 khóa học.');

    await select.selectOption('vi');
    expect((await shownTitles(s.page)).sort()).toEqual([VI_INTERACTIVE_TITLE, VI_CONTENT_TITLE].sort());
    await expect(s.page.getByTestId('catalog-filter-count')).toHaveText('Đang hiện 2 trong 3 khóa học.');

    // Gỡ lại được bằng MỘT lần bấm, và trả về ĐÚNG danh sách ban đầu.
    await select.selectOption('');
    expect((await shownTitles(s.page)).sort()).toEqual(
      [VI_INTERACTIVE_TITLE, VI_CONTENT_TITLE, EN_CONTENT_TITLE].sort(),
    );
    await expect(s.page.getByTestId('catalog-filter-count')).toHaveText('Đang hiện 3 trong 3 khóa học.');
  } finally {
    await s.context.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// KỊCH BẢN 2 — KÉO MỘT COURSE VỀ → THƯ VIỆN → MỞ CHƯƠNG ĐỌC ĐƯỢC
// ═══════════════════════════════════════════════════════════════════════════

test('kéo một course về: nó vào thư viện, và chương của nó mở ra đọc được', async ({
  browser,
}) => {
  const s = await signedIn(browser);
  try {
    // ── ĐỐI CHỨNG, TRƯỚC KHI KÉO ──────────────────────────────────────────
    // `course/loader.ts` NGUỒN 2 phục vụ `/courses/<id>/` từ chính `dist/`, và
    // `make courses` bung CẢ HAI gói mẫu vào đó. Với một trong hai, cả kịch bản
    // này sẽ xanh KỂ CẢ KHI nút kéo về không làm gì. `loop-invariants` không có
    // ở đó, và đây là bằng chứng — hỏi thẳng origin của ứng dụng.
    await s.page.goto(`${WEB_ORIGIN}/c/${EN_CONTENT_ID}`);
    await expectRightApp(s.page);

    /**
     * Đo bằng THÂN PHẢN HỒI, không bằng mã trạng thái — một phép đo đầu tiên
     * dùng `status === 404` đã ĐỎ ở đây, và nó đỏ vì một sự thật đáng ghi:
     * `vite preview` (như `_redirects` trên host thật) có SPA fallback, nên
     * `/courses/<id-bất-kỳ>/manifest.json` trả về **200 kèm `index.html`**.
     * Không có gói nào ở đó, nhưng cũng không có 404 nào. Đúng hình dạng
     * `815a472`: HTML tới chỗ đang đợi JSON.
     */
    const probe = async (id: string) =>
      s.page.evaluate(async (courseId: string) => {
        const r = await fetch(`/courses/${courseId}/manifest.json`);
        const text = await r.text();
        return { status: r.status, isHtml: text.trimStart().toLowerCase().startsWith('<!doctype') };
      }, id);

    const missing = await probe(EN_CONTENT_ID);
    expect(
      missing.isHtml,
      `origin của ứng dụng ĐANG phục vụ một manifest thật cho ${EN_CONTENT_ID} ` +
        `(status ${String(missing.status)}) — kịch bản này sẽ xanh kể cả khi nút kéo về không làm gì`,
    ).toBe(true);

    // ĐỐI CHỨNG của đối chứng: với một course origin này THẬT SỰ có, cùng phép
    // đo phải cho kết quả ngược. Không có nó, một `fetch` hỏng theo cách nào đó
    // cũng cho `isHtml === true` và chốt trên xanh một cách rỗng.
    const present = await probe(VI_CONTENT_ID);
    expect(
      present,
      `origin của ứng dụng KHÔNG phục vụ ${VI_CONTENT_ID} — phép đo ở trên không ` +
        'phân biệt được "không có gói" với "fetch hỏng"',
    ).toEqual({ status: 200, isHtml: false });

    // …và màn hình không vẽ được course nào.
    await expect(s.page.getByRole('heading', { name: EN_CONTENT_TITLE })).toHaveCount(0);

    // ── kéo về, qua giao diện ──────────────────────────────────────────────
    await openCatalogByClicking(s.page);
    const row = catalogRow(s.page, EN_CONTENT_TITLE);
    await row.getByRole('button', { name: VI.pullAction }).click();

    const done = row.getByText(`Đã kéo ${EN_CONTENT_TITLE} phiên bản ${EN_CONTENT_VERSION} về thiết bị này.`);
    await expect(done).toBeVisible({ timeout: 60_000 });

    // Đi qua MẠNG, tới ĐÚNG hai địa chỉ và không địa chỉ nào khác. So-bằng-ĐÚNG
    // cả danh sách: một cài đặt tải rời từng tệp, hay gọi thêm GitHub API, phải
    // đỏ ở đây chứ không chỉ một cài đặt gọi sai một URL.
    expect(registryPaths(s.requests)).toEqual([
      `/courses/${EN_CONTENT_ID}/${EN_CONTENT_VERSION}.zip`,
      '/index.json',
    ]);

    // ── nó có trong THƯ VIỆN ──────────────────────────────────────────────
    await s.page.getByRole('navigation', { name: VI.navMain }).getByRole('link', { name: 'Thư viện' }).click();
    await s.page.waitForURL((url) => url.pathname === '/library');
    const libRow = s.page.locator('li.lib-item', { hasText: EN_CONTENT_TITLE });
    await expect(libRow).toHaveCount(1);
    await expect(libRow.locator('.lib-tier')).toHaveText('content');

    // ── và một CHƯƠNG mở ra đọc được ──────────────────────────────────────
    // Mốc: từ đây trở đi, KHÔNG một request nào tới `/courses/…` của origin này
    // được phép. (Đối chứng ở đầu bài cố ý gọi đúng địa chỉ ấy một lần, nên phép
    // quét phải bắt đầu SAU nó.)
    const mark = s.requests.length;
    await libRow.getByRole('link', { name: EN_CONTENT_TITLE }).click();
    await s.page.waitForURL((url) => url.pathname === `/c/${EN_CONTENT_ID}`);
    const chapterLink = s.page
      .getByRole('navigation', { name: EN_CONTENT_TITLE })
      .locator(`[data-ch="${EN_FIRST_CHAPTER_ID}"]`);
    await expect(chapterLink).toBeVisible();
    await chapterLink.click();
    await s.page.waitForURL((url) => url.pathname === `/c/${EN_CONTENT_ID}/${EN_FIRST_CHAPTER_ID}`);

    // "Đọc được" nghĩa là CHỮ CỦA CHƯƠNG có mặt, không phải khung trang có mặt:
    // `#content` tồn tại kể cả trên một trang trắng.
    const body = s.page.locator('#content');
    await expect(body.getByRole('heading', { name: 'Vì sao chạy thử không kết luận được' })).toBeVisible();
    const words = await body.innerText();
    expect(words.length, `chương mở ra nhưng gần như rỗng (${words.length} ký tự)`).toBeGreaterThan(500);

    // Và chương ấy đến từ GÓI ĐÃ KÉO, không từ một `/courses/…` nào của origin
    // này — nếu có, đối chứng đầu bài đã không thể đỏ.
    expect(
      s.requests.slice(mark).filter((u) => u.startsWith(`${WEB_ORIGIN}/courses/${EN_CONTENT_ID}/`)),
      'trang đọc đi lấy chương từ origin của chính ứng dụng, không từ gói đã kéo',
    ).toEqual([]);
  } finally {
    await s.context.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// KỊCH BẢN 3 — ĐỔI NGÔN NGỮ GIAO DIỆN, VÀ LỰA CHỌN SỐNG SÓT QUA RELOAD
// ═══════════════════════════════════════════════════════════════════════════

test('đổi ngôn ngữ: chữ đổi ngay, và lựa chọn sống sót qua reload lẫn tab mới', async ({
  browser,
}) => {
  const s = await signedIn(browser);
  try {
    await openCatalogByClicking(s.page);

    // ĐỐI CHỨNG: bắt đầu bằng tiếng Việt. Không có chốt này, một bản dựng luôn
    // luôn tiếng Anh cũng đạt mọi chốt phía dưới.
    await expect(s.page.getByRole('heading', { name: VI.catalogTitle })).toBeVisible();
    expect(await s.page.evaluate(() => document.documentElement.lang)).toBe('vi');

    await s.page.getByLabel(VI.langSwitcher).selectOption('en');

    // Chữ đổi NGAY, không đợi tải lại.
    await expect(s.page.getByRole('heading', { name: EN.catalogTitle })).toBeVisible();
    await expect(s.page.getByRole('heading', { name: VI.catalogTitle })).toHaveCount(0);

    // Không phải chỉ tiêu đề, và không phải chỉ chữ NHÌN THẤY ĐƯỢC: tên trợ
    // năng của danh sách cũng phải đổi. Chốt này bắt được đúng lớp bỏ sót mà
    // Task 5 §6 liệt kê — `aria-label`/`title`/`placeholder` là những chỗ một
    // vòng bóc chuỗi hay quên vì mắt không thấy chúng.
    await expect(s.page.getByRole('list', { name: EN.catalogListAria })).toBeVisible();
    await expect(s.page.getByRole('list', { name: VI.catalogListAria })).toHaveCount(0);

    // Một HÀNG cũng phải đổi — chốt hẹp hơn thì một cài đặt dịch đúng một chuỗi
    // cũng xanh. Định vị theo `li.lib-item`, không theo tên trợ năng của danh
    // sách: cái tên ấy vừa là thứ đang được kiểm ở ngay trên.
    const interactiveRow = s.page.locator('li.lib-item', { hasText: VI_INTERACTIVE_TITLE });
    await expect(interactiveRow.locator('.lib-tier')).toHaveText(EN.tierInteractive);

    // ĐỐI CHỨNG NGƯỢC: nhãn của DỮ LIỆU không được dịch theo. Nhan đề course và
    // nhãn ngôn ngữ đến từ manifest — `registry/types.ts` ghi *"Nothing
    // translates on it"* — nên một cài đặt dịch nhầm cả dữ liệu phải đỏ ở đây.
    await expect(interactiveRow.locator('.lib-item-title')).toHaveText(VI_INTERACTIVE_TITLE);
    expect(
      (await interactiveRow.locator('.lib-meta-part').first().innerText()).trim(),
    ).toBe('vi');
    // Thuộc tính mà trình đọc màn hình đọc — để nó nói "vi" trong khi trang là
    // tiếng Anh là một lỗi trợ năng thật.
    expect(await s.page.evaluate(() => document.documentElement.lang)).toBe('en');

    // ── sống sót qua RELOAD ───────────────────────────────────────────────
    await s.page.reload();
    await expect(s.page.getByRole('heading', { name: EN.catalogTitle })).toBeVisible();
    expect(await s.page.evaluate(() => document.documentElement.lang)).toBe('en');

    // ── và qua một TAB MỚI của cùng thiết bị ──────────────────────────────
    // Reload một mình không phân biệt được "ghi vào localStorage" với "một biến
    // toàn cục sống sót vì trang không thật sự tải lại"; một tab mới thì có.
    const second = await s.context.newPage();
    await second.goto(`${WEB_ORIGIN}/catalog`);
    await expect(second.getByRole('heading', { name: EN.catalogTitle })).toBeVisible();
    await second.close();

    // ── và đổi ngược lại được ─────────────────────────────────────────────
    // Bằng nhãn TIẾNG ANH: nhãn của chính bộ chọn cũng đã dịch. Đây là một
    // phép đo, không phải một chi tiết kỹ thuật — bộ chọn còn nhãn tiếng Việt
    // sau khi đổi sang tiếng Anh nghĩa là một điều khiển đã mắc kẹt ở nửa
    // đường, và bài này bắt được.
    await expect(s.page.getByLabel(VI.langSwitcher)).toHaveCount(0);
    await s.page.getByLabel(EN.langSwitcher).selectOption('vi');
    await expect(s.page.getByRole('heading', { name: VI.catalogTitle })).toBeVisible();
    await s.page.reload();
    await expect(s.page.getByRole('heading', { name: VI.catalogTitle })).toBeVisible();
  } finally {
    await s.context.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// KỊCH BẢN 4 — `index.json` TRẢ HTML: THÔNG BÁO CỦA CATALOG, KHÔNG TRẮNG TRANG
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hồi quy có thật (`815a472`): một chuỗi HTML được trao dưới danh nghĩa `T`,
 * `.map` trên nó làm unmount cả cây React, và `document.body.innerHTML` còn lại
 * đúng `<div id="root"></div>`. Registry là **nguồn dữ liệu bên thứ ba**, tức
 * đúng lớp rủi ro ấy nhưng ngoài tầm kiểm soát của ta.
 *
 * Ba chốt, và chốt thứ ba là chốt dễ quên nhất: thông báo phải là câu CỦA
 * CATALOG, không phải câu chung của `<ErrorBoundary>`. Một màn hình chỉ vẽ ra
 * *"Màn hình này gặp lỗi"* thì "không trắng trang" đã đạt mà người đọc vẫn
 * không biết cái gì hỏng, ai hỏng, và phải làm gì.
 */
test('index.json trả HTML: catalog nói câu CỦA NÓ, không trắng trang, không phải câu của ErrorBoundary', async ({
  browser,
}) => {
  const s = await signedIn(browser);
  registryMode = 'html';
  try {
    await openCatalogByClicking(s.page);

    // 1. Câu ĐÍCH DANH của catalog cho đúng lớp lỗi này.
    await expect(s.page.getByRole('alert')).toContainText(VI.notJsonFragment);

    // 2. KHÔNG phải câu chung của ErrorBoundary.
    await expect(s.page.getByText(VI.boundaryTitle)).toHaveCount(0);

    // 3. KHÔNG trắng trang — và đo đúng thứ `815a472` để lại, không chỉ
    //    "body có chữ": khung ứng dụng còn đứng, và màn hình catalog vẫn tự
    //    xưng tên nó.
    await expect(s.page.getByRole('heading', { name: VI.catalogTitle })).toBeVisible();
    await expectRightApp(s.page);
    const rootHtml = await s.page.evaluate(() => document.getElementById('root')?.innerHTML ?? '');
    expect(rootHtml.length, 'cây React đã unmount — đây đúng là trang trắng của 815a472').toBeGreaterThan(200);

    // 4. Và không có hàng nào được vẽ từ dữ liệu không đọc được.
    await expect(catalogList(s.page)).toHaveCount(0);
  } finally {
    registryMode = 'ok';
    await s.context.close();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// KỊCH BẢN 5 — MÓN NỢ CỦA TASK 5 §9.1: `?lang=` LÀM KHUNG KHO KHOÁ NẠP LẠI
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Task 5 chấp nhận rằng đổi ngôn ngữ làm `<iframe>` kho khoá nạp lại — tức xoá
 * ô nhập key đang gõ dở — dựa trên một lập luận về BỐ CỤC:
 *
 *   > bộ chọn ngôn ngữ nằm trên thanh công cụ, còn khung kho khoá khi mở ra là
 *   > một lớp phủ che kín trang bên dưới, nên người dùng không với tới bộ chọn
 *   > trong lúc đang gõ key.
 *
 * Và báo cáo ấy nói thẳng: ***"lập luận ấy đúng bằng đúng cái CSS đang đúng"***,
 * và **không cổng nào của họ hỏi được câu ấy** — `VaultFrame.test.tsx` khẳng
 * định `?lang=` đi theo lựa chọn, nhưng nó không biết gì về việc bộ chọn có bấm
 * tới được hay không. Họ ghi nó là món nợ của Task 7. Đây là chỗ trả.
 *
 * Hai bài, vì có HAI đường tới một `<select>` và lập luận trên chỉ nói về một:
 *
 *   5a — CON TRỎ. Đo bằng `elementFromPoint` tại tâm bộ chọn, hai chiều: lớp
 *        phủ phải chặn khi khung mở, và KHÔNG chặn khi khung đóng. Không có
 *        chiều thứ hai, một trang hỏng tới mức không vẽ bộ chọn cũng "đạt".
 *   5b — BÀN PHÍM. Một `<select>` bị lớp phủ che vẫn nằm trong thứ tự Tab.
 */

async function openVaultOverlay(page: Page) {
  await page.goto(`${WEB_ORIGIN}/settings`);
  await expectRightApp(page);
  const ui = page.frameLocator('[data-testid="vault-frame"]');
  await expect(ui.locator('h2')).toHaveText(VI.vaultHeading);
  // Lớp phủ thật sự đang mở, không chỉ khung đã nạp.
  await expect(page.locator('.vault-overlay')).toHaveCount(1);
  return ui;
}

/** Phần tử thật sự nhận được một cú bấm tại tâm bộ chọn ngôn ngữ. */
async function whatIsOnTopOfLangSelect(page: Page): Promise<{
  found: boolean;
  isTheSelect: boolean;
  topDescription: string;
}> {
  return page.evaluate(() => {
    const sel = document.getElementById('lang-select');
    if (!sel) return { found: false, isTheSelect: false, topDescription: 'không có #lang-select' };
    const r = sel.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const cls = top instanceof HTMLElement ? top.className : '';
    return {
      found: true,
      isTheSelect: top === sel,
      topDescription: `${top?.tagName ?? 'null'}${top?.id ? `#${top.id}` : ''}${cls ? `.${String(cls)}` : ''}`,
    };
  });
}

test('kho khoá đang mở: lớp phủ CHẶN con trỏ tới bộ chọn ngôn ngữ — và không chặn khi đã đóng', async ({
  browser,
}) => {
  const s = await signedIn(browser);
  try {
    // ── ĐỐI CHỨNG trước: ở một trang thường, bộ chọn bấm tới được ─────────
    await s.page.goto(`${WEB_ORIGIN}/library`);
    await expectRightApp(s.page);
    const open = await whatIsOnTopOfLangSelect(s.page);
    expect(open.found, 'không tìm thấy #lang-select — mọi chốt dưới đây rỗng').toBe(true);
    expect(
      open.isTheSelect,
      `khi KHÔNG có lớp phủ, tâm bộ chọn ngôn ngữ lại là ${open.topDescription} — ` +
        'đối chứng hỏng, nên chốt "bị chặn" bên dưới không nói lên điều gì',
    ).toBe(true);

    // ── và khi khung kho khoá mở, nó bị lớp phủ chặn ──────────────────────
    const ui = await openVaultOverlay(s.page);
    await ui.locator('[data-role="secret"]').fill(HALF_TYPED_KEY);

    const covered = await whatIsOnTopOfLangSelect(s.page);
    expect(covered.found).toBe(true);
    expect(
      covered.isTheSelect,
      'lớp phủ kho khoá KHÔNG còn che bộ chọn ngôn ngữ. Lập luận mà Task 5 §9.1 ' +
        'dùng để chấp nhận việc `?lang=` nạp lại khung ("người dùng không với tới ' +
        'bộ chọn trong lúc đang gõ key") vừa hết đúng — xem bài 5b ngay dưới để ' +
        'biết cái giá.',
    ).toBe(false);
  } finally {
    await s.context.close();
  }
});

/**
 * Đường BÀN PHÍM, và cái giá của nó.
 *
 * Một `<select>` bị lớp phủ che vẫn ở trong thứ tự Tab: `z-index` quyết định
 * chuyện vẽ và chuyện bấm, không quyết định chuyện tiêu điểm. Bài này đi đúng
 * đường một người dùng bàn phím đi — Tab ra khỏi ô key — rồi hỏi câu mà Task 5
 * để ngỏ: **key đang gõ dở có còn không.**
 *
 * Không `test.fail()`, không `test.skip()`: nếu ô key bị xoá thì cổng này ĐỎ,
 * và đỏ là thứ người ta đọc.
 */
test('gõ dở một key rồi đổi ngôn ngữ bằng bàn phím: key đang gõ dở phải còn', async ({
  browser,
}) => {
  const s = await signedIn(browser);
  try {
    const ui = await openVaultOverlay(s.page);
    const secret = ui.locator('[data-role="secret"]');
    await secret.fill(HALF_TYPED_KEY);
    await expect(secret, 'chưa gõ được gì vào ô key — mọi chốt dưới đây rỗng').toHaveValue(HALF_TYPED_KEY);

    // Tiêu điểm đang ở TRONG khung, đúng chỗ người dùng đang gõ.
    await secret.focus();

    // Tab ra: ghi lại đường đi để một lần đỏ nói được nó đỏ ở đâu.
    const trail: string[] = [];
    let reachedSwitcher = false;
    for (let i = 0; i < 24 && !reachedSwitcher; i++) {
      await s.page.keyboard.press('Tab');
      const where = await s.page.evaluate(() => {
        const a = document.activeElement;
        if (!a) return 'null';
        const id = a.id ? `#${a.id}` : '';
        const testid = a instanceof HTMLElement ? (a.dataset.testid ?? '') : '';
        return `${a.tagName}${id}${testid ? `[${testid}]` : ''}`;
      });
      trail.push(where);
      reachedSwitcher = where.startsWith('SELECT#lang-select');
    }

    // In ra luôn, không chỉ khi đỏ: đường đi của tiêu điểm LÀ phép đo mà Task 5
    // §9.1 thiếu, và nó đáng đọc kể cả trong một lần chạy xanh.
    console.log(`[s3] Tab từ ô key: ${trail.join(' → ')}`);

    expect(
      reachedSwitcher,
      `Tab từ ô key không ra tới bộ chọn ngôn ngữ trong 24 lần. Đường đi: ${trail.join(' → ')}. ` +
        'Nếu đây là hành vi ĐÚNG (lớp phủ giam tiêu điểm), hãy đảo chốt này và ghi lý do — ' +
        'nhưng đừng để nó im lặng.',
    ).toBe(true);

    // Đổi ngôn ngữ đúng cách một người dùng bàn phím đổi nó.
    await s.page.getByLabel(VI.langSwitcher).selectOption('en');

    // Ngôn ngữ ĐÃ đổi thật — không có chốt này, một `selectOption` không ăn
    // thua sẽ làm chốt bên dưới xanh mà chẳng chứng minh gì.
    expect(await s.page.evaluate(() => document.documentElement.lang)).toBe('en');

    // …và ô key đang gõ dở phải còn nguyên.
    await expect(
      ui.locator('[data-role="secret"]'),
      'Đổi ngôn ngữ trong lúc đang gõ key XOÁ SẠCH ô nhập: `?lang=` đổi `src` của ' +
        '<iframe>, trình duyệt nạp lại tài liệu ở origin kho khoá, và người dùng mất ' +
        'thứ họ đang gõ. Đây đúng là cái giá mà Task 5 §9.1 chấp nhận dựa trên lập luận ' +
        '"không ai với tới được bộ chọn" — lập luận ấy nói về CON TRỎ (bài 5a xác nhận ' +
        'nó đúng) và không nói gì về BÀN PHÍM.',
    ).toHaveValue(HALF_TYPED_KEY);
  } finally {
    await s.context.close();
  }
});

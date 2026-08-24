import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { zipSync } from 'fflate';
import {
  PASSWORD,
  REAL_COURSE_ID,
  REPO_ROOT,
  freshEmail,
  isBenignAuthCheck401,
  openNotesTab,
  realCoursePackageZip,
  registerNewUser,
  selectParagraphByDrag,
} from './helpers';

/**
 * Cổng nghiệm thu đầu-cuối của **hệ thống con 1**, ba kịch bản còn lại.
 *
 * Kịch bản 1 — "nhập gói thật rồi đọc được, mô phỏng chạy từ chính gói" — nằm
 * ở `import.spec.ts` và **không lặp lại ở đây**. Tệp này giữ ba kịch bản mà
 * không tệp nào khác trong repo hỏi được:
 *
 *  - **§2 Từ chối gói xấu.** Gói hạng `content` mang `<script>` phải bị từ
 *    chối, thông báo phải **nêu đích danh tệp**, và **thư viện không được
 *    đổi**. Vế thứ ba là vế hay bị bỏ quên: nhập hỏng mà thư viện bẩn lên thì
 *    tệ hơn nhập hỏng.
 *  - **§3 Riêng tư là riêng tư.** Tầng Go đã có bốn test cho việc này
 *    (`TestOwnerCannotReadAnotherOwnersPackage`, `TestListReturnsOnlyMyCourses`,
 *    `TestPostIgnoresClientSuppliedOwnerID`, `TestNoRouteReadsOwnerFromTheRequest`).
 *    Giá trị của §3 là chốt ở **tầng cao nhất, qua HTTP thật, với hai tài khoản
 *    thật đăng ký qua chính màn hình đăng ký** — nơi mà một lỗi cấu hình
 *    middleware (route mắc nhầm chỗ, CORS mở quá tay, cookie sai origin) vẫn
 *    lọt qua mọi test đơn vị bên dưới.
 *  - **§4 Cập nhật có báo cáo thiệt hại.** Xem khối chú thích ngay trên §4:
 *    đây là kịch bản mà cả tệp này sinh ra để phục vụ.
 *
 * ## Ngữ liệu: `bat-bien-vong-lap`, không phải giáo trình riêng tư
 *
 * Cả ba kịch bản chạy trên gói mẫu **công khai** `fixtures/courses/bat-bien-vong-lap/`
 * — 3 chương, hạng `content`, 21 KB zip. `fixtures/README.md` đã chỉ định đúng
 * vai đó cho nó, kèm cách dựng hai biến thể mà tệp này cần:
 *
 *  - **gói xấu (§2)** dựng vòng qua `tuhoc pack` — CLI **từ chối** một gói
 *    `content` có `<script>`, và đó chính là điểm của nó, nên gói xấu phải
 *    được đóng bằng `zipSync` trực tiếp;
 *  - **bản v1.1 (§4)** dựng bằng phép sửa chuỗi trên chính nội dung đã được
 *    người đọc bôi chọn (xem `buildV11`).
 *
 * Cả hai **dựng trong lúc chạy test, không commit**. Không phải để tiết kiệm
 * chỗ: thứ đang được kiểm là **phản ứng của hệ thống trước một gói có tính
 * chất X**, và một tệp `.zip` nằm trong repo là một khẳng định về tính chất X
 * mà không cổng nào kiểm lại. Dựng tại chỗ thì tính chất ấy có một dòng mã
 * viết ra nó.
 *
 * Hệ quả quan trọng: **không kịch bản nào ở đây cần giáo trình riêng tư**, nên
 * một bản clone mới chạy được toàn bộ tệp này.
 *
 * ## Ba cổng mù trước của dự án, và cổng này mù ở đâu
 *
 * (1) cổng e2e của P1 mù với thay đổi Go vì ảnh Docker được tái dùng; (2)
 * `tsc --noEmit` xanh với lỗi kiểu hiển nhiên vì `"files": []`; (3) `rtk` bọc
 * `make test-e2e` và trả mã thoát của chính nó; (4) ruling S1-F29 — 775 dòng
 * tính năng không tệp sản phẩm nào import, bốn cổng vẫn xanh. Đặc điểm chung:
 * **cổng đo thứ nó với tới được, và im lặng đúng chỗ nó không với tới.**
 *
 * Chỗ tệp này **không** với tới, ghi ra để người sau khỏi tin nhầm:
 *
 *  - **`apps/web/e2e/**` không được `tsc` kiểm** (nợ trong `docs/carried-forward.md`).
 *    Một lỗi kiểu trong chính tệp này không cổng nào bắt; nó chỉ lộ ra khi
 *    Playwright chạy tới đúng dòng đó.
 *  - **Không có cửa giao diện nào để đẩy một gói LÊN máy chủ.** §3 và §4 đều
 *    cần máy chủ đang giữ một gói, và `POST /courses` (Task 6) chưa có màn
 *    hình nào gọi tới. Hai kịch bản đó gọi thẳng `fetch` **từ trong trang**
 *    (cookie thật, origin thật, CORS thật) — xem `uploadPackageToServer`. Đây
 *    là **dựng bối cảnh**, không phải đi vòng qua giao diện đang được kiểm:
 *    thứ đang được kiểm ở §4 là *hộp thoại cập nhật*, và mọi cú bấm của nó
 *    đều là bấm thật. Nhưng nó cũng có nghĩa là: **nếu một ngày có màn hình
 *    tải gói lên, màn hình đó vẫn không được cổng nào kiểm.**
 *  - §2 đo "thư viện không đổi" bằng **văn bản của danh sách thư viện**, tức
 *    thứ người đọc nhìn thấy. Một phép ghi vào `db.packages` mà thư viện
 *    không hiển thị (một hàng của một course id đã có, cùng phiên bản) sẽ
 *    **lọt** — xem chú thích tại chỗ, ở đó mã chọn id khác đi chính vì lý do
 *    này.
 */

/* ====================================================================== *
 * Ngữ liệu và cách dựng hai biến thể của nó
 * ====================================================================== */

const COURSE_ID = 'bat-bien-vong-lap';
const COURSE_TITLE = 'Bất biến vòng lặp';
/** Chương 1.1 — chương duy nhất §4 ghi chú lên, và là chương §4 viết lại. */
const CHAPTER_ID = 'c1';
const CHAPTER_FILE = `chapters/${CHAPTER_ID}.html`;
/** `manifest.json` của gói mẫu; `packages/course-format` gọi nó là MANIFEST_PATH. */
const MANIFEST_FILE = 'manifest.json';

const FIXTURE_DIR = resolve(REPO_ROOT, 'fixtures', 'courses', COURSE_ID);

/**
 * Nơi API thật đang lắng nghe — cùng phép suy ra mà `playwright.config.ts`
 * dùng, vì `scripts/test-e2e.sh` xuất đúng hai biến này ra môi trường trước
 * khi gọi Playwright. Hai chỗ tính khác nhau thì một trong hai sẽ nói chuyện
 * với một máy chủ không có ai ở nhà, và im lặng.
 */
const API_URL = process.env.VITE_API_URL ?? `http://localhost:${process.env.TUHOC_E2E_API_PORT ?? 8089}`;

const decodeUtf8 = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes);
const encodeUtf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * Đọc gói nguồn từ đĩa thành `đường dẫn trong gói → bytes`.
 *
 * Đọc **thư mục**, không đọc `.zip` đã commit, vì cả ba kịch bản đều cần sửa
 * nội dung trước khi đóng lại; và đọc **đệ quy theo thư mục thật** thay vì
 * liệt kê tên tệp, để một chương mới thêm vào gói mẫu không âm thầm bị bỏ ra
 * ngoài mọi biến thể mà tệp này dựng.
 */
function readPackageDir(dir: string): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const walk = (abs: string, rel: string): void => {
    const entries = readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const childAbs = join(abs, entry.name);
      const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile()) out.set(childRel, new Uint8Array(readFileSync(childAbs)));
    }
  };
  walk(dir, '');
  expect(
    out.has(MANIFEST_FILE),
    `không đọc được gói mẫu ở ${dir} — cổng nghiệm thu này chạy trên gói CÔNG KHAI trong repo (fixtures/README.md), không trên một gói dựng bằng tay`,
  ).toBe(true);
  return out;
}

/**
 * Đóng `files` thành `.zip`, cùng hình dạng `packZip` của
 * `packages/course-format` ghi ra: tên sắp xếp, `level: 9`.
 *
 * Không import `packZip` thật, và đó là một sự đánh đổi có ý thức chứ không
 * phải sự lười: `@tuhoc/course-format` tới `apps/web` bằng **alias** khai
 * trong `tsconfig.app.json` + `vite.config.ts`, mà `apps/web/tsconfig.json`
 * lại là tệp `"files": []` (đúng cái tệp đã tạo ra cổng mù thứ hai của dự
 * án), nên Playwright không có đường phân giải alias đó; và
 * `packages/course-format` không có `node_modules` trên máy chạy e2e —
 * `scripts/test-e2e.sh` chỉ `bun install` trong `apps/web`. `fflate` thì là
 * phụ thuộc khai báo của `apps/web`, tức phân giải được từ đúng thư mục này.
 * Cái giá: nếu `packZip` đổi cách đóng gói, tệp này không biết. Cái được: gói
 * mà §2/§4 thả vào màn hình import là **một zip bình thường**, đúng như một
 * zip do người lạ gửi tới — mà đó lại là thứ đường import phải chịu được.
 */
function packToZip(files: ReadonlyMap<string, Uint8Array>): Buffer {
  const zippable: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  for (const name of [...files.keys()].sort()) zippable[name] = files.get(name) as Uint8Array;
  return Buffer.from(zipSync(zippable, { level: 9 }));
}

/**
 * Thay **đúng một** lần xuất hiện của `from` bằng `to` trong một tệp của gói.
 *
 * "Đúng một" được khẳng định, không được giả định. Đây là chỗ một cổng như
 * thế này chết lặng: nếu `from` không khớp chỗ nào thì bản "v1.1" giống hệt
 * v1.0, hộp thoại báo `6/6 giữ đúng chỗ`, và cả kịch bản 4 trở thành một bài
 * kiểm tra rằng không có gì xảy ra. Nếu nó khớp hai chỗ thì phép sửa rơi vào
 * một đoạn văn không ai ghi chú. Cả hai đều là cổng xanh vô nghĩa.
 */
function replaceOnce(files: Map<string, Uint8Array>, name: string, from: string, to: string): void {
  const before = files.get(name);
  expect(before, `gói mẫu không có tệp ${name}`).toBeDefined();
  const text = decodeUtf8(before as Uint8Array);
  const hits = text.split(from).length - 1;
  expect(
    hits,
    `phép sửa "${from.slice(0, 48)}…" trong ${name} khớp ${hits} chỗ, phải đúng 1 — 0 nghĩa là biến thể này giống hệt bản gốc và kịch bản đang đo một cái không tồn tại`,
  ).toBe(1);
  files.set(name, encodeUtf8(text.replace(from, to)));
}

/**
 * Đẩy một gói lên thư viện máy chủ của người đang đăng nhập ở `page`.
 *
 * **Bằng `fetch` từ trong trang, không bằng `page.request`.** Hai thứ này
 * khác nhau ở đúng chỗ đáng giá: `page.request` là một client HTTP của
 * Playwright dùng chung lọ cookie, còn `fetch` trong trang đi qua **cookie
 * của trình duyệt, origin thật của ứng dụng, và CORS thật** — tức đúng con
 * đường mà `POST /sync` của ứng dụng đi hằng ngày, và đúng chỗ ruling S1-F25
 * ghi rằng một cấu hình sai sẽ trông y hệt "mạng yếu". Một `CORS_ORIGIN` đặt
 * sai làm lệnh này hỏng ở đây, chứ không âm thầm thành công.
 *
 * `POST /courses` (Task 6) chưa có màn hình nào gọi tới — xem đầu tệp về chỗ
 * cổng này mù. Đây là bối cảnh ("tác giả đã phát hành bản này"), không phải
 * đường tắt đi vòng qua giao diện đang được kiểm.
 */
async function uploadPackageToServer(page: Page, zip: Buffer): Promise<{ status: number; body: string }> {
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
    { apiUrl: API_URL, base64: zip.toString('base64') },
  );
}

/** `GET /courses` đúng như ứng dụng gọi nó: từ trong trang, với cookie phiên của trang. */
async function readServerLibrary(page: Page): Promise<{ status: number; ids: string[] }> {
  return page.evaluate(async ({ apiUrl }: { apiUrl: string }) => {
    const res = await fetch(`${apiUrl}/courses`, { credentials: 'include' });
    const body: unknown = await res.json();
    const ids = Array.isArray(body) ? body.map((row: { id?: unknown }) => String(row.id)) : [];
    return { status: res.status, ids };
  }, { apiUrl: API_URL });
}

/* ====================================================================== *
 * §2 — gói xấu bị từ chối, và thư viện không đổi
 * ====================================================================== */

/**
 * `<script>` được nhét vào **chương 2**, không phải chương 1, và tên tệp đó
 * là thứ được khẳng định phải xuất hiện trên màn hình. Một thông báo nói
 * "gói của bạn có mã chạy được" mà không nói ở đâu thì với một gói 3 chương
 * đã là khó chịu; với gói 46 tệp của một giáo trình thật thì nó vô dụng.
 */
const BAD_CHAPTER_FILE = 'chapters/c2.html';
const BAD_SCRIPT = '<script>alert(1)</script>';

/**
 * Gói xấu mang **id khác** gói tốt, và điều đó là một quyết định chứ không
 * phải tiện tay.
 *
 * "Thư viện không đổi" ở đây được đo bằng văn bản danh sách thư viện — thứ
 * người đọc thật sự nhìn. Nếu gói xấu mang cùng `id` và cùng `version` với
 * gói tốt, thì một phép ghi lọt qua sẽ **đè lên đúng hàng đó** và danh sách
 * trông y hệt: cổng xanh, thư viện bẩn. Đổi id làm cho một phép ghi lọt qua
 * trở thành **một hàng mới nhìn thấy được**. Nói thẳng cái giá: dạng "đè lên
 * chính gói đang có" vẫn nằm ngoài tầm với của cổng này.
 */
const BAD_COURSE_ID = 'bat-bien-vong-lap-xau';
const BAD_COURSE_TITLE = 'Bất biến vòng lặp (bản dựng hỏng)';

function buildBadPackage(): Buffer {
  const files = readPackageDir(FIXTURE_DIR);
  replaceOnce(files, MANIFEST_FILE, `"id": "${COURSE_ID}"`, `"id": "${BAD_COURSE_ID}"`);
  replaceOnce(files, MANIFEST_FILE, `"title": "${COURSE_TITLE}"`, `"title": "${BAD_COURSE_TITLE}"`);
  // Ngay sau `<h1 …>` đầu chương: một chỗ hợp lệ về cú pháp, để thứ bị từ
  // chối là NỘI DUNG gói chứ không phải một tệp HTML hỏng.
  const chapter = decodeUtf8(files.get(BAD_CHAPTER_FILE) as Uint8Array);
  const at = chapter.indexOf('</h1>');
  expect(at, `${BAD_CHAPTER_FILE} không có </h1> để chèn <script> vào sau`).toBeGreaterThan(0);
  files.set(
    BAD_CHAPTER_FILE,
    encodeUtf8(`${chapter.slice(0, at + '</h1>'.length)}\n${BAD_SCRIPT}\n${chapter.slice(at + '</h1>'.length)}`),
  );
  return packToZip(files);
}

test.describe('§2 — gói xấu bị từ chối, nêu đích danh tệp, và thư viện không đổi', () => {
  test('gói hạng content mang <script> bị chặn ở màn hình Import, và thư viện giữ nguyên từng chữ', async ({ page }) => {
    // Hai lần import (mỗi lần: đọc zip, giải nén, tokenize từng byte, ghi
    // IndexedDB) cộng hai lần dựng zip trong tiến trình test. Rộng rãi có chủ
    // ý — 90s mặc định của config là ngân sách của p1.spec.ts.
    test.setTimeout(180_000);

    const noise: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      if (isBenignAuthCheck401(msg)) return;
      noise.push(msg.text());
    });
    page.on('pageerror', (err) => noise.push(`pageerror: ${err.message}`));

    const goodZip = packToZip(readPackageDir(FIXTURE_DIR));
    const badZip = buildBadPackage();

    await page.goto('/login');
    await registerNewUser(page, freshEmail(), PASSWORD);

    // ---- 1. một gói TỐT vào trước, để "không đổi" có cái để không đổi ----
    // Thư viện rỗng thì "thư viện không đổi" là một khẳng định rỗng: nó đúng
    // kể cả khi phép ghi của gói xấu bị chặn vì một lý do hoàn toàn khác.
    await page.goto('/import');
    await expect(page.getByRole('heading', { name: 'Nhập khóa học' })).toBeVisible();
    await page.locator('.import-file input[type="file"]').setInputFiles({
      name: `${COURSE_ID}.zip`,
      mimeType: 'application/zip',
      buffer: goodZip,
    });
    await expect(page.locator('.import-ok'), 'gói mẫu HỢP LỆ không nhập được — kịch bản này chưa bắt đầu').toBeVisible({
      timeout: 60_000,
    });

    await page.goto('/library');
    const list = page.getByRole('list', { name: 'Khóa học của bạn' });
    await expect(list.locator('li')).toHaveCount(1);
    const libraryBefore = (await list.innerText()).trim();
    expect(libraryBefore).toContain(COURSE_TITLE);

    // ---- 2. gói xấu: bị từ chối, và nói ra TỆP NÀO ------------------------
    await page.goto('/import');
    await page.locator('.import-file input[type="file"]').setInputFiles({
      name: `${BAD_COURSE_ID}.zip`,
      mimeType: 'application/zip',
      buffer: badZip,
    });

    const findings = page.locator('.import-findings');
    await expect(
      findings,
      'gói hạng "content" mang <script> đã được NHẬN — §1.2 nói hạng content nghĩa là không có mã chạy được',
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.import-ok'), 'màn hình vừa từ chối gói vừa báo đã nhập xong').toHaveCount(0);

    // Đích danh tệp. Khẳng định trên MỘT mục của danh sách, không trên cả
    // khối: "cả khối có chứa chuỗi đó" cũng đúng khi tên tệp nằm ở một mục
    // nói về chuyện khác.
    await expect(
      findings.locator('li').filter({ hasText: BAD_CHAPTER_FILE }),
      `thông báo từ chối không nêu tên tệp ${BAD_CHAPTER_FILE} — với một gói nhiều chương, "gói của bạn có mã chạy được" là thứ không sửa được`,
    ).toHaveCount(1);
    await expect(findings.locator('li').filter({ hasText: BAD_CHAPTER_FILE })).toContainText('<script>');

    // ---- 3. thư viện KHÔNG đổi -------------------------------------------
    // Vế người dùng thật quan tâm: một lần nhập hỏng mà để lại rác thì tệ
    // hơn một lần nhập hỏng.
    await page.goto('/library');
    await expect(list.locator('li'), 'gói bị từ chối vẫn kịp để lại một hàng trong thư viện').toHaveCount(1);
    await expect(
      page.getByRole('list', { name: 'Khóa học của bạn' }).locator('li').filter({ hasText: BAD_COURSE_TITLE }),
      'gói bị từ chối đã được ghi vào máy — findings hiện ra chỉ là phần trang trí',
    ).toHaveCount(0);
    expect(
      (await list.innerText()).trim(),
      'thư viện đổi sau một lần nhập bị từ chối (so sánh từng chữ trước/sau)',
    ).toBe(libraryBefore);

    expect(noise, `console/page errors: ${noise.join(' | ')}`).toEqual([]);
  });
});

/* ====================================================================== *
 * §3 — riêng tư là riêng tư
 * ====================================================================== */

test.describe('§3 — riêng tư là riêng tư', () => {
  test('course của tài khoản A không xuất hiện trong GET /courses của tài khoản B', async ({ browser }) => {
    test.setTimeout(180_000);

    const noise: string[] = [];
    const watch = (page: Page, who: string): void => {
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        if (isBenignAuthCheck401(msg)) return;
        noise.push(`[${who}] ${msg.text()}`);
      });
      page.on('pageerror', (err) => noise.push(`[${who}] pageerror: ${err.message}`));
    };

    const zip = packToZip(readPackageDir(FIXTURE_DIR));

    // ---- tài khoản A: đăng ký thật, nhập thật, phát hành lên thư viện ----
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    watch(pageA, 'A');
    await pageA.goto('/login');
    await registerNewUser(pageA, freshEmail(), PASSWORD);

    await pageA.goto('/import');
    await pageA.locator('.import-file input[type="file"]').setInputFiles({
      name: `${COURSE_ID}.zip`,
      mimeType: 'application/zip',
      buffer: zip,
    });
    await expect(pageA.locator('.import-ok')).toBeVisible({ timeout: 60_000 });

    const uploaded = await uploadPackageToServer(pageA, zip);
    expect(uploaded.status, `POST /courses của A trả ${uploaded.status}: ${uploaded.body}`).toBe(201);
    expect(uploaded.body).toContain(COURSE_ID);

    // Đối chứng dương. Không có nó, mọi khẳng định "B không thấy" bên dưới
    // cũng đúng khi phép tải lên im lặng thất bại — cổng xanh, chưa đo gì.
    const catalogA = await readServerLibrary(pageA);
    expect(catalogA.status).toBe(200);
    expect(catalogA.ids, 'A không thấy chính course của mình — đối chứng dương hỏng').toContain(COURSE_ID);

    await pageA.goto('/library');
    await expect(
      pageA.getByRole('list', { name: 'Khóa học của bạn' }).locator('li').filter({ hasText: COURSE_TITLE }),
    ).toHaveCount(1);

    // ---- tài khoản B: một tài khoản THẬT, đăng ký qua chính màn hình ----
    // Không phải một token nặn trong test, và không phải một tab thứ hai:
    // một BrowserContext riêng có lọ cookie riêng và phân vùng IndexedDB
    // riêng, nên "B không thấy" không thể là "B đọc bản lưu của A".
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    watch(pageB, 'B');
    await pageB.goto('/login');
    await registerNewUser(pageB, freshEmail(), PASSWORD);

    const catalogB = await readServerLibrary(pageB);
    expect(catalogB.status).toBe(200);
    expect(
      catalogB.ids,
      `GET /courses của B trả về course của A: ${catalogB.ids.join(', ')} — giáo trình riêng tư của một người đọc được cho người khác`,
    ).not.toContain(COURSE_ID);
    expect(catalogB.ids, 'thư viện máy chủ của một tài khoản vừa tạo phải rỗng').toEqual([]);

    await pageB.goto('/library');
    await expect(
      pageB.getByRole('heading', { name: 'Thư viện của bạn đang trống' }),
      'B vừa đăng ký mà thư viện không rỗng',
    ).toBeVisible();

    // Và tầng dưới danh sách: ngay cả khi biết đích danh id + phiên bản, B
    // vẫn không lấy được một byte nào của gói. `context.request` (không phải
    // `fetch` trong trang) vì đây là một 404 CÓ CHỦ Ý và Chromium ghi một
    // dòng `console.error` cho mọi phản hồi không-2xx — dùng nó ở đây sẽ bắt
    // bộ lọc tiếng ồn phải nới ra để tha một trạng thái, mà bộ lọc ấy hẹp
    // đúng như nó đang hẹp là có lý do (xem `isBenignAuthCheck401`).
    const assetB = await contextB.request.get(`${API_URL}/courses/${COURSE_ID}/@1.0.0/${MANIFEST_FILE}`);
    expect(
      assetB.status(),
      'B tải được manifest gói của A — chốt riêng tư thủng ở tầng tệp, dù danh sách có sạch',
    ).toBe(404);
    const assetA = await contextA.request.get(`${API_URL}/courses/${COURSE_ID}/@1.0.0/${MANIFEST_FILE}`);
    expect(assetA.status(), 'A không tải được gói của chính mình — đối chứng dương của phép kiểm 404 trên').toBe(200);

    expect(noise, `console/page errors: ${noise.join(' | ')}`).toEqual([]);

    await contextA.close();
    await contextB.close();
  });
});

/* ====================================================================== *
 * §4 — cập nhật có báo cáo thiệt hại
 * ====================================================================== */

/**
 * Sáu ghi chú, ba nhóm, và mỗi nhóm một con số khác nhau.
 *
 * 3 · 2 · 1 chứ không phải 2 · 2 · 2: nếu hai nhóm mang cùng một số thì một
 * lỗi hoán vị hai nhóm cho nhau (đếm `fuzzy` vào ô `orphaned` chẳng hạn) vẫn
 * cho ra đúng câu chữ trên màn hình. Ba số phân biệt làm câu tóm tắt
 * `3/6 ghi chú giữ đúng chỗ · 2 dịch nhẹ · 1 mất neo` thành một khẳng định
 * về **ba** đại lượng.
 *
 * Mỗi mục dưới đây là **40 ký tự đầu của một đoạn văn**, và ba tính chất của
 * chúng đo trên tệp `fixtures/courses/bat-bien-vong-lap/chapters/c1.html`,
 * không phỏng đoán:
 *
 *  1. **Nút văn bản đầu tiên của đoạn dài hơn 40 ký tự.** `selectParagraphByDrag`
 *     kéo qua nút văn bản ĐẦU TIÊN; một đoạn mở đầu bằng `<b>` hay `<code>`
 *     cho một nút 8 ký tự và cú kéo chọn được vài chữ vô nghĩa.
 *  2. **Không có `$…$` trong 40 ký tự đầu.** Công thức thu về một ký tự
 *     `'￼'` trong phép chiếu mà neo sống trong đó.
 *  3. **Không nằm trong `<details>` gập lại.** Ba khối bài tập cuối chương
 *     đều gập; `selectParagraphByDrag` từ chối chúng thẳng thừng.
 */
const NOTES = [
  { key: 'exact-1', startsWith: 'Hàm dưới đây trả về phần tử lớn nhất của', kind: 'exact' as const, note: 'ghi chú A' },
  { key: 'orphan-1', startsWith: 'Sinh ngẫu nhiên mười nghìn dãy số nguyên', kind: 'orphan' as const, note: 'ghi chú B — cái sẽ mất neo' },
  { key: 'fuzzy-1', startsWith: 'Bạn có thể phản đối: thêm số âm vào bộ s', kind: 'fuzzy' as const, note: 'ghi chú C', word: 'phản đối', into: 'phản bác' },
  { key: 'exact-2', startsWith: 'Vậy phải chứng minh trực tiếp. Nhưng nga', kind: 'exact' as const, note: 'ghi chú D' },
  { key: 'exact-3', startsWith: '"Đầu mỗi lần kiểm tra điều kiện" là một', kind: 'exact' as const, note: 'ghi chú E' },
  { key: 'fuzzy-2', startsWith: 'Chứng minh không thay thế kiểm thử, và c', kind: 'fuzzy' as const, note: 'ghi chú F', word: 'thay thế', into: 'thay cho' },
];

/** Câu thay chỗ đoạn văn của ghi chú `orphan-1` ở bản 1.1. */
const REWRITTEN = 'Toàn bộ câu mở đầu đoạn này đã được viết lại cho bản 1.1 và không giữ lại chữ nào của bản cũ';

/** Số ký tự cú kéo nhắm tới. 40, như `p2.spec.ts` — vừa đủ dài để tầng fuzzy nhận, vừa đủ ngắn để nằm trên một dòng ở khung 1440px. */
const DRAG_CHARS = 40;

/**
 * Dựng bản 1.1 từ **chính những chuỗi mà trình duyệt đã bôi chọn**.
 *
 * Đây là chỗ kịch bản này khác một bài kiểm tra "sửa vài câu rồi xem sao".
 * Neo của một ghi chú sống trong phép chiếu của chương *sau khi KaTeX chạy*,
 * và thứ duy nhất biết chắc người đọc đã chọn đúng những ký tự nào là
 * `getSelection()` của chính lượt chạy này. Sửa mù trên tệp nguồn thì một cú
 * kéo lệch một dòng biến "dịch nhẹ" thành "giữ nguyên", và cổng vẫn xanh với
 * một con số sai.
 *
 * Nên: mỗi phép sửa lấy chuỗi đã chọn làm mỏ neo, và `replaceOnce` bắt buộc
 * nó khớp đúng một chỗ.
 *
 *  - `fuzzy`: đổi một từ NẰM TRONG chuỗi đã chọn. Khoảng cách sửa 2–3, còn
 *    ngưỡng của tầng fuzzy là `max(2, ceil(0.2·|exact|))` = 8 với một trích
 *    dẫn 40 ký tự (`annotations/anchor.ts`), nên phép sửa nằm gọn bên trong
 *    — và văn cảnh 32 ký tự hai bên không đổi, nên `candidateStarts` vẫn tìm
 *    ra vị trí. Tầng exact thì hỏng, vì chuỗi trích dẫn không còn nguyên văn.
 *  - `orphan`: thay TRỌN chuỗi đã chọn bằng một câu không dính dáng gì. Văn
 *    cảnh vẫn chỉ đúng chỗ, nên tầng fuzzy vẫn được mời tới xem — và từ chối,
 *    vì khoảng cách sửa xấp xỉ cả độ dài trích dẫn. Đó đúng là mất neo, chứ
 *    không phải "không tìm thấy vì chẳng ai đi tìm".
 *  - `exact`: không đụng tới. Kể cả khi văn cảnh hai bên đổi (một đoạn hàng
 *    xóm bị sửa), tầng exact vẫn chấm điểm các lần xuất hiện của trích dẫn và
 *    vẫn trả `fuzzy: false` — nên nhóm này ổn định theo thiết kế, không theo
 *    may mắn.
 */
function buildV11(selected: ReadonlyMap<string, string>): Buffer {
  const files = readPackageDir(FIXTURE_DIR);
  replaceOnce(files, MANIFEST_FILE, '"version": "1.0.0"', '"version": "1.1.0"');

  for (const spec of NOTES) {
    if (spec.kind === 'exact') continue;
    const quote = selected.get(spec.key);
    expect(quote, `lượt chạy này không ghi lại được đoạn đã bôi chọn cho ${spec.key}`).toBeDefined();
    const text = quote as string;
    if (spec.kind === 'fuzzy') {
      expect(
        text.includes(spec.word),
        `cú kéo cho ${spec.key} chọn "${text}", không chứa "${spec.word}" — phép sửa sẽ rơi ra NGOÀI trích dẫn và ghi chú này sẽ giữ nguyên chỗ thay vì dịch nhẹ`,
      ).toBe(true);
      replaceOnce(files, CHAPTER_FILE, text, text.replace(spec.word, spec.into));
    } else {
      replaceOnce(files, CHAPTER_FILE, text, REWRITTEN);
    }
  }
  return packToZip(files);
}

test.describe('§4 — cập nhật có báo cáo thiệt hại', () => {
  // `packages/course-kit/reader.css` giấu `#rail` dưới 1241px, mà `#rail` là
  // nơi panel mồ côi sống. `devices['Desktop Chrome']` là 1280x720, vượt
  // ngưỡng đúng 39px; §4 nói ra thứ nó cần thay vì sống nhờ 39px đó.
  test.use({ viewport: { width: 1440, height: 900 } });

  /**
   * **Kịch bản quan trọng nhất của cả tệp, và lý do nằm ở ruling S1-F29.**
   *
   * Sau khi gộp Task 9 + Task 10, `UpdateDialog.tsx` (297 dòng) và
   * `version.ts` (478 dòng) nằm trong repo mà **không tệp sản phẩm nào
   * import** — chỗ nhắc duy nhất là một chú thích. Thế mà 713 test đơn vị,
   * `tsc -b`, `build` và `lint` **đều xanh**. Bốn cổng đó không hỏi được câu
   * *"người dùng có bấm tới được không"*.
   *
   * Bài kiểm này hỏi được — **và chỉ khi nó thật sự bấm.** Nên mọi bước dưới
   * đây đi qua đúng những cú bấm người thật bấm: mở `/library`, thấy dòng
   * "Có bản mới", bấm "Xem thay đổi", đọc con số, bấm "Ở lại v1.0.0", rồi mở
   * lại và bấm "Cập nhật". **Không dòng nào gọi `previewUpdate` hay
   * `applyUpdate` trực tiếp.** Nếu gọi, bài kiểm này tái tạo lại đúng điểm mù
   * mà nó sinh ra để đóng, và mất lý do tồn tại.
   *
   * Ba lời hứa được khẳng định, theo đúng thứ tự người đọc gặp:
   *
   *  1. hộp thoại hiện **số đúng** cho ba nhóm (nguyên vẹn / dịch nhẹ / mất neo);
   *  2. "Ở lại v1.0.0" thì **không gì đổi** — kể cả nội dung chương, vì
   *     `previewUpdate` vừa tải và dựng cả bản 1.1 trong tiến trình đó
   *     (rule 1 của `course/version.ts`: xem trước KHÔNG được ghi gì);
   *  3. "Cập nhật" thì ghi chú mất neo **vẫn còn** — trong panel mồ côi, còn
   *     nguyên từng chữ.
   */
  test('ghi chú ở v1.0 → hộp thoại đếm đúng ba nhóm → "Ở lại" không đổi gì → "Cập nhật" giữ ghi chú mất neo trong panel mồ côi', async ({
    page,
  }) => {
    // Sáu cú kéo + sáu ghi chú, hai lượt xem trước (mỗi lượt tải cả gói 1.1
    // từ máy chủ và dựng KaTeX cho chương có ghi chú), một lượt áp dụng, và
    // bốn lần nạp trang đầy đủ.
    test.setTimeout(300_000);

    const noise: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      if (isBenignAuthCheck401(msg)) return;
      noise.push(msg.text());
    });
    page.on('pageerror', (err) => noise.push(`pageerror: ${err.message}`));

    await page.goto('/login');
    await registerNewUser(page, freshEmail(), PASSWORD);

    // ---- 1. v1.0 vào máy, qua màn hình Import thật ------------------------
    await page.goto('/import');
    await page.locator('.import-file input[type="file"]').setInputFiles({
      name: `${COURSE_ID}.zip`,
      mimeType: 'application/zip',
      buffer: packToZip(readPackageDir(FIXTURE_DIR)),
    });
    await expect(page.locator('.import-ok')).toContainText('1.0.0', { timeout: 60_000 });

    // ---- 2. sáu ghi chú trên bản 1.0 --------------------------------------
    await page.goto(`/c/${COURSE_ID}/${CHAPTER_ID}`);
    await expect(page.locator('.fade-in p').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.katex').first(), 'KaTeX chưa chạy — neo sẽ được đo trên một phép chiếu khác với phép chiếu người đọc thấy').toBeVisible();

    const selected = new Map<string, string>();
    for (const [i, spec] of NOTES.entries()) {
      const quote = await selectParagraphByDrag(page, spec.startsWith, DRAG_CHARS);
      selected.set(spec.key, quote.trim());

      const toolbar = page.locator('.ann-tb');
      await expect(toolbar, `bôi chọn cho ${spec.key} không mở được thanh công cụ`).toBeVisible();
      await toolbar.getByRole('button', { name: 'Ghi chú', exact: true }).click();
      await page.getByLabel('Nội dung ghi chú').fill(spec.note);
      await page.getByRole('button', { name: 'Xong' }).click();

      // Đếm dồn, không đếm một lần ở cuối: một cú kéo tạo hai vệt tô (đoạn có
      // thẻ con ở giữa) hay không tạo vệt nào phải hỏng NGAY, chứ không phải
      // hỏng ở một khẳng định tổng không nói được cú kéo nào sai.
      await expect(
        page.locator('mark.ann[data-ann-id]'),
        `ghi chú ${spec.key} không cho đúng một vệt tô mới`,
      ).toHaveCount(i + 1);
      // Thanh công cụ phải biến đi trước cú kéo sau: nó nổi trên nội dung, và
      // `selectParagraphByDrag` từ chối một cú kéo bị che — đúng như nó nên
      // làm, nhưng thất bại đó sẽ chỉ nhầm chỗ.
      await expect(toolbar).toBeHidden();
    }

    // ---- 3. tác giả phát hành 1.1 -----------------------------------------
    const v11 = buildV11(selected);
    const published = await uploadPackageToServer(page, v11);
    expect(published.status, `POST /courses trả ${published.status}: ${published.body}`).toBe(201);
    expect(published.body).toContain('1.1.0');

    // ---- 4. cửa vào hộp thoại, trên chính thư viện -------------------------
    await page.goto('/library');
    const row = page.getByRole('list', { name: 'Khóa học của bạn' }).locator('li').filter({ hasText: COURSE_TITLE });
    await expect(row).toHaveCount(1);
    await expect(row.locator('.lib-meta')).toContainText('phiên bản 1.0.0');
    await expect(
      row.locator('.lib-update-note'),
      'thư viện không mời cập nhật dù máy chủ đang giữ một bản mới hơn bản trên máy — đây chính là cánh cửa ruling S1-F29 nói không ai với tới được',
    ).toHaveText('Có bản mới: v1.1.0');

    await row.getByRole('button', { name: 'Xem thay đổi' }).click();

    // ---- 5. ba con số ------------------------------------------------------
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.cu-versions')).toHaveText('v1.0.0 → v1.1.0');

    const exact = NOTES.filter((n) => n.kind === 'exact').length;
    const fuzzy = NOTES.filter((n) => n.kind === 'fuzzy').length;
    const orphan = NOTES.filter((n) => n.kind === 'orphan').length;
    const summary = `${exact}/${NOTES.length} ghi chú giữ đúng chỗ · ${fuzzy} dịch nhẹ · ${orphan} mất neo`;
    await expect(
      dialog.locator('.cu-summary'),
      'ba con số trong hộp thoại không khớp thiệt hại mà bản 1.1 thật sự gây ra',
    ).toHaveText(summary, { timeout: 90_000 });

    // Ghi chú mất neo được gọi tên: đúng chương, đúng từng chữ người đọc đã bôi.
    const orphanRows = dialog.locator('.cu-orphans li');
    await expect(orphanRows).toHaveCount(orphan);
    await expect(orphanRows.first()).toContainText('1.1 · Vì sao chạy thử không kết luận được');
    await expect(orphanRows.first()).toContainText(selected.get('orphan-1') as string);

    // Phân biệt "thiệt hại của bản cập nhật này" với "thiệt hại đã có sẵn":
    // sáu ghi chú vừa được tạo trên chính bản 1.0 nên không cái nào mất neo
    // từ trước, và hộp thoại không được nói ngược lại.
    await expect(dialog).not.toContainText('vốn đã mất neo');
    await expect(dialog.locator('.cu-note')).toHaveCount(1);
    await expect(dialog.locator('.cu-note')).toContainText('không bị xoá');

    // ---- 6. "Ở lại v1.0.0" — không gì đổi ---------------------------------
    await dialog.getByRole('button', { name: 'Ở lại v1.0.0' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(row.locator('.lib-meta')).toContainText('phiên bản 1.0.0');
    await expect(row.locator('.lib-update-note')).toHaveText('Có bản mới: v1.1.0');

    // Nạp lại chương từ đầu: nếu phép xem trước đã ghi bất cứ thứ gì vào
    // `db.packages`, đây là chỗ nó lộ ra — trình đọc mở gói được ghim gần
    // nhất, không mở thứ còn sót trong bộ nhớ.
    await page.goto(`/c/${COURSE_ID}/${CHAPTER_ID}`);
    await expect(page.locator('.fade-in p').first()).toBeVisible({ timeout: 60_000 });
    const stillV10 = await page.evaluate(() => document.querySelector('.fade-in')?.textContent ?? '');
    expect(
      stillV10,
      '"Ở lại v1.0.0" mà chương đã là nội dung bản 1.1 — phép xem trước đã ghi, trái với rule 1 của course/version.ts',
    ).not.toContain(REWRITTEN);
    expect(stillV10, 'nội dung bản 1.0 biến mất khỏi chương sau khi người đọc chọn ở lại bản 1.0').toContain(
      selected.get('orphan-1') as string,
    );
    await expect(page.locator('mark.ann[data-ann-id]')).toHaveCount(NOTES.length, { timeout: 60_000 });
    await openNotesTab(page);
    await expect(page.locator('#rail-tab-notes')).toHaveText(`Ghi chú (${NOTES.length})`);
    await expect(page.locator('.ann-orphans'), 'ở lại bản cũ mà đã có ghi chú mồ côi').toHaveCount(0);

    // ---- 7. "Cập nhật" -----------------------------------------------------
    await page.goto('/library');
    await row.getByRole('button', { name: 'Xem thay đổi' }).click();
    const dialog2 = page.getByRole('dialog');
    // Cùng ba con số ở lượt mở thứ hai: phép xem trước là một phép đo lặp
    // lại được, không phải một tác dụng phụ dùng một lần.
    await expect(dialog2.locator('.cu-summary')).toHaveText(summary, { timeout: 90_000 });
    await dialog2.getByRole('button', { name: 'Cập nhật', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 90_000 });

    await expect(row.locator('.lib-meta'), 'bấm "Cập nhật" xong mà thư viện vẫn nói bản cũ').toContainText(
      'phiên bản 1.1.0',
      { timeout: 30_000 },
    );
    await expect(
      row.locator('.lib-update-note'),
      'đã ở bản mới nhất mà thư viện vẫn mời cập nhật',
    ).toHaveCount(0);

    // ---- 8. ghi chú mất neo VẪN CÒN ---------------------------------------
    await page.goto(`/c/${COURSE_ID}/${CHAPTER_ID}`);
    await expect(page.locator('.fade-in p').first()).toBeVisible({ timeout: 60_000 });
    const nowV11 = await page.evaluate(() => document.querySelector('.fade-in')?.textContent ?? '');
    expect(nowV11, 'chương vẫn là bản 1.0 sau khi người đọc bấm "Cập nhật"').toContain(REWRITTEN);

    await openNotesTab(page);
    // Vẫn sáu: một ghi chú không đặt được vào chỗ nào vẫn là một ghi chú.
    // Con số này từng là thứ P2 làm sai (nhãn "Ghi chú (0)" mời người đọc vào
    // xem đúng lúc họ vừa mất chỗ của mọi ghi chú).
    await expect(page.locator('#rail-tab-notes')).toHaveText(`Ghi chú (${NOTES.length})`, { timeout: 60_000 });
    await expect(
      page.locator('.ann-orphans-h'),
      'ghi chú mất neo không vào panel mồ côi — hộp thoại đã hứa "không bị xoá" ngay trước khi người đọc bấm Cập nhật',
    ).toHaveText(`Mồ côi (${orphan})`, { timeout: 60_000 });
    const orphanCard = page.locator('.ann-orphan');
    await expect(orphanCard).toHaveCount(orphan);
    await expect(orphanCard, 'ghi chú mồ côi mất chữ của nó').toContainText('ghi chú B — cái sẽ mất neo');
    await expect(orphanCard.locator('.ann-orphan-quote')).toContainText(selected.get('orphan-1') as string);
    // Và năm ghi chú kia vẫn được tô trên bản mới — ba nguyên vẹn, hai dịch nhẹ.
    await expect(page.locator('mark.ann[data-ann-id]')).toHaveCount(exact + fuzzy, { timeout: 60_000 });

    expect(noise, `console/page errors: ${noise.join(' | ')}`).toEqual([]);
  });
});

/**
 * §5 — THANH ĐIỀU HƯỚNG THU GỌN ĐƯỢC
 *
 * Người dùng yêu cầu: "The left navigation sidebar should be collapsible."
 *
 * Đây là tầng DUY NHẤT nói được câu ấy có đúng hay không. Luật ẩn là CSS treo
 * dưới `@media (min-width: 981px)` (`styles/shell-modes.css`), mà jsdom không
 * tính media query và không tính bố cục — nên bài kiểm đơn vị chỉ khẳng định
 * được cái LỚP `nav-collapsed`, và nó sẽ xanh y nguyên nếu ai đó xoá sạch khối
 * `@media` kia. Ở đây `toBeHidden()` hỏi trình duyệt thật.
 *
 * Hai chốt đối chứng đi kèm, vì "ẩn được" một mình là một nửa sự thật:
 * lựa chọn phải SỐNG QUA điều hướng và tải lại (khác hẳn ngăn kéo của màn hẹp,
 * thứ `useMobileNav` đóng ở mọi lần đổi route), và ở màn hẹp nút ấy phải vẫn
 * là ngăn kéo cũ chứ không phải một cơ chế thứ hai chồng lên.
 *
 * ── PHẠM VI THU HẸP TỪ VÒNG THIẾT KẾ LẠI ─────────────────────────────────
 * Hai bài này TỪNG chạy trên `/` và `/courses`. Chúng không chạy được ở đó
 * nữa, và đó là điều đúng chứ không phải một hồi quy: thanh bên nay chỉ mang
 * MỤC LỤC, nên ngoài một khoá nó không tồn tại — không có gì để thu gọn.
 *
 * Yêu cầu gốc của người dùng ("The left navigation sidebar should be
 * collapsible") vẫn được giữ nguyên vẹn, chỉ hẹp lại đúng chỗ nó còn nghĩa:
 * thu gọn mục lục để lấy thêm bề ngang khi đang ở trong một khoá. Nên hai bài
 * chuyển vào `/c/:courseId`, và chốt "sống qua điều hướng" nay đi giữa hai
 * route CÙNG có thanh bên (trang khoá học ⇄ tải lại) thay vì sang một route
 * không còn cột nào.
 *
 * Kèm một chốt MỚI, vì luật mới cần răng của chính nó: ngoài một khoá thì
 * `#sidebar` phải VẮNG MẶT, chứ không phải hiện ra rỗng.
 */
test.describe('§5 — thanh điều hướng thu gọn được', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  /**
   * HAI CÁCH ẨN KHÁC NHAU, và phải đo bằng hai phép khác nhau.
   *
   * · Màn rộng thu gọn bằng `display:none` → Playwright gọi là `hidden`.
   * · Màn hẹp ẩn bằng `transform: translateX(-100%)` (reader.css) → phần tử
   *   BỊ ĐẨY RA NGOÀI màn hình nhưng Playwright vẫn gọi nó là `visible`, vì
   *   `toBeHidden()` đo display/visibility/opacity/kích thước, KHÔNG đo vị trí.
   *
   * Bản đầu của bài kiểm này dùng `toBeHidden()` cho cả hai và đỏ ở ca thứ
   * hai — đúng, và đó là lý do hàm dưới đây tồn tại thay vì một lời khẳng định
   * chung chung.
   */
  async function offScreenLeft(page: import('@playwright/test').Page): Promise<boolean> {
    const box = await page.locator('#sidebar').boundingBox();
    return box === null || box.x + box.width <= 0;
  }

  /**
   * Đăng ký, nhập gói thật, rồi đứng TRONG khoá — nơi duy nhất còn thanh bên.
   * Dùng chính gói `tuhoc pack` ghi ra, y như `import.spec.ts`, chứ không dựng
   * một zip trong lúc chạy.
   */
  async function enterCourse(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/login');
    await registerNewUser(page, freshEmail(), PASSWORD);

    await page.goto('/import');
    await page.locator('.import-file input[type="file"]').setInputFiles(realCoursePackageZip());
    await expect(page.locator('.import-ok')).toBeVisible({ timeout: 120_000 });

    await page.goto(`/c/${REAL_COURSE_ID}`);
    await expect(page.locator('#sidebar')).toBeVisible();
  }

  test('☰ ẩn/hiện thanh bên trên màn rộng, và lựa chọn sống qua tải lại', async ({ page }) => {
    await enterCourse(page);

    const sidebar = page.locator('#sidebar');
    const menu = page.locator('#menu-btn');

    // Trạng thái nghỉ. Nút PHẢI thấy được ở khổ rộng — `reader.css` để
    // `#menu-btn{display:none}` ngoài màn hẹp, nên nếu luật
    // `#app:not(.reading) #menu-btn` mất thì tính năng này không có cửa vào.
    await expect(sidebar).toBeVisible();
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');

    await menu.click();
    await expect(sidebar).toBeHidden();
    await expect(menu).toHaveAttribute('aria-expanded', 'false');

    // NGOÀI một khoá thì không có cột nào cả — luật mới, và nó cần răng riêng.
    // Không có chốt này, một bản bỏ sót `#app:not(.in-course)` vẫn xanh.
    await page.goto('/courses');
    await expect(page.locator('#sidebar')).toBeHidden();

    // Quay lại trong khoá: lựa chọn thu gọn KHÔNG bị buộc vào một route, nên
    // nó vẫn còn nguyên. Đi bằng `goto` chứ không bấm liên kết, vì bản đầu của
    // bài này bấm một liên kết nằm trong chính thanh bên vừa thu gọn và hết
    // giờ, đúng như nó phải thế.
    await page.goto(`/c/${REAL_COURSE_ID}`);
    await expect(page.locator('#sidebar')).toBeHidden();

    // Và sống qua tải lại — đây là chỗ khác hẳn ngăn kéo của màn hẹp, thứ
    // `useMobileNav` đóng lại ở mọi lần đổi route.
    await page.reload();
    await expect(page.locator('#sidebar')).toBeHidden();

    // Mở lại được. Một nút chỉ ẩn được mà không hiện lại là một cái bẫy.
    await page.locator('#menu-btn').click();
    await expect(page.locator('#sidebar')).toBeVisible();
  });

  test('đối chứng màn hẹp: cùng nút ấy vẫn là ngăn kéo cũ, không phải cơ chế thứ hai', async ({
    page,
  }) => {
    await enterCourse(page);
    await page.setViewportSize({ width: 375, height: 800 });

    // Dưới 981px thanh bên là ngăn kéo: nó Ở TRONG tài liệu và Playwright gọi
    // là `visible`, chỉ nằm ngoài khung nhìn. Nên hỏi VỊ TRÍ, không hỏi hiện/ẩn.
    await expect(page.locator('#sidebar')).toBeVisible();
    // `poll`, không phải một phép đo một-lần: `reader.css` đặt
    // `transition: transform .22s ease` trên `#sidebar`, và bài này vừa đổi khổ
    // từ 1440 xuống 375 — tức thanh bên đang TRƯỢT từ vị trí cũ sang -100% ngay
    // lúc câu khẳng định chạy. Bản đầu đo một lần và đỏ với `x` nằm giữa chừng.
    await expect
      .poll(async () => offScreenLeft(page), { message: 'ngăn kéo phải nằm ngoài màn hình khi đóng' })
      .toBe(true);

    await page.locator('#menu-btn').click();
    await expect
      .poll(async () => offScreenLeft(page), { message: 'ngăn kéo phải trượt vào' })
      .toBe(false);

    // Đổi route ĐÓNG ngăn kéo lại — hành vi cũ của `useMobileNav`, và là chỗ
    // hai cơ chế khác nhau rõ nhất. Nếu bản thu gọn lỡ gộp vào đây thì đỏ.
    //
    // BẤM MỘT CHƯƠNG TRONG CHÍNH NGĂN KÉO, không bấm mục điều hướng trên thanh
    // trên — và đây là điều e2e dạy lại tôi chứ không phải một lựa chọn phong
    // cách. Khi ngăn kéo mở, `reader.css` phủ `body.nav-open::after` lên cả
    // trang; mục điều hướng nằm ở thanh trên nên nó nằm DƯỚI lớp phủ ấy và
    // Playwright chờ "visible, enabled and stable" 173 lần rồi hết giờ. Trước
    // vòng thiết kế lại, mục điều hướng nằm TRONG ngăn kéo nên câu hỏi này
    // không tồn tại.
    //
    // Đường của người dùng thật khi ngăn kéo đang mở cũng đúng là đường này:
    // thứ duy nhất bấm được là một chương.
    //
    // ĐO BẰNG `body.nav-open`, KHÔNG bằng vị trí thanh bên: đích là một chương,
    // mà chế độ đọc ẩn hẳn `#sidebar` vì một lý do KHÁC. Đo vị trí ở đó sẽ xanh
    // dù `useMobileNav` ngừng hoạt động hoàn toàn — hai nguyên nhân cho cùng
    // một phép đo. `body.nav-open` là trạng thái chính hook ấy sở hữu.
    await page.locator('#nav a.nav-item').first().click();
    await expect(page).toHaveURL(new RegExp(`/c/${REAL_COURSE_ID}/`));
    await expect(page.locator('body')).not.toHaveClass(/nav-open/);

    // Quay lại trang khoá học, nơi có cột để mà đo: ngăn kéo phải đang ĐÓNG, và
    // thanh bên KHÔNG bị `display:none` — tức luật thu gọn của màn rộng không
    // rò xuống dưới ngưỡng, nơi nó sẽ làm ngăn kéo không mở được nữa.
    await page.goto(`/c/${REAL_COURSE_ID}`);
    await expect(page.locator('#sidebar')).toBeVisible();
    await expect
      .poll(async () => offScreenLeft(page), { message: 'ngăn kéo phải đang đóng' })
      .toBe(true);
  });
});

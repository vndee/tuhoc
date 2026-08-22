# Hệ thống con 3 — Registry trên GitHub + song ngữ — Kế hoạch triển khai

> **Dành cho người thực thi bằng agent:** BẮT BUỘC dùng skill `superpowers:subagent-driven-development`
> hoặc `superpowers:executing-plans`. Các bước dùng checkbox (`- [ ]`).

**Mục tiêu:** Cộng đồng đóng góp course bằng một PR; người học duyệt catalog và kéo course về thư
viện cá nhân; giao diện nền tảng chạy được cả tiếng Việt lẫn tiếng Anh, còn course thì ngôn ngữ nào
cũng được nhưng **có nhãn** để người pull biết mình sắp nhận gì.

**Kiến trúc:** Một repo GitHub công khai, mỗi course một thư mục. CI chạy **đúng bộ luật mà nền tảng
chạy** (`packages/course-format`), gán nhãn hạng, và sinh **một** `index.json`. Nền tảng chỉ tải tệp
đó, phục vụ qua **GitHub Pages** — cache CDN, **không** giới hạn tần suất theo IP như GitHub API, và
bản tự chạy dùng được y hệt.

**Tech stack:** GitHub Actions + Pages cho registry; React 19 + Vite phía nền tảng; không thêm thư
viện i18n (xem HC-1).

**Spec:** `docs/superpowers/specs/2026-08-20-platform-v2-design.md` §4.

---

## Ba hiệu chỉnh spec — tiền kiểm trên mã thật ngày 2026-08-22

### HC-1. "Song ngữ" không phải một task. Nó là **84 tệp**.

Spec §4.2 viết gọn: *"Giao diện nền tảng: tiếng Việt + tiếng Anh."* Đo thật:

| nơi | số tệp có chuỗi tiếng Việt viết cứng |
|---|---|
| `apps/web/src/**/*.tsx` | **44** |
| `apps/web/src/**/*.ts` (không kể test) | **17** |
| `apps/vault/src/**/*.ts` (không kể test) | **14** |
| `apps/api/**/*.go` | **9** |
| **tổng** | **84** |

**HIỆU CHỈNH 2026-08-22 (Task 4 đo lại):** con số 84 ở trên đếm **chú thích**, không đếm chuỗi giao
diện — văn xuôi của repo này là tiếng Việt, nên `grep` gắn cờ *mọi* tệp sản phẩm (62/62 web, 14/14
vault). Đọc ở tầng **AST**, bề mặt cần bóc thật là **37 tệp**. Kết luận của HC-1 **vẫn đúng** (đây là
di trú xuyên suốt, cần tách hạ tầng khỏi việc bóc, cần cổng theo allowlist); chỉ **con số là sai**.
Task 5 có quy mô **37**, trong đó riêng `course/import.ts` là **75 chuỗi**.

**Và cần gốc quét THỨ BA:** `packages/course-kit/runtime.js:377,382` gửi hai câu tiếng Việt tới trang
người đọc qua `<script src>`. Một cổng chỉ quét hai cây sẽ **im lặng về chúng vĩnh viễn**.

Và **không có hạ tầng i18n nào** — không `i18next`, không `react-intl`, không một hàm `t()` nào.

⇒ Đây là **di trú xuyên suốt**, quy mô ngang cả hệ thống con 1, không phải một mục trong danh sách.
Hai hệ quả cho kế hoạch này:

1. **Tách hạ tầng (Task 4) khỏi việc bóc chuỗi (Task 5).** Task 4 nhỏ và có cổng; Task 5 lớn và cơ
   học. Gộp chúng thì người thẩm định không từ chối được nửa này mà giữ nửa kia.
2. **Task 4 phải dựng một cổng chặn chuỗi cứng MỚI**, nếu không Task 5 vừa dọn xong thì các task
   sau lại rắc chuỗi cứng vào. Dự án này đã có **năm cổng mù**, tất cả cùng hình dạng *cổng đo thứ
   nó với tới được*. Một cổng i18n chỉ quét `apps/web/src` sẽ **im lặng** về 14 tệp trong `apps/vault`
   — nơi có form nhập key.

**Không thêm thư viện i18n.** Lý do đo được: 84 tệp cần bóc chuỗi bất kể dùng thư viện gì; phần thư
viện thêm vào chỉ là tra cứu và số nhiều. Một `messages/{vi,en}.ts` cộng một hàm tra cứu là đủ, và
nó giữ được `tsc` làm cổng — khoá thiếu bản dịch **không biên dịch được**, thay vì trả về chính khoá
ấy lúc chạy như mọi thư viện i18n đều làm.

### HC-2. CI của registry chưa tồn tại — và máy chủ ĐÃ uỷ thác cho nó rồi

`.github/` **không tồn tại trong repo**. Nhưng thẩm định tổng hệ thống con 1 đã đo được: máy chủ
**cố ý không chạy luật HTML**, và chú thích trong mã **uỷ thác việc đó cho "registry CI"**.

⇒ Hôm nay **không có gì kiểm luật HTML của một gói tải lên**. Đó không phải nợ của hệ thống con 3;
đó là **lỗ đang mở** mà hệ thống con 3 là nơi đóng. Task 1 phải đóng nó, và phải có test chứng minh
rằng một gói hạng `content` mang `<script>` **bị PR từ chối**, chứ không chỉ "CI có chạy".

Ràng buộc kèm theo: CI **phải chạy đúng `packages/course-format`**, không phải một bản chép. Thẩm
định tổng đã đo *"một bộ luật, ba nơi"* thực ra là **ba bản bất đồng ở 7/12 hàng**. Đừng tạo bản thứ
tư.

### HC-2b. Registry là repo RIÊNG — nó lấy bộ luật ở đâu (quyết định 2026-08-22)

Người cài đặt Task 1 nêu đúng câu hỏi và **cố ý không tự quyết**: workflow hiện sống trong repo nền
tảng với `REGISTRY_ROOT: fixtures/courses`, nên **cổng registry và sáu tệp unit test đang dùng chung
một cây course**. Nếu registry thật sự là repo riêng, cách nó lấy `packages/course-format` quyết định
việc *"một bộ luật, một bản"* có sống sót hay không.

Ba đường và vì sao chọn đường thứ ba:

| đường | vấn đề |
|---|---|
| git submodule | người đóng góp phải `--recursive`; quên là CI chạy trên bộ luật rỗng — **im lặng**, đúng hình dạng cổng mù |
| vendor một bản chép | tạo **bản thứ tư**. Thẩm định tổng đã đo ba bản bất đồng **7/12 hàng**; đừng thêm |
| **CI của registry checkout repo nền tảng ở một tag đã ghim** ✅ | một bản duy nhất; tag làm việc đổi luật thành **hành động có chủ ý**; không cần hạ tầng publish |

**Trạng thái hiện tại là đúng và có ích, không phải tạm bợ:** workflow trong repo nền tảng, trỏ vào
`fixtures/courses`, là **phép tự kiểm của chính cái cổng ấy** — nó chứng minh bộ luật chặn được gói
xấu, trên gói thật, mỗi PR. Repo registry riêng là hiện vật **chưa tồn tại**; khi dựng, CI của nó
checkout repo này ở tag đã ghim rồi chạy `tools/registry`.

**Ràng buộc kèm theo:** khi tạo repo registry, `REGISTRY_ROOT` của nó trỏ vào cây course của chính
nó, **không** vào `fixtures/`. Hai cổng khi ấy đo hai thứ khác nhau — một cổng đo *bộ luật còn cắn
không*, một cổng đo *gói cộng đồng có sạch không* — và cả hai đều cần.

### HC-3. `lang` hôm nay chỉ để hiển thị, chưa lọc được gì

Đo: `lang` chỉ xuất hiện ở `apps/web/src/pages/Library.tsx` hai chỗ, cả hai để **vẽ chữ**. Không có
lọc, không có ưu tiên, không có gì đọc nó để quyết định. Spec §4.2 nói *"catalog lọc và hiển thị theo
nó"* — nửa "lọc" là **chưa có**, phải xây ở Task 6.

---

## Global Constraints

- **Một bộ luật, một bản.** CI registry chạy `packages/course-format`. Không chép luật.
- **Nền tảng chỉ tải `index.json`** — một request. Không gọi GitHub API cho việc duyệt catalog.
- **Bản tự chạy phải dùng được registry công khai ở chế độ chỉ-đọc** (quyết định của chủ dự án, §1.1).
- **Course riêng tư không bao giờ chạm registry.** `make check-publish` phải vẫn xanh phần của nó.
- **Không khoá dịch nào được phép thiếu ở một ngôn ngữ** — cưỡng chế bằng `tsc`, không bằng lúc chạy.
- `erasableSyntaxOnly` **cấm tham số-thuộc tính** (TS1294) — đã cắn **ba lần**.
- `tsc -b`, **không** `tsc --noEmit` (cổng rỗng trong repo này).
- **`rtk` không trung thực**: in "Success" cho lệnh exit 1, viết lại `cat`/`grep`/`find`, bọc
  `make test-e2e` rồi trả mã thoát của chính nó. `make` thoát **2** khi rule lỗi.
- **Tiến trình nền phải bị giết trong CÙNG lệnh shell**, và **giết theo cổng** — `kill $!` không với
  tới tiến trình con của `bunx` (đã rò một lần).
- **Cổng 5173 đang bị một PID lạ chiếm.** Hai agent đã suýt kết luận sai vì Playwright lái nhầm ứng
  dụng khác. Dùng cổng khác **và** khẳng định "tôi có đang nhìn đúng trang không".

---

## Cấu trúc tệp

```
.github/workflows/registry.yml       ← CI: validate + gán nhãn + sinh index.json
tools/registry/
  build-index.ts                     sinh index.json từ cây course
  build-index.test.ts
  validate-pr.ts                     chạy packages/course-format trên các thư mục đã đổi
apps/web/src/registry/
  index.ts                           tải + cache index.json
  types.ts                           RegistryIndex, RegistryEntry
  Catalog.tsx                        màn duyệt catalog
  useRegistry.ts
apps/web/src/i18n/
  messages/vi.ts                     nguồn sự thật: mọi khoá
  messages/en.ts                     PHẢI phủ đúng tập khoá của vi.ts (tsc cưỡng chế)
  index.ts                           t(), LanguageProvider, useLang
  i18n.test.ts                       cổng: không chuỗi cứng mới
```

---

## Task 1: CI registry — đóng lỗ HC-2

**Files:** Create `.github/workflows/registry.yml`, `tools/registry/validate-pr.ts` + test

**Interfaces:** Produces `validateChangedCourses(dirs: string[]): Promise<Finding[]>`

- [ ] **Step 1: Test đỏ — gói `content` mang `<script>` phải BỊ TỪ CHỐI**

Đây là khẳng định chịu lực của cả Task. Không viết test kiểu "CI có chạy"; viết test kiểu **"cái xấu
bị chặn"**.

```ts
it('gói hạng content mang <script> bị từ chối, và thông báo nêu ĐÍCH DANH tệp', async () => {
  const dir = await writeFixture({ tier: 'content', files: { 'chapters/c1.html': '<script>alert(1)</script>' } });
  const findings = await validateChangedCourses([dir]);
  expect(findings.length).toBeGreaterThan(0);
  expect(findings.map((f) => f.code)).toContain('SCRIPT_IN_CONTENT');
  expect(findings.map((f) => f.where).join(' ')).toContain('chapters/c1.html');
});

it('ĐỐI CHỨNG: cùng gói ấy khai tier "interactive" thì ĐƯỢC — hạng đó được phép chạy mã', async () => {
  const dir = await writeFixture({ tier: 'interactive', files: { 'chapters/c1.html': '<script>alert(1)</script>' } });
  expect(await validateChangedCourses([dir])).toEqual([]);
});
```

Ca đối chứng thứ hai **bắt buộc**: không có nó, một cài đặt từ chối mọi thứ cũng xanh.

- [ ] **Step 2: Chạy — ĐỎ.** Dán RED.
- [ ] **Step 3: Viết `validate-pr.ts`** — import `validatePackage` từ `packages/course-format`,
  **không chép luật**. Chỉ chạy trên thư mục PR đổi (`git diff --name-only`).
- [ ] **Step 4: Viết workflow.** Chạy trên `pull_request`. Job phải **thất bại** khi có finding.
- [ ] **Step 5: Chốt chống cổng mù** — nếu vòng quét thấy **0 thư mục course**, job phải **đỏ**, không
  xanh. Một PR không đụng course nào thì skip **có nêu lý do**, khác với "quét 0 thứ rồi báo đạt".
- [ ] **Step 6: Commit** `ci(registry): chạy bộ luật trên PR, chặn script trong hạng content`

---

## Task 2: `index.json` — một tệp, một request

**Files:** Create `tools/registry/build-index.ts` + test; mở rộng workflow Task 1

**Interfaces:** Produces `buildIndex(root: string): Promise<RegistryIndex>`;
`interface RegistryEntry { id, title, description, lang, tier, license, authors, generatedBy, versions: string[], latest: string, bytes: number, updatedAt: string }`

- [ ] **Step 1: Test đỏ — sắp phiên bản bằng SEMVER, không bằng thứ tự từ điển**

Dự án đã vấp bẫy này **hai lần** (một lần ở Go, một lần ở `course_workspace.py`). Nó sẽ vấp lần ba
nếu không có test.

```ts
it('latest là 1.10.0 chứ không phải 1.9.0', async () => {
  const idx = await buildIndex(fixtureWithVersions(['1.9.0', '1.10.0', '1.2.0']));
  expect(idx.courses[0].latest).toBe('1.10.0');
});
```

- [ ] **Step 2–4:** viết `buildIndex`, chạy xanh, nối vào workflow (job `push` lên `main` sinh
  `index.json` rồi publish qua Pages).
- [ ] **Step 5: `index.json` phải TỰ MÔ TẢ phiên bản định dạng** — thêm `schema: 1`. Nền tảng cũ gặp
  index mới phải **hỏng ồn ào**, không đoán.
- [ ] **Step 6: Commit** `feat(registry): sinh index.json, sắp phiên bản theo semver`

---

## Task 3: Nền tảng đọc catalog

**Files:** Create `apps/web/src/registry/{index.ts,types.ts,useRegistry.ts,Catalog.tsx}` + test

- [ ] **Step 1: Test đỏ — `index.json` hỏng KHÔNG được làm trắng trang.**

Đây là hồi quy có thật: `api.get<T>` từng trao một chuỗi HTML dưới danh nghĩa `T`, và `.map` trên nó
làm unmount cả cây React → trang trắng (commit `815a472`). Registry là **nguồn dữ liệu bên thứ ba**,
tức đúng lớp rủi ro ấy nhưng ở ngoài tầm kiểm soát của ta.

```ts
it('index.json trả HTML (Pages 404 fallback) → hiện thông báo, không trắng trang', async () => { … });
it('index.json thiếu trường courses → hiện thông báo', async () => { … });
it('schema lạ (999) → nói rõ nền tảng cần cập nhật, KHÔNG cố đọc', async () => { … });
```

- [ ] **Step 2–5:** `fetchIndex` kiểm hình dạng ở **ranh giới** (như `assertStats` ở
  `apps/web/src/api/stats.ts` — cùng lý do, chép cùng khuôn), cache theo `ETag`, màn Catalog.
- [ ] **Step 6: Commit** `feat(web): duyệt catalog registry`

---

## Task 4: Hạ tầng i18n + cổng chặn chuỗi cứng (HC-1 phần 1)

**Files:** Create `apps/web/src/i18n/{index.ts,messages/vi.ts,messages/en.ts,i18n.test.ts}`

- [ ] **Step 1: Test đỏ — thiếu một bản dịch phải KHÔNG BIÊN DỊCH ĐƯỢC**

```ts
// messages/en.ts
import type { Messages } from './messages/vi';
export const en: Messages = { /* thiếu một khoá ⇒ tsc -b thoát 2 */ };
```

Kiểm bằng cách xoá một khoá trong bản chép scratchpad rồi chạy `tsc -b`: **phải thoát khác 0**. Đây
là điểm mạnh duy nhất của cách tự viết so với thư viện i18n — thư viện trả về chính khoá ấy lúc chạy
và **không cổng nào biết**.

- [ ] **Step 2: Cổng chặn chuỗi cứng MỚI.** Quét **cả `apps/web/src` LẪN `apps/vault/src`** — 14 tệp
  trong vault có chuỗi tiếng Việt, và đó là nơi có form nhập key. Cổng phải:
  - **đỏ nếu quét 0 tệp** (chống cổng mù);
  - dùng **danh sách tệp đã bóc** (allowlist thu hẹp dần), không dùng ngưỡng đếm — một ngưỡng vẫn
    xanh khi ai đó bóc một tệp và thêm một tệp, đúng lập luận `db/local.test.ts` dùng để liệt kê năm
    bảng Dexie theo tên.
- [ ] **Step 3–5:** `t()`, `LanguageProvider`, ghi nhớ lựa chọn theo **thiết bị** (không đồng bộ).
- [ ] **Step 6: Commit** `feat(web): hạ tầng i18n + cổng chặn chuỗi cứng`

---

## Quyết định trước Task 5 (điều phối viên, 2026-08-22)

Task 4 nêu hai câu hỏi và **cố ý không tự trả lời**. Cả hai đã chốt.

### QĐ-1. `apps/vault` dùng chung catalog qua một gói `packages/i18n` **không phụ thuộc gì**

Kho khoá là **origin riêng giữ bí mật**, và `index.html` của nó nói rõ **danh sách phụ thuộc của nó
là bề mặt tấn công**. Ba đường:

| đường | phán quyết |
|---|---|
| vault nhập thẳng từ `apps/web/src/i18n` | ghép kho khoá vào cây nguồn của ứng dụng chính — chính thứ kiến trúc này sinh ra để tách |
| catalog thứ hai trong vault | **hai bản sẽ trôi khác nhau**. Dự án đã đo *"một bộ luật, ba bản, bất đồng 7/12 hàng"*; đừng thêm |
| **`packages/i18n` dùng chung** ✅ | một bản duy nhất, và bề mặt tấn công **đo được** |

**Ràng buộc làm cho lựa chọn này an toàn, và nó phải có cổng:** `packages/i18n` chỉ được chứa **hằng
chuỗi và một hàm tra cứu thuần** — **không React, không DOM, không I/O, không phụ thuộc runtime nào**.
Viết một test khẳng định điều đó (`dependencies` rỗng, và không tệp nguồn nào `import` thứ gì ngoài
kiểu của chính nó). Không có cổng ấy thì lựa chọn này chỉ là lời hứa.

**Và sửa thứ tự của Task 5:** kế hoạch bảo làm `apps/vault` **trước** vì "ít tệp nhất". Sai — nó là
bước **duy nhất có vật cản kiến trúc**. Làm nó **sau** khi `packages/i18n` tồn tại và có cổng.

### QĐ-2. `t()` giữ nguyên trả về `string`; thêm `tNode()` cho câu có thẻ giữa chừng

9 trong 20 tệp `.tsx` trên sổ có thẻ nội tuyến giữa câu (ví dụ `pages/Settings.tsx`:
`<strong>kho khoá</strong>`). Đổi `t()` sang `ReactNode` **hỏng** mọi ngữ cảnh chỉ-nhận-chuỗi —
`aria-label`, `title`, `placeholder`, thông báo `throw` — và biến chúng thành chỗ phải thu hẹp kiểu
bằng tay.

⇒ **Hai hàm, hai hợp đồng rõ ràng**, hơn một hàm trả về union mà mọi người phải narrow:
- `t(key)` → `string`, dùng được ở mọi chỗ cần chuỗi, **kiểu vẫn chặt**;
- `tNode(key, parts)` → `ReactNode`, chỉ cho câu có thẻ giữa chừng.

Người cài đặt Task 4 nói đúng rằng việc này **rẻ bây giờ và đắt sau 37 tệp** — đó là lý do chốt ở đây
chứ không để Task 5 tự xoay.

## Task 5: Bóc 37 tệp (HC-1 phần 2)

**Files:** Modify 44 `.tsx` + 17 `.ts` (`apps/web`), 14 `.ts` (`apps/vault`), 9 `.go` (`apps/api`)

Cơ học nhưng lớn. **Chia theo vùng, mỗi vùng một commit**, để một vòng thẩm định từ chối được một
vùng mà không phải trả lại cả 84 tệp:

- [ ] **Step 1:** `apps/vault` (14 tệp) — **làm trước**, vì đây là bề mặt an ninh và ít tệp nhất.
- [ ] **Step 2:** `apps/web` shell + trang (Dashboard, Library, Settings, Login…)
- [ ] **Step 3:** `apps/web` reader + annotations (nhiều chuỗi nhất)
- [ ] **Step 4:** `apps/web` chuỗi lỗi (`import.ts`, `client.ts`, `describeFinding`)
- [ ] **Step 5:** `apps/api` (9 tệp Go) — **quyết định trước khi làm**: thông báo lỗi API dịch phía
  server hay trả **mã lỗi** để client dịch? Trả mã là đúng hơn (server không biết ngôn ngữ người
  đọc), nhưng nó **đổi hợp đồng API**. Nếu bạn thấy phương án khác đúng hơn, **nói rõ lý do**.
- [ ] **Step 6:** allowlist của cổng Task 4 phải **rỗng** khi xong. Nếu còn mục nào, **liệt kê ra
  kèm lý do**, đừng để nó im lặng.

---

## Task 6: Kéo course về + lọc theo ngôn ngữ (HC-3)

**Files:** Modify `apps/web/src/course/import.ts`, `registry/Catalog.tsx`

- [ ] **Step 1: Test đỏ** — kéo một course từ registry đi qua **đúng đường import đã có** (ba đường
  hiện tại: tệp / URL zip / git công khai). Không mở đường thứ tư: hệ thống con 1 đã đo được cả ba
  đường tới cùng một chỗ, và đó là tính chất đáng giữ.
- [ ] **Step 2: Lọc theo `lang`** — HC-3: hôm nay `lang` chỉ để hiển thị. Thêm lọc, và **nhãn phải
  nói rõ trước khi kéo về**, vì chủ dự án nêu đúng yêu cầu ấy: *"cần nhãn để user biết nên expect
  như thế nào khi pull về thư viện cá nhân"*.
- [ ] **Step 3–5:** trạng thái đang kéo, lỗi mạng, gói không hợp lệ.
- [ ] **Step 6: Commit** `feat(web): kéo course từ registry, lọc theo ngôn ngữ`

---

## Task 7: Cổng nghiệm thu đầu-cuối

**Files:** Create `apps/web/e2e/s3.spec.ts`

Bốn kịch bản, **đi qua giao diện thật** — ruling S1-F29: bốn cổng đơn vị không hỏi được câu *"người
dùng có bấm tới được không"*, chỉ e2e hỏi được, **và chỉ khi nó bấm**.

1. Duyệt catalog → thấy nhãn ngôn ngữ và nhãn **hạng** (hạng là quyết định an ninh, không phải phân
   loại nội dung).
2. Kéo một course về → nó xuất hiện trong thư viện → mở chương đọc được.
3. Đổi ngôn ngữ giao diện → chữ đổi, **và lựa chọn sống sót qua reload**.
4. `index.json` trả HTML → **hiện thông báo**, không trắng trang.

- [ ] Chạy `rtk proxy make test-e2e`, in **mã thoát thô**. Mọi spec cũ phải vẫn xanh.
- [ ] Commit `test(e2e): cổng nghiệm thu hệ thống con 3`

---

## Self-Review

**Đối chiếu spec §4:**

| Spec | Task |
|---|---|
| §4.1 repo công khai, đóng góp bằng PR | 1 |
| §4.1 CI chạy bộ kiểm định, gán nhãn hạng | 1 — **và đóng lỗ HC-2** |
| §4.1 sinh `index.json`, một request, cache được | 2 · 3 |
| §4.1 phục vụ qua Pages, không qua API | 2 |
| §4.1 nội dung tải theo yêu cầu khi pull | 6 |
| §4.2 giao diện song ngữ | 4 · 5 — **84 tệp, xem HC-1** |
| §4.2 `lang` là nhãn, catalog lọc và hiển thị | 6 — **nửa "lọc" chưa từng tồn tại, xem HC-3** |
| §1.1 bản tự chạy đọc registry chỉ-đọc | 3 |

**Quét placeholder:** Task 5 cố ý là danh sách vùng chứ không phải mã — nó là di trú cơ học 84 tệp,
và viết sẵn mã cho 84 tệp trong một kế hoạch là giả vờ chính xác. Mọi task còn lại có mã thật hoặc
khẳng định cụ thể.

**Nhất quán kiểu:** `RegistryEntry`/`RegistryIndex` định nghĩa **một lần** ở Task 2 (`tools/registry`)
và nền tảng nhập lại ở Task 3 — một định nghĩa, không hai bản trôi dạt, đúng bài học *"một bộ luật,
ba bản, bất đồng 7/12 hàng"*. `Messages` định nghĩa ở `vi.ts` và `en.ts` **phải khớp kiểu**.

**Rủi ro lớn nhất** — nói ra để người thực thi cảnh giác: **Task 5 sẽ bị cám dỗ dùng ngưỡng đếm thay
cho allowlist tệp**, vì allowlist phải sửa mỗi commit còn ngưỡng thì không. Làm vậy là dựng **cổng mù
thứ sáu**: ngưỡng vẫn xanh khi ai đó bóc một tệp và thêm một tệp khác. Nếu thấy allowlist quá phiền,
**dừng và báo**, đừng tự đổi sang ngưỡng.

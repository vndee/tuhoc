# Hệ thống con 1 — Gói course di động + course riêng tư

> **Biên tập cho bản công khai — 2026-08-22.** Đây là một bản ghi **có ngày
> tháng**, nên nó không được viết lại. Đúng một thứ bị thay, ở mọi chỗ nó xuất
> hiện: danh tính giáo trình riêng tư của tác giả — `id`, `title`,
> `description` — nay lần lượt là `«giáo-trình-riêng»`, `«Giáo trình riêng»`,
> `«mô tả của giáo trình riêng»`. Mọi số đo, ngày tháng, quyết định, bước làm
> và kết luận **giữ nguyên**; chỗ nào đọc thấy lạ thì đó là câu chữ gốc, không
> phải chỗ bị cắt.
>
> Vì sao phải thay: repo này sắp công khai, và tài liệu đi cùng nó y như mã
> (`make check-publish`, phép 4). Vì sao không xoá hẳn tệp: một bản ghi quyết
> định bị giấu đi thì thôi là bản ghi. Vì sao khai báo thay vì sửa lặng lẽ:
> sửa lặng lẽ một tài liệu có ngày tháng là làm giả nó.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biến course từ một thư mục tĩnh nằm trong repo thành **gói cắm rời được**: tạo ra bằng CLI, kiểm định bằng một bộ luật, mang đi bằng tệp hoặc URL, import vào thư viện cá nhân, và giữ riêng tư nếu muốn.

**Architecture:** Một gói TypeScript thuần (`packages/course-format`) giữ **định dạng và bộ luật kiểm định** — CLI, CI của registry, và trình duyệt đều gọi đúng nó. Server Go **không** nhân bản bộ luật đó; nó chỉ kiểm cấu trúc (kích thước, manifest parse được, đường dẫn không thoát thư mục) rồi lưu gói dưới dạng blob trong Postgres. Phía web, gói được cache vào Dexie để đọc offline; `loader.ts` đọc local trước, ngã về server sau.

**Tech Stack:** TypeScript (gói định dạng + CLI, chạy bằng Bun), Go/Fiber + Postgres (lưu trữ + phục vụ), React/Vite (import + thư viện), Dexie (cache offline), `fflate` (giải nén zip, ~8KB, chạy được cả Node lẫn trình duyệt).

**Spec:** `docs/superpowers/specs/2026-08-20-platform-v2-design.md` §1.1, §1.2, §2, §2B, §9

---

## Global Constraints

Sao nguyên văn từ spec và từ nợ kết chuyển. **Mọi task đều ngầm chịu ràng buộc này.**

- **Một bộ luật kiểm định, ba nơi chạy** (§2.2). Bộ luật sống ở `packages/course-format`. CLI, CI registry, và trình duyệt **gọi cùng một hàm**. Server Go **cố ý KHÔNG nhân bản nó** — xem "Ranh giới kiểm định" dưới đây.
- **Hai hạng course** (§1.2): `content` (HTML+CSS+công thức, **không JS**) và `interactive` (có JS, phải duyệt tay). `tier` là trường **bắt buộc** trong manifest.
- **KHÔNG sandbox iframe cho nội dung chương** — nó sẽ phá toàn bộ P2 (ghi chú lề cần DOM cùng tài liệu). Đã phân tích ở spec §1.2.
- **`clearLocalData()` là điểm chân lý duy nhất** để xoá dữ liệu cục bộ, và nó liệt kê bảng qua `db.tables`. `db/local.test.ts` assert **đúng 4 bảng** như một tripwire — thêm bảng thứ 5 thì **sửa con số đó một cách có ý thức**, đừng "sửa" helper.
- **Mọi khoá `localStorage` phải đi qua `readLocalStorage`/`writeLocalStorage`** và được phân loại vào `USER_CONTENT_KEYS` hoặc `DEVICE_PREFERENCE_KEYS` (ruling P2-F17). Chốt AST trong `db/local.test.ts` quét cả `packages/course-kit/*.js` và `courses/*/*.js`.
- **Cursor đồng bộ là giá trị đục** — gửi lại nguyên văn, không parse.
- **KHÔNG thêm "đồng bộ ngay khi đăng nhập"** vào `useSyncLifecycle` (ruling P2-F3).
- **Đặt tên trong registry:** `<tài-khoản-github>/<mã-course>` (§9.5).
- **Giới hạn 20 MB chưa nén** mỗi gói; CI và server đều từ chối gói lớn hơn (§9.5).
- **Bản dịch là course RIÊNG**, liên kết bằng `translationOf` (§9.5).
- **Cổng kiểu là `tsc -b`**, KHÔNG phải `tsc --noEmit` (cổng rỗng — `"files": []` + references).
- **`make test-e2e` bị `rtk` bọc** và trả mã thoát của chính nó ⇒ luôn dùng `rtk proxy make test-e2e`, và kiểm log có phần Playwright thật.
- **Cổng e2e luôn `docker compose up -d --build`** — bỏ `--build` là lỗ hổng khiến cổng từng mù với mọi thay đổi Go.

### Ranh giới kiểm định — vì sao Go KHÔNG nhân bản bộ luật

Phép quét HTML nghiêm ngặt của hạng `content` tồn tại để **bảo vệ người khác** khỏi course do người lạ đóng góp. Đường đó là **registry** — và ở đó **CI chạy đúng bộ luật TypeScript** trước khi merge PR.

Một course **riêng tư** người dùng tự upload cho chính mình **không phải vector tấn công tới ai cả**; và muốn công khai thì phải đi qua PR vào registry, tức lại qua CI. Nên server chỉ cần:
1. kích thước ≤ 20 MB chưa nén,
2. `manifest.json` parse được và có đủ trường bắt buộc,
3. **không đường dẫn nào thoát ra ngoài thư mục gói** (`../`, đường dẫn tuyệt đối, symlink),
4. mọi `file` trong manifest trỏ tới một mục có thật trong gói.

Đó là tập luật **nhỏ, khác loại**, không phải bản sao nghèo nàn của bộ luật TS ⇒ không có "bản sao trôi dạt". **Nếu implementer thấy cần port phép quét HTML sang Go → DỪNG và báo.**

---

## File Structure

```
packages/course-format/                  # MỚI — thuần, không phụ thuộc app
  package.json  tsconfig.json
  src/types.ts          # Manifest v2 + Chapter/Part (mở rộng từ apps/web/src/course/types.ts)
  src/validate.ts       # BỘ LUẬT DUY NHẤT
  src/zip.ts            # đọc/ghi gói .zip (fflate), an toàn đường dẫn
  src/index.ts
  src/*.test.ts

tools/tuhoc-cli/                         # MỚI
  package.json  src/index.ts  src/init.ts  src/pack.ts
  templates/course/                      # khung course rỗng
  src/*.test.ts

.claude/skills/course-authoring/SKILL.md # MỚI — skill soạn course cho agent
docs/course-format.md                    # MỚI — tài liệu định dạng cho người đóng góp

apps/api/
  migrations/0002_course_packages.up.sql / .down.sql
  internal/course/{repo.go,usecase.go,handler.go,course_test.go}   # MỚI
  internal/server/server.go                                        # SỬA: đăng ký route

apps/web/src/
  db/local.ts                     # SỬA: thêm bảng `packages` (bảng thứ 5)
  db/local.test.ts                # SỬA: tripwire 4 → 5
  api/courses.ts                  # MỚI: client GET/POST /courses
  course/types.ts                 # SỬA: re-export từ packages/course-format
  course/loader.ts                # SỬA: local-first, ngã về server
  course/import.ts                # MỚI: tệp / URL / git công khai → gói đã kiểm định
  course/version.ts               # MỚI: ghim phiên bản + báo cáo thiệt hại
  pages/Library.tsx               # MỚI: thư viện cá nhân (thay KNOWN_COURSE_IDS)
  pages/ImportCourse.tsx          # MỚI
  pages/Dashboard.tsx             # SỬA: bỏ KNOWN_COURSE_IDS (nợ C-2 của P1)

apps/web/e2e/s1.spec.ts           # MỚI: cổng nghiệm thu
courses/                          # giáo trình riêng tư CHUYỂN RA (Task 11)
```

---

### Task 1: `packages/course-format` — định dạng v2 + bộ luật kiểm định

**Files:**
- Create: `packages/course-format/{package.json,tsconfig.json}`, `src/types.ts`, `src/validate.ts`, `src/index.ts`, `src/validate.test.ts`, `src/types.test.ts`

**Interfaces — Produces:**
```ts
export interface Chapter { id: string; num: string; title: string; short: string; file: string }
export interface Part { title: string; chapters: Chapter[] }
export interface Manifest {
  id: string; title: string; description: string;
  lang: string;                         // nhãn hiển thị trong catalog, KHÔNG dịch gì
  version: string;                      // semver
  runtime: string;                      // dải caret, vd "^1"
  tier: 'content' | 'interactive';      // MỚI, bắt buộc — §1.2
  license: string;                      // MỚI, bắt buộc với course lên registry
  authors: { name: string; url?: string }[];   // MỚI
  generatedBy: 'ai' | 'human' | 'mixed';       // MỚI — "user biết nên expect gì"
  translationOf?: string;               // MỚI — bản dịch là course RIÊNG (§9.5)
  registryId?: string;                  // chỉ có khi đã ở registry
  parts: Part[];
}

export interface Finding { readonly code: string; readonly path: string; readonly detail: string }
export interface ValidationResult { readonly ok: boolean; readonly findings: readonly Finding[] }

/** Bộ luật DUY NHẤT. `files` là toàn bộ nội dung gói, khoá là đường dẫn tương đối. */
export function validatePackage(files: ReadonlyMap<string, Uint8Array>): ValidationResult;
export function parseManifest(raw: string): { manifest: Manifest } | { error: Finding };
export const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024;
```

**Luật, chia hai nhóm** (mỗi luật một `code` để test bám vào được):

*Nhóm chung — mọi hạng:*
`MANIFEST_MISSING` · `MANIFEST_PARSE` · `MANIFEST_FIELD` (thiếu/sai kiểu trường bắt buộc) · `SEMVER` · `RUNTIME_RANGE` · `CHAPTER_FILE_MISSING` (một `file` trỏ tới thứ không có trong gói) · `PATH_ESCAPE` (`../`, đường dẫn tuyệt đối, hoặc chứa `\`) · `TOO_LARGE` (> `MAX_UNCOMPRESSED_BYTES`) · `DUPLICATE_CHAPTER_ID` · `EMPTY_PACKAGE`

*Nhóm chỉ áp cho `tier: 'content'`:*
`SCRIPT_TAG` · `EVENT_HANDLER_ATTR` (`on*=`) · `JAVASCRIPT_URL` (`href="javascript:"`) · `EMBEDDED_FRAME` (`<iframe>`/`<object>`/`<embed>`) · `FORM_TAG` · `JS_FILE_IN_PACKAGE` (bất kỳ `*.js` nào)

- [ ] **Step 1: Dựng gói và viết test FAIL trước**

`packages/course-format/package.json`: `{"name":"@tuhoc/course-format","type":"module","main":"src/index.ts","dependencies":{"fflate":"^0.8.2"}}`.
`tsconfig.json` kế thừa cấu hình gốc của repo (xem `packages/course-kit` làm mẫu nếu có, nếu không thì copy `apps/web/tsconfig.app.json` và bỏ phần JSX).

```ts
// src/validate.test.ts
import { describe, expect, it } from 'vitest';
import { validatePackage } from './validate';

const enc = (s: string) => new TextEncoder().encode(s);
const MANIFEST = (over: Record<string, unknown> = {}) => enc(JSON.stringify({
  id: 'demo', title: 'Demo', description: 'd', lang: 'vi', version: '1.0.0',
  runtime: '^1', tier: 'content', license: 'CC-BY-4.0',
  authors: [{ name: 'A' }], generatedBy: 'human',
  parts: [{ title: 'P', chapters: [{ id: 'c1', num: '1', title: 'T', short: 'T', file: 'chapters/c1.html' }] }],
  ...over,
}));

it('gói content hợp lệ thì ok', () => {
  const r = validatePackage(new Map([
    ['manifest.json', MANIFEST()],
    ['chapters/c1.html', enc('<p>Xin chào</p>')],
  ]));
  expect(r).toEqual({ ok: true, findings: [] });
});

it('hạng content KHÔNG được chứa <script>', () => {
  const r = validatePackage(new Map([
    ['manifest.json', MANIFEST()],
    ['chapters/c1.html', enc('<p>a</p><script>alert(1)</script>')],
  ]));
  expect(r.ok).toBe(false);
  expect(r.findings.map(f => f.code)).toContain('SCRIPT_TAG');
});

it('hạng interactive ĐƯỢC chứa JS — đây là điểm khác biệt của hai hạng', () => {
  const r = validatePackage(new Map([
    ['manifest.json', MANIFEST({ tier: 'interactive' })],
    ['chapters/c1.html', enc('<p>a</p>')],
    ['viz.js', enc('export function draw() {}')],
  ]));
  expect(r.ok).toBe(true);
});

it('đường dẫn thoát ra ngoài gói bị chặn', () => {
  const r = validatePackage(new Map([
    ['manifest.json', MANIFEST()],
    ['chapters/c1.html', enc('<p>a</p>')],
    ['../ngoai.txt', enc('x')],
  ]));
  expect(r.findings.map(f => f.code)).toContain('PATH_ESCAPE');
});

it('manifest trỏ tới chương không tồn tại', () => {
  const r = validatePackage(new Map([['manifest.json', MANIFEST()]]));
  expect(r.findings.map(f => f.code)).toContain('CHAPTER_FILE_MISSING');
});
```

- [ ] **Step 2: Chạy để chắc chắn nó FAIL**

Run: `cd packages/course-format && bunx vitest run src/validate.test.ts`
Expected: FAIL — `Failed to resolve import "./validate"`.

- [ ] **Step 3: Cài đặt tối thiểu cho test xanh**

Viết `src/types.ts` và `src/validate.ts` theo interface trên. Ba điều bắt buộc:
- **Trả về TẤT CẢ finding**, không dừng ở cái đầu tiên — người đóng góp cần thấy hết một lượt thay vì sửa từng cái.
- **Phép quét HTML phải là quét văn bản, không phải parse DOM** — gói này chạy cả trong Node (không có DOM). Dùng regex đủ chặt và **ghi rõ trong comment nó bắt được gì và bỏ sót gì**; đây là hàng rào đầu, không phải hàng rào duy nhất (hàng rào thật là duyệt tay ở registry).
- `MAX_UNCOMPRESSED_BYTES` tính trên **tổng byte đã giải nén**, không phải kích thước zip — zip bomb nén rất nhỏ.

- [ ] **Step 4: Chạy lại cho xanh, rồi thêm test cho MỌI code còn lại**

Mỗi `code` trong hai danh sách trên phải có ít nhất một test. Run: `bunx vitest run` → PASS.

- [ ] **Step 5: Tự kiểm bằng dữ liệu thật**

Chạy `validatePackage` trên **gói `courses/«giáo-trình-riêng»` hiện có** (đọc từ đĩa vào Map). Nó là hạng `interactive` (có `viz.js`) và **chưa có các trường v2** — nên sẽ báo `MANIFEST_FIELD`. Đó là kết quả **đúng**, và Task 11 sẽ bổ sung các trường đó. Ghi số finding thực tế vào báo cáo; nếu có finding nào bạn không giải thích được, **DỪNG và báo** — nó nghĩa là luật sai chứ không phải dữ liệu sai.

- [ ] **Step 6: Commit**

```bash
git add packages/course-format
git commit -m "feat(course-format): manifest v2 + bộ luật kiểm định dùng chung"
```

---

### Task 2: đọc/ghi gói `.zip` an toàn

**Files:**
- Create: `packages/course-format/src/zip.ts`, `src/zip.test.ts`
- Modify: `packages/course-format/src/index.ts` (re-export)

**Interfaces — Consumes:** `validatePackage` (Task 1). **Produces:**
```ts
/** Giải nén zip → Map đường dẫn → nội dung. NÉM nếu có mục thoát thư mục hoặc vượt trần. */
export function unpackZip(zip: Uint8Array): Map<string, Uint8Array>;
export function packZip(files: ReadonlyMap<string, Uint8Array>): Uint8Array;
export class UnsafeArchiveError extends Error { readonly entry: string }
```

- [ ] **Step 1: Test FAIL trước** — ba ca, ca thứ ba là ca quan trọng nhất:

```ts
it('vòng tròn: pack rồi unpack ra đúng nội dung cũ', () => {
  const files = new Map([['manifest.json', new TextEncoder().encode('{}')]]);
  expect([...unpackZip(packZip(files))]).toEqual([...files]);
});

it('mục có ../ bị NÉM, không phải bị bỏ qua im lặng', () => {
  const evil = packZip(new Map([['../thoat.txt', new Uint8Array([1])]]));
  expect(() => unpackZip(evil)).toThrow(UnsafeArchiveError);
});

it('zip bomb: nén nhỏ nhưng giải nén vượt trần → NÉM trước khi cấp phát hết bộ nhớ', () => {
  const bomb = packZip(new Map([['big.txt', new Uint8Array(21 * 1024 * 1024)]]));
  expect(bomb.byteLength).toBeLessThan(1024 * 1024);   // nén rất nhỏ
  expect(() => unpackZip(bomb)).toThrow(/TOO_LARGE|vượt trần/);
});
```

- [ ] **Step 2:** Run `bunx vitest run src/zip.test.ts` → FAIL.
- [ ] **Step 3:** Cài đặt bằng `fflate`. **Kiểm trần TRONG lúc giải nén, không phải sau** — giải nén xong rồi mới kiểm thì zip bomb đã chiếm hết bộ nhớ. `fflate` cho phép giải nén từng mục; cộng dồn và ném ngay khi vượt.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(course-format): đọc/ghi zip có chốt thoát thư mục và zip bomb`

---

### Task 3: CLI `tuhoc init` + `tuhoc pack`

**Files:**
- Create: `tools/tuhoc-cli/{package.json,src/index.ts,src/init.ts,src/pack.ts}`, `templates/course/**`, `src/pack.test.ts`

**Interfaces — Consumes:** `validatePackage`, `packZip` (Task 1–2).

`tuhoc init <thư-mục>` dựng khung course rỗng: `manifest.json` đủ trường v2 (`tier: "content"` mặc định — hạng an toàn), một chương mẫu, `README.md` trỏ tới `docs/course-format.md`.
`tuhoc pack <thư-mục> [-o out.zip]` đọc thư mục → `validatePackage` → nếu `ok` thì ghi zip, nếu không thì **in mọi finding rồi thoát mã 1**.

- [ ] **Step 1: Test FAIL trước**

```ts
it('pack một thư mục hợp lệ ra zip và thoát 0', async () => {
  const dir = await makeFixtureCourse();            // helper trong test
  const res = await runPack([dir, '-o', join(dir, 'out.zip')]);
  expect(res.code).toBe(0);
  expect(existsSync(join(dir, 'out.zip'))).toBe(true);
});

it('pack thư mục có <script> trong hạng content: thoát 1 và IN RA code luật', async () => {
  const dir = await makeFixtureCourse({ 'chapters/c1.html': '<script>x</script>' });
  const res = await runPack([dir]);
  expect(res.code).toBe(1);
  expect(res.stderr).toContain('SCRIPT_TAG');
  expect(res.stderr).toContain('chapters/c1.html');   // phải nói RÕ tệp nào
});

it('init rồi pack ngay phải thành công — khung mẫu tự nó hợp lệ', async () => {
  const dir = await tmpdir();
  expect((await runInit([dir])).code).toBe(0);
  expect((await runPack([dir])).code).toBe(0);
});
```

Test thứ ba là chốt chống một lỗi rất dễ xảy ra: khung mẫu **tự nó không hợp lệ**, khiến người đóng góp đầu tiên gặp lỗi ngay ở bước đầu.

- [ ] **Step 2:** Run → FAIL. **Step 3:** Cài đặt. **Step 4:** Run → PASS.
- [ ] **Step 5:** Thêm `tuhoc` vào `Makefile` (`make pack DIR=...`) và một dòng trong `README.md`.
- [ ] **Step 6: Commit** `feat(cli): tuhoc init + pack`

---

### Task 4: Skill soạn course cho agent + tài liệu định dạng

**Files:**
- Create: `.claude/skills/course-authoring/SKILL.md`, `docs/course-format.md`

**Không có test tự động** — đây là tài liệu. Nhưng có **cổng nghiệm thu thật** ở Step 3.

- [ ] **Step 1: Viết `docs/course-format.md`** — tài liệu cho người đóng góp: mọi trường manifest, hai hạng và vì sao có chúng, danh sách `code` luật kèm cách sửa từng cái, quy trình PR vào registry, và **giới hạn 20 MB**.

- [ ] **Step 2: Viết skill.** CLI đảm bảo course **hợp lệ**; skill đảm bảo course **hay** — một registry đầy course hợp lệ mà nhạt thì vẫn thất bại. Skill phải mã hoá:
  - cấu trúc chương và manifest;
  - **chuẩn sư phạm lấy chính giáo trình riêng của tác giả làm mẫu**: xây trực giác trước hình thức, mỗi khái niệm có một câu hỏi "vì sao ta cần thứ này", bài tập có lời giải, mô phỏng chỉ khi khái niệm **cần nhìn thấy mới hiểu** chứ không trang trí;
  - luật hai hạng và hệ quả: chọn `content` thì được merge gần như tự động, chọn `interactive` thì phải chờ duyệt tay;
  - `lang` và `generatedBy` phải trung thực — người pull về dựa vào đó;
  - **bắt buộc chạy `tuhoc pack` trước khi coi là xong.**

- [ ] **Step 3: Cổng nghiệm thu — dùng chính skill để sinh một course thật**

Dùng skill vừa viết để sinh một course **nhỏ nhưng thật** (3 chương, một chủ đề bạn tự chọn), rồi `tuhoc pack` nó. Nếu skill dẫn tới một gói **không** pack được, skill sai — sửa skill, không sửa gói. Giữ gói đó lại làm fixture cho Task 8 và Task 12.

- [ ] **Step 4: Commit** `docs: định dạng course + skill soạn course cho agent`

---

### Task 5: Migration 0002 + kho lưu gói phía Go

**Files:**
- Create: `apps/api/migrations/0002_course_packages.up.sql` / `.down.sql`, `apps/api/internal/course/{repo.go,course_test.go}`
- Modify: `apps/api/internal/server/server.go` (dựng repo, chưa đăng ký route)

**Interfaces — Produces:**
```go
type Package struct {
    CourseID  string; Version string; OwnerID uuid.UUID
    Tier      string; Lang string; Title string
    Manifest  json.RawMessage
    Blob      []byte            // gói .zip nguyên vẹn
    Bytes     int64             // kích thước ĐÃ GIẢI NÉN
    CreatedAt time.Time
}
type Repo interface {
    Put(ctx context.Context, p Package) error
    Get(ctx context.Context, ownerID uuid.UUID, courseID, version string) (Package, error)
    ListForOwner(ctx context.Context, ownerID uuid.UUID) ([]Package, error)
    ListVersions(ctx context.Context, ownerID uuid.UUID, courseID string) ([]string, error)
}
```

**Schema** — `courses` (đã có từ 0001, chỉ có `id`/`title`/`visibility`/`created_at`) **giữ nguyên**; thêm bảng mới:

```sql
CREATE TABLE course_packages (
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id  text NOT NULL,
  version    text NOT NULL,
  tier       text NOT NULL CHECK (tier IN ('content','interactive')),
  lang       text NOT NULL,
  title      text NOT NULL,
  manifest   jsonb NOT NULL,
  blob       bytea NOT NULL,
  bytes      bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, course_id, version));
CREATE INDEX idx_course_packages_owner ON course_packages (owner_id, course_id);
```

**Vì sao khoá chính gồm `owner_id`:** mỗi người có bản sao gói của riêng mình. Đắt hơn về dung lượng (0,4 MB/gói nén) nhưng **loại bỏ hoàn toàn một lớp lỗi**: không có đường nào để gói của người này bị người khác đọc, xoá, hay ghi đè. Với free tier và cỡ gói hiện tại, đánh đổi này là đúng. **Xem lại nếu có ngày một gói vượt ~10 MB.**

- [ ] **Step 1: Test FAIL trước** (testcontainers, theo mẫu `internal/sync/sync_test.go`):

```go
func TestPutThenGetRoundTrips(t *testing.T) { /* Put rồi Get ra đúng blob và manifest */ }

func TestOwnerCannotReadAnotherOwnersPackage(t *testing.T) {
    // A Put; B Get cùng courseID/version → phải trả lỗi không-tìm-thấy,
    // KHÔNG phải trả gói của A. Đây là lớp lỗi P1 từng mắc (rò rỉ chéo tài khoản).
}

func TestListVersionsSortsSemverNotLexically(t *testing.T) {
    // Put 1.0.0, 1.10.0, 1.9.0 → ListVersions trả 1.0.0, 1.9.0, 1.10.0
    // Sắp xếp theo chuỗi sẽ cho 1.0.0, 1.10.0, 1.9.0 — SAI, và sai âm thầm.
}
```

- [ ] **Step 2:** `cd apps/api && go test ./internal/course/... -run TestPut -v` → FAIL (package chưa tồn tại).
- [ ] **Step 3:** Viết migration + `repo.go`. Sắp xếp semver **trong Go**, không trong SQL (`ORDER BY version` là sắp theo chuỗi).
- [ ] **Step 4:** `go test ./internal/course/... -v` → PASS. Rồi `go test ./...` → toàn bộ 6 gói vẫn xanh.
- [ ] **Step 5: Commit** `feat(api): lưu gói course theo từng chủ sở hữu`

---

### Task 6: `GET /courses`, `POST /courses`, và phục vụ tài nguyên gói

**Files:**
- Create: `apps/api/internal/course/{usecase.go,handler.go}`, mở rộng `course_test.go`
- Modify: `apps/api/internal/server/server.go`, `apps/web/src/pages/Dashboard.tsx`

**Interfaces — Consumes:** `course.Repo` (Task 5). **Produces (HTTP):**
```
GET  /courses                          → [{ id, title, lang, tier, versions: string[], pinned: string }]
POST /courses                           multipart, field "package" = .zip → 201 { id, version }
GET  /courses/:id/@:version/manifest.json
GET  /courses/:id/@:version/*           → tài nguyên bên trong gói
```
Tất cả **sau `auth.Require(deps.Pool)`** — không endpoint nào trả dữ liệu của người khác.

**`GET /courses` đóng nợ C-2 của P1** (`docs/carried-forward.md`): spec §4 liệt kê endpoint này nhưng **không task nào của P1 được giao xây**, nên `Dashboard.tsx:27` phải hardcode `KNOWN_COURSE_IDS = ['«giáo-trình-riêng»']`. Task này xoá dòng đó.

- [ ] **Step 1: Test FAIL trước** — bốn ca, ca cuối là ca bảo vệ:

```go
func TestPostRejectsPackageOverLimit(t *testing.T)      // > 20 MB giải nén → 413
func TestPostRejectsPathEscape(t *testing.T)            // zip có ../ → 400, KHÔNG ghi gì
func TestGetAssetCannotEscapePackage(t *testing.T)      // GET /courses/x/@1.0.0/../../etc/passwd → 400
func TestListReturnsOnlyMyCourses(t *testing.T)         // A và B mỗi người 1 course → mỗi bên chỉ thấy của mình
```

- [ ] **Step 2:** `go test ./internal/course/... -v` → FAIL.
- [ ] **Step 3:** Cài đặt. **Ranh giới kiểm định (Global Constraints): Go chỉ kiểm 4 điều** — kích thước giải nén, manifest parse + đủ trường, không đường dẫn thoát, mọi `file` trong manifest có thật. **KHÔNG port phép quét HTML sang Go.** Thấy cần → DỪNG và báo.
- [ ] **Step 4:** `go test ./...` → PASS.
- [ ] **Step 5: Xoá `KNOWN_COURSE_IDS`.** Sửa `Dashboard.tsx` dùng `GET /courses`. Chạy `bun run test` — `Dashboard.test.tsx:15` có comment nhắc tới hằng số đó, cập nhật cho khớp. **Không được làm yếu khẳng định nào.**
- [ ] **Step 6: Commit** `feat(api): GET/POST /courses + phục vụ tài nguyên gói (đóng nợ C-2 của P1)`

---

### Task 7: Cache gói vào Dexie — đọc offline

**Files:**
- Modify: `apps/web/src/db/local.ts` (bảng thứ 5), `db/local.test.ts` (tripwire 4 → 5), `course/loader.ts`
- Create: `apps/web/src/api/courses.ts`

**Interfaces — Produces:**
```ts
// db/local.ts
export interface PackageRow { key: string /* `${courseId}@${version}` */; courseId: string; version: string;
                              manifest: unknown; files: Record<string, Uint8Array>; pinnedAt: string }
// api/courses.ts
export async function listCourses(): Promise<CourseSummary[]>;
export async function fetchPackage(courseId: string, version: string): Promise<Uint8Array>;
```

`loader.ts` **đọc local trước, ngã về server sau**: có gói trong Dexie thì dùng ngay (offline chạy được); không có thì tải từ server, lưu vào Dexie, rồi dùng.

**Ba cái bẫy, tất cả đã có tiền lệ trong repo:**
1. `db/local.test.ts` assert **đúng 4 bảng** như tripwire. Đổi thành 5 **một cách có ý thức**, và cập nhật comment giải thích bảng thứ 5 là gì. `carried-forward.md` cảnh báo: **sửa con số, đừng "sửa" helper.**
2. `clearLocalData()` liệt kê bảng qua `db.tables` nên bảng mới **tự động** được xoá khi đăng xuất. Đúng thứ ta muốn — course riêng tư là dữ liệu người dùng. **Viết một test khẳng định điều đó**, đừng dựa vào việc nó tình cờ đúng.
3. Course tĩnh trong `courses/` vẫn được phục vụ bởi `vite-plugins/courseAssets.ts`. `loader.ts` nay có **hai nguồn** — phải rõ nguồn nào thắng, và **có test cho cả hai đường**.

- [ ] **Step 1: Test FAIL trước**

```ts
it('mở chương khi ĐANG OFFLINE dùng gói đã cache, không gọi mạng', async () => {
  await db.packages.put(fixturePackageRow());
  const spy = vi.spyOn(globalThis, 'fetch');
  const m = await loadManifest('demo');
  expect(m.title).toBe('Demo');
  expect(spy).not.toHaveBeenCalled();
});

it('đăng xuất xoá luôn gói course đã cache', async () => {
  await db.packages.put(fixturePackageRow());
  await clearLocalData();
  expect(await db.packages.count()).toBe(0);
});

it('db.tables có đúng 5 bảng', () => {
  expect(db.tables.map(t => t.name).sort())
    .toEqual(['annotations', 'meta', 'outbox', 'packages', 'progress']);
});
```
*(Bốn bảng hiện có đã được xác minh ở bước pre-flight: `progress`, `annotations`, `outbox`, `meta` — ruling S1-F4.)*

- [ ] **Step 2:** `bun run test -- src/db/local.test.ts src/course/loader.test.ts` → FAIL.
- [ ] **Step 3:** Cài đặt. **Step 4:** Run → PASS, rồi chạy **cả bộ** — 523 test cũ phải giữ nguyên xanh.
- [ ] **Step 5: Commit** `feat(web): cache gói course vào Dexie để đọc offline`

---

### Task 8: Import từ tệp, URL, và repo Git công khai

**Files:**
- Create: `apps/web/src/course/import.ts` + test, `apps/web/src/pages/ImportCourse.tsx` + test
- Modify: `apps/web/src/routes.tsx`

**Interfaces — Consumes:** `unpackZip`, `validatePackage` (Task 1–2), `db.packages` (Task 7). **Produces:**
```ts
export type ImportSource =
  | { kind: 'file'; file: File }
  | { kind: 'zipUrl'; url: string }
  | { kind: 'gitUrl'; url: string };        // CHỈ repo công khai — xem dưới
export async function importCourse(src: ImportSource): Promise<
  { ok: true; courseId: string; version: string } | { ok: false; findings: readonly Finding[] }>;
```

**Repo Git CHỈ hỗ trợ repo CÔNG KHAI, và đây là quyết định có chủ ý** (spec §2.3): repo riêng tư đòi token truy cập, tức nền tảng lại phải giữ một bí mật lâu dài của người dùng — **đúng thứ §1.4 vừa loại bỏ, chỉ đổi tên**. Người muốn dùng course từ repo riêng tư thì tải `.zip` về rồi import tệp: cùng kết quả, không ai phải giữ bí mật của ai. **Nói điều này ra trong giao diện**, đừng để người dùng tự đoán vì sao repo riêng tư không dán được.

- [ ] **Step 1: Test FAIL trước**

```ts
it('import gói hợp lệ từ tệp → vào thư viện, đọc được ngay', async () => { /* … */ });

it('import gói KHÔNG hợp lệ → KHÔNG ghi gì vào Dexie và trả về mọi finding', async () => {
  const before = await db.packages.count();
  const r = await importCourse({ kind: 'file', file: fileWithScriptTag() });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.findings.map(f => f.code)).toContain('SCRIPT_TAG');
  expect(await db.packages.count()).toBe(before);      // không ghi một phần
});

it('URL git riêng tư → thông báo GIẢI THÍCH ĐƯỢC, không phải lỗi 404 trần trụi', async () => {
  const r = await importCourse({ kind: 'gitUrl', url: 'https://github.com/ai-do/repo-rieng-tu' });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.findings[0].detail).toMatch(/công khai|tải \.zip/i);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Cài đặt (git URL → tải tarball/zip công khai của GitHub, không cần token). **Step 4:** Run → PASS.
- [ ] **Step 5: Nhìn tận mắt trên trình duyệt thật.** Sáu vòng liên tiếp ở P2, việc này bắt được lỗi mà bộ test không thấy. Import gói fixture từ Task 4, kiểm: thông báo lỗi đọc hiểu được (không phải mã lỗi), trạng thái chờ khi tải gói lớn, và **màn hẹp**.
- [ ] **Step 6: Commit** `feat(web): import course từ tệp, URL, hoặc repo git công khai`

---

### Task 9: Thư viện cá nhân + đánh dấu riêng tư

**Files:**
- Create: `apps/web/src/pages/Library.tsx` + test
- Modify: `apps/web/src/routes.tsx`, `pages/Dashboard.tsx`, `shell/` (điều hướng)

Thư viện liệt kê mọi course người dùng có: tên, ngôn ngữ (`lang`), hạng (`content`/`interactive`), nguồn (registry / import / riêng tư), phiên bản đang ghim. **Nhãn hạng `interactive` phải hiện rõ** — người pull về cần biết course này chạy mã (§1.2).

- [ ] **Step 1: Test FAIL trước** — ba khẳng định: liệt kê đủ course từ `GET /courses` + Dexie; **nhãn `interactive` hiển thị**; course riêng tư có dấu hiệu riêng và **không có nút chia sẻ nào**.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Cài đặt. **Step 4:** Run → PASS.
- [ ] **Step 5:** Nhìn trên trình duyệt thật, cả rộng lẫn hẹp.
- [ ] **Step 6: Commit** `feat(web): thư viện cá nhân`

---

### Task 10: Ghim phiên bản + báo cáo thiệt hại trước khi cập nhật

**Files:**
- Create: `apps/web/src/course/version.ts` + test, `apps/web/src/course/UpdateDialog.tsx` + test
- Modify: `pages/Library.tsx`

**Interfaces — Consumes:** `anchorToRange` từ `apps/web/src/annotations/anchor.ts`, `normalizeContainer` từ `annotations/normalize.ts` (cả hai do P2 xây). **Produces:**
```ts
export interface UpdateImpact {
  readonly total: number;
  readonly exact: number;      // neo lại được, khớp chính xác
  readonly fuzzy: number;      // neo lại được nhưng đã dịch (khớp mờ)
  readonly orphaned: readonly { id: string; chapterId: string; exact: string }[];
}
/** CHẠY THỬ. KHÔNG ghi gì, KHÔNG đổi phiên bản đang ghim. */
export async function previewUpdate(courseId: string, fromVersion: string, toVersion: string): Promise<UpdateImpact>;
export async function applyUpdate(courseId: string, toVersion: string): Promise<void>;
```

**Đây là chỗ máy móc khớp-mờ của P2 trả lãi.** Nó được xây để chịu nội dung thay đổi; ở đây nó biến *"nội dung đổi dưới chân bạn"* thành **một quyết định có thông tin**:

> *v1.0 → v1.1 · 37/40 ghi chú giữ đúng chỗ · 2 dịch nhẹ · **1 mất neo** (chương 3.4) · Cập nhật / Ở lại v1.0*

**Ba ràng buộc cứng:**
1. `previewUpdate` **tuyệt đối không ghi gì** — không Dexie, không outbox, không đổi phiên bản ghim. Người dùng phải xem được hậu quả **trước** khi cam kết.
2. Ghi chú mất neo sau khi cập nhật **không bị xoá** — chúng vào panel mồ côi (P2 Task 7) để nối tay.
3. **`NormMap` là ảnh chụp** (ruling P2-F8): dựng map trên nội dung MỚI, và **không dùng lại map của nội dung cũ**. Dùng `isMapStale` để kiểm chủ động. Đây là lớp lỗi đã cắn **hai lần** ở P2.

- [ ] **Step 1: Test FAIL trước**

```ts
it('chạy thử KHÔNG ghi gì: Dexie và outbox y nguyên', async () => {
  const before = await snapshotDb();
  await previewUpdate('demo', '1.0.0', '1.1.0');
  expect(await snapshotDb()).toEqual(before);
});

it('đếm đúng ba nhóm: nguyên vẹn / dịch nhẹ / mất neo', async () => {
  // v1.1 sửa chính tả một đoạn (→ fuzzy) và xoá hẳn một đoạn khác (→ orphan)
  const impact = await previewUpdate('demo', '1.0.0', '1.1.0');
  expect(impact).toMatchObject({ total: 3, exact: 1, fuzzy: 1 });
  expect(impact.orphaned).toHaveLength(1);
});

it('sau khi áp dụng, ghi chú mất neo VẪN CÒN, chỉ là mồ côi', async () => {
  await applyUpdate('demo', '1.1.0');
  const rows = await db.annotations.toArray();
  expect(rows).toHaveLength(3);
  expect(rows.every(r => r.deletedAt === null)).toBe(true);
});
```

- [ ] **Step 2:** Run → FAIL. **Step 3:** Cài đặt. **Step 4:** Run → PASS.
- [ ] **Step 5: Chạy trên chương THẬT.** Lấy một chương thật, sửa vài đoạn để tạo cả ba nhóm, rồi kiểm số đếm khớp thực tế. Fixture thủ công **không** chứng minh được điều này — ở P2, việc chạy dữ liệu thật đã bác bỏ **năm** phép đo sai, ba trong số đó của coordinator.
- [ ] **Step 6: Commit** `feat(web): ghim phiên bản + báo cáo thiệt hại trước khi cập nhật`

---

### Task 11: Bóc giáo trình riêng tư ra khỏi repo

**Files:**
- Delete: `courses/«giáo-trình-riêng»/**` (47 tệp, 1,3 MB)
- Modify: `apps/web/vite-plugins/courseAssets.ts`, `tools/extract.py`, `docs/deploy.md`
- Create: `docs/publishing.md`

**Đây là việc phải làm NGAY, và xoá sau KHÔNG cứu được** (spec §2B.1). Giáo trình riêng tư đang nằm trong chính repo sẽ được publish. Git giữ toàn bộ lịch sử — xoá ở commit sau thì ai clone cũng khôi phục được bằng một lệnh.

**Được lợi kép:** giáo trình trở thành **course import đầu tiên** của chính tác giả ⇒ đường import được **dùng thật** thay vì được ưu ái bằng một đường đặc biệt. Nếu đường import có lỗi, ta phát hiện ngay trên dữ liệu ta quan tâm nhất, không phải sáu tháng sau từ một người lạ.

- [ ] **Step 1: Nâng manifest lên v2 TRƯỚC KHI bóc ra.** Thêm `tier: "interactive"` (nó có `viz.js`), `license`, `authors`, `generatedBy`. Chạy `tuhoc pack courses/«giáo-trình-riêng»` → phải thoát 0. **Nếu không pack được, DỪNG** — nghĩa là bộ luật Task 1 sai với dữ liệu thật, và đó là phát hiện quan trọng hơn task này.

- [ ] **Step 2: Cất gói ra ngoài repo.** Chép `.zip` vừa pack sang một nơi **ngoài cây git** (ví dụ `../tuhoc-courses/`). **Xác nhận tệp tồn tại và mở được trước khi sang bước 3** — bước 3 là bước xoá.

- [ ] **Step 3: Xoá khỏi cây làm việc và cập nhật mọi chỗ tham chiếu.**
```bash
git rm -r courses/«giáo-trình-riêng»
```
Rồi: `courseAssets.ts` phải chạy được với `courses/` **rỗng** (đừng để nó ném khi không có course nào — lần chạy đầu của người clone repo là đúng trạng thái này); `tools/extract.py` giữ nguyên, nó là công cụ chuyển đổi một lần, chỉ cập nhật tài liệu để nói rõ đầu ra nay đi qua `tuhoc pack`.

- [ ] **Step 4: Chạy bộ test.** **Danh sách đầy đủ, đã đếm ở pre-flight (ruling S1-F5) — 11 tệp:** 7 test đơn vị (`painter.test.ts`, `anchor.test.ts`, `normalize.test.ts`, `SelectionToolbar.test.tsx`, `Dashboard.test.tsx`, `useLogout.test.tsx`, `session.test.ts`) + 4 tệp e2e (`helpers.ts`, `p1.spec.ts`, `p2.spec.ts`, `viz.spec.ts`). Chúng sẽ đỏ. Mọi chỗ nhắc tới course trong code sản phẩm chỉ là comment trỏ về bản v1 — không có phụ thuộc lúc chạy.
  **Đây là quyết định thiết kế, không phải việc dọn dẹp:** những test đó có giá trị **chính vì chạy trên dữ liệu thật** — chúng đã bắt được lỗi mà fixture thủ công bỏ qua ở cả bốn vòng review của P2. **KHÔNG được đổi chúng sang fixture giả.**
  Thay vào đó: đưa **một chương thật duy nhất** vào `apps/web/src/test/fixtures/` như **fixture kiểm thử**, có ghi rõ trong tài liệu rằng nó ở đó để làm gì và nó **không phải** một course. Nếu bạn thấy cách tốt hơn giữ được tính "dữ liệu thật", làm và giải thích. **Nếu cách duy nhất bạn thấy là làm yếu các test đó → DỪNG và báo.**

- [ ] **Step 5: Viết `docs/publishing.md`** — quy trình viết lại lịch sử khi publish, gồm: lệnh bóc `courses/` khỏi mọi commit; cảnh báo **mọi mã commit sẽ đổi**; và **danh sách những nơi đang trích mã commit cần sửa theo** (lập danh sách **trước** khi viết lại, không phải sau).

- [ ] **Step 6: Import lại giáo trình qua đúng giao diện người dùng.** Mở app, dùng màn hình import (Task 8), chọn tệp `.zip` đã cất ở Step 2. Kiểm: nó hiện trong thư viện với nhãn `interactive`, mở chương đọc được, **59 mô phỏng chạy**, và ghi chú P2 vẫn hoạt động. **Đây là cổng nghiệm thu thật của cả hệ thống con.**

- [ ] **Step 7: Commit**
```bash
git add -A
git commit -m "chore: bóc giáo trình riêng tư khỏi repo — nó là course import đầu tiên"
```

---

### Task 12: Cổng nghiệm thu đầu-cuối

**Files:** Create `apps/web/e2e/s1.spec.ts`

- [ ] **Step 1: Bốn kịch bản**
  1. **Import → đọc:** import gói fixture → hiện trong thư viện → mở chương → nội dung render đúng.
  2. **Từ chối gói xấu:** import gói hạng `content` có `<script>` → bị từ chối, **thông báo nêu rõ tệp nào**, và **thư viện không đổi**.
  3. **Riêng tư là riêng tư:** tài khoản A import một course; tài khoản B đăng nhập → `GET /courses` của B **không chứa** course đó. *(Cùng lớp lỗi P1 từng mắc; đáng có chốt ở tầng cao nhất.)*
  4. **Cập nhật có báo cáo thiệt hại:** tạo ghi chú ở v1.0 → import v1.1 đã sửa nội dung → hộp thoại hiện số **đúng** cho ba nhóm → chọn "Ở lại v1.0" thì **không gì đổi**; chọn "Cập nhật" thì ghi chú mất neo **vẫn còn** trong panel mồ côi.

- [ ] **Step 2: Chạy trọn cổng** — `rtk proxy make test-e2e` (KHÔNG chạy `make test-e2e` trần: `rtk` bọc nó và **trả mã thoát của chính nó**, cổng sẽ báo xanh mà chưa chạy). `p1.spec.ts` và `p2.spec.ts` **phải vẫn xanh**. Luôn `--build`.
- [ ] **Step 3: Commit** `test(e2e): cổng nghiệm thu hệ thống con 1`

---

## Self-Review

**Spec coverage** — đối chiếu từng mục:

| Spec | Task |
|---|---|
| §2.1 định dạng v2 (`tier`, `license`, `authors`, `generatedBy`, `translationOf`) | 1 |
| §2.2 một bộ luật, ba nơi chạy | 1 (luật) · 3 (CLI) · 6 (ranh giới Go) · 8 (trình duyệt) |
| §2.3 import: tệp / URL zip / git công khai | 8 |
| §2.4 course riêng tư, cờ `visibility` | 5 (khoá chính có `owner_id`) · 9 (nhãn) · 12 (chốt e2e) |
| §2.5 CLI + skill soạn course | 3 · 4 |
| §2.6 ghim phiên bản + báo cáo thiệt hại | 10 |
| §2.7 lưu ở Postgres | 5 |
| §2B.1 bóc course riêng tư khỏi git | 11 |
| §9.5 đặt tên registry, bản dịch, 20 MB, `tuhoc init`, không đóng gói sẵn course | 1 · 3 · 11 |
| Nợ C-2 của P1 (`GET /courses`) | 6 |

**Chưa phủ, có chủ ý:** registry công khai, song ngữ giao diện, rating/Discussions → **hệ thống con 3 và 4**. Bố cục `<gh-user>/<course-id>` được định nghĩa ở Task 1 nhưng chỉ được *dùng* ở hệ 3.

**Placeholder scan:** không có "TBD"/"tương tự Task N"/"thêm xử lý lỗi phù hợp". Mọi test đều có mã thật hoặc ba khẳng định cụ thể.

**Type consistency:** `Manifest` định nghĩa ở Task 1 và **re-export** qua `apps/web/src/course/types.ts` (Task 7) — một định nghĩa, không hai bản. `validatePackage`/`unpackZip`/`packZip` dùng nhất quán ở Task 1, 2, 3, 6, 8. `Finding` trả về ở cả Task 1 và Task 8. `previewUpdate`/`applyUpdate` chỉ Task 10 định nghĩa và dùng.

**Rủi ro lớn nhất của kế hoạch này** — nói ra để người thực thi cảnh giác: Task 11 xoá dữ liệu mà **bốn bộ test đang dựa vào làm fixture thật**. Cám dỗ sẽ là đổi chúng sang fixture giả cho nhanh. Làm vậy là **vứt bỏ đúng thứ đã bắt được lỗi ở cả bốn vòng review của P2**. Step 4 của Task 11 tồn tại để chặn điều đó.

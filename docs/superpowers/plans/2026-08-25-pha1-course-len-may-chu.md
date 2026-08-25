# Pha 1 — Course lên máy chủ: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server thành nguồn course duy nhất — publish qua CLI/CMS có tái kiểm, đọc công khai không cần đăng nhập, JS chỉ chạy trong iframe sandbox, luồng import của người đọc chết, câu chữ ngoại tuyến rời trang đăng nhập.

**Architecture:** Format v2 khai tử hạng `interactive` (mọi chương là `content`, phần tương tác là widget một-tệp chạy trong `<iframe srcdoc sandbox="allow-scripts">`). Bộ luật sống ở HAI implementation — TS (`packages/course-format`, chạy lúc `pack`) và Go (`internal/pkgcheck`, chạy lúc publish) — giữ trung thực với nhau bằng một kho fixture chung (`fixtures/format-v2/`) mà cả hai phía bắt buộc chạy qua. Catalog nằm trong Postgres, phiên bản cũ giữ nguyên zip để rollback. Web đổi nguồn dữ liệu tại đúng một seam: `course/loader.ts`.

**Tech Stack:** Go/Fiber + pgx + `golang.org/x/net/html` (tokenizer), TypeScript/Bun + parse5 (đã có), React + TanStack Query (đã có), Playwright e2e (đã có).

**Spec:** `docs/superpowers/specs/2026-08-25-server-side-pivot.md` (đọc §2, §6, §7, §8, §9-Pha-1 trước khi làm bất kỳ task nào).

## Global Constraints

- **Mỗi cổng kiểm cũ bị gỡ phải gỡ trong một commit nói lý do** (spec §0.3, §8) — không xoá gộp "cho hết đỏ".
- **Server tái kiểm toàn bộ lúc publish** — không tin CLI (spec §2.2).
- **Câu chữ ngoại tuyến rời trang đăng nhập trong pha này** (spec §0.2) — Task 14, không được đẩy sang pha sau.
- **Widget là MỘT tệp** `widgets/<name>/index.html` tự chứa (CSS/JS inline). Iframe sandbox CHỈ có `allow-scripts` — không bao giờ `allow-same-origin`.
- Progress/ghi chú/sync/vault **không đụng trong pha này** — chúng là Pha 2/3. Dexie chỉ mất phần course store.
- Tiếng Việt cho copy người dùng, message lỗi CLI, và commit message — theo convention repo.
- Lệnh chạy test: `make test-format` (course-format), `make test-cli` (tuhoc-cli), `make test-api` (Go), `make test-web` (web), `make test-e2e` (e2e). Test Go đơn lẻ: `cd apps/api && go test ./internal/<pkg>/ -run <Name> -v`.

## Hằng số format v2 (một chỗ, mọi task trích từ đây)

| Hằng | Giá trị | Mã lỗi |
|---|---|---|
| Trần widget | 131072 byte (128 KiB) cho `widgets/<name>/index.html` | `WIDGET_TOO_LARGE` |
| Trần độ dài dòng trong widget | 500 byte | `WIDGET_LINE_TOO_LONG` |
| Tên widget | `^[a-z0-9][a-z0-9-]*$`, tối đa 64 ký tự | `WIDGET_BAD_NAME` |
| Chuỗi cấm trong widget | `document.cookie`, `localStorage`, `sessionStorage`, `indexedDB` | `WIDGET_FORBIDDEN_API` |
| URL ngoài trong widget | chuỗi con `http://` hoặc `https://` | `WIDGET_EXTERNAL_URL` |
| Tệp thừa trong thư mục widget | bất kỳ tệp nào ngoài `index.html` | `WIDGET_EXTRA_FILE` |
| Chương tham chiếu widget không tồn tại | `data-widget="x"` mà không có `widgets/x/index.html` | `WIDGET_MISSING` |
| Widget không ai tham chiếu | có thư mục, không chương nào trỏ tới | `WIDGET_ORPHAN` |
| Manifest còn trường `tier` | format v2 đã bỏ hạng | `TIER_REMOVED` |
| Tệp `.js`/`.mjs`/`.cjs` ngoài `widgets/` | viz.js kiểu cũ không còn đường chạy | `JS_OUTSIDE_WIDGETS` |
| Bảy luật content hiện có | chạy trên MỌI tệp của MỌI gói, trừ `widgets/*/index.html` và `manifest.json` | mã hiện có |

Placeholder trong chương: `<div data-widget="ten-widget"></div>` — thẻ `div`, thuộc tính `data-widget`, thân rỗng. Luật content vẫn quét chương bình thường (một `div` với `data-widget` không phạm luật nào).

---

### Task 1: course-format v2 — `tier` chết, luật content chạy trên mọi gói

**Files:**
- Modify: `packages/course-format/src/types.ts` (bỏ `tier` khỏi `Manifest`)
- Modify: `packages/course-format/src/validate.ts` (thêm `TIER_REMOVED`, `JS_OUTSIDE_WIDGETS`; bỏ điều kiện "chỉ quét khi tier content"; bỏ qua `widgets/*/index.html` khi chạy luật content)
- Modify: `packages/course-format/src/types.test.ts`, `packages/course-format/src/validate.test.ts`

**Interfaces:**
- Consumes: `FINDING_CODES`, `CONTENT_TIER_RULES`, tokenizer hiện có trong `validate.ts`.
- Produces: `FINDING_CODES` mở rộng thêm `'TIER_REMOVED'`, `'JS_OUTSIDE_WIDGETS'` (Task 2 thêm tiếp 8 mã widget). Hàm validate giữ nguyên tên/chữ ký hiện có — chỉ đổi hành vi. `Manifest` không còn field `tier`.

- [ ] **Step 1: Viết test đỏ cho ba hành vi mới**

Trong `validate.test.ts` (dùng đúng helper dựng gói mà file test này đang dùng — đọc các test `SCRIPT_TAG` hiện có để lấy mẫu):

```ts
describe('format v2 — tier đã chết', () => {
  it('manifest còn "tier" → TIER_REMOVED', () => {
    // gói hợp lệ tối thiểu nhưng manifest có "tier": "content"
    // expect findings chứa code 'TIER_REMOVED' trỏ path 'manifest.json'
  });
  it('gói KHÔNG có tier: luật content vẫn chạy — <script> trong chương bị bắt', () => {
    // manifest v2 (không tier), chương chứa '<script>alert(1)</script>'
    // expect findings chứa 'SCRIPT_TAG'
  });
  it('tệp viz.js ở gốc gói → JS_OUTSIDE_WIDGETS', () => {
    // gói v2 kèm tệp 'viz.js' nội dung 'defineViz()'
    // expect findings chứa 'JS_OUTSIDE_WIDGETS' trỏ path 'viz.js'
  });
  it('widgets/x/index.html KHÔNG bị luật content quét — <script> trong đó không phải SCRIPT_TAG', () => {
    // gói v2 có widgets/demo/index.html chứa '<script>1</script>'
    // và một chương có '<div data-widget="demo"></div>'
    // expect findings KHÔNG chứa 'SCRIPT_TAG'
    // (WIDGET_* của Task 2 chưa tồn tại — dùng expect.not vào SCRIPT_TAG thôi)
  });
});
```

Viết body thật cho cả bốn — nội dung gói dựng bằng helper sẵn có của file, không bịa helper mới.

- [ ] **Step 2: Chạy để thấy đỏ**

Run: `make test-format`
Expected: 4 test mới FAIL (TIER_REMOVED/JS_OUTSIDE_WIDGETS chưa tồn tại; SCRIPT_TAG đang bị tier-gate nên không nổ với manifest không tier).

- [ ] **Step 3: Sửa types.ts + validate.ts**

`types.ts`: xoá `tier` khỏi interface `Manifest` và khỏi mọi type guard đi kèm. `validate.ts`:

```ts
// thêm vào FINDING_CODES:
'TIER_REMOVED',
'JS_OUTSIDE_WIDGETS',
```

- Luật manifest: nếu object manifest có own-property `tier` → finding `TIER_REMOVED` với detail: `'format v2 đã bỏ hạng: xoá trường "tier" khỏi manifest; phần tương tác nay là widget (docs/course-format.md §4)'`.
- Bỏ nhánh điều kiện `tier === 'content'` quanh chỗ chạy `CONTENT_TIER_RULES` — luật chạy vô điều kiện, đổi tên biến/comment cho khỏi nói dối (`CONTENT_TIER_RULES` → giữ tên cũng được nhưng sửa comment: "content là hạng duy nhất").
- Trước khi quét từng tệp: nếu path khớp `/^widgets\/[^/]+\/index\.html$/` → bỏ qua luật content (Task 2 sẽ quét riêng).
- Luật mới: path kết thúc `.js`/`.mjs`/`.cjs` và KHÔNG nằm dưới `widgets/` → `JS_OUTSIDE_WIDGETS`, detail: `'JavaScript rời không còn đường chạy nào: viz.js kiểu cũ đã bị thay bằng widget (docs/course-format.md §4). Chuyển mã vào widgets/<tên>/index.html.'`.

- [ ] **Step 4: Chạy xanh toàn bộ**

Run: `make test-format`
Expected: PASS hết. Nếu test cũ nào đỏ vì nó dựng manifest có `tier` → sửa fixture của test đó sang v2 (đây là đổi format có chủ ý, ghi trong commit).

- [ ] **Step 5: Commit**

```bash
git add packages/course-format
git commit -m "Format v2: hạng tier chết, luật content quét mọi gói

Chương nay luôn là content (máy kiểm được hết); JS rời ngoài widgets/
bị chặn bằng JS_OUTSIDE_WIDGETS. Spec: 2026-08-25-server-side-pivot §2.3."
```

---

### Task 2: course-format v2 — luật widget (TS)

**Files:**
- Create: `packages/course-format/src/widgets.ts`
- Create: `packages/course-format/src/widgets.test.ts`
- Modify: `packages/course-format/src/validate.ts` (gọi widget rules), `packages/course-format/src/index.ts` (export)

**Interfaces:**
- Produces (Task 3, 6, 7, 10 dựa vào):

```ts
// widgets.ts
export const WIDGET_MAX_BYTES = 131072;
export const WIDGET_MAX_LINE_BYTES = 500;
export const WIDGET_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const WIDGET_NAME_MAX = 64;
export const WIDGET_FORBIDDEN_APIS = ['document.cookie', 'localStorage', 'sessionStorage', 'indexedDB'] as const;
/** Mọi giá trị data-widget trong một mảnh HTML chương, theo thứ tự gặp, không khử trùng lặp. Dùng tokenizer, không regex. */
export function extractWidgetRefs(chapterHtml: string): string[];
/** Chạy đủ 8 luật widget trên toàn gói. `files` là map path→bytes như validate.ts đang dùng. */
export function checkWidgets(files: ReadonlyMap<string, Uint8Array>, chapterFiles: readonly string[]): Finding[];
```

8 mã mới vào `FINDING_CODES`: `WIDGET_TOO_LARGE`, `WIDGET_LINE_TOO_LONG`, `WIDGET_BAD_NAME`, `WIDGET_FORBIDDEN_API`, `WIDGET_EXTERNAL_URL`, `WIDGET_EXTRA_FILE`, `WIDGET_MISSING`, `WIDGET_ORPHAN`. Giá trị hằng lấy từ bảng ở đầu plan.

- [ ] **Step 1: Viết test đỏ** — một test cho MỖI mã (8 cái), cộng: `extractWidgetRefs` đọc được `data-widget` viết hoa lẫn lộn thuộc tính (`DATA-WIDGET`), và một gói có widget hợp lệ + chương trỏ đúng → 0 finding. Widget hợp lệ mẫu dùng xuyên suốt:

```html
<style>button{font-size:2rem}</style>
<button id="b">0</button>
<script>
  let n = 0;
  document.getElementById('b').addEventListener('click', () => {
    n += 1;
    document.getElementById('b').textContent = String(n);
  });
</script>
```

- [ ] **Step 2: Chạy đỏ** — `make test-format`, 10 test mới FAIL.

- [ ] **Step 3: Implement `widgets.ts`**

Điểm cần đúng, không tuỳ nghi:
- Duyệt `files`: mọi path khớp `widgets/...` phân rã thành `widgets/<name>/<rest>`. `<rest> !== 'index.html'` → `WIDGET_EXTRA_FILE` (kể cả thư mục con). Tên không khớp `WIDGET_NAME_RE` hoặc dài quá `WIDGET_NAME_MAX` → `WIDGET_BAD_NAME`.
- `index.html` theo từng widget: size > `WIDGET_MAX_BYTES` → `WIDGET_TOO_LARGE`; decode UTF-8 rồi tách dòng theo `\n`, dòng nào > `WIDGET_MAX_LINE_BYTES` byte → `WIDGET_LINE_TOO_LONG` (detail nêu số dòng); chứa chuỗi con nào trong `WIDGET_FORBIDDEN_APIS` → `WIDGET_FORBIDDEN_API` (detail nêu chuỗi); chứa `http://` hoặc `https://` → `WIDGET_EXTERNAL_URL` với detail: `'widget phải tự chứa: không tải gì từ mạng, kể cả trong chú thích — bỏ URL đi'`.
- `extractWidgetRefs`: dùng cùng tokenizer parse5 mà `validate.ts` dùng (tái dùng hàm/tiện ích sẵn có, không chép); lấy giá trị thuộc tính `data-widget` trên mọi start tag.
- Đối chiếu: refs của mọi chương ∪ so với tập widget có thật → `WIDGET_MISSING` (path = chương chứa ref, detail nêu tên) / `WIDGET_ORPHAN` (path = `widgets/<name>/index.html`).
- `validate.ts` gọi `checkWidgets` sau các luật hiện có; `chapterFiles` là danh sách `file` từ manifest.

- [ ] **Step 4: Chạy xanh** — `make test-format`.

- [ ] **Step 5: Commit** — `git commit -m "Format v2: tám luật widget — một tệp, tự chứa, đọc được bằng mắt"`

---

### Task 3: Kho fixture chung `fixtures/format-v2/` + contract test TS

**Files:**
- Create: `fixtures/format-v2/valid-course/` (gói v2 hợp lệ đầy đủ: `manifest.json` — slug `mau-hop-le`, 1 part, 2 chương HTML đúng chuẩn `docs/course-format.md` §3, chương 2 chứa `<div data-widget="dem-so"></div>`, `widgets/dem-so/index.html` là widget mẫu ở Task 2)
- Create: `fixtures/format-v2/hostile/<case>/` — MỖI case một thư mục gói tối thiểu + `expect.json` dạng `{"codes": ["SCRIPT_TAG"]}`. 11 case bắt buộc: `script-tag`, `event-handler-attr`, `javascript-url`, `embedded-frame`, `tier-field`, `loose-js`, `widget-external-url`, `widget-forbidden-api`, `widget-extra-file`, `widget-missing`, `widget-orphan`. (`expect.json` nằm NGOÀI nội dung gói — contract test đọc nó rồi zip phần còn lại.)
- Create: `packages/course-format/src/contract.test.ts`

**Interfaces:**
- Produces: cấu trúc thư mục fixture là HỢP ĐỒNG cho Task 6–7 (Go đọc cùng thư mục). Quy ước: mỗi case-dir zip toàn bộ trừ `expect.json`; validator phải trả findings sao cho `expected.codes ⊆ codes(findings)`; case `valid-course` phải trả 0 finding.

- [ ] **Step 1: Dựng fixture** — viết từng tệp. Chương của `valid-course` viết thật theo chuẩn §3 course-format.md (mảnh HTML, `<h2 id=…>`, hộp `box-h`, không doctype). Case hostile giữ tối thiểu: manifest v2 hợp lệ + đúng MỘT tệp mang vi phạm.
- [ ] **Step 2: Viết contract test đỏ** — `contract.test.ts`: glob `fixtures/format-v2/hostile/*/`, với mỗi case dùng `zip.ts` (writer sẵn có của package) nén dir (trừ `expect.json`), chạy validate, assert `codes ⊇ expect.codes`; và `valid-course` → 0 finding. Chạy `make test-format` — đỏ nếu fixture nào sai/luật nào thiếu.
- [ ] **Step 3: Sửa cho xanh** — lỗi ở fixture thì sửa fixture, lỗi ở luật thì sửa luật (Task 1–2 đã dựng đủ; test này là lưới).
- [ ] **Step 4: Commit** — `git commit -m "Kho fixture format-v2 dùng chung hai implementation, kèm contract test TS"`

---

### Task 4: tuhoc-cli — template v2 + lệnh `publish`

**Files:**
- Modify: `tools/tuhoc-cli/src/init.ts` (template hết `tier`, thêm widget mẫu `widgets/vi-du/index.html` + một chương tham chiếu nó)
- Create: `tools/tuhoc-cli/src/publish.ts`, `tools/tuhoc-cli/src/publish.test.ts`
- Modify: `tools/tuhoc-cli/src/index.ts` (dispatch + usage), `tools/tuhoc-cli/src/pack.test.ts` (fixture init mới vẫn pack xanh)

**Interfaces:**
- Consumes: exit-code contract của CLI (0/1), `Io` từ `io.ts`, `selfCommand()`.
- Produces:

```
tuhoc publish <tệp.zip> --server <url>     # token đọc từ env TUHOC_ADMIN_TOKEN
```

`publish.ts`: `export async function publish(args: string[], io: Io, self: string): Promise<number>`. Slug lấy từ manifest trong zip (đọc bằng course-format `zip.ts`). Gửi `PUT {server}/admin/courses/{slug}` với header `Authorization: Bearer {token}`, body là zip (`Content-Type: application/zip`). 201 → in `đã publish {slug} v{version}` (version từ body JSON), exit 0. 400 → in từng finding `mã  path  detail` một dòng như `pack`, exit 1. 401/403 → nói token sai/thiếu. Thiếu env `TUHOC_ADMIN_TOKEN` → exit 1 kèm hướng dẫn.

- [ ] **Step 1: Test đỏ cho publish** — mock `fetch` (bun test, gán `globalThis.fetch`): case 201 in đúng dòng + exit 0; case 400 với body `{findings:[{code:'SCRIPT_TAG',path:'chapters/a.html',detail:'…'}]}` in finding + exit 1; case thiếu token exit 1 không gọi fetch. Test init: thư mục init ra pack được (chạy validate trực tiếp, expect 0 finding).
- [ ] **Step 2: Chạy đỏ** — `make test-cli`.
- [ ] **Step 3: Implement** — init template + publish.ts + dispatch trong index.ts (`if (command === 'publish') return publish(rest, io, self);` + dòng usage).
- [ ] **Step 4: Chạy xanh** — `make test-cli`.
- [ ] **Step 5: Commit** — `git commit -m "tuhoc publish: đường của người soạn lên thẳng máy chủ; init sinh khung v2"`

---

### Task 5: API — migration 0005 (catalog + role + audit) và config

**Files:**
- Create: `apps/api/migrations/0005_published_catalog.up.sql`, `apps/api/migrations/0005_published_catalog.down.sql`
- Modify: `apps/api/internal/config/config.go` (+`AdminToken string` đọc env `ADMIN_TOKEN`, mặc định rỗng = đường token tắt), `config_test.go`

**Interfaces:**
- Produces: schema cho Task 8–9. Nguyên văn up.sql:

```sql
ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'user'
  CHECK (role IN ('user','admin'));

-- Catalog công khai của nền tảng. KHÁC HẲN course_packages (bản riêng từng
-- người): ở đây một course chỉ có MỘT bản đang sống, không owner, ai cũng đọc.
CREATE TABLE published_courses (
  slug         text PRIMARY KEY,
  version      int  NOT NULL CHECK (version > 0),
  title        text NOT NULL,
  lang         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  manifest     jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE published_chapters (
  slug         text NOT NULL REFERENCES published_courses(slug) ON DELETE CASCADE,
  chapter_id   text NOT NULL,
  file         text NOT NULL,
  html         text NOT NULL,
  -- tên widget chương này tham chiếu, trích lúc publish, để GET chương
  -- trả kèm đúng widget mà không phải quét HTML mỗi request
  widget_names text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (slug, chapter_id));

CREATE TABLE published_assets (
  slug  text NOT NULL REFERENCES published_courses(slug) ON DELETE CASCADE,
  path  text NOT NULL,
  bytes bytea NOT NULL,
  PRIMARY KEY (slug, path));

CREATE TABLE published_widgets (
  slug text NOT NULL REFERENCES published_courses(slug) ON DELETE CASCADE,
  name text NOT NULL,
  html text NOT NULL,
  PRIMARY KEY (slug, name));

-- Nguyên zip từng bản publish: rollback là ĐỌC LẠI, không phải publish ngược.
CREATE TABLE course_versions (
  slug         text NOT NULL,
  version      int  NOT NULL CHECK (version > 0),
  zip          bytea NOT NULL,
  bytes        bigint NOT NULL CHECK (bytes >= 0),
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (slug, version));

-- Sổ cái thao tác admin. Không bao giờ DELETE. who NULL = đường token CLI.
CREATE TABLE admin_audit (
  id     bigserial PRIMARY KEY,
  who    uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target text NOT NULL,
  at     timestamptz NOT NULL DEFAULT now(),
  note   text NOT NULL DEFAULT '');
```

down.sql: drop 6 bảng theo thứ tự ngược + `ALTER TABLE users DROP COLUMN role`.

- [ ] **Step 1: Test đỏ config** — trong `config_test.go`: `ADMIN_TOKEN` set → `cfg.AdminToken` mang giá trị; unset → rỗng (theo mẫu test env sẵn có của file).
- [ ] **Step 2: Chạy đỏ** — `cd apps/api && go test ./internal/config/ -v`.
- [ ] **Step 3: Viết migration + config** — như trên; migrations.go dùng embed sẵn có, không phải sửa.
- [ ] **Step 4: Chạy xanh + migration lên-xuống sạch** — `go test ./internal/config/ -v`; rồi `migrate -path migrations -database "$DATABASE_URL" up` và `down 1` trên DB dev (cách chạy: docs/testing.md).
- [ ] **Step 5: Commit** — `git commit -m "Schema catalog công khai, cột role, sổ audit admin"`

---

### Task 6: Go `internal/pkgcheck` — manifest + bảy luật content

**Files:**
- Create: `apps/api/internal/pkgcheck/pkgcheck.go` (types + Validate + đọc zip), `apps/api/internal/pkgcheck/content.go` (tokenizer rules), `apps/api/internal/pkgcheck/contract_test.go`
- Modify: `apps/api/go.mod` (+`golang.org/x/net`)

**Interfaces:**
- Produces (Task 7–9 dùng):

```go
package pkgcheck

type Finding struct {
    Code   string `json:"code"`
    Path   string `json:"path"`
    Detail string `json:"detail"`
}
type Chapter struct {
    ID, File, HTML string
    WidgetNames    []string // trích từ data-widget, thứ tự gặp, khử trùng lặp
}
type Package struct {
    Slug, Title, Lang, Description string
    ManifestJSON                   []byte            // nguyên văn manifest.json
    Chapters                       []Chapter         // thứ tự part rồi chương như manifest
    Widgets                        map[string]string // name -> html
    Assets                         map[string][]byte // path -> bytes (mọi tệp còn lại)
}
const MaxUploadBytes = 21 * 1024 * 1024       // trần bytes zip trên dây
const MaxUncompressedBytes = 20 * 1024 * 1024 // khớp course-format MAX_UNCOMPRESSED_BYTES

// Validate đọc zip, chạy TOÀN BỘ luật v2. findings rỗng ⇒ pkg != nil.
// err chỉ cho lỗi hệ thống (zip hỏng cấu trúc trả findings, không err).
func Validate(zipBytes []byte) (findings []Finding, pkg *Package, err error)
```

- Consumes: `fixtures/format-v2/` của Task 3 (đường dẫn từ package test: `../../../../fixtures/format-v2`).

- [ ] **Step 1: Contract test đỏ** — `contract_test.go`: helper `zipDir(t, dir)` nén một case-dir (bỏ `expect.json`) bằng `archive/zip`; test 1 chạy `Validate` trên các case hostile CONTENT (`script-tag`, `event-handler-attr`, `javascript-url`, `embedded-frame`, `tier-field`, `loose-js`) assert `expect.codes ⊆ codes`; test 2: `valid-course` → 0 finding (case widget để Task 7 — dùng map `casesThisTask` liệt kê tường minh, KHÔNG glob hết rồi skip im lặng).
- [ ] **Step 2: Chạy đỏ** — `go test ./internal/pkgcheck/ -v` (chưa compile → viết khung types trước cho compile rồi thấy FAIL thật).
- [ ] **Step 3: Implement** — `pkgcheck.go`: `zip.NewReader`, chống path escape (`strings.Contains(name, "..")` + `path.Clean` không thoát gốc — chép cách usecase.go cũ của internal/course đang làm trước khi Task 9 xoá nó), cộng dồn size giải nén so `MaxUncompressedBytes`, parse manifest (struct tối thiểu: title, lang, description, slug/id, parts[].chapters[]{id,title,file}; có `tier` → `TIER_REMOVED`), map tệp. `content.go`: port bảy luật bằng `golang.org/x/net/html` — dùng **Tokenizer** (`html.NewTokenizer`), KHÔNG parser, cùng lý do parse5 tokenizer bên TS: `<script` mọi hoa thường → `SCRIPT_TAG`; start tag ∈ {iframe,object,embed,frame,frameset} → `EMBEDDED_FRAME`; attr tên `^on[a-z]+` → `EVENT_HANDLER_ATTR`; attr value sau trim/lowercase (tokenizer đã unescape entity) bắt đầu `javascript:` → `JAVASCRIPT_URL`; >1024 attr một tag → `TAG_ATTR_FLOOD`; đuôi js ngoài widgets → `JS_OUTSIDE_WIDGETS`. Quét mọi tệp trừ `manifest.json` và `widgets/*/index.html`. Trích `WidgetNames` bằng cùng tokenizer (attr `data-widget`).
- [ ] **Step 4: Chạy xanh** — `go test ./internal/pkgcheck/ -v`.
- [ ] **Step 5: Commit** — `git commit -m "pkgcheck: cổng thật nằm ở server — bảy luật content chạy lại bằng Go trên cùng kho fixture"`

---

### Task 7: Go `internal/pkgcheck` — luật widget

**Files:**
- Create: `apps/api/internal/pkgcheck/widgets.go`
- Modify: `apps/api/internal/pkgcheck/contract_test.go` (mở nốt case widget), thêm unit test cho `WIDGET_TOO_LARGE`/`WIDGET_LINE_TOO_LONG`/`WIDGET_BAD_NAME` (ba case này sinh nội dung trong test — tệp 128KiB không nằm trong git)

**Interfaces:**
- Consumes: hằng số bảng đầu plan; `Package.Widgets`, `Chapter.WidgetNames` từ Task 6.
- Produces: `Validate` phủ đủ 8 mã widget — contract corpus xanh 100% cả hai phía.

- [ ] **Step 1: Mở case widget trong contract test + viết 3 unit test sinh nội dung** — đỏ.
- [ ] **Step 2: Implement `widgets.go`** — logic soi gương Task 2 (size/line/name/forbidden/external/extra/missing/orphan), hằng số Go riêng cùng giá trị.
- [ ] **Step 3: Chạy xanh** — `go test ./internal/pkgcheck/ -v` rồi `make test-format` (đảm bảo hai phía cùng xanh trên cùng corpus).
- [ ] **Step 4: Commit** — `git commit -m "pkgcheck: tám luật widget, hai implementation một kho fixture"`

---

### Task 8: API — publish/unpublish/rollback + RequireAdmin + audit

**Files:**
- Create: `apps/api/internal/catalog/repo.go`, `apps/api/internal/catalog/usecase.go`, `apps/api/internal/catalog/handler.go`, `apps/api/internal/catalog/catalog_test.go`
- Modify: `apps/api/internal/auth/handler.go` (+`RequireAdmin`, +role trong `meResponse`), `apps/api/internal/auth/repo.go` (query role), `apps/api/internal/auth/auth_test.go`
- Modify: `apps/api/internal/server/server.go` (mount routes admin)

**Interfaces:**
- Consumes: `pkgcheck.Validate`, `auth.Require`/`auth.UID`, `config.AdminToken`, schema Task 5.
- Produces:

```go
// auth: sau auth.Require, chặn tiếp nếu users.role != 'admin' (403).
func RequireAdmin(pool *pgxpool.Pool) fiber.Handler
// auth: meResponse thêm `Role string `json:"role"`` — /me trả role.

// catalog usecase:
func (u *Usecase) Publish(ctx, who *uuid.UUID, zipBytes []byte) (slug string, version int, findings []pkgcheck.Finding, err error)
func (u *Usecase) Unpublish(ctx, who *uuid.UUID, slug string) error            // ErrNotFound
func (u *Usecase) Rollback(ctx, who *uuid.UUID, slug string, toVersion int) (newVersion int, findings []pkgcheck.Finding, err error)
func (u *Usecase) AdminList(ctx) ([]AdminCourseRow, error) // slug,title,version,published_at,versions []int
```

Routes (server.go):

```
PUT    /admin/courses/:slug            adminOrToken, body = zip (Content-Type application/zip)
GET    /admin/courses                  adminOrToken
DELETE /admin/courses/:slug            adminOrToken
POST   /admin/courses/:slug/rollback   adminOrToken, body {"version": 3}
```

`adminOrToken` là middleware nhỏ trong server.go: nếu header `Authorization: Bearer X` và `cfg.AdminToken != ""` và so bằng `subtle.ConstantTimeCompare` khớp → cho qua với who=nil; ngược lại rơi về `auth.Require(pool)` + `auth.RequireAdmin(pool)` (who=UID). Hợp đồng lỗi publish 400: `{"error":"gói không hợp lệ","findings":[{code,path,detail}...]}` — đúng shape CLI Task 4 đọc.

- [ ] **Step 1: Test đỏ** — theo mẫu test HTTP sẵn có của repo (đọc `course_test.go` cũ để lấy cách dựng app+DB test). Case bắt buộc: (a) PUT zip `valid-course` (nén từ fixture) với Bearer token → 201, version 1; DB có đủ published_courses/chapters(+widget_names=['dem-so'] ở chương 2)/widgets/assets/course_versions; audit có hàng `action='publish', target=slug, who IS NULL`; (b) PUT lại → version 2, bản 1 vẫn trong course_versions; (c) PUT zip hostile `script-tag` → 400 + findings chứa SCRIPT_TAG, DB không đổi; (d) không token, session user role='user' → 403; role='admin' → 201 và audit `who` = user id; (e) DELETE → published_* sạch slug đó, course_versions CÒN NGUYÊN, audit 'unpublish'; (f) rollback về version 1 → publish lại từ zip bản 1, version mới = 3, audit 'rollback' note nêu from/to; (g) PUT slug trên URL ≠ slug trong manifest → 400 (chặn ghi đè nhầm chỗ).
- [ ] **Step 2: Chạy đỏ** — `go test ./internal/catalog/ ./internal/auth/ -v`.
- [ ] **Step 3: Implement** — repo: mỗi thao tác một transaction (`pgx.Tx`): publish = `INSERT course_versions (version = COALESCE(MAX+1,1))` → `DELETE FROM published_courses WHERE slug=$1` (cascade dọn 3 bảng con) → insert 4 bảng → insert audit. Rollback = đọc zip từ course_versions rồi đi lại đúng đường Publish (không viết đường ghi thứ hai). Handler đọc body raw (`c.Body()`), chặn > `pkgcheck.MaxUploadBytes` → 413.
- [ ] **Step 4: Chạy xanh** — `go test ./internal/catalog/ ./internal/auth/ -v`.
- [ ] **Step 5: Commit** — `git commit -m "Publish có tái kiểm, hai đường vào một API, mọi thao tác admin vào sổ audit"`

---

### Task 9: API — đọc công khai + gỡ per-user course API

**Files:**
- Modify: `apps/api/internal/catalog/repo.go`/`usecase.go`/`handler.go` (+đường đọc), `catalog_test.go`
- Delete: `apps/api/internal/course/` (cả thư mục)
- Create: `apps/api/migrations/0006_drop_course_packages.up.sql` (`DROP TABLE course_packages;`), down.sql (dựng lại nguyên văn từ 0002)
- Modify: `apps/api/internal/server/server.go` (routes mới, gỡ routes cũ + uploadLimiter + import `course`; BodyLimit đổi sang `pkgcheck.MaxUploadBytes`)

**Interfaces:**
- Produces (web Task 10–11 gọi):

```
GET /courses                          → 200 [{"slug","title","lang","description","version"}]
GET /courses/:slug                    → 200 manifest.json nguyên văn (Content-Type application/json) | 404
GET /courses/:slug/chapters/:chapterId→ 200 {"html": "...", "widgets": [{"name","html"}]} | 404
GET /courses/:slug/assets/*           → 200 bytes | 404
```

KHÔNG auth trên cả bốn — công khai là quyết định spec §2.4. Content-Type asset: theo đuôi tệp trong allowlist bitmap `{png,jpg,jpeg,gif,webp}` → type thật; mọi thứ khác (kể cả `.svg`) → `application/octet-stream` + `X-Content-Type-Options: nosniff` — chép nguyên khối comment lý do của `assetContentType` trong handler.go cũ sang trước khi xoá thư mục (SVG chạy script khi được điều hướng thẳng, trên origin đang giữ cookie phiên; bitmap thì không có đường chạy mã). ETag: `W/"<slug>-<version>"` cho cả ba GET đầu; request mang `If-None-Match` khớp → 304.

- [ ] **Step 1: Test đỏ** — list/manifest/chapter(+widgets đúng theo widget_names)/asset png có Content-Type image/png/asset svg là octet-stream+nosniff/ETag 304/404 slug lạ — tất cả KHÔNG cookie. Và: `server_test.go` case route cũ `POST /courses` nay 404/405.
- [ ] **Step 2: Chạy đỏ.**
- [ ] **Step 3: Implement + gỡ** — hai commit tách bạch: commit A thêm đường đọc mới (xanh); commit B xoá `internal/course` + migration 0006 + gỡ route/limiter, message nêu lý do theo spec §0.3: kho riêng từng người đã bị thay bằng catalog chung — không còn import phía người đọc.
- [ ] **Step 4: Chạy xanh** — `make test-api`.
- [ ] **Step 5: Commit** (B ở step 3 là commit cuối của task)

```bash
git commit -m "Gỡ kho gói riêng từng người: catalog chung là nguồn duy nhất

course_packages, POST /courses, và quota theo owner ra đi cùng nhau —
người đọc không import nữa nên không còn thứ để canh. Spec §0.3."
```

---

### Task 10: Web — `course/loader.ts` đổi nguồn sang server

**Files:**
- Create: `apps/web/src/api/catalog.ts`, `apps/web/src/api/catalog.test.ts`
- Modify: `apps/web/src/course/loader.ts` (viết lại ruột), `apps/web/src/course/loader.test.ts`
- Modify: `apps/web/src/pages/Reader.tsx`, `apps/web/src/reader/ChapterView.tsx` (call-site `loadChapter` đổi tham số), `apps/web/src/pages/CourseHome.tsx`, `apps/web/src/course/chapters.ts` nếu nó đọc từ nguồn cũ

**Interfaces:**
- Consumes: endpoints Task 9; `BASE_URL` pattern từ `api/client.ts` (`import.meta.env.VITE_API_URL ?? ''`).
- Produces:

```ts
// api/catalog.ts
export interface CatalogCourse { slug: string; title: string; lang: string; description: string; version: number }
export interface ChapterPayload { html: string; widgets: { name: string; html: string }[] }
export async function fetchCatalog(): Promise<CatalogCourse[]>
export async function fetchManifest(slug: string): Promise<Manifest>
export async function fetchChapter(slug: string, chapterId: string): Promise<ChapterPayload>
export function assetUrl(slug: string, relPath: string): string   // `${BASE_URL}/courses/${slug}/assets/${relPath}`

// course/loader.ts — GIỮ tên hàm/query-key cũ, ruột mới:
export function manifestQueryKey(courseId: string)                 // giữ nguyên
export async function loadManifest(courseId: string): Promise<Manifest>          // = fetchManifest
export async function loadChapter(courseId: string, chapterId: string): Promise<ChapterPayload>  // ĐỔI: nhận chapterId (trước là file path), trả kèm widgets
export function describeCourseError(error, t): string              // giữ, thêm nhánh 404 catalog
```

Chết trong task này: `pinnedPackage`, `loadStaticManifest`, `pullPackageFromServer`, `pickPinned`, `resolveVizScriptUrl`, `vizBlobUrl`, `revokeVizScriptUrls`, `RuntimeMismatchError`, `PackageAssetError` (thay bằng `CourseFetchError` 404). `ChapterView` gọi `loadChapter(courseId, chapter.id)` thay vì `chapter.file` (widgets phần payload Task 11 mới dùng — task này chỉ lấy `.html`).

- [ ] **Step 1: Test đỏ** — msw theo mẫu test api sẵn có: fetchCatalog/fetchManifest/fetchChapter happy + 404; loader.test.ts viết lại: loadManifest trả manifest từ server, loadChapter trả html+widgets, lỗi mạng → CourseFetchError.
- [ ] **Step 2: Chạy đỏ** — `make test-web` (khoanh: `bun test loader catalog` theo cách repo chạy vitest).
- [ ] **Step 3: Implement** — viết lại loader.ts (~150 dòng thay ~600); sửa call-sites; `useCourseKit` tạm gọi thẳng `ensureCourseKitRuntime` (bỏ nhánh resolveVizScriptUrl — Task 11 dọn nốt).
- [ ] **Step 4: Chạy xanh phần khoanh + toàn bộ test-web** — test cũ của import/owned sẽ đỏ: KHÔNG sửa ở đây, Task 13 gỡ chúng có chủ ý. Ghi rõ danh sách file đỏ còn lại vào message commit.
- [ ] **Step 5: Commit** — `git commit -m "Reader đọc từ máy chủ: loader còn một nguồn, hai hàm, một query key"`

---

### Task 11: Web — widget sandbox + gỡ đường viz

**Files:**
- Create: `apps/web/src/reader/WidgetFrame.tsx`, `apps/web/src/reader/WidgetFrame.test.tsx`
- Modify: `apps/web/src/reader/ChapterView.tsx` (mount widget sau innerHTML; gỡ `initViz`/REDRAWS), `apps/web/src/reader/useCourseKit.ts` (trio-only, bỏ tham số courseId phần viz), tests liên quan
- Delete: `apps/web/e2e/viz.spec.ts` (commit riêng, lý do: đường viz không còn — thay bằng widget.spec Task 16)

**Interfaces:**
- Consumes: `ChapterPayload.widgets` từ Task 10.
- Produces:

```tsx
// WidgetFrame.tsx — TOÀN BỘ điểm an ninh nằm ở đúng một dòng sandbox:
export function WidgetFrame({ name, html }: { name: string; html: string }) {
  return (
    <iframe
      className="widget-frame"
      title={name}
      sandbox="allow-scripts"   // KHÔNG BAO GIỜ thêm allow-same-origin: origin mờ là bức tường
      srcDoc={html}
    />
  );
}
```

ChapterView: sau khi innerHTML + renderKatex, tìm `container.querySelectorAll('div[data-widget]')`, với mỗi placeholder render một `WidgetFrame` vào đó qua `createPortal` (map name→html từ payload; name không có trong payload → placeholder giữ trống — server đã validate nên chỉ xảy ra khi cache lệch).

- [ ] **Step 1: Test đỏ** — WidgetFrame.test: (a) iframe có `sandbox` đúng bằng `"allow-scripts"` — assert **so sánh bằng**, không `toContain`, để `allow-same-origin` lọt vào là đỏ; (b) srcDoc mang html truyền vào. ChapterView test: chương có 1 placeholder → 1 iframe đúng chỗ.
- [ ] **Step 2: Chạy đỏ.**
- [ ] **Step 3: Implement + dọn viz** — gỡ `initViz`, REDRAWS snapshot, `vizPromisesBySrc`, `readyCourseIds` phần viz trong useCourseKit (trio giữ nguyên — KaTeX vẫn cần); CSS `.widget-frame{width:100%;border:0}` vào `styles/app-screens.css`.
- [ ] **Step 4: Chạy xanh** — `make test-web` phần reader.
- [ ] **Step 5: Commit** — `git commit -m "Widget chạy sau song sắt: srcdoc + allow-scripts, origin mờ; đường viz cùng-origin ra đi"`

---

### Task 12: Web — đọc công khai, gate ẩn danh

**Files:**
- Modify: `apps/web/src/routes.tsx` (bỏ RequireAuth quanh `/c/:courseId`, `/c/:courseId/:chapterId`, `/courses`), `apps/web/src/reader/ChapterView.tsx` (annotations/progress/checkbox chỉ dựng khi có phiên — dùng `useMe` như các chỗ khác đang dùng), `apps/web/src/pages/CourseHome.tsx` (tương tự phần tiến độ)
- Create: key i18n `reader.anonNudge` (vi: `'Đăng nhập để lưu tiến độ, ghi chú và hỏi AI.'`, en: `'Sign in to keep progress, notes, and ask the AI.'`) + banner nhỏ đầu chương khi chưa đăng nhập
- Modify: `apps/web/src/auth/RequireAuth.test.tsx` — KHÔNG sửa nội dung test offline-branch (Pha 3); chỉ cập nhật test nào assert `/c/*` bị chặn (gỡ case đó, lý do trong commit: đọc là công khai theo spec §2.4)

**Interfaces:**
- Consumes: `useMe` từ `api/useMe.ts`.
- Produces: `/c/*` và `/courses` render không phiên; mọi hook ghi (useAnnotations, progress, leaveChapter) không được GỌI khi chưa đăng nhập (React rules: tách component `AuthedReaderExtras` chứa các hook đó, chỉ mount khi có phiên — không if quanh hook).

- [ ] **Step 1: Test đỏ** — render Reader qua router KHÔNG phiên (msw /me → 401): chương hiện, banner nudge hiện, không có SelectionToolbar/MarginCards/checkbox; CÓ phiên: như cũ, không banner.
- [ ] **Step 2: Chạy đỏ.** — chú ý test hiện có mock /me thế nào (đọc `useMe.test.tsx`).
- [ ] **Step 3: Implement** — routes + tách `AuthedReaderExtras` + banner.
- [ ] **Step 4: Chạy xanh** — `make test-web`.
- [ ] **Step 5: Commit** — `git commit -m "Đọc không cần tài khoản: RequireAuth rời reader, phần ghi tách thành nhánh có phiên"`

---

### Task 13: Web — luồng import chết, Courses thành catalog

**Files:**
- Modify: `apps/web/src/pages/Courses.tsx` (một danh mục từ `fetchCatalog`, không tab, không nút nhập; giữ redirect `/library`,`/import`,`/catalog` trong routes nhưng `?import=1`/`?tab=registry` nay chỉ về danh mục), `apps/web/src/pages/Courses.test.tsx`
- Modify: `apps/web/src/pages/Dashboard.tsx`, `apps/web/src/pages/Progress.tsx` (nguồn danh sách course đổi từ owned.ts sang fetchCatalog + progress Dexie hiện có)
- Delete (MỖI CÁI MỘT COMMIT, kèm lý do — spec §0.3): `pages/ImportCourse.tsx` + test; `pages/Library.tsx` + test (tab "Của bạn" không còn nghĩa khi không có kho riêng); `src/registry/` Catalog UI (catalog nay là chính /courses; ratings/discussions server-side GIỮ NGUYÊN — web thôi trỏ tới trong pha này); `course/import.ts` + test; `course/owned.ts`; `course/version.ts` + test; `course/UpdateDialog.tsx` + test; `e2e/import.spec.ts`; `e2e/s1.spec.ts` phần import/library (case đọc chương giữ lại, chuyển sang p1.spec)
- Modify: `apps/web/src/db/local.ts` — bảng `packages` bỏ khỏi schema Dexie (bump version DB theo cách Dexie của file); progress/annotations/meta GIỮ NGUYÊN

**Interfaces:**
- Consumes: `fetchCatalog` Task 10.
- Produces: không mã nào còn import từ `course/import.ts`/`owned.ts`/`version.ts` — `grep -rn "from '.*course/(import|owned|version)'" apps/web/src` phải trống.

- [ ] **Step 1: Test đỏ cho Courses catalog** — msw GET /courses → danh mục render tiêu đề + mô tả + link `/c/:slug`; trạng thái lỗi mạng nói "máy chủ không trả lời" (dùng `describeCourseError`).
- [ ] **Step 2: Implement Courses/Dashboard/Progress** — xanh phần mới.
- [ ] **Step 3: Gỡ từng khối một commit** — thứ tự: ImportCourse → import.ts → UpdateDialog+version.ts → owned.ts → Library+registry UI → db.packages → e2e import/s1. Sau mỗi commit `make test-web` phải xanh (không để cây đỏ giữa hai commit).
- [ ] **Step 4: Chạy xanh toàn bộ** — `make test-web && make test-format && make test-cli`.
- [ ] **Step 5: Commit cuối**

```bash
git commit -m "Người đọc không import nữa

Gói .zip là đường của người soạn (tuhoc publish). import.ts 50KB,
kho riêng, đối chiếu phiên bản, hộp cập nhật — tất cả canh một luồng
không còn tồn tại. Spec §0.3, §2."
```

---

### Task 14: Web — câu chữ đăng nhập đổi trong pha này

**Files:**
- Modify: `packages/i18n/src/messages/vi.ts`, `packages/i18n/src/messages/en.ts`, `apps/web/src/pages/Login.tsx` (mảng points), `apps/web/src/pages/Login.test.tsx`

**Interfaces:** key `login.point.offline` và `login.point.private` bị THAY bằng `login.point.free` và `login.point.sync` (đổi tên key để chỗ nào còn trỏ key cũ nổ compile/test thay vì lặng lẽ trống). Giá trị nguyên văn:

| Key | vi | en |
|---|---|---|
| `login.pitch.headline` | `Khoá học mở cho mọi người.` | `Courses are open to everyone.` |
| `login.point.free` | `Đọc toàn bộ giáo trình miễn phí — không cần tài khoản` | `Read every course free — no account needed` |
| `login.point.sync` | `Đăng nhập để tiến độ và ghi chú theo bạn trên mọi thiết bị` | `Sign in and your progress and notes follow you across devices` |
| `login.point.ownKey` | GIỮ NGUYÊN (còn đúng tới Pha 2) | GIỮ NGUYÊN |
| `login.lede` | `Tiến độ học đồng bộ giữa các máy của bạn.` | câu en tương ứng, bỏ vế "gói nằm trên máy" |

`login.pitch.lede` (vi.ts dòng 420) đọc lại và sửa cùng nguyên tắc: mọi vế nói "gói nằm trên máy bạn"/"ngoại tuyến" phải ra đi trong task này.

- [ ] **Step 1: Test đỏ** — Login.test đổi expectation sang key/giá trị mới; thêm assert chuỗi `'ngoại tuyến'` và `'trên máy bạn'` KHÔNG xuất hiện trong trang đăng nhập render ra.
- [ ] **Step 2: Implement** — đổi key + giá trị hai file messages, mảng `['login.point.free','login.point.ownKey','login.point.sync']` trong Login.tsx.
- [ ] **Step 3: Chạy xanh** — `make test-web`.
- [ ] **Step 4: Commit** — `git commit -m "Trang đăng nhập thôi hứa ngoại tuyến — lời hứa đổi cùng pha với kiến trúc (spec §0.2)"`

---

### Task 15: Web — khung `/admin` + màn Courses

**Files:**
- Modify: `apps/web/src/api/useMe.ts` (+`role` vào type Me — Go đã trả từ Task 8), `apps/web/src/routes.tsx` (+route `/admin`)
- Create: `apps/web/src/admin/AdminGuard.tsx` (useMe; đang tải → null; role!=='admin' → `<Navigate to="/" replace>`), `apps/web/src/admin/AdminCourses.tsx`, `apps/web/src/admin/adminApi.ts`, `apps/web/src/admin/AdminCourses.test.tsx`
- Modify: `apps/web/src/styles/app-screens.css` (khối `.admin-*` theo design token sẵn có của file)

**Interfaces:**
- Consumes: routes admin Task 8 (session admin — cookie sẵn có của phiên; KHÔNG bao giờ cầm ADMIN_TOKEN ở web).
- Produces:

```ts
// adminApi.ts — dùng client.ts request helper sẵn có (credentials include)
export async function adminListCourses(): Promise<AdminCourseRow[]>
export async function adminPublish(slug: string, zip: File): Promise<{version: number}>   // PUT, body zip; 400 → throw FindingsError{findings}
export async function adminUnpublish(slug: string): Promise<void>
export async function adminRollback(slug: string, version: number): Promise<{version: number}>
```

Màn AdminCourses: bảng slug/title/version/published_at; form upload (input file .zip + slug đọc từ tên tệp, người dùng sửa được); publish lỗi 400 → in đủ bảng findings (mã, path, detail) ngay trên trang — đúng tinh thần "in mọi vấn đề một lần" của pack; nút gỡ (confirm) + rollback (chọn version từ danh sách).

- [ ] **Step 1: Test đỏ** — AdminGuard: role user → điều hướng về `/`; role admin → render con. AdminCourses (msw): list render; publish 400 render cả 2 findings mẫu; publish 201 reload list.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Chạy xanh** — `make test-web`.
- [ ] **Step 4: Commit** — `git commit -m "CMS admin màn đầu: publish qua trình duyệt đi cùng đường validate với CLI"`

---

### Task 16: e2e + Makefile + docs

**Files:**
- Create: `apps/web/e2e/widget.spec.ts`
- Modify: `apps/web/e2e/p1.spec.ts` (đọc không đăng nhập), `apps/api/compose.e2e.yml` (+`ADMIN_TOKEN=e2e-admin-token` env cho api), `scripts/test-e2e.sh` (bước seed: sau khi API lên, zip `fixtures/format-v2/valid-course` và PUT bằng curl với token — thay cho bước courses/static cũ), `Makefile` (gỡ target `test-viz`; `test-e2e` thôi phụ thuộc `courses`)
- Modify: `docs/course-format.md` (§4 viết lại thành format v2: widget thay tier — bảng luật widget với hằng số ở đầu plan; §2 manifest bỏ tier), `README.md` (mục "No course ships with this repo" viết lại: course nằm trên server, publish bằng `tuhoc publish`; mục lệnh + `make pack` giữ)

**Interfaces:** widget.spec.ts là CỔNG MỚI của spec §8 — nội dung bắt buộc:

```ts
test('widget bị nhốt: origin mờ, không cookie, không allow-same-origin', async ({ page }) => {
  await page.goto('/c/mau-hop-le/<id-chương-2>');           // KHÔNG đăng nhập
  const iframe = page.locator('iframe.widget-frame');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts'); // so bằng, không chứa
  const frame = page.frameLocator('iframe.widget-frame');
  await frame.locator('#b').click();                         // widget mẫu dem-so chạy thật
  await expect(frame.locator('#b')).toHaveText('1');
  const origin = await iframe.evaluate(
    (el) => (el as HTMLIFrameElement).contentWindow ? 'reachable' : 'opaque');
  // origin mờ: cross-origin từ trang cha — đọc contentWindow.origin phải ném
  // (viết assertion bằng frame.evaluate trong frameLocator: window.origin === 'null'
  //  và document.cookie === '')
});
```

(Viết phần assertion origin bằng `frame.frameLocator(...).locator('body').evaluate(() => ({o: window.origin, c: document.cookie}))` → `{o:'null', c:''}` — Playwright chạy được trong sandboxed frame.)

- [ ] **Step 1: compose + seed script** — thêm env, viết bước seed trong test-e2e.sh (curl PUT, fail thì dừng cả gate với message rõ).
- [ ] **Step 2: widget.spec.ts + p1.spec sửa** — chạy `make test-e2e` đến xanh.
- [ ] **Step 3: Docs** — course-format.md §4 v2 + README; đối chiếu từng hằng số với bảng đầu plan (một nguồn số).
- [ ] **Step 4: Chạy hết mọi gate** — `make test-format && make test-cli && make test-api && make test-web && make test-e2e`.
- [ ] **Step 5: Commit** — `git commit -m "Cổng e2e mới: widget sau song sắt được đo thật; tài liệu format v2"`

---

## Ghi chú cho người thi công

1. **Hai course `interactive` hiện có** (`so-dau-phay-dong`, `***REMOVED***`) dùng viz.js kiểu cũ — chúng KHÔNG publish được lên format v2 cho tới khi được soạn lại thành widget (việc của kho course ngoài repo, skill course-authoring, sau pha này). `bat-bien-vong-lap` là content thuần: publish được ngay. Đây là trạng thái chấp nhận được của Pha 1, không phải bug.
2. **Bốn unit test + e2e đọc chương thật** (README): sau Task 13/16 chúng đọc từ fixture `valid-course` qua đường server/msw thay vì `make courses` — task nào gặp thì chuyển fixture theo, giữ nguyên tinh thần "chương thật, không prose bịa".
3. **Thứ tự task là thứ tự phụ thuộc** — 1→2→3 (format), 4 (CLI, cần 3), 5→6→7→8→9 (API), 10→11→12→13→14→15 (web), 16 (đóng gói). Task 4 có thể chạy song song nhánh API; trong một session tuần tự thì cứ theo số.

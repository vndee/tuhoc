# P1 — Platform Core Implementation Plan

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

**Goal:** Nền tảng tự học chạy được: reader ngang trải nghiệm v1, auth, progress sync đa thiết bị, dashboard.

**Architecture:** Monorepo `tuhoc/`. Course = static package tách từ file v1 bằng `tools/extract.py`; runtime dùng chung nằm ở `packages/course-kit` (classic scripts gắn global — giữ nguyên 59 viz không phải viết lại). Backend Go/Fiber clean architecture + Postgres, sync LWW theo `updated_at`. Frontend React/Vite tái tạo đúng DOM skeleton + CSS của v1 để đạt parity, offline-first qua Dexie outbox.

**Tech Stack:** Go 1.22+, Fiber v2, pgx v5, golang-migrate, alexedwards/argon2id, testcontainers-go · Bun, Vite 5, React 18, TypeScript, react-router v6, TanStack Query v5, Dexie v4, fake-indexeddb, MSW, Vitest, Playwright · Python 3.11 + pytest (extract).

**Spec:** `docs/superpowers/specs/2026-08-19-tuhoc-platform-design.md`

## Global Constraints

- Nguồn extraction: `/Users/vndee/Documents/claude/Research/«giáo-trình-riêng».html` tại tag `v1-single-file` (commit f782323). KHÔNG sửa repo Research.
- Validate gates của extract (spec §3): đủ 44 chương; 59 `data-viz` khớp 59 `defineViz`; số ký tự `$` từng chương giữ nguyên; không chương nào chứa chuỗi `</script`.
- Chapter id giữ nguyên `p0-1`…`p4-10`, `appx` (spec §3).
- Course content không nằm trong DB (spec §2).
- Cookie session: HttpOnly + Secure + SameSite=Lax (spec §4). Mật khẩu: argon2id.
- LWW: ghi đè khi và chỉ khi `incoming.updated_at > existing.updated_at` (spec §4).
- CSS: port nguyên tokens v1, không CSS framework (spec §5). CẢNH BÁO kế thừa từ v1: stylesheet có rule generic `input[type=text]{…}` và `a{border-bottom:…}` ghi đè component rule cùng độ đặc hiệu — input mới phải qualify selector, link non-prose phải khai `border-bottom:none`.
- Tinh chỉnh spec được chốt trong plan này: bảng `progress` thêm cột `done boolean NOT NULL DEFAULT true` (unmark = `done=false`, không cần tombstone riêng cho progress).

## File Structure (P1)

```
tuhoc/
├── Makefile                          # dev/test/build cho cả 3 phần
├── .gitignore
├── tools/
│   ├── extract.py                    # v1 → course package + course-kit
│   └── test_extract.py
├── packages/course-kit/
│   ├── vendor/katex.js  vendor/auto-render.js  vendor/katex.css   # cắt từ v1
│   ├── runtime.js                    # Plot engine + helpers + defineViz/initViz/renderKatex/REDRAWS (globals)
│   └── reader.css                    # toàn bộ stylesheet v1
├── courses/«giáo-trình-riêng»/
│   ├── manifest.json
│   ├── chapters/p0-1.html … appx.html   (44 file)
│   └── viz.js
├── apps/api/
│   ├── cmd/api/main.go
│   ├── internal/config/config.go
│   ├── internal/server/server.go            # fiber app, middleware, routes
│   ├── internal/auth/{handler,usecase,repo}.go
│   ├── internal/sync/{handler,usecase,repo}.go
│   ├── internal/stats/{handler,repo}.go
│   ├── internal/store/store.go              # pgx pool
│   ├── migrations/0001_init.up.sql / .down.sql
│   ├── Dockerfile
│   └── go.mod (module github.com/vndee/tuhoc-api)
└── apps/web/
    ├── index.html  vite.config.ts  package.json  tsconfig.json
    ├── src/main.tsx  src/App.tsx  src/routes.tsx
    ├── src/api/client.ts             # fetch wrapper + session
    ├── src/db/local.ts               # Dexie schema + outbox
    ├── src/sync/engine.ts            # push/pull loop, LWW merge
    ├── src/course/{loader.ts,types.ts}
    ├── src/pages/{Dashboard,CourseHome,Reader,Login}.tsx
    ├── src/reader/{ChapterView.tsx,useCourseKit.ts,getContext.ts}
    ├── src/progress/{useProgress.ts,heartbeat.ts}
    └── src/styles/shell.css          # phần shell-specific nếu cần thêm
```

---

### Task 1: Monorepo scaffold

**Files:** Create: `Makefile`, `.gitignore`, `README.md`, cấu trúc thư mục rỗng.

**Interfaces:** Produces: các target `make test-extract`, `make test-api`, `make test-web`, `make dev-api`, `make dev-web` mà mọi task sau dùng.

- [ ] **Step 1:** Tạo cây thư mục như File Structure; `.gitignore` gồm: `node_modules/`, `dist/`, `.env`, `*.local`, `__pycache__/`, `apps/api/bin/`.
- [ ] **Step 2:** `Makefile`:

```makefile
.PHONY: dev-api dev-web test-api test-web test-extract extract
dev-api:  ; cd apps/api && go run ./cmd/api
dev-web:  ; cd apps/web && bun run dev
test-api: ; cd apps/api && go test ./...
test-web: ; cd apps/web && bun run test
test-extract: ; cd tools && python3 -m pytest test_extract.py -v
extract:  ; python3 tools/extract.py --source ~/Documents/claude/Research/«giáo-trình-riêng».html --out .
```

- [ ] **Step 3:** README.md: mô tả 1 đoạn + bảng lệnh trên + link spec.
- [ ] **Step 4:** Commit: `chore: monorepo scaffold`

---

### Task 2: extract.py — chapters + manifest

**Files:** Create: `tools/extract.py`, `tools/test_extract.py` · Output: `courses/«giáo-trình-riêng»/{manifest.json,chapters/*.html}`

**Interfaces:** Produces: `extract_chapters(src: str) -> dict[str, str]` (id→fragment HTML, không gồm `home`), `build_manifest(src: str) -> dict` (đúng schema spec §3), CLI `python3 tools/extract.py --source <file> --out <repo-root>` (idempotent, ghi đè).

- [ ] **Step 1: Test fail trước.** `tools/test_extract.py`:

```python
import pathlib, re, json, pytest
from extract import extract_chapters, build_manifest, SRC_DEFAULT

SRC = pathlib.Path(SRC_DEFAULT).expanduser().read_text(encoding="utf-8")

def test_chapter_count_and_ids():
    ch = extract_chapters(SRC)
    assert len(ch) == 44                      # 43 chương đánh số + appx; home bị loại
    assert "home" not in ch and "p0-1" in ch and "p2-10" in ch and "p3-9" in ch and "appx" in ch

def test_dollar_parity_and_no_script_close():
    ch = extract_chapters(SRC)
    for cid, frag in ch.items():
        tpl = re.search(r'<script type="text/html" id="tpl-%s">(.*?)</script>' % re.escape(cid), SRC, re.S).group(1)
        assert frag.count("$") == tpl.count("$"), cid
        assert "</script" not in frag, cid

def test_manifest_shape():
    m = build_manifest(SRC)
    assert m["id"] == "«giáo-trình-riêng»" and m["runtime"] == "^1"
    chapters = [c for p in m["parts"] for c in p["chapters"]]
    assert len(chapters) == 44
    assert chapters[0]["id"] == "p0-1" and chapters[-1]["id"] == "appx"
    for c in chapters:
        assert c["file"] == f"chapters/{c['id']}.html"
```

- [ ] **Step 2:** Chạy `make test-extract` → FAIL (module chưa có).
- [ ] **Step 3:** Implement `tools/extract.py`:

```python
#!/usr/bin/env python3
import argparse, json, pathlib, re

SRC_DEFAULT = "~/Documents/claude/Research/«giáo-trình-riêng».html"
TPL_RE = re.compile(r'<script type="text/html" id="tpl-([\w-]+)">(.*?)</script>', re.S)
CH_ROW = re.compile(r"\{id:'([\w-]+)',\s*part:'([^']*)',\s*num:'([^']*)',\s*title:'([^']*)',\s*short:'([^']*)'\}")

def extract_chapters(src: str) -> dict:
    return {cid: body.strip() + "\n" for cid, body in TPL_RE.findall(src) if cid != "home"}

def registry(src: str):
    block = src[src.find("const CH = ["): src.find("];", src.find("const CH = ["))]
    return [dict(zip(("id","part","num","title","short"), m)) for m in CH_ROW.findall(block)]

def build_manifest(src: str) -> dict:
    parts, order = {}, []
    for row in registry(src):
        if row["id"] == "home": continue
        key = row["part"] or "Phụ lục"
        if key not in parts: parts[key] = []; order.append(key)
        parts[key].append({"id": row["id"], "num": row["num"], "title": row["title"],
                           "short": row["short"], "file": f"chapters/{row['id']}.html"})
    return {"id": "«giáo-trình-riêng»", "title": "«Giáo trình riêng»",
            "description": "«mô tả của giáo trình riêng»",
            "lang": "vi", "version": "1.0.0", "runtime": "^1",
            "parts": [{"title": k, "chapters": parts[k]} for k in order]}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--source", default=SRC_DEFAULT); ap.add_argument("--out", default=".")
    a = ap.parse_args()
    src = pathlib.Path(a.source).expanduser().read_text(encoding="utf-8")
    root = pathlib.Path(a.out) / "courses" / "«giáo-trình-riêng»"
    (root / "chapters").mkdir(parents=True, exist_ok=True)
    for cid, frag in extract_chapters(src).items():
        (root / "chapters" / f"{cid}.html").write_text(frag, encoding="utf-8")
    (root / "manifest.json").write_text(json.dumps(build_manifest(src), ensure_ascii=False, indent=2), encoding="utf-8")
    print("extracted:", len(extract_chapters(src)), "chapters")

if __name__ == "__main__": main()
```

- [ ] **Step 4:** `make test-extract` → PASS. Chạy `make extract`, kiểm tra `courses/«giáo-trình-riêng»/chapters/` có 44 file.
- [ ] **Step 5:** Commit: `feat(tools): extract chapters + manifest from v1`

---

### Task 3: extract.py — course-kit runtime + viz.js

**Files:** Modify: `tools/extract.py`, `tools/test_extract.py` · Output: `packages/course-kit/{vendor/*,runtime.js,reader.css}`, `courses/«giáo-trình-riêng»/viz.js`

**Interfaces:** Produces: file `runtime.js` (classic script) expose globals `Plot, defineViz, VIZ, PAL, cssv, mix, fmt, slider, seg, checkbox, button, ctrlRow, readout, legendRow, KL, Hb, H, …` (mọi helper v1) và `window.CourseKit = { initViz(root), renderKatex(root), REDRAWS }`. `viz.js` (classic script) chỉ chứa 59 `defineViz(...)`. `reader.css` = stylesheet v1 nguyên vẹn.

Vị trí cắt trong v1 (theo anchor chuỗi, không theo số dòng):
- `vendor/katex.css`: nội dung `<style>` đầu tiên (chứa `@font-face{font-family:KaTeX`).
- `vendor/katex.js`, `vendor/auto-render.js`: nội dung 2 `<script>` inline đầu tiên.
- `reader.css`: nội dung `<style>` thứ hai (bắt đầu `/* ====… TOKENS`).
- `runtime.js`: từ `/* =====\n   CORE UTILITIES` đến ngay trước `/* viz registry */`, CỘNG `const VIZ = {};\nfunction defineViz…`, CỘNG hàm `renderKatex` và `initViz` cắt từ app script v1, CỘNG đoạn expose `window.CourseKit`.
- `viz.js`: từ `/* ======================= HOME HERO` đến hết `function roundRectFull(…)}` (ngay trước `</script>` đứng trước `CHAPTER REGISTRY`). Giữ cả `home-hero` (course home dùng lại).

- [ ] **Step 1: Test fail trước** (thêm vào `test_extract.py`):

```python
def test_runtime_and_viz_split(tmp_path):
    from extract import extract_runtime
    out = extract_runtime(SRC)
    assert out["viz"].count("defineViz('") == 59
    assert "class Plot" in out["runtime"] and "function initViz" in out["runtime"]
    assert "window.CourseKit" in out["runtime"]
    assert "defineViz('" not in out["runtime"].replace("function defineViz", "")
    assert out["reader_css"].lstrip().startswith("/*") and "--s1:" in out["reader_css"]
    assert "@font-face" in out["katex_css"]
    for js in (out["runtime"], out["viz"]):
        assert "</script" not in js
```

- [ ] **Step 2:** `make test-extract` → FAIL.
- [ ] **Step 3:** Implement `extract_runtime(src) -> dict` cắt theo anchors nêu trên (dò bằng `str.find` với các mốc: `"CORE UTILITIES"`, `"/* viz registry */"`, `"HOME HERO"`, `"CHAPTER REGISTRY"`, `"function renderKatex"`, `"function initViz"`); phần expose thêm vào cuối runtime:

```javascript
window.CourseKit = { initViz, renderKatex, REDRAWS, VIZ };
```

  Lưu ý: `initViz` v1 gọi `$$('[data-viz]', root)` — helpers `$`/`$$` đã nằm trong CORE UTILITIES nên giữ nguyên. Trong `main()` ghi các file output + chạy `node --check` cho runtime.js và viz.js (subprocess; fail thì raise).
- [ ] **Step 4:** `make test-extract` → PASS; `make extract`; `node --check packages/course-kit/runtime.js && node --check courses/«giáo-trình-riêng»/viz.js` → OK.
- [ ] **Step 5:** Commit: `feat(tools): extract course-kit runtime, vendor katex, viz.js`

---

### Task 4: API scaffold + healthz

**Files:** Create: `apps/api/go.mod`, `cmd/api/main.go`, `internal/config/config.go`, `internal/server/server.go`, `internal/server/server_test.go`, `Dockerfile`

**Interfaces:** Produces: `server.New(cfg config.Config, deps server.Deps) *fiber.App` (Deps chứa `Pool *pgxpool.Pool`, nil được trong unit test); `config.Load()` đọc env `PORT, DATABASE_URL, CORS_ORIGIN, COOKIE_SECURE`.

- [ ] **Step 1: Test fail:** `internal/server/server_test.go`:

```go
func TestHealthz(t *testing.T) {
	app := New(config.Config{}, Deps{})
	req := httptest.NewRequest("GET", "/healthz", nil)
	resp, _ := app.Test(req)
	if resp.StatusCode != 200 { t.Fatalf("want 200 got %d", resp.StatusCode) }
}
```

- [ ] **Step 2:** `go test ./...` → FAIL (chưa có New).
- [ ] **Step 3:** Implement: Fiber app + `GET /healthz` trả `{"ok":true}`; middleware: recover, logger, CORS(origin từ cfg, credentials true). `main.go`: Load config → mở pgxpool nếu có DATABASE_URL → `app.Listen(":"+cfg.Port)`. Dockerfile multi-stage (golang:1.22-alpine build → scratch, copy binary + migrations).
- [ ] **Step 4:** `make test-api` → PASS. `docker build apps/api` → OK.
- [ ] **Step 5:** Commit: `feat(api): fiber scaffold + healthz + dockerfile`

---

### Task 5: Migrations 0001 + store

**Files:** Create: `apps/api/migrations/0001_init.up.sql`, `0001_init.down.sql`, `internal/store/store.go`, `internal/store/store_test.go` (testcontainers)

**Interfaces:** Produces: schema spec §4 (+ cột `done` cho progress); `store.MigrateUp(databaseURL string) error`; test helper `store.TestPool(t) *pgxpool.Pool` (spin Postgres 16 container, migrate, trả pool — mọi integration test sau dùng).

- [ ] **Step 1:** `0001_init.up.sql` — nguyên văn:

```sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL, name text NOT NULL DEFAULT '',
  pw_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE courses (
  id text PRIMARY KEY, title text NOT NULL,
  visibility text NOT NULL DEFAULT 'private', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE progress (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id text NOT NULL, chapter_id text NOT NULL, status text NOT NULL,
  done boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, course_id, chapter_id, status));
CREATE TABLE annotations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id text NOT NULL, chapter_id text NOT NULL,
  anchor jsonb NOT NULL, note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, deleted_at timestamptz);
CREATE INDEX idx_progress_sync ON progress (user_id, updated_at);
CREATE INDEX idx_annotations_sync ON annotations (user_id, updated_at);
CREATE TABLE events (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id text NOT NULL, chapter_id text NOT NULL,
  kind text NOT NULL, meta jsonb NOT NULL DEFAULT '{}', at timestamptz NOT NULL);
CREATE INDEX idx_events_user_at ON events (user_id, at);
INSERT INTO courses (id, title) VALUES ('«giáo-trình-riêng»', '«Giáo trình riêng»');
```

- [ ] **Step 2: Test fail:** `store_test.go` — TestPool spin container `postgres:16-alpine`, MigrateUp, rồi `SELECT count(*) FROM courses` = 1.
- [ ] **Step 3:** Implement store.go (pgxpool + golang-migrate iofs từ embed.FS migrations). Chạy `make test-api` → PASS.
- [ ] **Step 4:** Commit: `feat(api): schema 0001 + migrate + testcontainers helper`

---

### Task 6: Auth

**Files:** Create: `internal/auth/{handler.go,usecase.go,repo.go,auth_test.go}` · Modify: `internal/server/server.go` (mount routes + middleware)

**Interfaces:** Produces: `POST /auth/register {email,password,name}` → 200 set-cookie; `POST /auth/login`; `POST /auth/logout`; `GET /me` → `{id,email,name}`; middleware `auth.Require(pool)` gắn `userID uuid` vào `c.Locals("uid")` — mọi handler sau dùng `auth.UID(c)`.

- [ ] **Step 1: Test fail** (integration, dùng `store.TestPool`): register → me (cookie) → logout → me 401; login sai mật khẩu → 401; register email trùng → 409.
- [ ] **Step 2:** RED xác nhận.
- [ ] **Step 3:** Implement: argon2id (`alexedwards/argon2id` defaults), session 30 ngày, cookie `tuhoc_session` HttpOnly+SameSite=Lax+Secure(cfg). Rate limit: `fiber/middleware/limiter` 10 req/phút cho `/auth/*`.
- [ ] **Step 4:** `make test-api` → PASS.
- [ ] **Step 5:** Commit: `feat(api): auth register/login/logout/me + session middleware`

---

### Task 7: Sync endpoints (LWW)

**Files:** Create: `internal/sync/{handler.go,usecase.go,repo.go,sync_test.go}` · Modify: server.go

**Interfaces:** Produces:
- `GET /sync?since=<RFC3339Nano>` → `{"progress":[…],"annotations":[…],"cursor":"<max updated_at>"}` (mọi row `updated_at > since` của user, kể cả `deleted_at != null` và `done=false`).
- `POST /sync` body `{"progress":[{courseId,chapterId,status,done,updatedAt}],"annotations":[{id,courseId,chapterId,anchor,note,createdAt,updatedAt,deletedAt}]}` → 200 `{"applied":n}`.
- Quy tắc LWW đóng trong SQL:

```sql
-- progress
INSERT INTO progress (user_id,course_id,chapter_id,status,done,updated_at)
VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT (user_id,course_id,chapter_id,status) DO UPDATE
SET done=EXCLUDED.done, updated_at=EXCLUDED.updated_at
WHERE EXCLUDED.updated_at > progress.updated_at;
-- annotations
INSERT INTO annotations (id,user_id,course_id,chapter_id,anchor,note,created_at,updated_at,deleted_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT (id) DO UPDATE
SET anchor=EXCLUDED.anchor, note=EXCLUDED.note,
    updated_at=EXCLUDED.updated_at, deleted_at=EXCLUDED.deleted_at
WHERE EXCLUDED.updated_at > annotations.updated_at
  AND annotations.user_id = EXCLUDED.user_id;
```

- [ ] **Step 1: Test fail** — 3 test integration: (a) push A rồi push B cũ hơn → giữ A; (b) **hội tụ 2 thiết bị**: device1 push x, device2 push y mới hơn, cả hai GET since=0 → cùng thấy y; (c) annotation của user khác không rò qua GET.
- [ ] **Step 2:** RED. **Step 3:** Implement (batch trong 1 transaction). **Step 4:** PASS.
- [ ] **Step 5:** Commit: `feat(api): LWW sync push/pull`

---

### Task 8: Events + stats

**Files:** Create: `internal/stats/{handler.go,repo.go,stats_test.go}` · Modify: server.go

**Interfaces:** Produces: `POST /events/batch` body `{"events":[{courseId,chapterId,kind:"heartbeat",meta:{},at}]}`; `GET /stats` →

```json
{ "totalMinutes": 372, "streakDays": 5,
  "days": [{"date":"2026-08-19","minutes":42}],
  "courses": [{"courseId":"«giáo-trình-riêng»","minutes":372,"chaptersDone":12}] }
```

Quy đổi: mỗi heartbeat = 0.5 phút (interval 30s). `days` = 30 ngày gần nhất. Streak = số ngày liên tiếp tính từ hôm nay có ≥1 heartbeat.

- [ ] **Step 1: Test fail** — seed events 3 ngày (hôm nay, hôm qua, cách 3 ngày) → streak=2, minutes đúng tổng. **Step 2:** RED. **Step 3:** SQL `date_trunc('day', at)` + đếm; streak tính trong Go từ mảng days. **Step 4:** PASS. **Step 5:** Commit: `feat(api): events + stats`

---

### Task 9: Web scaffold + shell v1

**Files:** Create: `apps/web/*` (vite + react-ts), `src/styles/` import `reader.css` + `vendor/katex.css` từ course-kit (đường dẫn tương đối monorepo qua vite alias `@course-kit`), `src/App.tsx` dựng đúng DOM skeleton v1: `#app > #sidebar + #main(#topbar, #progwrap, #scroller > #content-wrap > #content + #rail)`.

**Interfaces:** Produces: component `<Shell sidebar topbar children rail>`; theme hook `useTheme()` (persist key `itbook-theme`, set `data-theme` trên `<html>`, gọi `CourseKit.REDRAWS` sau toggle); route skeleton `/`, `/login`, `/c/:courseId`, `/c/:courseId/:chapterId`.

- [ ] **Step 1:** `bun create vite` (react-ts), thêm router/query/dexie; vite alias `@course-kit` → `../../packages/course-kit`, và copy `courses/` vào `public/courses/` khi build (vite plugin static copy; dev dùng `publicDir` trỏ symlink). Test smoke (vitest + testing-library): render App → thấy `#app`.
- [ ] **Step 2:** Test theme: toggle → `document.documentElement.dataset.theme` đổi + localStorage ghi. RED → implement → GREEN.
- [ ] **Step 3:** Commit: `feat(web): scaffold + v1 shell skeleton + theme`

---

### Task 10: Course loader + trang course

**Files:** Create: `src/course/{loader.ts,types.ts}`, `src/pages/CourseHome.tsx`, test `src/course/loader.test.ts` (MSW)

**Interfaces:** Produces:

```ts
type Chapter = { id: string; num: string; title: string; short: string; file: string };
type Part = { title: string; chapters: Chapter[] };
type Manifest = { id: string; title: string; description: string; lang: string;
                  version: string; runtime: string; parts: Part[] };
loadManifest(courseId: string): Promise<Manifest>        // fetch /courses/<id>/manifest.json + check runtime ^1
loadChapter(courseId: string, file: string): Promise<string>
```

CourseHome: tiêu đề, mô tả, danh sách parts/chapters (nav giống sidebar v1), progress ring per part (dữ liệu từ Task 13).

- [ ] **Step 1:** Test loader với MSW: manifest hợp lệ parse đúng; `runtime:"^2"` → throw `RuntimeMismatchError`. RED → implement (semver check tự viết 5 dòng: major === 1). GREEN.
- [ ] **Step 2:** CourseHome render từ manifest mock; test: 44 link chương.
- [ ] **Step 3:** Commit: `feat(web): course loader + course home`

---

### Task 11: Reader — chapter render parity

**Files:** Create: `src/reader/{ChapterView.tsx,useCourseKit.ts,getContext.ts}`, `src/pages/Reader.tsx`

**Interfaces:**
- Consumes: `loadChapter`, globals course-kit (load 1 lần qua `useCourseKit`).
- Produces: `useCourseKit(): {ready: boolean}` — inject `<script>` tuần tự: vendor/katex.js → vendor/auto-render.js → runtime.js → `/courses/<id>/viz.js`, chỉ 1 lần/app. `ChapterView({courseId, chapter})` — set innerHTML fragment vào `#content`, gọi `CourseKit.renderKatex(el)` rồi `CourseKit.initViz(el)`, dựng rail TOC từ `h2/h3`, pager ←/→ theo manifest, phím tắt như v1. **`getContext(): {courseId, chapterId, headingTrail, selection?, sectionHTML}`** (spec §6 — ổ cắm AI; headingTrail = h1 + h2 gần nhất trên scroll position; sectionHTML = HTML từ h2 hiện tại tới h2 kế).
- Route `/c/:courseId/:chapterId` dùng ChapterView; đọc xong scroll đầu trang; document.title như v1.

- [ ] **Step 1:** Test (jsdom, canvas không chạy — mock `CourseKit`): fragment có `$x$` + `[data-viz=aep]` → renderKatex và initViz được gọi đúng 1 lần với element chứa fragment; rail có mục cho mỗi h2; getContext trả headingTrail đúng với DOM giả. RED → implement → GREEN.
- [ ] **Step 2:** Chạy dev thật (`make dev-web`) mở `p2-10`: KaTeX render, waterfill chạy, console 0 lỗi — ghi nhận thủ công vào PR note.
- [ ] **Step 3:** Commit: `feat(web): reader with katex + viz runtime + getContext`

---

### Task 12: Auth UI + API client

**Files:** Create: `src/api/client.ts`, `src/pages/Login.tsx`, guard route.

**Interfaces:** Produces: `api.get/post(path, body?)` (fetch, `credentials:'include'`, baseURL từ `VITE_API_URL`, 401 → redirect /login); `useMe()` query; `<RequireAuth>` wrapper. Login page: form đăng nhập + đăng ký (2 tab), lỗi hiển thị inline.

- [ ] **Step 1:** Test MSW: 401 → redirect; login ok → useMe có data. RED → implement → GREEN.
- [ ] **Step 2:** Commit: `feat(web): auth ui + client`

---

### Task 13: Local store + sync engine

**Files:** Create: `src/db/local.ts`, `src/sync/engine.ts`, tests với `fake-indexeddb` + MSW.

**Interfaces:** Produces:

```ts
// local.ts (Dexie)
db.progress: { courseId, chapterId, status, done, updatedAt }   // PK [courseId+chapterId+status]
db.annotations: { id, courseId, chapterId, anchor, note, createdAt, updatedAt, deletedAt }
db.outbox: { seq++, table: 'progress'|'annotations'|'events', row }
db.meta: { key, value }                                          // 'syncCursor'
setProgress(courseId, chapterId, status, done): Promise<void>    // ghi local + outbox, updatedAt = new Date().toISOString()
// engine.ts
startSync(): void   // loop: khi online + đăng nhập → flush outbox (POST /sync, POST /events/batch) → GET /sync?since=cursor → merge LWW vào Dexie → cursor = resp.cursor; chạy mỗi 15s + khi 'online' event
// QUAN TRỌNG (ruling sau review T7): `cursor` là GIÁ TRỊ ĐỤC do server cấp, đã có sẵn độ trễ an toàn 60s.
// Client lưu và gửi lại NGUYÊN VĂN — không parse, không tự trừ lề, không thay bằng max(updatedAt) của mình.
// Hệ quả: mỗi lần poll sẽ nhận lại vài row trong cửa sổ 60s. Đó là CHỦ ĐÍCH; mergeRow idempotent nên vô hại.
// Test bắt buộc: nhận lại row đã có (cùng updatedAt) không được tạo bản ghi trùng hay đảo ngược trạng thái.
mergeRow(local, incoming): Row                                   // pure: updatedAt lớn hơn thắng — export để test
```

- [ ] **Step 1:** Test pure `mergeRow` (4 case: incoming mới hơn/cũ hơn/bằng/local rỗng). Test engine: outbox 2 mutation → MSW nhận đúng batch → outbox rỗng; server trả row mới hơn → Dexie cập nhật. RED → implement → GREEN.
- [ ] **Step 2:** Commit: `feat(web): offline-first store + LWW sync engine`

---

### Task 14: Progress UI + dashboard

**Files:** Create: `src/progress/useProgress.ts`, `src/pages/Dashboard.tsx` · Modify: `Reader.tsx`, `CourseHome.tsx`

**Interfaces:** Produces: `useProgress(courseId)` → `{isRead(ch), toggleRead(ch), exDone(ch,n), toggleEx(ch,n), partStats}`; nút "Đã học" trên topbar reader (trạng thái như v1: ○/✓); checkbox tự tiêm vào mỗi `.box.ex .box-h` sau render (`ex:<index>`); Dashboard: card per course (title, ring % chương done, streak + minutes từ `GET /stats`, biểu đồ 30 ngày bằng div bars thuần CSS).

- [ ] **Step 1:** Test useProgress (fake-indexeddb): toggle → setProgress ghi outbox; partStats đếm đúng. Test tiêm checkbox trên fragment mẫu có 2 `.box.ex`. RED → implement → GREEN.
- [ ] **Step 2:** Commit: `feat(web): progress ui + dashboard`

---

### Task 15: Heartbeat

**Files:** Create: `src/progress/heartbeat.ts` + test.

**Interfaces:** Produces: `startHeartbeat(getCtx: () => {courseId, chapterId} | null)` — mỗi 30s, nếu tab visible và có user activity (pointer/key/scroll) trong 60s gần nhất → đẩy event `{kind:'heartbeat', at}` vào outbox. Gọi từ Reader mount.

- [ ] **Step 1:** Test với vi.useFakeTimers: visible + activity → 1 event/30s; tab hidden → 0. RED → implement → GREEN. Commit: `feat(web): study heartbeat`

---

### Task 16: Deploy artifacts

**Files:** Create: `apps/api/fly.toml`, `render.yaml`, `apps/web/wrangler.toml` (Pages), `.env.example` (API: PORT, DATABASE_URL, CORS_ORIGIN, COOKIE_SECURE; WEB: VITE_API_URL), `docs/deploy.md`

- [ ] **Step 1:** Viết config 3 file + deploy.md: bước tạo Neon → migrate (`migrate -path migrations -database $DATABASE_URL up` hoặc api tự migrate on-boot với flag `MIGRATE_ON_BOOT=1`) → Fly hoặc Render → Pages (`bun run build`, output `dist/`, copy `courses/` + `packages/course-kit` vào dist). Build production local: `bun run build` OK + `docker build` OK là gate.
- [ ] **Step 2:** Commit: `chore: deploy configs + docs`

---

### Task 17: E2E gate P1 (DoD)

**Files:** Create: `apps/web/e2e/p1.spec.ts` (Playwright), `apps/web/playwright.config.ts`; Makefile target `test-e2e` (spin api + postgres qua docker compose `apps/api/compose.e2e.yml`).

- [ ] **Step 1:** Viết e2e:

```ts
test('P1 DoD: đọc + sync 2 thiết bị', async ({ browser }) => {
  const a = await browser.newContext(); const p1 = await a.newPage();
  await p1.goto('/login'); await register(p1, 'e2e@tuhoc.dev', 'secret123');
  await p1.goto('/c/«giáo-trình-riêng»/p2-10');
  await expect(p1.locator('.katex').first()).toBeVisible();
  await expect(p1.locator('[data-viz="waterfill"] canvas')).toBeVisible();
  const errors: string[] = []; p1.on('pageerror', e => errors.push(String(e)));
  await p1.click('#mark-btn'); await p1.waitForTimeout(16000);      // chờ 1 chu kỳ sync
  const b = await browser.newContext(); const p2 = await b.newPage();
  await login(p2, 'e2e@tuhoc.dev', 'secret123');
  await p2.goto('/c/«giáo-trình-riêng»');
  await expect(p2.locator('[data-ch="p2-10"].done')).toBeVisible(); // tiến độ hiện trên "thiết bị 2"
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2:** Chạy `make test-e2e` → PASS. So màn hình 3 chương mẫu (p0-1, p2-10, p4-4) với v1 bằng mắt — ghi chú khác biệt vào `docs/parity-notes.md` (chấp nhận được: khác nhỏ về spacing; không chấp nhận: mất viz, vỡ công thức, mất box).
- [ ] **Step 3:** Commit: `test(e2e): P1 definition-of-done gate`

---

## Self-Review P1

- Spec coverage §2 (layout) T1; §3 (package + validate) T2–T3; §4 (schema/API/LWW/bảo mật) T4–T8; §5 (reader/state/progress) T9–T15; §6 (getContext) T11; §7 (deploy) T16; §9 (kiểm thử) T2,5,7,17. Gap: service worker precache — spec đánh dấu "P2 nếu kịp", không thuộc DoD P1 → để P2.
- Type consistency: `status` dạng `'read' | 'ex:<n>'` dùng thống nhất T5/T7/T13/T14; cursor RFC3339Nano thống nhất T7/T13; cookie `tuhoc_session` T6/T12.

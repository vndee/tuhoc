# Tuhoc — Nền tảng tự học đa khóa học

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

**Ngày:** 2026-08-19 · **Trạng thái:** Đã duyệt thiết kế tổng thể, chờ review spec
**Bối cảnh:** Xuất phát từ một giáo trình tương tác **riêng tư** của tác giả (single-file HTML 1.9MB, 45 chương, 59 mô phỏng canvas, 202 bài tập — đã tag `v1-single-file` tại repo `~/Documents/claude/Research`). Chủ nhân dùng để tự học trên nhiều thiết bị, sau này publish cho người khác dùng.

## 1. Mục tiêu và phạm vi

**Mục tiêu:**
- Một website tự học chứa nhiều khóa học; giáo trình riêng của tác giả là course đầu tiên.
- Đánh dấu "đã học", highlight + comment đoạn văn bản (hiển thị ở rãnh phải), track progress — đồng bộ qua nhiều thiết bị.
- Chuẩn bị sẵn chỗ cắm AI agent (hỏi đáp, đào sâu nội dung đang học).
- Về sau publish cho người dùng khác mà không phải đổi kiến trúc.

**Ngoài phạm vi (cố ý):**
- UI soạn khóa học — course soạn bằng file + Claude Code, commit vào repo.
- CRDT/collab realtime — dữ liệu cá nhân một người sửa, LWW đủ đúng.
- Mobile app native — web responsive là đủ.

**Tiêu chí thành công P1:** học trên 2 thiết bị, trải nghiệm đọc ngang bản single-file hiện tại (KaTeX, viz, dark mode, bài tập), tiến độ đồng bộ tự động.

## 2. Kiến trúc tổng thể

```
tuhoc/
├── apps/
│   ├── web/                 # React 18 + Vite + Bun. Shell, reader, annotation engine
│   └── api/                 # Go/Fiber, clean architecture. Auth, sync, stats, AI proxy
├── packages/
│   └── course-kit/          # JS runtime dùng chung giữa các course:
│                            #   - Plot engine + helpers (port từ v1)
│                            #   - KaTeX (vendored) + auto-render
│                            #   - CSS tokens/reader styles (port từ v1)
├── courses/
│   └── «giáo-trình-riêng»/  # course package đầu tiên (tách từ v1 bằng tools/extract.py)
├── tools/
│   └── extract.py           # one-shot: parse file v1 → course package + validate
└── docs/superpowers/specs/
```

**Nguyên tắc trung tâm:** *course = dữ liệu tĩnh, platform = code.* Content không nằm trong DB; DB chỉ giữ dữ liệu người học (progress, annotation, events, AI threads). Course package deploy như static asset cạnh frontend.

**Luồng dữ liệu:** Browser tải shell (CF Pages) → tải manifest + chapter fragment + viz.js của course (static) → render KaTeX/viz client-side → mutation của người học (đánh dấu, highlight, comment) ghi vào IndexedDB trước, sync lên API sau (offline-first).

## 3. Course package format

```
courses/<slug>/
├── manifest.json
├── chapters/<chapter-id>.html      # HTML fragment, giữ nguyên markup v1 (data-viz hooks, box def/thm/intu…, bài tập)
└── viz.js                          # defineViz(...) của riêng course; chạy trên runtime course-kit
```

`manifest.json`:
```json
{
  "id": "«giáo-trình-riêng»",
  "title": "«Giáo trình riêng»",
  "description": "«mô tả của giáo trình riêng»",
  "lang": "vi",
  "version": "1.0.0",
  "runtime": "^1",
  "parts": [
    { "title": "Phần 0 · Nền móng",
      "chapters": [ { "id": "p0-1", "num": "0.1", "title": "…", "short": "…", "file": "chapters/p0-1.html" } ] }
  ]
}
```

- `runtime: "^1"` — semver của course-kit mà course cần; shell từ chối load nếu lệch major.
- Chapter id giữ nguyên (`p0-1` … `p4-10`, `appx`) để không phá cross-reference `#hash` trong nội dung.

**tools/extract.py** — tách file v1:
1. Parse các block `<script type="text/html" id="tpl-*">` → chapters/*.html.
2. Cắt phần `defineViz(...)` → viz.js; cắt Plot engine + helpers + CSS tokens → packages/course-kit (một lần, thành runtime chung).
3. Sinh manifest từ registry `const CH=[...]`.
4. **Validate (bắt buộc pass):** đủ 44 chương (43 chương đánh số + phụ lục; trang home của v1 trở thành trang course `/c/:course`); 59 tên `data-viz` khớp 59 `defineViz`; số ký tự `$` từng chương giữ nguyên so với v1; không chương nào chứa chuỗi đóng script.

## 4. Backend — Go/Fiber, clean architecture

Layout chuẩn Go (handler → usecase → repository), Postgres qua pgx, migration bằng golang-migrate.

**Schema (P1 + P2; AI ở P3):**
```sql
users        (id uuid PK, email citext UNIQUE, name text, pw_hash text, created_at)
sessions     (id uuid PK, user_id FK, expires_at, created_at)          -- cookie session
courses      (id text PK, title text, visibility text DEFAULT 'private', created_at)
progress     (user_id, course_id, chapter_id, status text,             -- 'read' | exercise key
              updated_at, PRIMARY KEY(user_id, course_id, chapter_id, status))
annotations  (id uuid PK, user_id, course_id, chapter_id,
              anchor jsonb,          -- {exact, prefix, suffix, color}
              note text, created_at, updated_at, deleted_at)           -- soft delete = tombstone
events       (id bigserial, user_id, course_id, chapter_id,
              kind text, meta jsonb, at timestamptz)                   -- heartbeat học tập
ai_threads   (id uuid PK, user_id, course_id, chapter_id, title, created_at)      -- P3
ai_messages  (id uuid PK, thread_id FK, role, content, created_at)                -- P3
```

**API (REST, JSON):**
```
POST /auth/register | /auth/login | /auth/logout        # argon2id, cookie HttpOnly+Secure+SameSite=Lax
GET  /me
GET  /courses                                           # registry + trạng thái enroll
GET  /sync?since=<cursor>                               # progress + annotations đổi từ cursor (updated_at, id)
POST /sync                                              # batch mutations [{table, op, row}]
POST /events/batch                                      # heartbeat 30s/lần khi tab active
GET  /stats                                             # tổng hợp cho dashboard (time/chapter/streak)
POST /ai/chat                                           # P3: SSE stream, proxy Claude API (key server-side)
```

**Giao thức sync (LWW):**
- Client giữ hàng đợi mutation trong IndexedDB; mỗi row có `updated_at` do client sinh tại thời điểm sửa.
- `POST /sync` upsert theo quy tắc: ghi đè nếu `incoming.updated_at > existing.updated_at` (xóa = tombstone `deleted_at`, so sánh cùng quy tắc).
- `GET /sync?since=` trả mọi row có `updated_at > since` (kể cả tombstone); client merge cùng quy tắc → hai chiều hội tụ.
- **Cursor có độ trễ an toàn (sửa 2026-08-19 sau review T7).** Server KHÔNG trả `max(updated_at)` làm cursor, mà trả `max(maxUpdatedAt − 60s, since)`. Lý do: thứ tự commit không trùng thứ tự `updated_at` — máy A bắt đầu push (`T1`) nhưng commit chậm, máy B push (`T2 > T1`) commit trước, client poll xen giữa sẽ đẩy watermark lên `T2` và row của A **vĩnh viễn** không còn thỏa `updated_at > T2` → mất dữ liệu âm thầm. Độ trễ 60s khiến row commit muộn được gửi lại ở lần poll sau; merge LWW vốn idempotent nên gửi lại vô hại. Giới hạn còn lại: transaction sống lâu hơn 60s (workload này là mili-giây). Cursor là **giá trị đục** với client — client dùng nguyên văn, không tự trừ lề (nếu đúng/sai phụ thuộc kỷ luật của client thì một bug client sẽ thành mất dữ liệu).
- Xung đột thực tế (sửa cùng annotation trên 2 máy trong cùng giây) chấp nhận mất một bên — dữ liệu cá nhân, rủi ro thấp.

**Bảo mật P1:** rate-limit auth endpoints; CORS chỉ cho origin của Pages; không log nội dung note.

## 5. Frontend — React/Vite/Bun

**Routes:** `/` dashboard (course cards, progress ring, streak, thời gian học 30 ngày) · `/c/:course` trang course (TOC + tiến độ từng phần) · `/c/:course/:chapter` reader.

**Reader:** render chapter fragment vào container có scoped styles (port nguyên CSS tokens v1 — trải nghiệm đọc không đổi), chạy KaTeX auto-render + viz runtime từ course-kit, pager ←/→, rail phải, dark mode, phím tắt như v1. Trang in giữ nguyên print stylesheet.

**State:** TanStack Query cho server state; Dexie (IndexedDB) cho local store + outbox sync. App usable offline với course đã cache (service worker precache course package — P2 nếu kịp, không phải điều kiện P1).

**Annotation engine (P2 — phần khó nhất):**
- Chọn văn bản trong vùng prose (`p, li, td, .box`) → toolbar nổi: 4 màu highlight + "Ghi chú".
- **Anchor thuật toán:** chuẩn hóa văn bản chương thành chuỗi phẳng, trong đó mỗi khối `.katex` là **một token nguyên tử** (tránh văn bản nhân ba mathml/html của KaTeX; selection snap quanh token). Anchor = `{exact, prefix≤64, suffix≤64}` trên chuỗi chuẩn hóa (W3C Web Annotation text-quote).
- **Re-attach khi mở chương:** tìm `exact` với ràng buộc prefix/suffix; fallback fuzzy (khoảng cách Levenshtein có ngưỡng); thất bại → annotation vào panel "Ghi chú mồ côi", một click gắn lại thủ công. Không bao giờ tự xóa.
- **Hiển thị:** desktop ≥1240px — comment cards ở rãnh phải, canh theo Y của highlight, xếp chồng khi va nhau, kẻ connector mảnh; rail phải thành 2 tab "Trong chương" / "Ghi chú (n)". Màn hẹp — chạm highlight mở bottom sheet.

**Progress (P1):** nút "Đã học" per chương (như v1) + checkbox per bài tập (map vào `progress.status='ex:<n>'`); heartbeat 30s khi tab active + user hoạt động trong 60s gần nhất → `events` → dashboard.

## 6. AI agent (P3) — ổ cắm thiết kế từ P1

- Reader expose interface ổn định:
  ```ts
  getContext(): { courseId, chapterId, headingTrail: string[], selection?: string, sectionHTML: string }
  ```
- P3: bôi chọn → "Đào sâu" / nút "Hỏi AI" ở rail → panel chat phải; `POST /ai/chat` (SSE) với context trên; backend giữ API key (env), lưu thread theo chương; system prompt nêu rõ course + chương + đoạn đang đọc.
- Multi-user sau này: quota per user, hoặc user tự nhập key (mã hóa at-rest).

## 7. Triển khai (ưu tiên hạ tầng miễn phí)

| Thành phần | Nơi chạy | Ghi chú |
|---|---|---|
| apps/web + courses/* | Cloudflare Pages | tĩnh 100%, deploy bằng wrangler |
| apps/api | Container duy nhất — Fly.io free / Render free / VPS | Dockerfile multi-stage, binary Go |
| Postgres | Neon free tier | pgx + pooling |

Publish cho người khác (P4): thêm OAuth (GitHub/Google), `courses.visibility='public'`, quota AI, landing. Không đổi kiến trúc.

## 8. Lộ trình

- **P1 — Nền (làm trước):** scaffold monorepo; extract.py + course-kit; reader parity v1; auth + progress sync + dashboard tối thiểu. *DoD: học trên 2 thiết bị, tiến độ đồng bộ, trải nghiệm đọc không tụt so với v1.*
- **P2 — Annotation:** engine highlight/comment + margin cards + orphan + outbox offline.
- **P3 — AI tutor:** panel chat + SSE proxy + threads.
- **P4 — Publish:** OAuth, public courses, quota, landing.

## 9. Kiểm thử

- **extract.py:** bộ validate ở §3 là gate; diff render 3 chương mẫu (p0-1, p2-10, p4-4) giữa v1 và reader mới bằng screenshot so sánh thủ công.
- **api:** unit cho usecase (LWW merge, tombstone); integration testcontainers Postgres cho /sync hai-thiết-bị hội tụ.
- **web:** unit cho anchor normalize/re-attach (bộ case: sửa chính tả, chèn câu, xóa đoạn, quanh KaTeX); e2e mỏng (Playwright): login → đọc → đánh dấu → reload máy "thứ hai" thấy tiến độ.

## 10. Rủi ro chính

| Rủi ro | Ứng phó |
|---|---|
| Anchor vỡ trên DOM KaTeX | token nguyên tử + bộ test riêng; orphan panel là lưới an toàn |
| Free tier ngủ (Render) làm sync chậm | offline-first nên không chặn trải nghiệm; retry backoff |
| Tách viz khỏi shell v1 sót phụ thuộc ngầm | validate 59 viz chạy không lỗi console trong reader mới trước khi coi P1 xong |

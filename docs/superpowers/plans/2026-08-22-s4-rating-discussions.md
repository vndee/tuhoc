# Hệ thống con 4 — Rating + Discussions — Kế hoạch triển khai

> **Dành cho người thực thi bằng agent:** BẮT BUỘC dùng skill `superpowers:subagent-driven-development`
> hoặc `superpowers:executing-plans`. Các bước dùng checkbox (`- [ ]`).

**Mục tiêu:** Người học chấm sao cho course **trên registry**, catalog sắp theo điểm; mỗi course có
một Discussion trên repo registry, nền tảng **nhúng đọc** và nút đăng dẫn sang GitHub.

**Kiến trúc:** Rating tự làm (Postgres, một phiếu mỗi người mỗi course, sửa được). Bình luận **không
tự làm** — GitHub Discussions giữ nội dung, server ta chỉ đọc và cache.

**Spec:** `docs/superpowers/specs/2026-08-20-platform-v2-design.md` §5, và §8 (hai món nợ chặn).

---

## Ba hiệu chỉnh — tiền kiểm trên mã thật ngày 2026-08-22

### HC-1. Đây là hệ thống con MỞ CỬA CHO NGƯỜI LẠ, nên hai món nợ cũ trở thành CHẶN

Spec §8 ghi rõ nợ **C-1** và **C-3** *"vẫn phải xử lý trước khi mở cho người lạ"*. Hệ thống con 4 **là**
lúc mở cửa. Đo lại trạng thái hôm nay:

**C-1 — rò rỉ chéo tài khoản qua nhiều tab: CÒN MỞ, và không có điều kiện nào làm nó vô hại.**
`<Navigate>` guard ở `/login` và state của sync engine (`syncEpoch`, `timer`, `inFlight`) đều **theo
từng tab**. Tab 2 đang mở phiên của A **vẫn tiếp tục đồng bộ dưới cookie của B** sau khi tab 1 đăng
nhập lại. Đây là **Task 1** của kế hoạch này, đứng trước mọi thứ khác — một nền tảng có rating và
thảo luận công khai mà rò dữ liệu giữa hai tài khoản thì mọi thứ dựng trên nó đều vô nghĩa.

**C-3 — CSRF khi dùng `SameSite=None`: CÓ ĐIỀU KIỆN, và điều kiện ấy có thể đã tự tan.**
Đo: cookie hiện đặt `SameSite=Lax` (`apps/api/internal/auth/handler.go:164,180`). C-3 chỉ cắn nếu
chọn phương án **tên miền miễn phí** ở `docs/deploy.md` §0, thứ bắt buộc `None`. Chủ dự án **đã có
`duy.dev`** và đã chốt bố cục `tuhoc.duy.dev` + `vault.duy.dev` — cùng site, nên `Lax` là đủ.
⇒ **Đây có thể là món nợ đóng được bằng một QUYẾT ĐỊNH chứ không phải bằng mã.** Task 2 phải làm đúng
một việc: **ghi quyết định ấy ra thành ràng buộc có cổng** — một test khẳng định cookie không bao giờ
là `None`, để không ai sáu tháng sau đổi nó mà không nhận ra mình vừa mở một bề mặt CSRF.

### HC-2. Đây là lần ĐẦU TIÊN server ta giữ một bí mật — và điều đó phải được nói rõ

Toàn bộ danh tính của hệ thống con 2 là *"key không bao giờ đi qua máy chủ của chúng ta"*, cưỡng chế
bằng **sáu phép quét nguồn** (`no_key_transit_test.go`, `noKeyLeak.test.ts`).

Spec §5 nói server giữ **token GitHub** để đọc Discussions. Đó là một bí mật **của chúng ta**, không
phải của người dùng — khác hẳn về bản chất. Nhưng nếu không nói rõ, người đọc mã sau này sẽ thấy
"server có giữ token đấy thôi" và dùng nó làm tiền lệ để nới lời hứa kia.

⇒ **Bắt buộc:** token GitHub đặt tên và đặt chỗ sao cho **không dây bẫy nào của hệ 2 đỏ**, và chú
thích ngay tại chỗ khai báo phải nói rõ: *đây là thông tin xác thực của MÁY CHỦ với GitHub, không phải
của người dùng với nhà cung cấp AI; lời hứa ở §3.2 không bị nới.* Nếu thêm token làm một trong sáu
phép quét đỏ → **DỪNG và báo**, đó là tín hiệu đặt sai chỗ.

### HC-3. `course_ratings` chưa tồn tại, và khoá chính là một quyết định AN NINH

Migration hiện có: `0001_init`, `0002_course_packages`, `0003_drop_seed_course`. Không có bảng rating.

Bài học từ hệ thống con 1, phải chép lại: `course_packages` đặt `owner_id` **trong khoá chính**, và
`Put(ctx, ownerID, p)` nhận owner **làm tham số chứ không phải trường của struct** — nên một trường
client gửi lên **không lái được phép ghi**. Bốn test ở ba tầng canh điều đó, gồm một **bất biến cấu
trúc** (`TestNoRouteReadsOwnerFromTheRequest`).

⇒ `course_ratings` làm **y hệt**: `PRIMARY KEY (user_id, registry_id)`, `user_id` từ phiên chứ không
từ body, và **cùng bốn tầng test**. Đừng phát minh lại khuôn; chép khuôn đã được chứng minh.

---

## Global Constraints

- **Rating CHỈ cho course trên registry.** Course riêng tư và course import từ tệp **không có** rating
  — spec §5 nói rõ vì sao: không có gì để so sánh giữa những người dùng khác nhau. Đây cũng là hàng
  rào riêng tư: một course riêng tư **không được** xuất hiện ở bất kỳ bảng xếp hạng nào.
- **Một phiếu mỗi người mỗi course, sửa được.** Không ẩn danh nhiều phiếu.
- **Bình luận không tự làm.** Nội dung sống ở GitHub Discussions; ta chỉ đọc và cache theo TTL.
- **Không dây bẫy nào của hệ thống con 2 được đỏ** (xem HC-2).
- `erasableSyntaxOnly` **cấm tham số-thuộc tính** (TS1294) — đã cắn **ba lần**.
- `tsc -b`, **không** `tsc --noEmit`. `make` thoát **2** khi rule lỗi.
- **`rtk` không trung thực** — dùng `/bin/cat`, `/usr/bin/grep`, `/usr/bin/git`, `rtk proxy`, in **mã
  thoát thô**. `go test` **cache**: dùng `-count=1` khi cần chạy tươi.
- **Tiến trình nền bị giết trong CÙNG lệnh shell**, giết **theo cổng**.

---

## Task 1: Đóng C-1 — rò rỉ chéo tài khoản qua nhiều tab

**Files:** Modify `apps/web/src/sync/engine.ts`, `apps/web/src/auth/`, `apps/web/src/api/useMe.ts`

**Đây là task đứng trước mọi thứ khác.** Nó không thuộc "rating" hay "discussions", nhưng spec §8
xếp nó vào giai đoạn này và lý do rất cụ thể: publish làm kịch bản hai-tab **dễ xảy ra hơn nhiều**.

- [ ] **Step 1: Test đỏ — tái hiện phép rò**

Không viết test kiểu "BroadcastChannel có hoạt động". Viết test kiểu **"dữ liệu của A không tới server
dưới cookie của B"**:

```ts
it('tab 2 đang mở phiên A dừng đồng bộ khi tab 1 đăng nhập thành B', async () => {
  // tab2: startSync() với user A
  // tab1: đăng nhập B  → phát tín hiệu liên tab
  // khẳng định: tab2 KHÔNG còn gửi request đồng bộ nào nữa
  // và khẳng định NGƯỢC: trước tín hiệu, nó CÓ gửi (nếu không, bài kiểm rỗng)
});
```

Khẳng định ngược **bắt buộc**: không có nó, một cài đặt không bao giờ đồng bộ cũng xanh.

- [ ] **Step 2: Chạy — ĐỎ.** Dán RED.
- [ ] **Step 3: Cài đặt** — `BroadcastChannel` (hoặc `storage` event làm dự phòng). Danh tính người
  dùng hiện hành phải là **một nguồn sự thật liên tab**, không phải state theo tab.
- [ ] **Step 4: Đối chứng hai chiều** — gỡ phần điều phối liên tab thì test **phải đỏ**.
- [ ] **Step 5: Ghi vào `docs/carried-forward.md`** rằng C-1 đã đóng, **kèm cách kiểm lại**.
- [ ] **Step 6: Commit** `fix(web): đóng C-1 — dừng đồng bộ ở mọi tab khi danh tính đổi`

---

## Task 2: Chốt C-3 bằng cổng, không bằng lời

**Files:** Create test trong `apps/api/internal/auth/`, modify `docs/deploy.md`

- [ ] **Step 1: Test đỏ-được** — khẳng định cookie phiên **không bao giờ** `SameSite=None`:

```go
func TestSessionCookieIsNeverSameSiteNone(t *testing.T) {
    // Quét mọi chỗ đặt cookie phiên. `None` không kèm kiểm Origin/CSRF là bề
    // mặt tấn công thật (nợ C-3), và chuỗi "CSRF" không xuất hiện ở đâu trong
    // repo ngoài carried-forward.md — tức hôm nay KHÔNG có phòng thủ nào.
}
```

- [ ] **Step 2: Đối chứng** — đổi một chỗ sang `None` → **phải đỏ**.
- [ ] **Step 3:** `docs/deploy.md` §0 nói rõ: chọn phương án tên miền miễn phí thì **bắt buộc** kèm
  kiểm Origin hoặc CSRF token, **và test ở Step 1 phải được thay bằng thứ mạnh hơn trước khi đổi**.
- [ ] **Step 4: Commit** `test(api): chốt C-3 — cookie phiên không bao giờ SameSite=None`

---

## Task 3: Bảng `course_ratings` + tầng Go

**Files:** Create `apps/api/migrations/0004_course_ratings.{up,down}.sql`,
`apps/api/internal/rating/{repo.go,usecase.go,handler.go,rating_test.go}`

**Interfaces:** `Put(ctx, userID uuid.UUID, registryID string, stars int) error` — **userID là tham
số, không phải trường của struct** (khuôn đã được chứng minh ở `course_packages`).

```sql
CREATE TABLE course_ratings (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registry_id text NOT NULL,
  stars       smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, registry_id));
```

- [ ] **Step 1: Bốn test, ba tầng** — chép đúng khuôn đã chứng minh ở hệ thống con 1:
  `TestUserCannotOverwriteAnotherUsersRating` · `TestListReturnsAggregateNotVoters` ·
  `TestPostIgnoresClientSuppliedUserID` · `TestNoRouteReadsUserFromTheRequest`.
- [ ] **Step 2: Chạy — ĐỎ.** Dán RED.
- [ ] **Step 3–4:** migration + repo/usecase/handler; `PUT /ratings/:registryId`, `GET /ratings`.
- [ ] **Step 5: Riêng tư** — `GET /ratings` **không được** trả về danh tính người chấm, chỉ trả trung
  bình + số phiếu + **phiếu của chính người gọi**. Có test cho điều này.
- [ ] **Step 6: Commit** `feat(api): rating cho course registry`

---

## Task 4: Giao diện rating + sắp xếp catalog

**Files:** Create `apps/web/src/registry/Rating.tsx`; modify `registry/Catalog.tsx`

- [ ] **Step 1: Test đỏ** — course **không thuộc registry** (riêng tư, hoặc import từ tệp) **không
  hiện ô chấm sao nào**. Đây là hàng rào riêng tư, không phải chi tiết giao diện; nó phải có test và
  một mutant thêm ô chấm vào course riêng tư phải **đỏ**.
- [ ] **Step 2–4:** ô chấm sao sửa được, catalog sắp theo trung bình + số phiếu, hiện cả hai con số
  (một course 5 sao / 1 phiếu **không** được trông giống 5 sao / 200 phiếu).
- [ ] **Step 5: Commit** `feat(web): chấm sao và sắp xếp catalog`

---

## Task 5: Nhúng đọc GitHub Discussions

**Files:** Create `apps/api/internal/discuss/{client.go,handler.go,cache.go}` + test;
`apps/web/src/registry/Discussion.tsx`

- [ ] **Step 1: HC-2 trước tiên** — thêm token GitHub, rồi **chạy cả sáu phép quét** của hệ thống con
  2 (`make test-api`, `noKeyLeak.test.ts`). Nếu một cái đỏ → **DỪNG và báo**. Chú thích tại chỗ khai
  báo token phải nói rõ nó là thông tin xác thực **của máy chủ với GitHub**, và lời hứa §3.2 **không
  bị nới**.
- [ ] **Step 2: Test đỏ — cache TTL và hỏng-thì-suy-giảm**

GitHub là bên thứ ba: nó sẽ chậm, sẽ giới hạn tần suất, sẽ 500. **Hỏng phải suy giảm thành "chưa tải
được thảo luận", không được làm hỏng trang course.** Đây đúng lớp lỗi đã làm trắng trang một lần
(commit `4f2bf1f`): một nguồn dữ liệu trả thứ không mong đợi, không ai chặn ở ranh giới.
⇒ Kiểm hình dạng **ở ranh giới**, cùng khuôn `assertStats` ở `apps/web/src/api/stats.ts`.

- [ ] **Step 3–4:** client + cache TTL + handler; giao diện chỉ đọc, nút đăng **dẫn sang GitHub**.
- [ ] **Step 5: Giới hạn tần suất phía ta** — token là của ta, nên một người dùng làm cháy hạn ngạch
  sẽ làm **mọi người** mất thảo luận. Có test đếm **lời gọi ra ngoài thật**, không đếm hồi đáp — bài
  học S2 Task 9: mutant "gọi mạng rồi mới từ chối" cho hồi đáp y hệt trong khi số lời gọi nhảy 8 → 100.
- [ ] **Step 6: Commit** `feat: nhúng đọc GitHub Discussions`

---

## Task 6: Cổng nghiệm thu đầu-cuối

**Files:** Create `apps/web/e2e/s4.spec.ts`

Bốn kịch bản, **đi qua giao diện thật** (ruling S1-F29):

1. Chấm sao một course registry → tải lại → phiếu còn đó → sửa được.
2. **Course riêng tư không có ô chấm sao nào** — hàng rào riêng tư ở tầng cao nhất.
3. Tài khoản B **không thấy được** ai đã chấm gì; chỉ thấy trung bình + số phiếu + phiếu của chính mình.
4. GitHub trả 500 → **trang course vẫn đọc được**, phần thảo luận nói rõ chưa tải được.

- [ ] Chạy `rtk proxy make test-e2e`, in **mã thoát thô**. Mọi spec cũ phải vẫn xanh.
- [ ] Commit `test(e2e): cổng nghiệm thu hệ thống con 4`

---

## Self-Review

**Đối chiếu spec §5:**

| Spec | Task |
|---|---|
| Rating chỉ cho course registry | 3 · 4 (có test hàng rào) · 6 (chốt e2e) |
| `course_ratings(user_id, registry_id, stars, created_at)` | 3 |
| Một phiếu mỗi người mỗi course, sửa được | 3 (khoá chính) · 4 |
| Catalog sắp theo trung bình + số phiếu | 4 |
| Discussion mỗi course, server giữ token, cache TTL | 5 |
| Nút đăng dẫn sang GitHub | 5 |
| §8: nợ C-1 và C-3 trước khi mở cho người lạ | **1 · 2 — xem HC-1** |

**Quét placeholder:** không có "TBD" / "tương tự Task N". Task 1 và 2 cố ý đứng trước phần tính năng
vì spec §8 xếp chúng ở đây và lý do là cụ thể, không phải hình thức.

**Nhất quán kiểu:** `registry_id` là **cùng một chuỗi** với `RegistryEntry.id` của hệ thống con 3
(Task 2 của S3). Một định nghĩa, không hai bản — bài học *"một bộ luật, ba bản, bất đồng 7/12 hàng"*.

**Rủi ro lớn nhất** — nói ra để người thực thi cảnh giác: **Task 5 sẽ bị cám dỗ bỏ qua HC-2**, vì
thêm một biến môi trường có vẻ vô hại. Nhưng hệ thống con 2 dựng **sáu phép quét nguồn** trên một lời
hứa tuyệt đối, và một token đặt sai chỗ sẽ hoặc làm chúng đỏ (tốt — bạn biết ngay) hoặc **lặng lẽ tạo
tiền lệ** cho người sau nới lời hứa ấy. Chạy sáu phép quét **trước** khi viết phần còn lại của Task 5.

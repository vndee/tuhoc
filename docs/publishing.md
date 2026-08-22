# Publish repo này ra công khai

Repo này chưa từng được publish. Trước lần đầu, có **một** việc phải làm mà làm
sau thì không cứu được: bóc giáo trình riêng tư khỏi **lịch sử** git.

Tài liệu này là quy trình đó. Nó cũng ghi cái đã làm rồi (task 11) để không ai
làm lại, và cái **chưa** làm — việc viết lại lịch sử — kèm đủ thứ cần biết để
quyết định có chạy hay không.

> **Trạng thái:** phần 1 đã xong và đã commit. Phần 2 **chưa chạy**. Nó là thao
> tác khó đảo ngược nhất trong repo này, nên nó nằm đây dưới dạng lệnh đã soạn
> và đã kiểm chứng cách đo, chờ người duyệt — không phải một script tự chạy.

---

## 0. Cái gì riêng tư, và vì sao xoá sau không cứu được

`courses/***REMOVED***/` — 46 tệp, 1,3 MB thô — là giáo trình **Lý thuyết
Thông tin** của tác giả. Nó riêng tư. Nó không bao giờ được publish.

Nó đã được commit vào chính repo sắp publish (spec §2B.1). Xoá nó ở một commit
mới **không giải quyết gì**: git giữ toàn bộ lịch sử, và ai clone repo công khai
cũng lấy lại được đủ 46 tệp bằng một lệnh:

```bash
git show 955ce70:courses/***REMOVED***/chapters/p1-5.html   # vẫn đọc được sau khi xoá
```

Nên phần 2 tồn tại. `git rm` là điều kiện cần, không phải điều kiện đủ.

---

## 1. Đã làm: course ra khỏi cây làm việc (task 11)

Course không còn là một phần của repo. Nó là một **gói rời** — đúng cái mà cả hệ
thống con 1 dựng lên để phục vụ — và tác giả là **người import đầu tiên** của
chính nền tảng mình viết. Đường import không được ưu ái bằng đường tắt nào; nếu
nó hỏng, nó hỏng ngay trên dữ liệu ta quan tâm nhất.

### 1.1 Kho gói

Ngoài cây git. Mặc định `~/Documents/claude/tuhoc-courses/`, đổi bằng biến môi
trường `TUHOC_COURSE_STORE`. Trong đó là các tệp `.zip` do `tuhoc pack` ghi.

**Kho này không được nằm trong bất kỳ repo nào sẽ publish.** Nó cũng không được
backup vào một dịch vụ chia sẻ mà không nghĩ — riêng tư ở đây nghĩa là riêng tư.

### 1.2 `courses/` bây giờ là thư mục làm việc

`.gitignore` bỏ qua **toàn bộ** `/courses/*`, chừa đúng `.gitkeep`. Viết theo lối
"bỏ qua tất cả rồi trừ ra" chứ không phải liệt kê tên course: danh sách luôn đi
sau thực tế, và cái giá của việc đi sau ở đúng thư mục này là commit nhầm một
course riêng tư lần nữa.

Nạp nội dung về:

```bash
make courses      # bung mọi .zip trong kho vào courses/<manifest id>/
```

Không có kho, hoặc kho rỗng, **không phải lỗi** — đó là trạng thái của một bản
clone mới. Lệnh nói ra rồi thoát 0.

### 1.3 Chuyện gì xảy ra với test

Năm tệp test đơn vị và năm tệp e2e đọc nội dung thật của course. Danh sách này
**đo bằng cách bỏ thư mục course đi rồi chạy lại**, không phải bằng grep — grep
cho ra 18 tệp có nhắc tới course, hầu hết trong chú thích:

| tệp | đọc gì |
|---|---|
| `apps/web/src/annotations/painter.test.ts` | `chapters/p1-5.html` (cấp module) |
| `apps/web/src/annotations/anchor.test.ts` | `chapters/p1-5.html` (cấp module) |
| `apps/web/src/course/version.test.ts` | `chapters/p1-5.html` (cấp module) |
| `apps/web/src/annotations/SelectionToolbar.test.tsx` | `chapters/p1-5.html` (trong 1 test) |
| `packages/course-format/src/zip.test.ts` | cả 46 tệp, pack → unpack từng byte |
| `apps/web/e2e/helpers.ts`, `p1.spec.ts`, `p2.spec.ts`, `viz.spec.ts` | cả course, qua HTTP tĩnh |
| `apps/web/e2e/import.spec.ts` | chính tệp `.zip`, qua màn hình Import |

Ruling S1-F5 đếm bảy tệp đơn vị. Bốn trong bảy — `normalize`, `Dashboard`,
`useLogout`, `session` — **không** đọc course (chúng chỉ nhắc trong chú thích,
hoặc có một trường tên `courses` trong payload `/stats`), và hai tệp có đọc
thì không nằm trong danh sách ấy: `version.test.ts` và `zip.test.ts`. Số đúng là
**năm + năm**.

**Chúng không được đổi sang fixture bịa.** Lý do đo được, không phải khẩu hiệu:
`version.test.ts` có 17 fixture prose viết tay đều xanh cả khi bỏ `renderKatex`,
trong khi chương thật cho **26/30 orphan giả** — khối chú thích ngay trên
`previewUpdate` trong tệp đó ghi lại con số. Trong hệ thống con này, chạy trên
dữ liệu thật đã bác bỏ bảy phép đo mà fixture cho xanh hết.

Nên dữ liệu vẫn là dữ liệu thật, chỉ đổi chỗ cất. `make test-web`,
`make test-format` và `make test-e2e` đều phụ thuộc mục tiêu `courses`, nên bước
nạp chạy trước. Không có gói thì các tệp trên **đỏ** — không skip, không đổi
sang dữ liệu giả — kèm câu chỉ đúng lệnh phải gõ
(`apps/web/src/test/realCourse.ts`, `apps/web/e2e/helpers.ts`).

`apps/web/e2e/import.spec.ts` là tệp MỚI, và là cổng nghiệm thu của cả hệ thống
con: nó nhập chính tệp `.zip` qua màn hình Import rồi kiểm rằng chương đọc được,
mô phỏng chạy, và **`viz.js` đến từ chính gói** (blob URL, không một request nào
tới `/courses/<id>/viz.js`). Ba tệp e2e cũ đều đọc course qua đường tĩnh, nên cả
ba xanh trong khi đường import gãy — và đã xanh như thế một lần thật, xem
`resolveVizScriptUrl` trong `apps/web/src/course/loader.ts`.

Bản clone của người khác sẽ thấy bốn tệp đó đỏ. Đó là trạng thái đúng: gói là
của tác giả, họ không có nó. Xem §4.

### 1.4 Sinh lại gói từ đầu

`tools/extract.py` là bộ chuyển đổi một lần từ bản v1 một-tệp. Nó vẫn chạy được:

```bash
make extract                                   # → courses/***REMOVED***/
```

Nhưng nó ghi ra **manifest v1**. `tuhoc pack` trên đầu ra đó **thoát 1**, nêu
đúng bốn trường v2 còn thiếu:

```
MANIFEST_FIELD  manifest.json#/license      missing or not a non-empty string
MANIFEST_FIELD  manifest.json#/tier         must be exactly "content" or "interactive"
MANIFEST_FIELD  manifest.json#/generatedBy  must be exactly "ai", "human" or "mixed"
MANIFEST_FIELD  manifest.json#/authors      must be a non-empty array of { name, url? }
```

Đó là câu trả lời **đúng**, không phải lỗi cần đi vòng: bốn trường ấy là quyết
định về việc phát hành (hạng tin cậy nào, tên ai, giấy phép gì, ai viết văn), và
một script bóc chữ không có tư cách đoán hộ. Điền tay rồi pack:

```jsonc
  "tier": "interactive",                              // course có viz.js
  "license": "LicenseRef-Private-All-Rights-Reserved", // KHÔNG phải CC-BY: nó riêng tư
  "authors": [{ "name": "Duy Huynh" }],
  "generatedBy": "mixed",
```

```bash
bun tools/tuhoc-cli/src/index.ts pack courses/***REMOVED*** \
  -o ~/Documents/claude/tuhoc-courses/***REMOVED***-1.0.0.zip
```

`license` **không phải** một giấy phép mở. Trường này là chuỗi tự do
(`docs/course-format.md` §8); ghi một giấy phép cho phép phân phối lại vào một
gói riêng tư là tự mâu thuẫn, và nhãn ấy đi theo gói ra mọi nơi gói đi.

---

## 2. Chưa làm: bóc `courses/` khỏi mọi commit

### 2.1 Phạm vi, đã đo

```
$ git log --oneline -- courses/ | wc -l
3
$ git log --oneline -- courses/
aeb18c7 feat(tools): extract course-kit runtime, vendor katex, viz.js
955ce70 feat(tools): extract chapters + manifest from v1
a105fe6 chore: monorepo scaffold
$ git rev-list --count a105fe6..HEAD
123
```

Ba commit **chứa** course. Nhưng viết lại một commit đổi mã của **mọi hậu duệ**,
nên **124 trên 126 commit đổi mã** (`a105fe6` và 123 commit sau nó). Chỉ hai
commit đầu — `458f23d`, `46d1ad1` — giữ nguyên mã.

Cái được giữ lại là toàn bộ lịch sử phát triển: từng vòng review, từng phán
quyết, từng lần số đo bị bác. Đó là tài sản thật của repo này, và đó là lý do
chọn viết lại thay vì bắt đầu lại từ một commit trống.

### 2.2 Danh sách nơi đang trích mã commit — lập TRƯỚC, không phải sau

Lệnh đã dùng để lập (chạy lại được, để kiểm rằng danh sách còn đúng ngay trước
khi viết lại):

```bash
grep -rInE "(commit|HEAD|tag|ancestor of|fixed in|introduced in|as of|at) [\`']?[0-9a-f]{7,12}[\`']?|[\`'][0-9a-f]{7}[\`']" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=courses \
  --exclude=go.sum --exclude=go.mod --exclude=bun.lock .
```

Bảy chỗ, tại thời điểm task 11:

| tệp:dòng | mã được trích | trích cái gì |
|---|---|---|
| `apps/web/e2e/p2.spec.ts:436` | `5211e40` | commit sửa một Critical của P2 |
| `apps/web/src/auth/RequireAuth.tsx:27` | `0a733cb` | commit đã làm cùng lựa chọn về lint fast-refresh |
| `apps/web/src/auth/session.ts:20` | `b708620` | commit sửa rò dữ liệu chéo tài khoản |
| `apps/web/src/course/import.test.ts:394` | `0273c88` | commit sửa zip64 của Task 2 |
| `apps/web/src/course/import.ts:886` | `0273c88` | cùng commit trên |
| `packages/course-format/src/validate.test.ts:600` | `64c6459` | HEAD lúc đo một số hiệu năng |
| `docs/superpowers/plans/2026-08-19-p1-platform-core.md:15` | `f782323` + tag `v1-single-file` | **của repo `Research`, KHÔNG phải repo này** |

Hai điều về bảng này:

- **Dòng cuối không cần sửa.** `f782323` và tag `v1-single-file` thuộc repo
  `~/Documents/claude/Research`, không bị đụng tới. Đưa vào bảng vì grep bắt nó,
  và vì "sửa nhầm một mã đúng" cũng là một cách hỏng.
- **Sáu dòng còn lại là chú thích, không phải mã chạy.** Không có test nào đỏ nếu
  chúng sai. Đó chính là lý do phải lập danh sách trước: sai ở đây **im lặng**.

Không có tag nào trong repo này (`git tag -l` rỗng) và chưa có remote nào
(`git remote -v` rỗng). Nếu đến lúc chạy mà đã có, hai thứ đó phải vào danh sách.

### 2.3 Lệnh

`git-filter-repo` **chưa được cài** trên máy này (`which git-filter-repo` không
ra gì). Cài trước:

```bash
brew install git-filter-repo     # hoặc: pipx install git-filter-repo
```

Dùng `git-filter-repo`, không dùng `git filter-branch`: filter-branch chậm hơn
hai bậc trên 126 commit, và tài liệu git chính thức khuyên đừng dùng nó nữa vì
những cái bẫy im lặng (đặc biệt là để lại `refs/original` khiến object cũ vẫn
truy cập được, đúng thứ nguy hiểm ở đây).

```bash
# 0) Bản sao dự phòng, TRƯỚC KHI làm gì — đây là thao tác khó đảo ngược.
cp -a ~/Documents/claude/tuhoc ~/Documents/claude/tuhoc-backup-$(date +%Y%m%d-%H%M%S)

# 1) Mọi worktree agent phải gỡ trước: filter-repo từ chối chạy khi có worktree
#    phụ, và nếu ép chạy thì các nhánh worktree sẽ trỏ vào lịch sử cũ.
git worktree list
git worktree remove <đường-dẫn>          # cho từng cái
git branch -D worktree-agent-...         # cho từng nhánh không còn cần

# 2) Bóc thư mục khỏi mọi commit.
git filter-repo --invert-paths --path courses/

# 3) Dọn object cũ.
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

### 2.4 Kiểm chứng — trước và sau

**Trước** (phải ra kết quả, tức là còn rò):

```bash
git rev-list --objects --all -- courses/ | wc -l     # 59 lúc viết
git log --all --oneline -- courses/ | wc -l          # 3
git show 955ce70:courses/***REMOVED***/chapters/p1-5.html | head -1   # in ra HTML
```

**Sau** (cả ba phải câm):

```bash
git rev-list --objects --all -- courses/ | wc -l     # phải là 0
git log --all --oneline -- courses/ | wc -l          # phải là 0
git grep -I --all-match -l "***REMOVED***" $(git rev-list --all) -- courses/ ; echo "exit=$?"  # phải rỗng
git count-objects -vH                                 # size-pack phải giảm rõ
```

Và một phép đo cuối, thô nhưng đúng loại: clone repo đã viết lại vào một thư mục
trống rồi tìm bất kỳ chương nào.

```bash
git clone --mirror ~/Documents/claude/tuhoc /tmp/tuhoc-check.git
cd /tmp/tuhoc-check.git && git rev-list --objects --all | grep -c "***REMOVED***"   # phải là 0
```

Đây là phép đo đúng vì nó hỏi **đúng câu người ngoài sẽ hỏi**: một bản clone có
lấy lại được không. `git log` trên bản làm việc có thể sạch trong khi object vẫn
nằm trong pack.

### 2.5 Sau khi viết lại

1. Sửa sáu chỗ trích mã ở §2.2 sang mã mới. Ánh xạ cũ→mới nằm ở
   `.git/filter-repo/commit-map` do filter-repo ghi ra; **chép nó ra ngoài
   `.git/` trước khi `git gc`**, nó là thứ duy nhất dịch được mã cũ.
2. `make test-web && make test-format && make test-cli && make test-api` — bốn
   cổng phải xanh (chúng không đọc lịch sử git, nhưng chạy lại là cách rẻ nhất
   để biết cây làm việc không bị filter-repo động vào ngoài dự kiến).
3. Mọi bản clone khác của repo này **phải bị xoá và clone lại**. Một bản clone cũ
   còn giữ nguyên lịch sử cũ, tức còn nguyên giáo trình; push từ nó lên sẽ mang
   toàn bộ thứ vừa bóc quay lại.
4. Chỉ sau khi §2.4 câm hết mới `git remote add` và `git push`.

### 2.6 Cái viết lại lịch sử KHÔNG sửa được

- **Bản sao đã phát tán.** Nếu repo đã từng được đẩy đi đâu, viết lại ở đây không
  chạm tới đó. Lúc viết dòng này chưa có remote nào, nên chưa dính.
- **Bản dự phòng ở bước 0.** Nó có đầy đủ giáo trình. Đó là chủ đích — nhưng nó
  không được lẫn vào thứ gì sẽ publish.
- **Cái ngoài git.** `~/Documents/claude/Research/***REMOVED***.html` (bản
  v1 một-tệp) và kho `.zip` ở §1.1 vẫn còn, và phải còn.

---

## 3. Trước khi publish: soát lần cuối

- [ ] `git rev-list --objects --all -- courses/ | wc -l` → `0`
- [ ] `git ls-files | grep '^courses/'` → chỉ `courses/.gitkeep`
- [ ] Bản clone thử ở §2.4 không tìm thấy chương nào
- [ ] Sáu chỗ trích mã ở §2.2 đã sửa theo `commit-map`
- [ ] `.env` thật không bị theo dõi (`git ls-files | grep -c '^\.env$'` → `0`;
      `.env.example` thì được)
- [ ] Bốn cổng test xanh trên máy có gói; và **biết trước** rằng trên máy không
      có gói thì bốn tệp ở §1.3 sẽ đỏ, kèm hướng dẫn

---

## 4. Người clone repo công khai sẽ thấy gì

Một repo không có course nào. Đó là hình dạng đúng: nền tảng không đi kèm nội
dung, nội dung là gói rời.

- `make dev-web` chạy được; thư viện rỗng cho tới khi họ import gói của họ.
- `bun run build` chạy được với `courses/` rỗng **và** với `courses/` không tồn
  tại (`apps/web/vite-plugins/courseAssets.ts`, `copyDirIfPresent`).
- `make test-web`: 37/41 tệp xanh. Bốn tệp ở §1.3 đỏ, kèm câu nói rõ vì sao và
  phải làm gì.

Điểm cuối là một đánh đổi có ý thức, không phải sót. Cách khác là để bốn tệp đó
tự `skip` khi thiếu dữ liệu — nhưng một bộ test tự bỏ qua phần chạy trên dữ liệu
thật, đúng lúc không có dữ liệu thật, thì im lặng ở chỗ nó phải lên tiếng, và
trên màn hình nó trông y hệt lúc mọi thứ đều tốt. Nếu ngày nào đó có một course
**công khai** làm mẫu, nó nên thay vào vai này, và khi ấy bốn tệp kia xanh cho
mọi người.

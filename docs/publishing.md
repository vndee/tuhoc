# Publish repo này ra công khai

Trước lần push đầu tiên có **một** việc phải làm mà làm sau thì không cứu được:
bóc giáo trình riêng tư khỏi **lịch sử** git.

Tài liệu này là quy trình đó, và nay cũng là biên bản của lần chạy nó.

> **Trạng thái (28/08/2026): CẢ HAI PHẦN ĐÃ XONG.** Phần 1 xong ở task 11. Phần 2
> chạy ngay trước khi repo có remote đầu tiên (`github.com/vndee/tuhoc`, private).
> Đo sau khi chạy: object dưới `courses/` **61 → 0**, commit chạm `courses/`
> **4 → 0**, commit chứa `ly-thuyet-thong-tin` **46 → 0**, chứa
> `Lý thuyết Thông tin` **25 → 0**, và bản clone `--mirror` câm cả ba phép đo.
> 342 commit giữ nguyên số lượng — không commit nào bị xoá, chỉ đổi mã.
>
> Tài liệu **không** bị hạ xuống thành ghi chép lịch sử: nếu có course riêng thứ
> hai lọt vào, đây vẫn là quy trình phải chạy lại — và §2.2b, §2.7, §2.8 là
> những chỗ đã làm hỏng công thức này ba lần.

---

## 0. Cái gì riêng tư, và vì sao xoá sau không cứu được

`courses/ly-thuyet-thong-tin/` — 46 tệp, 1,3 MB thô — là giáo trình **Lý thuyết
Thông tin** của tác giả. Nó riêng tư. Nó không bao giờ được publish.

Nó đã được commit vào chính repo sắp publish (spec §2B.1). Xoá nó ở một commit
mới **không giải quyết gì**: git giữ toàn bộ lịch sử, và ai clone repo công khai
cũng lấy lại được đủ 46 tệp bằng một lệnh:

```bash
git show fd49d89:courses/ly-thuyet-thong-tin/chapters/p1-5.html   # vẫn đọc được sau khi xoá
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

**Sáu** tệp test đơn vị và **bốn** tệp e2e đọc nội dung thật của một course.
Danh sách này **đo bằng cách bỏ thư mục course đi rồi chạy lại**, không phải
bằng grep — grep cho ra 18 tệp có nhắc tới course, hầu hết trong chú thích:

| tệp | đọc gì |
|---|---|
| `apps/web/src/annotations/painter.test.ts` | `chapters/p1-3.html` (cấp module) |
| `apps/web/src/annotations/anchor.test.ts` | `chapters/p1-3.html` (cấp module) |
| `apps/web/src/course/version.test.ts` | `chapters/p1-3.html` (cấp module) |
| `apps/web/src/annotations/SelectionToolbar.test.tsx` | `chapters/p1-3.html` (trong 1 test) |
| `packages/course-format/src/zip.test.ts` | cả 10 tệp, pack → unpack từng byte |
| `tools/tuhoc-cli/src/pack.test.ts` | cả thư mục, mã thoát của CLI |
| `apps/web/e2e/p1.spec.ts`, `p2.spec.ts`, `viz.spec.ts` | cả course, qua HTTP tĩnh |
| `apps/web/e2e/import.spec.ts` | chính tệp `.zip`, qua màn hình Import |

Hai ruling trước đó đếm sai, mỗi cái sai một kiểu, nên đáng ghi lại cả hai:

- **S1-F5** đếm bảy tệp đơn vị. Bốn trong bảy — `normalize`, `Dashboard`,
  `useLogout`, `session` — **không** đọc course (chúng chỉ nhắc trong chú thích,
  hoặc có một trường tên `courses` trong payload `/stats`), và hai tệp có đọc
  thì không nằm trong danh sách ấy: `version.test.ts` và `zip.test.ts`.
- Bản sửa của nó lại chốt **"năm + năm"**, và con số đó cũng sai — sai ở **cả
  hai chiều**. Đo lại ở task 13 bằng đúng cách trên: `tools/tuhoc-cli/src/
  pack.test.ts` là tệp đơn vị **thứ sáu** (nó đọc `courses/<id>/` để so mã thoát
  CLI với phán quyết của bộ luật), còn `apps/web/e2e/helpers.ts` **không phải
  tệp e2e thứ năm** — Playwright chỉ nhận `*.spec.ts` làm bài kiểm, nên nó là
  một mô-đun trợ giúp. Số đúng là **sáu + bốn**; tổng mười thì đúng, nhưng đúng
  vì hai sai số triệt tiêu nhau.

**Chúng không được đổi sang HTML viết tay trong tệp test.** Lý do đo được, không
phải khẩu hiệu: `version.test.ts` có 17 fixture prose viết tay đều xanh cả khi
bỏ `renderKatex`, trong khi một chương thật thì không — khối chú thích ngay trên
`previewUpdate` trong tệp đó ghi lại con số cho cả hai ngữ liệu. Trong hệ thống
con này, chạy trên gói thật đã bác bỏ bảy phép đo mà fixture cho xanh hết.

Từ **task 13**, ngữ liệu ấy là gói mẫu **công khai** `so-dau-phay-dong`
(`fixtures/courses/`, có commit), không còn là giáo trình riêng tư. `make
test-web`, `make test-format` và `make test-e2e` đều phụ thuộc mục tiêu
`courses`, nên bước bung chạy trước và mười tệp trên xanh trên **mọi bản clone**.
Không bung được thì chúng **đỏ** — không skip, không đổi sang dữ liệu giả — kèm
câu chỉ đúng lệnh phải gõ (`apps/web/src/test/sampleCourse.ts`,
`apps/web/e2e/helpers.ts`).

`apps/web/e2e/import.spec.ts` là tệp MỚI, và là cổng nghiệm thu của cả hệ thống
con: nó nhập chính tệp `.zip` qua màn hình Import rồi kiểm rằng chương đọc được,
mô phỏng chạy, và **`viz.js` đến từ chính gói** (blob URL, không một request nào
tới `/courses/<id>/viz.js`). Ba tệp e2e cũ đều đọc course qua đường tĩnh, nên cả
ba xanh trong khi đường import gãy — và đã xanh như thế một lần thật, xem
`resolveVizScriptUrl` trong `apps/web/src/course/loader.ts`.

Trước task 13, bản clone của người khác thấy mười tệp đó đỏ, và đó là trạng
thái đúng khi ngữ liệu là gói riêng của tác giả. Từ task 13 thì không còn:
ngữ liệu là gói mẫu công khai nằm trong repo. Xem §4.

### 1.4 Sinh lại gói từ đầu

`tools/extract.py` là bộ chuyển đổi một lần từ bản v1 một-tệp. Nó vẫn chạy được,
nhưng **không còn hằng số riêng tư nào viết cứng trong nó**: đường dẫn nguồn đến
từ `$TUHOC_V1_SOURCE`, còn `id`/`title`/`description` là cờ bắt buộc. Đó là hệ
quả của phép 4 ở `make check-publish` — một hằng số trỏ vào giáo trình riêng thì
đi cùng mã ra công khai.

```bash
export TUHOC_V1_SOURCE=~/Documents/claude/Research/ly-thuyet-thong-tin.html
python3 tools/extract.py --out . \
  --id ly-thuyet-thong-tin \
  --title "Lý thuyết Thông tin" \
  --description "Từ tiên đề Shannon đến định lượng bất định trong LLM"
#                                              → courses/ly-thuyet-thong-tin/
```

Cùng biến môi trường ấy mở khoá `make test-extract`; không đặt nó thì cả tệp
`tools/test_extract.py` **bỏ qua có nêu lý do** thay vì đỏ bằng
`FileNotFoundError` trên mọi bản clone.

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
bun tools/tuhoc-cli/src/index.ts pack courses/ly-thuyet-thong-tin \
  -o ~/Documents/claude/tuhoc-courses/ly-thuyet-thong-tin-1.0.0.zip
```

`license` **không phải** một giấy phép mở. Trường này là chuỗi tự do
(`docs/course-format.md` §8); ghi một giấy phép cho phép phân phối lại vào một
gói riêng tư là tự mâu thuẫn, và nhãn ấy đi theo gói ra mọi nơi gói đi.

---

## 2. Đã làm 28/08/2026: bóc `courses/` khỏi mọi commit

### 2.1 Phạm vi, đã đo

> Bản chép màn hình dưới đây là trạng thái **trước** khi viết lại, giữ nguyên làm
> đối chứng. Mọi mã commit trong đó đã được ánh xạ sang mã mới (`commit-map`), nên
> chúng vẫn phân giải được — nhưng `git log -- courses/` nay trả về rỗng, đó là
> điểm của cả mục này. Xem §2.2b(a): các con số là ảnh chụp, không phải hằng số.

```
$ git log --oneline -- courses/ | wc -l
3
$ git log --oneline -- courses/
7d481b8 feat(tools): extract course-kit runtime, vendor katex, viz.js
fd49d89 feat(tools): extract chapters + manifest from v1
f2b4ca2 chore: monorepo scaffold
$ git rev-list --count f2b4ca2..HEAD
123
```

Ba commit **chứa** course. Nhưng viết lại một commit đổi mã của **mọi hậu duệ**,
nên **124 trên 126 commit đổi mã** (`f2b4ca2` và 123 commit sau nó). Chỉ hai
commit đầu — `ecf01a8`, `7bc0401` — giữ nguyên mã.

Cái được giữ lại là toàn bộ lịch sử phát triển: từng vòng review, từng phán
quyết, từng lần số đo bị bác. Đó là tài sản thật của repo này, và đó là lý do
chọn viết lại thay vì bắt đầu lại từ một commit trống.

### 2.2 Danh sách nơi đang trích mã commit — lập TRƯỚC, không phải sau

Lệnh đã dùng để lập (chạy lại được, để kiểm rằng danh sách còn đúng ngay trước
khi viết lại):

```bash
grep -rInE "(commit|HEAD|tag|ancestor of|fixed in|introduced in|as of|at) [\`']?[0-9a-f]{7,12}[\`']?|[\`'][0-9a-f]{7}[\`']" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.claude --exclude-dir=.superpowers \
  --exclude-dir=dist --exclude-dir=courses \
  --exclude=go.sum --exclude=go.mod --exclude=bun.lock .
```

Bảy chỗ, tại thời điểm task 11:

| tệp:dòng | mã được trích | trích cái gì |
|---|---|---|
| `apps/web/e2e/p2.spec.ts:436` | `8a27b63` | commit sửa một Critical của P2 |
| `apps/web/src/auth/RequireAuth.tsx:27` | `e859459` | commit đã làm cùng lựa chọn về lint fast-refresh |
| `apps/web/src/auth/session.ts:20` | `97a6e02` | commit sửa rò dữ liệu chéo tài khoản |
| `apps/web/src/course/import.test.ts:394` | `98bf7a6` | commit sửa zip64 của Task 2 |
| `apps/web/src/course/import.ts:886` | `98bf7a6` | cùng commit trên |
| `packages/course-format/src/validate.test.ts:600` | `1f8201d` | HEAD lúc đo một số hiệu năng |
| `docs/superpowers/plans/2026-08-19-p1-platform-core.md:15` | `f782323` + tag `v1-single-file` | **của repo `Research`, KHÔNG phải repo này** |

Hai điều về bảng này:

- **Dòng cuối không cần sửa.** `f782323` và tag `v1-single-file` thuộc repo
  `~/Documents/claude/Research`, không bị đụng tới. Đưa vào bảng vì grep bắt nó,
  và vì "sửa nhầm một mã đúng" cũng là một cách hỏng.
- **Sáu dòng còn lại là chú thích, không phải mã chạy.** Không có test nào đỏ nếu
  chúng sai. Đó chính là lý do phải lập danh sách trước: sai ở đây **im lặng**.

Không có tag nào trong repo này (`git tag -l` rỗng) và chưa có remote nào
(`git remote -v` rỗng). Nếu đến lúc chạy mà đã có, hai thứ đó phải vào danh sách.

### 2.2b Ba cái bẫy phát hiện khi CHẠY LẠI công thức này (2026-08-22)

Ba mục dưới đây không phải lý thuyết — chúng làm hỏng đúng công thức ở trên khi
điều phối viên chạy thử lại nó sau bảy commit gộp thêm.

**(a) Mọi con số ở §2.1 và §2.4 là ẢNH CHỤP, không phải hằng số.** Đo lại
2026-08-22: object dưới `courses/` **59 → 61**, commit chạm `courses/` **3 → 4**
(cái thứ tư là chính commit xoá của task 11), tổng commit **126 → 141**. Đừng so
với số in sẵn — **đo trước, ghi lại, rồi so sau**:

```bash
BEFORE_OBJ=$(git rev-list --objects --all -- courses/ | wc -l)
BEFORE_LOG=$(git log --all --oneline -- courses/ | wc -l)
echo "trước: obj=$BEFORE_OBJ log=$BEFORE_LOG"   # cả hai phải > 0, nếu không thì chưa có gì để bóc
# … chạy filter-repo …
echo "sau: obj=$(git rev-list --objects --all -- courses/ | wc -l) log=$(git log --all --oneline -- courses/ | wc -l)"
# cả hai phải là 0
```

**(b) Số dòng trong bảng §2.2 trôi theo mỗi lần sửa tệp.** `apps/web/e2e/p2.spec.ts:436`
nay là **dòng 457** (task 12 chuyển hai hàm trợ giúp sang `helpers.ts`). Tin tên tệp
và mã commit; **đừng tin số dòng** — chạy lại phép quét để lấy vị trí hiện tại.

**(c) WORKTREE, không chỉ clone.** §2.5 bước 3 dặn xoá mọi *bản clone* khác. Chưa
đủ: repo này lúc viết có **11 worktree phụ** dưới `.claude/worktrees/`, mỗi cái là
một checkout đầy đủ dùng chung kho object. Chúng gây hai vấn đề:

1. `git-filter-repo` **từ chối chạy** khi có worktree phụ.
2. Phép quét ở §2.2 quét luôn vào chúng và trả **374 chỗ thay vì 7** — đó là lý do
   lệnh trên nay loại trừ `.claude`.

```bash
git worktree list                      # phải chỉ còn MỘT dòng trước khi chạy
git worktree list | tail -n +2 | awk '{print $1}' | xargs -r -n1 git worktree remove --force
git worktree prune
```

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
git show fd49d89:courses/ly-thuyet-thong-tin/chapters/p1-5.html | head -1   # in ra HTML
```

**Sau** (cả ba phải câm):

```bash
git rev-list --objects --all -- courses/ | wc -l     # phải là 0
git log --all --oneline -- courses/ | wc -l          # phải là 0
git grep -I --all-match -l "ly-thuyet-thong-tin" $(git rev-list --all) -- courses/ ; echo "exit=$?"  # phải rỗng
git count-objects -vH                                 # size-pack phải giảm rõ
```

Và một phép đo cuối, thô nhưng đúng loại: clone repo đã viết lại vào một thư mục
trống rồi tìm bất kỳ chương nào.

```bash
git clone --mirror ~/Documents/claude/tuhoc /tmp/tuhoc-check.git
cd /tmp/tuhoc-check.git && git rev-list --objects --all | grep -c "ly-thuyet-thong-tin"   # phải là 0
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
3. Mọi bản clone khác **và mọi worktree phụ** của repo này **phải bị xoá** (worktree: xem §2.2b(c); clone: xoá rồi clone lại). Một bản clone cũ
   còn giữ nguyên lịch sử cũ, tức còn nguyên giáo trình; push từ nó lên sẽ mang
   toàn bộ thứ vừa bóc quay lại.
4. Chỉ sau khi §2.4 câm hết mới `git remote add` và `git push`.

### 2.6 Cái viết lại lịch sử KHÔNG sửa được

- **Bản sao đã phát tán.** Nếu repo đã từng được đẩy đi đâu, viết lại ở đây không
  chạm tới đó. Khi chạy thật (28/08/2026) repo **chưa có remote nào** — đó chính
  là lý do thứ tự là viết-lại-trước-rồi-mới-`git remote add`. Từ nay điều kiện ấy
  không còn đúng: một lần viết lại nữa sẽ phải force-push, và GitHub còn giữ
  object mồ côi truy cập được bằng mã một thời gian sau đó.
- **Bản dự phòng ở bước 0.** Nó có đầy đủ giáo trình. Đó là chủ đích — nhưng nó
  không được lẫn vào thứ gì sẽ publish.
- **Cái ngoài git.** `~/Documents/claude/Research/ly-thuyet-thong-tin.html` (bản
  v1 một-tệp) và kho `.zip` ở §1.1 vẫn còn, và phải còn.

### 2.7 `filter-repo --path courses/` KHÔNG đủ — bốn đường rò, ba sống sót

Đây là mục quan trọng nhất của tài liệu này, và nó được viết **sau** khi §2 đã
soạn xong. Thẩm định tổng của hệ thống con 1 đo lại toàn bộ công thức trên và
tìm ra bốn đường rò. `git filter-repo --invert-paths --path courses/` chỉ đóng
**một**. Ba đường còn lại đi qua nó không suy suyển, vì chúng **không nằm dưới
`courses/`**.

Chạy xong §2, dọn sạch lịch sử, `git push` — và ba thứ dưới đây vẫn đi cùng.

| # | Đường rò | `--path courses/` có bóc? | Đóng bằng |
|---|---|---|---|
| 1 | `main` theo dõi 46 tệp giáo trình như **tệp sống** | có (nó nằm dưới `courses/`) | gộp nhánh đã xoá, rồi chạy §2 |
| 2 | `apps/web/dist/courses/<id>/` — thứ `wrangler pages deploy dist` đẩy lên | **KHÔNG** — `dist/` không được git theo dõi | không còn bản chép nào (xem dưới) |
| 3 | Văn xuôi + số chương chép nguyên văn vào một tệp **ngoài** `courses/` | **KHÔNG** | phép đo xuất xứ, xem dưới |
| 4 | `INSERT INTO courses …` trong migration đã áp | **KHÔNG** | `0003_drop_seed_course` |

**Đường 2 nay đóng bằng cách mạnh hơn cái chốt từng canh nó: không còn gì để
lọc.**

Chốt cũ — và nó có thật, đây là phần thuật sự chứ không phải kế hoạch —
`closeBundle()` chép `courses/` vào `dist/` **từng gói một**, chỉ chép gói có
`id` nằm trong `fixtures/courses/`, tức gói mẫu công khai do chính repo này phát
hành. Gói riêng bị loại khỏi bundle (in ra một dòng nói rõ) chứ không làm build
đỏ, vì luồng dev bình thường của tác giả luôn có gói riêng trong `courses/` và
một cờ thoát dùng hằng ngày thì luôn bật. Ngay sau đó là một phép khẳng định đọc
`dist/courses/` thật: có gì lạ thì xoá đi rồi ném lỗi — xoá trước, vì `wrangler
pages deploy dist` không hỏi lần build gần nhất xanh hay đỏ, nó chỉ đọc thư mục.

Commit `dafd4eb` gỡ **cả bản chép**, không siết chốt thêm. Lý do không phải là
chốt ấy hỏng — nó chạy đúng — mà là cú chuyển trục sang máy chủ
(`docs/superpowers/specs/2026-08-25-server-side-pivot.md`) khiến câu hỏi "gói nào
được phép đi cạnh bundle" hết nghĩa: course nay do `apps/api` phục vụ từ
Postgres, nên **không gói nào**, công khai hay riêng tư, còn lý do nằm trong
`dist/`. Một bản chép đã lọc vẫn là một nguồn sự thật thứ hai, không đồng bộ, cho
đúng cái định dạng mà pha ấy khai tử — nên thứ thay thế cái chốt là sự vắng mặt.
`closeBundle()` giờ chỉ còn chép `course-kit/` (KaTeX và `runtime.js`, những
`<script src>` cổ điển mà mọi chương vẫn cần khi dựng hình).

Hệ quả cho tài liệu này: `dist/courses/` không bao giờ được tạo ra nữa, nên
Đường 2 không còn cần một bộ lọc đúng để đóng. Phép đo 3 của
`scripts/check_publishable.py` vẫn chạy, nhưng nay hỏi một câu khác — **có gì
dưới `dist/courses/` không**, bất kể công khai hay riêng tư — vì mọi thứ ở đó
chỉ có thể là tàn dư của một bản build từ TRƯỚC `dafd4eb`, trên một máy chưa
build lại. Đó là lý do nó vẫn không phải một no-op.

**Đường 3 là đường khó nhất, vì nó không mang tên course.**
`.claude/skills/course-authoring/SKILL.md` từng chép 714 ký tự văn xuôi kèm số
chương. Không một phép quét theo tên nào bắt được: đoạn văn ấy không chứa
`ly-thuyet-thong-tin` cũng không chứa tên course. Phép đo bắt được nó dùng
**chính gói riêng làm máy đối chiếu**: bung gói ra, băm văn bản chương thành
chuỗi 12 từ, rồi tìm trong mọi tệp được theo dõi. Nó chỉ chạy được trên máy CÓ
gói riêng — nghĩa là trên máy tác giả, đúng chỗ và đúng người cần nó chạy.
(Nó tìm ra thêm hai chỗ nữa mà cả thẩm định lẫn §2 đều không thấy:
`apps/web/src/annotations/anchor.test.ts` và `docs/parity-notes.md`.)

**Đường 4: sửa `0001` một mình là sai.** `0001_init.up.sql` đã được áp trên các
database đang tồn tại. Bỏ dòng seed khỏi nó chỉ dọn cho database dựng **mới**;
hàng đã ghi ở database cũ nằm nguyên đó. Nên làm cả hai: `0001` không seed nữa,
và `0003_drop_seed_course` xoá cái đã ghi. Sửa một migration đã áp **an toàn**
với golang-migrate — `schema_migrations` chỉ có `(version, dirty)`, không có cột
checksum (`database/pgx/v5/pgx.go:465`, v4.19.1) — nhưng chính vì thế nó cũng
không tự lan tới database cũ, và đó là khoảng trống `0003` lấp.

### 2.8 Đường rò thứ năm: bản CŨ của những tệp vừa được dọn

Phép 4 đo **cây làm việc**. Nó nói đúng câu nó nhận đo, và câu ấy không phải là
"tên course có còn lấy lại được không". 79 chỗ nêu tên course đã được dọn khỏi
mã, test và tài liệu (2026-08-22) — nhưng mỗi lần dọn là một commit, và **bản
trước khi dọn vẫn nằm nguyên trong lịch sử**, ở ngoài `courses/`:

```bash
git log -S "ly-thuyet-thong-tin" --oneline --all | wc -l   # phải là 0 sau khi viết lại
```

`git filter-repo --invert-paths --path courses/` ở §2.3 **không chạm tới chúng**
— cùng đúng cái lý do đã làm hỏng công thức ấy ba lần ở §2.7: bộ lọc theo đường
dẫn chỉ thấy đường dẫn. `apps/web/src/test/Dashboard.test.tsx` không nằm dưới
`courses/`, nên bản cũ của nó — có nguyên `id: 'ly-thuyet-thong-tin'` — đi qua
bộ lọc không suy suyển.

Và phép kiểm "sau" ở §2.4 **không bắt được**: hai lệnh đầu giới hạn ở
`-- courses/`, lệnh clone-mirror thì `grep` trên **tên object**, không phải nội
dung blob. Cả ba đều câm trong khi `git log -S` in ra hàng chục commit.

Hai cách đóng, chọn một, đừng nửa vời:

- **Lọc theo nội dung**, không theo đường dẫn: `git filter-repo
  --replace-text <tệp>` với chính hai dòng của `scripts/private-markers.txt`.
  Nó viết lại mọi blob của mọi commit, nên nó cũng làm hỏng đúng những chỗ
  §2.2 liệt kê — chạy nó **cùng lượt** với §2.3, không phải sau.
- **Hoặc bắt đầu lại từ một commit gốc mới** (squash toàn bộ lịch sử trước khi
  publish). Rẻ và chắc chắn, nhưng vứt đi đúng thứ §2.1 nói là tài sản thật của
  repo. Đây là đánh đổi cần người quyết, không phải mặc định.

Cho tới khi một trong hai được làm, đừng đọc "phép 4 xanh" là "tên course đã đi
khỏi repo". Nó chỉ có nghĩa là tên course đã đi khỏi **cây làm việc**.

---

## 3. Trước khi publish: soát lần cuối

**Một lệnh, một mã thoát.** Danh sách gạch đầu dòng cũ ở đây có một cổng mù đã
được đo (`git ls-files | grep '^courses/'` chỉ nhìn nhánh đang checkout — nó
XANH trên nhánh làm việc trong khi `main` có 46 tệp), và nó không có mục nào cho
ba đường rò ở §2.7. Nên nó thành một chương trình:

```bash
make check-publish ; echo "exit=$?"
```

Phải in `exit=0`. Năm phép đo, mỗi phép trả lời một câu khác nhau:

| Phép | Câu hỏi | Bắt được đường rò |
|---|---|---|
| 1 | Ref **nào** còn theo dõi tệp dưới `courses/`? (mọi ref, không chỉ nhánh hiện tại) | 1 |
| 2 | Lịch sử còn object dưới `courses/` không? | 1 |
| 3 | `apps/web/dist/` đang mang gì? | 2 |
| 4 | Tên course riêng còn xuất hiện trong tệp được theo dõi nào? | 4, và một nửa của 3 |
| 5 | Có đoạn văn nào chép nguyên văn từ gói riêng không? | 3 |

Phép 5 cần gói riêng để đối chiếu, nên `make check-publish` chạy `make courses`
trước. Không có gói riêng thì nó **nói ra là đã bỏ qua** — nó không im lặng cho
xanh. Trên máy tác giả, đừng publish khi thấy dòng "[KHÔNG chạy được]" ở phép 5.

Hai tệp cấu hình đi kèm, và cả hai cố ý ngắn:

- `scripts/private-markers.txt` — các chuỗi phép 4 đi tìm. Không có nó thì phép
  4 thoát 1 kèm "KHÔNG đo được gì": **fail-closed**, để người xoá nó nhìn thấy
  hậu quả ngay.
- `scripts/publish-allowlist.txt` — những tệp được phép nêu tên. Bốn dòng: chính
  tài liệu này và ba tệp bộ máy của cổng. Thêm dòng thì phải kèm lý do; "để cổng
  thôi kêu" không phải lý do.

Còn lại ba mục **không** máy hoá được, phải tự soát:

- [ ] Sáu chỗ trích mã commit ở §2.2 đã sửa theo `commit-map`
- [ ] `.env` thật không bị theo dõi (`git ls-files | grep -c '^\.env$'` → `0`;
      `.env.example` thì được)
- [ ] Bốn cổng test xanh trên một cây làm việc **không có** kho gói riêng
      (`TUHOC_COURSE_STORE` trỏ vào chỗ không tồn tại, `courses/` đã xoá) —
      đó là bản clone mới, và từ task 13 nó phải xanh trọn vẹn

Và một việc cuối, nếu ngay cả **cái tên** cũng không được lộ: xoá §0/§1 của
chính tài liệu này và `scripts/private-markers.txt` khỏi bản sẽ push. Cổng sẽ
báo đỏ ở phép 4 khi ấy — đó là đúng, và là lý do nó fail-closed.

---

## 4. Người clone repo công khai sẽ thấy gì

Một repo không mang course nào **cho người dùng**. Đó là hình dạng đúng: nền
tảng không đi kèm nội dung, nội dung là gói rời. Cái nó mang là **dữ liệu test**
— hai gói mẫu công khai trong `fixtures/courses/`, do chính repo này soạn.

- `make dev-web` chạy được; danh mục rỗng cho tới khi một `apps/api` có course
  được trỏ tới (từ cú chuyển trục sang máy chủ, người đọc không còn tự nhập gói
  — xem `docs/superpowers/specs/2026-08-25-server-side-pivot.md`).
- `bun run build` chạy được với `courses/` rỗng **và** với `courses/` không tồn
  tại — nay vì một lý do đơn giản hơn hẳn: từ commit `dafd4eb` bản build **không
  đọc `courses/` nữa** (`apps/web/vite-plugins/courseAssets.ts`, `closeBundle`
  chỉ còn chép `course-kit/`).
- `make test-web`, `make test-format`, `make test-cli`, `make test-e2e`:
  **xanh trọn vẹn**. Đo ở task 13 bằng cách xoá `courses/` và trỏ
  `TUHOC_COURSE_STORE` vào một thư mục không tồn tại — 739 + 164 + 43 test đơn
  vị và 8 bài e2e đều xanh.

Trước task 13, mười tệp ở §1.3 đỏ trên bản clone của người khác, và đó là một
đánh đổi có ý thức: cách khác là để chúng tự `skip` khi thiếu dữ liệu, nhưng một
bộ test tự bỏ qua phần chạy trên dữ liệu thật, đúng lúc không có dữ liệu thật,
thì im lặng ở chỗ nó phải lên tiếng. Task 13 gỡ được đánh đổi ấy theo đúng lối
mà đoạn này đã hẹn: một course **công khai** làm mẫu thay vào vai ngữ liệu, và
mười tệp kia xanh cho mọi người — mà không tệp nào phải hạ khẳng định xuống.

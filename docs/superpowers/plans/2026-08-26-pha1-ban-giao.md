# Pha 1 — bàn giao: quyết định, nợ treo, và thứ Pha 2/3 thừa kế

Thi công xong 26/08/2026. 17 task, 56 commit (`217edbd..ddbefb7`), mỗi task một
vòng review độc lập, cộng một review tổng nhánh và một đợt sửa cuối.

Spec: `2026-08-25-server-side-pivot.md`. Plan: `2026-08-25-pha1-course-len-may-chu.md`.

Tài liệu này giữ thứ không nằm trong `git log`: các quyết định đã ra trong lúc thi
công, các món nợ cố ý để lại, và những chỗ Pha 2/3 phải nhặt.

---

## 1. Nợ đã PARK — mỗi món cần một task riêng, không phải một bản vá

Cả ba đều cần **một mã lỗi mới**, nghĩa là bốn nơi khai báo (`course-format`,
`FINDING_KEY` của web, hai tệp i18n, `FIX_HINTS` của CLI) cộng cả hai
implementation cộng fixture trong kho chung. Cả ba đều nằm sau cổng publish chỉ
admin, nên bán kính là "người vận hành tự bắn chân" chứ không phải lỗ hổng cho
người đọc.

| Nợ | Vì sao nó tồn tại | Rủi ro nếu bỏ qua |
|---|---|---|
| Không có luật hình dạng cho `manifest.id` | `id` giờ là một đoạn URL công khai và một khoá chính, nhưng luật chỉ đòi "chuỗi không rỗng" — trong khi `WIDGET_NAME_RE` siết tên widget chặt chẽ **vì đúng lý do này** | Một `id` chứa `/` publish được rồi render ra URL không tới được |
| `<base>` và `<meta http-equiv="refresh">` không nằm trong bộ luật content | Không thẻ nào chạy script nên bảy luật hiện tại không chạm tới, nhưng cả hai **có hiệu lực khi chèn bằng `innerHTML`** và có thể đổi gốc phân giải URL hoặc chuyển hướng người đọc trên origin đang giữ cookie phiên | Có từ v1; nhưng mô hình đe doạ vừa đổi bên dưới nó, nên đây là lúc hỏi lại |
| Không luật nào chặn `..` trong `src`/`href` của chương | `content.go` và `validate.ts` đều chỉ kiểm SCRIPT_TAG, EVENT_HANDLER_ATTR, JAVASCRIPT_URL, EMBEDDED_FRAME, FORM_TAG, TAG_ATTR_FLOOD | Vector cụ thể đã bịt phía client (`rewriteAssetUrls.ts`), nhưng cả *lớp* thì chưa |

---

## 2. Hai lời hứa trên màn hình sẽ thành SAI ở Pha 2/3

Đây là thứ dễ trôi nhất, vì cả hai **đang đúng hôm nay**.

**`login.point.ownKey`** — *"Trợ lý AI chạy bằng key của chính bạn, và key không đi
qua máy chủ của chúng tôi."* Đúng hôm nay. **Sai ngay khi `internal/ai` ship.** Nó
nằm cùng mảng với lời hứa mà Task 14 vừa sửa, và **không cổng nào trong hai cổng
canh câu chữ mới của pha này bắt được nó** — chúng quét chuỗi "ngoại tuyến" và
"gói đã tải", không quét câu này. Spec §0.1 là việc của Pha 2; đây là hạng mục cụ
thể đầu tiên của nó.

**`login.point.sync`** — *"Đăng nhập để tiến độ và ghi chú theo bạn trên mọi thiết
bị."* Đúng về *ý định*, chưa đúng về *hành vi*: tiến độ/ghi chú/chú giải vẫn ở
Dexie + sync engine. Spec §9 giao `/progress`, `/notes`, `/annotations` và
`POST /migrate` cho Pha 3. Pha 3 là thứ làm câu này thành thật.

---

## 3. Bốn lần điều phối viên sai, và cái giá của chúng

Ghi lại vì mỗi cái là một dạng lỗi dễ lặp.

1. **Một mã lỗi có BỐN nhà, không phải ba.** Sau Task 1 tôi chạy typecheck của
   `apps/web` và `tools/registry` rồi kết luận nhánh xanh — quên `tools/tuhoc-cli`.
   `TIER_REMOVED` lọt qua, Task 2 thêm tám mã nữa, thành 9 key thiếu. *Bài học: đổi
   mã lỗi thì chạy cả bốn cổng.*
2. **Ép Task 4 đạt 43/43** trong khi chính phán quyết của tôi để dành một ca đỏ cho
   Task 17. Implementer dừng lại hỏi thay vì ép một bản vá tồi.
3. **Bắt dịch `Finding.Detail` sang tiếng Việt** — va vào `i18n_server_speaks_codes_test.go`,
   một dây bẫy có sẵn cấm chuỗi tiếng Việt trong mã sản phẩm của `apps/api`, mà
   phần PHẠM VI của nó đã lường trước đúng cái ngoại lệ tôi định tạo. Đảo ngược.
   Nguyên tắc đúng: **`Code` là hợp đồng giữa hai implementation; ngôn ngữ của
   `Detail` là thuộc tính của nơi mã chạy.**
4. **Nói `DUPLICATE_ENTRY` không có bản dịch phía client.** Sai — key có sẵn trong
   cả hai catalog. Tôi lẫn "không thuộc union `FindingCode`" với "không có bản
   dịch", và cái sai ấy đi vào một chú thích mã trước khi review bắt được.

Thêm một phán quyết **đúng nhưng định giá sai**: "sửa migration 0005 tại chỗ thì rẻ
vì dễ phát hiện". golang-migrate không checksum tệp, nên một DB dev đã ở version 5
sẽ **không bao giờ chạy lại 0005** và âm thầm thiếu cột `admin_audit.actor` — lộ ra
dưới dạng 500 ở lần publish đầu, không phải lỗi migration. Đã bù bằng một dòng
trong `docs/deploy.md`.

---

## 4. Thứ chỉ review tổng nhánh mới thấy

Review tổng dựng một **bộ fuzz đối chiếu 14.079 đầu vào** giữa TypeScript và Go.
Hai bộ luật khớp trên **cả 14.012 đầu vào HTML**, kể cả mọi ca NUL và UTF-8 hỏng —
bằng chứng mạnh hơn nhiều so với những gì kho fixture một mình chứng minh được.
Bốn khác biệt tìm được đều ngoài tokenizer, và **không ca nào theo chiều nguy hiểm**.

Nó cũng tìm ra thứ không task nào thấy được vì mỗi task chỉ làm nửa của nó:
**cánh cửa người vận hành không mở được trên deploy sạch** (`ADMIN_TOKEN` chỉ có
trong `compose.e2e.yml`, không có chỗ nào ghi cách đặt admin đầu tiên), và
**ảnh trong chương không tới được** (`assetUrl()` có test nhưng không caller nào
gọi). Cả hai đã sửa.

---

## 5. Cổng đang canh gì, sau pha này

- `WidgetFrame.test.tsx` — `sandbox` phải **bằng đúng** `allow-scripts`; thêm
  `allow-same-origin` là đỏ.
- `widget.spec.ts` — Chromium thật: widget chạy được, `window.origin === 'null'`,
  `document.cookie` **ném `SecurityError`**. (Giả định ban đầu của plan là nó trả
  chuỗi rỗng — sai, phát hiện khi chạy thật.)
- `i18n_server_speaks_codes_test.go` — không chuỗi tiếng Việt nào trong mã sản
  phẩm `apps/api`. Phạm vi phủ cả gói chưa tồn tại.
- `Login.test.tsx` + `Settings.copy.test.tsx` — quét **văn bản đã render**, không
  quét tên key, nên lời hứa cũ không quay lại được qua một key tên khác.
- Kho fixture `fixtures/format-v2/` — hợp đồng giữa hai implementation; contract
  test hai phía đỏ nếu thêm ca mà không khai báo.
- `make test-e2e` — nay chỉ chạy `p1` + `widget`; `p2`/`s2` bị cách ly **có ghi lý
  do** tại ba nơi (config, đầu mỗi spec, commit message). Không phải nợ vô hình.

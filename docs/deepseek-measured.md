# Bốn chỗ tài liệu DeepSeek im lặng — đo trên API thật

Đo ngày **2026-08-28**, model `deepseek-v4-pro` (một trong ba model khả dụng
cho key nền tảng — xác nhận qua `GET /models`, cùng với `deepseek-v4-flash`
và `deepseek-v4-flash-vision-exp`). Tài liệu công khai của DeepSeek không nói
rõ bốn điều dưới đây; Task 4 (client.go), Task 6 (vòng lặp agent), Task 7 và
Task 9 (streaming + trừ credit) đều được viết QUANH bốn kết quả này — xem
`apps/api/internal/ai/types.go` (chú thích trên `Usage`) và
`apps/api/internal/ai/provider_contract_test.go` (cổng giữ tệp này không bị
xoá hay rút gọn — cổng đó canh cả cấp "cả tệp" lẫn cấp "từng mục", xem chú
thích trong tệp test đó cho needle của từng mục).

Đo hai lượt: điều phối viên Pha 2 đo trước bằng curl thô; Task 0 đo lại độc
lập, một lượt gọi cho mỗi mục, và xác nhận cả bốn khớp — trừ một khác biệt về
ĐỘ ỔN ĐỊNH ghi ở mục 3.

> Hai lượt đo ấy được ghi trong sổ thực thi dưới `.superpowers/sdd/…`, thư mục
> mà `.gitignore` loại (`docs/carried-forward.md` khai cùng ranh giới này ở
> ngay dòng thứ năm của nó). Bản trước của đoạn này trỏ tên hai tệp cụ thể
> trong đó mà KHÔNG khai điều ấy, nên chúng đọc như hai con trỏ có thể mở
> được, và chết trong mọi clone. Tệp NÀY là bản lưu bền của phần còn giá
> trị — bốn con số dưới đây phải tự đứng được, không cần một tệp ngoài git
> để đọc hiểu.

---

## 1. Tên trường trong `usage` (kể cả hai trường cache)

*Đo ngày 2026-08-28.*

**Tồn tại đúng tên plan giả định**: `prompt_cache_hit_tokens` và
`prompt_cache_miss_tokens`. Thẻ JSON trên `Usage` trong
`apps/api/internal/ai/types.go` **không cần sửa**.

Bằng chứng — `usage` của lượt gọi KHÔNG-stream ở mục 3 (yêu cầu gọi song
song hai tool), model `deepseek-v4-pro`. Cố tình dùng lượt gọi RIÊNG với mục
4 (mục 4 dùng một lượt `stream: true` khác) để hai mục có hai họ bằng chứng
độc lập, không tái dùng cùng một response cho cả hai khẳng định:

```json
"usage": {
  "prompt_tokens": 418,
  "completion_tokens": 110,
  "total_tokens": 528,
  "prompt_tokens_details": { "cached_tokens": 256 },
  "completion_tokens_details": { "reasoning_tokens": 32 },
  "prompt_cache_hit_tokens": 256,
  "prompt_cache_miss_tokens": 162
}
```

Hai thứ **ngoài dự tính**, không nằm trong bốn ẩn số gốc nhưng ảnh hưởng cách
đọc `usage`:

- **`completion_tokens_details.reasoning_tokens`** — `deepseek-v4-pro` là
  model suy luận ("Thinking mode", xem thông điệp lỗi ở mục 2). Token suy
  luận **NẰM TRONG** `completion_tokens` (110 tổng, 32 suy luận ở ví dụ trên
  — không phải cộng thêm ra ngoài). Hệ quả: `Charge` trong
  `apps/api/internal/ai/cost.go` tính toàn bộ `CompletionTokens` theo giá
  đầu ra là **ĐÚNG**, không phải bỏ sót giá suy luận riêng.
- **`prompt_tokens_details.cached_tokens`** — phản chiếu đúng giá trị
  `prompt_cache_hit_tokens` (bề mặt tương thích kiểu OpenAI DeepSeek giữ lại
  cùng lúc). Dùng cặp `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens`
  vì nó có cả hai nửa (hit VÀ miss); `prompt_tokens_details.cached_tokens`
  chỉ có nửa hit.

Không có model `deepseek-v4-flash` nào trả `reasoning_tokens` trong phép đo
của tôi (một lượt gọi model đó ở mục "phụ lục" bên dưới) — hợp lý nếu
`v4-flash` không bật chế độ suy luận theo mặc định. Chunk `usage` cuối stream
ở mục 4 mang đúng shape này lần thứ ba (cùng bảy trường, giá trị khác vì
lượt gọi khác) — một sự trùng khớp CHÍNH LÀ điều mục này cần chứng minh:
shape `usage` ổn định qua cả đường non-stream lẫn đường stream.

## 2. `tool_choice` — chỉ hai giá trị dùng được

*Đo ngày 2026-08-28.*

Đo bốn giá trị trên `deepseek-v4-pro`, cùng một tool `read_chapter`:

| Giá trị `tool_choice` | Kết quả |
|---|---|
| `"auto"` | `finish_reason: "stop"` — OK |
| `"none"` | `finish_reason: "stop"` — OK |
| `"required"` | **Lỗi**: `{"message": "Thinking mode does not support this tool_choice", "type": "invalid_request_error", ...}` |
| `{"type":"function","function":{"name":"read_chapter"}}` (ép một hàm cụ thể) | **Lỗi**: cùng thông điệp |

Hệ quả cho Task 6 (vòng lặp agent): **không ép được model gọi một hàm cụ
thể** — thiết kế vòng lặp không được dựa vào `tool_choice` để buộc một bước
tra cứu bắt buộc. Nhưng `"none"` chạy được, và đó đúng là thứ vòng lặp cần
cho lượt **CUỐI CÙNG** (hết ngân sách vòng tool, ép model trả lời bằng văn
bản thay vì gọi tool nữa). Thiết kế vòng lặp: các vòng trước gửi
`tool_choice: "auto"`, vòng cuối gửi `tool_choice: "none"`.

## 3. Gọi tool đồng thời trong một lượt — CÓ (nhưng phụ thuộc câu hỏi có đủ cụ thể không)

*Đo ngày 2026-08-28.*

Một lượt **có thể** trả về nhiều phần tử trong `tool_calls`. Bằng chứng —
prompt yêu cầu rõ ràng gọi cả hai tool trong cùng lượt:

```json
"tool_calls": [
  {"id": "call_00_0W5fc7bElUjq8KRkDN2R3150", "type": "function",
   "function": {"name": "read_chapter", "arguments": "{\"chapter_id\": \"1\"}"}},
  {"id": "call_01_MgVimlelYoJBKMlMq2BD7378", "type": "function",
   "function": {"name": "read_chapter", "arguments": "{\"chapter_id\": \"2\"}"}}
],
"finish_reason": "tool_calls"
```

Hệ quả: `tool_calls` là **MẢNG** nhiều phần tử, mỗi phần tử một `id` riêng.
Vòng lặp agent phải chạy hết mảng và trả **MỘT** tin `role:"tool"` cho **MỖI**
`tool_call_id` — không được giả định chỉ có một tool_call mỗi lượt.

**Khác biệt so với đo của điều phối viên, đáng ghi lại**: lượt đo ĐẦU TIÊN
của tôi, dùng đúng nguyên văn câu hỏi ở Step 3 của brief ("So sánh chương 1
và chương 2." — không nói rõ tên/mã sách), model **không gọi tool nào cả**
— nó hỏi lại để làm rõ (`finish_reason: "stop"`, không có `tool_calls`).
Chỉ khi tôi đổi câu hỏi thành chỉ dẫn rõ ràng ("Dùng tool read_chapter để đọc
chương có chapter_id là 1, sau đó... chapter_id là 2. Gọi cả hai tool ngay
trong lượt này.") model mới gọi đồng thời 2 tool_calls như ở trên. Đây KHÔNG
phải mâu thuẫn với đo của điều phối viên (họ dùng một câu hỏi khác, "So sánh
chương 1 và chương 2." trong ngữ cảnh có nhắc "giáo trình" ở lượt trước) —
mà là một xác nhận thêm: **khả năng nhiều tool_calls trong một lượt có
thật**, nhưng **việc model có chọn dùng nó hay không phụ thuộc vào độ cụ thể
của ngữ cảnh/câu hỏi**, không phải một thuộc tính cố định của API. Task 6
không nên giả định "hỏi so sánh N chương luôn ra N tool_calls" — nên coi
vòng lặp tool là một vòng CÓ THỂ chạy nhiều bước (model tự quyết định gọi
bao nhiêu tool, có thể 0, 1, hoặc nhiều trong một lượt), không phải một phép
đếm cố định.

## 4. Streaming cùng tool call — CÓ, `arguments` rời rạc qua nhiều chunk

*Đo ngày 2026-08-28.*

`stream: true` + `tools` trên cùng request: DeepSeek trả các dòng
`data: {...}\n\n` kiểu SSE. Chunk đầu mang tool call mang `id`/`type`/`name`
với `arguments` RỖNG:

```json
data: {"choices":[{"index":0,"delta":{"tool_calls":[
  {"index":0,"id":"call_00_JKplDF8t8DbqkZaGChDX1881","type":"function",
   "function":{"name":"read_chapter","arguments":""}}
]},"finish_reason":null}]}
```

Các chunk sau chỉ mang một MẢNH của chuỗi `arguments`, khớp theo `index`
(không mang lại `id`/`type`/`name`):

```json
data: {"choices":[{"index":0,"delta":{"tool_calls":[
  {"index":0,"function":{"arguments":"{"}}
]},"finish_reason":null}]}

data: {"choices":[{"index":0,"delta":{"tool_calls":[
  {"index":0,"function":{"arguments":"\""}}
]},"finish_reason":null}]}

data: {"choices":[{"index":0,"delta":{"tool_calls":[
  {"index":0,"function":{"arguments":"chapter"}}
]},"finish_reason":null}]}
```

Hệ quả: client streaming (Task 4b) phải nối chuỗi `arguments` theo `index` qua toàn bộ chunk, không được đọc `arguments` một lần ở chunk đầu. Với nhiều tool_calls song song trong stream, mỗi tool_call giữ `index` riêng — nối theo đúng `index` của nó, không theo thứ tự chunk đến.

Chunk có `finish_reason: "tool_calls"` xuất hiện, và **`usage` CÓ MẶT trong
chunk cuối cùng của stream** (chunk mang `finish_reason`, `delta` rỗng) —
đây là lượt gọi RIÊNG với lượt non-stream dùng làm bằng chứng ở mục 1:

```json
data: {"choices":[{"index":0,"delta":{"content":"","reasoning_content":null},
  "finish_reason":"tool_calls"}],
  "usage":{"prompt_tokens":386,"completion_tokens":66,"total_tokens":452,
    "prompt_tokens_details":{"cached_tokens":256},
    "completion_tokens_details":{"reasoning_tokens":20},
    "prompt_cache_hit_tokens":256,"prompt_cache_miss_tokens":130}}

data: [DONE]
```

Stream kết thúc bằng dòng `data: [DONE]` (không phải JSON, chuỗi ký tự
đúng bốn ký tự `[DONE]`).

Hệ quả cho Task 7 + Task 9: **trừ credit được ngay từ chính stream đang
chạy** — đọc `usage` ở chunk cuối trước khi đóng kết nối, không cần một lời
gọi thứ hai (không-stream) chỉ để lấy usage sau khi stream xong.

## 5. Cache chạy thật (quan sát phụ, không phải một trong bốn ẩn số)

*Đo ngày 2026-08-28.*

`prompt_cache_hit_tokens: 256` xuất hiện ở cả lượt đo mục 1 (tổng
`prompt_tokens: 418`) lẫn lượt đo mục 4 (tổng `prompt_tokens: 386`), sau khi
đã gửi vài lượt trước đó có cùng tiền tố hệ thống/tool schema. Xác nhận: (a)
cache của DeepSeek chạy thật trên key này, và (b) thiết kế "giữ thứ tự tin
nhắn ổn định để giữ tiền tố cache" của plan Pha 2 là đúng hướng — đổi thứ tự
tool/system message giữa các lượt sẽ làm tiền tố lệch và mất cache hit.

## Phụ lục — model `deepseek-v4-flash` (alias `deepseek-chat`), không phải một trong bốn ẩn số

*Đo ngày 2026-08-28.*

Một lượt gọi phụ dùng alias `deepseek-chat` (route sang `deepseek-v4-flash`)
xác nhận cùng shape `usage` cơ bản, KHÔNG có `completion_tokens_details`
(model này không bật suy luận cho câu hỏi đơn giản):

```json
"usage": {
  "prompt_tokens": 297,
  "completion_tokens": 63,
  "total_tokens": 360,
  "prompt_tokens_details": { "cached_tokens": 0 },
  "prompt_cache_hit_tokens": 0,
  "prompt_cache_miss_tokens": 297
}
```

Ghi lại vì nó cho thấy `completion_tokens_details.reasoning_tokens` là
TUỲ MODEL/TUỲ LƯỢT, không phải một trường luôn có mặt — mã đọc `usage`
không được giả định trường này tồn tại.

---

## 6. Thân lỗi có bao giờ trích lại nội dung request không? — đo 11 ca, KHÔNG

Câu hỏi này không phải tò mò: `client.go` và `stream.go` bọc `error.message`
của DeepSeek **nguyên văn** (đã cắt bằng `truncateProviderMessage`) vào error
Go, và error ấy đi tới `slog.Error("ai turn failed", …, "err", runErr.Error())`
ở `handler.go` — tức **vào apilog**. Nếu DeepSeek từng trích lại một mảnh của
request bị từ chối, mảnh đó mang nội dung người học và đi thẳng vào log máy chủ
mà không qua bộ lọc nào. Cổng `apilog/no_ai_bodies_test.go` khai đúng lỗ này
trong doc comment của nó ("One shape is DELIBERATELY left untested here") và
để lại cho một task sau — đây là task ấy.

**Cách đo:** một sentinel `ZQXJV-SENTINEL-7731-KHOAHOC` đặt **chỉ** bên trong
`messages[].content` (và một lần trong `tools[].function.description`), rồi cố
tình gây lỗi bằng 11 đường khác nhau, kiểm sentinel có xuất hiện trong thân lỗi
trả về không. Đo ngày 2026-08-29.

| # | Cách gây lỗi | HTTP | Sentinel trong thân lỗi |
|---|---|---|---|
| 1 | model không tồn tại | 400 | không |
| 2 | `temperature: 99` | 400 | không |
| 3 | `max_tokens: -5` | 400 | không |
| 4 | `role` không hợp lệ | 400 | không |
| 5 | `content` sai kiểu (object thay vì string) | 400 | không |
| 6 | `tool_choice: "required"` ở thinking mode | 400 | không |
| 7 | API key sai | 401 | không |
| 8 | `tool_calls[].arguments` là JSON hỏng | 400 | không |
| 9 | message `role: "tool"` mồ côi | 400 | không |
| 10 | `tools[].type` sai variant | 400 | không |
| 11 | prompt ~1,68 triệu ký tự | **200** | không (xem ghi chú) |

**Kết luận: không có bằng chứng DeepSeek trích lại nội dung.** Nhưng bức tranh
có sắc thái, và sắc thái mới là thứ đáng ghi:

**DeepSeek CÓ echo giá trị request — nhưng chỉ ở trường vô hướng.** Bộ giải mã
(serde của Rust) trả về nguyên văn giá trị sai cho enum và số:

```
messages[0].role: unknown variant `khong-hop-le`, expected one of `system`, `user`, …
tools[0].type: unknown variant `khong-phai-function`, expected `function`
max_tokens: invalid value: integer `-5`, expected u32
```

**Nhưng khi trường sai CHÍNH LÀ chỗ mang nội dung, nó mô tả kiểu, không đổ giá
trị** — đây là điểm dữ liệu quan trọng nhất của cả bảng:

```
messages[0]: content should be a string or a list
```

Lỗi ngữ nghĩa (khác lỗi giải mã) là **câu cố định, không mang giá trị nào**:
`"Messages with role 'tool' must be a response to a preceding message with
'tool_calls'"`, `"Thinking mode does not support this tool_choice"`.

**DeepSeek tự che key của chính nó:** `"Authentication Fails, Your api key:
****0000 is invalid"` — key bị mask ở phía họ, không chỉ phía ta.

**Hai ghi chú về ca #11.** Nó **không** trả lỗi: `deepseek-v4-flash` nhận ~1,68
triệu ký tự và trả HTTP 200 kèm một câu trả lời bình thường. Nên ca "vượt cửa
sổ ngữ cảnh" — chỗ khả dĩ nhất một API trích lại đầu vào — **vẫn chưa đo được**
bằng đường này. Và nó tốn tiền thật (~420k token đầu vào): một phép đo chọn sai
kích thước, ghi lại để người sau đừng lặp.

### Thứ phép đo này KHÔNG chứng minh

- **Từ chối vì chính sách nội dung** — đúng hình dạng mà doc comment của cổng
  gọi là "the plausible shape". Không đo, **có chủ ý**: kích hoạt nó đòi soạn
  nội dung cốt để bị từ chối. Đây là lỗ còn lại thật sự, không phải chỗ bỏ quên.
- **Hạn mức / hết quota** (429) — không kích hoạt được theo yêu cầu.
- Hành vi tương lai: đây là ảnh chụp một API bên thứ ba ở một ngày, không phải
  một hợp đồng. DeepSeek đổi câu chữ lỗi lúc nào cũng được, không báo ai.

### Vì sao vẫn GIỮ `error.message` trong lỗi

Phép đo cho thấy các thông điệp này chính là thứ người vận hành cần: *"The
supported API model names are …, but you passed …"* nói thẳng vấn đề. Bỏ trường
`message` đi sẽ mất toàn bộ khả năng chẩn đoán ấy để đổi lấy một lợi ích riêng
tư **không đo được**. Trần 200 rune của `truncateProviderMessage` cũng hoá ra
được hiệu chỉnh đúng: thông điệp hữu ích dài nhất quan sát được là 139 ký tự,
dài nhất nói chung là ~160 — nằm gọn dưới trần, nên trần đang cắt đúng thứ nó
sinh ra để cắt (thân lỗi khổng lồ), không cắt nhầm thứ hữu ích.

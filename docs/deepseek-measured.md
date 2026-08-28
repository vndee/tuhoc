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

Đo hai lượt: điều phối viên Pha 2 đo trước bằng curl thô, kết quả nằm ở
`.superpowers/sdd/2026-08-28-pha2-ai-may-chu/task-0-measurements-raw.md`. Task
0 (tệp báo cáo: `.superpowers/sdd/2026-08-28-pha2-ai-may-chu/task-0-report.md`)
đo lại độc lập, một lượt gọi cho mỗi mục, và xác nhận cả bốn khớp — trừ một
khác biệt về ĐỘ ỔN ĐỊNH ghi ở mục 3.

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

// agent.go nối Client (Task 4b) với ToolRunner (Task 5) thành một VÒNG LẶP:
// gửi một lượt, đọc model có muốn gọi tool không, chạy tool nếu có, gửi kết
// quả tool lại cho model, lặp tới khi model trả lời bằng chữ hoặc trần vòng
// tool bị chạm — rồi cộng dồn số đo để Task 9 trừ credit đúng.
//
// Bốn điều package này CHỦ ĐỘNG giữ đúng, không phải quy ước ai đó nhớ giữ:
//  1. Thứ tự tin nhắn ổn định (buildMessages) — cache của DeepSeek khớp theo
//     TIỀN TỐ, và cache-hit rẻ hơn cache-miss 30-60 lần (đo thật,
//     docs/deepseek-measured.md §1/§5). Thứ tự sai không lỗi HTTP nào — nó
//     chỉ âm thầm làm hoá đơn cao.
//  2. Prompt nền (ai_settings.base_system_prompt) không bao giờ bị THAY —
//     prompt riêng của người dùng (user_agent_config.system_prompt) chỉ được
//     NỐI SAU, một message hệ thống riêng, không gộp chung chuỗi, và được
//     đóng khung rõ là KHÔNG được đè quy tắc của prompt nền.
//  3. Tool không nằm trong Turn.ToolsEnabled không bao giờ được liệt vào
//     Request.Tools gửi cho DeepSeek, VÀ không bao giờ thật sự CHẠY dù model
//     có gọi tên nó — tắt một tool ở tầng UI mà vẫn gửi/chạy nó là vẫn bị
//     tính vào ngữ cảnh (và tính tiền).
//  4. History không được mang một message role "system" (hay bất kỳ role
//     nào khác ngoài "user"/"assistant"/"tool") vào nguyên vẹn —
//     buildMessages là chỗ DUY NHẤT ráp toàn bộ prompt, nên nó là chỗ DUY
//     NHẤT có thể chặn một message giả danh "system" trà trộn vào History
//     rồi mang thẩm quyền ngang prompt nền.
package ai

import (
	"context"
	"errors"
	"fmt"
)

// Completer là bề mặt HẸP NHẤT Agent cần từ một client DeepSeek — đúng một
// phương thức, chữ ký giống hệt (*Client).Complete.
//
// TỰ QUYẾT ĐỊNH (task-6-brief.md nêu rõ đây là việc phải chọn, ghi lý do):
// brief khai `Agent{Client *Client}` — kiểu CỤ THỂ — nhưng Step 3 đòi một
// "Client giả" để khẳng định trần vòng tool cắt vòng lặp. Một kiểu cụ thể
// (struct với field không xuất khẩu, như Client ở client.go) không giả lập
// được bằng cách cài một interface, vì nó VỐN không phải interface — chỉ có
// hai lối thật sự khả thi:
//
//   - Đổi Client (field của Agent) thành một interface hẹp — LỐI ĐÃ CHỌN.
//   - Giữ Agent.Client kiểu *Client, và giả lập bằng httptest.Server đóng
//     vai nhà cung cấp DeepSeek thật (đúng tiền lệ client_test.go đã có).
//
// Lý do chọn interface, không phải httptest:
//
//  1. Agent, Turn, Result là hợp đồng Task 7/9/11 dùng lại NGUYÊN VẸN (ghi
//     rõ trong task-6-brief.md dòng cuối). Task 7 thêm RunStream — một vòng
//     lặp SONG SONG với Run, cùng logic trần vòng/prefix ổn định, và chắc
//     chắn cũng cần test theo kiểu "client giả trả X, khẳng định vòng lặp
//     làm Y" giống hệt bốn Step ở đây. Một interface hẹp thì cả hai file
//     agent.go/stream.go dùng chung MỘT fakeCompleter; một *Client cụ thể
//     thì MỖI file phải tự dựng httptest.Server riêng.
//  2. progress.md (ledger điều phối Pha 2) đã ghi nợ CHÍNH XÁC rủi ro này:
//     "Task 4b: NỢ MANG SANG TASK 6/7 — dương tính giả này SẼ tái diễn ở
//     Task 7: client streaming... và httptest đóng vai nhà cung cấp sẽ lại
//     chạm keyBearingFields" — nói về
//     internal/server/provider_key_never_leaks_test.go's TestNoRequestStructAcceptsAKey,
//     dây bẫy quét TOÀN REPO tìm lời gọi đọc-tiện-lợi một-tham-số của
//     net/http.Header trên đúng tên header này (và vài hình dạng tương tự)
//     bất kể CHIỀU dữ liệu — client_test.go đã phải né bằng cách đọc qua
//     chỉ mục map thay vì phương thức đọc-tiện-lợi đó, kèm 12 dòng chú
//     thích giải thích vì sao đọc-qua-map không kích dây bẫy. Một
//     httptest.Server mới trong agent_test.go/stream_test.go lại phải tự
//     làm y hệt, mỗi tệp một lần — một chi phí lặp lại không cần thiết khi
//     KHÔNG có gì trong bốn Step của Task 6 thật sự cần một request HTTP
//     thật đi qua mạng loopback: cả bốn Step chỉ cần biết "client trả gì,
//     vòng lặp làm gì với nó", không cần biết "request có đúng shape HTTP
//     không" (câu hỏi ĐÓ đã được client_test.go trả lời đầy đủ rồi, ở đúng
//     lớp của nó).
//  3. Đây là practice chuẩn Go ("accept interfaces, return structs") — New
//     (client.go) vẫn trả về *Client cụ thể như cũ, không đổi gì ở đó;
//     Completer chỉ là bề mặt Agent CHẤP NHẬN, không phải kiểu Client TỰ
//     KHAI. *Client tự động thoả interface này (xem `var _ Completer =
//     (*Client)(nil)` dưới đây) — không cần đổi gì ở client.go/client_test.go
//     để lối này hoạt động.
type Completer interface {
	Complete(ctx context.Context, req Request) (Completion, error)
}

// var _ Completer ép biên dịch fail nếu *Client (client.go) lỡ trôi khỏi
// chữ ký Complete(context.Context, Request) (Completion, error) mà
// Completer đòi — bắt lỗi ở BUILD TIME thay vì để agent.go's caller thật
// (Task 11's handler, khi nối *Client vào Agent{Client: c}) phát hiện qua
// một lỗi "does not implement" khó hiểu hơn ở một chỗ xa hơn nhiều.
var _ Completer = (*Client)(nil)

// Agent nối một Completer (thường là *Client thật, Task 4b) với một tập
// ToolRunner (Task 5, và Task 8's web_search sau này) theo đúng Settings
// (ai_settings, Task 2) — hai trần MaxTokensPerTurn/MaxToolRoundsPerTurn
// đọc từ đây.
//
// Tools là map[string]ToolRunner — TOÀN BỘ tool agent này CÓ THỂ chạy, không
// phải tool được PHÉP chạy ở một Turn cụ thể. Turn.ToolsEnabled (dưới đây)
// là danh sách con của Tools mà một NGƯỜI DÙNG cụ thể đã bật
// (user_agent_config.tools_enabled) — Run lọc theo đó trước khi gửi bất cứ
// gì cho DeepSeek, xem enabledTools.
type Agent struct {
	Client   Completer
	Tools    map[string]ToolRunner
	Settings Settings
}

// Turn là tham số một lượt hỏi-đáp Run xử lý.
//
//   - BasePrompt là ai_settings.base_system_prompt — cấu hình NỀN TẢNG,
//     giữ vai trò gia sư và ranh giới an toàn (spec §3.3). buildMessages
//     đặt nó ở message ĐẦU TIÊN, nguyên văn, không bao giờ sửa hay thay.
//   - UserPrompt là user_agent_config.system_prompt — tuỳ biến CỦA NGƯỜI
//     DÙNG, NỐI SAU BasePrompt như một message hệ thống riêng, không bao
//     giờ thay thế nó (xem doc comment buildMessages).
//   - CourseSlug là course người học đang xem lúc hỏi (nếu có — trang chủ
//     hay một khoá học không rõ ràng thì để rỗng). Không phải cột DB nào
//     (không nằm trong Settings hay user_agent_config) — đây là NGỮ CẢNH
//     CỦA MỘT LƯỢT, do Task 11's handler đọc từ route hiện tại rồi truyền
//     vào. buildMessages gắn nó thành một message hệ thống RIÊNG (chỉ khi
//     khác rỗng), đặt NGAY TRƯỚC Question — không phải trong vùng tiền tố
//     ổn định cùng BasePrompt/UserPrompt, vì CourseSlug có thể đổi giữa các
//     lượt trong CÙNG một phiên (người học chuyển course) — xem doc comment
//     buildMessages, điểm 4, cho lý do đầy đủ. Mục đích: để model biết ngay
//     slug cần truyền cho tham số bắt buộc "slug" của tool read_course
//     (tool_course.go) mà không phải đoán hay hỏi lại người học.
//   - History là các lượt TRƯỚC trong cùng phiên hội thoại (không bao gồm
//     Question của lượt này) — Run/buildMessages chuyển tiếp NỘI DUNG
//     nguyên vẹn, nhưng KHÔNG tin ROLE nguyên vẹn: một entry mang role khác
//     "user"/"assistant"/"tool" (đáng chú ý nhất: "system" — nguồn có thể
//     là chính client, nếu Task 11's handler đọc History từ thân request
//     thay vì tự dựng lại từ DB) bị HẠ CẤP xuống "user" trước khi vào
//     buildMessages's kết quả — xem doc comment buildMessages. Nội dung
//     được GIỮ LẠI (không xoá câm), chỉ THẨM QUYỀN của nó bị tước.
//   - ToolsEnabled là user_agent_config.tools_enabled của người dùng — tên
//     tool (khớp ToolRunner.Definition().Function.Name) được phép gửi cho
//     DeepSeek ở lượt NÀY. Một tool nằm trong Agent.Tools nhưng KHÔNG nằm
//     trong danh sách này không bao giờ xuất hiện trong Request.Tools — xem
//     enabledTools.
type Turn struct {
	Model        string
	BasePrompt   string
	UserPrompt   string
	CourseSlug   string
	History      []Message
	Question     string
	ToolsEnabled []string
}

// Result là số đo VÀ nội dung của một lượt Run đã hoàn tất — Task 9's
// ChargeTurn đọc trực tiếp struct này để trừ credit, nên MỌI trường ở đây
// là tiền hoặc dẫn tới tiền.
//
//   - Usage CỘNG DỒN mọi vòng gọi Complete bên trong lượt này, không phải
//     usage của riêng vòng cuối — một lượt tốn 3 vòng tool trước khi model
//     chịu trả lời thì cả 3 vòng đều tốn token thật, và Charge (cost.go)
//     phải tính đủ cả 3, không chỉ vòng rẻ nhất (thường là vòng cuối,
//     ToolChoiceNone, không có tool_calls nên completion ngắn hơn).
//   - ToolCalls đếm TỔNG số tool_call model gọi trong lượt này, thuộc BẤT
//     KỲ tool nào — dùng cho quan sát/log, Charge không đọc trực tiếp
//     trường này (nó tính tiền theo token, cộng phụ thu riêng cho
//     WebSearches).
//   - WebSearches đếm RIÊNG số tool_call gọi đúng tool tên "web_search"
//     (Task 8, plan Pha 2: "func NewSearchTool(...) ToolRunner // tên tool:
//     web_search") VÀ THẬT SỰ CHẠY THÀNH CÔNG — CHỈ tăng sau khi
//     ToolRunner.Run trả về không lỗi (runErr == nil), KHÔNG tăng khi model
//     chỉ XIN gọi (tool không tồn tại, tool bị tắt ở ToolsEnabled lượt này,
//     hay ToolRunner.Run tự trả lỗi). Charge (cost.go) nhân số này với
//     Settings.CostMicroPerWebSearch/CreditsPerWebSearch, một phụ thu KHÁC
//     hẳn giá token thường — đếm ở chỗ model XIN thay vì chỗ tool ĐÃ CHẠY
//     sẽ tính phụ thu cho một việc chưa từng xảy ra (round 1 review, Critical
//     C1). Task 6 chạy TRƯỚC khi Task 8 tồn tại, nên không tool nào tên
//     "web_search" thật sự được đăng ký trong Agent.Tools ở giai đoạn này —
//     trường này khớp đúng 0 cho tới khi Task 8 nối vào, nhưng cơ chế đếm
//     (theo TÊN tool, xem Run) đã sẵn sàng, không cần sửa agent.go khi Task
//     8 hạ cánh.
type Result struct {
	Answer      string
	Usage       Usage
	ToolCalls   int
	WebSearches int
}

// webSearchToolName là tên tool Result.WebSearches đếm riêng — khớp CHÍNH
// XÁC tên Task 8 sẽ đăng ký (xem doc comment Result.WebSearches ở trên).
// Đặt thành hằng, không phải chuỗi lặp lại nhiều chỗ trong Run, để một khi
// Task 8 đổi tên tool (nếu có) chỉ cần sửa MỘT dòng.
const webSearchToolName = "web_search"

// historyAllowedRoles là bộ role một entry Turn.History được giữ NGUYÊN VẸN
// khi vào buildMessages — đúng ba role shape API kiểu OpenAI-chat DeepSeek
// dùng cho phía "đã xảy ra trong hội thoại" (không phải "system", vốn chỉ
// dành cho hai chỗ buildMessages tự dựng: BasePrompt/UserPrompt). Một entry
// role khác — "system" là hình dạng đáng lo nhất, nhưng bất kỳ chuỗi lạ nào
// khác cũng vậy — bị hạ xuống "user" (xem buildMessages).
var historyAllowedRoles = map[string]bool{"user": true, "assistant": true, "tool": true}

// buildMessages ráp Turn thành mảng Message gửi DeepSeek, theo ĐÚNG một thứ
// tự cố định — không phụ thuộc Turn có field nào rỗng hay không, trừ việc
// bỏ hẳn một message khi nội dung của nó rỗng (một message hệ thống rỗng
// không giúp gì model, chỉ tốn token và có thể làm lệch tiền tố cache một
// cách vô ích):
//
//  1. system: BasePrompt — LUÔN có mặt, LUÔN ở vị trí đầu tiên, LUÔN nguyên
//     văn. Đây là "tiền tố ổn định" chính mà toàn hệ thống agent dựa vào để
//     cache của DeepSeek khớp được qua nhiều lượt/nhiều người dùng khác
//     nhau đang dùng CHUNG một base_system_prompt.
//  2. system: UserPrompt — CHỈ khi khác rỗng. Một message RIÊNG, đứng SAU
//     BasePrompt — "nối sau, không thay" nghĩa là NỐI THÊM MỘT MESSAGE, chứ
//     không phải nối chuỗi vào Content của message 1 (nối chuỗi sẽ xoá mất
//     ranh giới "đây là do NỀN TẢNG đặt" và "đây là do NGƯỜI DÙNG đặt" mà
//     hai message riêng biệt còn giữ được). Nội dung được ĐÓNG KHUNG bằng
//     một câu cố định nói rõ nó KHÔNG được đè quy tắc ở BasePrompt (round 1
//     review, I5, nửa "câu khung"): một message "system" trần, không câu
//     khung, mang thẩm quyền NGANG BasePrompt trong mắt model — với hai chỉ
//     dẫn "system" xung đột, model có xu hướng theo message ĐỨNG SAU, đúng
//     hướng ngược với "prompt nền giữ vai trò gia sư và ranh giới an toàn"
//     (spec §3.3) mà UserPrompt tuyệt đối không được phép đảo ngược.
//  3. History — role trong ba giá trị historyAllowedRoles được giữ NGUYÊN
//     VẸN, đúng thứ tự Turn mang vào; một entry mang role KHÁC (đáng ngại
//     nhất: "system") bị HẠ xuống "user" trước khi thêm vào — nội dung vẫn
//     còn, chỉ thẩm quyền bị tước (round 1 review, I5, nửa "History không
//     lọc role"): buildMessages là hàm DUY NHẤT ráp toàn bộ prompt, nên nó
//     là chỗ DUY NHẤT chặn được một entry History giả danh "system" (nguồn
//     có thể là chính client, nếu Task 11's handler sau này đọc History
//     thẳng từ thân request) trà trộn vào SAU BasePrompt/UserPrompt với
//     đúng thẩm quyền "system" như hai message đó.
//  4. system: ngữ cảnh CourseSlug — CHỈ khi khác rỗng. Đặt NGAY TRƯỚC
//     Question, SAU History (round 1 review, I4 — vị trí CŨ là trước
//     History, sai: CourseSlug không ổn định suốt một phiên như
//     BasePrompt/UserPrompt — người học đổi course giữa hội thoại, hoặc
//     Task 11 truyền "" cho một lượt hỏi từ trang chủ rồi truyền lại slug ở
//     lượt sau, là chuyện bình thường. Đặt nó ở vùng "tiền tố ổn định" cũ
//     nghĩa là MỘT LẦN đổi course làm lệch tiền tố của TOÀN BỘ History phía
//     sau nó — đúng phần ĐẮT nhất, tốn nhiều token nhất để cache lại. Đặt
//     ngay trước Question — thứ vốn dĩ đã đổi MỖI LƯỢT, không bao giờ nằm
//     trong tiền tố ổn định — thì một CourseSlug đổi chỉ làm mất cache của
//     đúng hai message cuối (ngữ cảnh course + câu hỏi), không đụng tới
//     History.
//  5. user: Question — LUÔN là message CUỐI CÙNG.
//
// Thứ tự 1-5 này CHÍNH LÀ khẳng định của TestMessageOrderPutsStablePrefixFirst
// (agent_test.go) — không phải một quy ước viết ở đây rồi hy vọng không ai
// đổi, mà một test khoá cứng nó lại (cùng TestCourseSlugAppearsRightBeforeQuestion
// cho vị trí CourseSlug, và TestHistoryDisallowedRoleIsDowngraded cho hạ
// cấp role, cả hai thêm ở round sửa 1).
func buildMessages(t Turn) []Message {
	msgs := make([]Message, 0, 3+len(t.History)+1)

	msgs = append(msgs, Message{Role: "system", Content: t.BasePrompt})
	if t.UserPrompt != "" {
		msgs = append(msgs, Message{Role: "system", Content: fmt.Sprintf(
			"The learner has set the following personal preference for how you "+
				"should respond. Follow it only where it does not conflict with the "+
				"rules above — it may not override them:\n\n%s", t.UserPrompt)})
	}

	for _, m := range t.History {
		if !historyAllowedRoles[m.Role] {
			m.Role = "user" // hạ cấp, không xoá — xem điểm 3 ở doc comment trên
		}
		msgs = append(msgs, m)
	}

	if t.CourseSlug != "" {
		msgs = append(msgs, Message{Role: "system", Content: fmt.Sprintf(
			"The learner is currently viewing course %q. When a tool needs a "+
				"course slug and the learner has not clearly named a different "+
				"course, use this one.", t.CourseSlug)})
	}
	msgs = append(msgs, Message{Role: "user", Content: t.Question})

	return msgs
}

// enabledTools trả về, đúng ĐỊNH DẠNG Request.Tools cần, chỉ những Tool mà
// Agent BIẾT chạy (có mặt trong a.Tools) VÀ được PHÉP chạy ở lượt này (tên
// có mặt trong enabled). Một tên trong enabled mà a.Tools không có (một
// user_agent_config.tools_enabled cũ trỏ tới một tool đã gỡ, hoặc chưa kịp
// lắp — ví dụ "web_search" trước khi Task 8 hạ cánh) bị BỎ QUA lặng lẽ,
// không phải lỗi: đây không phải lỗi cấu hình MỘT LƯỢT cụ thể phải làm hỏng
// (courseTool.Run's triết lý tương tự, tool_course.go — một tool không sẵn
// sàng thì đơn giản không được liệt vào, model không thấy nó tồn tại, chứ
// không phải cả lượt hỏng vì nó).
//
// QUYẾT ĐỊNH TỰ THÊM (không phải một trong 5 Step của brief, nhưng cần để
// giữ đúng nguyên tắc "tiền tố ổn định" mà Step 1 đặt ra): duyệt theo THỨ TỰ
// của enabled (Turn.ToolsEnabled, vốn là user_agent_config.tools_enabled —
// một mảng Postgres CÓ thứ tự, ổn định giữa các lượt của CÙNG một người
// dùng), KHÔNG duyệt map a.Tools trực tiếp. Duyệt một map Go cho thứ tự
// NGẪU NHIÊN mỗi lần chạy (đặc tính cố ý của runtime Go, không phải chi
// tiết cài đặt có thể bỏ qua) — nếu enabledTools duyệt a.Tools, mảng "tools"
// trong Request sẽ đổi thứ tự giữa các vòng gọi Complete TRONG CÙNG một
// lượt (round 1 khác round 2) và giữa các lượt khác nhau của cùng một
// người dùng, làm lệch đúng tiền tố mà Step 1 vừa khẳng định phải ổn định —
// "tools" nằm trong phần request DeepSeek băm để khớp cache, ngang hàng với
// "messages". Duyệt theo enabled thay vì theo map cho thứ tự này ổn định
// TUYỆT ĐỐI cho cùng một cấu hình tools_enabled, không phụ thuộc runtime Go
// duyệt map thế nào.
func (a *Agent) enabledTools(enabled []string) []Tool {
	var tools []Tool
	for _, name := range enabled {
		runner, ok := a.Tools[name]
		if !ok {
			continue
		}
		tools = append(tools, runner.Definition())
	}
	return tools
}

// ErrToolBudgetExhausted bọc lỗi Run trả khi VÒNG CUỐI (round == maxRounds,
// gửi ToolChoiceNone) vẫn trả về completion.Message.ToolCalls khác rỗng VÀ
// completion.Message.Content rỗng — tức model phớt lờ "none" (đo thật,
// docs/deepseek-measured.md §1: một lượt finish_reason "tool_calls" mang
// content RỖNG, không phải một chuỗi placeholder) và Run không còn ngân
// sách vòng để chạy tool đó rồi hỏi lại. Result.Answer khi đó là "" — một
// chuỗi rỗng KHÔNG TỰ NÓ phân biệt được "model trả lời trống" (lỗi) với
// "model chưa trả lời gì, chỉ mới hỏi tool" (bình thường ở vòng giữa) nếu
// caller chỉ nhìn Result — nên round 1 review (I6) yêu cầu một tín hiệu
// PHÂN BIỆT ĐƯỢC thay vì im lặng trả (Result{Answer: ""}, nil). Dùng
// errors.Is(err, ErrToolBudgetExhausted) để phân biệt case này khỏi một lỗi
// mạng/HTTP bình thường từ Client.Complete.
var ErrToolBudgetExhausted = errors.New("ai: model still requested tools at the final tool-budget round and returned no text answer")

// Run thực thi một lượt hỏi-đáp hoàn chỉnh: gửi Turn cho model, chạy hết
// mọi tool model yêu cầu, gửi kết quả lại, lặp — tới khi model trả lời bằng
// chữ (finish_reason khác "tool_calls", hoặc không có tool_calls nào trong
// message) hoặc Settings.MaxToolRoundsPerTurn vòng đã trôi qua, tuỳ điều
// nào tới trước.
//
// HAI TRẦN, không phải một:
//
//   - MaxTokensPerTurn (ai_settings.max_tokens_per_turn) giới hạn ĐỘ DÀI câu
//     trả lời model được sinh MỖI VÒNG — truyền thẳng vào Request.MaxTokens
//     MỖI LẦN gọi Complete, không phải một ngân sách CHUNG trừ dần qua các
//     vòng. QUYẾT ĐỊNH TỰ CHỌN (round 1 review, I2 — brief không nói rõ, cột
//     DB tên "max_tokens_per_turn" gợi ý "mỗi LƯỢT" chứ không phải "mỗi
//     VÒNG", nên đây LÀ một khác biệt cố ý với tên cột, không phải cách đọc
//     hiển nhiên duy nhất): chọn per-round vì (a) nó là hành vi ĐÃ CÓ TEST
//     (TestUsageAccumulatesAcrossRounds khoá fc.calls[i].MaxTokens ==
//     Settings.MaxTokensPerTurn ở MỌI vòng), còn phương án kia (một ngân
//     sách RÚT DẦN: remaining -= completion.Usage.CompletionTokens mỗi
//     vòng) có một trường hợp biên chưa ai đo được — remaining chạm 0/âm
//     giữa chừng thì Request.MaxTokens gửi gì? 0 bị wireRequest's
//     `omitempty` LƯỢC hẳn khỏi thân request (client.go), tức DeepSeek áp
//     giới hạn MẶC ĐỊNH CỦA NÓ — có thể RỘNG hơn ngân sách đã cạn, đúng
//     ngược hướng "trần" cần làm; và (b) dự án không gọi API thật để đo hành
//     vi đó (ràng buộc dự án). HỆ QUẢ PHẢI BIẾT: tổng token đầu ra XẤU NHẤT
//     một lượt có thể tốn là MaxTokensPerTurn × MaxToolRoundsPerTurn, KHÔNG
//     phải MaxTokensPerTurn — với giá trị seed mặc định (migration 0007:
//     8192 × 6 = 49.152), gấp 6 lần con số tên cột gợi ý. Pha 4 (chốt giá
//     bán, spec §10.1) và bất kỳ ai chỉnh ai_settings qua thời gian PHẢI đọc
//     đúng đoạn này trước khi đặt max_tokens_per_turn, không được suy ra từ
//     tên cột.
//   - MaxToolRoundsPerTurn (ai_settings.max_tool_rounds_per_turn) giới hạn
//     SỐ VÒNG gọi Complete trong một lượt — cắt một model cứ khăng khăng
//     đòi gọi tool mãi không chịu trả lời.
//
// VÒNG CUỐI gửi ToolChoiceNone (docs/deepseek-measured.md §2 — hai giá trị
// duy nhất chạy được trên model Thinking mode này là "auto"/"none";
// "required"/ép-một-hàm đều bị từ chối, nên không cách nào ép model PHẢI
// gọi một tool cụ thể — nhưng "none" ép được chiều NGƯỢC LẠI, buộc model
// PHẢI trả lời bằng chữ). Mọi vòng KHÁC gửi ToolChoiceAuto — để model tự
// quyết định lượt đó có cần tool hay không, đúng tinh thần "gọi tool là
// NĂNG LỰC, không phải điều bắt buộc" (docs/deepseek-measured.md §3).
//
// Dù model KHÔNG tôn trọng ToolChoiceNone (một client giả cố tình phớt lờ
// nó trong test, hoặc một hành vi provider chưa từng đo), vòng lặp VẪN dừng
// đúng ở vòng thứ MaxToolRoundsPerTurn — Run không dựa vào việc nhà cung
// cấp có nghe lời tool_choice hay không để thoát vòng lặp; nó dựa vào bộ
// đếm round của chính nó. Đây là lý do Step 3 (test client giả LUÔN trả
// finish_reason "tool_calls", bất kể tool_choice gửi lên là gì) vẫn phải
// dừng đúng 3 vòng, không lặp vô hạn — và khi điều đó xảy ra VỚI content
// rỗng, Run trả ErrToolBudgetExhausted thay vì một Result{Answer: ""} im
// lặng (xem doc comment ErrToolBudgetExhausted).
//
// HỢP ĐỒNG usage-trên-đường-lỗi (round 1 review, I7 — trước đây ĐÚNG nhưng
// KHÔNG GHI, KHÔNG TEST): khi Run trả err != nil — TỪ BẤT KỲ NGUYÊN NHÂN NÀO
// (Client.Complete lỗi mạng/HTTP, hay ErrToolBudgetExhausted ở trên) —
// Result trả VỀ CÙNG LÚC vẫn mang Usage cộng dồn từ MỌI VÒNG ĐÃ HOÀN TẤT
// trước lỗi đó, KHÔNG PHẢI Result{} rỗng. Caller (Task 9's ChargeTurn) PHẢI
// đọc Result.Usage cả trên đường lỗi và trừ credit cho phần đã tiêu — quy
// ước Go thường thấy "err != nil thì bỏ result" là SAI ở hàm này cụ thể,
// vì token đã trả tiền cho DeepSeek dù lượt không hoàn tất theo nghĩa
// "có Answer". TestRunErrorStillCarriesUsageFromCompletedRounds
// (agent_test.go) khoá đúng hợp đồng này.
func (a *Agent) Run(ctx context.Context, t Turn) (Result, error) {
	msgs := buildMessages(t)
	tools := a.enabledTools(t.ToolsEnabled)
	enabledSet := make(map[string]bool, len(t.ToolsEnabled))
	for _, name := range t.ToolsEnabled {
		enabledSet[name] = true
	}

	maxRounds := a.Settings.MaxToolRoundsPerTurn
	if maxRounds <= 0 {
		// migration 0007's CHECK (max_tool_rounds_per_turn > 0) đảm bảo giá
		// trị đọc từ DB thật luôn dương — nhánh này chỉ chạm tới khi ai đó
		// dựng Settings{} bằng tay (một test quên đặt trường, ví dụ) và
		// không phải một đường dữ liệu thật sẽ đi qua khi chạy production.
		// Không clamp về 1 thì round <= maxRounds không bao giờ đúng ngay
		// từ vòng đầu, Run trả một Result{} rỗng KHÔNG LỖI — một thất bại
		// câm, khó gỡ hơn nhiều so với việc cứ chạy đúng một vòng.
		maxRounds = 1
	}

	var result Result

	for round := 1; round <= maxRounds; round++ {
		isLastRound := round == maxRounds
		toolChoice := ToolChoiceAuto
		if isLastRound {
			toolChoice = ToolChoiceNone
		}

		completion, err := a.Client.Complete(ctx, Request{
			Model:      t.Model,
			Messages:   msgs,
			Tools:      tools,
			MaxTokens:  a.Settings.MaxTokensPerTurn,
			ToolChoice: toolChoice,
		})
		if err != nil {
			return result, fmt.Errorf("ai: agent round %d: %w", round, err)
		}

		result.Usage.PromptTokens += completion.Usage.PromptTokens
		result.Usage.CompletionTokens += completion.Usage.CompletionTokens
		result.Usage.CacheHitTokens += completion.Usage.CacheHitTokens
		result.Usage.CacheMissTokens += completion.Usage.CacheMissTokens

		// Vòng cuối LUÔN dừng ở đây, bất kể completion.Message.ToolCalls có
		// gì — xem doc comment của Run ở trên cho lý do (không dựa vào nhà
		// cung cấp tôn trọng ToolChoiceNone để thoát vòng lặp).
		if isLastRound || len(completion.Message.ToolCalls) == 0 {
			result.Answer = completion.Message.Content
			// isLastRound + vẫn còn tool_calls + không có chữ nào để trả lời
			// là đúng hình dạng "model phớt lờ ToolChoiceNone" — xem doc
			// comment ErrToolBudgetExhausted. Nhánh else-if còn lại (không
			// phải isLastRound, tức len(ToolCalls) == 0 — model tự dừng SỚM
			// bằng chữ) không bao giờ rơi vào đây dù Content cũng có thể
			// rỗng về lý thuyết: đó là model chủ động trả lời trống, một
			// tình huống khác (chất lượng câu trả lời, không phải hết ngân
			// sách vòng) — Run không tự ý coi nó là lỗi.
			if isLastRound && len(completion.Message.ToolCalls) > 0 && result.Answer == "" {
				return result, fmt.Errorf("ai: agent round %d: %w", round, ErrToolBudgetExhausted)
			}
			return result, nil
		}

		// Model muốn gọi tool và còn ngân sách vòng — chạy HẾT mảng
		// tool_calls (đo thật, docs/deepseek-measured.md §3: model có thể
		// gọi song song nhiều tool một lượt, mỗi phần tử một id riêng), rồi
		// đưa message assistant mang tool_calls VÀ đúng một message "tool"
		// cho MỖI phần tử vào cho vòng kế tiếp — đúng shape API kiểu
		// OpenAI-chat DeepSeek dùng đòi hỏi.
		msgs = append(msgs, completion.Message)
		for _, tc := range completion.Message.ToolCalls {
			// ToolCalls đếm LẦN GỌI model XIN, bất kể tool đó có thật sự
			// được phép/chạy hay không — xem doc comment Result.ToolCalls.
			result.ToolCalls++

			var content string
			runner, known := a.Tools[tc.Function.Name]
			// allowed đòi CẢ HAI: Agent biết chạy tool này (known) VÀ tool
			// đó nằm trong ToolsEnabled của LƯỢT NÀY (enabledSet). Trước
			// round 1 review (I1), điều kiện chỉ có `known` — một tool có
			// đăng ký trong Agent.Tools nhưng bị người dùng TẮT ở lượt này
			// (không có trong t.ToolsEnabled, nên enabledTools đã lọc nó
			// khỏi Request.Tools gửi cho DeepSeek) vẫn CHẠY THẬT nếu model
			// gọi đúng tên nó — đường kích hoạt thật: History mang một
			// message assistant của lượt TRƯỚC (lúc tool còn bật) có
			// tool_calls tên đó; model đọc lại History và gọi lại, dù
			// enabledTools đã không liệt tool đó vào Request.Tools của LƯỢT
			// NÀY. "Không nằm trong Request.Tools" chỉ canh đường GỬI,
			// không canh đường CHẠY — hai việc khác nhau, phải canh cả hai.
			allowed := known && enabledSet[tc.Function.Name]
			if !allowed {
				// Hai lý do gộp làm MỘT nhánh, cùng một câu model đọc
				// được: (a) known == false — model gọi một tool không có
				// trong Agent.Tools (tự bịa/nhớ nhầm tên từ một lượt
				// trước — vẫn là một đầu vào cần xử lý, không phải điều
				// kiện không bao giờ xảy ra); (b) known == true nhưng
				// enabledSet[...] == false — tool CÓ tồn tại nhưng bị TẮT
				// ở lượt này (xem đoạn trên). Không cần phân biệt hai lý do
				// với model — cả hai đều là "không dùng được tool này bây
				// giờ", và gộp lại giữ content đơn giản. Cùng triết lý
				// courseTool.Run (tool_course.go): một error Go ở đây buộc
				// CẢ LƯỢT hỏng vì một tool_call, trong khi model tự đọc
				// câu báo và có thể tự sửa hướng.
				content = fmt.Sprintf("Error: tool %q is not available in this turn.", tc.Function.Name)
			} else {
				out, runErr := runner.Run(ctx, tc.Function.Arguments)
				if runErr != nil {
					// ToolRunner.Run được đặc tả (tool_course.go) là KHÔNG
					// BAO GIỜ trả error khác nil trong cài đặt hiện có
					// (courseTool) — nhưng ToolRunner là một INTERFACE, và
					// một cài đặt TƯƠNG LAI (Task 8's web_search, hay bất
					// kỳ tool nào khác) không bị ép giữ đúng quy ước đó chỉ
					// vì courseTool làm vậy. Nhánh này là lưới an toàn cho
					// một cài đặt phá quy ước, không phải đường đi bình
					// thường của courseTool — cùng lý do "không để một
					// error Go làm hỏng cả lượt", content vẫn là một câu
					// model đọc được, không phải return sớm ra khỏi Run.
					content = fmt.Sprintf("Error: tool %q failed: %s", tc.Function.Name, runErr)
				} else {
					content = out
					// round 1 review, Critical C1: WebSearches đếm ở CHỖ
					// TOOL ĐÃ CHẠY THÀNH CÔNG, không phải chỗ model XIN
					// (dòng cũ đứng ngay khi vào vòng for, TRƯỚC cả tra
					// a.Tools — cộng tiền cho ba đường không có việc gì thật
					// sự chạy: tool chưa đăng ký, tool bị tắt, tool chạy
					// lỗi). Charge (cost.go) nhân thẳng số này với
					// CostMicroPerWebSearch/CreditsPerWebSearch — một bộ
					// đếm tăng khi hệ thống TỪ CHỐI phục vụ là lỗi tính
					// tiền, không phải lỗi thẩm mỹ.
					if tc.Function.Name == webSearchToolName {
						result.WebSearches++
					}
				}
			}

			msgs = append(msgs, Message{Role: "tool", Content: content, ToolCallID: tc.ID})
		}
	}

	// Không bao giờ tới đây: maxRounds >= 1 (clamp ở trên) nên vòng for
	// luôn chạy round == maxRounds ít nhất một lần, và nhánh isLastRound
	// trong thân vòng lặp luôn return trước khi vòng lặp tự kết thúc bằng
	// điều kiện round <= maxRounds. Giữ lại một return tường minh ở đây chỉ
	// vì Go bắt buộc — không phải một đường thật sự có thể chạy tới.
	return result, nil
}

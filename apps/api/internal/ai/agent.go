// agent.go nối Client (Task 4b) với ToolRunner (Task 5) thành một VÒNG LẶP:
// gửi một lượt, đọc model có muốn gọi tool không, chạy tool nếu có, gửi kết
// quả tool lại cho model, lặp tới khi model trả lời bằng chữ hoặc trần vòng
// tool bị chạm — rồi cộng dồn số đo để Task 9 trừ credit đúng.
//
// Ba điều package này CHỦ ĐỘNG giữ đúng, không phải quy ước ai đó nhớ giữ:
//  1. Thứ tự tin nhắn ổn định (buildMessages) — cache của DeepSeek khớp theo
//     TIỀN TỐ, và cache-hit rẻ hơn cache-miss 30-60 lần (đo thật,
//     docs/deepseek-measured.md §1/§5). Thứ tự sai không lỗi HTTP nào — nó
//     chỉ âm thầm làm hoá đơn cao.
//  2. Prompt nền (ai_settings.base_system_prompt) không bao giờ bị THAY —
//     prompt riêng của người dùng (user_agent_config.system_prompt) chỉ được
//     NỐI SAU, một message hệ thống riêng, không gộp chung chuỗi.
//  3. Tool không nằm trong Turn.ToolsEnabled không bao giờ được liệt vào
//     Request.Tools gửi cho DeepSeek — tắt một tool ở tầng UI mà vẫn gửi nó
//     lên là vẫn bị nhà cung cấp tính vào ngữ cảnh (và tính tiền).
package ai

import (
	"context"
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
//     vào. buildMessages gắn nó thành một message hệ thống thứ ba (chỉ khi
//     khác rỗng) để model biết ngay slug cần truyền cho tham số bắt buộc
//     "slug" của tool read_course (tool_course.go) mà không phải đoán hay
//     hỏi lại người học — xem doc comment buildMessages cho vị trí chính
//     xác.
//   - History là các lượt TRƯỚC trong cùng phiên hội thoại (không bao gồm
//     Question của lượt này) — Run/buildMessages chuyển tiếp nguyên vẹn,
//     không diễn giải lại vai trò hay nội dung.
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
//     web_search") — Charge(cost.go) nhân số này với
//     Settings.CostMicroPerWebSearch/CreditsPerWebSearch, một phụ thu KHÁC
//     hẳn giá token thường. Task 6 chạy TRƯỚC khi Task 8 tồn tại, nên không
//     tool nào tên "web_search" thật sự được đăng ký trong Agent.Tools ở
//     giai đoạn này — trường này khớp đúng 0 cho tới khi Task 8 nối vào,
//     nhưng cơ chế đếm (theo TÊN tool, xem Run) đã sẵn sàng, không cần sửa
//     agent.go khi Task 8 hạ cánh.
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
//     hai message riêng biệt còn giữ được).
//  3. system: ngữ cảnh CourseSlug — CHỈ khi khác rỗng. Đặt sau hai prompt hệ
//     thống, trước lịch sử hội thoại: nó ổn định trong SUỐT một phiên đang
//     xem cùng một course (giống BasePrompt/UserPrompt, không đổi giữa các
//     lượt hỏi liên tiếp trong cùng phiên), nên nằm trong vùng tiền tố ổn
//     định là đúng chỗ, không phải cuối mảng.
//  4. History — nguyên vẹn, đúng thứ tự Turn mang vào.
//  5. user: Question — LUÔN là message CUỐI CÙNG.
//
// Thứ tự 1-5 này CHÍNH LÀ khẳng định của TestMessageOrderPutsStablePrefixFirst
// (agent_test.go) — không phải một quy ước viết ở đây rồi hy vọng không ai
// đổi, mà một test khoá cứng nó lại.
func buildMessages(t Turn) []Message {
	msgs := make([]Message, 0, 3+len(t.History)+1)

	msgs = append(msgs, Message{Role: "system", Content: t.BasePrompt})
	if t.UserPrompt != "" {
		msgs = append(msgs, Message{Role: "system", Content: t.UserPrompt})
	}
	if t.CourseSlug != "" {
		msgs = append(msgs, Message{Role: "system", Content: fmt.Sprintf(
			"The learner is currently viewing course %q. When a tool needs a "+
				"course slug and the learner has not clearly named a different "+
				"course, use this one.", t.CourseSlug)})
	}
	msgs = append(msgs, t.History...)
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
//     mỗi lần gọi Complete.
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
// dừng đúng 3 vòng, không lặp vô hạn.
func (a *Agent) Run(ctx context.Context, t Turn) (Result, error) {
	msgs := buildMessages(t)
	tools := a.enabledTools(t.ToolsEnabled)

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
			result.ToolCalls++
			if tc.Function.Name == webSearchToolName {
				result.WebSearches++
			}

			var content string
			runner, ok := a.Tools[tc.Function.Name]
			if !ok {
				// Model gọi một tool không có trong Agent.Tools (hoặc có
				// nhưng không nằm trong ToolsEnabled — enabledTools đã lọc
				// nó khỏi Request.Tools NÊN model không lẽ ra không thấy
				// nó, nhưng "model gọi một tên nó tự bịa/nhớ nhầm từ một
				// lượt trước" vẫn là một đầu vào cần xử lý, không phải một
				// điều kiện không bao giờ xảy ra). Trả một câu model ĐỌC
				// ĐƯỢC, cùng triết lý courseTool.Run (tool_course.go): một
				// error Go ở đây buộc CẢ LƯỢT hỏng vì một tool_call, trong
				// khi model tự đọc câu báo và có thể tự sửa hướng.
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

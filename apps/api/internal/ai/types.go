// Package ai giữ các kiểu dữ liệu và phép tính giá vốn dùng chung cho trợ lý
// AI chạy trên máy chủ (Pha 2). Gói này KHÔNG tự gọi mạng — client DeepSeek
// (Task 4b, client.go) là nơi duy nhất mở kết nối HTTP tới nhà cung cấp.
//
// cost.go trong gói này cố tình chỉ đọc các trường Go của Usage/Pricing/
// Settings, không phụ thuộc tên thẻ JSON nào — độc lập với việc hai thẻ JSON
// của Usage đúng hay sai. Hai thẻ đó ĐÃ ĐƯỢC ĐO trên API DeepSeek thật, xem
// chú thích trên Usage bên dưới và docs/deepseek-measured.md §1.
package ai

import "time"

// Message là một lượt trong hội thoại gửi tới/nhận từ DeepSeek, theo đúng
// shape API kiểu OpenAI-chat mà DeepSeek dùng.
type Message struct {
	Role       string     `json:"role"` // "system" | "user" | "assistant" | "tool"
	Content    string     `json:"content"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID string     `json:"tool_call_id,omitempty"`
}

// ToolCall là một lời gọi công cụ mà mô hình yêu cầu, xuất hiện trong
// Message.ToolCalls của một lượt "assistant".
type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"` // luôn "function"
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"` // JSON đã encode thành CHUỖI
	} `json:"function"`
}

// Tool khai báo một công cụ mô hình được phép gọi, gửi trong Request.Tools.
type Tool struct {
	Type     string       `json:"type"` // "function"
	Function ToolFunction `json:"function"`
}

// ToolFunction mô tả chữ ký một công cụ theo JSON Schema, đúng shape
// "function calling" kiểu OpenAI.
type ToolFunction struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Parameters  map[string]any `json:"parameters"`
}

// Usage là số đo token của một lượt hoàn tất, đọc từ trường "usage" trong
// response của DeepSeek.
//
// CacheHitTokens/CacheMissTokens (thẻ JSON "prompt_cache_hit_tokens"/
// "prompt_cache_miss_tokens") ĐÃ ĐƯỢC ĐO trên API DeepSeek thật ngày
// 2026-08-28, không còn là giả định — xem docs/deepseek-measured.md §1: hai
// tên thẻ đúng như plan giả định ban đầu, xác nhận độc lập hai lượt (đo thô
// của điều phối viên, rồi Task 0 đo lại từng mục một lần nữa). Tài liệu đo
// còn ghi hai điều đáng biết thêm về "usage" không nằm trong hai trường này
// — completion_tokens_details.reasoning_tokens (đã NẰM TRONG
// CompletionTokens, không cộng thêm ra ngoài — nên cost.go's Charge tính
// toàn bộ CompletionTokens theo giá đầu ra là đúng) và
// prompt_tokens_details.cached_tokens (trùng lặp với CacheHitTokens, không
// mang thông tin mới) — cả hai đều KHÔNG có trường Go tương ứng ở struct
// này, xem client.go's wireResponse cho lý do.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	CacheHitTokens   int `json:"prompt_cache_hit_tokens"`
	CacheMissTokens  int `json:"prompt_cache_miss_tokens"`
}

// Completion là kết quả một lượt gọi DeepSeek đã hoàn tất, sau khi client
// (Task 4b) giải mã response.
type Completion struct {
	Message      Message
	FinishReason string
	Usage        Usage

	// ReasoningChars đếm ký tự model phát ra ở `reasoning_content` — phần
	// NGHĨ, không phải phần nói.
	//
	// Nó KHÔNG nằm trong Message, và đó là điều bắt buộc: Message là kiểu HAI
	// CHIỀU, cũng dùng để gửi lịch sử hội thoại ngược lên nhà cung cấp. Thêm
	// một trường có tag JSON vào đó là gửi trả `reasoning_content` trong mỗi
	// request sau — một thứ giao thức không hỏi và ta không có quyền bịa.
	//
	// Chỉ đường STREAM điền được số này; `Complete` (không stream) đọc qua
	// `Message`, nơi vừa nói là không thể thêm trường. Đó là lý do phép kiểm
	// "bị cắt giữa chừng" ở agent dựa vào FinishReason, thứ CẢ HAI đường đều
	// có, chứ không dựa vào con số này. Số này để CHẨN ĐOÁN: nó là thứ biến
	// "model không trả lời gì" thành "model tiêu N ký tự để nghĩ rồi hết
	// token trước khi kịp nói".
	ReasoningChars int
}

// ToolChoice nói với DeepSeek lượt này model có được phép gọi tool hay
// không. Đo thật (docs/deepseek-measured.md §2, bốn giá trị đã thử trên
// deepseek-v4-pro): CHỈ "auto" và "none" chạy được — cả hai trả về
// finish_reason hợp lệ. "required" và một object ép gọi đúng MỘT hàm cụ thể
// đều bị từ chối cùng một lỗi: {"message": "Thinking mode does not support
// this tool_choice", ...}. Model đang dùng ("Thinking mode") không chấp
// nhận hai hình dạng OpenAI-chuẩn đó.
//
// Kiểu này là một chuỗi có tên với đúng hai hằng xuất ra (ToolChoiceAuto,
// ToolChoiceNone), không phải một chuỗi trần: package này không tự chặn một
// lời gọi tự ý viết ToolChoice("required") — đó cần validate ở
// runtime, việc chưa ai yêu cầu — nhưng nó làm hai giá trị BỊ TỪ CHỐI không
// còn nằm trong bộ giá trị mà mã gọi TỪ TRONG package này (Agent.Run, Task
// 6; RunStream, Task 7) có thể vô tình gõ nhầm: chúng chỉ có hai hằng để
// chọn, và cả hai đều đã đo là chạy được. Việc validate triệt để hơn (chặn
// một chuỗi tuỳ ý ở compile-time) không làm được trong Go bằng một named
// string type — cần generate code hoặc một interface kín (sealed interface)
// nặng hơn nhiều so với lợi ích ở đây.
type ToolChoice string

const (
	// ToolChoiceAuto để model tự quyết định lượt này có gọi tool hay
	// không. Agent.Run (Task 6) gửi giá trị này ở mọi vòng TRỪ vòng cuối.
	ToolChoiceAuto ToolChoice = "auto"
	// ToolChoiceNone ép model trả lời bằng văn bản, không được gọi tool.
	// Agent.Run (Task 6) gửi giá trị này ở vòng CUỐI của trần vòng tool —
	// không có nó, một model cứ khăng khăng đòi gọi tool sẽ ăn hết
	// MaxToolRoundsPerTurn mà không bao giờ trả lời bằng chữ.
	ToolChoiceNone ToolChoice = "none"
)

// Request là tham số một lượt gọi DeepSeek. Client (Task 4b) mã hoá trực
// tiếp trường này thành thân request JSON.
//
// ToolChoice là bổ sung của Task 6 (Task 4b cố ý để trống, xem comment cũ
// từng nằm trên wireRequest ở client.go — nay đã cập nhật). Giá trị KHÔNG
// đặt (chuỗi rỗng, giá trị zero của Go) bị wireRequest lược khỏi thân
// request — giữ nguyên hành vi cũ với bất kỳ caller nào chưa biết tới
// trường này (mọi test hiện có trong client_test.go, ví dụ). Agent.Run
// (agent.go) không bao giờ để trường này ở giá trị zero — nó luôn đặt rõ
// ToolChoiceAuto hoặc ToolChoiceNone mỗi vòng, nên câu hỏi "bỏ trống có
// giống gửi 'auto' không" (một giả định CHƯA ĐO, ghi ở client.go) không
// bao giờ bị Agent.Run chạm tới: thiết kế vòng lặp né câu hỏi đó thay vì
// trả lời nó.
type Request struct {
	Model      string
	Messages   []Message
	Tools      []Tool
	MaxTokens  int
	Stream     bool
	ToolChoice ToolChoice
}

// Pricing ánh xạ 1-1 sang một hàng bảng ai_pricing (migration
// 0007_ai_credits) — một hàng cho mỗi model. cost_micro_* là giá vốn THẬT
// trả cho DeepSeek; credits_* là giá bán cho người dùng nền tảng, tính bằng
// đơn vị credit (Pha 2 seed hai cột bằng nhau — bán đúng giá vốn — vì tỷ lệ
// quy đổi thật chốt ở Pha 4).
type Pricing struct {
	Model                  string // ai_pricing.model
	CostMicroPer1kIn       int64  // ai_pricing.cost_micro_per_1k_in
	CostMicroPer1kCachedIn int64  // ai_pricing.cost_micro_per_1k_cached_in
	CostMicroPer1kOut      int64  // ai_pricing.cost_micro_per_1k_out
	CreditsPer1kIn         int64  // ai_pricing.credits_per_1k_in
	CreditsPer1kCachedIn   int64  // ai_pricing.credits_per_1k_cached_in
	CreditsPer1kOut        int64  // ai_pricing.credits_per_1k_out

	// UpdatedAt is ai_pricing.updated_at. Added by Task 17: cost.go's Charge
	// never reads it (it has no opinion about WHEN a rate was set, only what
	// it currently is), but the "Bảng giá & prompt nền" CMS screen shows it
	// so an operator can tell a rate they just changed apart from one seeded
	// at migration time and never touched since. Zero-valued (time.Time{})
	// on every Pricing this package builds internally (pricing(), used by
	// ChargeTurn) — only ListPricing/UpdatePricing (admin_handler.go, both
	// SELECT/RETURNING the column explicitly) ever populate it.
	UpdatedAt time.Time
}

// Settings ánh xạ 1-1 sang đúng MỘT hàng bảng ai_settings (migration
// 0007_ai_credits — cột id boolean CHECK(id) ép "chỉ một hàng" ở tầng
// schema). Task 6, 8, 10, 17 đều đọc struct này, nên nó sống ở gói `ai`
// chứ không nhân bản ở từng chỗ dùng.
type Settings struct {
	BaseSystemPrompt      string // ai_settings.base_system_prompt
	CreditsPerWebSearch   int64  // ai_settings.credits_per_web_search
	CostMicroPerWebSearch int64  // ai_settings.cost_micro_per_web_search
	SignupGrantMicro      int64  // ai_settings.signup_grant_micro
	MaxTokensPerTurn      int    // ai_settings.max_tokens_per_turn — Agent.Run (agent.go, Task 6) áp trường này MỖI VÒNG gọi Complete, không phải một ngân sách chung cho cả lượt; đọc doc comment của Run trước khi đổi giá trị này, tên cột dễ hiểu nhầm
	MaxToolRoundsPerTurn  int    // ai_settings.max_tool_rounds_per_turn
}

// Package ai giữ các kiểu dữ liệu và phép tính giá vốn dùng chung cho trợ lý
// AI chạy trên máy chủ (Pha 2). Gói này KHÔNG tự gọi mạng — client DeepSeek
// (Task 4b, client.go) là nơi duy nhất mở kết nối HTTP tới nhà cung cấp.
//
// cost.go trong gói này cố tình chỉ đọc các trường Go của Usage/Pricing/
// Settings, không phụ thuộc tên thẻ JSON nào — xem chú thích trên Usage bên
// dưới để biết vì sao hai thẻ JSON của Usage vẫn còn là GIẢ ĐỊNH chưa đo.
package ai

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
// TODO(Task 4b): CacheHitTokens/CacheMissTokens (thẻ JSON
// "prompt_cache_hit_tokens"/"prompt_cache_miss_tokens") là GIẢ ĐỊNH của
// Task 4 — tài liệu DeepSeek không nói rõ tên chính xác hai trường cache
// trong đối tượng "usage". Task 0 đo trên API DeepSeek thật, chốt tên đúng
// (hoặc xác nhận giả định này) tại docs/deepseek-measured.md, và Task 4b áp
// dụng kết quả đó vào client.go + hai thẻ JSON dưới đây. Nếu tên thật khác
// giả định: mã KHÔNG lỗi rõ ràng khi sai — client.go vẫn decode được JSON,
// cost.go (đọc trường Go, không đọc thẻ JSON) vẫn cộng ra một con số, và sổ
// ai_usage vẫn đầy hàng. Hình dạng cụ thể của cái hỏng phụ thuộc cách 4b
// điền hai trường này: nếu client.go decode thẳng qua hai thẻ JSON sai tên,
// CẢ HAI trường cache lặng lẽ ở lại 0 (JSON không có khoá khớp); nếu thay
// vào đó client.go suy ra CacheMissTokens = PromptTokens − CacheHitTokens
// (một cách hợp lý khác để lấp trường này khi không chắc tên thẻ), toàn bộ
// input đổ hết vào CacheMissTokens (giá đắt hơn cache-hit 30-60 lần) trong
// khi CacheHitTokens ở lại 0. Cả hai khả năng đều sai âm thầm theo cách
// khác nhau — không đoán trước cách 4b chọn, chỉ ghi lại rằng dù chọn cách
// nào, một tên thẻ sai không tự lộ ra ở đầu ra. Đây chính là kiểu hỏng ÂM
// THẦM Task 0 được viết ra để chặn, và Pha 4 sẽ chốt giá bán trên đúng những
// con số này.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	CacheHitTokens   int `json:"prompt_cache_hit_tokens"`  // TODO(Task 4b): tên GIẢ ĐỊNH, xem chú thích Usage ở trên
	CacheMissTokens  int `json:"prompt_cache_miss_tokens"` // TODO(Task 4b): tên GIẢ ĐỊNH, xem chú thích Usage ở trên
}

// Completion là kết quả một lượt gọi DeepSeek đã hoàn tất, sau khi client
// (Task 4b) giải mã response.
type Completion struct {
	Message      Message
	FinishReason string
	Usage        Usage
}

// Request là tham số một lượt gọi DeepSeek. Client (Task 4b) mã hoá trực
// tiếp trường này thành thân request JSON.
type Request struct {
	Model     string
	Messages  []Message
	Tools     []Tool
	MaxTokens int
	Stream    bool
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
	MaxTokensPerTurn      int    // ai_settings.max_tokens_per_turn
	MaxToolRoundsPerTurn  int    // ai_settings.max_tool_rounds_per_turn
}

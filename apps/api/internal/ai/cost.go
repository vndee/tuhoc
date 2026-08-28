package ai

// divUp tính tokens*per1k/1000, làm tròn LÊN chứ không xuống.
//
// Làm tròn xuống biến một lượt hỏi ngắn thành miễn phí (phép chia nguyên ăn
// mất phần dư), và đó là một đường farm: một nghìn lượt hỏi mỗi lượt 900
// token, làm tròn xuống, là một nghìn lượt miễn phí. +999 trước khi chia
// cho 1000 là công thức làm tròn lên tiêu chuẩn cho số nguyên không âm.
func divUp(tokens int, per1k int64) int64 {
	return (int64(tokens)*per1k + 999) / 1000
}

// Charge tính giá vốn (costMicro, đơn vị micro-đô) và giá bán (credits) của
// một lượt hoàn tất, CỘNG RIÊNG ba dải giá — cache-hit, cache-miss, output —
// thay vì gộp input thành một dải.
//
// Tách cache-hit khỏi cache-miss không phải một chi tiết cài đặt tuỳ chọn:
// giá cache-hit của DeepSeek rẻ hơn cache-miss 30-60 lần (xem chú thích cột
// cached_in_tokens ở migration 0007_ai_credits), nên gộp chung sẽ ghi sai
// giá vốn một bậc độ lớn — và Pha 4 chốt giá bán trên đúng những con số
// cost_micro này.
//
// Charge chỉ đọc các trường Go của Usage — không đọc thẻ JSON nào — nên nó
// không phụ thuộc việc hai tên thẻ JSON "prompt_cache_hit_tokens"/
// "prompt_cache_miss_tokens" trên Usage (xem TODO(Task 4b) ở types.go) đúng
// hay sai: dù client.go (Task 4b) giải mã sai vào đúng hai trường Go này
// hay đúng, Charge cộng tiền theo đúng công thức bên dưới trên bất kỳ giá
// trị nào Usage mang.
func Charge(u Usage, p Pricing, webSearches int, s Settings) (costMicro, credits int64) {
	costMicro = divUp(u.CacheHitTokens, p.CostMicroPer1kCachedIn) +
		divUp(u.CacheMissTokens, p.CostMicroPer1kIn) +
		divUp(u.CompletionTokens, p.CostMicroPer1kOut) +
		int64(webSearches)*s.CostMicroPerWebSearch
	credits = divUp(u.CacheHitTokens, p.CreditsPer1kCachedIn) +
		divUp(u.CacheMissTokens, p.CreditsPer1kIn) +
		divUp(u.CompletionTokens, p.CreditsPer1kOut) +
		int64(webSearches)*s.CreditsPerWebSearch
	return costMicro, credits
}

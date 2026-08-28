package ai

import "testing"

// TestCostSplitsCachedAndUncachedInput khẳng định Charge cộng riêng ba dải
// giá (cache-hit, cache-miss, output) thay vì gộp input thành một dải —
// đúng lý do cột cached_in_tokens tách khỏi in_tokens trong migration
// 0007_ai_credits (xem chú thích ai_usage ở đó): giá cache-hit của DeepSeek
// rẻ hơn cache-miss 30-60 lần, nên gộp chung ghi sai giá vốn một bậc độ
// lớn.
func TestCostSplitsCachedAndUncachedInput(t *testing.T) {
	p := Pricing{
		CostMicroPer1kIn: 1320, CostMicroPer1kCachedIn: 44, CostMicroPer1kOut: 3960,
		CreditsPer1kIn: 1320, CreditsPer1kCachedIn: 44, CreditsPer1kOut: 3960,
	}
	// 8000 token vào, trong đó 6000 trúng cache; 1000 token ra.
	cost, credits := Charge(Usage{CacheHitTokens: 6000, CacheMissTokens: 2000, CompletionTokens: 1000}, p, 0, Settings{})
	// 6000/1000*44 + 2000/1000*1320 + 1000/1000*3960 = 264 + 2640 + 3960 = 6864
	if cost != 6864 {
		t.Errorf("cost = %d, muốn 6864", cost)
	}
	if credits != 6864 {
		t.Errorf("credits = %d, muốn 6864", credits)
	}
}

// TestCostRoundsUpSoTinyTurnsAreNotFree khẳng định divUp làm tròn LÊN, không
// xuống: một lượt ngắn không được thành MIỄN PHÍ vì phép chia nguyên làm
// tròn xuống — một nghìn lượt hỏi mỗi lượt 900 token, làm tròn xuống, là một
// nghìn lượt miễn phí, và đó là một đường farm.
func TestCostRoundsUpSoTinyTurnsAreNotFree(t *testing.T) {
	p := Pricing{CostMicroPer1kIn: 1320, CostMicroPer1kOut: 3960, CreditsPer1kIn: 1320, CreditsPer1kOut: 3960}
	cost, _ := Charge(Usage{CacheMissTokens: 1, CompletionTokens: 1}, p, 0, Settings{})
	if cost == 0 {
		t.Error("một lượt có token thật mà tính giá vốn 0 — làm tròn xuống đã ăn mất nó")
	}
}

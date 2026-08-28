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
//
// VÌ SAO GIÁ CACHE-HIT (44/1k), KHÔNG PHẢI GIÁ CACHE-MISS/OUTPUT (1320/3960):
// vòng sửa 1 (round 2 review) đo được bản trước của test này (per1k=1320,
// tokens=1) là VACUOUS — với per1k=1320 và 1 token, ngay cả phép chia làm
// tròn XUỐNG (floor nguyên, bỏ +999) cũng cho 1*1320/1000 = 1, KHÁC 0, nên
// test đó xanh dù divUp hay floor. Với per1k=44 và 1 token:
// floor(1*44/1000) = 0 còn divUp = (44+999)/1000 = 1 — chỉ làm tròn LÊN mới
// giữ lượt này khỏi bị tính giá vốn 0. Đây là hình dạng DUY NHẤT phân biệt
// được divUp với floor trong khoảng dữ liệu test này dùng.
func TestCostRoundsUpSoTinyTurnsAreNotFree(t *testing.T) {
	p := Pricing{CostMicroPer1kCachedIn: 44, CreditsPer1kCachedIn: 44}
	cost, credits := Charge(Usage{CacheHitTokens: 1}, p, 0, Settings{})
	if cost == 0 {
		t.Error("một lượt có token thật mà tính giá vốn 0 — làm tròn xuống đã ăn mất nó")
	}
	if credits == 0 {
		t.Error("một lượt có token thật mà tính giá bán 0 — làm tròn xuống đã ăn mất nó")
	}
}

// TestChargeAddsWebSearchSurchargeAtDistinctPrices khẳng định nhánh tìm
// kiếm web của Charge — thứ hai test trên không chạm tới, vì cả hai gọi
// Charge(..., 0, ...) — cộng đúng phụ thu vào CẢ costMicro lẫn credits.
//
// Hai đơn giá (500 và 300) CỐ Ý khác nhau: nếu một lần sửa sau này hoán đổi
// s.CostMicroPerWebSearch với s.CreditsPerWebSearch trong Charge (hay gán
// nhầm biến theo cách khác khiến cost và credits tráo giá trị cho nhau),
// hai đơn giá bằng nhau sẽ không bắt được lỗi đó — hai đơn giá khác nhau
// thì bắt được.
func TestChargeAddsWebSearchSurchargeAtDistinctPrices(t *testing.T) {
	s := Settings{CostMicroPerWebSearch: 500, CreditsPerWebSearch: 300}
	cost, credits := Charge(Usage{}, Pricing{}, 4, s)
	if cost != 2000 {
		t.Errorf("cost = %d, muốn 2000 (4 lượt tìm x 500)", cost)
	}
	if credits != 1200 {
		t.Errorf("credits = %d, muốn 1200 (4 lượt tìm x 300)", credits)
	}
}

package ai

import (
	"errors"
	"math"
	"testing"
)

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
	cost, credits, err := Charge(Usage{CacheHitTokens: 6000, CacheMissTokens: 2000, CompletionTokens: 1000}, p, 0, Settings{})
	if err != nil {
		t.Fatalf("Charge trả lỗi trên giá seed thật: %v", err)
	}
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
	cost, credits, err := Charge(Usage{CacheHitTokens: 1}, p, 0, Settings{})
	if err != nil {
		t.Fatalf("Charge trả lỗi: %v", err)
	}
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
	cost, credits, err := Charge(Usage{}, Pricing{}, 4, s)
	if err != nil {
		t.Fatalf("Charge trả lỗi: %v", err)
	}
	if cost != 2000 {
		t.Errorf("cost = %d, muốn 2000 (4 lượt tìm x 500)", cost)
	}
	if credits != 1200 {
		t.Errorf("credits = %d, muốn 1200 (4 lượt tìm x 300)", credits)
	}
}

// TestChargeRefusesToWrapInsteadOfBillingANegativeNumber là D2 của review
// tổng nhánh, giữ nguyên hai phép đo của review làm dữ liệu vào.
//
// TRƯỚC vòng sửa này, cùng hai đầu vào ấy trả về (không lỗi):
//
//	per1k = 2e14      → -8.616.344.073.709.550  (đúng phải là ~9,8e15)
//	per1k = MaxInt64  → -48                     (một khoản THU thành khoản CẤP)
//
// Cả hai đều nằm trong dải mà CMS và server hôm nay chấp nhận — ngưỡng tràn
// ≈1,88e14 phụ thuộc SỐ TOKEN của lượt, nên cùng một hàng giá sai tính ĐÚNG
// cho lượt ngắn và sai cho lượt dài. Đó là lý do một `if result < 0` sau khi
// nhân KHÔNG đủ: giá trị wrap có thể dương và trông hoàn toàn hợp lý.
//
// D2 và D1 (trần giá ở admin_handler.go) là HAI LỚP, không phải một: một
// hàng ai_pricing ghi TRƯỚC khi trần tồn tại không đi qua trần. Test này
// canh lớp số học, không canh chính sách.
func TestChargeRefusesToWrapInsteadOfBillingANegativeNumber(t *testing.T) {
	cases := []struct {
		name    string
		usage   Usage
		pricing Pricing
		search  int
		set     Settings
	}{
		{
			name:    "per1k = 2e14, lượt 49.152 token (đo được -8.616.344.073.709.550)",
			usage:   Usage{CacheMissTokens: 49152},
			pricing: Pricing{CostMicroPer1kIn: 200_000_000_000_000, CreditsPer1kIn: 200_000_000_000_000},
		},
		{
			name:    "per1k = MaxInt64 (đo được credits = -48)",
			usage:   Usage{CacheMissTokens: 49152},
			pricing: Pricing{CostMicroPer1kIn: math.MaxInt64, CreditsPer1kIn: math.MaxInt64},
		},
		{
			name:    "tràn ở cột cached-in, không phải cột in",
			usage:   Usage{CacheHitTokens: 49152},
			pricing: Pricing{CostMicroPer1kCachedIn: math.MaxInt64, CreditsPer1kCachedIn: math.MaxInt64},
		},
		{
			name:    "tràn ở cột out",
			usage:   Usage{CompletionTokens: 8192},
			pricing: Pricing{CostMicroPer1kOut: math.MaxInt64, CreditsPer1kOut: math.MaxInt64},
		},
		{
			name:   "tràn ở phụ thu tìm kiếm web (nhân trần, không phải chia-1k)",
			search: 3,
			set:    Settings{CostMicroPerWebSearch: math.MaxInt64, CreditsPerWebSearch: math.MaxInt64},
		},
		{
			// Không SỐ HẠNG nào tự tràn, TỔNG thì tràn. Đây là hình dạng mà
			// một phép kiểm "mỗi lần NHÂN có tràn không" bỏ lọt hoàn toàn:
			// 2 lượt tìm x (MaxInt64/2) vừa khít int64, cộng thêm dải token
			// thì không. Một dải token KHÔNG thể tự làm tổng tràn — kết quả
			// mỗi dải bị chính phép chia 1000 chặn ở ~9,2e15 — nên phụ thu
			// tìm kiếm là đường DUY NHẤT dựng được ca này.
			name:    "không số hạng nào tự tràn, nhưng TỔNG thì tràn",
			usage:   Usage{CacheMissTokens: 1000},
			pricing: Pricing{CostMicroPer1kIn: 1000, CreditsPer1kIn: 1000},
			search:  2,
			set: Settings{
				CostMicroPerWebSearch: math.MaxInt64 / 2,
				CreditsPerWebSearch:   math.MaxInt64 / 2,
			},
		},
		{
			name:    "đơn giá ÂM (ai_pricing có CHECK >= 0, nhưng Charge không được tin điều đó)",
			usage:   Usage{CacheMissTokens: 1000},
			pricing: Pricing{CostMicroPer1kIn: -5, CreditsPer1kIn: -5},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cost, credits, err := Charge(tc.usage, tc.pricing, tc.search, tc.set)
			if err == nil {
				t.Fatalf("Charge trả nil error với cost=%d credits=%d — số học đã wrap "+
					"và một khoản THU có thể đã thành một khoản CẤP", cost, credits)
			}
			if !errors.Is(err, ErrChargeOverflow) {
				t.Errorf("err = %v, muốn errors.Is(..., ErrChargeOverflow) — caller phân "+
					"biệt được 'hàng giá bất khả thi' với mọi lỗi khác", err)
			}
			if cost != 0 || credits != 0 {
				t.Errorf("Charge trả (%d, %d) kèm lỗi — trên đường lỗi hai số phải là 0, "+
					"không phải một giá trị đã wrap mà caller có thể lỡ dùng", cost, credits)
			}
		})
	}
}

// TestChargeStillWorksAtTheHighestRateTheCMSAccepts là nửa còn lại của D2:
// kiểm tra tràn KHÔNG được phép biến thành "từ chối mọi hàng giá lớn". Ở
// đúng trần D1 đặt (MaxPricingRateMicro) và một lượt lớn hơn bất kỳ lượt
// thật nào (MaxChatBodyBytes 64 KiB prompt + max_tokens_per_turn), Charge
// phải trả về số DƯƠNG, không lỗi.
func TestChargeStillWorksAtTheHighestRateTheCMSAccepts(t *testing.T) {
	p := Pricing{
		CostMicroPer1kIn: MaxPricingRateMicro, CostMicroPer1kCachedIn: MaxPricingRateMicro,
		CostMicroPer1kOut: MaxPricingRateMicro, CreditsPer1kIn: MaxPricingRateMicro,
		CreditsPer1kCachedIn: MaxPricingRateMicro, CreditsPer1kOut: MaxPricingRateMicro,
	}
	// 49.152 token mỗi dải là con số review dùng cho lượt lớn nhất đo được.
	u := Usage{CacheHitTokens: 49152, CacheMissTokens: 49152, CompletionTokens: 49152}
	cost, credits, err := Charge(u, p, 100, Settings{CostMicroPerWebSearch: MaxPricingRateMicro, CreditsPerWebSearch: MaxPricingRateMicro})
	if err != nil {
		t.Fatalf("Charge từ chối một hàng giá NẰM TRONG trần D1: %v", err)
	}
	if cost <= 0 || credits <= 0 {
		t.Errorf("Charge = (%d, %d), muốn cả hai dương", cost, credits)
	}
}

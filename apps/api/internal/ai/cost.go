package ai

import (
	"errors"
	"fmt"
	"math"
)

// ErrChargeOverflow is returned by Charge (and propagated by ChargeTurn)
// when the money arithmetic for one turn cannot be represented in an
// int64.
//
// WHY THIS IS AN ERROR AND NOT A SATURATED NUMBER (whole-branch review,
// D2). Saturating at math.MaxInt64 would "succeed": ai_usage's CHECK
// (cost_micro >= 0) accepts it, and `balance_micro - 9223372036854775807`
// stays inside bigint for any realistic balance — so the learner's balance
// would be silently annihilated by a pricing row that is obviously a typo.
// Wrapping (what this file did before) is worse still: the measured
// behaviour was a charge of -8,616,344,073,709,550 and, at per1k =
// MaxInt64, a charge of -48 — a DEBIT that became a CREDIT. Neither of
// those is a number anybody should act on, so this package refuses to
// produce one and names the reason instead.
//
// WHAT THE CALLER GETS, HONESTLY STATED: the turn already ran and DeepSeek
// was already paid, so returning an error here does not recover the money
// — it converts a silent, wrong ledger row into a loud, absent one, with
// a named cause in the log (handler.go's "ai charge failed after turn").
// That is strictly better than the previous behaviour, where the wrong
// number reached Postgres and was rejected by ai_usage_cost_micro_check as
// an anonymous 23514 constraint violation, but it is NOT "the turn got
// billed". Fixing the money half is what the pricing ceiling in
// admin_handler.go (MaxPricingRateMicro) is for; these are two layers, and
// an ai_pricing row written BEFORE that ceiling existed does not pass
// through it.
var ErrChargeOverflow = errors.New("ai: turn cost does not fit in int64")

// mulDivUp returns ceil(tokens * per1k / 1000) — rounding UP, not down —
// and refuses to return a wrapped value.
//
// Rounding up is not a stylistic preference: rounding down turns a short
// turn into a free one (integer division eats the remainder), and that is
// a farming path — a thousand questions of 900 tokens each, rounded down,
// is a thousand free turns. Adding 999 before dividing by 1000 is the
// standard round-up for non-negative integers.
//
// The overflow check is done BEFORE the multiply, against the largest
// numerator this function may build (math.MaxInt64 - 999, since 999 is
// added after the multiply). Doing it after — checking whether the product
// "looks wrong" — is not possible: signed overflow in Go wraps silently and
// the wrapped value is a perfectly ordinary int64 that no later comparison
// can identify as bogus (per1k = MaxInt64 above wrapped all the way back to
// a small NEGATIVE number, which a naive `if result < 0` would catch, but
// per1k = 2e14 wrapped to a large negative one and other inputs wrap to
// large POSITIVE ones that look entirely plausible).
//
// Negative inputs are refused rather than computed on. tokens comes from a
// provider-supplied Usage and per1k from an ai_pricing row; both are
// non-negative by construction today (ai_pricing has CHECK (... >= 0),
// migration 0007), but "by construction elsewhere" is exactly the
// assumption this function must not carry silently — a negative rate would
// make every turn a grant.
func mulDivUp(tokens int, per1k int64) (int64, error) {
	if tokens < 0 {
		return 0, fmt.Errorf("%w: negative token count %d", ErrChargeOverflow, tokens)
	}
	if per1k < 0 {
		return 0, fmt.Errorf("%w: negative rate %d per 1k tokens", ErrChargeOverflow, per1k)
	}
	if per1k == 0 || tokens == 0 {
		return 0, nil
	}
	if int64(tokens) > (math.MaxInt64-999)/per1k {
		return 0, fmt.Errorf("%w: %d tokens at %d per 1k", ErrChargeOverflow, tokens, per1k)
	}
	return (int64(tokens)*per1k + 999) / 1000, nil
}

// mulChecked returns n*rate, or ErrChargeOverflow. Used for the web-search
// surcharge, which is a flat per-search price rather than a per-1k-token
// rate and so does not go through mulDivUp's rounding.
func mulChecked(n int, rate int64) (int64, error) {
	if n < 0 {
		return 0, fmt.Errorf("%w: negative count %d", ErrChargeOverflow, n)
	}
	if rate < 0 {
		return 0, fmt.Errorf("%w: negative rate %d", ErrChargeOverflow, rate)
	}
	if rate == 0 || n == 0 {
		return 0, nil
	}
	if int64(n) > math.MaxInt64/rate {
		return 0, fmt.Errorf("%w: %d x %d", ErrChargeOverflow, n, rate)
	}
	return int64(n) * rate, nil
}

// sumChecked adds non-negative terms and refuses to wrap. Every term
// reaching it has already been produced by mulDivUp/mulChecked, so all of
// them are >= 0 and a single "would the sum exceed MaxInt64" test per
// addition is enough — there is no negative-side overflow to consider.
func sumChecked(terms ...int64) (int64, error) {
	var total int64
	for _, t := range terms {
		if t > math.MaxInt64-total {
			return 0, fmt.Errorf("%w: sum of turn components exceeds int64", ErrChargeOverflow)
		}
		total += t
	}
	return total, nil
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
//
// ERROR RETURN (whole-branch review, D2): every multiply and every add
// below is overflow-checked, and any one of them failing aborts the whole
// computation with ErrChargeOverflow rather than returning a wrapped
// number. See that error's own doc comment for why refusing beats
// saturating, and for the honest statement of what the caller does and does
// not get back. Callers must not treat (0, 0, err) as "this turn was free".
func Charge(u Usage, p Pricing, webSearches int, s Settings) (costMicro, credits int64, err error) {
	costCacheHit, err := mulDivUp(u.CacheHitTokens, p.CostMicroPer1kCachedIn)
	if err != nil {
		return 0, 0, fmt.Errorf("cost cached input: %w", err)
	}
	costCacheMiss, err := mulDivUp(u.CacheMissTokens, p.CostMicroPer1kIn)
	if err != nil {
		return 0, 0, fmt.Errorf("cost input: %w", err)
	}
	costOut, err := mulDivUp(u.CompletionTokens, p.CostMicroPer1kOut)
	if err != nil {
		return 0, 0, fmt.Errorf("cost output: %w", err)
	}
	costSearch, err := mulChecked(webSearches, s.CostMicroPerWebSearch)
	if err != nil {
		return 0, 0, fmt.Errorf("cost web search: %w", err)
	}
	costMicro, err = sumChecked(costCacheHit, costCacheMiss, costOut, costSearch)
	if err != nil {
		return 0, 0, fmt.Errorf("cost total: %w", err)
	}

	creditsCacheHit, err := mulDivUp(u.CacheHitTokens, p.CreditsPer1kCachedIn)
	if err != nil {
		return 0, 0, fmt.Errorf("credits cached input: %w", err)
	}
	creditsCacheMiss, err := mulDivUp(u.CacheMissTokens, p.CreditsPer1kIn)
	if err != nil {
		return 0, 0, fmt.Errorf("credits input: %w", err)
	}
	creditsOut, err := mulDivUp(u.CompletionTokens, p.CreditsPer1kOut)
	if err != nil {
		return 0, 0, fmt.Errorf("credits output: %w", err)
	}
	creditsSearch, err := mulChecked(webSearches, s.CreditsPerWebSearch)
	if err != nil {
		return 0, 0, fmt.Errorf("credits web search: %w", err)
	}
	credits, err = sumChecked(creditsCacheHit, creditsCacheMiss, creditsOut, creditsSearch)
	if err != nil {
		return 0, 0, fmt.Errorf("credits total: %w", err)
	}

	return costMicro, credits, nil
}

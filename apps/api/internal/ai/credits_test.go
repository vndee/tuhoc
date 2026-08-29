package ai

// credits_test.go dựng Postgres thật (store.TestPool) cho mọi test — Service
// (credits.go) chỉ tồn tại để nói chuyện với bốn bảng thật của migration
// 0007_ai_credits, và một test chạy trên pool giả sẽ không bắt được đúng thứ
// cần bắt ở đây: ràng buộc CHECK của Postgres, và việc UPDATE/INSERT có nằm
// chung MỘT transaction hay không (điều một mock không có cách nào mô
// phỏng trung thực — nó không có khái niệm ROLLBACK).

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/store"
)

// newCreditsUser chèn một hàng users thật (ai_credits.user_id là khoá ngoại
// tới users(id), giống newVoter của internal/rating) rồi seed một hàng
// ai_credits với số dư ban đầu startMicro, trả về id người dùng mới.
func newCreditsUser(t *testing.T, pool *pgxpool.Pool, label string, startMicro int64) uuid.UUID {
	t.Helper()

	var id uuid.UUID
	email := fmt.Sprintf("credits-%s-%s@example.test", label, uuid.NewString())
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email, name, pw_hash) VALUES ($1,$2,$3) RETURNING id`,
		email, label, "not-a-real-hash").Scan(&id)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	_, err = pool.Exec(context.Background(),
		`INSERT INTO ai_credits (user_id, balance_micro) VALUES ($1,$2)`, id, startMicro)
	if err != nil {
		t.Fatalf("seed ai_credits: %v", err)
	}
	return id
}

// newUserWithoutCredits inserts a real users row and NOTHING else — no
// ai_credits row at all. Exists for
// TestEnsureCreditTreatsMissingCreditsRowAsInsufficient, which needs a user
// who has never been granted anything (the shape a caller sees between
// signup and Task 10's grant landing, or any bug that lets the two drift
// apart), distinct from newCreditsUser's "has a row, balance 0".
func newUserWithoutCredits(t *testing.T, pool *pgxpool.Pool, label string) uuid.UUID {
	t.Helper()

	var id uuid.UUID
	email := fmt.Sprintf("credits-%s-%s@example.test", label, uuid.NewString())
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email, name, pw_hash) VALUES ($1,$2,$3) RETURNING id`,
		email, label, "not-a-real-hash").Scan(&id)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}
	return id
}

// balanceOf đọc thẳng balance_micro hiện tại của userID, không đi qua
// Service — một trợ giúp độc lập với mã đang được kiểm.
func balanceOf(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) int64 {
	t.Helper()
	var b int64
	if err := pool.QueryRow(context.Background(),
		`SELECT balance_micro FROM ai_credits WHERE user_id = $1`, userID).Scan(&b); err != nil {
		t.Fatalf("read balance: %v", err)
	}
	return b
}

// updatedAtOf đọc thẳng ai_credits.updated_at của userID. Tồn tại riêng cho
// TestChargeTurnDoesNotTouchOtherUsersRow: một UPDATE thiếu WHERE user_id
// có thể (do trùng hợp) để nguyên GIÁ TRỊ balance_micro của một hàng khác
// (ví dụ hàng đó vừa được trừ đúng 0) trong khi vẫn stamp updated_at =
// now() lên NÓ — balance_micro một mình không đủ để bắt hình dạng lỗi đó.
func updatedAtOf(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) time.Time {
	t.Helper()
	var ts time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT updated_at FROM ai_credits WHERE user_id = $1`, userID).Scan(&ts); err != nil {
		t.Fatalf("read updated_at: %v", err)
	}
	return ts
}

// usageRowCount đếm số hàng ai_usage của userID.
func usageRowCount(t *testing.T, pool *pgxpool.Pool, userID uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM ai_usage WHERE user_id = $1`, userID).Scan(&n); err != nil {
		t.Fatalf("count ai_usage: %v", err)
	}
	return n
}

// seedTestPricing chèn một hàng ai_pricing dùng số tròn, tách khỏi giá
// DeepSeek thật mà migration 0007 seed sẵn (giá đó được tự do đổi mà không
// phải sửa test này) — model là một tên riêng cho từng test để không đụng
// hàng nhau hay đụng 'deepseek-v4-pro'/'deepseek-v4-flash'.
//
// credits_per_1k_out = 500 được chọn để divUp(1000, 500) (cost.go) ra đúng
// 500 — một lượt CompletionTokens=1000 tốn đúng 500 credit, số tròn brief
// Step 2 dùng làm ví dụ (số dư 10, lượt tốn 500 -> -490).
func seedTestPricing(t *testing.T, pool *pgxpool.Pool, model string) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO ai_pricing (model, cost_micro_per_1k_in, cost_micro_per_1k_cached_in,
			cost_micro_per_1k_out, credits_per_1k_in, credits_per_1k_cached_in, credits_per_1k_out)
		VALUES ($1, 1000, 100, 500, 1000, 100, 500)`, model)
	if err != nil {
		t.Fatalf("seed ai_pricing: %v", err)
	}
}

// seedAsymmetricTestPricing is seedTestPricing's cost_micro_* columns
// (unchanged: 1000/100/500) paired with credits_* columns at DOUBLE those
// rates (2000/200/1000) instead of the same numbers.
//
// Round 1 review, I2: seedTestPricing alone makes cost_micro and
// credits_charged IDENTICAL in every test that uses it (both 1000/100/500),
// so a mutant that swaps Charge's two return values (`credits, costMicro
// := Charge(...)`) or that has ChargeTurn return costMicro instead of
// credits is invisible to every assertion in this file — cost_micro ==
// credits_charged == charged no matter which one lands where. Only
// TestChargeTurnWritesExactLedgerRow claims to guard the field mapping, so
// it is the one test in this file that needs the two numbers to actually
// differ; every other test keeps using seedTestPricing on purpose (their
// own arithmetic — e.g. Step 2's balance 10, charge 500, land on -490 —
// stays easy to verify by hand when cost and credits agree).
//
// Round 3 review's pairwise-distinguishability scan: all SIX columns here
// (1000/100/500/2000/200/700) are pairwise DISTINCT on purpose. An earlier
// version used 1000 for both cost_micro_per_1k_in and credits_per_1k_out —
// equal by coincidence — which made a transposition mutation in
// pricing()'s Scan() call (CostMicroPer1kIn <-> CreditsPer1kOut) invisible
// to THIS test specifically (verified by injecting exactly that mutation
// and re-running: TestChargeTurnWritesExactLedgerRow alone stayed green).
// The whole SUITE still caught it, via seedTestPricing's tests (where
// cost_in=1000 and credits_out=500 legitimately differ) — but this test
// claims to guard the pricing field mapping on its own, so it should not
// depend on some OTHER test's fixture to close the loop. credits_per_1k_out
// changed from 1000 to 700 to remove the coincidence.
func seedAsymmetricTestPricing(t *testing.T, pool *pgxpool.Pool, model string) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO ai_pricing (model, cost_micro_per_1k_in, cost_micro_per_1k_cached_in,
			cost_micro_per_1k_out, credits_per_1k_in, credits_per_1k_cached_in, credits_per_1k_out)
		VALUES ($1, 1000, 100, 500, 2000, 200, 700)`, model)
	if err != nil {
		t.Fatalf("seed ai_pricing: %v", err)
	}
}

// TestChargeAndLedgerCommitTogether khoá đúng lời hứa cốt lõi của brief:
// trừ credit (UPDATE ai_credits) và ghi sổ (INSERT ai_usage) là MỘT
// transaction, không phải hai câu lệnh rời nhau.
//
// Ép lỗi GIỮA hai lệnh mà không cần fault injection ở tầng driver: đặt
// CacheMissTokens âm, ánh xạ thẳng vào ai_usage.in_tokens (credits.go),
// cột mang CHECK (in_tokens >= 0) (migration 0007). ChargeTurn phải chạy
// UPDATE ai_credits trước, RỒI INSERT ai_usage mới vỡ CHECK — nếu UPDATE
// nằm trong cùng transaction với INSERT, transaction bị abort và UPDATE
// cũng biến mất theo; nếu hai lệnh rời nhau, UPDATE đã commit độc lập và
// số dư đổi vĩnh viễn dù không hàng sổ nào được ghi. Test khẳng định vế
// sau KHÔNG xảy ra.
//
// CẢNH BÁO KHI SỬA credits.go: cơ chế ép lỗi ở trên phụ thuộc CHẶT vào
// việc r.Usage.CacheMissTokens vẫn map vào cột in_tokens (không phải
// cached_in_tokens hay bất kỳ cột nào khác). Đổi ánh xạ đó (kể cả để sửa
// I2 — xem seedAsymmetricTestPricing) mà không cập nhật badResult bên
// dưới sẽ âm thầm làm test này hết còn ép được lỗi gì cả — CHECK
// (cached_in_tokens >= 0) cũng tồn tại nên nó vẫn có thể "may mắn" đỏ đúng
// chỗ khác, nhưng đừng dựa vào may mắn đó, kiểm lại bằng tay nếu ánh xạ
// đổi.
func TestChargeAndLedgerCommitTogether(t *testing.T) {
	pool := store.TestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	const model = "atomic-test-model"
	seedTestPricing(t, pool, model)

	userID := newCreditsUser(t, pool, "atomic", 1000)

	badResult := Result{Usage: Usage{CacheMissTokens: -5}}

	charged, err := svc.ChargeTurn(ctx, userID, badResult, model)
	if err == nil {
		t.Fatalf("want error from an ai_usage row that violates its own CHECK constraint, got charged=%d", charged)
	}

	if got := balanceOf(t, pool, userID); got != 1000 {
		t.Errorf("balance changed despite the ledger insert failing: want 1000 (unchanged), got %d — the credit deduction was not rolled back with the failed ledger write", got)
	}
	if n := usageRowCount(t, pool, userID); n != 0 {
		t.Errorf("want 0 ai_usage rows after a failed charge, got %d", n)
	}
}

// TestChargeTurnDoesNotTouchOtherUsersRow guards the tenant scope on the
// ai_credits UPDATE, in credits.go's ChargeTurn: `WHERE user_id = $1`.
//
// Round 2 review ran its own mutation — deleting that WHERE clause — and
// EVERY test in this file still passed. The reason: every other test in
// this file seeds exactly ONE ai_credits row per pool (store.TestPool
// gives each test its own disposable container), so an UPDATE with no
// WHERE clause updates "every row in the table" and "the one row that
// belongs to userID" are the SAME set — indistinguishable from outside.
// In a real multi-learner database they are never the same set: a missing
// WHERE clause there means ONE learner's turn silently deducts credit from
// (and stamps updated_at on) EVERY OTHER learner's balance at once.
//
// This is the first test in the file to put TWO ai_credits rows in the
// SAME pool on purpose, so a missing WHERE clause has a second row to leak
// into. It checks THREE independent signals of that leak — balance_micro,
// updated_at, and ai_usage row count — because a mutation could coincidentally
// leave one of them looking right (e.g. a bystander balance that happens to
// already equal what a broken UPDATE would produce) without the others
// agreeing.
func TestChargeTurnDoesNotTouchOtherUsersRow(t *testing.T) {
	pool := store.TestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	const model = "tenant-scope-test-model"
	seedTestPricing(t, pool, model)

	charged := newCreditsUser(t, pool, "tenant-charged", 10000)
	bystander := newCreditsUser(t, pool, "tenant-bystander", 5000)

	bystanderBalanceBefore := balanceOf(t, pool, bystander)
	bystanderUpdatedAtBefore := updatedAtOf(t, pool, bystander)

	if _, err := svc.ChargeTurn(ctx, charged, Result{Usage: Usage{CompletionTokens: 1000}}, model); err != nil {
		t.Fatalf("ChargeTurn: %v", err)
	}

	if got := balanceOf(t, pool, bystander); got != bystanderBalanceBefore {
		t.Errorf("bystander's balance changed from %d to %d after charging a DIFFERENT user — the UPDATE is missing (or lost) its WHERE user_id scope", bystanderBalanceBefore, got)
	}
	if got := updatedAtOf(t, pool, bystander); !got.Equal(bystanderUpdatedAtBefore) {
		t.Errorf("bystander's updated_at changed from %s to %s after charging a DIFFERENT user — same missing-scope bug, catchable even on a coincidence that left balance_micro's value alone", bystanderUpdatedAtBefore, got)
	}
	if n := usageRowCount(t, pool, bystander); n != 0 {
		t.Errorf("want 0 ai_usage rows for the bystander (nobody charged their turn), got %d", n)
	}
}

// TestChargeTurnGoesNegativeMidTurnAndFinishes khoá spec §3.4: một lượt hết
// credit GIỮA CHỪNG vẫn chạy nốt, và số dư sau đó được PHÉP âm — số dư 10,
// lượt tốn 500 -> balance_micro == -490, khớp nguyên văn ví dụ của brief.
//
// result.Answer để "" CÓ CHỦ Ý (không chỉ là giá trị zero mặc định bị bỏ
// quên) — đây cũng LÀ hình dạng "lượt trắng" của món nợ #2 (Content=="" và
// không tool_calls, Run vẫn trả (Result, nil)). Trước round 1 review điều
// này chỉ đúng TÌNH CỜ; giờ ghi thành ý định: ChargeTurn không đặc cách
// Answer rỗng, nó trừ tiền y hệt mọi Result khác dựa trên r.Usage — xem
// điểm 2 ở doc comment đầu credits.go.
func TestChargeTurnGoesNegativeMidTurnAndFinishes(t *testing.T) {
	pool := store.TestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	const model = "negative-test-model"
	seedTestPricing(t, pool, model)

	userID := newCreditsUser(t, pool, "negative", 10)

	result := Result{Answer: "", Usage: Usage{CompletionTokens: 1000}}

	charged, err := svc.ChargeTurn(ctx, userID, result, model)
	if err != nil {
		t.Fatalf("ChargeTurn: %v", err)
	}
	if charged != 500 {
		t.Fatalf("want charged 500 credits, got %d", charged)
	}

	if got := balanceOf(t, pool, userID); got != -490 {
		t.Errorf("want balance -490 (10 - 500, spec §3.4: a turn that runs out of credit mid-turn still finishes and goes negative), got %d", got)
	}
}

// TestChargeTurnWritesExactLedgerRow guards the field mapping between
// Result/Usage and ai_usage's columns, AND the ai_credits deduction. A
// mapping bug — CacheHitTokens fed into in_tokens where CacheMissTokens
// belongs, say — would still pass every other test in this file: both
// cache columns carry the identical CHECK (>= 0), and the other tests only
// assert the TOTAL credits charged, which a swap of two distinct fields
// does not change when both are nonzero-but-untested. This test reads the
// row back and checks every column, using seedAsymmetricTestPricing
// (credits at DOUBLE cost's rate — see that helper's comment, round 1
// review I2) so cost_micro and credits_charged land on two DIFFERENT
// numbers: a test that could pass with the two swapped, or with ChargeTurn
// returning the wrong one as `charged`, was not actually guarding either.
//
//	cost_micro     = divUp(4000,100)  + divUp(3000,1000) + divUp(1000,500)
//	               =      400         +      3000         +      500       = 3900
//	credits_charged = divUp(4000,200) + divUp(3000,2000) + divUp(1000,700)
//	               =      800         +      6000         +      700       = 7500
//
// Round 3 review: this was the ONE test with cost_micro != credits_charged,
// but before this round it never called balanceOf() to check what the
// UPDATE actually deducted from ai_credits — it checked `charged` (the
// return value) and the ai_usage columns, and stopped there. credits.go's
// UPDATE call used `credits` correctly, but nothing here would have
// noticed if it had used `costMicro` instead: every OTHER test in this
// file seeds symmetric pricing (cost_micro_per_1k_* == credits_per_1k_*),
// so deducting the wrong one of the pair still landed on the same number.
// The balanceOf() assertion below closes that: it is the fourth and last
// place `credits` (as opposed to `costMicro`) needs to show up correctly —
// return value, ai_usage.credits_charged, ai_usage.cost_micro (which must
// NOT equal credits), and now ai_credits.balance_micro.
func TestChargeTurnWritesExactLedgerRow(t *testing.T) {
	pool := store.TestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	const model = "ledger-row-test-model"
	seedAsymmetricTestPricing(t, pool, model)

	const startBalance = 100000
	userID := newCreditsUser(t, pool, "ledger-row", startBalance)

	result := Result{
		Usage: Usage{
			CacheMissTokens:  3000,
			CacheHitTokens:   4000,
			CompletionTokens: 1000,
		},
		ToolCalls:   3,
		WebSearches: 2,
	}

	const wantCostMicro = 400 + 3000 + 500 // 3900
	const wantCredits = 800 + 6000 + 700   // 7500

	charged, err := svc.ChargeTurn(ctx, userID, result, model)
	if err != nil {
		t.Fatalf("ChargeTurn: %v", err)
	}
	if charged != wantCredits {
		t.Errorf("ChargeTurn returned charged=%d, want %d (credits_charged, the price sold to the learner — NOT cost_micro, the platform's own cost) — round 1 review I2: this is the assertion that would catch ChargeTurn returning costMicro instead of credits", charged, wantCredits)
	}

	// Round 3 review: the UPDATE inside ChargeTurn is a SEPARATE write site
	// from the INSERT checked below — a mutation that has the UPDATE
	// deduct costMicro (3900) instead of credits (7500) leaves `charged`
	// and every ai_usage column correct, and only shows up HERE.
	if got := balanceOf(t, pool, userID); got != startBalance-wantCredits {
		t.Errorf("balance: want %d (%d - %d credits), got %d — the ai_credits UPDATE deducted the wrong one of cost_micro/credits", startBalance-wantCredits, startBalance, wantCredits, got)
	}

	var gotModel string
	var inTokens, cachedInTokens, outTokens, toolCalls, webSearches int
	var costMicro, creditsCharged int64
	err = pool.QueryRow(ctx, `
		SELECT model, in_tokens, cached_in_tokens, out_tokens, tool_calls, web_searches,
		       cost_micro, credits_charged
		FROM ai_usage WHERE user_id = $1`, userID).
		Scan(&gotModel, &inTokens, &cachedInTokens, &outTokens, &toolCalls, &webSearches,
			&costMicro, &creditsCharged)
	if err != nil {
		t.Fatalf("read ai_usage row: %v", err)
	}

	if gotModel != model {
		t.Errorf("model: want %q, got %q", model, gotModel)
	}
	if inTokens != 3000 {
		t.Errorf("in_tokens: want 3000 (CacheMissTokens), got %d", inTokens)
	}
	if cachedInTokens != 4000 {
		t.Errorf("cached_in_tokens: want 4000 (CacheHitTokens), got %d", cachedInTokens)
	}
	if outTokens != 1000 {
		t.Errorf("out_tokens: want 1000 (CompletionTokens), got %d", outTokens)
	}
	if toolCalls != 3 {
		t.Errorf("tool_calls: want 3, got %d", toolCalls)
	}
	if webSearches != 2 {
		t.Errorf("web_searches: want 2, got %d", webSearches)
	}
	if costMicro != wantCostMicro {
		t.Errorf("cost_micro: want %d, got %d", wantCostMicro, costMicro)
	}
	if creditsCharged != wantCredits {
		t.Errorf("credits_charged: want %d, got %d", wantCredits, creditsCharged)
	}
}

// TestChargeTurnAppliesWebSearchSurcharge locks the other live input Charge
// (cost.go) reads besides Usage/Pricing: Settings.CreditsPerWebSearch and
// Settings.CostMicroPerWebSearch.
//
// Round 1 review, I1: migration 0007 seeds ai_settings with BOTH surcharge
// columns at 0, and no other test in this file changes them — so a mutant
// that drops r.WebSearches from the Charge(...) call entirely (2 *
// 0 == 0, same as 2 * <anything> * 0) is invisible everywhere else,
// including TestChargeTurnWritesExactLedgerRow's web_searches column
// (written straight from r.WebSearches into the INSERT, never through
// Charge at all — that assertion guards the LEDGER ROW, not the PRICE).
// This test UPDATEs the one ai_settings row to a nonzero surcharge — safe
// because store.TestPool gives every test its own disposable container —
// and checks the surcharge lands in real money.
func TestChargeTurnAppliesWebSearchSurcharge(t *testing.T) {
	pool := store.TestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	const model = "web-search-surcharge-test-model"
	seedTestPricing(t, pool, model)

	if _, err := pool.Exec(ctx,
		`UPDATE ai_settings SET credits_per_web_search = 300, cost_micro_per_web_search = 150`); err != nil {
		t.Fatalf("seed ai_settings surcharge: %v", err)
	}

	userID := newCreditsUser(t, pool, "web-search", 100000)

	result := Result{Usage: Usage{CompletionTokens: 1000}, WebSearches: 2}

	// seedTestPricing: divUp(1000, 500) == 500 token credits (and 500 token
	// cost_micro, same rate). Two web searches at 300 credits/150
	// cost_micro each add 600/300 on top.
	const wantCharged = 500 + 2*300
	const wantCostMicro = 500 + 2*150

	charged, err := svc.ChargeTurn(ctx, userID, result, model)
	if err != nil {
		t.Fatalf("ChargeTurn: %v", err)
	}
	if charged != wantCharged {
		t.Errorf("charged: want %d (token credits + web-search surcharge), got %d", wantCharged, charged)
	}

	var costMicro int64
	if err := pool.QueryRow(ctx, `SELECT cost_micro FROM ai_usage WHERE user_id = $1`, userID).
		Scan(&costMicro); err != nil {
		t.Fatalf("read ai_usage.cost_micro: %v", err)
	}
	if costMicro != wantCostMicro {
		t.Errorf("cost_micro: want %d (token cost + web-search surcharge), got %d", wantCostMicro, costMicro)
	}
}

// TestEnsureCreditBlocksNextTurnAfterGoingNegative khoá nửa còn lại của
// spec §3.4: lượt SAU một số dư âm bị chặn. ChargeTurn (test trên) tự nó
// không chặn gì — nó luôn hoàn tất lượt ĐANG chạy dù kết quả là âm; việc
// chặn là của EnsureCredit, gọi TRƯỚC khi một lượt MỚI bắt đầu.
func TestEnsureCreditBlocksNextTurnAfterGoingNegative(t *testing.T) {
	pool := store.TestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	const model = "block-test-model"
	seedTestPricing(t, pool, model)

	userID := newCreditsUser(t, pool, "block", 10)

	if _, err := svc.ChargeTurn(ctx, userID, Result{Usage: Usage{CompletionTokens: 1000}}, model); err != nil {
		t.Fatalf("ChargeTurn: %v", err)
	}

	if err := svc.EnsureCredit(ctx, userID); !errors.Is(err, ErrInsufficientCredit) {
		t.Errorf("want ErrInsufficientCredit for a negative balance, got %v", err)
	}
}

// TestEnsureCreditAllowsPositiveBalance is the control for the test above:
// EnsureCredit must not block a user who has never spent anything.
func TestEnsureCreditAllowsPositiveBalance(t *testing.T) {
	pool := store.TestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	userID := newCreditsUser(t, pool, "positive", 10)

	if err := svc.EnsureCredit(ctx, userID); err != nil {
		t.Errorf("want no error for a positive balance, got %v", err)
	}
}

// TestEnsureCreditBlocksAtExactlyZero pins the boundary itself.
//
// Round 1 review, I3: the two tests above only ever exercise +10 (allowed)
// and -490 (blocked) — nothing in this file previously distinguished
// `balance <= 0` from `balance < 0`, so a mutant that changed the operator
// passed both. Balance exactly 0 is the one value that actually separates
// the two operators, and it is also the realistic case: a learner who has
// spent precisely what they were given, before ever going negative.
func TestEnsureCreditBlocksAtExactlyZero(t *testing.T) {
	pool := store.TestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	userID := newCreditsUser(t, pool, "zero", 0)

	if err := svc.EnsureCredit(ctx, userID); !errors.Is(err, ErrInsufficientCredit) {
		t.Errorf("want ErrInsufficientCredit at balance == 0 (the boundary itself), got %v", err)
	}
}

// TestEnsureCreditTreatsMissingCreditsRowAsInsufficient pins the error
// SHAPE EnsureCredit returns for a user with no ai_credits row at all —
// distinct from every balance-based test above, which all seed a row
// first.
//
// Round 1 review, minor: without credits.go's explicit pgx.ErrNoRows
// branch, this case would surface as a generic wrapped lookup error
// instead of ErrInsufficientCredit. A caller that branches with
// errors.Is(err, ErrInsufficientCredit) to choose between an HTTP 402 and
// a 500 needs this case to read the same as a negative or zero balance —
// "nothing to spend" is the same fact whether the row says 0 or is simply
// absent.
func TestEnsureCreditTreatsMissingCreditsRowAsInsufficient(t *testing.T) {
	pool := store.TestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	userID := newUserWithoutCredits(t, pool, "no-row")

	if err := svc.EnsureCredit(ctx, userID); !errors.Is(err, ErrInsufficientCredit) {
		t.Errorf("want ErrInsufficientCredit for a user with no ai_credits row, got %v", err)
	}
}

// dbColumn is one row of information_schema.columns, the subset
// columnsOf needs.
type dbColumn struct {
	Name string
	Type string
}

// columnsOf lists every column of table in a fresh migrated database.
func columnsOf(t *testing.T, table string) []dbColumn {
	t.Helper()
	pool := store.TestPool(t)

	rows, err := pool.Query(context.Background(),
		`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`, table)
	if err != nil {
		t.Fatalf("query columns of %s: %v", table, err)
	}
	defer rows.Close()

	var cols []dbColumn
	for rows.Next() {
		var c dbColumn
		if err := rows.Scan(&c.Name, &c.Type); err != nil {
			t.Fatalf("scan column of %s: %v", table, err)
		}
		cols = append(cols, c)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read columns of %s: %v", table, err)
	}
	return cols
}

// freeTextTypes are the Postgres data_type strings (as
// information_schema.columns reports them) capable of holding an
// unbounded blob of prose — a conversation body, specifically.
//
// Round 1 review, I4: the previous version of this test checked only
// c.Type == "text". A varchar column reports "character varying", not
// "text" — and json/jsonb columns report their own names — so all three
// could carry a conversation body exactly as well as text can, and none
// of them were being checked.
//
// Round 2 review, I4 follow-up: experimentally confirmed against a real
// Postgres container that char(n)/bpchar reports data_type "character"
// (added below — a fixed-width column can still hold a truncated
// conversation fragment, and "character" names no numeric or temporal
// type in Postgres, so adding it carries no false-positive risk for any
// column this migration could plausibly add).
//
// Deliberately NOT added: "ARRAY". information_schema.columns reports
// EVERY array column's data_type as the bare string "ARRAY" regardless of
// element type — text[] and int[] are indistinguishable at this view; the
// element type lives in a separate column (udt_name, e.g. "_text" vs
// "_int4") this test does not read. Adding "ARRAY" here would false-positive
// on the very first int[]/uuid[] column anyone adds to ANY table this test
// touches — a gate that cries wolf gets ignored or weakened, which is worse
// than the gap it would have closed. Closing this properly needs a second
// map keyed on udt_name, or a query that reads it; left as a known,
// documented limitation rather than a rushed false-positive gate.
var freeTextTypes = map[string]bool{
	"text":              true,
	"character varying": true,
	"character":         true,
	"json":              true,
	"jsonb":             true,
}

// TestUsageLedgerHasNoFreeTextColumn is global constraint #2 of the whole
// phase, enforced at the SCHEMA layer rather than as a "remember not to
// write it" convention: ai_usage (migration 0007_ai_credits) may hold
// MEASUREMENTS only. A free-text-capable column beyond "model" is exactly
// where a conversation body would eventually drift in.
func TestUsageLedgerHasNoFreeTextColumn(t *testing.T) {
	cols := columnsOf(t, "ai_usage")
	if len(cols) == 0 {
		// Round 1 review, I4: a typo'd table name, a wrong search_path, or
		// a dropped table all make information_schema.columns return
		// nothing — and an empty result makes the loop below assert
		// NOTHING and pass silently. This is the same "blind gate" shape
		// i18n_server_speaks_codes_test.go's own minProductionGoFiles
		// anchor guards against: a gate that can pass by reading zero rows
		// is a gate that stopped gating without ever turning red.
		t.Fatalf("columnsOf(%q) returned no columns — the table lookup itself is broken, not that the table has no free-text column", "ai_usage")
	}
	for _, c := range cols {
		if freeTextTypes[c.Type] && c.Name != "model" {
			t.Errorf("free-text-capable column %q (%s) in ai_usage — this ledger may only hold MEASUREMENTS, and a free-text-capable column is where a conversation body would drift in", c.Name, c.Type)
		}
	}
}

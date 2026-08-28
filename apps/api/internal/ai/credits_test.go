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

// TestChargeTurnGoesNegativeMidTurnAndFinishes khoá spec §3.4: một lượt hết
// credit GIỮA CHỪNG vẫn chạy nốt, và số dư sau đó được PHÉP âm — số dư 10,
// lượt tốn 500 -> balance_micro == -490, khớp nguyên văn ví dụ của brief.
func TestChargeTurnGoesNegativeMidTurnAndFinishes(t *testing.T) {
	pool := store.TestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	const model = "negative-test-model"
	seedTestPricing(t, pool, model)

	userID := newCreditsUser(t, pool, "negative", 10)

	result := Result{Usage: Usage{CompletionTokens: 1000}}

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
// Result/Usage and ai_usage's columns. A mapping bug — CacheHitTokens fed
// into in_tokens where CacheMissTokens belongs, say — would still pass
// every other test in this file: both cache columns carry the identical
// CHECK (>= 0), and the other tests only assert the TOTAL credits charged,
// which a swap of two distinct fields does not change when both are
// nonzero-but-untested. This test reads the row back and checks every
// column against a hand-computed total (seedTestPricing uses round
// numbers specifically so this is easy to verify by hand):
//
//	cost_micro = divUp(4000,100) + divUp(3000,1000) + divUp(1000,500)
//	           =      400        +      3000         +      500       = 3900
//
// credits_charged uses the same rates in seedTestPricing, so it comes out
// to the identical 3900.
func TestChargeTurnWritesExactLedgerRow(t *testing.T) {
	pool := store.TestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	const model = "ledger-row-test-model"
	seedTestPricing(t, pool, model)

	userID := newCreditsUser(t, pool, "ledger-row", 100000)

	result := Result{
		Usage: Usage{
			CacheMissTokens:  3000,
			CacheHitTokens:   4000,
			CompletionTokens: 1000,
		},
		ToolCalls:   3,
		WebSearches: 2,
	}

	if _, err := svc.ChargeTurn(ctx, userID, result, model); err != nil {
		t.Fatalf("ChargeTurn: %v", err)
	}

	var gotModel string
	var inTokens, cachedInTokens, outTokens, toolCalls, webSearches int
	var costMicro, creditsCharged int64
	err := pool.QueryRow(ctx, `
		SELECT model, in_tokens, cached_in_tokens, out_tokens, tool_calls, web_searches,
		       cost_micro, credits_charged
		FROM ai_usage WHERE user_id = $1`, userID).
		Scan(&gotModel, &inTokens, &cachedInTokens, &outTokens, &toolCalls, &webSearches,
			&costMicro, &creditsCharged)
	if err != nil {
		t.Fatalf("read ai_usage row: %v", err)
	}

	const wantTotal = 400 + 3000 + 500 // 3900

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
	if costMicro != wantTotal {
		t.Errorf("cost_micro: want %d, got %d", wantTotal, costMicro)
	}
	if creditsCharged != wantTotal {
		t.Errorf("credits_charged: want %d, got %d", wantTotal, creditsCharged)
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

// TestUsageLedgerHasNoFreeTextColumn is global constraint #2 of the whole
// phase, enforced at the SCHEMA layer rather than as a "remember not to
// write it" convention: ai_usage (migration 0007_ai_credits) may hold
// MEASUREMENTS only. A free-text column beyond "model" is exactly where a
// conversation body would eventually drift in.
func TestUsageLedgerHasNoFreeTextColumn(t *testing.T) {
	cols := columnsOf(t, "ai_usage")
	for _, c := range cols {
		if c.Type == "text" && c.Name != "model" {
			t.Errorf("text column %q in ai_usage — this ledger may only hold MEASUREMENTS, and a free-text column is where a conversation body would drift in", c.Name)
		}
	}
}

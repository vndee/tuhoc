// credits.go is the only file in this package that speaks SQL — same split
// as internal/rating/repo.go and internal/auth/repo.go. It owns the four
// tables migration 0007_ai_credits created (ai_credits, ai_usage,
// ai_pricing, ai_settings) and is the ONE place a credit is deducted or a
// usage row is written.
//
// Task 9's ledger (task-9-brief.md) names two decisions this file must NOT
// get wrong, because five earlier round reviews across this run caught the
// same failure shape — a real line of billing logic deleted while the
// whole suite stayed green:
//
//  1. Run/RunStream's documented contract (agent.go's doc comment on Run,
//     "HỢP ĐỒNG usage-trên-đường-lỗi") is that Result carries accumulated
//     Usage EVEN WHEN err != nil — DeepSeek has already been paid for those
//     tokens. ChargeTurn's signature takes a bare Result, not a
//     (Result, error) pair, and reads ONLY r.Usage/r.ToolCalls/
//     r.WebSearches — it has no opinion on whether the turn that produced r
//     succeeded. The Go instinct "err != nil, discard the result" is the
//     caller's business (Task 10/11's handler, calling Run/RunStream) and
//     is explicitly WRONG for this package: ChargeTurn must be called with
//     r regardless of whether the turn that built it returned an error, or
//     the tokens DeepSeek already billed go uncharged to the learner.
//  2. A turn whose Answer is "" and carries no tool calls (Run's own doc
//     comment: a model that quietly answers with nothing, as opposed to
//     ErrToolBudgetExhausted's "model never got to answer at all") still
//     returns (Result, nil) — real tokens, zero output. ChargeTurn does
//     NOT special-case this: it charges on r.Usage exactly like any other
//     result. The alternative — skip charging when Answer == "" — would
//     let a script farm free tokens by asking questions worded to produce
//     an empty reply; DeepSeek was paid regardless of what the model chose
//     to say.
//
// A third fact about this file, not from the debt ledger but load-bearing
// for the transaction test: deducting credit and writing the ledger row
// happen in ONE Postgres transaction (tx.Exec twice, one tx.Commit), not
// two separate pool.Exec calls. Two separate statements have a window —
// the process can die, or a later statement can fail, between them — where
// only one side lands: credit gone with no record of why (an unexplained
// deduction), or a ledger row with no matching deduction (free tokens).
package ai

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrInsufficientCredit is returned by EnsureCredit when userID's
// ai_credits balance is at or below zero. It is the block on the turn
// AFTER the one that ran the balance negative — spec §3.4 lets the turn
// that crosses zero finish and go negative (ChargeTurn never refuses to
// charge because a balance would end up negative), and this error is the
// separate check a caller runs BEFORE starting a new turn.
var ErrInsufficientCredit = errors.New("ai: insufficient credit")

// Service is the credit and usage-ledger store: ai_credits (balance),
// ai_usage (the append-only ledger), ai_pricing (per-model rates), and
// ai_settings (the one-row platform config, read here for the web-search
// surcharge). It holds no business rules beyond "charge exactly what
// Charge (cost.go) computes, atomically" — the decision of WHEN to call
// ChargeTurn, and whether to call EnsureCredit first, belongs to the
// caller (Task 10's rate limiter, Task 11's /ai/chat handler).
type Service struct {
	pool *pgxpool.Pool
}

// NewService builds a Service over pool.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// Balance reads userID's current ai_credits.balance_micro. Despite the
// column's name, this is the same "credits" unit ChargeTurn's charged
// return value and cost.go's Charge deal in — see Pricing's doc comment in
// types.go for the cost-vs-credits distinction; balance_micro tracks
// credits spent, not cost_micro.
func (s *Service) Balance(ctx context.Context, userID uuid.UUID) (int64, error) {
	var balance int64
	err := s.pool.QueryRow(ctx,
		`SELECT balance_micro FROM ai_credits WHERE user_id = $1`, userID).Scan(&balance)
	if err != nil {
		return 0, fmt.Errorf("ai: balance for user %s: %w", userID, err)
	}
	return balance, nil
}

// EnsureCredit blocks a NEW turn from starting when userID's balance is at
// or below zero. It does not reserve, lock, or otherwise hold the balance
// — it is a single read of the current row. There is therefore a window
// between this call returning nil and a turn actually starting where a
// concurrent ChargeTurn could move the balance again; closing that window
// (a reservation, or checking again immediately before the first DeepSeek
// call) is out of scope for this file and belongs to whichever task wires
// this into the request path.
func (s *Service) EnsureCredit(ctx context.Context, userID uuid.UUID) error {
	balance, err := s.Balance(ctx, userID)
	if err != nil {
		return err
	}
	if balance <= 0 {
		return ErrInsufficientCredit
	}
	return nil
}

// pricing loads the ai_pricing row for model. A model with no row (a typo,
// or a model retired from ai_pricing but still reachable through stale
// client state) fails closed: ChargeTurn returns the wrapped pgx.ErrNoRows
// instead of charging nothing, which would be an undercharge, not a
// warning.
func (s *Service) pricing(ctx context.Context, model string) (Pricing, error) {
	var p Pricing
	err := s.pool.QueryRow(ctx, `
		SELECT model, cost_micro_per_1k_in, cost_micro_per_1k_cached_in, cost_micro_per_1k_out,
		       credits_per_1k_in, credits_per_1k_cached_in, credits_per_1k_out
		FROM ai_pricing WHERE model = $1`, model).
		Scan(&p.Model, &p.CostMicroPer1kIn, &p.CostMicroPer1kCachedIn, &p.CostMicroPer1kOut,
			&p.CreditsPer1kIn, &p.CreditsPer1kCachedIn, &p.CreditsPer1kOut)
	if err != nil {
		return Pricing{}, fmt.Errorf("ai: pricing for model %q: %w", model, err)
	}
	return p, nil
}

// settings loads the one row of ai_settings (id boolean CHECK(id) enforces
// there is exactly one, per migration 0007's own comment).
func (s *Service) settings(ctx context.Context) (Settings, error) {
	var st Settings
	err := s.pool.QueryRow(ctx, `
		SELECT base_system_prompt, credits_per_web_search, cost_micro_per_web_search,
		       signup_grant_micro, max_tokens_per_turn, max_tool_rounds_per_turn
		FROM ai_settings LIMIT 1`).
		Scan(&st.BaseSystemPrompt, &st.CreditsPerWebSearch, &st.CostMicroPerWebSearch,
			&st.SignupGrantMicro, &st.MaxTokensPerTurn, &st.MaxToolRoundsPerTurn)
	if err != nil {
		return Settings{}, fmt.Errorf("ai: settings: %w", err)
	}
	return st, nil
}

// ChargeTurn deducts the credits a completed (or errored — see this file's
// package comment, point 1) turn cost from userID's balance and appends
// the matching row to ai_usage, IN ONE TRANSACTION. It returns the number
// of credits deducted (Charge's second return, cost.go — the price sold to
// the learner, not the platform's cost_micro).
//
// The deduction is allowed to take balance negative (spec §3.4): ChargeTurn
// itself never refuses to charge because the result would be negative — a
// turn already run is a turn already billed by DeepSeek, and refusing to
// record that here would silently give the tokens away. Blocking the NEXT
// turn from starting on a negative balance is EnsureCredit's job, called
// separately, before Run/RunStream, by whichever caller wires this in.
//
// r.Usage's four fields map onto ai_usage as follows: CacheMissTokens ->
// in_tokens, CacheHitTokens -> cached_in_tokens, CompletionTokens ->
// out_tokens — mirroring cost.go's Charge, which reads exactly these three
// (never r.Usage.PromptTokens, the wire-level total that Charge does not
// use either; see cost.go's own doc comment).
func (s *Service) ChargeTurn(ctx context.Context, userID uuid.UUID, r Result, model string) (int64, error) {
	pricing, err := s.pricing(ctx, model)
	if err != nil {
		return 0, err
	}
	settings, err := s.settings(ctx)
	if err != nil {
		return 0, err
	}

	costMicro, credits := Charge(r.Usage, pricing, r.WebSearches, settings)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("ai: charge turn begin tx for user %s: %w", userID, err)
	}
	// Rollback after a successful Commit is a documented no-op
	// (pgx.ErrTxClosed, discarded) — this defer is the safety net for
	// every OTHER return path below, including a panic unwinding through
	// this function.
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var newBalance int64
	err = tx.QueryRow(ctx, `
		UPDATE ai_credits SET balance_micro = balance_micro - $2, updated_at = now()
		WHERE user_id = $1
		RETURNING balance_micro`, userID, credits).Scan(&newBalance)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, fmt.Errorf("ai: charge turn: user %s has no ai_credits row: %w", userID, err)
		}
		return 0, fmt.Errorf("ai: charge turn deduct for user %s: %w", userID, err)
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO ai_usage (user_id, model, in_tokens, cached_in_tokens, out_tokens,
		                       tool_calls, web_searches, cost_micro, credits_charged)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		userID, model, r.Usage.CacheMissTokens, r.Usage.CacheHitTokens, r.Usage.CompletionTokens,
		r.ToolCalls, r.WebSearches, costMicro, credits)
	if err != nil {
		return 0, fmt.Errorf("ai: charge turn ledger for user %s: %w", userID, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("ai: charge turn commit for user %s: %w", userID, err)
	}

	return credits, nil
}

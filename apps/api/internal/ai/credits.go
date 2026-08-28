// credits.go is the only file in this package that speaks SQL — same split
// as internal/rating/repo.go and internal/auth/repo.go. It owns all five
// tables migration 0007_ai_credits created (ai_credits, ai_usage,
// ai_pricing, ai_settings, user_agent_config) and is the ONE place a credit
// is deducted, granted, or a usage row is written.
//
// Task 11 added the last of those five, user_agent_config, plus the two
// read-only accessors GET /ai/credits and GET/PUT /ai/config need
// (Settings, AgentConfig, SaveAgentConfig, RecentUsage). They live here
// rather than in handler.go for the reason stated in the first sentence:
// the split this package keeps is "one file speaks SQL", and a second file
// growing its own queries is how that stops being true.
//
// Task 10 adds GrantSignupCredit (bottom of this file) alongside Task 9's
// ChargeTurn/EnsureCredit/Balance: the same table (ai_credits) getting its
// balance moved the other direction, on registration instead of on a
// turn. It takes an explicit pgx.Tx rather than using s.pool the way every
// other method here does, because its caller (auth.Repo.
// CreateUserWithSignupCredit) needs the INSERT INTO users and this
// method's INSERT INTO ai_credits to commit or roll back TOGETHER — see
// that method's own doc comment for the orphan risk a separate statement
// here would reopen.
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
	"time"

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
		if errors.Is(err, pgx.ErrNoRows) {
			// A user with no ai_credits row yet has spent nothing AND has
			// nothing — round 1 review, I(minor): without this branch,
			// Balance's wrapped pgx.ErrNoRows would propagate as a generic
			// lookup failure instead of ErrInsufficientCredit, and a caller
			// that does errors.Is(err, ErrInsufficientCredit) to decide
			// between a 402 and a 500 would send this learner a 500 for a
			// condition that is really "nothing to spend" — the same
			// externally-visible situation as a balance of exactly 0.
			return ErrInsufficientCredit
		}
		return err
	}
	if balance <= 0 {
		return ErrInsufficientCredit
	}
	return nil
}

// pricing loads the ai_pricing row for model. A model with no row (a typo,
// or a model retired from ai_pricing but still reachable through stale
// client state) makes ChargeTurn return the wrapped pgx.ErrNoRows before
// touching ai_credits or ai_usage at all.
//
// Round 1 review (I5) flagged the previous version of this comment for
// calling that "failing closed" — it is NOT a safety property. By the time
// ChargeTurn runs, the turn already happened and DeepSeek already got paid
// for real tokens; returning an error here does not undo that spend, it
// just means THIS turn's cost never reaches either table — an actual loss
// of money and of the record of where it went, same failure shape as a
// missing ai_credits row or a failed Commit below. There is no retry and
// no dead-letter queue for this path in this file; a caller that needs one
// has to build it.
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

	// r.WebSearches feeds Charge (cost.go) here, which multiplies it by
	// BOTH settings.CostMicroPerWebSearch (Brave's real cost) and
	// settings.CreditsPerWebSearch (the price this learner pays) — the
	// counter carries both jobs at once. It is correct for what this row
	// charges the learner (r.WebSearches only ever counts a tool_call that
	// actually ran — see agent.go's doc comment on Result.WebSearches, "CHỈ
	// tăng sau khi ToolRunner.Run trả về không lỗi"), but it means a FAILED
	// search costMicro never appears anywhere in ai_usage: this ledger's
	// cost_micro therefore undercounts Brave's real spend by however many
	// searches errored. Fine today (nothing downstream reads cost_micro as
	// a cost ledger yet), but a debt Phase 4 needs to know about if it ever
	// wants an accurate cost_micro rather than an accurate credits_charged.
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

// GrantSignupCredit inserts userID's first ai_credits row, crediting
// ai_settings.signup_grant_micro. It reads that column from the database
// on every call — never a constant compiled into this binary — because
// the project owner changes this number from Task 17's CMS and expects it
// to take effect without a deploy; caching or hardcoding it would mean a
// changed setting only applies to accounts that register after the NEXT
// deploy, silently contradicting that expectation.
//
// It runs entirely inside the caller-supplied tx, never s.pool: the
// caller is registration itself (auth.Repo.CreateUserWithSignupCredit),
// and registration's own transaction is what makes "create the user" and
// "grant the signup credit" one atomic unit. A version of this method
// that opened its own transaction — the way ChargeTurn above does,
// because ChargeTurn's caller has no matching transaction of its own to
// join — would defeat that: the user row could commit while this insert
// failed moments later, leaving a real, permanent account with no credit
// and nothing that ever retries the grant.
func (s *Service) GrantSignupCredit(ctx context.Context, tx pgx.Tx, userID uuid.UUID) (int64, error) {
	var grantMicro int64
	err := tx.QueryRow(ctx, `SELECT signup_grant_micro FROM ai_settings LIMIT 1`).Scan(&grantMicro)
	if err != nil {
		return 0, fmt.Errorf("ai: signup grant: read ai_settings for user %s: %w", userID, err)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO ai_credits (user_id, balance_micro) VALUES ($1, $2)`,
		userID, grantMicro); err != nil {
		return 0, fmt.Errorf("ai: signup grant: insert ai_credits for user %s: %w", userID, err)
	}

	return grantMicro, nil
}

// Settings exposes the one ai_settings row to callers outside this package
// (Task 11's /ai/chat handler needs BaseSystemPrompt, MaxTokensPerTurn and
// MaxToolRoundsPerTurn to build an Agent and a Turn). It is a thin export
// of the unexported settings above rather than a second query: one SELECT,
// one place to change it.
//
// Every call reads the row afresh. That is the point of putting these
// numbers in a table at all — the project owner changes them from Task 17's
// CMS and expects the next turn to use the new values, with no deploy and
// no process restart. Any caching added here has to be a deliberate,
// documented trade against that expectation.
func (s *Service) Settings(ctx context.Context) (Settings, error) {
	return s.settings(ctx)
}

// AgentConfig is one learner's row of user_agent_config: the personal
// system prompt that gets APPENDED AFTER (never substituted for) the
// platform's base prompt, and the set of tools they have switched on.
//
// It is deliberately not the same type as Settings: Settings is the
// platform's configuration for everyone, this is one learner's, and the
// single most important rule about the pair (spec §3.3) is that the second
// never overrides the first. Two types make that hard to blur by accident;
// see buildMessages (agent.go) for where the rule is actually enforced.
type AgentConfig struct {
	SystemPrompt string
	ToolsEnabled []string
}

// defaultAgentConfig is what a learner who has never opened the settings
// screen gets. It mirrors user_agent_config's own column DEFAULTs
// (system_prompt ”, tools_enabled '{read_course}') by hand, because a
// SELECT that finds no row does not apply column defaults — they only fire
// on INSERT. A learner with no row and a learner who saved the defaults
// must behave identically.
func defaultAgentConfig() AgentConfig {
	return AgentConfig{ToolsEnabled: []string{ToolNameReadCourse}}
}

// AgentConfig reads userID's row, or the defaults above when there is none.
//
// The returned ToolsEnabled is DEDUPLICATED. text[] has no uniqueness
// constraint, and enabledTools (agent.go) appends one entry to
// Request.Tools per name it walks — so a duplicated name would send DeepSeek
// the same function twice in one request. SaveAgentConfig below already
// refuses to write a duplicate; this second pass covers rows written by
// anything else (a hand-edited row, a future admin tool, a restore).
func (s *Service) AgentConfig(ctx context.Context, userID uuid.UUID) (AgentConfig, error) {
	var cfg AgentConfig
	err := s.pool.QueryRow(ctx,
		`SELECT system_prompt, tools_enabled FROM user_agent_config WHERE user_id = $1`,
		userID).Scan(&cfg.SystemPrompt, &cfg.ToolsEnabled)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return defaultAgentConfig(), nil
		}
		return AgentConfig{}, fmt.Errorf("ai: agent config for user %s: %w", userID, err)
	}
	cfg.ToolsEnabled = dedupeStrings(cfg.ToolsEnabled)
	return cfg, nil
}

// SaveAgentConfig writes userID's row, creating it if this is the learner's
// first save. It validates NOTHING about the prompt's length or the tool
// names: that is the HTTP boundary's job (handler.go), where a rejection can
// carry a machine-readable code and a status the client can act on. What it
// does guarantee is the deduplication AgentConfig's doc comment explains,
// so the wire-shape invariant holds no matter which caller writes.
func (s *Service) SaveAgentConfig(ctx context.Context, userID uuid.UUID, cfg AgentConfig) error {
	tools := dedupeStrings(cfg.ToolsEnabled)
	if tools == nil {
		// A nil slice would be written as SQL NULL, and the column is NOT
		// NULL. An empty list is a legitimate choice — every tool off — so
		// it has to reach the database as '{}', not as an error.
		tools = []string{}
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO user_agent_config (user_id, system_prompt, tools_enabled)
		VALUES ($1,$2,$3)
		ON CONFLICT (user_id) DO UPDATE
		SET system_prompt = EXCLUDED.system_prompt,
		    tools_enabled = EXCLUDED.tools_enabled,
		    updated_at = now()`, userID, cfg.SystemPrompt, tools)
	if err != nil {
		return fmt.Errorf("ai: save agent config for user %s: %w", userID, err)
	}
	return nil
}

// UsageEntry is one ai_usage row as GET /ai/credits reports it.
//
// cost_micro is deliberately ABSENT. That column is what the platform paid
// DeepSeek and Brave; credits_charged is what the learner paid the platform.
// The gap between them is the margin, and Pha 4 is where it gets set (spec
// §10.1). Publishing it on a learner-facing endpoint would put the
// platform's cost basis in every browser that opens the settings screen.
type UsageEntry struct {
	At             time.Time
	Model          string
	InTokens       int
	CachedInTokens int
	OutTokens      int
	ToolCalls      int
	WebSearches    int
	CreditsCharged int64
}

// RecentUsage returns userID's most recent ledger rows, newest first, at
// most limit of them.
//
// The WHERE clause is the whole security property of this method, and the
// index ai_usage_user_at (migration 0007) is (user_id, at DESC) precisely
// so that filter is the cheap path rather than a temptation to drop.
// TestGetCreditsShowsOnlyTheCallersBalanceAndLedger (handler_test.go) seeds
// a second learner's row specifically so a missing WHERE stops being
// invisible.
func (s *Service) RecentUsage(ctx context.Context, userID uuid.UUID, limit int) ([]UsageEntry, error) {
	if limit <= 0 {
		limit = 1
	}
	rows, err := s.pool.Query(ctx, `
		SELECT at, model, in_tokens, cached_in_tokens, out_tokens, tool_calls,
		       web_searches, credits_charged
		FROM ai_usage WHERE user_id = $1 ORDER BY at DESC, id DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("ai: recent usage for user %s: %w", userID, err)
	}
	defer rows.Close()

	// Never nil: an empty ledger must serialize as [] rather than null, the
	// same rule internal/catalog's handler already keeps for its arrays.
	out := make([]UsageEntry, 0, limit)
	for rows.Next() {
		var e UsageEntry
		if err := rows.Scan(&e.At, &e.Model, &e.InTokens, &e.CachedInTokens, &e.OutTokens,
			&e.ToolCalls, &e.WebSearches, &e.CreditsCharged); err != nil {
			return nil, fmt.Errorf("ai: recent usage scan for user %s: %w", userID, err)
		}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ai: recent usage rows for user %s: %w", userID, err)
	}
	return out, nil
}

// dedupeStrings keeps the FIRST occurrence of each value and preserves
// order. Order matters and is not cosmetic: enabledTools (agent.go) walks
// this list to build Request.Tools, and DeepSeek's prompt cache matches by
// PREFIX — a set that reshuffles between turns costs cache hits that are
// 30-60x cheaper than misses (docs/deepseek-measured.md §1/§5).
func dedupeStrings(in []string) []string {
	if len(in) == 0 {
		return in
	}
	seen := make(map[string]bool, len(in))
	out := make([]string, 0, len(in))
	for _, s := range in {
		if seen[s] {
			continue
		}
		seen[s] = true
		out = append(out, s)
	}
	return out
}

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
//
// Task 17 adds a sixth table this file speaks: admin_audit (migration
// 0005_published_catalog, not 0007 — it predates this package and already
// belongs to internal/catalog's own admin writes; this file only INSERTs
// into it, it does not own its schema). Every method in the block near the
// bottom of this file (ListUsers, GetUser, AdjustCredit, ListPricing,
// UpdatePricing, RecentCreditAdjustments, UpdateSettings) exists
// for the two CMS screens spec §7 names ("Người dùng & credit", "Bảng giá &
// prompt nền"), and AdjustCredit/UpdatePricing/UpdateSettings keep
// the SAME one-transaction discipline the paragraph above states for
// ChargeTurn — a balance or a rate that moved with no matching admin_audit
// row is the identical failure shape one table over.
package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
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
	//
	// The error return is ErrChargeOverflow and nothing else (cost.go): a
	// pricing row whose rates make this turn's cost unrepresentable in an
	// int64. Refused HERE, before Begin, so no transaction is opened and no
	// half-written row exists — and, more to the point, so a wrapped
	// negative number never reaches `balance_micro - $2`. Before this check
	// existed the wrapped value DID reach Postgres and was rejected by
	// ai_usage_cost_micro_check as an anonymous 23514, which read in the log
	// as "the database refused something" rather than "this ai_pricing row
	// is impossible".
	costMicro, credits, err := Charge(r.Usage, pricing, r.WebSearches, settings)
	if err != nil {
		return 0, fmt.Errorf("ai: charge turn for user %s (model=%s): %w", userID, model, err)
	}

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
// the project owner changes this number from the CMS (PUT
// /admin/ai/settings, AdminUpdateSettings) and expects it to take effect
// without a deploy; caching or hardcoding it would mean a changed setting
// only applies to accounts that register after the NEXT deploy, silently
// contradicting that expectation.
//
// That sentence used to be FALSE, and the falseness was the bug. Until the
// whole-branch review fix round (A1), no route, CMS screen or CLI could
// write signup_grant_micro at all — AdminUpdateSettings accepted
// base_system_prompt and nothing else, and the only writer in the whole
// repo was a raw SQL UPDATE inside scripts/test-e2e.sh, for its own
// throwaway stack. The column sat at its 0 DEFAULT (migration 0007), so
// every new account was created with a zero balance and got a 402 on its
// very first question. Migration 0008 seeds the value and backfills the
// accounts that predate 0007; this comment now describes a path that
// exists.
//
// WHAT THIS METHOD DOES NOT LEAVE BEHIND (whole-branch review, F3 — read
// before assuming there is a ledger here). This is the ONE path in the
// system that creates credit without writing a row anywhere except
// ai_credits itself: no admin_audit entry (there is no operator — the
// learner registered), and no ai_usage row (that table is a SPEND ledger,
// with CHECK (credits_charged >= 0), so a grant cannot be expressed in it).
// It was harmless while the grant was 0; it stopped being harmless the
// moment 0008 made it non-zero.
//
// The decision taken, and why: DO NOT write a per-registration audit row.
// admin_audit is the operator-action table — its `who` column is a
// foreign key to the human who acted, and a self-registration has no such
// human — so one row per signup would grow it without bound with entries
// that name nobody, burying the operator actions it exists to make
// findable. What IS made traceable instead is the MINT RATE over time:
// every change to signup_grant_micro writes an 'ai.settings.signup_grant'
// row carrying the amount (UpdateSettings, below), and migration 0008
// writes the same row for the INITIAL value so the timeline has no gap at
// its start. Any account's grant is therefore reconstructable by reading
// users.created_at against that timeline. The residual gap — no per-account
// record of the mint EVENT, only of the rate in force — is recorded as a
// named debt rather than papered over here.
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

// ═══════════════════════════════════════════════════════════════════════
// Task 17 — the "Người dùng & credit" and "Bảng giá & prompt nền" CMS
// screens (spec §7). Every method below is reachable ONLY behind
// auth.Require + auth.RequireAdmin (server.go's "/admin/ai" group) — this
// file has no opinion about who is allowed to call it, the same split
// ChargeTurn/SaveAgentConfig already keep with their own callers. HTTP-layer
// validation (empty note, zero delta, negative rate, empty base prompt)
// lives in admin_handler.go, not here — PutConfig's own doc comment states
// the reason this split exists and it applies unchanged to every method
// below.
// ═══════════════════════════════════════════════════════════════════════

// ErrUserNotFound is returned by GetUser/AdjustCredit when the target id
// names no row in users — a different failure than ErrInsufficientCredit
// (a real account with too little money): this one names an account that
// does not exist at all, e.g. an operator following a stale link to a
// deleted account, or a typo'd id.
var ErrUserNotFound = errors.New("ai: user not found")

// ErrPricingModelNotFound is returned by UpdatePricing when model names no
// row in ai_pricing. UpdatePricing is deliberately an UPDATE, never an
// upsert — see its own doc comment for why silently creating a row for an
// unknown model would be worse than refusing the request.
var ErrPricingModelNotFound = errors.New("ai: pricing model not found")

// AdminUser is one row of GET /admin/ai/users — a learner the way the
// "Người dùng & credit" screen needs to see them: identity plus their
// current AI balance. It carries nothing from ai_usage (the spend ledger)
// or admin_audit (the adjustment history) — those are separate calls
// (RecentUsage, RecentCreditAdjustments) that GetUser below combines for
// ONE learner; listing every learner's ledger on the search screen would be
// an expensive query nobody asked for.
type AdminUser struct {
	ID           uuid.UUID
	Email        string
	Role         string
	BalanceMicro int64
}

// escapeLikePattern backslash-escapes the three characters that are
// meaningful inside a Postgres LIKE pattern — the backslash itself, '%',
// and '_' — so a caller-supplied search string is matched LITERALLY.
// Paired with ListUsers's own `ESCAPE '\\'` clause; the two must agree on
// the escape character or this is a no-op that LOOKS like a fix.
func escapeLikePattern(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

// adminUserListLimit bounds ListUsers — an operator's search box, not a
// full export. 50 is generous for "type a few letters of an email, see who
// matches" and cheap for the database; a deployment that needs to page past
// it needs a different screen (Pha 4's billing reconciliation names one),
// not a wider LIMIT here.
const adminUserListLimit = 50

// ListUsers returns up to adminUserListLimit users, optionally filtered by
// an email substring, ordered by email. query == "" returns the first
// adminUserListLimit accounts alphabetically — not "every user", the same
// bounded-by-default posture RecentUsage already takes with its own limit.
//
// query is matched with a SQL LIKE against users.email, which is citext
// (migration 0001_init) and therefore ALREADY case-insensitive — no ILIKE
// needed.
//
// escapeLikePattern (below) IS applied — round-2 review corrected this
// comment after finding the previous version argued escaping away as "a UX
// quirk, not a security hole" and stopped there. That argument is true as
// far as it goes (this sits behind auth.RequireAdmin, so nothing about
// injection is at stake), but it missed the actual failure this screen
// cares about: '_' is SQL LIKE's single-character wildcard AND a character
// that appears constantly in real email addresses (firstname_lastname@…).
// On the ONE screen whose named risk is "topping up the WRONG person",
// searching "nguyen_van_a@…" matching a DIFFERENT account whose email
// merely has some other character in that position is exactly the kind of
// silent near-miss that risk is about — an operator who typed a real,
// specific email and got back a result they trusted. Escaping is cheap and
// removes that failure mode entirely.
func (s *Service) ListUsers(ctx context.Context, query string) ([]AdminUser, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.email, u.role, COALESCE(c.balance_micro, 0)
		FROM users u LEFT JOIN ai_credits c ON c.user_id = u.id
		WHERE $1 = '' OR u.email LIKE '%' || $1 || '%' ESCAPE '\'
		ORDER BY u.email
		LIMIT $2`, escapeLikePattern(query), adminUserListLimit)
	if err != nil {
		// query is deliberately NOT interpolated into this error: it is
		// operator-typed search text that may contain a fragment of a real
		// learner's email, and this error reaches slog verbatim via
		// h.internal (handler.go) on a 500 — the same "never let a
		// user-supplied string ride an error into the log" discipline
		// apilog.go's own package doc states for annotations.note and
		// credentials. The op name in h.internal's own log line ("ai.
		// AdminListUsers") is enough to find this call site without it.
		return nil, fmt.Errorf("ai: list users: %w", err)
	}
	defer rows.Close()

	out := make([]AdminUser, 0, adminUserListLimit)
	for rows.Next() {
		var u AdminUser
		if err := rows.Scan(&u.ID, &u.Email, &u.Role, &u.BalanceMicro); err != nil {
			return nil, fmt.Errorf("ai: list users scan: %w", err)
		}
		out = append(out, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ai: list users rows: %w", err)
	}
	return out, nil
}

// GetUser reads one learner's identity and current balance, or
// ErrUserNotFound. Balance's own ErrNoRows-tolerant fallback (a learner who
// predates the signup grant, or whose grant was zero) is reproduced here
// rather than reused as-is, because THIS caller must still tell "no such
// user" apart from "a real user with nothing in ai_credits yet" — Balance
// alone only answers the second question.
func (s *Service) GetUser(ctx context.Context, userID uuid.UUID) (AdminUser, error) {
	u := AdminUser{ID: userID}
	err := s.pool.QueryRow(ctx,
		`SELECT email, role FROM users WHERE id = $1`, userID).Scan(&u.Email, &u.Role)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AdminUser{}, ErrUserNotFound
		}
		return AdminUser{}, fmt.Errorf("ai: get user %s: %w", userID, err)
	}

	balance, err := s.Balance(ctx, userID)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return AdminUser{}, err
		}
		balance = 0
	}
	u.BalanceMicro = balance
	return u, nil
}

// adminActionCreditAdjust is admin_audit.action's fixed value for every row
// AdjustCredit writes — RecentCreditAdjustments below filters on this exact
// string, so the two must never drift apart.
const adminActionCreditAdjust = "ai.credit.adjust"

// CreditAdjustment is one manual balance change an operator made through
// POST /admin/ai/users/:id/credit, read back from admin_audit — the same
// append-only table AdjustCredit writes into, never a second ledger of its
// own. This IS the trail spec §7's "sổ cái thao tác, không xoá" promises
// for the single most dangerous write in this screen: which admin moved
// this account's balance, when, by how much, and why (Note carries the
// signed amount AND the operator's own words — see AdjustCredit's doc
// comment for the exact format).
type CreditAdjustment struct {
	At   time.Time
	Who  *uuid.UUID
	Note string
}

// adminAuditListLimit bounds RecentCreditAdjustments the same way
// recentUsageLimit (handler.go) bounds RecentUsage — a detail screen, not a
// report.
const adminAuditListLimit = 20

// RecentCreditAdjustments returns userID's most recent manual credit
// changes, newest first — the ONE place an operator can see "has this
// account already been topped up, and why" before adding another
// adjustment on top of it, which is the closest this screen comes to a
// defense against topping up the same person twice by accident.
func (s *Service) RecentCreditAdjustments(ctx context.Context, userID uuid.UUID) ([]CreditAdjustment, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT who, at, note FROM admin_audit
		WHERE action = $1 AND target = $2
		ORDER BY at DESC, id DESC LIMIT $3`,
		adminActionCreditAdjust, userID.String(), adminAuditListLimit)
	if err != nil {
		return nil, fmt.Errorf("ai: recent credit adjustments for user %s: %w", userID, err)
	}
	defer rows.Close()

	out := make([]CreditAdjustment, 0, adminAuditListLimit)
	for rows.Next() {
		var a CreditAdjustment
		if err := rows.Scan(&a.Who, &a.At, &a.Note); err != nil {
			return nil, fmt.Errorf("ai: recent credit adjustments scan for user %s: %w", userID, err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ai: recent credit adjustments rows for user %s: %w", userID, err)
	}
	return out, nil
}

// AdjustCredit is the one function behind spec §7's "cộng/trừ credit tay":
// it moves userID's balance_micro by deltaMicro (positive credits the
// account, negative debits it) and writes the admin_audit row IN ONE
// TRANSACTION — the same shape ChargeTurn already keeps, and for the same
// reason: an unexplained balance change and an audit row with no matching
// change are both worse than a failed request.
//
// It validates NOTHING about deltaMicro or note being non-zero/non-empty —
// that is admin_handler.go's AdminAdjustCredit's job, at the HTTP boundary,
// the same split PutConfig documents for user_agent_config. note here is
// assumed to already be the FULL text to store, including the signed
// amount AdminAdjustCredit prefixes onto the operator's own words (e.g.
// "+500000 micro-credit: refund for double charge") — this method does not
// reconstruct that format from deltaMicro, so the two must be kept in sync
// by the caller, not by magic here.
//
// The UPSERT (INSERT ... ON CONFLICT DO UPDATE) is deliberate, not
// something the caller is expected to have avoided by checking first: a
// learner who predates this feature, or whose signup grant was zero, has
// no ai_credits row yet (the same gap Balance's and EnsureCredit's own doc
// comments describe), and an operator correcting THAT account must not
// need a separate "does this user have a row" branch — deltaMicro simply
// becomes the opening balance on a first-time upsert.
func (s *Service) AdjustCredit(ctx context.Context, actorID, targetID uuid.UUID, deltaMicro int64, note string) (int64, error) {
	var exists bool
	if err := s.pool.QueryRow(ctx,
		`SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, targetID).Scan(&exists); err != nil {
		return 0, fmt.Errorf("ai: adjust credit: check user %s exists: %w", targetID, err)
	}
	if !exists {
		return 0, ErrUserNotFound
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("ai: adjust credit begin tx for user %s: %w", targetID, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var newBalance int64
	err = tx.QueryRow(ctx, `
		INSERT INTO ai_credits (user_id, balance_micro) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE
		SET balance_micro = ai_credits.balance_micro + EXCLUDED.balance_micro, updated_at = now()
		RETURNING balance_micro`, targetID, deltaMicro).Scan(&newBalance)
	if err != nil {
		return 0, fmt.Errorf("ai: adjust credit upsert for user %s: %w", targetID, err)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO admin_audit (who, actor, action, target, note) VALUES ($1, 'user', $2, $3, $4)`,
		actorID, adminActionCreditAdjust, targetID.String(), note); err != nil {
		return 0, fmt.Errorf("ai: adjust credit audit for user %s: %w", targetID, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("ai: adjust credit commit for user %s: %w", targetID, err)
	}
	return newBalance, nil
}

// ListPricing returns every ai_pricing row, ordered by model — the whole
// "bảng quy đổi credit" the CMS's "Bảng giá & prompt nền" screen edits.
func (s *Service) ListPricing(ctx context.Context) ([]Pricing, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT model, cost_micro_per_1k_in, cost_micro_per_1k_cached_in, cost_micro_per_1k_out,
		       credits_per_1k_in, credits_per_1k_cached_in, credits_per_1k_out, updated_at
		FROM ai_pricing ORDER BY model`)
	if err != nil {
		return nil, fmt.Errorf("ai: list pricing: %w", err)
	}
	defer rows.Close()

	out := []Pricing{}
	for rows.Next() {
		var p Pricing
		if err := rows.Scan(&p.Model, &p.CostMicroPer1kIn, &p.CostMicroPer1kCachedIn, &p.CostMicroPer1kOut,
			&p.CreditsPer1kIn, &p.CreditsPer1kCachedIn, &p.CreditsPer1kOut, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("ai: list pricing scan: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ai: list pricing rows: %w", err)
	}
	return out, nil
}

// adminActionPricingUpdate is admin_audit.action's fixed value for every
// row UpdatePricing writes.
const adminActionPricingUpdate = "ai.pricing.update"

// UpdatePricing overwrites model's six rates and writes the audit row in
// one transaction, returning the row as stored. It is an UPDATE, never an
// upsert: ErrPricingModelNotFound's own doc comment says why a typo'd
// model must fail loudly rather than quietly create a row nothing will
// ever charge against — ai_pricing's rows are keyed on model names this
// package's own Go code names (DefaultModel and its sibling), not on
// anything an operator types freely.
//
// Every future ChargeTurn call reads this row FRESH: pricing (above) has
// never cached it. That absence of a cache is the entire mechanism behind
// spec §3.4's "đổi giá không cần deploy" — there is nothing for this method
// to invalidate and nothing to restart, only a COMMIT here and a SELECT on
// the very next turn.
func (s *Service) UpdatePricing(ctx context.Context, actorID uuid.UUID, model string, p Pricing, note string) (Pricing, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Pricing{}, fmt.Errorf("ai: update pricing begin tx (model=%s): %w", model, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var out Pricing
	err = tx.QueryRow(ctx, `
		UPDATE ai_pricing
		SET cost_micro_per_1k_in=$2, cost_micro_per_1k_cached_in=$3, cost_micro_per_1k_out=$4,
		    credits_per_1k_in=$5, credits_per_1k_cached_in=$6, credits_per_1k_out=$7, updated_at=now()
		WHERE model = $1
		RETURNING model, cost_micro_per_1k_in, cost_micro_per_1k_cached_in, cost_micro_per_1k_out,
		          credits_per_1k_in, credits_per_1k_cached_in, credits_per_1k_out, updated_at`,
		model, p.CostMicroPer1kIn, p.CostMicroPer1kCachedIn, p.CostMicroPer1kOut,
		p.CreditsPer1kIn, p.CreditsPer1kCachedIn, p.CreditsPer1kOut).
		Scan(&out.Model, &out.CostMicroPer1kIn, &out.CostMicroPer1kCachedIn, &out.CostMicroPer1kOut,
			&out.CreditsPer1kIn, &out.CreditsPer1kCachedIn, &out.CreditsPer1kOut, &out.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Pricing{}, ErrPricingModelNotFound
		}
		return Pricing{}, fmt.Errorf("ai: update pricing (model=%s): %w", model, err)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO admin_audit (who, actor, action, target, note) VALUES ($1, 'user', $2, $3, $4)`,
		actorID, adminActionPricingUpdate, model, note); err != nil {
		return Pricing{}, fmt.Errorf("ai: update pricing audit (model=%s): %w", model, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Pricing{}, fmt.Errorf("ai: update pricing commit (model=%s): %w", model, err)
	}
	return out, nil
}

// adminActionBasePromptUpdate and adminActionSignupGrantUpdate are
// admin_audit.action's fixed values for the two columns UpdateSettings
// writes. They are SEPARATE actions, not one "settings updated" action with
// the detail buried in the note: an operator asking "who changed the
// welcome grant, and when" must be able to filter on that alone, the same
// way RecentCreditAdjustments filters on adminActionCreditAdjust.
const (
	adminActionBasePromptUpdate  = "ai.settings.base_prompt"
	adminActionSignupGrantUpdate = "ai.settings.signup_grant"
)

// adminSettingsAuditTarget is admin_audit.target for ai_settings edits.
// ai_settings has no natural id of its own (its CHECK(id) enforces exactly
// one row — migration 0007's own comment), so this fixed string names the
// row the way a real id would name any other target.
const adminSettingsAuditTarget = "ai_settings"

// UpdateSettings overwrites ai_settings.base_system_prompt, optionally
// overwrites ai_settings.signup_grant_micro, and writes one audit row PER
// COLUMN ACTUALLY WRITTEN — all in ONE transaction — then returns the
// settings row as stored (a fresh read, not an echo — SaveAgentConfig's own
// doc comment explains why a caller should see what was actually written).
//
// ONE TRANSACTION, not two calls: the two columns can move in the same
// request, and a base prompt that committed while the grant did not (or the
// reverse) would leave the operator looking at a screen that half-took. It
// is the same shape ChargeTurn and AdjustCredit already keep, for the same
// reason.
//
// signupGrantMicro is a POINTER and nil means DO NOT TOUCH — not "set it to
// zero". See updateSettingsRequest's own comment (admin_handler.go) for the
// concrete regression a plain int64 would cause here. When it is nil, no
// signup-grant audit row is written either: an audit trail that records
// changes that did not happen is worse than none, because it teaches the
// reader to ignore it.
//
// It validates NOTHING about basePrompt except by what it refuses to do:
// there is no path through this method that clears the column to an empty
// string, because there is no caller-supplied "clear it" branch at all —
// admin_handler.go's AdminUpdateSettings refuses an empty/whitespace-only
// value before this method is ever invoked. The base prompt is BOTH the
// platform's tutor persona and its safety boundary (spec §3.3: a learner's
// own user_agent_config.system_prompt is APPENDED AFTER it, never a
// replacement), so "empty" here is not a smaller version of the prompt, it
// is every learner's safety boundary gone. signupGrantMicro's own range is
// checked at the same boundary, against MaxSignupGrantMicro.
func (s *Service) UpdateSettings(ctx context.Context, actorID uuid.UUID, basePrompt string, signupGrantMicro *int64, note string) (Settings, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Settings{}, fmt.Errorf("ai: update settings begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx,
		`UPDATE ai_settings SET base_system_prompt = $1, updated_at = now()`, basePrompt); err != nil {
		return Settings{}, fmt.Errorf("ai: update base prompt: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO admin_audit (who, actor, action, target, note) VALUES ($1, 'user', $2, $3, $4)`,
		actorID, adminActionBasePromptUpdate, adminSettingsAuditTarget, note); err != nil {
		return Settings{}, fmt.Errorf("ai: update base prompt audit: %w", err)
	}

	if signupGrantMicro != nil {
		if _, err := tx.Exec(ctx,
			`UPDATE ai_settings SET signup_grant_micro = $1, updated_at = now()`, *signupGrantMicro); err != nil {
			return Settings{}, fmt.Errorf("ai: update signup grant: %w", err)
		}
		// The AMOUNT is baked into the stored note, the same way
		// AdminAdjustCredit bakes the signed delta into its own: admin_audit
		// has no numeric column of its own (migration 0005's schema), so
		// this is the one place the number and the operator's reason travel
		// together into the one column that exists. Without it the trail
		// reads "somebody changed the welcome grant" with no way to tell
		// 50,000 from 50,000,000.
		grantNote := fmt.Sprintf("signup_grant_micro set to %d: %s", *signupGrantMicro, note)
		if _, err := tx.Exec(ctx,
			`INSERT INTO admin_audit (who, actor, action, target, note) VALUES ($1, 'user', $2, $3, $4)`,
			actorID, adminActionSignupGrantUpdate, adminSettingsAuditTarget, grantNote); err != nil {
			return Settings{}, fmt.Errorf("ai: update signup grant audit: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Settings{}, fmt.Errorf("ai: update settings commit: %w", err)
	}

	return s.settings(ctx)
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

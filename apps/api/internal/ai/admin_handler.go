// admin_handler.go is the HTTP layer for the two CMS screens Task 17 adds
// (spec §7): "Người dùng & credit" and "Bảng giá & prompt nền". Every
// handler below is a method on the SAME Handler type handler.go already
// defines — there is no second "AdminHandler" struct — because every one
// of them needs exactly the SQL access (h.credits) and the "who is
// calling" plumbing (h.userID / h.caller / fail / h.internal) the three
// learner-facing routes already have wired. Splitting into a second type
// would mean building a second, equivalent constructor over the same
// dependencies for no reason beyond "these routes are for admins" — the
// admin/learner distinction is enforced by server.go's route wiring (Task
// 8's own auth.Require + auth.RequireAdmin pair, no adminOrToken: unlike
// `tuhoc publish`, no CLI tool needs a shared-token door onto these
// routes), not by which Go type answers the request.
//
// Every write below (AdminAdjustCredit, AdminUpdatePricing,
// AdminUpdateSettings) validates its request HERE, before calling into
// credits.go, and credits.go's own methods trust what they are given —
// the same split PutConfig documents for user_agent_config, applied to
// three new endpoints instead of one.
package ai

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

// MaxAdminCreditAdjustmentMicro bounds ONE manual credit adjustment
// (POST /admin/ai/users/:id/credit).
//
// This is a decision task-17-brief.md leaves to whoever implements it,
// made explicit here: 100,000 credits (100_000_000_000 micro-credit) per
// adjustment is comfortably above anything a real top-up or correction
// needs — spec §5's preset credit packs are described as "a few sensible
// tiers", not six-figure sums — while still catching the shape of mistake
// this ceiling exists for: a fat-fingered extra zero (or three) turning a
// 10-credit correction into a number that reads as an obvious typo to
// anyone who looks at the ledger afterward. It is NOT a defense against a
// malicious admin — an admin account can already move arbitrary money by
// repeating a smaller adjustment — it only backstops a slip of the
// keyboard, the same class of bug cost.go's divUp comment protects against
// from the opposite direction (rounding a charge DOWN to zero).
const MaxAdminCreditAdjustmentMicro int64 = 100_000_000_000

// MaxBasePromptChars caps ai_settings.base_system_prompt, in CHARACTERS —
// see MaxSystemPromptChars (handler.go) for why runes, not bytes, matter on
// a bilingual platform (spec §4.2). Five times MaxSystemPromptChars's own
// 4000: the base prompt carries the platform's whole tutor persona and
// safety boundary (spec §3.3), a longer document than any one learner's
// personal addendum, but still a bounded one — an operator who needs more
// than 20,000 characters of instructions is building something this single
// text field was never meant to hold.
const MaxBasePromptChars = 20000

// CodeNotFound and CodeAmountOutOfRange are two admin-route-only codes,
// alongside the shared block in handler.go. Neither existing code fits
// either case: CodeNotFound names "the id in the path matches nothing" (a
// user, or a pricing model) — none of the three learner routes above ever
// look something up BY ID, so this code never had a reason to exist before
// this file. CodeAmountOutOfRange names "the number is real but outside
// what this endpoint accepts" — CodeFieldRequired means "missing", not
// "present but too large", and CodeFieldTooLong is about STRING length,
// not a numeric ceiling.
const (
	CodeNotFound         = "NotFound"
	CodeAmountOutOfRange = "AmountOutOfRange"
)

// --- GET /admin/ai/users ----------------------------------------------

// adminUserPayload is one learner on the wire, for both AdminListUsers and
// (embedded) AdminGetUser.
type adminUserPayload struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	Role         string `json:"role"`
	BalanceMicro int64  `json:"balance_micro"`
}

func newAdminUserPayload(u AdminUser) adminUserPayload {
	return adminUserPayload{ID: u.ID.String(), Email: u.Email, Role: u.Role, BalanceMicro: u.BalanceMicro}
}

// AdminListUsers serves GET /admin/ai/users?q=<email substring>: the "tìm
// user" half of spec §7's "Người dùng & credit" screen.
func (h *Handler) AdminListUsers(c *fiber.Ctx) error {
	actorID := h.caller(c)
	if actorID == uuid.Nil {
		return fail(c, fiber.StatusUnauthorized, CodeUnauthenticated, "unauthenticated")
	}

	users, err := h.credits.ListUsers(c.Context(), strings.TrimSpace(c.Query("q")))
	if err != nil {
		return h.internal(c, "ai.AdminListUsers", err)
	}

	// Never null on the wire — same array rule newConfigResponse (handler.go)
	// and internal/catalog's own handler already keep.
	out := make([]adminUserPayload, len(users))
	for i, u := range users {
		out[i] = newAdminUserPayload(u)
	}
	return c.JSON(out)
}

// --- GET /admin/ai/users/:id --------------------------------------------

// creditAdjustmentPayload is one CreditAdjustment on the wire. Who is a
// pointer so a 'cli'-actor row (none exist yet — see credits.go's
// AdjustCredit, which always writes 'user' since there is no token door
// onto these routes — but admin_audit.who is nullable at the schema level
// regardless) serializes as JSON null rather than the zero UUID, which
// would read as a real, if unlikely, account id.
type creditAdjustmentPayload struct {
	At   time.Time `json:"at"`
	Who  *string   `json:"who"`
	Note string    `json:"note"`
}

func newCreditAdjustmentPayload(a CreditAdjustment) creditAdjustmentPayload {
	p := creditAdjustmentPayload{At: a.At, Note: a.Note}
	if a.Who != nil {
		who := a.Who.String()
		p.Who = &who
	}
	return p
}

// adminUserDetailPayload is GET /admin/ai/users/:id's body: identity,
// balance, spend ledger, and manual-adjustment history — everything spec
// §7 lists for this screen ("tìm user, số dư, sổ cái ai_usage") plus the
// adjustment trail this task's own brief asks the implementer to think
// through ("nạp cho sai người thì dấu vết ở đâu").
type adminUserDetailPayload struct {
	adminUserPayload
	RecentUsage       []usageEntryPayload       `json:"recent_usage"`
	RecentAdjustments []creditAdjustmentPayload `json:"recent_adjustments"`
}

// AdminGetUser serves GET /admin/ai/users/:id.
func (h *Handler) AdminGetUser(c *fiber.Ctx) error {
	actorID := h.caller(c)
	if actorID == uuid.Nil {
		return fail(c, fiber.StatusUnauthorized, CodeUnauthenticated, "unauthenticated")
	}

	targetID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fail(c, fiber.StatusBadRequest, CodeInvalidBody, "id is not a valid UUID")
	}

	user, err := h.credits.GetUser(c.Context(), targetID)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			return fail(c, fiber.StatusNotFound, CodeNotFound, "no such user")
		}
		return h.internal(c, "ai.AdminGetUser/user", err)
	}

	usage, err := h.credits.RecentUsage(c.Context(), targetID, recentUsageLimit)
	if err != nil {
		return h.internal(c, "ai.AdminGetUser/usage", err)
	}
	adjustments, err := h.credits.RecentCreditAdjustments(c.Context(), targetID)
	if err != nil {
		return h.internal(c, "ai.AdminGetUser/adjustments", err)
	}

	usagePayload := make([]usageEntryPayload, 0, len(usage))
	for _, u := range usage {
		usagePayload = append(usagePayload, usageEntryPayload{
			At: u.At, Model: u.Model, InTokens: u.InTokens, CachedInTokens: u.CachedInTokens,
			OutTokens: u.OutTokens, ToolCalls: u.ToolCalls, WebSearches: u.WebSearches,
			CreditsCharged: u.CreditsCharged,
		})
	}
	adjPayload := make([]creditAdjustmentPayload, 0, len(adjustments))
	for _, a := range adjustments {
		adjPayload = append(adjPayload, newCreditAdjustmentPayload(a))
	}

	return c.JSON(adminUserDetailPayload{
		adminUserPayload:  newAdminUserPayload(user),
		RecentUsage:       usagePayload,
		RecentAdjustments: adjPayload,
	})
}

// --- POST /admin/ai/users/:id/credit ------------------------------------

type adjustCreditRequest struct {
	DeltaMicro int64  `json:"delta_micro"`
	Note       string `json:"note"`
}

type adjustCreditResponse struct {
	BalanceMicro int64 `json:"balance_micro"`
}

// AdminAdjustCredit serves POST /admin/ai/users/:id/credit: spec §7's
// "cộng/trừ credit tay" — task-17-brief.md's own words call this "màn nguy
// hiểm nhất trong cả pha" (the single most dangerous screen in this whole
// phase), and every check below answers one of the questions that brief
// asks the implementer to answer themselves:
//
//   - "double-submit charges twice?" — this handler does not deduplicate
//     requests (no idempotency key): two identical POSTs are two real,
//     independent adjustments, each fully audited (see below). Closing
//     that at the API layer needs a client-supplied idempotency key and a
//     table to remember it in, which is out of scope for this task; the
//     practical mitigation lives in the WEB client instead (AdminCredits.tsx
//     disables the submit control while a request is in flight and clears
//     the amount field on success, so a second click needs a second,
//     deliberate action) — recorded here because a reviewer looking only at
//     this file would otherwise not find where that risk was addressed.
//   - "topped up the WRONG person — where is the trail?" — admin_audit.who
//     (the operator), .target (the affected learner's id), .at, and .note
//     (which ALWAYS carries the signed amount, see below) together are that
//     trail, and RecentCreditAdjustments/AdminGetUser surface it back on
//     the same screen an operator would use to fix their own mistake (a
//     second, negative adjustment with a note explaining why) — admin_audit
//     is never UPDATEd or DELETEd, so the original mistake stays visible
//     next to its correction, not silently overwritten.
//   - "negative numbers?" — deltaMicro < 0 is a legitimate DEBIT (spec §7
//     says "cộng/trừ", add OR subtract) and is accepted; only
//     deltaMicro == 0 is refused, as a no-op that could only be an
//     accidental submit.
//   - "int64 overflow?" — MaxAdminCreditAdjustmentMicro bounds the MAGNITUDE
//     of a single adjustment (see its own doc comment) so no single request
//     can move the needle far enough to matter; the backstop underneath
//     that cap is Postgres's own bigint arithmetic, which raises an error
//     (caught below as an ordinary 500, transaction rolled back) rather
//     than silently wrapping on overflow — this handler adds a sane ceiling
//     on top of a database that already fails closed.
//
// note is BINDING, not advisory: an empty one (after trimming) is refused
// BEFORE anything is touched — h.credits.AdjustCredit below is never
// called — because a balance that moved with no explanation attached is
// indistinguishable, a week later, from a bug.
func (h *Handler) AdminAdjustCredit(c *fiber.Ctx) error {
	actorID := h.caller(c)
	if actorID == uuid.Nil {
		return fail(c, fiber.StatusUnauthorized, CodeUnauthenticated, "unauthenticated")
	}

	targetID, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return fail(c, fiber.StatusBadRequest, CodeInvalidBody, "id is not a valid UUID")
	}

	var req adjustCreditRequest
	if err := c.BodyParser(&req); err != nil {
		return fail(c, fiber.StatusBadRequest, CodeInvalidBody, "request body is not valid JSON")
	}

	note := strings.TrimSpace(req.Note)
	if note == "" {
		return fail(c, fiber.StatusBadRequest, CodeFieldRequired,
			"note is required for a manual credit adjustment")
	}
	if req.DeltaMicro == 0 {
		return fail(c, fiber.StatusBadRequest, CodeFieldRequired, "delta_micro must not be zero")
	}
	if req.DeltaMicro > MaxAdminCreditAdjustmentMicro || req.DeltaMicro < -MaxAdminCreditAdjustmentMicro {
		return fail(c, fiber.StatusBadRequest, CodeAmountOutOfRange,
			fmt.Sprintf("delta_micro must be within +/-%d", MaxAdminCreditAdjustmentMicro))
	}

	// The signed amount is baked into the STORED note, not kept only in
	// delta_micro: admin_audit has no numeric "amount" column of its own
	// (migration 0005_published_catalog's schema, shared with catalog's own
	// publish/unpublish/rollback rows), so this is the one place the amount
	// and the operator's reason travel together into the one column that
	// exists. RecentCreditAdjustments reads this back VERBATIM — it does
	// not reparse the amount out of it — so the format only has to be
	// readable by a human on the CMS screen, never re-parsed by this code.
	stored := fmt.Sprintf("%+d micro-credit: %s", req.DeltaMicro, note)

	newBalance, err := h.credits.AdjustCredit(c.Context(), actorID, targetID, req.DeltaMicro, stored)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			return fail(c, fiber.StatusNotFound, CodeNotFound, "no such user")
		}
		return h.internal(c, "ai.AdminAdjustCredit", err)
	}

	return c.JSON(adjustCreditResponse{BalanceMicro: newBalance})
}

// --- GET /admin/ai/pricing, PUT /admin/ai/pricing/:model -----------------

type pricingPayload struct {
	Model                  string    `json:"model"`
	CostMicroPer1kIn       int64     `json:"cost_micro_per_1k_in"`
	CostMicroPer1kCachedIn int64     `json:"cost_micro_per_1k_cached_in"`
	CostMicroPer1kOut      int64     `json:"cost_micro_per_1k_out"`
	CreditsPer1kIn         int64     `json:"credits_per_1k_in"`
	CreditsPer1kCachedIn   int64     `json:"credits_per_1k_cached_in"`
	CreditsPer1kOut        int64     `json:"credits_per_1k_out"`
	UpdatedAt              time.Time `json:"updated_at"`
}

func newPricingPayload(p Pricing) pricingPayload {
	return pricingPayload{
		Model: p.Model, CostMicroPer1kIn: p.CostMicroPer1kIn, CostMicroPer1kCachedIn: p.CostMicroPer1kCachedIn,
		CostMicroPer1kOut: p.CostMicroPer1kOut, CreditsPer1kIn: p.CreditsPer1kIn,
		CreditsPer1kCachedIn: p.CreditsPer1kCachedIn, CreditsPer1kOut: p.CreditsPer1kOut, UpdatedAt: p.UpdatedAt,
	}
}

// AdminListPricing serves GET /admin/ai/pricing: the whole "bảng quy đổi
// credit" spec §7 names for the "Bảng giá & prompt nền" screen.
func (h *Handler) AdminListPricing(c *fiber.Ctx) error {
	actorID := h.caller(c)
	if actorID == uuid.Nil {
		return fail(c, fiber.StatusUnauthorized, CodeUnauthenticated, "unauthenticated")
	}

	rows, err := h.credits.ListPricing(c.Context())
	if err != nil {
		return h.internal(c, "ai.AdminListPricing", err)
	}
	out := make([]pricingPayload, len(rows))
	for i, r := range rows {
		out[i] = newPricingPayload(r)
	}
	return c.JSON(out)
}

// updatePricingRequest's six rate fields are POINTERS so "absent" is
// distinguishable from "explicitly zero" — same reasoning configRequest
// (handler.go) gives for its own two pointer fields: PUT replaces the
// WHOLE row, so every rate is required, and a plain (non-pointer) field
// left out of the JSON body would otherwise silently zero a rate the
// operator never meant to touch.
type updatePricingRequest struct {
	CostMicroPer1kIn       *int64 `json:"cost_micro_per_1k_in"`
	CostMicroPer1kCachedIn *int64 `json:"cost_micro_per_1k_cached_in"`
	CostMicroPer1kOut      *int64 `json:"cost_micro_per_1k_out"`
	CreditsPer1kIn         *int64 `json:"credits_per_1k_in"`
	CreditsPer1kCachedIn   *int64 `json:"credits_per_1k_cached_in"`
	CreditsPer1kOut        *int64 `json:"credits_per_1k_out"`
	Note                   string `json:"note"`
}

// updatePricingField names one rate for the required/non-negative loop in
// AdminUpdatePricing, paired with the pointer PutConfig-style validation
// reads from.
type updatePricingField struct {
	name string
	val  *int64
}

// AdminUpdatePricing serves PUT /admin/ai/pricing/:model — this is the
// route Step 2 of task-17-brief.md is about: a rate change here must take
// effect on the VERY NEXT turn, with no deploy and no process restart.
// That property is proven in admin_handler_test.go by charging a turn
// TWICE against the same long-lived *Service, with this route called in
// between — see UpdatePricing's own doc comment in credits.go for why the
// absence of any cache is what makes that true.
func (h *Handler) AdminUpdatePricing(c *fiber.Ctx) error {
	actorID := h.caller(c)
	if actorID == uuid.Nil {
		return fail(c, fiber.StatusUnauthorized, CodeUnauthenticated, "unauthenticated")
	}
	model := strings.TrimSpace(c.Params("model"))

	var req updatePricingRequest
	if err := c.BodyParser(&req); err != nil {
		return fail(c, fiber.StatusBadRequest, CodeInvalidBody, "request body is not valid JSON")
	}

	fields := []updatePricingField{
		{"cost_micro_per_1k_in", req.CostMicroPer1kIn},
		{"cost_micro_per_1k_cached_in", req.CostMicroPer1kCachedIn},
		{"cost_micro_per_1k_out", req.CostMicroPer1kOut},
		{"credits_per_1k_in", req.CreditsPer1kIn},
		{"credits_per_1k_cached_in", req.CreditsPer1kCachedIn},
		{"credits_per_1k_out", req.CreditsPer1kOut},
	}
	for _, f := range fields {
		if f.val == nil {
			return fail(c, fiber.StatusBadRequest, CodeFieldRequired, fmt.Sprintf("%s is required", f.name))
		}
		// Mirrors ai_pricing's own CHECK (... >= 0) constraints (migration
		// 0007_ai_credits) — refused here, at the boundary, with a code and
		// an English sentence, rather than left to surface as a raw
		// constraint-violation 500 from Postgres.
		if *f.val < 0 {
			return fail(c, fiber.StatusBadRequest, CodeAmountOutOfRange, fmt.Sprintf("%s must not be negative", f.name))
		}
	}

	note := strings.TrimSpace(req.Note)
	if note == "" {
		note = fmt.Sprintf(
			"rates set to cost_in=%d cost_cached_in=%d cost_out=%d credits_in=%d credits_cached_in=%d credits_out=%d",
			*req.CostMicroPer1kIn, *req.CostMicroPer1kCachedIn, *req.CostMicroPer1kOut,
			*req.CreditsPer1kIn, *req.CreditsPer1kCachedIn, *req.CreditsPer1kOut)
	}

	updated, err := h.credits.UpdatePricing(c.Context(), actorID, model, Pricing{
		CostMicroPer1kIn: *req.CostMicroPer1kIn, CostMicroPer1kCachedIn: *req.CostMicroPer1kCachedIn,
		CostMicroPer1kOut: *req.CostMicroPer1kOut, CreditsPer1kIn: *req.CreditsPer1kIn,
		CreditsPer1kCachedIn: *req.CreditsPer1kCachedIn, CreditsPer1kOut: *req.CreditsPer1kOut,
	}, note)
	if err != nil {
		if errors.Is(err, ErrPricingModelNotFound) {
			return fail(c, fiber.StatusNotFound, CodeNotFound, "no such pricing model")
		}
		return h.internal(c, "ai.AdminUpdatePricing", err)
	}
	return c.JSON(newPricingPayload(updated))
}

// --- GET/PUT /admin/ai/settings ------------------------------------------

// settingsPayload's MaxBasePromptChars mirrors configResponse's own
// max_system_prompt_chars (handler.go): "TRẦN ĐỘ DÀI: SERVER LÀ NGUỒN SỰ
// THẬT DUY NHẤT, KỂ CẢ Ở CLIENT" — AgentConfigPanel.tsx's own doc comment
// states the rule this field exists to keep for the ADMIN side too. It is
// a plain echo of the MaxBasePromptChars constant above, not a second
// number to keep in sync by hand.
type settingsPayload struct {
	BaseSystemPrompt      string `json:"base_system_prompt"`
	CreditsPerWebSearch   int64  `json:"credits_per_web_search"`
	CostMicroPerWebSearch int64  `json:"cost_micro_per_web_search"`
	SignupGrantMicro      int64  `json:"signup_grant_micro"`
	MaxTokensPerTurn      int    `json:"max_tokens_per_turn"`
	MaxToolRoundsPerTurn  int    `json:"max_tool_rounds_per_turn"`
	MaxBasePromptChars    int    `json:"max_base_prompt_chars"`
}

func newSettingsPayload(s Settings) settingsPayload {
	return settingsPayload{
		BaseSystemPrompt: s.BaseSystemPrompt, CreditsPerWebSearch: s.CreditsPerWebSearch,
		CostMicroPerWebSearch: s.CostMicroPerWebSearch, SignupGrantMicro: s.SignupGrantMicro,
		MaxTokensPerTurn: s.MaxTokensPerTurn, MaxToolRoundsPerTurn: s.MaxToolRoundsPerTurn,
		MaxBasePromptChars: MaxBasePromptChars,
	}
}

// AdminGetSettings serves GET /admin/ai/settings: every ai_settings column,
// read-only context for an operator EXCEPT base_system_prompt — the only
// one AdminUpdateSettings below accepts a write for. The other five
// (credits_per_web_search, cost_micro_per_web_search, signup_grant_micro,
// max_tokens_per_turn, max_tool_rounds_per_turn) are shown so an operator
// editing the base prompt can see the rest of the platform's AI
// configuration at a glance; editing THEM is deliberately out of this
// task's scope — spec §7's row for this screen names "bảng quy đổi credit"
// (ai_pricing, the six PER-MODEL rates AdminUpdatePricing edits) and
// "prompt nền" only, not the whole of ai_settings.
func (h *Handler) AdminGetSettings(c *fiber.Ctx) error {
	actorID := h.caller(c)
	if actorID == uuid.Nil {
		return fail(c, fiber.StatusUnauthorized, CodeUnauthenticated, "unauthenticated")
	}

	settings, err := h.credits.Settings(c.Context())
	if err != nil {
		return h.internal(c, "ai.AdminGetSettings", err)
	}
	return c.JSON(newSettingsPayload(settings))
}

// updateSettingsRequest's BaseSystemPrompt is a POINTER for the same reason
// configRequest's fields are (handler.go): "absent" must be distinguishable
// from "the empty string", because the latter is what Step 4 of
// task-17-brief.md's red test sends on purpose, and it must be REFUSED, not
// silently treated the same as "field not sent".
type updateSettingsRequest struct {
	BaseSystemPrompt *string `json:"base_system_prompt"`
	Note             string  `json:"note"`
}

// AdminUpdateSettings serves PUT /admin/ai/settings: spec §7's "sửa system
// prompt nền của agent".
//
// base_system_prompt is REQUIRED and must not be empty (or whitespace-only)
// after trimming — this is task-17-brief.md's Step 4, verbatim: "sửa prompt
// nền không cho xoá rỗng". The base prompt is BOTH the platform's tutor
// persona AND its safety boundary (spec §3.3: a learner's own
// user_agent_config.system_prompt is APPENDED AFTER it, never a
// replacement — see agent.go's buildMessages for where that rule is
// actually enforced), so clearing it to "" would not "reset" the agent to
// some smaller default, it would remove the one thing every learner's
// personal prompt is layered on top of, for every learner at once.
//
// The STORED value is the raw, untrimmed string the operator sent (once
// confirmed non-empty after trimming) — this mirrors PutConfig's own
// choice for user_agent_config.system_prompt: validate that a value is not
// FUNCTIONALLY empty, but do not silently rewrite what was typed.
func (h *Handler) AdminUpdateSettings(c *fiber.Ctx) error {
	actorID := h.caller(c)
	if actorID == uuid.Nil {
		return fail(c, fiber.StatusUnauthorized, CodeUnauthenticated, "unauthenticated")
	}

	var req updateSettingsRequest
	if err := c.BodyParser(&req); err != nil {
		return fail(c, fiber.StatusBadRequest, CodeInvalidBody, "request body is not valid JSON")
	}
	if req.BaseSystemPrompt == nil {
		return fail(c, fiber.StatusBadRequest, CodeFieldRequired, "base_system_prompt is required")
	}
	basePrompt := *req.BaseSystemPrompt
	if strings.TrimSpace(basePrompt) == "" {
		return fail(c, fiber.StatusBadRequest, CodeFieldRequired,
			"base_system_prompt must not be empty — it is the agent's safety boundary, not an optional field")
	}
	if utf8.RuneCountInString(basePrompt) > MaxBasePromptChars {
		return fail(c, fiber.StatusBadRequest, CodeFieldTooLong,
			fmt.Sprintf("base_system_prompt is longer than %d characters", MaxBasePromptChars))
	}

	note := strings.TrimSpace(req.Note)
	if note == "" {
		note = "base system prompt updated"
	}

	updated, err := h.credits.UpdateBaseSystemPrompt(c.Context(), actorID, basePrompt, note)
	if err != nil {
		return h.internal(c, "ai.AdminUpdateSettings", err)
	}
	return c.JSON(newSettingsPayload(updated))
}

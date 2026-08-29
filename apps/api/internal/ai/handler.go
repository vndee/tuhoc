// handler.go is where every piece the ten tasks before it built gets joined
// into three routes: POST /ai/chat (SSE), GET /ai/credits, GET/PUT
// /ai/config. Nothing in this file is new machinery — the client, the agent
// loop, the streaming reader, the two tools, the ledger, and the rate
// limiter all already exist. What is new is the ORDER they run in, and that
// order is where this task's whole risk lives.
//
// NINE THINGS THIS FILE HAS TO KEEP RIGHT. Each one is a real defect a
// previous review found in the piece it belongs to, deferred here because
// here is the only place it can be fixed:
//
//  1. ChargeTurn runs EVEN WHEN RunStream returns an error. Result carries
//     accumulated Usage on the error path too (agent.go's doc comment on
//     Run, "HỢP ĐỒNG usage-trên-đường-lỗi"): DeepSeek has already been paid
//     for those tokens. The Go reflex `res, err := ...; if err != nil {
//     return err }` gives them away for free. See streamTurn below, where
//     the charge is in a deferred-style tail that BOTH paths reach.
//  2. Turn.History is never built from the request body, and this file's
//     request struct has no field that could carry one. buildMessages
//     (agent.go) filters Role but not ToolCalls/ToolCallID, and its
//     whitelist admits "tool" and "assistant" — so a body-supplied history
//     lets a client forge "the course tool returned X". The only
//     trustworthy source would be a server-side transcript, and Pha 2 has
//     no table for one. See chatRequest.
//  3. EnsureCredit is a bare read with no reservation, so two concurrent
//     turns both pass at balance 1. This file narrows that window rather
//     than closing it — see the rate limiter's role in Chat — and the
//     remainder is recorded as debt, not silently assumed away.
//  4. A turn gets a deadline HERE. stream.go's 20-minute budget is
//     PER ROUND; six rounds is two hours. See DefaultTurnTimeout.
//  5. Only the streaming path is used. Run's 90-second wall clock and
//     RunStream's idle/total watchdogs are different policies; mixing them
//     per request would make two learners' identical questions time out
//     differently. /ai/chat is SSE, so it is RunStream, always.
//  6. Complete refuses Request.Stream == true. Nothing here sets it: this
//     file never builds a Request at all, RunStream does.
//  7. The *http.Client handed to New must carry NO Timeout, because
//     http.Client.Timeout is a TOTAL bound including body reads and would
//     silently re-impose the flat cutoff CompleteStream's watchdogs exist
//     to replace. NewProviderClient below is the wiring's only door, and it
//     closes that one by not having a parameter for it.
//  8. A tool is registered under the key agent.go DISPATCHES on, which must
//     equal the name the model SEES. Two independent strings; a mismatch
//     produces a tool that is advertised and then never runs, with no
//     error. registerTool takes the key from Definition() so the two cannot
//     disagree.
//  9. NewSearchTool's "N per turn" budget lives on the instance for the
//     instance's whole life. TurnTools is called PER REQUEST for exactly
//     that reason.
package ai

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ToolNameReadCourse and ToolNameWebSearch are the names the two shipped
// tools answer to. They are declared here, not next to each tool, because
// this file needs them for three separate jobs that must agree: registering
// the runners (TurnTools), validating what PUT /ai/config will store, and
// telling the settings screen what exists (GET /ai/config's
// available_tools).
//
// The values are not free choices. ToolNameReadCourse must equal
// courseTool.Definition().Function.Name (tool_course.go), ToolNameWebSearch
// must equal searchTool's (tool_search.go) AND agent.go's unexported
// webSearchToolName, which is what decides whether the per-search surcharge
// is billed at all. TestTurnToolsKeysMatchDefinitionNames pins the first
// two; the surcharge assertion in
// "POST /ai/chat runs a tool, charges the surcharge" pins the third
// behaviorally, by showing the money actually move.
const (
	ToolNameReadCourse = "read_course"
	ToolNameWebSearch  = "web_search"
)

// KnownToolNames is every tool name the platform will accept in
// user_agent_config.tools_enabled, in a stable order.
//
// "Known" is deliberately not "currently available". A deployment with no
// BRAVE_API_KEY registers no web_search runner (TurnTools), but a learner
// who switched the tool on last month must not have their saved preference
// rejected as a bad name and silently rewritten the next time they open the
// settings screen — the preference is durable, the wiring is not. A name
// enabled but not registered is simply never advertised to the model
// (enabledTools, agent.go, skips it), which is the correct behavior for
// "this tool is off right now".
func KnownToolNames() []string {
	return []string{ToolNameReadCourse, ToolNameWebSearch}
}

// MaxSystemPromptChars caps user_agent_config.system_prompt, in CHARACTERS
// (runes), not bytes.
//
// Why a cap at all: the personal prompt is prepended to EVERY later turn,
// so an unbounded one is a bill the learner pays forever for a single paste.
// 4000 characters is the number task-11-brief.md fixes.
//
// Why runes: a byte cap would give an English prompt the full allowance and
// a Vietnamese one roughly a third of it, for a platform whose whole reader
// interface is bilingual (spec §4.2).
const MaxSystemPromptChars = 4000

// MaxQuestionChars caps one question. Unlike the personal prompt this is
// paid for once, so it is looser — but not unbounded: without it the only
// ceiling is the app's 21 MiB body limit, and a single request could put
// millions of tokens into a prompt whose cost lands on a balance that is
// only checked for being above zero (see debt 3).
const MaxQuestionChars = 8000

// MaxChatBodyBytes and MaxConfigBodyBytes are what server.go mounts
// bodyLimit with, ahead of the session check, so an oversized body is
// refused without spending a pool connection on validating a cookie.
//
// They are byte ceilings for the two rune ceilings above: 8000 and 4000
// characters are at most 4 bytes each, and both bodies also carry a small
// amount of JSON framing. Neither is a substitute for the rune checks — a
// body can be under the byte cap and still hold a prompt over the rune cap,
// and vice versa.
const (
	MaxChatBodyBytes   int64 = 64 << 10
	MaxConfigBodyBytes int64 = 32 << 10
)

// DefaultModel is the model every turn runs on.
//
// It is a constant rather than a request field on purpose: which model runs
// is a COST decision, and a client that could name one could name the
// expensive one on every turn. It is a constant rather than a DB column
// because ai_settings has no column for it and adding one is a migration
// this task does not own — the price table already keys on model, so
// whatever value is here must have an ai_pricing row or ChargeTurn fails
// after the turn already ran (see pricing's doc comment in credits.go).
//
// The plan's own choice, for the reason recorded there: deepseek-v4-pro is
// 4-6x cheaper than the alternative it replaced and the platform sells on
// answer quality. deepseek-v4-flash is seeded in ai_pricing for side work.
const DefaultModel = "deepseek-v4-pro"

// DefaultMaxSearchesPerTurn bounds how many web searches ONE turn may run.
//
// Each one is a surcharge on top of tokens (ai_settings.credits_per_web_
// search) and a call to a second paid provider, so this is the knob that
// stops a single question from quietly costing several times what the
// learner expects. Three is enough for "look it up, then check a second
// source, then one more" and short of a research session.
const DefaultMaxSearchesPerTurn = 3

// DefaultTurnTimeout is the ceiling on ONE TURN — debt 4.
//
// stream.go carries a block titled "PER-ROUND, NOT PER-TURN — READ THIS
// BEFORE SETTING A HANDLER DEADLINE" for this exact moment: its
// streamTotalTimeout of 20 minutes bounds a single round, and with
// ai_settings.max_tool_rounds_per_turn seeded at 6 that is a structural
// ceiling of TWO HOURS per turn — two hours of one goroutine, two
// connections, and (once the turn finally ends) a charge nobody is waiting
// for any more.
//
// Ten minutes, derived rather than picked: the slowest generation rate this
// project has measured is ~20 tokens/second, and ai_settings.
// max_tokens_per_turn is seeded at 8192, so the longest HEALTHY answer round
// is about 6.8 minutes. Tool rounds emit tens of tokens, not thousands, so
// several of them fit in what is left. Ten minutes therefore never cuts a
// long answer that is genuinely progressing, while removing 110 of the 120
// minutes a stuck turn could otherwise hold.
//
// THE COUPLING TO WRITE DOWN: this number is derived from
// max_tokens_per_turn, which lives in a table Task 17's CMS can edit with no
// deploy. Raising that column above ~12000 makes a legitimate answer able to
// outlast this deadline. Whoever raises it has to revisit this constant.
const DefaultTurnTimeout = 10 * time.Minute

// DefaultRateLimitMax and DefaultRateLimitWindow are the first real call
// site RateLimiter.Allow has ever had (ratelimit.go shipped in Task 10 with
// none), so the numbers are decided here.
//
// Ten turns per five minutes, and the reasoning is deliberately about the
// ABUSE shape, not about a comfortable human pace:
//
//   - A turn streams for tens of seconds at least, so ten SEQUENTIAL turns
//     cannot fit in five minutes anyway. This budget is therefore almost
//     invisible to a person and bites precisely on what spec §3.4 names:
//     a script firing turns in parallel or back to back.
//   - It bounds the worst case in money terms. One turn's ceiling is
//     max_tokens_per_turn * max_tool_rounds_per_turn output tokens (8192 x 6
//     = 49152, see Run's doc comment), about 195 000 micro-dollars at the
//     seeded v4-pro output price. Ten of those per five minutes caps one
//     account at roughly $23/hour of provider spend even with an unlimited
//     balance — a number small enough to notice and act on, where an
//     unlimited rate has no bound at all.
//   - It matches the shape already in this repo: /auth/* runs 10 per minute
//     (server.go). Same budget, a five-times-longer window, because a turn
//     is five-times-plus more expensive than a login attempt.
//
// This limit is also the only thing standing between debt 3's TOCTOU window
// and unbounded overspend: EnsureCredit does not reserve, so N concurrent
// turns can all pass at balance 1 and all charge. N is not unbounded, it is
// at most this max per window. That NARROWS the window; it does not close
// it. The real fix is a conditional, atomic deduction (an UPDATE ... WHERE
// balance_micro > 0 that reserves, plus a refund path), which needs
// credits.go changes this task does not own.
const (
	DefaultRateLimitMax    = 10
	DefaultRateLimitWindow = 5 * time.Minute
)

// recentUsageLimit is how many ledger rows GET /ai/credits returns. Enough
// for the settings screen to show "where did my credits go" without turning
// a settings page into a paginated report.
const recentUsageLimit = 20

// chargeTimeout bounds the charge that follows a turn. It is short because
// the work is two statements in one transaction, and it is SEPARATE from the
// turn's own context on purpose: a turn cut off by DefaultTurnTimeout must
// still be billed for what it burned, and charging on the same (already
// expired) context would drop the charge exactly when the turn cost the most.
const chargeTimeout = 15 * time.Second

// Machine-readable failure codes. The web client branches on these to decide
// what to SHOW — Task 13's brief names the distinction that matters most:
// "out of credit" must lead to a top-up prompt and "the provider broke" must
// lead to a retry, and collapsing the two shows "try again later" to someone
// who only needs to pay.
//
// This is a narrow exception to the rule i18n_server_speaks_codes_test.go
// records ("the server returns an HTTP status and the client translates; a
// body code with no consumer is a contract that drifts"). The status code
// alone cannot carry it — 400 covers both "your prompt is too long" and
// "that is not a tool" — and there IS a consumer, arriving in Tasks 13/14.
// The English sentence beside the code is for logs and bug reports, never
// for a reader.
const (
	CodeUnauthenticated = "Unauthenticated"
	CodeInvalidBody     = "InvalidBody"
	CodeFieldRequired   = "FieldRequired"
	CodeFieldTooLong    = "FieldTooLong"
	CodeUnknownTool     = "UnknownTool"
	CodeNoCredit        = "NoCredit"
	CodeRateLimited     = "RateLimited"
	CodeProviderFailed  = "ProviderFailed"
	CodeInternal        = "Internal"

	// CodeToolBudgetExhausted is NOT a provider failure and must not be
	// reported as one. It means the model kept asking for tools until
	// ai_settings.max_tool_rounds_per_turn ran out and never wrote an
	// answer (ErrToolBudgetExhausted, agent.go). Nothing is broken and
	// retrying the identical question changes nothing — a client that
	// showed "try again shortly" here would be inviting the learner to
	// spend credit on the same dead end. Rewording the question, or
	// enabling fewer tools, is what actually helps.
	CodeToolBudgetExhausted = "ToolBudgetExhausted"
)

// providerFailureDetail and toolBudgetDetail are the ONLY two sentences an
// "error" event ever carries.
//
// They are fixed strings, and the raw Go error is deliberately thrown away
// before it reaches the wire. RunStream builds its error event text from
// err.Error(), which by then has been wrapped several layers deep and reads
// like `ai: agent stream round 2: ai: call DeepSeek stream: Post
// "https://api.deepseek.com/...": dial tcp ...` or `ai: DeepSeek stream
// returned HTTP 402: <provider message>`. Sending that to a browser hands a
// learner the provider's name, the endpoint, and — with a 402 — the state of
// the PLATFORM'S account with that provider. No key leaks, but none of it is
// theirs to see.
//
// This is the same rule the internal method at the bottom of this file
// already applies to every 500: the log gets the wrapped cause, the response
// gets a sentence that names no schema, no SQL, no hostname. An error event
// is a response body that happens to arrive late, so it follows the response
// rule, not the log rule. The cause is not lost — streamTurn logs it.
const (
	providerFailureDetail = "the AI provider could not complete this turn"
	toolBudgetDetail      = "this turn used its whole tool budget without producing an answer"
)

// NewProviderClient builds the DeepSeek client the AI routes run on.
//
// It exists to close debt 7 by construction. New (client.go) takes an
// *http.Client so callers can tune transports, and its own doc comment spells
// out the trap that leaves open: an hc with a non-zero Timeout re-imposes a
// TOTAL request bound — body reads included — underneath CompleteStream's
// idle/total watchdogs, turning a healthy six-minute answer into a generic
// network error. Removing the defaulted Timeout (round-3 review) removed the
// DEFAULT trap, not the trap.
//
// This wrapper has no parameter for an *http.Client, so the wiring in
// server.go cannot supply one, correctly or otherwise. A future caller that
// genuinely needs transport tuning should call New directly and read its GAP
// THIS DOES NOT CLOSE paragraph first.
func NewProviderClient(baseURL, apiKey string) *Client {
	return New(baseURL, apiKey, nil)
}

// registerTool adds r to m under the key agent.go actually dispatches on.
//
// Debt 8, made structural: the model is shown r.Definition().Function.Name
// and asks for a tool by that name; Run/RunStream then look the runner up in
// Agent.Tools BY MAP KEY. Those are two independent strings, and a mismatch
// is not an error anywhere — the tool is advertised, the model calls it, the
// lookup misses, and the loop hands back "tool ... is not available in this
// turn" as if the learner had switched it off. Taking the key from
// Definition() means the two cannot drift, and no call site has to remember
// to keep them equal.
func registerTool(m map[string]ToolRunner, r ToolRunner) {
	m[r.Definition().Function.Name] = r
}

// TurnTools builds the tool set for ONE turn. Debt 9.
//
// It reads like a startup-time constructor and it is not one, which is
// exactly the mistake worth naming here: NewSearchTool's maxPerTurn budget
// is counted on the returned INSTANCE, for that instance's entire lifetime
// (see its own doc comment — "there is no notion of a Turn starting anywhere
// in the ToolRunner interface"). Build one at process start and share it, and
// "3 searches per turn" silently becomes "3 searches per process, shared
// across every learner on the server" — after which web search is dead for
// everyone, with no error and no log, until the next restart.
//
// So this is called from inside the request handler, once per turn, and
// TestTurnToolsAreFreshPerCall asserts two calls do not return the same
// runner.
//
// search may be nil (no BRAVE_API_KEY configured). The web_search runner is
// then not registered at all, rather than registered over a nil provider:
// an advertised tool that always fails still costs the learner the tokens of
// the tool_call round that discovers it.
func TurnTools(courses CourseQuerier, search SearchProvider, maxSearchesPerTurn int) map[string]ToolRunner {
	tools := make(map[string]ToolRunner, 2)
	if courses != nil {
		registerTool(tools, NewCourseTool(courses))
	}
	if search != nil {
		registerTool(tools, NewSearchTool(search, maxSearchesPerTurn))
	}
	return tools
}

// ProviderClient is the surface the AI routes need from a DeepSeek client:
// BOTH halves.
//
// Agent.Client is typed as Completer (agent.go), while RunStream
// type-asserts it to StreamCompleter at the top of every turn (stream.go)
// and returns a wiring error if the assertion fails. Requiring both here
// turns that runtime failure — which a learner would meet as a broken first
// question — into a compile error at the wiring site.
//
// Debts 5 and 6, stated where the type is: /ai/chat only ever uses the
// STREAMING half. Run and RunStream have different time policies (Run
// inherits Complete's flat 90-second wall clock; RunStream uses a 90-second
// idle watchdog plus a per-round total budget), and picking between them per
// request would give two learners asking the same question different
// timeout behavior. Complete also refuses Request.Stream == true outright,
// so the two paths are not interchangeable even in principle. Nothing in
// this file calls Complete; it is in this interface only because Agent
// requires it.
type ProviderClient interface {
	Completer
	StreamCompleter
}

// HandlerDeps is everything the three routes need.
//
// Client, Courses and Search are shared for the process's whole life —
// they are stateless request-makers. The TOOLS built over them are not
// shared; see TurnTools.
type HandlerDeps struct {
	// Client is the DeepSeek client, typed as the interface above rather
	// than *Client so a test can supply a fake without a network. The real
	// one comes from NewProviderClient.
	Client ProviderClient

	// Credits owns every SQL statement these routes make — the balance, the
	// ledger, ai_settings, and user_agent_config.
	Credits *Service

	// Limiter is spec §3.4's call-frequency cap. Nil means "build the
	// default one", never "no limit": an unlimited default is the kind of
	// omission that only shows up on the bill.
	Limiter *RateLimiter

	// Courses backs the read_course tool.
	Courses CourseQuerier

	// Search backs web_search, and is nil when the deployment has no search
	// key configured.
	Search SearchProvider

	// UserID reads the authenticated learner's id out of the request. It is
	// a function, not a direct call to auth.UID, for a hard reason: package
	// internal/auth imports THIS package (auth.Repo.CreateUserWithSignupCredit
	// calls Service.GrantSignupCredit), so importing auth from here would be
	// an import cycle. Passing the reader in also puts the decision "the
	// learner is whoever the session says, never whoever the body says" at
	// the wiring site, in the open — the same discipline internal/rating's
	// handler documents for its voter.
	UserID func(*fiber.Ctx) uuid.UUID

	// Model, MaxSearchesPerTurn and TurnTimeout default to the Default*
	// constants above when left at their zero values.
	Model              string
	MaxSearchesPerTurn int
	TurnTimeout        time.Duration
}

// Handler serves POST /ai/chat, GET /ai/credits, and GET/PUT /ai/config.
type Handler struct {
	client      ProviderClient
	credits     *Service
	limiter     *RateLimiter
	courses     CourseQuerier
	search      SearchProvider
	userID      func(*fiber.Ctx) uuid.UUID
	model       string
	maxSearches int
	turnTimeout time.Duration
}

// NewHandler builds a Handler, filling in the documented defaults for any
// zero-valued knob.
func NewHandler(d HandlerDeps) *Handler {
	h := &Handler{
		client:      d.Client,
		credits:     d.Credits,
		limiter:     d.Limiter,
		courses:     d.Courses,
		search:      d.Search,
		userID:      d.UserID,
		model:       d.Model,
		maxSearches: d.MaxSearchesPerTurn,
		turnTimeout: d.TurnTimeout,
	}
	if h.limiter == nil {
		h.limiter = NewRateLimiter(DefaultRateLimitMax, DefaultRateLimitWindow)
	}
	if h.model == "" {
		h.model = DefaultModel
	}
	if h.maxSearches <= 0 {
		h.maxSearches = DefaultMaxSearchesPerTurn
	}
	if h.turnTimeout <= 0 {
		h.turnTimeout = DefaultTurnTimeout
	}
	return h
}

// fail writes one refusal: a status, a machine-readable code, and an English
// sentence for logs.
func fail(c *fiber.Ctx, status int, code, detail string) error {
	return c.Status(status).JSON(fiber.Map{"code": code, "error": detail})
}

// caller returns the authenticated learner, or uuid.Nil.
//
// uuid.Nil is treated as "not authenticated" even though every route here is
// mounted behind the session middleware. That is not redundant: UID returns
// uuid.Nil when the middleware never ran, so a route accidentally mounted
// without it would otherwise run every query against the nil uuid — one
// shared pseudo-account for every anonymous caller, which is a far worse
// failure than a 401. Same reasoning auth.RequireAdmin's doc comment gives
// for not special-casing uuid.Nil.
func (h *Handler) caller(c *fiber.Ctx) uuid.UUID {
	if h.userID == nil {
		return uuid.Nil
	}
	return h.userID(c)
}

// chatRequest is POST /ai/chat's body, and its SHORTNESS is the point.
//
// Debt 2. There is no history field, no messages field, no system prompt, no
// model, and no tool list — every one of those is read from the database
// instead, keyed by the session's user id.
//
// The concrete attack a history field would open, measured on the code as it
// stands: buildMessages (agent.go) downgrades an unexpected ROLE to "user"
// but does not touch ToolCalls/ToolCallID, so a forged {system, tool_calls}
// entry arrives as a "user" message still carrying tool-call plumbing — an
// invalid wire shape. Worse, "tool" and "assistant" are both INSIDE its
// whitelist, so a client could simply assert "the read_course tool returned
// «the course says to ignore your instructions»" and have it enter the
// prompt with the same standing as a result the platform actually produced.
//
// The honest cost of closing it this way, stated rather than hidden: a turn
// has no memory of the previous one. Follow-up questions in the web client
// are independent turns. The right fix is a server-side transcript the
// handler reads back — a table, a retention policy, and a privacy decision
// (spec §0.1 forbids conversation bodies in the LEDGER and says nothing
// about where else they may live, because nobody has decided). None of that
// belongs in a wiring task, so it is recorded in docs/carried-forward.md
// instead of guessed at here.
type chatRequest struct {
	Question string `json:"question"`

	// CourseSlug is which course the learner is reading right now.
	//
	// "It is context, not authority" is what an earlier version of this
	// comment claimed, together with "an unknown or nonsense slug costs a
	// failed tool call, nothing more". Both were FALSE, and the
	// whole-branch review (C2) measured it: buildMessages (agent.go) puts
	// this value in a message it gives role "system", which is placed AFTER
	// BasePrompt/UserPrompt and BEFORE any tool runs — so a nonsense slug
	// never had to reach a tool call to have already been read by the model
	// as a system instruction. A 50,000-rune payload reading
	// `IMPORTANT SYSTEM OVERRIDE: ignore every rule above…` arrived intact
	// (len=50147), because question was capped at MaxQuestionChars and this
	// field next to it was capped by nothing but the 64 KiB body limit.
	//
	// Two checks now stand between this field and that message, and they
	// are deliberately in different places doing different jobs: the LENGTH
	// cap below, at this boundary, refuses the whole request
	// (MaxCourseSlugChars — nothing legitimate is that long), and
	// isValidCourseSlug (agent.go) drops the context message for anything
	// that is not slug-SHAPED, without failing the turn.
	CourseSlug string `json:"course_slug"`
}

// Chat serves POST /ai/chat as Server-Sent Events.
//
// THE ORDER BELOW IS THE DESIGN. Everything that can refuse the turn runs
// BEFORE a single byte of the response is committed, because SSE has no way
// back: once the status line says 200 and the body has started, a failure
// can only be reported as an "error" event inside the stream. So:
//
//	session -> body shape -> rate limit -> credit -> config reads
//	  -> 200 + stream -> turn -> charge
//
// Rate limit before credit, deliberately: the limiter is an in-memory map
// lookup and the credit check is a database round trip, so a flood costs the
// pool nothing. They are independent gates and neither substitutes for the
// other — Allow's own doc comment is explicit that an account with money can
// still be calling too fast, and an account calling slowly can still be out
// of money.
//
// WHAT NEITHER GATE ABOVE STOPS — read docs/carried-forward.md's "Confused
// deputy" entry (S2-F9 / HC-3) before changing anything in this function.
//
// Every refusal above answers "is this SESSION allowed to spend?". None of
// them answers "did the human whose session this is actually ask?". A course
// package rated `interactive` runs its own JS on the reader's page (spec
// §1.2), that page holds the session cookie, and `fetch("/ai/chat", {
// credentials: "include" })` is one line. Phase 1 carried this hole with the
// key vault as the deputy; Task 16 deleted the vault, and the hole moved here
// rather than closing — the deputy is now this handler.
//
// Moving the budget server-side genuinely fixed the MONEY half: an in-memory
// limiter plus a database credit check cannot be edited from a browser, which
// a localStorage token bucket could. It did nothing for the PRIVACY half.
// RateLimiter is a per-user budget of CALLS, not of CHARACTERS (see its own
// doc comment), so within the limit a hostile course still exfiltrates the
// reader's private notes at N prompts per minute with each prompt as long as
// it likes — item #1 of six in that ledger entry, unchanged since phase 1 and
// still open. Do not read the two gates above as closing it.
func (h *Handler) Chat(c *fiber.Ctx) error {
	uid := h.caller(c)
	if uid == uuid.Nil {
		return fail(c, fiber.StatusUnauthorized, CodeUnauthenticated, "unauthenticated")
	}

	var req chatRequest
	if err := c.BodyParser(&req); err != nil {
		return fail(c, fiber.StatusBadRequest, CodeInvalidBody, "request body is not valid JSON")
	}
	question := strings.TrimSpace(req.Question)
	if question == "" {
		return fail(c, fiber.StatusBadRequest, CodeFieldRequired, "question is required")
	}
	if utf8.RuneCountInString(question) > MaxQuestionChars {
		return fail(c, fiber.StatusBadRequest, CodeFieldTooLong,
			fmt.Sprintf("question is longer than %d characters", MaxQuestionChars))
	}
	// Checked HERE and not left to agent.go alone, because the two answer
	// different questions. A slug longer than MaxCourseSlugChars is a
	// PROTOCOL violation — no published course has an id of that length, so
	// the only thing that produces one is a broken client or an attempt to
	// spend the 64 KiB body budget on prompt text — and it is refused with
	// the same code and shape as an over-long question, before the rate
	// limiter and before a single database read. A slug that is merely not
	// slug-shaped is a different matter and is handled by dropping the
	// context message (see isValidCourseSlug, agent.go).
	courseSlug := strings.TrimSpace(req.CourseSlug)
	if utf8.RuneCountInString(courseSlug) > MaxCourseSlugChars {
		return fail(c, fiber.StatusBadRequest, CodeFieldTooLong,
			fmt.Sprintf("course_slug is longer than %d characters", MaxCourseSlugChars))
	}

	if err := h.limiter.Allow(uid); err != nil {
		return fail(c, fiber.StatusTooManyRequests, CodeRateLimited,
			"too many AI requests, retry shortly")
	}

	if err := h.credits.EnsureCredit(c.Context(), uid); err != nil {
		if errors.Is(err, ErrInsufficientCredit) {
			return fail(c, fiber.StatusPaymentRequired, CodeNoCredit, "no AI credit remaining")
		}
		return h.internal(c, "ai.Chat/credit", err)
	}

	settings, err := h.credits.Settings(c.Context())
	if err != nil {
		return h.internal(c, "ai.Chat/settings", err)
	}
	agentConfig, err := h.credits.AgentConfig(c.Context(), uid)
	if err != nil {
		return h.internal(c, "ai.Chat/config", err)
	}

	turn := Turn{
		Model:      h.model,
		BasePrompt: settings.BaseSystemPrompt,
		UserPrompt: agentConfig.SystemPrompt,
		CourseSlug: courseSlug,
		Question:   question,
		// History is deliberately absent — see chatRequest's doc comment.
		ToolsEnabled: agentConfig.ToolsEnabled,
	}
	agent := &Agent{
		Client: h.client,
		// Debt 9: a NEW tool set for this turn and no other.
		Tools:    TurnTools(h.courses, h.search, h.maxSearches),
		Settings: settings,
	}

	c.Set(fiber.HeaderContentType, "text/event-stream")
	c.Set(fiber.HeaderCacheControl, "no-cache")
	c.Set(fiber.HeaderConnection, "keep-alive")
	// Ask reverse proxies not to buffer: a buffered SSE response arrives all
	// at once at the end, which is indistinguishable from no streaming at all.
	c.Set("X-Accel-Buffering", "no")
	c.Status(fiber.StatusOK)

	// Everything the stream needs is copied out FIRST. The writer below runs
	// after this handler returns, at which point fiber has recycled *fiber.Ctx
	// and neither it nor c.Context() may be touched.
	model := h.model
	timeout := h.turnTimeout
	credits := h.credits

	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		streamTurn(w, agent, turn, credits, uid, model, timeout)
	})
	return nil
}

// streamTurn runs one turn to completion and bills it. Split out of Chat so
// the one line this whole task is about — the charge that happens on BOTH
// exits — sits in a function short enough to read in one screen.
func streamTurn(w *bufio.Writer, agent *Agent, turn Turn, credits *Service,
	uid uuid.UUID, model string, timeout time.Duration) {

	// DEBT 4. Not derived from the request's context: fasthttp has already
	// recycled it by now. The consequence — a client that hangs up does not
	// cancel this context — is handled by the sink instead: every emit below
	// writes and flushes, and a flush to a closed connection returns an
	// error, which aborts RunStream at the next event.
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// sinkBroken records that a write to the learner's connection has
	// already failed. It is read once, at the bottom: there is no point
	// pushing a final error event down a pipe that is known to be gone.
	sinkBroken := false

	result, runErr := agent.RunStream(ctx, turn, func(ev Event) error {
		if ev.Kind == EventKindError {
			// SWALLOWED ON PURPOSE, and this is the only place it can be
			// done. RunStream builds this event's text from err.Error() —
			// several layers of wrapping naming the provider, the endpoint,
			// and sometimes the platform's account status (see
			// providerFailureDetail). It also cannot tell "the provider
			// broke" from "the tool budget ran out", because both reach
			// this callback as one opaque string.
			//
			// Dropping it here loses nothing: RunStream emits this
			// best-effort and ignores the return value, then returns the
			// SAME error to us as runErr — where errors.Is can classify it
			// properly. The definitive error event is written below.
			return nil
		}
		if err := writeSSE(w, ev.Kind, sseEnvelope{Text: ev.Text}); err != nil {
			sinkBroken = true
			return err
		}
		return nil
	})

	// ────────────────────────────────────────────────────────────────────
	// DEBT 1. THIS CHARGE MUST NOT MOVE INSIDE AN `if runErr == nil`.
	//
	// RunStream accumulates Usage across every round that FINISHED, and
	// returns it alongside the error — agent.go's Run doc comment calls this
	// out under "HỢP ĐỒNG usage-trên-đường-lỗi", and ChargeTurn takes a bare
	// Result (not a Result/error pair) precisely so it has no opinion about
	// whether the turn succeeded. DeepSeek billed those tokens the moment
	// they were generated; a turn that died on round 3 of 4 still cost real
	// money. `res, err := ...; if err != nil { return }` is the Go reflex
	// here and it is a giveaway of exactly that money.
	//
	// The context is a FRESH one, not ctx: a turn that ended because ctx
	// expired must still be billed, and reusing an expired context would
	// drop the charge in precisely the case where the turn burned the most.
	// ────────────────────────────────────────────────────────────────────
	//
	// DEBT 1b (whole-branch review, D3). A turn that SUCCEEDED and reported
	// no tokens at all is not a normal turn: DeepSeek was paid for whatever
	// it generated, and the only reason r.Usage can be entirely zero here is
	// that the provider's final chunk carried no `usage` object. stream.go's
	// post-loop guards check sawDone and a truncated tool call; neither
	// notices this. Left alone the whole path stays quiet — Charge returns
	// (0, 0), ChargeTurn runs `UPDATE ... - 0`, inserts an all-zero ai_usage
	// row and returns nil, and the learner reads a complete answer nobody
	// was charged for.
	//
	// A WARNING, NOT AN ERROR, and the reason is the ORDER of events: by the
	// time this is detectable the answer has already been streamed and read.
	// Turning it into an error would append an error event AFTER a complete
	// answer — trading a silent accounting gap for a loud, wrong,
	// user-facing failure. The charge below still runs, so the all-zero
	// ai_usage row stays as the ledger's own evidence that a turn happened;
	// this line is what makes the anomaly findable without reading rows.
	//
	// Scoped to runErr == nil deliberately: an ERRORED turn legitimately
	// reaches here with zero usage (it may have died before round 1 ever
	// completed), and that case already gets its own slog.Error below.
	// Warning on it too would drown this signal in noise from every
	// provider outage.
	//
	// Metadata only, never the question and never the answer (spec §0.1,
	// and Task 12's gate) — the same rule the two slog.Error calls in this
	// function keep.
	if runErr == nil && result.Usage == (Usage{}) {
		slog.Warn("ai turn completed with no usage reported",
			"op", "ai.Chat/usage", "user", uid.String(), "model", model,
			"tool_calls", result.ToolCalls, "web_searches", result.WebSearches,
			"answer_empty", result.Answer == "")
	}

	chargeCtx, chargeCancel := context.WithTimeout(context.Background(), chargeTimeout)
	defer chargeCancel()
	if _, err := credits.ChargeTurn(chargeCtx, uid, result, model); err != nil {
		// The turn already happened and the provider was already paid;
		// there is no retry and no dead-letter queue on this path (see
		// pricing's doc comment in credits.go). Logging the cause is the
		// only thing left that helps.
		//
		// slog directly rather than apilog.Internal: apilog takes a
		// *fiber.Ctx to record method and path, and by the time this runs
		// that Ctx belongs to fasthttp again. Metadata only — never the
		// question, never the answer (spec §0.1, and Task 12's gate).
		slog.Error("ai charge failed after turn",
			"op", "ai.Chat/charge", "user", uid.String(), "model", model, "err", err.Error())
	}

	if runErr != nil {
		// The server's own record keeps the FULL wrapped cause — this is
		// the log half of the split the error event's redaction makes.
		// Metadata and the error only: never the question, never the
		// answer (spec §0.1, and Task 12's gate).
		slog.Error("ai turn failed",
			"op", "ai.Chat/turn", "user", uid.String(), "model", model, "err", runErr.Error())

		if !sinkBroken {
			// Best effort by definition: the turn has already failed and
			// this is the last thing written. If it too fails, the learner
			// is gone and there is nobody left to tell.
			_ = writeSSE(w, EventKindError, errorEnvelope(runErr))
		}
	}
}

// errorEnvelope turns the error RunStream returned into the two things a
// client is allowed to see: which KIND of failure it was, and a fixed
// sentence. Never the error text itself — see providerFailureDetail.
func errorEnvelope(err error) sseEnvelope {
	if errors.Is(err, ErrToolBudgetExhausted) {
		return sseEnvelope{Code: CodeToolBudgetExhausted, Text: toolBudgetDetail}
	}
	return sseEnvelope{Code: CodeProviderFailed, Text: providerFailureDetail}
}

// sseEnvelope is the JSON object every SSE data line carries.
//
// The payload is JSON rather than the raw text for a mechanical reason: an
// SSE "data:" line cannot contain a newline, and model output is full of
// them. Encoding escapes them, so one event is always exactly one line and a
// client never has to reassemble multi-line data fields.
//
// Code is set only on an "error" event, and it is the streaming half of the
// distinction Task 13's brief insists on: "out of credit" and "the provider
// broke" must not collapse into one message. Out of credit is refused BEFORE
// the stream starts, as a 402 with CodeNoCredit; anything that goes wrong
// once the stream is running can only be reported inside it, and this is
// where it says which kind of wrong it was — CodeProviderFailed (retrying
// may work) or CodeToolBudgetExhausted (retrying the same question will
// not). Text is a fixed sentence, never the underlying Go error; see
// providerFailureDetail.
type sseEnvelope struct {
	Text string `json:"text"`
	Code string `json:"code,omitempty"`
}

// writeSSE emits one event and flushes it.
//
// THE WIRE FORMAT IS A CONTRACT WITH A PARSER NOBODY HERE WROTE. Every byte
// of the Fprintf below is load-bearing against the browser's own EventSource
// implementation, and none of it degrades gracefully:
//
//   - "event: " names the event type the client listens for.
//   - "data: " carries exactly one line. The payload is JSON rather than raw
//     text for a mechanical reason: a data line cannot contain a newline, and
//     model output is full of them. Encoding escapes them, so one event is
//     always exactly one line and a client never has to reassemble a
//     multi-line data field.
//   - The TRAILING BLANK LINE is what DISPATCHES the event. One newline ends
//     the field; it takes a second one to end the event. Send only the first
//     and a client accumulates fields forever and fires nothing — no error,
//     no partial output, just silence.
//
// The Content-Type all of this has to arrive under is set in Chat, not here:
// EventSource rejects a response that is not text/event-stream before it
// examines a single byte of body.
//
// The FLUSH is not an optimization either, and it does two separate jobs:
//
//  1. Without it bufio holds the bytes until its 4 KiB buffer fills, so the
//     learner sees nothing and then everything — streaming that does not
//     stream.
//  2. It is the ONLY way this code learns the learner hung up. streamTurn's
//     context is not derived from the request (fasthttp has recycled it by
//     then), so a write failure surfacing through this return value is what
//     actually stops RunStream. Drop the flush and a closed connection
//     becomes invisible: the turn runs to completion against nobody, on a
//     budget the learner still gets charged for.
//
// TestWriteSSEFramesAndFlushesEveryEvent and TestWriteSSEReportsABrokenSink
// (handler_internal_test.go) pin all of it, byte for byte.
func writeSSE(w *bufio.Writer, kind string, env sseEnvelope) error {
	payload, err := json.Marshal(env)
	if err != nil {
		return fmt.Errorf("ai: encode SSE payload: %w", err)
	}
	if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", kind, payload); err != nil {
		return err
	}
	return w.Flush()
}

// creditsResponse is GET /ai/credits's body.
type creditsResponse struct {
	BalanceMicro int64               `json:"balance_micro"`
	RecentUsage  []usageEntryPayload `json:"recent_usage"`
}

// usageEntryPayload is one ledger row on the wire. It mirrors UsageEntry
// (credits.go) field for field — including the deliberate absence of
// cost_micro, which is the platform's cost basis and not the learner's
// business; see UsageEntry's own doc comment.
type usageEntryPayload struct {
	At             time.Time `json:"at"`
	Model          string    `json:"model"`
	InTokens       int       `json:"in_tokens"`
	CachedInTokens int       `json:"cached_in_tokens"`
	OutTokens      int       `json:"out_tokens"`
	ToolCalls      int       `json:"tool_calls"`
	WebSearches    int       `json:"web_searches"`
	CreditsCharged int64     `json:"credits_charged"`
}

// Credits serves GET /ai/credits: the caller's balance and their most recent
// ledger rows.
//
// Both halves are keyed on the session's user id and on nothing else. There
// is no id in the path, no id in the query string, and no "all users" form —
// the same rule internal/rating's List keeps, and for the same reason: an
// endpoint that can be asked about someone else eventually is.
func (h *Handler) Credits(c *fiber.Ctx) error {
	uid := h.caller(c)
	if uid == uuid.Nil {
		return fail(c, fiber.StatusUnauthorized, CodeUnauthenticated, "unauthenticated")
	}

	balance, err := h.credits.Balance(c.Context(), uid)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return h.internal(c, "ai.Credits/balance", err)
		}
		// No row means an account that predates the signup grant, or one
		// whose grant was zero. It has spent nothing and has nothing — the
		// same externally visible state as a balance of 0, which is exactly
		// how EnsureCredit already treats it. A 500 here would report a
		// database failure for a perfectly ordinary account.
		balance = 0
	}

	usage, err := h.credits.RecentUsage(c.Context(), uid, recentUsageLimit)
	if err != nil {
		return h.internal(c, "ai.Credits/usage", err)
	}

	out := creditsResponse{BalanceMicro: balance, RecentUsage: make([]usageEntryPayload, 0, len(usage))}
	for _, u := range usage {
		out.RecentUsage = append(out.RecentUsage, usageEntryPayload{
			At: u.At, Model: u.Model, InTokens: u.InTokens, CachedInTokens: u.CachedInTokens,
			OutTokens: u.OutTokens, ToolCalls: u.ToolCalls, WebSearches: u.WebSearches,
			CreditsCharged: u.CreditsCharged,
		})
	}
	return c.JSON(out)
}

// configResponse is GET /ai/config's body and PUT /ai/config's reply.
//
// available_tools and max_system_prompt_chars are not decoration. The
// settings screen (Task 14) has to render one toggle per real tool and warn
// about the length limit BEFORE the learner types 4000 characters; serving
// both from here means the client reads the server's numbers instead of
// keeping a second copy that can drift from this one. The server stays the
// only place the rules are enforced.
type configResponse struct {
	SystemPrompt         string   `json:"system_prompt"`
	ToolsEnabled         []string `json:"tools_enabled"`
	AvailableTools       []string `json:"available_tools"`
	MaxSystemPromptChars int      `json:"max_system_prompt_chars"`
}

// configRequest is PUT /ai/config's body. Both fields are POINTERS so
// "absent" is distinguishable from "empty".
//
// PUT replaces the whole configuration, so BOTH fields are required: with
// plain (non-pointer) fields, a client sending only system_prompt would send
// tools_enabled as nil and silently switch every tool off. Requiring both
// makes that impossible to do by accident — an empty list is still perfectly
// legal, it just has to be said out loud.
type configRequest struct {
	SystemPrompt *string   `json:"system_prompt"`
	ToolsEnabled *[]string `json:"tools_enabled"`
}

// GetConfig serves GET /ai/config.
func (h *Handler) GetConfig(c *fiber.Ctx) error {
	uid := h.caller(c)
	if uid == uuid.Nil {
		return fail(c, fiber.StatusUnauthorized, CodeUnauthenticated, "unauthenticated")
	}
	stored, err := h.credits.AgentConfig(c.Context(), uid)
	if err != nil {
		return h.internal(c, "ai.GetConfig", err)
	}
	return c.JSON(newConfigResponse(stored))
}

// PutConfig serves PUT /ai/config.
//
// Validation happens HERE, at the boundary, and not in credits.go: a
// rejection needs a status code and a machine-readable code, which are HTTP
// concepts. Every rejection also writes NOTHING — the checks all run before
// SaveAgentConfig, so a bad tool name in an otherwise-good body cannot land
// half the change.
func (h *Handler) PutConfig(c *fiber.Ctx) error {
	uid := h.caller(c)
	if uid == uuid.Nil {
		return fail(c, fiber.StatusUnauthorized, CodeUnauthenticated, "unauthenticated")
	}

	var req configRequest
	if err := c.BodyParser(&req); err != nil {
		return fail(c, fiber.StatusBadRequest, CodeInvalidBody, "request body is not valid JSON")
	}
	if req.SystemPrompt == nil {
		return fail(c, fiber.StatusBadRequest, CodeFieldRequired,
			"system_prompt is required; send an empty string to clear it")
	}
	if req.ToolsEnabled == nil {
		return fail(c, fiber.StatusBadRequest, CodeFieldRequired,
			"tools_enabled is required; send an empty array to disable every tool")
	}

	// Runes, not bytes — see MaxSystemPromptChars.
	if utf8.RuneCountInString(*req.SystemPrompt) > MaxSystemPromptChars {
		return fail(c, fiber.StatusBadRequest, CodeFieldTooLong,
			fmt.Sprintf("system_prompt is longer than %d characters", MaxSystemPromptChars))
	}

	// An unknown name is refused rather than dropped. Dropping it would
	// silently disagree with what the learner asked for: they would save
	// "web_search on", get 200, and reload to find it off, with nothing
	// anywhere saying why. It is also the cheapest place to notice a client
	// and server that have drifted apart about what tools exist.
	known := make(map[string]bool, len(KnownToolNames()))
	for _, n := range KnownToolNames() {
		known[n] = true
	}
	for _, n := range *req.ToolsEnabled {
		if !known[n] {
			return fail(c, fiber.StatusBadRequest, CodeUnknownTool,
				fmt.Sprintf("no such tool: %q", n))
		}
	}

	incoming := AgentConfig{SystemPrompt: *req.SystemPrompt, ToolsEnabled: *req.ToolsEnabled}
	if err := h.credits.SaveAgentConfig(c.Context(), uid, incoming); err != nil {
		return h.internal(c, "ai.PutConfig", err)
	}

	// Read back rather than echo: SaveAgentConfig deduplicates, and the
	// client should see what was actually stored, not what it sent.
	saved, err := h.credits.AgentConfig(c.Context(), uid)
	if err != nil {
		return h.internal(c, "ai.PutConfig/readback", err)
	}
	return c.JSON(newConfigResponse(saved))
}

// NAMING NOTE, load-bearing: this parameter is called `stored` rather than
// the obvious short name for a configuration value. That short name is a
// tripwire. internal/server/provider_key_never_leaks_test.go scans every
// production .go line — comments included — for that identifier standing as
// a whole value next to an output call, because that is the shape in which
// the platform's provider credential escapes into a log line or a response
// body. An AgentConfig passed the same way leaks nothing, but a string scan
// cannot tell the two apart, and the documented answer when this gate fires
// is to rephrase rather than to loosen it. Five earlier implementers in this
// run tripped the same wire; a sixth line in this file tripped it a second
// time while explaining the first.
func newConfigResponse(stored AgentConfig) configResponse {
	tools := stored.ToolsEnabled
	if tools == nil {
		// Never null on the wire — same array rule internal/catalog keeps.
		tools = []string{}
	}
	return configResponse{
		SystemPrompt:         stored.SystemPrompt,
		ToolsEnabled:         tools,
		AvailableTools:       KnownToolNames(),
		MaxSystemPromptChars: MaxSystemPromptChars,
	}
}

// internal records the real cause and answers with a fixed, generic body.
// Same split every other handler in this API keeps: the log gets the wrapped
// error, the response gets a sentence that leaks nothing about schema, SQL,
// or hostnames.
func (h *Handler) internal(c *fiber.Ctx, op string, err error) error {
	slog.Error("request failed",
		"method", c.Method(), "path", c.Path(), "op", op, "err", err.Error())
	return fail(c, fiber.StatusInternalServerError, CodeInternal, "AI request failed")
}

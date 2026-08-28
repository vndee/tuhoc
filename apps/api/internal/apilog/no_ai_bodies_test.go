// no_ai_bodies_test.go is the gate spec §0.1's global constraint #2 and
// spec §8 both name: apilog — the server's own error log, apilog.go's doc
// comment calls it "the one place the real cause behind a generic 5xx
// response gets recorded" — must NEVER carry an AI turn's conversation
// body. Not the learner's question, not the model's answer. What the
// ledger and this log MAY carry is metadata: who, which model, how many
// tokens, how many credits. Never the text itself.
//
// This is not a hypothetical risk. apilog.Internal's whole reason to exist
// (apilog.go's own doc comment) is that it DOES accept err.Error() and
// writes it verbatim — that is the entire point of the package: keep the
// wrapped cause the generic HTTP response deliberately throws away. A
// wrapped Go error is exactly the shape that swallows arbitrary text
// without anyone noticing, because %w and %s don't know or care what they
// are formatting. The real question this file answers is task-12-brief.md's
// own framing of it: is there ANY path by which an error carrying
// conversation text reaches that log?
//
// ── TWO HALVES, NEITHER SUFFICIENT ALONE ────────────────────────────────
//
// BEHAVIOR (TestAIConversationBodyNeverReachesAPILog) runs a real /ai/chat
// turn — through ai.NewHandler, a fake DeepSeek client, and a real
// Postgres — with a question and an answer that each carry an easy-to-grep
// sentinel, and reads the REAL log destination (log/slog's default logger,
// the same one apilog.go writes through) afterward. This proves the
// property against what the server actually emits, not against what the
// source looks like it should emit.
//
// It sees THREE call-site families in internal/ai/handler.go, not two —
// round-1 review corrected this comment after finding the two named below
// were an undercount:
//
//  1. streamTurn's own two direct slog.Error calls — the "ai turn failed"
//     line (runErr.Error(), built from whatever RunStream returned) and
//     the "ai charge failed after turn" line (ChargeTurn's error). These
//     are the two task-12-brief.md's own point 3 names.
//  2. Handler.internal (handler.go, near the bottom) — a HAND-COPIED TWIN
//     of apilog.Internal (same "request failed" message, same fields),
//     which handler.go's own comment explains exists because no
//     *fiber.Ctx survives to streamTurn for the real apilog.Internal to
//     use. It is called from eight sites across Chat/Credits/GetConfig/
//     PutConfig; THREE of them — the EnsureCredit/Settings/AgentConfig
//     failure branches inside Chat itself — run with `question` (the
//     trimmed request body) already parsed and live in scope. Round-1
//     review proved this path live: mutating the Settings call site to
//     `fmt.Errorf("settings lookup while answering %q: %w", question,
//     err)` put the learner's literal question into slog, and this file's
//     ORIGINAL structural half (which only matched literal "apilog."
//     prefixes, and Handler.internal never contains that substring) never
//     saw it. apilogCallRe below now matches this shape too — see its own
//     doc comment for exactly how.
//
// It does NOT reach into internal/rating, internal/auth, internal/catalog,
// internal/sync, internal/discuss, or internal/stats's own apilog.Internal
// call sites — those handle ratings, credentials, catalog metadata, sync
// payloads, and stats events, none of which share any code path with an AI
// turn's Question/Answer, so a behavioral probe through THEIR routes would
// prove nothing about THIS property. That is what the structural half is
// for.
//
// One shape is DELIBERATELY left untested here, not overlooked: an error
// that ALREADY carries conversation-shaped text before streamTurn ever
// touches it — concretely, stream.go's CompleteStream wraps DeepSeek's own
// non-2xx error body verbatim (truncated) via truncateProviderMessage into
// runErr (see stream.go:567, client.go:326), and that text is provider-
// authored diagnostic content, not learner/model conversation text, so
// logging it is the log doing its documented job (apilog.go's own doc
// comment: "the SERVER must keep the cause"), not a leak of the two things
// spec §0.1 names. It is ALSO a real, narrower residual risk this file
// does not close: if DeepSeek's error API ever echoes a fragment of the
// rejected request back in its error message (a content-policy rejection
// quoting the flagged text is the plausible shape), that fragment would
// reach apilog unfiltered, because nothing between client.go's
// truncateProviderMessage and streamTurn's slog.Error call inspects what
// the provider's own text contains. Closing that would mean deciding what
// (if anything) to redact from a THIRD PARTY's error text before wrapping
// it — a design question for stream.go/client.go, not a test-coverage gap
// this gate's two fixtures (answerStep, failStep — both of which use
// FIXED, hand-written error strings specifically so a red result can only
// mean streamTurn's own code reached into conversation content, never that
// the fake provider handed it some) can settle by adding a case. Recorded
// as an open, out-of-scope-for-this-task item in task-12-report.md rather
// than guessed at here.
//
// STRUCTURE (TestAPILogCallSitesNeverNameConversationBodyArgs) scans every
// non-test .go file under apps/api for a call into the log destination
// this whole file is about, carrying, on the same source line, a bare
// identifier named body, content, question, answer, messages, or prompt —
// task-12-brief.md's own checklist, widened past its literal wording after
// round-1 review (see apilogCallRe's own doc comment for why "just
// apilog.*" undercounted). It does not care whether any test ever
// exercises the call site: a future violation added to ANY package,
// including ones that don't exist yet, is caught the moment it is
// compiled into a file this scan reads — exactly the gap
// provider_key_never_leaks_test.go's own doc comment documents for its
// analogous two-half design ("a route that doesn't exist yet, that a
// behavioral probe can never reach").
//
// ── ITS OWN NARROW SHAPE — READ BEFORE TRUSTING IT WIDER THAN THIS ───────
//
// Following provider_key_never_leaks_test.go's own discipline (task-12's
// brief names it directly, "Khuôn 2"): a scan narrower than its own
// comment claims is a trap, not a gate. Three real limits, not
// hypothetical — the third one added by round-1 review, which found the
// first version of this comment silently narrowing "the log destination"
// (this file's own opening paragraph's framing) down to "callers spelled
// apilog.*" without ever saying so:
//
//  1. SAME LINE ONLY. A call site gofmt has wrapped across lines —
//     `apilog.Internal(c, "op",\n\t\tfmt.Errorf("...: %s", question))` —
//     is invisible to this scan; that needs a real Go parser (go/ast), not
//     a line-oriented string scan. This is the identical limitation
//     provider_key_never_leaks_test.go's own comment records for its
//     needle scan, for the identical reason: apilogArgScan below is
//     line-oriented on purpose (see its own doc comment), and a real
//     parser is a bigger tool than this property has needed so far. The
//     BEHAVIOR half is the safety net for exactly this shape: it doesn't
//     care how many lines an error is built across, it reads what actually
//     got logged.
//  2. NAME-BASED, NOT TYPE-BASED, AND BLIND ACROSS A FUNCTION BOUNDARY. It
//     matches an IDENTIFIER spelled body/content/question/answer/messages/
//     prompt appearing on the apilog-call line — not "a string that
//     happens to hold conversation text." A variable holding the learner's
//     question but named `q` (as chatRequest's own JSON-decoded field is,
//     after BodyParser assigns it to req.Question — see handler.go) would
//     not be caught by name if some future call site plumbed it through
//     under a different local name. This is the same value-renamed-across-
//     a-boundary blind spot provider_key_never_leaks_test.go's own comment
//     names for cfg.DeepSeekAPIKey crossing into internal/discuss's
//     `token string` parameter — full taint tracking is out of reach for a
//     hand-written scan and was out of scope for that gate too.
//  3. THREE KNOWN SHAPES, NOT "THE DESTINATION." apilogCallRe matches
//     `apilog.*(`, `.internal(`, and direct `slog.(Error|Warn|Info|
//     Debug)(` — three MEASURED, NAMED shapes this repo's source actually
//     uses to reach the log destination today (round-1 review widened
//     this from one shape to three after the Critical above). It is still
//     not equivalent to "any code path that ends up writing to
//     slog.Default()": a hypothetical fourth wrapper under a different
//     name — `mylog.Emit(...)`, a package-level `func logFailure(...)`
//     that itself calls slog with no ".internal(" or "apilog." in its own
//     call sites, or a write straight to os.Stderr bypassing slog
//     entirely — is exactly as invisible to this needle-based scan as
//     Handler.internal was before this round. Widening a needle list after
//     finding a live miss is not the same as closing the class of "a new
//     name for the same sink" misses; the BEHAVIOR half is what actually
//     observes the real destination, independent of what the source is
//     named.
//
// A narrow gate documented as narrow is usable; a narrow gate whose comment
// claims it is wider is the trap. All three limits above are measured
// against this run's actual source, not assumed.
package apilog_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/ai"
	"github.com/vndee/tuhoc-api/internal/store"
)

// ═══════════════════════════════════════════════════════════════════════
// SHARED SENTINELS
// ═══════════════════════════════════════════════════════════════════════

// questionSentinel and answerSentinel are the two "mốc" strings
// task-12-brief.md's checklist names verbatim (Step 1). Distinct from each
// other so an assertion that happens to check the wrong one is visible
// (same "pairwise distinct" discipline internal/ai/handler_test.go's
// fixture block documents for money values — here applied to the two
// halves of a conversation instead).
const (
	questionSentinel = "CAU-HOI-RIENG-TU"
	answerSentinel   = "TRA-LOI-RIENG-TU"
)

// ═══════════════════════════════════════════════════════════════════════
// BEHAVIOR HALF — fakes and fixtures
//
// Duplicated from internal/ai/handler_test.go's own fakeStream/newUser
// rather than imported: those helpers are unexported to that file's
// package (ai_test), and Go gives an external test package no way to reach
// them. The duplication is small and deliberately minimal — only the two
// script shapes (answer, fail-after-partial-delta) this file's two
// scenarios need, not the whole fixture surface handler_test.go carries
// for money assertions this file has no use for.
// ═══════════════════════════════════════════════════════════════════════

// streamStep scripts one round of the fake DeepSeek client.
type streamStep func(onDelta func(string) error) (ai.Completion, error)

// fakeStream is a minimal ai.ProviderClient: CompleteStream replays a
// script one entry per round; Complete always fails, because /ai/chat must
// never call it (handler.go's own doc comment, debt 5/6) — a test that
// silently took the non-streaming path would prove nothing about the SSE
// handler this file actually needs to drive.
type fakeStream struct {
	mu     sync.Mutex
	script []streamStep
	calls  int
}

func (f *fakeStream) CompleteStream(ctx context.Context, req ai.Request, onDelta func(string) error) (ai.Completion, error) {
	f.mu.Lock()
	n := f.calls
	f.calls++
	f.mu.Unlock()
	if n >= len(f.script) {
		return ai.Completion{}, fmt.Errorf("fakeStream: no script entry for round %d", n+1)
	}
	return f.script[n](onDelta)
}

func (f *fakeStream) Complete(ctx context.Context, req ai.Request) (ai.Completion, error) {
	return ai.Completion{}, errors.New("fakeStream: /ai/chat must use the streaming path, not Complete")
}

// answerStep is an ordinary successful round: the model streams `text` and
// then finishes.
func answerStep(text string, u ai.Usage) streamStep {
	return func(onDelta func(string) error) (ai.Completion, error) {
		if err := onDelta(text); err != nil {
			return ai.Completion{Usage: u}, err
		}
		return ai.Completion{
			Message:      ai.Message{Role: "assistant", Content: text},
			FinishReason: "stop",
			Usage:        u,
		}, nil
	}
}

// failStep streams `partial` — which, in the scenario below, itself carries
// answerSentinel, standing in for "the model was mid-answer when the round
// died" — and then fails with a GENERIC, fixed error string. Never one
// built from partial or from any turn content: this mirrors every real
// error stream.go's CompleteStream actually returns (a network failure, a
// non-2xx provider response, a decode failure, a truncation guard — see
// that file's fmt.Errorf call sites), none of which wrap the request or
// response body. Scripting it this way means a red result below can only
// mean streamTurn's OWN logging code reached into the turn's content on
// its own initiative — not that the fake provider handed it content to
// begin with.
//
// The `partial == ""` branch (skip onDelta entirely — "the round died
// before producing any text") is not exercised by either call site below
// as of this writing (round-1 review, Minor); kept rather than deleted
// because it is the correct shape for a round that fails immediately, and
// removing it would only shrink what a future caller could script for no
// benefit to the two scenarios that exist today.
func failStep(partial string, u ai.Usage) streamStep {
	return func(onDelta func(string) error) (ai.Completion, error) {
		if partial != "" {
			if err := onDelta(partial); err != nil {
				return ai.Completion{Usage: u}, err
			}
		}
		return ai.Completion{Usage: u}, errors.New("provider exploded")
	}
}

// slogCapture swaps the process-wide default logger — what apilog writes
// through, and what internal/ai/handler.go's streamTurn writes through
// directly (see that file's own comment on why it doesn't call
// apilog.Internal: it has no *fiber.Ctx by the time it runs) — for one that
// appends to a buffer. Duplicated from internal/server/observability_test.go
// for the same reason fakeStream is duplicated above: that helper is
// unexported to package server.
type slogCapture struct {
	buf *bytes.Buffer
}

func captureSlog(t *testing.T) *slogCapture {
	t.Helper()
	buf := &bytes.Buffer{}
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return &slogCapture{buf: buf}
}

func (c *slogCapture) take() string {
	out := c.buf.String()
	c.buf.Reset()
	return out
}

// newAIApp mounts POST /ai/chat alone, with a fixed user id — same pattern
// as internal/ai/handler_test.go's own newAIApp, minimal for this file's
// needs (no /ai/credits or /ai/config route: this gate never touches
// them).
func newAIApp(t *testing.T, uid uuid.UUID, deps ai.HandlerDeps) *fiber.App {
	t.Helper()
	deps.UserID = func(*fiber.Ctx) uuid.UUID { return uid }
	h := ai.NewHandler(deps)
	app := fiber.New()
	app.Post("/ai/chat", h.Chat)
	return app
}

// newUser inserts a fresh learner with an ai_credits row, mirroring
// internal/ai/handler_test.go's own newUser.
func newUser(t *testing.T, pool *pgxpool.Pool, label string, balanceMicro int64) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	email := fmt.Sprintf("apilog-gate-%s-%s@example.test", label, uuid.NewString())
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email, name, pw_hash) VALUES ($1,$2,$3) RETURNING id`,
		email, label, "not-a-real-hash").Scan(&id); err != nil {
		t.Fatalf("insert user %s: %v", label, err)
	}
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO ai_credits (user_id, balance_micro) VALUES ($1,$2)`, id, balanceMicro); err != nil {
		t.Fatalf("insert ai_credits for %s: %v", label, err)
	}
	return id
}

// doChat drives one POST /ai/chat turn to completion. Reading the ENTIRE
// SSE body via io.ReadAll before returning is load-bearing, not
// incidental: fasthttp's SetBodyStreamWriter runs streamTurn (both of its
// slog.Error call sites included) IN THE GOROUTINE THAT PRODUCES THE
// RESPONSE BODY, and only closes that stream — which is what lets the
// client-side read reach EOF — after streamTurn itself returns. So by the
// time io.ReadAll below has returned, every log line one turn could
// possibly produce has already been written to whatever slog.Default()
// pointed at when the turn ran. This is the fact task-12-brief.md's hint 4
// says to check before trusting a "read after" capture — here it holds,
// because (unlike the SSE ORDERING task 11 measured as invisible to
// app.Test()) this file only needs the FULL log output after the turn is
// entirely done, never the relative order of two things happening DURING
// it.
func doChat(t *testing.T, app *fiber.App, question string) (*http.Response, string) {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"question": question})
	if err != nil {
		t.Fatalf("marshal chat body: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/ai/chat", strings.NewReader(string(raw)))
	req.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	resp, err := app.Test(req, 30000)
	if err != nil {
		t.Fatalf("POST /ai/chat: %v", err)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read /ai/chat response body: %v", err)
	}
	return resp, string(body)
}

// ═══════════════════════════════════════════════════════════════════════
// BEHAVIOR HALF — the test
// ═══════════════════════════════════════════════════════════════════════

// TestAIConversationBodyNeverReachesAPILog is task-12-brief.md's Step 1,
// run twice against the two DIFFERENT call sites inside streamTurn
// (internal/ai/handler.go) that could plausibly carry conversation text —
// see this file's package comment for why a single "one happy turn"
// scenario would check nothing at all.
//
// Both subtests follow the same fail-closed shape task-12-brief.md's
// "Khuôn 1" names (task 9's silently-vacuous column loop): each first
// PROVES the scenario actually made the target log line fire — with its
// own t.Fatalf, before a single sentinel assertion runs — so a refactor
// that accidentally stops either code path from logging at all turns this
// test RED for saying so, not GREEN for having nothing left to check.
func TestAIConversationBodyNeverReachesAPILog(t *testing.T) {
	pool := store.TestPool(t)

	t.Run("a turn that dies mid-stream after emitting part of the answer", func(t *testing.T) {
		uid := newUser(t, pool, "midstream", 50000)
		stream := &fakeStream{script: []streamStep{
			failStep("the model had started to say: "+answerSentinel, ai.Usage{CompletionTokens: 3}),
		}}
		app := newAIApp(t, uid, ai.HandlerDeps{
			Client:  stream,
			Credits: ai.NewService(pool),
		})

		logs := captureSlog(t)
		question := "please help me understand " + questionSentinel
		resp, body := doChat(t, app, question)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("POST /ai/chat: SSE always starts 200 (see handler.go's Chat doc "+
				"comment — everything that can refuse the turn runs BEFORE the stream "+
				"starts), got %d body=%s", resp.StatusCode, body)
		}

		logged := logs.take()
		if !strings.Contains(logged, "ai turn failed") {
			t.Fatalf("this scenario is built to force streamTurn's error-path log "+
				"line (\"ai turn failed\", the one wrapping RunStream's own error) "+
				"to fire — it did not, so the sentinel checks below would be "+
				"examining an empty/irrelevant buffer and proving nothing. Fix the "+
				"fixture, don't delete this check (task-12-brief.md's fail-closed "+
				"rule). Logged:\n%s", logged)
		}
		if strings.Contains(logged, questionSentinel) {
			t.Errorf("apilog carries the learner's QUESTION after a mid-stream "+
				"provider failure. Logged:\n%s", logged)
		}
		if strings.Contains(logged, answerSentinel) {
			t.Errorf("apilog carries part of the model's ANSWER after a mid-stream "+
				"provider failure. Logged:\n%s", logged)
		}
	})

	t.Run("ChargeTurn itself fails after a fully successful turn", func(t *testing.T) {
		uid := newUser(t, pool, "chargefail", 50000)

		// ChargeTurn's FIRST statement is a pricing lookup (credits.go's
		// pricing method) — deleting DefaultModel's ai_pricing row makes
		// THAT fail deterministically, with no timing race to win: nothing
		// before ChargeTurn in Chat/streamTurn touches ai_pricing at all
		// (EnsureCredit reads ai_credits; Settings/AgentConfig read
		// ai_settings/user_agent_config). The row is read back and restored
		// in t.Cleanup rather than hand-copied from the migration, so this
		// stays correct even if the seeded numbers ever change.
		var costIn, costCachedIn, costOut, credIn, credCachedIn, credOut int64
		if err := pool.QueryRow(context.Background(), `
			SELECT cost_micro_per_1k_in, cost_micro_per_1k_cached_in, cost_micro_per_1k_out,
			       credits_per_1k_in, credits_per_1k_cached_in, credits_per_1k_out
			FROM ai_pricing WHERE model = $1`, ai.DefaultModel).
			Scan(&costIn, &costCachedIn, &costOut, &credIn, &credCachedIn, &credOut); err != nil {
			t.Fatalf("read ai_pricing for %s before deleting it: %v", ai.DefaultModel, err)
		}
		if _, err := pool.Exec(context.Background(),
			`DELETE FROM ai_pricing WHERE model = $1`, ai.DefaultModel); err != nil {
			t.Fatalf("delete ai_pricing row for %s: %v", ai.DefaultModel, err)
		}
		t.Cleanup(func() {
			if _, err := pool.Exec(context.Background(), `
				INSERT INTO ai_pricing (model, cost_micro_per_1k_in, cost_micro_per_1k_cached_in,
				    cost_micro_per_1k_out, credits_per_1k_in, credits_per_1k_cached_in, credits_per_1k_out)
				VALUES ($1,$2,$3,$4,$5,$6,$7)`,
				ai.DefaultModel, costIn, costCachedIn, costOut, credIn, credCachedIn, credOut); err != nil {
				t.Fatalf("restore ai_pricing row for %s: %v", ai.DefaultModel, err)
			}
		})

		stream := &fakeStream{script: []streamStep{
			answerStep("here is the full answer: "+answerSentinel, ai.Usage{CompletionTokens: 5}),
		}}
		app := newAIApp(t, uid, ai.HandlerDeps{
			Client:  stream,
			Credits: ai.NewService(pool),
		})

		logs := captureSlog(t)
		question := "please help me understand " + questionSentinel
		resp, body := doChat(t, app, question)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("POST /ai/chat: want 200 got %d body=%s", resp.StatusCode, body)
		}

		logged := logs.take()
		if !strings.Contains(logged, "ai charge failed after turn") {
			t.Fatalf("this scenario is built to force ChargeTurn to fail (its "+
				"ai_pricing row was deleted above) so streamTurn's \"ai charge "+
				"failed after turn\" line fires — it did not, so the sentinel "+
				"checks below would be examining an empty/irrelevant buffer and "+
				"proving nothing. Logged:\n%s", logged)
		}
		if strings.Contains(logged, questionSentinel) {
			t.Errorf("apilog carries the learner's QUESTION after a failed charge. "+
				"Logged:\n%s", logged)
		}
		if strings.Contains(logged, answerSentinel) {
			t.Errorf("apilog carries the model's ANSWER after a failed charge. "+
				"Logged:\n%s", logged)
		}
	})

	// Round-1 review, Critical: the two subtests above only ever reach
	// streamTurn's own two slog.Error call sites. handler.go's Chat has a
	// THIRD family — Handler.internal, called from the EnsureCredit/
	// Settings/AgentConfig failure branches BEFORE the stream ever starts,
	// with `question` already parsed and live in scope at every one of
	// those call sites. This subtest forces the simplest of the three
	// (Settings) to fail deterministically and checks the exact call site
	// the reviewer's own mutation (handler.go:565,
	// `fmt.Errorf("settings lookup while answering %q: %w", question,
	// err)`) proved live.
	t.Run("h.internal logs a pre-flight failure with the question already in scope", func(t *testing.T) {
		uid := newUser(t, pool, "presettings", 50000)

		// ai_settings is a SINGLETON row (migration 0007's `id boolean
		// PRIMARY KEY DEFAULT true CHECK (id)`), so deleting it makes
		// Service.Settings fail with a plain wrapped pgx.ErrNoRows — no
		// timing race to win, same reasoning as the ai_pricing deletion
		// above. Read back and restored via t.Cleanup rather than
		// hand-copied, for the same reason.
		var basePrompt string
		var creditsPerSearch, costPerSearch, signupGrant int64
		var maxTokens, maxRounds int
		if err := pool.QueryRow(context.Background(), `
			SELECT base_system_prompt, credits_per_web_search, cost_micro_per_web_search,
			       signup_grant_micro, max_tokens_per_turn, max_tool_rounds_per_turn
			FROM ai_settings LIMIT 1`).
			Scan(&basePrompt, &creditsPerSearch, &costPerSearch, &signupGrant, &maxTokens, &maxRounds); err != nil {
			t.Fatalf("read ai_settings before deleting it: %v", err)
		}
		if _, err := pool.Exec(context.Background(), `DELETE FROM ai_settings`); err != nil {
			t.Fatalf("delete ai_settings row: %v", err)
		}
		t.Cleanup(func() {
			if _, err := pool.Exec(context.Background(), `
				INSERT INTO ai_settings (id, base_system_prompt, credits_per_web_search,
				    cost_micro_per_web_search, signup_grant_micro, max_tokens_per_turn,
				    max_tool_rounds_per_turn)
				VALUES (true,$1,$2,$3,$4,$5,$6)`,
				basePrompt, creditsPerSearch, costPerSearch, signupGrant, maxTokens, maxRounds); err != nil {
				t.Fatalf("restore ai_settings row: %v", err)
			}
		})

		// The turn never reaches RunStream on this path (Settings fails
		// before Chat builds a Turn at all), so the fake client's script is
		// never consulted — an empty one is enough, and correct: a
		// non-empty one would silently hide a regression that made Chat
		// start streaming despite the missing settings row.
		app := newAIApp(t, uid, ai.HandlerDeps{
			Client:  &fakeStream{},
			Credits: ai.NewService(pool),
		})

		logs := captureSlog(t)
		question := "please help me understand " + questionSentinel
		resp, body := doChat(t, app, question)
		if resp.StatusCode != http.StatusInternalServerError {
			t.Fatalf("POST /ai/chat with ai_settings deleted: want 500 (h.internal's "+
				"fixed response) got %d body=%s", resp.StatusCode, body)
		}

		logged := logs.take()
		if !strings.Contains(logged, "request failed") || !strings.Contains(logged, "ai.Chat/settings") {
			t.Fatalf("this scenario is built to force h.internal's \"request failed\" "+
				"line (op=ai.Chat/settings) to fire — it did not, so the sentinel "+
				"check below would be examining an empty/irrelevant buffer and "+
				"proving nothing. Logged:\n%s", logged)
		}
		if strings.Contains(logged, questionSentinel) {
			t.Errorf("apilog's destination carries the learner's QUESTION via "+
				"Handler.internal — handler.go's own hand-copied twin of "+
				"apilog.Internal, the exact call site round-1 review's mutation "+
				"proved live. Logged:\n%s", logged)
		}
	})
}

// ═══════════════════════════════════════════════════════════════════════
// STRUCTURE HALF
// ═══════════════════════════════════════════════════════════════════════

// forbiddenAPILogArgNames is task-12-brief.md's Step 2 checklist, verbatim:
// no call into the apilog package may carry, on its own source line, a
// bare identifier spelled exactly one of these.
var forbiddenAPILogArgNames = []string{
	"body", "content", "question", "answer", "messages", "prompt",
}

// forbiddenAPILogArgRe compiles one whole-word regex per name in
// forbiddenAPILogArgNames, built once so apilogArgScan (called once per
// source file below, and again per synthetic fixture in the
// anti-vacuity test) doesn't recompile six patterns per line. Word
// boundaries matter the same way they do in
// provider_key_never_leaks_test.go's providerKeyCfgWord: `\bcontent\b`
// matches the standalone word "content" but not "Content-Type" glued onto
// it with no boundary character in between... except a hyphen IS a
// non-word character in RE2, so `\bcontent\b` DOES match the "content" in
// "Content-Type" too. No real apilog call site in this repo carries
// "Content-Type" on the same line as of this writing (checked by hand),
// so this is a known, undemonstrated false-positive shape rather than a
// live one — recorded here rather than silently relied upon.
var forbiddenAPILogArgRe = func() map[string]*regexp.Regexp {
	out := make(map[string]*regexp.Regexp, len(forbiddenAPILogArgNames))
	for _, name := range forbiddenAPILogArgNames {
		out[name] = regexp.MustCompile(`\b` + name + `\b`)
	}
	return out
}()

// apilogCallRe matches a call into the log destination this gate is about,
// on a single source line — THREE independent shapes, not one.
//
// ROUND 1 REVIEW, CRITICAL: the first version of this pattern only matched
// `apilog\.\w+\(` — a literal package-qualified call. That is exactly what
// let a real leak through: internal/ai/handler.go's `Handler.internal`
// (handler.go, near the bottom) is a HAND-COPIED TWIN of apilog.Internal —
// same "request failed" message, same method/path/op/err fields, written
// straight to slog.Default() (apilog.go's own doc comment explains why it
// isn't literally apilog.Internal: no *fiber.Ctx survives to streamTurn) —
// and it never once contains the substring "apilog." itself, so the old
// pattern was BLIND to all eight of its call sites, three of which run
// inside Chat with `question` already parsed and in scope (handler.go's
// EnsureCredit/Settings/AgentConfig failure branches). Reviewer proved it
// live: `fmt.Errorf("settings lookup while answering %q: %w", question,
// err)` at the AgentConfig-adjacent call site reached slog with the
// learner's literal question text, and this gate stayed green throughout
// (go test ./internal/apilog/ was 5/5 passing on that mutation).
//
// The three alternatives below, matched against the SAME lowercased line:
//
//  1. `apilog\.\w+\(` — an actual call into the apilog package. Not
//     hardcoded to "Internal"/"Panic" (today's only two exports): a future
//     third apilog function is covered the moment it exists.
//  2. `\.internal\(` — the hand-copied-twin shape the Critical above is
//     about. Deliberately not scoped to `h.internal(` specifically: ANY
//     receiver's `.internal(` method is a plausible second hand-copy of
//     the same pattern in some future package, and this repo has exactly
//     one such method today (checked by hand:
//     `grep -rn '\.internal(' --include='*.go' . | grep -v _test.go`
//     resolves to Handler.internal's eight call sites and nothing else) —
//     so widening past `h\.internal\(` costs nothing today and closes the
//     door on the next hand-copy landing in a different package under a
//     different receiver name.
//  3. `\bslog\.(?:error|warn|info|debug)\(` — a direct call into log/slog,
//     bypassing BOTH of the above. This is the shape neither #1 nor #2
//     catches: a log line written with no wrapper function at all.
//     streamTurn's own two call sites (handler.go, the ones task-12-brief
//     originally asked this gate to watch) are exactly this shape, and so
//     is apilog.go's own Internal/Panic — matching this needle means the
//     scan now also re-derives its own two ORIGINAL targets without
//     needing the apilog-prefix needle for them at all. Restricted to the
//     four named levels (not `slog\.` bare) so it does not also match
//     `slog.Default(` (apilog.go:22, a logger constructor, not a sink).
//
// Checked by hand before enabling (see task-12-report.md's round-1 section
// for the exact counts): on today's source, widening from 25 matched
// lines to 38 introduces ZERO new false positives — none of the 13 newly
// matched lines (8 `.internal(`, 5 raw `slog.*(`) carries any of the six
// forbidden words on the same line.
var apilogCallRe = regexp.MustCompile(
	`\bapilog\.[a-z_][a-z0-9_]*\(` +
		`|\.internal\(` +
		`|\bslog\.(?:error|warn|info|debug)\(`)

// minProductGoFilesForAPILogArgScan and apilogArgScanSentinels are the
// fail-closed floor task-12-brief.md's own "Khuôn 1" names (task 9's
// silent-empty-loop) applied to THIS scan: a broken path or an
// over-eager directory filter that makes the walk below read zero files
// must turn this gate RED, not leave it vacuously green forever. Measured
// 2026-08-29 (after the round-1 widening of apilogCallRe above): apps/api
// has 37 non-test .go files (`find apps/api -name '*.go' ! -name
// '*_test.go' | wc -l`) and 38 lines matching apilogCallRe's three-shape
// union (`grep -rnE '(apilog\.[A-Za-z_][A-Za-z0-9_]*\(|\.internal\(|slog\.
// (Error|Warn|Info|Debug)\()' --include='*.go' . | grep -v _test.go | wc
// -l`, run from apps/api — up from 25 before the widening, since that
// count only ever saw the `apilog\.` shape). Both floors below sit well
// under the measured numbers so one legitimate file deletion or one call
// site's removal never trips them on its own; the REAL check for "still
// finding real call sites" is the sentinel list, same split
// provider_key_never_leaks_test.go's own floor/sentinel pair keeps.
const (
	minProductGoFilesForAPILogArgScan = 20
	minAPILogCallSitesFound           = 25
)

// apilogArgScanSentinels names files a violation would land in if it
// landed anywhere reachable from AI conversation content today (the ai
// package itself and its caller, server.go), plus one file from three
// OTHER packages with real, unrelated apilog.Internal call sites — proof
// the walk below is reading packages that have nothing to do with AI at
// all, not just the ai package this task was written to worry about.
//
// internal/ai/handler.go and internal/apilog/apilog.go are anchors for the
// WALK (proof these files are actually read), not a claim that a
// violation sits in them today — round-1 review caught an earlier version
// of this comment overclaiming the opposite for handler.go specifically:
// under the ORIGINAL apilogCallRe (apilog-prefix only), handler.go
// contained ZERO matched lines (that was the whole Critical finding — see
// apilogCallRe's doc comment), so calling it "where a violation would
// land" was false at the time it was written. After the round-1 widening
// both files genuinely do carry matched lines (handler.go: eight
// `.internal(` sites plus two `slog.Error(`; apilog.go: its own two
// `slog.Error(` definitions), so the claim is now actually true — recorded
// here so the fix and the reason it was needed both stay legible.
var apilogArgScanSentinels = []string{
	"internal/ai/handler.go",
	"internal/apilog/apilog.go",
	"internal/server/server.go",
	"internal/auth/handler.go",
	"internal/catalog/handler.go",
	"internal/sync/handler.go",
}

// apilogSkippedDirs mirrors provider_key_never_leaks_test.go's own list —
// apps/api has none of these today (checked by hand: cmd/, internal/,
// migrations/ only), but the walk below is written to survive one
// appearing without silently reading into it.
var apilogSkippedDirs = map[string]bool{
	".git":         true,
	"node_modules": true,
	"vendor":       true,
}

// apilogGateRepoRoot walks up from the test binary's working directory
// (which `go test` sets to this package's directory) to the nearest
// go.mod. That lands at apps/api, not the monorepo root: the apilog
// package this gate is about only exists inside the apps/api Go module —
// apps/web and apps/vault are TypeScript, and nothing outside apps/api can
// import "github.com/vndee/tuhoc-api/internal/apilog" at all — so scanning
// wider than apps/api's own module would read source that categorically
// cannot call this package.
func apilogGateRepoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("could not get working directory: %v", err)
	}
	for range 8 {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Fatalf("could not find go.mod walking up from %q — this scan anchors "+
		"at the apps/api Go module root and does not fall back silently.", dir)
	return ""
}

// apilogGoSources reads every non-test .go file under apps/api, lowercased
// (forbiddenAPILogArgRe and apilogCallRe are matched against lowercased
// text, same convention provider_key_never_leaks_test.go uses), keyed by
// path relative to apps/api. *_test.go is excluded at read time: both
// TestAIConversationBodyNeverReachesAPILog above and the anti-vacuity test
// below legitimately construct apilog-call-shaped strings in Go source, and
// scanning test files would make this gate trip on its own fixtures.
func apilogGoSources(t *testing.T) map[string]string {
	t.Helper()
	root := apilogGateRepoRoot(t)

	out := map[string]string{}
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if p != root && apilogSkippedDirs[info.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		out[filepath.ToSlash(rel)] = strings.ToLower(string(b))
		return nil
	})
	if err != nil {
		t.Fatalf("could not walk Go sources under %s: %v", root, err)
	}

	if len(out) < minProductGoFilesForAPILogArgScan {
		t.Fatalf("only read %d product .go files under %s (floor %d) — a bad "+
			"path or an over-eager directory filter ate the tree. This scan is "+
			"CURRENTLY CHECKING NOTHING; don't lower the floor, fix the path.",
			len(out), root, minProductGoFilesForAPILogArgScan)
	}
	var missing []string
	for _, s := range apilogArgScanSentinels {
		if _, ok := out[s]; !ok {
			missing = append(missing, s)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("read %d files but MISSING %d anchor files: %s. If one was "+
			"deliberately renamed or removed, update apilogArgScanSentinels "+
			"consciously; otherwise this scan is missing exactly where it needs "+
			"to look.", len(out), len(missing), strings.Join(missing, ", "))
	}
	t.Logf("apilog conversation-arg scan read %d product .go files under %s", len(out), root)
	return out
}

// apilogArgScan returns sorted "path:line: [needle] src" hits for every
// line that BOTH matches apilogCallRe (a call into the apilog package) AND
// contains at least one forbidden identifier as a whole word. Split out of
// the test function so it can be driven by synthetic sources in
// TestAPILogArgScanIsNotVacuous, the same "prove the detector itself is
// alive" split provider_key_never_leaks_test.go's providerKeyScan keeps.
func apilogArgScan(sources map[string]string) []string {
	var hits []string
	for path, src := range sources {
		for i, line := range strings.Split(src, "\n") {
			if !apilogCallRe.MatchString(line) {
				continue
			}
			for _, name := range forbiddenAPILogArgNames {
				if forbiddenAPILogArgRe[name].MatchString(line) {
					hits = append(hits, fmt.Sprintf("%s:%d: [%s] %s",
						path, i+1, name, strings.TrimSpace(line)))
				}
			}
		}
	}
	sort.Strings(hits)
	return hits
}

// apilogCallSiteCount counts lines apilogCallRe matches, REGARDLESS of
// whether any forbidden name is present — the fail-closed floor for "the
// call-detection needle itself still recognizes real apilog call sites,"
// independent of whether any of them happen to violate anything today.
// Without this, a typo that broke apilogCallRe (e.g. matching
// "apilog\\." with a literal escaped-wrong regex) would make apilogArgScan
// find zero call sites, zero violations, and report success for a reason
// that has nothing to do with the property being true.
func apilogCallSiteCount(sources map[string]string) int {
	n := 0
	for _, src := range sources {
		for _, line := range strings.Split(src, "\n") {
			if apilogCallRe.MatchString(line) {
				n++
			}
		}
	}
	return n
}

// TestAPILogArgScanIsNotVacuous proves apilogArgScan and apilogCallRe are
// both still alive, on synthetic sources, before the real scan below is
// trusted to mean anything — the same self-check
// TestProviderKeyStructuralScanIsNotVacuous runs for its own detector.
func TestAPILogArgScanIsNotVacuous(t *testing.T) {
	// A direct violation: a bare `question` identifier on the same line as
	// an apilog.Internal call — the exact shape task-12-brief.md's Step 2
	// names.
	violating := map[string]string{
		"internal/ai/handler.go": strings.ToLower(`package ai
func streamTurn(question string, err error) {
	apilog.Internal(c, "ai.Chat/turn", fmt.Errorf("turn failed for %s: %w", question, err))
}`),
	}
	if got := apilogArgScan(violating); len(got) == 0 {
		t.Error("apilogArgScan did not catch a synthetic apilog.Internal call " +
			"carrying a bare `question` identifier — the detector is dead")
	}

	// apilog.Panic must be caught too, not just apilog.Internal — this is
	// what apilogCallRe's generic `apilog\.\w+\(` match (rather than two
	// hardcoded names) is for.
	violatingPanic := map[string]string{
		"internal/server/server.go": strings.ToLower(`package server
func recoverHandler(answer string) {
	apilog.Panic(c, answer, stack)
}`),
	}
	if got := apilogArgScan(violatingPanic); len(got) == 0 {
		t.Error("apilogArgScan did not catch a synthetic apilog.Panic call " +
			"carrying a bare `answer` identifier — the detector is dead for " +
			"apilog.Panic specifically")
	}

	// Round-1 review, Critical: a hand-copied twin of apilog.Internal that
	// never contains the literal substring "apilog." at all — the EXACT
	// shape that let Handler.internal (handler.go) slip past the original
	// version of this scan. Proves the `.internal(` alternative in
	// apilogCallRe is alive on its own, independent of the apilog-prefix
	// alternative above.
	violatingHandCopiedTwin := map[string]string{
		"internal/ai/handler.go": strings.ToLower(`package ai
func (h *Handler) internal(c *fiber.Ctx, op string, err error) error {
	return h.internal(c, op, fmt.Errorf("settings lookup while answering %q: %w", question, err))
}`),
	}
	if got := apilogArgScan(violatingHandCopiedTwin); len(got) == 0 {
		t.Error("apilogArgScan did not catch a synthetic `.internal(` call " +
			"carrying a bare `question` identifier, with no \"apilog.\" prefix " +
			"anywhere on the line — this is the exact shape round-1 review's " +
			"Critical finding used to slip past the pre-fix version of this scan " +
			"(Handler.internal, handler.go); the `.internal(` alternative in " +
			"apilogCallRe is dead")
	}

	// A direct, unwrapped slog call — no "apilog." prefix and no ".internal("
	// wrapper at all — must also be caught. This is the shape streamTurn's
	// own two call sites use, and the shape apilog.go's Internal/Panic use
	// internally.
	violatingRawSlog := map[string]string{
		"internal/ai/handler.go": strings.ToLower(`package ai
func f(content string) {
	slog.Error("ai turn failed", "op", "ai.Chat/turn", "content", content)
}`),
	}
	if got := apilogArgScan(violatingRawSlog); len(got) == 0 {
		t.Error("apilogArgScan did not catch a synthetic raw slog.Error call " +
			"carrying a bare `content` identifier — the direct-slog alternative " +
			"in apilogCallRe is dead")
	}

	// slog.Default( (a logger constructor, not a sink — apilog.go:22 calls
	// it once, legitimately) must NOT be treated as a call this scan cares
	// about, even with a forbidden word coincidentally on the same line.
	benignSlogDefault := map[string]string{
		"internal/apilog/apilog.go": strings.ToLower(`package apilog
func f(prompt string) {
	l := slog.Default()
	_ = prompt
	_ = l
}`),
	}
	if got := apilogArgScan(benignSlogDefault); len(got) != 0 {
		t.Errorf("apilogArgScan flagged a slog.Default( line (a logger "+
			"constructor, not a sink) just because a forbidden word appeared "+
			"on the same line — the direct-slog alternative in apilogCallRe "+
			"must be scoped to Error/Warn/Info/Debug specifically: %v", got)
	}

	// A word appearing on an apilog-call line but NOT as a whole word (a
	// substring of a longer identifier) must NOT trip this — the same
	// whole-word discipline providerKeyCfgWord keeps for `cfg`.
	benignSubstring := map[string]string{
		"internal/ai/handler.go": strings.ToLower(`package ai
func f(op string, err error) {
	apilog.Internal(c, "ai.Chat/promptless", err)
}`),
	}
	if got := apilogArgScan(benignSubstring); len(got) != 0 {
		t.Errorf("apilogArgScan flagged \"promptless\" (contains \"prompt\" as a "+
			"substring, not a whole word) on an apilog.Internal line — whole-word "+
			"matching is broken: %v", got)
	}

	// A forbidden word present on a DIFFERENT line from the apilog call
	// must not trip this — same-line is the scan's whole scope, and this
	// is the shape its own doc comment says it is blind to when the call
	// itself is what wraps.
	benignDifferentLine := map[string]string{
		"internal/ai/handler.go": strings.ToLower(`package ai
func f(question string, err error) {
	_ = question
	apilog.Internal(c, "ai.Chat/turn", err)
}`),
	}
	if got := apilogArgScan(benignDifferentLine); len(got) != 0 {
		t.Errorf("apilogArgScan flagged a forbidden word on a DIFFERENT line "+
			"from the apilog call — this scan is documented as same-line only; "+
			"if it now spans lines, the doc comment above needs rewriting too: %v", got)
	}

	// apilogCallSiteCount must actually count something on real source —
	// same "the floor itself has to be reachable" check
	// TestProviderKeyStructuralScanIsNotVacuous closes with a real-repo
	// read. The floor ITSELF is enforced only once, as a t.Fatalf inside
	// TestAPILogCallSitesNeverNameConversationBodyArgs below (the actual
	// gate) — asserting the identical threshold a second time here, on the
	// same real-repo read, would be checking the same fact twice under two
	// different names rather than checking something new (round-1 review,
	// Minor). This call stays only to prove apilogGoSources/
	// apilogCallSiteCount don't panic or silently return zero when driven
	// end-to-end on the real tree, logged for visibility.
	t.Logf("apilogCallSiteCount found %d real apilog call sites under apps/api",
		apilogCallSiteCount(apilogGoSources(t)))
}

// TestAPILogCallSitesNeverNameConversationBodyArgs is the structure half —
// see this file's package comment for what it catches, and its own narrow,
// documented limits.
func TestAPILogCallSitesNeverNameConversationBodyArgs(t *testing.T) {
	sources := apilogGoSources(t)

	if n := apilogCallSiteCount(sources); n < minAPILogCallSitesFound {
		t.Fatalf("found only %d apilog call sites in real source (floor %d) — "+
			"this scan is not looking at what it thinks it's looking at; the "+
			"violation check below would be checking too little to mean "+
			"anything. Don't lower the floor, find out why the count dropped.",
			n, minAPILogCallSitesFound)
	}

	for _, hit := range apilogArgScan(sources) {
		t.Errorf("a call into apilog carries a bare identifier named body/"+
			"content/question/answer/messages/prompt on its own source line: "+
			"%s\nspec §0.1's global constraint is that apilog NEVER carries an "+
			"AI conversation body — only metadata (user, model, tokens, "+
			"credits). If this identifier genuinely does not hold conversation "+
			"text (e.g. it's an unrelated `content` meaning something else "+
			"entirely), rename it at the call site rather than loosening this "+
			"scan — a scan that stops meaning what its own comment says is "+
			"worse than no scan.", hit)
	}
}

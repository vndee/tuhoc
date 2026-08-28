// stream.go adds a streaming path alongside agent.go's Run: the same tool
// loop, but pushing text to the caller AS THE MODEL GENERATES IT instead of
// making the learner wait for a whole turn (possibly several tool rounds)
// to finish before seeing a single character.
//
// Task 0's measurement settled the shape question the task-7 brief left
// open ("stream shape depends on a measurement not yet taken"): DeepSeek
// streams fine alongside tool_calls (docs/deepseek-measured.md §4), so this
// file streams every round directly — it never falls back to a
// non-streaming round-then-stream-the-last-turn split.
//
// Two details from that same measurement drive the parsing in
// (*Client).CompleteStream below:
//   - tool_calls.function.arguments arrives in FRAGMENTS across many SSE
//     chunks, keyed by "index" — the first fragment carries id/type/name
//     with an empty arguments string, every later fragment for that index
//     carries only another slice of arguments to append. Reading arguments
//     once (first chunk only) silently drops the rest of a tool call's
//     JSON.
//   - "usage" rides in the FINAL chunk of the stream (the one carrying
//     finish_reason), and the stream itself ends with a literal four-byte
//     line "[DONE]" — not a JSON object, and never something this file
//     turns into a delta.
package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Event is one piece of a streaming turn, forwarded to the caller's emit
// function as RunStream produces it. Kind is one of "delta" (a fragment of
// the model's final text answer, in the order generated), "tool" (the
// model is about to call the tool named in Text), "done" (the turn
// finished successfully — no more events follow), or "error" (the turn
// ended in failure; Text carries the error message, and RunStream also
// returns a non-nil error from the same call).
//
// This is the exact shape task-7-brief.md's Interfaces section specifies —
// Task 9/11/13 depend on this type and on RunStream's signature staying
// exactly as declared here.
type Event struct {
	Kind string
	Text string
}

// EventKindDelta/Tool/Done/Error name the four values Event.Kind takes —
// exported so callers (Task 11's handler, mapping an Event to an SSE wire
// event) don't have to duplicate the four bare strings from the brief.
const (
	EventKindDelta = "delta"
	EventKindTool  = "tool"
	EventKindDone  = "done"
	EventKindError = "error"
)

// StreamCompleter is the narrow surface RunStream needs from a DeepSeek
// client for the streaming path — one method, CompleteStream, mirroring
// Completer's shape (agent.go) but taking an onDelta callback instead of
// returning one final Completion with no progress in between.
//
// SELF-DECIDED (task-7-brief.md says explicitly: Completer, as Task 6 left
// it, cannot serve RunStream — extend it or add a second interface, your
// call, write down why). Two options were on the table:
//
//   - Extend Completer itself to require CompleteStream too.
//   - Add a second, separate interface (the choice made here).
//
// Reasons for a second interface, not a wider Completer:
//
//  1. Zero blast radius on Task 6's contract. task-6-brief.md's own closing
//     line says Agent/Turn/Result carry forward UNCHANGED into Task 7/9/11
//     — and Completer is as much a part of that contract as the struct
//     types are. Widening Completer to require CompleteStream would break
//     every existing Completer implementation the moment this file lands,
//     including agent_test.go's fakeCompleter (Task 6's own test double) —
//     Agent{Client: fc} stops compiling until fakeCompleter grows a stub
//     CompleteStream nobody asked it to have. A second interface leaves
//     agent.go, Completer, and agent_test.go entirely untouched: every line
//     Task 6 wrote keeps compiling and keeps meaning what it meant.
//  2. Run and RunStream stay orthogonal capabilities, not one fused one.
//     Nothing about a non-streaming caller (Task 9's batch-style use, if it
//     ever exists, or any future test that only cares about Run) needs to
//     know streaming exists at all. Forcing every Completer to also grow a
//     CompleteStream method — even a panic stub — makes "does this type
//     support streaming" a question every implementer has to answer whether
//     or not they care, instead of a question only RunStream's caller asks.
//  3. This is the same reasoning agent.go already wrote down for choosing
//     an interface over a concrete *Client in the first place ("accept
//     interfaces, return structs") — narrow, single-purpose interfaces over
//     one interface trying to describe everything a client can do.
//
// The cost of this choice: Agent.Client is still declared as Completer
// (agent.go, unchanged), so RunStream must type-assert it to StreamCompleter
// at the top of the call — see RunStream below. A caller that hands Agent a
// Completer without also implementing StreamCompleter gets a clear error
// immediately, before any round runs (TestRunStreamRequiresStreamCompleter,
// stream_test.go) — not a nil-interface panic buried inside the loop.
type StreamCompleter interface {
	CompleteStream(ctx context.Context, req Request, onDelta func(text string) error) (Completion, error)
}

// var _ StreamCompleter forces a build-time failure if *Client ever drifts
// from the signature StreamCompleter requires — same discipline as
// agent.go's `var _ Completer = (*Client)(nil)`.
var _ StreamCompleter = (*Client)(nil)

// RunStream is RunStream's contract with Task 9 (credit charging), Task 11
// (the /ai/chat handler turning Event into SSE wire lines), and Task 13:
// same turn semantics as Run (agent.go), but emit is called with an Event
// for every piece of progress as it happens, instead of the caller getting
// nothing until the whole turn — possibly several tool rounds — completes.
//
// RunStream keeps every invariant Run established (task-7-brief.md is
// explicit that losing one is a bug, not a style choice this file gets to
// make differently):
//
//   - buildMessages/enabledTools (agent.go) are reused UNCHANGED — this
//     file does not re-implement message ordering or tool gating, so the
//     stable-prefix-for-cache and ToolsEnabled-gates-both-directions
//     guarantees Run already has automatically hold here too.
//   - The tool_calls ARRAY is run to completion every round, one
//     Message{Role:"tool"} per tool_call_id, on every branch — see the loop
//     below, copied from Run's shape.
//   - WebSearches increments only after a tool named "web_search" actually
//     RUNS successfully, never at the point the model merely asks.
//   - Usage accumulates all four fields across every completed round.
//   - The last round sends ToolChoiceNone, and ErrToolBudgetExhausted is
//     returned (wrapped) under the exact same condition Run uses.
//   - err != nil still returns a Result carrying Usage from every round
//     that finished before the error — TestRunStreamErrorStillCarriesUsageFromCompletedRounds
//     pins this the same way agent_test.go's TestRunErrorStillCarriesUsageFromCompletedRounds
//     pins it for Run.
//
// The loop body below is a near-verbatim copy of Run's (agent.go) — same
// round structure, same tool-execution block, differing only in the emit
// calls and the two early returns when emit itself fails. That duplication
// has no test-enforced lattice keeping the two in lockstep as either one
// changes (round-1 review, I3) — TestRunAndRunStreamProduceSameResultForSameScenario
// (stream_test.go) is the cheap net cast over that gap: same fixture driven
// through both Run and RunStream, asserting equal Result. It cannot catch
// every possible divergence, but it turns "two silent copies" into "two
// copies one test compares" — a fix applied to Run's tool-execution block
// (e.g. the debt noted at Result.WebSearches's doc comment in agent.go)
// that is not mirrored here will show up as this test going red, not as a
// silent divergence nobody notices until Task 9 charges the wrong amount.
//
// SELF-DECIDED — Event semantics (task-7-brief.md defines the Kind enum but
// not what triggers each one; Task 9/11/13 need this settled, not guessed
// at three separate call sites later):
//
//   - "delta": one per non-empty content fragment CompleteStream reports via
//     onDelta, forwarded verbatim and in order. Emitted DURING a round, as
//     text is generated — this is the whole point of streaming.
//
//   - "tool": one per tool_call, emitted right after a round finishes and
//     BEFORE that tool actually runs — Text is the tool's function name, so
//     a frontend can show e.g. "looking up chapter 1...". Not emitted for
//     the disabled/unknown-tool branch differently than the allowed branch
//     — the learner doesn't need to know a tool_call was rejected before
//     the loop hands the model an "Error: ... not available" tool message
//     and moves on.
//
//   - "done": exactly one, after the LAST successful round, once
//     result.Answer is set and no error path is taken — never emitted on
//     any error exit. Text is empty: every character of the final answer
//     already went out as "delta" events during the last round: sending it
//     again in "done" would just duplicate everything the caller already
//     reconstructed.
//
//   - "error": Text set to err.Error(), attempted (best-effort) on every
//     error that arises ONCE THE TURN HAS BEGUN — a CompleteStream failure
//     inside a round, or ErrToolBudgetExhausted at the final round. The
//     emit call's own error (the learner's connection is probably already
//     gone at that point) is deliberately NOT retried as another "error"
//     event — RunStream is already returning the primary error regardless,
//     and the sink is already known broken, so a second attempt through
//     the same broken sink would just be more of the same failure. This
//     covers the two `emitErr` return paths below (a failed "tool"/"done"
//     emit): no redundant "error" event follows either, on purpose.
//
//     EXCEPTION, not a bug (round-1 review, I2 — a prior version of this
//     comment claimed "every error return path" without carving this out,
//     which read as a promise the code below does not keep): the
//     StreamCompleter type-assertion failure right below returns BEFORE
//     any round starts — the turn never began, so there is nothing to
//     announce "an error mid-turn" about, and emit is guaranteed to never
//     be called on this path (TestRunStreamRequiresStreamCompleter pins
//     this as the intended contract, not an oversight). This is a wiring
//     error (Agent built with the wrong Client type), not a per-request
//     runtime failure — callers (Task 11's handler) must check RunStream's
//     returned error directly regardless of Event, exactly as they already
//     have to for every other Go function that returns (T, error); Event
//     is a progress feed for a turn that's under way, not a replacement
//     for checking the return value.
func (a *Agent) RunStream(ctx context.Context, t Turn, emit func(Event) error) (Result, error) {
	sc, ok := a.Client.(StreamCompleter)
	if !ok {
		// No Event is emitted here — see the EXCEPTION paragraph above.
		return Result{}, fmt.Errorf("ai: RunStream requires a Client that also implements StreamCompleter, got %T", a.Client)
	}

	msgs := buildMessages(t)
	tools := a.enabledTools(t.ToolsEnabled)
	enabledSet := make(map[string]bool, len(t.ToolsEnabled))
	for _, name := range t.ToolsEnabled {
		enabledSet[name] = true
	}

	maxRounds := a.Settings.MaxToolRoundsPerTurn
	if maxRounds <= 0 {
		// Same defensive clamp as Run (agent.go) — see its comment for why:
		// only reachable from a hand-built Settings{}, never from a real DB
		// row (migration 0007's CHECK keeps this column positive there).
		maxRounds = 1
	}

	var result Result

	for round := 1; round <= maxRounds; round++ {
		isLastRound := round == maxRounds
		toolChoice := ToolChoiceAuto
		if isLastRound {
			toolChoice = ToolChoiceNone
		}

		completion, err := sc.CompleteStream(ctx, Request{
			Model:      t.Model,
			Messages:   msgs,
			Tools:      tools,
			MaxTokens:  a.Settings.MaxTokensPerTurn,
			ToolChoice: toolChoice,
		}, func(delta string) error {
			return emit(Event{Kind: EventKindDelta, Text: delta})
		})
		if err != nil {
			streamErr := fmt.Errorf("ai: agent stream round %d: %w", round, err)
			_ = emit(Event{Kind: EventKindError, Text: streamErr.Error()})
			return result, streamErr
		}

		result.Usage.PromptTokens += completion.Usage.PromptTokens
		result.Usage.CompletionTokens += completion.Usage.CompletionTokens
		result.Usage.CacheHitTokens += completion.Usage.CacheHitTokens
		result.Usage.CacheMissTokens += completion.Usage.CacheMissTokens

		if isLastRound || len(completion.Message.ToolCalls) == 0 {
			result.Answer = completion.Message.Content
			if isLastRound && len(completion.Message.ToolCalls) > 0 && result.Answer == "" {
				budgetErr := fmt.Errorf("ai: agent stream round %d: %w", round, ErrToolBudgetExhausted)
				_ = emit(Event{Kind: EventKindError, Text: budgetErr.Error()})
				return result, budgetErr
			}
			if emitErr := emit(Event{Kind: EventKindDone}); emitErr != nil {
				return result, emitErr
			}
			return result, nil
		}

		// Model wants tools and there is round budget left — run the WHOLE
		// tool_calls array (parallel calls, docs/deepseek-measured.md §3),
		// same shape as Run's loop below.
		msgs = append(msgs, completion.Message)
		for _, tc := range completion.Message.ToolCalls {
			result.ToolCalls++

			if emitErr := emit(Event{Kind: EventKindTool, Text: tc.Function.Name}); emitErr != nil {
				return result, emitErr
			}

			var content string
			runner, known := a.Tools[tc.Function.Name]
			// allowed requires BOTH known (Agent.Tools has it) AND enabled
			// for THIS turn — see agent.go's Run for the full reasoning
			// (a disabled tool must not run even if a stale History entry
			// makes the model call it again).
			allowed := known && enabledSet[tc.Function.Name]
			if !allowed {
				content = fmt.Sprintf("Error: tool %q is not available in this turn.", tc.Function.Name)
			} else {
				out, runErr := runner.Run(ctx, tc.Function.Arguments)
				if runErr != nil {
					content = fmt.Sprintf("Error: tool %q failed: %s", tc.Function.Name, runErr)
				} else {
					content = out
					if tc.Function.Name == webSearchToolName {
						result.WebSearches++
					}
				}
			}

			msgs = append(msgs, Message{Role: "tool", Content: content, ToolCallID: tc.ID})
		}
	}

	// Unreachable for the same reason as Run's trailing return — see its
	// comment. Kept only because Go requires a return after the loop.
	return result, nil
}

// wireStreamChunk is one decoded "data: {...}" SSE line from DeepSeek's
// streaming chat-completions endpoint (docs/deepseek-measured.md §4).
//
// FinishReason is a *string, not a string, because most chunks carry
// "finish_reason":null and only the LAST one carries a real value — a bare
// string field can't tell "absent/null" apart from "empty string", and this
// file needs to know which chunk is the last one to also read Usage from
// the same object.
type wireStreamChunk struct {
	Choices []struct {
		Delta struct {
			Content   string `json:"content"`
			ToolCalls []struct {
				Index    int    `json:"index"`
				ID       string `json:"id"`
				Type     string `json:"type"`
				Function struct {
					Name      string `json:"name"`
					Arguments string `json:"arguments"`
				} `json:"function"`
			} `json:"tool_calls"`
		} `json:"delta"`
		FinishReason *string `json:"finish_reason"`
	} `json:"choices"`
	Usage *Usage `json:"usage"`
}

// sseDoneMarker is the literal, non-JSON payload DeepSeek sends to end a
// stream (docs/deepseek-measured.md §4: "a literal four-character string
// [DONE]", not an object). CompleteStream below checks for this BEFORE
// attempting json.Unmarshal, and stops reading without ever treating it as
// a chunk — this is what keeps it from becoming a spurious empty delta
// (task-7-brief.md Step 1 / task instructions item #1).
const sseDoneMarker = "[DONE]"

// streamToolCallAcc accumulates one tool_call's fragments across many SSE
// chunks, keyed by the "index" DeepSeek repeats on every fragment for that
// call (docs/deepseek-measured.md §4). Only the FIRST fragment for a given
// index carries id/type/function.name; every fragment carries a slice of
// arguments to append — args is a strings.Builder specifically so appending
// N small fragments is O(N) total, not O(N^2) from repeated string
// concatenation.
type streamToolCallAcc struct {
	id, typ, name string
	args          strings.Builder
}

// CompleteStream sends one chat-completions turn to DeepSeek with
// "stream": true and reads the SSE response, calling onDelta for every
// non-empty content fragment as it arrives and returning the fully
// assembled Completion once the stream ends (either "[DONE]" or EOF).
//
// Unlike Complete (client.go), which REJECTS Request.Stream == true,
// CompleteStream always sends "stream": true regardless of req.Stream —
// calling this method already says "I want a stream" unambiguously, so
// there is no silent-downgrade risk analogous to the one Complete guards
// against (client.go's round-1 review, Important #4): a caller of THIS
// method never gets back a non-streaming call it didn't ask for, because
// there is no non-streaming behavior this method can fall back to.
//
// TIMEOUT — SELF-DECIDED, REVISED (task-7-brief.md: "Complete wraps its own
// 90s context.WithTimeout per call; consider the equivalent for stream, and
// remember a multi-round turn can run long").
//
// ROUND 1 REVIEW, I4 — the first version of this method wrapped a flat
// context.WithTimeout(ctx, defaultTimeout) around the WHOLE call, same
// granularity as Complete. Review did the arithmetic that version's comment
// waved away as "not measurable": ai_settings' seeded max_tokens_per_turn
// is 8192 (migration 0007), and §1's measurement shows reasoning_tokens
// live INSIDE completion_tokens for the Thinking-mode model this project
// uses — so a single round generating close to that budget, at ordinary
// generation speeds, needs far more than 90s wall-clock:
//
//	20 tok/s → 410s (6.8 min)
//	40 tok/s → 205s (3.4 min)
//	60 tok/s → 137s (2.3 min)
//
// all several times past a flat 90s bound. A wall-clock timeout would abort
// a completely healthy, steadily-progressing long answer — exactly the
// case streaming exists to serve well. That is not a hypothetical edge
// case this project can defer; it is the ordinary case for any answer of
// real length.
//
// FIX: streamIdleTimeout (below) bounds IDLENESS, not total duration. A
// cancellable context (readCtx) is derived from the caller's ctx with NO
// deadline of its own; a single time.AfterFunc timer cancels readCtx if
// streamIdleTimeout passes with no progress, and is reset — pushed back out
// — on every unit of progress: right after headers arrive (resp obtained)
// and again on every single scanner.Scan() success (every SSE line read,
// data or blank). A stream that keeps producing SOMETHING at least once
// every streamIdleTimeout can run indefinitely; one that goes silent for
// that long — genuinely stuck, not just slow — gets cut, with an error
// message that says "idle timeout" so it reads distinctly from a network
// failure or a caller-initiated cancellation (see the two ctx.Err() /
// readCtx.Err() checks below). No goroutine is left running either way:
// the timer's callback (cancelRead) only ever runs to fire-and-return, and
// `defer idleTimer.Stop()` disarms it on every return path before that can
// happen at all when the call finishes normally.
//
// streamIdleTimeout is a `var`, not a `const`, so stream_test.go can shrink
// it for TestCompleteStreamIdleTimeoutFiresOnNoProgress /
// TestCompleteStreamIdleTimeoutResetsOnEachChunk without a real 90s wait.
var streamIdleTimeout = defaultTimeout

func (c *Client) CompleteStream(ctx context.Context, req Request, onDelta func(text string) error) (Completion, error) {
	readCtx, cancelRead := context.WithCancel(ctx)
	defer cancelRead()

	idleTimer := time.AfterFunc(streamIdleTimeout, cancelRead)
	defer idleTimer.Stop()

	body, err := json.Marshal(wireRequest{
		Model:      req.Model,
		Messages:   req.Messages,
		Tools:      req.Tools,
		MaxTokens:  req.MaxTokens,
		Stream:     true,
		ToolChoice: req.ToolChoice,
	})
	if err != nil {
		return Completion{}, fmt.Errorf("ai: encode DeepSeek stream request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(readCtx, http.MethodPost, c.baseURL+chatCompletionsPath, bytes.NewReader(body))
	if err != nil {
		return Completion{}, fmt.Errorf("ai: build DeepSeek stream request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		// Order matters: check the CALLER's ctx first (a real disconnect
		// takes priority in the message over our own idle watchdog, in the
		// unlikely case both ended around the same moment), then readCtx
		// (streamIdleTimeout fired with no response ever arriving), then
		// fall back to a plain network error.
		if ctx.Err() != nil {
			return Completion{}, fmt.Errorf("ai: DeepSeek stream interrupted: %w", ctx.Err())
		}
		if readCtx.Err() != nil {
			return Completion{}, fmt.Errorf("ai: DeepSeek stream idle timeout: no response within %s", streamIdleTimeout)
		}
		return Completion{}, fmt.Errorf("ai: call DeepSeek stream: %w", err)
	}
	defer resp.Body.Close()
	idleTimer.Reset(streamIdleTimeout) // got headers — progress, push the idle deadline back out

	if resp.StatusCode != http.StatusOK {
		// Same non-2xx handling as Complete (client.go) — DeepSeek can
		// reject a streaming request outright, before any SSE line is
		// ever sent, e.g. a bad model name or an invalid tool_choice
		// (docs/deepseek-measured.md §2).
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
		var eb wireErrorBody
		_ = json.Unmarshal(raw, &eb) // best-effort: a malformed error body still gets a status code
		if eb.Error.Message != "" {
			return Completion{}, fmt.Errorf("ai: DeepSeek stream returned HTTP %d: %s", resp.StatusCode, truncateProviderMessage(eb.Error.Message))
		}
		return Completion{}, fmt.Errorf("ai: DeepSeek stream returned HTTP %d", resp.StatusCode)
	}

	var (
		contentBuilder strings.Builder
		finishReason   string
		usage          Usage
		toolOrder      []int
		toolByIndex    = map[int]*streamToolCallAcc{}
		sawDone        bool // round-1 review I1 — see the truncation guard after this loop
	)

	// io.LimitReader bounds total stream bytes read the same way Complete
	// bounds one response (client.go's maxResponseBytes comment) — a
	// runaway or malicious response dies here with "one turn fails", not
	// "this process's memory grows without bound". It also, deliberately,
	// makes hitting that cap look IDENTICAL to a connection closing early —
	// both end the loop with scanner.Err() == nil and sawDone still false,
	// so both are caught by the very same truncation guard below.
	scanner := bufio.NewScanner(io.LimitReader(resp.Body, maxResponseBytes))
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)

	for scanner.Scan() {
		idleTimer.Reset(streamIdleTimeout) // any successful read is progress, data or blank line alike

		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue // SSE blank-line separators and any non-"data:" field
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == sseDoneMarker {
			sawDone = true
			break // never unmarshal "[DONE]", never treat it as a chunk
		}

		var chunk wireStreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			return Completion{}, fmt.Errorf("ai: decode DeepSeek stream chunk: %w", err)
		}
		if chunk.Usage != nil {
			usage = *chunk.Usage
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		choice := chunk.Choices[0]
		if choice.FinishReason != nil && *choice.FinishReason != "" {
			finishReason = *choice.FinishReason
		}
		if choice.Delta.Content != "" {
			contentBuilder.WriteString(choice.Delta.Content)
			if onDelta != nil {
				if err := onDelta(choice.Delta.Content); err != nil {
					// The caller's sink failed (e.g. the learner's
					// connection dropped and Task 11's SSE write errored)
					// — stop reading from DeepSeek immediately rather than
					// keep paying for tokens nobody can receive anymore.
					return Completion{}, err
				}
			}
		}
		for _, tc := range choice.Delta.ToolCalls {
			acc, ok := toolByIndex[tc.Index]
			if !ok {
				acc = &streamToolCallAcc{}
				toolByIndex[tc.Index] = acc
				toolOrder = append(toolOrder, tc.Index)
			}
			if tc.ID != "" {
				acc.id = tc.ID
			}
			if tc.Type != "" {
				acc.typ = tc.Type
			}
			if tc.Function.Name != "" {
				acc.name = tc.Function.Name
			}
			acc.args.WriteString(tc.Function.Arguments)
		}
	}
	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			// The caller's ctx ended this read — a cancellation the
			// caller's own ctx carried in (Task 11's handler ties this to
			// the learner's HTTP request context, so this is the "closed
			// the tab mid-answer" path, task-7-brief.md Step 2). Report
			// ctx.Err(), not the raw scanner error, so the caller can tell
			// this apart from an actual DeepSeek-side failure.
			return Completion{}, fmt.Errorf("ai: DeepSeek stream interrupted: %w", ctx.Err())
		}
		if readCtx.Err() != nil {
			// ctx (the caller's) is still fine — readCtx is only ever
			// canceled independently of it by idleTimer firing. Say so
			// explicitly: this is DeepSeek going quiet mid-stream, not the
			// learner disconnecting and not a generic network error.
			return Completion{}, fmt.Errorf("ai: DeepSeek stream idle timeout: no data received for %s", streamIdleTimeout)
		}
		return Completion{}, fmt.Errorf("ai: read DeepSeek stream: %w", err)
	}

	// ROUND 1 REVIEW, I1 — Complete (client.go) refuses a 200 response with
	// zero choices ("ai: DeepSeek response has no choices") rather than
	// treat a superficially-OK reply as a real completion. This method had
	// no equivalent: a body that closes CLEANLY (scanner.Err() == nil, an
	// ordinary EOF — a load balancer cutting the connection early, DeepSeek
	// dying mid-generation, or the maxResponseBytes cap above being hit)
	// but never carries "[DONE]" used to fall straight through to a
	// successful-looking Completion{}, nil — the model's own choice to end
	// the turn (a "[DONE]" line) and a THIRD PARTY silently cutting the
	// wire looked identical. That is dangerous in three ways at once: the
	// learner sees a truncated answer rendered as if it were complete, Task
	// 9 charges 0 credit for tokens DeepSeek already billed for, and — if
	// the cut lands mid-tool_call — a truncated arguments JSON fragment
	// would reach runner.Run as if it were whole. sawDone is the guard:
	// only a line that was ACTUALLY "[DONE]" sets it, so a truncated body
	// is now indistinguishable from any other read failure — an error, not
	// a quiet success (TestCompleteStreamTruncatedResponseReturnsError).
	if !sawDone {
		return Completion{}, fmt.Errorf("ai: DeepSeek stream ended without a terminating %q marker (finish_reason=%q) — the response may have been truncated", sseDoneMarker, finishReason)
	}

	var toolCalls []ToolCall
	for _, idx := range toolOrder {
		acc := toolByIndex[idx]
		toolCalls = append(toolCalls, ToolCall{
			ID:   acc.id,
			Type: acc.typ,
			Function: struct {
				Name      string `json:"name"`
				Arguments string `json:"arguments"`
			}{Name: acc.name, Arguments: acc.args.String()},
		})
	}

	return Completion{
		Message: Message{
			Role:      "assistant",
			Content:   contentBuilder.String(),
			ToolCalls: toolCalls,
		},
		FinishReason: finishReason,
		Usage:        usage,
	}, nil
}

package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// chatCompletionsPath is DeepSeek's endpoint path, appended to baseURL.
//
// No "/v1" prefix — measured on the real API 2026-08-28 (see
// .superpowers/sdd/2026-08-28-pha2-ai-may-chu/task-0-measurements-raw.md,
// which curls exactly "https://api.deepseek.com/chat/completions"). config.
// DefaultDeepSeekBaseURL is "https://api.deepseek.com" with no trailing
// path, so this constant carries the whole rest of the URL.
const chatCompletionsPath = "/chat/completions"

// maxResponseBytes caps how much of DeepSeek's answer this process reads
// into memory in one call, same discipline as discuss.MaxResponseBytes
// (internal/discuss/client.go): an unbounded io.ReadAll on a third-party
// response makes the failure mode "the whole API dies" instead of "one
// turn fails". 8 MiB comfortably covers a v4-pro completion with a long
// reasoning_content plus several parallel tool_calls; DeepSeek has no
// documented cap that gets close to it.
const maxResponseBytes int64 = 8 << 20

// maxProviderErrorMessageBytes caps how many runes of a non-2xx reply's
// error.message this file puts into a returned error — and, from there,
// into whatever logs that error (round-1 review, Important #2).
// error.message is third-party text: DeepSeek today, but nothing in this
// file stops DEEPSEEK_BASE_URL (config.go) from pointing somewhere else —
// provider_key_never_leaks_test.go's own TODO on this file names that
// exact gap ("KHÔNG canh được ĐÍCH ĐẾN của một lời gọi ra ngoài"). raw
// already allows up to maxResponseBytes (8 MiB) before this point, so an
// unbounded error.message could put megabytes of arbitrary third-party
// text into a server log on every failed call. internal/discuss/client.go
// resolves the same tension by refusing to log GitHub's body at all — this
// file cannot do that, because the Task 4b brief requires error.message in
// the returned error for callers to distinguish 401/429/500. A hard cap
// is the compromise: still useful for debugging, bounded either way.
const maxProviderErrorMessageBytes = 200

// truncateProviderMessage bounds s to maxProviderErrorMessageBytes RUNES
// (not bytes) so a cut never lands inside a multi-byte UTF-8 sequence and
// produces invalid text in a log line.
func truncateProviderMessage(s string) string {
	r := []rune(s)
	if len(r) <= maxProviderErrorMessageBytes {
		return s
	}
	return string(r[:maxProviderErrorMessageBytes]) + "... [truncated]"
}

// defaultTimeout bounds one call to DeepSeek when neither layer that could
// supply a deadline actually supplies one (round-1 review, Important #3).
// Applied as a context.WithTimeout wrapped around ctx on every Complete
// call (client.go) and, separately, as the basis for stream.go's
// streamIdleTimeout/streamTotalTimeout on every CompleteStream call —
// client_test.go's sibling internal/discuss/client.go uses the same
// pattern (its RequestTimeout). 90s is generous headroom over anything
// measured in docs/deepseek-measured.md (a reasoning completion with
// several parallel tool_calls) while still being a bound instead of none.
//
// ROUND 3 REVIEW (Task 7) — this is NO LONGER also set as New's hc==nil
// fallback http.Client.Timeout; see New's doc comment below for why that
// second layer was removed rather than kept "for extra safety". The short
// version: it was never load-bearing for Complete (Complete's own
// context.WithTimeout below already bounds the ENTIRE call — DNS, TLS
// handshake, and body read all fall under that same ctx, measured directly
// against this repo's go 1.25.5 toolchain, not assumed), and it was
// actively harmful for stream.go's CompleteStream (a TOTAL-request
// http.Client.Timeout silently re-imposing a flat 90s cutoff underneath
// CompleteStream's own idle/total-time watchdogs, defeating the entire
// point of their redesign — round-2 review, I1's second half). One knob,
// one job: ctx carries every deadline now: Complete's own per-call
// WithTimeout(ctx, defaultTimeout), and stream.go's own
// WithTimeout(ctx, streamTotalTimeout) + idle watchdog.
const defaultTimeout = 90 * time.Second

// Client talks to DeepSeek's OpenAI-compatible chat-completions endpoint
// over plain net/http — no SDK dependency, matching this module's stated
// choice to keep go.mod at ten direct deps.
//
// baseURL and apiKey are unexported plain strings, not a config.Config and
// not fields named DeepSeekAPIKey/BraveAPIKey. That is a deliberate choice,
// not an oversight: apps/api/internal/server/provider_key_never_leaks_test.go
// documents its own blind spot in PHẠM VI THẬT point 2 — it only matches
// those two exact names (plus a bare `cfg` value). Reusing those names here
// would light the gate up; using this package's own names instead means the
// leak-freedom of this file has to hold on its own, checked directly by
// TestCompleteErrorNeverContainsKey in client_test.go, rather than by
// borrowing a gate built for a different package's field names.
type Client struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// New builds a Client. hc is the caller's choice (Task 6/7/9 own timeouts,
// retries, and any transport tuning) — this package does not construct its
// own http.Client from scratch or read any environment variable; every
// destination this file can reach is visible right here at the call site,
// same discipline internal/discuss/client.go's APIURL comment describes.
//
// A nil hc falls back to &http.Client{} — carrying no Timeout of its own —
// NOT http.DefaultClient (still a distinct value, so a caller can tell the
// two apart, and so a future change to DefaultClient's own settings can't
// silently change this package's behavior). This is a REVISED fallback
// (round-3 review, Task 7, item 3 — previously &http.Client{Timeout:
// defaultTimeout}); see the history below for why the Timeout field was
// deliberately removed rather than kept as a second layer of safety:
//
//   - It was NEVER load-bearing for Complete in the first place. Complete
//     (below) already wraps ctx in its own context.WithTimeout(ctx,
//     defaultTimeout) on EVERY call, hc == nil or not — and a Go context
//     deadline bounds the WHOLE request lifecycle through net/http: DNS
//     resolution, the TCP dial, the TLS handshake, AND reading the
//     response body, not merely "waiting for Do() to return". Measured
//     directly against this repo's go 1.25.5 toolchain (round-3 review):
//     a body that hangs after headers already arrived, and a bare TCP
//     accept that never completes a TLS handshake, BOTH abort at the
//     ctx's own deadline — not a millisecond later waiting on some other
//     layer. http.Client.Timeout duplicating that bound added nothing
//     Complete didn't already have.
//   - It was ACTIVELY HARMFUL for stream.go's CompleteStream. Go's
//     http.Client.Timeout is a TOTAL-request bound covering body reads —
//     exactly the flat wall-clock cutoff CompleteStream's
//     streamIdleTimeout/streamTotalTimeout redesign exists to replace
//     with something that tells "stuck" apart from "long but healthy"
//     (round-2 review, I1). A Client built via New(url, key, nil) used to
//     silently reintroduce that flat cutoff underneath CompleteStream's
//     own watchdogs, surfacing as a generic network error instead of
//     CompleteStream's distinguishable "idle timeout"/"total time budget"
//     messages — because net/http's Transport enforced it BEFORE
//     CompleteStream's own code ever got a say.
//
// Round-1 review (Important #3, now superseded by the above) is the reason
// this fallback exists at all — it caught an EARLIER version of this
// comment claiming a caller that "does not care" still gets "a working
// Client", when what they actually got was http.DefaultClient (no bound of
// any kind). &http.Client{} (this fallback) is still a DISTINCT client
// value from http.DefaultClient, so New's own identity check
// (TestNewNilHCHasNoClientTimeoutButStillBounded, client_test.go) still has
// something to assert on — the bounding itself now comes entirely from
// Complete's and CompleteStream's own per-call context.WithTimeout, not
// from this http.Client's Timeout field.
//
// GAP THIS DOES NOT CLOSE: this only removes the DEFAULT trap. A caller
// that constructs its own hc and passes &http.Client{Timeout: 90 * time.Second}
// (or any other Timeout) explicitly to New still hands CompleteStream the
// exact same total-request cutoff underneath its watchdogs — New has no
// way to see or reject that choice. Whoever wires up the real *Client for
// streaming (Task 11, or wherever cmd/api assembles ai.New's arguments)
// needs to know: an hc with Timeout != 0 defeats streaming's idle/total
// watchdogs regardless of what New's OWN default does.
//
// baseURL has any trailing "/" trimmed — config.Load does not normalize
// DEEPSEEK_BASE_URL, and chatCompletionsPath below already starts with
// "/"; a trailing slash left in would build ".../com//chat/completions".
func New(baseURL, apiKey string, hc *http.Client) *Client {
	baseURL = strings.TrimSuffix(baseURL, "/")
	if hc == nil {
		hc = &http.Client{}
	}
	return &Client{baseURL: baseURL, apiKey: apiKey, http: hc}
}

// wireRequest is the JSON shape DeepSeek's chat-completions endpoint
// expects on the wire. It is deliberately NOT ai.Request: Request (types.go,
// Task 4a) carries no JSON tags at all — encoding it directly would produce
// "Model"/"Messages"/... (Go's default, capitalized field name) instead of
// the "model"/"messages"/... DeepSeek requires. Keeping the wire shape here,
// local to client.go, is what lets Request stay a plain Go-side parameter
// struct that Task 4a could define without knowing the wire format Task 4b
// would settle on.
//
// Message and Tool (types.go) DO already carry the correct JSON tags —
// Task 4a wrote those to match the shape client.go needed to send/receive
// them nested inside a request or response, so they are embedded here
// as-is rather than re-declared.
//
// ToolChoice (added by Task 6, agent.go) carries ai.ToolChoice straight
// through with "tool_choice,omitempty" — the zero value ("") is the empty
// ai.ToolChoice, which omitempty treats the same as any other empty string,
// so a Request that never sets ToolChoice sends no "tool_choice" key at
// all, exactly as before this field existed (every pre-Task-6 caller,
// including every test in client_test.go, is unaffected).
//
// This resolves the question the comment used to leave open here — whether
// omitting "tool_choice" behaves the same as sending "auto" was flagged as
// an UNMEASURED ASSUMPTION (round-1 review, "5 việc") rather than settled,
// because settling it meant either spending the project's DeepSeek balance
// on a call that answers nothing else, or designing the one caller that
// needs tool_choice at all (Agent.Run, Task 6) so it never exercises the
// omitted path. Task 6 took the second option: agent.go sets ToolChoiceAuto
// or ToolChoiceNone on every round, never leaving the field at its zero
// value — see ToolChoice's doc comment in types.go and Agent.Run in
// agent.go. The omitted-vs-"auto" question stays open for any FUTURE
// caller that constructs a Request without setting ToolChoice; it is not
// answered here, only avoided by every caller this package ships today.
type wireRequest struct {
	Model      string     `json:"model"`
	Messages   []Message  `json:"messages"`
	Tools      []Tool     `json:"tools,omitempty"`
	MaxTokens  int        `json:"max_tokens,omitempty"`
	Stream     bool       `json:"stream"`
	ToolChoice ToolChoice `json:"tool_choice,omitempty"`
}

// wireResponse is the JSON shape of a non-streaming chat-completions reply.
// Only choices[0] and usage are decoded — Request.Stream is always sent as
// false by this file today (streaming is Task 7/9's addition), so a reply
// always has exactly one non-streamed choice to read.
//
// Usage embeds ai.Usage (types.go) directly — its two cache-token JSON
// tags were measured against the real API and confirmed correct (see
// docs/deepseek-measured.md §1, and the comment on Usage in types.go).
//
// reasoning_tokens (completion_tokens_details.reasoning_tokens) and
// cached_tokens (prompt_tokens_details.cached_tokens) are DELIBERATELY not
// decoded anywhere in this file — see docs/deepseek-measured.md §1 for the
// measurement, and the comment on Usage in types.go for why: reasoning
// tokens are already INSIDE completion_tokens (not additive), so cost.go's
// Charge billing the whole of CompletionTokens at the output price is
// already correct, not a gap to fill; and cached_tokens duplicates
// prompt_cache_hit_tokens, which this struct already captures via the pair
// that carries BOTH halves (hit and miss). encoding/json ignores JSON
// object fields with no matching Go field, so leaving them off here is
// silent and safe, not a decode error.
type wireResponse struct {
	Choices []struct {
		Message      Message `json:"message"`
		FinishReason string  `json:"finish_reason"`
	} `json:"choices"`
	Usage Usage `json:"usage"`
}

// wireErrorBody is the shape DeepSeek uses for a non-2xx reply, e.g.
// {"error":{"message":"...","type":"invalid_request_error"}} — measured at
// docs/deepseek-measured.md §2 (the tool_choice rejection message has this
// exact shape). Only Message is read; type/param/code are not needed by any
// caller today.
type wireErrorBody struct {
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Complete sends one chat-completions turn to DeepSeek and decodes the
// reply. It never streams: req.Stream is READ (round-1 review, Important
// #4 — an earlier version silently hardcoded Stream: false and ignored the
// field entirely, so a caller that set Stream: true got a non-streaming
// call back with no error and no warning) and req.Stream == true is
// rejected outright, before any network I/O. Task 7/9 add a separate
// streaming path rather than branching this one.
//
// Every call is bounded by defaultTimeout via context.WithTimeout, on top
// of whatever deadline ctx already carries — see defaultTimeout's comment
// for why this layer exists even though New's caller supplies its own
// http.Client.
//
// Error handling is written around ONE constraint, spelled out in the Task
// 4b brief: an HTTP error must never carry the API key out with it.
// Wrapping *http.Request (or anything built from it) with %w is the classic
// leak — an *http.Request formatted with %v/%+v dumps its Header map,
// Authorization included. This function never does that: req is used only
// to set headers and to call c.http.Do; every error message below is built
// from plain strings, status codes, and DeepSeek's own decoded error text,
// never from req or from c.apiKey. c.http.Do's own error (network/TLS
// failures) is safe to wrap with %w — *url.Error's Error() method reports
// the URL and the underlying error, not headers — so that one line is the
// one place %w wraps something that touched the request.
func (c *Client) Complete(ctx context.Context, req Request) (Completion, error) {
	if req.Stream {
		return Completion{}, fmt.Errorf("ai: Complete does not support Request.Stream=true — this is a non-streaming call, and streaming is a separate path Task 7/9 add, not a silent downgrade")
	}

	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	body, err := json.Marshal(wireRequest{
		Model:      req.Model,
		Messages:   req.Messages,
		Tools:      req.Tools,
		MaxTokens:  req.MaxTokens,
		Stream:     false, // req.Stream == true already returned above; this is always false here
		ToolChoice: req.ToolChoice,
	})
	if err != nil {
		return Completion{}, fmt.Errorf("ai: encode DeepSeek request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+chatCompletionsPath, bytes.NewReader(body))
	if err != nil {
		return Completion{}, fmt.Errorf("ai: build DeepSeek request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return Completion{}, fmt.Errorf("ai: call DeepSeek: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return Completion{}, fmt.Errorf("ai: read DeepSeek response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		// raw is DeepSeek's own text, decoded down to just its "message"
		// field and then truncated (maxProviderErrorMessageBytes) — never
		// the raw request, never c.apiKey. See the doc comment above for
		// why the key-secrecy half is load-bearing here, and
		// maxProviderErrorMessageBytes's comment for why the length cap is
		// needed too (round-1 review, Important #2).
		var eb wireErrorBody
		_ = json.Unmarshal(raw, &eb) // best-effort: a malformed error body still gets a status code
		if eb.Error.Message != "" {
			return Completion{}, fmt.Errorf("ai: DeepSeek returned HTTP %d: %s", resp.StatusCode, truncateProviderMessage(eb.Error.Message))
		}
		return Completion{}, fmt.Errorf("ai: DeepSeek returned HTTP %d", resp.StatusCode)
	}

	var wire wireResponse
	if err := json.Unmarshal(raw, &wire); err != nil {
		return Completion{}, fmt.Errorf("ai: decode DeepSeek response: %w", err)
	}
	if len(wire.Choices) == 0 {
		return Completion{}, fmt.Errorf("ai: DeepSeek response has no choices")
	}

	// ROUND 3 REVIEW (Task 7) — mirrors stream.go's CompleteStream guard on
	// finish_reason=="length" with a pending tool call, added there for
	// round-2 review's I3. That guard's underlying concern is NOT
	// streaming-specific: DeepSeek's non-streaming endpoint can equally
	// return finish_reason "length" (MaxTokensPerTurn's own budget, see
	// agent.go's doc comment on that field) alongside a tool_calls entry
	// whose Function.Arguments string was cut off mid-generation — the
	// SAME malformed artifact CompleteStream guards against, delivered in
	// one response instead of assembled across chunks. Without this
	// mirror, the identical DeepSeek reply would fail through
	// CompleteStream but succeed through Complete, handing Run (agent.go)
	// a truncated arguments string to pass straight to a ToolRunner.Run —
	// see stream.go's matching guard for why it is scoped to "a tool_calls
	// entry is present", not every "length" finish (a plain truncated text
	// answer is MaxTokensPerTurn doing its documented job, not a corrupted
	// structured artifact).
	if wire.Choices[0].FinishReason == "length" && len(wire.Choices[0].Message.ToolCalls) > 0 {
		return Completion{Usage: wire.Usage, FinishReason: wire.Choices[0].FinishReason},
			fmt.Errorf("ai: DeepSeek response ended with finish_reason %q while it included a tool call — its arguments JSON is likely truncated",
				truncateProviderMessage(wire.Choices[0].FinishReason))
	}

	return Completion{
		Message:      wire.Choices[0].Message,
		FinishReason: wire.Choices[0].FinishReason,
		Usage:        wire.Usage,
	}, nil
}

package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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

// New builds a Client. hc is required from the caller (Task 6/7/9 own
// timeouts, retries, and any transport tuning) — this package does not
// construct its own http.Client or read any environment variable; every
// destination this file can reach is visible right here at the call site,
// same discipline internal/discuss/client.go's APIURL comment describes.
// A nil hc falls back to http.DefaultClient (no timeout) so a test or a
// caller that truly does not care still gets a working Client rather than
// a nil-pointer panic on first use.
func New(baseURL, apiKey string, hc *http.Client) *Client {
	if hc == nil {
		hc = http.DefaultClient
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
type wireRequest struct {
	Model     string    `json:"model"`
	Messages  []Message `json:"messages"`
	Tools     []Tool    `json:"tools,omitempty"`
	MaxTokens int       `json:"max_tokens"`
	Stream    bool      `json:"stream"`
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
// reply. It never streams (Request.Stream is not read from req — Task 7/9
// add a separate streaming path rather than branching this one).
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
	body, err := json.Marshal(wireRequest{
		Model:     req.Model,
		Messages:  req.Messages,
		Tools:     req.Tools,
		MaxTokens: req.MaxTokens,
		Stream:    false,
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
		// field — never the raw request, never c.apiKey. See the doc
		// comment above for why that distinction is load-bearing here.
		var eb wireErrorBody
		_ = json.Unmarshal(raw, &eb) // best-effort: a malformed error body still gets a status code
		if eb.Error.Message != "" {
			return Completion{}, fmt.Errorf("ai: DeepSeek returned HTTP %d: %s", resp.StatusCode, eb.Error.Message)
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

	return Completion{
		Message:      wire.Choices[0].Message,
		FinishReason: wire.Choices[0].FinishReason,
		Usage:        wire.Usage,
	}, nil
}

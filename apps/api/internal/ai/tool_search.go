// tool_search.go gives the agent (Pha 2) a WEB SEARCH tool through Brave (brave.go) — the
// one tool with a real-money surcharge (Settings.CostMicroPerWebSearch/
// CreditsPerWebSearch, cost.go's Charge) on top of ordinary token billing. Everything in
// this file exists to protect that surcharge from being charged for something that did not
// happen.
//
// agent.go's tool-call loop (Task 6, not touched by this task) increments
// Result.WebSearches — and therefore the learner's bill — for ANY tool_call whose
// ToolRunner.Run returns a NIL error, PROVIDED the tool's name is "web_search"
// (webSearchToolName, agent.go). See agent.go's doc comment on Result.WebSearches and the
// `if runErr != nil { ... } else { ... result.WebSearches++ }` branch inside Run. That
// mechanism is FIXED and BINARY: a nil error always counts, a non-nil error never does,
// regardless of what the returned string says.
//
// tool_course.go's ToolRunner (read_course) deliberately NEVER returns a non-nil error —
// every failure there becomes a string the model can read, so a broken course lookup never
// aborts a turn (see tool_course.go's own doc comment on courseTool.Run). This file breaks
// that convention on purpose, for a reason that has NOTHING to do with "aborting the turn"
// (agent.go's loop absorbs a non-nil Run error into an `Error: tool "web_search" failed:
// ...` content string and keeps the turn going exactly the way a plain string would — see
// agent.go's `allowed`/`runErr` handling) and everything to do with the billing counter
// above. The rule this file follows:
//
//   - Run returns (string, nil) — the BILLING path — ONLY when this call actually reached
//     Brave and got back a response (searchTool.provider.Search returned without error).
//     Brave served the request, so the learner is billed for it, whether or not any results
//     came back — brave.go's handling of a response with no "web" key is a valid "nothing
//     found" answer, not a failure (see brave.go's TestBraveHandlesMissingWebKey and this
//     file's TestSearchToolNoResultsIsSuccessNotError).
//   - Run returns (string, error) — never counted — for every path where Brave was NOT
//     successfully queried: malformed or empty arguments, this instance's search budget
//     already spent (maxPerTurn, see NewSearchTool below), or any upstream failure the
//     provider reports (network error, non-2xx status, timeout, DNS). None of these spent a
//     Brave credit, so none of them may increment WebSearches — and the ONLY lever this file
//     has to stop that increment, given agent.go's fixed nil-error-counts rule, is returning
//     a real Go error.
//
// task-8-brief.md's Step 1 (as originally written) describes the budget-exhausted case as
// returning "a string, not an error" ("chuỗi, không phải error, vì đây không phải thất bại
// upstream"). That line predates the WebSearches ledger debt this task's brief was later
// annotated with (its "MÓN NỢ" section, added after review of Task 6) and, read literally,
// reintroduces exactly the bug that debt warns about for provider failures: a (string, nil)
// return for a call that never touched Brave still increments WebSearches under agent.go's
// rule. This file departs from that literal instruction for the budget-exhausted case
// specifically (see ErrSearchBudgetExhausted) while still satisfying the brief's actual GOAL
// — "để model biết mà dừng" (so the model knows to stop): agent.go wraps ANY non-nil Run
// error into a plain-text content string before the model ever sees it, so the model still
// reads a string it can act on either way. Only the billing side effect differs, and that
// side effect is precisely what this whole task is about getting right.
package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
)

// searchResultLimit is how many hits ONE web_search call asks the provider for. This is a
// tool-level default, not something the model controls — Definition below exposes only
// "query" as an argument, on purpose (see Definition's doc comment) — and not a second copy
// of brave.go's own ceiling (braveMaxCount, 20): brave.go clamps independently regardless of
// what this constant says. This number just keeps one search's own footprint in the
// conversation (and therefore in token billing, on top of the flat per-search surcharge)
// modest.
const searchResultLimit = 5

// ErrSearchBudgetExhausted is the error Run returns once maxPerTurn calls to the provider
// have already happened in this searchTool instance's lifetime — see NewSearchTool's doc
// comment for what "this instance's lifetime" must mean to whoever wires it into
// Agent.Tools. It is exported and wrapped with %w (not embedded as plain text) so a caller
// that DOES care can tell this apart from an upstream Brave failure via errors.Is — agent.go
// itself has no need to (both become the same shape of "Error: tool ... failed" content to
// the model), but nothing about the ToolRunner contract stops a future caller from wanting
// the distinction, the same way agent.go's own ErrToolBudgetExhausted exists for its
// (different) round budget.
var ErrSearchBudgetExhausted = errors.New("web_search: this turn's search budget is exhausted")

// searchTool is the sole ToolRunner implementation in this file — the tool named
// "web_search". That name is not a free choice: agent.go's webSearchToolName constant and
// Result.WebSearches's doc comment (agent.go, written during Task 6, before this file
// existed) both already hardcode "web_search" as the name Result.WebSearches counts —
// Definition below must produce exactly that string or the counter this whole file exists
// to protect silently stays at zero forever (see TestSearchToolDefinitionName,
// tool_search_test.go).
type searchTool struct {
	provider   SearchProvider
	maxPerTurn int

	mu    sync.Mutex
	calls int
}

// NewSearchTool builds a ToolRunner backed by p, allowing at most maxPerTurn calls to p
// before Run starts refusing with ErrSearchBudgetExhausted.
//
// SCOPE OF THE CAP — READ BEFORE WIRING THIS INTO Agent.Tools: the "per turn" in maxPerTurn
// is enforced by counting calls made to THIS RETURNED INSTANCE, for its entire lifetime.
// There is no notion of "a Turn starting" anywhere in the ToolRunner interface (Definition/
// Run, tool_course.go) for this file to hook — Run has no way to be told "a new turn just
// began, reset your counter". That makes the cap correct ONLY if whoever wires Agent.Tools
// (Task 11's handler, not built as of this task) constructs A FRESH NewSearchTool PER
// Turn/request — the same way it must already construct Turn itself fresh per request to
// vary Question/History/CourseSlug per learner. Sharing one instance across turns (e.g.
// building it once at process startup, the same way a stateless *Client for DeepSeek could
// reasonably be shared) turns "N searches per turn" into "N searches for the lifetime of the
// process, shared and RACED across every concurrent learner" — a materially different, and
// wrong, product behavior, not a naming quibble. mu below only protects the counter from a
// data race IF that mistake is made anyway; it does not make sharing one instance across
// turns correct, only non-corrupting.
func NewSearchTool(p SearchProvider, maxPerTurn int) ToolRunner {
	return &searchTool{provider: p, maxPerTurn: maxPerTurn}
}

// Definition exposes exactly one argument to the model: query. Deliberately NOT a
// result-count knob — how many results one call asks for is a cost/context-size decision
// this file already makes (searchResultLimit above), not something worth a tool-schema
// argument and a per-call model decision. The description leans on the model's own judgment
// ("this tool costs the learner extra credits") rather than a hard permission gate, matching
// spec §3.2's stance quoted in task-8-brief.md: an expensive tool's price speaks through the
// conversion table, not through asking the learner to approve every call.
func (t *searchTool) Definition() Tool {
	return Tool{
		Type: "function",
		Function: ToolFunction{
			Name: "web_search",
			Description: "Search the public web for information the course material and " +
				"your own knowledge do not cover — for example current events, or facts " +
				"that may have changed since your training. This tool costs the learner " +
				"extra credits on top of normal usage every time it is called, so only " +
				"call it when the answer cannot be found in the course or in what you " +
				"already know.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query": map[string]any{
						"type":        "string",
						"description": "The search query.",
					},
				},
				"required": []string{"query"},
			},
		},
	}
}

// searchToolArgs is the JSON shape model gửi trong ToolCall.Function.Arguments — mirror của
// courseToolArgs, tool_course.go.
type searchToolArgs struct {
	Query string `json:"query"`
}

// Run decodes argsJSON and either queries the provider or refuses — per this file's
// package-level doc comment's rule: a real Go error for every path that does NOT reach
// Brave, a (string, nil) success for every path that does (regardless of whether Brave
// found anything).
func (t *searchTool) Run(ctx context.Context, argsJSON string) (string, error) {
	var args searchToolArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		// Không reach provider — không được tính tiền — nên đây PHẢI là error Go thật,
		// không phải (chuỗi, nil) kiểu courseTool.Run. Xem chú thích đầu tệp.
		return "", fmt.Errorf("web_search: could not parse arguments: %w", err)
	}
	query := strings.TrimSpace(args.Query)
	if query == "" {
		return "", errors.New("web_search: query is required")
	}

	t.mu.Lock()
	if t.calls >= t.maxPerTurn {
		t.mu.Unlock()
		// Trần maxPerTurn chạm — KHÔNG gọi provider, nên KHÔNG được tính tiền. Đây là
		// điểm tự quyết định khác literal wording của task-8-brief.md Step 1 ("chuỗi,
		// không phải error") — xem chú thích đầu tệp cho lý do đầy đủ: agent.go tính
		// WebSearches++ trên MỌI Run trả về nil error cho tool tên "web_search", bất kể
		// nội dung chuỗi trả về nói gì, nên (chuỗi, nil) ở đây sẽ tính phụ thu cho một
		// lượt tìm CHƯA TỪNG chạm Brave.
		return "", fmt.Errorf("%w (max %d calls this turn)", ErrSearchBudgetExhausted, t.maxPerTurn)
	}
	t.calls++
	t.mu.Unlock()

	hits, err := t.provider.Search(ctx, query, searchResultLimit)
	if err != nil {
		// Brave KHÔNG phục vụ được lượt gọi này — không được tính tiền — nên đây PHẢI
		// là error Go thật, dù rất giống hình dạng courseTool.Run's "always (string,
		// nil)" convention. t.provider.Search (brave.go, khi provider thật là *Brave)
		// đã cắt gọt chuỗi lỗi của Brave khỏi API key trước khi trả về
		// (truncateProviderMessage, cùng kỷ luật client.go's TestCompleteErrorNeverContainsKey)
		// — %w chỉ mang tiếp chuỗi ĐÃ AN TOÀN đó, không tự thêm gì mới có thể rò.
		return "", fmt.Errorf("web_search: %w", err)
	}

	if len(hits) == 0 {
		// Brave ĐÃ phục vụ (không lỗi) nhưng không tìm thấy gì — một câu trả lời hợp lệ,
		// PHẢI tính tiền vì Brave đã làm việc, nên đây là (chuỗi, nil), không phải lỗi.
		// Cùng triết lý "Note: ... no readable content" của courseTool.Run
		// (tool_course.go) — model cần một câu đọc được, không phải chuỗi rỗng im lặng.
		return fmt.Sprintf("No web results were found for %q.", query), nil
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "Web search results for %q:\n\n", query)
	for i, h := range hits {
		fmt.Fprintf(&sb, "%d. %s\n%s\n%s\n\n", i+1, h.Title, h.URL, h.Snippet)
	}
	return strings.TrimSpace(sb.String()), nil
}

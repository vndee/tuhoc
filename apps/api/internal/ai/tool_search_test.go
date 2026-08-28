package ai

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// fakeSearchProvider implements SearchProvider without a network call — same spirit as
// agent_test.go's fakeCompleter/fakeTool: this file's own tests care about searchTool's
// CALL-COUNTING and error-vs-string decisions, not about any one provider's wire format
// (brave_test.go already owns that).
type fakeSearchProvider struct {
	calls  int
	hits   []SearchHit
	err    error
	onCall func(call int, query string, limit int) ([]SearchHit, error)
}

func (f *fakeSearchProvider) Search(ctx context.Context, query string, limit int) ([]SearchHit, error) {
	f.calls++
	if f.onCall != nil {
		return f.onCall(f.calls, query, limit)
	}
	if f.err != nil {
		return nil, f.err
	}
	return f.hits, nil
}

// ── Definition ───────────────────────────────────────────────────────────

// TestSearchToolDefinitionName pins the exact tool name agent.go's webSearchToolName
// constant (and Result.WebSearches's doc comment) already assume exists: "web_search".
// agent.go was written before this file existed and hardcodes that string — a mismatch
// here would leave Result.WebSearches permanently at 0 with no test anywhere failing loudly
// (enabledTools/the tool-call loop just never sees a match), which is exactly the kind of
// silent miscount this task exists to prevent.
func TestSearchToolDefinitionName(t *testing.T) {
	tool := NewSearchTool(&fakeSearchProvider{}, 3)
	if got := tool.Definition().Function.Name; got != "web_search" {
		t.Errorf("Definition().Function.Name = %q, muốn %q (khớp agent.go's webSearchToolName)", got, "web_search")
	}
}

// ── kết quả thành công ──────────────────────────────────────────────────

func TestSearchToolReturnsResultsAsReadableText(t *testing.T) {
	p := &fakeSearchProvider{hits: []SearchHit{{Title: "T1", URL: "https://e.com/1", Snippet: "S1"}}}
	tool := NewSearchTool(p, 3)
	out, err := tool.Run(context.Background(), `{"query":"golang"}`)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !strings.Contains(out, "T1") || !strings.Contains(out, "https://e.com/1") || !strings.Contains(out, "S1") {
		t.Errorf("out = %q, thiếu nội dung kết quả", out)
	}
	if p.calls != 1 {
		t.Errorf("provider.calls = %d, muốn 1", p.calls)
	}
}

// TestSearchToolNoResultsIsSuccessNotError pins, AT THE TOOL LEVEL, the same boundary
// brave_test.go's TestBraveHandlesMissingWebKey pins at the provider level: Brave serving a
// response with zero hits is a valid, billable answer — "tìm được nhưng không có kết quả" —
// not a failure. A tool that turned this into an error would refuse to bill for a search
// Brave genuinely performed.
func TestSearchToolNoResultsIsSuccessNotError(t *testing.T) {
	p := &fakeSearchProvider{hits: nil}
	tool := NewSearchTool(p, 3)
	out, err := tool.Run(context.Background(), `{"query":"khong co gi"}`)
	if err != nil {
		t.Fatalf("0 kết quả KHÔNG phải lỗi — Brave đã phục vụ, phải tính tiền: %v", err)
	}
	if strings.TrimSpace(out) == "" {
		t.Error("out rỗng — model cần một câu đọc được, không phải chuỗi im lặng (cùng lý do tool_course.go's " +
			"nhánh \"Note: ... returned no readable content\")")
	}
}

// ── thất bại upstream: PHẢI là error Go thật ───────────────────────────────

// TestSearchToolProviderErrorIsARealGoError pins the exact fix task-8-brief.md's "MÓN NỢ"
// section demands: a provider failure (Brave 429/timeout/DNS/...) must come back from Run
// as a NON-NIL Go error, NOT as (errorString, nil) — courseTool.Run's convention
// (tool_course.go) — because agent.go's tool-call loop increments Result.WebSearches (and
// therefore the learner's bill) for ANY nil-error Run on a tool named "web_search",
// regardless of what the returned string says. A (errorString, nil) return here would bill
// the learner for a search that never came back.
func TestSearchToolProviderErrorIsARealGoError(t *testing.T) {
	p := &fakeSearchProvider{err: errors.New("brave: search returned HTTP 429: rate limited")}
	tool := NewSearchTool(p, 3)
	out, err := tool.Run(context.Background(), `{"query":"q"}`)
	if err == nil {
		t.Fatalf("muốn error khác nil khi provider lỗi (được chuỗi %q, nil) — xem chú thích trên hàm test này", out)
	}
}

// ── trần maxPerTurn (task-8-brief.md Step 1) ───────────────────────────────

// TestSearchToolCapsCallsPerTurn is Step 1 of task-8-brief.md: an expensive tool doesn't
// need a permission gate (spec §3.2 — its price speaks through the conversion table), but
// "no permission gate" is not "no ceiling" — a broken agent loop could call it dozens of
// times in one turn. The (maxPerTurn+1)-th call must not reach the provider at all.
//
// It must ALSO come back as a real Go error, not the "a string, not an error" wording
// task-8-brief.md's Step 1 uses literally — see tool_search.go's file-level doc comment for
// why this file departs from that literal instruction: a (string, nil) return here would
// increment Result.WebSearches in agent.go for a call that never touched Brave, which is the
// same class of bug the brief's own "MÓN NỢ" section calls out for provider failures. The
// model still gets a plain-text message either way (agent.go formats any non-nil Run error
// into `Error: tool "web_search" failed: ...` content) — only the billing side effect
// differs.
func TestSearchToolCapsCallsPerTurn(t *testing.T) {
	p := &fakeSearchProvider{hits: []SearchHit{{Title: "T", URL: "https://e.com", Snippet: "S"}}}
	tool := NewSearchTool(p, 2)

	for i := 0; i < 2; i++ {
		if _, err := tool.Run(context.Background(), `{"query":"q"}`); err != nil {
			t.Fatalf("lần gọi %d (trong trần maxPerTurn=2): muốn thành công, được lỗi %v", i+1, err)
		}
	}

	_, err := tool.Run(context.Background(), `{"query":"q"}`)
	if err == nil {
		t.Fatal("lần gọi thứ 3 (vượt trần maxPerTurn=2) muốn một error khác nil, không phải (chuỗi, nil)")
	}
	if !errors.Is(err, ErrSearchBudgetExhausted) {
		t.Errorf("lỗi = %v, muốn errors.Is(err, ErrSearchBudgetExhausted)", err)
	}
	if p.calls != 2 {
		t.Errorf("provider.calls = %d, muốn đúng 2 — lần gọi vượt trần không được chạm provider", p.calls)
	}
}

// ── đầu vào hỏng ─────────────────────────────────────────────────────────

func TestSearchToolMalformedOrEmptyQueryIsError(t *testing.T) {
	p := &fakeSearchProvider{}
	tool := NewSearchTool(p, 3)
	if _, err := tool.Run(context.Background(), `not json`); err == nil {
		t.Error("muốn error khi arguments không phải JSON hợp lệ")
	}
	if _, err := tool.Run(context.Background(), `{"query":""}`); err == nil {
		t.Error("muốn error khi query rỗng")
	}
	if _, err := tool.Run(context.Background(), `{"query":"   "}`); err == nil {
		t.Error("muốn error khi query chỉ có khoảng trắng")
	}
	if p.calls != 0 {
		t.Errorf("provider.calls = %d, muốn 0 — không được chạm provider với đầu vào hỏng", p.calls)
	}
}

// ── tích hợp với vòng lặp agent THẬT (agent.go, Task 6) ────────────────────
//
// Hai test dưới đây không chỉ tin vào cách đọc agent.go của tệp này — chúng chạy searchTool
// qua ĐÚNG Agent.Run mà học viên thật sẽ đi qua, và đọc Result.WebSearches ở đầu ra, đúng
// biến mà cost.go's Charge nhân với CostMicroPerWebSearch/CreditsPerWebSearch. Đây là câu
// trả lời THẬT cho câu hỏi "tiền có tính đúng không", không phải suy luận về câu trả lời đó.

func newWebSearchCall(id, query string) ToolCall {
	return ToolCall{ID: id, Type: "function", Function: struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	}{Name: "web_search", Arguments: `{"query":"` + query + `"}`}}
}

// TestWebSearchToolIntegratesWithAgentWebSearchesCounter: round 1 gọi provider lỗi (giả lập
// Brave 429), round 2 gọi thành công. Result.WebSearches phải đúng 1 — chỉ round THÀNH CÔNG
// mới được tính, dù cả hai đều là một tool_call model "xin" hợp lệ (Result.ToolCalls đếm cả
// hai).
func TestWebSearchToolIntegratesWithAgentWebSearchesCounter(t *testing.T) {
	p := &fakeSearchProvider{onCall: func(call int, query string, limit int) ([]SearchHit, error) {
		if call == 1 {
			return nil, errors.New("brave: search returned HTTP 429: rate limited")
		}
		return []SearchHit{{Title: "T", URL: "https://e.com", Snippet: "S"}}, nil
	}}
	tool := NewSearchTool(p, 5)

	fc := &fakeCompleter{responses: []Completion{
		{FinishReason: "tool_calls", Message: Message{Role: "assistant", ToolCalls: []ToolCall{newWebSearchCall("c1", "a")}}},
		{FinishReason: "tool_calls", Message: Message{Role: "assistant", ToolCalls: []ToolCall{newWebSearchCall("c2", "b")}}},
		{FinishReason: "stop", Message: Message{Role: "assistant", Content: "done"}},
	}}
	a := &Agent{
		Client:   fc,
		Tools:    map[string]ToolRunner{"web_search": tool},
		Settings: Settings{MaxToolRoundsPerTurn: 5, MaxTokensPerTurn: 100},
	}

	result, err := a.Run(context.Background(), Turn{
		Model: "m", BasePrompt: "base", Question: "q",
		ToolsEnabled: []string{"web_search"},
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if result.WebSearches != 1 {
		t.Errorf("Result.WebSearches = %d, muốn 1 — round 1 (provider lỗi, 429) KHÔNG được tính, "+
			"round 2 (thành công) MỚI được tính", result.WebSearches)
	}
	if result.ToolCalls != 2 {
		t.Errorf("Result.ToolCalls = %d, muốn 2 (cả hai lần model xin đều đếm, thành công hay không)", result.ToolCalls)
	}
}

// TestWebSearchToolBudgetExhaustedDoesNotCountAsWebSearchInAgent: maxPerTurn=1, model xin
// tool web_search hai lần trong CÙNG một lượt. Result.WebSearches phải đúng 1 — lần vượt
// trần không được chạm provider (nên không có gì để tính tiền), và provider.calls phải xác
// nhận điều đó độc lập với Result.WebSearches (hai phép đo khác nhau cùng khẳng định một
// điều, đúng kỷ luật "tự đột biến" ở task-8-brief.md).
func TestWebSearchToolBudgetExhaustedDoesNotCountAsWebSearchInAgent(t *testing.T) {
	p := &fakeSearchProvider{hits: []SearchHit{{Title: "T", URL: "https://e.com", Snippet: "S"}}}
	tool := NewSearchTool(p, 1)

	fc := &fakeCompleter{responses: []Completion{
		{FinishReason: "tool_calls", Message: Message{Role: "assistant", ToolCalls: []ToolCall{newWebSearchCall("c1", "a")}}},
		{FinishReason: "tool_calls", Message: Message{Role: "assistant", ToolCalls: []ToolCall{newWebSearchCall("c2", "b")}}},
		{FinishReason: "stop", Message: Message{Role: "assistant", Content: "done"}},
	}}
	a := &Agent{
		Client:   fc,
		Tools:    map[string]ToolRunner{"web_search": tool},
		Settings: Settings{MaxToolRoundsPerTurn: 5, MaxTokensPerTurn: 100},
	}

	result, err := a.Run(context.Background(), Turn{
		Model: "m", BasePrompt: "base", Question: "q",
		ToolsEnabled: []string{"web_search"},
	})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if result.WebSearches != 1 {
		t.Errorf("Result.WebSearches = %d, muốn 1 — chỉ round trong trần (maxPerTurn=1) được tính, "+
			"round vượt trần không được chạm provider nên không được tính tiền", result.WebSearches)
	}
	if p.calls != 1 {
		t.Errorf("provider.calls = %d, muốn 1 — lần gọi vượt trần không được chạm provider", p.calls)
	}
}

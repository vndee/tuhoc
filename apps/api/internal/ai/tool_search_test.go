package ai

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

// fakeSearchProvider implements SearchProvider without a network call — same spirit as
// agent_test.go's fakeCompleter/fakeTool: this file's own tests care about searchTool's
// CALL-COUNTING and error-vs-string decisions, not about any one provider's wire format
// (brave_test.go already owns that).
//
// calls is guarded by mu — round-1 review's M4 added TestSearchToolCapIsRaceSafeUnderConcurrentCalls,
// which calls Run concurrently on ONE searchTool instance; every call that gets past
// searchTool's own budget check reaches THIS Search concurrently with the others, so this
// fake needs its own lock to avoid being a second, unrelated data race sitting on top of the
// one that test exists to catch in searchTool itself. Every other (sequential) test in this
// file is unaffected — a mutex uncontended by concurrent callers costs nothing worth avoiding.
type fakeSearchProvider struct {
	mu     sync.Mutex
	calls  int
	hits   []SearchHit
	err    error
	onCall func(call int, query string, limit int) ([]SearchHit, error)
}

func (f *fakeSearchProvider) Search(ctx context.Context, query string, limit int) ([]SearchHit, error) {
	f.mu.Lock()
	f.calls++
	call := f.calls
	f.mu.Unlock()
	if f.onCall != nil {
		return f.onCall(call, query, limit)
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

// TestSearchToolStripsHTMLFromResults is round-1 review's I1, top of the reviewer's list:
// Brave's `description` field ROUTINELY contains HTML (`<strong>` around matched query
// terms, to bold them on a results page meant for human eyes) — this is not an adversarial
// input, it happens on the ORDINARY success path. Before this test/fix, Title/URL/Snippet
// went into model-facing content byte-for-byte; a raw `<strong>` tag (or worse, something
// deliberately crafted to look like a system/tool delimiter) reached the model's context
// unfiltered. formatHit (tool_search.go) now runs htmltext.Strip (internal/htmltext, reused as-is —
// same job, same package) over Title/Snippet before they reach content.
func TestSearchToolStripsHTMLFromResults(t *testing.T) {
	p := &fakeSearchProvider{hits: []SearchHit{{
		Title:   "Golang <strong>concurrency</strong> guide",
		URL:     "https://e.com/1",
		Snippet: "Use <strong>goroutines</strong> and channels <script>alert(1)</script> safely.",
	}}}
	tool := NewSearchTool(p, 3)
	out, err := tool.Run(context.Background(), `{"query":"golang concurrency"}`)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if strings.Contains(out, "<") || strings.Contains(out, ">") {
		t.Errorf("out vẫn còn thẻ HTML chưa lọc: %q", out)
	}
	if !strings.Contains(out, "Golang concurrency guide") {
		t.Errorf("out thiếu title đã lọc thẻ (chữ phải còn nguyên, chỉ thẻ bị xoá): %q", out)
	}
	if strings.Contains(out, "alert(1)") {
		t.Errorf("out mang theo nội dung BÊN TRONG <script> — htmltext.Strip phải xoá cả thân, không "+
			"chỉ cặp thẻ mở/đóng (tool_course.go's stripRawTextTags): %q", out)
	}
}

// TestSearchToolTruncatesLongHitFields is round-1 review's I1, second half: the only length
// guard before this fix was maxBraveResponseBytes (brave.go) — a cap on the WHOLE response
// body — which does nothing to stop ONE field from eating a disproportionate share of that
// budget. This pins maxHitFieldRunes actually gets applied per field.
func TestSearchToolTruncatesLongHitFields(t *testing.T) {
	longSnippet := strings.Repeat("x", 5000)
	p := &fakeSearchProvider{hits: []SearchHit{{Title: "T", URL: "https://e.com", Snippet: longSnippet}}}
	tool := NewSearchTool(p, 3)
	out, err := tool.Run(context.Background(), `{"query":"q"}`)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if len(out) > 1000 {
		t.Errorf("out dài %d byte — một snippet 5000 ký tự phải bị cắt về maxHitFieldRunes, "+
			"không chảy nguyên vào content: %.80s...", len(out), out)
	}
}

// TestSearchToolRequestsSearchResultLimitFromProvider is round-1 review's M4: the reviewer's
// own words — "không test nào đọc `limit` mà tool truyền xuống provider — đây là lỗ phủ lớn
// nhất". searchResultLimit (5) silently becoming 20 (or anything else) controls exactly how
// many external-website snippets enter the model's context per call, and nothing failed
// before this test if it drifted.
//
// Asserts against the LITERAL 5, not against the searchResultLimit constant itself — the
// first version of this test compared gotLimit to searchResultLimit and, when self-mutated
// (searchResultLimit: 5 -> 20) to check this test's own teeth, PASSED anyway: both sides of
// the comparison moved together, so the test could never observe the constant changing under
// it. A literal is what actually pins the value; if 5 is ever a deliberate change, update
// this literal too — that is the point, not an accident to route around.
func TestSearchToolRequestsSearchResultLimitFromProvider(t *testing.T) {
	var gotLimit int
	p := &fakeSearchProvider{onCall: func(call int, query string, limit int) ([]SearchHit, error) {
		gotLimit = limit
		return nil, nil
	}}
	tool := NewSearchTool(p, 3)
	if _, err := tool.Run(context.Background(), `{"query":"q"}`); err != nil {
		t.Fatalf("Run: %v", err)
	}
	const wantLimit = 5
	if gotLimit != wantLimit {
		t.Errorf("limit truyền xuống provider = %d, muốn đúng %d", gotLimit, wantLimit)
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

// TestNewSearchToolClampsNonPositiveMaxPerTurnToOne is round-1 review's M5: an
// ai_settings.max_tool_rounds_per_turn-shaped bug — a Go zero value nobody set yet — must not
// turn into a permanently, silently refusing tool. Same fix agent.go already applies to
// Settings.MaxToolRoundsPerTurn <= 0 (clamp to 1), same reasoning: "not clamping is a silent
// failure, much harder to debug than just running exactly one round".
func TestNewSearchToolClampsNonPositiveMaxPerTurnToOne(t *testing.T) {
	p := &fakeSearchProvider{hits: []SearchHit{{Title: "T", URL: "https://e.com", Snippet: "S"}}}
	tool := NewSearchTool(p, 0)
	if _, err := tool.Run(context.Background(), `{"query":"q"}`); err != nil {
		t.Fatalf("maxPerTurn=0 muốn kẹp về 1 (còn chạy được ít nhất một lượt), được lỗi %v", err)
	}
	if _, err := tool.Run(context.Background(), `{"query":"q"}`); !errors.Is(err, ErrSearchBudgetExhausted) {
		t.Errorf("lượt thứ 2 (sau khi kẹp về 1) muốn ErrSearchBudgetExhausted, được %v", err)
	}

	p2 := &fakeSearchProvider{hits: []SearchHit{{Title: "T", URL: "https://e.com", Snippet: "S"}}}
	tool2 := NewSearchTool(p2, -5)
	if _, err := tool2.Run(context.Background(), `{"query":"q"}`); err != nil {
		t.Fatalf("maxPerTurn=-5 muốn kẹp về 1 y hệt maxPerTurn=0, được lỗi %v", err)
	}
}

// TestNewSearchToolBudgetIsPerInstanceNotSharedGlobally is round-1 review's I2: NewSearchTool's
// doc comment WARNS that the cap only means "per Turn" if callers construct a fresh instance
// per Turn — but that warning lived only in prose. This makes it a runnable assertion, both
// directions at once: two INDEPENDENT instances backed by the SAME provider each get their
// own full budget (proving the counter is not hiding on the provider or anywhere shared), and
// — in the same test — reusing ONE instance for what should have been a second Turn (calling
// Run again after its own budget is already spent) is the EXACT misuse shape the doc comment
// names: it fails closed with ErrSearchBudgetExhausted, not silently succeeding and quietly
// spending a second Turn's worth of budget that was never allocated. This does not stop a
// future caller from making that mistake (nothing at the type level can, given ToolRunner has
// no "a Turn started" hook) — it pins what happens WHEN they do, and gives this exact contract
// something that breaks loudly if it regresses, instead of only a comment nobody re-reads.
func TestNewSearchToolBudgetIsPerInstanceNotSharedGlobally(t *testing.T) {
	p := &fakeSearchProvider{hits: []SearchHit{{Title: "T", URL: "https://e.com", Snippet: "S"}}}

	toolA := NewSearchTool(p, 1)
	if _, err := toolA.Run(context.Background(), `{"query":"a"}`); err != nil {
		t.Fatalf("toolA lượt 1: muốn thành công, được %v", err)
	}

	// Một instance MỚI, cùng provider — đúng điều Task 11 PHẢI làm mỗi Turn.
	toolB := NewSearchTool(p, 1)
	if _, err := toolB.Run(context.Background(), `{"query":"b"}`); err != nil {
		t.Fatalf("toolB (instance MỚI, cùng provider): muốn thành công (budget riêng, không "+
			"bị toolA rút cạn), được %v", err)
	}

	// Hình dạng LẠM DỤNG: dùng LẠI toolA cho một "Turn" thứ hai, thay vì dựng instance mới.
	if _, err := toolA.Run(context.Background(), `{"query":"a-again"}`); !errors.Is(err, ErrSearchBudgetExhausted) {
		t.Errorf("dùng lại toolA cho lượt thứ 2: muốn ErrSearchBudgetExhausted (đúng lỗi "+
			"NewSearchTool's doc comment cảnh báo khi một instance bị dùng chung qua nhiều Turn), được %v", err)
	}
}

// TestSearchToolCapIsRaceSafeUnderConcurrentCalls is round-1 review's M4, third item: no test
// before this one ever called Run concurrently on ONE instance, so a broken/missing lock
// around the budget counter would not fail any test by itself — a data race does not always
// produce a visibly wrong COUNT on a given run, only under `-race` or an unlucky scheduling —
// even though a shared instance IS exactly the misuse shape this file's own doc comments name.
// task-8-brief.md's own verification command runs `-race` for internal/ai, which is what makes
// this test load-bearing: without `-race`, this test can pass even with the mutex deleted, by
// luck of scheduling — the assertion on succeeded/p.calls below is the belt, `-race` is the
// suspenders that actually catches the missing lock.
func TestSearchToolCapIsRaceSafeUnderConcurrentCalls(t *testing.T) {
	const maxPerTurn = 5
	const attempts = 50

	p := &fakeSearchProvider{hits: []SearchHit{{Title: "T", URL: "https://e.com", Snippet: "S"}}}
	tool := NewSearchTool(p, maxPerTurn)

	var wg sync.WaitGroup
	var succeeded int64
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := tool.Run(context.Background(), `{"query":"q"}`); err == nil {
				atomic.AddInt64(&succeeded, 1)
			}
		}()
	}
	wg.Wait()

	if succeeded != maxPerTurn {
		t.Errorf("số lượt THÀNH CÔNG = %d, muốn ĐÚNG %d (maxPerTurn) — lệch (kể cả lệch nhẹ) "+
			"nghĩa là bộ đếm bị race, học viên có thể bị tính phụ thu sai", succeeded, maxPerTurn)
	}
	if p.calls != maxPerTurn {
		t.Errorf("provider.calls = %d, muốn đúng %d", p.calls, maxPerTurn)
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

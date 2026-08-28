package ai

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

// ── fakes ────────────────────────────────────────────────────────────────

// fakeStreamCompleter cài CẢ Completer lẫn StreamCompleter (xem stream.go
// cho quyết định "thêm interface thứ hai, không nới Completer") — cùng tinh
// thần fakeCompleter (agent_test.go) nhưng đường CompleteStream: mỗi lời
// gọi trước tiên phát hết deltas[round-1] (nếu có) qua onDelta, rồi trả
// responses[round-1] (hoặc onCall nếu khác nil, thắng cả deltas/responses,
// giống chính xác quy ước fakeCompleter).
//
// Complete panic có chủ ý: RunStream (stream.go) không bao giờ được gọi
// Complete, chỉ CompleteStream — một panic ở đây là chuông báo ngay lập tức
// nếu vòng lặp lỡ gọi nhầm phương thức, thay vì một bài test âm thầm đi qua
// một đường không phải đường nó tưởng đang canh.
type fakeStreamCompleter struct {
	calls     []Request
	responses []Completion
	deltas    [][]string
	err       error
	onCall    func(round int, req Request) (Completion, error)
}

func (f *fakeStreamCompleter) Complete(ctx context.Context, req Request) (Completion, error) {
	panic("fakeStreamCompleter.Complete must not be called by RunStream — it must call CompleteStream")
}

func (f *fakeStreamCompleter) CompleteStream(ctx context.Context, req Request, onDelta func(string) error) (Completion, error) {
	f.calls = append(f.calls, req)
	round := len(f.calls)
	if round-1 < len(f.deltas) {
		for _, d := range f.deltas[round-1] {
			if err := onDelta(d); err != nil {
				return Completion{}, err
			}
		}
	}
	if f.onCall != nil {
		return f.onCall(round, req)
	}
	if f.err != nil {
		return Completion{}, f.err
	}
	if round-1 < len(f.responses) {
		return f.responses[round-1], nil
	}
	return f.responses[len(f.responses)-1], nil
}

var (
	_ Completer       = (*fakeStreamCompleter)(nil)
	_ StreamCompleter = (*fakeStreamCompleter)(nil)
)

// mkToolCall giảm lặp lại hình dạng struct ẩn danh ToolCall.Function (types.go)
// mà agent_test.go phải viết ra tay ở mọi nơi cần một ToolCall.
func mkToolCall(id, name, argsJSON string) ToolCall {
	return ToolCall{ID: id, Type: "function", Function: struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	}{Name: name, Arguments: argsJSON}}
}

// measuredToolCallFixtureLines là NGUYÊN VĂN hình dạng đo được ở
// docs/deepseek-measured.md §4 (chunk đầu mang id/type/name với arguments
// rỗng, các chunk sau chỉ bồi thêm một MẢNH của arguments theo cùng index,
// chunk cuối mang finish_reason + usage, rồi "[DONE]") — dùng LÀM fixture
// thay vì một hình dạng tự bịa, để test này còn có tác dụng chống trôi nếu
// ai đó diễn giải sai tài liệu đo khi viết stream.go.
var measuredToolCallFixtureLines = []string{
	`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_00_JKplDF8t8DbqkZaGChDX1881","type":"function","function":{"name":"read_chapter","arguments":""}}]},"finish_reason":null}]}`,
	`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{"}}]},"finish_reason":null}]}`,
	`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\""}}]},"finish_reason":null}]}`,
	`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"chapter"}}]},"finish_reason":null}]}`,
	`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"_id"}}]},"finish_reason":null}]}`,
	`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\":"}}]},"finish_reason":null}]}`,
	`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"1"}}]},"finish_reason":null}]}`,
	`data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"}"}}]},"finish_reason":null}]}`,
	`data: {"choices":[{"index":0,"delta":{"content":"","reasoning_content":null},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":386,"completion_tokens":66,"total_tokens":452,"prompt_tokens_details":{"cached_tokens":256},"completion_tokens_details":{"reasoning_tokens":20},"prompt_cache_hit_tokens":256,"prompt_cache_miss_tokens":130}}`,
	`data: [DONE]`,
}

func writeSSELines(t *testing.T, w http.ResponseWriter, lines []string) {
	t.Helper()
	flusher, ok := w.(http.Flusher)
	if !ok {
		t.Fatal("httptest ResponseWriter does not implement http.Flusher")
	}
	w.Header().Set("Content-Type", "text/event-stream")
	for _, line := range lines {
		io.WriteString(w, line+"\n\n")
		flusher.Flush()
	}
}

// ── Client-level: (*Client).CompleteStream, đường mạng thật qua httptest ──

// TestCompleteStreamDoneMarkerNeverBecomesADelta là Step 1 của
// task-7-brief.md, dùng nguyên fixture đo thật (measuredToolCallFixtureLines):
// "data: [DONE]" phải KHÔNG BAO GIỜ tạo ra một delta — cùng lúc khẳng định
// luôn việc nối `arguments` theo `index` qua 8 mảnh rời rạc (Task instructions,
// việc #2) và việc đọc `usage` ở đúng chunk cuối (việc #3, Task 9 thừa
// hưởng), vì fixture này mang cả ba trong MỘT lượt đo.
func TestCompleteStreamDoneMarkerNeverBecomesADelta(t *testing.T) {
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Đọc header qua chỉ mục map, KHÔNG qua phương thức đọc-tiện-lợi
		// một-tham-số — cùng lý do và cùng cách né đã ghi ở client_test.go's
		// TestCompleteSendsBearerAndParsesUsage: dây bẫy toàn repo canh
		// CHIỀU máy chủ TA nhận key của NGƯỜI DÙNG, không phân biệt được
		// rằng httptest.Server này đang đóng vai NHÀ CUNG CẤP nhận lại một
		// header do CHÍNH client của ta gửi đi — chiều ngược hẳn.
		if v := r.Header["Authorization"]; len(v) > 0 {
			gotAuth = v[0]
		}
		writeSSELines(t, w, measuredToolCallFixtureLines)
	}))
	defer srv.Close()

	c := New(srv.URL, "sk-test", srv.Client())

	var deltas []string
	out, err := c.CompleteStream(context.Background(), Request{
		Model:    "deepseek-v4-pro",
		Messages: []Message{{Role: "user", Content: "đọc chương 1"}},
	}, func(delta string) error {
		deltas = append(deltas, delta)
		return nil
	})
	if err != nil {
		t.Fatalf("CompleteStream: %v", err)
	}
	if gotAuth != "Bearer sk-test" {
		t.Errorf("Authorization = %q", gotAuth)
	}
	if len(deltas) != 0 {
		t.Errorf("deltas = %v, muốn rỗng — \"[DONE]\" (và mọi content rỗng khác trong fixture) không được lọt qua thành một delta", deltas)
	}
	if out.FinishReason != "tool_calls" {
		t.Errorf("FinishReason = %q, muốn tool_calls", out.FinishReason)
	}
	if len(out.Message.ToolCalls) != 1 {
		t.Fatalf("số tool_calls = %d, muốn 1", len(out.Message.ToolCalls))
	}
	tc := out.Message.ToolCalls[0]
	if tc.ID != "call_00_JKplDF8t8DbqkZaGChDX1881" {
		t.Errorf("ToolCall.ID = %q", tc.ID)
	}
	if tc.Type != "function" {
		t.Errorf("ToolCall.Type = %q, muốn function", tc.Type)
	}
	if tc.Function.Name != "read_chapter" {
		t.Errorf("ToolCall.Function.Name = %q, muốn read_chapter", tc.Function.Name)
	}
	if tc.Function.Arguments != `{"chapter_id":"1"}` {
		t.Errorf(`ToolCall.Function.Arguments = %q, muốn nối 8 mảnh rời rạc theo index thành {"chapter_id":"1"}`, tc.Function.Arguments)
	}
	if out.Usage.PromptTokens != 386 || out.Usage.CompletionTokens != 66 {
		t.Errorf("Usage = %+v, muốn prompt=386 completion=66 (đúng chunk cuối cùng của stream)", out.Usage)
	}
	if out.Usage.CacheHitTokens != 256 || out.Usage.CacheMissTokens != 130 {
		t.Errorf("Usage cache = %+v, muốn hit=256 miss=130", out.Usage)
	}
}

// TestCompleteStreamForwardsContentDeltasInOrder khẳng định đường thường
// (không tool_calls): mỗi delta.content khác rỗng phải gọi onDelta đúng một
// lần, đúng thứ tự, và Message.Content cuối cùng là nối đủ mọi mảnh.
func TestCompleteStreamForwardsContentDeltasInOrder(t *testing.T) {
	lines := []string{
		`data: {"choices":[{"index":0,"delta":{"content":"Xin "},"finish_reason":null}]}`,
		`data: {"choices":[{"index":0,"delta":{"content":"chào "},"finish_reason":null}]}`,
		`data: {"choices":[{"index":0,"delta":{"content":"bạn"},"finish_reason":null}]}`,
		`data: {"choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":3,"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":10}}`,
		`data: [DONE]`,
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeSSELines(t, w, lines)
	}))
	defer srv.Close()

	c := New(srv.URL, "sk-test", srv.Client())
	var deltas []string
	out, err := c.CompleteStream(context.Background(), Request{
		Model: "m", Messages: []Message{{Role: "user", Content: "chào"}},
	}, func(delta string) error {
		deltas = append(deltas, delta)
		return nil
	})
	if err != nil {
		t.Fatalf("CompleteStream: %v", err)
	}
	want := []string{"Xin ", "chào ", "bạn"}
	if !reflect.DeepEqual(deltas, want) {
		t.Errorf("deltas = %v, muốn %v (đúng thứ tự, không gộp không thiếu)", deltas, want)
	}
	if out.Message.Content != "Xin chào bạn" {
		t.Errorf("Message.Content = %q, muốn nối đủ ba mảnh", out.Message.Content)
	}
	if out.FinishReason != "stop" {
		t.Errorf("FinishReason = %q, muốn stop", out.FinishReason)
	}
	if len(out.Message.ToolCalls) != 0 {
		t.Errorf("ToolCalls = %+v, muốn rỗng — lượt này không gọi tool nào", out.Message.ToolCalls)
	}
}

// TestCompleteStreamMalformedChunkReturnsError: một chunk JSON hỏng giữa
// stream (mạng chập chờn, hay một hình dạng chưa từng đo) phải trả về lỗi
// rõ ràng, không phải nuốt câm hay panic — và những delta ĐÃ nhận trước đó
// không bị mất khỏi bằng chứng gọi onDelta (dù completion cuối cùng không
// bao giờ trả về, vì hàm return sớm theo lỗi).
func TestCompleteStreamMalformedChunkReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher := w.(http.Flusher)
		io.WriteString(w, `data: {"choices":[{"index":0,"delta":{"content":"xin "},"finish_reason":null}]}`+"\n\n")
		flusher.Flush()
		io.WriteString(w, `data: {broken json`+"\n\n")
		flusher.Flush()
	}))
	defer srv.Close()

	c := New(srv.URL, "sk-test", srv.Client())
	var got []string
	_, err := c.CompleteStream(context.Background(), Request{
		Model: "m", Messages: []Message{{Role: "user", Content: "hi"}},
	}, func(delta string) error {
		got = append(got, delta)
		return nil
	})
	if err == nil {
		t.Fatal("CompleteStream trả nil error dù chunk thứ hai là JSON hỏng")
	}
	if !reflect.DeepEqual(got, []string{"xin "}) {
		t.Errorf("deltas nhận trước khi lỗi = %v, muốn đúng [\"xin \"]", got)
	}
}

// TestCompleteStreamNonOKStatusReturnsProviderMessage: DeepSeek từ chối cả
// yêu cầu (429, 401, ...) trước khi kịp phát chunk nào — hành vi phải khớp
// Complete's non-2xx handling (client.go), không phải một đường code khác
// biệt và chưa test.
func TestCompleteStreamNonOKStatusReturnsProviderMessage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		io.WriteString(w, `{"error":{"message":"rate limited"}}`)
	}))
	defer srv.Close()

	c := New(srv.URL, "sk-test", srv.Client())
	_, err := c.CompleteStream(context.Background(), Request{
		Model: "m", Messages: []Message{{Role: "user", Content: "hi"}},
	}, nil)
	if err == nil {
		t.Fatal("CompleteStream trả nil error dù HTTP 429")
	}
	if !strings.Contains(err.Error(), "rate limited") {
		t.Errorf("err = %v, muốn chứa thông điệp thật của nhà cung cấp", err)
	}
}

// ── Step 2: ngắt kết nối giữa chừng thì dừng đọc, không rò goroutine ───────

// TestStreamStopsWhenClientDisconnects là Step 2 của task-7-brief.md, đúng
// tên hàm brief đã ghim sẵn. Kịch bản: người học đóng tab giữa một câu trả
// lời dài — ctx của lượt đó bị huỷ. Ba điều phải đúng CÙNG LÚC:
//  1. RunStream trả về ngay (không treo mãi trên một Read chờ DeepSeek).
//  2. Việc huỷ ctx phía client THẬT SỰ lan tới kết nối mạng — server (đóng
//     vai DeepSeek) phải tự thấy request context của nó Done, không phải
//     client chỉ âm thầm ngừng ĐỌC trong khi kết nối vẫn mở và server (hay
//     một goroutine nào đó) vẫn đang ghi/đọc, tức vẫn đang "tiêu tiền" cho
//     một câu không ai đọc.
//  3. Sau khi mọi thứ đã dừng, tổng số goroutine của tiến trình quay về
//     đúng mức nền — không có goroutine nào của stream.go bị bỏ quên chạy
//     ngầm đọc tiếp từ một kết nối đã đóng.
func TestStreamStopsWhenClientDisconnects(t *testing.T) {
	serverSawDisconnect := make(chan struct{})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher, ok := w.(http.Flusher)
		if !ok {
			t.Fatal("httptest ResponseWriter does not implement http.Flusher")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, `data: {"choices":[{"index":0,"delta":{"content":"xin "},"finish_reason":null}]}`+"\n\n")
		flusher.Flush()

		// Đợi đúng tín hiệu "kết nối phía client đã huỷ" từ chính request
		// context của SERVER — nếu Step 2 không thật (client chỉ ngừng đọc
		// cục bộ, không đóng kết nối), r.Context() không bao giờ Done và
		// test tự hết giờ ở dưới thay vì báo đạt giả.
		select {
		case <-r.Context().Done():
			close(serverSawDisconnect)
		case <-time.After(5 * time.Second):
		}
	}))
	defer srv.Close()

	runtime.GC()
	time.Sleep(10 * time.Millisecond)
	baseline := runtime.NumGoroutine()

	c := New(srv.URL, "sk-test", srv.Client())
	a := &Agent{
		Client:   c,
		Tools:    map[string]ToolRunner{},
		Settings: Settings{MaxToolRoundsPerTurn: 1, MaxTokensPerTurn: 100},
	}

	ctx, cancel := context.WithCancel(context.Background())

	// Tín hiệu chờ để gọi cancel() PHẢI đến từ phía CLIENT (một delta thật
	// sự đã được CompleteStream phân tích và gọi tới emit) — KHÔNG phải từ
	// việc server đã flush. Hai việc đó không đồng bộ: server flush xong
	// không có nghĩa là (*http.Client).Do() phía client đã nhận lại phần
	// header phản hồi và trả về. Một bản trước của test này canh theo tín
	// hiệu phía SERVER và bị lộ: cấy thử một goroutine rò rỉ ngay sau
	// resp, err := c.http.Do(...) (trước khi vào vòng đọc SSE) để xác nhận
	// test bắt được nó — nó KHÔNG bắt được, vì cancel() thắng cuộc đua với
	// chính Do(), khiến Do() tự trả lỗi "context canceled" TRƯỚC khi vòng
	// đọc SSE (và goroutine rò rỉ cấy thử) từng có cơ hội chạy — tức test
	// đã không canh đúng thứ nó tưởng đang canh. Chờ delta ĐẦU TIÊN tới tay
	// emit chứng minh Do() đã thành công và vòng đọc SSE đã thật sự bắt
	// đầu trước khi ctx bị huỷ.
	clientGotFirstDelta := make(chan struct{})
	runDone := make(chan error, 1)
	go func() {
		_, err := a.RunStream(ctx, Turn{Model: "m", BasePrompt: "base", Question: "q"}, func(e Event) error {
			if e.Kind == EventKindDelta {
				select {
				case <-clientGotFirstDelta:
				default:
					close(clientGotFirstDelta)
				}
			}
			return nil
		})
		runDone <- err
	}()

	select {
	case <-clientGotFirstDelta:
	case <-time.After(2 * time.Second):
		t.Fatal("client chưa nhận được delta đầu — CompleteStream có thể chưa từng vào vòng đọc SSE")
	}

	cancel() // người học đóng tab

	select {
	case runErr := <-runDone:
		if runErr == nil {
			t.Error("RunStream trả nil error dù ctx đã bị huỷ giữa chừng")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("RunStream không trả về sau khi ctx bị huỷ — có thể đang treo trên một goroutine đọc")
	}

	select {
	case <-serverSawDisconnect:
	case <-time.After(3 * time.Second):
		t.Fatal("server không thấy request context Done — việc huỷ ctx phía client không thật sự lan tới kết nối mạng")
	}

	c.http.CloseIdleConnections() // ép transport dọn goroutine nền còn treo

	deadline := time.Now().Add(2 * time.Second)
	for {
		if n := runtime.NumGoroutine(); n <= baseline {
			return
		}
		if time.Now().After(deadline) {
			buf := make([]byte, 1<<20)
			n := runtime.Stack(buf, true)
			t.Fatalf("goroutine không về mức nền sau khi ctx huỷ: còn %d (nền %d)\n%s", runtime.NumGoroutine(), baseline, buf[:n])
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// ── Agent-level: RunStream, qua fakeStreamCompleter (không chạm mạng) ─────

// TestRunStreamRequiresStreamCompleter khoá quyết định "thêm interface thứ
// hai" (stream.go): một Agent.Client chỉ cài Completer (fakeCompleter,
// agent_test.go — Task 6 chưa từng biết StreamCompleter tồn tại) phải nhận
// một lỗi RÕ RÀNG ngay từ đầu, TRƯỚC khi vào vòng lặp — emit không bao giờ
// được gọi, vì RunStream chưa từng thật sự bắt đầu một vòng nào.
func TestRunStreamRequiresStreamCompleter(t *testing.T) {
	fc := &fakeCompleter{}
	a := &Agent{Client: fc, Tools: map[string]ToolRunner{}, Settings: Settings{MaxToolRoundsPerTurn: 1, MaxTokensPerTurn: 100}}

	emitted := false
	_, err := a.RunStream(context.Background(), Turn{Model: "m", BasePrompt: "base", Question: "q"}, func(Event) error {
		emitted = true
		return nil
	})
	if err == nil {
		t.Fatal("RunStream trả nil error dù Client không cài StreamCompleter")
	}
	if emitted {
		t.Error("emit bị gọi dù RunStream lẽ ra phải phát hiện thiếu StreamCompleter TRƯỚC khi vào vòng lặp")
	}
}

// ── Step 3: lỗi giữa stream ra event error, không đứt câm ──────────────────

// TestRunStreamErrorEmitsErrorEventNotSilent là Step 3 của task-7-brief.md:
// một lỗi xảy ra GIỮA stream (ở đây: vòng thứ nhất phát được một delta rồi
// CompleteStream mới lỗi, mô phỏng đúng hình dạng "chunk hỏng/mạng rớt sau
// khi đã gửi vài chunk hợp lệ") phải kết thúc bằng một Event{Kind:"error"},
// không phải im lặng dừng lại không nói gì — và tuyệt đối không có Event
// "done" nào theo sau, vì lượt này KHÔNG hoàn tất.
func TestRunStreamErrorEmitsErrorEventNotSilent(t *testing.T) {
	wantErr := errors.New("boom mid stream")
	fsc := &fakeStreamCompleter{
		deltas: [][]string{{"xin "}},
		onCall: func(round int, req Request) (Completion, error) {
			return Completion{}, wantErr
		},
	}
	a := &Agent{
		Client:   fsc,
		Tools:    map[string]ToolRunner{},
		Settings: Settings{MaxToolRoundsPerTurn: 3, MaxTokensPerTurn: 100},
	}

	var events []Event
	_, err := a.RunStream(context.Background(), Turn{Model: "m", BasePrompt: "base", Question: "q"}, func(e Event) error {
		events = append(events, e)
		return nil
	})
	if err == nil {
		t.Fatal("RunStream trả nil error dù CompleteStream lỗi giữa chừng")
	}
	if !errors.Is(err, wantErr) {
		t.Errorf("err = %v, muốn bọc (errors.Is) lỗi gốc %v", err, wantErr)
	}
	if len(events) != 2 {
		t.Fatalf("events = %+v, muốn đúng 2 (một delta rồi một error)", events)
	}
	if events[0].Kind != EventKindDelta || events[0].Text != "xin " {
		t.Errorf("event đầu = %+v, muốn delta \"xin \"", events[0])
	}
	if events[1].Kind != EventKindError {
		t.Fatalf("event cuối Kind = %q, muốn error", events[1].Kind)
	}
	if !strings.Contains(events[1].Text, "boom mid stream") {
		t.Errorf("event error Text = %q, muốn chứa thông điệp lỗi gốc", events[1].Text)
	}
	for _, e := range events {
		if e.Kind == EventKindDone {
			t.Error("có Event Kind==done dù lượt này kết thúc bằng lỗi — done chỉ dành cho lượt HOÀN TẤT")
		}
	}
}

// ── Bất biến Task 6 phải giữ nguyên qua RunStream ──────────────────────────

// TestRunStreamNoToolCallsEmitsOnlyDeltasThenDone: đường vui đơn giản nhất —
// model trả lời thẳng bằng chữ (một vòng, không tool_calls) — phải phát
// đúng các Event delta theo thứ tự CompleteStream gọi onDelta, rồi đúng MỘT
// Event "done" ở cuối, không "tool" nào chen vào.
func TestRunStreamNoToolCallsEmitsOnlyDeltasThenDone(t *testing.T) {
	fsc := &fakeStreamCompleter{
		deltas: [][]string{{"Xin ", "chào"}},
		responses: []Completion{
			{FinishReason: "stop", Message: Message{Role: "assistant", Content: "Xin chào"}},
		},
	}
	a := &Agent{
		Client:   fsc,
		Tools:    map[string]ToolRunner{},
		Settings: Settings{MaxToolRoundsPerTurn: 3, MaxTokensPerTurn: 100},
	}

	var events []Event
	result, err := a.RunStream(context.Background(), Turn{Model: "m", BasePrompt: "base", Question: "chào"}, func(e Event) error {
		events = append(events, e)
		return nil
	})
	if err != nil {
		t.Fatalf("RunStream: %v", err)
	}
	if result.Answer != "Xin chào" {
		t.Errorf("Answer = %q", result.Answer)
	}
	want := []Event{{Kind: EventKindDelta, Text: "Xin "}, {Kind: EventKindDelta, Text: "chào"}, {Kind: EventKindDone}}
	if !reflect.DeepEqual(events, want) {
		t.Errorf("events = %+v, muốn %+v", events, want)
	}
}

// TestRunStreamUsageAccumulatesAcrossRounds mirror TestUsageAccumulatesAcrossRounds
// (agent_test.go, Step 4 của task-6-brief.md) qua đường stream: usage phải
// CỘNG DỒN cả 3 vòng (không chỉ vòng cuối), và MaxTokens gửi đúng
// Settings.MaxTokensPerTurn ở MỌI vòng.
func TestRunStreamUsageAccumulatesAcrossRounds(t *testing.T) {
	toolCall := mkToolCall("call_0", "read_course", `{"slug":"x"}`)
	fsc := &fakeStreamCompleter{
		responses: []Completion{
			{FinishReason: "tool_calls", Usage: Usage{PromptTokens: 100, CompletionTokens: 10, CacheHitTokens: 20, CacheMissTokens: 80},
				Message: Message{Role: "assistant", ToolCalls: []ToolCall{toolCall}}},
			{FinishReason: "tool_calls", Usage: Usage{PromptTokens: 100, CompletionTokens: 10, CacheHitTokens: 60, CacheMissTokens: 40},
				Message: Message{Role: "assistant", ToolCalls: []ToolCall{toolCall}}},
			{FinishReason: "stop", Usage: Usage{PromptTokens: 100, CompletionTokens: 10, CacheHitTokens: 90, CacheMissTokens: 10},
				Message: Message{Role: "assistant", Content: "final answer"}},
		},
	}
	a := &Agent{
		Client:   fsc,
		Tools:    map[string]ToolRunner{"read_course": &fakeTool{name: "read_course"}},
		Settings: Settings{MaxToolRoundsPerTurn: 6, MaxTokensPerTurn: 100},
	}

	var events []Event
	result, err := a.RunStream(context.Background(), Turn{
		Model: "deepseek-v4-pro", BasePrompt: "base", Question: "q",
		ToolsEnabled: []string{"read_course"},
	}, func(e Event) error {
		events = append(events, e)
		return nil
	})
	if err != nil {
		t.Fatalf("RunStream: %v", err)
	}
	if len(fsc.calls) != 3 {
		t.Fatalf("số lần gọi CompleteStream = %d, muốn 3 (dừng tự nhiên ở finish_reason stop)", len(fsc.calls))
	}
	if result.Usage.CompletionTokens != 30 {
		t.Errorf("Usage.CompletionTokens = %d, muốn 30", result.Usage.CompletionTokens)
	}
	if result.Usage.PromptTokens != 300 {
		t.Errorf("Usage.PromptTokens = %d, muốn 300", result.Usage.PromptTokens)
	}
	if result.Usage.CacheHitTokens != 170 || result.Usage.CacheMissTokens != 130 {
		t.Errorf("Usage cache = %+v, muốn hit=170 miss=130", result.Usage)
	}
	for i, call := range fsc.calls {
		if call.MaxTokens != 100 {
			t.Errorf("vòng %d: Request.MaxTokens = %d, muốn 100", i+1, call.MaxTokens)
		}
	}
	if result.Answer != "final answer" {
		t.Errorf("Answer = %q", result.Answer)
	}
	if len(events) == 0 || events[len(events)-1].Kind != EventKindDone {
		t.Fatalf("event cuối = %+v, muốn Kind==done", events)
	}
	for _, e := range events {
		if e.Kind == EventKindError {
			t.Errorf("có Event error dù RunStream không lỗi: %+v", events)
		}
	}
}

// TestRunStreamParallelToolCallsEachGetOneToolMessage mirror
// TestParallelToolCallsEachGetOneToolMessage (agent_test.go): mảng
// tool_calls SONG SONG (docs/deepseek-measured.md §3) phải chạy hết, mỗi
// phần tử một Event "tool" VÀ một Message role "tool" riêng, đúng thứ tự,
// và tiền tố Messages của vòng trước phải còn nguyên trong vòng sau (chỉ
// nối thêm, không dựng lại).
func TestRunStreamParallelToolCallsEachGetOneToolMessage(t *testing.T) {
	calls := []ToolCall{
		mkToolCall("call_00_a", "read_course", `{"slug":"x","chapter_id":"1"}`),
		mkToolCall("call_01_b", "read_course", `{"slug":"x","chapter_id":"2"}`),
	}
	fsc := &fakeStreamCompleter{
		responses: []Completion{
			{FinishReason: "tool_calls", Message: Message{Role: "assistant", ToolCalls: calls}},
			{FinishReason: "stop", Message: Message{Role: "assistant", Content: "so sánh xong"}},
		},
	}
	runCount := 0
	a := &Agent{
		Client: fsc,
		Tools: map[string]ToolRunner{"read_course": &fakeTool{name: "read_course", run: func(ctx context.Context, argsJSON string) (string, error) {
			runCount++
			return "chapter text for " + argsJSON, nil
		}}},
		Settings: Settings{MaxToolRoundsPerTurn: 4, MaxTokensPerTurn: 100},
	}

	var toolEvents []Event
	result, err := a.RunStream(context.Background(), Turn{
		Model: "deepseek-v4-pro", BasePrompt: "base", Question: "so sánh chương 1 và 2",
		ToolsEnabled: []string{"read_course"},
	}, func(e Event) error {
		if e.Kind == EventKindTool {
			toolEvents = append(toolEvents, e)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("RunStream: %v", err)
	}
	if runCount != 2 {
		t.Fatalf("ToolRunner.Run được gọi %d lần, muốn 2", runCount)
	}
	if result.ToolCalls != 2 {
		t.Errorf("Result.ToolCalls = %d, muốn 2", result.ToolCalls)
	}
	if len(toolEvents) != 2 || toolEvents[0].Text != "read_course" || toolEvents[1].Text != "read_course" {
		t.Errorf("tool events = %+v, muốn đúng 2 event Kind=tool Text=read_course", toolEvents)
	}

	sentInRound2 := fsc.calls[1].Messages
	n := len(sentInRound2)
	if n < 3 {
		t.Fatalf("round 2 chỉ mang %d message, cần ít nhất assistant + 2 tool: %+v", n, sentInRound2)
	}
	last3 := sentInRound2[n-3:]
	if last3[0].Role != "assistant" || len(last3[0].ToolCalls) != 2 {
		t.Fatalf("message thứ %d phải là assistant mang lại 2 tool_calls gốc, có %+v", n-2, last3[0])
	}
	if last3[1].Role != "tool" || last3[1].ToolCallID != "call_00_a" {
		t.Errorf("message %d = %+v, muốn role tool / tool_call_id call_00_a", n-1, last3[1])
	}
	if last3[2].Role != "tool" || last3[2].ToolCallID != "call_01_b" {
		t.Errorf("message %d = %+v, muốn role tool / tool_call_id call_01_b", n, last3[2])
	}
	if result.Answer != "so sánh xong" {
		t.Errorf("Answer = %q", result.Answer)
	}

	round1Messages := fsc.calls[0].Messages
	if !reflect.DeepEqual(sentInRound2[:len(round1Messages)], round1Messages) {
		t.Errorf("Messages của round 2, cắt về đúng độ dài round 1, phải BẰNG NGUYÊN round 1 (chỉ NỐI THÊM)")
	}
}

// TestRunStreamWebSearchesCountsOnlyWebSearchTool mirror
// TestWebSearchesCountsOnlyWebSearchTool (agent_test.go): Result.WebSearches
// chỉ đếm tool_call gọi ĐÚNG tên "web_search", không đếm read_course.
func TestRunStreamWebSearchesCountsOnlyWebSearchTool(t *testing.T) {
	calls := []ToolCall{
		mkToolCall("call_0", "read_course", `{"slug":"x"}`),
		mkToolCall("call_1", "web_search", `{"query":"q"}`),
	}
	fsc := &fakeStreamCompleter{
		responses: []Completion{
			{FinishReason: "tool_calls", Message: Message{Role: "assistant", ToolCalls: calls}},
			{FinishReason: "stop", Message: Message{Role: "assistant", Content: "done"}},
		},
	}
	a := &Agent{
		Client: fsc,
		Tools: map[string]ToolRunner{
			"read_course": &fakeTool{name: "read_course"},
			"web_search":  &fakeTool{name: "web_search"},
		},
		Settings: Settings{MaxToolRoundsPerTurn: 4, MaxTokensPerTurn: 100},
	}

	result, err := a.RunStream(context.Background(), Turn{
		Model: "deepseek-v4-pro", BasePrompt: "base", Question: "q",
		ToolsEnabled: []string{"read_course", "web_search"},
	}, func(Event) error { return nil })
	if err != nil {
		t.Fatalf("RunStream: %v", err)
	}
	if result.ToolCalls != 2 {
		t.Errorf("Result.ToolCalls = %d, muốn 2", result.ToolCalls)
	}
	if result.WebSearches != 1 {
		t.Errorf("Result.WebSearches = %d, muốn 1", result.WebSearches)
	}
}

// TestRunStreamToolsEnabledGatesExecutionNotJustOutgoingRequest gộp
// TestDisabledToolNotSentInRequest + TestToolsEnabledGatesExecutionNotJustOutgoingRequest
// (agent_test.go) thành một: một tool bị TẮT ở ToolsEnabled lượt này không
// được gửi trong Request.Tools, VÀ không được THẬT SỰ CHẠY dù model gọi lại
// tên nó từ một tool_call CŨ còn trong History.
func TestRunStreamToolsEnabledGatesExecutionNotJustOutgoingRequest(t *testing.T) {
	ran := false
	newCalls := []ToolCall{mkToolCall("call_new", "web_search", `{"query":"q"}`)}
	fsc := &fakeStreamCompleter{
		responses: []Completion{
			{FinishReason: "tool_calls", Message: Message{Role: "assistant", ToolCalls: newCalls}},
			{FinishReason: "stop", Message: Message{Role: "assistant", Content: "done"}},
		},
	}
	a := &Agent{
		Client: fsc,
		Tools: map[string]ToolRunner{
			"read_course": &fakeTool{name: "read_course"},
			"web_search": &fakeTool{name: "web_search", run: func(ctx context.Context, argsJSON string) (string, error) {
				ran = true
				return "should not run", nil
			}},
		},
		Settings: Settings{MaxToolRoundsPerTurn: 4, MaxTokensPerTurn: 100},
	}

	oldCall := mkToolCall("old_call", "web_search", `{"query":"old"}`)
	result, err := a.RunStream(context.Background(), Turn{
		Model: "m", BasePrompt: "base",
		History: []Message{
			{Role: "assistant", ToolCalls: []ToolCall{oldCall}},
			{Role: "tool", Content: "old result", ToolCallID: "old_call"},
		},
		Question:     "q",
		ToolsEnabled: []string{"read_course"}, // web_search KHÔNG có mặt ở lượt NÀY
	}, func(Event) error { return nil })
	if err != nil {
		t.Fatalf("RunStream: %v", err)
	}
	if ran {
		t.Fatal("web_search.Run bị gọi dù ToolsEnabled lượt này không có \"web_search\"")
	}
	if result.WebSearches != 0 {
		t.Errorf("Result.WebSearches = %d, muốn 0", result.WebSearches)
	}
	if result.ToolCalls != 1 {
		t.Errorf("Result.ToolCalls = %d, muốn 1", result.ToolCalls)
	}
	sent := fsc.calls[0].Tools
	if len(sent) != 1 || sent[0].Function.Name != "read_course" {
		t.Fatalf("Request.Tools = %+v, muốn đúng 1 phần tử (read_course)", sent)
	}
	lastMsg := fsc.calls[1].Messages[len(fsc.calls[1].Messages)-1]
	if lastMsg.Role != "tool" || lastMsg.ToolCallID != "call_new" || !strings.Contains(lastMsg.Content, "not available") {
		t.Errorf("message tool-result cho lần gọi bị tắt = %+v, muốn báo \"not available\"", lastMsg)
	}
}

// TestRunStreamMaxRoundsExhaustedWithEmptyAnswerReturnsDistinguishableError
// mirror TestMaxRoundsExhaustedWithEmptyAnswerReturnsDistinguishableError
// (agent_test.go, round 1 review I6): vòng CUỐI vẫn trả tool_calls VÀ
// content rỗng (model phớt lờ ToolChoiceNone) phải trả ErrToolBudgetExhausted
// — VÀ, khác Run, phải kết bằng một Event "error", không phải "done".
func TestRunStreamMaxRoundsExhaustedWithEmptyAnswerReturnsDistinguishableError(t *testing.T) {
	fsc := &fakeStreamCompleter{
		onCall: func(round int, req Request) (Completion, error) {
			return Completion{
				FinishReason: "tool_calls",
				Usage:        Usage{PromptTokens: 50, CompletionTokens: 5},
				Message: Message{Role: "assistant", Content: "", ToolCalls: []ToolCall{
					mkToolCall(fmt.Sprintf("call_%d", round), "read_course", `{"slug":"x"}`),
				}},
			}, nil
		},
	}
	a := &Agent{
		Client:   fsc,
		Tools:    map[string]ToolRunner{"read_course": &fakeTool{name: "read_course"}},
		Settings: Settings{MaxToolRoundsPerTurn: 2, MaxTokensPerTurn: 100},
	}

	var events []Event
	result, err := a.RunStream(context.Background(), Turn{
		Model: "m", BasePrompt: "base", Question: "q", ToolsEnabled: []string{"read_course"},
	}, func(e Event) error {
		events = append(events, e)
		return nil
	})
	if err == nil {
		t.Fatal("RunStream trả nil error dù vòng cuối content rỗng và model vẫn xin tool")
	}
	if !errors.Is(err, ErrToolBudgetExhausted) {
		t.Errorf("err = %v, muốn bọc (errors.Is) ErrToolBudgetExhausted", err)
	}
	if result.Answer != "" {
		t.Errorf("Answer = %q, muốn rỗng", result.Answer)
	}
	if result.Usage.CompletionTokens != 10 {
		t.Errorf("Usage.CompletionTokens = %d, muốn 10 (usage vẫn cộng dồn dù kết thúc bằng lỗi)", result.Usage.CompletionTokens)
	}
	if len(events) == 0 || events[len(events)-1].Kind != EventKindError {
		t.Fatalf("event cuối = %+v, muốn Kind==error (không phải đứt câm)", events)
	}
}

// TestRunStreamErrorStillCarriesUsageFromCompletedRounds mirror
// TestRunErrorStillCarriesUsageFromCompletedRounds (agent_test.go, round 1
// review I7): khi RunStream trả err != nil, Result vẫn phải mang Usage cộng
// dồn từ mọi vòng ĐÃ HOÀN TẤT trước lỗi, không phải Result{} rỗng.
func TestRunStreamErrorStillCarriesUsageFromCompletedRounds(t *testing.T) {
	toolCall := mkToolCall("call_0", "read_course", `{"slug":"x"}`)
	wantErr := errors.New("boom at round 3")

	fsc := &fakeStreamCompleter{
		onCall: func(round int, req Request) (Completion, error) {
			if round == 3 {
				return Completion{}, wantErr
			}
			return Completion{
				FinishReason: "tool_calls",
				Usage:        Usage{PromptTokens: 100, CompletionTokens: 10},
				Message:      Message{Role: "assistant", ToolCalls: []ToolCall{toolCall}},
			}, nil
		},
	}
	a := &Agent{
		Client:   fsc,
		Tools:    map[string]ToolRunner{"read_course": &fakeTool{name: "read_course"}},
		Settings: Settings{MaxToolRoundsPerTurn: 5, MaxTokensPerTurn: 100},
	}

	result, err := a.RunStream(context.Background(), Turn{
		Model: "m", BasePrompt: "base", Question: "q", ToolsEnabled: []string{"read_course"},
	}, func(Event) error { return nil })
	if err == nil {
		t.Fatal("RunStream trả nil error")
	}
	if !errors.Is(err, wantErr) {
		t.Errorf("err = %v, muốn bọc (errors.Is) %v", err, wantErr)
	}
	if result.Usage.CompletionTokens != 20 || result.Usage.PromptTokens != 200 {
		t.Errorf("Usage = %+v, muốn cộng dồn đúng 2 vòng đã hoàn tất trước lỗi (20/200)", result.Usage)
	}
}

// ── Vòng sửa 1 review: M5 — ToolChoice gửi lên dây phải khoá bằng test ─────

// TestRunStreamSendsToolChoiceAutoThenNoneOnLastRound mirror
// TestMaxToolRoundsCutsLoop (agent_test.go): các vòng KHÔNG PHẢI vòng cuối
// phải gửi ToolChoiceAuto, vòng CUỐI phải gửi ToolChoiceNone. Trước bài sửa
// này, không test stream nào khẳng định GIÁ TRỊ gửi lên dây — xoá hẳn logic
// chọn toolChoice ở stream.go vẫn để lại 14 test cũ xanh, vì
// ErrToolBudgetExhausted chỉ khoá HỆ QUẢ (model phớt lờ tool_choice), không
// khoá việc tool_choice có được GỬI ĐÚNG hay không. Tự chứng minh test này
// có răng: xoá logic ở stream.go rồi chạy lại — xem task-7-report.md.
func TestRunStreamSendsToolChoiceAutoThenNoneOnLastRound(t *testing.T) {
	fsc := &fakeStreamCompleter{
		onCall: func(round int, req Request) (Completion, error) {
			return Completion{
				FinishReason: "tool_calls",
				Message: Message{Role: "assistant", ToolCalls: []ToolCall{
					mkToolCall(fmt.Sprintf("call_%d", round), "read_course", `{"slug":"x"}`),
				}, Content: fmt.Sprintf("round %d partial", round)},
			}, nil
		},
	}
	a := &Agent{
		Client:   fsc,
		Tools:    map[string]ToolRunner{"read_course": &fakeTool{name: "read_course"}},
		Settings: Settings{MaxToolRoundsPerTurn: 3, MaxTokensPerTurn: 100},
	}

	result, err := a.RunStream(context.Background(), Turn{
		Model: "deepseek-v4-pro", BasePrompt: "base", Question: "so sánh chương 1 và 2",
		ToolsEnabled: []string{"read_course"},
	}, func(Event) error { return nil })
	if err != nil {
		t.Fatalf("RunStream trả lỗi dù client giả không bao giờ lỗi: %v", err)
	}
	if len(fsc.calls) != 3 {
		t.Fatalf("số lần gọi CompleteStream = %d, muốn đúng 3 (= MaxToolRoundsPerTurn)", len(fsc.calls))
	}
	if result.Answer != "round 3 partial" {
		t.Errorf("Answer = %q, muốn nội dung của VÒNG CUỐI (round 3 partial)", result.Answer)
	}
	if fsc.calls[0].ToolChoice != ToolChoiceAuto || fsc.calls[1].ToolChoice != ToolChoiceAuto {
		t.Errorf("hai vòng đầu phải gửi ToolChoiceAuto, có %q / %q", fsc.calls[0].ToolChoice, fsc.calls[1].ToolChoice)
	}
	if fsc.calls[2].ToolChoice != ToolChoiceNone {
		t.Errorf("vòng cuối (thứ 3) phải gửi ToolChoiceNone, có %q", fsc.calls[2].ToolChoice)
	}
}

// ── Vòng sửa 1 review: I3 — Run và RunStream không được rẽ nhánh khác nhau ─

// TestRunAndRunStreamProduceSameResultForSameScenario chạy CÙNG một kịch
// bản (3 vòng: hai vòng tool rồi vòng trả lời bằng chữ, y hệt
// TestUsageAccumulatesAcrossRounds/TestRunStreamUsageAccumulatesAcrossRounds)
// qua CẢ Run (fakeCompleter, agent_test.go) lẫn RunStream
// (fakeStreamCompleter, tệp này), rồi khẳng định hai Result BẰNG NHAU.
//
// stream.go's vòng lặp là bản sao verbatim của agent.go's Run, khác đúng
// vài chỗ liên quan tới emit — không có lưới nào buộc một sửa ở Run (ví dụ
// nợ Task 8: Brave hỏng phải trả error Go thật, nếu không WebSearches++
// tính tiền cho một lượt tìm thất bại) phải được mang sang RunStream cùng
// lúc. Test này không xoá được rủi ro "sửa một chỗ quên chỗ kia", nhưng nó
// biến "hai bản sao im lặng" thành "hai bản sao có một test so kết quả" —
// một sửa làm lệch KẾT QUẢ (không chỉ lệch cách viết) giữa hai đường sẽ làm
// test này đỏ. Xem chú thích tương ứng ở agent.go's Run.
func TestRunAndRunStreamProduceSameResultForSameScenario(t *testing.T) {
	toolCall := mkToolCall("call_0", "read_course", `{"slug":"x"}`)
	responses := []Completion{
		{FinishReason: "tool_calls", Usage: Usage{PromptTokens: 100, CompletionTokens: 10, CacheHitTokens: 20, CacheMissTokens: 80},
			Message: Message{Role: "assistant", ToolCalls: []ToolCall{toolCall}}},
		{FinishReason: "tool_calls", Usage: Usage{PromptTokens: 100, CompletionTokens: 10, CacheHitTokens: 60, CacheMissTokens: 40},
			Message: Message{Role: "assistant", ToolCalls: []ToolCall{toolCall}}},
		{FinishReason: "stop", Usage: Usage{PromptTokens: 100, CompletionTokens: 10, CacheHitTokens: 90, CacheMissTokens: 10},
			Message: Message{Role: "assistant", Content: "final answer"}},
	}
	turn := Turn{
		Model: "deepseek-v4-pro", BasePrompt: "base", Question: "q",
		ToolsEnabled: []string{"read_course"},
	}
	settings := Settings{MaxToolRoundsPerTurn: 6, MaxTokensPerTurn: 100}

	fc := &fakeCompleter{responses: responses}
	runResult, err := (&Agent{
		Client:   fc,
		Tools:    map[string]ToolRunner{"read_course": &fakeTool{name: "read_course"}},
		Settings: settings,
	}).Run(context.Background(), turn)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}

	fsc := &fakeStreamCompleter{responses: responses}
	streamResult, err := (&Agent{
		Client:   fsc,
		Tools:    map[string]ToolRunner{"read_course": &fakeTool{name: "read_course"}},
		Settings: settings,
	}).RunStream(context.Background(), turn, func(Event) error { return nil })
	if err != nil {
		t.Fatalf("RunStream: %v", err)
	}

	if !reflect.DeepEqual(runResult, streamResult) {
		t.Errorf("Run và RunStream trả Result KHÁC NHAU cho cùng một kịch bản:\nRun:       %+v\nRunStream: %+v", runResult, streamResult)
	}
}

// ── Vòng sửa 1 review: I1 — thân 200 bị cắt nửa chừng không được coi là ────
// ── một completion THÀNH CÔNG ──────────────────────────────────────────────

// TestCompleteStreamTruncatedResponseReturnsError: Complete (client.go) có
// guard "len(wire.Choices) == 0" chặn một response 200 nhưng RỖNG NGHĨA —
// CompleteStream trước bài sửa này KHÔNG có gì tương đương: kết nối đóng
// sạch (scanner.Err() == nil, io.EOF) mà chưa từng thấy "[DONE]" vẫn trả về
// một Completion{} + nil error, y hệt một lượt THÀNH CÔNG. Ba thiệt hại
// cùng lúc (review ghi rõ): người học thấy câu cụt như câu hoàn chỉnh,
// Task 9 trừ 0 credit cho token DeepSeek ĐÃ tính tiền, và một tool_call bị
// cắt giữa các mảnh arguments đi thẳng vào runner.Run như thể hợp lệ.
//
// Kịch bản: server flush một delta hợp lệ rồi ĐÓNG KẾT NỐI SẠCH (không lỗi
// mạng — return khỏi handler bình thường) mà không bao giờ gửi "[DONE]" —
// mô phỏng LB đóng sớm, DeepSeek ngắt giữa chừng, hoặc io.LimitReader chạm
// trần maxResponseBytes.
func TestCompleteStreamTruncatedResponseReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, `data: {"choices":[{"index":0,"delta":{"content":"xin "},"finish_reason":null}]}`+"\n\n")
		flusher.Flush()
		// Handler return bình thường ở đây — KHÔNG có "data: [DONE]" —
		// đúng hình dạng "thân 200 bị cắt nửa chừng".
	}))
	defer srv.Close()

	c := New(srv.URL, "sk-test", srv.Client())
	var deltas []string
	_, err := c.CompleteStream(context.Background(), Request{
		Model: "m", Messages: []Message{{Role: "user", Content: "hi"}},
	}, func(delta string) error {
		deltas = append(deltas, delta)
		return nil
	})
	if err == nil {
		t.Fatal("CompleteStream trả nil error dù kết nối đóng sạch mà chưa từng thấy \"[DONE]\" — thân bị cắt phải là một lỗi, không phải một completion thành công")
	}
	if !strings.Contains(err.Error(), "DONE") {
		t.Errorf(`err = %v, muốn nói rõ thiếu "[DONE]" — người đọc log cần phân biệt được ca này với một lỗi mạng thường`, err)
	}
	if len(deltas) != 1 || deltas[0] != "xin " {
		t.Errorf("deltas = %v, muốn [\"xin \"] — chunk hợp lệ nhận được TRƯỚC khi đứt vẫn phải tới tay onDelta dù completion cuối cùng không bao giờ trả về", deltas)
	}
}

// ── Vòng sửa 1 review: I4 — trần thời gian phải là IDLE, không phải WALL-CLOCK ─

// TestCompleteStreamIdleTimeoutFiresOnNoProgress: server flush một delta
// hợp lệ rồi IM LẶNG MÃI MÃI (không đóng kết nối, không lỗi — mô phỏng
// DeepSeek "treo" giữa chừng, không phải một câu trả lời dài nhưng vẫn đang
// tiến triển). CompleteStream phải tự cắt sau streamIdleTimeout kể từ lần
// nhận dữ liệu CUỐI CÙNG — không phải kể từ lúc BẮT ĐẦU cuộc gọi (một trần
// WALL-CLOCK phẳng sẽ cắt ngang cả một câu trả lời dài nhưng vẫn đang chảy
// đều, đúng thứ review chỉ ra bằng phép tính: 8192 max_tokens_per_turn ở
// 20-60 tok/s cần 137-410s > 90s).
//
// streamIdleTimeout là một `var` (không phải `const`) CHÍNH VÌ test này —
// không thể chờ 90s thật trong một unit test.
func TestCompleteStreamIdleTimeoutFiresOnNoProgress(t *testing.T) {
	orig := streamIdleTimeout
	streamIdleTimeout = 80 * time.Millisecond
	defer func() { streamIdleTimeout = orig }()

	blockForever := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, `data: {"choices":[{"index":0,"delta":{"content":"xin "},"finish_reason":null}]}`+"\n\n")
		flusher.Flush()
		<-blockForever // im lặng mãi mãi sau chunk đầu — không đóng, không lỗi
	}))
	defer srv.Close() // LIFO: chạy SAU close(blockForever) — handler phải return trước
	defer close(blockForever)

	c := New(srv.URL, "sk-test", srv.Client())
	start := time.Now()
	_, err := c.CompleteStream(context.Background(), Request{
		Model: "m", Messages: []Message{{Role: "user", Content: "hi"}},
	}, func(string) error { return nil })
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("CompleteStream trả nil error dù server im lặng vượt streamIdleTimeout")
	}
	if !strings.Contains(err.Error(), "idle") {
		t.Errorf("err = %v, muốn thông điệp phân biệt được đây là IDLE timeout, không phải một lỗi mạng thường", err)
	}
	if elapsed > 2*time.Second {
		t.Errorf("mất %s để timeout, muốn gần streamIdleTimeout (%s) — trần không được là wall-clock cố định lớn hơn nhiều", elapsed, streamIdleTimeout)
	}
}

// TestCompleteStreamIdleTimeoutResetsOnEachChunk chứng minh nửa còn lại của
// I4: một chuỗi chunk đến đều đặn, mỗi khoảng cách NGẮN HƠN streamIdleTimeout
// nhưng TỔNG thời gian dài HƠN streamIdleTimeout, không được bị cắt — đây
// chính là khác biệt giữa idle-timeout và wall-clock mà review yêu cầu.
func TestCompleteStreamIdleTimeoutResetsOnEachChunk(t *testing.T) {
	orig := streamIdleTimeout
	streamIdleTimeout = 100 * time.Millisecond
	defer func() { streamIdleTimeout = orig }()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		// 6 chunk, mỗi chunk cách nhau 40ms (< streamIdleTimeout) nhưng
		// TỔNG 240ms (> streamIdleTimeout) — một wall-clock 100ms sẽ cắt
		// ngang trước khi gửi hết; idle-timeout thì không, vì mỗi chunk
		// đều đến trước khi hạn idle của LẦN GỬI TRƯỚC hết hạn.
		for i := 0; i < 6; i++ {
			io.WriteString(w, `data: {"choices":[{"index":0,"delta":{"content":"a"},"finish_reason":null}]}`+"\n\n")
			flusher.Flush()
			time.Sleep(40 * time.Millisecond)
		}
		io.WriteString(w, `data: {"choices":[{"index":0,"delta":{"content":""},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":1}}`+"\n\n")
		flusher.Flush()
		io.WriteString(w, "data: [DONE]\n\n")
		flusher.Flush()
	}))
	defer srv.Close()

	c := New(srv.URL, "sk-test", srv.Client())
	out, err := c.CompleteStream(context.Background(), Request{
		Model: "m", Messages: []Message{{Role: "user", Content: "hi"}},
	}, func(string) error { return nil })
	if err != nil {
		t.Fatalf("CompleteStream: %v — idle timeout không được cắt một stream vẫn đang chảy đều (mỗi chunk cách nhau < streamIdleTimeout)", err)
	}
	if out.Message.Content != "aaaaaa" {
		t.Errorf("Message.Content = %q, muốn đủ 6 chunk", out.Message.Content)
	}
}

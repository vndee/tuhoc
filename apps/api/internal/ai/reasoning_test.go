package ai

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestCompleteStreamCountsReasoningContent đo đúng cái lỗ hổng đã có: trường
// `reasoning_content` từng KHÔNG được khai trong wireStreamChunk.Delta, nên
// mọi chunk suy luận bị giải mã thành delta rỗng và biến mất không dấu vết.
//
// Con số ở đây không bịa: đo trên api.deepseek.com với deepseek-v4-pro, cùng
// một câu hỏi, hai ngân sách token —
//
//	max_tokens=200  → 201 chunk reasoning_content, 0 chunk content
//	max_tokens=2000 → 474 chunk reasoning_content, 292 chunk content
//
// Hàng đầu là hình dạng test này dựng lại.
func TestCompleteStreamCountsReasoningContent(t *testing.T) {
	lines := []string{
		`data: {"choices":[{"index":0,"delta":{"reasoning_content":"nghĩ "},"finish_reason":null}]}`,
		`data: {"choices":[{"index":0,"delta":{"reasoning_content":"tiếp"},"finish_reason":null}]}`,
		`data: {"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}`,
		`data: [DONE]`,
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeSSELines(t, w, lines)
	}))
	defer srv.Close()

	var deltas []string
	got, err := New(srv.URL, "sk-test", srv.Client()).CompleteStream(
		context.Background(), Request{Model: "m"}, func(s string) error {
			deltas = append(deltas, s)
			return nil
		})
	if err != nil {
		t.Fatalf("CompleteStream: %v", err)
	}

	// Phần NGHĨ được đếm...
	if want := len("nghĩ ") + len("tiếp"); got.ReasoningChars != want {
		t.Errorf("ReasoningChars = %d, muốn %d", got.ReasoningChars, want)
	}
	// ...nhưng KHÔNG bao giờ chảy vào câu trả lời, và không được đẩy ra cho
	// người học như một delta. Nó là suy nghĩ của model, không phải lời nói.
	if got.Message.Content != "" {
		t.Errorf("Content = %q, muốn rỗng — reasoning không được lẫn vào câu trả lời", got.Message.Content)
	}
	if len(deltas) != 0 {
		t.Errorf("onDelta được gọi %d lần với %q, muốn 0", len(deltas), deltas)
	}
	if got.FinishReason != "length" {
		t.Errorf("FinishReason = %q, muốn \"length\"", got.FinishReason)
	}
}

// TestRunAnswerCutOffAtLength: hết token TRƯỚC KHI viết được chữ nào là một
// lỗi có tên, không phải một câu trả lời rỗng thầm lặng.
func TestRunAnswerCutOffAtLength(t *testing.T) {
	fc := &fakeCompleter{responses: []Completion{{
		Message:        Message{Role: "assistant", Content: ""},
		FinishReason:   "length",
		ReasoningChars: 4096,
	}}}
	a := &Agent{Client: fc, Settings: Settings{MaxToolRoundsPerTurn: 3, MaxTokensPerTurn: 100}}

	result, err := a.Run(context.Background(), Turn{Model: "m", BasePrompt: "base", Question: "q"})
	if err == nil {
		t.Fatal("Run trả nil error dù model bị cắt trước khi kịp trả lời")
	}
	if !errors.Is(err, ErrAnswerCutOff) {
		t.Errorf("err = %v, muốn bọc (errors.Is) ErrAnswerCutOff", err)
	}
	if result.Answer != "" {
		t.Errorf("Answer = %q, muốn rỗng", result.Answer)
	}
}

// TestRunEmptyAnswerAtStopIsNotAnError giữ RANH GIỚI, và nó quan trọng ngang
// test trên.
//
// agent.go đã có một quyết định thành văn: một câu trả lời rỗng kèm
// finish_reason "stop" là model CHỦ ĐỘNG im — chuyện chất lượng câu trả lời,
// không phải hết ngân sách — và Run cố ý không coi đó là lỗi.
//
// Không có test này, "bắt lỗi khi câu trả lời rỗng" sẽ trôi dần sang bắt cả
// trường hợp ấy, và một quyết định có chủ ý biến mất mà không ai nhận ra.
func TestRunEmptyAnswerAtStopIsNotAnError(t *testing.T) {
	fc := &fakeCompleter{responses: []Completion{{
		Message:      Message{Role: "assistant", Content: ""},
		FinishReason: "stop",
	}}}
	a := &Agent{Client: fc, Settings: Settings{MaxToolRoundsPerTurn: 3, MaxTokensPerTurn: 100}}

	result, err := a.Run(context.Background(), Turn{Model: "m", BasePrompt: "base", Question: "q"})
	if err != nil {
		t.Fatalf("Run trả lỗi %v — nội dung rỗng kèm \"stop\" KHÔNG phải lỗi", err)
	}
	if result.Answer != "" {
		t.Errorf("Answer = %q, muốn rỗng", result.Answer)
	}
}

// TestErrorEnvelopeSeparatesCutOffFromProviderFailure: ba tình huống, ba mã.
//
// Gộp chúng lại là nói dối người học theo ba cách khác nhau: "thử lại sau" cho
// một tường mà thử lại nguyên văn sẽ đâm y hệt, "hết ngân sách công cụ" cho
// một giới hạn token, hoặc "hết token" cho một sự cố nhà cung cấp thật.
func TestErrorEnvelopeSeparatesCutOffFromProviderFailure(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want string
	}{
		{"bị cắt vì hết token", ErrAnswerCutOff, CodeAnswerCutOff},
		{"hết ngân sách vòng tool", ErrToolBudgetExhausted, CodeToolBudgetExhausted},
		{"lỗi thật của nhà cung cấp", errors.New("ai: DeepSeek stream returned HTTP 500"), CodeProviderFailed},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := errorEnvelope(tc.err).Code; got != tc.want {
				t.Errorf("Code = %q, muốn %q", got, tc.want)
			}
		})
	}
}

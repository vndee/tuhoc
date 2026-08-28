package ai

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestCompleteSendsBearerAndParsesUsage là Step 1 của brief Task 4b: khẳng
// định ba điều cùng lúc — Authorization mang đúng "Bearer <key>", thân
// request gửi đúng model/messages, và path gọi đúng "/chat/completions"
// (DeepSeek đo được ở task-0-measurements-raw.md, KHÔNG có tiền tố /v1) —
// rồi Usage đọc đúng bốn trường đã đo ở docs/deepseek-measured.md §1.
func TestCompleteSendsBearerAndParsesUsage(t *testing.T) {
	var gotAuth, gotBody, gotPath, gotContentType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Đọc header qua chỉ mục map r.Header["Authorization"] trực tiếp,
		// tránh dùng phương thức đọc-tiện-lợi một-tham-số của net/http.Header
		// cho đúng header này: dây bẫy
		// apps/api/internal/server/provider_key_never_leaks_test.go's
		// keyBearingFields quét TOÀN REPO (kể cả tệp test) tìm đúng hình dạng
		// lời gọi đó áp cho header Authorization — nó cấm ĐỌC header đó ở
		// BẤT KỲ ĐÂU, vì nó tồn tại để chặn route CỦA SERVER TA nhận key
		// người dùng qua đúng hình dạng gọi ấy. Ở đây, r là request
		// httptest.Server này (đóng vai NHÀ CUNG CẤP DeepSeek) nhận được TỪ
		// client của chính ta — hướng ngược hẳn với thứ dây bẫy đó canh
		// (server ta nhận key CỦA NGƯỜI DÙNG) — nhưng dây bẫy so khớp CHUỖI,
		// không phân biệt được hai hướng. Không sửa dây bẫy (không thuộc
		// phạm vi Task 4b); đổi cách đọc ở phía test thay vì nới cổng bảo
		// mật.
		if v := r.Header["Authorization"]; len(v) > 0 {
			gotAuth = v[0]
		}
		gotPath = r.URL.Path
		gotContentType = r.Header.Get("Content-Type")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"chào"}}],
		  "usage":{"prompt_tokens":100,"completion_tokens":20,"prompt_cache_hit_tokens":80,"prompt_cache_miss_tokens":20}}`)
	}))
	defer srv.Close()

	c := New(srv.URL, "sk-test", srv.Client())
	out, err := c.Complete(context.Background(), Request{
		Model: "deepseek-v4-pro", MaxTokens: 100,
		Messages: []Message{{Role: "user", Content: "chào"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if gotAuth != "Bearer sk-test" {
		t.Errorf("Authorization = %q", gotAuth)
	}
	if gotPath != "/chat/completions" {
		t.Errorf("path = %q, muốn /chat/completions (đo ở task-0-measurements-raw.md, không có tiền tố /v1)", gotPath)
	}
	if gotContentType != "application/json" {
		t.Errorf("Content-Type = %q, muốn application/json", gotContentType)
	}
	if !strings.Contains(gotBody, `"model":"deepseek-v4-pro"`) {
		t.Errorf("thân request thiếu model: %s", gotBody)
	}
	if !strings.Contains(gotBody, `"messages":[{"role":"user","content":"chào"}]`) {
		t.Errorf("thân request thiếu messages đúng shape: %s", gotBody)
	}
	if out.Usage.CacheHitTokens != 80 || out.Usage.CacheMissTokens != 20 {
		t.Errorf("usage cache = %d/%d, muốn 80/20", out.Usage.CacheHitTokens, out.Usage.CacheMissTokens)
	}
	if out.Usage.PromptTokens != 100 || out.Usage.CompletionTokens != 20 {
		t.Errorf("usage prompt/completion = %d/%d, muốn 100/20", out.Usage.PromptTokens, out.Usage.CompletionTokens)
	}
	if out.FinishReason != "stop" {
		t.Errorf("FinishReason = %q, muốn stop", out.FinishReason)
	}
	if out.Message.Content != "chào" {
		t.Errorf("Message.Content = %q, muốn chào", out.Message.Content)
	}
}

// TestCompleteErrorNeverContainsKey là Step 2 của brief Task 4b — điểm cốt
// lõi của task. Một `%w` bọc cả *http.Request là đường rò key kinh điển: nó
// kéo theo header Authorization. apps/api/internal/server/
// provider_key_never_leaks_test.go quét CẤU TRÚC (cùng dòng nguồn, tên
// trường), test này quét HÀNH VI (giá trị lỗi thật, ở đúng gói phát sinh
// nó) — hai nửa bổ khuyết cho nhau đúng cách provider_key_never_leaks_test.go
// tự mô tả về chính nó.
func TestCompleteErrorNeverContainsKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		io.WriteString(w, `{"error":{"message":"boom"}}`)
	}))
	defer srv.Close()
	_, err := New(srv.URL, "sk-SENTINEL", srv.Client()).
		Complete(context.Background(), Request{Model: "m", Messages: []Message{{Role: "user"}}})
	if err == nil {
		t.Fatal("muốn lỗi")
	}
	if strings.Contains(err.Error(), "sk-SENTINEL") {
		t.Errorf("lỗi mang key: %v", err)
	}
}

// TestCompleteErrorIncludesStatusAndProviderMessage khẳng định nửa còn lại
// của Step 4 (brief): lỗi HTTP phải mang đủ thông tin để gỡ lỗi được —
// status code và trường error.message của thân response — dù nó không được
// mang key. Không kiểm tính "không rò" là chưa đủ; một client trả
// "ai: lỗi" cho MỌI lỗi HTTP thì Task 6/7/9 (đọc lỗi để quyết định retry hay
// báo người dùng) không phân biệt được 401 (key sai) với 429 (hết hạn mức)
// với 500 (DeepSeek sập).
func TestCompleteErrorIncludesStatusAndProviderMessage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(429)
		io.WriteString(w, `{"error":{"message":"rate limit exceeded, slow down"}}`)
	}))
	defer srv.Close()
	_, err := New(srv.URL, "sk-test", srv.Client()).
		Complete(context.Background(), Request{Model: "m", Messages: []Message{{Role: "user"}}})
	if err == nil {
		t.Fatal("muốn lỗi")
	}
	if !strings.Contains(err.Error(), "429") {
		t.Errorf("lỗi thiếu status code: %v", err)
	}
	if !strings.Contains(err.Error(), "rate limit exceeded, slow down") {
		t.Errorf("lỗi thiếu error.message của nhà cung cấp: %v", err)
	}
}

// TestCompleteDecodesMultipleParallelToolCalls khẳng định docs/
// deepseek-measured.md §3: "tool_calls là MẢNG nhiều phần tử — model có thể
// gọi song song." client.go chỉ cần decode đúng mảng (vòng lặp nhiều bước là
// việc Task 6) — test này khẳng định đúng phần việc đó, dùng nguyên shape đo
// được ở §3 (hai lời gọi read_chapter, chapter_id "1" và "2").
func TestCompleteDecodesMultipleParallelToolCalls(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"choices":[{"finish_reason":"tool_calls","message":{"role":"assistant","content":"",
		  "tool_calls":[
		    {"id":"call_00_a","type":"function","function":{"name":"read_chapter","arguments":"{\"chapter_id\": \"1\"}"}},
		    {"id":"call_01_b","type":"function","function":{"name":"read_chapter","arguments":"{\"chapter_id\": \"2\"}"}}
		  ]}}],"usage":{"prompt_tokens":1,"completion_tokens":1,"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":1}}`)
	}))
	defer srv.Close()

	out, err := New(srv.URL, "sk-test", srv.Client()).Complete(context.Background(), Request{
		Model:    "deepseek-v4-pro",
		Messages: []Message{{Role: "user", Content: "so sánh chương 1 và 2"}},
		Tools:    []Tool{{Type: "function", Function: ToolFunction{Name: "read_chapter"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if out.FinishReason != "tool_calls" {
		t.Fatalf("FinishReason = %q, muốn tool_calls", out.FinishReason)
	}
	if len(out.Message.ToolCalls) != 2 {
		t.Fatalf("số tool_calls = %d, muốn 2 (model gọi song song)", len(out.Message.ToolCalls))
	}
	if out.Message.ToolCalls[0].ID != "call_00_a" || out.Message.ToolCalls[1].ID != "call_01_b" {
		t.Errorf("ID tool_calls = %q/%q, muốn call_00_a/call_01_b — thứ tự mảng phải giữ nguyên",
			out.Message.ToolCalls[0].ID, out.Message.ToolCalls[1].ID)
	}
	if out.Message.ToolCalls[0].Function.Arguments != `{"chapter_id": "1"}` {
		t.Errorf("arguments[0] = %q", out.Message.ToolCalls[0].Function.Arguments)
	}
	if out.Message.ToolCalls[1].Function.Arguments != `{"chapter_id": "2"}` {
		t.Errorf("arguments[1] = %q", out.Message.ToolCalls[1].Function.Arguments)
	}
}

// TestCompleteOmitsToolsFieldWhenRequestHasNone khẳng định cơ chế mà Task 6
// Step 5 sẽ dựa vào ("tool không nằm trong ToolsEnabled KHÔNG được gửi
// lên"): khi Request.Tools rỗng, thân request không được mang khoá "tools"
// nào cả — không phải mảng rỗng, không phải null. Task 6 quyết định TRƯỚC
// khi gọi Complete tool nào được liệt kê; client.go chỉ cần không tự thêm gì
// vào một Request.Tools rỗng.
func TestCompleteOmitsToolsFieldWhenRequestHasNone(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"ok"}}],"usage":{}}`)
	}))
	defer srv.Close()

	_, err := New(srv.URL, "sk-test", srv.Client()).Complete(context.Background(), Request{
		Model:    "m",
		Messages: []Message{{Role: "user", Content: "chào"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(gotBody, `"tools"`) {
		t.Errorf("thân request mang khoá tools dù Request.Tools rỗng: %s", gotBody)
	}
}

// TestCompleteRespectsContextCancellation khẳng định ctx thật sự đi vào
// http.Request (qua NewRequestWithContext), không bị bỏ quên — một context
// đã huỷ trước khi gọi phải làm Complete trả lỗi ngay, không treo tới khi
// httptest.Server (hoặc DeepSeek thật) tự trả lời.
func TestCompleteRespectsContextCancellation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"ok"}}],"usage":{}}`)
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	done := make(chan struct{})
	var err error
	go func() {
		_, err = New(srv.URL, "sk-test", srv.Client()).Complete(ctx, Request{
			Model: "m", Messages: []Message{{Role: "user", Content: "chào"}},
		})
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Complete treo quá 5s trên một context đã huỷ — ctx không được truyền vào request")
	}
	if err == nil {
		t.Error("muốn lỗi khi context đã huỷ trước khi gọi")
	}
}

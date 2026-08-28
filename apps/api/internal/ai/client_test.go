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
//
// VÒNG SỬA 1 (review opus): bản trước chỉ canh MỘT trong tám đường trả lỗi
// của Complete (500 kèm error.message) — bảy đường còn lại (marshal hỏng,
// build request hỏng, mạng hỏng, đọc body hỏng, 200/500 body không parse
// được, JSON hỏng, không có choices) đúng trên VĂN XUÔI chú thích, không
// trên một khẳng định chạy được. Nghiêm trọng vì cổng cấu trúc
// provider_key_never_leaks_test.go tự ghi nó MÙ với gói internal/ai (xem
// PHẠM VI THẬT điểm 2 của tệp đó) — nên test hành vi ở đây là lớp phòng
// thủ DUY NHẤT, đúng lúc Task 6/7/9 sắp thêm mã vào chính gói này. Bảng
// dưới đây phủ năm trong tám đường tới được TỪ NGOÀI (marshal req/build
// request không đứng lên được — req luôn hợp lệ ở đây; hai đường 200-body
// hỏng gộp vào bảng vì cùng cơ chế với 500-thân-hỏng):
//
//   - server đóng kết nối ngay, không trả byte nào → err từ c.http.Do
//     (đường "mạng hỏng")
//   - 500 kèm error.message → đường status!=200 có message (đã canh từ
//     đầu, giữ lại)
//   - 200 nhưng thân không phải JSON hợp lệ → đường decode wireResponse hỏng
//   - 200 nhưng thân là {} rỗng, không có choices → đường "không có choices"
//   - context đã huỷ trước khi gọi → đường ctx.Err() nổi lên qua c.http.Do
func TestCompleteErrorNeverContainsKey(t *testing.T) {
	const sentinel = "sk-SENTINEL-do-not-emit-4f2c"

	canceledCtx, cancel := context.WithCancel(context.Background())
	cancel()

	cases := []struct {
		name    string
		handler http.HandlerFunc
		ctx     context.Context // nil dùng context.Background()
	}{
		{
			name: "server đóng kết nối ngay, không trả gì (lỗi mạng)",
			handler: func(w http.ResponseWriter, r *http.Request) {
				// httptest.Server luôn phục vụ qua net/http.Server thật trên
				// TCP, nên Hijacker luôn có mặt — không cần kiểm ok.
				hj := w.(http.Hijacker)
				conn, _, _ := hj.Hijack()
				conn.Close()
			},
		},
		{
			name: "500 kèm error.message",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(500)
				io.WriteString(w, `{"error":{"message":"boom"}}`)
			},
		},
		{
			name: "200 nhưng thân không phải JSON hợp lệ",
			handler: func(w http.ResponseWriter, r *http.Request) {
				io.WriteString(w, `khong phai json, chi la rac`)
			},
		},
		{
			name: "200 nhưng thân là {} rỗng — không có choices",
			handler: func(w http.ResponseWriter, r *http.Request) {
				io.WriteString(w, `{}`)
			},
		},
		{
			name: "context đã huỷ trước khi gọi",
			handler: func(w http.ResponseWriter, r *http.Request) {
				io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"ok"}}],"usage":{}}`)
			},
			ctx: canceledCtx,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(tc.handler)
			defer srv.Close()
			ctx := tc.ctx
			if ctx == nil {
				ctx = context.Background()
			}
			_, err := New(srv.URL, sentinel, srv.Client()).
				Complete(ctx, Request{Model: "m", Messages: []Message{{Role: "user"}}})
			if err == nil {
				t.Fatal("muốn lỗi")
			}
			if strings.Contains(err.Error(), sentinel) {
				t.Errorf("lỗi mang key: %v", err)
			}
		})
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

// TestCompleteOmitsMaxTokensFieldWhenZero là việc #5 round-1 review:
// wireRequest.MaxTokens thiếu omitempty trong khi Tools có, và năm trong
// sáu test gốc gọi Complete không đặt MaxTokens — tức đang lặng lẽ gửi
// "max_tokens": 0 mà không test nào phát hiện, vì httptest không bao giờ
// phàn nàn về giá trị đó. Hành vi thật của DeepSeek với max_tokens: 0
// KHÔNG có trong docs/deepseek-measured.md, nên không đoán nó — chỉ đảm
// bảo Request.MaxTokens == 0 (giá trị zero của Go, "caller không đặt")
// không tự ý gửi lên một con số DeepSeek chưa từng được đo phản ứng ra sao.
func TestCompleteOmitsMaxTokensFieldWhenZero(t *testing.T) {
	var gotBody string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
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
	if strings.Contains(gotBody, `"max_tokens"`) {
		t.Errorf("thân request mang khoá max_tokens dù Request.MaxTokens == 0: %s", gotBody)
	}
}

// TestCompleteMapsToolChoiceOntoWireRequest là phần việc Task 6 nợ lại cho
// client.go (task-6-brief.md): tool_choice không nằm trong docs DeepSeek
// công khai, nhu cầu đến từ docs/deepseek-measured.md §2 — chỉ "auto" và
// "none" chạy được trên model Thinking mode này, "required"/ép-một-hàm bị
// từ chối. Request.ToolChoice (types.go) giờ có mặt; test này khoá đúng hai
// điều wireRequest phải làm với nó: gửi đúng giá trị khi caller đặt, và
// LƯỢC hẳn khoá "tool_choice" khi caller không đặt (giá trị zero) — giữ
// nguyên hành vi mọi test khác trong tệp này vẫn đang dựa vào (chúng không
// đặt ToolChoice và không mong đợi khoá đó xuất hiện).
func TestCompleteMapsToolChoiceOntoWireRequest(t *testing.T) {
	for _, tc := range []struct {
		name       string
		toolChoice ToolChoice
		wantKey    string // "" nghĩa là khoá "tool_choice" không được xuất hiện
	}{
		{name: "auto", toolChoice: ToolChoiceAuto, wantKey: `"tool_choice":"auto"`},
		{name: "none", toolChoice: ToolChoiceNone, wantKey: `"tool_choice":"none"`},
		{name: "chưa đặt (giá trị zero)", toolChoice: "", wantKey: ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var gotBody string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				b, _ := io.ReadAll(r.Body)
				gotBody = string(b)
				w.Header().Set("Content-Type", "application/json")
				io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"ok"}}],"usage":{}}`)
			}))
			defer srv.Close()

			_, err := New(srv.URL, "sk-test", srv.Client()).Complete(context.Background(), Request{
				Model:      "m",
				Messages:   []Message{{Role: "user", Content: "chào"}},
				ToolChoice: tc.toolChoice,
			})
			if err != nil {
				t.Fatal(err)
			}
			if tc.wantKey == "" {
				if strings.Contains(gotBody, `"tool_choice"`) {
					t.Errorf("thân request mang khoá tool_choice dù ToolChoice chưa đặt: %s", gotBody)
				}
				return
			}
			if !strings.Contains(gotBody, tc.wantKey) {
				t.Errorf("thân request thiếu %s: %s", tc.wantKey, gotBody)
			}
		})
	}
}

// TestCompleteRejectsStreamingRequests là việc #4 round-1 review:
// Complete trước đây hardcode Stream: false và không bao giờ đọc
// req.Stream — một caller đặt Stream: true nhận một lời gọi KHÔNG stream,
// không lỗi, không cảnh báo. Task 7 (thêm đường streaming) sẽ đi thẳng vào
// bẫy đó nếu nó tưởng Request.Stream: true đã được tôn trọng ở đâu đó.
// Complete giờ từ chối thẳng, trước cả khi gọi mạng — baseURL cố tình trỏ
// tới một host không giải quyết được (.invalid, RFC 2606) để chứng minh
// không có request nào được gửi đi trước khi bị từ chối.
func TestCompleteRejectsStreamingRequests(t *testing.T) {
	// baseURL trỏ tới một host không giải quyết được (.invalid, RFC 2606) —
	// nếu Complete lỡ không chặn sớm và thật sự cố gọi mạng, ta muốn thấy
	// một lỗi DNS/kết nối RÕ RỆT KHÁC với lỗi từ chối Stream, để hai
	// nguyên nhân không lẫn vào nhau trong khẳng định message dưới đây.
	c := New("https://deepseek.invalid", "sk-test", &http.Client{Timeout: time.Second})
	_, err := c.Complete(context.Background(), Request{
		Model: "m", Messages: []Message{{Role: "user"}}, Stream: true,
	})
	if err == nil {
		t.Fatal("muốn lỗi khi Request.Stream = true — Complete không hỗ trợ stream, không được nuốt im lặng")
	}
	if !strings.Contains(err.Error(), "Stream=true") {
		t.Errorf("lỗi = %v, muốn nhắc rõ Stream=true bị từ chối (không phải một lỗi mạng tình cờ tới host .invalid)", err)
	}
}

// TestCompleteTruncatesLongProviderErrorMessage là việc #2 round-1 review:
// error.message của nhà cung cấp là văn bản BÊN THỨ BA tới 8 MiB (giới hạn
// duy nhất trước đây là maxResponseBytes) chảy thẳng vào error.Error() —
// và từ đó vào bất kỳ log nào ghi lại lỗi. Task 4b brief YÊU CẦU mang
// error.message vào lỗi (để Task 6/7/9 phân biệt 401/429/500), nên không
// thể bỏ hẳn như internal/discuss/client.go làm với body của GitHub —
// cách dung hoà là cắt ở maxProviderErrorMessageBytes.
func TestCompleteTruncatesLongProviderErrorMessage(t *testing.T) {
	longMsg := strings.Repeat("x", 5000)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
		io.WriteString(w, `{"error":{"message":"`+longMsg+`"}}`)
	}))
	defer srv.Close()

	_, err := New(srv.URL, "sk-test", srv.Client()).
		Complete(context.Background(), Request{Model: "m", Messages: []Message{{Role: "user"}}})
	if err == nil {
		t.Fatal("muốn lỗi")
	}
	if len(err.Error()) > 400 {
		t.Errorf("lỗi dài %d byte — error.message của nhà cung cấp (5000 ký tự) phải bị cắt, không chảy nguyên vào lỗi/log", len(err.Error()))
	}
	if !strings.Contains(err.Error(), "truncated") {
		t.Errorf("lỗi không có dấu hiệu đã cắt: %v", err)
	}
}

// TestNewNilHCHasNoClientTimeoutButStillBounded — ROUND 3 REVIEW: bất biến
// gốc của test này (round-1 review, Important #3 — tên hàm cũ
// TestNewFallsBackToATimeoutClientWhenHCIsNil) từng khẳng định
// c.http.Timeout > 0. Round 3 tự đo được trên toolchain go 1.25.5 của repo
// này rằng http.Client.Timeout CHƯA BAO GIỜ là lớp chặn thật cho Complete —
// context.WithTimeout(ctx, defaultTimeout) (Complete, dưới đây) đã bọc TOÀN
// BỘ vòng đời một lời gọi (DNS, bắt tay TLS, đọc thân response) mỗi lần
// gọi rồi, hc == nil hay không — và http.Client.Timeout LÀ lớp gây hại
// thật cho CompleteStream (stream.go): nó là một trần TỔNG tính cả việc
// đọc body, tái áp đặt đúng cái wall-clock streamIdleTimeout/
// streamTotalTimeout tồn tại để thay thế. New's fallback đổi thành
// &http.Client{} (không Timeout) — xem doc comment New (client.go).
//
// Bất biến MỚI, thay cho bất biến cũ: "Client dựng qua hc == nil không
// treo vô hạn, vì CẢ Complete LẪN CompleteStream đều tự áp deadline qua
// ctx — không cần http.Client.Timeout làm lớp thứ hai."
func TestNewNilHCHasNoClientTimeoutButStillBounded(t *testing.T) {
	c := New("https://deepseek.invalid", "sk-test", nil)
	if c.http == http.DefaultClient {
		t.Fatal("New(..., nil) dùng http.DefaultClient — nên dùng &http.Client{} riêng để giữ được một giá trị phân biệt được (xem doc comment New)")
	}
	if c.http.Timeout != 0 {
		t.Errorf("c.http.Timeout = %v, muốn 0 — Complete/CompleteStream tự áp deadline qua ctx (context.WithTimeout mỗi lời gọi), "+
			"một http.Client.Timeout ở đây không còn cần và CHỈ có hại cho CompleteStream (một trần TỔNG tái áp đặt sai chỗ, "+
			"vô hiệu hoá streamIdleTimeout/streamTotalTimeout của stream.go)", c.http.Timeout)
	}

	// Bằng chứng HÀNH VI cho bất biến mới: một server chấp nhận kết nối,
	// gửi header 200 OK, rồi TREO THÂN RESPONSE MÃI MÃI (không đóng, không
	// lỗi) — đúng hình dạng "nhà cung cấp đứng hình sau khi đã bắt tay
	// xong", ca mà round-1 review lo ngại. http.Client.Timeout == 0 rồi,
	// nên nếu Complete còn bị chặn đúng hạn, lớp chặn DUY NHẤT còn lại
	// PHẢI là context.WithTimeout(ctx, defaultTimeout) bên trong Complete —
	// canh bằng một ctx caller NGẮN HƠN NHIỀU defaultTimeout (90s) để test
	// không phải chờ đủ 90s thật.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		<-r.Context().Done() // treo thân response mãi mãi — không tự đóng, không tự lỗi
	}))
	defer srv.Close()

	bounded := New(srv.URL, "sk-test", nil)
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	start := time.Now()
	_, err := bounded.Complete(ctx, Request{Model: "m", Messages: []Message{{Role: "user", Content: "hi"}}})
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("Complete trả nil error dù thân response treo mãi mãi — http.Client.Timeout == 0 rồi, context.WithTimeout(ctx, defaultTimeout) của Complete phải chặn đường này")
	}
	if elapsed > 2*time.Second {
		t.Errorf("mất %s để bỏ cuộc, muốn gần 200ms (deadline của ctx caller, sớm hơn defaultTimeout 90s) — không phải treo tới khi ai đó ngắt bằng tay", elapsed)
	}
}

// TestNewTrimsTrailingSlashFromBaseURL là việc-thêm round-1 review:
// config.Load không chuẩn hoá DEEPSEEK_BASE_URL, và chatCompletionsPath đã
// tự mang "/" ở đầu — một baseURL có "/" cuối (một lỗi cấu hình dễ mắc,
// "https://api.deepseek.com/" thay vì không có "/") sẽ ghép thành
// "…com//chat/completions" nếu New không cắt nó.
func TestNewTrimsTrailingSlashFromBaseURL(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"ok"}}],"usage":{}}`)
	}))
	defer srv.Close()

	_, err := New(srv.URL+"/", "sk-test", srv.Client()).
		Complete(context.Background(), Request{Model: "m", Messages: []Message{{Role: "user"}}})
	if err != nil {
		t.Fatal(err)
	}
	if gotPath != "/chat/completions" {
		t.Errorf("path = %q, muốn /chat/completions — baseURL có / cuối phải được chuẩn hoá, không double-slash", gotPath)
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

// ── round 3 review (Task 7): mirror of stream.go's finish_reason "length" ──
// ── + pending tool_call guard ───────────────────────────────────────────────

// TestCompleteLengthFinishWithPendingToolCallReturnsError: the non-streaming
// endpoint can return the SAME malformed shape CompleteStream (stream.go)
// guards against — finish_reason "length" (MaxTokensPerTurn's budget hit
// mid-generation) alongside a tool_calls entry whose Function.Arguments was
// cut off. Before this guard, Complete would hand that straight to Run
// (agent.go), which would pass a truncated JSON string to a ToolRunner.Run
// as if it were whole.
func TestCompleteLengthFinishWithPendingToolCallReturnsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"choices":[{"finish_reason":"length","message":{"role":"assistant","content":"",
		  "tool_calls":[{"id":"call_x","type":"function","function":{"name":"read_course","arguments":"{\"slug\""}}]}}],
		  "usage":{"prompt_tokens":10,"completion_tokens":8192,"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":10}}`)
	}))
	defer srv.Close()

	out, err := New(srv.URL, "sk-test", srv.Client()).Complete(context.Background(), Request{
		Model: "m", Messages: []Message{{Role: "user", Content: "hi"}},
	})
	if err == nil {
		t.Fatal(`Complete trả nil error dù finish_reason == "length" với một tool_call còn dở dang`)
	}
	if !strings.Contains(err.Error(), "length") {
		t.Errorf(`err = %v, muốn nói rõ finish_reason "length"`, err)
	}
	if out.Usage.CompletionTokens != 8192 {
		t.Errorf("Usage.CompletionTokens trên đường lỗi = %d, muốn 8192 (giữ nguyên usage đã đọc)", out.Usage.CompletionTokens)
	}
}

// TestCompleteLengthFinishWithoutToolCallSucceeds: finish_reason "length"
// KHÔNG kèm tool_call (một câu trả lời chữ bị cắt vì hết ngân sách token)
// KHÔNG phải lỗi — MaxTokensPerTurn làm đúng việc nó được đặc tả làm, một
// câu trả lời ngắn hơn dự kiến nhưng hợp lệ về cấu trúc.
func TestCompleteLengthFinishWithoutToolCallSucceeds(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"choices":[{"finish_reason":"length","message":{"role":"assistant","content":"câu trả lời cụt"}}],
		  "usage":{"prompt_tokens":10,"completion_tokens":8192,"prompt_cache_hit_tokens":0,"prompt_cache_miss_tokens":10}}`)
	}))
	defer srv.Close()

	out, err := New(srv.URL, "sk-test", srv.Client()).Complete(context.Background(), Request{
		Model: "m", Messages: []Message{{Role: "user", Content: "hi"}},
	})
	if err != nil {
		t.Fatalf(`Complete: %v — finish_reason "length" KHÔNG kèm tool_call không được là lỗi`, err)
	}
	if out.Message.Content != "câu trả lời cụt" {
		t.Errorf("Message.Content = %q", out.Message.Content)
	}
}

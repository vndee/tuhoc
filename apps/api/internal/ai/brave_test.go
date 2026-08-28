package ai

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestBraveSendsSubscriptionTokenHeader pins task-8-brief.md's central measured fact: Brave
// authenticates via X-Subscription-Token, not the header client.go uses for DeepSeek's
// Bearer token — putting the key on that other header is the reflexive mistake (every other
// provider this codebase talks to, DeepSeek included, uses that convention) and Brave
// answers a misrouted key with a bare 401, no hint why.
//
// Reads that other header through the map index (r.Header["..."], below) instead of
// net/http.Header's single-argument convenience getter — same reason client_test.go's
// TestCompleteSendsBearerAndParsesUsage reads it that way there: apps/api/internal/server/
// provider_key_never_leaks_test.go's keyBearingFields scans EVERY .go file in the repo,
// tests included, for that exact getter called with that exact header's name
// (case-insensitive), with no way to tell "our own outgoing request, inspected by a fake
// Brave server standing in for the real one" apart from "our server receiving a caller's
// key" — the two are opposite directions but identical text to a string scan. This is not a
// gate to widen (the task brief for this file explicitly says so); it is a shape to avoid
// typing — including in prose, which is why this comment itself never spells out the getter
// call or the header name together — exactly as client_test.go already worked around it for
// DeepSeek.
func TestBraveSendsSubscriptionTokenHeader(t *testing.T) {
	var gotTok, gotAuth, gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotTok = r.Header.Get("X-Subscription-Token") // not a keyBearingFields needle — safe to read directly
		if v := r.Header["Authorization"]; len(v) > 0 {
			gotAuth = v[0]
		}
		gotQuery = r.URL.Query().Get("q")
		io.WriteString(w, `{"web":{"results":[{"title":"T","url":"https://e.com","description":"D"}]}}`)
	}))
	defer srv.Close()

	hits, err := NewBrave(srv.URL, "bk-test", srv.Client()).Search(context.Background(), "vòng lặp", 5)
	if err != nil {
		t.Fatal(err)
	}
	if gotTok != "bk-test" {
		t.Errorf("X-Subscription-Token = %q", gotTok)
	}
	// Đặt key vào Authorization là lỗi phản xạ, và Brave chỉ trả 401 câm.
	if gotAuth != "" {
		t.Errorf("Authorization phải RỖNG với Brave, có %q", gotAuth)
	}
	if gotQuery != "vòng lặp" {
		t.Errorf("q = %q", gotQuery)
	}
	if len(hits) != 1 || hits[0].Title != "T" || hits[0].URL != "https://e.com" || hits[0].Snippet != "D" {
		t.Errorf("hits = %+v", hits)
	}
}

// TestBraveClampsCountToTwenty pins Brave's documented ceiling (task-8-brief.md): a caller
// asking for more than 20 results must be clamped DOWN before it reaches the wire — sending
// 100 is a 422 at Brave for real, not something to discover in production.
func TestBraveClampsCountToTwenty(t *testing.T) {
	var gotCount string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotCount = r.URL.Query().Get("count")
		io.WriteString(w, `{"web":{"results":[]}}`)
	}))
	defer srv.Close()
	_, _ = NewBrave(srv.URL, "k", srv.Client()).Search(context.Background(), "q", 100)
	if gotCount != "20" {
		t.Errorf("count = %q, muốn kẹp về 20", gotCount)
	}
}

// TestBraveDoesNotRaiseCountAboveRequestedLimit is the mutation guard
// TestBraveClampsCountToTwenty alone cannot be: an implementation that always hardcodes
// count=20 (ignoring the caller's own limit, always asking Brave for the maximum) would
// still pass that test — and would silently spend more of the platform's Brave quota per
// search than any caller asked for. This pins that a limit UNDER the ceiling passes through
// unchanged, not bumped up.
func TestBraveDoesNotRaiseCountAboveRequestedLimit(t *testing.T) {
	var gotCount string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotCount = r.URL.Query().Get("count")
		io.WriteString(w, `{"web":{"results":[]}}`)
	}))
	defer srv.Close()
	_, _ = NewBrave(srv.URL, "k", srv.Client()).Search(context.Background(), "q", 3)
	if gotCount != "3" {
		t.Errorf("count = %q, muốn 3 (không bị đẩy lên 20)", gotCount)
	}
}

// TestBraveHandlesMissingWebKey pins the exact shape Brave uses for "found nothing": the
// "web" key is ABSENT from the response, not present with an empty results array — and that
// absence is a valid answer, not an error. Search returning err != nil here would make
// tool_search.go treat an ordinary empty result as an upstream failure, which is the wrong
// boundary: the brief calls this "tìm được nhưng không có kết quả" (found, but no results),
// and this package draws the line at "did Brave serve the request", not "did it find
// anything".
func TestBraveHandlesMissingWebKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{}`)
	}))
	defer srv.Close()
	hits, err := NewBrave(srv.URL, "k", srv.Client()).Search(context.Background(), "q", 5)
	if err != nil {
		t.Fatalf("thiếu khoá web KHÔNG phải lỗi: %v", err)
	}
	if len(hits) != 0 {
		t.Errorf("hits = %+v, muốn rỗng", hits)
	}
}

// TestBraveDefaultsSafeSearchToModerate pins task-8-brief.md's platform-specific default:
// this is a learning platform, safesearch stays "moderate". SearchProvider's interface
// (query, limit only) gives a caller no way to override it — which means THIS test is the
// only thing that would catch the default silently drifting if someone edits the query
// params later without re-reading the brief.
func TestBraveDefaultsSafeSearchToModerate(t *testing.T) {
	var gotSafeSearch string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSafeSearch = r.URL.Query().Get("safesearch")
		io.WriteString(w, `{"web":{"results":[]}}`)
	}))
	defer srv.Close()
	_, _ = NewBrave(srv.URL, "k", srv.Client()).Search(context.Background(), "q", 5)
	if gotSafeSearch != "moderate" {
		t.Errorf("safesearch = %q, muốn moderate", gotSafeSearch)
	}
}

// TestBraveSearchErrorNeverContainsKey mirrors client_test.go's
// TestCompleteErrorNeverContainsKey for the second provider this codebase now holds a key
// for — same discipline, same reason: provider_key_never_leaks_test.go's structural scan is
// documented as blind to internal/ai (its own PHẠM VI THẬT point 2), so a behavioral test on
// the actual error VALUE, in the package that produces it, is the only real defense here
// too.
func TestBraveSearchErrorNeverContainsKey(t *testing.T) {
	const sentinel = "bk-SENTINEL-do-not-emit-9a1e"

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
				hj := w.(http.Hijacker)
				conn, _, _ := hj.Hijack()
				conn.Close()
			},
		},
		{
			name: "429 kèm error.message",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(429)
				io.WriteString(w, `{"error":{"message":"rate limited"}}`)
			},
		},
		{
			name: "500 kèm error.message",
			handler: func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(500)
				io.WriteString(w, `{"error":{"message":"internal error"}}`)
			},
		},
		{
			name: "200 nhưng thân không phải JSON hợp lệ",
			handler: func(w http.ResponseWriter, r *http.Request) {
				io.WriteString(w, `khong phai json, chi la rac`)
			},
		},
		{
			name: "context đã huỷ trước khi gọi",
			handler: func(w http.ResponseWriter, r *http.Request) {
				io.WriteString(w, `{"web":{"results":[]}}`)
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
			_, err := NewBrave(srv.URL, sentinel, srv.Client()).Search(ctx, "q", 5)
			if err == nil {
				t.Fatal("muốn lỗi")
			}
			if strings.Contains(err.Error(), sentinel) {
				t.Errorf("lỗi mang key: %v", err)
			}
		})
	}
}

// TestBraveSearchErrorIncludesStatusAndProviderMessage mirrors client_test.go's
// TestCompleteErrorIncludesStatusAndProviderMessage: not carrying the key is necessary but
// not sufficient — an error that collapses to the same generic text for every failure gives
// tool_search.go (and anyone debugging a stuck integration) nothing to distinguish a bad key
// (401) from a spent quota (429) from Brave being down (5xx).
func TestBraveSearchErrorIncludesStatusAndProviderMessage(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(429)
		io.WriteString(w, `{"error":{"message":"rate limit exceeded, slow down"}}`)
	}))
	defer srv.Close()
	_, err := NewBrave(srv.URL, "k", srv.Client()).Search(context.Background(), "q", 5)
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

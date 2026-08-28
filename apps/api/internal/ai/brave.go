// brave.go implements SearchProvider (tool_search.go) against Brave Search's Web Search
// API — the provider chốt 28/08/2026 (task-8-brief.md). Every value here — endpoint,
// header name, `count`'s ceiling, `safesearch`'s default, the `web.results[]` shape — was
// measured against Brave's own docs the same day and is used AS GIVEN, not re-derived.
//
// This file is deliberately the ONLY thing in the ai package that knows Brave's wire
// format. tool_search.go, and everything upstream of it (agent.go's tool-call loop),
// depends only on the SearchProvider interface below — swapping search providers later is
// "write a second file implementing SearchProvider", not "touch the tool or the agent
// loop".
package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
)

// DefaultBraveSearchEndpoint is Brave's real Web Search endpoint (task-8-brief.md's
// measured table). It is a plain exported constant, not baked into NewBrave, so a caller
// wiring the real client (a future task — config.Config.BraveAPIKey already exists, but no
// handler constructs a *Brave from it yet) passes it explicitly, the same way client.go's
// New(baseURL, apiKey, hc) takes baseURL as a parameter rather than assuming DeepSeek's URL
// internally. Tests pass an httptest.Server URL here instead.
const DefaultBraveSearchEndpoint = "https://api.search.brave.com/res/v1/web/search"

// braveMaxCount is Brave's documented ceiling on `count` (results requested PER CALL, not
// to be confused with tool_search.go's maxPerTurn, which counts CALLS — task-8-brief.md is
// explicit that these are two different numbers and both are money). Search always clamps
// DOWN to this; it never raises a caller's own lower limit up to it (see
// TestBraveDoesNotRaiseCountAboveRequestedLimit, brave_test.go) — asking Brave for more
// results than needed has no benefit and, since a search's price does not depend on how
// many results came back, no reason to pad up to the ceiling by default either.
const braveMaxCount = 20

// braveDefaultSafeSearch is fixed at "moderate" — task-8-brief.md's platform-specific call:
// this is a learning platform. SearchProvider's interface (Search(ctx, query, limit)) gives
// no caller a way to override it, on purpose: nothing today has a legitimate reason to ask
// for anything looser.
const braveDefaultSafeSearch = "moderate"

// maxBraveResponseBytes bounds how much of Brave's reply this process reads into memory in
// one call — same discipline as client.go's maxResponseBytes for DeepSeek, sized down: a
// JSON array of up to braveMaxCount results (title/url/description strings) is small, this
// is a defensive ceiling against an oversized or malicious response body, not a realistic
// budget for a normal reply.
const maxBraveResponseBytes int64 = 1 << 20

// SearchProvider is the narrowest surface tool_search.go needs from a web-search backend.
// Interface first, implementation second (task-8-brief.md): the provider had not been
// chosen when tool_search.go's shape was planned, and "how much does switching providers
// cost" needs to answer "replace one file" — so this stays exactly two methods' worth of
// surface, nothing Brave-specific (no safesearch knob, no country/search_lang, no raw
// result count) leaks through it.
type SearchProvider interface {
	Search(ctx context.Context, query string, limit int) ([]SearchHit, error)
}

// SearchHit is one search result, reduced to the three fields any caller of SearchProvider
// could plausibly want regardless of provider: a title, a URL, and a short snippet of
// surrounding text.
type SearchHit struct {
	Title, URL, Snippet string
}

// Brave implements SearchProvider against Brave Search's Web Search API over plain
// net/http — same choice client.go made for DeepSeek (no SDK dependency; this module's
// go.mod stays at its current direct-dependency count).
type Brave struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

// NewBrave builds a Brave client. hc is the caller's choice, same contract as client.go's
// New: a nil hc falls back to &http.Client{} with no Timeout of its own — Search below
// bounds every call with its own context.WithTimeout(ctx, defaultTimeout) instead (reusing
// client.go's defaultTimeout, not a second constant), the same "one knob, one job" reasoning
// New's doc comment lays out for DeepSeek. baseURL is normally DefaultBraveSearchEndpoint in
// production and an httptest.Server URL in tests.
func NewBrave(baseURL, apiKey string, hc *http.Client) *Brave {
	if hc == nil {
		hc = &http.Client{}
	}
	return &Brave{baseURL: baseURL, apiKey: apiKey, http: hc}
}

// braveWireResponse is the JSON shape of a successful Brave Web Search reply, reduced to
// what this file reads.
//
// Web is a POINTER, not a plain struct — this is the load-bearing part of the type
// (TestBraveHandlesMissingWebKey, brave_test.go): Brave OMITS the "web" key entirely from a
// response with no web results, rather than sending "web":{"results":[]}. A plain (non-
// pointer) struct field would decode a missing key to its zero value, which is
// indistinguishable from an explicit empty array — this pointer keeps "key absent" (Web ==
// nil) and "key present with zero results" (Web != nil, len(Web.Results) == 0)
// distinguishable at decode time, even though Search below deliberately treats both the same
// way afterwards (see Search's doc comment: both are a valid zero-hit answer, not a
// provider error).
type braveWireResponse struct {
	Web *struct {
		Results []struct {
			Title       string `json:"title"`
			URL         string `json:"url"`
			Description string `json:"description"`
		} `json:"results"`
	} `json:"web"`
}

// braveWireErrorBody is the shape Brave uses for a non-2xx reply's error message — same
// {"error":{"message":"..."}} shape client.go's wireErrorBody already assumes for DeepSeek;
// Brave's own docs measured 2026-08-28 confirm the same field name.
type braveWireErrorBody struct {
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

// Search sends one Brave Web Search request and decodes the reply.
//
// Error handling is written around the exact same constraint client.go's Complete states
// for DeepSeek: an HTTP error must never carry the API key out with it. b.apiKey is used
// ONLY to set the X-Subscription-Token header below — it never appears in any string this
// function builds, formats, or wraps, and Brave's own error.message text (third-party,
// unbounded) is truncated the same way client.go's DeepSeek errors are
// (truncateProviderMessage, defined in client.go and shared by this whole package) before it
// reaches a returned error. See TestBraveSearchErrorNeverContainsKey (brave_test.go) for the
// behavioral proof — provider_key_never_leaks_test.go's structural scan is documented as
// blind to this package (its own PHẠM VI THẬT point 2), so that behavioral test carries the
// real weight here, same as client_test.go's TestCompleteErrorNeverContainsKey does for
// DeepSeek.
//
// The upstream-failure-vs-found-nothing boundary this whole package draws (tool_search.go's
// file-level doc comment) is decided HERE, not in the caller: any non-2xx status, any
// network/DNS/timeout failure reaching c.http.Do, or an undecodable body all return a
// non-nil error — Brave did NOT successfully serve the request. A 200 with the "web" key
// absent, or present with zero results, returns (empty slice, nil) — Brave DID serve the
// request and its answer happens to be "nothing found", which is not a failure (see
// TestBraveHandlesMissingWebKey).
func (b *Brave) Search(ctx context.Context, query string, limit int) ([]SearchHit, error) {
	ctx, cancel := context.WithTimeout(ctx, defaultTimeout)
	defer cancel()

	count := limit
	if count > braveMaxCount {
		count = braveMaxCount
	}
	if count < 1 {
		count = 1
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, b.baseURL, nil)
	if err != nil {
		return nil, fmt.Errorf("brave: build request: %w", err)
	}
	q := req.URL.Query()
	q.Set("q", query)
	q.Set("count", strconv.Itoa(count))
	q.Set("safesearch", braveDefaultSafeSearch)
	req.URL.RawQuery = q.Encode()
	req.Header.Set("X-Subscription-Token", b.apiKey)
	req.Header.Set("Accept", "application/json")

	resp, err := b.http.Do(req)
	if err != nil {
		// c.http.Do's own error (network/DNS/timeout failures) is safe to wrap with %w
		// for the same reason client.go's Complete documents: *url.Error's Error()
		// method reports the URL and the underlying error, not headers — req's
		// X-Subscription-Token never surfaces through it.
		return nil, fmt.Errorf("brave: request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxBraveResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("brave: read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		var eb braveWireErrorBody
		_ = json.Unmarshal(raw, &eb) // best-effort: a malformed error body still gets a status code
		if eb.Error.Message != "" {
			return nil, fmt.Errorf("brave: search returned HTTP %d: %s", resp.StatusCode, truncateProviderMessage(eb.Error.Message))
		}
		return nil, fmt.Errorf("brave: search returned HTTP %d", resp.StatusCode)
	}

	var wire braveWireResponse
	if err := json.Unmarshal(raw, &wire); err != nil {
		return nil, fmt.Errorf("brave: decode response: %w", err)
	}
	if wire.Web == nil {
		return []SearchHit{}, nil
	}

	hits := make([]SearchHit, 0, len(wire.Web.Results))
	for _, res := range wire.Web.Results {
		hits = append(hits, SearchHit{Title: res.Title, URL: res.URL, Snippet: res.Description})
	}
	return hits, nil
}

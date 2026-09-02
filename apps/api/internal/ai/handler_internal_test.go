// handler_internal_test.go is `package ai`, unlike its sibling
// handler_test.go, which is `package ai_test`.
//
// The split is not decoration and the earlier report got the reason wrong.
// handler_test.go MUST be external, because it drives internal/server and
// internal/auth, and internal/auth imports internal/ai — an internal test
// would be an import cycle. That constraint belongs to THAT FILE, not to the
// package: nine other test files in this directory (agent_test.go,
// stream_test.go, tool_search_test.go, ...) are plain `package ai` and always
// were. Anything that needs to see an unexported identifier belongs here,
// where seeing it costs nothing and needs no Postgres.
//
// Two kinds of assertion live here for exactly that reason:
//
//  1. The two-strings-must-agree check between agent.go's unexported
//     webSearchToolName and this package's exported ToolNameWebSearch. The
//     first review round asserted that only INDIRECTLY, through a
//     database-backed test that watched the web-search surcharge appear in
//     ai_usage. That test is worth keeping — it proves the money moves — but
//     as the sole guard for a string equality it was a long rope for a short
//     job: a container, a migration, two provider rounds and a price table,
//     to compare two constants that sit 300 lines apart in the same package.
//  2. The SSE wire format, which is a contract with a parser nobody in this
//     repo wrote (the browser's EventSource). handler_test.go reads the
//     response body after fasthttp has already assembled it, so it is
//     structurally blind to whether writeSSE flushed — and a buffered SSE
//     stream is a broken SSE stream. Only a direct call with a writer under
//     the test's own control can see it.
package ai

import (
	"bufio"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// TestWebSearchToolNameMatchesTheAgentLoopsCounter is the direct form of the
// assertion that debt 8's second half is really about.
//
// agent.go counts a successful call to the tool it knows as webSearchToolName
// into Result.WebSearches, and ChargeTurn multiplies THAT counter by
// ai_settings.credits_per_web_search. handler.go registers the search runner
// under the name it knows as ToolNameWebSearch. If the two strings ever drift
// apart the tool still runs, the learner still gets their answer, and the
// surcharge silently stops being billed — no error, no log, no failing
// request. The platform simply pays Brave and forgets to charge for it.
func TestWebSearchToolNameMatchesTheAgentLoopsCounter(t *testing.T) {
	if webSearchToolName != ToolNameWebSearch {
		t.Fatalf("agent.go counts web searches for the tool named %q, but handler.go "+
			"registers it as %q. Nothing fails when these disagree: the tool runs, the "+
			"answer arrives, and Result.WebSearches stays 0 forever, so every web search "+
			"is served free of charge.", webSearchToolName, ToolNameWebSearch)
	}
}

// TestToolNameConstantsMatchTheRunnersDefinitions closes the same gap for the
// other direction and the other tool: the constants this package validates
// PUT /ai/config against must be the names the runners actually answer to.
func TestToolNameConstantsMatchTheRunnersDefinitions(t *testing.T) {
	cases := []struct {
		want   string
		runner ToolRunner
	}{
		{ToolNameReadCourse, NewCourseTool(nil)},
		{ToolNameWebSearch, NewSearchTool(nil, 1)},
		{ToolNameReadMyNotes, NewNotesTool(nil, uuid.Nil)},
	}
	for _, tc := range cases {
		if got := tc.runner.Definition().Function.Name; got != tc.want {
			t.Fatalf("constant says %q, the runner calls itself %q — PUT /ai/config would "+
				"accept a name no tool answers to", tc.want, got)
		}
	}
}

// captureWriter records everything that actually reaches the underlying
// stream, so a test can tell "written into bufio" apart from "flushed onto
// the wire".
type captureWriter struct {
	got strings.Builder
}

func (c *captureWriter) Write(p []byte) (int, error) {
	return c.got.Write(p)
}

// brokenWriter is a connection the learner has already closed.
type brokenWriter struct{}

var errBrokenSink = errors.New("connection reset by peer")

func (brokenWriter) Write([]byte) (int, error) { return 0, errBrokenSink }

// TestWriteSSEFramesAndFlushesEveryEvent pins the byte-level wire format AND
// the flush, in one assertion each.
//
// Both halves were invisible to the first round's tests: handler_test.go
// parsed the response body after fasthttp had assembled and flushed it on its
// own, so a writeSSE that never flushed, and a writeSSE that ended events
// with one newline instead of two, both produced a body that its line scanner
// happily accepted. A browser accepts neither.
func TestWriteSSEFramesAndFlushesEveryEvent(t *testing.T) {
	sink := &captureWriter{}
	// A default-sized bufio.Writer (4 KiB) holds these few dozen bytes
	// indefinitely, so anything reaching sink got there by an explicit Flush.
	w := bufio.NewWriter(sink)

	if err := writeSSE(w, EventKindDelta, sseEnvelope{Text: "hello"}); err != nil {
		t.Fatalf("writeSSE: %v", err)
	}

	const want = "event: delta\ndata: {\"text\":\"hello\"}\n\n"
	if got := sink.got.String(); got != want {
		t.Fatalf("SSE frame on the wire is wrong.\n got: %q\nwant: %q\n\n"+
			"Both failure modes here are silent in a browser: an unflushed event never "+
			"arrives at all, and an event ending in one newline instead of two is never "+
			"DISPATCHED — EventSource keeps accumulating fields and fires nothing.",
			got, want)
	}

	// A second event must be a second complete frame, not a continuation.
	sink.got.Reset()
	if err := writeSSE(w, EventKindError, sseEnvelope{Text: toolBudgetDetail, Code: CodeToolBudgetExhausted}); err != nil {
		t.Fatalf("writeSSE: %v", err)
	}
	got := sink.got.String()
	if !strings.HasSuffix(got, "\n\n") {
		t.Fatalf("every frame must end with a blank line, got %q", got)
	}
	if !strings.HasPrefix(got, "event: error\ndata: ") {
		t.Fatalf("frame does not start with its own event line: %q", got)
	}
	if !strings.Contains(got, `"code":"`+CodeToolBudgetExhausted+`"`) {
		t.Fatalf("an error frame must name which failure it was: %q", got)
	}
}

// TestWriteSSEKeepsOneEventOnOneLine is the newline case the first round
// never exercised: a real "\n" inside model output.
//
// It is why the payload is JSON at all. An SSE data field cannot span lines,
// so a raw newline would split one event into two malformed ones — and model
// answers are full of newlines, so this is the ordinary path, not an edge.
func TestWriteSSEKeepsOneEventOnOneLine(t *testing.T) {
	sink := &captureWriter{}
	w := bufio.NewWriter(sink)

	if err := writeSSE(w, EventKindDelta, sseEnvelope{Text: "first line\nsecond line\n\nthird"}); err != nil {
		t.Fatalf("writeSSE: %v", err)
	}

	got := sink.got.String()
	frame := strings.TrimSuffix(got, "\n\n")
	if strings.Count(frame, "\n") != 1 {
		t.Fatalf("an event whose text contains real newlines must still be exactly two "+
			"lines (event + data); got %d newlines inside the frame: %q",
			strings.Count(frame, "\n")+1, got)
	}
	if strings.Contains(frame, "line\nsecond") {
		t.Fatalf("a raw newline reached the wire un-escaped, splitting one event into "+
			"malformed fragments: %q", got)
	}
}

// TestWriteSSEReportsABrokenSink is the disconnect-detection half.
//
// streamTurn's context is deliberately NOT derived from the request (fasthttp
// has recycled it by the time the body stream writer runs), and its doc
// comment justifies that by saying a failed write is what stops the turn
// instead. That justification is only true if writeSSE actually flushes:
// bufio swallows a small write without touching the underlying writer, so
// without the flush this returns nil for a connection that is already gone,
// and the turn runs to completion against nobody.
func TestWriteSSEReportsABrokenSink(t *testing.T) {
	w := bufio.NewWriter(brokenWriter{})

	err := writeSSE(w, EventKindDelta, sseEnvelope{Text: "anyone there?"})
	if err == nil {
		t.Fatal("writeSSE returned nil for a connection that refuses every write. " +
			"This is the ONLY way the turn learns the learner hung up — streamTurn's " +
			"context is not the request's, so nothing else cancels it. Without a flush, " +
			"bufio absorbs the write and this failure is invisible.")
	}
	if !errors.Is(err, errBrokenSink) {
		t.Fatalf("want the sink's own error to surface, got %v", err)
	}
}

// TestErrorEnvelopeNeverCarriesTheRawError pins the redaction, and pins that
// the two failure kinds stay distinguishable.
func TestErrorEnvelopeNeverCarriesTheRawError(t *testing.T) {
	// The shape RunStream really produces: several layers of wrapping around
	// a transport error, naming the provider and the endpoint.
	raw := fmt.Errorf("ai: agent stream round 2: %w",
		fmt.Errorf("ai: call DeepSeek stream: Post %q: dial tcp 1.2.3.4:443: connect: refused",
			"https://api.deepseek.com/chat/completions"))

	env := errorEnvelope(raw)
	if env.Code != CodeProviderFailed {
		t.Fatalf("want %q got %q", CodeProviderFailed, env.Code)
	}
	if env.Text != providerFailureDetail {
		t.Fatalf("the error event must carry a fixed sentence, got %q", env.Text)
	}
	for _, leaked := range []string{"deepseek", "dial tcp", "1.2.3.4", "chat/completions", "round 2"} {
		if strings.Contains(strings.ToLower(env.Text), leaked) {
			t.Fatalf("internal detail %q reached the learner's browser: %q", leaked, env.Text)
		}
	}

	// A turn that ran out of tool rounds is a different condition, and a
	// client that showed "the provider broke, try again" for it would be
	// inviting the learner to spend credit on the same dead end.
	budget := fmt.Errorf("ai: agent stream round 6: %w", ErrToolBudgetExhausted)
	got := errorEnvelope(budget)
	if got.Code != CodeToolBudgetExhausted {
		t.Fatalf("an exhausted tool budget is not a provider failure: want %q got %q",
			CodeToolBudgetExhausted, got.Code)
	}
	if got.Text != toolBudgetDetail {
		t.Fatalf("want the fixed tool-budget sentence, got %q", got.Text)
	}
}

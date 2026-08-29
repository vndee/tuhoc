#!/usr/bin/env python3
"""
fake_deepseek.py — Task 18's stand-in for DeepSeek's chat-completions API,
run as the `deepseek-fake` service in apps/api/compose.e2e.yml.

WHY THIS EXISTS: apps/api/internal/ai/client.go's CompleteStream (the only
path POST /ai/chat ever takes — see handler.go's "debt 5") sends every real
turn to DEEPSEEK_BASE_URL + "/chat/completions". Pointing that at the real
DeepSeek API from an e2e suite would spend real money on every run and make
the suite's pass/fail depend on a third party's uptime and a live API key
(task-18-brief.md: "một bộ e2e tiêu tiền thật mỗi lần chạy là một bộ e2e sẽ
bị tắt"). This script answers on the exact wire shape stream.go's
CompleteStream parses (docs/deepseek-measured.md §4), with a FIXED reply and
FIXED usage, regardless of what was asked — so apps/api/internal/ai's own
cost math (cost.go's Charge, credits.go's ChargeTurn) is the thing under
test here, not DeepSeek's.

WHAT THIS DOES NOT TEST: whether apps/api talks to the REAL DeepSeek
correctly. client_test.go / stream_test.go already cover that against
recorded wire shapes, and docs/deepseek-measured.md is the one place actual
measurements against the live API are recorded — deliberately not in a
suite that runs on every push. This script's only job is to be a stable,
free, wire-compatible double so apps/web/e2e/s2.spec.ts can prove the
CREDIT machinery — balance display, deduction, blocking, config persistence
— actually moves real numbers through a real HTTP round trip to a real
(fake) provider, end to end.

FIXED USAGE — chosen so the exact credit math has a short derivation, not
because it resembles a real turn: cache_hit=40, cache_miss=1200,
completion=350 tokens (see USAGE below). Against ai_pricing's seeded
deepseek-v4-pro row (apps/api/migrations/0007_ai_credits.up.sql:
credits_per_1k_in=1320, credits_per_1k_cached_in=44, credits_per_1k_out=3960
micro-credits per 1k tokens) and cost.go's divUp (ceiling division), ONE
turn against this server costs EXACTLY:

    divUp(40,   44) = ceil(   40 *   44 / 1000) =    2
    divUp(1200, 1320) = ceil(1200 * 1320 / 1000) = 1584
    divUp(350,  3960) = ceil( 350 * 3960 / 1000) = 1386
    total                                        = 2972 micro-credits

apps/web/e2e/s2.spec.ts's SEED_MICRO and scripts/test-e2e.sh's
TUHOC_E2E_AI_SIGNUP_GRANT_MICRO default both hardcode this same 2972, so a
freshly-registered e2e learner starts with EXACTLY one fake turn's worth of
credit — the same fixture proves scenario 2 (balance drops by precisely
usage × price) AND sets up scenario 3 (balance 0 blocks the next turn) with
no second seed step. KEEP ALL THREE NUMBERS IN SYNC BY HAND if any of the
three inputs above ever changes — there is no fourth place that could read
a shared value from without a build step none of the three otherwise needs
(same tension apps/web/playwright.config.ts already documents for
CORS_ORIGIN).

STREAMING SHAPE, matched against stream.go's CompleteStream byte for byte:
  - Content-Type does not matter to the Go client (CompleteStream never
    reads it — only resp.StatusCode) but is set to text/event-stream anyway.
  - Every line is "data: <json>\\n\\n" — no "event:" field. DeepSeek's own
    stream never sends one; only apps/api's OWN downstream SSE to the
    BROWSER does (handler.go's writeSSE) — a different wire, one hop later.
  - The answer streams across a few `delta.content` fragments with a short
    real delay between them, so a client that buffers everything and paints
    once is distinguishable from one that streams — the same property the
    now-deleted `serveProvider` helper had (git show
    390931e:apps/web/e2e/s2.spec.ts; see docs/testing.md's "Reading
    s2.spec.ts back" for the full accounting of what did and did not carry
    forward from that file).
  - "usage" rides on the FINAL chunk only, alongside finish_reason: "stop"
    — the exact shape docs/deepseek-measured.md §4 measured on the real
    API. Earlier chunks carry no "usage" key at all (Go's `*Usage` decodes
    that as nil, matching a real DeepSeek stream).
  - The stream ends with the literal line "data: [DONE]", then the
    connection closes — CompleteStream's sawDone guard (stream.go) treats
    anything else (a clean EOF with no "[DONE]") as a truncated response.

NO TOOL CALLS, ever, on purpose: this response's message never carries
tool_calls, so every turn against this server finishes in exactly ONE round
(stream.go's RunStream: "isLastRound || len(completion.Message.ToolCalls)
== 0") no matter how many rounds ai_settings.max_tool_rounds_per_turn
allows. That is what makes the cost derivation above exact rather than
"usually right" — a turn that ran a tool round would add ToolCalls/
WebSearches this comment does not account for, and Go-side tool-loop
coverage (agent_test.go, stream_test.go, tool_course_test.go) already
exists and does not need re-proving through a real HTTP round trip.

NON-STREAMING PATH ALSO SERVED (a request body with "stream": false), even
though nothing in apps/api's current code ever takes that path for
POST /ai/chat (handler.go's own doc comment, debt 5: "Only the streaming
path is used"). Cheap to support, and it keeps this double honest about the
one thing that could silently stop being true without anyone updating this
file.
"""

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8090

MODEL = "deepseek-v4-pro"

# Vietnamese, typed as \uXXXX escapes rather than raw UTF-8 source bytes —
# keeps this file readable in a plain-ASCII editor/terminal and sidesteps
# any doubt about the container's locale correctly reading this source
# file. The bytes actually sent over the wire are UTF-8 either way (Python's
# json.dumps with ensure_ascii=True below re-escapes them the same way on
# output; \uXXXX and raw UTF-8 decode to the identical Python str).
ANSWER_TEXT = (
    "Đây là câu trả lời cố định "
    "từ DeepSeek giả, dùng cho bộ kiểm e2e của "
    "Task 18. Không có lời gọi mạng thật nào "
    "tới DeepSeek trong lần chạy này."
)


def _delta_chunks(text: str, words_per_chunk: int):
    """Split `text` into a handful of fragments that concatenate back to it
    EXACTLY — s2.spec.ts asserts the full answer text, so a split that lost
    or duplicated a character would fail loudly there, not silently here."""
    words = text.split(" ")
    for i in range(0, len(words), words_per_chunk):
        group = words[i:i + words_per_chunk]
        suffix = " " if i + words_per_chunk < len(words) else ""
        yield " ".join(group) + suffix


DELTA_CHUNKS = list(_delta_chunks(ANSWER_TEXT, 6))

# See this file's header comment for the derivation of 2972 micro-credits
# from these three numbers against ai_pricing's seeded deepseek-v4-pro row.
USAGE = {
    "prompt_tokens": 1240,
    "completion_tokens": 350,
    "prompt_cache_hit_tokens": 40,
    "prompt_cache_miss_tokens": 1200,
}


def _sse_line(obj) -> bytes:
    return ("data: " + json.dumps(obj, ensure_ascii=True) + "\n\n").encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    # Deliberately left at the class default ("HTTP/1.0"), not bumped to
    # "HTTP/1.1": with the default, BaseHTTPRequestHandler always closes the
    # connection after one response (cpython's http.server only keeps a
    # connection alive on "Connection: keep-alive" when protocol_version is
    # AT LEAST "HTTP/1.1"), so the Go client always sees a clean EOF right
    # after this handler is done writing — one fewer thing to get right for
    # a server this small, at the cost of a fresh TCP handshake per turn,
    # which is free on a local compose network for the two or three turns
    # any one e2e run makes.

    def log_message(self, fmt, *args):  # noqa: A002 - stdlib override signature
        # Quiet by default. scripts/test-e2e.sh already prints the API
        # service's own logs at the end of a run; a log line per request
        # here would only ever restate what apps/api's "ai turn"/"ai charge"
        # slog lines already say, from the other side of the call.
        pass

    def do_GET(self):
        if self.path == "/health":
            body = b"ok"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        if self.path != "/chat/completions":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            req = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            req = {}
        # The request's own content — model, messages, tools, question,
        # course slug — is deliberately IGNORED past this one flag. This
        # server answers the SAME fixed reply to any question, about any
        # chapter, with any tool list. See this file's header comment for
        # why a fixed reply is the point, not a shortcut.
        streaming = bool(req.get("stream"))

        if not streaming:
            body = json.dumps(
                {
                    "choices": [
                        {
                            "message": {"role": "assistant", "content": ANSWER_TEXT},
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": USAGE,
                },
                ensure_ascii=True,
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        for fragment in DELTA_CHUNKS:
            self.wfile.write(
                _sse_line({"choices": [{"delta": {"content": fragment}, "finish_reason": None}]})
            )
            self.wfile.flush()
            # A real inter-chunk delay — the property that tells "streamed"
            # apart from "painted once at the end". Short enough that the
            # whole suite stays fast (a handful of fragments per turn, well
            # under a second total).
            time.sleep(0.05)

        self.wfile.write(
            _sse_line(
                {
                    "choices": [{"delta": {}, "finish_reason": "stop"}],
                    "usage": USAGE,
                }
            )
        )
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()

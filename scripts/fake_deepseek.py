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
CREDIT machinery — balance display, deduction (including going NEGATIVE,
spec §3.4), blocking, config persistence — actually moves real numbers
through a real HTTP round trip to a real (fake) provider, end to end.

FIXED USAGE — chosen so EVERY term of the credit formula has a genuine,
non-trivial ceiling to round (round-1 self-review, "M-1 cảnh báo": the
FIRST version of this file used cache_miss=1200 and completion=350, both
exact multiples of 1000, so cost.go's divUp only ever rounded the
cache_hit=40 term — a "round the fixture for readability" edit could have
silently deleted the ONLY case exercising divUp's rounding direction, and
nothing here would have said so). All three terms below land on a genuine
fraction:

    cache_hit=137, cache_miss=1583, completion=421 (tokens)

Against ai_pricing's seeded deepseek-v4-pro row (apps/api/migrations/
0007_ai_credits.up.sql: credits_per_1k_in=1320, credits_per_1k_cached_in=44,
credits_per_1k_out=3960 micro-credits per 1k tokens) and cost.go's divUp
(ceiling division), ONE turn against this server costs EXACTLY:

    divUp(137,    44) = ceil( 137 *   44 / 1000) = ceil(   6.028) =    7
    divUp(1583, 1320) = ceil(1583 * 1320 / 1000) = ceil(2089.560) = 2090
    divUp(421,  3960) = ceil( 421 * 3960 / 1000) = ceil(1667.160) = 1668
    ONE_TURN_MICRO                                                = 3765

`apps/web/e2e/s2.spec.ts` hardcodes this same 3765 as its own
`ONE_TURN_MICRO`, and derives `SEED_MICRO = 4765` (`ONE_TURN_MICRO + 1000`)
from it — chosen so the SECOND of two turns charges MORE than the balance
that is left after the first, driving the balance NEGATIVE rather than
merely to zero (see that spec's own top comment, "round-1 self-review,
M-2", for why: a balance seeded at EXACTLY one turn's cost cannot tell
correct subtraction apart from a bug that silently floors the result at
zero instead of letting it go negative — spec §3.4 requires the latter).
KEEP ALL FOUR NUMBERS (the three usage figures here and ONE_TURN_MICRO) IN
SYNC BY HAND with `s2.spec.ts` if any of them ever changes — there is no
third place either file could read a shared value from without a build
step neither otherwise needs (same tension apps/web/playwright.config.ts
already documents for CORS_ORIGIN).

SEPARATE FROM `ai_pricing`'s COST columns: `scripts/test-e2e.sh` also seeds
`ai_pricing.cost_micro_per_1k_*` to values DIFFERENT from the
`credits_per_1k_*` columns this file's math above uses (round-1
self-review, "M-1" — migration 0007 seeds the two sets of columns EQUAL for
deepseek-v4-pro, which means a `ChargeTurn` bug that deducts/records the
platform's COST instead of the learner's CREDITS is invisible to any
assertion that only checks the numbers end up right, because both columns
produce the identical number). This file's own derivation above is
unaffected — it is entirely about the `credits_per_1k_*` columns, never
`cost_micro_per_1k_*` — see `test-e2e.sh`'s own comment on that seed step
for the full reasoning.

STREAMING SHAPE, matched against stream.go's CompleteStream byte for byte:
  - Content-Type does not matter to the Go client (CompleteStream never
    reads it — only resp.StatusCode) but is set to text/event-stream anyway.
  - Every line is "data: <json>\\n\\n" — no "event:" field. DeepSeek's own
    stream never sends one; only apps/api's OWN downstream SSE to the
    BROWSER does (handler.go's writeSSE) — a different wire, one hop later.
  - The answer streams across a few `delta.content` fragments with a real
    inter-chunk delay (see DELTA_CHUNK_DELAY_S below) — the same property
    the now-deleted `serveProvider` helper had (git show
    390931e:apps/web/e2e/s2.spec.ts). Unlike that old helper, THIS repo
    still has a live assertion for it: `s2.spec.ts`'s scenario 2 polls the
    answer element mid-stream and requires it to be a non-empty, INCOMPLETE
    prefix of the full text at least once (round-1 self-review, "Minor 2" —
    a prior version of this file claimed this delay made "streamed"
    distinguishable from "painted once at the end" with no assertion
    anywhere that actually looked at an intermediate state; that claim is
    now true rather than aspirational). See docs/testing.md's `s2.spec.ts`
    section for where the old file's reusable ideas did and did not carry
    forward.
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
NAMED GAP (round-1 self-review nit): because WebSearches is always 0 here,
cost.go's Charge's own web-search surcharge terms
(`s.CostMicroPerWebSearch`/`s.CreditsPerWebSearch`, cost.go:33/37) have ZERO
coverage from this e2e gate — deleting either line would not turn this
suite red. Not closed here; Go's own cost_test.go is where that formula is
actually pinned.

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

# Vietnamese, written as literal UTF-8 source text (this file's own encoding
# is UTF-8, like every other .py/.ts/.go file in this repo) — NOT \uXXXX
# escapes (round-1 self-review corrected an earlier version of this comment
# that claimed otherwise; the raw bytes at the start of "Đây" are literally
# 0xC4 0x90 0xC3 0xA2, i.e. UTF-8, not an escape sequence). The bytes sent
# over the wire are UTF-8 either way — json.dumps with ensure_ascii=True
# below re-escapes them to \uXXXX on OUTPUT, which is a separate, later
# step from how this literal is written in the SOURCE file.
ANSWER_TEXT = (
    "Đây là câu trả lời cố định "
    "từ DeepSeek giả, dùng cho bộ kiểm e2e của "
    "Task 18. Không có lời gọi mạng thật nào "
    "tới DeepSeek trong lần chạy này."
)


def _delta_chunks(text: str, words_per_chunk: int):
    """Split `text` into a handful of fragments that concatenate back to it
    EXACTLY — s2.spec.ts asserts the answer element's FULL text equals
    ANSWER_TEXT verbatim (not merely a `toContainText` substring — round-1
    self-review found an earlier version of the spec only checked a ~42-char
    prefix ending inside the second fragment, so a bug that lost, duplicated
    or reordered anything past that point would have passed silently), so a
    split that lost or duplicated a character anywhere fails loudly there,
    not silently here."""
    words = text.split(" ")
    for i in range(0, len(words), words_per_chunk):
        group = words[i:i + words_per_chunk]
        suffix = " " if i + words_per_chunk < len(words) else ""
        yield " ".join(group) + suffix


DELTA_CHUNKS = list(_delta_chunks(ANSWER_TEXT, 6))

# Per-chunk delay while streaming. 0.1s × up to 6 chunks = a ~0.6s
# streaming window per turn — short enough that two turns (s2.spec.ts's
# scenario 2, see this file's header comment on ONE_TURN_MICRO/SEED_MICRO)
# still cost the suite well under two seconds total, but long enough to
# give Playwright's `expect.poll` (default-ish 25-50ms sampling interval)
# many chances to observe a genuine mid-stream, INCOMPLETE state rather
# than racing a delivery that completes inside a single poll tick.
DELTA_CHUNK_DELAY_S = 0.1

# See this file's header comment for the derivation of 3765 micro-credits
# (ONE_TURN_MICRO) from these three numbers against ai_pricing's seeded
# deepseek-v4-pro CREDITS columns (never the COST columns — see the header
# comment's "SEPARATE FROM ai_pricing's COST columns" paragraph).
USAGE = {
    "prompt_tokens": 137 + 1583,
    "completion_tokens": 421,
    "prompt_cache_hit_tokens": 137,
    "prompt_cache_miss_tokens": 1583,
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
    # which is free on a local compose network for the handful of turns any
    # one e2e run makes.

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
        # chapter, with any tool list, EVERY call. See this file's header
        # comment for why a fixed reply is the point, not a shortcut.
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
            # See DELTA_CHUNK_DELAY_S's own comment above for why this
            # duration specifically.
            time.sleep(DELTA_CHUNK_DELAY_S)

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

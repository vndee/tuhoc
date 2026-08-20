// Package apilog is the API's server-side error log: the one place where
// the real cause behind a generic 5xx response gets recorded before that
// deliberately-uninformative response goes out on the wire.
//
// It exists because the two halves of "handle an internal failure" pull in
// opposite directions and both are mandatory:
//
//   - The RESPONSE must leak nothing. Every 500 in this API answers with a
//     fixed, generic string ("sync push failed", "stats failed", ...) and
//     never `err.Error()` — an internal error can carry schema names, SQL
//     fragments, host names, and in the wrong hands the shape of the data
//     model. That is a deliberate choice and this package does not change
//     it.
//   - The SERVER must keep the cause. Without it, the only signal that
//     `/sync` is failing in production is a 500 in the access log with no
//     reason attached, and the richly-wrapped errors the repo layer builds
//     ("sync: upsert progress (course=%s chapter=%s status=%s): %w") are
//     constructed and then thrown away at the handler boundary — all
//     eleven of the API's 500 sites did exactly that before this package
//     existed.
//
// Writes through `slog.Default()` rather than a logger plumbed through
// every constructor: the alternative would have changed the signature of
// every `NewHandler` and every test that calls one, for a dependency that
// is genuinely process-global. Tests capture output by swapping the
// default logger (see internal/server/observability_test.go).
//
// What must never appear here: note bodies (annotations.note), passwords,
// and password hashes. None of the wrapped errors this package receives
// carry any of the three — the repo layer's error strings name identifiers
// (course/chapter/status/uuid) only, and auth's never include the
// credential itself — and that is a property to preserve when adding a new
// wrapped error, not an accident to rely on. For the same reason this logs
// `c.Path()` and not `c.OriginalURL()`: the path alone, never the query
// string.
package apilog

import (
	"fmt"
	"log/slog"

	"github.com/gofiber/fiber/v2"
)

// Internal records the real, wrapped cause behind a generic 500 response.
// `op` names the operation in the handler's own vocabulary (e.g.
// "sync.Push") so a log line is attributable to a call site without
// depending on the error text alone.
//
// Call it immediately before returning the 500, never instead of it.
func Internal(c *fiber.Ctx, op string, err error) {
	slog.Error("request failed",
		"method", c.Method(),
		"path", c.Path(),
		"op", op,
		"err", err.Error(),
	)
}

// Panic records a panic recovered by the recover middleware, together with
// the stack trace that says where it came from.
//
// This is wired as the middleware's `StackTraceHandler` (see
// internal/server/server.go) rather than left to its default, which writes
// straight to os.Stderr and so lands outside whatever the rest of the
// process logs through. Routing it here keeps one destination for
// "something went wrong on the server," and makes the stack trace
// assertable in a test instead of merely believed to be enabled.
func Panic(c *fiber.Ctx, recovered any, stack []byte) {
	slog.Error("panic recovered",
		"method", c.Method(),
		"path", c.Path(),
		"panic", fmt.Sprint(recovered),
		"stack", string(stack),
	)
}

// ratelimit.go implements spec §3.4's call-frequency cap: a per-account
// budget of at most `max` calls inside any `window`-long stretch of time,
// enforced ENTIRELY SEPARATELY from ai_credits (credits.go, this same
// package). The task 10 brief names the two abuse shapes this exists for:
// a script burning through a well-funded account's tokens as fast as the
// server will accept them (ai_credits alone never stops this — the
// account has plenty to spend, EnsureCredit sails it through every time),
// and someone farming the signup grant across many freshly-registered
// accounts (the same problem, worse: each account individually looks
// perfectly healthy to EnsureCredit). Both abuse shapes need a gate that
// has NO OPINION on balance_micro at all — which is exactly why
// RateLimiter's Allow takes only a user id, never a *Service or a
// Result: nothing in this type can even SEE a balance, so nothing here
// can be tempted to let a healthy one through.
//
// Task 11 wires this into POST /ai/chat's handler, calling Allow
// alongside — not instead of — credits.go's EnsureCredit; see Allow's own
// doc comment for why both checks must run.
package ai

import (
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
)

// ErrRateLimited is returned by Allow when userID has already used its
// full budget of calls within the current window. Unlike
// ErrInsufficientCredit (credits.go), which names a durable account state
// a client can act on (show a top-up prompt), spec §3.4 gives no specific
// retry time here — a caller mapping this to HTTP is expected to use 429,
// whose Retry-After semantics exist for exactly this kind of transient,
// time-bounded refusal.
var ErrRateLimited = errors.New("ai: rate limited")

// RateLimiter enforces a sliding-window call budget per user id, held
// entirely in process memory. There is no migration for this under
// migrations/, on purpose: nothing here needs to survive a restart or be
// visible to more than one server process, unlike ai_credits (real money,
// must never reset by accident) or ai_settings (deliberately
// hot-reloadable from Task 17's CMS without a deploy). A process restart
// resetting everyone's budget to zero is an ACCEPTABLE cost of this
// design, not a bug: both abuse shapes spec §3.4 names (a runaway script,
// a signup-grant farm) need sustained high-frequency calling to matter,
// and neither survives being reset by a deploy any better than it
// survives waiting out one window.
//
// The zero value is not usable — build one with NewRateLimiter.
type RateLimiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[uuid.UUID][]time.Time

	// now defaults to time.Now; NewRateLimiter never sets it to anything
	// else. Tests in this package (same package, unexported field) swap
	// it directly to move the clock without a real sleep.
	now func() time.Time
}

// NewRateLimiter builds a RateLimiter allowing at most max calls per user
// id within any window-long stretch of time. Both max and window are the
// caller's decision (Task 11's wiring, or whatever config later reads
// them from) — this file bakes in no specific number, the same way
// credits.go bakes in no specific price: the mechanism belongs here, the
// policy does not.
func NewRateLimiter(max int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		max:    max,
		window: window,
		hits:   make(map[uuid.UUID][]time.Time),
		now:    time.Now,
	}
}

// Allow records one call attempt for userID and reports whether it fits
// inside the budget. It is a SLIDING window, not a fixed one: a call
// counts against the budget for exactly `window` after it happened, not
// until some fixed clock boundary. A fixed window would let a burst of
// 2*max calls through back-to-back by timing it to straddle the boundary
// (max calls in the last instant of one window, max more in the first
// instant of the next) — precisely the kind of script abuse spec §3.4
// wants stopped, so this file does not use that shape.
//
// Allow takes ONLY userID — no ctx, no credit check, no reference to this
// package's Service. That is deliberate: see this file's package comment
// for why a rate limiter that could see a balance would be the wrong
// shape for what spec §3.4 asks for. A caller (Task 11) is expected to
// call this ALONGSIDE credits.go's EnsureCredit before every turn, never
// as a substitute for it: EnsureCredit blocks an account that is out of
// money regardless of how slowly it is calling, and Allow blocks an
// account that is calling too fast regardless of how much money it has —
// neither check can stand in for the other.
func (rl *RateLimiter) Allow(userID uuid.UUID) error {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := rl.now()
	cutoff := now.Add(-rl.window)

	// Filter rl.hits[userID] down to timestamps still inside the window,
	// in place: kept and rl.hits[userID] share a backing array, and the
	// write cursor never runs ahead of the read cursor, so this is the
	// standard safe in-place filter — see e.g. the Go wiki's "Filtering
	// without allocating" idiom.
	kept := rl.hits[userID][:0]
	for _, h := range rl.hits[userID] {
		if h.After(cutoff) {
			kept = append(kept, h)
		}
	}

	if len(kept) >= rl.max {
		rl.hits[userID] = kept
		return ErrRateLimited
	}

	rl.hits[userID] = append(kept, now)
	return nil
}

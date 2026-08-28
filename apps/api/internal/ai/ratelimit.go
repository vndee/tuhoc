// ratelimit.go implements spec §3.4's call-frequency cap: a per-account
// budget of at most `max` calls inside any `window`-long stretch of time,
// enforced ENTIRELY SEPARATELY from ai_credits (credits.go, this same
// package). What it actually defends against: a script burning through
// ONE well-funded account's tokens as fast as the server will accept them
// — ai_credits alone never stops this, the account has plenty to spend
// and EnsureCredit sails it through every call. That is why RateLimiter's
// Allow takes only a user id, never a *Service or a Result: nothing in
// this type can even SEE a balance, so nothing here can be tempted to let
// a healthy one through.
//
// What it does NOT defend against, on its own: spec §3.4's other named
// abuse shape, someone farming the signup grant across many
// freshly-registered accounts. Allow is keyed BY user id specifically
// because the single-account burn above needs exactly that (one account,
// hammered fast); the same keying means a farmer sidesteps this file
// entirely by registering K accounts instead of hammering one — each new
// uuid.UUID gets its own empty budget in rl.hits, so K accounts buy
// K*max calls per window, not max. This is a real, currently-open gap,
// not an oversight this file can close by itself: the actual fix is
// upstream of rate limiting (email verification before a signup grant
// lands, or delaying/throttling the grant itself), and apps/api has no
// email-verification code today (grep for email_verified,
// verification_token, VerifyEmail — zero hits). Recorded as a named debt
// in docs/carried-forward.md rather than left as an implicit assumption
// in this comment alone.
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
// migrations/, on purpose: nothing here needs to survive a restart, unlike
// ai_credits (real money, must never reset by accident) or ai_settings
// (deliberately hot-reloadable from Task 17's CMS without a deploy). A
// process restart resetting everyone's budget to zero is an ACCEPTABLE
// cost of this design, not a bug: the single-account burn spec §3.4 names
// needs sustained high-frequency calling to matter, and that does not
// survive being reset by a deploy any better than it survives waiting out
// one window.
//
// "Visible to more than one server process" is deliberately NOT claimed
// as acceptable-to-lose the way the paragraph above claims restart-safety
// is: this type's state is NOT shared across processes at all, so running
// more than one instance would silently turn "max per user" into
// "max * instance-count per user". That is true and currently harmless
// only because render.yaml's tuhoc-api service is `plan: free` with no
// scaling/numInstances block — Render's free plan does not offer more
// than one instance — not because of any property of this design. If that
// plan ever changes, this budget quietly stops being a real budget; see
// docs/carried-forward.md for this tied explicitly to that deploy fact.
//
// Known, accepted debt, not fixed in this file: rl.hits never removes an
// entry once created — every distinct user id that ever calls Allow keeps
// a small slice in this map for the lifetime of the process, with no TTL
// or sweep. At this platform's scale that is a bounded, slow leak (one
// small slice per learner, not per request); the same restart that resets
// everyone's budget above also frees this memory. A `NewRateLimiter` that
// wanted this to be more than an accepted trade-off would need a
// background sweep this constructor does not build. See
// docs/carried-forward.md for why this file does not simply reuse
// github.com/gofiber/fiber/v2/middleware/limiter instead (already
// vendored, already used for /auth/* in server.go, and its default
// storage DOES expire entries on its own) — the short version: that
// package's only export is `limiter.New(cfg) fiber.Handler`, coupled to
// *fiber.Ctx, and has no standalone "check a plain key" API a domain
// package like this one could call directly, in the same code path as
// credits.go's EnsureCredit, without importing gofiber into internal/ai.
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
// inside the budget. It is a SLIDING window, not a fixed one: a call made
// at t0 counts against the budget for exactly the half-open interval
// (t0, t0+window] — that is, EVERY later "now" with now-t0 < window still
// counts it, and the instant now-t0 == window is already OUTSIDE the
// window (the call no longer counts, full recovery, not one instant
// later). TestAllowRecoversExactlyAtWindowBoundary pins that exact edge;
// TestAllowSlidesPartiallyNotAllAtOnce pins that expiry is evaluated
// per-hit, not "clear everything once the oldest hit ages out". A FIXED
// window (instead of this sliding one) would let a burst of 2*max calls
// through back-to-back by timing it to straddle a boundary (max calls in
// the last instant of one window, max more in the first instant of the
// next) — precisely the kind of script abuse spec §3.4 wants stopped, so
// this file does not use that shape.
//
// Only an ALLOWED call is recorded into rl.hits — a call refused with
// ErrRateLimited is never added. This matters as much as the sliding
// window itself: if a blocked attempt also counted as a hit, a client
// that keeps retrying while blocked would keep pushing its own recovery
// time forward and could stay locked out indefinitely, even though it
// never got a single extra call through. TestBlockedAttemptsDoNotExtend
// TheWindow pins this the other direction: retrying while blocked must
// not delay recovery past `window` since the last call that actually
// succeeded.
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

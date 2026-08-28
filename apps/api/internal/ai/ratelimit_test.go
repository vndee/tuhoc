package ai

// ratelimit_test.go pins two independent claims about RateLimiter (task
// 10's brief): the threshold itself blocks at the right call, and the
// block is NEVER a function of ai_credits — a well-funded account is
// throttled exactly like a broke one, because Allow's only input is a
// user id.
//
// The threshold test below checks the boundary at EXACTLY the budget and
// EXACTLY one call past it — not "eventually blocks somewhere after many
// calls" — because an off-by-one in either direction (>= vs >, or an
// index shifted by one) would still pass a looser test. See credits_test.go's
// own lesson (task 9's debt ledger): a boundary never exercised at its
// exact edge is a boundary a later refactor can silently move.

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/vndee/tuhoc-api/internal/store"
)

// TestAllowBlocksAtNPlus1WithinWindow is the exact boundary the brief
// demands: N calls succeed, and the VERY NEXT one (N+1, same window, no
// clock movement) is refused.
func TestAllowBlocksAtNPlus1WithinWindow(t *testing.T) {
	const maxCalls = 3 // distinct from windowSeconds below — different units, but kept numerically distinct on purpose (task 9's fixture-permutation lesson)
	const windowSeconds = 45
	rl := NewRateLimiter(maxCalls, windowSeconds*time.Second)
	userID := uuid.New()

	for i := 1; i <= maxCalls; i++ {
		if err := rl.Allow(userID); err != nil {
			t.Fatalf("call %d of %d: want allowed, got %v", i, maxCalls, err)
		}
	}

	if err := rl.Allow(userID); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("call %d (budget+1), same window: want ErrRateLimited, got %v", maxCalls+1, err)
	}
}

// TestAllowBlocksAWellFundedAccountIndependentlyOfCredit is spec §3.4's
// core claim: a rate limit that is a NO-OP whenever the account has
// credit left is not independent, it is just a slower path to the same
// EnsureCredit decision. This test keeps the account's balance untouched
// throughout (EnsureCredit says yes every single time, proven by calling
// it) and still expects RateLimiter to refuse the call past its own
// budget — the two gates must be able to DISAGREE.
func TestAllowBlocksAWellFundedAccountIndependentlyOfCredit(t *testing.T) {
	pool := store.TestPool(t)
	ctx := context.Background()
	svc := NewService(pool)

	// Absurdly large on purpose: nothing in this test ever calls
	// ChargeTurn, so the balance never moves, but the size itself is a
	// belt-and-suspenders signal to a reader that "well-funded" is not a
	// borderline case here.
	const startingBalanceMicro = 5_000_000_000
	userID := newCreditsUser(t, pool, "ratelimit-independent", startingBalanceMicro)

	const maxCalls = 2 // distinct from windowMinutes and from startingBalanceMicro
	const windowMinutes = 5
	rl := NewRateLimiter(maxCalls, windowMinutes*time.Minute)

	for i := 1; i <= maxCalls; i++ {
		if err := svc.EnsureCredit(ctx, userID); err != nil {
			t.Fatalf("EnsureCredit call %d: unexpected block on a well-funded account: %v", i, err)
		}
		if err := rl.Allow(userID); err != nil {
			t.Fatalf("Allow call %d of %d: want allowed, got %v", i, maxCalls, err)
		}
	}

	// The balance never moved — EnsureCredit alone would wave this next
	// call through exactly like the first two did.
	if err := svc.EnsureCredit(ctx, userID); err != nil {
		t.Fatalf("EnsureCredit after %d calls with balance untouched: want nil, got %v — "+
			"this test needs the credit gate to keep saying yes here, so the block asserted "+
			"below can only be attributed to the rate limiter, not to credit", maxCalls, err)
	}

	if err := rl.Allow(userID); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("Allow after %d calls: want ErrRateLimited despite a healthy %d-micro-credit "+
			"balance, got %v — spec §3.4 requires rate limiting to block a well-funded account, "+
			"independently of EnsureCredit", maxCalls, startingBalanceMicro, err)
	}
}

// TestAllowTracksEachUserSeparately guards against a limiter keyed
// globally (a single shared counter) instead of per user id — that shape
// of bug would make one busy account throttle everyone else, which is a
// worse outage than the abuse spec §3.4 is defending against.
func TestAllowTracksEachUserSeparately(t *testing.T) {
	const maxCalls = 2 // distinct from windowSeconds
	const windowSeconds = 20
	rl := NewRateLimiter(maxCalls, windowSeconds*time.Second)
	alice := uuid.New()
	bob := uuid.New()

	for i := 1; i <= maxCalls; i++ {
		if err := rl.Allow(alice); err != nil {
			t.Fatalf("alice call %d of %d: want allowed, got %v", i, maxCalls, err)
		}
	}
	if err := rl.Allow(alice); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("alice call %d: want ErrRateLimited, got %v", maxCalls+1, err)
	}

	// Bob has made zero calls of his own.
	if err := rl.Allow(bob); err != nil {
		t.Fatalf("bob's first call: want allowed, got %v — alice's calls must not count against bob", err)
	}
}

// TestAllowRecoversAfterWindowElapses proves the "sliding window"
// property is real: calls made before the window's start no longer count
// against the budget, via an injectable clock (rl.now, unexported —
// reachable directly because this file shares package ai with
// ratelimit.go) rather than an actual multi-second sleep.
func TestAllowRecoversAfterWindowElapses(t *testing.T) {
	const maxCalls = 2 // distinct from windowSeconds
	const windowSeconds = 30
	rl := NewRateLimiter(maxCalls, windowSeconds*time.Second)
	userID := uuid.New()

	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	rl.now = func() time.Time { return base }

	for i := 1; i <= maxCalls; i++ {
		if err := rl.Allow(userID); err != nil {
			t.Fatalf("call %d of %d at t=0: want allowed, got %v", i, maxCalls, err)
		}
	}
	if err := rl.Allow(userID); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("call %d at t=0: want ErrRateLimited, got %v", maxCalls+1, err)
	}

	// Move the clock past the window: the earlier hits must no longer
	// count.
	rl.now = func() time.Time { return base.Add(windowSeconds*time.Second + time.Second) }
	if err := rl.Allow(userID); err != nil {
		t.Fatalf("call after window elapsed: want allowed, got %v", err)
	}
}

// Round 1 review found two mutants the four tests above never caught,
// both at instants and interleavings TestAllowRecoversAfterWindowElapses
// never exercised (it only ever moves the clock to t=0 or comfortably
// past the whole window — never to the exact boundary, and never with a
// blocked poll in between). The three tests below close those gaps:
// TestAllowRecoversExactlyAtWindowBoundary pins the exact edge, PLUS a
// SECOND mutant found alongside it (`h.After(cutoff)` -> `!h.Before
// (cutoff)`, one instant off in the OTHER direction, run and confirmed
// dead against this test before it was kept); TestAllowSlidesPartially
// NotAllAtOnce pins that expiry is evaluated per-hit; TestBlockedAttempts
// DoNotExtendTheWindow pins that a REFUSED call never counts as a hit.

// TestAllowRecoversExactlyAtWindowBoundary pins the exact instant this
// type's sliding window recovers: a hit at t0 stops counting the moment
// now-t0 == window, not one instant later. Round 1 review's mutant
// (`h.After(cutoff)` -> `!h.Before(cutoff)`, i.e. keep a hit exactly AT
// the cutoff instead of dropping it) changes behavior at EXACTLY this
// instant and nowhere else — a test that only ever checks window+1s
// (TestAllowRecoversAfterWindowElapses, above) cannot see it, because
// both the mutant and the original agree by window+1s.
func TestAllowRecoversExactlyAtWindowBoundary(t *testing.T) {
	const maxCalls = 2 // distinct from windowSeconds
	const windowSeconds = 40
	rl := NewRateLimiter(maxCalls, windowSeconds*time.Second)
	userID := uuid.New()

	base := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	rl.now = func() time.Time { return base }

	for i := 1; i <= maxCalls; i++ {
		if err := rl.Allow(userID); err != nil {
			t.Fatalf("call %d of %d at t=0: want allowed, got %v", i, maxCalls, err)
		}
	}
	if err := rl.Allow(userID); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("call at t=0 past budget: want ErrRateLimited, got %v", err)
	}

	// Exactly `window` later, to the instant — not window+1s.
	rl.now = func() time.Time { return base.Add(windowSeconds * time.Second) }
	if err := rl.Allow(userID); err != nil {
		t.Fatalf("call at t=window exactly: want allowed — this type's window is the half-open "+
			"interval (t0, t0+window], so t0+window itself is already outside it — got %v", err)
	}
}

// TestAllowSlidesPartiallyNotAllAtOnce proves expiry is evaluated PER
// HIT, not "clear the whole budget once the single oldest hit ages out"
// — an implementation that only checked the oldest entry (e.g. a plain
// FIFO queue popped from the front until the front is fresh) could pass
// every other test in this file yet free ALL slots the instant ANY one
// hit expires, which is a materially looser budget than the one this
// type promises.
func TestAllowSlidesPartiallyNotAllAtOnce(t *testing.T) {
	const maxCalls = 2 // distinct from windowSeconds and gapSeconds
	const windowSeconds = 30
	const gapSeconds = 12 // distinct from maxCalls and windowSeconds
	rl := NewRateLimiter(maxCalls, windowSeconds*time.Second)
	userID := uuid.New()

	base := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)

	rl.now = func() time.Time { return base }
	if err := rl.Allow(userID); err != nil {
		t.Fatalf("first call at t=0: want allowed, got %v", err)
	}

	rl.now = func() time.Time { return base.Add(gapSeconds * time.Second) }
	if err := rl.Allow(userID); err != nil {
		t.Fatalf("second call at t=%ds: want allowed, got %v", gapSeconds, err)
	}

	// Budget is now full: one hit at t=0, one at t=gapSeconds. Move to a
	// moment where ONLY the first hit (t=0) has aged out of the window —
	// the second (t=gapSeconds) has not.
	thirdCallSeconds := windowSeconds + 1 // > window since t=0; still < window since t=gapSeconds
	rl.now = func() time.Time { return base.Add(time.Duration(thirdCallSeconds) * time.Second) }
	if err := rl.Allow(userID); err != nil {
		t.Fatalf("third call at t=%ds (only the t=0 hit should have aged out): want allowed, got %v",
			thirdCallSeconds, err)
	}

	// That third call re-filled the one freed slot. The t=gapSeconds hit
	// is still within its own window (it will not age out until
	// t=gapSeconds+windowSeconds, later than thirdCallSeconds), so a
	// fourth call right now must still be blocked — proving the
	// allowance above was a partial slide (exactly one slot), not a full
	// reset of the budget.
	if err := rl.Allow(userID); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("fourth call at t=%ds: want ErrRateLimited (the t=%ds hit is still within its own "+
			"window), got %v", thirdCallSeconds, gapSeconds, err)
	}
}

// TestBlockedAttemptsDoNotExtendTheWindow pins that Allow only ever
// records a call it ALLOWS — a call it refuses with ErrRateLimited must
// never be added to rl.hits. Round 1 review's mutant (on the refusal
// branch: `rl.hits[userID] = kept` -> `rl.hits[userID] = append(kept,
// now)`) makes every blocked ATTEMPT count as if it were an allowed
// call, which — as this test's own numbers show — means a client that
// keeps polling while blocked never recovers, even though it never got a
// single extra call through: exactly the failure mode a caller retrying
// on a timer (Task 11's frontend, most plausibly) would hit in
// production.
func TestBlockedAttemptsDoNotExtendTheWindow(t *testing.T) {
	const maxCalls = 2 // distinct from every *Seconds constant below
	const windowSeconds = 30
	const poll1Seconds = 10
	const poll2Seconds = 20
	// retrySeconds is > windowSeconds after the last ALLOWED call (t=0),
	// but only 15s after poll2Seconds — well within windowSeconds of it.
	// If a blocked poll counted as a hit, the poll2Seconds hit alone
	// would still be "fresh" here and this call would stay blocked.
	const retrySeconds = 35
	rl := NewRateLimiter(maxCalls, windowSeconds*time.Second)
	userID := uuid.New()

	base := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)

	rl.now = func() time.Time { return base }
	for i := 1; i <= maxCalls; i++ {
		if err := rl.Allow(userID); err != nil {
			t.Fatalf("call %d of %d at t=0: want allowed, got %v", i, maxCalls, err)
		}
	}

	rl.now = func() time.Time { return base.Add(poll1Seconds * time.Second) }
	if err := rl.Allow(userID); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("poll at t=%ds: want ErrRateLimited, got %v", poll1Seconds, err)
	}
	rl.now = func() time.Time { return base.Add(poll2Seconds * time.Second) }
	if err := rl.Allow(userID); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("poll at t=%ds: want ErrRateLimited, got %v", poll2Seconds, err)
	}

	rl.now = func() time.Time { return base.Add(retrySeconds * time.Second) }
	if err := rl.Allow(userID); err != nil {
		t.Fatalf("retry at t=%ds (%ds after the last ALLOWED call, well past the %ds window): "+
			"want allowed, got %v — a blocked attempt must not extend the window",
			retrySeconds, retrySeconds, windowSeconds, err)
	}
}

// TestAllowIsRaceSafeUnderConcurrentCalls follows the exact shape of
// tool_search_test.go's TestSearchToolCapIsRaceSafeUnderConcurrentCalls
// (this same package, born from round-1 review of Task 8 finding the
// identical gap: a shared-instance budget counter with no test that ever
// called it from more than one goroutine at once). Round 2 review of THIS
// task found the same gap here: deleting rl.mu.Lock()/rl.mu.Unlock() from
// Allow leaves all seven other tests in this file green, because none of
// them calls Allow from more than one goroutine on the same *RateLimiter.
// A RateLimiter is explicitly NOT meant to be used that way — this file's
// own package comment says Task 11 wires ONE instance into every
// /ai/chat request, so concurrent HTTP handlers calling Allow(sameUserID)
// at once is the normal case, not a misuse — which is exactly the shape
// only a concurrent test can exercise.
//
// Assertion beyond "no race" (this task's round 2 review asked for one
// explicitly): with maxCalls < attempts concurrent callers on the SAME
// user id, EXACTLY maxCalls of them must succeed — not "at most", not "a
// number near it". This is NOT a brittle ordering assertion: WHICH
// goroutines win is unspecified by design and does not matter to this
// test; HOW MANY win is fully determined by the mutex correctly
// serializing access to rl.hits, the same invariant
// TestSearchToolCapIsRaceSafeUnderConcurrentCalls pins for its own budget
// counter. Run under `-race` (this task's own verification command
// includes it for internal/ai — see task-10-report.md), a missing or
// broken lock is reported as a DATA RACE even on a scheduling that
// happens to still land on the right count — the count assertion is the
// belt, `-race` is the suspenders that actually catches the missing lock.
func TestAllowIsRaceSafeUnderConcurrentCalls(t *testing.T) {
	const maxCalls = 5 // distinct from attempts and windowMinutes below
	const attempts = 50
	// windowMinutes is long enough that none of the `attempts`
	// near-simultaneous timestamps (real time.Now(), not the injectable
	// clock the other tests in this file use) could age out of the
	// window during this test's brief run — keeping this a pure test of
	// the LOCK, not of window arithmetic racing against wall-clock time.
	const windowMinutes = 10
	rl := NewRateLimiter(maxCalls, windowMinutes*time.Minute)
	userID := uuid.New()

	var wg sync.WaitGroup
	var succeeded int64
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := rl.Allow(userID); err == nil {
				atomic.AddInt64(&succeeded, 1)
			}
		}()
	}
	wg.Wait()

	if succeeded != maxCalls {
		t.Errorf("succeeded = %d, want EXACTLY %d (maxCalls) — any deviation means rl.hits is "+
			"being raced, and under a broken lock a caller could burn more turns than the "+
			"configured budget allows, or fewer than it should", succeeded, maxCalls)
	}
}

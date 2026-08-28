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

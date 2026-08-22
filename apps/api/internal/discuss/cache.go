// Package discuss embeds a read-only view of the registry repository's
// GitHub Discussions.
//
// # WHAT THIS PACKAGE IS DEFENDING AGAINST
//
// GitHub is a third party. It will be slow, it will rate-limit, it will
// return 500s, and — the case that actually cost this project a blank page
// once (commit 815a472) — it will one day return a 200 whose body is not
// the shape anybody expected. Every one of those must degrade into "the
// discussion could not be loaded" and must never take the course page with
// it. That is why the decode in client.go checks the shape at the BOUNDARY
// rather than letting a zero value travel inward, and why handler.go's
// answer is a value ("loaded": false) rather than an error status.
//
// # AND THE OTHER HALF: THE QUOTA IS SHARED
//
// The token belongs to the platform, not to the reader (see
// config.Config.GitHubToken). So a single reader who burns the quota does
// not lose their own discussions — they lose EVERYBODY's. The cache and the
// budget in this file are what stand between one reader and that outcome,
// and they are ordered so the budget is consulted BEFORE the network call,
// never after. A refusal that has already made the call is not a refusal;
// it produces byte-identical responses and a completely different bill.
package discuss

import (
	"sync"
	"time"
)

// SuccessTTL is how long a thread fetched from GitHub is served from
// memory before another fetch is allowed.
//
// Five minutes is chosen against the reader, not against GitHub: a
// discussion comment posted on the registry repo shows up on the course
// page within five minutes, which is well inside the time it takes anyone
// to notice, while turning "one page view, one API call" into "one API
// call per course per five minutes no matter how many readers". The cache
// is the primary defense on the quota; the budget below is the backstop
// for the case the cache cannot help with (many distinct courses).
const SuccessTTL = 5 * time.Minute

// FailureTTL is how long a FAILED fetch is remembered.
//
// Caching a failure looks wrong until you count the calls without it: while
// GitHub is down, every course page view is a cache miss, so every view
// spends one of the budget's calls on a request already known to fail, and
// within seconds the budget is empty for everyone — including for the
// courses whose threads would have loaded fine. Remembering the failure for
// a minute costs at most sixty seconds of staleness after GitHub recovers
// and removes that entire failure mode.
//
// It is deliberately much shorter than SuccessTTL: a stale success is
// harmless, a stale failure is a working feature that looks broken.
const FailureTTL = time.Minute

// MaxOutboundPerWindow and OutboundWindow are the platform's own ration on
// calls to GitHub, counted across ALL readers because the quota is one
// quota.
//
// Where 30 comes from: a GitHub personal access token gets 5 000 GraphQL
// points per hour, and the query in client.go is a search plus a nested
// connection, so its real cost is several points rather than one. 30 per
// minute is 1 800 requests per hour — comfortably inside the budget even if
// each request cost two or three points — and it is far above what honest
// traffic can reach given the cache above, since a miss only happens once
// per course per SuccessTTL.
//
// What it is NOT: a per-user quota. It is deliberately global, because the
// resource being rationed is global. A per-user limit would let a hundred
// accounts do together exactly the damage this exists to prevent.
const (
	MaxOutboundPerWindow = 30
	OutboundWindow       = time.Minute
)

// entry is one cached answer. ok distinguishes "GitHub answered and the
// body had the right shape" from "it did not"; both are cached, with
// different lifetimes.
type entry struct {
	thread  Thread
	ok      bool
	expires time.Time
}

// Cache is a TTL map from registry id to the last answer for it.
//
// It holds one entry per registry id and never evicts on size. That is
// bounded in practice by the number of registry courses (a few dozen —
// docs/deploy.md §5c) and NOT by anything a client can drive: handler.go
// only ever stores an id that a fetch was actually attempted for, and a
// fetch is only attempted when the budget allows one, so the number of
// distinct keys one attacker can create per hour is bounded by
// MaxOutboundPerWindow rather than by their request rate. If the registry
// ever holds enough courses for that to matter, this needs an eviction
// policy; today adding one would be inventing a bound nothing is near.
type Cache struct {
	mu      sync.Mutex
	entries map[string]entry

	successTTL time.Duration
	failureTTL time.Duration

	// now is the clock. Injectable so tests can prove expiry by moving
	// time instead of by sleeping — a test that sleeps for a TTL either
	// takes as long as the TTL or forces the TTL to be set to something
	// no production value resembles.
	now func() time.Time
}

// NewCache builds a Cache with the package's production lifetimes.
func NewCache() *Cache {
	return NewCacheWith(SuccessTTL, FailureTTL, time.Now)
}

// NewCacheWith builds a Cache with explicit lifetimes and clock, for tests.
func NewCacheWith(successTTL, failureTTL time.Duration, now func() time.Time) *Cache {
	if now == nil {
		now = time.Now
	}
	return &Cache{
		entries:    map[string]entry{},
		successTTL: successTTL,
		failureTTL: failureTTL,
		now:        now,
	}
}

// Get returns the cached answer for registryID if one is present and still
// live. ok reports whether the ENTRY exists; the returned entry's own ok
// field reports whether that entry is a success or a remembered failure.
func (c *Cache) Get(registryID string) (Thread, bool, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	e, present := c.entries[registryID]
	if !present || !c.now().Before(e.expires) {
		return Thread{}, false, false
	}
	return e.thread, e.ok, true
}

// Put stores an answer under registryID, choosing the lifetime from ok.
func (c *Cache) Put(registryID string, thread Thread, ok bool) {
	ttl := c.failureTTL
	if ok {
		ttl = c.successTTL
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[registryID] = entry{thread: thread, ok: ok, expires: c.now().Add(ttl)}
}

// Budget is a fixed-window ration on calls that actually leave this
// process.
//
// # THE ONE THING THIS TYPE EXISTS TO GET RIGHT
//
// Take() must be called BEFORE the outbound call and its answer must
// decide whether that call happens at all. The tempting alternative —
// make the call, then decide whether to serve the result — produces a
// byte-identical HTTP response for every request, so no assertion on
// responses can tell the two apart, while the number of requests actually
// sent to GitHub differs by more than an order of magnitude. Subsystem 2
// measured exactly that mutant: identical bodies (92 refusals either way)
// while the real call count went from 8 to 100.
//
// The test for this counts calls arriving at a fake GitHub, never
// responses leaving this API.
//
// Fixed window, not a sliding one or a token bucket: the property that
// matters is "the hourly bill is bounded", and a fixed window bounds it
// with one integer and no allocation. Its known weakness — up to 2×max
// across a window boundary — is a factor of two on a number chosen with a
// factor of three of headroom.
type Budget struct {
	mu          sync.Mutex
	max         int
	window      time.Duration
	windowStart time.Time
	used        int
	now         func() time.Time
}

// NewBudget builds a Budget with the package's production ration.
func NewBudget() *Budget {
	return NewBudgetWith(MaxOutboundPerWindow, OutboundWindow, time.Now)
}

// NewBudgetWith builds a Budget with an explicit ration and clock, for
// tests.
func NewBudgetWith(max int, window time.Duration, now func() time.Time) *Budget {
	if now == nil {
		now = time.Now
	}
	return &Budget{max: max, window: window, now: now, windowStart: now()}
}

// Take reserves one outbound call, reporting whether the caller may make
// it. A false answer means the caller must NOT contact GitHub.
func (b *Budget) Take() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	now := b.now()
	if now.Sub(b.windowStart) >= b.window {
		b.windowStart = now
		b.used = 0
	}
	if b.used >= b.max {
		return false
	}
	b.used++
	return true
}

package store

import (
	"context"
	"testing"
)

// TestTestPool_MigratesAndSeedsNoCourse is the store package's own
// integration test, and doubles as the first exercise of TestPool — the
// helper every later backend package (auth, sync, stats) uses to get a
// migrated, ready-to-query pool in its own tests. It spins up a real
// postgres:16-alpine container, runs MigrateUp against it, and checks that
// a fully migrated database carries NO course rows.
//
// It used to assert the opposite — one seeded row — because 0001_init
// seeded the author's private textbook into `courses`. That row was
// metadata about a private work baked into every database of everyone who
// ever self-hosted this platform, and rewriting git history would not have
// touched it (S1 review, C2d). 0001 no longer seeds and 0003 deletes what
// it seeded, so the assertion flips with it.
//
// The direction matters: asserting `count == 0` is what makes a re-added
// seed row fail here rather than ship. `count >= 0` would pass either way.
func TestTestPool_MigratesAndSeedsNoCourse(t *testing.T) {
	pool := TestPool(t)

	var count int
	err := pool.QueryRow(context.Background(), "SELECT count(*) FROM courses").Scan(&count)
	if err != nil {
		t.Fatalf("query courses count: %v", err)
	}

	if count != 0 {
		t.Fatalf("want 0 seeded courses (the platform ships no content), got %d", count)
	}
}

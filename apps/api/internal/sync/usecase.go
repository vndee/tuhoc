package sync

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ErrInvalidBatch is returned by Push when a batch item is missing a
// required field. It is checked with errors.Is by handler.go to produce a
// 400 (client's malformed request) rather than the 500 a genuine repo/DB
// failure gets.
var ErrInvalidBatch = errors.New("sync: invalid batch item")

// SyncSafetyLag is subtracted from the observed max updated_at before Pull
// hands it back as the next cursor. See Pull's doc comment for the full
// mechanism this exists to close: two concurrent POST /sync transactions
// can commit out of order relative to the updated_at values their rows
// carry, and without this lag a poller's cursor can advance past a row
// that had not committed yet, losing it permanently. 60s is roughly five
// orders of magnitude more than this workload's actual exposure window
// (single-digit-row batches, millisecond-scale transactions), not a value
// tuned to any measured p99.
const SyncSafetyLag = 60 * time.Second

// Usecase holds sync's business rules: cursor computation for Pull and
// batch validation for Push. It talks to Postgres only through Repo, never
// directly.
type Usecase struct {
	repo *Repo
}

// NewUsecase builds a Usecase over repo.
func NewUsecase(repo *Repo) *Usecase {
	return &Usecase{repo: repo}
}

// Pull returns every progress and annotation row for userID changed
// strictly after since (the repo query itself always stays a strict `>`;
// that part is unchanged and is not what this comment is about), plus a
// cursor the caller can pass as the next call's since.
//
// The cursor is NOT simply the max updated_at seen in this call's result
// set. It is safety-lagged:
//
//	cursor = max(maxUpdatedAt - SyncSafetyLag, since)
//
// Why a raw max(updated_at) is unsafe — this is a commit-ordering race, not
// a clock-tie edge case:
//
//  1. Device A's POST /sync begins, carrying a row with updated_at = T1. Its
//     transaction is slow (network jitter, retry, whatever) and has not
//     committed yet.
//  2. Device B's POST /sync carries a row with updated_at = T2, T2 > T1, and
//     commits FIRST.
//  3. A poller calls GET /sync in between A's begin and A's commit. It sees
//     B's row and would naively advance its cursor to T2.
//  4. A's transaction now commits, with updated_at = T1. Since T1 < T2, that
//     row can never satisfy `updated_at > T2` on any future poll using that
//     cursor — the row is silently lost, forever, with no error and nothing
//     to observe. Note this can happen under perfectly ordinary network
//     jitter; it needs no clock skew and no tied timestamps, and pushing
//     the raw per-call max is what causes it (see the fix's regression
//     test, TestSyncFlows/a_late-committing_row..., which reproduces this
//     scenario and is verified to fail against the pre-fix logic).
//
// The lag closes this by never handing back a cursor newer than
// (observed max - SyncSafetyLag): any transaction that commits within that
// trailing window is still "in range" of a future poll using this cursor,
// because its row's updated_at, however low, is virtually certain to be
// above cursor - SyncSafetyLag. The floor at `since` guarantees the
// watermark itself never moves backwards call over call, and is also what
// makes "nothing new happened" produce an unchanged, non-blank cursor (see
// below).
//
// Consequences, stated plainly rather than glossed over:
//   - Rows whose updated_at falls inside the trailing SyncSafetyLag window
//     are deliberately re-delivered on the next poll or two, even though the
//     poller already saw them. This is harmless: the client applies the
//     exact same LWW rule to re-apply them, which is idempotent by
//     construction (PushBatch's ON CONFLICT ... WHERE guard makes a replay
//     of an already-current row a no-op — see
//     TestSyncFlows/replaying_an_identical_batch_is_idempotent).
//   - The residual hole is a transaction that stays open LONGER than
//     SyncSafetyLag (60s). For this workload — single-digit-row batches,
//     millisecond-scale transactions — that is roughly five orders of
//     magnitude of headroom, not zero risk. This is a deliberate,
//     documented trade-off, not a claim that the race is eliminated.
//   - Deliberately NOT solved by asking the client to subtract a margin
//     before sending `since`: correctness must not depend on client
//     discipline, since a client bug would then silently reintroduce
//     exactly this data loss. The server always hands back a cursor that is
//     safe to use verbatim.
//   - Deliberately NOT solved with a sequence/serial tiebreaker column
//     either: a sequence's value is assigned at statement time, not commit
//     time, so nextval() ordering does not match commit ordering — it would
//     reproduce the identical race in a more expensive, falsely-reassuring
//     form.
func (uc *Usecase) Pull(ctx context.Context, userID uuid.UUID, since time.Time) (progress []ProgressRow, annotations []AnnotationRow, cursor time.Time, err error) {
	progress, err = uc.repo.PullProgress(ctx, userID, since)
	if err != nil {
		return nil, nil, time.Time{}, err
	}

	annotations, err = uc.repo.PullAnnotations(ctx, userID, since)
	if err != nil {
		return nil, nil, time.Time{}, err
	}

	maxUpdatedAt := since
	for _, p := range progress {
		if p.UpdatedAt.After(maxUpdatedAt) {
			maxUpdatedAt = p.UpdatedAt
		}
	}
	for _, a := range annotations {
		if a.UpdatedAt.After(maxUpdatedAt) {
			maxUpdatedAt = a.UpdatedAt
		}
	}

	cursor = maxUpdatedAt.Add(-SyncSafetyLag)
	if cursor.Before(since) {
		cursor = since
	}

	return progress, annotations, cursor, nil
}

// Push validates and applies one batch under userID's identity. userID
// comes from auth.UID (the handler's job to supply, from the authenticated
// session) — it is never taken from the request body, which is exactly
// what makes the user-isolation argument in repo.go's SQL comments hold:
// EXCLUDED.user_id in both upserts is always this value.
//
// Validation happens before anything touches the database, so a malformed
// item anywhere in the batch rejects the whole request with zero side
// effects — a client can't end up in a state where "some of my batch
// applied, some didn't" because of a typo in one item; either every item
// was well-formed and PushBatch's single transaction ran, or nothing did.
//
// Clock clamping: each item's UpdatedAt is stored as
// min(clientUpdatedAt, now) — see clampFuture. FUTURE timestamps only;
// past-dated ones are stored exactly as sent, because that is what makes
// offline editing work at all (see clampFuture's own doc comment).
//
// Note that this mutates the caller's slices in place rather than copying
// them. That is intentional and safe here: handler.go builds both slices
// fresh, per request, from the parsed body and hands them straight to this
// method — there is no other holder of them to surprise. Copying two
// slices per request to avoid a side effect nobody can observe would be
// pure ceremony.
func (uc *Usecase) Push(ctx context.Context, userID uuid.UUID, progress []ProgressRow, annotations []AnnotationRow) (int, error) {
	for _, p := range progress {
		if p.CourseID == "" || p.ChapterID == "" || p.Status == "" || p.UpdatedAt.IsZero() {
			return 0, fmt.Errorf("%w: progress item (course=%q chapter=%q status=%q) missing a required field", ErrInvalidBatch, p.CourseID, p.ChapterID, p.Status)
		}
	}
	for _, a := range annotations {
		if a.ID == uuid.Nil || a.CourseID == "" || a.ChapterID == "" || a.CreatedAt.IsZero() || a.UpdatedAt.IsZero() {
			return 0, fmt.Errorf("%w: annotation item (id=%s) missing a required field", ErrInvalidBatch, a.ID)
		}
	}

	if len(progress) == 0 && len(annotations) == 0 {
		return 0, nil
	}

	// One `now` for the whole batch, read after validation and before any
	// database work: two items in the same request must not be clamped to
	// two different instants just because the loop took a moment.
	now := time.Now().UTC()
	for i := range progress {
		progress[i].UpdatedAt = clampFuture(progress[i].UpdatedAt, now)
	}
	for i := range annotations {
		annotations[i].UpdatedAt = clampFuture(annotations[i].UpdatedAt, now)
	}

	return uc.repo.PushBatch(ctx, userID, progress, annotations)
}

// clampFuture returns t, or now if t is after now. One-sided on purpose.
//
// Why the future must be clamped: `updated_at` arrives from the CLIENT
// (handler.go parses it out of the request body) and is then the sole
// input to Pull's returned cursor, which every one of that user's devices
// polls with. A single device whose clock runs more than SyncSafetyLag
// (60s) fast therefore poisons the watermark for ALL of that user's
// devices at once: it pushes a row stamped, say, an hour ahead, Pull hands
// back `thatTime - 60s` as the cursor, and every row written afterwards
// with a CORRECT timestamp falls below that cursor and is never delivered
// to anyone — silently, with no error anywhere, until wall-clock time
// catches up an hour later. The safety lag was never meant to absorb this;
// it is sized for commit-ordering jitter (milliseconds), not for clock
// skew (unbounded). A wrong clock is a mundane environmental fault — a
// flat CMOS battery, a phone with automatic time off, a VM resuming from
// suspend — not an attack, and it must not be able to stop this user's
// sync.
//
// Why the PAST must NOT be clamped: past-dated timestamps are load-bearing
// and correct. `setProgress` (apps/web/src/db/local.ts) stamps an edit at
// the instant it happens, deliberately NOT when the outbox eventually
// flushes, so that a device that was offline for an hour does not have its
// hour-old edit dishonestly beat a genuinely newer edit made elsewhere in
// the meantime. Clamping the past — or, worse, replacing every timestamp
// with `now` — would break last-write-wins for exactly the offline case
// the whole design exists to support. And a past-dated row cannot poison
// anything: Pull's cursor already floors at the caller's own `since`, so a
// row older than the watermark can only ever cause a harmless re-delivery,
// never a skip.
func clampFuture(t, now time.Time) time.Time {
	if t.After(now) {
		return now
	}
	return t
}

// Package stats implements the two events/dashboard endpoints named in the
// task brief: POST /events/batch (heartbeat ingestion) and GET /stats
// (study-time, streak, and 30-day chart for the dashboard). Unlike auth
// and sync, this package has deliberately no usecase.go — the brief's own
// file list is {handler.go, repo.go, stats_test.go}: the one piece of
// business logic here (streak / 30-day-window computation) is pure,
// side-effect-free Go arithmetic over rows repo.go already fetched, not a
// persistence rule or a validation policy that warrants its own layer.
// repo.go remains the only file in this package that speaks SQL.
package stats

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// EventRow is the subset of an events row this package writes. UserID is
// deliberately absent — it is passed as a separate argument to
// InsertEvents (see handler.go's EventsBatch, which always supplies
// auth.UID(c), never client input), the same isolation pattern
// internal/sync's ProgressRow/AnnotationRow use.
type EventRow struct {
	CourseID  string
	ChapterID string
	Kind      string
	Meta      json.RawMessage
	At        time.Time
}

// DayCount is one (Vietnam calendar day, heartbeat count) pair, as
// returned by HeartbeatDayCounts. Day is formatted "YYYY-MM-DD", already
// bucketed to Vietnam's fixed UTC+7 offset by dayBucketExpr below.
type DayCount struct {
	Day   string
	Count int64
}

// CourseCount is one (course, heartbeat count) pair, as returned by
// HeartbeatCourseCounts.
type CourseCount struct {
	CourseID string
	Count    int64
}

// Repo is the SQL-backed persistence layer for stats. It holds no business
// rules — every method is a direct, single-purpose query; streak logic and
// response shaping live in handler.go.
type Repo struct {
	pool *pgxpool.Pool
}

// NewRepo builds a Repo over pool.
func NewRepo(pool *pgxpool.Pool) *Repo {
	return &Repo{pool: pool}
}

// dayBucketExpr shifts a timestamptz by Vietnam's fixed UTC+7 offset
// before truncating to a calendar day, expressed only via interval
// arithmetic and the always-available "UTC" zone name — deliberately
// never a named zone like "Asia/Ho_Chi_Minh". This matters because the
// API's runtime image is FROM scratch (see apps/api/Dockerfile): it ships
// no tzdata at all, so a named-zone lookup would work in local dev/CI
// (where a system zoneinfo database happens to be present) and then
// either fail or silently misbehave in production, where none exists.
// Vietnam has used a constant UTC+7 offset with no DST since 1975, so a
// fixed 7-hour shift is not an approximation — it is exactly correct for
// every instant, with zero external dependency. This must stay
// numerically identical to handler.go's icTZ (time.FixedZone(7h)), which
// performs the equivalent shift on the Go side when computing "today" and
// the streak.
const dayBucketExpr = `date_trunc('day', (at + interval '7 hours') AT TIME ZONE 'UTC')::date`

// insertEventSQL is idempotent by construction against the scenario this
// task's binding requirements name — a client outbox retrying a batch that
// already landed (e.g. the request succeeded server-side but the response
// was lost): the WHERE NOT EXISTS guard keys on (user_id, course_id,
// chapter_id, kind, at), so replaying an identical row a second time
// matches zero new rows and affects nothing. meta is deliberately NOT
// part of that key — two heartbeats for the same chapter at the exact
// same instant are, for this app's purposes, the same event regardless of
// incidental metadata.
//
// This is an application-level guard (a query predicate), not a database
// uniqueness constraint — a truly concurrent (not sequential-retry) double
// POST of the same row could in principle race past the NOT EXISTS check
// on two separate connections before either commits, inserting both. That
// residual risk is accepted here: heartbeats are low-stakes analytics
// data, not billing or security state, and the realistic failure mode
// this guards against — a single client's serial retry-after-timeout — is
// exactly sequential, not concurrent. See InsertEvents's doc comment for
// the fuller reasoning and stats_test.go's "idempotent replay" case.
const insertEventSQL = `
INSERT INTO events (user_id, course_id, chapter_id, kind, meta, at)
SELECT $1, $2, $3, $4, $5, $6
WHERE NOT EXISTS (
  SELECT 1 FROM events
  WHERE user_id = $1 AND course_id = $2 AND chapter_id = $3 AND kind = $4 AND at = $6
);
`

// InsertEvents writes every row in events under userID's identity, inside
// one transaction (mirroring internal/sync's PushBatch: either the whole
// batch commits or none of it does), and returns how many rows were
// actually newly written — see insertEventSQL's doc comment for why a
// replayed row affects zero rows and is not counted, which is what makes
// retrying an identical batch safe.
func (r *Repo) InsertEvents(ctx context.Context, userID uuid.UUID, events []EventRow) (int, error) {
	if len(events) == 0 {
		return 0, nil
	}

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("stats: begin insert events transaction: %w", err)
	}
	// Rollback is a no-op once Commit has succeeded (pgx tracks tx state
	// and returns pgx.ErrTxClosed, ignored here); this defer only matters
	// on an early return, guaranteeing the transaction never sits open
	// holding partial work.
	defer func() { _ = tx.Rollback(ctx) }()

	inserted := 0
	for _, e := range events {
		tag, err := tx.Exec(ctx, insertEventSQL, userID, e.CourseID, e.ChapterID, e.Kind, e.Meta, e.At)
		if err != nil {
			return 0, fmt.Errorf("stats: insert event (course=%s chapter=%s kind=%s): %w", e.CourseID, e.ChapterID, e.Kind, err)
		}
		inserted += int(tag.RowsAffected())
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("stats: commit insert events transaction: %w", err)
	}
	return inserted, nil
}

// HeartbeatDayCounts returns, for every Vietnam calendar day (bucketed per
// dayBucketExpr) on which userID has at least one kind='heartbeat' event,
// the number of heartbeats recorded that day. It is deliberately
// unbounded in time, not just the last 30 days: handler.go's streak
// computation needs to walk arbitrarily far back to find the break, and
// this single query serves both that and the 30-day chart (handler.go
// zero-fills and truncates to the last 30 days from this same result).
// Only kind='heartbeat' events are counted — heartbeats are the only
// event kind this task's binding requirements define a minutes conversion
// for; other kinds (should any exist in the future) are stored via
// InsertEvents but do not contribute to study time here.
func (r *Repo) HeartbeatDayCounts(ctx context.Context, userID uuid.UUID) ([]DayCount, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT `+dayBucketExpr+` AS day, count(*) AS n
		 FROM events
		 WHERE user_id = $1 AND kind = 'heartbeat'
		 GROUP BY 1
		 ORDER BY 1`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("stats: heartbeat day counts: %w", err)
	}
	defer rows.Close()

	out := []DayCount{}
	for rows.Next() {
		var day time.Time
		var n int64
		if err := rows.Scan(&day, &n); err != nil {
			return nil, fmt.Errorf("stats: scan day count row: %w", err)
		}
		out = append(out, DayCount{Day: day.Format("2006-01-02"), Count: n})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("stats: heartbeat day counts: %w", err)
	}
	return out, nil
}

// HeartbeatCourseCounts returns, for every course userID has at least one
// kind='heartbeat' event in, the total number of heartbeats recorded for
// that course across all time (not just the last 30 days — see
// handler.go's Stats for why totalMinutes and courses[].minutes are both
// lifetime sums, distinct from the 30-day days[] chart).
func (r *Repo) HeartbeatCourseCounts(ctx context.Context, userID uuid.UUID) ([]CourseCount, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT course_id, count(*) AS n
		 FROM events
		 WHERE user_id = $1 AND kind = 'heartbeat'
		 GROUP BY course_id
		 ORDER BY course_id`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("stats: heartbeat course counts: %w", err)
	}
	defer rows.Close()

	out := []CourseCount{}
	for rows.Next() {
		var c CourseCount
		if err := rows.Scan(&c.CourseID, &c.Count); err != nil {
			return nil, fmt.Errorf("stats: scan course count row: %w", err)
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("stats: heartbeat course counts: %w", err)
	}
	return out, nil
}

// CompletedChaptersByCourse returns, for every course userID has at least
// one completed chapter in, the count of distinct chapters marked
// complete.
//
// "Complete" means a progress row with status='read' AND done=true — the
// row sync's client writes for the per-chapter "Đã học" ("studied")
// button (see the platform spec's progress.status comment: 'read' |
// exercise key). Exercise-status rows (status='ex:<n>') are deliberately
// excluded: they track per-exercise checkboxes, not chapter completion.
// done=false rows are excluded too — that is the user un-marking a
// chapter, and must not still count. Both exclusions are safe as a plain
// AND filter, not something requiring "latest write wins" logic here:
// progress's real primary key is (user_id, course_id, chapter_id,
// status), so at most one row can exist for status='read' on a given
// chapter, and that row's done column already reflects whichever write
// most recently won the sync package's own LWW rule.
//
// Per ruling F5, this is a secondary display count, not the dashboard's
// source of truth for a completion percentage — deliberately not divided
// by any chapter total, since course content (and therefore a course's
// total chapter count) never lives in this database.
func (r *Repo) CompletedChaptersByCourse(ctx context.Context, userID uuid.UUID) (map[string]int64, error) {
	rows, err := r.pool.Query(ctx,
		`SELECT course_id, count(DISTINCT chapter_id) AS n
		 FROM progress
		 WHERE user_id = $1 AND status = 'read' AND done = true
		 GROUP BY course_id`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("stats: completed chapters by course: %w", err)
	}
	defer rows.Close()

	out := map[string]int64{}
	for rows.Next() {
		var courseID string
		var n int64
		if err := rows.Scan(&courseID, &n); err != nil {
			return nil, fmt.Errorf("stats: scan completed chapters row: %w", err)
		}
		out[courseID] = n
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("stats: completed chapters by course: %w", err)
	}
	return out, nil
}

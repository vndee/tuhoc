// Package rating owns star ratings for courses published on the registry:
// one vote per person per course, editable. This file is the persistence
// layer and, following internal/course's split, is the only place here
// that speaks SQL.
//
// Two rules in this file are load-bearing and easy to undo by accident,
// and both are copied deliberately from internal/course rather than
// reinvented — that shape was reviewed, mutated, and measured, and this
// one has the same threat model:
//
//  1. user_id is part of the table's PRIMARY KEY, and it is always an
//     ARGUMENT of the method, never a field of a value being written.
//     There is no second way to say who is voting, so a request body that
//     names a user cannot reach a row. internal/course's own comment
//     records what happened when that was true of the comment but not of
//     the code: an attacker who declared the victim's id in a struct field
//     overwrote the victim's row whole, err=<nil>.
//
//  2. Nothing in this package can enumerate. There is no "every rating"
//     query and no "which courses have ratings" query, and adding one is
//     not a small convenience — see Aggregates.
package rating

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Aggregate is what one course's ratings look like to a caller: the
// numbers, and the caller's own vote. There is deliberately NO field that
// could carry a voter's identity.
//
// That absence is the privacy rule expressed as a type. A handler cannot
// leak who voted by forgetting to strip a field, because there is no
// field: it would have to add one, which is a visible change to a struct
// whose doc comment says not to. The alternative shape — returning []Rating
// and trusting every caller to aggregate before serialising — puts the
// identities one forgotten .map() away from the wire.
type Aggregate struct {
	RegistryID string
	// Average is the mean of Stars over Count votes. Meaningless when
	// Count is 0, and set to 0 there.
	Average float64
	// Count is how many people have voted. It travels WITH Average and
	// must be displayed with it: 5.0 from one vote and 5.0 from two
	// hundred are the same number and not the same fact.
	Count int
	// Mine is the calling user's own vote, or 0 if they have not voted.
	// It comes from the userID argument passed to Aggregates — the
	// authenticated session — and from nothing else.
	Mine int
}

// Repo is the storage interface the layers above depend on. Both methods
// take userID as their own argument rather than reading it out of a value,
// so a handler physically cannot pass a caller-supplied identity by
// forgetting to overwrite one: the identity comes from the authenticated
// session at the call site, in the open. Same shape as course.Repo and
// sync.Repo.PushBatch, for the same reason.
type Repo interface {
	// Put stores userID's vote of stars on registryID, replacing that
	// user's previous vote if there is one.
	Put(ctx context.Context, userID uuid.UUID, registryID string, stars int) error
	// Aggregates returns one Aggregate per requested id, including ids
	// nobody has rated (Count 0). Mine is userID's own vote.
	Aggregates(ctx context.Context, userID uuid.UUID, registryIDs []string) ([]Aggregate, error)
	// CountForUser returns how many distinct courses userID has rated.
	CountForUser(ctx context.Context, userID uuid.UUID) (int, error)
}

// PostgresRepo is the Postgres-backed Repo. Like internal/course's it
// holds no business rules: no star-range check beyond the schema's own
// CHECK, no id validation, no per-user cap. Those belong to the layer
// above, which can refuse a request before it reaches storage.
type PostgresRepo struct {
	pool *pgxpool.Pool
}

// Compile-time proof that the concrete type satisfies the interface the
// HTTP layer depends on, so a signature drift is a build error here rather
// than a confusing failure elsewhere.
var _ Repo = (*PostgresRepo)(nil)

// NewRepo builds a PostgresRepo over pool.
func NewRepo(pool *pgxpool.Pool) *PostgresRepo {
	return &PostgresRepo{pool: pool}
}

// upsertRatingSQL replaces the voter's own previous vote rather than
// rejecting it: changing your mind about a course is an ordinary thing to
// do, not an error worth surfacing.
//
// The safety of DO UPDATE rests entirely on the conflict target being the
// FULL primary key, user_id included. A row can only conflict with a row
// that already has the same user_id, because user_id is part of the
// identity Postgres uses to detect the conflict: (A, courseX) and
// (B, courseX) are simply different keys. One person's vote therefore
// cannot overwrite another's.
//
// $1 is Put's userID argument, the authenticated caller — never a value
// that arrived in a request.
//
// created_at is absent from the SET clause on purpose: it records when
// this person first voted, and editing a vote does not change that.
// updated_at is set explicitly because a column DEFAULT applies only on
// INSERT.
const upsertRatingSQL = `
INSERT INTO course_ratings (user_id, registry_id, stars)
VALUES ($1,$2,$3)
ON CONFLICT (user_id, registry_id) DO UPDATE
SET stars = EXCLUDED.stars, updated_at = now();
`

// Put records userID's vote. A previous vote by the same user on the same
// course is replaced; a vote by anybody else is untouched and unreachable.
func (r *PostgresRepo) Put(ctx context.Context, userID uuid.UUID, registryID string, stars int) error {
	_, err := r.pool.Exec(ctx, upsertRatingSQL, userID, registryID, stars)
	if err != nil {
		return fmt.Errorf("rating: put (user=%s registry=%s): %w", userID, registryID, err)
	}
	return nil
}

// aggregateSQL computes, for the requested ids only, the numbers a catalog
// needs plus the caller's own vote.
//
// `WHERE registry_id = ANY($2)` is the whole privacy design in one clause,
// and it is why there is no variant of this query without it. The server
// never answers "which courses have ratings" — it answers only about ids
// the caller already named, and those come from the PUBLIC registry index
// the client fetched. A vote cast on a private course id, or on an id
// somebody invented, is therefore inert: it is stored, and it can never
// appear in a listing shown to anyone who did not already possess that id.
// Replace this with a plain GROUP BY over the whole table and every
// private course anyone ever rated becomes enumerable.
//
// MAX(stars) FILTER (WHERE user_id = $1) is exact rather than approximate:
// the primary key allows at most one row per (user, course), so the filter
// selects at most one value. COALESCE turns "this user has not voted" into
// 0, which the wire format documents as "no vote".
//
// AVG returns numeric; the ::float8 cast is what lets it scan into a Go
// float64 rather than failing at the driver.
const aggregateSQL = `
SELECT registry_id,
       AVG(stars)::float8,
       COUNT(*),
       COALESCE(MAX(stars) FILTER (WHERE user_id = $1), 0)
FROM course_ratings
WHERE registry_id = ANY($2)
GROUP BY registry_id;
`

// Aggregates returns one Aggregate per id in registryIDs, in that order,
// including ids nobody has rated yet.
//
// Returning a row for every REQUESTED id — not only for ids that have
// rows — matters to the caller: a catalog needs to render every course,
// and "no ratings yet" is an answer, not an omission. It also means the
// response shape carries no information about which ids exist in the
// table, which is the same non-enumeration property aggregateSQL protects.
//
// Duplicate ids in the request collapse to one entry each; the GROUP BY
// would return one row regardless, and answering twice would only invite a
// caller to build a map and silently overwrite.
func (r *PostgresRepo) Aggregates(ctx context.Context, userID uuid.UUID, registryIDs []string) ([]Aggregate, error) {
	found := map[string]Aggregate{}

	if len(registryIDs) > 0 {
		rows, err := r.pool.Query(ctx, aggregateSQL, userID, registryIDs)
		if err != nil {
			return nil, fmt.Errorf("rating: aggregates for user %s: %w", userID, err)
		}
		defer rows.Close()

		for rows.Next() {
			var a Aggregate
			if err := rows.Scan(&a.RegistryID, &a.Average, &a.Count, &a.Mine); err != nil {
				return nil, fmt.Errorf("rating: scan aggregate row: %w", err)
			}
			found[a.RegistryID] = a
		}
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("rating: aggregates for user %s: %w", userID, err)
		}
	}

	out := make([]Aggregate, 0, len(registryIDs))
	seen := map[string]bool{}
	for _, id := range registryIDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		if a, ok := found[id]; ok {
			out = append(out, a)
			continue
		}
		out = append(out, Aggregate{RegistryID: id})
	}
	return out, nil
}

// CountForUser reports how many distinct courses userID has rated. It
// exists for the per-user cap in usecase.go — see MaxRatingsPerUser for
// why an endpoint like this one needs a bound at all.
func (r *PostgresRepo) CountForUser(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx,
		`SELECT count(*) FROM course_ratings WHERE user_id = $1`, userID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("rating: count for user %s: %w", userID, err)
	}
	return n, nil
}

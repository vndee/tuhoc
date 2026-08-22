package rating

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
)

// MinStars and MaxStars are what "a star rating" means, not a tunable
// policy. The schema carries the same range as a CHECK constraint; that is
// not a duplicated policy number but a second lock on a value the
// arithmetic downstream depends on — one row outside it silently falsifies
// every AVG.
const (
	MinStars = 1
	MaxStars = 5
)

// MaxRegistryIDBytes bounds a registry id.
//
// The number is derived, not invented: a registry id IS a directory name
// in the registry repository (tools/registry/src/tree.ts takes the id from
// basename(courseDir) and refuses a package whose manifest.id disagrees),
// and a path segment is at most 255 bytes on every filesystem this repo
// could be cloned onto. So no real registry id can exceed it, and nothing
// legitimate is refused.
const MaxRegistryIDBytes = 255

// MaxIDsPerQuery bounds one GET /ratings request.
//
// It is a bound on work, not on the catalog: the whole registry is
// expected to hold a few dozen courses, so 500 is generous by more than an
// order of magnitude while still turning "ask about unlimited ids" into a
// bounded query. A client with more courses than this pages; the
// alternative is one request that builds an arbitrarily large array
// parameter and one query that scans it.
const MaxIDsPerQuery = 500

// MaxRatingsPerUser bounds how many distinct courses one account may rate.
//
// This is NOT in the plan, and it is here because of a hole the plan's
// schema leaves open: registry_id has no foreign key (the registry is not
// in this database — see the migration), so without a cap an authenticated
// account can write an unbounded number of rows by inventing ids. There is
// no delete endpoint to reclaim them. That is the same shape as the defect
// a review measured in internal/course, where Bytes = 5 GiB was stored
// happily because no layer enforced a ceiling.
//
// 500 is far beyond any honest use — it is more courses than the registry
// is ever likely to hold — so it never obstructs a real reader, and it
// turns "unbounded" into "bounded".
//
// What it is NOT: a race-free quota. Two concurrent Puts can both observe
// count = 499 and both insert. It bounds growth; it does not pin the
// number exactly, and pretending otherwise would need a constraint the
// schema cannot express cheaply.
const MaxRatingsPerUser = 500

// ErrInvalidRating is the class of "the request can never work" — a star
// value outside the range, or a registry id that is not a well-formed id.
// Wrapped in an InvalidRatingError carrying a Reason written from fixed
// phrases in this file, never by a driver, so the HTTP layer can return it
// to the caller safely.
var ErrInvalidRating = errors.New("rating: invalid rating")

// ErrTooManyRatings is returned when the caller has reached
// MaxRatingsPerUser and is trying to rate a course they have not rated
// before. Editing an existing vote is always allowed — otherwise a user at
// the cap could never correct a mistake, the same "no way to get unstuck"
// trap internal/course's UsedBytesExcluding exists to avoid.
var ErrTooManyRatings = errors.New("rating: too many rated courses")

// InvalidRatingError carries the human-readable half of ErrInvalidRating.
type InvalidRatingError struct {
	Reason string
}

func (e *InvalidRatingError) Error() string { return "rating: " + e.Reason }
func (e *InvalidRatingError) Unwrap() error { return ErrInvalidRating }

func invalid(format string, args ...any) error {
	return &InvalidRatingError{Reason: fmt.Sprintf(format, args...)}
}

// Usecase holds the rules: what a valid vote is, what a valid registry id
// is, and how many courses one account may rate. It owns no SQL and no
// HTTP concerns.
type Usecase struct {
	repo Repo
}

// NewUsecase builds a Usecase over repo.
func NewUsecase(repo Repo) *Usecase {
	return &Usecase{repo: repo}
}

// Rate validates and stores userID's vote.
//
// userID is the FIRST parameter and comes from the authenticated session
// at the call site. rawRegistryID is whatever arrived in the URL path,
// still percent-encoded.
func (u *Usecase) Rate(ctx context.Context, userID uuid.UUID, rawRegistryID string, stars int) error {
	registryID, err := RegistryID(rawRegistryID)
	if err != nil {
		return err
	}
	if stars < MinStars || stars > MaxStars {
		return invalid("stars must be between %d and %d, got %d", MinStars, MaxStars, stars)
	}

	// Checked before the write, and only for a course this user has not
	// already rated: an edit must always be possible.
	n, err := u.repo.CountForUser(ctx, userID)
	if err != nil {
		return err
	}
	if n >= MaxRatingsPerUser {
		existing, err := u.repo.Aggregates(ctx, userID, []string{registryID})
		if err != nil {
			return err
		}
		if len(existing) == 0 || existing[0].Mine == 0 {
			return fmt.Errorf("%w: %d courses already rated (limit %d)",
				ErrTooManyRatings, n, MaxRatingsPerUser)
		}
	}

	return u.repo.Put(ctx, userID, registryID, stars)
}

// List returns the aggregate for each requested id, plus the caller's own
// vote on each.
//
// It refuses an empty request rather than answering with everything, and
// that refusal IS the privacy barrier rather than an ergonomic choice —
// see the handler, and the migration, for the full reasoning. In short:
// there is no "all ratings" answer anywhere in this package, because such
// an answer would enumerate every course id anyone has ever rated,
// including private ones.
func (u *Usecase) List(ctx context.Context, userID uuid.UUID, rawIDs []string) ([]Aggregate, error) {
	if len(rawIDs) == 0 {
		return nil, invalid("name the courses you want ratings for; there is no listing of all rated courses")
	}
	if len(rawIDs) > MaxIDsPerQuery {
		return nil, invalid("at most %d course ids per request, got %d", MaxIDsPerQuery, len(rawIDs))
	}

	ids := make([]string, 0, len(rawIDs))
	for _, raw := range rawIDs {
		id, err := RegistryID(raw)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return u.repo.Aggregates(ctx, userID, ids)
}

// RegistryID decodes and validates one registry course id.
//
// The unescape happens FIRST and is not optional. Fiber's UnescapePath is
// off, so "%2f" arrives as those three literal characters — a string that
// contains no slash at all until it is decoded, and would sail past a
// check applied to the raw form. internal/course measured exactly this
// against this fiber version (see its assetName/pathSafeParam and
// TestGetAssetCannotEscapePackage); the same trap is here and the same
// order of operations avoids it.
//
// What is checked is what a registry id STRUCTURALLY is — one path
// segment naming a directory in the registry repo — and nothing more. It
// deliberately does NOT impose a character set the registry itself does
// not impose: a scheme invented here would either drift from the registry's
// rule or reject a legitimate course, which is the "one rule, three copies,
// disagreeing on 7 of 12 rows" failure this project has already paid for.
//
// It also cannot check that the id names a REAL registry course; nothing
// in this API can, because the API never fetches the registry index. That
// gap is closed by never enumerating rather than by validating harder.
func RegistryID(raw string) (string, error) {
	id, err := url.PathUnescape(raw)
	if err != nil {
		return "", invalid("the course id is not valid percent-encoding")
	}
	if id == "" {
		return "", invalid("the course id is empty")
	}
	if len(id) > MaxRegistryIDBytes {
		return "", invalid("the course id is longer than %d bytes", MaxRegistryIDBytes)
	}
	if !utf8.ValidString(id) {
		return "", invalid("the course id is not valid UTF-8")
	}
	// A registry id is a directory name. None of these can be one, and
	// each would also produce links that address something other than what
	// they name.
	if id == "." || id == ".." {
		return "", invalid("%q is not a course id", id)
	}
	if strings.ContainsAny(id, `/\`) || strings.Contains(id, "\x00") {
		return "", invalid("the course id %q cannot appear in a URL path", id)
	}
	if strings.TrimSpace(id) != id {
		return "", invalid("the course id has leading or trailing whitespace")
	}
	return id, nil
}

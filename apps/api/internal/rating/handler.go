package rating

import (
	"errors"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/vndee/tuhoc-api/internal/apilog"
	"github.com/vndee/tuhoc-api/internal/auth"
)

// Handler owns the HTTP-layer concerns for ratings: parsing requests,
// shaping responses, and status codes. It holds no SQL (repo.go) and no
// rules (usecase.go).
//
// Two rules outrank the rest here, and both are worth stating where they
// can be seen:
//
//  1. The voter is auth.UID(c) — the id auth.Require put in the request's
//     locals after validating the session cookie — and NOTHING else. Not a
//     body field, not a query parameter, not a header. Repo.Put takes the
//     user as an argument precisely so this decision is made in the open at
//     the call site (ruling S1-F12); the argument is only as good as what
//     is passed to it, and this file is what passes it.
//
//  2. No route here enumerates. GET /ratings answers about the ids the
//     caller named and refuses to answer about "everything" — see List.
type Handler struct {
	uc *Usecase
}

// NewHandler builds a Handler over uc.
func NewHandler(uc *Usecase) *Handler {
	return &Handler{uc: uc}
}

// putRequest is PUT /ratings/:registryId's body. It has exactly one field,
// and that is the point: there is no user_id to bind, no registry_id to
// disagree with the URL, and therefore nothing in the body that can steer
// which row is written. A field added here is a field a client controls.
type putRequest struct {
	Stars int `json:"stars"`
}

// ratingResponse is GET /ratings's wire shape, one per requested course.
//
// It carries no voter identity, and it never will: rating.Aggregate — the
// type it is built from — has no field that could hold one. Anyone adding
// a "voters" or "ratedBy" field has to change two types whose comments
// both say not to, which is the difference between a mistake and a
// decision.
//
// Count travels with Average because the two are one fact. 5.0 from one
// vote and 5.0 from two hundred are the same number and not the same
// information, and a catalog that sorts on the average alone puts the
// first above the second.
//
// Mine is the caller's own vote, 0 when they have not voted. It is the
// only per-person value in this response and it is the caller's own.
type ratingResponse struct {
	ID      string  `json:"id"`
	Average float64 `json:"average"`
	Count   int     `json:"count"`
	Mine    int     `json:"mine"`
}

// Put handles PUT /ratings/:registryId.
//
// The voter is auth.UID(c). Any user id the request carries — in the body,
// in the query string, in a header — is not read here, which is a stronger
// property than being read and overwritten: there is no variable for it to
// land in. TestPostIgnoresClientSuppliedUserID sends all three at once.
func (h *Handler) Put(c *fiber.Ctx) error {
	var req putRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "body must be JSON of the form {\"stars\": 1..5}",
		})
	}

	err := h.uc.Rate(c.Context(), auth.UID(c), c.Params("registryId"), req.Stars)
	switch {
	case errors.Is(err, ErrInvalidRating):
		// The reason is written by usecase.go from fixed phrases (see
		// InvalidRatingError), never by a driver, so it is safe to return.
		var reason *InvalidRatingError
		detail := ""
		if errors.As(err, &reason) {
			detail = reason.Reason
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":  "invalid rating",
			"detail": detail,
		})
	case errors.Is(err, ErrTooManyRatings):
		// 507, not 400: the vote is well formed and the account simply
		// holds too many. Same distinction internal/course draws between
		// "this package is too big" and "this library is full", and the
		// numbers in the detail are the caller's own.
		return c.Status(fiber.StatusInsufficientStorage).JSON(fiber.Map{
			"error":  "too many rated courses",
			"detail": err.Error(),
		})
	case err != nil:
		apilog.Internal(c, "rating.Put", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "rating failed"})
	}

	return c.SendStatus(fiber.StatusNoContent)
}

// List handles GET /ratings?ids=a,b,c.
//
// # WHY IT REFUSES A REQUEST WITH NO IDS, INSTEAD OF ANSWERING WITH ALL OF THEM
//
// Ratings exist only for courses published on the registry. Nothing in
// this API can verify that, because the API never fetches the registry
// index. So a vote can be stored against any id a client sends, including
// the id of a course that is private or was imported from a file.
//
// This used to read "apps/api product code makes no outbound calls at all,
// a promise enforced by internal/server/no_key_transit_test.go". Neither
// half survived Pha 2: that file was deleted at Task 11, and apps/api now
// calls DeepSeek, Brave and GitHub. The premise this handler depends on is
// only the narrow one — NOTHING READS THE REGISTRY INDEX — and it holds
// because no code does it, not because a gate forbids it.
//
// That is harmless for exactly as long as no route enumerates. The ids
// this endpoint answers about are ids the caller already had — they come
// from the PUBLIC registry index the web client fetched — so a rating on a
// private id is inert: stored, and invisible to anyone who did not already
// possess the id. Add an "all ratings" or "top rated" answer here and
// every private course anyone has rated becomes enumerable, which is the
// privacy barrier the plan states as a global constraint.
//
// So a missing ids parameter is a 400 with a sentence explaining that,
// rather than an empty array. An empty array would be indistinguishable
// from "nobody has rated anything" and would quietly invite somebody to
// "fix" it later by returning everything.
func (h *Handler) List(c *fiber.Ctx) error {
	items, err := h.uc.List(c.Context(), auth.UID(c), splitIDs(c.Query("ids")))
	switch {
	case errors.Is(err, ErrInvalidRating):
		var reason *InvalidRatingError
		detail := ""
		if errors.As(err, &reason) {
			detail = reason.Reason
		}
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error":  "invalid ratings query",
			"detail": detail,
		})
	case err != nil:
		apilog.Internal(c, "rating.List", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "ratings lookup failed"})
	}

	// make(..., len) and not a nil slice: encoding/json turns a nil slice
	// into `null`, and a client calling .map() on the response would throw.
	out := make([]ratingResponse, len(items))
	for i, a := range items {
		out[i] = ratingResponse{
			ID:      a.RegistryID,
			Average: a.Average,
			Count:   a.Count,
			Mine:    a.Mine,
		}
	}
	return c.Status(fiber.StatusOK).JSON(out)
}

// splitIDs turns the comma-separated ids parameter into a slice, dropping
// empty segments so "a,,b" and a trailing comma are not errors about
// punctuation. Whitespace is NOT trimmed: a registry id with a leading
// space is refused by RegistryID with a message that says so, and trimming
// here would silently accept an id that is not the id the caller wrote.
func splitIDs(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

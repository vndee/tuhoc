// This package is dead code on a schedule, not dead code.
//
// Pha 3 replaced the old cursor+outbox sync protocol (GET/POST /sync) with
// plain REST resources — GET/PUT /progress (internal/userdata, Task 1) and
// the four /annotations verbs (internal/userdata, Task 2) — because the
// browser is no longer local-first. Every new read and write in the web
// client goes through those instead. GET /sync itself is deleted (Pha 3
// Task 3): there is no client left that calls it.
//
// POST /sync survives on purpose. An upgrading browser flushes its old
// offline outbox through it exactly once, before deleting its own local
// database, and that flush is the only thing standing between a learner's
// unsent work and silent loss — so this package stays alive to receive it.
//
// The condition for deleting this package: zero POST /sync requests
// recorded in apilog over 30 consecutive days. That is a scheduling
// decision, not a code change — once every upgrading browser has had its
// one-time flush window, there is nothing left calling this route and it
// can be removed the same way GET /sync was cut here.
//
// What that schedule does NOT cover, stated plainly rather than glossed
// over: a user who does not open the upgraded app within that 30-day
// window loses whatever sat unflushed in their local outbox. That is a
// known, accepted hole — closed by CHOOSING WHEN this package is safe to
// delete (a wide enough margin that any real user has shown up at least
// once), not by anything this code does. See docs/carried-forward.md for
// the fuller accounting of what Pha 3 carries forward.
package sync

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	"github.com/vndee/tuhoc-api/internal/apilog"
	"github.com/vndee/tuhoc-api/internal/auth"
)

// timeLayout is the wire format for every timestamp this package reads or
// writes: RFC3339Nano. time.Parse with this exact layout constant gets
// Go's dedicated RFC3339 fast path, which accepts any number of fractional
// digits (including none) and any valid zone offset — so a client sending
// "2026-08-19T10:00:00Z" (second precision) or
// "2026-08-19T10:00:00.123456789+07:00" (nanosecond precision, non-UTC
// zone) both parse correctly into the same kind of time.Time, and are
// compared as absolute instants everywhere downstream (Go's time.Time
// comparisons and Postgres timestamptz alike) — never as strings. Output
// is always normalized to UTC before formatting, purely for readability;
// it carries no correctness meaning (an equivalent-instant, differently-
// zoned string would compare identically wherever it matters).
const timeLayout = time.RFC3339Nano

// MaxPushBytes is the ceiling on POST /sync's request body, applied as a
// route-scoped middleware in internal/server rather than as fiber's
// app-wide BodyLimit.
//
// It restores what this endpoint always had. fiber's default BodyLimit is
// 4 MiB and /sync inherited it, until POST /courses needed a 21 MiB
// ceiling for course packages — and fiber v2's BodyLimit is an APP
// setting, so raising it for one route raised it for every route. A
// review measured the consequence for this one: the number of progress
// items a single request could carry went from ~39 303 to ~204 919, a
// 5.21× widening of an endpoint that had nothing to do with the change.
//
// 4 MiB is not a number this handler needs; it is the number it had. The
// bound that matters for the work this handler does is MaxItemsPerPush.
const MaxPushBytes int64 = 4 << 20

// MaxItemsPerPush is the ceiling on progress + annotations in ONE request.
//
// A byte limit cannot stand in for it. An item can be shrunk far below
// its realistic size (an object carrying nothing but a parseable
// updatedAt is under 40 bytes), so the number of items a body can hold is
// not a function of the body's size — a review's own arithmetic put
// ~39 303 realistic items in 4 MiB, and the floor is several times that.
// Each item is one tx.Exec inside a SINGLE transaction (see
// Repo.PushBatch), holding one of the pool's 4–8 connections for the
// duration, while every other route needs that pool just to validate a
// session cookie. This is the bound on that, and the byte limit above is
// the bound on the ~20× RAM amplification BodyParser costs.
//
// The number is chosen against the client, not against an attacker: the
// web client (apps/web/src/sync/engine.ts) sends its WHOLE outbox in one
// request with no chunking, so a cap it can exceed strands a long-offline
// device permanently — it would 413 forever and never drain. 10 000
// items is over 80 hours of continuous active reading at one heartbeat
// per 30 s, far beyond any realistic offline window. Lowering it is a
// client change first (chunked flushes), a server change second; that
// pairing is recorded in docs/carried-forward.md.
const MaxItemsPerPush = 10000

// Handler holds the HTTP-layer concerns for sync: parsing requests,
// shaping responses, and status codes. It owns no SQL (that's repo.go) and
// no LWW/validation business rules (that's usecase.go).
type Handler struct {
	uc *Usecase
}

// NewHandler builds a Handler over uc.
func NewHandler(uc *Usecase) *Handler {
	return &Handler{uc: uc}
}

type progressItem struct {
	CourseID  string `json:"courseId"`
	ChapterID string `json:"chapterId"`
	Status    string `json:"status"`
	Done      bool   `json:"done"`
	UpdatedAt string `json:"updatedAt"`
}

type annotationItem struct {
	ID        string          `json:"id"`
	CourseID  string          `json:"courseId"`
	ChapterID string          `json:"chapterId"`
	Anchor    json.RawMessage `json:"anchor"`
	Note      string          `json:"note"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
	DeletedAt *string         `json:"deletedAt"`
}

type pushRequest struct {
	Progress    []progressItem   `json:"progress"`
	Annotations []annotationItem `json:"annotations"`
}

type pushResponse struct {
	Applied int `json:"applied"`
}

// Push handles POST /sync {"progress":[...],"annotations":[...]}. It is
// mounted behind auth.Require, so auth.UID(c) is always populated by the
// time this runs.
//
// Every progress/annotation item is parsed and validated before any
// database work happens (see the parse loop below and Usecase.Push's own
// validation): a malformed item anywhere in the batch rejects the whole
// request with 400 and zero side effects, rather than applying a prefix of
// the batch and failing partway through.
func (h *Handler) Push(c *fiber.Ctx) error {
	var req pushRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	// Before the per-item loop below, so an over-cap batch is never parsed
	// into rows, and before Usecase.Push, so it never opens a transaction.
	// The two arrays are counted together because they are written in ONE
	// transaction: what is being bounded is that transaction, not either
	// array on its own.
	if n := len(req.Progress) + len(req.Annotations); n > MaxItemsPerPush {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
			"error": fmt.Sprintf("a push carries at most %d items; this one has %d — send it in smaller batches", MaxItemsPerPush, n),
		})
	}

	progressRows := make([]ProgressRow, len(req.Progress))
	for i, item := range req.Progress {
		updatedAt, err := time.Parse(timeLayout, item.UpdatedAt)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid updatedAt in progress item: must be RFC3339Nano"})
		}
		progressRows[i] = ProgressRow{
			CourseID:  item.CourseID,
			ChapterID: item.ChapterID,
			Status:    item.Status,
			Done:      item.Done,
			UpdatedAt: updatedAt,
		}
	}

	annotationRows := make([]AnnotationRow, len(req.Annotations))
	for i, item := range req.Annotations {
		id, err := uuid.Parse(item.ID)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid id in annotation item: must be a uuid"})
		}
		createdAt, err := time.Parse(timeLayout, item.CreatedAt)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid createdAt in annotation item: must be RFC3339Nano"})
		}
		updatedAt, err := time.Parse(timeLayout, item.UpdatedAt)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid updatedAt in annotation item: must be RFC3339Nano"})
		}
		var deletedAt *time.Time
		if item.DeletedAt != nil {
			d, err := time.Parse(timeLayout, *item.DeletedAt)
			if err != nil {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid deletedAt in annotation item: must be RFC3339Nano"})
			}
			deletedAt = &d
		}

		annotationRows[i] = AnnotationRow{
			ID:        id,
			CourseID:  item.CourseID,
			ChapterID: item.ChapterID,
			Anchor:    item.Anchor,
			Note:      item.Note,
			CreatedAt: createdAt,
			UpdatedAt: updatedAt,
			DeletedAt: deletedAt,
		}
	}

	applied, err := h.uc.Push(c.Context(), auth.UID(c), progressRows, annotationRows)
	if err != nil {
		if errors.Is(err, ErrInvalidBatch) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid batch item"})
		}
		apilog.Internal(c, "sync.Push", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "sync push failed"})
	}

	return c.Status(fiber.StatusOK).JSON(pushResponse{Applied: applied})
}

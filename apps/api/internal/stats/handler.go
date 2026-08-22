package stats

import (
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/vndee/tuhoc-api/internal/apilog"
	"github.com/vndee/tuhoc-api/internal/auth"
)

// timeLayout is the wire format for the `at` timestamp this package
// reads, parsed via Go's dedicated RFC3339Nano fast path (accepts any
// fractional precision and any valid zone offset). This mirrors
// internal/sync's own timeLayout constant of the same name and purpose;
// it is deliberately redefined here rather than imported — sync does not
// export it, and duplicating one constant is cheaper than adding a shared
// internal package just to avoid it, matching this repo's existing
// convention of each handler package owning its own copy.
const timeLayout = time.RFC3339Nano

// icTZOffset is Vietnam's fixed UTC+7 offset, expressed as a Duration.
// This is the SINGLE source of truth for the day-boundary shift used
// throughout this package and in repo.go: icTZ (below) derives from it on
// the Go side, and Stats passes it to repo.go's HeartbeatDayCounts as a
// bound query parameter so the SQL-side bucketing derives from this exact
// same value instead of duplicating "7 hours" as an independent,
// hand-maintained literal — see repo.go's HeartbeatDayCounts doc comment
// for why that duplication was a real risk (the two would silently drift
// apart near midnight with no error, corrupting both the streak and the
// chart) and why a bound parameter, not a second hardcoded constant, is
// the fix.
//
// See Stats's doc comment for the reasoning behind choosing Vietnam-local
// time over UTC or the server host's own local time, and this package
// ships no tzdata dependency: the API's runtime image is FROM scratch
// (see apps/api/Dockerfile), so a named-zone lookup
// (time.LoadLocation("Asia/Ho_Chi_Minh"), or Postgres's
// "AT TIME ZONE 'Asia/Ho_Chi_Minh'") would work in dev/CI (where a system
// zoneinfo database happens to exist) and fail in production. Vietnam has
// used a constant UTC+7 offset with no DST since 1975, so a fixed 7-hour
// shift is exactly correct for every instant, with zero external
// dependency, in every environment including FROM scratch.
const icTZOffset = 7 * time.Hour

// icTZ is Vietnam's fixed UTC+7 offset as a time.Location, derived from
// icTZOffset. It is the single day-boundary definition this whole package
// uses for "today", "the last 30 days", and "streak".
var icTZ = time.FixedZone("ICT", int(icTZOffset.Seconds()))

// dateLayout is the wire format for every date in GET /stats's response
// (days[].date): a plain calendar date, no time component, matching the
// task brief's example ("2026-08-19").
const dateLayout = "2006-01-02"

// statsWindowDays is the fixed size of GET /stats's days[] array — the
// task's binding requirement ("`days`: the last 30 days"). See Stats's
// doc comment for why every one of these 30 entries is always present,
// zero-filled or not, rather than only the days with activity.
const statsWindowDays = 30

// minutesPerHeartbeat is the task's binding requirement: the client emits
// one heartbeat every 30 seconds while the user is actively reading, so
// each heartbeat represents exactly half a minute of study time. This is
// the only place that conversion happens.
const minutesPerHeartbeat = 0.5

// MaxBatchBytes is the ceiling on POST /events/batch's request body,
// applied as a route-scoped middleware in internal/server rather than as
// fiber's app-wide BodyLimit — see internal/sync's MaxPushBytes, which is
// the same number for the same reason: 4 MiB is what this endpoint had
// under fiber's default, until POST /courses raised the APP-wide limit to
// 21 MiB for course packages and took every other route with it.
const MaxBatchBytes int64 = 4 << 20

// MaxEventsPerBatch is the ceiling on events in ONE request.
//
// This handler's doc comment used to say outright that no cap was placed
// here and defer the question to a later hardening task. A review closed
// the question with measurements instead: one 4 MiB body was confirmed
// writing 37 216 real rows, each one a tx.Exec inside a single
// transaction holding one of the pool's 4–8 connections. A byte limit
// does not bound the count — an event item can be shrunk far below its
// realistic size — so this is its own number.
//
// It is set against the client rather than against an attacker, exactly
// as internal/sync's MaxItemsPerPush is: the web client posts its whole
// outbox in one unchunked request, so a cap it can exceed strands a
// long-offline device permanently. 10 000 heartbeats is over 80 hours of
// continuous active reading.
const MaxEventsPerBatch = 10000

// Handler holds the HTTP-layer concerns for stats: parsing/validating
// POST /events/batch, and shaping GET /stats's response — including the
// streak and 30-day-window computation. Per this task's file layout
// (handler.go, repo.go — no usecase.go, unlike auth/sync), that
// computation lives here deliberately: it is pure Go arithmetic over rows
// repo.go already fetched, not a persistence rule of its own.
type Handler struct {
	repo *Repo
}

// NewHandler builds a Handler over repo.
func NewHandler(repo *Repo) *Handler {
	return &Handler{repo: repo}
}

type eventItem struct {
	CourseID  string          `json:"courseId"`
	ChapterID string          `json:"chapterId"`
	Kind      string          `json:"kind"`
	Meta      json.RawMessage `json:"meta"`
	At        string          `json:"at"`
}

type eventsBatchRequest struct {
	Events []eventItem `json:"events"`
}

// eventsBatchResponse.Accepted counts rows actually newly written (post
// dedup — see repo.go's insertEventSQL), not merely how many items the
// request contained. Replaying an already-landed batch therefore reports
// accepted=0, which is the client-visible signal that the retry was a
// no-op rather than a second write.
type eventsBatchResponse struct {
	Accepted int `json:"accepted"`
}

// EventsBatch handles POST /events/batch
// {"events":[{courseId,chapterId,kind,meta,at}]}. It is mounted behind
// auth.Require, so auth.UID(c) is always populated by the time this runs.
//
// Every item is parsed and validated before any database work happens —
// a malformed item anywhere in the batch rejects the whole request with
// 400 and zero side effects, matching sync.Push's own all-or-nothing
// contract (see that handler's doc comment).
//
// kind is deliberately NOT restricted to the literal string "heartbeat":
// the events table (and this handler) are generic — the wire shape this
// task's binding requirements name always sends kind="heartbeat" today,
// but nothing here hardcodes that. Only GET /stats's minutes conversion
// is heartbeat-specific (see repo.go's HeartbeatDayCounts /
// HeartbeatCourseCounts, both filtered to kind='heartbeat'), so a future
// event kind can be added without an API change here.
//
// The batch is capped at MaxEventsPerBatch items (and, at the transport,
// at MaxBatchBytes). That cap used to be absent — this comment said so
// and deferred it to a later hardening task — until a review measured
// what the absence bought: 37 216 rows written from a single 4 MiB
// request, one tx.Exec at a time inside one transaction holding one of
// the pool's four to eight connections. See MaxEventsPerBatch.
func (h *Handler) EventsBatch(c *fiber.Ctx) error {
	var req eventsBatchRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	// Before the per-item loop, so an over-cap batch is never turned into
	// rows, and before InsertEvents, so it never opens a transaction.
	if len(req.Events) > MaxEventsPerBatch {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
			"error": fmt.Sprintf("a batch carries at most %d events; this one has %d — send it in smaller batches", MaxEventsPerBatch, len(req.Events)),
		})
	}

	rows := make([]EventRow, len(req.Events))
	for i, item := range req.Events {
		if item.CourseID == "" || item.ChapterID == "" || item.Kind == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid event item: courseId, chapterId and kind are required"})
		}
		at, err := time.Parse(timeLayout, item.At)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid at in event item: must be RFC3339Nano"})
		}

		meta := item.Meta
		if len(meta) == 0 {
			// events.meta is NOT NULL DEFAULT '{}' — an absent or
			// explicitly empty meta from the client must still write a
			// valid, non-null jsonb value rather than erroring or relying
			// on the column default (which only applies when the column
			// is omitted from the INSERT list entirely; InsertEvents
			// always supplies it).
			meta = json.RawMessage("{}")
		}

		rows[i] = EventRow{
			CourseID:  item.CourseID,
			ChapterID: item.ChapterID,
			Kind:      item.Kind,
			Meta:      meta,
			At:        at,
		}
	}

	accepted, err := h.repo.InsertEvents(c.Context(), auth.UID(c), rows)
	if err != nil {
		apilog.Internal(c, "stats.EventsBatch", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "events batch failed"})
	}

	return c.Status(fiber.StatusOK).JSON(eventsBatchResponse{Accepted: accepted})
}

type dayStat struct {
	Date    string  `json:"date"`
	Minutes float64 `json:"minutes"`
}

type courseStat struct {
	CourseID     string  `json:"courseId"`
	Minutes      float64 `json:"minutes"`
	ChaptersDone int64   `json:"chaptersDone"`
}

type statsResponse struct {
	TotalMinutes float64      `json:"totalMinutes"`
	StreakDays   int          `json:"streakDays"`
	Days         []dayStat    `json:"days"`
	Courses      []courseStat `json:"courses"`
}

// Stats handles GET /stats. It is mounted behind auth.Require, so
// auth.UID(c) is always populated by the time this runs.
//
// Response shape decisions (see this task's report for the full
// reasoning):
//
//   - Day boundary: Vietnam's fixed UTC+7 offset (icTZ), for "today", the
//     30-day window, and the streak alike — not UTC, and not the deploy
//     host's own local time. This is a single-locale Vietnamese product
//     (no per-user timezone is stored anywhere in the schema), and a
//     student studying between roughly 00:00 and 07:00 local time would
//     have that session silently attributed to the *previous* calendar
//     day under UTC bucketing (UTC trails Vietnam by 7 hours) — see
//     stats_test.go's "timezone" case, which actually proves this rather
//     than merely asserting it.
//   - Streak (controller ruling, fix round 1 — supersedes the original
//     literal "counting FROM today" reading, which made a number meant to
//     motivate into something demotivating: a user who studied last night
//     and opened the dashboard before studying again today would have
//     seen a 0-day streak): if today has activity, count the consecutive
//     run ending today; else if yesterday has activity, count the
//     consecutive run ending yesterday (the streak survives until a FULL
//     day passes with no activity at all, not merely until the calendar
//     rolls over); else 0. See streakAnchor and stats_test.go's two
//     "streak stays alive" / "streak resets to 0" cases.
//   - days[]: always exactly statsWindowDays (30) entries, zero-filled,
//     ascending (oldest first, today last) — a chart consuming this would
//     misrender gaps as missing data points rather than zero-height bars
//     if only active days were included.
//   - totalMinutes and courses[].minutes are lifetime sums (all heartbeats
//     ever recorded), not limited to the 30-day window days[] covers — a
//     dashboard's "total time studied" is conventionally all-time,
//     distinct from its 30-day trend chart.
//   - courses[] is a UNION of courses seen via heartbeats and via
//     completed chapters (see buildCourseStats), not an intersection.
func (h *Handler) Stats(c *fiber.Ctx) error {
	userID := auth.UID(c)
	ctx := c.Context()

	dayCounts, err := h.repo.HeartbeatDayCounts(ctx, userID, icTZOffset)
	if err != nil {
		apilog.Internal(c, "stats.Stats/HeartbeatDayCounts", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "stats failed"})
	}
	courseCounts, err := h.repo.HeartbeatCourseCounts(ctx, userID)
	if err != nil {
		apilog.Internal(c, "stats.Stats/HeartbeatCourseCounts", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "stats failed"})
	}
	chaptersDone, err := h.repo.CompletedChaptersByCourse(ctx, userID)
	if err != nil {
		apilog.Internal(c, "stats.Stats/CompletedChaptersByCourse", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "stats failed"})
	}

	byDay := make(map[string]int64, len(dayCounts))
	var totalHeartbeats int64
	for _, d := range dayCounts {
		byDay[d.Day] = d.Count
		totalHeartbeats += d.Count
	}

	today := todayICT()

	days := make([]dayStat, statsWindowDays)
	for i := 0; i < statsWindowDays; i++ {
		d := today.AddDate(0, 0, -(statsWindowDays - 1 - i))
		key := d.Format(dateLayout)
		days[i] = dayStat{Date: key, Minutes: minutesFromHeartbeats(byDay[key])}
	}

	streak := 0
	if anchor, ok := streakAnchor(today, byDay); ok {
		for d := anchor; byDay[d.Format(dateLayout)] > 0; d = d.AddDate(0, 0, -1) {
			streak++
		}
	}

	return c.Status(fiber.StatusOK).JSON(statsResponse{
		TotalMinutes: minutesFromHeartbeats(totalHeartbeats),
		StreakDays:   streak,
		Days:         days,
		Courses:      buildCourseStats(courseCounts, chaptersDone),
	})
}

// minutesFromHeartbeats converts a heartbeat count into minutes at the
// binding requirement's fixed rate (minutesPerHeartbeat). This is the
// only place that conversion happens.
func minutesFromHeartbeats(n int64) float64 {
	return float64(n) * minutesPerHeartbeat
}

// todayICT returns the start (00:00:00) of the current calendar day in
// Vietnam's fixed UTC+7 offset (icTZ) — see icTZ's doc comment and Stats's
// doc comment for why this, rather than UTC or the server host's own
// local time, is the day boundary this whole package uses.
func todayICT() time.Time {
	now := time.Now().In(icTZ)
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, icTZ)
}

// streakAnchor picks the day the streak's consecutive run should be
// counted backward from, per the controller's fix-round-1 ruling: today,
// if today already has activity; otherwise yesterday, if yesterday has
// activity — a user who studied last night and checks the dashboard
// before studying again today should not see their streak reset to 0 the
// instant the calendar rolls over. It stays alive through yesterday's
// count until a FULL day passes with no activity at all. If neither today
// nor yesterday has any activity, there is no active streak (ok=false,
// and the caller must not enter the walk-back loop at all — anchoring on
// some older active day would incorrectly resurrect a streak that has, in
// fact, already been broken by the gap between it and today).
func streakAnchor(today time.Time, byDay map[string]int64) (anchor time.Time, ok bool) {
	if byDay[today.Format(dateLayout)] > 0 {
		return today, true
	}
	yesterday := today.AddDate(0, 0, -1)
	if byDay[yesterday.Format(dateLayout)] > 0 {
		return yesterday, true
	}
	return time.Time{}, false
}

// buildCourseStats merges heartbeat-derived minutes and completed-chapter
// counts into one courses[] list, keyed by courseId. A course appears in
// the result if it has EITHER at least one heartbeat OR at least one
// completed chapter — the two repo queries run over different tables
// (events, progress) and neither result is a subset of the other (a user
// can mark a chapter "done" without ever having a heartbeat land for it in
// a short session, or accumulate heartbeats in a chapter never marked
// done), so this is a union, not an intersection, with the missing side
// defaulting to zero. Sorted by courseId for a stable, deterministic
// response.
func buildCourseStats(courseCounts []CourseCount, chaptersDone map[string]int64) []courseStat {
	byCourse := make(map[string]*courseStat, len(courseCounts)+len(chaptersDone))
	order := make([]string, 0, len(courseCounts)+len(chaptersDone))

	get := func(courseID string) *courseStat {
		if cs, ok := byCourse[courseID]; ok {
			return cs
		}
		cs := &courseStat{CourseID: courseID}
		byCourse[courseID] = cs
		order = append(order, courseID)
		return cs
	}

	for _, cc := range courseCounts {
		get(cc.CourseID).Minutes = minutesFromHeartbeats(cc.Count)
	}
	for courseID, n := range chaptersDone {
		get(courseID).ChaptersDone = n
	}

	sort.Strings(order)
	out := make([]courseStat, len(order))
	for i, courseID := range order {
		out[i] = *byCourse[courseID]
	}
	return out
}

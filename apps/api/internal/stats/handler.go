package stats

import (
	"encoding/json"
	"sort"
	"time"

	"github.com/gofiber/fiber/v2"

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

// icTZ is Vietnam's fixed UTC+7 offset. It is the single day-boundary
// definition this whole package uses for "today", "the last 30 days", and
// "streak" — see Stats's doc comment for the reasoning behind choosing
// Vietnam-local time over UTC or the server host's own local time, and
// repo.go's dayBucketExpr for why this is a fixed offset
// (time.FixedZone), not a named zone (time.LoadLocation): the API's
// runtime image is FROM scratch (see apps/api/Dockerfile) and ships no
// tzdata, so a named-zone lookup would work in dev/CI and fail in
// production. Must stay numerically identical to dayBucketExpr's SQL-side
// +7h shift.
var icTZ = time.FixedZone("ICT", 7*3600)

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
// No cap is placed on the number of events per batch. A client could in
// principle post an enormous batch in one request; this is a deliberate,
// documented deferral (matching this project's established pattern of
// deferring abuse/resilience hardening to the later P4 hardening task —
// see e.g. store.TestPool's own rulings on fail-fast vs. resilience), not
// an oversight.
func (h *Handler) EventsBatch(c *fiber.Ctx) error {
	var req eventsBatchRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
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
//   - Streak: counts consecutive days with >=1 heartbeat, walking
//     backward starting AT today (per the brief's own wording: "streak =
//     số ngày liên tiếp TÍNH TỪ HÔM NAY" — "counting FROM today"). If
//     today itself has no heartbeat yet, the streak reads as 0
//     immediately, even if yesterday was studied — a stricter rule than a
//     duolingo-style streak-freeze, chosen because the brief anchors the
//     count at today, not at "the most recently active day". See
//     stats_test.go's "streak requires activity today" case.
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

	dayCounts, err := h.repo.HeartbeatDayCounts(ctx, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "stats failed"})
	}
	courseCounts, err := h.repo.HeartbeatCourseCounts(ctx, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "stats failed"})
	}
	chaptersDone, err := h.repo.CompletedChaptersByCourse(ctx, userID)
	if err != nil {
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
	for d := today; byDay[d.Format(dateLayout)] > 0; d = d.AddDate(0, 0, -1) {
		streak++
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

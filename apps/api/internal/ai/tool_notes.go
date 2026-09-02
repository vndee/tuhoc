// tool_notes.go gives the agent (Pha 3, Task 12) a way to read the ASKING
// LEARNER's own progress and notes for one course — "where am I stuck" needs
// the tutor to see which chapters were read and what the learner privately
// wrote about them.
//
// TWO CONDITIONS THIS FILE EXISTS TO ENFORCE, both paid for in the previous
// phase and both load-bearing here:
//
//  1. CONFUSED DEPUTY. The tool's JSON schema (Definition, below) carries no
//     parameter that could name a learner, and Run NEVER reads one out of
//     argsJSON — NewNotesTool binds userID ONCE, at construction, from the
//     authenticated caller. docs/carried-forward.md's still-live S2-F9 entry
//     is about a different route (a hostile course's script riding the
//     learner's own session into POST /ai/chat), but the SAME mechanism one
//     layer up: a tool whose schema let the MODEL name a user id would let a
//     cleverly worded question (or a hostile course's prose, which
//     tool_course.go already reads unfiltered into the model's context) turn
//     into a command to read someone else's private notes. Binding userID
//     here removes the argument entirely — there is nothing for anything to
//     inject INTO. TestNotesToolSchemaHasNoUserParameter and
//     TestNotesToolReadsOnlyBoundUser (tool_notes_test.go) are this file's
//     proof, and both are proven able to fail (see task-12-report.md's
//     mutation section) — a test that is the SOLE gate on a security
//     property is worth nothing unmutated.
//
//  2. AN EMPTY SLUG IS LOUD. Pha 2's read_course tool shipped enabled by
//     default while ChapterView rendered the AI panels without passing
//     courseSlug — the prop defaulted "" all the way down to agent.go's
//     `if t.CourseSlug != ""`, a dead branch in production for a whole
//     phase, every test green throughout. Run below never reads "every
//     course" for an empty/missing slug; it refuses with a sentence the
//     model can read and act on (ask the learner which course, or try
//     read_course's manifest first).
//
//  3. THE COURSE IS THE TURN'S, NOT THE MODEL'S (final whole-branch review,
//     Important 4). The tool used to take `slug` as an argument, and
//     agent.go injects the learner's current course only as ADVISORY PROSE
//     ("When a tool needs a course slug and the learner has not clearly
//     named a different course, use this one") — nothing compared the
//     argument against Turn.CourseSlug. So the identity binding of
//     condition 1 was airtight while the SCOPE inside that identity was
//     model-steerable, and the learner-facing disclosure said otherwise:
//     `ai.readsYourNotes` (packages/i18n, rendered unconditionally by
//     AskPanel.tsx) promises reading "for this course".
//
//     That gap is not theoretical here. docs/carried-forward.md's S2-F9 is
//     a LIVE debt: a hostile same-origin course can already drive
//     POST /ai/chat under the learner's session, and tool_course.go reads a
//     course's own prose unfiltered into the model's context. Steerable
//     scope is the difference between "reads the notes for the course you
//     are on" and "reads your notes for any course it can name".
//
//     So courseSlug is bound at construction from Turn.CourseSlug, exactly
//     like userID, and the schema declares NO parameters at all — there is
//     nothing left for anything to inject INTO, which is the same shape
//     condition 1 already relies on rather than a second, weaker mechanism
//     (validating an argument the model still gets to choose).
package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// NotesProgressRow and NotesAnnotationRow mirror the exported fields
// notesTool needs from userdata.ProgressRow / userdata.AnnotationRow.
//
// NOT userdata.ProgressRow/AnnotationRow themselves, and this is a hard
// compiler constraint, not a style echo of tool_course.go's CourseQuerier
// (which avoids internal/catalog by choice, to keep this package depending
// on nothing but its two providers). Verified empirically, not assumed:
// internal/userdata (handler.go) imports internal/auth, and internal/auth
// (repo.go) imports THIS package for the signup-credit grant
// (handler.go's own doc comment on HandlerDeps.UserID names the other half
// of that constraint). So internal/ai importing internal/userdata closes a
// cycle — ai -> userdata -> auth -> ai — and `go build` confirms it
// ("import cycle not allowed") rather than merely suggesting it. The fix
// has the same SHAPE as CourseQuerier's regardless of why it is needed:
// this package declares its own narrow types, and internal/server's
// composition root (notesQuerier, mirroring courseQuerier) is the one place
// allowed to see both internal/ai and internal/userdata and translate
// between them.
type NotesProgressRow struct {
	ChapterID string
	Status    string
	Done      bool
}

// NotesAnnotationRow carries Anchor opaquely, same discipline as
// userdata.AnnotationRow's own doc comment: this package does not decode it
// into a Go struct except at the one point (anchorExcerpt, below) where it
// needs the "exact" field to give the model something more useful to quote
// back than a raw JSON blob.
type NotesAnnotationRow struct {
	ChapterID string
	Anchor    json.RawMessage
	Note      string
}

// NotesQuerier is the narrow surface notesTool needs from userdata.Repo.
// internal/server's notesQuerier adapter implements this over the real
// *userdata.Repo (ListProgress/ListAnnotations).
//
// Both methods take userID as an explicit argument — the SAME shape
// userdata.Repo.ListProgress/ListAnnotations already have, because that is
// what the SQL WHERE clause needs to scope the read to one learner.
// NewNotesTool below is the ONLY thing that decides what value flows into
// that argument at runtime: it is bound once, at construction, from the
// authenticated caller, never from argsJSON. See NewNotesTool's doc
// comment for why that split matters.
type NotesQuerier interface {
	Progress(ctx context.Context, userID uuid.UUID, courseID string) ([]NotesProgressRow, error)
	Notes(ctx context.Context, userID uuid.UUID, courseID string) ([]NotesAnnotationRow, error)
}

// maxNotesToolOutputRunes bounds notesTool.Run's WHOLE formatted answer, in
// RUNES (not bytes — this platform is bilingual, and a byte cap would give
// an English learner's notes roughly three times the allowance a
// Vietnamese learner's notes get for the same character count; see
// MaxSystemPromptChars, handler.go, for the same reasoning applied to a
// different field).
//
// WHY THIS CAP EXISTS WHEN tool_course.go HAS NONE (measured, not assumed —
// tool_course.go's Run puts a whole manifest or a whole stripped chapter
// into the model's context with no length guard at all). A published
// chapter is bounded by what an AUTHOR wrote and pkgcheck accepted at
// publish time; this tool's input is bounded by nothing — a diligent
// learner accumulates one annotation per interesting sentence across an
// entire course, and every one of those notes is read back on every
// question that triggers this tool, billed out of that same learner's
// credit (task-12-brief.md's own framing: "notes can be longer than the
// chapter"). 12,000 runes is three times MaxQuestionChars (handler.go's own
// cap on one question) — generous enough for a genuinely prolific
// note-taker's course-so-far, while keeping one tool call from being able
// to spend an unbounded amount of a learner's own balance on itself.
const maxNotesToolOutputRunes = 12000

// notesTool is the sole ToolRunner implementation in this file — the tool
// named ToolNameReadMyNotes ("read_my_notes").
type notesTool struct {
	q          NotesQuerier
	userID     uuid.UUID
	courseSlug string
}

// NewNotesTool builds the "read_my_notes" ToolRunner, bound to userID AND
// to courseSlug at construction — see this file's package doc comment,
// conditions 1 and 3, for the full reasoning. Both are constructor
// arguments and ONLY constructor arguments: Definition declares no
// parameters whatsoever, and Run never looks in argsJSON for either. There
// is no user_id and no slug for a model, or for a hostile course's prose
// read into the model's context by tool_course.go, to inject INTO.
//
// courseSlug is Turn.CourseSlug, threaded through TurnTools from the ONE
// place that knows it (handler.go's Chat, from the request body's
// course_slug field, already length-capped there). It may be "" — a
// question asked from the home page — and Run refuses loudly in that case
// rather than falling back to the model's opinion or to "every course".
func NewNotesTool(q NotesQuerier, userID uuid.UUID, courseSlug string) ToolRunner {
	return &notesTool{q: q, userID: userID, courseSlug: courseSlug}
}

// Definition declares NO arguments at all: an empty object schema.
//
// It used to declare one — `slug`, required — and the final whole-branch
// review removed it rather than validating it, for the reason condition 1
// gives about user ids: a parameter that the model fills in is a parameter
// something can steer, and the only argument that cannot be injected into
// is the one that does not exist. Both facets this tool needs (WHO and
// WHICH COURSE) now come from the turn.
//
// Two tests fail the build the moment either creeps back in:
// TestNotesToolSchemaHasNoUserParameter scans the marshaled schema for
// "user"/"user_id"/"userId", and TestNotesToolSchemaHasNoSlugParameter for
// "slug" — so these comments are promises tests also keep.
//
// `"properties": map[string]any{}` is written out explicitly rather than
// omitted: an object schema with no properties key at all is, to some
// providers, an under-specified schema rather than a no-argument one.
func (t *notesTool) Definition() Tool {
	return Tool{
		Type: "function",
		Function: ToolFunction{
			Name: ToolNameReadMyNotes,
			Description: "Read the current learner's own progress and notes for the course they " +
				"are reading right now: which chapters have been read, and any margin notes " +
				"written, each shown with the passage it is anchored to. This always reads the " +
				"learner asking the question, and always the course they currently have open — " +
				"there is no way to target anyone else, or any other course. Takes no arguments.",
			Parameters: map[string]any{
				"type":       "object",
				"properties": map[string]any{},
			},
		},
	}
}

// notesToolArgs is exactly the JSON shape this tool reads out of
// ToolCall.Function.Arguments: nothing. It has no fields, and that is the
// whole point — json.Unmarshal silently ignores every key a struct does not
// declare, so a model that sends `{"user_id":"...","slug":"..."}` anyway
// (out of habit, or because a hostile course's prose told it to) changes
// nothing about what is read. TestNotesToolReadsOnlyBoundUser and
// TestNotesToolReadsOnlyTheTurnsCourse each send exactly that and assert it.
//
// Kept as a named type with a real Unmarshal call rather than dropped
// entirely: the call is what still turns MALFORMED arguments into a
// model-readable text error instead of silently accepting them, which is a
// different property from "arguments are ignored" and has its own test
// (TestNotesToolMalformedArgsJSONIsATextError).
type notesToolArgs struct{}

// Run decodes argsJSON, reads the BOUND learner's progress and notes for
// slug, and ALWAYS returns (text, nil) — never (any, non-nil error) — for
// every condition the model can read and act on itself: malformed args, a
// missing/empty slug, or a NotesQuerier failure. This is the exact contract
// courseTool.Run documents at length (tool_course.go): a Go error here
// would hand the tool-call loop (agent.go) a decision that belongs to the
// model — abort the turn, retry, swallow it — while a plain string lets the
// model read "no slug given" or "could not read notes" and decide its own
// next step (ask the learner, fall back to read_course, and so on).
func (t *notesTool) Run(ctx context.Context, argsJSON string) (string, error) {
	var args notesToolArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return fmt.Sprintf("Error: could not parse arguments: %s", err), nil
	}

	// THE TURN'S course, never the model's — condition 3. `args` is
	// deliberately unused past the parse above; see notesToolArgs.
	slug := strings.TrimSpace(t.courseSlug)

	// isValidCourseSlug, not `!= ""` — the same test agent.go's
	// buildMessages applies before it will even SHOW a course slug to the
	// model (whole-branch review, C2). One definition of "slug-shaped" in
	// this package, applied in both directions: a Turn.CourseSlug this
	// package refuses to say is one it refuses to read.
	//
	// LOUD, not silent — condition 2. An empty or unusable course is never
	// treated as "every course", which is exactly what a courseID == ""
	// would mean to Repo.ListAnnotations (userdata/repo.go) if it reached
	// that layer unchecked. The text names what the MODEL can do about it,
	// since the model is the only reader this string has.
	if !isValidCourseSlug(slug) {
		return "Error: no course is open in this conversation, so there are no progress or notes to read. " +
			"Ask the learner to open the course they mean, then ask again.", nil
	}

	progress, err := t.q.Progress(ctx, t.userID, slug)
	if err != nil {
		return fmt.Sprintf("Error: could not read progress for course %q: %s", slug, err), nil
	}
	notes, err := t.q.Notes(ctx, t.userID, slug)
	if err != nil {
		return fmt.Sprintf("Error: could not read notes for course %q: %s", slug, err), nil
	}

	return truncateNotesOutput(formatNotesOutput(slug, progress, notes)), nil
}

// formatNotesOutput renders progress and notes as plain text for the
// model's context — never empty (see TestNotesToolReportsNoDataAsReadableNotEmptyString):
// a blank Message{Role:"tool"}.Content is indistinguishable, to the model,
// from "nothing to read yet" and "something in this pipeline broke
// silently" — the same reasoning tool_course.go's Run gives for its own
// "Note: ... returned no content" branches.
func formatNotesOutput(slug string, progress []NotesProgressRow, notes []NotesAnnotationRow) string {
	var sb strings.Builder

	fmt.Fprintf(&sb, "Chapters read in course %q:\n", slug)
	var readChapters []string
	for _, p := range progress {
		// "read" (status) is the reader's own convention for "this chapter's
		// text was read" (apps/web/src/progress/useProgress.ts marks it
		// this way); every other status this platform writes is an
		// exercise's progress ("ex:0", "ex:1", ...) and is not what a
		// learner or a tutor means by "chapters I have read".
		if p.Status == "read" && p.Done {
			readChapters = append(readChapters, p.ChapterID)
		}
	}
	if len(readChapters) == 0 {
		sb.WriteString("(none yet)\n")
	} else {
		for _, ch := range readChapters {
			fmt.Fprintf(&sb, "- %s\n", ch)
		}
	}

	fmt.Fprintf(&sb, "\nNotes in course %q:\n", slug)
	if len(notes) == 0 {
		sb.WriteString("(no notes yet)\n")
	} else {
		for _, n := range notes {
			excerpt := anchorExcerpt(n.Anchor)
			if excerpt == "" {
				fmt.Fprintf(&sb, "- [%s] %s\n", n.ChapterID, n.Note)
			} else {
				fmt.Fprintf(&sb, "- [%s] anchored to %q: %s\n", n.ChapterID, excerpt, n.Note)
			}
		}
	}

	return sb.String()
}

// anchorExcerpt reads Anchor's "exact" field — the highlighted text a note
// was written about — with the same defensiveness
// apps/web/src/annotations/useAnnotations.ts's exactOf reads it
// client-side: the anchor is carried opaquely end to end
// (NotesAnnotationRow's own doc comment), so a shape this tool does not
// expect (a future anchor version, a malformed row) must fall back to an
// empty excerpt rather than take the note's own text down with it — see
// TestNotesToolHandlesMalformedAnchorWithoutBreaking.
func anchorExcerpt(anchor json.RawMessage) string {
	var parsed struct {
		Exact string `json:"exact"`
	}
	if err := json.Unmarshal(anchor, &parsed); err != nil {
		return ""
	}
	return parsed.Exact
}

// truncateNotesOutput bounds s to maxNotesToolOutputRunes RUNES, cutting on
// a rune boundary (never inside a multi-byte UTF-8 sequence — this
// platform's text is Vietnamese as often as English) and appending a
// marker the MODEL can read as "there is more, but it was cut", not a
// silent truncation it might mistake for the whole answer.
func truncateNotesOutput(s string) string {
	r := []rune(s)
	if len(r) <= maxNotesToolOutputRunes {
		return s
	}
	return string(r[:maxNotesToolOutputRunes]) +
		"\n\n[Output truncated — this course has more notes than fit here. Ask about one chapter for the rest.]"
}

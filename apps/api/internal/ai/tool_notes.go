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
	q      NotesQuerier
	userID uuid.UUID
}

// NewNotesTool builds the "read_my_notes" ToolRunner, bound to userID at
// construction — see this file's package doc comment, condition 1, for the
// full reasoning. userID is a constructor argument and ONLY a constructor
// argument: Definition declares no field that could carry an identity, and
// Run never looks for one in argsJSON. There is no user_id for a model,
// or for a hostile course's prose read into the model's context by
// tool_course.go, to inject INTO.
func NewNotesTool(q NotesQuerier, userID uuid.UUID) ToolRunner {
	return &notesTool{q: q, userID: userID}
}

// Definition declares exactly one argument: slug, required. No parameter
// here can carry a learner identity — TestNotesToolSchemaHasNoUserParameter
// scans the marshaled schema for "user"/"user_id"/"userId" and fails the
// build the moment one appears, so this comment is a promise a test also
// keeps.
func (t *notesTool) Definition() Tool {
	return Tool{
		Type: "function",
		Function: ToolFunction{
			Name: ToolNameReadMyNotes,
			Description: "Read the current learner's own progress and notes for one course: " +
				"which chapters have been read, and any margin notes written, each shown with " +
				"the passage it is anchored to. This always reads the learner asking the " +
				"question — there is no way to target anyone else.",
			Parameters: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"slug": map[string]any{
						"type":        "string",
						"description": "The course's slug (its unique id in the catalog) to read progress and notes for.",
					},
				},
				"required": []string{"slug"},
			},
		},
	}
}

// notesToolArgs is exactly the JSON shape the model sends in
// ToolCall.Function.Arguments. Deliberately narrow — no field here could
// carry a learner identity even if the model tried to put one in "user_id"
// or similar; json.Unmarshal silently ignores keys this struct does not
// declare (proven by TestNotesToolReadsOnlyBoundUser, which sends "user_id"
// alongside "slug" and asserts it changes nothing).
type notesToolArgs struct {
	Slug string `json:"slug"`
}

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

	slug := strings.TrimSpace(args.Slug)
	if slug == "" {
		// LOUD, not silent — condition 2 of this file's doc comment. A
		// missing "slug" key and an explicit "" both land here (both
		// TrimSpace to ""); neither one is treated as "every course",
		// which is what a courseID == "" would mean to Repo.ListAnnotations
		// (userdata/repo.go) if it ever reached that layer unchecked.
		return "Error: slug is required — name the course to read progress and notes for.", nil
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

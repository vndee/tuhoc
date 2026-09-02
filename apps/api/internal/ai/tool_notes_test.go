package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// fakeNotesQuerier is a NotesQuerier that never touches Postgres — the
// notes-tool analogue of tool_course_test.go's fakeQuerier. Named
// "fakeNotesQuerier" rather than "fakeQuerier" on purpose: this package
// already has a fakeQuerier (tool_course_test.go, for CourseQuerier), and a
// second type of the same name in the same package is a compile error, not
// a style choice.
type fakeNotesQuerier struct {
	progress    []NotesProgressRow
	progressErr error
	notes       []NotesAnnotationRow
	notesErr    error
}

func (f fakeNotesQuerier) Progress(ctx context.Context, userID uuid.UUID, courseID string) ([]NotesProgressRow, error) {
	return f.progress, f.progressErr
}

func (f fakeNotesQuerier) Notes(ctx context.Context, userID uuid.UUID, courseID string) ([]NotesAnnotationRow, error) {
	return f.notes, f.notesErr
}

// recordingNotesQuerier records the userID/courseID EACH METHOD was
// actually called with, separately — TestNotesToolReadsOnlyBoundUser's
// whole point is reading these back and comparing them against what
// argsJSON tried to smuggle in.
//
// Progress and Notes record into SEPARATE fields, deliberately, not one
// shared "last call wins" field: Run (tool_notes.go) calls Progress THEN
// Notes, so a single shared field would let a mutation that only steers
// Progress hide behind a correct, later Notes call overwriting the
// evidence. Measured, not assumed — this file's own mutation testing
// (task-12-report.md) caught exactly that gap in an earlier draft of this
// fake, where mutating only the Progress call still left the test green.
type recordingNotesQuerier struct {
	askedForProgress    uuid.UUID
	askedCourseProgress string
	askedForNotes       uuid.UUID
	askedCourseNotes    string
}

func (r *recordingNotesQuerier) Progress(ctx context.Context, userID uuid.UUID, courseID string) ([]NotesProgressRow, error) {
	r.askedForProgress = userID
	r.askedCourseProgress = courseID
	return nil, nil
}

func (r *recordingNotesQuerier) Notes(ctx context.Context, userID uuid.UUID, courseID string) ([]NotesAnnotationRow, error) {
	r.askedForNotes = userID
	r.askedCourseNotes = courseID
	return nil, nil
}

// ============================================================================
// Security gate 1 — the tool's schema carries no user identity of any kind,
// and Run never reads one out of argsJSON even when the model supplies one.
//
// task-12-brief.md names the mechanism directly: this is the S2-F9
// confused-deputy shape (docs/carried-forward.md), one layer up — a model
// that can NAME a user_id turns a well-phrased question into a command to
// read someone else's private notes, and a tool built to obey arguments
// would do exactly that.
// ============================================================================

func TestNotesToolSchemaHasNoUserParameter(t *testing.T) {
	def := NewNotesTool(fakeNotesQuerier{}, uuid.New()).Definition()
	raw, err := json.Marshal(def)
	if err != nil {
		t.Fatalf("marshal Definition(): %v", err)
	}
	for _, needle := range []string{"user_id", "userId", "user"} {
		if bytes.Contains(bytes.ToLower(raw), []byte(strings.ToLower(needle))) {
			t.Fatalf("schema contains %q — a model could supply it as an argument: %s", needle, raw)
		}
	}
}

func TestNotesToolReadsOnlyBoundUser(t *testing.T) {
	q := &recordingNotesQuerier{}
	bound := uuid.New()
	spoofed := uuid.NewString()

	if _, err := NewNotesTool(q, bound).Run(context.Background(), `{"slug":"c","user_id":"`+spoofed+`"}`); err != nil {
		t.Fatalf("Run returned a Go error: %v", err)
	}
	// BOTH calls checked independently — Run calls Progress then Notes, and
	// checking only whichever ran last would miss a mutation that steers
	// just the other one. See recordingNotesQuerier's own doc comment.
	if q.askedForProgress != bound {
		t.Fatalf("Progress read data for %v, want the bound learner %v — a user_id smuggled "+
			"into argsJSON steered whose data was read", q.askedForProgress, bound)
	}
	if q.askedForNotes != bound {
		t.Fatalf("Notes read data for %v, want the bound learner %v — a user_id smuggled "+
			"into argsJSON steered whose data was read", q.askedForNotes, bound)
	}
}

// ============================================================================
// Security gate 2 — an empty slug is a LOUD, model-readable error, never a
// silent read of every course's data.
//
// task-12-brief.md's own words for why: the previous phase's read_course
// tool shipped enabled by default and blind — ChapterView rendered the AI
// panels without passing courseSlug, the prop defaulted "" the whole way
// down, and agent.go's `if t.CourseSlug != ""` was a dead branch in
// production for a whole phase, with every test green throughout.
// ============================================================================

func TestNotesToolRejectsEmptySlug(t *testing.T) {
	out, err := NewNotesTool(fakeNotesQuerier{}, uuid.New()).Run(context.Background(), `{"slug":""}`)
	if err != nil {
		t.Fatalf("want a text error the model can read, not a Go error: %v", err)
	}
	if !strings.Contains(strings.ToLower(out), "slug") {
		t.Errorf("the model cannot tell why from this text: %q", out)
	}
}

func TestNotesToolRejectsMissingSlug(t *testing.T) {
	// No "slug" key at all — not merely an empty string — must fail the
	// same loud way, not read every course silently under courseID "".
	out, err := NewNotesTool(fakeNotesQuerier{}, uuid.New()).Run(context.Background(), `{}`)
	if err != nil {
		t.Fatalf("want a text error, not a Go error: %v", err)
	}
	if !strings.Contains(strings.ToLower(out), "slug") {
		t.Errorf("the model cannot tell why from this text: %q", out)
	}
}

// ============================================================================
// Ordinary behavior — schema shape, argument passthrough, formatting, error
// handling, and the output cap.
// ============================================================================

func TestNotesToolDefinitionNameMatchesConstant(t *testing.T) {
	def := NewNotesTool(fakeNotesQuerier{}, uuid.New()).Definition()
	if def.Function.Name != ToolNameReadMyNotes {
		t.Fatalf("Definition().Function.Name = %q, want %q (ToolNameReadMyNotes) — a mismatch "+
			"here means agent.go dispatches on one key while the model is told a different name, "+
			"and the tool is advertised but can never run", def.Function.Name, ToolNameReadMyNotes)
	}
}

func TestNotesToolPassesSlugAsCourseID(t *testing.T) {
	q := &recordingNotesQuerier{}
	if _, err := NewNotesTool(q, uuid.New()).Run(context.Background(), `{"slug":"toan-roi-rac"}`); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if q.askedCourseProgress != "toan-roi-rac" {
		t.Fatalf("slug forwarded to Progress as courseID = %q, want %q", q.askedCourseProgress, "toan-roi-rac")
	}
	if q.askedCourseNotes != "toan-roi-rac" {
		t.Fatalf("slug forwarded to Notes as courseID = %q, want %q", q.askedCourseNotes, "toan-roi-rac")
	}
}

func TestNotesToolListsOnlyChaptersMarkedReadAndDone(t *testing.T) {
	q := fakeNotesQuerier{progress: []NotesProgressRow{
		{ChapterID: "ch1", Status: "read", Done: true},
		{ChapterID: "ch2", Status: "read", Done: false}, // read row, not finished
		{ChapterID: "ch3", Status: "ex:0", Done: true},  // exercise progress, not "read"
	}}
	out, err := NewNotesTool(q, uuid.New()).Run(context.Background(), `{"slug":"c"}`)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !strings.Contains(out, "ch1") {
		t.Errorf("ch1 (status=read, done=true) missing from output: %q", out)
	}
	if strings.Contains(out, "ch2") {
		t.Errorf("ch2 (status=read, done=false) must not be reported as read: %q", out)
	}
	if strings.Contains(out, "ch3") {
		t.Errorf("ch3 (an exercise-progress row, not a chapter-read row) must not be reported as read: %q", out)
	}
}

func TestNotesToolIncludesNoteTextAndAnchoredExcerpt(t *testing.T) {
	q := fakeNotesQuerier{notes: []NotesAnnotationRow{
		{ChapterID: "ch1", Anchor: json.RawMessage(`{"exact":"quan trọng","prefix":"a","suffix":"b","color":"y"}`), Note: "cần ôn lại"},
	}}
	out, err := NewNotesTool(q, uuid.New()).Run(context.Background(), `{"slug":"c"}`)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !strings.Contains(out, "cần ôn lại") {
		t.Errorf("note text missing from output: %q", out)
	}
	if !strings.Contains(out, "quan trọng") {
		t.Errorf("anchored excerpt (anchor.exact) missing from output: %q", out)
	}
}

func TestNotesToolHandlesMalformedAnchorWithoutBreaking(t *testing.T) {
	q := fakeNotesQuerier{notes: []NotesAnnotationRow{
		{ChapterID: "ch1", Anchor: json.RawMessage(`not json`), Note: "note text survives"},
	}}
	out, err := NewNotesTool(q, uuid.New()).Run(context.Background(), `{"slug":"c"}`)
	if err != nil {
		t.Fatalf("want a text error, not a Go error, even for a malformed anchor: %v", err)
	}
	if !strings.Contains(out, "note text survives") {
		t.Errorf("a malformed anchor must not take the note text down with it: %q", out)
	}
}

func TestNotesToolReportsNoDataAsReadableNotEmptyString(t *testing.T) {
	out, err := NewNotesTool(fakeNotesQuerier{}, uuid.New()).Run(context.Background(), `{"slug":"brand-new-course"}`)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if strings.TrimSpace(out) == "" {
		t.Fatal("an empty string in Message{Role:\"tool\"}.Content gives the model no signal " +
			"that this is \"nothing to read yet\" rather than a broken tool call")
	}
}

func TestNotesToolReportsProgressQuerierErrorAsText(t *testing.T) {
	q := fakeNotesQuerier{progressErr: errors.New("connection reset")}
	out, err := NewNotesTool(q, uuid.New()).Run(context.Background(), `{"slug":"c"}`)
	if err != nil {
		t.Fatalf("want a text error, not a Go error: %v", err)
	}
	if !strings.Contains(strings.ToLower(out), "error") {
		t.Errorf("querier failure must read as an error to the model: %q", out)
	}
}

func TestNotesToolReportsNotesQuerierErrorAsText(t *testing.T) {
	q := fakeNotesQuerier{notesErr: errors.New("connection reset")}
	out, err := NewNotesTool(q, uuid.New()).Run(context.Background(), `{"slug":"c"}`)
	if err != nil {
		t.Fatalf("want a text error, not a Go error: %v", err)
	}
	if !strings.Contains(strings.ToLower(out), "error") {
		t.Errorf("querier failure must read as an error to the model: %q", out)
	}
}

func TestNotesToolMalformedArgsJSONIsATextError(t *testing.T) {
	out, err := NewNotesTool(fakeNotesQuerier{}, uuid.New()).Run(context.Background(), `{not json`)
	if err != nil {
		t.Fatalf("want a text error, not a Go error: %v", err)
	}
	if strings.TrimSpace(out) == "" {
		t.Fatal("malformed arguments must produce a readable error, not silence")
	}
}

// TestNotesToolCapsOutputLength is the mutation-provable gate on
// maxNotesToolOutputRunes: a diligent learner's notes can be longer than a
// chapter, and this tool's output is paid for out of the learner's own
// credit (task-12's own constraint) — an unbounded echo of every note ever
// written is a bill with no ceiling.
func TestNotesToolCapsOutputLength(t *testing.T) {
	notes := make([]NotesAnnotationRow, 0, 50)
	for i := 0; i < 50; i++ {
		notes = append(notes, NotesAnnotationRow{
			ChapterID: "ch1",
			Anchor:    json.RawMessage(`{"exact":"x"}`),
			Note:      strings.Repeat("a very long note repeated many times ", 50),
		})
	}
	q := fakeNotesQuerier{notes: notes}
	out, err := NewNotesTool(q, uuid.New()).Run(context.Background(), `{"slug":"c"}`)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := len([]rune(out)); got > maxNotesToolOutputRunes+200 { // +200 slack for the truncation marker
		t.Fatalf("output is %d runes, want at most ~%d — an uncapped notes tool bills the "+
			"learner for every note they ever wrote, every time the model calls it",
			got, maxNotesToolOutputRunes)
	}
}

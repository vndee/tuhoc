// notes_querier_test.go exercises notesQuerier (server.go) directly against
// a real Postgres — the one piece of Task 12's wiring that
// tool_notes_test.go (package ai) and handler_test.go's
// TestChatBindsNotesToolToTheCallersOwnID (package ai_test, a fake
// ai.NotesQuerier) cannot reach: the real translation from
// *userdata.Repo's rows to ai.NotesProgressRow/ai.NotesAnnotationRow, and
// the one piece of actual LOGIC that translation contains — Progress's
// manual per-course filter (Repo.ListProgress has no course-scoped query of
// its own; see notesQuerier.Progress's own doc comment).
//
// package server (internal), not server_test: notesQuerier is unexported,
// and this file needs to construct one directly.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/store"
	"github.com/vndee/tuhoc-api/internal/userdata"
)

func notesQuerierTestUser(t *testing.T, pool *pgxpool.Pool, label string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	email := fmt.Sprintf("notes-querier-%s-%s@example.test", label, uuid.NewString())
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email, name, pw_hash) VALUES ($1,$2,$3) RETURNING id`,
		email, label, "not-a-real-hash").Scan(&id); err != nil {
		t.Fatalf("insert user %s: %v", label, err)
	}
	return id
}

// TestNotesQuerierScopesProgressToOneUserAndOneCourse is the adapter-level
// half of task-12's confused-deputy proof: even calling notesQuerier
// directly, with a courseID and a userID chosen freely (exactly the two
// values notesTool.Run passes through — see tool_notes.go), one learner's
// row never appears in another learner's read, and a row from a different
// course never appears when a specific course was asked for.
func TestNotesQuerierScopesProgressToOneUserAndOneCourse(t *testing.T) {
	pool := store.TestPool(t)
	repo := userdata.NewRepo(pool)
	q := notesQuerier{repo: repo}

	alice := notesQuerierTestUser(t, pool, "alice")
	bob := notesQuerierTestUser(t, pool, "bob")

	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	must(repo.UpsertProgress(context.Background(), alice, userdata.ProgressRow{
		CourseID: "course-a", ChapterID: "ch1", Status: "read", Done: true,
	}))
	must(repo.UpsertProgress(context.Background(), alice, userdata.ProgressRow{
		CourseID: "course-b", ChapterID: "ch1", Status: "read", Done: true,
	}))
	must(repo.UpsertProgress(context.Background(), bob, userdata.ProgressRow{
		CourseID: "course-a", ChapterID: "ch1", Status: "read", Done: true,
	}))

	got, err := q.Progress(context.Background(), alice, "course-a")
	if err != nil {
		t.Fatalf("Progress: %v", err)
	}
	if len(got) != 1 || got[0].ChapterID != "ch1" {
		t.Fatalf("alice/course-a: want exactly alice's one course-a row, got %+v", got)
	}

	// Same learner, other course: must not see course-a's row.
	gotOtherCourse, err := q.Progress(context.Background(), alice, "course-b")
	if err != nil {
		t.Fatalf("Progress: %v", err)
	}
	if len(gotOtherCourse) != 1 {
		t.Fatalf("alice/course-b: want exactly one row (alice's own), got %+v", gotOtherCourse)
	}

	// Different learner, same course: must not see alice's row — this is
	// the adapter-level shape of the confused-deputy property tool_notes.go
	// exists to enforce; a leak here would mean the SQL scoping itself is
	// broken, independent of anything tool_notes.go's Run does right.
	gotBob, err := q.Progress(context.Background(), bob, "course-a")
	if err != nil {
		t.Fatalf("Progress: %v", err)
	}
	if len(gotBob) != 1 {
		t.Fatalf("bob/course-a: want exactly bob's own one row, got %+v", gotBob)
	}

	// A course neither learner touched: empty, not an error, not the other
	// learner's rows.
	gotNone, err := q.Progress(context.Background(), alice, "course-nobody-touched")
	if err != nil {
		t.Fatalf("Progress: %v", err)
	}
	if len(gotNone) != 0 {
		t.Fatalf("want no rows for an untouched course, got %+v", gotNone)
	}
}

// TestNotesQuerierScopesNotesToOneUser is Notes's half of the same proof.
// Unlike Progress, Notes maps straight onto Repo.ListAnnotations (which
// already course-scopes in SQL) — this test exists to prove that pass-
// through is honest, not to re-test Repo.ListAnnotations itself (that is
// internal/userdata's own job).
func TestNotesQuerierScopesNotesToOneUser(t *testing.T) {
	pool := store.TestPool(t)
	repo := userdata.NewRepo(pool)
	q := notesQuerier{repo: repo}

	alice := notesQuerierTestUser(t, pool, "alice-notes")
	bob := notesQuerierTestUser(t, pool, "bob-notes")

	anchor := json.RawMessage(`{"exact":"quan trọng","prefix":"a","suffix":"b","color":"y"}`)
	if err := repo.CreateAnnotation(context.Background(), alice, userdata.AnnotationRow{
		ID: uuid.New(), CourseID: "course-a", ChapterID: "ch1", Anchor: anchor, Note: "alice's private note",
	}); err != nil {
		t.Fatalf("seed alice annotation: %v", err)
	}
	if err := repo.CreateAnnotation(context.Background(), bob, userdata.AnnotationRow{
		ID: uuid.New(), CourseID: "course-a", ChapterID: "ch1", Anchor: anchor, Note: "bob's private note",
	}); err != nil {
		t.Fatalf("seed bob annotation: %v", err)
	}

	got, err := q.Notes(context.Background(), alice, "course-a")
	if err != nil {
		t.Fatalf("Notes: %v", err)
	}
	if len(got) != 1 || got[0].Note != "alice's private note" {
		t.Fatalf("alice's read must contain only her own note, got %+v", got)
	}
	for _, n := range got {
		if n.Note == "bob's private note" {
			t.Fatal("bob's note leaked into alice's read — the confused-deputy property " +
				"this whole task exists to protect")
		}
	}
}

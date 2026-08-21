// Package course_test exercises the course-package repository against a
// real Postgres (via store.TestPool), at the repository level rather than
// through HTTP: this task builds only the storage layer, and the routes
// that will sit on top of it land in a later task. It is an external test
// package (course_test, not course) so it can only reach the same exported
// surface a future handler package will — if a test here needs something
// unexported, that is a signal the interface is wrong, not that the test
// should move inside the package.
//
// Container cost note: the three tests this task's brief names are
// mandated as top-level functions, and store.TestPool is keyed to a
// *testing.T, so each one gets its own disposable postgres container
// rather than sharing one the way internal/sync's single TestSyncFlows
// does. That is a deliberate trade (a few extra seconds per run) to keep
// the three named tests independent and individually runnable with -run;
// the supplementary coverage is grouped under one further top-level test
// so it costs only one more container instead of one per case.
package course_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/course"
	"github.com/vndee/tuhoc-api/internal/store"
)

// sampleUncompressedBytes is deliberately far larger than the sample blob
// returned by sampleBlob(). Package.Bytes is the UNCOMPRESSED total, not
// the size of the stored .zip, and the two must never be conflated: the
// ingest ceiling a later task enforces is applied to this number
// precisely because a zip bomb is tiny on disk and enormous once
// expanded. Any implementation that "helpfully" derives the column from
// len(blob) fails TestPutThenGetRoundTrips on this value.
const sampleUncompressedBytes int64 = 5 << 20 // 5 MiB

// sampleBlob returns bytes that are emphatically not valid UTF-8 text: a
// zip local-file-header magic followed by a spread of byte values that
// includes 0x00 and 0xFF. A bytea column that were mistakenly handled as
// a string somewhere in the round trip would corrupt or truncate at the
// NUL, so the blob assertions below are byte-exact on purpose.
func sampleBlob() []byte {
	b := []byte{'P', 'K', 0x03, 0x04}
	for i := 0; i < 60; i++ {
		b = append(b, byte(i*4))
	}
	return append(b, 0xFF, 0x00, 0xFE)
}

// newOwner inserts a real users row and returns its id. course_packages
// declares owner_id as a foreign key into users(id), so every test needs
// genuine owners rather than freshly minted uuids; going straight to SQL
// (instead of through the auth HTTP handlers, as internal/sync's tests
// do) keeps this package's tests free of any dependency on auth.
func newOwner(t *testing.T, pool *pgxpool.Pool, label string) uuid.UUID {
	t.Helper()

	var id uuid.UUID
	email := fmt.Sprintf("course-%s-%s@example.test", label, uuid.NewString())
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (email, name, pw_hash) VALUES ($1,$2,$3) RETURNING id`,
		email, label, "not-a-real-hash").Scan(&id)
	if err != nil {
		t.Fatalf("create owner %s: %v", label, err)
	}
	return id
}

// samplePackage builds a valid Package for ownerID. Callers override
// whatever field the case under test is actually about.
func samplePackage(ownerID uuid.UUID, courseID, version string) course.Package {
	return course.Package{
		OwnerID:  ownerID,
		CourseID: courseID,
		Version:  version,
		Tier:     "content",
		Lang:     "vi",
		Title:    "***REMOVED***",
		Manifest: json.RawMessage(fmt.Sprintf(
			`{"id":%q,"version":%q,"lang":"vi","chapters":["p0-1","p0-2"]}`, courseID, version)),
		Blob:  sampleBlob(),
		Bytes: sampleUncompressedBytes,
	}
}

// assertJSONEqual compares two JSON documents by value, not by bytes.
// Postgres jsonb is a parsed representation: it does not preserve key
// order, insignificant whitespace, or duplicate keys, so a manifest read
// back out is semantically identical but rarely byte-identical to the one
// written in. Comparing raw bytes here would produce a test that fails for
// a reason that has nothing to do with the code under test.
func assertJSONEqual(t *testing.T, what string, want, got json.RawMessage) {
	t.Helper()

	var wantV, gotV any
	if err := json.Unmarshal(want, &wantV); err != nil {
		t.Fatalf("%s: unmarshal want: %v (raw=%s)", what, err, want)
	}
	if err := json.Unmarshal(got, &gotV); err != nil {
		t.Fatalf("%s: unmarshal got: %v (raw=%s)", what, err, got)
	}
	if !reflect.DeepEqual(wantV, gotV) {
		t.Fatalf("%s: want %s got %s", what, want, got)
	}
}

// TestPutThenGetRoundTrips is the brief's first named case: a package that
// goes in must come back out intact, field for field. It asserts every
// column rather than a representative sample, because the failure mode
// this guards against (a column dropped from the INSERT, or the SELECT's
// column order not matching the Scan's argument order) shows up as one
// specific field being empty or holding a neighbour's value.
func TestPutThenGetRoundTrips(t *testing.T) {
	pool := store.TestPool(t)
	repo := course.NewRepo(pool)
	ctx := context.Background()

	owner := newOwner(t, pool, "roundtrip")
	want := samplePackage(owner, "***REMOVED***", "1.2.3")

	before := time.Now().UTC().Add(-time.Minute)
	if err := repo.Put(ctx, want); err != nil {
		t.Fatalf("Put: %v", err)
	}

	got, err := repo.Get(ctx, owner, want.CourseID, want.Version)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}

	if got.OwnerID != want.OwnerID {
		t.Errorf("OwnerID: want %s got %s", want.OwnerID, got.OwnerID)
	}
	if got.CourseID != want.CourseID {
		t.Errorf("CourseID: want %q got %q", want.CourseID, got.CourseID)
	}
	if got.Version != want.Version {
		t.Errorf("Version: want %q got %q", want.Version, got.Version)
	}
	if got.Tier != want.Tier {
		t.Errorf("Tier: want %q got %q", want.Tier, got.Tier)
	}
	if got.Lang != want.Lang {
		t.Errorf("Lang: want %q got %q", want.Lang, got.Lang)
	}
	if got.Title != want.Title {
		t.Errorf("Title: want %q got %q", want.Title, got.Title)
	}
	assertJSONEqual(t, "Manifest", want.Manifest, got.Manifest)

	if !reflect.DeepEqual(got.Blob, want.Blob) {
		t.Errorf("Blob: want %d bytes %v got %d bytes %v",
			len(want.Blob), want.Blob, len(got.Blob), got.Blob)
	}

	// The load-bearing assertion for the uncompressed-size rule: Bytes is
	// what the caller supplied, which is nothing like len(Blob).
	if got.Bytes != want.Bytes {
		t.Errorf("Bytes: want %d (uncompressed) got %d", want.Bytes, got.Bytes)
	}
	if got.Bytes == int64(len(got.Blob)) {
		t.Errorf("Bytes (%d) equals len(Blob) (%d): the stored size must be the "+
			"UNCOMPRESSED total, not the size of the compressed blob",
			got.Bytes, len(got.Blob))
	}

	if got.CreatedAt.IsZero() {
		t.Error("CreatedAt: want a database-assigned timestamp, got the zero time")
	}
	if got.CreatedAt.Before(before) {
		t.Errorf("CreatedAt: want a timestamp at or after %s, got %s", before, got.CreatedAt)
	}
}

// TestOwnerCannotReadAnotherOwnersPackage is the brief's second named
// case, and the reason owner_id is part of the primary key rather than a
// column hanging off a globally-keyed row. Cross-account leakage is a
// failure class this project has already shipped once, so the assertions
// here are deliberately paranoid: it is not enough that Get returns an
// error, the returned Package must also carry none of A's data, and the
// two list methods must not leak through the side door either.
//
// The final assertion — that A can still read its own package — is what
// stops this test from passing vacuously. Without it, a repository whose
// Get unconditionally returned ErrNotFound would look perfectly secure.
func TestOwnerCannotReadAnotherOwnersPackage(t *testing.T) {
	pool := store.TestPool(t)
	repo := course.NewRepo(pool)
	ctx := context.Background()

	ownerA := newOwner(t, pool, "leak-a")
	ownerB := newOwner(t, pool, "leak-b")

	const courseID = "***REMOVED***"
	const version = "1.0.0"

	pkgA := samplePackage(ownerA, courseID, version)
	pkgA.Title = "A's private import"
	if err := repo.Put(ctx, pkgA); err != nil {
		t.Fatalf("Put as A: %v", err)
	}

	// B asks for exactly the identifiers A used.
	got, err := repo.Get(ctx, ownerB, courseID, version)
	if !errors.Is(err, course.ErrNotFound) {
		t.Fatalf("Get as B: want course.ErrNotFound, got err=%v package=%+v", err, got)
	}
	if got.Title != "" || got.Blob != nil || got.OwnerID != uuid.Nil || got.CourseID != "" {
		t.Errorf("Get as B: not-found result must be the zero Package, got %+v", got)
	}

	// The list methods must agree with Get: B owns nothing.
	versions, err := repo.ListVersions(ctx, ownerB, courseID)
	if err != nil {
		t.Fatalf("ListVersions as B: %v", err)
	}
	if len(versions) != 0 {
		t.Errorf("ListVersions as B: want none, got %v", versions)
	}

	owned, err := repo.ListForOwner(ctx, ownerB)
	if err != nil {
		t.Fatalf("ListForOwner as B: %v", err)
	}
	if len(owned) != 0 {
		t.Errorf("ListForOwner as B: want none, got %+v", owned)
	}

	// Anti-vacuity: the row genuinely exists and A can still read it.
	mine, err := repo.Get(ctx, ownerA, courseID, version)
	if err != nil {
		t.Fatalf("Get as A: want A's own package back, got error %v", err)
	}
	if mine.Title != "A's private import" {
		t.Errorf("Get as A: want title %q got %q", "A's private import", mine.Title)
	}
}

// TestListVersionsSortsSemverNotLexically is the brief's third named case.
// Sorting these strings in SQL with ORDER BY version yields
// 1.0.0, 1.10.0, 1.9.0 — wrong, and wrong without any error, warning, or
// visible symptom until someone is served an older package than the one
// they asked for. The versions are inserted in an order that matches
// neither the lexical result nor the correct one, so a repository that
// simply returned rows in insertion order would fail too.
func TestListVersionsSortsSemverNotLexically(t *testing.T) {
	pool := store.TestPool(t)
	repo := course.NewRepo(pool)
	ctx := context.Background()

	owner := newOwner(t, pool, "semver")
	const courseID = "***REMOVED***"

	for _, v := range []string{"1.10.0", "1.0.0", "1.9.0"} {
		if err := repo.Put(ctx, samplePackage(owner, courseID, v)); err != nil {
			t.Fatalf("Put %s: %v", v, err)
		}
	}

	got, err := repo.ListVersions(ctx, owner, courseID)
	if err != nil {
		t.Fatalf("ListVersions: %v", err)
	}

	want := []string{"1.0.0", "1.9.0", "1.10.0"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("ListVersions: want %v got %v (lexical sorting would give %v)",
			want, got, []string{"1.0.0", "1.10.0", "1.9.0"})
	}
}

// TestRepoContracts covers the rest of the mandated interface — the parts
// the three named cases above do not reach — under a single shared
// container. ListForOwner in particular would otherwise ship with no test
// at all.
func TestRepoContracts(t *testing.T) {
	pool := store.TestPool(t)
	repo := course.NewRepo(pool)
	ctx := context.Background()

	t.Run("Get reports a missing version as not found", func(t *testing.T) {
		owner := newOwner(t, pool, "missing")
		if err := repo.Put(ctx, samplePackage(owner, "c1", "1.0.0")); err != nil {
			t.Fatalf("Put: %v", err)
		}

		got, err := repo.Get(ctx, owner, "c1", "2.0.0")
		if !errors.Is(err, course.ErrNotFound) {
			t.Fatalf("Get unknown version: want course.ErrNotFound, got err=%v package=%+v", err, got)
		}

		got, err = repo.Get(ctx, owner, "no-such-course", "1.0.0")
		if !errors.Is(err, course.ErrNotFound) {
			t.Fatalf("Get unknown course: want course.ErrNotFound, got err=%v package=%+v", err, got)
		}
	})

	t.Run("ListForOwner returns metadata for every package but no blobs", func(t *testing.T) {
		owner := newOwner(t, pool, "listowner")
		for _, spec := range []struct{ courseID, version string }{
			{"zz-later-course", "1.0.0"},
			{"aa-first-course", "1.10.0"},
			{"aa-first-course", "1.2.0"},
		} {
			if err := repo.Put(ctx, samplePackage(owner, spec.courseID, spec.version)); err != nil {
				t.Fatalf("Put %s@%s: %v", spec.courseID, spec.version, err)
			}
		}

		got, err := repo.ListForOwner(ctx, owner)
		if err != nil {
			t.Fatalf("ListForOwner: %v", err)
		}
		if len(got) != 3 {
			t.Fatalf("ListForOwner: want 3 packages, got %d (%+v)", len(got), got)
		}

		// Ordered by course id, then by semver within a course — so the
		// same lexical trap ListVersions avoids is avoided here too.
		wantOrder := []string{
			"aa-first-course@1.2.0",
			"aa-first-course@1.10.0",
			"zz-later-course@1.0.0",
		}
		var gotOrder []string
		for _, p := range got {
			gotOrder = append(gotOrder, p.CourseID+"@"+p.Version)
		}
		if !reflect.DeepEqual(gotOrder, wantOrder) {
			t.Errorf("ListForOwner order: want %v got %v", wantOrder, gotOrder)
		}

		for _, p := range got {
			if p.Blob != nil {
				t.Errorf("ListForOwner %s@%s: Blob must be nil on a listing (%d bytes returned) — "+
					"listings must not load every package body into memory",
					p.CourseID, p.Version, len(p.Blob))
			}
			if p.Title == "" || p.Lang == "" || p.Tier == "" {
				t.Errorf("ListForOwner %s@%s: want metadata populated, got %+v", p.CourseID, p.Version, p)
			}
			if p.Bytes != sampleUncompressedBytes {
				t.Errorf("ListForOwner %s@%s: Bytes want %d got %d",
					p.CourseID, p.Version, sampleUncompressedBytes, p.Bytes)
			}
			if len(p.Manifest) == 0 {
				t.Errorf("ListForOwner %s@%s: want manifest populated", p.CourseID, p.Version)
			}
			if p.OwnerID != owner {
				t.Errorf("ListForOwner %s@%s: OwnerID want %s got %s", p.CourseID, p.Version, owner, p.OwnerID)
			}
		}
	})

	t.Run("Put replaces an existing version for the same owner", func(t *testing.T) {
		owner := newOwner(t, pool, "replace")

		first := samplePackage(owner, "c-replace", "1.0.0")
		first.Title = "first import"
		if err := repo.Put(ctx, first); err != nil {
			t.Fatalf("Put first: %v", err)
		}

		second := samplePackage(owner, "c-replace", "1.0.0")
		second.Title = "re-imported"
		second.Blob = append(sampleBlob(), 'X')
		second.Bytes = sampleUncompressedBytes + 1
		if err := repo.Put(ctx, second); err != nil {
			t.Fatalf("Put second (same version): %v", err)
		}

		got, err := repo.Get(ctx, owner, "c-replace", "1.0.0")
		if err != nil {
			t.Fatalf("Get: %v", err)
		}
		if got.Title != "re-imported" {
			t.Errorf("Title: want the replacement %q, got %q", "re-imported", got.Title)
		}
		if !reflect.DeepEqual(got.Blob, second.Blob) {
			t.Errorf("Blob: want the replacement's %d bytes, got %d", len(second.Blob), len(got.Blob))
		}
		if got.Bytes != second.Bytes {
			t.Errorf("Bytes: want %d got %d", second.Bytes, got.Bytes)
		}

		versions, err := repo.ListVersions(ctx, owner, "c-replace")
		if err != nil {
			t.Fatalf("ListVersions: %v", err)
		}
		if !reflect.DeepEqual(versions, []string{"1.0.0"}) {
			t.Errorf("ListVersions after replace: want exactly one row, got %v", versions)
		}
	})

	t.Run("Put by one owner never disturbs another owner's same-named version", func(t *testing.T) {
		ownerA := newOwner(t, pool, "overwrite-a")
		ownerB := newOwner(t, pool, "overwrite-b")

		a := samplePackage(ownerA, "c-shared", "1.0.0")
		a.Title = "A's copy"
		if err := repo.Put(ctx, a); err != nil {
			t.Fatalf("Put as A: %v", err)
		}

		b := samplePackage(ownerB, "c-shared", "1.0.0")
		b.Title = "B's copy"
		if err := repo.Put(ctx, b); err != nil {
			t.Fatalf("Put as B: %v", err)
		}

		gotA, err := repo.Get(ctx, ownerA, "c-shared", "1.0.0")
		if err != nil {
			t.Fatalf("Get as A: %v", err)
		}
		if gotA.Title != "A's copy" {
			t.Errorf("A's package was overwritten by B's Put: want %q got %q", "A's copy", gotA.Title)
		}

		gotB, err := repo.Get(ctx, ownerB, "c-shared", "1.0.0")
		if err != nil {
			t.Fatalf("Get as B: %v", err)
		}
		if gotB.Title != "B's copy" {
			t.Errorf("B's package: want %q got %q", "B's copy", gotB.Title)
		}
	})

	t.Run("ListVersions orders prereleases below their release", func(t *testing.T) {
		owner := newOwner(t, pool, "prerelease")
		const courseID = "c-prerelease"

		// Inserted in an order that is neither lexical nor correct.
		for _, v := range []string{"1.0.0", "2.0.0-rc.10", "1.0.0-rc.2", "2.0.0-rc.2", "1.0.0-rc.1"} {
			if err := repo.Put(ctx, samplePackage(owner, courseID, v)); err != nil {
				t.Fatalf("Put %s: %v", v, err)
			}
		}

		got, err := repo.ListVersions(ctx, owner, courseID)
		if err != nil {
			t.Fatalf("ListVersions: %v", err)
		}

		// Per semver precedence: a prerelease sorts below the release that
		// shares its core, and numeric prerelease identifiers compare
		// numerically (rc.2 < rc.10), not as strings.
		want := []string{"1.0.0-rc.1", "1.0.0-rc.2", "1.0.0", "2.0.0-rc.2", "2.0.0-rc.10"}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("ListVersions: want %v got %v", want, got)
		}
	})

	t.Run("ListVersions and ListForOwner return empty, not nil-shaped errors, for a stranger", func(t *testing.T) {
		owner := newOwner(t, pool, "empty")

		versions, err := repo.ListVersions(ctx, owner, "never-imported")
		if err != nil {
			t.Fatalf("ListVersions: %v", err)
		}
		if len(versions) != 0 {
			t.Errorf("ListVersions: want none, got %v", versions)
		}

		owned, err := repo.ListForOwner(ctx, owner)
		if err != nil {
			t.Fatalf("ListForOwner: %v", err)
		}
		if len(owned) != 0 {
			t.Errorf("ListForOwner: want none, got %+v", owned)
		}
	})
}

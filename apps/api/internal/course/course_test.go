// Package course_test exercises the course package against a real
// Postgres (via store.TestPool) at two levels: the repository directly,
// and the HTTP routes through internal/server.New — the same wiring the
// web client depends on. It is an external test package (course_test, not
// course) so it can only reach the same exported surface the rest of the
// API can: if a test here needs something unexported, that is a signal the
// interface is wrong, not that the test should move inside the package.
//
// Container cost note: the tests the two briefs name are mandated as
// top-level functions, and store.TestPool is keyed to a *testing.T, so
// each one gets its own disposable postgres container rather than sharing
// one the way internal/sync's single TestSyncFlows does. That is a
// deliberate trade (a few extra seconds per run) to keep the named tests
// independent and individually runnable with -run; the supplementary
// coverage is grouped under two further top-level tests (TestRepoContracts
// and TestCourseHTTPContracts) so it costs two more containers instead of
// one per case.
package course_test

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jackc/pgerrcode"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/vndee/tuhoc-api/internal/auth"
	"github.com/vndee/tuhoc-api/internal/config"
	"github.com/vndee/tuhoc-api/internal/course"
	"github.com/vndee/tuhoc-api/internal/server"
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
//
// It still fills in OwnerID even though Put ignores that field: the
// round-trip assertions read it back, and one subtest below sets it to a
// *different* owner on purpose to prove the field cannot steer a write.
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
	if err := repo.Put(ctx, owner, want); err != nil {
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
	if err := repo.Put(ctx, ownerA, pkgA); err != nil {
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
		if err := repo.Put(ctx, owner, samplePackage(owner, courseID, v)); err != nil {
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
		if err := repo.Put(ctx, owner, samplePackage(owner, "c1", "1.0.0")); err != nil {
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
			if err := repo.Put(ctx, owner, samplePackage(owner, spec.courseID, spec.version)); err != nil {
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
		if err := repo.Put(ctx, owner, first); err != nil {
			t.Fatalf("Put first: %v", err)
		}

		second := samplePackage(owner, "c-replace", "1.0.0")
		second.Title = "re-imported"
		second.Blob = append(sampleBlob(), 'X')
		second.Bytes = sampleUncompressedBytes + 1
		// Tier and lang are re-imported too. They are easy to leave out of
		// the upsert's SET clause — no test noticed their absence until a
		// review mutated them away — and a package that keeps a stale tier
		// forever is rendered by the wrong reader with no error anywhere.
		second.Tier = "interactive"
		second.Lang = "en"
		if err := repo.Put(ctx, owner, second); err != nil {
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
		if got.Tier != second.Tier {
			t.Errorf("Tier not refreshed on replace: want %q got %q", second.Tier, got.Tier)
		}
		if got.Lang != second.Lang {
			t.Errorf("Lang not refreshed on replace: want %q got %q", second.Lang, got.Lang)
		}

		versions, err := repo.ListVersions(ctx, owner, "c-replace")
		if err != nil {
			t.Fatalf("ListVersions: %v", err)
		}
		if !reflect.DeepEqual(versions, []string{"1.0.0"}) {
			t.Errorf("ListVersions after replace: want exactly one row, got %v", versions)
		}
	})

	// The owner a write lands under comes from the ownerID argument — the
	// authenticated caller — and from nowhere else. This subtest is the
	// review's measured attack turned into a control: an attacker fills in
	// the victim's id in the one place a request body could reach,
	// Package.OwnerID, and calls Put as itself. Before Put took an ownerID
	// argument the measurement was
	// `err=<nil> victimRowTitle="PWNED BY ATTACKER" attackerRows=0`; the
	// forged field must now be inert.
	t.Run("Put ignores an OwnerID field the caller did not authenticate as", func(t *testing.T) {
		victim := newOwner(t, pool, "forge-victim")
		attacker := newOwner(t, pool, "forge-attacker")

		legit := samplePackage(victim, "c-forge", "1.0.0")
		legit.Title = "victim's own import"
		if err := repo.Put(ctx, victim, legit); err != nil {
			t.Fatalf("Put as victim: %v", err)
		}

		forged := samplePackage(attacker, "c-forge", "1.0.0")
		forged.Title = "PWNED BY ATTACKER"
		forged.OwnerID = victim // the field an attacker controls
		if err := repo.Put(ctx, attacker, forged); err != nil {
			t.Fatalf("Put as attacker: %v", err)
		}

		stillVictims, err := repo.Get(ctx, victim, "c-forge", "1.0.0")
		if err != nil {
			t.Fatalf("Get as victim: %v", err)
		}
		if stillVictims.Title != "victim's own import" {
			t.Errorf("victim's row was overwritten by a forged Package.OwnerID: want %q got %q",
				"victim's own import", stillVictims.Title)
		}

		// Anti-vacuity: the write did happen — under the attacker's own id.
		mine, err := repo.Get(ctx, attacker, "c-forge", "1.0.0")
		if err != nil {
			t.Fatalf("Get as attacker: want the attacker's own row, got %v", err)
		}
		if mine.Title != "PWNED BY ATTACKER" {
			t.Errorf("attacker's own row: want %q got %q", "PWNED BY ATTACKER", mine.Title)
		}
		if mine.OwnerID != attacker {
			t.Errorf("stored owner_id: want the ownerID argument %s, got %s", attacker, mine.OwnerID)
		}
	})

	t.Run("Put by one owner never disturbs another owner's same-named version", func(t *testing.T) {
		ownerA := newOwner(t, pool, "overwrite-a")
		ownerB := newOwner(t, pool, "overwrite-b")

		a := samplePackage(ownerA, "c-shared", "1.0.0")
		a.Title = "A's copy"
		if err := repo.Put(ctx, ownerA, a); err != nil {
			t.Fatalf("Put as A: %v", err)
		}

		b := samplePackage(ownerB, "c-shared", "1.0.0")
		b.Title = "B's copy"
		if err := repo.Put(ctx, ownerB, b); err != nil {
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
			if err := repo.Put(ctx, owner, samplePackage(owner, courseID, v)); err != nil {
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

	// ListVersions filters on TWO columns, and the second one had no
	// control: every owner elsewhere in this file holds exactly one
	// course, so dropping "AND course_id = $2" changed no result anywhere.
	// A review measured the gap — ListVersions(owner, "course-alpha")
	// returning [1.0.0 1.1.0 7.0.0 8.0.0] — and this is the case that
	// closes it: one owner, two courses, versions that cannot be confused
	// for each other. The failure it guards against is not cross-account
	// leakage (owner_id survives) but the quiet kind: a caller taking the
	// last element as "newest" is handed a version that does not exist for
	// the course it asked about, and the Get that follows 404s.
	t.Run("ListVersions is scoped to one course, not to the whole owner", func(t *testing.T) {
		owner := newOwner(t, pool, "twocourses")
		for _, spec := range []struct{ courseID, version string }{
			{"course-alpha", "1.0.0"},
			{"course-alpha", "1.1.0"},
			{"course-beta", "7.0.0"},
			{"course-beta", "8.0.0"},
		} {
			if err := repo.Put(ctx, owner, samplePackage(owner, spec.courseID, spec.version)); err != nil {
				t.Fatalf("Put %s@%s: %v", spec.courseID, spec.version, err)
			}
		}

		alpha, err := repo.ListVersions(ctx, owner, "course-alpha")
		if err != nil {
			t.Fatalf("ListVersions alpha: %v", err)
		}
		if want := []string{"1.0.0", "1.1.0"}; !reflect.DeepEqual(alpha, want) {
			t.Errorf("ListVersions(course-alpha): want %v got %v — versions of another "+
				"course this owner holds must not appear", want, alpha)
		}

		// Symmetric, so the assertion cannot be satisfied by a filter that
		// happens to pin the first course inserted.
		beta, err := repo.ListVersions(ctx, owner, "course-beta")
		if err != nil {
			t.Fatalf("ListVersions beta: %v", err)
		}
		if want := []string{"7.0.0", "8.0.0"}; !reflect.DeepEqual(beta, want) {
			t.Errorf("ListVersions(course-beta): want %v got %v", want, beta)
		}
	})

	// ErrNotFound must mean "this owner has no such package" and nothing
	// else. Widening the pgx.ErrNoRows check to "any error" passes every
	// other test in this file, because no other test ever makes the query
	// itself fail — and the consequence is a database outage rendered as a
	// 404 telling the user their package does not exist. A cancelled
	// context is the cheapest real infrastructure failure to produce.
	t.Run("Get reports an infrastructure failure as itself, not as not found", func(t *testing.T) {
		owner := newOwner(t, pool, "infra")
		if err := repo.Put(ctx, owner, samplePackage(owner, "c-infra", "1.0.0")); err != nil {
			t.Fatalf("Put: %v", err)
		}

		dead, cancel := context.WithCancel(ctx)
		cancel()

		got, err := repo.Get(dead, owner, "c-infra", "1.0.0")
		if err == nil {
			t.Fatalf("Get on a cancelled context: want an error, got package %+v", got)
		}
		if errors.Is(err, course.ErrNotFound) {
			t.Errorf("Get on a cancelled context returned ErrNotFound (%v): a caller cannot "+
				"tell a broken database from a missing package, and will answer 404", err)
		}
		if !errors.Is(err, context.Canceled) {
			t.Errorf("Get on a cancelled context: want an error wrapping context.Canceled, got %v", err)
		}

		// Anti-vacuity: the row is there, and a healthy call still reads it.
		// Without this, a Get that always failed would pass the above.
		if _, err := repo.Get(ctx, owner, "c-infra", "1.0.0"); err != nil {
			t.Fatalf("Get with a live context: want the package back, got %v", err)
		}
	})

	// bytes is an uncompressed total, so a negative value is not a small
	// package, it is corrupt data — and it poisons any sum a later task
	// computes over a library. The ingest ceiling stays out of this layer
	// (that number belongs where it is produced, and duplicating it is how
	// two copies drift), but "not negative" costs one CHECK and duplicates
	// nothing.
	t.Run("Put refuses a negative Bytes", func(t *testing.T) {
		owner := newOwner(t, pool, "negbytes")

		bad := samplePackage(owner, "c-negative", "1.0.0")
		bad.Bytes = -1
		if err := repo.Put(ctx, owner, bad); err == nil {
			t.Errorf("Put with Bytes=-1: want an error, got nil")
		}
		if _, err := repo.Get(ctx, owner, "c-negative", "1.0.0"); !errors.Is(err, course.ErrNotFound) {
			t.Errorf("a rejected Put must leave no row behind: Get returned %v", err)
		}

		// Anti-vacuity, and the boundary itself: zero is a legal size (an
		// empty package is odd, not corrupt), so the constraint must be
		// >= 0 and not > 0.
		zero := samplePackage(owner, "c-zero-bytes", "1.0.0")
		zero.Bytes = 0
		if err := repo.Put(ctx, owner, zero); err != nil {
			t.Errorf("Put with Bytes=0: want it stored, got %v", err)
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

// ---------------------------------------------------------------------
// HTTP layer (Task 6)
//
// Everything below exercises the routes through internal/server.New — the
// same wiring the web client depends on — rather than calling the handler
// directly, so the auth middleware, the route patterns, and the body
// limit are all part of what is under test. internal/sync's tests take
// the same approach and for the same reason.
//
// Container cost note (extending the one at the top of this file): the
// five tests the brief names by name each get their own container so they
// stay individually runnable with -run; every other HTTP case is grouped
// under TestCourseHTTPContracts so the supplementary coverage costs one
// container, not one per case.
// ---------------------------------------------------------------------

const sessionCookieName = "tuhoc_session"

// manifestPath is where a manifest must live inside a package. Spelled
// out here rather than imported so this test states the contract itself:
// packages/course-format/src/validate.ts's MANIFEST_PATH is the rule, and
// a Go constant that silently changed with it would take this assertion
// along for the ride.
const manifestPath = "manifest.json"

func newTestApp(pool *pgxpool.Pool) *fiber.App {
	return server.New(config.Config{CookieSecure: false}, server.Deps{Pool: pool, LogOutput: io.Discard})
}

// registerUser creates a real account through the real /auth/register
// route and returns its session cookie and user id. HTTP-level tests need
// a genuine session (auth.Require validates it against the sessions
// table), which newOwner's straight-to-SQL insert cannot provide.
//
// Each caller gets its own fiber.App: /auth/* carries a 10-per-minute
// rate limiter whose storage is per-App, so sharing one App across many
// registrations would eventually start answering 429 for reasons that
// have nothing to do with the case under test.
func registerUser(t *testing.T, app *fiber.App, label string) (*http.Cookie, uuid.UUID) {
	t.Helper()

	email := fmt.Sprintf("course-http-%s-%s@example.test", label, uuid.NewString())
	body, err := json.Marshal(map[string]string{"email": email, "password": "course-test-password-1", "name": label})
	if err != nil {
		t.Fatalf("register %s: marshal: %v", label, err)
	}
	req := httptest.NewRequest(http.MethodPost, "/auth/register", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	resp, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("register %s: %v", label, err)
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("register %s: want 200 got %d body=%s", label, resp.StatusCode, raw)
	}

	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("register %s: unmarshal: %v (body=%s)", label, err, raw)
	}
	id, err := uuid.Parse(out.ID)
	if err != nil {
		t.Fatalf("register %s: bad id %q: %v", label, out.ID, err)
	}

	var cookie *http.Cookie
	for _, ck := range resp.Cookies() {
		if ck.Name == sessionCookieName {
			cookie = ck
		}
	}
	if cookie == nil {
		t.Fatalf("register %s: no session cookie", label)
	}
	return cookie, id
}

const httpTimeoutMS = 30000

// zipEntry is one file inside a package under construction. A slice
// rather than a map so entry order is fixed — a zip's central directory
// is ordered, and a test that shuffled it would be reproducing a
// different archive on every run.
type zipEntry struct {
	name string
	data []byte
}

// buildZip writes entries into an in-memory .zip. It uses CreateHeader
// rather than Create so a deliberately hostile entry name ("../evil.html")
// is written verbatim: the whole point of TestPostRejectsPathEscape is
// that such a name reaches the server.
func buildZip(t *testing.T, entries []zipEntry) []byte {
	t.Helper()

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, e := range entries {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: e.name, Method: zip.Deflate})
		if err != nil {
			t.Fatalf("zip: create %q: %v", e.name, err)
		}
		if _, err := w.Write(e.data); err != nil {
			t.Fatalf("zip: write %q: %v", e.name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip: close: %v", err)
	}
	return buf.Bytes()
}

// manifestDoc builds a manifest that packages/course-format's own
// validator would accept, so a package built from it fails only for the
// reason the case under test introduces. Callers mutate the returned map
// to break exactly one thing.
func manifestDoc(courseID, version string, chapterFiles ...string) map[string]any {
	chapters := make([]map[string]any, 0, len(chapterFiles))
	for i, f := range chapterFiles {
		chapters = append(chapters, map[string]any{
			"id":    fmt.Sprintf("ch-%d", i+1),
			"num":   fmt.Sprintf("%d", i+1),
			"title": fmt.Sprintf("Chương %d", i+1),
			"short": fmt.Sprintf("Ch %d", i+1),
			"file":  f,
		})
	}
	return map[string]any{
		"id":          courseID,
		"title":       "***REMOVED***",
		"description": "Một câu mô tả.",
		"lang":        "vi",
		"version":     version,
		"runtime":     "^1",
		"tier":        "content",
		"license":     "CC-BY-4.0",
		"authors":     []map[string]any{{"name": "Tác giả"}},
		"generatedBy": "human",
		"parts":       []map[string]any{{"title": "Phần I", "chapters": chapters}},
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return b
}

const sampleChapterHTML = "<h1>Chương 1</h1><p>Nội dung.</p>"

// validPackage is a package that must import cleanly: manifest at the
// root, one chapter, nothing hostile.
func validPackage(t *testing.T, courseID, version string) []byte {
	t.Helper()
	return buildZip(t, []zipEntry{
		{manifestPath, mustJSON(t, manifestDoc(courseID, version, "chapters/ch-1.html"))},
		{"chapters/ch-1.html", []byte(sampleChapterHTML)},
	})
}

// postPackage uploads zipBytes as multipart field "package".
//
// extraFields are written as sibling form fields. Every call in this file
// that passes any is trying to make the server read an identity out of
// the request; see TestPostIgnoresClientSuppliedOwnerID.
func postPackage(t *testing.T, app *fiber.App, cookie *http.Cookie, target string, zipBytes []byte, extraFields map[string]string) (*http.Response, []byte) {
	t.Helper()

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for k, v := range extraFields {
		if err := mw.WriteField(k, v); err != nil {
			t.Fatalf("multipart: field %q: %v", k, err)
		}
	}
	fw, err := mw.CreateFormFile("package", "course.zip")
	if err != nil {
		t.Fatalf("multipart: create file: %v", err)
	}
	if _, err := fw.Write(zipBytes); err != nil {
		t.Fatalf("multipart: write zip: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("multipart: close: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, target, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if cookie != nil {
		req.AddCookie(cookie)
	}

	resp, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("POST %s: %v", target, err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("POST %s: read body: %v", target, err)
	}
	resp.Body.Close()
	return resp, raw
}

func doGet(t *testing.T, app *fiber.App, target string, cookie *http.Cookie) (*http.Response, []byte) {
	t.Helper()

	req := httptest.NewRequest(http.MethodGet, target, nil)
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := app.Test(req, httpTimeoutMS)
	if err != nil {
		t.Fatalf("GET %s: %v", target, err)
	}
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("GET %s: read body: %v", target, err)
	}
	resp.Body.Close()
	return resp, raw
}

// countRowsFor is the "did anything reach storage" probe. Every rejection
// test in this file asserts on it as well as on the status code: a review
// of the storage layer measured Bytes = 5 GiB being stored happily
// because no layer enforced a ceiling, so a 413 on its own proves only
// that the response was shaped right, not that the write was stopped.
func countRowsFor(t *testing.T, pool *pgxpool.Pool, ownerID uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM course_packages WHERE owner_id = $1`, ownerID).Scan(&n); err != nil {
		t.Fatalf("count rows for %s: %v", ownerID, err)
	}
	return n
}

// countAllRows is countRowsFor's stronger sibling: a write that landed
// under some *other* owner id (the failure mode ruling S1-F12 is about)
// is invisible to a per-owner count.
func countAllRows(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM course_packages`).Scan(&n); err != nil {
		t.Fatalf("count all rows: %v", err)
	}
	return n
}

// TestPostRejectsPackageOverLimit is the brief's first named HTTP case and
// the one the storage layer deliberately cannot help with: repo.go holds
// no business rules, so this handler is the ONLY place the 20 MiB ceiling
// exists. A review measured the consequence of that gap directly —
// Bytes = 5 GiB stored, err=<nil> — which is why the assertions below are
// not satisfied by a 413 alone.
//
// The payload is a zip BOMB, not a large upload: it is a few kilobytes on
// the wire and expands past the ceiling. A ceiling checked against the
// compressed size, or against Content-Length, or against fiber's BodyLimit
// would let exactly this payload through, which is the whole reason the
// stored size is the uncompressed total.
func TestPostRejectsPackageOverLimit(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	ctx := context.Background()
	_ = ctx

	cookie, ownerID := registerUser(t, app, "overlimit")

	bomb := buildZip(t, []zipEntry{
		{manifestPath, mustJSON(t, manifestDoc("c-bomb", "1.0.0", "chapters/ch-1.html"))},
		{"chapters/ch-1.html", []byte(sampleChapterHTML)},
		{"assets/zeros.bin", make([]byte, course.MaxUncompressedBytes+1)},
	})
	// Anti-vacuity for the bomb itself: if this ever stopped being small
	// on the wire, the test would be measuring fiber's BodyLimit instead
	// of the ceiling this handler enforces.
	if int64(len(bomb)) > 1<<20 {
		t.Fatalf("the over-limit fixture must stay small COMPRESSED (it is a zip bomb): got %d bytes", len(bomb))
	}

	resp, raw := postPackage(t, app, cookie, "/courses", bomb, nil)
	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("POST over-limit package: want 413 got %d body=%s", resp.StatusCode, raw)
	}

	if n := countRowsFor(t, pool, ownerID); n != 0 {
		t.Errorf("a rejected over-limit package left %d row(s) behind for its uploader: the "+
			"413 was shaped correctly but the write was not stopped", n)
	}
	if n := countAllRows(t, pool); n != 0 {
		t.Errorf("a rejected over-limit package left %d row(s) in course_packages", n)
	}

	// Anti-vacuity: the same route, same session, still accepts a package
	// under the ceiling. Without this a handler that answered 413 to
	// everything would pass.
	okResp, okRaw := postPackage(t, app, cookie, "/courses", validPackage(t, "c-under", "1.0.0"), nil)
	if okResp.StatusCode != http.StatusCreated {
		t.Fatalf("POST under-limit package: want 201 got %d body=%s", okResp.StatusCode, okRaw)
	}
	if n := countRowsFor(t, pool, ownerID); n != 1 {
		t.Errorf("after one accepted import: want 1 row, got %d", n)
	}
}

// TestPostRejectsPathEscape is the brief's second named case. Two
// different surfaces can carry an escaping path — a zip ENTRY NAME and a
// manifest's chapter.file — and both are checked, because they are
// extracted by different code and a fix to one does not cover the other.
//
// The rule mirrors packages/course-format/src/validate.ts's
// escapesPackage: empty, contains a backslash, starts with "/", or has a
// ".." segment.
func TestPostRejectsPathEscape(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie, ownerID := registerUser(t, app, "escape")

	cases := []struct {
		name string
		zip  func(t *testing.T) []byte
	}{
		{"entry name walks out of the package", func(t *testing.T) []byte {
			return buildZip(t, []zipEntry{
				{manifestPath, mustJSON(t, manifestDoc("c-esc", "1.0.0", "chapters/ch-1.html"))},
				{"chapters/ch-1.html", []byte(sampleChapterHTML)},
				{"../evil.html", []byte("owned")},
			})
		}},
		{"entry name is absolute", func(t *testing.T) []byte {
			return buildZip(t, []zipEntry{
				{manifestPath, mustJSON(t, manifestDoc("c-esc", "1.0.0", "chapters/ch-1.html"))},
				{"chapters/ch-1.html", []byte(sampleChapterHTML)},
				{"/etc/passwd", []byte("owned")},
			})
		}},
		{"entry name uses backslash separators", func(t *testing.T) []byte {
			return buildZip(t, []zipEntry{
				{manifestPath, mustJSON(t, manifestDoc("c-esc", "1.0.0", "chapters/ch-1.html"))},
				{"chapters/ch-1.html", []byte(sampleChapterHTML)},
				{`..\..\evil.html`, []byte("owned")},
			})
		}},
		{"manifest chapter.file walks out of the package", func(t *testing.T) []byte {
			return buildZip(t, []zipEntry{
				{manifestPath, mustJSON(t, manifestDoc("c-esc", "1.0.0", "../../etc/passwd"))},
				{"chapters/ch-1.html", []byte(sampleChapterHTML)},
			})
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, raw := postPackage(t, app, cookie, "/courses", tc.zip(t), nil)
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("want 400 got %d body=%s", resp.StatusCode, raw)
			}
			if n := countRowsFor(t, pool, ownerID); n != 0 {
				t.Errorf("a rejected package left %d row(s) behind", n)
			}
			if n := countAllRows(t, pool); n != 0 {
				t.Errorf("a rejected package left %d row(s) in course_packages", n)
			}
		})
	}

	// Anti-vacuity: a package whose paths are all inside the root still
	// imports. Without it, "reject everything" would pass every case above.
	resp, raw := postPackage(t, app, cookie, "/courses", validPackage(t, "c-clean", "1.0.0"), nil)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST clean package: want 201 got %d body=%s", resp.StatusCode, raw)
	}
}

// TestGetAssetCannotEscapePackage is the brief's third named case.
//
// Fiber is configured with UnescapePath off, which means it does NOT
// collapse dot segments before routing: "/courses/x/@1.0.0/../../etc/passwd"
// arrives at the handler with c.Params("*") == "../../etc/passwd", and a
// percent-encoded traversal arrives still encoded. Both facts were
// measured against this fiber version, not assumed, and both are why this
// check has to live in the handler rather than being something the router
// already did.
func TestGetAssetCannotEscapePackage(t *testing.T) {
	pool := store.TestPool(t)
	app := newTestApp(pool)
	cookie, _ := registerUser(t, app, "assetescape")

	resp, raw := postPackage(t, app, cookie, "/courses", validPackage(t, "c-esc", "1.0.0"), nil)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("seed import: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	for _, target := range []string{
		"/courses/c-esc/@1.0.0/../../etc/passwd",
		"/courses/c-esc/@1.0.0/..%2f..%2fetc/passwd",
		"/courses/c-esc/@1.0.0/%2e%2e%2f%2e%2e%2fetc/passwd",
		"/courses/c-esc/@1.0.0/chapters/../../../etc/passwd",
		`/courses/c-esc/@1.0.0/..\..\etc\passwd`,
		"/courses/c-esc/@1.0.0/",
	} {
		t.Run(target, func(t *testing.T) {
			got, body := doGet(t, app, target, cookie)
			if got.StatusCode != http.StatusBadRequest {
				t.Fatalf("want 400 got %d body=%s", got.StatusCode, body)
			}
			// The answer must be an error envelope, not a file. Quoting
			// the path the CLIENT sent back at it is fine and useful;
			// what would not be fine is any byte of the file it aimed at,
			// so the probe is for /etc/passwd's own content rather than
			// for the request's own words.
			if !bytes.Contains(body, []byte(`"error"`)) {
				t.Errorf("the rejection is not an error envelope: %s", body)
			}
			if bytes.Contains(body, []byte("root:")) || bytes.Contains(body, []byte("daemon:")) {
				t.Errorf("the rejection body carries host filesystem content: %s", body)
			}
		})
	}

	// Anti-vacuity: an ordinary asset inside the package is served, byte
	// for byte. A handler that answered 400 to every asset request would
	// otherwise pass every case above.
	ok, body := doGet(t, app, "/courses/c-esc/@1.0.0/chapters/ch-1.html", cookie)
	if ok.StatusCode != http.StatusOK {
		t.Fatalf("GET a real asset: want 200 got %d body=%s", ok.StatusCode, body)
	}
	if string(body) != sampleChapterHTML {
		t.Errorf("GET a real asset: want %q got %q", sampleChapterHTML, body)
	}
}

// courseSummary mirrors GET /courses's JSON contract — see handler.go.
// Declared here rather than exported from the package so a change to the
// wire shape has to be made twice, deliberately, instead of once by
// accident.
type courseSummary struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Lang     string   `json:"lang"`
	Tier     string   `json:"tier"`
	Versions []string `json:"versions"`
	Pinned   string   `json:"pinned"`
}

func listCourses(t *testing.T, app *fiber.App, cookie *http.Cookie) []courseSummary {
	t.Helper()
	resp, raw := doGet(t, app, "/courses", cookie)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("GET /courses: want 200 got %d body=%s", resp.StatusCode, raw)
	}
	var out []courseSummary
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("GET /courses: unmarshal %s: %v", raw, err)
	}
	return out
}

// TestListReturnsOnlyMyCourses is the brief's fourth named case. Every
// course.Repo method is keyed on an owner id; this proves the HTTP layer
// actually passes the SESSION's id and not something else, in both
// directions (A must not see B's course AND B must not see A's — a
// listing hardwired to whoever wrote first would pass a one-sided test).
func TestListReturnsOnlyMyCourses(t *testing.T) {
	pool := store.TestPool(t)
	appA := newTestApp(pool)
	appB := newTestApp(pool)
	cookieA, _ := registerUser(t, appA, "list-a")
	cookieB, _ := registerUser(t, appB, "list-b")

	if resp, raw := postPackage(t, appA, cookieA, "/courses", validPackage(t, "course-of-a", "1.0.0"), nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("A import: want 201 got %d body=%s", resp.StatusCode, raw)
	}
	if resp, raw := postPackage(t, appB, cookieB, "/courses", validPackage(t, "course-of-b", "1.0.0"), nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("B import: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	gotA := listCourses(t, appA, cookieA)
	if len(gotA) != 1 || gotA[0].ID != "course-of-a" {
		t.Fatalf("A's catalog: want exactly [course-of-a], got %+v", gotA)
	}
	gotB := listCourses(t, appB, cookieB)
	if len(gotB) != 1 || gotB[0].ID != "course-of-b" {
		t.Fatalf("B's catalog: want exactly [course-of-b], got %+v", gotB)
	}

	// The asset routes must agree with the listing, and must report
	// somebody else's package as ABSENT rather than FORBIDDEN: a 403 here
	// would confirm to A that course-of-b exists, which is exactly the
	// distinction course.ErrNotFound was built to erase.
	resp, raw := doGet(t, appA, "/courses/course-of-b/@1.0.0/manifest.json", cookieA)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("A reading B's manifest: want 404 got %d body=%s", resp.StatusCode, raw)
	}

	// Anti-vacuity: the row genuinely exists and B can still read it.
	resp, raw = doGet(t, appB, "/courses/course-of-b/@1.0.0/manifest.json", cookieB)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("B reading B's own manifest: want 200 got %d body=%s", resp.StatusCode, raw)
	}
}

// TestPostIgnoresClientSuppliedOwnerID is ruling S1-F12's control.
//
// Repo.Put was changed to take ownerID as an argument precisely so a
// forged owner in the payload cannot reach a row — but that fix lives one
// layer below this one, and nothing in it stops a handler from PASSING
// the wrong id. This test attacks all three places a handler could
// plausibly read an owner from — a multipart form field, a query
// parameter, and the manifest itself — while authenticated as the
// attacker, and requires that the victim's package come through
// untouched.
func TestPostIgnoresClientSuppliedOwnerID(t *testing.T) {
	pool := store.TestPool(t)
	appVictim := newTestApp(pool)
	appAttacker := newTestApp(pool)

	cookieVictim, victimID := registerUser(t, appVictim, "forge-victim")
	cookieAttacker, attackerID := registerUser(t, appAttacker, "forge-attacker")

	const courseID = "c-forge"
	const version = "1.0.0"

	victimManifest := manifestDoc(courseID, version, "chapters/ch-1.html")
	victimManifest["title"] = "Bản của nạn nhân"
	victimZip := buildZip(t, []zipEntry{
		{manifestPath, mustJSON(t, victimManifest)},
		{"chapters/ch-1.html", []byte(sampleChapterHTML)},
	})
	if resp, raw := postPackage(t, appVictim, cookieVictim, "/courses", victimZip, nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("victim import: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	attackerManifest := manifestDoc(courseID, version, "chapters/ch-1.html")
	attackerManifest["title"] = "PWNED BY ATTACKER"
	attackerManifest["owner_id"] = victimID.String() // vector 3: inside the manifest
	attackerZip := buildZip(t, []zipEntry{
		{manifestPath, mustJSON(t, attackerManifest)},
		{"chapters/ch-1.html", []byte("<p>owned</p>")},
	})

	resp, raw := postPackage(t, appAttacker, cookieAttacker,
		"/courses?owner_id="+victimID.String(), // vector 2: query parameter
		attackerZip,
		map[string]string{ // vector 1: sibling form fields
			"owner_id": victimID.String(),
			"ownerId":  victimID.String(),
			"user_id":  victimID.String(),
		})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("attacker import: want 201 got %d body=%s", resp.StatusCode, raw)
	}

	// The victim's package is untouched, read through the victim's own
	// session.
	victimGot, victimBody := doGet(t, appVictim, "/courses/"+courseID+"/@"+version+"/"+manifestPath, cookieVictim)
	if victimGot.StatusCode != http.StatusOK {
		t.Fatalf("victim reading own manifest: want 200 got %d body=%s", victimGot.StatusCode, victimBody)
	}
	if !bytes.Contains(victimBody, []byte("Bản của nạn nhân")) {
		t.Errorf("the victim's package was overwritten by a forged owner id: manifest=%s", victimBody)
	}
	if bytes.Contains(victimBody, []byte("PWNED BY ATTACKER")) {
		t.Errorf("the attacker's package replaced the victim's: manifest=%s", victimBody)
	}

	// Anti-vacuity: the write DID happen — under the attacker's own id.
	attackerGot, attackerBody := doGet(t, appAttacker, "/courses/"+courseID+"/@"+version+"/"+manifestPath, cookieAttacker)
	if attackerGot.StatusCode != http.StatusOK {
		t.Fatalf("attacker reading own manifest: want 200 got %d body=%s", attackerGot.StatusCode, attackerBody)
	}
	if !bytes.Contains(attackerBody, []byte("PWNED BY ATTACKER")) {
		t.Errorf("the attacker's own row does not hold the attacker's package: manifest=%s", attackerBody)
	}

	if n := countRowsFor(t, pool, victimID); n != 1 {
		t.Errorf("victim rows: want 1, got %d", n)
	}
	if n := countRowsFor(t, pool, attackerID); n != 1 {
		t.Errorf("attacker rows: want 1, got %d", n)
	}
}

// stubRepo is a course.Repo whose Put fails with whatever error the case
// hands it. It exists for one job: the storage-failure classification
// below, where the interesting inputs are driver errors that a healthy
// database will never produce on demand.
//
// It is deliberately the ONLY place in this file that bypasses the real
// repository, and it bypasses only the repository — the auth middleware,
// the routing, and the handler are all the real ones.
type stubRepo struct {
	putErr error
}

func (s stubRepo) Put(context.Context, uuid.UUID, course.Package) error { return s.putErr }
func (s stubRepo) Get(context.Context, uuid.UUID, string, string) (course.Package, error) {
	return course.Package{}, course.ErrNotFound
}
func (s stubRepo) ListForOwner(context.Context, uuid.UUID) ([]course.Package, error) {
	return []course.Package{}, nil
}
func (s stubRepo) ListVersions(context.Context, uuid.UUID, string) ([]string, error) {
	return []string{}, nil
}

// TestCourseHTTPContracts holds every HTTP case the five named tests
// above do not reach, under a single shared container.
func TestCourseHTTPContracts(t *testing.T) {
	pool := store.TestPool(t)
	ctx := context.Background()

	t.Run("a package round-trips through POST and back out of the asset routes", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "roundtrip")

		manifest := mustJSON(t, manifestDoc("c-round", "1.2.3", "chapters/ch-1.html"))
		pkg := buildZip(t, []zipEntry{
			{manifestPath, manifest},
			{"chapters/ch-1.html", []byte(sampleChapterHTML)},
		})

		resp, raw := postPackage(t, app, cookie, "/courses", pkg, nil)
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("POST: want 201 got %d body=%s", resp.StatusCode, raw)
		}
		var created struct {
			ID      string `json:"id"`
			Version string `json:"version"`
		}
		if err := json.Unmarshal(raw, &created); err != nil {
			t.Fatalf("POST: unmarshal %s: %v", raw, err)
		}
		if created.ID != "c-round" || created.Version != "1.2.3" {
			t.Errorf("POST body: want {c-round 1.2.3} got %+v", created)
		}

		// The manifest comes back exactly as it was packed. It is served
		// out of the .zip, not out of the jsonb column, on purpose: jsonb
		// stores a parsed document, so a manifest read back from the
		// column has lost key order and would have collapsed duplicate
		// keys silently (see repo.go's Manifest doc).
		got, body := doGet(t, app, "/courses/c-round/@1.2.3/manifest.json", cookie)
		if got.StatusCode != http.StatusOK {
			t.Fatalf("GET manifest: want 200 got %d body=%s", got.StatusCode, body)
		}
		if !bytes.Equal(body, manifest) {
			t.Errorf("GET manifest: want the packed bytes\n%s\ngot\n%s", manifest, body)
		}

		// Assets are served as opaque bytes with sniffing disabled. This
		// origin holds the session cookie; a chapter that a browser
		// RENDERED here would be running the package author's markup
		// against that cookie. Nothing about a package is trusted enough
		// for text/html.
		asset, assetBody := doGet(t, app, "/courses/c-round/@1.2.3/chapters/ch-1.html", cookie)
		if asset.StatusCode != http.StatusOK {
			t.Fatalf("GET asset: want 200 got %d body=%s", asset.StatusCode, assetBody)
		}
		if string(assetBody) != sampleChapterHTML {
			t.Errorf("GET asset: want %q got %q", sampleChapterHTML, assetBody)
		}
		if ct := asset.Header.Get("Content-Type"); ct != "application/octet-stream" {
			t.Errorf("GET asset Content-Type: want application/octet-stream got %q", ct)
		}
		if nosniff := asset.Header.Get("X-Content-Type-Options"); nosniff != "nosniff" {
			t.Errorf("GET asset X-Content-Type-Options: want nosniff got %q", nosniff)
		}
		if ct := got.Header.Get("Content-Type"); ct != "application/octet-stream" {
			t.Errorf("GET manifest Content-Type: want application/octet-stream got %q", ct)
		}
	})

	t.Run("every course route is behind auth", func(t *testing.T) {
		app := newTestApp(pool)
		for _, target := range []string{
			"/courses",
			"/courses/c-any/@1.0.0/manifest.json",
			"/courses/c-any/@1.0.0/chapters/ch-1.html",
		} {
			resp, raw := doGet(t, app, target, nil)
			if resp.StatusCode != http.StatusUnauthorized {
				t.Errorf("GET %s without a session: want 401 got %d body=%s", target, resp.StatusCode, raw)
			}
		}
		// Counted before and after rather than against zero: sibling
		// subtests share this container and have already imported
		// packages of their own by the time this runs.
		before := countAllRows(t, pool)
		resp, raw := postPackage(t, app, nil, "/courses", validPackage(t, "c-any", "1.0.0"), nil)
		if resp.StatusCode != http.StatusUnauthorized {
			t.Errorf("POST /courses without a session: want 401 got %d body=%s", resp.StatusCode, raw)
		}
		if after := countAllRows(t, pool); after != before {
			t.Errorf("an unauthenticated POST changed the row count from %d to %d", before, after)
		}
	})

	t.Run("the ceiling is a maximum, not a threshold: exactly 20 MiB is accepted", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, ownerID := registerUser(t, app, "boundary")

		manifest := mustJSON(t, manifestDoc("c-exact", "1.0.0", "chapters/ch-1.html"))
		chapter := []byte(sampleChapterHTML)
		filler := course.MaxUncompressedBytes - int64(len(manifest)) - int64(len(chapter))
		if filler < 0 {
			t.Fatalf("fixture is already over the ceiling: %d", filler)
		}

		exact := buildZip(t, []zipEntry{
			{manifestPath, manifest},
			{"chapters/ch-1.html", chapter},
			{"assets/filler.bin", make([]byte, filler)},
		})
		resp, raw := postPackage(t, app, cookie, "/courses", exact, nil)
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("a package of exactly %d uncompressed bytes: want 201 got %d body=%s",
				course.MaxUncompressedBytes, resp.StatusCode, raw)
		}

		// And the stored size is the UNCOMPRESSED total, not the size of
		// the .zip — the number the ceiling is applied to must be the
		// number that gets stored, or the two drift.
		var storedBytes int64
		if err := pool.QueryRow(ctx,
			`SELECT bytes FROM course_packages WHERE owner_id = $1 AND course_id = 'c-exact'`,
			ownerID).Scan(&storedBytes); err != nil {
			t.Fatalf("read stored bytes: %v", err)
		}
		if storedBytes != course.MaxUncompressedBytes {
			t.Errorf("stored bytes: want the uncompressed total %d, got %d (the .zip is %d bytes)",
				course.MaxUncompressedBytes, storedBytes, len(exact))
		}
	})

	t.Run("a malformed package is a 400 and stores nothing", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, ownerID := registerUser(t, app, "malformed")

		noManifest := buildZip(t, []zipEntry{{"chapters/ch-1.html", []byte(sampleChapterHTML)}})

		nestedManifest := buildZip(t, []zipEntry{
			{"course/" + manifestPath, mustJSON(t, manifestDoc("c-nested", "1.0.0", "course/chapters/ch-1.html"))},
			{"course/chapters/ch-1.html", []byte(sampleChapterHTML)},
		})

		badJSON := buildZip(t, []zipEntry{
			{manifestPath, []byte(`{"id": "c-bad",}`)},
			{"chapters/ch-1.html", []byte(sampleChapterHTML)},
		})

		notAnObject := buildZip(t, []zipEntry{
			{manifestPath, []byte(`["not", "an", "object"]`)},
			{"chapters/ch-1.html", []byte(sampleChapterHTML)},
		})

		missingChapterFile := buildZip(t, []zipEntry{
			{manifestPath, mustJSON(t, manifestDoc("c-missing", "1.0.0", "chapters/nope.html"))},
			{"chapters/ch-1.html", []byte(sampleChapterHTML)},
		})

		type malformedCase struct {
			name string
			body []byte
		}

		cases := []malformedCase{
			{"not a zip at all", []byte("PK-not-really-a-zip")},
			{"no manifest.json at the root", noManifest},
			{"manifest.json only inside a subdirectory", nestedManifest},
			{"manifest.json is not valid JSON", badJSON},
			{"manifest.json is not a JSON object", notAnObject},
			{"a chapter file named in the manifest is not in the package", missingChapterFile},
		}

		// Each required field, removed one at a time. These are the fields
		// this server itself needs in order to store, list and serve the
		// package; the full registry field table is validate.ts's job and
		// is deliberately NOT duplicated here.
		for _, field := range []string{"id", "title", "lang", "version", "tier", "parts"} {
			m := manifestDoc("c-field", "1.0.0", "chapters/ch-1.html")
			delete(m, field)
			cases = append(cases, malformedCase{
				name: "manifest is missing " + field,
				body: buildZip(t, []zipEntry{
					{manifestPath, mustJSON(t, m)},
					{"chapters/ch-1.html", []byte(sampleChapterHTML)},
				}),
			})
		}

		// Values that are present but unusable.
		for _, bad := range []struct {
			name   string
			mutate func(map[string]any)
		}{
			{"tier is neither content nor interactive", func(m map[string]any) { m["tier"] = "premium" }},
			{"id would not survive a URL path", func(m map[string]any) { m["id"] = "a/b" }},
			{"id is a dot-dot segment", func(m map[string]any) { m["id"] = ".." }},
			{"version would not survive a URL path", func(m map[string]any) { m["version"] = "1.0.0/../../etc" }},
			{"title is empty", func(m map[string]any) { m["title"] = "" }},
			{"parts is empty", func(m map[string]any) { m["parts"] = []map[string]any{} }},
			{"a part has no chapters", func(m map[string]any) {
				m["parts"] = []map[string]any{{"title": "Phần I", "chapters": []map[string]any{}}}
			}},
		} {
			m := manifestDoc("c-value", "1.0.0", "chapters/ch-1.html")
			bad.mutate(m)
			cases = append(cases, malformedCase{
				name: bad.name,
				body: buildZip(t, []zipEntry{
					{manifestPath, mustJSON(t, m)},
					{"chapters/ch-1.html", []byte(sampleChapterHTML)},
				}),
			})
		}

		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				resp, raw := postPackage(t, app, cookie, "/courses", tc.body, nil)
				if resp.StatusCode != http.StatusBadRequest {
					t.Fatalf("want 400 got %d body=%s", resp.StatusCode, raw)
				}
				if n := countRowsFor(t, pool, ownerID); n != 0 {
					t.Errorf("a rejected package left %d row(s) behind", n)
				}
			})
		}

		// Anti-vacuity for the whole table.
		if resp, raw := postPackage(t, app, cookie, "/courses", validPackage(t, "c-good", "1.0.0"), nil); resp.StatusCode != http.StatusCreated {
			t.Fatalf("POST a well-formed package: want 201 got %d body=%s", resp.StatusCode, raw)
		}
	})

	t.Run("POST without the multipart package field is a 400", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "nofield")

		var body bytes.Buffer
		mw := multipart.NewWriter(&body)
		if err := mw.WriteField("not_the_package", "hello"); err != nil {
			t.Fatalf("multipart: %v", err)
		}
		if err := mw.Close(); err != nil {
			t.Fatalf("multipart close: %v", err)
		}
		req := httptest.NewRequest(http.MethodPost, "/courses", &body)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.AddCookie(cookie)
		resp, err := app.Test(req, httpTimeoutMS)
		if err != nil {
			t.Fatalf("POST: %v", err)
		}
		raw, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("POST without a package field: want 400 got %d body=%s", resp.StatusCode, raw)
		}
	})

	t.Run("GET /courses groups versions and pins the newest by semver, not lexically", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "pinned")

		// Uploaded in an order that is neither lexical nor correct, so a
		// listing that returned insertion order would fail too.
		for _, v := range []string{"1.10.0", "1.0.0", "1.9.0"} {
			if resp, raw := postPackage(t, app, cookie, "/courses", validPackage(t, "c-pin", v), nil); resp.StatusCode != http.StatusCreated {
				t.Fatalf("import %s: want 201 got %d body=%s", v, resp.StatusCode, raw)
			}
		}

		got := listCourses(t, app, cookie)
		if len(got) != 1 {
			t.Fatalf("want one course, got %+v", got)
		}
		want := []string{"1.0.0", "1.9.0", "1.10.0"}
		if !reflect.DeepEqual(got[0].Versions, want) {
			t.Errorf("versions: want %v got %v (lexical order would give %v)",
				want, got[0].Versions, []string{"1.0.0", "1.10.0", "1.9.0"})
		}
		if got[0].Pinned != "1.10.0" {
			t.Errorf("pinned: want 1.10.0 (the newest by semver precedence) got %q", got[0].Pinned)
		}
		if got[0].Title == "" || got[0].Lang != "vi" || got[0].Tier != "content" {
			t.Errorf("summary metadata: want title/lang/tier populated, got %+v", got[0])
		}
	})

	t.Run("GET /courses is a summary, never the package bodies", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "nobodies")

		if resp, raw := postPackage(t, app, cookie, "/courses", validPackage(t, "c-summary", "1.0.0"), nil); resp.StatusCode != http.StatusCreated {
			t.Fatalf("import: want 201 got %d body=%s", resp.StatusCode, raw)
		}

		resp, raw := doGet(t, app, "/courses", cookie)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET /courses: want 200 got %d body=%s", resp.StatusCode, raw)
		}
		// ListForOwner returns Blob=nil and a populated Manifest; a
		// handler that marshalled course.Package straight to the wire
		// would serve a null blob field and the whole manifest on a page
		// that shows neither.
		for _, leaked := range []string{"blob", "Blob", "manifest", "Manifest", "OwnerID", "owner_id", "createdAt"} {
			if bytes.Contains(raw, []byte(leaked)) {
				t.Errorf("GET /courses leaks the storage struct's %q field: %s", leaked, raw)
			}
		}
	})

	t.Run("an owner with no packages gets an empty JSON array, not null", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "emptycatalog")

		resp, raw := doGet(t, app, "/courses", cookie)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("GET /courses: want 200 got %d body=%s", resp.StatusCode, raw)
		}
		if string(raw) != "[]" {
			t.Errorf("GET /courses for an empty library: want `[]` got %s "+
				"(a JSON null makes every client's .map() throw)", raw)
		}
	})

	t.Run("an unknown course, version or asset is a 404", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "notfound")

		if resp, raw := postPackage(t, app, cookie, "/courses", validPackage(t, "c-404", "1.0.0"), nil); resp.StatusCode != http.StatusCreated {
			t.Fatalf("import: want 201 got %d body=%s", resp.StatusCode, raw)
		}

		for _, target := range []string{
			"/courses/no-such-course/@1.0.0/manifest.json",
			"/courses/c-404/@9.9.9/manifest.json",
			"/courses/c-404/@1.0.0/chapters/no-such-file.html",
		} {
			resp, raw := doGet(t, app, target, cookie)
			if resp.StatusCode != http.StatusNotFound {
				t.Errorf("GET %s: want 404 got %d body=%s", target, resp.StatusCode, raw)
			}
		}
	})

	t.Run("re-importing a version replaces it instead of adding a row", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, ownerID := registerUser(t, app, "reimport")

		first := manifestDoc("c-reimport", "1.0.0", "chapters/ch-1.html")
		first["title"] = "Bản đầu"
		second := manifestDoc("c-reimport", "1.0.0", "chapters/ch-1.html")
		second["title"] = "Bản thay thế"

		for _, m := range []map[string]any{first, second} {
			pkg := buildZip(t, []zipEntry{
				{manifestPath, mustJSON(t, m)},
				{"chapters/ch-1.html", []byte(sampleChapterHTML)},
			})
			if resp, raw := postPackage(t, app, cookie, "/courses", pkg, nil); resp.StatusCode != http.StatusCreated {
				t.Fatalf("import %v: want 201 got %d body=%s", m["title"], resp.StatusCode, raw)
			}
		}

		if n := countRowsFor(t, pool, ownerID); n != 1 {
			t.Errorf("after re-importing the same version: want 1 row, got %d", n)
		}
		_, body := doGet(t, app, "/courses/c-reimport/@1.0.0/manifest.json", cookie)
		if !bytes.Contains(body, []byte("Bản thay thế")) {
			t.Errorf("re-import did not replace the stored package: %s", body)
		}
	})

	// The validation boundary, pinned as a test rather than left to a
	// comment. Go checks FOUR structural things (uncompressed size,
	// manifest parse + the fields this server needs, no escaping path,
	// every chapter file present) and deliberately does not run the HTML
	// rule set that packages/course-format applies to registry
	// submissions. That rule set protects readers from a STRANGER's
	// course; a package a user imports into their own private library is
	// their own markup, and the registry's CI is where the TypeScript
	// rules run. If this test ever starts failing because someone added a
	// script-tag check here, that is a scope decision to raise, not a bug
	// to fix by deleting the test.
	t.Run("the HTML rule set is not ported: a private import with a script tag is accepted", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, _ := registerUser(t, app, "htmlboundary")

		hostile := buildZip(t, []zipEntry{
			{manifestPath, mustJSON(t, manifestDoc("c-html", "1.0.0", "chapters/ch-1.html"))},
			{"chapters/ch-1.html", []byte(`<script>alert(1)</script><a href="javascript:x()" onclick="y()">i</a><iframe src="x"></iframe><form></form>`)},
		})
		resp, raw := postPackage(t, app, cookie, "/courses", hostile, nil)
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("want 201 (the HTML rules belong to the registry's CI, not to this handler): got %d body=%s",
				resp.StatusCode, raw)
		}
	})

	// The two SQLSTATE 23514 cases have DIFFERENT causes and must not be
	// collapsed (ruling S1-F13). This subtest pins the substrings the
	// classifier keys on to the names Postgres actually reports, so the
	// classification cannot rot into "every check violation is a 500"
	// without a test noticing.
	t.Run("the constraint names the classifier keys on are the ones Postgres reports", func(t *testing.T) {
		repo := course.NewRepo(pool)
		owner := newOwner(t, pool, "constraintnames")

		badTier := samplePackage(owner, "c-tier", "1.0.0")
		badTier.Tier = "premium"
		err := repo.Put(ctx, owner, badTier)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) {
			t.Fatalf("Put with a bad tier: want a *pgconn.PgError, got %v", err)
		}
		if pgErr.Code != pgerrcode.CheckViolation {
			t.Errorf("bad tier: want SQLSTATE %s got %s", pgerrcode.CheckViolation, pgErr.Code)
		}
		if !strings.Contains(pgErr.ConstraintName, "tier") {
			t.Errorf("the classifier tells the two 23514 cases apart by a %q substring in the "+
				"constraint name; Postgres reported %q", "tier", pgErr.ConstraintName)
		}

		badBytes := samplePackage(owner, "c-bytes", "1.0.0")
		badBytes.Bytes = -1
		err = repo.Put(ctx, owner, badBytes)
		if !errors.As(err, &pgErr) {
			t.Fatalf("Put with a negative Bytes: want a *pgconn.PgError, got %v", err)
		}
		if pgErr.Code != pgerrcode.CheckViolation {
			t.Errorf("negative bytes: want SQLSTATE %s got %s", pgerrcode.CheckViolation, pgErr.Code)
		}
		if strings.Contains(pgErr.ConstraintName, "tier") {
			t.Errorf("the bytes constraint is named %q, which the tier branch would swallow", pgErr.ConstraintName)
		}
	})

	// A manifest that encoding/json accepts but jsonb refuses. This is not
	// hypothetical: repo.go documents it as MEASURED — a NUL escape inside
	// a string draws SQLSTATE 22P05 out of Postgres. It is the client's
	// payload, so it must be a 400; answering 500 would tell the user
	// their perfectly-sent request broke the server.
	t.Run("a manifest Postgres cannot store is a 400, not a 500", func(t *testing.T) {
		app := newTestApp(pool)
		cookie, ownerID := registerUser(t, app, "nulescape")

		m := manifestDoc("c-nul", "1.0.0", "chapters/ch-1.html")
		m["description"] = "trước\x00sau"
		pkg := buildZip(t, []zipEntry{
			{manifestPath, mustJSON(t, m)},
			{"chapters/ch-1.html", []byte(sampleChapterHTML)},
		})

		resp, raw := postPackage(t, app, cookie, "/courses", pkg, nil)
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("manifest with a NUL escape: want 400 got %d body=%s", resp.StatusCode, raw)
		}
		if n := countRowsFor(t, pool, ownerID); n != 0 {
			t.Errorf("a rejected manifest left %d row(s) behind", n)
		}
	})

	// Five storage-failure paths, five outcomes. The point of the table is
	// the pair in the middle: both are SQLSTATE 23514, and they must not
	// answer the same thing, because one is the sender's fault and the
	// other is ours.
	t.Run("storage failures are classified, not lumped together", func(t *testing.T) {
		cases := []struct {
			name       string
			putErr     error
			wantStatus int
		}{
			{
				name:       "23514 on the tier constraint is the sender's fault",
				putErr:     &pgconn.PgError{Code: pgerrcode.CheckViolation, ConstraintName: "course_packages_tier_check"},
				wantStatus: http.StatusBadRequest,
			},
			{
				name:       "23514 on the bytes constraint is ours: this server computes that number",
				putErr:     &pgconn.PgError{Code: pgerrcode.CheckViolation, ConstraintName: "course_packages_bytes_check"},
				wantStatus: http.StatusInternalServerError,
			},
			{
				name:       "23503: the authenticated owner no longer exists",
				putErr:     &pgconn.PgError{Code: pgerrcode.ForeignKeyViolation, ConstraintName: "course_packages_owner_id_fkey"},
				wantStatus: http.StatusInternalServerError,
			},
			{
				name:       "22P05: a payload Postgres cannot represent",
				putErr:     &pgconn.PgError{Code: pgerrcode.UntranslatableCharacter},
				wantStatus: http.StatusBadRequest,
			},
			{
				name:       "anything else is an infrastructure failure",
				putErr:     errors.New("connection reset by peer"),
				wantStatus: http.StatusInternalServerError,
			},
		}

		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				// A real session (so auth is the real middleware) over a
				// repository that fails on demand.
				authApp := newTestApp(pool)
				cookie, _ := registerUser(t, authApp, "classify")

				app := fiber.New()
				h := course.NewHandler(course.NewUsecase(stubRepo{
					putErr: fmt.Errorf("course: put package: %w", tc.putErr),
				}))
				app.Post("/courses", auth.Require(pool), h.Post)

				resp, raw := postPackage(t, app, cookie, "/courses", validPackage(t, "c-classify", "1.0.0"), nil)
				if resp.StatusCode != tc.wantStatus {
					t.Fatalf("want %d got %d body=%s", tc.wantStatus, resp.StatusCode, raw)
				}
				// A 500 must never carry the driver's own words.
				if resp.StatusCode >= 500 && bytes.Contains(raw, []byte("SQLSTATE")) {
					t.Errorf("the 500 body leaks the driver error: %s", raw)
				}
			})
		}
	})
}


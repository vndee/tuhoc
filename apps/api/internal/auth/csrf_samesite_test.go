package auth_test

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/vndee/tuhoc-api/internal/store"
)

// THE DECISION THIS FILE TURNS INTO A GATE
//
// Debt C-3 (docs/carried-forward.md) is not a bug in the code. It is a
// deployment choice that has never been written down anywhere the compiler
// can see it. docs/deploy.md §0 offers two paths:
//
//   - a custom domain, web and API as subdomains of one apex — same *site*,
//     so the session cookie stays SameSite=Lax and nothing changes;
//   - the free default hostnames (*.pages.dev + *.onrender.com) — genuinely
//     cross-site, which forces SameSite=None.
//
// The project owner already owns duy.dev and has settled on
// tuhoc.duy.dev + api.duy.dev. Same site. Lax is sufficient. (Phase 1
// planned a third subdomain for the key vault; Pha 2 Task 16 deleted it,
// and this argument never depended on the count.) C-3 is
// therefore closed by a DECISION, and this file is that decision written
// down in the only form that survives six months: a test.
//
// WHY IT MATTERS THAT THIS IS SPECIFICALLY ABOUT CSRF
//
// SameSite=Lax is this API's ONLY CSRF defense. Measured on this branch:
// the string "CSRF" appears in exactly two places in the repo's own source
// (docs/deploy.md and docs/carried-forward.md), plus vite's vendored
// typings under node_modules. There is no CSRF token, no Origin check, no
// Referer check, no custom-header requirement anywhere in apps/api. So the
// single line `SameSite: fiber.CookieSameSiteLaxMode` is not one defense
// among several — it is the whole of it. Flipping it to None does not
// weaken a layered defense; it removes the layer, and every state-changing
// route (POST /sync, PUT /ratings/:registryId, POST /auth/logout) becomes
// reachable from any page the user happens to be visiting.
//
// The change that opens that hole is one word long, looks like a config
// tweak, and is exactly what docs/deploy.md §0 tells someone to do if they
// do not want to pay for a domain. That is the shape of change this file
// exists to interrupt.
//
// WHY TWO HALVES, AND WHY NEITHER IS ENOUGH ALONE
//
// The BEHAVIORAL half drives the real app and reads the real Set-Cookie
// headers off register, login, and logout. It is the half that proves the
// property is true of what the server actually emits rather than of what
// the source appears to say.
//
// It cannot, however, see a cookie site no request in this file reaches.
// That is not hypothetical: before this file, auth_test.go asserted the
// cookie attributes on the REGISTER response only, so a mutant that
// switched clearSessionCookie (handler.go:180) to None left the whole
// suite green — measured, see the report for this task. The STRUCTURAL
// half closes that by scanning every .go file in the repo and demanding
// that every SameSite setting anywhere be Lax, whether or not a test
// happens to drive it.
//
// The structural half is written as a BALANCE rather than a fixed count,
// deliberately. `len(cookie call sites) == len(Lax settings)` stays green
// when someone adds a legitimate third cookie that is also Lax — a gate
// that goes red on innocent changes is a gate people delete — but goes red
// the moment a cookie is set with a different SameSite, with a
// config-driven one, or with none at all. A missing attribute is not a
// harmless omission: browsers do not agree on the default, so "no SameSite"
// is "Lax in Chrome, and something else elsewhere".

// sameSiteNoneNeedles are the ways SameSite=None can be spelled in Go
// source, lowercased before matching (so `fiber.CookieSameSiteNoneMode`,
// `http.SameSiteNoneMode`, and a literal `SameSite: "None"` all land).
//
// They are deliberately narrow — the point is not to catch the string
// "none" but the specific act of setting this attribute to it.
var sameSiteNoneNeedles = []string{
	`samesitenonemode`,
	`samesite=none`,
	`samesite: "none"`,
	`samesite:"none"`,
}

// cookieSetSite is the only way this codebase sets a cookie. It matches
// the CALL that writes a cookie, not `c.Cookies(` — which is the plural
// READER used to pull the session id back out of a request, and is
// entirely legitimate.
const cookieSetSite = `c.cookie(&fiber.cookie{`

// laxSetting is the one SameSite value this project allows. Measured on
// this branch: 2 occurrences, both in apps/api/internal/auth/handler.go,
// matching the 2 cookieSetSite calls in the same file.
const laxSetting = `samesite: fiber.cookiesamesitelaxmode`

// sameSiteScanSentinel is the file a violation would live in if it lived
// anywhere. Pinning it by name, rather than trusting a file count, is the
// lesson from apps/web/src/db/local.test.ts: a count stays green when
// somebody adds one file and removes another.
const sameSiteScanSentinel = "apps/api/internal/auth/handler.go"

// minGoFilesForSameSiteScan is the floor that distinguishes "green because
// clean" from "green because the walk read nothing". Measured 2026-08-22:
// the repo has 27 .go files, all under apps/api. The floor sits below that
// so one legitimate deletion does not go red; the real anchor is the
// sentinel above.
const minGoFilesForSameSiteScan = 20

// sameSiteSkippedDirs mirrors no_key_transit_test.go's list, and `.claude`
// is mandatory rather than tidy: the main checkout keeps every agent's
// worktree under .claude/worktrees/agent-*/, each a full copy of the repo,
// so without this the scan reads other agents' code and reports failures
// at their paths.
var sameSiteSkippedDirs = map[string]bool{
	".git":         true,
	".claude":      true,
	"node_modules": true,
	"dist":         true,
	"build":        true,
	"vendor":       true,
}

// sameSiteRepoRoot walks up from the package directory (go test sets cwd
// there) to the directory holding go.work.
//
// It fails rather than falling back to the module root. A silent fallback
// is the exact shape that produced the blind gates recorded in
// docs/carried-forward.md: the scan still runs, still passes, and quietly
// covers less than its name claims.
func sameSiteRepoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for range 12 {
		if _, err := os.Stat(filepath.Join(dir, "go.work")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Fatalf("no go.work found walking up from %q — this scan anchors at the "+
		"repo root and deliberately does NOT fall back to the module root, "+
		"because a silent fallback turns a trip-wire into a blind gate. Run it "+
		"through `make test-api` from the repo root.", dir)
	return ""
}

// sameSiteGoSources reads every .go file under the repo root, keyed by
// repo-relative slash path, contents lowercased.
func sameSiteGoSources(t *testing.T) map[string]string {
	t.Helper()
	root := sameSiteRepoRoot(t)

	out := map[string]string{}
	self := 0
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			if p != root && sameSiteSkippedDirs[info.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") {
			return nil
		}
		// This file carries every forbidden spelling in its own needle
		// list; without the exclusion it makes itself red.
		if info.Name() == "csrf_samesite_test.go" {
			self++
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		b, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		out[filepath.ToSlash(rel)] = strings.ToLower(string(b))
		return nil
	})
	if err != nil {
		t.Fatalf("walking %s: %v", root, err)
	}

	// Three self-checks, one per way this scan could be green having
	// verified nothing.
	if len(out) < minGoFilesForSameSiteScan {
		t.Fatalf("scanned only %d .go files under %s (floor %d) — wrong root, or "+
			"the directory filter swallowed the repo. This scan is CHECKING "+
			"NOTHING; fix the path, do not lower the floor.",
			len(out), root, minGoFilesForSameSiteScan)
	}
	if _, ok := out[sameSiteScanSentinel]; !ok {
		t.Fatalf("scanned %d files but NOT %s, the one file a violation would "+
			"live in. If that file was genuinely renamed, update the sentinel "+
			"deliberately; otherwise the scan is missing exactly where it must look.",
			len(out), sameSiteScanSentinel)
	}
	if self != 1 {
		t.Fatalf("self-exclusion matched %d files, must match exactly 1 (this "+
			"file). 0 = renamed; >1 = a copy of this trip-wire exists.", self)
	}
	t.Logf("SameSite scan read %d .go files under %s (excluding 1: this trip-wire)",
		len(out), root)
	return out
}

// sameSiteScan returns sorted "path: needle" hits. Split out from the
// tests so it can be proved alive against synthetic source — see
// TestSameSiteScanIsNotVacuous.
func sameSiteScan(sources map[string]string, needles []string) []string {
	var hits []string
	for path, src := range sources {
		for _, n := range needles {
			if strings.Contains(src, strings.ToLower(n)) {
				hits = append(hits, path+": "+n)
			}
		}
	}
	sort.Strings(hits)
	return hits
}

// countOccurrences counts non-overlapping occurrences of needle across
// every source, and returns the per-file breakdown for the error message
// — "the numbers disagree" is useless without "and here is where".
func countOccurrences(sources map[string]string, needle string) (int, map[string]int) {
	total := 0
	per := map[string]int{}
	for path, src := range sources {
		if n := strings.Count(src, needle); n > 0 {
			per[path] = n
			total += n
		}
	}
	return total, per
}

// TestSameSiteScanIsNotVacuous is the trip-wire for the trip-wire.
//
// Every assertion below is of the form "nothing was found". A broken
// matcher — an empty needle, a case fold applied to one side only, a
// Contains quietly turned into an Equal — produces exactly the same green.
// This feeds synthetic violating source through the SAME functions and
// demands they go red, so the detector is proved alive on every run rather
// than only on the afternoon somebody planted a mutant by hand.
func TestSameSiteScanIsNotVacuous(t *testing.T) {
	violating := map[string]string{
		"apps/api/internal/auth/handler.go": strings.ToLower(`package auth
func (h *Handler) setSessionCookie(c *fiber.Ctx, s Session) {
	c.Cookie(&fiber.Cookie{
		Name:     CookieName,
		SameSite: fiber.CookieSameSiteNoneMode,
	})
}`),
	}
	if got := sameSiteScan(violating, sameSiteNoneNeedles); len(got) == 0 {
		t.Errorf("the needle scan did not catch synthetic SameSite=None source — " +
			"the detector is dead and TestSessionCookieIsNeverSameSiteNone is " +
			"green for no reason")
	}
	if n, _ := countOccurrences(violating, cookieSetSite); n != 1 {
		t.Errorf("cookie-call-site counter: want 1 on synthetic source, got %d", n)
	}
	if n, _ := countOccurrences(violating, laxSetting); n != 0 {
		t.Errorf("Lax counter: want 0 on synthetic None source, got %d", n)
	}

	// The other direction. A matcher that flags everything is useless in
	// the opposite way, and would make this gate the first thing deleted.
	benign := map[string]string{
		"apps/api/internal/auth/handler.go": strings.ToLower(`package auth
// SameSite is scoped to the registrable domain, so tuhoc.duy.dev and
// api.duy.dev are same-site and Lax cookies flow between them.
func (h *Handler) setSessionCookie(c *fiber.Ctx, s Session) {
	c.Cookie(&fiber.Cookie{
		Name:     CookieName,
		SameSite: fiber.CookieSameSiteLaxMode,
	})
}`),
	}
	if got := sameSiteScan(benign, sameSiteNoneNeedles); len(got) != 0 {
		t.Errorf("the needle scan flagged benign Lax source: %v", got)
	}
	if n, _ := countOccurrences(benign, cookieSetSite); n != 1 {
		t.Errorf("cookie-call-site counter: want 1 on benign source, got %d", n)
	}
	if n, _ := countOccurrences(benign, laxSetting); n != 1 {
		t.Errorf("Lax counter: want 1 on benign source, got %d", n)
	}

	// And the real walk must reach the real repo.
	if n := len(sameSiteGoSources(t)); n < minGoFilesForSameSiteScan {
		t.Errorf("sameSiteGoSources returned %d files", n)
	}
}

// TestSessionCookieIsNeverSameSiteNone is the C-3 gate.
//
// Both halves are required and neither substitutes for the other; see the
// file comment for what each one can and cannot see.
func TestSessionCookieIsNeverSameSiteNone(t *testing.T) {
	// ---- STRUCTURAL HALF -------------------------------------------------
	// No database needed, so it runs first: if someone has already flipped
	// the constant, the report should say so without waiting on a container.
	sources := sameSiteGoSources(t)

	for _, hit := range sameSiteScan(sources, sameSiteNoneNeedles) {
		t.Errorf("%s — the session cookie must never be SameSite=None.\n"+
			"SameSite=Lax is this API's ONLY CSRF defense: there is no CSRF "+
			"token, no Origin check and no Referer check anywhere in apps/api. "+
			"Setting None removes that defense outright, and every credentialed "+
			"state-changing route becomes reachable cross-site.\n"+
			"This is debt C-3, and it is closed by a DEPLOYMENT DECISION: web "+
			"and API are subdomains of one apex (tuhoc.duy.dev / api.duy.dev), "+
			"which is same-SITE, so Lax works as written and no code change is "+
			"needed. See docs/deploy.md §0.\n"+
			"If you are genuinely moving to the cross-site (free-hostname) "+
			"deployment, None is not a complete change on its own — ship an "+
			"Origin allowlist or a double-submit CSRF token on state-changing "+
			"routes FIRST, replace this test with one that gates THAT, and only "+
			"then flip the attribute.", hit)
	}

	// Every place a cookie is written must set SameSite=Lax. Counting the
	// two against each other, rather than pinning a magic number, keeps a
	// legitimate new Lax cookie green while catching a cookie written with
	// a different mode, a config-driven mode, or no SameSite at all.
	setSites, setPer := countOccurrences(sources, cookieSetSite)
	laxSites, laxPer := countOccurrences(sources, laxSetting)
	if setSites == 0 {
		t.Fatalf("found no `c.Cookie(&fiber.Cookie{` call anywhere — either the "+
			"session cookie stopped being set (in which case auth is broken and "+
			"the behavioral half below will say so), or the cookie is now written "+
			"some other way this scan cannot see. Update %q deliberately.",
			cookieSetSite)
	}
	if setSites != laxSites {
		t.Errorf("%d cookie-setting call sites but %d SameSite=Lax settings — "+
			"at least one cookie is written with a SameSite this project has not "+
			"approved, or with none at all.\ncall sites: %v\nLax settings: %v\n"+
			"An ABSENT SameSite is not harmless: browsers disagree on the "+
			"default, so omitting it is not the same as writing Lax. If a new "+
			"cookie here is genuinely not the session cookie, give it "+
			"SameSite=Lax too, or narrow this scan on purpose and say why.",
			setSites, laxSites, setPer, laxPer)
	}

	// ---- BEHAVIORAL HALF -------------------------------------------------
	// What the server actually emits, on every response that carries the
	// session cookie — including logout, which the pre-existing cookie test
	// in auth_test.go never looked at.
	pool := store.TestPool(t)

	for _, cookieSecure := range []bool{false, true} {
		app := newTestApp(pool, cookieSecure, nil)
		email := uniqueEmail("samesite")
		const password = "samesite-gate-password-1"

		type step struct {
			what string
			resp *http.Response
		}
		registerResp, _, registerRaw := doJSON(t, app, http.MethodPost, "/auth/register",
			map[string]string{"email": email, "password": password, "name": "SameSite"}, nil)
		if registerResp.StatusCode != http.StatusOK {
			t.Fatalf("register: want 200 got %d body=%s", registerResp.StatusCode, registerRaw)
		}
		registerCookie := sessionCookie(registerResp)
		if registerCookie == nil {
			t.Fatalf("register set no session cookie")
		}

		loginResp, _, loginRaw := doJSON(t, app, http.MethodPost, "/auth/login",
			map[string]string{"email": email, "password": password}, nil)
		if loginResp.StatusCode != http.StatusOK {
			t.Fatalf("login: want 200 got %d body=%s", loginResp.StatusCode, loginRaw)
		}

		// Logout is the response the pre-existing test never inspected, and
		// clearSessionCookie is a second, independently mutable place the
		// attribute is written. Its own doc comment says its attributes MUST
		// match setSessionCookie's or some browsers treat it as setting a
		// different cookie rather than clearing this one — so a drift here
		// is both a CSRF hole and a logout that does not log out.
		logoutResp, _, _ := doJSON(t, app, http.MethodPost, "/auth/logout", nil, registerCookie)
		if logoutResp.StatusCode != http.StatusOK {
			t.Fatalf("logout: want 200 got %d", logoutResp.StatusCode)
		}

		for _, s := range []step{
			{"POST /auth/register", registerResp},
			{"POST /auth/login", loginResp},
			{"POST /auth/logout", logoutResp},
		} {
			ck := sessionCookie(s.resp)
			if ck == nil {
				t.Errorf("%s (COOKIE_SECURE=%v): no %s cookie in the response — "+
					"this half of the gate reads Set-Cookie headers, so a response "+
					"that stopped setting the cookie makes it silently check nothing",
					s.what, cookieSecure, sessionCookieName)
				continue
			}

			if ck.SameSite == http.SameSiteNoneMode {
				t.Errorf("%s (COOKIE_SECURE=%v): session cookie is SameSite=None. "+
					"That is debt C-3 realised: it is the only CSRF defense this "+
					"API has. See the structural half above for what to do instead.",
					s.what, cookieSecure)
			}
			// Asserting Lax, not merely "not None". Deleting the attribute
			// altogether yields SameSiteDefaultMode here, and browsers do not
			// agree on what an absent SameSite means — Chrome treats it as
			// Lax, others do not.
			if ck.SameSite != http.SameSiteLaxMode {
				t.Errorf("%s (COOKIE_SECURE=%v): want SameSite=Lax, got %v (0 = the "+
					"attribute is absent, which is NOT the same as Lax)",
					s.what, cookieSecure, ck.SameSite)
			}

			// Independent of net/http's cookie parser: read the raw header.
			// If a future Go release changes how an unknown SameSite value
			// is mapped, the check above could soften without anybody
			// noticing; this one cannot.
			for _, raw := range s.resp.Header.Values("Set-Cookie") {
				if !strings.HasPrefix(raw, sessionCookieName+"=") {
					continue
				}
				lower := strings.ToLower(raw)
				if strings.Contains(lower, "samesite=none") {
					t.Errorf("%s (COOKIE_SECURE=%v): raw Set-Cookie carries "+
						"SameSite=None: %s", s.what, cookieSecure, raw)
				}
				if !strings.Contains(lower, "samesite=lax") {
					t.Errorf("%s (COOKIE_SECURE=%v): raw Set-Cookie does not carry "+
						"SameSite=Lax: %s", s.what, cookieSecure, raw)
				}
			}
		}
	}
}

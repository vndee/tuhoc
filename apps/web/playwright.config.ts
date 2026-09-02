import { defineConfig, devices } from '@playwright/test';

/**
 * Task 17: the P1 end-to-end gate. This config boots the REAL app the same
 * way a learner would load it — the PRODUCTION BUILD, served by
 * `vite preview` (not a dev server, not a mock, not a component harness) —
 * against the REAL API + Postgres that `scripts/test-e2e.sh` already
 * brought up via `apps/api/compose.e2e.yml` before Playwright ever runs.
 * Nothing here mocks `fetch`, IndexedDB, or the course-kit runtime scripts:
 * the whole point of this suite is to prove the pieces actually work
 * together, which a mocked boundary would defeat.
 *
 * Port choice (5183): deliberately NOT 5173 (`vite dev`'s default, used by
 * any developer's own local dev server) or 4173 (`vite preview`'s own
 * default, which a developer may equally have open) — running this suite must never fight a dev server a human
 * happens to have open, and must never silently attach to one via
 * `reuseExistingServer` (see below). Verified free on this machine before
 * picking it (see task report). `apps/api/compose.e2e.yml`'s `CORS_ORIGIN`
 * default and this file's default must be kept in sync by hand — there is
 * no third place either could read a shared value from without adding a
 * build step neither file otherwise needs.
 */
const WEB_PORT = Number(process.env.TUHOC_E2E_WEB_PORT ?? 5183);
const BASE_URL = `http://localhost:${WEB_PORT}`;

// Where the ALREADY-RUNNING api+db compose stack listens — set by
// scripts/test-e2e.sh from the same TUHOC_E2E_API_PORT the compose file
// uses, so the two never disagree about which port the API is on. Falls
// back to the compose file's own default for a developer who runs
// `bunx playwright test` directly against a stack they started by hand.
const API_URL = process.env.VITE_API_URL ?? `http://localhost:${process.env.TUHOC_E2E_API_PORT ?? 8089}`;

export default defineConfig({
  testDir: './e2e',
  // Final whole-branch review, Important 4 (Pha 2) found `make test-e2e` red
  // for a reason that predated that review and was never this phase's own
  // subsystem to fix: `p2.spec.ts` navigated to a chapter in course
  // `so-dau-phay-dong` (see its own history in that file), but
  // `scripts/test-e2e.sh`'s seed step only ever publishes ONE course to
  // the e2e stack — `mau-hop-le` (`fixtures/format-v2/valid-course`, the
  // shared TS/Go fixture corpus's zero-finding case, chosen there for
  // that reason). `so-dau-phay-dong` was never seeded, so every request
  // p2.spec.ts made 404d before it ever reached the annotation behaviour
  // it meant to test — a missing fixture, not a course-serving regression.
  // That review quarantined the file here (a `testIgnore` entry) rather
  // than leave a permanently-red spec in the gate.
  //
  // `s2.spec.ts` held a SECOND entry here for one Pha 2 commit: Task 16
  // deleted the phase-1 AI/BYOK key vault app it drove FIRST, in one
  // commit, which left this testIgnore ENTRY quarantining a spec that no
  // longer had anything real left to test; a LATER commit deleted the spec
  // FILE itself, at which point the entry quarantined nothing at all — the
  // file was gone outright, so there was nothing left to quarantine.
  // Task 18 wrote a REPLACEMENT `s2.spec.ts`, rebuilt around credit
  // (spec §8: "số dư hiện, trừ đúng, hết chặn, config giữ"), against a
  // fake DeepSeek double (`scripts/fake_deepseek.py`) rather than the
  // real API — see that spec file's own top comment for the full
  // reasoning.
  //
  // Task 13 of Pha 3 (`.superpowers/sdd/2026-09-01-pha3-du-lieu-len-may-chu/
  // task-13-brief.md`) is what un-quarantines `p2.spec.ts`: it now targets
  // `mau-hop-le`/`c1` — the course/chapter this script already seeds for
  // `p1.spec.ts`/`widget.spec.ts`, and the SAME chapter `p1.spec.ts` proves
  // renders KaTeX; `c2` was left to `widget.spec.ts` alone so the two
  // gates do not share a chapter — and its scenarios were rewritten around
  // the fact that this phase deleted the local-first Dexie/outbox/sync-
  // engine layer entirely (see that file's own header comment for what
  // replaced the old "wait for two devices to converge" shape). No
  // `testIgnore` entry is left below: every spec `testDir` finds now runs
  // unfiltered, which is what `make test-e2e` asserts from this task on.
  // One real network round trip per assertion, two independent browser
  // contexts, a real build+seed of the stack underneath — this is not a
  // fast suite, and 90s is a real per-test budget for that, not a
  // copy-pasted default.
  //
  // Task 13 of Pha 3: this used to also cover a deliberate wait for two
  // independent 15s server-side sync timers (`p1.spec.ts`'s cross-device
  // assertion, `p2.spec.ts`'s before this task). Both timers, and the
  // local-first Dexie/outbox layer they belonged to, are gone — a mark-read
  // or an annotation write is now a synchronous request, and a second
  // device sees it on its own next read (a reload), not on a poll. Left at
  // 90s anyway: `p2.spec.ts`'s failure-path scenario still deliberately
  // delays an aborted request by a few hundred ms to give the optimistic
  // paint a real window to be observed before it rolls back (see that
  // file), and registration/login can themselves wait out `helpers.ts`'s
  // own `/auth/*` rate-limit budget — neither of those is a 15s-timer wait,
  // but both eat into a single test's budget.
  timeout: 90_000,
  // Deliberately Playwright's own stock default (5s), not a suite-wide
  // bump. No assertion in this directory needs more than that any more —
  // see this file's `timeout` comment above for what used to and no longer
  // does (the cross-device 15s-timer waits). No timeout override left
  // here at all: fast checks stay fast-failing, slow checks say why
  // inline, at the call site.
  fullyParallel: false,
  workers: 1,
  // Never retry silently: this suite exists to tell the truth about
  // whether the DoD holds, and a flaky-look retried into green would
  // hide exactly the kind of regression it's meant to catch.
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // `build` then `preview`, NOT `dev`. While this ran `vite dev`, the
    // entire production path had no automated coverage anywhere in the
    // repo: `tsc -b && vite build`, the `courseAssets` plugin's
    // `closeBundle` copy of `/course-kit` and `/courses` into `dist/`, and
    // the SPA fallback for deep links like `/c/:courseId/:chapterId`. A
    // build that emitted a broken bundle, or a plugin that copied the
    // course assets to the wrong place, would have left this gate green —
    // the gate would have been proving that the DEV SERVER works.
    //
    // `vite preview` serves `dist/` and, thanks to the same plugin's
    // `configurePreviewServer` hook, the two asset prefixes as well. It
    // also does its own SPA history fallback, which is what `_redirects`
    // arranges for on the real host (Cloudflare Pages) — the same
    // behaviour, not the same file, so a broken `_redirects` is still not
    // something this gate can see. p1.spec.ts asserts the served document
    // really is the built one, so a silent revert to `dev` fails loudly
    // rather than quietly halving what this suite proves.
    command: `bun run build && bun run preview -- --port ${WEB_PORT} --strictPort`,
    url: BASE_URL,
    // Always boot a fresh server scoped to this run, never attach to one
    // that happens to already be listening on WEB_PORT: a stale server
    // started with a different (or no) VITE_API_URL would make every
    // request in this suite silently talk to the wrong API, or none.
    reuseExistingServer: false,
    // Generous because it now covers `tsc -b && vite build` as well as
    // boot: a cold build on a slow machine is minutes, not seconds, and a
    // timeout here would look like an app failure rather than a slow
    // toolchain.
    timeout: 300_000,
    env: {
      VITE_API_URL: API_URL,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

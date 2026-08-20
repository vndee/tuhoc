import { defineConfig, devices } from '@playwright/test';

/**
 * Task 17: the P1 end-to-end gate. This config boots the REAL app the same
 * way a learner would load it — `vite dev` (not a mock, not a component
 * harness) — against the REAL API + Postgres that `scripts/test-e2e.sh`
 * already brought up via `apps/api/compose.e2e.yml` before Playwright ever
 * runs. Nothing here mocks `fetch`, IndexedDB, or the course-kit runtime
 * scripts: the whole point of this suite is to prove the pieces actually
 * work together, which a mocked boundary would defeat.
 *
 * Port choice (5183): deliberately NOT 5173 (`bun run dev`'s default,
 * used by any developer's own local dev server) or 4173 (`vite preview`'s
 * default) — running this suite must never fight a dev server a human
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
  // One real network round trip per assertion, two independent browser
  // contexts, and a deliberate wait for a 15s server-side sync timer (see
  // e2e/p1.spec.ts) — this is not a fast suite, and 90s is a real budget
  // for it, not a copy-pasted default.
  timeout: 90_000,
  // Deliberately Playwright's own stock default (5s), not a suite-wide
  // bump — fix-round-1 finding: an earlier draft set this globally to
  // 45_000 to cover the one assertion that genuinely needs it (the
  // cross-device sync wait, which polls across two independent 15s
  // server timers — see p1.spec.ts). That gave every OTHER assertion in
  // this file — `.katex` visibility, `#mark-btn.on`, the pre-login
  // redirect, the pre-mark "nothing done yet" check — the same 45s of
  // slack, none of which they need: a regression that made the initial
  // chapter render take, say, 20s would still have passed silently. The
  // one assertion that actually needs more than 5s
  // (`courseHomeChapterLink(...).toHaveClass(/\bdone\b/, ...)`) sets its
  // own explicit `{ timeout: 45_000 }` inline instead — see that call
  // site's own comment. `expectVizCanvasDrawn`'s pixel-ratio check
  // likewise carries its own explicit `expect.poll(..., { timeout:
  // 10_000 })`, chosen for its own reason (one animation frame, never
  // 5s), not this default. No timeout override left here at all: fast
  // checks stay fast-failing, slow checks say why inline.
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
    command: `bun run dev -- --port ${WEB_PORT} --strictPort`,
    url: BASE_URL,
    // Always boot a fresh server scoped to this run, never attach to one
    // that happens to already be listening on WEB_PORT: a stale server
    // started with a different (or no) VITE_API_URL would make every
    // request in this suite silently talk to the wrong API, or none.
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_API_URL: API_URL,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

# Testing tuhoc

## Story artwork validation and required native conversion gate

From `apps/web`, `bun run test` runs portable tests, including manifest,
source and destination safety validations with an inspection-only PNG fixture
adapter. It does not claim real codec coverage. The separate required gate is
`bun run test:story-plates-native`: this performs real WebP conversion, dimension,
hash, source-preservation, shell/path-safety, quality-step and byte-budget checks
against temporary non-art fixtures. It never regenerates edition artwork.

The native gate requires macOS `/usr/bin/sips` and executable
`/opt/homebrew/bin/cwebp` (the Apple Silicon Homebrew `webp` package).
`node scripts/export-story-plates.mjs --check-tools` checks these prerequisites;
the gate fails clearly when either is absent and never silently skips conversion.
On other toolchains, report the native gate as unavailable and run it on the
supported installed toolchain before accepting artwork/exporter changes.
No encoder discovery or cross-platform substitution is provided.

Unit/integration tests: `make test-api` (Go, spins up real Postgres via
testcontainers per-package) and `make test-web` (vitest, jsdom). This
doc is only about the one that's different in kind:

## `make test-e2e` — the P1 end-to-end gate

Brings up the real API + Postgres, serves the real **production build**
of the web app, and drives both with a real browser (Playwright) to prove
the whole stack works together. For what each spec actually checks and why,
read the spec files themselves — `apps/web/e2e/p1.spec.ts`,
`apps/web/e2e/widget.spec.ts`, `apps/web/e2e/s2.spec.ts`,
`apps/web/e2e/p2.spec.ts`, and `apps/web/e2e/stories.spec.ts` — and
`scripts/test-e2e.sh`, whose comments carry the reasoning for every step of
the harness.

> This paragraph used to end with a fourth pointer, to
> `.superpowers/sdd/2026-08-19-p1-platform-core/task-17-report.md`. That
> directory does not exist, and `.superpowers/` is excluded by
> `.gitignore`, so the pointer was dead in every clone — twice over.
> Execution reports are not part of this repository; anything a reader of a
> tracked doc needs must live in a tracked file.

**Five spec files actually run**, and they are gates for different things:
`p1.spec.ts` (the reader — including the course table of contents, inherited
from the deleted `s1.spec.ts`), `widget.spec.ts` (the phase-1 security
gate: a course widget runs inside `sandbox="allow-scripts"`, its origin is
opaque, and `document.cookie` throws rather than returning the session), and
`s2.spec.ts` (Pha 2's AI/credit gate — see below), `p2.spec.ts` (annotations
against the shared seeded course), and `stories.spec.ts`
(public special-edition routes, bundle/network laziness, responsive and
motion behavior, fallbacks, visual baselines, and performance budgets).

Gone with the features they covered: `import.spec.ts` and `s1.spec.ts` (the
Import screen and the version-pinning update dialog, removed in `e58ef41`;
see `fixtures/README.md` for what the two package-variant scenarios were),
`s3.spec.ts`/`s4.spec.ts` (the registry catalog UI), and `viz.spec.ts` (the
course-wide `viz.js` runtime, replaced by sandboxed widgets).

### `s2.spec.ts` — the AI/credit gate (Pha 2, Task 18)

Rewritten from scratch around spec §8's own words for this gate: "số dư
hiện, trừ đúng, hết chặn, config giữ" (the balance displays, deducts
correctly, blocks when empty, personal config survives a reload). The
Pha-1 version of this file drove `apps/vault` — a second-origin app the
learner plugged their own DeepSeek key into — and Pha 2 Task 16 deleted
that app along with every test that drove it; **nothing in the current
file is lifted from that one**, because a second origin holding a
learner's own key is not a concept the credit architecture has any use
for. The old version is still readable at `git show
390931e:apps/web/e2e/s2.spec.ts` for anyone curious what a BYOK-era gate
looked like, but it is history, not a starting point.

**No real DeepSeek call, ever.** `scripts/test-e2e.sh` points
`DEEPSEEK_BASE_URL` (`apps/api/compose.e2e.yml`) at `scripts/
fake_deepseek.py` — a small stdlib-only HTTP server, run as its own compose
service (`deepseek-fake`, not reachable from the host), that answers the
exact wire shape `apps/api/internal/ai/stream.go`'s `CompleteStream` parses
with a FIXED reply and FIXED usage, regardless of what was asked. That
double is what this gate proves and what it does not:

- It proves `apps/api/internal/ai`'s own cost math (`cost.go`'s `Charge`,
  `credits.go`'s `ChargeTurn`) and the SSE relay in `handler.go` end to end,
  through a real HTTP round trip from a real browser. A real DeepSeek call
  would exercise that same machinery identically — the double only replaces
  the third party on the other end of one `net/http` call.
- It does NOT prove DeepSeek's real API behaves the way `client_test.go`/
  `stream_test.go` assume, or spend the project's real balance to find out.
  `docs/deepseek-measured.md` is the one place that gets checked against
  the live API — deliberately not in a suite that runs on every push, per
  task-18-brief.md's own instruction: "một bộ e2e tiêu tiền thật mỗi lần
  chạy là một bộ e2e sẽ bị tắt" (an e2e suite that spends real money every
  run is an e2e suite that gets turned off).
- The fake reply never emits a `tool_calls` entry, so every turn finishes
  in exactly one round — the tool loop itself is not exercised here, and
  does not need to be: Go's own coverage (`agent_test.go`, `stream_test.go`,
  `tool_course_test.go`) already exists for it.

**One seed, shared by hand across three files — and chosen to cross zero,
not just reach it.** `scripts/test-e2e.sh` sets `ai_settings.
signup_grant_micro` to `4765` (its own `AI_SIGNUP_GRANT_MICRO`, overridable
via `TUHOC_E2E_AI_SIGNUP_GRANT_MICRO`) before Playwright registers anyone.
`scripts/fake_deepseek.py`'s header comment derives `ONE_TURN_MICRO = 3765`
from its own fixed usage against `ai_pricing`'s seeded `deepseek-v4-pro`
CREDITS columns, and `4765 = 3765 + 1000` is `s2.spec.ts`'s own `SEED_MICRO`
— hardcoded a second time by hand, same as `ONE_TURN_MICRO` itself. There is
no fourth place either file could read a shared number from without a build
step neither otherwise needs; a mismatch fails loudly (a balance assertion
off by the exact difference), not silently.

**Round-1 self-review found two mutations this gate could not see, both
because a fixture made two different-meaning numbers equal — fixed, and
re-verified red under the actual mutation:**

- `ai_pricing.cost_micro_per_1k_*` (what DeepSeek bills the PLATFORM) and
  `credits_per_1k_*` (what the platform bills the LEARNER) were seeded
  EQUAL for `deepseek-v4-pro` (migration 0007's own comment: Pha 2 sells at
  cost). A `ChargeTurn` that deducted/recorded the platform's cost instead
  of the learner's credits was therefore invisible. `scripts/test-e2e.sh`
  now seeds the two sets of columns to DIFFERENT values as a dedicated step
  — the existing balance/ledger assertions in `s2.spec.ts` did not need to
  change, only the fixture that was hiding a real bug from them.
- Seeding a learner with EXACTLY one turn's cost (3765, the first version's
  `SEED_MICRO`) cannot tell correct subtraction apart from a bug that
  floors the result at zero instead of letting it go negative — spec §3.4
  explicitly allows the turn that crosses zero to finish and go negative.
  Both produce `balance_micro === 0` after one turn. `s2.spec.ts` now seeds
  `ONE_TURN_MICRO + 1000` and runs TWO turns in its second scenario: the
  first leaves a small positive balance (asserted exactly), the second
  charges more than what is left and is asserted to land on the exact
  NEGATIVE number real subtraction produces — a `LEAST($2, balance_micro)`-
  style clamp cannot reach that number.

Two properties of this gate are deliberate and easy to lose:

- **The API image is rebuilt on every run** (`docker compose up -d
  --build`). `apps/api/compose.e2e.yml` declares `image: tuhoc-api:latest`
  alongside `build:`, and compose builds only when that tag is absent —
  so without `--build` every run after the first silently tested a cached
  image, and the gate was blind to Go changes.
- **The browser is pointed at the built artifact, not `vite dev`**
  (`bun run build && bun run preview`). The production path — `tsc -b &&
  vite build`, the `courseAssets` plugin's post-build copy of
  `/course-kit` and `/courses` into `dist/`, and the SPA fallback — had no
  automated coverage at all while the gate ran against the dev server.
  `p1.spec.ts` asserts the served HTML really is the built one (it
  references hashed `/assets/…` bundles, not `/src/main.tsx`) so this
  cannot silently revert.

### Prerequisites

Read this **before** running `make test-e2e` the first time — both items
below surface as a hang or a failure at the moment you run it, not
before, if you skip this.

1. **Docker**, running.
2. **Bun** (`apps/web`'s package manager and test runner).
3. **The `golang-migrate` CLI (`migrate`) on `PATH`.** `make test-e2e`
   applies `apps/api/migrations/*.sql` against the compose stack's
   Postgres the same explicit, operator-driven way `docs/deploy.md` §3
   documents for production — it is not wired into the API's boot
   sequence (`apps/api/cmd/api/main.go` deliberately does not migrate on
   boot). Install the exact pinned version `docs/deploy.md` §1 already
   documents:
   ```bash
   go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@v4.19.1
   ```
   `scripts/test-e2e.sh` checks for `migrate` on `PATH` up front and
   fails immediately with this exact command if it's missing, rather
   than failing confusingly later.
4. **A Docker Hub connection that can resolve the BuildKit frontend
   image, on the first build.** `make test-e2e` rebuilds the API image
   every run, and `apps/api/Dockerfile`'s `# syntax=docker/dockerfile:1`
   header makes Docker fetch that frontend image before building.
   Task 17's own verification hit a real, reproducible hang there (most
   likely Docker Hub's anonymous-pull rate limit on a shared sandbox
   egress IP — raw HTTPS to `registry-1.docker.io` answered instantly
   from the same host, so it was not a blanket network outage). If
   `make test-e2e` hangs at "Building api", pull it once by hand on a
   connection you know reaches Docker Hub:
   ```bash
   docker pull docker/dockerfile:1
   ```
   It is cached from then on and the per-run rebuild costs seconds.

   **Do not "fix" this by pre-building `tuhoc-api:latest` and dropping
   `--build`.** That was the previous advice here, and it is precisely
   what made the gate able to pass against an API binary that is not in
   your branch.

   `DOCKER_BUILDKIT=0 make test-e2e` removes the `# syntax=` frontend
   fetch specifically (verified: the build gets past that step), but it
   is not an offline mode — the build stage's own `golang:1.25.5-alpine`
   base image still has to be pullable or already in the local cache. On
   a machine where Docker Hub is unreachable altogether, neither builder
   can produce this image and the gate cannot run; that is an environment
   problem to fix, not a reason to test a stale binary.

### Running it

```bash
make test-e2e
```

Focused special-edition checks, including the production manifest graph and
controlled screenshots, run from `apps/web`:

```bash
bun run check:stories-bundle
bunx playwright test e2e/stories.spec.ts
```

The web step builds before it serves, so the first run in a clean
checkout spends a little time in `vite build` before the browser starts.

Tears the compose stack down on exit — pass or fail — via a `trap ...
EXIT` in `scripts/test-e2e.sh`, so a failed run doesn't leave containers
or a database behind.

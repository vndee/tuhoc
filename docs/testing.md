# Testing tuhoc

Unit/integration tests: `make test-api` (Go, spins up real Postgres via
testcontainers per-package) and `make test-web` (vitest, jsdom). This
doc is only about the one that's different in kind:

## `make test-e2e` — the P1 end-to-end gate

Brings up the real API + Postgres, serves the real **production build**
of the web app, and drives both with a real browser (Playwright) to prove
the whole stack works together — see `apps/web/e2e/p1.spec.ts`,
`apps/web/e2e/widget.spec.ts` and
`.superpowers/sdd/2026-08-19-p1-platform-core/task-17-report.md` for what
it actually checks and why.

**Two spec files actually run**, and they are gates for different things:
`p1.spec.ts` (the reader — including the course table of contents, inherited
from the deleted `s1.spec.ts`) and `widget.spec.ts` (the phase-1 security
gate: a course widget runs inside `sandbox="allow-scripts"`, its origin is
opaque, and `document.cookie` throws rather than returning the session).

One more sits in the directory but is **quarantined** in
`apps/web/playwright.config.ts`'s `testIgnore`, with its reason recorded at
the top of the file itself: `p2.spec.ts` (annotations — its fixture
expectations predate the server-side pivot).

Gone with the features they covered: `import.spec.ts` and `s1.spec.ts` (the
Import screen and the version-pinning update dialog, removed in `e58ef41`;
see `fixtures/README.md` for what the two package-variant scenarios were),
`s3.spec.ts`/`s4.spec.ts` (the registry catalog UI), `viz.spec.ts` (the
course-wide `viz.js` runtime, replaced by sandboxed widgets), and
`s2.spec.ts` (the AI/BYOK key vault — it built, served and drove
`apps/vault`, which Pha 2 Task 16 deleted; it was quarantined before it was
deleted, and those are two different states).

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

The web step builds before it serves, so the first run in a clean
checkout spends a little time in `vite build` before the browser starts.

Tears the compose stack down on exit — pass or fail — via a `trap ...
EXIT` in `scripts/test-e2e.sh`, so a failed run doesn't leave containers
or a database behind.

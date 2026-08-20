# Testing tuhoc

Unit/integration tests: `make test-api` (Go, spins up real Postgres via
testcontainers per-package) and `make test-web` (vitest, jsdom). This
doc is only about the one that's different in kind:

## `make test-e2e` — the P1 end-to-end gate

Brings up the real API + Postgres, the real Vite dev server, and drives
both with a real browser (Playwright) to prove the whole stack works
together — see `apps/web/e2e/p1.spec.ts` and
`.superpowers/sdd/2026-08-19-p1-platform-core/task-17-report.md` for what
it actually checks and why.

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
4. **One-time, before the very first `make test-e2e` run on a machine
   that has never built the API image:** run
   ```bash
   docker build -t tuhoc-api:latest apps/api
   ```
   by hand first, on a connection you know can reach Docker Hub.
   `apps/api/compose.e2e.yml`'s `api` service declares `image:
   tuhoc-api:latest` alongside its own `build:` block — `docker compose
   up` only invokes the build when that tag doesn't already exist
   locally, so every run *after* this one-time build reuses it and never
   touches the network for it again. Why this is called out explicitly:
   this task's own verification hit a real, reproducible hang resolving
   `apps/api/Dockerfile`'s `# syntax=docker/dockerfile:1` frontend image
   over the network (most likely Docker Hub's anonymous-pull rate limit
   on a shared sandbox egress IP — raw HTTPS to `registry-1.docker.io`
   answered instantly from the same host, so it is not a blanket network
   outage). Unlikely to reproduce on an ordinary developer machine or CI
   runner, but real and worth a five-second pre-build rather than a
   confusing multi-minute hang the first time someone runs the gate.

### Running it

```bash
make test-e2e
```

Tears the compose stack down on exit — pass or fail — via a `trap ...
EXIT` in `scripts/test-e2e.sh`, so a failed run doesn't leave containers
or a database behind.

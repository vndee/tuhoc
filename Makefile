.PHONY: dev-api dev-web test-api test-web test-format test-cli pack courses test-e2e test-viz setup-extract test-extract extract
dev-api:  ; cd apps/api && go run ./cmd/api
dev-web:  courses ; cd apps/web && bun run dev
test-api: ; cd apps/api && go test ./...
# `courses` first: four unit test files read a chapter of the real course, and
# since task 11 the course is not in this repo — see the `courses` target below.
test-web: courses ; cd apps/web && bun run test
# packages/course-format — the course package rule set shared by the packaging
# CLI, registry CI and the browser importer. Two gates, both required: vitest
# for behaviour, and `tsc -b` for types.
#
# `tsc -b`, NOT `tsc --noEmit`: `--noEmit` does not descend into project
# references and has already produced one empty, always-green gate in this repo
# (docs/carried-forward.md §2). This package's tsconfig names real sources in
# `include`, so both would work here — `tsc -b` is used anyway so there is one
# type-gate shape in the repo rather than two, and it is the shape proven to go
# red. Verified by injecting `const x: number = 'chuỗi'` into src/validate.ts
# (exit 1) and into src/validate.test.ts (exit 1, so test files are covered too).
#
# Note this package has its own node_modules: the repo has no npm workspaces
# and no root package.json. Run `cd packages/course-format && bun install` once.
#
# `courses` first: `src/zip.test.ts`'s last describe packs and unpacks the REAL
# 46-file course, and since task 11 that content is not in the repo.
test-format: courses ; cd packages/course-format && bun run typecheck && bun run test
# tools/tuhoc-cli — the packaging CLI (`tuhoc init` / `tuhoc pack`), the first
# command a contributor runs before opening a PR against the course registry.
# Same two gates and the same reasoning as test-format above: vitest for
# behaviour, `tsc -b` for types. It is a SEPARATE target from test-extract on
# purpose (ruling S1-F3) — `tools/` was pure Python until this landed, and
# mixing a Bun project into the pytest target would give one command two
# failure modes.
#
# Both halves verified to go red rather than assumed to: `const x: number =
# 'chuỗi'` injected into src/pack.ts, src/init.ts AND src/pack.test.ts each
# exits 1 (so test files are type-checked too), and 12 mutants of the CLI —
# including "the scaffold template itself is invalid" — are all killed by the
# suite, against a comment-only control that survives.
#
# This package has its own node_modules; the repo has no npm workspaces and no
# root package.json. Run `cd tools/tuhoc-cli && bun install` once.
test-cli: ; cd tools/tuhoc-cli && bun run typecheck && bun run test
# `make pack DIR=my-course` — check a course directory against
# packages/course-format and write a zip. Exits 1 and prints every finding when
# the package is not valid; DIR is relative to the repo root.
pack: ; bun tools/tuhoc-cli/src/index.ts pack $(DIR)
# `make courses` — unpack the course packages held OUTSIDE this repo into
# `courses/`, which is a working directory (`.gitignore`d in full), not source.
#
# Task 11 took `courses/***REMOVED***/` out of the repo: it is a private
# textbook, this repo gets published, and deleting it in a later commit rescues
# nothing because git keeps the history (spec §2B.1). It now lives as a `.zip`
# in a store outside the git tree — `~/Documents/claude/tuhoc-courses` by
# default, `TUHOC_COURSE_STORE` to point somewhere else.
#
# Nothing in the SHIPPED app needs this. Two things in the repo do, and both
# need the real bytes rather than a stand-in: `vite dev` serving `/courses/...`,
# and the test files that read a real chapter (four unit, four e2e). Swapping
# those to hand-written fixtures was the cheap option and is the one thing this
# task was told not to do — hand-written prose fixtures have passed while the
# real chapter failed often enough in this subsystem to have a ruling of their
# own. See scripts/course_workspace.py and apps/web/src/test/realCourse.ts.
#
# No store, or an empty one, is NOT an error: that is a fresh clone, and it
# exits 0 saying so.
courses: ; python3 scripts/course_workspace.py
# Task 17: the P1 end-to-end gate. Rebuilds and brings up Postgres + the
# real API via apps/api/compose.e2e.yml (always `--build`, so the gate can
# never pass against a stale API binary), applies migrations, builds and
# serves the real PRODUCTION web bundle, runs apps/web/e2e/*.spec.ts
# (Playwright) against all of it, and tears the whole stack back down
# afterwards regardless of pass/fail — see scripts/test-e2e.sh.
# Read docs/testing.md's "Prerequisites" section BEFORE the first run on
# a new machine (migrate CLI on PATH; one `docker pull docker/dockerfile:1`
# avoids a real Docker Hub resolution hang this task hit under its own
# sandbox).
#
# test-e2e runs BOTH specs. `make test-viz` runs only the exhaustive
# visualization sweep against a stack you already have up — minutes, not
# seconds; see apps/web/e2e/viz.spec.ts.
#
# `courses` first, for the same reason test-web has it: all four e2e files open
# the real course over HTTP, and the production bundle only carries it if it is
# on disk when `vite build` runs.
test-e2e: courses ; ./scripts/test-e2e.sh
test-viz: courses ; cd apps/web && bunx playwright test viz.spec.ts
# One-time setup for a fresh machine: test-extract depends on pytest, which
# is not part of this repo's own dependency graph (tools/ has no
# venv/lockfile of its own) and is not guaranteed to be installed by
# default. On Homebrew Python (PEP 668 "externally managed environment"),
# a plain `pip install` refuses to run outside a venv, hence
# --break-system-packages here — see tools/requirements.txt and
# docs/deploy.md for the full reasoning.
setup-extract: ; python3 -m pip install --break-system-packages -r tools/requirements.txt
test-extract: ; cd tools && python3 -m pytest test_extract.py -v
# One-shot converter from the v1 single-file textbook to a course DIRECTORY, at
# `courses/<id>/`. It is not part of any build: it ran once, and the package it
# produced is what has been maintained since.
#
# What it writes is a **v1 manifest** — no `tier`, `license`, `authors`,
# `generatedBy` — so `tuhoc pack` on its output exits 1 naming exactly those
# four fields. That is the correct answer, not a bug to route around: the four
# are decisions about publishing (which tier of trust, whose name, what
# licence, who wrote the prose) that a text-extraction script has no business
# guessing. Add them, then pack. Full walkthrough: docs/publishing.md §1.
extract:  ; python3 tools/extract.py --source ~/Documents/claude/Research/***REMOVED***.html --out .

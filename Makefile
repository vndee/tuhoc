.PHONY: dev-api dev-web test-api test-web test-e2e setup-extract test-extract extract
dev-api:  ; cd apps/api && go run ./cmd/api
dev-web:  ; cd apps/web && bun run dev
test-api: ; cd apps/api && go test ./...
test-web: ; cd apps/web && bun run test
# Task 17: the P1 end-to-end gate. Brings up Postgres + the real API via
# apps/api/compose.e2e.yml, applies migrations, boots the real web app,
# runs apps/web/e2e/p1.spec.ts (Playwright) against all of it, and tears
# the whole stack back down afterwards regardless of pass/fail — see
# scripts/test-e2e.sh for the actual orchestration and its own comment on
# this task's one real environment caveat (a Docker Hub resolution hang
# hit while building tuhoc-api under this task's own sandbox).
test-e2e: ; ./scripts/test-e2e.sh
# One-time setup for a fresh machine: test-extract depends on pytest, which
# is not part of this repo's own dependency graph (tools/ has no
# venv/lockfile of its own) and is not guaranteed to be installed by
# default. On Homebrew Python (PEP 668 "externally managed environment"),
# a plain `pip install` refuses to run outside a venv, hence
# --break-system-packages here — see tools/requirements.txt and
# docs/deploy.md for the full reasoning.
setup-extract: ; python3 -m pip install --break-system-packages -r tools/requirements.txt
test-extract: ; cd tools && python3 -m pytest test_extract.py -v
extract:  ; python3 tools/extract.py --source ~/Documents/claude/Research/***REMOVED***.html --out .

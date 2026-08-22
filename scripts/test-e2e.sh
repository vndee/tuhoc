#!/usr/bin/env bash
# Task 17: brings up Postgres + the real API (docker compose), applies
# migrations, boots the real web app, runs the Playwright P1
# definition-of-done suite against all of it, and tears the stack back
# down — win or lose. Invoked as `make test-e2e`; see the Makefile.
#
# Prerequisites (migrate CLI, a one-time docker build to dodge the hang
# documented below): see docs/testing.md before the first run on a new
# machine.
#
# The API image is ALWAYS rebuilt (`up -d --build`), never reused. This is
# not a nicety: `apps/api/compose.e2e.yml` declares `image: tuhoc-api:latest`
# alongside `build:`, and a plain `docker compose up` builds ONLY when that
# tag is absent locally. Every run after the first therefore silently reused
# a cached image — which made this script, the phase's acceptance gate,
# blind to every Go change since that image was built. A gate that can pass
# against a binary that is not in the branch is worse than no gate.
#
# Known environment caveat (see task-17-report.md for the full writeup):
# building requires the `apps/api/Dockerfile`'s `# syntax=docker/dockerfile:1`
# frontend image to resolve over the network. In task 17's own sandbox that
# resolution hung indefinitely (raw HTTPS to registry-1.docker.io worked
# fine from the host shell, but the Docker Desktop VM's own pull of that
# specific tag did not return — most likely Docker Hub's anonymous-pull
# rate limit on a shared sandbox egress IP, not a code problem). If
# `make test-e2e` hangs at "Building api", pull that frontend image once,
# ahead of time, on a connection that CAN reach Docker Hub:
# `docker pull docker/dockerfile:1`. Do NOT work around it by pre-building
# `tuhoc-api:latest` and dropping `--build` — that is exactly the hole this
# comment replaced. `DOCKER_BUILDKIT=0` removes the frontend fetch
# specifically (verified), but it is not an offline mode: the build stage's
# `golang:1.25.5-alpine` base still has to be pullable or cached. See
# docs/testing.md.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="$REPO_ROOT/apps/api/compose.e2e.yml"
DB_PORT="${TUHOC_E2E_DB_PORT:-55433}"
API_PORT="${TUHOC_E2E_API_PORT:-8089}"
WEB_PORT="${TUHOC_E2E_WEB_PORT:-5183}"
API_URL="http://localhost:${API_PORT}"
MIGRATE_DB_URL="postgres://tuhoc:tuhoc@localhost:${DB_PORT}/tuhoc?sslmode=disable"

export TUHOC_E2E_DB_PORT="$DB_PORT" TUHOC_E2E_API_PORT="$API_PORT" TUHOC_E2E_WEB_PORT="$WEB_PORT"

# TÊN PROJECT CỦA DOCKER COMPOSE — TƯỜNG MINH, RIÊNG CHO TỪNG WORKTREE.
#
# Trước dòng này, mọi lời gọi ở đây là `docker compose -f <file>` không có `-p`,
# và `apps/api/compose.e2e.yml` không có `name:`. Compose khi ấy lấy tên project
# theo THƯ MỤC CHỨA TỆP COMPOSE, tức là **`api` cho MỌI worktree** — cùng một
# tên cho mọi bản checkout trên máy này.
#
# Hệ quả đo được, và nó tệ hơn "hai lần chạy tranh nhau": cái `trap cleanup EXIT`
# ngay dưới gọi `down -v`, nên một lần chạy thứ hai — từ một worktree khác, của
# một agent khác — **kéo sập stack của lần chạy thứ nhất giữa chừng, và xoá luôn
# volume của nó**. Triệu chứng đổ lên đầu lần chạy thứ nhất dưới dạng "kết nối bị
# từ chối" hoặc "database rỗng", tức là trông y hệt một hồi quy của mã. Đây đúng
# lớp lỗi ruling S1-F41 đã ghi: một cổng về xanh (hoặc đỏ) vì thứ đang chạy không
# phải thứ vừa dựng.
#
# Tên dẫn xuất từ ĐƯỜNG DẪN worktree, không từ tên thư mục: hai worktree có thể
# trùng tên thư mục cuối, và một tên project trùng là đúng cái lỗi đang được vá.
# Phần basename được giữ lại (đã lọc) chỉ để `docker ps` còn đọc được.
#
# CÒN LẠI, CỐ Ý KHÔNG SỬA Ở ĐÂY, vì cả hai nằm ngoài tệp này:
#   · CỔNG máy chủ (`$DB_PORT`/`$API_PORT`/`$WEB_PORT`) vẫn cố định, nên hai lần
#     chạy SONG SONG vẫn tranh cổng — chúng đã nhận biến môi trường, và việc cấp
#     phát động thuộc về người quyết định có cho chạy song song hay không;
#   · thẻ ảnh `tuhoc-api:latest` khai trong compose.e2e.yml cũng dùng chung cho
#     mọi worktree, nên hai lần `--build` song song vẫn ghi đè nhau. Vá nó là sửa
#     tệp compose, và tệp ấy có lý do riêng để mang đúng thẻ mà docs/deploy.md
#     dựng (xem chú thích của chính nó).
COMPOSE_PROJECT="${TUHOC_E2E_COMPOSE_PROJECT:-}"
if [ -z "$COMPOSE_PROJECT" ]; then
  ROOT_SLUG="$(printf '%s' "$(basename "$REPO_ROOT")" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-' | cut -c1-24)"
  ROOT_HASH="$(printf '%s' "$REPO_ROOT" | shasum | cut -c1-8)"
  COMPOSE_PROJECT="tuhoc-e2e-${ROOT_SLUG}-${ROOT_HASH}"
fi
# Một mảng, không một chuỗi: `set -u` cộng với việc chèn chuỗi vào lệnh là cách
# một khoảng trắng trong đường dẫn worktree trở thành hai đối số.
COMPOSE=(docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE")

log() { printf '\n==> %s\n' "$1"; }
fail() {
  printf '\nFAIL: %s\n' "$1" >&2
  exit 1
}

STACK_UP=0
cleanup() {
  if [ "$STACK_UP" -eq 1 ]; then
    log "tearing down docker compose stack (db + api, plus the anonymous db volume)"
    "${COMPOSE[@]}" down -v
  fi
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || fail "docker not found on PATH"
command -v bun >/dev/null 2>&1 || fail "bun not found on PATH"
command -v migrate >/dev/null 2>&1 || fail "golang-migrate CLI ('migrate') not found on PATH — see docs/deploy.md §1 for the pinned install command (go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@v4.19.1)"

log "bringing up Postgres + API (project $COMPOSE_PROJECT, file $COMPOSE_FILE)"
# --build is load-bearing — see this script's header comment. Without it the
# gate happily tests whatever tuhoc-api:latest happened to be built from
# last, which may be another branch, or a week old.
"${COMPOSE[@]}" up -d --build
UP_EXIT=$?
echo "docker compose up exit=$UP_EXIT"
[ "$UP_EXIT" -eq 0 ] || fail "docker compose up failed (exit=$UP_EXIT) — see output above"
STACK_UP=1

log "waiting for API /healthz at $API_URL (up to 60s)"
API_READY=0
for i in $(seq 1 60); do
  if curl -fsS -m 2 "$API_URL/healthz" >/dev/null 2>&1; then
    API_READY=1
    break
  fi
  sleep 1
done
if [ "$API_READY" -ne 1 ]; then
  "${COMPOSE[@]}" logs
  fail "API never became healthy at $API_URL/healthz within 60s"
fi
echo "API healthy after ${i}s"

log "applying migrations (migrate -path apps/api/migrations -database ... up)"
migrate -path "$REPO_ROOT/apps/api/migrations" -database "$MIGRATE_DB_URL" up
MIGRATE_EXIT=$?
echo "migrate up exit=$MIGRATE_EXIT"
# golang-migrate's CLI exits 0 for "applied N" and ALSO for "no change" —
# both are a legitimate success here (compose.e2e.yml's db never carries a
# prior run's data — see its own no-volume comment — so "no change" would
# only mean this script's own migrate call already ran once already this
# invocation, which never happens; it's still not worth treating as a
# distinct failure mode).
[ "$MIGRATE_EXIT" -eq 0 ] || fail "migrate up failed (exit=$MIGRATE_EXIT)"

log "installing web dependencies (bun install)"
(cd "$REPO_ROOT/apps/web" && bun install)
INSTALL_EXIT=$?
echo "bun install exit=$INSTALL_EXIT"
[ "$INSTALL_EXIT" -eq 0 ] || fail "bun install failed (exit=$INSTALL_EXIT)"

log "ensuring the Playwright chromium browser is installed"
(cd "$REPO_ROOT/apps/web" && bunx playwright install chromium)
PW_INSTALL_EXIT=$?
echo "playwright install exit=$PW_INSTALL_EXIT"
[ "$PW_INSTALL_EXIT" -eq 0 ] || fail "playwright browser install failed (exit=$PW_INSTALL_EXIT)"

log "running the Playwright P1 definition-of-done suite"
(cd "$REPO_ROOT/apps/web" && VITE_API_URL="$API_URL" bunx playwright test)
TEST_EXIT=$?
echo "playwright test exit=$TEST_EXIT"

log "docker compose logs (api service, last 50 lines) — kept for the report regardless of pass/fail"
"${COMPOSE[@]}" logs api --tail 50

exit "$TEST_EXIT"

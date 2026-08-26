.PHONY: dev-api dev-web dev-vault test-api test-web test-vault test-format test-cli test-registry pack courses test-e2e setup-extract test-extract extract check-publish
dev-api:  ; cd apps/api && go run ./cmd/api
dev-web:  courses ; cd apps/web && bun run dev
# apps/vault — KHO KHOÁ, chạy ở CỔNG 5174 trong khi dev-web chạy ở 5173.
#
# Hai cổng, không phải một đường dẫn `/vault/` trên cùng cổng: origin bao gồm cả
# cổng, nên `http://localhost:5173` và `http://localhost:5174` là hai origin khác
# nhau và trình duyệt cách ly `localStorage` giữa chúng. Đó chính là hàng rào mà
# hệ thống con này dựng lên — một đường dẫn trên cùng cổng sẽ là CÙNG origin và
# phá huỷ toàn bộ mục đích.
#
# Cần cả hai chạy song song khi phát triển tính năng AI: `make dev-web` ở một
# terminal, `make dev-vault` ở terminal khác.
dev-vault: ; cd apps/vault && bun run dev
# gofmt là một cổng, không phải một thói quen. Hai tệp đã lệch định dạng và
# không ai biết, vì `make` chưa từng hỏi — một trong hai do chính điều phối viên
# thêm vào. `gofmt -l` in ra TÊN TỆP lệch và thoát 0 dù có lệch hay không, nên
# phải tự chuyển thành mã thoát.
gofmt-check:
	@cd apps/api && out=$$(gofmt -l .); if [ -n "$$out" ]; then echo "gofmt: các tệp sau lệch định dạng:"; echo "$$out" | sed 's/^/  /'; echo "  chạy: cd apps/api && gofmt -w ."; exit 1; fi

test-api: gofmt-check ; cd apps/api && go test ./...
# `courses` first: four unit test files read a chapter of a real, packed course
# — since task 13 that is the PUBLIC sample package `so-dau-phay-dong`, which
# lives in this repo at `fixtures/courses/` but is read from the `courses/`
# working directory. See the `courses` target below.
#
# `bun run typecheck` (`tsc -b`) chạy TRƯỚC vitest, thêm ở Task 4 của hệ thống
# con 3, và lý do là một phép đo chứ không phải sự đồng bộ hình thức với bốn
# target dưới đây:
#
#   apps/vault           → typecheck
#   packages/course-format → typecheck
#   tools/tuhoc-cli      → typecheck
#   tools/registry       → typecheck
#   apps/web             → KHÔNG. `bun run test` = vitest, và vitest KHÔNG kiểm kiểu.
#
# Tức là thư mục LỚN NHẤT repo là thư mục duy nhất không có cổng kiểu, ở đúng
# hình dạng năm cổng mù đã ghi trong docs/carried-forward.md. Nó không phải giả
# thuyết: báo cáo Task 3 §0.2 ghi lại một ca `bun run test` XANH trong khi
# `tsc -b` thoát 2 trên cùng cây mã (fixture khai sai `generatedBy`), và cổng
# duy nhất bắt được là một lệnh gõ tay.
#
# Với hệ song ngữ thì khoảng trống ấy đắt hơn nữa: lời hứa "không khoá dịch nào
# được phép thiếu ở một ngôn ngữ" được cưỡng chế BẰNG KIỂU (`en: Messages`), nên
# nếu không có ai chạy `tsc` thì lời hứa ấy không có cổng nào cả. Đã đo, hai
# chiều, khôi phục trong cùng lệnh shell với `shasum` khớp: xoá một khoá trong
# `src/i18n/messages/en.ts` → TS2741, thoát **2**; thêm một khoá → TS2353, thoát
# **2**; khôi phục → thoát **0**.
#
# `tsc -b`, KHÔNG `tsc --noEmit`: `--noEmit` không đi xuống project reference và
# đã tạo ra một cổng rỗng, luôn xanh, trong repo này (docs/carried-forward.md §2).
test-web: courses ; cd apps/web && bun run typecheck && bun run test
# apps/vault — kho khoá ở origin riêng. BA cổng: `tsc -b` cho kiểu, `oxlint`
# cho mã, vitest cho hành vi. KHÔNG phụ thuộc `courses`: kho khoá không bao giờ
# chạm tới nội dung course — nó chỉ giữ key và gọi nhà cung cấp.
#
# `oxlint` được thêm ở Task 6 của hệ thống con 2, và lý do nằm trong một câu mà
# ba báo cáo liên tiếp đều ghi lại: **thư mục chạm tới key là thư mục có ít cổng
# nhất repo** — `apps/web` chạy lint, `apps/vault` thì không. Cấu hình ở
# `apps/vault/.oxlintrc.json` hẹp có chủ ý; luật đáng kể nhất là `no-console`
# bật mức ERROR cho mã sản phẩm, vì "key không bao giờ vào log" là một ràng buộc
# CÓ TÊN của hệ thống con này mà cho tới nay chỉ có bẫy trong test canh. Một
# `console.warn` để gỡ lỗi là đủ để rò key ra DevTools của bất kỳ ai mở khung
# kho khoá, và nó là kiểu dòng mã được thêm vào lúc 2 giờ sáng rồi ở lại.
# Tệp test và `scripts/` được miễn: `providers.test.ts` CỐ Ý gọi `console.warn`
# với một key giả để chứng minh bẫy console của chính nó còn sống.
#
# `tsc -b`, KHÔNG phải `tsc --noEmit`, vì lý do đã ghi ở test-format và trong
# docs/carried-forward.md §2. Đã kiểm là ĐỎ được chứ không giả định: chèn
# `const mutantA: number = "chuoi"` vào src/main.ts → exit 1, và vào
# src/protocol.test.ts → exit 1 (nên tệp test cũng được kiểm kiểu).
#
# NỬA THỨ BA — `assert-tests-ran.mjs` — là thứ khác với hai mục trên, và nó có
# lý do đo được. Vitest 4.1.11, đo trong chính thư mục này ngày 2026-08-22:
#
#   · include không khớp tệp nào  → vitest thoát 1  (cổng tự đỏ, tốt)
#   · MỌI describe bị `.skip`     → vitest thoát 0  ("Tests 8 skipped (8)")
#
# Trường hợp thứ hai là cổng mù thứ SÁU đang chờ xảy ra, cùng hình dạng với năm
# cái đã ghi trong docs/carried-forward.md. Script đọc `numPassedTests` từ
# reporter json và đỏ khi con số đó bằng 0 — hoặc khi có bất kỳ test nào bị
# `.skip`/`.todo`, vì ở kho khoá thì một bài kiểm bị tắt lặng lẽ (ví dụ bài
# "origin lạ không gây ra bất kỳ ảnh hưởng nào") là thứ không được phép trôi
# qua. `numTotalTests` KHÔNG dùng được: ở trường hợp skip nó vẫn bằng 8.
#
# `rm -f` tệp tóm tắt TRƯỚC khi chạy là có chủ ý: nếu ai đó gỡ cờ
# `--reporter=json`, cổng đỏ vì thiếu tệp thay vì đọc lại kết quả lần trước.
#
# Thư mục này có node_modules riêng; repo không có npm workspaces và không có
# package.json ở gốc. Chạy `cd apps/vault && bun install` một lần.
test-vault: ; cd apps/vault && rm -f node_modules/.tmp/vitest-summary.json && bun run typecheck && bun run lint && bunx vitest run --reporter=default --reporter=json --outputFile.json=node_modules/.tmp/vitest-summary.json && node scripts/assert-tests-ran.mjs node_modules/.tmp/vitest-summary.json
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
# `courses` first: `src/zip.test.ts`'s last describe packs and unpacks a REAL
# course package from `courses/` — 10 files since task 13, when the ngữ liệu
# moved from the private textbook to the public sample package.
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
#
# `courses` first since task 13: `src/pack.test.ts`'s last describe runs the CLI
# against a real, committed course directory and checks its exit code equals the
# rule set's verdict. That was the sixth unit test file depending on course
# content, and it is the one ruling S1-F5 and its own correction both missed.
# Task 17 (server-side pivot) retargeted it from `courses/so-dau-phay-dong/` to
# `courses/bat-bien-vong-lap/` — the first is a v1 `interactive` sample kept for
# OTHER tests' real-content needs and is deliberately, permanently invalid under
# format v2 (`viz.js`) until it is rewritten as a widget; the second already
# passes cleanly. See `pack.test.ts`'s own comment for the full account.
test-cli: courses ; cd tools/tuhoc-cli && bun run typecheck && bun run test
# tools/registry — cổng CI của registry, và bản chạy CỤC BỘ của nó.
#
# Vì sao target này tồn tại: `.github/workflows/registry.yml` không chạy được ở
# máy ai cả. Nên mọi thứ quyết định được nằm trong `tools/registry/`, còn workflow
# chỉ gọi. `make test-registry` chạy ĐÚNG những lệnh workflow chạy, nên phần
# đáng kiểm được kiểm trước khi đẩy lên.
#
# Sau pha chuyển trục 2026-08-25 (task 17): `build-index.ts`/`pack-site.ts` đã
# gỡ — catalog nay là `/courses` của `apps/api`, không còn `index.json` xuất
# bản qua GitHub Pages nữa (lý do đầy đủ nằm ở đầu `validate-pr.ts`). Cái còn
# lại là cổng kiểm PR trước khi merge, không phải cổng an toàn cuối cùng nữa —
# `apps/api/internal/catalog/usecase.go`'s `publishZip` mới là cổng thật, chạy
# lại TOÀN BỘ bộ luật trên mọi lần publish. `make test-registry` xanh chứng
# minh công cụ này còn hoạt động, không chứng minh có gì đó đang được nó canh.
#
# Ba phép, và phép thứ ba là khẳng định chịu lực:
#   1. `tsc -b` (không phải `tsc --noEmit` — cổng rỗng trong repo này). Đã đo
#      chứ không đoán: nhét `const x: number = "chuỗi"` vào src/ thì thoát 1.
#   2. vitest — trong đó có ca "gói hạng content mang <script> BỊ TỪ CHỐI" và ca
#      ĐỐI CHỨNG "cùng gói ấy khai interactive thì ĐƯỢC". Thiếu ca hai thì một
#      cài đặt từ chối mọi thứ cũng xanh.
#   3. chạy bộ luật thật lên `fixtures/registry/` — MỘT gói mẫu tối thiểu, hợp
#      lệ theo v2. KHÔNG phải `fixtures/courses/`: gói đó có đúng hai course, và
#      một trong hai (`so-dau-phay-dong`) là ngữ liệu v1 cố ý giữ lại cho mười
#      tệp test khác (xem `fixtures/README.md`) — nó sẽ MÃI MÃI không hợp lệ
#      dưới v2 (JS_FILE_IN_PACKAGE trên `viz.js`) cho tới khi được soạn lại
#      thành widget, việc nội dung ngoài phạm vi cổng này. Trộn hai vai — "ngữ
#      liệu thật cho việc khác" và "cây phải sạch 100% cho cổng này" — vào
#      cùng một thư mục là thứ đã làm `make test-registry` đỏ suốt từ task 1.
#
# KHÔNG phụ thuộc `courses`: registry chỉ đọc `fixtures/registry/` (đã commit,
# không cần bung). Giáo trình riêng tư nằm ở kho ngoài cây git và KHÔNG BAO GIỜ
# chạm registry — `make check-publish` vẫn là cổng của chuyện đó.
#
# Thư mục này có node_modules riêng; repo không có npm workspaces và không có
# package.json ở gốc. Chạy `cd tools/registry && bun install` một lần.
test-registry: ; cd tools/registry && bun run typecheck && bun run test && cd ../.. && bun tools/registry/src/validate-pr.ts --root fixtures/registry
# `make pack DIR=my-course` — check a course directory against
# packages/course-format and write a zip. Exits 1 and prints every finding when
# the package is not valid; DIR is relative to the repo root.
pack: ; bun tools/tuhoc-cli/src/index.ts pack $(DIR)
# `make courses` — unpack course packages into `courses/`, which is a working
# directory (`.gitignore`d in full), not source.
#
# TWO sources, and the split is the whole point:
#
#   1. `fixtures/courses/*.zip` — public sample packages, COMMITTED, written by
#      this repo and produced by `tuhoc pack`. These are the default test data,
#      so a fresh clone is green on every gate without anyone handing it
#      anything (task 13).
#   2. A store OUTSIDE the git tree — `~/Documents/claude/tuhoc-courses` by
#      default, `TUHOC_COURSE_STORE` to point elsewhere. Task 11 moved the
#      private textbook there: this repo gets published, and deleting it in a
#      later commit rescues nothing because git keeps the history (spec §2B.1).
#
# Two packages with the same `manifest.id` are refused loudly rather than one
# silently winning — including across the two sources, because a private
# package shadowing the sample would make the whole suite measure content
# nobody chose.
#
# Nothing in the SHIPPED app needs this. Two things in the repo do, and both
# need real packed bytes rather than a stand-in: `vite dev` serving
# `/courses/...`, and the ten test files that read a real chapter (six unit,
# four e2e). Swapping those to HTML written inside the test files was the cheap
# option and is the one thing this subsystem was told not to do — hand-written
# prose fixtures have passed while a real chapter failed often enough here to
# have a ruling of their own. See scripts/course_workspace.py and
# apps/web/src/test/sampleCourse.ts.
#
# No private store, or an empty one, is NOT an error: that is a fresh clone,
# and it says so and carries on with the sample packages.
# Cài dependency ở MỌI nơi có package.json riêng. Repo này không dùng workspace,
# nên mỗi thư mục tự quản `node_modules` — và một worktree mới KHÔNG có cái nào.
#
# Đã cắn NĂM lần, mỗi lần trông như một hồi quy khác nhau:
#   thiếu apps/vault             -> test-vault đỏ vì @types/node
#   thiếu apps/web               -> test-web không chạy
#   thiếu packages/course-format -> test-web thoát 2, lỗi resolve `parse5`
#   thiếu tools/tuhoc-cli        -> test-cli thoát 127, `tsc: command not found`
#   thiếu tools/registry         -> test-registry thoát 127, cùng lỗi
# Không cái nào tự nói ra nguyên nhân thật.
DEP_DIRS = apps/web apps/vault packages/course-format tools/tuhoc-cli tools/registry
deps:
	@for d in $(DEP_DIRS); do printf '  %-28s ' "$$d"; (cd $$d && bun install --silent 2>&1 | tail -1) || exit 1; done

courses: ; python3 scripts/course_workspace.py
# `make check-publish` — cổng TIỀN-PUBLISH. Thoát 1 khi repo còn dấu vết course
# riêng tư ở BẤT KỲ đâu; thoát 0 khi không còn. Đây là mục kiểm chạy được thay
# cho danh sách gạch đầu dòng ở `docs/publishing.md` §3.
#
# `courses` chạy trước, và đó không phải thói quen sao chép từ các mục trên:
# phép đo thứ NĂM của script (văn xuôi chép nguyên văn, không kèm tên course)
# cần chính gói riêng làm máy đối chiếu, và gói ấy chỉ có mặt sau khi
# `make courses` bung nó ra từ kho ngoài cây git. Không có nó, phép 5 nói thẳng
# là đã bỏ qua — nó không im lặng cho xanh.
#
# `git filter-repo --invert-paths --path courses/` một mình KHÔNG đủ: ba trong
# bốn đường rò mà thẩm định hệ thống con 1 tìm ra nằm ngoài `courses/` và sống
# sót trọn vẹn qua nó. Xem docs/publishing.md §2.7.
check-publish: courses ; python3 scripts/check_publishable.py
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
# `test-viz` and the exhaustive visualization sweep it ran
# (`apps/web/e2e/viz.spec.ts`) are GONE as of Task 11 of the server-side
# pivot, together, in the same commit: course-wide `viz.js` execution is
# retired — a chapter's interactive parts are now widgets running each in
# their own `sandbox="allow-scripts"` iframe (reader/WidgetFrame.tsx) — so
# there is no more per-course visualization set for that target to sweep.
# Task 16 writes its replacement, a real browser driving a real widget and
# asserting it cannot reach the session.
#
# `courses` first, for the same reason test-web has it: all four e2e files open
# the real course over HTTP, and the production bundle only carries it if it is
# on disk when `vite build` runs.
test-e2e: courses ; ./scripts/test-e2e.sh
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
# ⚠️ CẢNH BÁO ĐÃ ĐO (2026-08-22): target này sinh lại `packages/course-kit/runtime.js`
# từ bản v1 một-tệp, và bản v1 mang mã TRƯỚC khi vá lỗ Critical S1-F43 — nên chạy
# `make extract` sẽ HOÀN NGUYÊN phép vá ấy, im lặng. Đã xảy ra thật một lần.
# Hàng rào ở `apps/web/src/db/local.test.ts` bắt được (2 test đỏ) CHỈ VÌ thẩm quyền
# của nó đã được mở từ "một thư mục" thành "mọi tệp ta ship tới trình duyệt" khi vá
# C1. Bản hàng rào cũ không quét `packages/` và sẽ cho lỗ hổng quay lại không tiếng động.
# ⇒ Sau khi chạy target này, LUÔN chạy `make test-web` trước khi commit.
#
# Không viết cứng course nào ở đây: một hằng số trỏ vào giáo trình riêng thì đi
# cùng Makefile ra công khai (phép 4 của `make check-publish` bắt đúng dòng này).
# Bốn giá trị đến từ môi trường; thiếu cái nào thì dừng và nói thiếu cái nào,
# thay vì chạy nửa vời. Hướng dẫn đầy đủ: docs/publishing.md §1.4.
extract:
	@test -n "$$TUHOC_V1_SOURCE"  || { echo "extract: thiếu TUHOC_V1_SOURCE (đường dẫn tệp v1 một-tệp) — xem docs/publishing.md §1.4"; exit 1; }
	@test -n "$$COURSE_ID"        || { echo "extract: thiếu COURSE_ID — xem docs/publishing.md §1.4"; exit 1; }
	@test -n "$$COURSE_TITLE"     || { echo "extract: thiếu COURSE_TITLE — xem docs/publishing.md §1.4"; exit 1; }
	@test -n "$$COURSE_DESC"      || { echo "extract: thiếu COURSE_DESC — xem docs/publishing.md §1.4"; exit 1; }
	python3 tools/extract.py --out . --id "$$COURSE_ID" --title "$$COURSE_TITLE" --description "$$COURSE_DESC"

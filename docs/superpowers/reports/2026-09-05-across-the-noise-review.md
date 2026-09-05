# Across the Noise — Task24 local review gate

Implementation status: complete for independent review. Implementation commit: `78dea4e` (`test: verify communication edition privacy accessibility and loading`). All required local gates passed on that implementation; final normal production artifacts are restored. This is execution evidence, not a release authorization.

## Scope and implementation

Worktree: `/Users/vndee/Documents/claude/tuhoc/.worktrees/dac-san`, branch `codex/across-the-noise-design`; Task24 began at clean `daf7543`. No root checkout edits, artwork generation, publication/featured changes, push, PR, merge or deployment. RTK.md remains absent in both this worktree and root. TDD and verification-before-completion skills were used; no subagents were dispatched.

- Broadened static-entry leak detection to every issue's full content (including provenance JSON and scene assets), all lab subdirectories and session runtime. Metadata/cover assets, explicit registry and type-only definitions remain allowed. A real Vite fixture verifies folded imports and dynamic exclusion.
- R21: explicit initial imports are unchanged. A build-specific JSON map is paired by unique filename and validated buildId with the current runtime. Only explicit Retry attempts fetch that first-party map and import the requested entry with a bounded numeric query. Unavailable/malformed/unsafe/mismatched metadata fails with fixed content-free codes. Recovered module exports are cached by lab kind (no payload/session), so Back/reopen remains usable. Focus moves to the recovered group. No reload, error-text URL parsing, eval, service worker or runtime dependency.
- Added bilingual, optional non-gating Predict prompts to labs01–03 (R10). General SECDED decision wording and advanced rejection report an uncorrectable pattern; normal bounded two-error feedback is preserved (R15).
- Guarded null comparison rows and incomplete binary-noise route-memory snapshots. Expanded stale precedence across all receipt outcomes and strict malformed-UTF8 final-scene evidence, with unchanged exact hex and no replacement sentence.
- Catalog missing/error tests now await actual query settlement. Renamed the AI-specific twelve-lab test accurately.
- R22: radio/checkbox labels now form aligned rows with normal20px native glyphs and≥44px actual clickable labels; real label-click and keyboard behavior covered at320/1440 in both themes. Other input/button targets and oldAI styles are preserved.
- Privacy E2E captures request URLs, bodies and raw byte bodies, console text/arguments, local/session storage, IndexedDB values, CacheStorage entries, cookies and URL. It uses the exact required distinctive message in06/08/09/11/12, an invalid probability draft, language and theme. Numeric JSON arrays/objects and UTF8 encodings are checked as well as literal/URL text; real GET catalog traffic is separately observed.
- Browser lifecycle covers p0 exact receipt, hash navigation, browser Back, theme, edit→stale, reset11→not-run, collection→Back and reload→fresh sample. Actual Retry retains message and prior receipt; separately failed artwork leaves its lab usable.
- Request/decode/CLS gates cover320/390/1024/1440. Maximum valid one-grapheme1024-byte payload is entered through the real editor and cancelled natively at6× Chrome CPU slowdown during each raw/repeat3/SECDED phase; old receipt/final scene stay unchanged and no partial completed table is published.

## TDD and intermediate evidence

All logs remain in `.superpowers/sdd/2026-09-05-across-the-noise/task-24-evidence/`.

| Evidence | Actual result |
|---|---|
| semantic-red.log | exit1;10 failed/51 passed. Six missing localized Predict regions, missing general content/lab leak detection, null batch row TypeError and advanced/general SECDED wrong feedback. |
| semantic-green.log | exit0;81 passed/9 files after minimal corrections plus final-receipt/catalog coverage. |
| retry-diagnosis-red.log | Actual Chrome: Retry did not recover; direct import of the same compiled URL remained rejected without a request; query-varied URL loaded a default function. Two requests total: original abort and fresh diagnostic import. |
| retry-unit-red.log | exit1; expected missing new retry resolver module before implementation. |
| retry-unit-green.log | exit0;37 passed/4 files. |
| retry-build-green.log | exit0;21 passed/2 files, including actual compiled metadata pairing/dynamic graph. |
| binary-guard-red.log | exit1;1 failed/15 passed; incomplete snapshot reached toBits(undefined). |
| binary-guard-green.log | exit0;28 passed/2 files, including content-free importer/map errors. |
| focused-browser.log | exit1;2 passed/5 failed. One real recovery reopening defect (original failed URL reused); four test-locator/counter issues. Retained traces. |
| focused-browser-2.log | exit1;9 passed/1 failed. Recovery+reopen+receipt, privacy, decode/CLS, three native cancellation phases and persistent fallback passed. Lifecycle failed because passive scrollIntoView did not release intentionally retained deep-link state. |
| lifecycle-green.log | exit0;1 passed after using native wheel reader intent; no reader runtime change. |
| loading-widths.log | exit0;4 passed, actual decode and CLS at each required width. |
| radio-red.log | exit1;native input box687.1875px wide; expected≤24. Before screenshot retained. |
| radio-green.log | exit0;4 passed at320/1440×light/dark; native label click/arrow/Space and≥44px labels. After screenshots independently viewed. |

R21 was raised to controller with concrete compiled-browser evidence before adding loader/build support. R22 followed controller's direct final-scene screenshot finding and was verified RED→GREEN before the final matrix.

## Fresh final verification

All package commands run from `apps/web` with `/Users/vndee/.bun/bin/bun`.

| Command | Exit / result | Evidence |
|---|---|---|
| bun run typecheck |0|final-typecheck.log|
| bun run lint |0;41 warnings in existing untouched owners|final-lint.log|
| bun run test |0;2053 passed/178 files,47.16s|final-test.log|
| bun run build (normal, before draft)|0|normal-build-before-draft.log|
| bun run check:stories-bundle|0|bundle-before-draft.log|
| actual normal production Chrome: e2e/stories.spec.ts|0;22 passed,40.5s|final-old-stories.log|
| full final draft Chrome|0;100 passed,15.7m|final-draft.log|
| final normal bun run build|0|final-normal-build.log|
| final normal bun run check:stories-bundle|0|final-normal-bundle.log|
| final normal production exclusion|0;1 passed,10.5s|final-production-exclusion.log|
| post-exclusion actual bundle graph|0|final-post-exclusion-bundle.log|
| final actual24-entry map/archive audit|0;24 modules,13 source+26 derivative hashes|final-artifact-audit.json|
| live local dev actual Chrome smoke|0;real catalog/decode/Retry/reopen/receipt|local-review-smoke.log|

The canonical test infrastructure command prefix, from worktree root:

```sh
PATH=/Users/vndee/.bun/bin:/Users/vndee/go/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin DOCKER_CONFIG=/private/tmp/tuhoc-noise-docker.WyKdkH DOCKER_HOST=unix:///Users/vndee/.docker/run/docker.sock TUHOC_E2E_DB_PORT=55434 TUHOC_E2E_WEB_PORT=5183 bash scripts/test-e2e.sh --config ../../.superpowers/sdd/2026-09-05-across-the-noise/task-23-production-chrome.config.ts e2e/stories.spec.ts --output ../../.superpowers/sdd/2026-09-05-across-the-noise/task-24-evidence/final-old-stories
PATH=/Users/vndee/.bun/bin:/Users/vndee/go/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin DOCKER_CONFIG=/private/tmp/tuhoc-noise-docker.WyKdkH DOCKER_HOST=unix:///Users/vndee/.docker/run/docker.sock TUHOC_E2E_DB_PORT=55434 TUHOC_E2E_WEB_PORT=5184 bash scripts/test-e2e.sh --config playwright.stories-draft.config.ts --output ../../.superpowers/sdd/2026-09-05-across-the-noise/task-24-evidence/final-draft
PATH=/Users/vndee/.bun/bin:/Users/vndee/go/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin DOCKER_CONFIG=/private/tmp/tuhoc-noise-docker.WyKdkH DOCKER_HOST=unix:///Users/vndee/.docker/run/docker.sock TUHOC_E2E_DB_PORT=55434 TUHOC_E2E_WEB_PORT=5183 bash scripts/test-e2e.sh --config ../../.superpowers/sdd/2026-09-05-across-the-noise/task-23-production-chrome.config.ts e2e/stories-draft-exclusion.spec.ts --output ../../.superpowers/sdd/2026-09-05-across-the-noise/task-24-evidence/final-production-exclusion
```

Each invocation redirects stdout/stderr to the corresponding named log. The ignored R19 Chrome wrapper imports the normal production config and changes only channel, absolute testDir and webServer.cwd. It preserves normal production build/server/API env, exclusions, workers1/retries0/timeouts. No successful mock is substituted for real integration. Each canonical script run freshly builds the real API with --build, applies12 migrations and seeds the real `mau-hop-le` course. That course is distinct from the desired subject-course slug; the coda honestly links `/courses`.

Deferred semantic item7 remains explicitly triaged: the full unit log contains61 jsdom `Window.scrollTo` notices, owned by existing `apps/web/src/reader/ChapterView.tsx:590` invoked by reader tests. Resolving these would require the unrelated reader-test setup to provide its expected scroll mock; Task24 does not change that runtime or globally suppress diagnostics. Existing lint warnings include StoryIssueSessionProvider fast-refresh exports and StoryPage effect plus unrelated reader/auth/annotation owners; no new changed Task24 production file warning. These untouched-owner warnings remain for their owning test/lint cleanup rather than a broad last-gate rewrite. Build emits the existing>500KB entry warning. E2E logs include NO_COLOR/FORCE_COLOR warning, expected unauthenticated /me401 and startup-before-migration backfill warning; catalog responses subsequently200. Output is therefore not claimed pristine. No current final-unit MSW or KaTeX warning appeared.

## Loading, privacy and measured budgets

Final matrix metrics are recorded in JSON files under successful Playwright output directories. Actual four-width Chrome CLS:320=.001161,390=.001161,1024=.002456774711608887,1440=.0028148148148148147. Initial scene-image requests numbered1 on mobile and2 on desktop; no distant04–12 scene image request and no lab request before opening. Opening06 loaded BinaryNoise, not Huffman/SECDED UI;08 requested Huffman. All13 plate images were explicitly present and successfully decoded before screenshot claims.

Final native6× CPU cancellation stopped at raw90/600, repeat3 245/600 and SECDED455/600, each inside its respective phase. Measured full interaction elapsed times (including the subsequent final-scene/receipt checks) were1663/3014/6384ms respectively; these are not per-trial timings or cancellation latency claims. No completed partial table appeared; the existing receipt and final exact message remained intact. Final privacy observation contained48 requests, allGET, and only itbook-lang=vi/itbook-theme=dark in localStorage; sessionStorage, IndexedDB, CacheStorage and cookies were empty, console argument count0. The final Retry observation records1 failed original request, in-place recovery, successful reopen and retained prior receipt.

The compiled-map audit executes `bun .superpowers/sdd/2026-09-05-across-the-noise/task-24-artifact-audit.mjs`. It passed both before draft and after the final production-exclusion script's own normal rebuild:24/24 explicit entries, each mapped file in real normal dist, filename/buildId pairing and all13 archived-source plus26 derivative hashes. Final map is `story-labs-fa106507-3459-45f3-92df-d6a27f987978.json` with matching buildId. The final artifact is a normal build, not the draft matrix's build; the dev review server does not overwrite dist. Huffman entry≈17.2KB, SECDED UI≈13.2KB, channel-budget≈22.4KB; those entry sizes exclude shared dependency chunks. No claim of a smaller total transfer is made.

Privacy observations use the fixed synthetic sentinel, never a reader's real message. The test confirms no captured outbound/persisted raw text, URL encoding, JSON/byte-array payload or typed-array object form. Successful and content-free error component tests cover fetch/console absence; failed loading errors expose only fixed codes. Session memory is intentionally discarded on route leave/reload.

## Thirteen accepted original plates

The artwork remains unchanged from accepted Tasks20–21. All large files1536×1024; small files768×512. Large cover≤250000bytes, large scenes≤320000, small≤100000. The exact record IDs/bytes/recorded edit counts below come from the actual provenance/hash audit, not invented generation metadata.

| Record | Large bytes | Small bytes | Recorded edits |
|---|---:|---:|---:|
|noise-cover|223680|61540|0|
|noise-scene-01|301448|73500|0|
|noise-scene-02|263924|93494|0|
|noise-scene-03|258196|69878|0|
|noise-scene-04|231138|70108|1|
|noise-scene-05|317970|92610|0|
|noise-scene-06|249460|89656|0|
|noise-scene-07|244110|63500|0|
|noise-scene-08|259870|74106|0|
|noise-scene-09|204304|54766|0|
|noise-scene-10|217032|57634|1|
|noise-scene-11|310642|90954|1|
|noise-scene-12|249000|63058|1|

All13 archived source SHA256s and26 responsive derivative hashes match existing provenance. Existing art provenance truthfully says the generator did not report its model or exact timestamp; createdAt is the post-completion UTC observation and the license category is project-generated, not an exclusivity guarantee. Source originals and intermediate edits remain preserved under the ignored art archives. No image-generation or export step was repeated in Task24. Existing exporter integration tests did run in the full suite against actual installed /usr/bin/sips and /opt/homebrew/bin/cwebp. Deferred semantic item6 remains Minor: `apps/web/scripts/export-story-plates.mjs` and its integration tests require those exact macOS tools. The approved local conversion gate succeeds here, no current webCI regression was established, and introducing a cross-platform encoder/tool-discovery policy would expand the verified-fix scope. Portable image/hash checks remain active, and missing conversion tools have not been hidden as successful conversion.

## Sources and semantic scope

Read the complete existing source-audit.md and static-example-audit.md, plus Task21 provenance report. Final content/model tests validate source mapping, numeric tables and bilingual structure. Task24 did not relabel prior metadata retrieval as a newly completed full-paper inspection. Earlier primary checks cover Shannon's engineering/semantic separation, entropy and asymptotic capacity; modern ITU Morse timing; historical cable material/infrastructure; Hamming overall parity and bounded SECDED; IBM's classical independent-flip repetition formula; MIT ISI/coding/capacity; Unicode grapheme/normalization distinctions.

Source-access limits remain explicit: LOC direct pages returned403, with official indexed metadata used; the original scanned Huffman algorithm image was not visible through the tool. Algorithm verification used the primary-paper excerpts reprinted in Stanford's teaching packet. The one-pole channel, deterministic seed, Huffman teaching container/tie-break and fictional human contexts are declared teaching choices, not historical measurements or protocols. SECDED advanced/general rejection is now correct for four physical flips as well as normal bounded examples.

## Screenshots and local review

Before/after native choice controls: `radio-red/` and `radio-green/`. Fresh final captures live under `task-24-evidence/final-draft/` with the following exact directory names; every loading directory contains `cover-light.png`, `cover-dark.png`, `lab-light.png`, `lab-dark.png`, `final-light.png`, `final-dark.png`, and `loading-and-cls.json` after actual successful decoding:

| Width | Final loading screenshot directory |
|---|---|
|320|across-the-noise-performan-ee75b-uest-and-CLS-stays-within-1-chromium|
|390|across-the-noise-performan-0c570-uest-and-CLS-stays-within-1-chromium|
|1024|across-the-noise-performan-5bcc6-uest-and-CLS-stays-within-1-chromium|
|1440|across-the-noise-performan-0ee81-uest-and-CLS-stays-within-1-chromium|

Final native radio/checkbox captures are `radio-label.png` and `checkbox-label.png` within `across-the-noise-selection-21dfd-ckbox-label-rows-1440-light-chromium`, `across-the-noise-selection-51d03-eckbox-label-rows-320-light-chromium`, `across-the-noise-selection-558ea-heckbox-label-rows-320-dark-chromium`, and `across-the-noise-selection-5c114-eckbox-label-rows-1440-dark-chromium`. Self-review directly viewed fresh cover/lab/final controls across mobile/desktop and both themes. The full matrix also retains affected scene diagrams/native reset captures.

The accepted cover-caption overlay remains unchanged; it hides some lower artwork on narrow screens, retained as a Minor visual triage observation rather than a redesign.

Live review URL: **http://localhost:5174/stories/across-the-noise?preview=1**. Separate owned project `tuhoc-noise-review-dac-san` uses existing `apps/api/compose.e2e.yml` with ignored `task-24-review-compose.yml` !override; Docker Compose2.37.1 resolved config and running service publication confirm API127.0.0.1:8098 and DB127.0.0.1:55435 only, CORS http://localhost:5174. Owned web PID78204/tool session91180 binds127.0.0.1:5174. API `/healthz` returned `{ "ok": true }`; DB and internal fake-provider health checks are healthy. Real migrations applied12 and real `mau-hop-le` fixture seed returned201. Actual Chrome on this live dev URL verified catalog200, decoded cover, failed-source Retry/reopen and prior exact receipt retention; then reloaded to discard its synthetic test session. `local-review-cover.png` preserves its final capture. The seeded catalog/API are real; the separate DeepSeek provider is the existing deterministic test stand-in, not production AI, and has no published host port.

Reproduction commands (worktree root except web command):

```sh
DOCKER_CONFIG=/private/tmp/tuhoc-noise-docker.WyKdkH DOCKER_HOST=unix:///Users/vndee/.docker/run/docker.sock TUHOC_E2E_WEB_PORT=5174 docker compose -p tuhoc-noise-review-dac-san -f apps/api/compose.e2e.yml -f .superpowers/sdd/2026-09-05-across-the-noise/task-24-review-compose.yml up -d --build
/Users/vndee/go/bin/migrate -path apps/api/migrations -database 'postgres://tuhoc:tuhoc@localhost:55435/tuhoc?sslmode=disable' up
# From apps/web:
VITE_API_URL=http://localhost:8098 /Users/vndee/.bun/bin/bun run dev -- --host 127.0.0.1 --port 5174 --strictPort
# From worktree root:
/Users/vndee/.bun/bin/bun .superpowers/sdd/2026-09-05-across-the-noise/task-24-review-smoke.mjs
```

The fixture was zipped from `fixtures/format-v2/valid-course` using `zip -rq -X` into `/private/tmp/tuhoc-noise-review-seed.86Kmr7/mau-hop-le.zip`, then PUT only to `http://localhost:8098/admin/courses/mau-hop-le` with the compose fixture admin token and `Content-Type: application/zip`. Startup, migration, seed, resolved config, running publications and browser smoke are retained as `local-review-*`/`review-compose-config.json` evidence. To stop only these review services later, stop PID78204/session91180 and run the same named compose command with `down` instead of `up -d --build`; do not target the user's compose project. No teardown is performed at handoff because the requested URL remains live.

Preserved user services: web5179, root-checkout API8099 and existing DockerDB55433; none stopped/reconfigured. Canonical tests own only project `tuhoc-e2e-dac-san-1f41f569` onDB55434/API8089/web5183 or5184, tearing it down after each sequential run. The isolated empty Docker configuration avoids the known credential-helper hang without changing user settings or credentials.

## Remaining limits and self-review

The Retry contract covers a failed requested entry becoming available again. A separately failed transitive module, removed deployment files or unavailable/mismatched pinned metadata can still leave the authored fallback and Back; no recursive dependency URL rewrite or universal offline/upgrade guarantee was added (R21). Successful cached module identity contains no session data.

Self-review found and corrected real failed-import reopen identity and the R22 choice-control layout; fresh final gates above were run after those corrections. `git diff --check` and exact staged-path inspection passed before implementation commit:36 scoped files, no artwork or publication metadata. The committed report is `docs/superpowers/reports/2026-09-05-across-the-noise-review.md`; the full local execution copy and all logs/source archives remain in ignored `.superpowers/sdd/2026-09-05-across-the-noise/`. No ignored evidence was force-added. Root owns independent final review and any subsequent rulings. No publication, push, PR, merge or deployment was performed.

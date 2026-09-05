# Task 14 report — Lab09 repetition coding

## Outcome

Implemented `repetition-channel` on branch `codex/across-the-noise-design` from base/HEAD `dddb9c2af497d4ea03881c462654279560813026`, using focused RED/GREEN before production implementation.

The lab now compares uncoded N-use transmission with repeat-3 3N-use transmission on the same UTF-8 payload and seed. It supports BSC and a shared burst interval, keeps explicit-run snapshots immutable and route-local, distinguishes observed metrics from independent-channel theory, and renders paged text-equivalent triple relationships with 60 bit cells maximum per view.

## TDD evidence

### RED

Command:

```text
/Users/vndee/.bun/bin/bun run test src/stories/labs/communication/repetition.test.ts src/stories/labs/repetition-channel
```

Observed output before implementation:

```text
Test Files  3 failed (3)
Tests  no tests
error: script "test" exited with code 1
```

All three suites failed for the intended missing-production-module reason: unresolved `./repetition`, `./model`, and `./RepetitionChannelLab` imports.

### Focused GREEN

Command:

```text
/Users/vndee/.bun/bin/bun run test src/stories/labs/communication/repetition.test.ts src/stories/labs/repetition-channel
```

Output:

```text
Test Files  3 passed (3)
Tests  35 passed (35)
Duration  1.61s
```

The first implementation run exposed one over-broad accessible-name regex (`Source bit 1` also matched `Source bit 12`). Tightening that test query produced the focused green result above; production behavior did not change for that test correction.

### Integration GREEN

Command:

```text
/Users/vndee/.bun/bin/bun run test src/stories/labs/communication/repetition.test.ts src/stories/labs/repetition-channel src/stories/labs/registry.test.ts src/stories/labs/runtime.test.ts src/stories/validateStory.test.ts src/i18n/i18n.test.ts
```

Final output:

```text
Test Files  7 passed (7)
Tests  163 passed (163)
Duration  2.60s
```

### Full web suite (run once before commit)

Command:

```text
/Users/vndee/.bun/bin/bun run test
```

Output:

```text
Test Files  162 passed (162)
Tests  1853 passed (1853)
Duration  39.90s
```

Vitest/jsdom also emitted repeated pre-existing `Not implemented: Window's scrollTo() method` notices; they were non-failing and no Task14 test emitted an error or failure.

### Typecheck

Command:

```text
/Users/vndee/.bun/bin/bun run typecheck
```

Output:

```text
$ tsc -b
```

Exit code: `0`.

### Scoped lint

Command:

```text
/Users/vndee/.bun/bin/bun run lint src/stories/labs/communication/repetition.ts src/stories/labs/communication/repetition.test.ts src/stories/labs/repetition-channel src/stories/types.ts src/stories/validateStory.ts src/stories/validateStory.test.ts src/stories/labs/registry.ts src/stories/labs/registry.test.ts src/stories/labs/runtime.ts src/stories/labs/runtime.test.ts src/i18n/i18n.test.ts
```

Output:

```text
$ oxlint src/stories/labs/communication/repetition.ts src/stories/labs/communication/repetition.test.ts src/stories/labs/repetition-channel src/stories/types.ts src/stories/validateStory.ts src/stories/validateStory.test.ts src/stories/labs/registry.ts src/stories/labs/registry.test.ts src/stories/labs/runtime.ts src/stories/labs/runtime.test.ts "src/i18n/i18n.test.ts"
```

Exit code: `0`.

## Changed files

- `apps/web/src/stories/labs/communication/repetition.ts`
- `apps/web/src/stories/labs/communication/repetition.test.ts`
- `apps/web/src/stories/labs/repetition-channel/model.ts`
- `apps/web/src/stories/labs/repetition-channel/model.test.ts`
- `apps/web/src/stories/labs/repetition-channel/RepetitionChannelLab.tsx`
- `apps/web/src/stories/labs/repetition-channel/RepetitionChannelLab.test.tsx`
- `apps/web/src/stories/labs/repetition-channel/copy.ts`
- `apps/web/src/stories/types.ts`
- `apps/web/src/stories/validateStory.ts`
- `apps/web/src/stories/validateStory.test.ts`
- `apps/web/src/stories/labs/registry.ts`
- `apps/web/src/stories/labs/registry.test.ts`
- `apps/web/src/stories/labs/runtime.ts`
- `apps/web/src/stories/labs/runtime.test.ts`
- `apps/web/src/i18n/i18n.test.ts`
- `.superpowers/sdd/2026-09-05-across-the-noise/task-14-report.md`

## Self-review against the contract

- Exact primitives are present: repeat-3 encode, triple-majority decode, `3p²−2p³`, and contiguous burst flipping with fixed Result/RangeError codes and sparse-input rejection.
- `flipBurst` uses the supplied stream's full bound; its final-bit 3N vector passes. `compareRepetition` separately enforces the shared burst interval against N and never clamps it.
- Both BSC paths reuse `communication/noise.ts`; no RNG implementation or RNG boundary was duplicated. The same seed is restarted for each stream, while tests and UI explicitly avoid claiming equal flip counts.
- Payload bytes come from `inspectUnicode`; bit/byte conversion uses shared communication primitives. There is no Huffman dependency.
- The result contract reports N/3N channel uses, channel flips, payload errors after decoding, repeat-decoded bytes, and independent-theory/null according to mode.
- The UI uses the actual `scene-09` journey harness in tests, includes non-gating bilingual Predict, explicit Run, MessageEditor, Observe/Explain separation, text plus decorative status icon, and existing Reset/Back controls.
- Snapshots copy and freeze source/config/result data. Tests verify previous settings, previous message, close/reopen persistence, and original-byte immutability.
- Burst mode hides the i.i.d. theory and labels the one shared interval as N-bounded. Triple rows show unchanged, corrected, and majority-failure outcomes.
- Each visible source-bit row has an accessible relationship across original/raw/triple/vote/outcome. Twelve rows render five visual bit cells each, so the combined per-view maximum is 60, below the common 64-cell bound.
- `repetition-channel` was added to the discriminated union, validator, initial state, explicit lazy registry, registry/runtime tests, and the exact adjacent copy-home allowlist in the same change.
- Production paths contain no storage, requests, analytics, console logging, publication changes, raw HTML, broad `as any`, import glob, or payload interpretation.
- R13 fallback diagram work was not touched; it remains Task19 scope.

## Concerns

No Task14 implementation concerns remain. The only verification noise was the existing non-failing jsdom `window.scrollTo` notice during the full suite.

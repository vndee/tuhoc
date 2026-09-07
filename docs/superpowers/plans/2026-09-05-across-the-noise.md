# Across the Noise Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reviewable, bilingual Issue 02 with twelve accurate interactive labs and thirteen original illustrations, without publishing it before the product owner approves the finished edition.

**Architecture:** Reuse the existing story reader, explicit lazy lab registry and scene state contract. Add an optional route-scoped message session, pure communication models and an independently art-directed content package. Keep draft discovery separate from production discovery; do not modify the existing AI issue's interaction model.

**Tech Stack:** Existing React 19, TypeScript 6, Vite 8, Vitest 4, Playwright, Bun, React Router, TanStack Query, CSS and accessible SVG/HTML; browser TextEncoder, strict TextDecoder and Intl.Segmenter. No new runtime dependencies or backend endpoints.

**Spec:** Read all three approved documents before execution: [design](../specs/2026-09-05-across-the-noise-design.md), [full VI/EN copy](../specs/2026-09-05-across-the-noise-copy.md), [twelve lab contracts](../specs/2026-09-05-across-the-noise-labs.md). This plan specifies implementation, not permission to change their editorial decisions.

## Global Constraints

- Issue `02`, slug `across-the-noise`, route `/stories/across-the-noise`; 4 acts × 3 scenes, 12 distinct labs, 1 cover + 12 illustrations × 2 image sizes.
- VI title “Một lời nói đi qua đại dương”; EN title “Across the Noise”. Complete VI/EN narrative, controls, status, alt, captions, fallbacks and coda.
- Human story 120–210 whitespace words per language; technical hinge ≥70 words per language; 2–4 mapped sources per scene.
- Fictional people, historical evidence and simplified models must remain explicitly distinguished. No fabricated dialogue, historical measurements or technical claims beyond the declared model.
- Preserve the message exactly: ≤120 extended grapheme clusters and ≤1,024 UTF-8 bytes; no normalization, transliteration, trimming, IME truncation or interpretation score.
- Message, drafts, experiment state and receipts live only in route memory: no URL, storage, server, analytics or console content. Theme/language persistence is separate.
- VI example “Mình đã đến nơi. Mọi chuyện vẫn ổn.”; EN example “I have arrived. Everything is all right.” Initialize once; language changes never replace the payload.
- Message changes increment revision; old snapshots stay immutable and visibly stale. Changed settings do not mutate a run. Deep links never require earlier labs.
- Seed uint32 `20260905`, counter `0`, deterministic Mulberry32; only explicit reseeding changes the noise sample, and lab07 Draw advances its counter.
- Show at most 64 bit cells per view, with full-payload statistics and pagination; strict UTF-8 errors retain hex, never pretend replacement characters are the original.
- Lab11 transmits uncompressed UTF-8, not lab08's Huffman container. Batch is 200 trials per eligible code, user-started, cancellable and yielding.
- Lab01 reset preserves original; lab11 reset clears receipt/batch; lab12 reset clears context/interpretation only. Whole-session reset requires confirmation.
- Desktop lab replaces illustration AND caption on an opaque stage; mobile lab is inline. Preserve scroll/back behavior, focus return, light/dark and reduced motion.
- No decorative thread motif. Maritime atlas/operator-notebook art: watercolor, graphite, fine engraving, tracing paper, material infrastructure and collective labor. Raster contains no labels or algorithmic diagrams.
- Images 1536×1024 and 768×512; large cover ≤250KB, large scene ≤320KB, small-image target ≤100KB. Record actual generation/edit provenance, never invented tool output or license.
- Landing title inherits Shantell, 22–28px, `text-wrap: wrap`. Issue-only display can use existing Charis SIL; do not leak issue typography onto landing.
- Text contrast ≥4.5:1, large text/essential controls ≥3:1; statuses use text/icons as well as color. Widths 320/390/1024/1440px; CLS ≤0.1.
- `published:false`, `featured:false` during this plan. No push, release PR, merge, deploy, fake coming-soon card, new chatbot, account requirement, actual transmission or personalization claim.
- Every task that adds a lab updates the discriminated union, validator, initial state and explicit lazy import in the SAME commit; no missing imports, `as any`, import glob or weakened unknown-kind validation.

---

## Working directory, execution and review boundaries

Use `<repo>/.worktrees/dac-san`, branch `codex/across-the-noise-design`, based on production `62e55fd`, design commit `03abeef`. Preserve the root checkout and unrelated worktrees. Inspect current git status before editing; do not recreate or reset this worktree.

All paths below are relative to that worktree. Shell commands for tests run from `apps/web`; git commands run from worktree root. Bun is `bun`; use `./node_modules/.bin/playwright` for Playwright. Read repository instructions again at execution time; `AGENTS.md` references `RTK.md`, which was not present during planning. If it becomes available, read it before work.

Use TDD and verification-before-completion skills during execution. Each numbered task is one reviewable deliverable; each checkbox is an action. Expand a longer algorithm into short edits following its numbered substeps, not a single unreviewed bulk rewrite. Commit only the explicit task paths after green checks. Do not mark planned tests as executed.

Sequence: 01–04 foundation → 05–18 labs → 19 content → 20–21 art → 22 integration → 23–24 verification. No parallel-agent dispatch is authorized by this document alone; execution method is chosen by the user. Within an approved subagent workflow, independent lab tasks may run concurrently only with a single integrator owning shared registry/type files.

Review checkpoints: after 04 inspect session/fallback behavior; after 18 review all teaching models; after 20 inspect the three pilot plates before generating ten more; after 24 let the user review the complete local edition. Material deviations from approved copy/art require user direction. Publication remains a separate authorized operation.

## File and responsibility map

| Path | Responsibility |
|---|---|
| `apps/web/src/stories/types.ts`, `validateStory.ts` | Optional session/intro/coda action/fallback data; discriminated lab contracts and validation |
| `apps/web/src/stories/session/types.ts`, `model.ts`, `StoryIssueSessionProvider.tsx` | Immutable route-only state and message/receipt lifecycle; no simulation engine imports |
| `apps/web/src/stories/components/StoryRenderer.tsx` | Opt-in provider; reuse scene controls and existing callback signature |
| `apps/web/src/stories/components/StaticLabFallback.tsx`, `StoryLabHost.tsx`, `StoryLabBoundary.tsx` | Data-backed fallback plus retry/back on both pending/error paths |
| `apps/web/src/stories/labs/communication/{types,unicode,bits,random,noise,repetition,secded}.ts` | Small pure reusable primitives; no Huffman import |
| `apps/web/src/stories/labs/communication/{CommunicationLabFrame,BitWindow,MessageEditor}.tsx` | Accessible interaction shell, bounded bit view and private-message editor |
| `apps/web/src/stories/labs/<kind>/{model.ts,model.test.ts,<Name>Lab.tsx,<Name>Lab.test.tsx}` | One lab's model, UI and tests; mapping given in each task |
| `apps/web/src/stories/labs/huffman-message/codec.ts`, `codec.test.ts` | Isolated teaching-container encoder/decoder |
| `apps/web/src/stories/labs/channel-budget/batch.ts`, `batch.test.ts` | Yielding/cancellable comparison, separate from single-run receipt |
| `apps/web/src/stories/labs/{registry.ts,runtime.ts}` | Explicit lazy loading and initial state; incremental updates with each lab |
| `apps/web/src/stories/testing/renderJourneyLab.tsx` | Component-test harness, not a production preview or production dependency |
| `apps/web/src/stories/content/across-the-noise/{copy,sources,labs,fallbacks,story,assets,meta,cover}.ts` | Approved authored content; only meta/cover eligible for collection entry graph |
| `apps/web/src/stories/content/across-the-noise/{provenance.json,assets/*}` | Actual original plates and responsive exports |
| `apps/web/src/stories/content/registry.ts`, `components/StoryPage.tsx`, `StoryCourseLink.tsx` | Draft-safe routing, existing discovery and catalog-backed coda |
| `apps/web/src/styles/across-the-noise.css` | Issue-scoped theme/typography/visualization layout, imported by lazy issue |
| `apps/web/scripts/check-story-bundles.{mjs,test.ts}` | Expanded static-entry leak guard for both issues |
| `apps/web/e2e/stories-draft/across-the-noise*.spec.ts`, `playwright.stories-draft.config.ts` | Explicit review-build verification, outside the ordinary production-build suite |
| `apps/web/e2e/stories-draft-exclusion.spec.ts`, `playwright.config.ts` | Verify normal production build cannot preview unpublished issues |
| `docs/superpowers/reports/2026-09-05-across-the-noise-review.md` | Actual checks, screenshots, remaining limitations and user-review URL |

### Cross-task contracts (define once; copy exact names into consumers)

Put these dependency-free types in `labs/communication/types.ts`; arrays are immutable plain numbers, not mutable typed-array views. Validate bit/byte ranges at public model boundaries. `Result` failures contain codes, never message content. Imported `Lang`, `Localized`, `SceneId` retain their existing definitions.

```ts
export type Bit = 0 | 1;
export type Bits = readonly Bit[];
export type Bytes = readonly number[];
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type ChannelCode = 'raw' | 'repeat3' | 'secded';
export type NoiseConfig = { p: number; seed: number };
export type TransmissionConfig = NoiseConfig & { code: ChannelCode; budget: number };
export type Transmission = {
  source: Bytes; received: Bytes | null; config: TransmissionConfig;
  required: number; outcome: 'exact' | 'silent-corruption' | 'rejected';
  flippedBits: number; payloadErrors: number | null;
};
export type DeliveryReceipt = Transmission & { messageRevision: number; messageText: string };
export type RunSnapshot<C, R> = {
  messageRevision: number; source: Bytes; config: C; result: R;
};
export type LabState<C, R> = { config: C; snapshot: RunSnapshot<C, R> | null };
```

`session/types.ts` imports those as types, not engines:

```ts
export type MessageSession = {
  messageText: string; messageRevision: number; draftText: string;
  shortenedDraft: string;
  experimentStateByScene: Partial<Record<SceneId, unknown>>;
  deliveryReceipt: DeliveryReceipt | null;
};
export type SessionAction =
  | { type: 'draft'; text: string }
  | { type: 'commit'; text: string }
  | { type: 'shorten'; text: string }
  | { type: 'lab'; sceneId: SceneId; value: unknown }
  | { type: 'reset-lab'; sceneId: SceneId }
  | { type: 'receipt'; receipt: DeliveryReceipt }
  | { type: 'reset-session'; example: string };
export type MessageJourney = {
  state: MessageSession; dispatch: React.Dispatch<SessionAction>;
  examples: Localized;
};
```

Models produce new arrays/objects. Copy/freeze receipt source, received, config and record when saving; never freeze a caller-owned object. Explicit stale checks compare revision and config, not source object identity. Controlled-example labs have no message snapshot; their local state travels through existing `value/onChange`.

All new labels live in a localized constant in the owning module or approved content data. Shared interaction labels go in `communication/copy.ts`. Avoid loading all twelve UI modules merely to access translations. Testing Library is already installed; use `fireEvent`, `screen`, `render`, `act`, `waitFor`, Vitest `it/expect/vi`. Each test file imports its named model exports directly.

### Task 01: Extend story data without changing existing editions

**Files:** Modify `apps/web/src/stories/{types.ts,validateStory.ts,validateStory.test.ts}`, `content/a-history-of-ai/story.test.ts`; create `apps/web/src/stories/session/types.ts`, `labs/communication/types.ts`.

**Interfaces:** Produce the types above and these optional fields; consume existing `Localized`, `RichTextBlock`, `SceneId`. No new lab kind is registered until its UI exists.

```ts
// Add to StoryDefinition:
interaction?: { kind: 'message-journey'; examples: Localized };
intro?: Localized<RichTextBlock[]>;
courseAction?: { slug: string; label: Localized; fallbackLabel: Localized };
// Add to LabFallback; literals stay authored data, not executable modules:
table?: Localized<{ headers: string[]; rows: string[][] }>;
```

- [ ] Add failing validator tests using `makeStoryFixture()`: blank EN example, blank intro, empty course slug, unequal table row/header widths and missing EN cells must produce issues at their exact fields. Preserve behavior when all optional fields are absent.

```ts
const story = makeStoryFixture();
story.interaction = { kind: 'message-journey', examples: { vi: 'Xin chào', en: '' } };
expect(validateStory(story)).toContainEqual(expect.objectContaining({
  code: 'missing-locale', path: 'interaction.examples.en',
}));
```

- [ ] Run `bun run test src/stories/validateStory.test.ts`; expect failure because optional fields are not validated yet.
- [ ] Add the declarations and invoke existing localized text/block validators only when fields exist. Add `invalid-fallback-table` and `invalid-story-interaction` issue codes for structural failures; reject empty/invalid example input under Task02's validator when available, without validating via React.
- [ ] Replace the AI story's global-registry equality assertion with exact set equality for its original twelve kinds AND membership in `REGISTERED_LAB_KINDS`. Keep scene counts, source coverage and word-count assertions.

```ts
const expected = new Set([
  'external-memory', 'embodied-calculation', 'executable-rules',
  'computation-limits', 'judgment-criteria', 'linear-separator',
  'knowledge-bottleneck', 'gradient-descent', 'convolution',
  'attention', 'agent-trace', 'agi-definitions',
]);
expect(new Set(story.scenes.map(scene => scene.lab.kind))).toEqual(expected);
for (const scene of story.scenes) expect(REGISTERED_LAB_KINDS.has(scene.lab.kind)).toBe(true);
```

- [ ] Run `bun run typecheck` and `bun run test src/stories/validateStory.test.ts src/stories/content/a-history-of-ai/story.test.ts`; expect all pass. Stage only Task01 files and commit `feat: extend optional story interaction and fallback data`.

### Task 02: Unicode, bits and reproducible noise primitives

**Files:** Create `apps/web/src/stories/labs/communication/{unicode,bits,random,noise}.ts` and matching `.test.ts`; finish example validation in `validateStory.ts`.

**Interfaces:** Produce `inspectMessage(text: string): Result<{graphemes:number; bytes:Bytes}>`, `decodeUtf8(bytes:Bytes): Result<string>`, `toBits(bytes:Bytes): Bit[]`, `toBytes(bits:Bits): Result<Bytes>`, `uniforms(seed:number,count:number): number[]`, `bsc(bits:Bits,config:NoiseConfig): {bits:Bits; flipped:number[]}`. Error codes: `empty`, `ill-formed`, `grapheme-limit`, `byte-limit`, `invalid-byte`, `invalid-bit`, `unaligned`, `invalid-seed`, `invalid-probability`, `invalid-length`.

- [ ] Add these failing tests, plus 120/121 grapheme boundary, 1,024/1,025-byte boundary using a long combining cluster, lone surrogates, retained newline/whitespace, all byte values and non-byte-aligned bits.

```ts
expect(inspectMessage('ắ')).toMatchObject({ ok: true, value: { graphemes: 1 } });
expect(inspectMessage('a\u0306\u0301')).toMatchObject({ ok: true, value: { graphemes: 1 } });
expect(inspectMessage('👨‍👩‍👧‍👦')).toMatchObject({ ok: true, value: { graphemes: 1 } });
expect(inspectMessage('\ud800')).toEqual({ ok: false, error: 'ill-formed' });
expect(decodeUtf8([0xc3, 0x28])).toEqual({ ok: false, error: 'invalid-byte' });
const bits = toBits([0, 255, 128]);
expect(toBytes(bits)).toEqual({ ok: true, value: [0, 255, 128] });
expect(bsc(bits, { p: 0, seed: 20260905 }).bits).toEqual(bits);
const low = bsc(bits, { p: .1, seed: 20260905 }).flipped;
expect(low.every(i => bsc(bits, { p: .3, seed: 20260905 }).flipped.includes(i))).toBe(true);
```

- [ ] Run `bun run test src/stories/labs/communication`; expect missing-module/export failures.
- [ ] Implement grapheme segmentation with `new Intl.Segmenter(undefined,{granularity:'grapheme'})`; detect unpaired surrogates before TextEncoder. Test whitespace using `text.trim().length===0` but never return a trimmed string. Strict decoder uses `{fatal:true}`. `toBits` is MSB-first; reject rather than pad incomplete `toBytes` input.

```ts
// Internal PRNG step: never use Date.now or Math.random.
let state = seed >>> 0;
const draw = () => {
  state = (state + 0x6d2b79f5) >>> 0;
  let value = Math.imul(state ^ (state >>> 15), 1 | state);
  value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
};
```

- [ ] Implement BSC from the stable `uniforms` prefix, using `u < p`; validate finite p∈[0,.5], uint32 seed and integral lengths. Assert replay equality and no mutation. Add independent fixed-seed expected draws to lock generator behavior.
- [ ] Run `bun run typecheck` and the communication/validator tests; expect pass. Commit Task02 paths as `feat: add exact Unicode and deterministic channel primitives`.

### Task 03: Route-scoped message session and immutable snapshots

**Files:** Create `apps/web/src/stories/session/{model.ts,model.test.ts,StoryIssueSessionProvider.tsx,StoryIssueSessionProvider.test.tsx}`; modify `components/{StoryRenderer.tsx,StoryRenderer.test.tsx}`.

**Interfaces:** Consume Task02 `inspectMessage` and Task01 types. Produce `createSession(example:string):MessageSession`, `reduceSession(state:MessageSession,action:SessionAction):MessageSession`, `StoryIssueSessionProvider({story,children}:{story:StoryDefinition;children:ReactNode})`, `useMessageJourney():MessageJourney|null`, `useRequiredMessageJourney():MessageJourney` (throw content-free error if absent).

- [ ] Write reducer tests for valid commit/revision, invalid draft retention, immutable old receipt, and the three distinct lab resets. Test provider rerender with EN preserves VI payload; provider unmount/remount resets, while hash/theme changes do not.

```ts
const initial = createSession('Xin chào');
const draft = reduceSession(initial, { type: 'draft', text: '   ' });
expect(reduceSession(draft, { type: 'commit', text: draft.draftText })).toEqual(draft);
const next = reduceSession(initial, { type: 'commit', text: 'Câu mới' });
expect(next.messageRevision).toBe(initial.messageRevision + 1);
expect(initial.messageText).toBe('Xin chào');
expect(reduceSession(next, { type: 'reset-lab', sceneId: 'scene-01' }).messageText).toBe('Câu mới');
```

- [ ] Run `bun run test src/stories/session src/stories/components/StoryRenderer.test.tsx`; new tests fail before implementation.
- [ ] Initialize from language only in the provider's state initializer. No storage effect. With absent interaction, expose null; use a keyed inner provider to obey hook rules when interaction changes.
- [ ] Route lab state through the session only for opted-in stories; retain existing local state for AI. Preserve `renderLab(scene,value,onChange,onReset)` exactly.

```ts
const journey = useMessageJourney();
const value = journey ? journey.state.experimentStateByScene[scene.id] : labStateByScene[scene.id];
const onChange = (next: unknown) => journey
  ? journey.dispatch({ type: 'lab', sceneId: scene.id, value: next })
  : setLabStateByScene(current => ({ ...current, [scene.id]: next }));
```

- [ ] Implement reducer action branches: commit validates and increments revision only for a changed valid text; leave old runs/receipt intact; reset01 empties shortened draft and deletes scene01 config; reset11 clears receipt plus scene11 state; reset12 deletes only scene12 state. Whole reset creates a fresh session after caller confirmation. Ignore stale asynchronous `receipt` dispatch whose revision no longer matches.
- [ ] Run session/renderer tests and typecheck; expect pass. Commit `feat: preserve private message journeys within each story route`.

### Task 04: Accessible lab furniture, test harness and useful fallbacks

**Files:** Create `labs/communication/{copy.ts,CommunicationLabFrame.tsx,BitWindow.tsx,MessageEditor.tsx}` and component tests, `testing/renderJourneyLab.tsx`, `components/{StaticLabFallback.tsx,StaticLabFallback.test.tsx}`; modify `components/{StoryLabHost.tsx,StoryLabBoundary.tsx}` and their tests. All paths under `apps/web/src/stories`.

**Interfaces:** `CommunicationLabFrame(props:LabFrameProps & {prediction?:ReactNode; explanation:ReactNode})` wraps existing LabFrame; `BitWindow({bits,lang,page,onPage,flipped,onFlip}:{bits:Bits;lang:Lang;page:number;onPage:(n:number)=>void;flipped:readonly number[];onFlip?:(index:number)=>void})`; `MessageEditor({lang}:{lang:Lang})` uses session. `StaticLabFallback({fallback,lang,title,instruction,onRetry,onBack}:{fallback:LabFallback;lang:Lang;title:string;instruction:string;onRetry:()=>void;onBack:()=>void})` renders authored table, label, explanation and actions. Add optional `fallbackContent?:ReactNode` to `StoryLabBoundaryProps`; supplied host content replaces the legacy boundary fallback, while direct existing callers remain compatible. `renderJourneyLab(Component:ComponentType<LabRuntimeProps>,definition:LabDefinition,options?:{lang?:Lang;example?:string})` returns Testing Library's render result; internal controlled host owns value and Task03 provider.

- [ ] Add tests: 8,192 bits produces ≤64 bit buttons and a correct page range; next page preserves absolute indices; editor keeps invalid IME draft; `<img onerror=...>` input is literal text; failed lazy import shows a real table and Retry/Back. Assert no duplicated caption behind the fallback.

```tsx
const back = vi.fn();
render(<StaticLabFallback lang="en" title="Example" instruction="Compare the bytes"
  fallback={{ diagramLabel: {vi:'Ví dụ tĩnh',en:'Static example'},
    explanation: {vi:'Một bit đổi',en:'One changed bit'},
    table: {vi:{headers:['Gốc','Nhận'],rows:[['00','01']]},en:{headers:['Sent','Received'],rows:[['00','01']]}} }}
  onRetry={vi.fn()} onBack={back} />);
expect(screen.getByRole('table')).toHaveTextContent('Sent');
fireEvent.click(screen.getByRole('button', { name: 'Back to illustration' }));
expect(back).toHaveBeenCalledOnce();
```

- [ ] Run `bun run test src/stories/labs/communication src/stories/components/StoryLabHost.test.tsx src/stories/components/StoryLabBoundary.test.tsx src/stories/components/StaticLabFallback.test.tsx`; expect new UI tests fail.
- [ ] Build the semantic furniture. Keep Predict optional; Try controls precede Observe (SVG + real data table), then Explain/limits. Keep tables outside LabFrame's existing status `<p>`; announce a short summary only after deliberate actions. BitWindow uses native buttons with absolute bit number/value and marks, not 8,192 hidden cells.
- [ ] MessageEditor uses textarea + explicit commit/use-example; display both counters, error strings and the approved privacy copy. Composition events only track composing; never truncate on input. Render comparison with `<pre>{text}</pre>`. Whole reset uses an accessible confirm/cancel dialog; cancellation keeps all state.
- [ ] Refactor pending and error fallbacks to the same component supplied by Host through `fallbackContent` and Suspense. Host retry increments an attempt used in both lazy-component memo and boundary reset key `${scene.id}:${attempt}`; Back is available even if the chunk never loads. Keep old AI fallback data optional and retain its labels. Test a one-time failed import followed by successful retry, not just that the retry counter increments.
- [ ] Run all new component tests, old host/boundary/renderer tests and typecheck; expect pass. Commit `feat: add accessible communication lab controls and complete fallbacks`.

### Task 05: Lab01 — message budget without semantic grading

**Files:** Create `apps/web/src/stories/labs/message-budget/{model.ts,model.test.ts,MessageBudgetLab.tsx,MessageBudgetLab.test.tsx}`; modify `types.ts`, `validateStory.ts`, `labs/{registry.ts,runtime.ts}` under `src/stories`.

**Interfaces:** `compareDraft(original:string,shortened:string,budget:15|30|60):Result<{originalGraphemes:number;shortenedGraphemes:number;originalBytes:number;shortenedBytes:number;over:number}>`. Add kind `message-budget`, config `{defaultBudget:15|30|60}`, default30; initial state `{budget:definition.config.defaultBudget}`. Consume Task03 message session and MessageEditor; empty shortened draft is allowed, original is not.

- [ ] Test counting, independent shortened draft and reset:

```ts
expect(compareDraft('👨‍👩‍👧‍👦', '👨‍👩‍👧‍👦', 15)).toMatchObject({ok:true,value:{shortenedGraphemes:1,over:0}});
expect(compareDraft('Một câu', 'Một', 15)).toMatchObject({ok:true,value:{shortenedGraphemes:3}});
```

- [ ] Run `bun run test src/stories/labs/message-budget`; expect missing module. Add model using Task02 exact counts; `over=Math.max(0,shortenedGraphemes-budget)`. Segment diff by grapheme; labels say editing, never “compression succeeded”. Test newlines and pasted overflow retain all text.
- [ ] Add component tests using `renderJourneyLab`: commit original, edit shortened textarea, reset lab and verify original remains. Switch to EN and verify original bytes unchanged. Add component with MessageEditor, budget select, two literal text panes and counts. Reset dispatches Task03 reset01 through `onReset`; shortened text dispatches `shorten`.
- [ ] Atomically append the union/ALL_LAB_KINDS value, config validator and initial state, plus explicit registry import:

```ts
'message-budget': () => import('./message-budget/MessageBudgetLab'),
```

- [ ] Run `bun run test src/stories/labs/message-budget src/stories/labs/registry.test.ts src/stories/validateStory.test.ts` and typecheck; expect pass. Stage these exact files and commit `feat: add bilingual message editing lab`.

### Task 06: Lab02 — exhaustive ambiguous-code decoding

**Files:** Create `labs/ambiguous-code/{model.ts,model.test.ts,AmbiguousCodeLab.tsx,AmbiguousCodeLab.test.tsx}` under `apps/web/src/stories`; update shared type/validator/registry/runtime.

**Interfaces:** `SymbolId='A'|'B'|'C'|'D'`; `Codebook=Record<SymbolId,string>`; `decodePaths(bits:string,book:Codebook):Result<{count:string;readings:string[];truncated:boolean}>`; `encodeSymbols(symbols:string,book:Codebook):Result<string>`. Export SymbolId/Codebook from dependency-free `communication/types.ts` so schema imports no engine. Config `{initialBook:Codebook;initialSymbols:string}`; initial state copies those plus `result:null`. Validate 1–6 binary digits/codeword and 1–6 source symbols; allow duplicate codewords. Decoder permits zero readings and uses full DP count, serialized as an exact decimal string, max32 rendered readings.

- [ ] Write tests and run `bun run test src/stories/labs/ambiguous-code`; expect missing-model failure.

```ts
const book = {A:'0',B:'01',C:'1',D:'11'};
expect(decodePaths('01',book)).toMatchObject({ok:true,value:{count:'2',readings:['AC','B'],truncated:false}});
expect(decodePaths('1',{A:'00',B:'01',C:'00',D:'01'})).toMatchObject({ok:true,value:{count:'0'}});
expect(decodePaths('000000',{A:'0',B:'0',C:'0',D:'0'})).toMatchObject({ok:true,value:{count:'4096',truncated:true}});
```

- [ ] Implement count with `ways[end]=1n` and reverse offsets, adding `ways[offset+code.length]` for each matching symbol; enumerate A/B/C/D paths only until32. Do not stop counting when rendering caps. Restrict externally supplied bitstream to ≤36 bits; use bigint internally and `.toString()` at the result boundary so counts never round or break JSON-serializable lab state.
- [ ] Add a 36-zero/four-duplicate-codeword fixture expecting `(4n ** 36n).toString()` and exactly32 rendered readings. Also test empty/nonbinary codewords and non-A/B/C/D source text; return content-free error codes and preserve invalid UI drafts.
- [ ] Build codeword inputs and native symbol buttons, Send and prefix-free preset, branching SVG with equivalent readings list and exact-total label. Default sends B. An invalid field retains draft and disables Send; duplicate codes remain usable. Add UI test switching preset yields one reading; validate prefix-free warnings do not claim every input is ambiguous.
- [ ] Add kind `ambiguous-code`, config/defaults and `() => import('./ambiguous-code/AmbiguousCodeLab')`. Run model/UI/registry/validator tests and typecheck; expect pass. Commit `feat: expose code boundaries and competing decodings`.

### Task 07: Lab03 — Morse marks, pauses and a declared decoder

**Files:** Create `apps/web/src/stories/labs/morse-spacing/{model.ts,model.test.ts,MorseSpacingLab.tsx,MorseSpacingLab.test.tsx}`; update type/validator/registry/runtime.

**Interfaces:** `MorseSegment={kind:'mark'|'gap';duration:number}`; `morseTimeline(text:string,letterGap:number,wordGap:number):Result<MorseSegment[]>`; `readMorse(segments:readonly MorseSegment[]):Result<string>`. Config `{example:'ET'|'AET'|'BEAM'|'BEAM ET'}`; state `{example,letterGap:3,wordGap:7,result:null}`. Reject unsupported characters; do not touch shared message.

- [ ] Add tests then run `bun run test src/stories/labs/morse-spacing`; expect missing exports.

```ts
for (const text of ['ET','AET','BEAM','BEAM ET']) {
  const timeline = morseTimeline(text,3,7);
  if (!timeline.ok) throw new Error(timeline.error);
  expect(readMorse(timeline.value)).toEqual({ok:true,value:text});
}
const joined = morseTimeline('ET',1,7);
if (!joined.ok) throw new Error(joined.error);
expect(readMorse(joined.value)).toEqual({ok:true,value:'A'});
```

- [ ] Implement the controlled codebook `{E:'.',T:'-',A:'.-',B:'-...',M:'--'}`; include reverse International Morse mappings needed by altered boundaries (all A–Z and digits) rather than inventing codes. Unknown sequences return `unknown-code`. Dot1, dash3, intra1; parser gap<2 joins, gap2–<5 separates letters, gap≥5 separates words. Validate letter1–7 and word1–9.
- [ ] Add labeled numeric controls and presets, duration-proportional SVG marks/spaces and a segment table. Render decoder thresholds and “modern teaching model” notice. No audio dependency. UI test confirms changing ET gap from3 to1 changes result to A without changing marks; word-gap test uses BEAM ET.
- [ ] Add kind, union config, validator, state and `() => import('./morse-spacing/MorseSpacingLab')`. Run folder tests, registry tests and typecheck; expect pass. Commit `feat: make Morse timing and boundaries explorable`.

### Task 08: Lab04 — infrastructure route trade-offs

**Files:** Create `apps/web/src/stories/labs/cable-route/{model.ts,model.test.ts,CableRouteLab.tsx,CableRouteLab.test.tsx}`; update type/validator/registry/runtime.

**Interfaces:** `RouteId='north'|'middle'|'south'`; `routeCost(id:RouteId):{length:number;hard:number;deep:number;components:readonly number[];total:number}`. Config `{defaultBudget:number}`, integer15–40/default28; state `{route:'south',budget:28,step:0}`. Dataset lives in model, declared fictional; budget cannot alter terrain.

- [ ] Add fixtures and run `bun run test src/stories/labs/cable-route`; expect failure.

```ts
expect(['north','middle','south'].map(id => routeCost(id as RouteId).total)).toEqual([27,31,21]);
expect(routeCost('south')).toMatchObject({length:13,hard:1,deep:2,components:[13,4,4],total:21});
```

- [ ] Implement fixed `{north:[11,2,4],middle:[9,5,1],south:[13,1,2]}` and `components=[L,4*H,2*D]`. Step reveals length, difficult-segment and depth components in that order; do not fabricate geographical failure probabilities or subdivide them into alleged historical measurements.
- [ ] Build three keyboard radio options, schematic fictional profiles, budget15–40, Step and Reset. Show explicit formula, components and shortfall `Math.max(0,total-budget)` in a table. UI test selects South/budget21 with keyboard and verifies exactly enough, then20 shows one unit short.
- [ ] Register `cable-route` and lazy `CableRouteLab`; validate budget and initialize it from config. Run folder/registry tests and typecheck; expect pass. Commit `feat: show the resources behind fictional cable routes`.

### Task 09: Lab05 — deterministic channel memory and sampling

**Files:** Create `apps/web/src/stories/labs/pulse-channel/{model.ts,model.test.ts,PulseChannelLab.tsx,PulseChannelLab.test.tsx}`; update type/validator/registry/runtime.

**Interfaces:** `PulseConfig={duration:1|2|4;tau:0|0.5|1|2;sampleFraction:0.25|0.5|0.75}`; `PulseExperimentConfig=PulseConfig & {source:'alternating'|'message';page:number}`; `PulseResult={points:readonly {time:number;input:number;output:number}[];samples:readonly {time:number;value:number;sent:Bit;received:Bit}[];errors:number}`; `simulatePulses(bits:Bits,config:PulseConfig):Result<PulseResult>`. Config `{defaultDuration:1|2|4}`, default1; state `{duration:1,tau:1,sampleFraction:0.5,source:'alternating',page:0,snapshot:null}`. Snapshots use Task01 `RunSnapshot<PulseExperimentConfig,PulseResult>` with captured source bytes and revision; changing source/window also makes previous settings stale.

- [ ] Test tau0, all-zero, all-one, alternating, input rejection, exact sample timestamps and replay. Run `bun run test src/stories/labs/pulse-channel`; expect missing model.

```ts
const result = simulatePulses([0,1,0,1],{duration:1,tau:0,sampleFraction:.5});
expect(result).toMatchObject({ok:true,value:{errors:0}});
if (result.ok) expect(result.value.samples.map(p=>p.time)).toEqual([.5,1.5,2.5,3.5]);
```

- [ ] Implement integer ticks with dt1/16, y at tick0=0; for interval [tick,tick+1), update from that interval's source symbol and record y at tick+1. Sample at exact integer tick `(symbol+fraction)*T*16`; tau0 directly returns current symbol amplitude at sample time. Limit supplied window to64 bits and reject empty input. No stochastic noise.

```ts
const amplitude = (bit:Bit) => bit === 0 ? -1 : 1;
const a = config.tau === 0 ? 1 : 1-Math.exp(-(1/16)/config.tau);
y = config.tau === 0 ? amplitude(bit) : (1-a)*y+a*amplitude(bit);
const received:Bit = y >= 0 ? 1 : 0;
```

- [ ] Build window source toggle (alternating versus original bytes), independent T/tau/sample controls, Run, waveform and sample table using the same arrays. A changed config/message leaves old plot labeled stale until Run. UI test changing T never changes tau; close/open preserves controls and plot.
- [ ] Register `pulse-channel`/`PulseChannelLab`, validate allowed duration and initialize state. Run folder/session/registry tests and typecheck; expect pass. Commit `feat: reveal pulse memory and receiver sampling`.

### Task 10: Lab06 — actual-message noise, manual flips and strict decoding

**Files:** Create `apps/web/src/stories/labs/binary-noise/{model.ts,model.test.ts,BinaryNoiseLab.tsx,BinaryNoiseLab.test.tsx}`; update type/validator/registry/runtime.

**Interfaces:** `NoiseResult={received:Bytes;flipped:readonly number[];errors:number;ber:number;decoded:Result<string>;exact:boolean}`; `transmitNoisy(bytes:Bytes,config:NoiseConfig):Result<NoiseResult>`; `manualNoise(bytes:Bytes,indices:readonly number[]):Result<NoiseResult>`. Config `{defaultP:number;seed:number}` defaults.05/20260905; state `LabState<NoiseConfig & {mode:'bsc'|'manual';manual:readonly number[]},NoiseResult> & {page:number}`. Manual toggles maintain a set, with no i.i.d. claim.

- [ ] Add model tests and run `bun run test src/stories/labs/binary-noise`; expect failure.

```ts
expect(transmitNoisy([0xc3,0xa9],{p:0,seed:20260905})).toMatchObject({ok:true,value:{exact:true,errors:0}});
expect(manualNoise([0x41],[0])).toMatchObject({ok:true,value:{exact:false,decoded:{ok:false}}});
expect(manualNoise([0x41],[])).toMatchObject({ok:true,value:{exact:true}});
```

- [ ] Compose Task02 bit/noise/decode functions; compare arrays byte-by-byte. BER is flips/total bits, not configured p. Reject out-of-range manual indices without logging input. Store copied config/source/result/revision only after Run.
- [ ] Add MessageEditor, p/seed controls, explicit deterministic new-seed button `(seed+1)>>>0`, mode toggle, 64-bit BitWindow, hex and strict text panels. New seed changes controls but not old result. Manual bit toggled twice returns original. UI tests cover invalid UTF8 status, labels in VI/EN, p-replay, and previous-message/config banners.
- [ ] Register `binary-noise`/`BinaryNoiseLab`, p∈[0,.5], uint32 seed. Run folder, Unicode, session, registry tests and typecheck; expect pass. Commit `feat: inspect noisy message bytes without hiding decode errors`.

### Task 11: Lab07 — entropy of a controlled source

**Files:** Create `apps/web/src/stories/labs/source-entropy/{model.ts,model.test.ts,SourceEntropyLab.tsx,SourceEntropyLab.test.tsx}`; update type/validator/registry/runtime.

**Interfaces:** `Weights=readonly [number,number,number,number]`; `sourceEntropy(weights:Weights):Result<{probabilities:readonly number[];contributions:readonly number[];entropy:number}>`; `drawSymbol(weights:Weights,seed:number,counter:number):Result<{symbol:SymbolId;surprise:number}>`. Config `{weights:Weights;seed:number}`, defaults[25,25,25,25]/20260905; state `{weights,seed,counter:0,lastDraw:null,prediction:null}`.

- [ ] Test exact boundaries, positive zero, all-zero rejection, scale invariance, no zero-probability draw and replay. Run `bun run test src/stories/labs/source-entropy`; expect failure.

```ts
for (const [weights,entropy] of [[[1,0,0,0],0],[[1,1,0,0],1],[[1,1,1,1],2]] as const) {
  const result=sourceEntropy(weights);
  expect(result).toMatchObject({ok:true,value:{entropy}});
  if (result.ok) expect(Object.is(result.value.entropy,-0)).toBe(false);
}
expect(sourceEntropy([0,0,0,0])).toEqual({ok:false,error:'empty-source'});
```

- [ ] Normalize nonnegative integer weights≤100, calculate contributions `p===0 ? 0 : -p*Math.log2(p)`, sum positive contributions to avoid -0. Draw uses the uniform at counter index and cumulative probabilities. Reject invalid counter/seed; draw algorithm can advance generator without retaining all past draws, keeping memory bounded.
- [ ] Build four labeled weights, probability/contribution table, annotated bars and explicit “bits/source-symbol, not meaning” copy. Optional prediction is not a score; Draw increments counter only on valid draw. Changing language or rendering does not draw again. Test allzero leaves editable error and disables Draw.
- [ ] Register `source-entropy`/`SourceEntropyLab`, validate tuple and seed, type-only import Weights from `communication/types.ts`. Run folder/registry tests and typecheck; expect pass. Commit `feat: make source uncertainty measurable without grading meaning`.

### Task 12: Independently decodable Huffman teaching container

**Files:** Create `apps/web/src/stories/labs/huffman-message/{codec.ts,codec.test.ts}`. This task does not register a UI kind yet.

**Interfaces:** `HuffmanNode={id:number;count:number;minByte:number;byte:number|null;left:number|null;right:number|null}`; `HuffmanMerge={left:number;right:number;parent:number}`; `HuffmanPacket={container:Bytes;payloadBits:number;headerBits:number;paddingBits:number;totalBits:number;nodes:readonly HuffmanNode[];merges:readonly HuffmanMerge[];codes:readonly {byte:number;count:number;code:string}[]}`; `encodeHuffman(bytes:Bytes):Result<HuffmanPacket>`; `decodeHuffman(container:Bytes):Result<Bytes>`.

- [ ] Add known vector, Unicode round-trip, deterministic equal-frequency tree, malformed headers and decoder independence tests. Run `bun run test src/stories/labs/huffman-message/codec.test.ts`; expect missing codec.

```ts
const packet=encodeHuffman([65,65,65,65]);
expect(packet).toMatchObject({ok:true,value:{payloadBits:4,headerBits:88,paddingBits:4,totalBits:96}});
if (packet.ok) {
  expect(packet.value.container).toEqual([0,1,0,4,0,0,0,4,65,0,4,0]);
  expect(decodeHuffman(JSON.parse(JSON.stringify(packet.value.container)))).toEqual({ok:true,value:[65,65,65,65]});
}
```

- [ ] Implement frequency counting and stable min-heap: priority count, minByte, creation id; leaves created in ascending byte order; first popped child left0, second right1. Keep integer node IDs and merges for Step UI. Single leaf code0, length1. Reject empty or >1,024 bytes.
- [ ] Implement big-endian header count:uint16, source length:uint16, payload bits:uint32; sorted entries byte:uint8/count:uint16; append zero-padded MSB-first payload. Header bits=`64+24*k`; padding=`(8-payloadBits%8)%8`; total=header+payload+padding. Keep helper tree construction private to this module.
- [ ] Decoder reads ONLY container: check k1–256, source1–1024, unique byte entries, positive counts, sum=source length, header bounds, payload length consistent with derived code lengths/frequencies, exact file length and zero padding. Reject incomplete traversal, nonzero single-symbol code, decoded count/frequency mismatch and extra trailing bytes with content-free codes.
- [ ] Add mutation cases for each declared validation, including impossible frequency sum, duplicate leaf, declared bitlength overflow, corrupt pad and truncated body. Verify maximum256-byte alphabet, repeated bytes and NFC/NFD remain byte-exact. Do not compare only displayed strings.
- [ ] Run codec tests and typecheck; expect pass. Commit only codec files as `feat: implement a self-contained Huffman teaching format`.

### Task 13: Lab08 — Huffman construction and honest size accounting

**Files:** Create `apps/web/src/stories/labs/huffman-message/{model.ts,model.test.ts,HuffmanMessageLab.tsx,HuffmanMessageLab.test.tsx}`; update type/validator/registry/runtime.

**Interfaces:** Consume Task12 packet. Produce `visibleHuffmanMerges(packet:HuffmanPacket,step:number):readonly HuffmanMerge[]` (clamp step0…merge count). Config `{maxVisibleNodes:number}`, integer1–32/default24; state `{step:0,page:0,snapshot:null}` where snapshot is `RunSnapshot<Record<string,never>,HuffmanPacket>`. Step affects presentation, not the codec result.

- [ ] Test visible merge prefixes and exact-accounting UI; run `bun run test src/stories/labs/huffman-message`; new tests fail before UI exists.

```tsx
const definition:LabDefinition={kind:'huffman-message',title:{vi:'Nén',en:'Compress'},instruction:{vi:'Tính cả gói',en:'Count the whole packet'},config:{maxVisibleNodes:24}};
renderJourneyLab(HuffmanMessageLab,definition,{lang:'en',example:'AAAA'});
fireEvent.click(screen.getByRole('button',{name:'Run experiment'}));
expect(screen.getByRole('table',{name:'Size accounting'})).toHaveTextContent('96');
expect(screen.getByRole('status')).toHaveTextContent('larger');
```

- [ ] Run encoder only on Run, save immutable snapshot, and use independent decoder output for equality status. Compute shown rows from actual packet:

```ts
const sizeRows = [
  ['Raw UTF-8', snapshot.source.length*8], ['Coded payload', packet.payloadBits],
  ['Header and frequencies',packet.headerBits], ['Padding',packet.paddingBits],
  ['Total packet',packet.totalBits],
];
```

- [ ] Add Step/Complete, bounded tree with byte labels as hex, paginated code table and size table. Localize row labels. Single-symbol tree remains meaningful; >24 nodes gets a selected-subtree window and all-code pagination rather than thousands of SVG nodes. UI tests check byte—not grapheme—alphabet, stale message, and total-size increase. Show teaching-format notice; do not import fflate.
- [ ] Register `huffman-message`/`HuffmanMessageLab`, maxVisibleNodes validation and fresh state. Run full Huffman tests, registry tests and typecheck; expect pass. Commit `feat: visualize Huffman construction and full packet costs`.

### Task 14: Lab09 — repetition coding, independence and bursts

**Files:** Create `apps/web/src/stories/labs/communication/{repetition.ts,repetition.test.ts}`, `labs/repetition-channel/{model.ts,model.test.ts,RepetitionChannelLab.tsx,RepetitionChannelLab.test.tsx}`; update type/validator/registry/runtime.

**Interfaces:** `encodeRepeat3(bits:Bits):Bits`, `decodeRepeat3(bits:Bits):Result<Bits>`, `repeatErrorProbability(p:number):Result<number>`, `flipBurst(bits:Bits,start:number,length:number):Result<Bits>`. `RepetitionComparison={raw:{uses:number;errors:number;flips:number};repeat:{uses:number;errors:number;flips:number};received:Bytes;theoretical:number|null}`; `compareRepetition(bytes:Bytes,config:NoiseConfig & {mode:'bsc'|'burst';start:number;length:number}):Result<RepetitionComparison>`. Config `{defaultP:number;seed:number}`; state config p.05/seeddefault/modebsc/start0/length1 plus snapshot:null/page0.

- [ ] Write vectors, burst bounds and p boundaries; run `bun run test src/stories/labs/communication/repetition.test.ts src/stories/labs/repetition-channel`; expect failure.

```ts
expect(encodeRepeat3([0,1])).toEqual([0,0,0,1,1,1]);
expect(decodeRepeat3([1,0,0])).toEqual({ok:true,value:[0]});
expect(decodeRepeat3([1,1,0])).toEqual({ok:true,value:[1]});
expect(decodeRepeat3([1,0,1])).toEqual({ok:true,value:[1]});
expect(repeatErrorProbability(.5)).toEqual({ok:true,value:.5});
```

- [ ] Implement triple grouping and majority; reject lengths not divisible by3. Independent formula is `3*p*p-2*p*p*p`. Burst flips one contiguous valid interval; zero length is allowed, past-end intervals rejected. The side-by-side comparison uses an explicitly labeled shared interval bounded by the raw channel length N, so the identical requested interval exists in both N and3N streams; never silently clamp. The pure `flipBurst` helper supports the full supplied stream length and is tested at the final bit of a3N stream.
- [ ] Compose raw/repeat runs on same payload and seed, not equal flip counts. Calculate payload errors after decode, uses N/3N and correct payload bits per use. In burst mode set theoretical=null. UI separates theory and observed results, shows each triple, failures as well as corrections, and original byte snapshot.

```tsx
<BitWindow bits={encoded} lang={lang} page={page} onPage={setPage}
  flipped={flipped} />
<p>{lang==='vi'?'Ba bit đi liên tiếp qua cùng mô hình kênh.':'Three bits travel consecutively through the same channel model.'}</p>
```

- [ ] Add UI tests: mode switch hides i.i.d. formula, p0 round-trip, two-flip majority failure, immutable previous settings. Register `repetition-channel`/`RepetitionChannelLab`; reuse p/seed validation with no broad casts. Run both folders, registry and typecheck; expect pass. Commit `feat: compare repetition protection with its channel cost`.

### Task 15: Lab10 — SECDED and the limit of repair

**Files:** Create `apps/web/src/stories/labs/communication/{secded.ts,secded.test.ts}`, `labs/secded-inspector/{model.ts,model.test.ts,SecdedInspectorLab.tsx,SecdedInspectorLab.test.tsx}`; update type/validator/registry/runtime.

**Interfaces:** `encodeSecded(data:Bits):Result<Bits>` accepts exactly4 bits; `decodeSecded(word:Bits):Result<{data:Bits|null;word:Bits;syndrome:number;overall:Bit;decision:'no-alarm'|'corrected'|'rejected';correctedPosition:number|null}>` accepts exactly8. `inspectSecded(data:Bits,flips:readonly number[]):Result<{sent:Bits;received:Bits;decoded:SecdedResult;exact:boolean}>`, where `SecdedResult` is the exported successful decoder value type. Flip indices are zero-based in APIs, one-based in UI. Config `{data:string}` default1011; state `{data:'1011',flips:[],advanced:false}`.

- [ ] Add the592-case test (16×37) and representative higher-error limits; run `bun run test src/stories/labs/communication/secded.test.ts`; expect failure.

```ts
for(let value=0;value<16;value++) {
  const data=[3,2,1,0].map(i=>((value>>>i)&1) as Bit);
  const encoded=encodeSecded(data); if(!encoded.ok) throw new Error(encoded.error);
  const masks=[[],...Array.from({length:8},(_,i)=>[i]),
    ...Array.from({length:8},(_,i)=>Array.from({length:7-i},(_,j)=>[i,i+j+1])).flat()];
  expect(masks).toHaveLength(37);
  for(const mask of masks) {
    const received=encoded.value.map((b,i)=>(mask.includes(i)?1-b:b) as Bit);
    const decoded=decodeSecded(received); if(!decoded.ok) throw new Error(decoded.error);
    if(mask.length===2) expect(decoded.value.decision).toBe('rejected');
    else expect(decoded.value.data).toEqual(data);
  }
}
```

- [ ] Implement even-parity layout p1,p2,d1,p4,d2,d3,d4,p0. Compute syndrome checks on positions1…7 and xor on all8. s0/t0→no-alarm, s≠0/t1→flip position s, s0/t1→flip8, s≠0/t0→reject. Decoder never sees original data. `1011` must encode to `01100110`.
- [ ] Add advanced counterexamples for data0000: flip positions1,2,3 (indices0,1,2) produces misleading repair at8; flip1,2,3,8 produces no-alarm but wrong data. Assert simulator reports mismatch without changing decoder's decision.
- [ ] Build four data bit inputs, eight labeled protected-bit buttons, parity check rows, syndrome calculation and decision table; normal mode permits≤2 flips, advanced permits8 with persistent warning. Show “No error signaled”, not “Definitely error-free”. Add keyboard UI test detecting/rejecting two errors and separate ground-truth comparison.
- [ ] Register `secded-inspector`/`SecdedInspectorLab`, validate four binary characters and fresh arrays. Run SECDED/model/UI/registry tests and typecheck; expect pass. Commit `feat: teach single-error repair and double-error detection`.

### Task 16: Lab11 single transmission and trustworthy receipts

**Files:** Create `apps/web/src/stories/labs/channel-budget/{model.ts,model.test.ts,ChannelBudgetLab.tsx,ChannelBudgetLab.test.tsx}`; update type/validator/registry/runtime.

**Interfaces:** `channelRequirement(bitCount:number,code:ChannelCode):{required:number;k:number;n:number;rate:number}`; `channelCapacity(p:number):Result<number>`; `runTransmission(bytes:Bytes,config:TransmissionConfig):Result<Transmission>`. Input nonempty≤1,024bytes; budget512–32768 step512; insufficient budget returns `budget-exceeded` without a receipt. Config `{defaultBudget:number;defaultP:number;seed:number}` defaults4096/.05/20260905; state `{config:{code:'raw',budget:4096,p:.05,seed:20260905},batch:null}`; single-run receipt is in session, not duplicated in this local state.

- [ ] Test exact boundary and p0 for each code. Run `bun run test src/stories/labs/channel-budget/model.test.ts`; expect failure.

```ts
expect(channelRequirement(512,'repeat3')).toEqual({required:1536,k:1,n:3,rate:1/3});
for(const code of ['raw','repeat3','secded'] as const)
  expect(runTransmission([0xc3,0xa9],{code,budget:512,p:0,seed:20260905})).toMatchObject({ok:true,value:{outcome:'exact',received:[0xc3,0xa9]}});
expect(runTransmission(Array(65).fill(65),{code:'raw',budget:512,p:0,seed:1})).toEqual({ok:false,error:'budget-exceeded'});
expect(channelCapacity(0)).toEqual({ok:true,value:1});
expect(channelCapacity(.5)).toEqual({ok:true,value:0});
```

- [ ] Compute required=`Math.ceil(N/k)*n`, capacity=`Math.floor(B/n)*k`; no truncation. Encode/decode full block stream using Task14/15 primitives and a single BSC mask. Any rejected SECDED word rejects whole message with `received:null,payloadErrors:null`; otherwise compare all decoded bytes and label exact/silent-corruption. Count raw channel flips separately from payload errors. No Huffman import.
- [ ] Build controls, full-budget breakdown and independent theory panel `C=1-Hb(p)`, with asymptotic-versus-short-code caveat. Run event snapshots revision, text, source and config before calculation; reducer deep-copies receipt. Changed controls retain receipt with previous-settings label. A budget error leaves old receipt visibly identified as old, never presents it as the failed attempt's success.

```ts
const run = runTransmission(source,config);
if(run.ok) dispatch({type:'receipt',receipt:{...run.value,
  messageText:state.messageText,messageRevision:state.messageRevision}});
```

- [ ] UI tests: insufficient budget; rejected not success; raw silent corruption; reset clears receipt but not message; edit/EN/theme retains original snapshot. Reference noise fixtures calculated during planning: payload[65], p.05, seed1 flips raw zero-based index1, yielding byte1 and silent-corruption; SECDED seed6 flips encoded indices1,6,12, with two flips in the first word and one in the second, so reject. Reconfirm these against the implemented generator/decoder; the planning calculation is not implementation test evidence.
- [ ] Register `channel-budget`/`ChannelBudgetLab`, exact budget/p/seed validators and state. Run model/UI/session/registry tests and typecheck; expect pass. Commit `feat: compare transmission resources and save honest delivery receipts`.

### Task 17: Yielding and cancellable 200-trial comparison

**Files:** Create `apps/web/src/stories/labs/channel-budget/{batch.ts,batch.test.ts}`; modify `ChannelBudgetLab.tsx` and its tests.

**Interfaces:** `BatchRow={code:ChannelCode;trials:200;exact:number;rejected:number;silent:number;payloadErrors:number;decodedPayloadBits:number}`; `BatchResult={rows:readonly BatchRow[];excluded:readonly ChannelCode[]}`; `compareCodes(bytes:Bytes,config:{p:number;seed:number;budget:number},options:{signal:AbortSignal;onProgress:(done:number,total:number)=>void;yieldControl?:()=>Promise<void>}):Promise<Result<BatchResult>>`. Cancel returns `{ok:false,error:'cancelled'}`; completed summaries never overwrite single deliveryReceipt.

- [ ] Add exact200 accounting, insufficient-code exclusion, replay and abort tests, using injected yield to deterministically abort. Run `bun run test src/stories/labs/channel-budget/batch.test.ts`; expect failure.

```ts
const abort=new AbortController();
const result=await compareCodes([65],{p:0,seed:20260905,budget:512},
  {signal:abort.signal,onProgress:()=>{},yieldControl:async()=>{}});
if(!result.ok) throw new Error(result.error);
expect(result.value.rows).toHaveLength(3);
for(const row of result.value.rows) expect([row.exact,row.rejected,row.silent]).toEqual([200,0,0]);
```

- [ ] Use seed list `(baseSeed+i)>>>0`, i0…199 for every eligible code. Accumulate only completed trials and never substitute per-bit success for exact-message success. BER denominator includes output-bearing trials only; show rejected count alongside it.
- [ ] Yield at least every five transmissions and check signal before/after yield; default yield is a zero-delay timer. Record done/total progress. If a max-payload group still yields too slowly under throttling, reduce chunk size to1; do not silently move work to a blocking useMemo.

```ts
const yieldControl=options.yieldControl ?? (()=>new Promise<void>(resolve=>setTimeout(resolve,0)));
if(done % 5 === 0) {
  options.onProgress(done,total);
  await yieldControl();
  if(options.signal.aborted) return {ok:false,error:'cancelled'};
}
```

- [ ] Start only on Compare200; expose Cancel. Abort on input/config change, reset, component unmount or route exit. Guard progress/completion with run token and captured message revision so stale promises cannot publish. Persist completed batch snapshot (revision+config+rows), not an AbortController or Promise; show previous-message/settings labels. Cancelled progress stays labeled incomplete, not complete.
- [ ] UI tests verify no batch call on scroll/render, Cancel leaves receipt unchanged, progress is announced at chunk boundaries rather than each bit, and max-payload typing/navigation remains responsive. Run folder tests and typecheck; expect pass. Commit `feat: add responsive channel comparisons with explicit cancellation`.

### Task 18: Lab12 — interpretation without invented delivery or grading

**Files:** Create `apps/web/src/stories/labs/message-meaning/{model.ts,model.test.ts,MessageMeaningLab.tsx,MessageMeaningLab.test.tsx}`; update type/validator/registry/runtime.

**Interfaces:** `ReceiptView={status:'not-run'|'stale'|'exact'|'silent-corruption'|'rejected';receipt:DeliveryReceipt|null}`; `receiptView(receipt:DeliveryReceipt|null,revision:number):ReceiptView`. Config `{contexts:readonly {id:'meeting'|'disagreement'|'missing-previous';label:Localized}[]}`; state `{contextId:'meeting',interpretation:null}` where interpretation is `'changed'|'unchanged'|'unsure'|null`. Only receiptView determines technical status.

- [ ] Write tests for not-run/stale/rejected plus context independence. Run `bun run test src/stories/labs/message-meaning`; expect failure.

```ts
expect(receiptView(null,2)).toEqual({status:'not-run',receipt:null});
const receipt:DeliveryReceipt={messageText:'A',messageRevision:1,source:[65],received:[65],
  config:{code:'raw',p:0,seed:1,budget:512},required:8,outcome:'exact',flippedBits:0,payloadErrors:0};
expect(receiptView(receipt,2).status).toBe('stale');
expect(receiptView(receipt,1).status).toBe('exact');
```

- [ ] Implement precedence: null→not-run; mismatched revision→stale; otherwise receipt.outcome. Original/received text uses strictUTF8 decode and hex; rejected has no claimed received sentence. Present snapshot configuration beside its status.
- [ ] Add three fictional context radios and optional “changed/unchanged/unsure”; no correct-answer styling or AI calls. Not-run/stale states link to `#scene-11`; separate static example is explicitly labeled. “Try another message” opens MessageEditor without replacing data. Reset changes only context/interpretation.

```tsx
{view.status==='not-run'||view.status==='stale'
  ? <a href="#scene-11">{lang==='vi'?'Thử truyền ở cảnh 11':'Try a transmission in scene 11'}</a>
  : null}
```

- [ ] UI tests open this lab directly, switch all contexts, language and theme, and assert bytes/receipt unchanged with no requests. Register `message-meaning`/`MessageMeaningLab`; validate exactly three unique context IDs and complete locales. Run model/UI/session/registry tests and typecheck; expect pass. Commit `feat: separate delivery evidence from human interpretation`.

### Task 19: Transfer approved bilingual editorial data and static examples

**Files:** Create `apps/web/src/stories/content/across-the-noise/{copy.ts,copy.test.ts,sources.ts,labs.ts,fallbacks.ts,content.test.ts}`. No registry import or fictional provenance yet.

**Interfaces:** `issueCopy:{title:Localized;deck:Localized;intro:Localized<RichTextBlock[]>;acts:StoryAct[];scenes:Record<SceneId,Pick<StoryScene,'period'|'title'|'humanStory'|'technicalHinge'|'sourceIds'|'openQuestion'>>;imageText:Record<'cover'|SceneId,{alt:Localized;caption:Localized}>;coda:Localized<RichTextBlock[]>;courseAction:NonNullable<StoryDefinition['courseAction']>}`; `noiseSources:SourceEntry[]`; `noiseLabs:Record<SceneId,LabDefinition>`; `noiseFallbacks:Record<SceneId,LabFallback>`. Use explicit scene-01…scene-12 keys, no weak casts.

- [ ] Add tests for four acts, exact twelve scene/kind order, two locales, words, 2–4 source IDs per scene, complete fallback tables and exact examples. Run `bun run test src/stories/content/across-the-noise`; expect missing content.

```ts
expect(issueCopy.acts.map(a=>a.sceneIds.length)).toEqual([3,3,3,3]);
expect(Object.values(noiseLabs).map(l=>l.kind)).toEqual([
  'message-budget','ambiguous-code','morse-spacing','cable-route',
  'pulse-channel','binary-noise','source-entropy','huffman-message',
  'repetition-channel','secded-inspector','channel-budget','message-meaning',
]);
for(const scene of Object.values(issueCopy.scenes)) for(const lang of ['vi','en'] as const) {
  const words=scene.humanStory[lang].flatMap(b=>'text' in b?[b.text]:b.items).join(' ').trim().split(/\s+/).length;
  expect(words).toBeGreaterThanOrEqual(120); expect(words).toBeLessThanOrEqual(210);
}
```

- [ ] Transfer the approved copy verbatim into localized data. Intro includes Opening and Editorial notice, not only deck. Preserve fictional notices in01/12 while normalizing caption prefixes to the main spec: `Minh hoạ: tình huống hư cấu — …` / `Illustration: a fictional situation — …`. This is punctuation/prefix alignment, not a new story claim. Do not add long verbatim quotations from sources.
- [ ] Populate all15 source entries from the design's source table; read original URLs to verify the authored factual clauses before release review. Use actual access date, meaningful VI/EN scope notes and accurate year/type. Record inaccessible originals in review report rather than inventing a successful lookup; use another primary source only if it supports the same claim and document the replacement.
- [ ] Author twelve static tables from the approved fixtures: shortened examples, `01→AC/B`, ET timings, route27/31/21, two pulse sample tables, flipped byte, entropy0/2, Huffman96bit, repetition success/failure, SECDED01100110, three code rates/budgets, and three fictional contexts. Do not import lab engines into authored fallback data. Unit tests compare static numeric rows with pure model results by importing models from TESTS only.
- [ ] Add a content parity test that parses the approved copy appendix using named section boundaries and compares human/technical paragraphs, questions and title/deck to the corresponding localized fields. Document only the caption-prefix normalization above; avoid a silent summary or partial translation.
- [ ] Run content tests, validateStory tests and typecheck; expect pass. Commit `feat: author the approved bilingual communication narrative`.

### Task 20: Generate and review the cover/opening/ending art pilot

**Files:** Create `apps/web/src/stories/content/across-the-noise/art-pilot.json`, `art-pilot.test.ts`, `art-direction.md`; create pilot exports in `assets/cover.webp`, `assets/cover-768.webp`, `assets/scene-01.webp`, `assets/scene-01-768.webp`, `assets/scene-12.webp`, `assets/scene-12-768.webp`. Create `apps/web/scripts/export-story-plates.mjs` and `.test.ts` for reproducible mechanical conversion.

**Interfaces:** Exporter input is an explicit manifest array `{sceneId:'cover'|SceneId;sourceOutput:string;createdAt:string;tool:string;model:string;prompt:string;edits:string[];license:string}` using real tool-returned paths/metadata. CLI `node scripts/export-story-plates.mjs --manifest src/stories/content/across-the-noise/art-pilot.json --out src/stories/content/across-the-noise/assets`. Script exports both sizes, checks budget and reports actual hashes/bytes; it must reject duplicate IDs, nonexistent source paths, destinations outside the exact output directory and wrong aspect ratio. No destructive source overwrite.

- [ ] Read imagegen and frontend-design skills before art actions. Use image generation for original illustrations and creative edits. Mechanical format conversion/downsampling can use installed `/opt/homebrew/bin/cwebp`; `/usr/bin/sips` is available for dimension inspection. Do not install new dependencies or send unrelated local images.
- [ ] Write pilot-manifest tests expecting exactly cover/scene-01/scene-12, distinct SHA256, valid dimensions and nonempty actual metadata. They fail while pilot outputs do not exist; this is an art acceptance gate, not proof that a text prompt generated an image.
- [ ] Generate cover, scene01 and scene12 using their approved briefs. Common art instruction:

```text
Original editorial illustration for a bilingual essay about communication.
Maritime atlas meets an operator's notebook: diluted watercolor on warm paper,
graphite observation, delicate engraved texture, tracing-paper translucency.
Material weight, modest human figures, believable tools, restrained sea blue,
mineral gray and copper-brown. Horizontal 3:2 composition. No letters, labels,
numbers, diagrams, luminous bits, generic robots, glowing brains or decorative
thread. Preserve generous quiet areas without turning the image into a UI.
```

- [ ] For01 use the approved two-room diptych; for12 return to that fictional receiving room from a new viewpoint with warmer light and a paper now on the table. Inspect generated images before referenced-image edits. Use the actual pilot as continuity reference, not a historical portrait or copied museum artwork. Do not prefill model/date/path based on expectations; if the tool does not report a model, record “not reported by tool” explicitly rather than inventing one.
- [ ] Implement exporter with argument-vector `execFile` calls, not shell interpolation. Verify 3:2 source before resize. For each width1536/768 use WebP q85,80,75,70 in descending quality until budget fits; if q70 fails, stop and review art/detail instead of crushing quality. Decimal budgets250000/320000/100000bytes. Keep source originals recoverable.

```js
await execFileAsync('/opt/homebrew/bin/cwebp',[
  '-resize',String(width),String(width*2/3),'-q',String(quality),
  '-metadata','none',sourceOutput,'-o',destination,
]);
```

- [ ] Inspect all six exports at actual display size in light/dark surroundings and create a three-plate contact sheet for review. Explain how imagegen/art direction influenced the output. Ask for review if the pilot materially differs from approved direction; do not generate the remaining ten while such a choice is unresolved.
- [ ] Run pilot/exporter tests and `git diff --check`; expect correct files/metadata. Stage only Task20 assets/scripts/docs and commit `art: establish the maritime operator-notebook illustration direction`.

### Task 21: Complete thirteen plates and measured provenance

**Files:** Create `apps/web/src/stories/content/across-the-noise/assets/scene-02.webp` through `scene-11.webp` and their `-768.webp` variants; create `provenance.json`, `assets.ts`, `cover.ts`, `assets.test.ts`; update art-direction notes. Preserve original pilot records as generation evidence.

**Interfaces:** `noiseCover:ResponsiveStoryImage`, `noiseIllustrations:Record<SceneId,StoryIllustration>`, provenance as existing `IllustrationProvenance[]` plus stored `sha256` and `smallSha256` fields for verification. `cover.ts` imports only its two assets and small literal alt/caption data; it must NOT import `copy.ts`, `assets.ts` or all provenance. `assets.ts` uses explicit image imports for twelve scenes, not importglob.

- [ ] Write asset tests for exactly13 provenance records,26files,13distinct large hashes, exact actual byte counts, dimensions and budgets; run `bun run test src/stories/content/across-the-noise/assets.test.ts`, expect absent/incomplete assets to fail.

```ts
expect(provenance).toHaveLength(13);
for(const record of provenance) {
  const path=fileURLToPath(new URL(`./assets/${record.filename}`,import.meta.url));
  expect(statSync(path).size).toBe(record.bytes);
  expect(record.bytes).toBeLessThanOrEqual(record.sceneId==='cover'?250000:320000);
  expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(record.sha256);
}
```

- [ ] Generate scenes02–06 from approved briefs, one distinct composition each: codebook collaboration; hand/timing close-up; workers/cable deck; shore instrument/cable cross-section; two comparison desks. Inspect hands/tool plausibility, no invented raster text, and human-labor emphasis after each output; use imagegen edits for substantive corrections.
- [ ] Generate scenes07–11: counting cards; grouping/tracing paper; three paper copies; overlapping check sheets; engineer's three equipment choices/resource ledger. Do not imply three physically independent networks or depict Shannon capacity as a literal sea barrier.
- [ ] Export real outputs with Task20 exporter; record actual prompts, dates, source paths, edits, bytes and hashes. `license:'project-generated'` is the project's provenance category, not a claim of exclusivity or an invented third-party license. Retain any actual tool/provider terms relevant to reuse in art-direction notes.
- [ ] Build ResponsiveStoryImage entries with width1536/height1024, srcSet768w/1536w, scene sizes `(max-width: 900px) 100vw, 58vw`, actual byte count and bilingual image text from Task19. Pick measured/visually verified dominant colors; metadata cover remains small and isolated.
- [ ] Visually inspect all13 as one narrative, then each at mobile size; verify no duplicated crop masquerading as another scene. Run asset/content/export tests and typecheck; expect pass. Commit `art: complete the thirteen original Across the Noise plates`.

### Task 22: Assemble the draft, preview safely and connect the real catalog

**Files:** Create `apps/web/src/stories/content/across-the-noise/{meta.ts,story.ts,story.test.ts}`, `components/{StoryCourseLink.tsx,StoryCourseLink.test.tsx}`; modify `content/{registry.ts,registry.test.ts}`, `components/{StoryPage.tsx,StoryPage.test.tsx,StoryRenderer.tsx,StoryRenderer.test.tsx,LandingStoryFeature.test.tsx,StoryIndex.test.tsx}`.

**Interfaces:** `noiseMeta:StoryMeta`; default `story:StoryDefinition`; `resolveStoryEntry(slug:string,allowDrafts:boolean,entries:readonly StoryRegistryEntry[]=storyRegistry):StoryRegistryEntry|undefined`. Keep `getStoryBySlug` production-only unchanged. `StoryCourseLink({action}:{action:NonNullable<StoryDefinition['courseAction']>})` consumes existing `fetchCatalog`, `catalogQueryKey`, `useQuery`; no session input.

- [ ] Add tests for assembled `validateStory(story)===[]`, exact12kinds and full word/source counts. Test draft absent from normal collection/landing and production route, available only under explicit draft resolver. Run content/registry/page tests; expect missing assembly/resolver failures.

```ts
expect(noiseMeta.published).toBe(false); expect(noiseMeta.featured).toBe(false);
expect(getPublishedStories().some(s=>s.slug==='across-the-noise')).toBe(false);
expect(resolveStoryEntry('across-the-noise',false)).toBeUndefined();
expect(resolveStoryEntry('across-the-noise',true)?.slug).toBe('across-the-noise');
expect(validateStory(story)).toEqual([]);
```

- [ ] Assemble story from copy/acts/sources/labs/fallbacks/assets/provenance with explicit scene01…12 mapping. Set interaction examples, intro, coda/courseAction and theme. Import issue CSS only from lazy story module. Metadata imports only cover and its own short localized literals; parity tests compare duplicated title/deck to issueCopy to prevent drift.
- [ ] Add explicit registry loader `() => import('./across-the-noise/story')`. Preserve production discovery. StoryPage permits draft only with `?preview=1` AND a local dev or explicit `story-review` build mode:

```ts
const allowDrafts=(import.meta.env.DEV || import.meta.env.MODE==='story-review')
  && searchParams.get('preview')==='1';
const entry=resolveStoryEntry(slug,allowDrafts);
```

- [ ] Test normal production mode ignores preview query and doesn't invoke draft loader. Preview is a local review convenience, not a secrecy/auth boundary: bundled draft assets are not private documents. Add visible VI/EN draft banner and `noindex` for draft pages with cleanup on route exit; public route/canonical slug stay stable.
- [ ] Renderer outputs optional intro before cover and optional StoryCourseLink in coda, only when declared. Existing AI fixture without these fields must not need a QueryClient or change markup unexpectedly. CTA uses a real catalog match for the declared slug; loading/missing/error leads to `/courses`; present leads to `/c/<slug>`. *(CTA khoá đã được gỡ khỏi bản đặc biệt trước khi repo mở công khai — nó trỏ tới một khoá riêng tư, tức một liên kết chết với công chúng; xem `docs/publishing.md`.)* EN label never claims the course has an English edition.

```ts
const catalog=useQuery({queryKey:catalogQueryKey(),queryFn:fetchCatalog,retry:false});
const available=catalog.data?.some(course=>course.slug===action.slug)===true;
const href=available?`/c/${action.slug}`:'/courses';
const label=(available?action.label:action.fallbackLabel)[lang];
```

- [ ] Use injected registry arrays in LandingStoryFeature/StoryIndex tests to simulate future publication: issue02true/true and issue01true/false yields order02,01 and exactlyone featured. Do not change actual flags. Keep no empty “coming soon” filler. Run all stories tests and typecheck; expect pass. Commit `feat: integrate the unpublished communication edition for local review`.

### Task 23: Issue-specific art direction and browser interaction polish

**Files:** Create `apps/web/src/styles/across-the-noise.css`, `apps/web/e2e/stories-draft/across-the-noise.spec.ts`, `apps/web/e2e/stories-draft-exclusion.spec.ts`, `apps/web/playwright.stories-draft.config.ts`; modify `apps/web/playwright.config.ts` to exclude only the dedicated draft-test directory from its production-build suite. Modify new lab components and `src/stories/components/{StoryRenderer.tsx,StoryRenderer.test.tsx}` only for measured layout/focus failures. Avoid unrelated landing redesign.

**Interfaces:** Theme class `story-theme-across-noise`; shared theme variables keep existing names. Draft Playwright config extends existing config, sets `testDir:'./e2e/stories-draft'`, clears the inherited directory exclusion with `testIgnore:[]`, and uses `testMatch:'across-the-noise*.spec.ts'`. Independent port5184, `reuseExistingServer:false`, installed Chrome channel for visual runs; no interference with user's running servers. Production suite still runs all existing tests plus draft-exclusion, and Task24 runs both configs explicitly.

```ts
webServer: {
  command:'bun run typecheck && ./node_modules/.bin/vite build --mode story-review && bun run preview -- --port 5184 --strictPort',
  url:'http://localhost:5184',reuseExistingServer:false,
},
use:{baseURL:'http://localhost:5184',channel:'chrome'},
```

- [ ] Add draft smoke for all12 labs at320/390/1024/1440, both languages, light/dark and reduced motion. Test active lab stage contains no illustration/caption, actual document has no horizontal overflow, Back is reachable and returns focus to opening button. Use mobile inline locator at≤900px rather than asserting the desktop stage exists there. Run one smoke before CSS; expect missing theme/overflow assertions to fail if defects exist. Do not force a failing assertion when the preserved shell already passes—record it as a regression baseline.

```ts
await page.goto('/stories/across-the-noise?preview=1#scene-03');
const open=page.getByRole('button',{name:'Tự tay thử'}).nth(2);
await open.click();
await expect(page.locator('.story-stage .story-lab-frame')).toBeVisible();
expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
await page.getByRole('button',{name:'Trở lại tranh'}).click();
await expect(open).toBeFocused();
```

- [ ] Implement scoped dark tokens with specificity at least that of existing global dark rule; preserve transparent theme button/currentColor behavior. Charis display only inside this issue. Core styles:

```css
html[data-theme='dark'] .story-shell-theme-scope.story-theme-across-noise {
  --story-paper:#15252c; --story-ink:#ece7db; --story-muted-ink:#b1c2c4;
  --story-accent:#d6ab75; --story-stage:#1d343b;
}
.story-theme-across-noise .story-lab-frame {background:var(--story-paper);min-width:0;}
.story-theme-across-noise .story-lab-frame pre {white-space:pre-wrap;overflow-wrap:anywhere;}
.story-theme-across-noise .story-lab-frame svg {display:block;max-width:100%;height:auto;}
.story-theme-across-noise .story-lab-frame table {width:100%;table-layout:fixed;overflow-wrap:anywhere;}
```

- [ ] Add subtle printed rules and actual-data diagrams, not ornamental connections. Pulse plots distinguish strokes/dashes; parity groups use numbers/labels; entropy bars use real probabilities. Keep ample whitespace in illustration mode and denser notebook grids only in lab mode. No parallax/ambient sound/autoplay.
- [ ] Measure text/focus/disabled/stage contrast on rendered light/dark states; preserve ≥44px targets. Check long VI title and English title through injected featured-card tests: Shantell22–28px/natural wrapping/no balance/max-inline-width causing early break. No style rule in issue CSS may target `.bd-story-feature` or global headings.
- [ ] Run draft E2E and old stories E2E; capture actual Chrome screenshots. Known headless-shell image-render artifact is not a reason to change app image code; use verified Chrome channel and record environment. Commit `style: give the communication edition a responsive maritime notebook identity`.

### Task 24: Privacy, lazy-loading, performance and final local review gate

**Files:** Modify `apps/web/scripts/check-story-bundles.{mjs,test.ts}`; create `apps/web/e2e/stories-draft/{across-the-noise-privacy.spec.ts,across-the-noise-performance.spec.ts}` and `docs/superpowers/reports/2026-09-05-across-the-noise-review.md`; fix only verified task-related failures before final handoff.

**Interfaces:** Keep `findStoryStaticLeaks(evidence)` API. Extend forbidden patterns to full content for any issue and all lab subdirectories; allow metadata/cover, type-only definitions and explicit loader registry. Production entry cannot contain session UI/engines; issue entry may contain Unicode/session support but Huffman/SECDED UI loads only when requested.

- [ ] Add failing leak fixtures including folded issue02 copy, source, assets, provenance and communication/Huffman engines; preserve allow-meta/cover and dynamic-chunk tests.

```ts
expect(findStoryStaticLeaks({staticChunks:[{modules:[
  'src/stories/content/across-the-noise/copy.ts',
  'src/stories/labs/communication/noise.ts',
]}]})).toEqual([
  'src/stories/content/across-the-noise/copy.ts',
  'src/stories/labs/communication/noise.ts',
]);
```

- [ ] Run `bun run test scripts/check-story-bundles.test.ts`; expect new leaks not detected before extending regex. Then implement general content exclusions with explicit allowlist meta/cover; include `.json` provenance and `labs/communication/` engine paths. Run the real production build and graph check, not only fixture regexes.
- [ ] Write privacy E2E with distinctive message `PRIVATE-NOISE-20260905-ắ-👨‍👩‍👧‍👦`: capture requests including POST bodies, console, URL and browser storage; edit/run06/08/09/11/12 and switch language/theme. Assert no raw or URL-encoded sentinel leaves the DOM/memory. Check outgoing JSON/byte-array forms against the UTF8 payload too, not only the exact text. Make normal catalog traffic distinguishable from a message leak.

```ts
const observed:string[]=[];
page.on('request',request=>observed.push(request.url(),request.postData()??''));
page.on('console',message=>observed.push(message.text()));
// After UI interactions with the sentinel:
const persisted=await page.evaluate(()=>({local:{...localStorage},session:{...sessionStorage},url:location.href}));
for(const token of [sentinel,encodeURIComponent(sentinel)]) {
  expect(JSON.stringify(persisted)).not.toContain(token);
  expect(observed.join('\n')).not.toContain(token);
}
```

- [ ] Add route lifecycle E2E: edit/run11 with p0, deep link12 shows exact; edit message makes stale; reset11 makes not-run; theme/language/hash/Back retain state; navigate collection then back/reload starts sample anew. Cancelled/late batch never changes final scene or old receipt. Fetch and console spies in component tests cover content-free error paths as well as successful paths. Abort one requested lab chunk, verify its static table, then remove interception and use Retry; separately fail a scene image and prove its lab can still open.
- [ ] Add request-observation tests: landing/collection request no full narrative or lab chunk; draft issue loads cover/nearby scenes only; opening08 first requests Huffman; opening06 does not. Verify actual image decode succeeds, not merely response200. Observe CLS≤.1 using PerformanceObserver; max1,024byte batch yields and Cancel is processed before complete; no eager200trial loop on scroll.
- [ ] Run fresh verification commands, recording exact exit status and totals on the final implementation tree:

```bash
# From apps/web; existing configured API must be reachable for catalog/reader smoke.
bun run typecheck
bun run lint
bun run test
bun run build
bun run check:stories-bundle
./node_modules/.bin/playwright test e2e/stories.spec.ts
./node_modules/.bin/playwright test --config playwright.stories-draft.config.ts
bun run build
bun run check:stories-bundle
./node_modules/.bin/playwright test e2e/stories-draft-exclusion.spec.ts
```

- [ ] Draft E2E overwrites local dist with review build. Rebuild with normal `bun run build` afterward and run bundle check plus production-route exclusion test for `?preview=1`; do not leave review artifacts as deployment input. Use the repo's real API test setup (`scripts/test-e2e.sh`) for the catalog/reader test when required; never substitute a successful mock and call it production integration. If services are unavailable, report which gates remain unverified.
- [ ] Write review report with implementation commit, actual commands/counts, measured budgets/CLS, screenshot paths for cover/lab/final scene in both themes, source checks, all13 provenance records and any limitations. Local dev review URL is `/stories/across-the-noise?preview=1`; start on an available explicit port, keeping the user's existing servers intact. Do not claim code was tested based on this plan or the earlier13 design-baseline tests.
- [ ] `git diff --check`, inspect exact staged paths and commit `test: verify communication edition privacy accessibility and loading`. Present the live local review URL and report. Stop before public flags, push, PR merge or production deployment; obtain user authorization for that separate step.

## Self-review and coverage map

| Approved requirement | Task/evidence gate |
|---|---|
| Reusable reader, unchanged AI labs and optional interaction | 01,03,22; full old story tests in24 |
| Exact Unicode/privacy/reset/stale snapshots | 02–05,10,13–18,24 |
| Four acts, human/technical depth, bilingual source-mapped copy | 19,22 |
| Every lab's pure model and real UI | 05–18; each has targeted tests and explicit lazy registration |
| Prefix ambiguity full counts; Morse convention boundaries | 06 bigint DP;07 durations/reverse-code tests |
| Fictional infrastructure, deterministic ISI/noise | 08–10 |
| Entropy boundaries, Huffman overhead and independent decoder | 11–13 |
| Repetition limits,592 SECDED cases,200-trial cancellation | 14–17 |
| No invented final delivery or semantic grading | 18,24 |
| Thirteen distinct original plates, all responsive budgets | 20–21 |
| Opaque stage, focus return, dark mode, natural landing title | 04,23–24 |
| Static fallbacks with meaningful numeric/text tables | 01,04,19; failed-chunk E2E in24 |
| Draft-only review; true catalog CTA; one future featured | 22,24; actual public flags remainfalse |
| Lazy entry/scene/lab behavior, CLS, browser responsiveness | 24 |

This document is a plan. Unchecked boxes intentionally indicate work not performed. The handoff ends with an execution-method choice, not automatic implementation or release.

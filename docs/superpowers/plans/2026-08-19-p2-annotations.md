# P2 — Annotation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight + comment đoạn văn bản với margin cards ở rãnh phải, neo bền qua chỉnh sửa nội dung, sync đa thiết bị, offline-first.

**Architecture:** Anchor theo W3C text-quote `{exact, prefix, suffix}` tính trên **văn bản chuẩn hóa** trong đó mỗi khối `.katex` là một token nguyên tử (ký tự `￼`). Server-side đã xong từ P1 (bảng `annotations` + sync LWW + tombstone) — P2 thuần frontend trừ khi ghi chú khác.

**Tech Stack:** như P1. Không thêm dependency mới ngoài một hàm Levenshtein tự viết (~20 dòng — không kéo lib).

**Spec:** `docs/superpowers/specs/2026-08-19-tuhoc-platform-design.md` (§5 Annotation engine)

## Global Constraints

- Vùng annotatable: text bên trong `#content p, li, td, .box, .fig-foot, .keyfacts` — KHÔNG cho chọn xuyên `canvas`, `input`, `.ctrls`.
- Mọi khối `.katex` (cả display) là token nguyên tử: selection cắt ngang nó thì snap ra ngoài; anchor không bao giờ chứa nội dung bên trong `.katex`.
- Annotation mất neo KHÔNG BAO GIỜ tự xóa (spec §5) — vào panel "Ghi chú mồ côi".
- `prefix`/`suffix` ≤ 64 ký tự trên chuỗi chuẩn hóa.
- Sync dùng lại nguyên `annotations` pipeline P1 (Dexie + outbox + LWW); xóa = set `deletedAt`.
- Màu highlight: 4 giá trị `'y' | 'g' | 'b' | 'p'` lưu trong `anchor.color`; CSS var từ tokens v1 (`--s4, --s3, --s1, --s5` với alpha .28; dark mode alpha .38).

## File Structure

```
apps/web/src/annotations/
├── normalize.ts        # chuẩn hóa DOM → chuỗi phẳng + bảng map
├── anchor.ts           # selectionToAnchor / anchorToRange (+ fuzzy)
├── painter.ts          # sơn/tẩy <mark> theo Range
├── useAnnotations.ts   # CRUD hook trên Dexie + outbox
├── SelectionToolbar.tsx
├── MarginCards.tsx     # cards rãnh phải + xếp chồng
├── AnnotationSheet.tsx # bottom sheet mobile
├── OrphanPanel.tsx
└── __tests__/          # normalize.test.ts, anchor.test.ts, painter.test.ts, layout.test.ts
```

---

### Task 1: normalize.ts

**Files:** Create: `src/annotations/normalize.ts`, `__tests__/normalize.test.ts`

**Interfaces:** Produces:

```ts
type NormMap = { flat: string; segs: Array<{ node: Text | Element; start: number; end: number; atomic: boolean }> };
normalizeContainer(root: Element): NormMap
// flat: concat textContent các text node trong vùng annotatable, mỗi .katex (span.katex | span.katex-display)
//       đóng góp đúng 1 ký tự '￼' (atomic seg, node = element .katex);
//       bỏ qua text bên trong .ctrls, canvas wrapper, .tip; KHÔNG collapse whitespace (giữ nguyên offsets).
flatToDom(map: NormMap, from: number, to: number): Range | null   // đổi khoảng trên flat → DOM Range (snap mép ra ngoài token atomic)
domToFlat(map: NormMap, node: Node, offset: number): number       // đổi vị trí DOM → offset trên flat; trong .katex → trả mép token
```

- [ ] **Step 1: Test fail trước** — fixture HTML thu nhỏ nhưng thật (cắt từ chương p1-5: đoạn `<p>` chứa 2 công thức inline + 1 display):

```ts
const FIX = `<div id="c"><p>Xét phân kỳ <span class="katex">…mathml nhân ba…</span> giữa hai phân phối,
và <span class="katex">…</span> là đại lượng trung tâm.</p>
<div class="ctrls"><label>bỏ qua tôi</label></div></div>`;

it('katex là 1 token, ctrls bị loại', () => {
  const m = normalizeContainer(el(FIX));
  expect(m.flat).toContain('Xét phân kỳ ￼ giữa hai phân phối');
  expect(m.flat).not.toContain('mathml');
  expect(m.flat).not.toContain('bỏ qua tôi');
});
it('round-trip flat→dom→flat trên text thường', () => {
  const m = normalizeContainer(el(FIX));
  const i = m.flat.indexOf('hai phân phối');
  const r = flatToDom(m, i, i + 13)!;
  expect(r.toString()).toBe('hai phân phối');
  expect(domToFlat(m, r.startContainer, r.startOffset)).toBe(i);
});
it('offset trong katex snap ra mép token', () => { /* domToFlat với node bên trong .katex → mép ￼ */ });
```

- [ ] **Step 2:** RED → implement bằng TreeWalker (SHOW_TEXT | SHOW_ELEMENT; khi gặp `.katex` push seg atomic rồi skip subtree; khi gặp vùng loại trừ skip subtree). **Step 3:** GREEN. **Step 4:** Commit `feat(web): annotation text normalization`

---

### Task 2: anchor.ts — tạo và giải anchor

**Files:** Create: `src/annotations/anchor.ts`, `__tests__/anchor.test.ts`

**Interfaces:** Produces:

```ts
type Anchor = { exact: string; prefix: string; suffix: string; color: 'y'|'g'|'b'|'p' };
selectionToAnchor(map: NormMap, range: Range, color: Anchor['color']): Anchor | null
   // null nếu selection rỗng sau khi snap hoặc nằm ngoài vùng annotatable
anchorToRange(map: NormMap, a: Anchor): { range: Range; fuzzy: boolean } | null
   // 1) exact match: indexOf toàn bộ exact; nhiều match → chọn match có prefix/suffix khớp dài nhất
   // 2) fuzzy: trượt cửa sổ |exact| ± 8 quanh vị trí gợi ý bởi prefix; nhận nếu
   //    levenshtein(window, exact) <= max(2, ceil(0.2 * exact.length)); đánh dấu fuzzy=true
   // 3) thất bại → null (caller đưa vào orphan)
levenshtein(a: string, b: string): number   // export để test; cắt sớm khi vượt ngưỡng
```

- [ ] **Step 1: Test fail trước** — đúng bộ case spec §9:

```ts
const base = 'Entropy đo độ bất định trung bình của một nguồn tin rời rạc.';
it('exact match', () => {/* anchor tạo từ 'độ bất định trung bình' giải lại đúng range */});
it('sửa chính tả 1 ký tự → fuzzy=true, vẫn tìm được', () => {/* 'bất địn' */});
it('chèn cả câu trước đó → vẫn đúng (prefix đổi, exact còn)', () => {});
it('xóa đoạn chứa exact → null (orphan)', () => {});
it('quanh katex: exact chứa ￼ vẫn match sau khi công thức re-render', () => {});
it('exact xuất hiện 2 lần → prefix/suffix chọn đúng bản', () => {});
```

- [ ] **Step 2:** RED → implement. **Step 3:** GREEN. **Step 4:** Commit `feat(web): text-quote anchor + fuzzy re-attach`

---

### Task 3: painter.ts

**Files:** Create: `src/annotations/painter.ts`, `__tests__/painter.test.ts`

**Interfaces:** Produces:

```ts
paint(range: Range, id: string, color: string): void
  // wrap từng đoạn text-node giao với range bằng <mark class="ann ann-<color>" data-ann-id=id>;
  // range xuyên nhiều element (qua </p><p>, qua <b>…) → nhiều mark cùng data-ann-id;
  // KHÔNG wrap phần tử .katex — mark dừng hai bên (token atomic đã hiển thị nguyên khối).
unpaint(id: string): void                    // unwrap mọi mark của id, normalize() text node
highlightRects(id: string): DOMRect[]        // rects hiện tại (cho MarginCards canh Y)
```

CSS thêm vào `src/styles/shell.css`: `.ann{cursor:pointer; border-radius:2px}` + 4 màu (alpha theo Global Constraints), `.ann.focus{outline:2px solid var(--accent)}`.

- [ ] **Step 1: Test fail:** paint range xuyên `<p>A <b>B</b> C</p>` → 3 mark cùng id, text đọc lại nguyên vẹn; unpaint → DOM trở về (so sánh `innerHTML` với gốc, chấp nhận normalize()); paint quanh katex → katex không nằm trong mark nào.
- [ ] **Step 2:** RED → implement → GREEN. **Step 3:** Commit `feat(web): highlight painter`

---

### Task 4: useAnnotations — CRUD + sync nối P1

**Files:** Create: `src/annotations/useAnnotations.ts`, test.

**Interfaces:**
- Consumes: `db.annotations`, `setProgress`-style outbox từ P1 (`db.outbox`), `mergeRow`.
- Produces:

```ts
useAnnotations(courseId: string, chapterId: string): {
  list: Ann[];                                  // sống (deletedAt null), sắp theo vị trí xuất hiện
  orphans: Ann[];                               // anchorToRange trả null ở lần render hiện tại
  create(anchor: Anchor, note: string): Promise<string>;   // id = crypto.randomUUID()
  updateNote(id: string, note: string): Promise<void>;
  remove(id: string): Promise<void>;            // deletedAt = now → outbox
  reattach(id: string, anchor: Anchor): Promise<void>;     // dùng bởi OrphanPanel
}
```

- [ ] **Step 1: Test fail** (fake-indexeddb): create → row trong Dexie + outbox entry đúng shape POST /sync của P1; remove → deletedAt set, outbox thêm; hai bản ghi cùng id merge theo updatedAt. RED → implement → GREEN.
- [ ] **Step 2:** Commit `feat(web): annotation store wired to P1 sync`

---

### Task 5: SelectionToolbar + luồng tạo

**Files:** Create: `src/annotations/SelectionToolbar.tsx` · Modify: `src/reader/ChapterView.tsx` (mount engine sau initViz)

**Interfaces:** Produces: lắng nghe `selectionchange` trong `#content`; selection hợp lệ → toolbar nổi phía trên selection: 4 nút màu (highlight ngay) + nút "Ghi chú" (highlight + mở ô nhập note trong margin card mới, autofocus). Esc/click ngoài đóng. Sau tạo: paint ngay, không chờ sync.

Luồng render chương đầy đủ (thứ tự bắt buộc, ChapterView): innerHTML → renderKatex → initViz → `normalizeContainer` → giải anchor mọi annotation của chương → paint + thu `orphans` → mount toolbar + cards.

- [ ] **Step 1:** Test component (testing-library + user-event): mock selection trên fixture → toolbar hiện; click màu → `create` gọi với anchor đúng exact. RED → implement → GREEN.
- [ ] **Step 2:** Commit `feat(web): selection toolbar + create flow`

---

### Task 6: MarginCards — rãnh phải

**Files:** Create: `src/annotations/MarginCards.tsx`, `__tests__/layout.test.ts` · Modify: `Reader.tsx` (rail 2 tab "Trong chương" / "Ghi chú (n)"), `reader-layout` CSS.

**Interfaces:** Produces:
- `layoutCards(items: {id, y, height}[], gap=10): {id, top}[]` — pure, export để test: sort theo y, `top = max(y, prevBottom + gap)` (một cột, đẩy xuống, không đổi thứ tự).
- `<MarginCards>`: desktop ≥1240px render cột phải rộng 260px (chiếm chỗ `#rail` khi tab "Ghi chú" active); card = note + màu viền trái + thời gian; click card ↔ scroll + focus highlight (2 chiều); connector kẻ bằng 1 div absolute mảnh. Resize/scroll → re-đo `highlightRects` (rAF throttle).
- Màn `<1240px`: tap highlight → `<AnnotationSheet>` bottom sheet (list ghi chú của highlight đó, sửa/xóa).

- [ ] **Step 1:** Test `layoutCards` (3 case: không chạm, chạm dây chuyền, thứ tự giữ nguyên). Test click-to-focus 2 chiều bằng testing-library. RED → implement → GREEN.
- [ ] **Step 2:** Chạy dev thật, tạo 5 ghi chú sát nhau trên p1-5 — cards xếp chồng đúng, không che nội dung. Ghi chú vào PR note.
- [ ] **Step 3:** Commit `feat(web): margin comment cards + rail tabs + mobile sheet`

---

### Task 7: OrphanPanel

**Files:** Create: `src/annotations/OrphanPanel.tsx` · Modify: rail tab "Ghi chú" (mục "Mồ côi (n)" dưới cùng)

**Interfaces:** Produces: list orphan (exact bị cắt còn 80 ký tự + note); nút "Gắn lại": vào chế độ chọn — user bôi chọn đoạn mới → `reattach(id, anchorMới)` (giữ nguyên note + màu); nút "Xem exact gốc" (copy được). Không có nút xóa hàng loạt.

- [ ] **Step 1:** Test: annotation với anchor không giải được → xuất hiện trong orphans; reattach → rời orphans, paint lại. RED → implement → GREEN. Commit `feat(web): orphan panel + reattach`

---

### Task 8: E2E gate P2 (DoD)

**Files:** Create: `apps/web/e2e/p2.spec.ts`

- [ ] **Step 1:** E2E:

```ts
test('P2 DoD: highlight + comment + sync + orphan', async ({ browser }) => {
  // thiết bị 1: bôi 'tập điển hình' trong p1-8 → highlight vàng + note 'xem lại'
  // chờ sync → thiết bị 2 (context mới, cùng account): mở p1-8
  //   → thấy mark + margin card 'xem lại'; sửa note ở thiết bị 2 → thiết bị 1 nhận sau chu kỳ sync
  // offline: context 1 set offline → tạo highlight → online lại → xuất hiện ở context 2
  // orphan: inject sửa DOM xóa đoạn chứa exact (page.evaluate) → reload → card nằm trong 'Mồ côi', không mất note
});
```

- [ ] **Step 2:** `make test-e2e` PASS toàn bộ (p1.spec vẫn xanh — reader không tụt). Commit `test(e2e): P2 gate`

## Self-Review P2

- Spec §5 phủ đủ: anchor thuật toán (T1–T2), toolbar 4 màu + note (T5), margin cards + tabs + bottom sheet (T6), orphan không tự xóa (T7), offline outbox (T4 + e2e). Service worker precache (spec "P2 nếu kịp"): KHÔNG nằm trong DoD — nếu còn thời gian sau T8, thêm task riêng; không chặn P3.
- Type consistency: `Anchor.color` nằm trong anchor jsonb — khớp schema P1 (không cần migration); `Ann` = row Dexie P1.

/**
 * Tests for the annotation store (P2 Task 4) — the module that joins the
 * three previous ones (`./normalize`, `./anchor`, `./painter`) to the sync
 * pipeline P1 built and nobody had used yet.
 *
 * Three properties here are worth more than the rest, because each of them
 * is a failure that stays GREEN under the obvious test:
 *
 *   1. **Two overlapping notes painted in one pass.** The naive loop
 *      `for (a of anns) { r = anchorToRange(map, a); paint(r) }` passes every
 *      non-overlapping fixture and only breaks when the reader highlights over
 *      an existing highlight (ruling P2-F8). The "chồng nhau" test below fails
 *      loudly (`StaleNormMapError`) against that loop.
 *   2. **The fuzzy tier is deferred.** A budget test that only measures wall
 *      clock is a flake; this file asserts the ORDER of published states
 *      instead — an exact-matching note must reach `list` in an earlier React
 *      commit than a note that needed the fuzzy tier.
 *   3. **The outbox row's field names.** One wrong name and the note syncs to
 *      the server and vanishes on the other device, silently. The shape is
 *      compared against the literal key list of `annotationItem` in
 *      `apps/api/internal/sync/handler.go`.
 */
import { act, render, waitFor } from '@testing-library/react';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearLocalData, db, mergeRow, type AnnotationRow } from '../db/local';
import { type Anchor, type AnchorColor, selectionToAnchor } from './anchor';
import { normalizeContainer } from './normalize';
import { type ChapterContent, type UseAnnotationsResult, useAnnotations } from './useAnnotations';

/** The exact JSON field names `annotationItem` declares in
 * apps/api/internal/sync/handler.go. Anything else in an outbox row is a
 * field the server will ignore; anything missing is a field it will reject
 * (400) or read as empty. */
const SERVER_ANNOTATION_FIELDS = [
  'anchor',
  'chapterId',
  'courseId',
  'createdAt',
  'deletedAt',
  'id',
  'note',
  'updatedAt',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CHAPTER = [
  '<h2>Chương thử nghiệm</h2>',
  '<p>Entropy đo lượng thông tin trung bình mà một nguồn tin sinh ra.</p>',
  '<p>Độ dài mã tối ưu không thể ngắn hơn entropy của nguồn tin đó.</p>',
  '<p>Kênh nhiễu làm giảm dung lượng truyền tin của toàn hệ thống.</p>',
].join('\n');

/** The same chapter after a one-character content edit inside the second
 * paragraph — "ngắn" → "ngán". Every anchor quoting that paragraph misses the
 * exact tier and has to go through the fuzzy one. */
const CHAPTER_EDITED = CHAPTER.replace('ngắn hơn', 'ngán hơn');

const Q_FIRST_HALF = 'Entropy đo lượng thông tin';
const Q_SECOND_HALF = 'lượng thông tin trung bình';
const Q_THIRD_PARA = 'Kênh nhiễu làm giảm dung lượng';
const Q_EDITED_PARA = 'Độ dài mã tối ưu không thể ngắn hơn entropy của nguồn tin đó.';
const Q_ABSENT = 'Định lý mã hoá kênh của Shannon nói về dung lượng khả đạt';

/**
 * Builds a real `Anchor` the way Task 5's toolbar will: from a live `Range`
 * over the chapter, through `selectionToAnchor`. Hand-writing `{exact,
 * prefix, suffix}` literals would test this file's idea of the collapsed
 * projection rather than `./anchor`'s.
 *
 * `html` is rendered into a DETACHED scratch div, never the one under test —
 * the chapter under test gets painted, and an anchor must be built from
 * pristine content the way it is on the device that created it.
 */
function makeAnchor(html: string, quote: string, color: AnchorColor = 'y'): Anchor {
  const scratch = document.createElement('div');
  scratch.innerHTML = html;
  const map = normalizeContainer(scratch);
  const walker = document.createTreeWalker(scratch, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    const at = text.data.indexOf(quote);
    if (at < 0) continue;
    const range = document.createRange();
    range.setStart(text, at);
    range.setEnd(text, at + quote.length);
    const anchor = selectionToAnchor(map, range, color);
    if (anchor) return anchor;
  }
  throw new Error(`makeAnchor: cannot anchor ${JSON.stringify(quote)}`);
}

interface SeedInput {
  id: string;
  anchor: Anchor;
  note?: string;
  courseId?: string;
  chapterId?: string;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

/** Puts a row straight into Dexie without an outbox entry — i.e. exactly what
 * `sync/engine.ts`'s `pull()` does with a row that arrived from another
 * device. Used so "resolving an annotation must never write anything" can be
 * asserted against an empty outbox. */
async function seed(input: SeedInput): Promise<AnnotationRow> {
  const row: AnnotationRow = {
    id: input.id,
    courseId: input.courseId ?? 'c1',
    chapterId: input.chapterId ?? 'ch1',
    anchor: input.anchor,
    note: input.note ?? '',
    createdAt: input.createdAt ?? '2026-08-20T10:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-08-20T10:00:00.000Z',
    deletedAt: input.deletedAt ?? null,
  };
  await db.annotations.put(row);
  return row;
}

interface Snapshot {
  list: string[];
  orphans: string[];
}

/** The hook result under test, captured from inside the harness so the test
 * bodies can call `create`/`remove`/… and read `list`/`orphans`.
 *
 * A holder object, the same shape `ChapterView.test.tsx` uses for its mock
 * state. Stated plainly because it would be easy to assume otherwise: this
 * does NOT silence oxlint — capturing anything out of a render is what the
 * `react` rules object to, and the holder only changes which of them fires
 * (`globals` → `immutability`). It is kept because one named holder is
 * clearer about what is being smuggled out of the component than a bare
 * reassigned `let`, not because it satisfies the linter. */
const hook = { api: null as unknown as UseAnnotationsResult };
let snapshots: Snapshot[];

/**
 * Stands in for `ChapterView`: owns a `<div>` React never gives children to,
 * sets the chapter's HTML into it imperatively, and bumps a revision counter
 * so the hook knows the content underneath it was replaced.
 */
function Harness({ html, courseId = 'c1', chapterId = 'ch1' }: { html: string; courseId?: string; chapterId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<ChapterContent>({ root: null, revision: 0 });

  const result = useAnnotations(courseId, chapterId, content);
  hook.api = result;
  snapshots.push({ list: result.list.map((r) => r.id), orphans: result.orphans.map((r) => r.id) });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    setContent((prev) => ({ root: el, revision: prev.revision + 1 }));
  }, [html, chapterId]);

  return <div ref={ref} data-testid="chapter" />;
}

/** The two-argument form the task brief names verbatim: no DOM, CRUD only. */
function CrudHarness() {
  hook.api = useAnnotations('c1', 'ch1');
  return null;
}

function chapterRoot(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-testid="chapter"]');
  if (!el) throw new Error('chapter root not rendered');
  return el;
}

function marksFor(id: string): HTMLElement[] {
  return Array.from(chapterRoot().querySelectorAll<HTMLElement>(`mark.ann[data-ann-id="${id}"]`));
}

function paintedText(id: string): string {
  return marksFor(id)
    .map((el) => el.textContent ?? '')
    .join('');
}

function shift(iso: string, ms: number): string {
  return new Date(Date.parse(iso) + ms).toISOString();
}

beforeEach(async () => {
  await clearLocalData();
  snapshots = [];
  document.body.innerHTML = '';
});

afterEach(async () => {
  await clearLocalData();
});

describe('useAnnotations — CRUD writes local + outbox in one go', () => {
  it('create() returns a crypto.randomUUID id and writes BOTH the Dexie row and an outbox entry whose row matches the server contract field-for-field', async () => {
    render(<CrudHarness />);
    const anchor = makeAnchor(CHAPTER, Q_FIRST_HALF, 'g');

    let id = '';
    await act(async () => {
      id = await hook.api.create(anchor, 'ghi chú của tôi');
    });

    expect(id).toMatch(UUID_RE);

    const row = await db.annotations.get(id);
    expect(row).toEqual({
      id,
      courseId: 'c1',
      chapterId: 'ch1',
      anchor,
      note: 'ghi chú của tôi',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      deletedAt: null,
    });
    // createdAt/updatedAt are the same instant on creation, and are the
    // instant of the EDIT — not of the eventual flush (see setProgress's own
    // doc comment for why that distinction is load-bearing for LWW).
    expect(row!.createdAt).toBe(row!.updatedAt);
    expect(Number.isNaN(Date.parse(row!.createdAt))).toBe(false);

    const entries = await db.outbox.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0].table).toBe('annotations');
    // Field-for-field against apps/api/internal/sync/handler.go's
    // `annotationItem`: a single renamed field here is a note that syncs and
    // then silently never appears on the other device.
    expect(Object.keys(entries[0].row as object).sort()).toEqual(SERVER_ANNOTATION_FIELDS);
    expect(entries[0].row).toEqual(row);
  });

  it('remove() sets a deletedAt tombstone (never deletes the row) and enqueues the tombstone', async () => {
    render(<CrudHarness />);
    const anchor = makeAnchor(CHAPTER, Q_FIRST_HALF);

    let id = '';
    await act(async () => {
      id = await hook.api.create(anchor, 'sắp xoá');
    });
    const before = await db.annotations.get(id);

    await act(async () => {
      await hook.api.remove(id);
    });

    const after = await db.annotations.get(id);
    expect(after).toBeDefined();
    expect(after!.deletedAt).not.toBeNull();
    expect(Date.parse(after!.deletedAt!)).toBeGreaterThanOrEqual(Date.parse(before!.updatedAt));
    // updatedAt must move too, or LWW on every other device keeps the live row.
    expect(Date.parse(after!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(before!.updatedAt));
    expect(after!.note).toBe('sắp xoá');
    expect(after!.createdAt).toBe(before!.createdAt);

    const entries = await db.outbox.toArray();
    expect(entries).toHaveLength(2);
    expect(entries[1].table).toBe('annotations');
    expect(entries[1].row).toEqual(after);
    expect(Object.keys(entries[1].row as object).sort()).toEqual(SERVER_ANNOTATION_FIELDS);
  });

  it('updateNote() rewrites the note, bumps updatedAt, keeps the anchor, and enqueues', async () => {
    render(<CrudHarness />);
    const anchor = makeAnchor(CHAPTER, Q_FIRST_HALF);

    let id = '';
    await act(async () => {
      id = await hook.api.create(anchor, 'bản nháp');
    });
    const before = await db.annotations.get(id);

    await act(async () => {
      await hook.api.updateNote(id, 'bản sửa');
    });

    const after = await db.annotations.get(id);
    expect(after!.note).toBe('bản sửa');
    expect(after!.anchor).toEqual(anchor);
    expect(after!.createdAt).toBe(before!.createdAt);
    expect(Date.parse(after!.updatedAt)).toBeGreaterThanOrEqual(Date.parse(before!.updatedAt));

    const entries = await db.outbox.toArray();
    expect(entries).toHaveLength(2);
    expect(entries[1].row).toEqual(after);
  });

  it('reattach() replaces the anchor, keeps note/createdAt, and enqueues', async () => {
    render(<CrudHarness />);
    const first = makeAnchor(CHAPTER, Q_FIRST_HALF);
    const second = makeAnchor(CHAPTER, Q_THIRD_PARA, 'b');

    let id = '';
    await act(async () => {
      id = await hook.api.create(first, 'nối lại');
    });

    await act(async () => {
      await hook.api.reattach(id, second);
    });

    const after = await db.annotations.get(id);
    expect(after!.anchor).toEqual(second);
    expect(after!.note).toBe('nối lại');
    expect(after!.deletedAt).toBeNull();

    const entries = await db.outbox.toArray();
    expect(entries).toHaveLength(2);
    expect(entries[1].row).toEqual(after);
  });

  it('every write leaves local row and outbox entry consistent — never one without the other', async () => {
    render(<CrudHarness />);
    const anchor = makeAnchor(CHAPTER, Q_FIRST_HALF);

    await act(async () => {
      const id = await hook.api.create(anchor, 'một');
      await hook.api.updateNote(id, 'hai');
      await hook.api.remove(id);
    });

    const rows = await db.annotations.toArray();
    const entries = await db.outbox.toArray();
    expect(rows).toHaveLength(1);
    expect(entries).toHaveLength(3);
    // The last queued row is always exactly what the local table holds now.
    expect(entries[2].row).toEqual(rows[0]);
    for (const entry of entries) {
      expect(entry.table).toBe('annotations');
      expect(Object.keys(entry.row as object).sort()).toEqual(SERVER_ANNOTATION_FIELDS);
    }
  });

  it('updateNote()/remove()/reattach() on an unknown id write nothing at all', async () => {
    render(<CrudHarness />);

    await act(async () => {
      await hook.api.updateNote('khong-ton-tai', 'x');
      await hook.api.remove('khong-ton-tai');
      await hook.api.reattach('khong-ton-tai', makeAnchor(CHAPTER, Q_FIRST_HALF));
    });

    expect(await db.annotations.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('useAnnotations — resolving and painting a chapter', () => {
  it('paints TWO OVERLAPPING annotations in one pass (a naive resolve-then-paint loop throws StaleNormMapError here)', async () => {
    const a1 = makeAnchor(CHAPTER, Q_FIRST_HALF, 'y');
    const a2 = makeAnchor(CHAPTER, Q_SECOND_HALF, 'g');
    await seed({ id: 'a1', anchor: a1, createdAt: '2026-08-20T10:00:00.000Z' });
    await seed({ id: 'a2', anchor: a2, createdAt: '2026-08-20T10:00:01.000Z' });

    render(<Harness html={CHAPTER} />);

    await waitFor(() => expect(hook.api.list).toHaveLength(2));

    // Both are painted, and each covers exactly the words its anchor quotes —
    // the property a drifted live Range breaks silently.
    expect(paintedText('a1')).toBe(Q_FIRST_HALF);
    expect(paintedText('a2')).toBe(Q_SECOND_HALF);
    expect(marksFor('a1').length).toBeGreaterThan(0);
    expect(marksFor('a2').length).toBeGreaterThan(0);
    expect(marksFor('a1')[0].className).toBe('ann ann-y');
    expect(marksFor('a2')[0].className).toBe('ann ann-g');
    // The shared words carry BOTH ids (nested marks), which is what makes the
    // overlap read darker instead of one note winning.
    const shared = chapterRoot().querySelector('mark.ann[data-ann-id="a1"] mark.ann[data-ann-id="a2"]');
    expect(shared).not.toBeNull();
    // Painting must not change a single character of the chapter.
    expect(chapterRoot().textContent).toBe(CHAPTER.replace(/<[^>]+>/g, ''));
  });

  it('orders `list` by where each note appears in the chapter, not by creation time', async () => {
    // Seeded in reverse document order, with createdAt agreeing with the
    // seeding order, so a hook that just echoed insertion order would pass
    // every other assertion in this file and fail this one.
    await seed({ id: 'third', anchor: makeAnchor(CHAPTER, Q_THIRD_PARA), createdAt: '2026-08-20T10:00:00.000Z' });
    await seed({ id: 'first', anchor: makeAnchor(CHAPTER, Q_FIRST_HALF), createdAt: '2026-08-20T10:00:09.000Z' });

    render(<Harness html={CHAPTER} />);

    await waitFor(() => expect(hook.api.list).toHaveLength(2));
    expect(hook.api.list.map((r) => r.id)).toEqual(['first', 'third']);
  });

  it('a tombstoned annotation is neither listed nor painted', async () => {
    await seed({ id: 'gone', anchor: makeAnchor(CHAPTER, Q_FIRST_HALF), deletedAt: '2026-08-20T11:00:00.000Z' });
    await seed({ id: 'alive', anchor: makeAnchor(CHAPTER, Q_THIRD_PARA) });

    render(<Harness html={CHAPTER} />);

    await waitFor(() => expect(hook.api.list).toHaveLength(1));
    expect(hook.api.list[0].id).toBe('alive');
    expect(marksFor('gone')).toHaveLength(0);
  });

  it('annotations belonging to another chapter or course are ignored entirely', async () => {
    await seed({ id: 'mine', anchor: makeAnchor(CHAPTER, Q_FIRST_HALF) });
    await seed({ id: 'other-chapter', anchor: makeAnchor(CHAPTER, Q_THIRD_PARA), chapterId: 'ch2' });
    await seed({ id: 'other-course', anchor: makeAnchor(CHAPTER, Q_THIRD_PARA), courseId: 'c2' });

    render(<Harness html={CHAPTER} />);

    await waitFor(() => expect(hook.api.list).toHaveLength(1));
    expect(hook.api.list[0].id).toBe('mine');
    expect(marksFor('other-chapter')).toHaveLength(0);
    expect(marksFor('other-course')).toHaveLength(0);
  });
});

describe('useAnnotations — orphans are DATA, not rubbish', () => {
  it('an unresolvable anchor lands in `orphans`, is never deleted, never tombstoned, and never enqueued', async () => {
    await seed({ id: 'lost', anchor: makeAnchor(CHAPTER, Q_FIRST_HALF), note: 'ghi chú quý' });
    // Rendered content that contains none of the quote, none of its context.
    const unrelated = '<p>Một chương hoàn toàn khác, không có câu nào giống.</p>';

    render(<Harness html={unrelated} />);

    await waitFor(() => expect(hook.api.orphans).toHaveLength(1));
    expect(hook.api.orphans[0].id).toBe('lost');
    expect(hook.api.list).toHaveLength(0);

    const row = await db.annotations.get('lost');
    expect(row).toBeDefined();
    expect(row!.deletedAt).toBeNull();
    expect(row!.note).toBe('ghi chú quý');
    // Resolving is a READ. Nothing about a note failing to find its place is
    // a change to propagate to the server.
    expect(await db.outbox.count()).toBe(0);
  });

  it('an anchor whose quote is simply absent from THIS chapter is an orphan, while its neighbours still resolve', async () => {
    await seed({ id: 'ok', anchor: makeAnchor(CHAPTER, Q_FIRST_HALF) });
    await seed({ id: 'nope', anchor: makeAnchor(`<p>${Q_ABSENT} và thêm chữ.</p>`, Q_ABSENT) });

    render(<Harness html={CHAPTER} />);

    await waitFor(() => expect(hook.api.orphans).toHaveLength(1));
    expect(hook.api.orphans[0].id).toBe('nope');
    expect(hook.api.list.map((r) => r.id)).toEqual(['ok']);
  });

  it('reattach() moves a note out of `orphans` and paints it', async () => {
    await seed({ id: 'lost', anchor: makeAnchor(`<p>${Q_ABSENT} và thêm chữ.</p>`, Q_ABSENT) });

    render(<Harness html={CHAPTER} />);
    await waitFor(() => expect(hook.api.orphans).toHaveLength(1));

    await act(async () => {
      await hook.api.reattach('lost', makeAnchor(CHAPTER, Q_THIRD_PARA));
    });

    await waitFor(() => expect(hook.api.list).toHaveLength(1));
    expect(hook.api.orphans).toHaveLength(0);
    expect(paintedText('lost')).toBe(Q_THIRD_PARA);
  });
});

/**
 * These three own the deferral, and they run against a CONTROLLED idle
 * scheduler rather than against the clock.
 *
 * The first version of them asserted the ORDER of published React states: the
 * exact match must appear in an earlier commit than the fuzzy one. That is
 * true of what the hook does and still flaked — 1 failure in 34 full-suite
 * runs under 8-core saturation — because it silently also asserts that React
 * scheduled a render BETWEEN the two publishes. React batches; when the
 * deferred task wins the race against React's own scheduler callback, both
 * publishes land in one commit and the "later commit" assertion fails even
 * though the fuzzy work genuinely happened in a later task.
 *
 * Installing `requestIdleCallback` (which jsdom does not have) makes the thing
 * under test observable directly instead: the deferred chunk cannot have run
 * until this file runs it. That removes the race, removes the dependence on
 * React's scheduler, AND exercises the `requestIdleCallback` branch of
 * `scheduleDeferred`, which the `setTimeout` fallback otherwise hides.
 */
describe('useAnnotations — the fuzzy tier is deferred past the first paint (ruling P2-F9)', () => {
  const idle = { next: 1, callbacks: new Map<number, () => void>() };
  let realRequest: unknown;
  let realCancel: unknown;

  beforeEach(() => {
    const scope = globalThis as unknown as Record<string, unknown>;
    realRequest = scope.requestIdleCallback;
    realCancel = scope.cancelIdleCallback;
    idle.next = 1;
    idle.callbacks = new Map();
    scope.requestIdleCallback = (cb: () => void) => {
      const handle = idle.next++;
      idle.callbacks.set(handle, cb);
      return handle;
    };
    scope.cancelIdleCallback = (handle: number) => {
      idle.callbacks.delete(handle);
    };
  });

  afterEach(() => {
    const scope = globalThis as unknown as Record<string, unknown>;
    scope.requestIdleCallback = realRequest;
    scope.cancelIdleCallback = realCancel;
  });

  /** Runs exactly the chunks queued right now, and returns how many. A chunk
   * that queues the next one does NOT get run by the same call, which is what
   * makes "how many chunks did this take" a real measurement. */
  async function runIdleRound(): Promise<number> {
    const batch = Array.from(idle.callbacks.entries());
    for (const [handle] of batch) idle.callbacks.delete(handle);
    await act(async () => {
      for (const [, cb] of batch) cb();
    });
    return batch.length;
  }

  async function drainIdle(): Promise<number> {
    let rounds = 0;
    while (idle.callbacks.size > 0) {
      await runIdleRound();
      rounds++;
      if (rounds > 100) throw new Error('deferred queue never drained');
    }
    return rounds;
  }

  it('resolves the exact match inline and leaves the fuzzy one for an idle callback that has not run yet', async () => {
    await seed({ id: 'exact', anchor: makeAnchor(CHAPTER, Q_THIRD_PARA) });
    await seed({ id: 'fuzzy', anchor: makeAnchor(CHAPTER, Q_EDITED_PARA) });

    // The chapter as it is TODAY: one character of the quoted paragraph has
    // been edited since the note was taken, so 'fuzzy' misses the exact tier.
    render(<Harness html={CHAPTER_EDITED} />);

    await waitFor(() => expect(hook.api.list.map((r) => r.id)).toEqual(['exact']));

    // Nothing has run the deferred pass, so this is not "not yet" in a timing
    // sense — it is "cannot have happened".
    expect(paintedText('exact')).toBe(Q_THIRD_PARA);
    expect(marksFor('fuzzy')).toHaveLength(0);
    // ...and a chunk really is waiting, rather than the note having been
    // dropped on the floor.
    expect(idle.callbacks.size).toBe(1);

    const rounds = await drainIdle();

    expect(rounds).toBe(1);
    expect(hook.api.list.map((r) => r.id)).toEqual(['fuzzy', 'exact']);
    expect(hook.api.orphans).toHaveLength(0);
    expect(paintedText('fuzzy')).toBe(Q_EDITED_PARA.replace('ngắn', 'ngán'));
    expect(paintedText('exact')).toBe(Q_THIRD_PARA);
  });

  it('a note awaiting the fuzzy tier is in neither `list` nor `orphans` — it is not reported lost before it has been looked for', async () => {
    await seed({ id: 'exact', anchor: makeAnchor(CHAPTER, Q_THIRD_PARA) });
    await seed({ id: 'fuzzy', anchor: makeAnchor(CHAPTER, Q_EDITED_PARA) });

    render(<Harness html={CHAPTER_EDITED} />);

    await waitFor(() => expect(hook.api.list).toHaveLength(1));

    // The whole point: the orphan panel must not flash "your note lost its
    // place" about a note nobody has gone looking for yet.
    expect(hook.api.orphans).toHaveLength(0);
    for (const snapshot of snapshots) {
      expect(snapshot.orphans).not.toContain('fuzzy');
    }

    await drainIdle();

    expect(hook.api.orphans).toHaveLength(0);
    expect(hook.api.list.map((r) => r.id).sort()).toEqual(['exact', 'fuzzy']);
  });

  it('resolves EVERY deferred anchor — the fuzzy queue is worked to the end, across as many chunks as it takes', async () => {
    // MORE anchors than one deferred chunk may take (DEFERRED_CHUNK_MAX = 8),
    // so "keeps rescheduling until the queue is empty" is what is actually
    // being measured here rather than "they all happened to fit". A pass that
    // resolves one chunk and stops — the "just cap the fuzzy batch" shortcut
    // ruling P2-F9 forbids — leaves the last of these unresolved.
    const count = 12;
    const paragraphs: string[] = [];
    const quotes: string[] = [];
    for (let i = 0; i < count; i++) {
      const quote = `Đoạn văn số ${i} nói về dung lượng kênh và giới hạn dưới của độ dài mã trung bình.`;
      quotes.push(quote);
      paragraphs.push(`<p>${quote}</p>`);
    }
    const pristine = paragraphs.join('\n');
    const ids = quotes.map((_, i) => `f${String(i).padStart(2, '0')}`);
    for (let i = 0; i < count; i++) {
      await seed({ id: ids[i], anchor: makeAnchor(pristine, quotes[i]) });
    }
    // Every paragraph edited, in its MIDDLE: every anchor misses the exact
    // tier and has to go through the deferred one. Deliberately not an edit at
    // the paragraph's end — that would also corrupt the next anchor's stored
    // `prefix`, and for the LAST paragraph (whose `suffix` is empty) the
    // prefix is the only context `anchor.ts` has to propose a candidate from,
    // so it would legitimately orphan and this test would be measuring the
    // fuzzy tier's documented give-up rule instead of this file's queue.
    const edited = pristine.replaceAll('dung lượng kênh', 'dung luong kênh');

    render(<Harness html={edited} />);

    await waitFor(() => expect(idle.callbacks.size).toBe(1));
    expect(hook.api.list).toHaveLength(0);

    // First chunk: DEFERRED_CHUNK_MAX of them, not all twelve.
    await runIdleRound();
    expect(hook.api.list.length).toBeGreaterThan(0);
    expect(hook.api.list.length).toBeLessThan(count);
    // A capped implementation stops here, with four notes silently abandoned.
    expect(idle.callbacks.size).toBe(1);

    const moreRounds = await drainIdle();

    expect(moreRounds).toBeGreaterThanOrEqual(1);
    expect(hook.api.list.map((r) => r.id)).toEqual(ids);
    expect(hook.api.orphans).toHaveLength(0);
  });
});

describe('useAnnotations — React StrictMode double-invoke', () => {
  it('paints each annotation exactly once under a double-invoked effect', async () => {
    await seed({ id: 'a1', anchor: makeAnchor(CHAPTER, Q_FIRST_HALF) });
    await seed({ id: 'a2', anchor: makeAnchor(CHAPTER, Q_THIRD_PARA) });

    render(
      <StrictMode>
        <Harness html={CHAPTER} />
      </StrictMode>,
    );

    await waitFor(() => expect(hook.api.list).toHaveLength(2));

    expect(marksFor('a1')).toHaveLength(1);
    expect(marksFor('a2')).toHaveLength(1);
    expect(chapterRoot().querySelectorAll('mark.ann')).toHaveLength(2);
    // A second paint of the same id nests a mark inside a mark with the SAME
    // id — the specific shape a double-invoked effect produces.
    expect(chapterRoot().querySelector('mark.ann mark.ann[data-ann-id="a1"]')).toBeNull();
    expect(paintedText('a1')).toBe(Q_FIRST_HALF);
    expect(paintedText('a2')).toBe(Q_THIRD_PARA);
  });

  it('paints overlapping annotations exactly once each under StrictMode too', async () => {
    await seed({ id: 'a1', anchor: makeAnchor(CHAPTER, Q_FIRST_HALF), createdAt: '2026-08-20T10:00:00.000Z' });
    await seed({ id: 'a2', anchor: makeAnchor(CHAPTER, Q_SECOND_HALF), createdAt: '2026-08-20T10:00:01.000Z' });

    render(
      <StrictMode>
        <Harness html={CHAPTER} />
      </StrictMode>,
    );

    await waitFor(() => expect(hook.api.list).toHaveLength(2));

    expect(paintedText('a1')).toBe(Q_FIRST_HALF);
    expect(paintedText('a2')).toBe(Q_SECOND_HALF);
    expect(chapterRoot().querySelector('mark.ann[data-ann-id="a1"] mark.ann[data-ann-id="a1"]')).toBeNull();
    expect(chapterRoot().querySelector('mark.ann[data-ann-id="a2"] mark.ann[data-ann-id="a2"]')).toBeNull();
  });
});

describe('useAnnotations — keeping the painted DOM in step with the store', () => {
  it('remove() unpaints the highlight and puts the chapter text back exactly', async () => {
    const before = (() => {
      const scratch = document.createElement('div');
      scratch.innerHTML = CHAPTER;
      return scratch.innerHTML;
    })();
    await seed({ id: 'a1', anchor: makeAnchor(CHAPTER, Q_FIRST_HALF) });

    render(<Harness html={CHAPTER} />);
    await waitFor(() => expect(marksFor('a1').length).toBeGreaterThan(0));

    await act(async () => {
      await hook.api.remove('a1');
    });

    await waitFor(() => expect(marksFor('a1')).toHaveLength(0));
    expect(hook.api.list).toHaveLength(0);
    expect(chapterRoot().innerHTML).toBe(before);
  });

  it('a note created through create() is painted without re-painting the notes already on the page', async () => {
    await seed({ id: 'a1', anchor: makeAnchor(CHAPTER, Q_FIRST_HALF) });

    render(<Harness html={CHAPTER} />);
    await waitFor(() => expect(hook.api.list).toHaveLength(1));
    const firstMark = marksFor('a1')[0];

    await act(async () => {
      await hook.api.create(makeAnchor(CHAPTER, Q_THIRD_PARA, 'p'), 'thêm một');
    });

    await waitFor(() => expect(hook.api.list).toHaveLength(2));
    // The existing highlight is the SAME element — it was never unpainted and
    // re-painted, which is what would double-wrap it or drop its identity.
    expect(marksFor('a1')[0]).toBe(firstMark);
    expect(marksFor('a1')).toHaveLength(1);
    expect(hook.api.list.map((r) => r.id)).toEqual(['a1', hook.api.list[1].id]);
  });

  it('updateNote() leaves the painted highlight untouched (same element, no repaint)', async () => {
    await seed({ id: 'a1', anchor: makeAnchor(CHAPTER, Q_FIRST_HALF), note: 'cũ' });

    render(<Harness html={CHAPTER} />);
    await waitFor(() => expect(hook.api.list).toHaveLength(1));
    const firstMark = marksFor('a1')[0];

    await act(async () => {
      await hook.api.updateNote('a1', 'mới');
    });

    await waitFor(() => expect(hook.api.list[0].note).toBe('mới'));
    expect(marksFor('a1')[0]).toBe(firstMark);
    expect(marksFor('a1')).toHaveLength(1);
  });

  it('a row arriving from another device merges by updatedAt (LWW) and the hook shows the merged result', async () => {
    render(<Harness html={CHAPTER} />);
    const anchor = makeAnchor(CHAPTER, Q_FIRST_HALF);

    let id = '';
    await act(async () => {
      id = await hook.api.create(anchor, 'bản của máy này');
    });
    await waitFor(() => expect(hook.api.list).toHaveLength(1));

    const local = (await db.annotations.get(id))!;

    // Newer remote row wins — applied exactly the way sync/engine.ts's pull()
    // applies it, through the same mergeRow.
    const newer: AnnotationRow = { ...local, note: 'bản của máy kia', updatedAt: shift(local.updatedAt, 1000) };
    await act(async () => {
      await db.annotations.put(mergeRow(local, newer));
    });
    await waitFor(() => expect(hook.api.list[0].note).toBe('bản của máy kia'));

    // Older remote row loses, and nothing about the painted highlight changes.
    const older: AnnotationRow = { ...local, note: 'bản cũ hơn', updatedAt: shift(local.updatedAt, -1000) };
    await act(async () => {
      const current = (await db.annotations.get(id))!;
      await db.annotations.put(mergeRow(current, older));
    });
    expect((await db.annotations.get(id))!.note).toBe('bản của máy kia');
    expect(marksFor(id)).toHaveLength(1);
  });

  it('changing chapter repaints against the new content and never carries the old chapter\'s notes over', async () => {
    const other = '<p>Chương hai nói về mã hoá nguồn và cây Huffman.</p>';
    await seed({ id: 'in-ch1', anchor: makeAnchor(CHAPTER, Q_FIRST_HALF), chapterId: 'ch1' });
    await seed({ id: 'in-ch2', anchor: makeAnchor(other, 'mã hoá nguồn và cây Huffman'), chapterId: 'ch2' });

    const view = render(<Harness html={CHAPTER} chapterId="ch1" />);
    await waitFor(() => expect(hook.api.list.map((r) => r.id)).toEqual(['in-ch1']));

    view.rerender(<Harness html={other} chapterId="ch2" />);

    await waitFor(() => expect(hook.api.list.map((r) => r.id)).toEqual(['in-ch2']));
    expect(marksFor('in-ch1')).toHaveLength(0);
    expect(paintedText('in-ch2')).toBe('mã hoá nguồn và cây Huffman');
  });

  it('rebuilds the NormMap when the content is replaced, even when the previous chapter painted nothing', async () => {
    // The dangerous shape, and the reason this test exists next to the one
    // above: chapter one's only note ORPHANS, so a `NormMap` was built for it
    // and no paint ever invalidated it. A hook that keys its cached map on
    // anything less than the content revision keeps that map — every tracked
    // text node still holds the character count it recorded (they are merely
    // detached now, which `isMapStale` deliberately does not detect), so
    // nothing throws and chapter two's notes silently resolve against the
    // text of chapter one and are painted into a tree nobody can see.
    const other = '<p>Chương hai nói về mã hoá nguồn và cây Huffman.</p>';
    await seed({ id: 'orphan-ch1', anchor: makeAnchor(`<p>${Q_ABSENT} và thêm chữ.</p>`, Q_ABSENT), chapterId: 'ch1' });
    await seed({ id: 'in-ch2', anchor: makeAnchor(other, 'mã hoá nguồn và cây Huffman'), chapterId: 'ch2' });

    const view = render(<Harness html={CHAPTER} chapterId="ch1" />);
    await waitFor(() => expect(hook.api.orphans.map((r) => r.id)).toEqual(['orphan-ch1']));
    expect(chapterRoot().querySelectorAll('mark.ann')).toHaveLength(0);

    view.rerender(<Harness html={other} chapterId="ch2" />);

    await waitFor(() => expect(hook.api.list.map((r) => r.id)).toEqual(['in-ch2']));
    expect(paintedText('in-ch2')).toBe('mã hoá nguồn và cây Huffman');
  });
});

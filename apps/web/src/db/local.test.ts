import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearLocalData, db, mergeRow, setProgress, type ProgressRow } from './local';

async function clearAll() {
  await clearLocalData();
}

beforeEach(clearAll);
afterEach(clearAll);

describe('mergeRow (pure LWW)', () => {
  // The four cases the brief names verbatim: incoming newer / incoming
  // older / equal timestamps / local absent.
  it('incoming strictly newer than local wins', () => {
    const local: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: false, updatedAt: '2026-08-20T10:00:00.000Z' };
    const incoming: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:01.000Z' };
    expect(mergeRow(local, incoming)).toEqual(incoming);
  });

  it('incoming strictly older than local loses — local is kept unchanged', () => {
    const local: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:05.000Z' };
    const incoming: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: false, updatedAt: '2026-08-20T10:00:01.000Z' };
    expect(mergeRow(local, incoming)).toEqual(local);
  });

  it('equal updatedAt: local wins (strictly-greater required to overwrite, per server LWW)', () => {
    const local: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' };
    // Same instant, different object identity/fields — simulates the exact
    // re-delivery scenario the safety-lagged cursor guarantees will happen.
    const incoming: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: false, updatedAt: '2026-08-20T10:00:00.000Z' };
    expect(mergeRow(local, incoming)).toEqual(local);
  });

  it('local absent (row never seen before) — incoming wins unconditionally', () => {
    const incoming: ProgressRow = { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' };
    expect(mergeRow(undefined, incoming)).toEqual(incoming);
  });

  // Go's RFC3339Nano formatter (see apps/api/internal/sync/handler.go's
  // timeLayout) trims TRAILING ZERO fractional digits, and drops the
  // fractional part (and its leading '.') ENTIRELY when a timestamp lands
  // on an exact whole second — e.g. "2026-08-20T10:00:00Z", no ".000000".
  // A naive `incoming.updatedAt > local.updatedAt` STRING comparison
  // breaks exactly here: '.' (0x2E) sorts below 'Z' (0x5A), so
  // "...:00.500Z" (500ms into the second) would lexicographically compare
  // as LESS than "...:00Z" (the exact second boundary, i.e. 0ms) even
  // though 500ms is chronologically LATER. mergeRow must compare parsed
  // instants (Date.parse), not raw strings, or this flips a real ordering
  // backwards and could apply a stale row as if it were newer.
  it('does not mis-order a fractional timestamp against a same-second whole-second timestamp (RFC3339Nano trimming)', () => {
    const local: ProgressRow = {
      courseId: 'c1',
      chapterId: 'ch1',
      status: 'read',
      done: true,
      updatedAt: '2026-08-20T10:00:00.500Z', // 500ms into the second — chronologically LATER
    };
    const incoming: ProgressRow = {
      courseId: 'c1',
      chapterId: 'ch1',
      status: 'read',
      done: false,
      updatedAt: '2026-08-20T10:00:00Z', // exact second boundary, i.e. 0ms — chronologically EARLIER, but a naive string compare would say it's greater ('Z' > '.')
    };
    // incoming is chronologically older, so it must lose — a naive string
    // comparison would (incorrectly) apply it.
    expect(mergeRow(local, incoming)).toEqual(local);

    // And the reverse direction must correctly apply the newer row.
    const olderLocal: ProgressRow = { ...local, done: false, updatedAt: '2026-08-20T10:00:00Z' };
    const newerIncoming: ProgressRow = { ...incoming, done: true, updatedAt: '2026-08-20T10:00:00.500Z' };
    expect(mergeRow(olderLocal, newerIncoming)).toEqual(newerIncoming);
  });

  it('applies the same rule to annotation rows (deletedAt tombstones are just another field, not special-cased)', () => {
    const local = {
      id: 'a1',
      courseId: 'c1',
      chapterId: 'ch1',
      anchor: { x: 1 },
      note: 'note',
      createdAt: '2026-08-20T09:00:00.000Z',
      updatedAt: '2026-08-20T09:00:00.000Z',
      deletedAt: null as string | null,
    };
    const tombstone = { ...local, updatedAt: '2026-08-20T09:05:00.000Z', deletedAt: '2026-08-20T09:05:00.000Z' };
    expect(mergeRow(local, tombstone)).toEqual(tombstone);

    // A replay of the SAME tombstone (identical updatedAt) must not
    // "resurrect" anything — it's already a no-op equal case.
    expect(mergeRow(tombstone, { ...tombstone })).toEqual(tombstone);

    // An OLDER, not-yet-deleted version replayed after the tombstone was
    // already applied locally must never resurrect the row.
    expect(mergeRow(tombstone, local)).toEqual(tombstone);
  });
});

describe('setProgress', () => {
  it('writes the progress row to db.progress with a client-generated updatedAt, and enqueues it in db.outbox', async () => {
    const before = Date.now();
    await setProgress('c1', 'ch1', 'read', true);
    const after = Date.now();

    const row = await db.progress.get(['c1', 'ch1', 'read']);
    expect(row).toBeDefined();
    expect(row).toMatchObject({ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true });
    const updatedAtMs = Date.parse(row!.updatedAt);
    expect(updatedAtMs).toBeGreaterThanOrEqual(before);
    expect(updatedAtMs).toBeLessThanOrEqual(after);

    const outboxRows = await db.outbox.toArray();
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].table).toBe('progress');
    expect(outboxRows[0].row).toEqual(row);
  });

  it('a second call for the same courseId+chapterId+status overwrites the local row in place (same PK) but adds a SECOND outbox entry', async () => {
    await setProgress('c1', 'ch1', 'read', false);
    await setProgress('c1', 'ch1', 'read', true);

    const rows = await db.progress.where({ courseId: 'c1', chapterId: 'ch1', status: 'read' }).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].done).toBe(true);

    const outboxRows = await db.outbox.toArray();
    expect(outboxRows).toHaveLength(2);
  });

  it('different status values for the same course/chapter are independent rows (PK includes status)', async () => {
    await setProgress('c1', 'ch1', 'read', true);
    await setProgress('c1', 'ch1', 'started', true);

    const rows = await db.progress.where({ courseId: 'c1', chapterId: 'ch1' }).toArray();
    expect(rows).toHaveLength(2);
  });
});

describe('clearLocalData', () => {
  it('empties every table in the schema, not a hand-maintained list of four', async () => {
    await db.progress.put({ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: '2026-08-20T10:00:00.000Z' });
    await db.annotations.put({
      id: '11111111-1111-4111-8111-111111111111',
      courseId: 'c1',
      chapterId: 'ch1',
      anchor: {},
      note: 'n',
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-20T10:00:00.000Z',
      deletedAt: null,
    });
    await db.outbox.add({ table: 'progress', row: {} });
    await db.meta.put({ key: 'syncCursor', value: '2026-08-20T10:00:00Z' });

    // Pre-condition: every table genuinely has something in it, so the
    // assertion below can't pass vacuously.
    const before = await Promise.all(db.tables.map((t) => t.count()));
    expect(before.every((n) => n > 0)).toBe(true);
    expect(db.tables).toHaveLength(4);

    await clearLocalData();

    const after = await Promise.all(db.tables.map((t) => t.count()));
    expect(after).toEqual(db.tables.map(() => 0));
  });
});

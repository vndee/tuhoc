import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearLocalData, db } from '../db/local';
import { useProgress } from './useProgress';

async function clearAll() {
  await clearLocalData();
}

beforeEach(clearAll);
afterEach(clearAll);

describe('useProgress — reading a chapter', () => {
  it('starts with isRead false for a chapter with no progress row', () => {
    const { result } = renderHook(() => useProgress('c1'));
    expect(result.current.isRead('ch1')).toBe(false);
  });

  it('toggleRead writes a local progress row AND enqueues it in the outbox (offline-first contract)', async () => {
    const { result } = renderHook(() => useProgress('c1'));

    act(() => {
      result.current.toggleRead('ch1');
    });

    await waitFor(() => expect(result.current.isRead('ch1')).toBe(true));

    const row = await db.progress.get(['c1', 'ch1', 'read']);
    expect(row).toMatchObject({ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true });

    const outboxRows = await db.outbox.toArray();
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toMatchObject({ table: 'progress', row: { courseId: 'c1', chapterId: 'ch1', status: 'read', done: true } });
  });

  it('toggling a second time marks the chapter unread again, with a SECOND outbox entry', async () => {
    const { result } = renderHook(() => useProgress('c1'));

    act(() => result.current.toggleRead('ch1'));
    await waitFor(() => expect(result.current.isRead('ch1')).toBe(true));

    act(() => result.current.toggleRead('ch1'));
    await waitFor(() => expect(result.current.isRead('ch1')).toBe(false));

    const outboxRows = await db.outbox.toArray();
    expect(outboxRows).toHaveLength(2);
    expect(outboxRows[1].row).toMatchObject({ done: false });
  });

  it('doneChapterIds reflects exactly the chapters marked read for THIS course, nothing else', async () => {
    const { result } = renderHook(() => useProgress('c1'));

    act(() => result.current.toggleRead('ch1'));
    act(() => result.current.toggleRead('ch2'));
    await waitFor(() => expect(result.current.doneChapterIds.has('ch1')).toBe(true));
    await waitFor(() => expect(result.current.doneChapterIds.has('ch2')).toBe(true));

    expect(result.current.doneChapterIds.size).toBe(2);
  });

  it('data is scoped by courseId: a progress row for a DIFFERENT course never leaks into isRead/doneChapterIds', async () => {
    await db.progress.put({ courseId: 'other-course', chapterId: 'ch1', status: 'read', done: true, updatedAt: new Date().toISOString() });

    const { result } = renderHook(() => useProgress('c1'));

    // Give the live query a tick to settle (it starts async).
    await waitFor(() => expect(result.current.isRead).toBeDefined());
    expect(result.current.isRead('ch1')).toBe(false);
    expect(result.current.doneChapterIds.has('ch1')).toBe(false);
  });

  it('reacts to a progress row written from OUTSIDE the hook (e.g. the sync engine pulling a remote update)', async () => {
    const { result } = renderHook(() => useProgress('c1'));
    expect(result.current.isRead('ch1')).toBe(false);

    await db.progress.put({ courseId: 'c1', chapterId: 'ch1', status: 'read', done: true, updatedAt: new Date().toISOString() });

    await waitFor(() => expect(result.current.isRead('ch1')).toBe(true));
  });
});

describe('useProgress — exercises', () => {
  it('exDone/toggleEx use the "ex:<n>" status string, independent per exercise index', async () => {
    const { result } = renderHook(() => useProgress('c1'));

    act(() => result.current.toggleEx('ch1', 0));
    await waitFor(() => expect(result.current.exDone('ch1', 0)).toBe(true));
    expect(result.current.exDone('ch1', 1)).toBe(false);

    const row = await db.progress.get(['c1', 'ch1', 'ex:0']);
    expect(row).toMatchObject({ status: 'ex:0', done: true });
  });

  it('toggling exercise n does not affect chapter isRead, and vice versa', async () => {
    const { result } = renderHook(() => useProgress('c1'));

    act(() => result.current.toggleEx('ch1', 0));
    await waitFor(() => expect(result.current.exDone('ch1', 0)).toBe(true));
    expect(result.current.isRead('ch1')).toBe(false);

    act(() => result.current.toggleRead('ch1'));
    await waitFor(() => expect(result.current.isRead('ch1')).toBe(true));
    expect(result.current.exDone('ch1', 0)).toBe(true);
  });
});

describe('useProgress — partStats', () => {
  it('counts distinct read chapters and distinct done exercises correctly across toggles', async () => {
    const { result } = renderHook(() => useProgress('c1'));

    expect(result.current.partStats).toEqual({ chaptersRead: 0, exercisesDone: 0 });

    act(() => result.current.toggleRead('ch1'));
    act(() => result.current.toggleRead('ch2'));
    act(() => result.current.toggleEx('ch1', 0));
    act(() => result.current.toggleEx('ch1', 1));

    await waitFor(() => expect(result.current.partStats).toEqual({ chaptersRead: 2, exercisesDone: 2 }));

    // Un-mark one chapter and one exercise — counts must go back down, not just up.
    act(() => result.current.toggleRead('ch2'));
    act(() => result.current.toggleEx('ch1', 0));

    await waitFor(() => expect(result.current.partStats).toEqual({ chaptersRead: 1, exercisesDone: 1 }));
  });

  it('does not count a different course\'s rows toward this hook instance\'s partStats', async () => {
    await db.progress.put({ courseId: 'other-course', chapterId: 'chX', status: 'read', done: true, updatedAt: new Date().toISOString() });

    const { result } = renderHook(() => useProgress('c1'));
    act(() => result.current.toggleRead('ch1'));

    await waitFor(() => expect(result.current.partStats.chaptersRead).toBe(1));
  });
});

describe('useProgress — stable action identities', () => {
  it('toggleRead/toggleEx/isRead/exDone keep the same function identity across re-renders (safe as an effect dependency)', () => {
    const { result, rerender } = renderHook(() => useProgress('c1'));
    const first = result.current;
    rerender();
    const second = result.current;

    expect(second.toggleRead).toBe(first.toggleRead);
    expect(second.toggleEx).toBe(first.toggleEx);
    expect(second.isRead).toBe(first.isRead);
    expect(second.exDone).toBe(first.exDone);
  });
});

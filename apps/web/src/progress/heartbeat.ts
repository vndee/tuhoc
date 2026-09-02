import { queueEvent } from '../api/events';

/** The chapter this device currently considers "open," as `getCtx()` reports it at the moment of a given tick — not necessarily the chapter that was open when `startHeartbeat` was first called. See `startHeartbeat`'s own doc comment for why that distinction matters. */
export interface HeartbeatCtx {
  courseId: string;
  chapterId: string;
}

/** Binding requirement's fixed cadence — must match apps/api/internal/stats/handler.go's `minutesPerHeartbeat` comment ("the client emits one heartbeat every 30 seconds ... each heartbeat represents exactly half a minute"). Changing this number on the client without changing the server's conversion would silently miscount every user's study time. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Binding requirement's activity recency window — see the design-decision comment above `startHeartbeat` for the trade-off this specific number encodes. */
const ACTIVITY_WINDOW_MS = 60_000;

/** The three input signals the binding requirement names as "activity": pointer, key, or scroll. Deliberately NOT mouse `mousemove` — the task brief lists exactly these three, and `mousemove` fires continuously just from resting a hand near the trackpad, which would make the activity gate nearly meaningless (see this file's own doc comment on the activity-window trade-off for the general spirit: this gate exists to distinguish "present and doing something" from "tab merely open," and a signal that fires without any deliberate action defeats that). */
const ACTIVITY_EVENT_TYPES = ['pointerdown', 'keydown', 'scroll'] as const;

/**
 * Starts the study heartbeat: every 30 seconds, if the tab is visible
 * AND there has been pointer/key/scroll activity within the last 60
 * seconds, queues one `{kind:'heartbeat'}` event for whatever chapter
 * `getCtx()` currently reports. Returns a teardown function that clears
 * the interval and removes the activity listeners — callers (the reader)
 * MUST call it on unmount, the same discipline `src/sync/engine.ts`'s
 * `startSync`/`stopSync` pair is held to: a heartbeat that keeps ticking
 * after the reader unmounts would attribute study time to a chapter
 * nobody is reading.
 *
 * Unlike `startSync`, this is NOT a module-level singleton — every piece
 * of state (`lastActivityAt`, the interval handle, the listener
 * references) lives in this call's own closure, not in module scope.
 * There is exactly one call site (`ChapterView`'s mount effect) today,
 * but nothing here would break if there were more than one: each
 * `startHeartbeat()` call is fully independent and its own teardown
 * releases exactly what IT registered, so React StrictMode's
 * mount→cleanup→mount double-invoke in dev is harmless without needing
 * `startSync`'s "second call is a no-op" idempotency guard.
 *
 * --- Judgment calls (Task 15 brief asks these to be decided
 * deliberately, not silently) ---
 *
 * VISIBILITY: gated by reading `document.hidden` directly inside each
 * tick, not by also listening for `visibilitychange`. The Page
 * Visibility API is what a browser updates when a tab is backgrounded,
 * minimized, or the OS switches away from it — a laptop lid closing
 * normally triggers a system sleep, which pauses ALL JavaScript
 * execution (including this very timer) until it wakes, so there is
 * nothing this module needs to do differently for that case: a
 * suspended tab simply produces no ticks at all while asleep, and
 * `document.hidden` correctly reflects whatever the visibility state is
 * once execution resumes. A dedicated `visibilitychange` listener would
 * only be useful if this module wanted to react to a visibility change
 * BETWEEN ticks (e.g. flush something the instant a tab is hidden) —
 * nothing here needs that; checking the live property at the one moment
 * that matters (tick time) is simpler and cannot drift out of sync with
 * a separately-tracked boolean.
 *
 * ACTIVITY (the 60s window vs. "silent reading"): the task brief itself
 * poses the tension directly — a reader working through a dense proof
 * genuinely produces zero pointer/key/scroll input for minutes, and a
 * literal 60s window would stop crediting them well before they've
 * actually stopped studying. This implementation still uses the literal
 * 60s window the brief names as the BINDING requirement, not a redesign
 * of it — but the trade-off is deliberate, not accidental: false
 * negatives (undercounting a genuinely engaged silent reader) are judged
 * strictly less harmful than false positives (crediting a tab left open
 * on a second monitor for an hour) for a self-study dashboard whose
 * numbers exist to reflect and motivate real study time, not to be a
 * perfectly precise timer. A reader who pauses to think for over a
 * minute loses credit for that one 30s tick, not their whole session —
 * the very next scroll or keypress resumes counting on the following
 * tick, so the worst case is a modest undercount, never a stuck or
 * broken counter. Widening the window would trade this for the opposite,
 * worse failure mode (crediting idle time), which is why the literal
 * spec value is kept rather than loosened.
 *
 * IDEMPOTENCY (`at`): generated ONCE, at the moment a tick decides to
 * queue an event (`Date.now()`, captured into a local `now` before
 * anything else runs), and stored directly into the queued `StudyEvent`
 * — never regenerated later. This mirrors `setProgress`'s `updatedAt` in
 * src/db/local.ts exactly, for the same reason: `../api/events.ts`'s
 * `flushEvents` resends a failed batch's events VERBATIM on the next
 * attempt (see that module's own doc on why a failed flush keeps its
 * events rather than dropping them), so `at` MUST be stable across those
 * retries for the server's `(user_id, course_id, chapter_id, kind, at)`
 * dedupe key to actually recognize a retried batch as "the same event"
 * rather than minting a fresh row (and fresh minutes) on every retry. A
 * DIFFERENT tick, 30 real seconds later, naturally gets a DIFFERENT
 * `at` (millisecond-resolution `Date.now()`, ticks spaced 30s apart) —
 * so genuinely distinct heartbeats are never accidentally deduped
 * against each other either.
 *
 * CHAPTER ATTRIBUTION: `getCtx()` is called fresh INSIDE `tick()`, once
 * per firing — never captured once when `startHeartbeat` is first
 * called. This is exactly why the binding interface takes a getter
 * function rather than a plain `{courseId, chapterId}` value: the reader
 * can navigate to a different chapter between two ticks (`ChapterView`
 * is reused across chapter navigation within one course, not
 * remounted — ChapterView.test.tsx's own
 * "navigating between chapters does not accumulate REDRAWS entries" test
 * proves this via `rerender`, not a fresh `render`), and each tick must
 * be attributed to whichever chapter is open AT THAT TICK, not whichever
 * one happened to be open when the interval was first started minutes
 * or chapters ago.
 */
export function startHeartbeat(getCtx: () => HeartbeatCtx | null): () => void {
  // No activity has been observed yet — deliberately NOT `Date.now()`
  // (which would silently treat "just mounted" as "just active," letting
  // a tab that's opened and immediately abandoned still bank one free
  // heartbeat before genuine inactivity kicks in). Only a real
  // pointerdown/keydown/scroll should ever move this forward.
  let lastActivityAt = Number.NEGATIVE_INFINITY;

  const markActivity = () => {
    lastActivityAt = Date.now();
  };
  for (const type of ACTIVITY_EVENT_TYPES) {
    window.addEventListener(type, markActivity, { passive: true });
  }

  const tick = () => {
    if (document.hidden) return;

    const now = Date.now();
    if (now - lastActivityAt > ACTIVITY_WINDOW_MS) return;

    const ctx = getCtx();
    if (ctx === null) return;

    // `queueEvent` is synchronous and never touches the network — it only
    // appends to `../api/events.ts`'s in-memory queue, which
    // `startEventFlusher` (mounted in App.tsx next to `startSync()`)
    // drains on its own slower cadence. Unlike the pre-Task-8 `db.outbox
    // .add(...)` this replaced, there is no promise here to reject and
    // nothing to catch.
    queueEvent({
      courseId: ctx.courseId,
      chapterId: ctx.chapterId,
      kind: 'heartbeat',
      meta: {},
      at: new Date(now).toISOString(),
    });
  };

  const timer = setInterval(tick, HEARTBEAT_INTERVAL_MS);

  return () => {
    clearInterval(timer);
    for (const type of ACTIVITY_EVENT_TYPES) {
      window.removeEventListener(type, markActivity);
    }
  };
}

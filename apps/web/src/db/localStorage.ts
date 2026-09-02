/**
 * `localStorage` — the ONE local store left after Task 10 removed Dexie
 * (`db/local.ts`, `sync/engine.ts`). Everything below is a near-verbatim
 * carry-over of that file's `localStorage` half: the classification
 * mechanism it built is the load-bearing part, and it did not change shape
 * just because the OTHER local store (Dexie) it used to share a file with
 * is gone.
 */

/**
 * Keys holding the USER'S OWN WORDS. `clearUserContent()` deletes every one
 * of them, because these are their content, not their settings.
 *
 * Currently one entry, and the reason it exists is worth keeping in view:
 * Chromium discards IndexedDB transactions opened during a same-tab
 * navigation, so the note being typed was measurably lost at 0 ms and at
 * 400 ms after F5 (see `annotations/MarginCards.tsx`'s `DRAFT_KEY` for the
 * measurement). The draft is therefore stamped into `localStorage`
 * synchronously on every keystroke. That decision stands. What it also
 * created was a SECOND store of user content, which this list is here to
 * keep attached to the one place that empties them.
 */
export const USER_CONTENT_KEYS = ['itbook-note-draft'] as const;

/**
 * Keys describing this DEVICE, not this person. `clearUserContent()` leaves
 * them alone, deliberately.
 *
 * Signing in as somebody else is not a request to change the lighting: a
 * shared laptop that flipped back to a blinding white page on every
 * handover would be a worse app, and there is nothing private in "dark".
 * The line this list draws is CONTENT vs PREFERENCE, and drawing it
 * explicitly is the point — the alternative, `localStorage.clear()`, is a
 * one-liner that quietly gets the theme wrong and can never be argued
 * with, because it does not know what it is deleting.
 *
 * `index.html` also reads `itbook-theme`, in an inline bootstrap script
 * that runs before any module loads (that is what prevents a flash of the
 * wrong palette). It cannot import this constant; `localStorage.test.ts`
 * pins the two together instead.
 *
 * `itbook-lang` (subsystem 3, Task 4) is the second entry and lands on this
 * side of the line for the same reason: the interface language is a property
 * of the person reading this screen right now, not of the account they are
 * signed into. A shared laptop that flipped back to Vietnamese every time
 * somebody signed in would be worse, and there is nothing private in "en".
 *
 * It is also the answer to "remember the choice PER DEVICE, do not sync it":
 * this list is exactly the set of keys `clearUserContent()` leaves alone.
 */
export const DEVICE_PREFERENCE_KEYS = ['itbook-theme', 'itbook-lang'] as const;

/**
 * Every `localStorage` key this app is allowed to touch.
 *
 * This union is the compile-time half of the "no third store" guard:
 * `readLocalStorage`/`writeLocalStorage` accept nothing else, so a new key
 * cannot be written without first being classified as content or
 * preference above — and classifying it as content wires it into
 * `clearUserContent()` in the same edit. `bunx tsc -b` is a gate, so this is
 * enforced, not advisory.
 *
 * The runtime half (nothing may bypass these functions and reach
 * `localStorage` directly) is pinned by `localStorage.test.ts`'s
 * `PERSISTENCE` scan. Task 11 (Pha 3) removed the one exception this used
 * to name — `auth/session.ts`'s offline-read marker, a session-lifecycle
 * value that was neither user content nor a device preference. Its one
 * reader (`<RequireAuth>`'s offline branch) is gone, and with it the last
 * reason anything outside this file touched `localStorage` directly.
 */
export type LocalStorageKey = (typeof USER_CONTENT_KEYS)[number] | (typeof DEVICE_PREFERENCE_KEYS)[number];

/**
 * `localStorage` throws in private mode and wherever storage is disabled,
 * and a reader whose browser refuses it should still get a working app —
 * just without the persistence. Both accessors swallow that, which is what
 * every call site used to do for itself.
 */
export function readLocalStorage(key: LocalStorageKey): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Writes `value`, or removes the key when `value` is `null`. */
export function writeLocalStorage(key: LocalStorageKey, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Best-effort: see `readLocalStorage`.
  }
}

/**
 * Empties every `localStorage` key holding the user's own content — the
 * `localStorage` half of `auth/session.ts`'s `clearSession()`, which is now
 * the single, authoritative "this browser now belongs to nobody / to
 * somebody else" operation (Dexie, and the four-table clear this function
 * used to also perform as `clearLocalData()`, left with `db/local.ts` in
 * Task 10 — there is no local table left to empty).
 *
 * Synchronous, unlike the `clearLocalData()` this replaces: `localStorage`
 * is synchronous by nature, and the only reason the old function was
 * `async` was the Dexie table clear it used to do alongside this. Nothing
 * about clearing a handful of `localStorage` keys ever needed a Promise.
 *
 * Enumerating `USER_CONTENT_KEYS` rather than calling `localStorage.clear()`
 * is the whole point: a key added to that list is cleared here
 * automatically, and a key that is NOT user content (an extension's, a
 * different app's, `not-ours` in `localStorage.test.ts`'s own fixture) is
 * left standing, because deleting what this app did not write is not
 * tidying, it is breaking someone else's software.
 *
 * Call sites — both auth transitions, in both directions, through the one
 * door at `auth/session.ts`'s `clearSession()`: sign-out (the departing
 * user's words must not outlive their session) and sign-in (the ARRIVING
 * user must not inherit whatever the previous one left typed and unsaved).
 */
export function clearUserContent(): void {
  for (const key of USER_CONTENT_KEYS) writeLocalStorage(key, null);
}

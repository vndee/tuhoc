import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * How long a `waitFor`/`findBy*` may keep asking before it gives up.
 *
 * This is a HARNESS BUDGET, not an assertion — the same distinction ruling
 * P2-F16 drew for `vite.config.ts`'s `testTimeout`, and the same one
 * `Dashboard.test.tsx` already wrote down at length when it set this exact
 * number file-locally. It is repeated here for one reason: that file's own
 * closing argument turned out to apply one level up as well.
 *
 * Dashboard.test.tsx says a wait that survives today is safe "do THỨ TỰ,
 * không phải do bản chất" — safe by ordering, not by nature — and so applies
 * its budget to all six of its tests rather than to the one that happened to
 * lose. Exactly the same is true ACROSS files: nothing makes Dashboard's
 * Dexie→liveQuery→commit chain special. Every suite here waits on the same
 * shape of chain, and every one of them was still on RTL's 1000 ms default.
 *
 * Measured, gate-close round, 8 full-suite runs against 20 busy-loop
 * processes on 8 cores (load average 88–120 — the acceptance run that went
 * red reported load 32, so this is that condition made worse on purpose):
 *
 *     3 of 8 runs red; the losers were three DIFFERENT tests in three
 *     different files —
 *       annotations/SelectionToolbar.test.tsx  "HAI ghi chú liên tiếp"
 *       reader/ChapterView.test.tsx            "gắn lại qua giao diện thật"
 *       annotations/painter.test.ts            (a testTimeout, see that file)
 *
 * Two of those three are this budget, and which test draws the short straw
 * is luck. That is the signature of a suite-wide ceiling, not of a defect in
 * any one test, and it is why the fix belongs in the shared setup file.
 *
 * Why raising it weakens nothing — the argument is Dashboard.test.tsx's,
 * unchanged: `waitFor`/`findBy*` are MutationObserver-driven and answer the
 * instant the DOM satisfies them, so this number is only the moment they
 * stop asking. A genuinely broken screen still fails, on the SAME assertion
 * with the SAME message, just later. Nothing in this suite asserts that a
 * wait *expires* (checked: no `.rejects` anywhere on a `waitFor`/`findBy*` —
 * the `.rejects` in `course/loader.test.ts` and `api/client.test.ts` are on
 * plain API promises, which this does not touch), so no test can pass
 * because of a longer wait that would have failed with a shorter one.
 *
 * It must stay comfortably below `vite.config.ts`'s `testTimeout` (30 s), or
 * a wait that legitimately expires gets cut off by the test clock first and
 * reports a useless "Test timed out" in place of the real assertion.
 */
const OVERSUBSCRIBED_WAIT_MS = 15_000;
configure({ asyncUtilTimeout: OVERSUBSCRIBED_WAIT_MS });

/**
 * jsdom (this project's `test.environment`) implements no IndexedDB at all
 * — `window.indexedDB` is simply `undefined`.
 *
 * Task 13 through Task 9 (Pha 3) needed this because the local store
 * (`src/db/local.ts`) was a Dexie database, and Dexie throws synchronously
 * at `new Dexie(...)` time if the global is missing. Task 10 removed Dexie
 * entirely — but `db/legacyDrain.ts`'s one-time drain of an old build's
 * leftover Dexie database talks to raw `indexedDB` directly (`indexedDB.
 * open`/`.databases()`/`.deleteDatabase`), and its own test file
 * (`db/legacyDrain.test.ts`) needs the same global to seed a fixture
 * database. So the need outlived the dependency that originally justified
 * it, and the shim stays for a narrower reason than it started with.
 *
 * `fake-indexeddb/auto` installs a spec-compliant in-memory IndexedDB
 * implementation onto `globalThis` as a side effect of being imported; it
 * must run before any test file touches `indexedDB`, which is exactly what
 * a shared `setupFiles` entry (run once, before every test file is loaded)
 * guarantees. Real browsers all have IndexedDB natively, so this is a
 * test-runtime-only shim, same rationale as the MemoryStorage patch below
 * for localStorage.
 */
import 'fake-indexeddb/auto';

/**
 * Bun ships its own global `localStorage` (backed by SQLite, gated behind
 * `--localstorage-file`), and when vitest's jsdom environment runs inside a
 * Bun-spawned worker (`bun run test`), that global leaks onto
 * `window`/`globalThis` in place of jsdom's own Storage implementation —
 * the resulting object is missing getItem/setItem/removeItem/clear
 * entirely, and merely *reading* it prints a `--localstorage-file` warning
 * to stderr. This is a test-runtime artifact only: real browsers (dev/prod
 * build) always have a working localStorage.
 *
 * Fix: install a small compliant in-memory Storage unconditionally, before
 * anything probes the existing (broken) accessor — probing it is exactly
 * what triggers the warning. This also gives every test file an isolated,
 * clean store, which is what you want in tests regardless.
 */
class MemoryStorage implements Storage {
  #store = new Map<string, string>();

  get length() {
    return this.#store.size;
  }
  clear() {
    this.#store.clear();
  }
  getItem(key: string) {
    return this.#store.has(key) ? this.#store.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.#store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.#store.delete(key);
  }
  setItem(key: string, value: string) {
    this.#store.set(key, String(value));
  }
}

for (const target of [globalThis, window] as const) {
  Object.defineProperty(target, 'localStorage', {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
});

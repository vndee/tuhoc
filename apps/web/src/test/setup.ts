import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * jsdom (this project's `test.environment`) implements no IndexedDB at all
 * — `window.indexedDB` is simply `undefined` — but Task 13's local store
 * (`src/db/local.ts`) is a Dexie database, and Dexie throws synchronously
 * at `new Dexie(...)` time if the global is missing. `fake-indexeddb/auto`
 * installs a spec-compliant in-memory IndexedDB implementation onto
 * `globalThis` as a side effect of being imported; it must run before any
 * test file's `import { db } from '../db/local'` does, which is exactly
 * what a shared `setupFiles` entry (run once, before every test file is
 * loaded) guarantees. Real browsers all have IndexedDB natively, so this
 * is a test-runtime-only shim, same rationale as the MemoryStorage patch
 * below for localStorage.
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

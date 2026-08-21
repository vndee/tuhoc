/**
 * The two `node:fs` functions the **tests** use, declared by hand.
 *
 * `src/env.d.ts` explains why this package refuses `"types": ["node"]`: the
 * shipped modules must compile for the browser too, so a Node global would be a
 * compile-time promise the runtime cannot keep. That argument is about SHIPPED
 * code. `zip.test.ts` runs only under vitest, which runs only in Node, and it
 * has to read the real 46-file course package off disk — a fixture that cannot
 * be inlined and must not be a hand-made imitation, because imitations are how
 * six wrong measurements got into this project.
 *
 * The hole this opens: an ambient module declaration is visible to every file in
 * the project, so `zip.ts` or `validate.ts` could import `node:fs` and still
 * compile. That hole is closed from the outside — `zip.test.ts` reads its own
 * sibling sources and asserts neither of them imports `node:`.
 *
 * Only the members the tests actually call are declared, so reaching for
 * anything wider fails here first.
 */

declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readdirSync(path: string): string[];
}

/**
 * The two WHATWG Encoding globals this package uses, declared by hand.
 *
 * Why not just widen `lib`/`types` in `tsconfig.json`:
 * - `"lib": [... "DOM"]` would also hand this code `document`, `window` and
 *   `DOMParser`. This package runs in Node too (the packaging CLI, registry
 *   CI), so every one of those would be a compile-time promise the runtime
 *   cannot keep — and `DOMParser` in particular is the exact temptation the
 *   text-scanning design exists to refuse.
 * - `"types": ["node"]` would be the mirror-image lie for the browser build.
 *
 * `TextEncoder`/`TextDecoder` are the narrow intersection: WHATWG Encoding,
 * present in every browser and in Node since v11. Declaring only them keeps the
 * compiler's view of the world exactly as small as the runtime's.
 *
 * Only the members actually used are declared, so reaching for anything wider
 * fails here first.
 */

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(input?: Uint8Array): string;
}

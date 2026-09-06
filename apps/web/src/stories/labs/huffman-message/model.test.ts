import { describe, expect, it } from 'vitest';

import { encodeHuffman } from './codec';
import { visibleHuffmanMerges } from './model';

describe('visibleHuffmanMerges', () => {
  it('returns a clamped prefix without changing the packet merge history', () => {
    const encoded = encodeHuffman([65, 66, 67, 68]);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const original = structuredClone(encoded.value.merges);

    expect(visibleHuffmanMerges(encoded.value, -10)).toEqual([]);
    expect(visibleHuffmanMerges(encoded.value, 0)).toEqual([]);
    expect(visibleHuffmanMerges(encoded.value, 1)).toEqual([
      { left: 0, right: 1, parent: 4 },
    ]);
    expect(visibleHuffmanMerges(encoded.value, 2)).toEqual([
      { left: 0, right: 1, parent: 4 },
      { left: 2, right: 3, parent: 5 },
    ]);
    expect(visibleHuffmanMerges(encoded.value, 99)).toEqual(original);
    expect(encoded.value.merges).toEqual(original);
  });

  it('keeps the single-symbol construction meaningful with no synthetic merge', () => {
    const encoded = encodeHuffman([65, 65, 65, 65]);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;

    expect(visibleHuffmanMerges(encoded.value, 1)).toEqual([]);
    expect(encoded.value.nodes).toEqual([
      { id: 0, count: 4, minByte: 65, byte: 65, left: null, right: null },
    ]);
  });
});

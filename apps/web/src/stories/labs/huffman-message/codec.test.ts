import { describe, expect, it } from 'vitest';

import { decodeHuffman, encodeHuffman } from './codec';

const fourEqualPacket = [
  0, 4, 0, 4, 0, 0, 0, 8,
  65, 0, 1, 66, 0, 1, 67, 0, 1, 68, 0, 1,
  27,
];

describe('encodeHuffman', () => {
  it('encodes the single-symbol teaching vector with code 0 and full accounting', () => {
    const result = encodeHuffman([65, 65, 65, 65]);

    expect(result).toEqual({
      ok: true,
      value: {
        container: [0, 1, 0, 4, 0, 0, 0, 4, 65, 0, 4, 0],
        payloadBits: 4,
        headerBits: 88,
        paddingBits: 4,
        totalBits: 96,
        nodes: [
          { id: 0, count: 4, minByte: 65, byte: 65, left: null, right: null },
        ],
        merges: [],
        codes: [{ byte: 65, count: 4, code: '0' }],
      },
    });
    if (result.ok) {
      expect(decodeHuffman(JSON.parse(JSON.stringify(result.value.container)))).toEqual({
        ok: true,
        value: [65, 65, 65, 65],
      });
    }
  });

  it('uses the stable count, minimum-byte and creation-id ordering for equal frequencies', () => {
    const result = encodeHuffman([65, 66, 67, 68]);

    expect(result).toMatchObject({
      ok: true,
      value: {
        container: fourEqualPacket,
        payloadBits: 8,
        headerBits: 160,
        paddingBits: 0,
        totalBits: 168,
        codes: [
          { byte: 65, count: 1, code: '00' },
          { byte: 66, count: 1, code: '01' },
          { byte: 67, count: 1, code: '10' },
          { byte: 68, count: 1, code: '11' },
        ],
        merges: [
          { left: 0, right: 1, parent: 4 },
          { left: 2, right: 3, parent: 5 },
          { left: 4, right: 5, parent: 6 },
        ],
      },
    });
  });

  it('rejects empty, oversized, invalid and sparse byte inputs with content-free codes', () => {
    const sparse = Array<number>(1);

    expect(encodeHuffman([])).toEqual({ ok: false, error: 'invalid-source-length' });
    expect(encodeHuffman(Array(1_025).fill(0))).toEqual({
      ok: false,
      error: 'invalid-source-length',
    });
    expect(encodeHuffman([256])).toEqual({ ok: false, error: 'invalid-byte' });
    expect(encodeHuffman(sparse)).toEqual({ ok: false, error: 'invalid-byte' });
  });
});

describe('decodeHuffman', () => {
  it('decodes a literal packet without encoder state', () => {
    expect(decodeHuffman(fourEqualPacket)).toEqual({
      ok: true,
      value: [65, 66, 67, 68],
    });
  });

  it('preserves UTF-8 bytes for repeated bytes and canonically distinct text', () => {
    const encoder = new TextEncoder();
    const fixtures = [
      [0, 0, 255, 0, 255, 255],
      [...encoder.encode('Tiếng Việt 📡')],
      [...encoder.encode('é')],
      [...encoder.encode('é')],
    ];

    for (const source of fixtures) {
      const encoded = encodeHuffman(source);
      expect(encoded.ok).toBe(true);
      if (!encoded.ok) continue;
      expect(decodeHuffman(encoded.value.container)).toEqual({ ok: true, value: source });
    }
    expect(fixtures[2]).not.toEqual(fixtures[3]);
  });

  it('supports the maximum 256-byte alphabet', () => {
    const source = Array.from({ length: 256 }, (_, byte) => byte);
    const result = encodeHuffman(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.codes).toHaveLength(256);
    expect(result.value.headerBits).toBe(6_208);
    expect(decodeHuffman(result.value.container)).toEqual({ ok: true, value: source });
  });

  it.each([
    ['invalid bytes', [0, 1, 2, 3, 4, 5, 6, 256], 'invalid-byte'],
    ['sparse bytes', Object.assign(Array<number>(8), { 0: 0 }), 'invalid-byte'],
    ['truncated fixed header', [0, 1, 0], 'truncated-header'],
    ['zero alphabet', [0, 0, 0, 1, 0, 0, 0, 1], 'invalid-alphabet-count'],
    ['alphabet above 256', [1, 1, 0, 1, 0, 0, 0, 1], 'invalid-alphabet-count'],
    ['zero source length', [0, 1, 0, 0, 0, 0, 0, 1, 65, 0, 1, 0], 'invalid-source-length'],
    ['source above 1024', [0, 1, 4, 1, 0, 0, 0, 1, 65, 4, 1, 0], 'invalid-source-length'],
    ['truncated entries', [0, 2, 0, 2, 0, 0, 0, 2, 65, 0, 1], 'truncated-header'],
    ['duplicate leaf', [0, 2, 0, 2, 0, 0, 0, 2, 65, 0, 1, 65, 0, 1, 0], 'duplicate-byte'],
    ['zero count', [0, 1, 0, 1, 0, 0, 0, 1, 65, 0, 0, 0], 'invalid-count'],
    ['impossible frequency sum', [0, 1, 0, 2, 0, 0, 0, 1, 65, 0, 1, 0], 'count-mismatch'],
    ['declared bitlength overflow', [0, 1, 0, 1, 255, 255, 255, 255, 65, 0, 1, 0], 'payload-length'],
    ['truncated body', fourEqualPacket.slice(0, -1), 'truncated-payload'],
    ['extra trailing byte', [...fourEqualPacket, 0], 'trailing-bytes'],
    ['corrupt padding', [0, 1, 0, 4, 0, 0, 0, 4, 65, 0, 4, 1], 'nonzero-padding'],
    ['nonzero single-symbol code', [0, 1, 0, 4, 0, 0, 0, 4, 65, 0, 4, 128], 'invalid-single-symbol-code'],
  ])('rejects %s', (_name, container, error) => {
    expect(decodeHuffman(container as number[])).toEqual({ ok: false, error });
  });

  it('rejects an incomplete final traversal', () => {
    const packet = [
      0, 3, 0, 3, 0, 0, 0, 5,
      65, 0, 1, 66, 0, 1, 67, 0, 1,
      248,
    ];

    expect(decodeHuffman(packet)).toEqual({ ok: false, error: 'incomplete-payload' });
  });

  it('rejects decoded length and frequency mismatches', () => {
    const base = [
      0, 3, 0, 4, 0, 0, 0, 6,
      65, 0, 2, 66, 0, 1, 67, 0, 1,
    ];
    const wrongDecodedLength = [...base, 168];
    const wrongDecodedFrequency = [...base, 40];

    expect(decodeHuffman(wrongDecodedLength)).toEqual({
      ok: false,
      error: 'decoded-count-mismatch',
    });
    expect(decodeHuffman(wrongDecodedFrequency)).toEqual({
      ok: false,
      error: 'decoded-frequency-mismatch',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { decodeUtf8, inspectMessage } from './unicode';

describe('inspectMessage', () => {
  it.each([
    ['precomposed Vietnamese text', 'ắ'],
    ['decomposed Vietnamese text', 'a\u0306\u0301'],
    ['a family emoji joined with ZWJs', '👨‍👩‍👧‍👦'],
  ])('counts %s as one grapheme', (_name, text) => {
    expect(inspectMessage(text)).toMatchObject({ ok: true, value: { graphemes: 1 } });
  });

  it('preserves user-entered whitespace and newlines in the encoded bytes', () => {
    const text = '  đến nơi\n';

    expect(inspectMessage(text)).toEqual({
      ok: true,
      value: { graphemes: 10, bytes: [32, 32, 196, 145, 225, 186, 191, 110, 32, 110, 198, 161, 105, 10] },
    });
  });

  it('rejects a message containing only whitespace without coercing it', () => {
    expect(inspectMessage(' \n\t')).toEqual({ ok: false, error: 'empty' });
  });

  it.each(['\ud800', '\udc00', 'valid\ud800text'])('rejects ill-formed UTF-16: %j', (text) => {
    expect(inspectMessage(text)).toEqual({ ok: false, error: 'ill-formed' });
  });

  it('accepts exactly 120 graphemes', () => {
    expect(inspectMessage('a'.repeat(120))).toMatchObject({ ok: true, value: { graphemes: 120 } });
  });

  it('rejects 121 graphemes', () => {
    expect(inspectMessage('a'.repeat(121))).toEqual({ ok: false, error: 'grapheme-limit' });
  });

  it('accepts a 1,024-byte message made from one long combining cluster', () => {
    const text = `😀${'\u0301'.repeat(510)}`;

    expect(inspectMessage(text)).toMatchObject({ ok: true, value: { graphemes: 1 } });
    expect(inspectMessage(text)).toMatchObject({ ok: true, value: { bytes: expect.arrayContaining([240, 159, 152, 128]) } });
    const result = inspectMessage(text);
    expect(result.ok && result.value.bytes).toHaveLength(1024);
  });

  it('rejects a 1,025-byte message made from a long combining cluster', () => {
    const text = `😀${'\u0301'.repeat(510)}a`;

    expect(inspectMessage(text)).toEqual({ ok: false, error: 'byte-limit' });
  });
});

describe('decodeUtf8', () => {
  it('decodes valid UTF-8 without replacing invalid sequences', () => {
    expect(decodeUtf8([225, 186, 175])).toEqual({ ok: true, value: 'ắ' });
  });

  it('retains a valid leading byte-order-mark character', () => {
    expect(decodeUtf8([0xef, 0xbb, 0xbf, 0x61])).toEqual({ ok: true, value: '\ufeffa' });
  });

  it('rejects malformed UTF-8', () => {
    expect(decodeUtf8([0xc3, 0x28])).toEqual({ ok: false, error: 'invalid-byte' });
  });

  it.each([-1, 256, 1.5, Number.NaN])('rejects values outside the byte domain: %s', (byte) => {
    expect(decodeUtf8([byte])).toEqual({ ok: false, error: 'invalid-byte' });
  });

  it('rejects sparse byte arrays instead of decoding holes as NUL bytes', () => {
    expect(decodeUtf8(Array<number>(1))).toEqual({ ok: false, error: 'invalid-byte' });
  });
});

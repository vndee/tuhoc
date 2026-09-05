import type { Bytes, Result } from './types';

const MAX_GRAPHEMES = 120;
const MAX_UTF8_BYTES = 1024;
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function isWellFormedUtf16(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isByte(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xff;
}

export function inspectMessage(text: string): Result<{ graphemes: number; bytes: Bytes }> {
  if (text.trim().length === 0) return { ok: false, error: 'empty' };
  if (!isWellFormedUtf16(text)) return { ok: false, error: 'ill-formed' };

  const graphemes = Array.from(graphemeSegmenter.segment(text)).length;
  if (graphemes > MAX_GRAPHEMES) return { ok: false, error: 'grapheme-limit' };

  const bytes = Array.from(utf8Encoder.encode(text));
  if (bytes.length > MAX_UTF8_BYTES) return { ok: false, error: 'byte-limit' };

  return { ok: true, value: { graphemes, bytes } };
}

export function decodeUtf8(bytes: Bytes): Result<string> {
  if (!bytes.every(isByte)) return { ok: false, error: 'invalid-byte' };

  try {
    return { ok: true, value: utf8Decoder.decode(Uint8Array.from(bytes)) };
  } catch {
    return { ok: false, error: 'invalid-byte' };
  }
}

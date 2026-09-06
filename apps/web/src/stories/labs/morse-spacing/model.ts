import type { Result } from '../communication/types';

export interface MorseSegment {
  kind: 'mark' | 'gap';
  duration: number;
}

const CONTROLLED_CODEBOOK = {
  A: '.-',
  B: '-...',
  E: '.',
  M: '--',
  T: '-',
} as const;

const INTERNATIONAL_MORSE: Readonly<Record<string, string>> = {
  '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F',
  '--.': 'G', '....': 'H', '..': 'I', '.---': 'J', '-.-': 'K', '.-..': 'L',
  '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R',
  '...': 'S', '-': 'T', '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X',
  '-.--': 'Y', '--..': 'Z', '-----': '0', '.----': '1', '..---': '2',
  '...--': '3', '....-': '4', '.....': '5', '-....': '6', '--...': '7',
  '---..': '8', '----.': '9',
};

const CONTROLLED_TEXT = /^[AETBM]+(?: [AETBM]+)*$/;

export function morseTimeline(text: string, letterGap: number, wordGap: number): Result<MorseSegment[]> {
  if (typeof text !== 'string' || !CONTROLLED_TEXT.test(text)) {
    return { ok: false, error: 'unsupported-character' };
  }
  if (!Number.isInteger(letterGap) || letterGap < 1 || letterGap > 7) {
    return { ok: false, error: 'invalid-letter-gap' };
  }
  if (!Number.isInteger(wordGap) || wordGap < 1 || wordGap > 9) {
    return { ok: false, error: 'invalid-word-gap' };
  }

  const segments: MorseSegment[] = [];
  let needsBoundary = false;
  for (const word of text.split(' ')) {
    for (let letterIndex = 0; letterIndex < word.length; letterIndex += 1) {
      if (needsBoundary) {
        segments.push({
          kind: 'gap',
          duration: letterIndex === 0 ? wordGap : letterGap,
        });
      }
      const code = CONTROLLED_CODEBOOK[word[letterIndex] as keyof typeof CONTROLLED_CODEBOOK];
      for (let markIndex = 0; markIndex < code.length; markIndex += 1) {
        if (markIndex > 0) segments.push({ kind: 'gap', duration: 1 });
        segments.push({ kind: 'mark', duration: code[markIndex] === '.' ? 1 : 3 });
      }
      needsBoundary = true;
    }
  }
  return { ok: true, value: segments };
}

export function readMorse(segments: readonly MorseSegment[]): Result<string> {
  if (!isValidSegments(segments)) return { ok: false, error: 'invalid-segments' };

  let code = '';
  let reading = '';
  const finishLetter = () => {
    const letter = INTERNATIONAL_MORSE[code];
    if (letter === undefined) return false;
    reading += letter;
    code = '';
    return true;
  };

  for (const segment of segments) {
    if (segment.kind === 'mark') {
      code += segment.duration === 1 ? '.' : '-';
      continue;
    }
    if (segment.duration < 2) continue;
    if (!finishLetter()) return { ok: false, error: 'unknown-code' };
    if (segment.duration >= 5) reading += ' ';
  }

  return finishLetter()
    ? { ok: true, value: reading }
    : { ok: false, error: 'unknown-code' };
}

function isValidSegments(segments: readonly MorseSegment[]): boolean {
  if (!Array.isArray(segments) || segments.length === 0) return false;
  for (let index = 0; index < segments.length; index += 1) {
    if (!(index in segments)) return false;
    const segment = segments[index];
    if (typeof segment !== 'object' || segment === null || !Number.isInteger(segment.duration)) return false;
    if (segment.kind === 'mark') {
      if (segment.duration !== 1 && segment.duration !== 3) return false;
    } else if (segment.kind === 'gap') {
      if (segment.duration < 1) return false;
    } else {
      return false;
    }
    if ((index % 2 === 0) !== (segment.kind === 'mark')) return false;
  }
  return segments[segments.length - 1]?.kind === 'mark';
}

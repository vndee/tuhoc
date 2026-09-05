const MAX_UINT32 = 0xffff_ffff;

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_UINT32;
}

function isValidLength(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_UINT32;
}

export function uniforms(seed: number, count: number): number[] {
  if (!isUint32(seed)) throw new RangeError('invalid-seed');
  if (!isValidLength(count)) throw new RangeError('invalid-length');

  let state = seed >>> 0;
  const draw = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  return Array.from({ length: count }, draw);
}

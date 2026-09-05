const MAX_UINT32 = 0xffff_ffff;
const UINT32_RANGE = 0x1_0000_0000;
const MULBERRY32_INCREMENT = 0x6d2b79f5;

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_UINT32;
}

function isValidLength(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_UINT32;
}

function mixState(state: number): number {
  let value = Math.imul(state ^ (state >>> 15), 1 | state);
  value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
  return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
}

export function uniforms(seed: number, count: number): number[] {
  if (!isUint32(seed)) throw new RangeError('invalid-seed');
  if (!isValidLength(count)) throw new RangeError('invalid-length');

  let state = seed >>> 0;
  const draw = () => {
    state = (state + MULBERRY32_INCREMENT) >>> 0;
    return mixState(state);
  };

  return Array.from({ length: count }, draw);
}

/** Returns one indexed Mulberry32 draw in constant memory and time. */
export function uniformAt(seed: number, index: number): number {
  if (!isUint32(seed)) throw new RangeError('invalid-seed');
  if (!Number.isSafeInteger(index) || index < 0) throw new RangeError('invalid-index');

  const steps = ((index % UINT32_RANGE) + 1) % UINT32_RANGE;
  const state = (seed + Math.imul(MULBERRY32_INCREMENT, steps)) >>> 0;
  return mixState(state);
}

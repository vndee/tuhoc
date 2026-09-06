import type { Bytes, ChannelCode, Result } from '../communication/types';
import { channelRequirement, runTransmission } from './model';

export type BatchRow = {
  code: ChannelCode; trials: 200; exact: number; rejected: number; silent: number;
  payloadErrors: number; decodedPayloadBits: number;
};
export type BatchResult = { rows: readonly BatchRow[]; excluded: readonly ChannelCode[] };
export type BatchConfig = { p: number; seed: number; budget: number };

export async function compareCodes(
  bytes: Bytes,
  config: BatchConfig,
  options: { signal: AbortSignal; onProgress: (done: number, total: number) => void; yieldControl?: () => Promise<void> },
): Promise<Result<BatchResult>> {
  const cancelled = { ok: false, error: 'cancelled' } as const;
  if (options.signal.aborted) return cancelled;
  // The first raw trial also validates the public boundary; reuse it below.
  const first = runTransmission(bytes, { ...config, code: 'raw' });
  if (!first.ok && first.error !== 'budget-exceeded') return first;
  const source = [...bytes];
  const captured = { ...config };
  const codes = ['raw', 'repeat3', 'secded'] as const;
  const eligible = codes.filter((code) => channelRequirement(source.length * 8, code).required <= captured.budget);
  const excluded = codes.filter((code) => !eligible.includes(code));
  const rows: BatchRow[] = [];
  const total = eligible.length * 200;
  let done = 0;
  const yieldControl = options.yieldControl ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  for (const code of eligible) {
    const row: BatchRow = { code, trials: 200, exact: 0, rejected: 0, silent: 0, payloadErrors: 0, decodedPayloadBits: 0 };
    for (let i = 0; i < 200; i += 1) {
      if (options.signal.aborted) return cancelled;
      const run = code === 'raw' && i === 0 ? first : runTransmission(source, { ...captured, code, seed: (captured.seed + i) >>> 0 });
      if (!run.ok) return run;
      if (run.value.outcome === 'exact') row.exact += 1;
      else if (run.value.outcome === 'rejected') row.rejected += 1;
      else row.silent += 1;
      if (run.value.received !== null) {
        row.payloadErrors += run.value.payloadErrors!;
        row.decodedPayloadBits += source.length * 8;
      }
      done += 1;
      if (done % 5 === 0) {
        options.onProgress(done, total);
        if (options.signal.aborted) return cancelled;
        await yieldControl();
        if (options.signal.aborted) return cancelled;
      }
    }
    rows.push(row);
  }
  return { ok: true, value: { rows, excluded } };
}

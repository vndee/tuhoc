import { describe, expect, it, vi } from 'vitest';
import { compareCodes } from './batch';
import { runTransmission } from './model';

const config = { p: 0, seed: 20260905, budget: 512 };
const options = () => ({ signal: new AbortController().signal, onProgress: vi.fn(), yieldControl: async () => {} });

describe('compareCodes', () => {
  it('counts exactly 200 whole-message outcomes per eligible code', async () => {
    const result = await compareCodes([65], config, options());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.excluded).toEqual([]);
    expect(result.value.rows).toHaveLength(3);
    for (const row of result.value.rows) {
      expect([row.trials, row.exact, row.rejected, row.silent, row.payloadErrors, row.decodedPayloadBits])
        .toEqual([200, 200, 0, 0, 0, 1600]);
    }
  });

  it('excludes codes that cannot carry the entire payload, including all-code exclusion', async () => {
    const result = await compareCodes(Array(32).fill(65), config, options());
    expect(result.ok && result.value.rows.map((row) => row.code)).toEqual(['raw', 'secded']);
    expect(result.ok && result.value.excluded).toEqual(['repeat3']);
    expect(await compareCodes(Array(65).fill(65), config, options())).toEqual({
      ok: true, value: { rows: [], excluded: ['raw', 'repeat3', 'secded'] },
    });
  });

  it('replays the shared uint32 seed sequence and excludes rejected outputs from BER', async () => {
    const noisy = { ...config, p: 0.2, seed: 0xffff_fffe };
    const result = await compareCodes([65], noisy, options());
    expect(result).toEqual(await compareCodes([65], noisy, options()));
    if (!result.ok) throw new Error(result.error);
    for (const row of result.value.rows) {
      const runs = Array.from({ length: 200 }, (_, i) => runTransmission([65], { ...noisy, code: row.code, seed: (noisy.seed + i) >>> 0 }));
      const transmissions = runs.map((run) => { if (!run.ok) throw new Error(run.error); return run.value; });
      expect(row.exact).toBe(transmissions.filter((run) => run.outcome === 'exact').length);
      expect(row.rejected).toBe(transmissions.filter((run) => run.outcome === 'rejected').length);
      expect(row.silent).toBe(transmissions.filter((run) => run.outcome === 'silent-corruption').length);
      expect(row.exact + row.rejected + row.silent).toBe(200);
      expect(row.decodedPayloadBits).toBe((200 - row.rejected) * 8);
      expect(row.payloadErrors).toBe(transmissions.reduce((sum, run) => sum + (run.payloadErrors ?? 0), 0));
    }
    expect(result.value.rows[2]!.rejected).toBeGreaterThan(0);
  });

  it('yields and reports progress only at five-transmission boundaries', async () => {
    const settings = options();
    const yieldControl = vi.fn(async () => {});
    await compareCodes([65], config, { ...settings, yieldControl });
    expect(settings.onProgress.mock.calls).toEqual(Array.from({ length: 120 }, (_, i) => [(i + 1) * 5, 600]));
    expect(yieldControl).toHaveBeenCalledTimes(120);
  });

  it('checks cancellation before work, before yielding, and after yielding without later progress', async () => {
    for (const when of ['before', 'progress', 'yield'] as const) {
      const abort = new AbortController();
      if (when === 'before') abort.abort();
      const onProgress = vi.fn(() => { if (when === 'progress') abort.abort(); });
      const yieldControl = vi.fn(async () => { abort.abort(); });
      expect(await compareCodes([65], config, { signal: abort.signal, onProgress, yieldControl }))
        .toEqual({ ok: false, error: 'cancelled' });
      expect(onProgress).toHaveBeenCalledTimes(when === 'before' ? 0 : 1);
      expect(yieldControl).toHaveBeenCalledTimes(when === 'yield' ? 1 : 0);
    }
  });

  it('uses a real timer by default so other queued work can cancel it', async () => {
    const abort = new AbortController();
    setTimeout(() => abort.abort(), 0);
    expect(await compareCodes([65], config, { signal: abort.signal, onProgress: () => {} }))
      .toEqual({ ok: false, error: 'cancelled' });
  });

  it('captures caller bytes and config before yielding', async () => {
    const bytes = [65];
    const settings = { ...config };
    const expected = await compareCodes(bytes, settings, options());
    expect(await compareCodes(bytes, settings, { ...options(), yieldControl: async () => {
      bytes[0] = 66;
      settings.p = 0.5;
      settings.seed = 1;
      settings.budget = 32768;
    } })).toEqual(expected);
  });

  it.each([
    { bytes: [], settings: config, error: 'empty' },
    { bytes: [256], settings: config, error: 'invalid-byte' },
    { bytes: Array(2) as number[], settings: config, error: 'invalid-byte' },
    { bytes: Array(1025).fill(65), settings: config, error: 'byte-limit' },
    { bytes: [65], settings: { ...config, p: NaN }, error: 'invalid-probability' },
    { bytes: [65], settings: { ...config, seed: -1 }, error: 'invalid-seed' },
    { bytes: [65], settings: { ...config, budget: 513 }, error: 'invalid-budget' },
  ])('returns $error without progress for invalid input', async ({ bytes, settings, error }) => {
    const opts = options();
    expect(await compareCodes(bytes, settings, opts)).toEqual({ ok: false, error });
    expect(opts.onProgress).not.toHaveBeenCalled();
  });
});

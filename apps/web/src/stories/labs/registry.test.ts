import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_LAB_KINDS } from '../types';
import type { LabModule } from './runtime';
import { labRegistry, loadLab, REGISTERED_LAB_KINDS } from './registry';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
const registryApiAssertions = [
  true as Assert<Equal<typeof labRegistry, Readonly<Record<(typeof ALL_LAB_KINDS)[number], () => Promise<LabModule>>>>>,
  true as Assert<Equal<typeof REGISTERED_LAB_KINDS, ReadonlySet<(typeof ALL_LAB_KINDS)[number]>>>,
];
void registryApiAssertions;

afterEach(() => vi.restoreAllMocks());

describe('labRegistry', () => {
  it.each(['http', 'network', 'json'] as const)('keeps %s retry-map failures content-free', async (failure) => {
    const privateText = 'PRIVATE-MAP-FAILURE-ắ';
    vi.spyOn(labRegistry, 'binary-noise').mockRejectedValue(new Error(privateText));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    if (failure === 'network') fetchSpy.mockRejectedValue(new Error(privateText));
    else fetchSpy.mockResolvedValue(new Response(privateText, { status: failure === 'http' ? 404 : 200 }));
    const error = await loadLab('binary-noise', 1).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('lab-retry-unavailable');
    expect(String(fetchSpy.mock.calls[0]![0])).not.toContain(privateText);
    expect(fetchSpy.mock.calls[0]![1]).toEqual({ credentials: 'omit', cache: 'no-store' });
  });
  it('keeps failed import and malformed retry metadata errors content-free without leaking private data', async () => {
    const privateText = 'PRIVATE-NOISE-20260905-ắ-👨‍👩‍👧‍👦';
    vi.spyOn(labRegistry, 'binary-noise').mockRejectedValue(new Error(privateText));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ buildId: 'wrong-build', entries: { 'binary-noise': privateText } })));
    const consoleSpies = ['log', 'info', 'warn', 'error', 'debug'].map(method => vi.spyOn(console, method as 'log'));
    await expect(loadLab('binary-noise')).rejects.toThrow('lab-load-unavailable');
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(loadLab('binary-noise', 1)).rejects.toThrow('lab-retry-unavailable');
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(String(fetchSpy.mock.calls[0]![0])).not.toContain(privateText);
    expect(fetchSpy.mock.calls[0]![1]).toEqual({ credentials: 'omit', cache: 'no-store' });
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
  it('has an explicit lazy loader for message-meaning', () => {
    expect((labRegistry as Record<string, unknown>)['message-meaning']).toEqual(expect.any(Function));
  });

  it('has an explicit lazy loader for channel-budget', () => {
    expect((labRegistry as Record<string, unknown>)['channel-budget']).toEqual(expect.any(Function));
  });

  it('has an explicit lazy loader for secded-inspector', () => {
    expect((labRegistry as Record<string, unknown>)['secded-inspector']).toEqual(expect.any(Function));
  });

  it('has an explicit lazy loader for repetition-channel', () => {
    expect((labRegistry as Record<string, unknown>)['repetition-channel']).toEqual(expect.any(Function));
  });

  it('has an explicit lazy loader for huffman-message', () => {
    expect((labRegistry as Record<string, unknown>)['huffman-message']).toEqual(expect.any(Function));
  });

  it('has an explicit lazy loader for source-entropy', () => {
    expect((labRegistry as Record<string, unknown>)['source-entropy']).toEqual(expect.any(Function));
  });

  it('has an explicit lazy loader for binary-noise', () => {
    expect((labRegistry as Record<string, unknown>)['binary-noise']).toEqual(expect.any(Function));
  });

  it('has an explicit lazy loader for pulse-channel', () => {
    expect((labRegistry as Record<string, unknown>)['pulse-channel']).toEqual(expect.any(Function));
  });

  it('has an explicit lazy loader for cable-route', () => {
    expect((labRegistry as Record<string, unknown>)['cable-route']).toEqual(expect.any(Function));
  });

  it('registers every lab kind explicitly', () => {
    expect(Object.keys(labRegistry).sort()).toEqual([...ALL_LAB_KINDS].sort());
    expect(REGISTERED_LAB_KINDS).toEqual(new Set(ALL_LAB_KINDS));
  });

  it('loads only the requested lab chunk', async () => {
    const FakeAttentionLab = () => null;
    const loaders = Object.fromEntries(ALL_LAB_KINDS.map((kind) => [
      kind,
      vi.spyOn(labRegistry, kind),
    ])) as Record<(typeof ALL_LAB_KINDS)[number], ReturnType<typeof vi.spyOn>>;
    loaders.attention.mockResolvedValue({ default: FakeAttentionLab });

    expect(loaders.attention).not.toHaveBeenCalled();
    await loadLab('attention');

    expect(loaders.attention).toHaveBeenCalledOnce();
    for (const kind of ALL_LAB_KINDS.filter((kind) => kind !== 'attention')) {
      expect(loaders[kind]).not.toHaveBeenCalled();
    }
  });
});

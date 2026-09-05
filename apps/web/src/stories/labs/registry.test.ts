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

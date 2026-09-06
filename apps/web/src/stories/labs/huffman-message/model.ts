import type { HuffmanMerge, HuffmanPacket } from './codec';

export function visibleHuffmanMerges(packet: HuffmanPacket, step: number): readonly HuffmanMerge[] {
  const integerStep = Number.isFinite(step) ? Math.trunc(step) : 0;
  const count = Math.min(packet.merges.length, Math.max(0, integerStep));
  return packet.merges.slice(0, count);
}

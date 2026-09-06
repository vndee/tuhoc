import type { Bytes, Result } from '../communication/types';

export type HuffmanNode = {
  id: number;
  count: number;
  minByte: number;
  byte: number | null;
  left: number | null;
  right: number | null;
};

export type HuffmanMerge = { left: number; right: number; parent: number };

export type HuffmanPacket = {
  container: Bytes;
  payloadBits: number;
  headerBits: number;
  paddingBits: number;
  totalBits: number;
  nodes: readonly HuffmanNode[];
  merges: readonly HuffmanMerge[];
  codes: readonly { byte: number; count: number; code: string }[];
};

type Tree = {
  nodes: HuffmanNode[];
  merges: HuffmanMerge[];
  root: number;
  codes: { byte: number; count: number; code: string }[];
};

function hasOnlyDenseBytes(bytes: Bytes): boolean {
  for (let index = 0; index < bytes.length; index += 1) {
    if (!(index in bytes)) return false;
    const byte = bytes[index];
    if (!Number.isInteger(byte) || byte! < 0 || byte! > 0xff) return false;
  }
  return true;
}

function compareNodes(left: HuffmanNode, right: HuffmanNode): number {
  return left.count - right.count || left.minByte - right.minByte || left.id - right.id;
}

class NodeHeap {
  private readonly ids: number[] = [];
  private readonly nodes: readonly HuffmanNode[];

  constructor(nodes: readonly HuffmanNode[]) {
    this.nodes = nodes;
  }

  get size(): number {
    return this.ids.length;
  }

  push(id: number): void {
    this.ids.push(id);
    let index = this.ids.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.less(index, parent)) break;
      this.swap(index, parent);
      index = parent;
    }
  }

  pop(): number {
    const first = this.ids[0]!;
    const last = this.ids.pop()!;
    if (this.ids.length === 0) return first;

    this.ids[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.ids.length && this.less(left, smallest)) smallest = left;
      if (right < this.ids.length && this.less(right, smallest)) smallest = right;
      if (smallest === index) return first;
      this.swap(index, smallest);
      index = smallest;
    }
  }

  private less(leftIndex: number, rightIndex: number): boolean {
    return compareNodes(this.nodes[this.ids[leftIndex]!]!, this.nodes[this.ids[rightIndex]!]!) < 0;
  }

  private swap(left: number, right: number): void {
    [this.ids[left], this.ids[right]] = [this.ids[right]!, this.ids[left]!];
  }
}

function buildTree(entries: readonly { byte: number; count: number }[]): Tree {
  const nodes: HuffmanNode[] = entries.map(({ byte, count }, id) => ({
    id,
    count,
    minByte: byte,
    byte,
    left: null,
    right: null,
  }));
  const merges: HuffmanMerge[] = [];
  const heap = new NodeHeap(nodes);
  for (const node of nodes) heap.push(node.id);

  while (heap.size > 1) {
    const left = heap.pop();
    const right = heap.pop();
    const leftNode = nodes[left]!;
    const rightNode = nodes[right]!;
    const parent = nodes.length;
    nodes.push({
      id: parent,
      count: leftNode.count + rightNode.count,
      minByte: Math.min(leftNode.minByte, rightNode.minByte),
      byte: null,
      left,
      right,
    });
    merges.push({ left, right, parent });
    heap.push(parent);
  }

  const root = heap.pop();
  const codeByByte = new Map<number, string>();
  if (entries.length === 1) {
    codeByByte.set(entries[0]!.byte, '0');
  } else {
    const visit = (nodeId: number, prefix: string): void => {
      const node = nodes[nodeId]!;
      if (node.byte !== null) {
        codeByByte.set(node.byte, prefix);
        return;
      }
      visit(node.left!, `${prefix}0`);
      visit(node.right!, `${prefix}1`);
    };
    visit(root, '');
  }

  return {
    nodes,
    merges,
    root,
    codes: entries.map(({ byte, count }) => ({ byte, count, code: codeByByte.get(byte)! })),
  };
}

function writeUint16(target: number[], value: number): void {
  target.push((value >>> 8) & 0xff, value & 0xff);
}

function writeUint32(target: number[], value: number): void {
  target.push(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  );
}

function readUint16(source: Bytes, offset: number): number {
  return source[offset]! * 0x100 + source[offset + 1]!;
}

function readUint32(source: Bytes, offset: number): number {
  return (
    source[offset]! * 0x1000000
    + source[offset + 1]! * 0x10000
    + source[offset + 2]! * 0x100
    + source[offset + 3]!
  );
}

export function encodeHuffman(bytes: Bytes): Result<HuffmanPacket> {
  if (!hasOnlyDenseBytes(bytes)) return { ok: false, error: 'invalid-byte' };
  if (bytes.length < 1 || bytes.length > 1_024) {
    return { ok: false, error: 'invalid-source-length' };
  }

  const frequencies = new Array<number>(256).fill(0);
  for (const byte of bytes) frequencies[byte!]! += 1;
  const entries = frequencies.flatMap((count, byte) => count === 0 ? [] : [{ byte, count }]);
  const tree = buildTree(entries);
  const codeByByte = new Map(tree.codes.map(({ byte, code }) => [byte, code]));
  const payloadBits = tree.codes.reduce((total, entry) => total + entry.count * entry.code.length, 0);
  const payload = new Array<number>(Math.ceil(payloadBits / 8)).fill(0);
  let bitOffset = 0;
  for (const byte of bytes) {
    for (const bit of codeByByte.get(byte!)!) {
      if (bit === '1') payload[Math.floor(bitOffset / 8)]! |= 1 << (7 - (bitOffset % 8));
      bitOffset += 1;
    }
  }

  const container: number[] = [];
  writeUint16(container, entries.length);
  writeUint16(container, bytes.length);
  writeUint32(container, payloadBits);
  for (const entry of entries) {
    container.push(entry.byte);
    writeUint16(container, entry.count);
  }
  container.push(...payload);

  const headerBits = 64 + 24 * entries.length;
  const paddingBits = (8 - (payloadBits % 8)) % 8;
  return {
    ok: true,
    value: {
      container,
      payloadBits,
      headerBits,
      paddingBits,
      totalBits: headerBits + payloadBits + paddingBits,
      nodes: tree.nodes,
      merges: tree.merges,
      codes: tree.codes,
    },
  };
}

export function decodeHuffman(container: Bytes): Result<Bytes> {
  if (!hasOnlyDenseBytes(container)) return { ok: false, error: 'invalid-byte' };
  if (container.length < 8) return { ok: false, error: 'truncated-header' };

  const alphabetCount = readUint16(container, 0);
  const sourceLength = readUint16(container, 2);
  const payloadBits = readUint32(container, 4);
  if (alphabetCount < 1 || alphabetCount > 256) {
    return { ok: false, error: 'invalid-alphabet-count' };
  }
  if (sourceLength < 1 || sourceLength > 1_024) {
    return { ok: false, error: 'invalid-source-length' };
  }

  const headerBytes = 8 + 3 * alphabetCount;
  if (container.length < headerBytes) return { ok: false, error: 'truncated-header' };

  const seen = new Set<number>();
  const entries: { byte: number; count: number }[] = [];
  let countSum = 0;
  for (let index = 0; index < alphabetCount; index += 1) {
    const offset = 8 + index * 3;
    const byte = container[offset]!;
    const count = readUint16(container, offset + 1);
    if (seen.has(byte)) return { ok: false, error: 'duplicate-byte' };
    if (count === 0) return { ok: false, error: 'invalid-count' };
    seen.add(byte);
    entries.push({ byte, count });
    countSum += count;
  }
  if (countSum !== sourceLength) return { ok: false, error: 'count-mismatch' };

  entries.sort((left, right) => left.byte - right.byte);
  const tree = buildTree(entries);
  const expectedPayloadBits = tree.codes.reduce(
    (total, entry) => total + entry.count * entry.code.length,
    0,
  );
  if (payloadBits !== expectedPayloadBits) return { ok: false, error: 'payload-length' };

  const payloadBytes = Math.ceil(payloadBits / 8);
  const expectedLength = headerBytes + payloadBytes;
  if (container.length < expectedLength) return { ok: false, error: 'truncated-payload' };
  if (container.length > expectedLength) return { ok: false, error: 'trailing-bytes' };

  const paddingBits = (8 - (payloadBits % 8)) % 8;
  if (paddingBits > 0) {
    const paddingMask = (1 << paddingBits) - 1;
    if ((container[container.length - 1]! & paddingMask) !== 0) {
      return { ok: false, error: 'nonzero-padding' };
    }
  }

  const readBit = (index: number): number => (
    container[headerBytes + Math.floor(index / 8)]! >>> (7 - (index % 8))
  ) & 1;
  const decoded: number[] = [];

  if (alphabetCount === 1) {
    for (let index = 0; index < payloadBits; index += 1) {
      if (readBit(index) !== 0) return { ok: false, error: 'invalid-single-symbol-code' };
      decoded.push(entries[0]!.byte);
    }
  } else {
    let current = tree.root;
    for (let index = 0; index < payloadBits; index += 1) {
      const node = tree.nodes[current]!;
      current = readBit(index) === 0 ? node.left! : node.right!;
      const next = tree.nodes[current]!;
      if (next.byte !== null) {
        decoded.push(next.byte);
        current = tree.root;
      }
    }
    if (current !== tree.root) return { ok: false, error: 'incomplete-payload' };
  }

  if (decoded.length !== sourceLength) {
    return { ok: false, error: 'decoded-count-mismatch' };
  }
  const decodedFrequencies = new Array<number>(256).fill(0);
  for (const byte of decoded) decodedFrequencies[byte]! += 1;
  for (const entry of entries) {
    if (decodedFrequencies[entry.byte] !== entry.count) {
      return { ok: false, error: 'decoded-frequency-mismatch' };
    }
  }

  return { ok: true, value: decoded };
}

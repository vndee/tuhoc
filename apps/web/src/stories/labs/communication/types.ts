export type Bit = 0 | 1;
export type Bits = readonly Bit[];
export type Bytes = readonly number[];
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type SymbolId = 'A' | 'B' | 'C' | 'D';
export type Weights = readonly [number, number, number, number];
export type Codebook = Record<SymbolId, string>;
export type ChannelCode = 'raw' | 'repeat3' | 'secded';
export type NoiseConfig = { p: number; seed: number };
export type TransmissionConfig = NoiseConfig & { code: ChannelCode; budget: number };
export type Transmission = {
  source: Bytes;
  received: Bytes | null;
  config: TransmissionConfig;
  required: number;
  outcome: 'exact' | 'silent-corruption' | 'rejected';
  flippedBits: number;
  payloadErrors: number | null;
};
export type DeliveryReceipt = Transmission & { messageRevision: number; messageText: string };
export type RunSnapshot<C, R> = {
  messageRevision: number;
  source: Bytes;
  config: C;
  result: R;
};
export type LabState<C, R> = { config: C; snapshot: RunSnapshot<C, R> | null };

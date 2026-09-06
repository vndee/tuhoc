import { describe, expect, it } from 'vitest';
import type { DeliveryReceipt } from '../communication/types';
import { receiptView } from './model';

const receipt = (overrides: Partial<DeliveryReceipt> = {}): DeliveryReceipt => ({
  messageText: 'A',
  messageRevision: 1,
  source: [65],
  received: [65],
  config: { code: 'raw', p: 0, seed: 1, budget: 512 },
  required: 8,
  outcome: 'exact',
  flippedBits: 0,
  payloadErrors: 0,
  ...overrides,
});

describe('receiptView', () => {
  it('treats a missing current receipt as not run', () => {
    expect(receiptView(null, 2)).toEqual({ status: 'not-run', receipt: null });
  });

  it.each(['exact', 'rejected', 'silent-corruption'] as const)('gives revision mismatch precedence over captured %s', (outcome) => {
    const captured = receipt({ outcome, received: outcome === 'rejected' ? null : [65] });

    expect(receiptView(captured, 2)).toEqual({ status: 'stale', receipt: captured });
    expect(receiptView(captured, 1)).toEqual({ status: outcome, receipt: captured });
  });

  it.each(['exact', 'silent-corruption', 'rejected'] as const)(
    'reports the current receipt outcome %s without interpretation',
    (outcome) => {
      const captured = receipt({ outcome, received: outcome === 'rejected' ? null : [65] });

      expect(receiptView(captured, 1)).toEqual({ status: outcome, receipt: captured });
    },
  );
});

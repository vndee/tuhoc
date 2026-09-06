import type { DeliveryReceipt } from '../communication/types';

export type ReceiptView = {
  status: 'not-run' | 'stale' | 'exact' | 'silent-corruption' | 'rejected';
  receipt: DeliveryReceipt | null;
};

export function receiptView(receipt: DeliveryReceipt | null, revision: number): ReceiptView {
  if (receipt === null) return { status: 'not-run', receipt: null };
  if (receipt.messageRevision !== revision) return { status: 'stale', receipt };
  return { status: receipt.outcome, receipt };
}

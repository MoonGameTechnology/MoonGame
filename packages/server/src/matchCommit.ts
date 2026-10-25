import type { MatchSnapshot, MatchStore, ReceiptStore, StoredReceipt } from './store/types';

/** A durable command must never fall back to two independent writes. */
export async function commitMatch(
  matches: MatchStore,
  receipts: ReceiptStore,
  snapshot: MatchSnapshot,
  receipt: StoredReceipt,
): Promise<void> {
  if (!matches.saveWithReceipt) throw new Error('E_MATCH_COMMIT_BACKEND');
  return matches.saveWithReceipt(snapshot, receipt, receipts);
}

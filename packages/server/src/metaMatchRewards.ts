import type { MetaCommandResult, MetaMatchRewardsView } from '@void/protocol';
import type { MetaEconomyStore } from './metaEconomyStore';
import type { MetaEconomyCatalog } from './metaEconomyCatalog';
import { metaSettlementReceiptKey } from './metaEconomy';

export async function readMatchRewards(
  store: MetaEconomyStore,
  catalog: MetaEconomyCatalog,
  accountId: string,
  matchId: string,
): Promise<MetaMatchRewardsView> {
  // Observe the final commit first. A successful final receipt closes the operation,
  // so its earlier stage receipts are visible to every following read. Reading stages
  // first could combine an old empty stage snapshot with a newly committed final.
  const final = await store.receipt(
    metaSettlementReceiptKey({ accountId, matchId, kind: 'final' }),
  );
  const keys = catalog.rewards.stageFractions
    .slice(0, 10)
    .map((_fraction, index) =>
      metaSettlementReceiptKey({ accountId, matchId, kind: 'stage', stage: index + 1 }),
    );
  const stored = [...(await Promise.all(keys.map((key) => store.receipt(key)))), final];
  const receipts = stored.flatMap((row) => {
    const result = row?.response as MetaCommandResult | undefined;
    return result?.ok && result.receipt ? [result.receipt] : [];
  });
  const finalResult = final?.response as MetaCommandResult | undefined;
  return { receipts, finalReady: Boolean(finalResult?.ok && finalResult.receipt) };
}

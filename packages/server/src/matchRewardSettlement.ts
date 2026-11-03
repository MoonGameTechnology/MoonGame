import { createHash } from 'node:crypto';
import type { MetaCommandReceipt, MetaEconomyAccount } from '@void/protocol';
import type { MetaEconomyTransaction } from './metaEconomyStore';
import type { MatchRewardFacts } from './metaEconomy';
import type { FinalRewardFacts } from './matchRewardFacts';

const safeAdd = (a: number, b: number): number => {
  const result = a + b;
  if (!Number.isSafeInteger(result) || result > 1_000_000_000) throw new Error('E_META_LIMIT');
  return result;
};
/** Seed is secret until the final facts commit, independent of match/account IDs. */
function rng(seed: string): () => number {
  let index = 0;
  return () =>
    createHash('sha256').update(`${seed}:${index++}`).digest().readUInt32BE(0) / 0x1_0000_0000;
}

/** Runs inside MetaEconomy's inventory/wallet/material/receipt transaction. */
export async function settleFinalMatch(
  tx: MetaEconomyTransaction,
  account: MetaEconomyAccount,
  receipt: MetaCommandReceipt,
  facts: MatchRewardFacts,
  reward: FinalRewardFacts,
): Promise<{ materials: Record<string, number>; eligible: boolean }> {
  const { policy } = reward;
  const eligible = reward.reason === 'active' || reward.reason === 'eliminated';
  const baseWarrants = eligible ? policy.baseWarrants : 0;
  const killWarrants = eligible ? Math.floor(reward.kills / policy.killsPerWarrant) : 0;
  const sovereigns = eligible ? Math.floor(reward.score / policy.scoreDivisor) : 0;
  const veteranMaterials = eligible
    ? Math.min(
        policy.veteranMaterialCap,
        Math.floor(reward.veteranPoints / policy.veteranPointsPerMaterial),
      )
    : 0;
  const materials: Record<string, number> = {};
  const roll = rng(reward.seed);
  const totalWeight = policy.materialPool.reduce((sum, entry) => sum + entry.weight, 0);
  for (let i = 0; eligible && i < policy.baseMaterialCount + veteranMaterials; i++) {
    let value = roll() * totalWeight;
    const id = policy.materialPool.find((entry) => (value -= entry.weight) < 0)!.materialId;
    materials[id] = (materials[id] ?? 0) + 1;
  }
  receipt.matchReward = {
    version: policy.version,
    reason: reward.reason,
    score: reward.score,
    scoreDivisor: policy.scoreDivisor,
    kills: reward.kills,
    killsPerWarrant: policy.killsPerWarrant,
    baseWarrants,
    killWarrants,
    baseMaterials: eligible ? policy.baseMaterialCount : 0,
    veteranPoints: reward.veteranPoints,
    veteranMaterials,
    moduleChance: policy.moduleChance,
  };
  receipt.sovereignsGranted = sovereigns;
  receipt.warrants = baseWarrants + killWarrants;
  if (sovereigns > 0) account.sovereigns = safeAdd(account.sovereigns ?? 0, sovereigns);
  if (receipt.warrants > 0)
    await tx.creditWarrants(
      facts.accountId,
      receipt.warrants,
      'match_reward',
      facts.matchId,
      facts.occurredAt,
    );
  if (eligible && (await tx.drops.claim(facts.matchId, facts.accountId))) {
    receipt.dropOdds = {
      chance: policy.moduleChance,
      pity: 0,
      forced: false,
      tablesHash: createHash('sha256').update(JSON.stringify(policy)).digest('hex'),
    };
    receipt.drop = null;
    if (roll() < policy.moduleChance) {
      const total = policy.modulePool.reduce((sum, item) => sum + item.weight, 0);
      let value = roll() * total;
      const chosen = policy.modulePool.find((item) => (value -= item.weight) < 0)!;
      const itemId = `drop:${facts.matchId}:${facts.accountId}`;
      await tx.arsenal.grant({
        itemId,
        accountId: facts.accountId,
        kind: 'module',
        form: 'blueprint',
        defId: chosen.defId,
        soulbound: false,
        origin: 'drop',
        acquiredAt: facts.occurredAt,
      });
      account.itemSources[itemId] = { source: 'match', sourceId: receipt.id };
      receipt.itemIds = [itemId];
      receipt.drop = { kind: 'module', defId: chosen.defId, forced: false };
    }
  }
  return { materials, eligible };
}

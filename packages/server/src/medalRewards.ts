import { earnedMedalGrades, type MedalRewardGrant } from '@void/protocol';
import { medalReward, type MetaEconomy } from './metaEconomy';
import type { MetaEconomyCatalog } from './metaEconomyCatalog';
import type { ProfileStore } from './profileStore';
import type { CommanderStore } from './store';

export interface MedalRewardDeps {
  profiles: Pick<ProfileStore, 'progress'>;
  commanders: Pick<CommanderStore, 'creditMatch'>;
  economy: Pick<MetaEconomy, 'unpaidMedals' | 'claimMedals'>;
  table: MetaEconomyCatalog['medals'];
}

/**
 * Pays every profile medal degree the account has reached and not been paid for: Sovereigns,
 * Warrants and commander XP (owner's order 2026-10-24: all medals pay all three; medals
 * earned without playing pay Sovereigns only). Degrees reached before rewards existed are
 * paid on the first call too.
 *
 * Two stores hold the value, so the order makes a retry safe: XP first, per degree, under
 * its own idempotency key; then the economy marks the degrees paid and credits the
 * currencies in one transaction. A failure between them leaves the degrees unpaid, and
 * the retry's XP credits are no-ops.
 */
export async function settleMedalRewards(
  deps: MedalRewardDeps,
  accountId: string,
): Promise<MedalRewardGrant[]> {
  const earned = earnedMedalGrades(await deps.profiles.progress(accountId));
  const unpaid = await deps.economy.unpaidMedals(accountId, earned);
  if (unpaid.length === 0) return [];
  for (const ref of unpaid) {
    const { xp } = medalReward(deps.table, ref);
    if (xp > 0)
      await deps.commanders.creditMatch(`medal-xp:${accountId}:${ref.medalId}:${ref.grade}`, [
        { accountId, xp },
      ]);
  }
  const result = await deps.economy.claimMedals(accountId, unpaid);
  if (!result.ok) throw new Error(result.code);
  return result.receipt.medals ?? [];
}

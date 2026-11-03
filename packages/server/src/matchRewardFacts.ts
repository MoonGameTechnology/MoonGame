import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { MatchRewardPlayer, MatchRewardProgress } from './matchRewardProgress';
import { matchRewardPolicySchema } from './matchRewardPolicy';

const counter = z.number().int().min(0).max(1_000_000_000);
export const finalRewardFactsSchema = z
  .object({
    policy: matchRewardPolicySchema,
    reason: z.enum(['active', 'eliminated', 'inactive', 'no-contribution']),
    score: counter,
    kills: counter,
    veteranPoints: counter,
    seed: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type FinalRewardFacts = z.infer<typeof finalRewardFactsSchema>;

export function finalRewardFacts(
  ledger: MatchRewardProgress,
  row: MatchRewardPlayer | undefined,
  contribution: number,
  timeScale: number,
  endedAt: number,
): FinalRewardFacts {
  const policy = ledger.policy;
  const end = row?.endedAt ?? endedAt;
  const duration = Math.max(0, end - (row?.startedAt ?? end));
  const scale = Number.isFinite(timeScale) && timeScale > 0 ? timeScale : 1;
  const window = Math.min(
    duration,
    policy.maxAbsenceMs * scale,
    Math.max(duration * policy.finalPresence, policy.presenceGraceMs * scale),
  );
  const present =
    row?.lastOrderAt !== undefined && row.lastOrderAt >= end - window && row.lastOrderAt <= end;
  const meaningful =
    !!row && row.orders >= policy.minimumOrders && contribution >= policy.minimumContribution;
  return {
    policy: structuredClone(policy),
    reason: !meaningful
      ? 'no-contribution'
      : !present
        ? 'inactive'
        : row?.eliminated
          ? 'eliminated'
          : 'active',
    score: row?.peakScore ?? 0,
    kills: row?.kills ?? 0,
    veteranPoints: row?.veteranPoints ?? 0,
    // Committed in the immutable delivery envelope before any roll. Retries reuse it.
    seed: randomBytes(32).toString('hex'),
  };
}

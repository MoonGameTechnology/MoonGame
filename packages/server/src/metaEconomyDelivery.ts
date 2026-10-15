import { createHash } from 'node:crypto';
import type { GameState } from '@void/shared-core';
import type { EconomyObservation } from './store/types';
import {
  captureEconomyObservations,
  economyObservation as observation,
  economyObservationKey,
} from './metaEconomyObservation';
import type { MatchRewardFacts } from './metaEconomy';
import type { MetaEconomyStore } from './metaEconomyStore';
import type { MatchSnapshot, MatchStore } from './store';
import type { SeatAccounts } from './commanderCredit';
import type { MetaEconomyCatalog } from './metaEconomyCatalog';

type Metrics = Record<'recon' | 'logistics' | 'defense' | 'objectives', number>;
const fingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Conservative facts from a committed server snapshot. Initial visibility,
 *  starting buildings, passive score and participation XP grant nothing. */
export function operationProgress(
  state: GameState,
  player: string,
  baseline: EconomyObservation,
  verified: Partial<Metrics> = {},
): Metrics {
  const current = observation(state, player);
  const since = state.players[player]?.claimedAt ?? state.startedAt ?? 0;
  const captured = Object.values(state.missionFacts?.held ?? {}).filter(
    (held) => held.owner === player && held.since >= since,
  ).length;
  return {
    recon: current.known.filter((world) => !baseline.known.includes(world)).length,
    logistics:
      Math.max(0, current.evacuated - baseline.evacuated) +
      Math.max(0, current.rescued - baseline.rescued) +
      Math.max(
        current.buildings.filter((building) => !baseline.buildings.includes(building)).length,
        verified.logistics ?? 0,
      ),
    defense: Math.max(0, current.battles - baseline.battles, verified.defense ?? 0),
    objectives: Math.max(captured, verified.objectives ?? 0),
  };
}

export interface MetaRewardDeliveryDeps {
  store: MetaEconomyStore;
  matches: MatchStore;
  seats(matchId: string): SeatAccounts;
  settle(facts: MatchRewardFacts): Promise<{ ok: boolean; code?: string }>;
  stageCount: number;
  participation?: MetaEconomyCatalog['rewards']['participation'];
  now?: () => number;
  onError(error: unknown): void;
}

/** Saved snapshots are the durable delivery source. Baselines and issued fact
 *  envelopes are persisted before settlement: a crash in between leaves retryable
 *  facts, never an already-consumed reward claim. Nothing is sent by the client. */
export function createMetaRewardDelivery(deps: MetaRewardDeliveryDeps): {
  matches: MatchStore;
  deliver(snapshot: MatchSnapshot): Promise<void>;
  sweep(): Promise<void>;
  start(): void;
  stop(): Promise<void>;
} {
  const now = deps.now ?? Date.now;
  const thresholds = deps.participation ?? {
    reconPerPoint: 3,
    logisticsPerPoint: 2,
    defensePerPoint: 1,
    objectivesPerPoint: 1,
    stagePoints: [1, 3],
  };
  let cursor = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  let scanning: Promise<void> | undefined;
  const inflight = new Map<string, Promise<void>>();
  const deliver = async (snapshot: MatchSnapshot): Promise<void> => {
    const { state, matchId } = snapshot;
    // Sector Zero runs are client-local and never delivered by either host.
    // This additional guard also keeps imported run snapshots out of main economy.
    if (state.modeId === 'sector-zero' || state.modeId === 'sector_zero') return;
    const seats = await deps.seats(matchId)();
    for (const [player, accountId] of Object.entries(seats)) {
      const seat = state.players[player];
      if (!seat?.seated || seat.npc || seat.ai) continue;
      const scope = JSON.stringify([matchId, accountId, player, seat.claimedAt ?? 0]);
      // Settlement identity is account+match; reclaiming a seat must replay the
      // same immutable facts instead of issuing a different envelope for its key.
      const rewardScope = JSON.stringify([matchId, accountId]);
      const facts = await deps.store.transaction([accountId], async (tx) => {
        const baselineKey = `observation:${scope}`;
        const saved = await tx.receipt(baselineKey);
        const baseline =
          snapshot.economyObservations?.[economyObservationKey(player, seat.claimedAt ?? 0)] ??
          (saved?.response as EconomyObservation | undefined);
        if (!baseline)
          await tx.saveReceipt(baselineKey, 'observation-v1', observation(state, player));
        const activityCount = (role: keyof Metrics): number =>
          snapshot.economyActivity?.[JSON.stringify([player, seat.claimedAt ?? 0, role])]?.length ??
          0;
        const progress = operationProgress(state, player, baseline ?? observation(state, player), {
          logistics: activityCount('logistics'),
          defense: activityCount('defense'),
          objectives: activityCount('objectives'),
        });
        const output: MatchRewardFacts[] = [];
        // A role may qualify on its own. Natural async pauses and the Steward do
        // not erase a verified accomplishment; previous stage facts retain it.
        for (let stage = 1; stage <= deps.stageCount; stage++) {
          const key = `reward-facts:${rewardScope}:stage:${stage}`;
          const previous = await tx.receipt(key);
          if (previous) {
            const stored = previous.response as MatchRewardFacts;
            for (const metric of Object.keys(progress) as Array<keyof Metrics>)
              progress[metric] = Math.max(progress[metric], stored.seasonFacts?.[metric] ?? 0);
            output.push(stored);
            continue;
          }
          const points =
            Math.floor(progress.recon / thresholds.reconPerPoint) +
            Math.floor(progress.logistics / thresholds.logisticsPerPoint) +
            Math.floor(progress.defense / thresholds.defensePerPoint) +
            Math.floor(progress.objectives / thresholds.objectivesPerPoint);
          if (points < (thresholds.stagePoints[stage - 1] ?? Infinity)) continue;
          const entry: MatchRewardFacts = {
            matchId,
            accountId,
            kind: 'stage',
            stage,
            participation: true,
            seasonFacts: { ...progress },
            occurredAt: snapshot.clock?.wallTime ?? now(),
          };
          await tx.saveReceipt(key, fingerprint(entry), entry);
          output.push(entry);
        }
        const reward = state.match.rewards?.[player];
        if (state.match.status === 'ended' && reward && output.length > 0) {
          const key = `reward-facts:${rewardScope}:final`;
          const existing = await tx.receipt(key);
          if (existing) output.push(existing.response as MatchRewardFacts);
          else {
            const final: MatchRewardFacts = {
              matchId,
              accountId,
              kind: 'final',
              place: reward.place,
              participation: true,
              seasonFacts: { ...progress },
              occurredAt: snapshot.clock?.wallTime ?? now(),
            };
            await tx.saveReceipt(key, fingerprint(final), final);
            output.push(final);
          }
        }
        return output;
      });
      for (const fact of facts) {
        const result = await deps.settle(fact);
        if (!result.ok) throw new Error(result.code ?? 'E_META_SETTLEMENT');
      }
    }
  };
  const schedule = (matchId: string): void => {
    if (inflight.has(matchId) || inflight.size >= 256) return; // sweep recovers coalesced work
    const job = (async () => {
      const committed = await deps.matches.load(matchId);
      if (committed) await deliver(committed);
    })()
      .catch(deps.onError)
      .finally(() => {
        inflight.delete(matchId);
      });
    inflight.set(matchId, job);
  };
  const sweep = (): Promise<void> => {
    if (scanning) return scanning;
    scanning = (async () => {
      const ids = (await deps.matches.economyMatchIds?.(cursor, 100)) ?? [];
      if (ids.length === 0) {
        cursor = '';
        return;
      }
      for (const matchId of ids) {
        try {
          const snapshot = await deps.matches.load(matchId);
          if (snapshot) await deliver(snapshot);
        } catch (error) {
          deps.onError(error);
        }
        cursor = matchId;
      }
      if (ids.length < 100) cursor = '';
    })().finally(() => {
      scanning = undefined;
    });
    return scanning;
  };
  const matches: MatchStore = {
    load: (id) => deps.matches.load(id),
    save: async (snapshot) => {
      const economyObservations = {
        ...captureEconomyObservations(snapshot.state),
        ...snapshot.economyObservations,
      };
      await deps.matches.save({
        ...snapshot,
        ...(Object.keys(economyObservations).length ? { economyObservations } : {}),
      });
      schedule(snapshot.matchId);
    },
    ongoingMatchIds: () => deps.matches.ongoingMatchIds(),
    ...(deps.matches.economyMatchIds
      ? {
          economyMatchIds: (after?: string, limit?: number) =>
            deps.matches.economyMatchIds!(after, limit),
        }
      : {}),
    ...(deps.matches.ping ? { ping: () => deps.matches.ping!() } : {}),
    ...(deps.matches.close ? { close: () => deps.matches.close!() } : {}),
  };
  return {
    matches,
    deliver,
    sweep,
    start: () => {
      if (timer) return;
      void sweep().catch(deps.onError);
      timer = setInterval(() => {
        void sweep().catch(deps.onError);
      }, 30_000);
      timer.unref();
    },
    stop: async () => {
      if (timer) clearInterval(timer);
      timer = undefined;
      await scanning;
      await Promise.all(inflight.values());
    },
  };
}

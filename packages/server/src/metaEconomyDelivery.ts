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
import { commitMatch } from './matchCommit';
import type { SeatAccounts } from './commanderCredit';
import type { MetaEconomyCatalog } from './metaEconomyCatalog';

type Metrics = Record<'recon' | 'logistics' | 'defense' | 'objectives', number>;
type Participation = MetaEconomyCatalog['rewards']['participation'];
const DAY = 86_400_000;
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
  /** Independent idempotent career projection, retried by the same bounded sweep. */
  career?(snapshot: MatchSnapshot): Promise<void>;
  participation?: Participation;
  /** Season XP for one UTC day of the account's own orders (idempotent per account+day). */
  activeDay?(accountId: string, day: number): Promise<{ ok: boolean; code?: string }>;
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
  // Without a catalog (tests, older wiring) presence is not required.
  const thresholds: Omit<Participation, 'stageDays' | 'finalPresence'> & Partial<Participation> =
    deps.participation ?? {
      reconPerPoint: 3,
      logisticsPerPoint: 2,
      defensePerPoint: 1,
      objectivesPerPoint: 1,
      stagePoints: [1, 3],
    };
  // Days already credited by this process; the command receipt is the durable guard.
  const creditedDays = new Set<string>();
  let cursor = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  let scanning: Promise<void> | undefined;
  const inflight = new Map<string, Promise<void>>();
  const deliver = async (snapshot: MatchSnapshot): Promise<void> => {
    const { state, matchId } = snapshot;
    // Sector Zero runs are client-local and never delivered by either host.
    // This additional guard also keeps imported run snapshots out of main economy.
    if (state.modeId === 'sector-zero' || state.modeId === 'sector_zero') return;
    if (state.match.status === 'ended' && snapshot.career && deps.career) {
      try { await deps.career(snapshot); } catch (error) { deps.onError(error); }
    }
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
        const activity = (role: string): string[] =>
          snapshot.economyActivity?.[JSON.stringify([player, seat.claimedAt ?? 0, role])] ?? [];
        const activityCount = (role: keyof Metrics): number => activity(role).length;
        const orderDays = [...new Set(activity('orders'))].map(Number).filter(Number.isSafeInteger);
        const progress = operationProgress(state, player, baseline ?? observation(state, player), {
          logistics: activityCount('logistics'),
          defense: activityCount('defense'),
          objectives: activityCount('objectives'),
        });
        const output: MatchRewardFacts[] = [];
        const points = (): number =>
          Math.floor(progress.recon / thresholds.reconPerPoint) +
          Math.floor(progress.logistics / thresholds.logisticsPerPoint) +
          Math.floor(progress.defense / thresholds.defensePerPoint) +
          Math.floor(progress.objectives / thresholds.objectivesPerPoint);
        // A role may qualify on its own. Natural async pauses and the Steward do
        // not erase a verified accomplishment; previous stage facts retain it.
        // Each stage also needs that many distinct days of the player's own orders,
        // so taking a seat, scoring a stage in minutes and leaving pays nothing.
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
          if (
            points() < (thresholds.stagePoints[stage - 1] ?? Infinity) ||
            orderDays.length < (thresholds.stageDays?.[stage - 1] ?? 0)
          )
            continue;
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
        // The final needs a verified accomplishment and the player's own orders in the
        // closing share of their tenure (claim → elimination or match end): a seat left
        // to the bots does not collect the full budget when the match ends.
        const present = (): boolean => {
          if (thresholds.finalPresence === undefined) return true;
          const start = seat.claimedAt ?? state.startedAt ?? 0;
          const eliminated = activity('eliminated').map(Number).filter(Number.isFinite);
          const end =
            eliminated.length > 0 ? Math.min(...eliminated) : (state.match.endedAt ?? state.time);
          const from = end - Math.max(0, end - start) * thresholds.finalPresence;
          return orderDays.some((day) => (day + 1) * DAY > from);
        };
        const reward = state.match.rewards?.[player];
        if (state.match.status === 'ended' && reward) {
          const key = `reward-facts:${rewardScope}:final`;
          const existing = await tx.receipt(key);
          if (existing) output.push(existing.response as MatchRewardFacts);
          else if (points() >= (thresholds.stagePoints[0] ?? Infinity) && present()) {
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
      if (!deps.activeDay) continue;
      const utcDays =
        snapshot.economyActivity?.[JSON.stringify([player, seat.claimedAt ?? 0, 'ordersUtc'])];
      for (const day of (utcDays ?? []).map(Number).filter(Number.isSafeInteger)) {
        const credited = JSON.stringify([accountId, day]);
        if (creditedDays.has(credited)) continue;
        const result = await deps.activeDay(accountId, day);
        if (!result.ok) throw new Error(result.code ?? 'E_META_SETTLEMENT');
        if (creditedDays.size >= 100_000) creditedDays.clear();
        creditedDays.add(credited);
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
  const withObservations = (snapshot: MatchSnapshot): MatchSnapshot => {
    const economyObservations = {
      ...captureEconomyObservations(snapshot.state),
      ...snapshot.economyObservations,
    };
    return {
      ...snapshot,
      ...(Object.keys(economyObservations).length ? { economyObservations } : {}),
    };
  };
  const matches: MatchStore = {
    load: (id) => deps.matches.load(id),
    save: async (snapshot) => {
      await deps.matches.save(withObservations(snapshot));
      schedule(snapshot.matchId);
    },
    saveWithReceipt: async (snapshot, receipt, receipts) => {
      await commitMatch(deps.matches, receipts, withObservations(snapshot), receipt);
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

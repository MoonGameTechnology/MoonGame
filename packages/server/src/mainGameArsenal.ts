import { createHash } from 'node:crypto';
import {
  playablePlayerIds,
  type GameData,
  type GameState,
  type PlayerArsenal,
} from '@void/shared-core';
import { arsenalSnapshotOf } from './arsenal';
import type { RoomRegistry } from './roomRegistry';
import type { AccountStore, ArsenalStore } from './store';

/** Everything the ownership gate can ask about: every non-ground hull and every
 *  module. Ground units bypass the gate, so listing them would only grow the snapshot. */
export function fullCatalogArsenal(data: Pick<GameData, 'units' | 'modules'>): PlayerArsenal {
  return {
    hulls: Object.entries(data.units)
      .filter(([, unit]) => unit.domain !== 'ground')
      .map(([id]) => id)
      .sort(),
    modules: Object.keys(data.modules).sort(),
  };
}

/** Call only when creating a new authenticated main-game match. Historical
 * unrestricted matches and the independent Sector Zero loadout are not migrated.
 *
 * Every playable seat starts with the FULL catalog: until a human claims it, the
 * seat is a stand-in bot, and bots play without restrictions (owner decision
 * 2026-10-15, «Широкий старт»). The snapshot still has to exist — it marks the match
 * as ownership-gated, so the join's `syncAccountArsenal` replaces it with the
 * claiming account's own arsenal before the join token is issued. */
export function initializeOrdinaryArsenal(
  state: GameState,
  data: Pick<GameData, 'units' | 'modules'>,
): GameState {
  const next = structuredClone(state);
  const snapshot = fullCatalogArsenal(data);
  for (const playerId of playablePlayerIds(next)) {
    // NPC inhabitants retain their own roster.
    next.players[playerId]!.arsenal = structuredClone(snapshot);
  }
  return next;
}

export interface SyncAccountArsenalDeps {
  accountId: string;
  login: string;
  arsenal: ArsenalStore;
  accounts: Pick<AccountStore, 'seatOf'>;
  registry: Pick<RoomRegistry, 'ids' | 'get'>;
  /** The host owns the ordinary/AvA distinction; PvE main-game matches also qualify. */
  isOrdinary(matchId: string): boolean | Promise<boolean>;
  /** Pauses between attempts on a transient refusal; the default spans a few seconds.
   *  Tests pass `[]` or zeros. */
  retryDelaysMs?: readonly number[];
  sleep?(ms: number): Promise<void>;
}

/** The room's own transient refusals (see `MatchRoom.sendReject`): a full mailbox, a
 *  failed durable write, an unexpected throw. Anything else will not change on retry. */
const TRANSIENT = new Set(['E_RATE_LIMIT', 'E_UNAVAILABLE', 'E_INTERNAL']);
const RETRY_DELAYS_MS = [250, 1000, 3000];
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const pending = new WeakMap<ArsenalStore, Map<string, Promise<unknown>>>();

/** Refresh build ownership through the room mailbox after a committed economic
 * change or authenticated join. Existing units are never refitted. Serializing
 * reads per account prevents an older concurrent read replacing a newer grant.
 *
 * A revoke (a sold or salvaged module) must land even when the player has just used up
 * their own order budget, so the sync bypasses the per-player rate limit and retries
 * transient refusals. One room failing does not stop the others; the call still
 * rejects afterwards so the caller logs it and a join issues no token. */
export function syncAccountArsenal(deps: SyncAccountArsenalDeps): Promise<number> {
  let accounts = pending.get(deps.arsenal);
  if (!accounts) {
    accounts = new Map();
    pending.set(deps.arsenal, accounts);
  }
  const delays = deps.retryDelaysMs ?? RETRY_DELAYS_MS;
  const sleep = deps.sleep ?? wait;
  const run = async (): Promise<number> => {
    const fresh = arsenalSnapshotOf(await deps.arsenal.listOf(deps.accountId));
    const fingerprint = createHash('sha256').update(JSON.stringify(fresh)).digest('hex');
    let synced = 0;
    const failures: string[] = [];
    for (const matchId of deps.registry.ids()) {
      const room = deps.registry.get(matchId);
      if (!room || room.state.match.status === 'ended' || !(await deps.isOrdinary(matchId)))
        continue;
      const playerId = await deps.accounts.seatOf(matchId, deps.login);
      if (!playerId || deps.registry.get(matchId) !== room) continue;
      // Re-read on every attempt: the room may have ended, been evicted, or already
      // taken this snapshot through another path while we waited.
      const gone = (): boolean =>
        deps.registry.get(matchId) !== room || room.state.match.status === 'ended';
      for (let attempt = 0; ; attempt++) {
        if (gone()) break;
        const player = room.state.players[playerId];
        if (!player?.arsenal || player.npc) break;
        if (
          JSON.stringify({ hulls: player.arsenal.hulls, modules: player.arsenal.modules }) ===
          JSON.stringify(fresh)
        )
          break;
        const result = await room.submitServerAction(
          playerId,
          {
            id: `srv:meta-arsenal:${playerId}:${room.sequence}:${fingerprint}`,
            type: 'arsenal.sync',
            playerId,
            payload: fresh,
            issuedAt: room.state.time,
          },
          undefined,
          { throttle: false },
        );
        if (result.ok) {
          synced++;
          break;
        }
        const code = result.code ?? 'E_INTERNAL';
        if (!TRANSIENT.has(code) || attempt >= delays.length) {
          failures.push(code);
          break;
        }
        await sleep(delays[attempt]!);
      }
    }
    if (failures.length > 0) throw Error(failures[0]);
    return synced;
  };
  const previous = accounts.get(deps.accountId) ?? Promise.resolve();
  const result = previous.then(run, run);
  accounts.set(deps.accountId, result);
  void result
    .finally(() => {
      if (accounts!.get(deps.accountId) === result) accounts!.delete(deps.accountId);
    })
    .catch(() => undefined);
  return result;
}

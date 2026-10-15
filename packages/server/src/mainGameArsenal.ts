import { createHash } from 'node:crypto';
import { playablePlayerIds, type GameState } from '@void/shared-core';
import { arsenalSnapshotOf, type StarterArsenalTemplate } from './arsenal';
import type { RoomRegistry } from './roomRegistry';
import type { AccountStore, ArsenalStore } from './store';

/** Call only when creating a new authenticated main-game match. Historical
 * unrestricted matches and the independent Sector Zero loadout are not migrated. */
export function initializeOrdinaryArsenal(
  state: GameState,
  starterTemplates: readonly StarterArsenalTemplate[],
): GameState {
  const next = structuredClone(state);
  const snapshot = {
    hulls: [
      ...new Set(starterTemplates.filter((item) => item.kind === 'hull').map((item) => item.defId)),
    ].sort(),
    modules: [
      ...new Set(
        starterTemplates.filter((item) => item.kind === 'module').map((item) => item.defId),
      ),
    ].sort(),
  };
  for (const playerId of playablePlayerIds(next)) {
    // Stand-in bots are claimable seats. NPC inhabitants retain their own roster.
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
}

const pending = new WeakMap<ArsenalStore, Map<string, Promise<unknown>>>();

/** Refresh build ownership through the room mailbox after a committed economic
 * change or authenticated join. Existing units are never refitted. Serializing
 * reads per account prevents an older concurrent read replacing a newer grant. */
export function syncAccountArsenal(deps: SyncAccountArsenalDeps): Promise<number> {
  let accounts = pending.get(deps.arsenal);
  if (!accounts) {
    accounts = new Map();
    pending.set(deps.arsenal, accounts);
  }
  const run = async (): Promise<number> => {
    const fresh = arsenalSnapshotOf(await deps.arsenal.listOf(deps.accountId));
    const fingerprint = createHash('sha256').update(JSON.stringify(fresh)).digest('hex');
    let synced = 0;
    for (const matchId of deps.registry.ids()) {
      const room = deps.registry.get(matchId);
      if (!room || room.state.match.status === 'ended' || !(await deps.isOrdinary(matchId)))
        continue;
      const playerId = await deps.accounts.seatOf(matchId, deps.login);
      if (!playerId || deps.registry.get(matchId) !== room) continue;
      const player = room.state.players[playerId];
      if (!player?.arsenal || player.npc) continue;
      if (
        JSON.stringify({ hulls: player.arsenal.hulls, modules: player.arsenal.modules }) ===
        JSON.stringify(fresh)
      )
        continue;
      const result = await room.submitServerAction(playerId, {
        id: `srv:meta-arsenal:${playerId}:${room.sequence}:${fingerprint}`,
        type: 'arsenal.sync',
        playerId,
        payload: fresh,
        issuedAt: room.state.time,
      });
      if (!result.ok) throw Error(result.code ?? 'E_INTERNAL');
      synced++;
    }
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

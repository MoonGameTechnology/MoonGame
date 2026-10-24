import { coalitionCapacity, coalitionOf, coalitionWallNow, hasFixedSides, type GameState } from '../packages/shared-core/src/index';

/** The server validates the intent again; this only controls the session button. */
export function canCreateCoalition(state: GameState, playerId: string): boolean {
  const player = state.players[playerId];
  return (
    !!player &&
    player.status === 'active' &&
    !player.ai &&
    !player.npc &&
    !hasFixedSides(state.modeId) &&
    !coalitionOf(state, playerId) &&
    (state.coalitionJoinAfter?.[playerId] ?? 0) <= coalitionWallNow(state)
  );
}

/** Diplomacy does not constrain invitations; membership and departure timers do. */
export function coalitionInviteBlock(state: GameState, playerId: string, target: string): string | null {
  const actor = state.players[playerId];
  const other = state.players[target];
  if (!actor || !other || playerId === target || actor.status !== 'active' || other.status !== 'active' || hasFixedSides(state.modeId))
    return 'err.forbidden';
  if (actor.ai || actor.npc || other.ai || other.npc) return 'comms.bots-no-coalition';
  const mine = coalitionOf(state, playerId);
  const theirs = coalitionOf(state, target);
  if (mine && theirs && mine.id === theirs.id) return null;
  const now = coalitionWallNow(state);
  if ((state.coalitionJoinAfter?.[playerId] ?? 0) > now || (state.coalitionJoinAfter?.[target] ?? 0) > now)
    return 'err.coalition-cooldown';
  if (mine?.departures?.[playerId] || theirs?.departures?.[target]) return 'err.coalition-leaving';
  if (mine && theirs) return 'err.coalition-other';
  const joining = mine ?? theirs;
  if (joining && joining.members.length >= coalitionCapacity(state)) return 'err.coalition-full';
  return null;
}

/** A founder can schedule another member's departure once. */
export function canKickCoalitionMember(state: GameState, playerId: string, target: string): boolean {
  const coalition = coalitionOf(state, playerId);
  return !!coalition && state.players[playerId]?.status === 'active' && !hasFixedSides(state.modeId) &&
    coalition.founder === playerId && target !== playerId &&
    coalition.members.includes(target) && !coalition.departures?.[playerId] && !coalition.departures?.[target];
}

/** Breaking a coalition treaty cannot skip its departure notice. */
export function coalitionTreatyLocked(state: GameState, playerId: string, target: string): boolean {
  const coalition = coalitionOf(state, playerId);
  return !!coalition && coalition.members.includes(target);
}

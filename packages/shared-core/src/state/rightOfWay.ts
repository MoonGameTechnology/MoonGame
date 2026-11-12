/**
 * Право прохода (D2) — общее правило для приказа «Курс» и точки сбора (RALLY-2): чья
 * территория закрыта игроку и какую закрытую территорию он ВИДИТ.
 */
import type { GameState, PlanetId, PlayerId } from './gameState';
import { getStance } from './diplomacy';
import { knownOwner } from './knownOwner';

/** Is `owner`'s territory closed to `playerId` — a player it is at PEACE with (D2)? */
export function closedTo(state: GameState, playerId: PlayerId, owner: PlayerId | null): boolean {
  return owner !== null && owner !== playerId && getStance(state, playerId, owner) === 'peace';
}

/** The world's REAL owner closes it to the mover — the rule the flight itself obeys. */
export function trulyClosed(state: GameState, playerId: PlayerId, id: PlanetId): boolean {
  return closedTo(state, playerId, state.planets[id]?.owner ?? null);
}

/**
 * FOG-LEAK (owner's report 2026-10-17): an ORDER is refused only for a border the
 * player can SEE — closed both on their own map (`knownOwner`) and in truth. Judged by
 * the real owner alone, «нет права прохода» to an unexplored province told the player
 * that somebody's territory lay there, and the solo war prompt even named whose.
 *
 * Requiring both halves keeps the order gate strictly MORE permissive than before:
 * nothing that used to pass is refused now, so bots and scripts lose no moves. A
 * border the player cannot see is met in flight instead (`haltAtBorder`).
 */
export function knownClosed(state: GameState, playerId: PlayerId, id: PlanetId): boolean {
  return (
    trulyClosed(state, playerId, id) && closedTo(state, playerId, knownOwner(state, playerId, id))
  );
}

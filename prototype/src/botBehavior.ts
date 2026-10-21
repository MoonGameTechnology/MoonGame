import { getStance, type Action, type GameState } from '../../packages/shared-core/src/index';
import { garrisonNeed } from '../../decisions/garrisonPolicy';
import { aiOrders } from './ai';
import { aiOrderSlices } from './aiOrderSlices';
import { data } from './gameData';

/** Host policy for permanent identities only. These are strategies, not difficulty
 * levels, and are never written to GameState or accepted from a client. */
export const BOT_STYLES = ['expansionist', 'defensive', 'economic'] as const;
export type BotStyle = (typeof BOT_STYLES)[number];

/** The catalogue seed survives seat rotation and process restarts. Do not derive
 * personality from the current seat, wall clock or a process-local random draw. */
export function botStyle(seed: number): BotStyle {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new Error('E_BOT_SEED');
  return BOT_STYLES[seed % BOT_STYLES.length]!;
}

/** Personality policy for an explicit, outstanding human offer. The room still
 * applies both sides through normal diplomacy rules and verifies the result.
 * Temperament is stable across restarts and never reads hidden opponent intel. */
export function botAcceptsOffer(
  state: GameState,
  bot: string,
  human: string,
  seed: number,
  stance: 'peace' | 'pact',
): boolean {
  if (!state.players[bot] || !state.players[human]) return false;
  const style = botStyle(seed);
  if (style === 'defensive') return true;
  if (style === 'economic') return stance === 'peace' || getStance(state, bot, human) === 'peace';
  return stance === 'peace' && seed % 2 === 0;
}

const MILITARY_EXPANSION = new Set(['shipyard', 'factory', 'fort', 'orbital_aa', 'zonal_aa']);

/** Retain ordinary planner intent and ordering. A cautious industrialist invests
 * in income/research instead of another peacetime navy or heavy military factory,
 * while still filling the existing garrison floor. War lifts this spending
 * restraint against a seated opponent. Unclaimed chairs and NPC hostility do not
 * turn an empty FFA into a permanent arms race. Local guard/evacuation orders and
 * basic garrison replacements remain available against every actual attacker. */
function economicSpending(state: GameState, seat: string, action: Action): boolean {
  if (action.type === 'unit.build') {
    const payload = action.payload as { planetId: string; unit: string };
    const planet = state.planets[payload.planetId];
    return (
      data.units[payload.unit]?.domain === 'ground' &&
      planet?.owner === seat &&
      garrisonNeed(planet, data) > 0
    );
  }
  if (action.type === 'building.construct' || action.type === 'building.upgrade') {
    const payload = action.payload as { building: string };
    return !MILITARY_EXPANSION.has(payload.building);
  }
  return true;
}

/** Return complete scheduler slices. Never filter/reorder individual commands:
 * retreat+course, split+course and future coupled commands travel together. The
 * authoritative room still validates every action at the instant it is applied. */
export function botBehaviorOrders(state: GameState, seat: string, seed: number): Action[][] {
  const style = botStyle(seed);
  const posture =
    style === 'expansionist' ? 'expand' : style === 'defensive' ? 'active_defend' : 'defend';
  const groups = aiOrderSlices(aiOrders(state, seat, posture));
  if (style !== 'economic') return groups;
  const atWar = Object.values(state.players).some(
    (player) =>
      player.id !== seat &&
      !player.npc &&
      player.seated === true &&
      player.status === 'active' &&
      getStance(state, seat, player.id) === 'war',
  );
  return atWar
    ? groups
    : groups.filter((group) => group.every((a) => economicSpending(state, seat, a)));
}

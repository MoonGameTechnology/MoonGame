import type { DomainEvent, GameState } from '@void/shared-core';

/** Each role/claim retains at most this many distinct accomplishments. Beyond reward
 * thresholds, additional IDs must not keep growing a weeks-long server snapshot. */
export const MAX_META_ACTIVITY_FACTS_PER_ROLE = 256;
const validId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256;
const validDamage = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const DAY = 86_400_000;
/** `orders` — game days and `ordersUtc` — UTC days on which the player's own client
 *  order was applied; `eliminated` — game time the seat lost its last world. Presence
 *  evidence for stage/final rewards and the daily season XP (metaEconomyDelivery). */
type ActivityRole = 'defense' | 'logistics' | 'objectives' | 'orders' | 'ordersUtc' | 'eliminated';

/** An order the player sent from their own client and the world applied. AI, Steward
 *  and host bookkeeping submit without a client, so they never count as presence. */
export interface OwnOrder {
  playerId: string;
  /** Game time the order was applied at. */
  at: number;
  /** Wall-clock time of the commit (ms), for UTC days. */
  wall: number;
}

/** Server-only facts from authoritative engine events, retained after troops, buildings
 * or captured planets are lost. Pass state BEFORE the event batch: a newly claimed AI
 * seat must not inherit the bot's accomplishments from the same batch. */
export function captureMetaEconomyActivity(
  existing: Record<string, string[]> | undefined,
  events: readonly DomainEvent[],
  state: GameState,
  order?: OwnOrder,
): Record<string, string[]> {
  const facts: Record<string, string[]> = Object.fromEntries(
    Object.entries(existing ?? {}).map(([scope, ids]) => [
      scope,
      // Building identities contain two JSON-escaped IDs and a level, hence a larger
      // bound than an individual engine ID. The number of retained facts stays capped.
      [
        ...new Set(
          ids.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 4096),
        ),
      ].slice(0, MAX_META_ACTIVITY_FACTS_PER_ROLE),
    ]),
  );
  const add = (playerId: unknown, role: ActivityRole, id: string): void => {
    if (!validId(playerId)) return;
    const player = state.players[playerId];
    if (!player?.seated || player.npc || player.ai) return;
    const scope = JSON.stringify([playerId, player.claimedAt ?? 0, role]);
    const ids = facts[scope] ?? (facts[scope] = []);
    if (ids.length < MAX_META_ACTIVITY_FACTS_PER_ROLE && !ids.includes(id)) ids.push(id);
  };
  // A match lasts at most 100 game days, so day sets stay under the per-role bound.
  if (order && Number.isFinite(order.at) && Number.isFinite(order.wall)) {
    add(order.playerId, 'orders', String(Math.floor(order.at / DAY)));
    add(order.playerId, 'ordersUtc', String(Math.floor(order.wall / DAY)));
  }
  for (const event of events) {
    const payload = event.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue;
    const value = payload as Record<string, unknown>;
    if (event.type === 'combat.round') {
      if (
        !validId(value.battleId) ||
        !Number.isSafeInteger(value.round) ||
        (value.round as number) <= 0 ||
        !validDamage(value.dmgToAttacker) ||
        !validDamage(value.dmgToDefender) ||
        (value.dmgToAttacker === 0 && value.dmgToDefender === 0)
      )
        continue;
      add(value.defender, 'defense', value.battleId);
    } else if (event.type === 'building.constructed' || event.type === 'building.upgraded') {
      if (!validId(value.planetId) || !validId(value.building)) continue;
      const level = event.type === 'building.constructed' ? 1 : value.level;
      if (
        !Number.isSafeInteger(level) ||
        (level as number) < (event.type === 'building.constructed' ? 1 : 2)
      )
        continue;
      // These events carry neither instance UID nor completion time. Deliberately
      // count each planet/type/level once, so demolishing and rebuilding cannot farm XP.
      add(
        value.owner,
        'logistics',
        JSON.stringify(['building', value.planetId, value.building, level]),
      );
    } else if (event.type === 'planet.captured') {
      if (
        !validId(value.planetId) ||
        value.from === value.owner ||
        (value.from !== undefined && value.from !== null && !validId(value.from))
      )
        continue;
      add(value.owner, 'objectives', value.planetId);
    } else if (event.type === 'player.eliminated') {
      // Events carry no time: the batch's start bounds it from below, which only ever
      // moves the end of the seat's tenure earlier, in the player's favour.
      add(value.playerId, 'eliminated', String(state.time));
    }
  }
  return facts;
}

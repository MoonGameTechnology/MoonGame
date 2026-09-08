import type { Battle, BattleSide, GameState, Hero, PlanetId } from './gameState';

/**
 * Shared pure hero/battle reads for the hero-family modules (`hero`,
 * `heroEffects`). They live in the neutral state layer so a provider module
 * never has to import another module for them (invariant #3) — and so the
 * semantics can't fork across copies (a `heroNode` clone with swapped
 * parameters used to live in heroEffects).
 */

/** The node a hero acts from (HERO-2 — the hero's position IS its ship): the fleet's
 *  current node while deployed; mid-flight (`location: null`) or shipless it falls back
 *  to `Hero.location` — the last confirmed node, synced on transit/arrival and doubling
 *  as the respawn anchor after `home`. */
/** Герой, ведущий этот флот (его корабль), если он там есть.
 *
 *  Живёт в `state/`, а не в модуле героев, ПОТОМУ ЧТО читателей двое и они в разных
 *  модулях: `hero.ts` привязывает смерть к герою, `fleetOps.ts` держит на слиянии
 *  инвариант «каждый герой ведёт свой флот». Модуль модулю не импортируется
 *  (инвариант #3), а чистый читатель по состоянию — не модуль.
 *
 *  Порядок обхода стабилен по вставке; `undefined`-гард держит частый безгеройский
 *  случай без аллокаций — это ходит на каждом `fleet.transit`/`arrived` и на обоих
 *  сигналах смерти. */
export function heroByFleet(state: GameState, fleetId: string): Hero | undefined {
  if (state.heroes === undefined) return undefined;
  return Object.values(state.heroes).find((hero) => hero.fleetId === fleetId);
}

export function heroNode(state: GameState, hero: Hero): PlanetId {
  if (hero.fleetId) {
    const loc = state.fleets[hero.fleetId]?.location;
    if (typeof loc === 'string') return loc;
  }
  return hero.location;
}

/** The FLEET side dealing this `combat.damage` hit, or null when the hook args
 *  don't resolve to one (malformed args, unknown battle, or a garrison side —
 *  hero auras are fleet bonuses only). `args.attacker` is the owner DEALING the
 *  hit, so buffing that side covers both its attack and its return-fire defense.
 *  The one copy of the preamble both hero-family `combat.damage` hooks share. */
export function fleetSideDealingHit(
  state: GameState,
  battleId: unknown,
  attacker: unknown,
): { battle: Battle; side: BattleSide & { ref: { kind: 'fleet'; fleetId: string } } } | null {
  if (typeof battleId !== 'string' || typeof attacker !== 'string') return null;
  const battle = state.battles[battleId];
  if (!battle) return null;
  const side = battle.attacker.owner === attacker ? battle.attacker : battle.defender;
  if (side.ref.kind !== 'fleet') return null;
  return { battle, side: side as BattleSide & { ref: { kind: 'fleet'; fleetId: string } } };
}

/** The FLEET side TAKING this `combat.damage` hit, or null when the args don't resolve
 *  to one. The mirror of {@link fleetSideDealingHit}: `args.defender` is the owner the
 *  damage lands on, so a modifier keyed off this side is INCOMING damage for it. Fleet
 *  sides only, same reason as its twin — the hero family buffs fleets, not garrisons. */
export function fleetSideTakingHit(
  state: GameState,
  battleId: unknown,
  defender: unknown,
): { battle: Battle; side: BattleSide & { ref: { kind: 'fleet'; fleetId: string } } } | null {
  if (typeof battleId !== 'string' || typeof defender !== 'string') return null;
  const battle = state.battles[battleId];
  if (!battle) return null;
  const side = battle.defender.owner === defender ? battle.defender : battle.attacker;
  if (side.owner !== defender || side.ref.kind !== 'fleet') return null;
  return { battle, side: side as BattleSide & { ref: { kind: 'fleet'; fleetId: string } } };
}

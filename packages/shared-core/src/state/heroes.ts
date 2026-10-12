import type { GameState, Hero, PlanetId } from './gameState';
import type { GameData } from '../data/schemas';

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

/** Пал ли БОСС насовсем (PVR-4.7): архетип `boss` и корабль потерян. Смерть босса
 *  окончательна — возрождения нет ни по таймеру, ни приказом, — поэтому такого героя не
 *  поднимают, не оснащают и не учат. Читателей двое: модуль героев (гейт `hero.spawn`)
 *  и бот, который иначе слал бы заведомо отбиваемые приказы. */
export function bossFallen(hero: Hero, data: Pick<GameData, 'heroes'>): boolean {
  return (
    hero.alive === false &&
    hero.archetype !== undefined &&
    data.heroes[hero.archetype]?.boss === true
  );
}

export function heroNode(state: GameState, hero: Hero): PlanetId {
  if (hero.fleetId) {
    const loc = state.fleets[hero.fleetId]?.location;
    if (typeof loc === 'string') return loc;
  }
  return hero.location;
}

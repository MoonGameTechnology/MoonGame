import type { SlotCounts } from '../util/loadout';
import type { GameData } from '../data/schemas';
import type { Hero, GameState } from './gameState';

export function heroFlagshipUnit(hero: Hero, data: GameData): string {
  return hero.flagship && data.units[hero.flagship]
    ? hero.flagship
    : defaultHeroFlagship(hero, data);
}
export function defaultHeroFlagship(hero: Hero, data: GameData): string {
  return (hero.archetype ? data.heroes[hero.archetype]?.ship.unit : undefined) ?? 'hero';
}
/** Selection is restricted to owned regular space hulls plus the archetype's original hull. */
export function heroFlagshipChoices(state: GameState, hero: Hero, data: GameData): string[] {
  const base = defaultHeroFlagship(hero, data);
  const owned = state.players[hero.owner]?.arsenal?.hulls;
  return [
    base,
    ...Object.keys(data.units).filter((id) => {
      const def = data.units[id]!;
      return (
        id !== base &&
        def.domain === 'space' &&
        !def.traits.some((t) => ['hero', 'shuttle', 'issued', 'immobile'].includes(t)) &&
        def.buildTimeHours > 0 &&
        (!owned || owned.includes(id))
      );
    }),
  ];
}

export function heroModuleSlots(hero: Hero, unit: string, data: GameData): SlotCounts {
  const hull = data.units[unit]?.slots;
  const bonus = hero.grade !== undefined ? data.heroGrades[hero.grade]?.moduleSlots : undefined;
  const own = hero.moduleSlots;
  return {
    weapon: (hull?.weapon ?? 0) + (bonus?.weapon ?? 0) + (own?.weapon ?? 0),
    defense: (hull?.defense ?? 0) + (bonus?.defense ?? 0) + (own?.defense ?? 0),
    utility: (hull?.utility ?? 0) + (bonus?.utility ?? 0) + (own?.utility ?? 0),
  };
}

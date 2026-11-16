import { describe, expect, it } from 'vitest';
import { techDepthRows, techIconKind } from './techTreeLayout';

describe('techDepthRows', () => {
  const pre: Record<string, string[]> = {
    a: [],
    b: [],
    c: ['b'],
    d: ['a'],
    e: ['c', 'outside'],
    f: ['outside'],
  };
  const rows = (ids: string[]) => techDepthRows(ids, (id) => pre[id] ?? []);

  it('кладёт узел на ряд по глубине внутри набора; чужой предок не опускает', () => {
    expect(rows(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual([['a', 'b', 'f'], ['d', 'c'], ['e']]);
  });

  it('сортирует ряд по месту предков в ряду выше', () => {
    // b стоит левее a — значит и его ребёнок c встаёт левее d
    expect(rows(['b', 'a', 'd', 'c'])).toEqual([['b', 'a'], ['c', 'd']]);
  });

  it('не зависает на кольце в данных', () => {
    const loop = techDepthRows(['x', 'y'], (id) => (id === 'x' ? ['y'] : ['x']));
    expect(loop.flat().sort()).toEqual(['x', 'y']);
  });
});

describe('techIconKind', () => {
  it('сначала то, что узел открывает', () => {
    expect(techIconKind({ unlocks: { abilities: ['steward'] } })).toBe('moon');
    expect(techIconKind({ unlocks: { units: ['cruise_missile'] } })).toBe('rocket');
    expect(techIconKind({ unlocks: { units: ['heavy_infantry'] } })).toBe('troop');
    expect(techIconKind({ unlocks: { units: ['cruiser'] } })).toBe('ship');
    expect(techIconKind({ branch: 'shuttle', unlocks: { units: ['gunship'] } })).toBe('craft');
    expect(techIconKind({ unlocks: { buildings: ['orbital_defense'] } })).toBe('shield');
    expect(techIconKind({ unlocks: { buildings: ['spaceport'] } })).toBe('bld');
  });

  it('потом главный эффект', () => {
    expect(techIconKind({ effects: { heroSlots: 1 } })).toBe('hero');
    expect(techIconKind({ effects: { controlLimit: 2 } })).toBe('flag');
    expect(techIconKind({ effects: { productionBonus: 0.1 } })).toBe('prod');
    expect(techIconKind({ effects: { combatDamageBonus: 0.1 } })).toBe('dmg');
    expect(techIconKind({ effects: { radarRangeBonus: 0.1 } })).toBe('radar');
    expect(techIconKind({ effects: { fleetSpeedBonus: 0.1 } })).toBe('speed');
    expect(techIconKind({ effects: { armyUpkeep: -0.1 } })).toBe('coin');
    expect(techIconKind({})).toBe('star');
  });
});

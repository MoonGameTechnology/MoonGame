import { describe, expect, it } from 'vitest';
import {
  type EffectTag,
  type FleetFacts,
  debtTagsShown,
  effectsShown,
  fleetEffects,
  hungerShown,
  pointDefenseShown,
  pointDefenseTotal,
} from './fleetEffects';

const calm = (over: Partial<FleetFacts> = {}): FleetFacts => ({
  owner: 'p1',
  inBattle: false,
  forcedMarch: false,
  bombarding: false,
  barrageFocus: false,
  freeFlight: false,
  patrol: null,
  troops: 0,
  pointDefense: 0,
  ...over,
});
const kinds = (tags: readonly EffectTag[]) => tags.map((t) => t.kind);

describe('pointDefenseTotal', () => {
  it('sums the defence across the stacks', () => {
    expect(
      pointDefenseTotal(
        [
          { unit: 'a', count: 2 },
          { unit: 'b', count: 3 },
        ],
        () => 4,
      ),
    ).toBe(20);
  });

  // Правило 4: пустая стопка остаётся в составе, но стволов у неё нет.
  it('ignores a stack with no ships left', () => {
    expect(
      pointDefenseTotal(
        [
          { unit: 'a', count: 0 },
          { unit: 'b', count: 2 },
        ],
        () => 5,
      ),
    ).toBe(10);
    expect(pointDefenseTotal([{ unit: 'a', count: -3 }], () => 5)).toBe(0);
  });

  // Незнакомый тип корабля — про его вооружение мы ничего не знаем.
  it('ignores a stack whose unit is not in the data', () => {
    expect(
      pointDefenseTotal([{ unit: 'ghost', count: 9 }], (st) => (st.unit === 'ghost' ? null : 1)),
    ).toBe(0);
  });

  it('is zero on an empty composition', () => {
    expect(pointDefenseTotal([], () => 7)).toBe(0);
  });
});

describe('debtTagsShown', () => {
  // Правило 1: долг — состояние моей казны, а не чужого флота.
  it('admits the debt tags only on my own fleet', () => {
    expect(debtTagsShown('p1', 'p1')).toBe(true);
    expect(debtTagsShown('p2', 'p1')).toBe(false);
  });
});

describe('hungerShown', () => {
  // Правило 2: голодают люди, а не корпуса.
  it('shows hunger only with troops aboard', () => {
    expect(hungerShown(['food'], 3)).toBe(true);
    expect(hungerShown(['food'], 0)).toBe(false);
  });

  it('stays silent while the food is paid for', () => {
    expect(hungerShown([], 3)).toBe(false);
    expect(hungerShown(['energy'], 3)).toBe(false);
  });
});

describe('pointDefenseShown / effectsShown', () => {
  // Правило 5: «🛡 0» читается как «защита есть».
  it('hides a zero point-defence tag', () => {
    expect(pointDefenseShown(0)).toBe(false);
    expect(pointDefenseShown(1)).toBe(true);
  });

  // Правило 6: пустая полоса выглядит как поломка загрузки.
  it('hides the whole strip when there is nothing to say', () => {
    expect(effectsShown([])).toBe(false);
    expect(effectsShown([{ kind: 'in-battle' }])).toBe(true);
  });
});

describe('fleetEffects', () => {
  it('says nothing about a calm fleet', () => {
    expect(fleetEffects(calm(), 'p1', [])).toEqual([]);
  });

  it('lists the states in the order the player reads them', () => {
    const tags = fleetEffects(
      calm({
        inBattle: true,
        forcedMarch: true,
        bombarding: true,
        barrageFocus: true,
        freeFlight: true,
        patrol: { rearming: 0, fuel: 4 },
        troops: 2,
        pointDefense: 7,
      }),
      'p1',
      ['energy', 'food'],
    );
    expect(kinds(tags)).toEqual([
      'in-battle',
      'forced-march',
      'bombarding',
      'barrage-focus',
      'free-flight',
      'patrol',
      'blackout',
      'hunger',
      'point-defense',
    ]);
  });

  // Правило 3: перевооружение вытесняет топливо.
  it('names rearming instead of fuel while the wing is rearming', () => {
    expect(fleetEffects(calm({ patrol: { rearming: 2, fuel: 9 } }), 'p1', [])).toEqual([
      { kind: 'patrol', rearming: 2 },
    ]);
    expect(fleetEffects(calm({ patrol: { rearming: 0, fuel: 9 } }), 'p1', [])).toEqual([
      { kind: 'patrol', fuel: 9 },
    ]);
  });

  // Правило 1 живьём: те же долги, чужой флот — ни одной долговой метки.
  it('keeps my arrears off a foreign fleet', () => {
    const debts = ['energy', 'food'];
    expect(kinds(fleetEffects(calm({ owner: 'p2', troops: 5 }), 'p1', debts))).toEqual([]);
    expect(kinds(fleetEffects(calm({ owner: 'p1', troops: 5 }), 'p1', debts))).toEqual([
      'blackout',
      'hunger',
    ]);
  });

  it('carries the point-defence total into the tag', () => {
    expect(fleetEffects(calm({ pointDefense: 12 }), 'p1', [])).toEqual([
      { kind: 'point-defense', n: 12 },
    ]);
  });
});

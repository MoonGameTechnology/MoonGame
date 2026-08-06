import { describe, it, expect } from 'vitest';
import { data, newGame } from './game';
import {
  BASE_OUTPUT_RESOURCES,
  garrisonSplit,
  isGroundUnit,
  isShipUnit,
  isWingUnit,
  planetSummary,
} from './planetSummary';
import { provinceScore } from '../../packages/shared-core/src/state/sectorKind';
import type { Fleet, Planet, UnitStack } from '../../packages/shared-core/src/index';

const s = newGame();
const anyPlanet = Object.values(s.planets)[0]!;

const planet = (over: Partial<Planet> = {}): Planet =>
  ({ ...anyPlanet, garrison: [], buildings: [], ...over }) as Planet;

const fleet = (location: string, units: UnitStack[]): Fleet =>
  ({ id: `f-${location}-${units.length}`, owner: 'p1', location, units }) as Fleet;

describe('сводка мира — домены гарнизона', () => {
  it('АВИАНОСЕЦ — крыло, а не корабль линии: иначе он посчитается дважды', () => {
    expect(isWingUnit('strike_carrier', data)).toBe(true);
    expect(isShipUnit('strike_carrier', data)).toBe(false);
    expect(isWingUnit('fighter_squadron', data)).toBe(true);
  });

  it('корабль линии — не наземный и не крыло', () => {
    expect(isShipUnit('cruiser', data)).toBe(true);
    expect(isWingUnit('cruiser', data)).toBe(false);
    expect(isGroundUnit('cruiser', data)).toBe(false);
  });

  it('наземные распознаются по домену', () => {
    expect(isGroundUnit('tank', data)).toBe(true);
    expect(isShipUnit('tank', data)).toBe(false);
  });

  it('КАЖДЫЙ стек попадает ровно в одну корзину — сумма сходится', () => {
    const split = garrisonSplit(
      [
        { unit: 'tank', count: 3 },
        { unit: 'cruiser', count: 2 },
        { unit: 'strike_carrier', count: 1 },
        { unit: 'fighter_squadron', count: 4 },
      ],
      data,
    );
    expect(split).toEqual({ ground: 3, ships: 2, wings: 5 });
    expect(split.ground + split.ships + split.wings).toBe(10);
  });

  it('выбитый стек не считается', () => {
    expect(garrisonSplit([{ unit: 'cruiser', count: 0 }], data)).toEqual({
      ground: 0,
      ships: 0,
      wings: 0,
    });
  });

  it('незнакомый юнит никуда не приписывается вместо падения', () => {
    expect(garrisonSplit([{ unit: 'нет-такого', count: 9 }], data).ships).toBe(9);
    expect(isGroundUnit('нет-такого', data)).toBe(false);
  });
});

describe('сводка мира — выход и бонусы', () => {
  it('ВЫХОД ПЕРЕЧИСЛЯЕТ И НУЛИ — иначе перекос типа планеты не виден', () => {
    const sm = planetSummary(planet({ planetType: 'terran' }), data, []);
    expect(Object.keys(sm.baseOutput).sort()).toEqual([...BASE_OUTPUT_RESOURCES].sort());
    const bare = planetSummary(planet({ planetType: undefined }), data, []);
    expect(bare.baseOutput).toEqual({ metal: 0, credits: 0, food: 0, energy: 0 });
  });

  it('выход берётся из типа планеты', () => {
    const sm = planetSummary(planet({ planetType: 'volcanic' }), data, []);
    expect(sm.baseOutput.metal).toBe(data.planetTypes.volcanic!.baseOutput!.metal);
    expect(sm.baseOutput.food).toBe(data.planetTypes.volcanic!.baseOutput!.food);
  });

  it('нулевой бонус НЕ занимает строку, ненулевой — занимает', () => {
    const terran = planetSummary(planet({ planetType: 'terran' }), data, []).bonuses;
    expect(terran.production).toBeUndefined(); // у Terran производство ровно нулевое
    expect(terran.defense).toBeCloseTo(0.1);
  });

  it('отрицательный бонус показывается наравне с положительным', () => {
    const barren = planetSummary(planet({ planetType: 'barren' }), data, []).bonuses;
    expect(barren.production).toBeLessThan(0);
  });
});

describe('сводка мира — постройки и очки', () => {
  it('постройки идут с уровнями и в своём порядке', () => {
    const sm = planetSummary(
      planet({
        buildings: [
          { type: 'mine', level: 2, hp: 100 },
          { type: 'radar', level: 1, hp: 100 },
        ],
      }),
      data,
      [],
    );
    expect(sm.buildings).toEqual([
      { type: 'mine', level: 2 },
      { type: 'radar', level: 1 },
    ]);
  });

  it('ОЧКИ ПОБЕДЫ приходят из ядра, а не из формулы панели', () => {
    for (const p of Object.values(s.planets)) {
      expect(planetSummary(p, data, []).victoryPoints).toBe(Math.round(provinceScore(data, p)));
    }
  });

  it('очки — целое число: дробей игроку не показывают', () => {
    expect(Number.isInteger(planetSummary(planet(), data, []).victoryPoints)).toBe(true);
  });
});

describe('сводка мира — флоты на орбите', () => {
  const p = planet();

  it('считает только те флоты, что стоят ЗДЕСЬ', () => {
    const sm = planetSummary(p, data, [
      fleet(p.id, [{ unit: 'cruiser', count: 2 }]),
      fleet('другой-мир', [{ unit: 'cruiser', count: 5 }]),
    ]);
    expect(sm.orbit).toEqual({ fleets: 1, ships: 2 });
  });

  it('ТРАНЗИТНЫЙ флот на орбите не стоит — у него нет местоположения', () => {
    const passing: Fleet = { ...fleet(p.id, [{ unit: 'cruiser', count: 3 }]), location: null };
    expect(planetSummary(p, data, [passing]).orbit).toEqual({ fleets: 0, ships: 0 });
  });

  it('корабли складываются по всем стоящим флотам', () => {
    const sm = planetSummary(p, data, [
      fleet(p.id, [{ unit: 'cruiser', count: 2 }]),
      fleet(p.id, [
        { unit: 'scout', count: 1 },
        { unit: 'siege', count: 1 },
      ]),
    ]);
    expect(sm.orbit).toEqual({ fleets: 2, ships: 4 });
  });

  it('пустая орбита — нули, а не отсутствие', () => {
    expect(planetSummary(p, data, []).orbit).toEqual({ fleets: 0, ships: 0 });
  });
});

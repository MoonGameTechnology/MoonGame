import { describe, expect, it } from 'vitest';
import { parseGameData, type GameData, type Planet } from '../packages/shared-core/src/index';
import {
  GARRISON_FLOOR_BASE,
  garrisonDefense,
  garrisonFloor,
  garrisonNeed,
  pickForGarrison,
  planetDevelopment,
  spareGround,
} from './garrisonPolicy';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    militia: { faction: 'x', domain: 'ground', kind: 'infantry', stats: { attack: 4, defense: 8, hp: 14, speed: 44 } },
    heavy: { faction: 'x', domain: 'ground', kind: 'infantry', stats: { attack: 8, defense: 20, hp: 34, speed: 40 } },
    tank: { faction: 'x', domain: 'ground', kind: 'vehicle', stats: { attack: 22, defense: 14, hp: 46, speed: 40 } },
    frigate: { faction: 'x', domain: 'space', stats: { attack: 3, defense: 2, hp: 30, speed: 56 } },
  },
  factions: {},
  buildings: { mine: { name: 'Mine', cost: {}, buildTimeHours: 0, hp: 20 } },
  events: {},
});

function planet(garrison: Array<[string, number]>, levels: number[] = []): Planet {
  return {
    id: 'P',
    owner: 'p1',
    position: { x: 0, y: 0 },
    resources: {},
    buildings: levels.map((level) => ({ type: 'mine', level, hp: 20 })),
    garrison: garrison.map(([unit, count]) => ({ unit, count })),
    traits: [],
  };
}

describe('политика гарнизона', () => {
  it('РАЗВИТОСТЬ — сумма УРОВНЕЙ зданий, а не их число', () => {
    expect(planetDevelopment(planet([], []))).toBe(0);
    expect(planetDevelopment(planet([], [1, 1]))).toBe(2);
    expect(planetDevelopment(planet([], [3, 2]))).toBe(5);
  });

  it('ПОЛ САМОГО СЛАБОГО МИРА — два ополченца ИЛИ один тяжёлый пехотинец', () => {
    const bare = planet([]);
    expect(garrisonFloor(bare)).toBe(GARRISON_FLOOR_BASE);
    expect(garrisonDefense([{ unit: 'militia', count: 2 }], data)).toBeGreaterThanOrEqual(
      garrisonFloor(bare),
    );
    expect(garrisonDefense([{ unit: 'heavy', count: 1 }], data)).toBeGreaterThanOrEqual(
      garrisonFloor(bare),
    );
    expect(garrisonDefense([{ unit: 'militia', count: 1 }], data)).toBeLessThan(garrisonFloor(bare));
  });

  it('ЧЕМ РАЗВИТЕЕ МИР, ТЕМ ВЫШЕ ПОЛ — столица держит больше глухой окраины', () => {
    expect(garrisonFloor(planet([], [1, 1, 1]))).toBeGreaterThan(garrisonFloor(planet([])));
    expect(garrisonFloor(planet([], [3, 3, 3]))).toBeGreaterThan(garrisonFloor(planet([], [1, 1])));
  });

  it('ДОСУХА НЕ ВЫЧЕРПЫВАЕТ: с двух ополченцев на голом мире брать нечего', () => {
    expect(spareGround(planet([['militia', 2]]), data)).toEqual([]);
  });

  it('ИЗЛИШЕК ОТДАЁТСЯ, пол остаётся на месте', () => {
    const p = planet([['militia', 5]]);
    const spare = spareGround(p, data);
    expect(spare).toEqual([{ unit: 'militia', count: 3 }]);
    const left = garrisonDefense([{ unit: 'militia', count: 2 }], data);
    expect(left).toBeGreaterThanOrEqual(garrisonFloor(p));
  });

  it('УЕЗЖАЮТ УДАРНЫЕ, ОСТАЮТСЯ ОБОРОНИТЕЛЬНЫЕ — танк в атаку, ополченец домой', () => {
    // Танк бьёт 22 при обороне 14, ополченец — наоборот. Отдавать надо того, кто на
    // чужой земле полезнее, а держать того, кто полезнее на своей.
    const spare = spareGround(planet([['militia', 2], ['tank', 1]]), data);
    expect(spare).toEqual([{ unit: 'tank', count: 1 }]);
  });

  it('КОРАБЛЬ НЕ ГАРНИЗОН: в счёт обороны земли он не идёт и в десант не уезжает', () => {
    expect(garrisonDefense([{ unit: 'frigate', count: 9 }], data)).toBe(0);
    expect(spareGround(planet([['frigate', 9]]), data)).toEqual([]);
  });
});

const st = (unit: string, count: number) => ({ unit, count });

describe('подкрепление гарнизона', () => {
  it('НУЖДА — это НЕДОБОР до пола, и у сытого мира она ноль', () => {
    expect(garrisonNeed(planet([['militia', 2]]), data)).toBe(0);
    expect(garrisonNeed(planet([['militia', 9]]), data)).toBe(0);
    expect(garrisonNeed(planet([]), data)).toBe(GARRISON_FLOOR_BASE);
    expect(garrisonNeed(planet([['militia', 1]]), data)).toBe(GARRISON_FLOOR_BASE - 8);
  });

  it('РАЗВИТОМУ МИРУ НУЖНО БОЛЬШЕ при том же гарнизоне', () => {
    expect(garrisonNeed(planet([['militia', 2]], [1, 1, 1]), data)).toBeGreaterThan(0);
  });

  it('ССАЖИВАЮТСЯ ОБОРОНИТЕЛЬНЫЕ — зеркало правила «уезжают ударные»', () => {
    // Гарнизон живёт `defense`, поэтому на землю идёт тяжёлый пехотинец, а танк
    // остаётся на борту: он полезнее там, где им будут бить.
    const out = pickForGarrison([st('tank', 2), st('heavy', 2)], 20, data);
    expect(out).toEqual([{ unit: 'heavy', count: 1 }]);
  });

  it('БЕРЁТСЯ РОВНО СТОЛЬКО, СКОЛЬКО ЗАКРОЕТ НУЖДУ, а не весь трюм', () => {
    expect(pickForGarrison([st('militia', 9)], 16, data)).toEqual([{ unit: 'militia', count: 2 }]);
  });

  it('НУЖДА БОЛЬШЕ ТРЮМА — отдаётся всё, что есть', () => {
    expect(pickForGarrison([st('militia', 2)], 999, data)).toEqual([{ unit: 'militia', count: 2 }]);
  });

  it('НУЖДЫ НЕТ — не ссаживается ничего; КОРАБЛЬ гарнизоном не станет', () => {
    expect(pickForGarrison([st('militia', 9)], 0, data)).toEqual([]);
    expect(pickForGarrison([st('frigate', 9)], 99, data)).toEqual([]);
  });
});

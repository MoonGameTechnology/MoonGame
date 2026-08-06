import { describe, it, expect } from 'vitest';
import { data } from './game';
import { fleetSummary, stackHullPct, stackPools } from './fleetSummary';
import type { Fleet, GameData, UnitStack } from '../../packages/shared-core/src/index';

const fleet = (units: UnitStack[], over: Partial<Fleet> = {}): Fleet =>
  ({ id: 'f1', owner: 'p1', at: 'C1R1', units, ...over }) as Fleet;

const sum = (units: UnitStack[], over: Partial<Fleet> = {}, now = 0) =>
  fleetSummary(fleet(units, over), data, now);

describe('сводка армии — залп', () => {
  it('ЛИНИЯ БОЯ ограничивает огонь: сверх капа корабли только принимают урон', () => {
    const few = sum([{ unit: 'cruiser', count: 5 }]).attack;
    const many = sum([{ unit: 'cruiser', count: 30 }]).attack;
    expect(few.capped).toBe(few.total); // пятеро помещаются в линию целиком
    expect(many.total).toBeGreaterThan(many.capped); // а тридцать — уже нет
    expect(many.capped).toBe(few.capped * 2); // в залпе ровно кап, сколько ни строй
  });

  it('корпуса за линией всё равно идут в живучесть', () => {
    const few = sum([{ unit: 'cruiser', count: 5 }]);
    const many = sum([{ unit: 'cruiser', count: 30 }]);
    expect(many.hull.max).toBeGreaterThan(few.hull.max);
  });

  it('оборона тоже считается по линии боя', () => {
    const many = sum([{ unit: 'cruiser', count: 30 }]);
    expect(many.defense).toBe(sum([{ unit: 'cruiser', count: 10 }]).defense);
  });

  it('десант в трюме не стреляет из космоса', () => {
    const bare = sum([{ unit: 'cruiser', count: 2 }]);
    const loaded = sum([{ unit: 'cruiser', count: 2 }], {
      landing: [{ unit: 'tank', count: 4 }],
    });
    expect(loaded.attack).toEqual(bare.attack);
  });
});

describe('сводка армии — пулы корпуса и щита', () => {
  it('целый флот — остаток равен максимуму', () => {
    const s = sum([{ unit: 'cruiser', count: 3 }]);
    expect(s.hull.max).toBe(3 * 60);
    expect(s.hull.cur).toBe(s.hull.max);
  });

  it('битый стек показывает свой остаток', () => {
    expect(sum([{ unit: 'cruiser', count: 3, hp: 100 }]).hull.cur).toBe(100);
  });

  it('ОСТАТОК ЗАЖИМАЕТСЯ по максимуму — панель не показывает «110/100»', () => {
    const s = sum([{ unit: 'cruiser', count: 1, hp: 9999 }]);
    expect(s.hull.cur).toBe(s.hull.max);
  });

  it('десант в трюме входит в живучесть — бомбардировка бьёт и по нему', () => {
    const bare = sum([{ unit: 'dropship', count: 1 }]);
    const loaded = sum([{ unit: 'dropship', count: 1 }], {
      landing: [{ unit: 'tank', count: 2 }],
    });
    expect(loaded.hull.max).toBe(bare.hull.max + 2 * 46);
  });

  it('без щитов пул нулевой, а не отсутствующий', () => {
    expect(sum([{ unit: 'cruiser', count: 2 }]).shield).toEqual({ cur: 0, max: 0 });
  });
});

describe('сводка армии — состав', () => {
  it('корабли складываются по архетипам в порядке состава', () => {
    const s = sum([
      { unit: 'cruiser', count: 2 },
      { unit: 'siege', count: 1 },
      { unit: 'scout', count: 3 },
    ]);
    expect(s.composition).toEqual([
      { archetype: 'combat', count: 2 },
      { archetype: 'artillery', count: 1 },
      { archetype: 'scout', count: 3 },
    ]);
  });

  it('однотипные стеки сливаются в одну строку архетипа', () => {
    const s = sum([
      { unit: 'cruiser', count: 2 },
      { unit: 'cruiser', count: 3, hp: 40 },
    ]);
    expect(s.composition).toEqual([{ archetype: 'combat', count: 5 }]);
  });

  it('десант считается отдельно от кораблей', () => {
    const s = sum([{ unit: 'cruiser', count: 1 }], {
      landing: [
        { unit: 'tank', count: 2 },
        { unit: 'militia', count: 5 },
      ],
    });
    expect(s.troops).toBe(7);
    expect(s.composition).toEqual([{ archetype: 'combat', count: 1 }]);
  });

  it('ВЫБИТЫЙ СТЕК не занимает строку — после боя он остаётся в массиве', () => {
    const s = sum([
      { unit: 'cruiser', count: 0 },
      { unit: 'scout', count: 1 },
    ]);
    expect(s.composition).toEqual([{ archetype: 'scout', count: 1 }]);
  });

  it('пустой флот не роняет расчёт', () => {
    const s = sum([]);
    expect(s.composition).toEqual([]);
    expect(s.hull).toEqual({ cur: 0, max: 0 });
    expect(s.speed).toBe(0);
    expect(s.radar).toBe(0);
  });
});

describe('сводка армии — трюм, радар, содержание', () => {
  it('вместимость складывается по кораблям, а возить некому — трюма нет', () => {
    expect(sum([{ unit: 'dropship', count: 2 }]).cargo).toEqual({ used: 0, cap: 16 });
    expect(sum([{ unit: 'siege', count: 2 }]).cargo).toBeNull();
  });

  it('ТРЮМ СЧИТАЕТСЯ ОБЪЁМОМ груза, а не числом голов', () => {
    const heavy: GameData = {
      ...data,
      units: {
        ...data.units,
        tank: { ...data.units.tank!, stats: { ...data.units.tank!.stats, cargoSize: 3 } },
      },
    };
    const f = fleet([{ unit: 'dropship', count: 1 }], { landing: [{ unit: 'tank', count: 2 }] });
    expect(fleetSummary(f, data, 0).cargo).toEqual({ used: 2, cap: 8 });
    expect(fleetSummary(f, heavy, 0).cargo).toEqual({ used: 6, cap: 8 });
  });

  it('РАДАР — МАКСИМУМ по кораблям: два разведчика не видят вдвое дальше', () => {
    const one = sum([{ unit: 'scout', count: 1 }]).radar;
    expect(one).toBeGreaterThan(0);
    expect(sum([{ unit: 'scout', count: 2 }]).radar).toBe(one);
    expect(
      sum([
        { unit: 'scout', count: 1 },
        { unit: 'cruiser', count: 5 },
      ]).radar,
    ).toBe(one);
  });

  it('содержание суммируется по ресурсам и умножается на численность', () => {
    const s = sum([
      { unit: 'cruiser', count: 2 },
      { unit: 'scout', count: 3 },
    ]);
    expect(s.upkeep).toEqual({ credits: 2 * 4 + 3 * 1 });
  });

  it('бесплатный флот отдаёт пустое содержание, а не мусор', () => {
    expect(sum([]).upkeep).toEqual({});
  });
});

describe('сводка армии — ход', () => {
  it('скорость флота — по самому медленному корпусу', () => {
    expect(
      sum([
        { unit: 'scout', count: 1 },
        { unit: 'siege', count: 1 },
      ]).speed,
    ).toBe(data.units.siege!.stats.speed);
  });

  it('СПЕШНЫЙ ОТХОД помечается только пока он действует', () => {
    const units = [{ unit: 'cruiser', count: 1 }];
    expect(sum(units, { retreatHasteUntil: 500 } as Partial<Fleet>, 100).retreatHaste).toBe(true);
    expect(sum(units, { retreatHasteUntil: 500 } as Partial<Fleet>, 500).retreatHaste).toBe(false);
    expect(sum(units).retreatHaste).toBe(false);
  });
});

describe('сводка армии — пул одного стека', () => {
  it('доля корпуса округляется до процента', () => {
    expect(stackHullPct({ unit: 'cruiser', count: 2, hp: 60 }, data)).toBe(50);
    expect(stackHullPct({ unit: 'cruiser', count: 2 }, data)).toBe(100);
  });

  it('стек без корпуса считается целым, а не делится на ноль', () => {
    expect(stackHullPct({ unit: 'cruiser', count: 0 }, data)).toBe(100);
  });

  it('незнакомый юнит не роняет расчёт и не даёт живучести', () => {
    expect(stackPools({ unit: 'нет-такого', count: 5 }, data)).toEqual({
      hull: { cur: 0, max: 0 },
      shield: { cur: 0, max: 0 },
    });
    expect(sum([{ unit: 'нет-такого', count: 5 }]).hull).toEqual({ cur: 0, max: 0 });
  });
});

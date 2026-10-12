import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { pveState } from '../packages/client/src/gameData';
import { effectiveStats, type GameState } from '../packages/shared-core/src/index';
import { shipCardModel, stackBonusSlots } from './shipCard';

const data = shippedGameData();

describe('карточка корабля — отсеки (заказ владельца 2026-09-24)', () => {
  it('отсеков столько, сколько даёт корпус: оружие, защита, системы — пустые видны пустыми', () => {
    const m = shipCardModel({ unit: 'cruiser', count: 2, modules: ['shield_booster'] }, data)!;
    expect(m.bays.map((b) => [b.type, b.module])).toEqual([
      ['weapon', null],
      ['defense', 'shield_booster'],
      ['utility', null],
    ]);
    expect(m.count).toBe(2);
  });

  it('модуль в отсеке своего типа, порядок лоадаута не важен', () => {
    const a = shipCardModel({ unit: 'cruiser', count: 1, modules: ['radar_module', 'targeting_array'] }, data)!;
    expect(a.bays.map((b) => b.module)).toEqual(['targeting_array', null, 'radar_module']);
  });

  it('модуль сверх ёмкости не пропадает — лишний отсек', () => {
    const m = shipCardModel({ unit: 'cruiser', count: 1, modules: ['shield_booster', 'ablative_plating'] }, data)!;
    const defense = m.bays.filter((b) => b.type === 'defense');
    expect(defense.map((b) => b.module)).toEqual(['shield_booster', 'ablative_plating']);
    expect(defense[0]!.extra).toBeUndefined();
    expect(defense[1]!.extra).toBe(true);
  });

  it('слот, купленный звездой корабля, — отсек, а не лишний модуль', () => {
    // Крейсер забега со звездой «защита» (`Player.arsenal.slots.cruiser`): второй модуль
    // защиты стоит в купленном отсеке, а не «лишним».
    const stack = { unit: 'cruiser', count: 1, modules: ['shield_booster', 'ablative_plating'] };
    const m = shipCardModel(stack, data, { defense: 1 })!;
    expect(m.bays.map((b) => [b.type, b.module, b.bonus ?? false, b.extra ?? false])).toEqual([
      ['weapon', null, false, false],
      ['defense', 'shield_booster', false, false],
      ['defense', 'ablative_plating', true, false],
      ['utility', null, false, false],
    ]);
    // Пустой купленный отсек виден пустым — как и слоты каталога.
    expect(shipCardModel({ unit: 'cruiser', count: 1 }, data, { weapon: 1 })!.bays[1]).toMatchObject({
      type: 'weapon',
      module: null,
      bonus: true,
    });
  });

  it('вклад отсека — то, что модуль добавляет одному кораблю', () => {
    const m = shipCardModel({ unit: 'cruiser', count: 1, modules: ['targeting_array'] }, data)!;
    expect(m.bays[0]!.effect).toEqual({ attack: 4 });
    expect(m.bays[1]!.effect).toEqual({});
  });

  it('звёзды и редкость едут в отсек и в числа — те же, что в бою', () => {
    const stack = { unit: 'cruiser', count: 1, modules: ['targeting_array'], moduleStars: { targeting_array: 2 } };
    const m = shipCardModel(stack, data)!;
    expect(m.bays[0]!.stars).toBe(2);
    const attack = m.stats.find((s) => s.stat === 'attack')!;
    expect(attack.effective).toBeCloseTo(effectiveStats(data.units.cruiser!, stack, data).attack!, 9);
    expect(attack.effective).toBeGreaterThan(16 + 4 - 1e-9);
    expect(m.bays[0]!.effect.attack).toBeCloseTo(attack.delta, 9);
  });

  it('неизвестный корпус — карточки нет', () => {
    expect(shipCardModel({ unit: 'no_such_hull', count: 1 }, data)).toBeNull();
  });
});

describe('карточка корабля — универсальные отсеки (усиленный крейсер)', () => {
  it('четыре универсальных отсека, модули любых типов — в них', () => {
    const m = shipCardModel(
      { unit: 'heavy_cruiser', count: 1, modules: ['shield_booster', 'targeting_array', 'ablative_plating'] },
      data,
    )!;
    expect(m.bays.map((b) => [b.type, b.module])).toEqual([
      ['universal', 'targeting_array'],
      ['universal', 'shield_booster'],
      ['universal', 'ablative_plating'],
      ['universal', null],
    ]);
    expect(m.bays.some((b) => b.extra)).toBe(false);
  });

  it('вклад модуля в универсальном отсеке считается так же, как в своём', () => {
    const m = shipCardModel({ unit: 'heavy_cruiser', count: 1, modules: ['targeting_array'] }, data)!;
    expect(m.bays[0]!.effect).toEqual({ attack: 4 });
  });
});

describe('карточка корабля — характеристики (правило 4)', () => {
  it('атака, защита, корпус и скорость — всегда; прочие — только живые', () => {
    const bare = shipCardModel({ unit: 'cruiser', count: 1 }, data)!;
    const keys = bare.stats.map((s) => s.stat);
    expect(keys).toEqual(expect.arrayContaining(['attack', 'defense', 'hp', 'speed', 'cargoCapacity']));
    expect(keys).not.toContain('shield');
    expect(keys).not.toContain('radarRange');
    const fitted = shipCardModel({ unit: 'cruiser', count: 1, modules: ['shield_booster', 'radar_module'] }, data)!;
    const shield = fitted.stats.find((s) => s.stat === 'shield')!;
    expect(shield).toMatchObject({ base: 0, effective: 15, delta: 15 });
    expect(fitted.stats.some((s) => s.stat === 'radarRange')).toBe(true);
  });

  it('ремонтный ангар виден строкой ремонта корпуса и вкладом отсека (SHU-5.5)', () => {
    const bare = shipCardModel({ unit: 'cruiser', count: 1 }, data)!;
    expect(bare.stats.map((s) => s.stat)).not.toContain('hullRepair');
    const m = shipCardModel({ unit: 'cruiser', count: 1, modules: ['repair_bay'] }, data)!;
    expect(m.stats.find((s) => s.stat === 'hullRepair')).toMatchObject({ base: 0, effective: 0.05 });
    expect(m.bays.find((b) => b.module === 'repair_bay')!.effect).toEqual({ hullRepair: 0.05 });
  });
});

describe('карточка корабля — прибавка слотов владельца', () => {
  const base = (): GameState => pveState(data);
  const fleetOf = (s: GameState): string => Object.keys(s.fleets).find((id) => s.fleets[id]!.owner === 'p1')!;

  it('купленные звёздами корабля слоты — из арсенала владельца, по корпусу', () => {
    const s = base();
    s.players.p1!.arsenal = { hulls: [], modules: [], slots: { cruiser: { defense: 1 } } };
    const fleet = fleetOf(s);
    expect(stackBonusSlots(s, fleet, { unit: 'cruiser' }, data)).toEqual({ defense: 1 });
    expect(stackBonusSlots(s, fleet, { unit: 'frigate' }, data)).toBeUndefined();
    expect(stackBonusSlots(s, 'no-such-fleet', { unit: 'cruiser' }, data)).toBeUndefined();
  });

  it('корабль героя — отсеки ступени и звёзд героя, а не арсенал', () => {
    const s = base();
    const fleet = fleetOf(s);
    s.heroes = {
      h: { id: 'h', owner: 'p1', location: 'x', cooldowns: {}, fleetId: fleet, grade: 'main', moduleSlots: { weapon: 1 } },
    };
    expect(stackBonusSlots(s, fleet, { unit: 'hero' }, data)).toEqual({ weapon: 1, defense: 0, utility: 1 });
    // Другой стек того же флота — обычный корабль, прибавка героя его не касается.
    expect(stackBonusSlots(s, fleet, { unit: 'cruiser' }, data)).toBeUndefined();
  });
});

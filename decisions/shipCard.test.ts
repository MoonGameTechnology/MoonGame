import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { effectiveStats } from '../packages/shared-core/src/index';
import { shipCardModel } from './shipCard';

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

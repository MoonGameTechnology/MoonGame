import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { TILE_HP_LOW_PCT, TILE_MODULE_MARKS, tileHp, tileModuleRow } from './unitTile';

const data = shippedGameData();

describe('здоровье на плитке состава: полоска и числа (заказ владельца 2026-09-25)', () => {
  it('раненый стек — доля и «осталось/всего»', () => {
    expect(tileHp({ cur: 75, max: 120 })).toEqual({ pct: 63, cur: 75, max: 120, low: false });
    expect(tileHp({ cur: 140, max: 140 })).toEqual({ pct: 100, cur: 140, max: 140, low: false });
  });

  it('живой стек не показывает ноль: остаток меньше единицы — «1»', () => {
    expect(tileHp({ cur: 0.3, max: 30 })).toMatchObject({ cur: 1, max: 30, low: true });
    expect(tileHp({ cur: 0, max: 30 })).toMatchObject({ cur: 0, pct: 0 });
  });

  it('остаток зажат в 0..всего, дробный корпус округляется', () => {
    expect(tileHp({ cur: 200, max: 120 })).toMatchObject({ cur: 120, pct: 100 });
    expect(tileHp({ cur: -5, max: 30 })).toMatchObject({ cur: 0, pct: 0 });
    expect(tileHp({ cur: 100.8, max: 100.8 })).toMatchObject({ cur: 101, max: 101, pct: 100 });
    expect(tileHp({ cur: 100.4, max: 100.4 })).toMatchObject({ cur: 100, max: 100 });
  });

  it('нечему ломаться — целый, как прежняя полоска', () => {
    expect(tileHp({ cur: 0, max: 0 })).toEqual({ pct: 100, cur: 0, max: 0, low: false });
  });

  it('красная полоска — ниже порога хромоты, не на нём', () => {
    expect(TILE_HP_LOW_PCT).toBe(30);
    expect(tileHp({ cur: 29, max: 100 }).low).toBe(true);
    expect(tileHp({ cur: 30, max: 100 }).low).toBe(false);
  });
});

describe('строка модулей на плитке корабля (заказ владельца 2026-11-17)', () => {
  it('голый корпус — одни точки свободных отсеков, корабль без отсеков — пустая строка', () => {
    expect(tileModuleRow({ unit: 'frigate' }, data)).toEqual({ modules: [], free: 4, more: [] });
    expect(tileModuleRow({ unit: 'scout_drone' }, data)).toEqual({
      modules: [],
      free: 0,
      more: [],
    });
  });

  it('надетое — первым, точки после, хотя отсек модуля стоит не первым', () => {
    // У фрегата первый отсек — защита; ремонтный ангар встаёт в систему, но рисуется первым.
    expect(tileModuleRow({ unit: 'frigate', modules: ['repair_bay'] }, data)).toEqual({
      modules: ['repair_bay'],
      free: 3,
      more: [],
    });
  });

  it('модули — в порядке отсеков корпуса, а не лоадаута', () => {
    expect(
      tileModuleRow({ unit: 'cruiser', modules: ['radar_module', 'targeting_array'] }, data),
    ).toEqual({ modules: ['targeting_array', 'radar_module'], free: 1, more: [] });
  });

  it('модуль сверх ёмкости корпуса — тоже значок, а не пропажа', () => {
    expect(
      tileModuleRow({ unit: 'cruiser', modules: ['shield_booster', 'ablative_plating'] }, data),
    ).toEqual({ modules: ['shield_booster', 'ablative_plating'], free: 2, more: [] });
  });

  it('строка не шире четырёх мест: лишние точки не рисуются, лишние модули — «+N»', () => {
    expect(TILE_MODULE_MARKS).toBe(4);
    // Пять отсеков, ничего не надето: четыре точки.
    expect(tileModuleRow({ unit: 'fortress_guns' }, data)).toEqual({
      modules: [],
      free: 4,
      more: [],
    });
    // Прибавка слотов делает отсеки фрегата шестью: три значка и «+3».
    const six = [
      'ablative_plating',
      'repair_bay',
      'long_range_optics',
      'ion_engine',
      'cargo_bay',
      'radar_module',
    ];
    expect(tileModuleRow({ unit: 'frigate', modules: six }, data, { utility: 2 })).toEqual({
      modules: ['ablative_plating', 'repair_bay', 'long_range_optics'],
      free: 0,
      more: ['ion_engine', 'cargo_bay', 'radar_module'],
    });
  });

  it('ровно четыре модуля — все четыре значка, без «+N»', () => {
    const four = ['ablative_plating', 'repair_bay', 'long_range_optics', 'ion_engine'];
    expect(tileModuleRow({ unit: 'frigate', modules: four }, data)).toEqual({
      modules: four,
      free: 0,
      more: [],
    });
  });

  it('корпуса нет в данных — пустая строка, а не падение', () => {
    expect(tileModuleRow({ unit: 'nope', modules: ['repair_bay'] }, data)).toEqual({
      modules: [],
      free: 0,
      more: [],
    });
  });
});

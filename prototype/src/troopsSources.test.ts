import { describe, it, expect } from 'vitest';
import { groundTypes, hasTroops, totalOf, troopSources, type Stack } from './troopsSources';

const пехота = (count: number): Stack => ({ unit: 'infantry', count });
const танк = (count: number): Stack => ({ unit: 'tank', count });
const корабль = (count: number): Stack => ({ unit: 'cruiser', count });
const наземный = (u: string) => u === 'infantry' || u === 'tank';

describe('десант — откуда берутся источники', () => {
  it('НА СВОЁМ МИРЕ ИСТОЧНИКОВ ДВА: и поднимаем, и высаживаем', () => {
    expect(troopSources(true, [пехота(3)], [танк(1)])).toEqual([пехота(3), танк(1)]);
  });

  it('НА СОЮЗНОМ МИРЕ ПОДНИМАТЬ НЕЧЕГО: чужой гарнизон не твой, ядро отобьёт погрузку', () => {
    expect(troopSources(false, [пехота(9)], [танк(1)])).toEqual([танк(1)]);
  });

  it('пустой трюм над чужим миром — источников нет вовсе', () => {
    expect(troopSources(false, [пехота(9)], [])).toEqual([]);
  });
});

describe('десант — какие типы попадают в меню', () => {
  it('корабли в десантное меню не идут', () => {
    expect(groundTypes([пехота(1), корабль(4)], наземный)).toEqual(['infantry']);
  });

  it('ПОРЯДОК ПЕРВОГО ПОЯВЛЕНИЯ И БЕЗ ПОВТОРОВ: иначе строки прыгают от перерисовки', () => {
    expect(groundTypes([танк(1), пехота(2), танк(3), пехота(1)], наземный)).toEqual([
      'tank',
      'infantry',
    ]);
  });

  it('пустой вход — пустой список типов', () => {
    expect(groundTypes([], наземный)).toEqual([]);
  });

  it('НЕТ НАЗЕМНЫХ ТИПОВ — МЕНЮ НЕ ОТКРЫВАЕТСЯ: пустое хуже отсутствующего', () => {
    expect(hasTroops(groundTypes([корабль(2)], наземный))).toBe(false);
    expect(hasTroops(groundTypes([пехота(1)], наземный))).toBe(true);
  });
});

describe('десант — сколько частей всего', () => {
  it('НЕСКОЛЬКО СТОПОК ОДНОГО ТИПА СКЛАДЫВАЮТСЯ: побитая и целая', () => {
    expect(totalOf([пехота(2), пехота(3)], 'infantry')).toBe(5);
  });

  it('чужие типы в сумму не входят', () => {
    expect(totalOf([пехота(2), танк(7)], 'infantry')).toBe(2);
  });

  it('типа нет вовсе — ноль', () => {
    expect(totalOf([танк(7)], 'infantry')).toBe(0);
    expect(totalOf([], 'infantry')).toBe(0);
  });
});

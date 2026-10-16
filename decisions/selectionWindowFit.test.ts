import { describe, expect, it } from 'vitest';
import { FIT_MAX_COLUMNS, fitColumns, fitLayout } from './selectionWindowFit';

const окно = { info: true, commands: false, fleetConsole: false, details: false, world: false };

describe('какой раскладке окна выбора ширина подбирается по содержимому', () => {
  it('одни сведения — газетой на всю ширину, с приказами — газетой справа от них', () => {
    expect(fitLayout(окно)).toBe('info');
    expect(fitLayout({ ...окно, commands: true })).toBe('orders');
  });

  it('у консоли флота, раскрытых подробностей и окна мира своя ширина', () => {
    expect(fitLayout({ ...окно, commands: true, fleetConsole: true })).toBeNull();
    expect(fitLayout({ ...окно, details: true })).toBeNull();
    expect(fitLayout({ ...окно, world: true })).toBeNull();
  });

  it('окно одних приказов узкое и без газеты', () => {
    expect(fitLayout({ ...окно, info: false, commands: true })).toBeNull();
  });
});

describe('сколько колонок газеты нужно окну', () => {
  /** Содержимое высотой `колонок` колонок: прячется, пока колонок у окна меньше. */
  const высотой = (колонок: number) => (n: number) => n < колонок;

  it('ОКНО — НАИМЕНЬШЕЕ, В КОТОРОМ ВИДНО ВСЁ: короткая карточка — одна колонка', () => {
    expect(fitColumns('info', высотой(1))).toBe(1);
    expect(fitColumns('info', высотой(2))).toBe(2);
    expect(fitColumns('info', высотой(3))).toBe(3);
  });

  it('ступени меряются по порядку и не дальше первой, где всё видно', () => {
    const мерили: number[] = [];
    fitColumns('info', (n) => (мерили.push(n), n < 2));
    expect(мерили).toEqual([1, 2]);
  });

  it('не влезло и в последнюю ступень — последняя ступень, окно не шире прежнего', () => {
    expect(fitColumns('info', () => true)).toBe(FIT_MAX_COLUMNS.info);
    expect(fitColumns('orders', () => true)).toBe(FIT_MAX_COLUMNS.orders);
  });

  it('последнюю ступень не меряют: шире ей всё равно некуда', () => {
    const мерили: number[] = [];
    fitColumns('orders', (n) => (мерили.push(n), true));
    expect(мерили).toEqual([1]);
  });

  it('рядом с приказами места на две колонки, без них — на четыре', () => {
    expect(FIT_MAX_COLUMNS).toEqual({ info: 4, orders: 2 });
    expect(fitColumns('orders', высотой(4))).toBe(2);
  });
});

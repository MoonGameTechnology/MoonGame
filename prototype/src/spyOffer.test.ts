import { describe, it, expect } from 'vitest';
import { spyOffer, windowLeftH } from './spyOffer';

const ЧАС = 3_600_000;

describe('шпионаж — кому предлагаем', () => {
  it('чужой мир с владельцем и деньгами — можно купить', () => {
    expect(spyOffer(false, true, false, true)).toBe('buy');
  });

  it('СВОЙ МИР НЕ ШПИОНЯТ: про него и так всё известно', () => {
    expect(spyOffer(true, true, false, true)).toBe('none');
  });

  it('НИЧЕЙНЫЙ МИР НЕ ШПИОНЯТ: красть сведения не у кого', () => {
    expect(spyOffer(false, false, false, true)).toBe('none');
  });
});

describe('шпионаж — живое окно', () => {
  it('ПОКА ОКНО ЖИВО — ОТСЧЁТ, а не кнопка: второй раз за то же не платят', () => {
    expect(spyOffer(false, true, true, true)).toBe('window');
  });

  it('живое окно важнее денег — отсчёт показывается и без кредитов', () => {
    expect(spyOffer(false, true, true, false)).toBe('window');
  });
});

describe('шпионаж — цена', () => {
  it('НЕХВАТКА ГАСИТ, НО НЕ ПРЯЧЕТ: цена должна остаться на виду', () => {
    expect(spyOffer(false, true, false, false)).toBe('buy-disabled');
  });
});

describe('шпионаж — остаток окна', () => {
  it('живое окно считает часы', () => {
    expect(windowLeftH(5 * ЧАС, 2 * ЧАС, ЧАС)).toBe(3);
  });

  it('ИСТЁКШЕЕ ОКНО — НОЛЬ, А НЕ МИНУС: «осталось −3ч» это поломка', () => {
    expect(windowLeftH(2 * ЧАС, 5 * ЧАС, ЧАС)).toBe(0);
  });

  it('ровно в момент истечения — ноль', () => {
    expect(windowLeftH(5 * ЧАС, 5 * ЧАС, ЧАС)).toBe(0);
  });
});

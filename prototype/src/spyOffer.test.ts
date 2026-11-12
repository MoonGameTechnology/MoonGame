import { describe, it, expect } from 'vitest';
import { spyOffer } from './spyOffer';

describe('шпионаж — кому предлагаем', () => {
  it('чужой мир с деньгами — можно купить, и ничейный тоже (SPY-24)', () => {
    expect(spyOffer(false, false, true)).toBe('buy');
  });

  it('СВОЙ МИР НЕ ШПИОНЯТ: про него и так всё известно', () => {
    expect(spyOffer(true, false, true)).toBe('none');
  });
});

describe('шпионаж — живое окно', () => {
  it('ПОКА ОКНО ЖИВО — ОТСЧЁТ, а не кнопка: второй раз за то же не платят', () => {
    expect(spyOffer(false, true, true)).toBe('window');
  });

  it('живое окно важнее денег — отсчёт показывается и без кредитов', () => {
    expect(spyOffer(false, true, false)).toBe('window');
  });
});

describe('шпионаж — цена', () => {
  it('НЕХВАТКА ГАСИТ, НО НЕ ПРЯЧЕТ: цена должна остаться на виду', () => {
    expect(spyOffer(false, false, false)).toBe('buy-disabled');
  });
});

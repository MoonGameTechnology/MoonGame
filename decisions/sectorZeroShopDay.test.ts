import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { advanceShopDay, dailyOffers, localShopDay } from './sectorZeroShop';
import { freshSectorZeroProgress, type SectorZeroProgress } from './sectorZeroProgress';

const data = shippedGameData();
const profile = (over: Partial<SectorZeroProgress> = {}): SectorZeroProgress => ({
  ...freshSectorZeroProgress(data, 'rotator'),
  ...over,
});

describe('SZE-3.2 — номер дня монотонен: накрутка часов наказывает сама себя', () => {
  it('свежий профиль начинает с нулевого дня', () => {
    expect(profile().day).toBe(0);
  });

  it('часы ВПЕРЁД двигают витрину — и навсегда', () => {
    const p = advanceShopDay(profile({ day: 10 }), 40);
    expect(p.day).toBe(40); // промотанные дни сгорели вместе с их товаром
  });

  it('часы НАЗАД не откатывают ничего', () => {
    // Иначе игрок крутил бы дату туда-сюда, пока не выпадет нужное, — ровно тот
    // перекат, который `SZE-0.3` закрыл у Мастерской, только другим входом.
    const p = profile({ day: 40 });
    expect(advanceShopDay(p, 5)).toBe(p); // тот же объект: менять нечего
    expect(advanceShopDay(p, 40)).toBe(p);
  });

  it('мусорный день игнорируется', () => {
    const p = profile({ day: 7 });
    for (const bad of [Number.NaN, -1, 1.5, Infinity])
      expect([bad, advanceShopDay(p, bad).day]).toEqual([bad, 7]);
  });

  it('локальный день считается из миллисекунд, а не из объекта даты', () => {
    // `decisions/` обязаны оставаться чистыми: время приходит числом снаружи.
    expect(localShopDay(0)).toBe(0);
    expect(localShopDay(86_400_000)).toBe(1);
    expect(localShopDay(86_400_000 * 3 + 5)).toBe(3);
    expect(localShopDay(-5)).toBe(0); // часы до эпохи — не повод уходить в минус
  });
});

describe('SZE-3.2 — витрина выводится, а не хранится', () => {
  const idsOn = (day: number, seed = 'rotator'): string[] =>
    dailyOffers(seed, day, data).map((o) => o.id);

  it('один и тот же день даёт одну и ту же витрину', () => {
    expect(idsOn(12)).toEqual(idsOn(12));
  });

  it('разные дни дают разные витрины', () => {
    const week = new Set(Array.from({ length: 7 }, (_, d) => idsOn(d).join(',')));
    expect(week.size).toBeGreaterThan(1);
  });

  it('у разных профилей витрины разные', () => {
    // Сид профиля в ключе — иначе вся площадка видит одну и ту же лавку.
    const same = Array.from({ length: 10 }, (_, d) => idsOn(d).join(',') === idsOn(d, 'other').join(','));
    expect(same.every(Boolean)).toBe(false);
  });

  it('витрина короче каталога и без повторов', () => {
    const ids = idsOn(3);
    expect(ids.length).toBeLessThan(Object.keys(data.sectorZeroShop.offers).length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('пустой каталог даёт пустую витрину, а не падение', () => {
    expect(dailyOffers('x', 1, { ...data, sectorZeroShop: { ...data.sectorZeroShop, offers: {}, slots: 4 } })).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { featuredOffer } from './shopFeatured';
import type { ShopRow } from './sectorZeroShop';

const data = shippedGameData();
const price = (available = true): ShopRow['prices'][number] => ({
  kind: 'warrants',
  amount: 100,
  available,
  can: true,
  reason: null,
});
const row = (
  id: string,
  kind: ShopRow['kind'],
  grants: string,
  over: Partial<ShopRow> = {},
): ShopRow => ({
  id,
  kind,
  grants,
  amount: 1,
  owned: false,
  prices: [price()],
  ...over,
});

describe('featuredOffer — главное предложение витрины', () => {
  it('выделяет самый редкий модуль', () => {
    const rows = [
      row('a', 'module', 'cargo_bay'), // простой
      row('b', 'module', 'targeting_array'), // уникальный
      row('c', 'resource', 'research'),
    ];
    expect(data.modules.targeting_array!.rarity).toBe('unique');
    expect(featuredOffer(rows, data)).toBe('b');
  });

  it('узел навыка — выше простого модуля, ресурс — ниже всех', () => {
    expect(
      featuredOffer(
        [row('r', 'resource', 'research'), row('m', 'module', 'cargo_bay'), row('s', 'skill', 'x')],
        data,
      ),
    ).toBe('s');
    expect(
      featuredOffer([row('r', 'resource', 'research'), row('m', 'module', 'cargo_bay')], data),
    ).toBe('m');
  });

  it('равенство решает порядок витрины', () => {
    expect(
      featuredOffer(
        [row('first', 'module', 'cargo_bay'), row('second', 'module', 'ion_engine')],
        data,
      ),
    ).toBe('first');
  });

  it('не выделяет купленное и то, что площадка продать не может', () => {
    const rows = [
      row('owned', 'module', 'targeting_array', { owned: true }),
      row('nope', 'module', 'targeting_array', { prices: [price(false)] }),
      row('ok', 'resource', 'research'),
    ];
    expect(featuredOffer(rows, data)).toBe('ok');
    expect(featuredOffer([rows[0]!, rows[1]!], data)).toBeNull();
    expect(featuredOffer([], data)).toBeNull();
  });
});

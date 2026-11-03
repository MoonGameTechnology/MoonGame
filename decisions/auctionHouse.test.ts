import { describe, expect, it } from 'vitest';
import { countdown, groupOffers, inCategory, itemCategory, shelfSlots } from './auctionHouse';

describe('auction house decisions', () => {
  it('puts blueprints and hulls in their own categories and modules by slot', () => {
    expect(itemCategory({ kind: 'module', form: 'blueprint', slot: 'weapon' })).toBe('blueprint');
    expect(itemCategory({ kind: 'hull', form: 'instance' })).toBe('hull');
    expect(itemCategory({ kind: 'module', form: 'instance', slot: 'defense' })).toBe('defense');
    expect(itemCategory({ kind: 'module', form: 'instance' })).toBe('utility');
    expect(inCategory('all', 'material')).toBe(true);
    expect(inCategory('weapon', 'defense')).toBe(false);
  });

  it('groups offers by type with the cheapest first, inside and across tiles', () => {
    const groups = groupOffers(
      [
        { id: 'b', price: 90, key: 'shield' },
        { id: 'a', price: 90, key: 'shield' },
        { id: 'c', price: 40, key: 'engine' },
        { id: 'd', price: 75, key: 'shield' },
      ],
      (o) => o.key,
    );
    expect(groups.map((g) => [g.key, g.lowest])).toEqual([
      ['engine', 40],
      ['shield', 75],
    ]);
    expect(groups[1]!.offers.map((o) => o.id)).toEqual(['d', 'a', 'b']);
  });

  it('lays out used, free and locked shelf slots', () => {
    expect(shelfSlots(2, 4, [3850])).toEqual([
      { state: 'used', index: 0 },
      { state: 'used', index: 1 },
      { state: 'free' },
      { state: 'free' },
      { state: 'locked', xp: 3850 },
    ]);
    // Лоты, выставленные до полки, не прячутся и не дают «отрицательных» свободных мест.
    expect(shelfSlots(3, 2, [])).toHaveLength(3);
  });

  it('formats the time left on a lot', () => {
    expect(countdown(4_718_000)).toBe('01:18:38');
    expect(countdown(-5)).toBe('00:00:00');
    expect(countdown(48 * 3_600_000)).toBe('48:00:00');
  });
});

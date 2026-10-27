import { describe, expect, it } from 'vitest';
import { AVA_FORMATS, avaFormat, corpMaxFormat, parseAvaFormats } from './avaFormats';
import { CORP_BUILDINGS } from './corpConstruction';

describe('AvA battle formats (CORP-7)', () => {
  it('the catalog: 2 на 2 to 10 на 10 at 50 ⟡ a seat, 75 ⟡ a seat to the winner, N − ⌊N/4⌋ players', () => {
    expect(AVA_FORMATS.baseMaxFormat).toBe(3);
    expect(AVA_FORMATS.formats.map((f) => f.format)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const f of AVA_FORMATS.formats) {
      expect(f).toEqual({
        format: f.format,
        cost: 50 * f.format,
        reward: 75 * f.format,
        minPlayers: f.format - Math.floor(f.format / 4),
      });
    }
    expect(avaFormat(AVA_FORMATS, 2)).toMatchObject({ cost: 100, reward: 150, minPlayers: 2 });
    expect(avaFormat(AVA_FORMATS, 1)).toBeUndefined();
    expect(avaFormat(AVA_FORMATS, 11)).toBeUndefined();
  });

  it('rejects a broken catalog before it reaches a challenge', () => {
    const row = { format: 2, cost: 100, reward: 150, minPlayers: 2 };
    for (const raw of [
      null,
      {},
      { baseMaxFormat: 2, formats: [] },
      { baseMaxFormat: 2, formats: [null] },
      { baseMaxFormat: 2, formats: [{ ...row, format: 1, minPlayers: 1 }] }, // a side of one
      { baseMaxFormat: 2, formats: [row, row] }, // not ascending
      { baseMaxFormat: 2, formats: [{ ...row, cost: 0 }] },
      { baseMaxFormat: 2, formats: [{ ...row, reward: 1.5 }] },
      { baseMaxFormat: 2, formats: [{ ...row, minPlayers: 3 }] }, // more than the side holds
      { baseMaxFormat: 4, formats: [row] }, // the base is not a format
    ]) {
      expect(() => parseAvaFormats(raw)).toThrow('E_AVA_FORMATS');
    }
    // Every format a building opens must be one a battle can be played in.
    const known = { baseMaxFormat: 2, formats: [row] };
    expect(() => parseAvaFormats(known)).toThrow('E_AVA_FORMATS'); // the operations center opens 5
  });

  it('a corporation plays up to the base, or what its built levels open', () => {
    const ops = CORP_BUILDINGS.find((b) => b.id === 'operations_center')!;
    expect(ops.levels.map((l) => l.maxFormat)).toEqual([5, 7, 10]);
    expect(corpMaxFormat(AVA_FORMATS, [])).toBe(3);
    expect(corpMaxFormat(AVA_FORMATS, [{ ...ops, level: 0 }])).toBe(3);
    expect(corpMaxFormat(AVA_FORMATS, [{ ...ops, level: 1 }])).toBe(5);
    expect(corpMaxFormat(AVA_FORMATS, [{ ...ops, level: 3 }])).toBe(10);
    // A building without formats changes nothing.
    const hq = CORP_BUILDINGS.find((b) => b.id === 'headquarters')!;
    expect(
      corpMaxFormat(AVA_FORMATS, [
        { ...hq, level: 5 },
        { ...ops, level: 2 },
      ]),
    ).toBe(7);
  });
});

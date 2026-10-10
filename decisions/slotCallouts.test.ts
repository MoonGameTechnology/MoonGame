import { describe, expect, it } from 'vitest';
import { SLOT_ANCHORS, slotCallouts } from './slotCallouts';

const bays = (...types: string[]) => types.map((type) => ({ type }));

describe('slotCallouts — выноски отсеков на арте', () => {
  it('отсек занимает точку своего типа, в порядке отсеков ядра', () => {
    const c = slotCallouts('cruiser', bays('utility', 'weapon', 'defense'))!;
    expect(c.map((x) => x.a)).toEqual([
      [42, 31],
      [72, 21],
      [47, 74],
    ]);
  });

  it('отсеки одного типа берут точки этого типа по очереди', () => {
    const c = slotCallouts('frigate', bays('defense', 'utility', 'utility', 'utility'))!;
    expect(c.map((x) => x.a)).toEqual([
      [34, 73],
      [52, 32],
      [81, 20],
      [17, 56],
    ]);
  });

  it('отсеку без точки своего типа достаётся свободная точка любого типа', () => {
    // Арт крейсера у корпуса с тремя слотами оружия: свою точку получает один,
    // остальные — первые свободные, и ни одна точка не занята дважды.
    const c = slotCallouts('cruiser', bays('weapon', 'weapon', 'weapon'))!;
    expect(c.map((x) => x.a)).toEqual([
      [72, 21],
      [47, 74],
      [42, 31],
    ]);
  });

  it('точек меньше, чем отсеков, или арта нет — выносок нет вовсе', () => {
    expect(slotCallouts('scout', bays('utility', 'utility'))).toBeNull();
    expect(slotCallouts('swarmHunter', bays('weapon'))).toBeNull();
    expect(slotCallouts(undefined, bays('weapon'))).toBeNull();
    expect(slotCallouts('cruiser', [])).toBeNull();
  });

  it('точки и плитки лежат на картинке, плитки одного арта не налезают друг на друга', () => {
    for (const [art, list] of Object.entries(SLOT_ANCHORS)) {
      for (const p of list) {
        for (const v of [...p.a, ...p.t]) {
          expect(v, art).toBeGreaterThanOrEqual(0);
          expect(v, art).toBeLessThanOrEqual(100);
        }
      }
      // Плитка 44 px на телефоне — около 15% ширины и 23% высоты слоя (≈285×190):
      // центры двух плиток расходятся на столько хотя бы по одной оси.
      for (let i = 0; i < list.length; i++) {
        for (let k = i + 1; k < list.length; k++) {
          const dx = Math.abs(list[i]!.t[0] - list[k]!.t[0]);
          const dy = Math.abs(list[i]!.t[1] - list[k]!.t[1]);
          expect(dx > 15 || dy > 23, `${art} ${i}/${k}`).toBe(true);
        }
      }
    }
  });
});

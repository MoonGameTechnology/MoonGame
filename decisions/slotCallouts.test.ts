import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { UNIT_SHAPE } from '../packages/client/src/shipShapes';
import { loadoutBays } from '../packages/shared-core/src/index';
import { SLOT_ANCHORS, slotCallouts } from './slotCallouts';
import {
  freshSectorZeroProgress,
  HERO_SHIP_STAR_SLOTS,
  hullStarCost,
  newSectorHero,
  sectorHeroShipSlots,
  sectorHeroShipUnit,
  sectorHullIds,
  sectorHullSlots,
  type SectorZeroProgress,
} from './sectorZeroProgress';

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
    // Арт крейсера у корпуса с тремя слотами оружия: точек оружия на арте две, третий
    // отсек получает первую свободную, и ни одна точка не занята дважды.
    const c = slotCallouts('cruiser', bays('weapon', 'weapon', 'weapon'))!;
    expect(c.map((x) => x.a)).toEqual([
      [72, 21],
      [81, 28],
      [47, 74],
    ]);
  });

  it('купленный слот добавляет плитку, а стоявшие остаются на своих местах', () => {
    // Крейсер со звездой «защита»: отсеки ядра — оружие, защита, защита, система.
    const before = slotCallouts('cruiser', bays('weapon', 'defense', 'utility'))!;
    const after = slotCallouts('cruiser', bays('weapon', 'defense', 'defense', 'utility'))!;
    expect([after[0], after[1], after[3]]).toEqual(before);
    expect(after[2]!.a).toEqual([17, 51]);
  });

  it('точек меньше, чем отсеков, или арта нет — выносок нет вовсе', () => {
    expect(slotCallouts('scout', bays(...Array<string>(7).fill('utility')))).toBeNull();
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

  // Сторож бага 2026-10-12 (замечание владельца): купил слот — плитки слетели с арта в
  // список, потому что точек было ровно под слоты каталога. Здесь отсеков столько, сколько
  // корпус может получить, — и у каждого должна быть своя точка.
  describe('точек хватает на все отсеки, какие корпус может получить', () => {
    const data = shippedGameData();
    const bayCount = (slots: Parameters<typeof loadoutBays>[0]): number =>
      loadoutBays(slots, [], data).length;
    const anchorsOf = (unit: string): number => SLOT_ANCHORS[UNIT_SHAPE[unit] ?? '']?.length ?? 0;

    it('корпус Сектора Зеро со всеми звёздами корабля', () => {
      for (const hull of sectorHullIds(data)) {
        let p: SectorZeroProgress = freshSectorZeroProgress(data);
        while (hullStarCost(hull, p, data) !== null)
          p = {
            ...p,
            hullStars: { ...p.hullStars, [hull]: [...(p.hullStars[hull] ?? []), 'weapon'] },
          };
        const need = bayCount(sectorHullSlots(hull, p, data));
        if (need > 0)
          expect(anchorsOf(hull), `${hull} → ${UNIT_SHAPE[hull]}`).toBeGreaterThanOrEqual(need);
      }
    });

    it('корабль героя со всеми звёздами героя', () => {
      const top = Math.max(...Object.keys(HERO_SHIP_STAR_SLOTS).map(Number));
      for (const id of Object.keys(data.heroes)) {
        const unit = sectorHeroShipUnit(id, data);
        if (!data.units[unit] || data.units[unit].traits.includes('issued')) continue;
        const need = bayCount(
          sectorHeroShipSlots(id, { ...newSectorHero(id, data), level: top }, data),
        );
        expect(anchorsOf(unit), `${id} → ${unit}`).toBeGreaterThanOrEqual(need);
      }
    });

    it('корпус обычной партии: слоты каталога и отсек главного героя', () => {
      for (const [unit, def] of Object.entries(data.units)) {
        if (!SLOT_ANCHORS[UNIT_SHAPE[unit] ?? '']) continue;
        expect(anchorsOf(unit), unit).toBeGreaterThanOrEqual(bayCount(def.slots));
      }
      // Корабль героя в обычной партии: слоты корпуса плюс отсеки за ступень (`moduleSlots`).
      for (const grade of Object.values(data.heroGrades)) {
        const bonus = grade.moduleSlots ?? {};
        const hull = data.units.hero!.slots;
        const need = bayCount({
          weapon: hull.weapon + (bonus.weapon ?? 0),
          defense: hull.defense + (bonus.defense ?? 0),
          utility: hull.utility + (bonus.utility ?? 0),
        });
        expect(anchorsOf('hero')).toBeGreaterThanOrEqual(need);
      }
    });
  });
});

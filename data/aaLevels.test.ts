/**
 * УРОВНИ ЗЕНИТНЫХ БАТАРЕЙ (FORT-3.1).
 *
 * У обеих батарей не было `upgrades` вообще: построил — и всё, дальше оборона узла не
 * росла ничем, кроме второй постройки, которой `maxPerPlanet` не разрешает. Теперь растут
 * обе, каждая по СВОЕЙ оси: орбитальная — урон по кораблям, зональная — по челнокам.
 *
 * Разделение осей проверяется отдельно и намеренно: спутать их легко (обе «ПВО» на слух),
 * а игрок платит за разные угрозы. Сторож в `schemas.test.ts` держит это на первом уровне —
 * здесь то же требование распространено на ВСЕ уровни, иначе прокачка могла бы тихо
 * превратить одну батарею в другую.
 */
import { describe, expect, it } from 'vitest';
import { buildingLevel, buildingMaxLevel } from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const levelsOf = (id: string) => {
  const def = data.buildings[id]!;
  return [...Array(buildingMaxLevel(def))].map((_, i) => buildingLevel(def, i + 1));
};

describe('зенитные батареи прокачиваются — FORT-3.1', () => {
  it('у ОБЕИХ батарей по три уровня', () => {
    expect(buildingMaxLevel(data.buildings.orbital_aa!)).toBe(3);
    expect(buildingMaxLevel(data.buildings.zonal_aa!)).toBe(3);
  });

  it('каждый уровень СИЛЬНЕЕ предыдущего и ДОРОЖЕ в содержании', () => {
    // Содержание тоже обязано расти: батарея, которая усиливается даром, обесценивает
    // выбор «поставить ещё что-то вместо неё».
    for (const [id, stat] of [['orbital_aa', 'aaDamage'], ['zonal_aa', 'pointDefense']] as const) {
      const rows = levelsOf(id);
      for (let i = 1; i < rows.length; i += 1) {
        expect(rows[i]![stat], `${id}: урон на уровне ${i + 1}`).toBeGreaterThan(rows[i - 1]![stat]);
        expect(rows[i]!.upkeep.energy ?? 0, `${id}: содержание на уровне ${i + 1}`).toBeGreaterThan(
          rows[i - 1]!.upkeep.energy ?? 0,
        );
      }
    }
  });

  it('ОСИ НЕ СМЕШАЛИСЬ НИ НА ОДНОМ уровне: орбитальная бьёт корабли, зональная — челноки', () => {
    // Сторож схемы держит это на первом уровне. Без проверки по всем уровням прокачка
    // могла бы молча выдать орбитальной батарее противочелночный стат — и игрок,
    // заплативший за зональную, получил бы её даром.
    for (const lv of levelsOf('orbital_aa')) {
      expect(lv.aaDamage).toBeGreaterThan(0);
      expect(lv.pointDefense, 'орбитальная батарея начала бить челноки').toBe(0);
    }
    for (const lv of levelsOf('zonal_aa')) {
      expect(lv.pointDefense).toBeGreaterThan(0);
      expect(lv.aaDamage, 'зональная батарея начала бить корабли').toBe(0);
    }
  });

  it('форт остаётся СЛАБЕЕ зональной батареи на ЛЮБОМ уровне (решение владельца 7)', () => {
    // Решение 7 говорит «небольшой дополнительный урон», а не «такой же». Прокачка
    // батареи это только усилила — но проверить стоит именно верхний форт против нижней
    // батареи: если бы форт когда-нибудь догнал её, отдельное здание обесценилось бы.
    const topFort = buildingLevel(data.buildings.fort!, buildingMaxLevel(data.buildings.fort!));
    expect(levelsOf('zonal_aa')[0]!.pointDefense).toBeGreaterThan(topFort.pointDefense);
  });
});

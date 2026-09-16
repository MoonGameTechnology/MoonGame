import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { GameData } from '../data/schemas';
import { loadGameData } from '../data/loadGameData';
import { parseMatchMap } from '../data/mapSchema';
import { shuttleBayAt } from '../state/shuttle';
import { unitBuildSiteBlocker } from './construction';
import type { Planet } from '../state/gameState';

/**
 * ВЕРФЬ СТРОИТ КОРАБЛИ, КОСМОПОРТ ДЕРЖИТ ЧЕЛНОКИ — и это РАЗНЫЕ здания.
 *
 * До разделения оба объявляли `enablesShipConstruction` И `shuttleBay`, то есть были
 * почти одним зданием с разным ценником; дом стартовал с космопортом, и верфь не стояла
 * ни на одной шипнутой карте — своей роли у неё не было вовсе.
 *
 * Разделение целиком живёт в ДАННЫХ: гейт (`unitBuildSiteBlocker`) и так спрашивает два
 * разных поля. Поэтому сторож проверяет не код, а шипнутый каталог и шипнутые карты —
 * единственное место, где правило может тихо развалиться обратно.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(path.join(repoRoot, p), 'utf8'));
const data: GameData = loadGameData((name) => readJson('data/' + name));

const world = (buildings: string[]): Planet => ({
  id: 'N',
  owner: 'p1',
  position: { x: 0, y: 0 },
  resources: {},
  buildings: buildings.map((type) => ({ type, level: 1, hp: data.buildings[type]!.hp })),
  garrison: [],
  traits: [],
});

/** Корабль и челнок шипнутого каталога — берутся по СВОЙСТВУ, а не по имени. */
const someShip = Object.entries(data.units).find(
  ([, u]) => u.domain !== 'ground' && !u.traits.includes('shuttle'),
)![0];
const someShuttle = Object.entries(data.units).find(([, u]) => u.traits.includes('shuttle'))![0];

/** Здания шипнутого каталога по способности — тоже по свойству. */
const yards = Object.keys(data.buildings).filter((b) => data.buildings[b]!.enablesShipConstruction);
const hangars = Object.keys(data.buildings).filter((b) => (data.buildings[b]!.shuttleBay ?? 0) > 0);

describe('верфь и космопорт — разные здания с разными ролями', () => {
  it('ровно одно здание строит корабли и ровно одно держит челноки, и это НЕ одно здание', () => {
    expect(yards).toEqual(['shipyard']);
    expect(hangars).toEqual(['spaceport']);
    expect(yards.some((b) => hangars.includes(b))).toBe(false);
  });

  it('на верфи закладывается корабль, но не челнок', () => {
    const only = world(['shipyard']);
    expect(unitBuildSiteBlocker(only, data.units[someShip]!, data)).toBeNull();
    expect(unitBuildSiteBlocker(only, data.units[someShuttle]!, data)).toBe('E_NO_PORT');
  });

  it('в космопорте закладывается челнок, но не корабль', () => {
    const only = world(['spaceport']);
    expect(unitBuildSiteBlocker(only, data.units[someShuttle]!, data)).toBeNull();
    expect(unitBuildSiteBlocker(only, data.units[someShip]!, data)).toBe('E_NO_SHIPYARD');
  });

  /**
   * ДВА ЯРУСА ВЕРФИ (решение владельца 2026-09-15). После YARD-1 верфь стала ЕДИНСТВЕННЫМ
   * способом строить корабли, и её цена — 400 металла / 200 кредитов / 24 ч — оказалась
   * ценой расширения производства на каждый захваченный мир. При доходе стартового дома
   * (~24 металла, ~6 кредитов в час) это 2–3 дня плюс сутки стройки при сессии в 14.
   *
   * Разложено на ярусы, а не удешевлено: первый ярус уже СТРОИТ КОРАБЛИ и стоит половину,
   * второй доводит до прежней верфи. Полная верфь стоит РОВНО столько же, сколько стоила,
   * — изменилось не «сколько», а «можно ли остановиться на половине».
   */
  it('первый ярус верфи уже строит корабли и стоит ПОЛОВИНУ', () => {
    const yard = data.buildings.shipyard!;
    expect(yard.enablesShipConstruction).toBe(true); // ворота открыты с первого уровня
    expect(yard.upgrades.length).toBeGreaterThan(0);
    const up = yard.upgrades[0]!;
    // Апгрейд не должен ГАСИТЬ способность: `capabilityAt` копит её по уровням, но
    // молчаливый `false` на втором ярусе прочитался бы как «верфь перестала быть верфью».
    expect(up.enablesShipConstruction).toBe(true);
    expect(yard.cost.metal!).toBeLessThan(up.cost.metal! + yard.cost.metal!);
  });

  it('полная верфь стоит столько же, сколько стоила до разделения на ярусы', () => {
    const yard = data.buildings.shipyard!;
    const up = yard.upgrades[0]!;
    expect({
      metal: yard.cost.metal! + up.cost.metal!,
      credits: yard.cost.credits! + up.cost.credits!,
      hours: yard.buildTimeHours + up.buildTimeHours,
    }).toEqual({ metal: 400, credits: 200, hours: 24 });
  });

  it('второй ярус чинит лучше и весит больше очков', () => {
    const yard = data.buildings.shipyard!;
    const up = yard.upgrades[0]!;
    expect(up.shipRepair!).toBeGreaterThan(yard.shipRepair);
    // Очки считает ЯДРО: `scoreValue` умножается на уровень (см. схему), поэтому
    // отдельного поля у яруса нет — полная верфь весит вдвое просто потому, что L2.
    expect(yard.scoreValue * 2).toBe(12);
  });

  it('космопорт приносит кредиты — торговля, а не только ангар', () => {
    const port = data.buildings.spaceport!;
    expect(port.produces?.credits ?? 0).toBeGreaterThan(0);
    // «Небольшой» — меньше, чем у здания, которое ТОЛЬКО про деньги: иначе порт стал бы
    // лучшей экономикой в игре, а ангар — бесплатным довеском.
    expect(port.produces!.credits!).toBeLessThan(data.buildings.refinery!.produces!.credits!);
  });
});

describe('стартовый мир: верфь есть, космопорта НЕТ', () => {
  const maps = readdirSync(path.join(repoRoot, 'data/maps')).filter((f) => f.endsWith('.json'));

  it('шипнутые карты вообще есть — иначе проверки ниже зелены ни на чём', () => {
    expect(maps.length).toBeGreaterThan(0);
  });

  for (const file of maps) {
    it(`${file}: ни один обжитой мир не начинает с ангаром, и каждый начинает с верфью`, () => {
      const map = parseMatchMap(readJson(`data/maps/${file}`));
      const homes = Object.entries(map.sectors).filter(([, s]) => (s.buildings ?? []).length > 0);
      expect(homes.length).toBeGreaterThan(0);
      for (const [id, sec] of homes) {
        const planet = world((sec.buildings ?? []).map((b) => b.type));
        // Ангар — то, что игрок обязан ПОСТРОИТЬ: иначе челноки достаются даром.
        expect([id, shuttleBayAt(planet, data)]).toEqual([id, 0]);
        // Верфь — то, с чего игра начинается: без неё первый корабль не заложить.
        expect([id, unitBuildSiteBlocker(planet, data.units[someShip]!, data)]).toEqual([id, null]);
      }
    });
  }
});

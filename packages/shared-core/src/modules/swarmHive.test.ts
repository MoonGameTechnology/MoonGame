import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGameData } from '../data/loadGameData';
import { buildingLevel, type GameData } from '../data/schemas';


// PVR-4.4 — наземный производственный орган Роя. Кирпич `[data]`: новых механик не
// заводится, орган выражен ИМЕЮЩИМИСЯ — гейтом наземной постройки и содержанием.
// Проверяется шипнутый каталог, потому что правило может развалиться только в нём.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const data: GameData = loadGameData((name) =>
  JSON.parse(readFileSync(path.join(root, 'data', name), 'utf8')),
);

describe('PVR-4.4 — Улей как наземный орган', () => {
  it('Улей есть в каталоге и помечен заражённым, как остальные органы', () => {
    const hive = data.buildings.swarm_hive;
    expect(hive).toBeDefined();
    expect(hive!.traits).toContain('infected');
  });

  it('он и есть то, что позволяет Рою растить наземные формы', () => {
    // Способность живёт на самом определении, а не на ступени: у органов Роя
    // ступеней нет вовсе (§3.6), и `buildingLevel` их поля не переносит.
    expect(data.buildings.swarm_hive!.enablesInfantryConstruction).toBe(true);
  });

  it('очаг растёт, только имея ПИТАНИЕ: у Улья содержание в биомассе', () => {
    // Задолженность по ресурсу содержания переводит здание в brownout (economy.ts),
    // то есть голодный очаг работает вполсилы. Это и есть «только имея питание»,
    // выраженное механикой, которая в игре уже есть.
    const upkeep = buildingLevel(data.buildings.swarm_hive!, 1).upkeep;
    expect(upkeep.biomass).toBeGreaterThan(0);
  });

  it('у органов Роя нет лестницы улучшений — §3.6 запрещает уровни зданий', () => {
    for (const id of ['swarm_hive', 'biomass_pit', 'swarm_synapse']) {
      const def = data.buildings[id];
      expect(def, id).toBeDefined();
      expect(def!.upgrades, id).toEqual([]);
    }
  });

  it('Улей стоит у Роя с начала забега — иначе первая волна растить десант не смогла бы', () => {
    expect(data.factions.swarm!.startingLoadout.homeBuildings).toContain('swarm_hive');
  });

  it('орган стоит биомассы и металла: он выращен, а не куплен за кредиты', () => {
    const cost = buildingLevel(data.buildings.swarm_hive!, 1).cost;
    expect(cost.biomass).toBeGreaterThan(0);
    expect(cost.metal).toBeGreaterThan(0);
    expect(cost.credits ?? 0).toBe(0);
  });

  it('Улей разрушим — иначе очаг нельзя было бы остановить', () => {
    expect(buildingLevel(data.buildings.swarm_hive!, 1).hp).toBeGreaterThan(0);
  });
});

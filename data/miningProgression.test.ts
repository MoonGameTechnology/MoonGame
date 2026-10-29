import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canBuildHere } from '../decisions/buildGate';
import { buildingLevel, buildingMaxLevel } from '../packages/shared-core/src/index';
import { parseMatchMap } from '../packages/shared-core/src/data/mapSchema';
import { shippedGameData } from './bundle';

const data = shippedGameData();

describe('one planetary mining progression', () => {
  it('offers one metal producer on a planet and a separate rig on asteroids', () => {
    const producers = (kind: string) => Object.entries(data.buildings)
      .filter(([id, def]) => (def.produces.metal ?? 0) > 0 && canBuildHere({ kind }, id, data, false))
      .map(([id]) => id);
    expect(producers('planet')).toEqual(['mine']);
    expect(producers('asteroid')).toEqual(['metal_station']);
    expect(producers('dead_world')).toEqual(['metal_station']);
    expect(buildingMaxLevel(data.buildings.mine!)).toBe(3);
    expect([1, 2, 3].map((level) => buildingLevel(data.buildings.mine!, level).produces.metal))
      .toEqual([12, 18, 27]);
  });

  it('keeps legacy extraction rates and paid-order prices available to old matches', () => {
    expect(data.buildings.mine_t1).toMatchObject({ retired: true, produces: { metal: 20 }, cost: { metal: 100 } });
    expect(data.buildings.mine_t2).toMatchObject({ retired: true, produces: { metal: 55 }, cost: { metal: 300, credits: 120 } });
  });

  it('new map seeds contain no retired content or duplicate mines', () => {
    const dir = new URL('./maps/', import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const map = parseMatchMap(JSON.parse(readFileSync(new URL(file, dir), 'utf8')));
      for (const [id, node] of Object.entries(map.sectors)) {
        const buildings = node.buildings ?? [];
        for (const b of buildings) expect(data.buildings[b.type]?.retired, `${file}/${id}/${b.type}`).not.toBe(true);
        expect(buildings.filter((b) => b.type === 'mine').length, `${file}/${id}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('starting factions and research no longer grant retired buildings', () => {
    for (const faction of Object.values(data.factions)) {
      for (const id of faction.startingLoadout.homeBuildings) expect(data.buildings[id]?.retired).not.toBe(true);
    }
    for (const tech of Object.values(data.technologies)) {
      for (const id of (tech.unlocks.buildings ?? [])) expect(data.buildings[id]?.retired).not.toBe(true);
    }
    expect(data.technologies.industrial_automation!.effects.productionBonus).toBe(0.1);
  });
});

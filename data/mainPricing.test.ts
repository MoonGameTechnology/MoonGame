/**
 * ЦЕНЫ ОСНОВНОЙ ИГРЫ (резолюция владельца 2026-10-18: «я только про основную игру»).
 *
 * Корабли, юниты, здания и технологии дороже каталога только в основной игре. Каталог у неё
 * общий с главами Sector Zero, поэтому дорожает не каталог, а партия: карта основной игры
 * объявляет `pricing`, и `buildStateFromMap` закрепляет его в состоянии. Здесь держится,
 * что правило одно на все карты основной игры и что главы его не получают.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { pveState, PVE_MISSION_COUNT } from '../packages/client/src/gameData';
import { shippedGameData } from './bundle';
import { buildingLevel, matchCost, matchStart, matchUnitCost, matchHours, matchBuildingHours, matchUnitHours } from '../packages/shared-core/src/index';
import { MatchPricingSchema } from '../packages/shared-core/src/data/schemas';

const data = shippedGameData();
const dir = new URL('./maps/', import.meta.url);
const maps = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, json: JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Record<string, unknown> }));
const mainMaps = maps.filter((m) => (m.json.techRules as { ruleset?: string } | undefined)?.ruleset === 'main');

describe('цены основной игры', () => {
  it('карты основной игры есть, и у каждой — цены партии', () => {
    expect(mainMaps.map((m) => m.file).sort()).toEqual([
      'duel-1.json',
      'ffa-20.json',
      'ffa-4.json',
      'ffa-50.json',
      'team-2v2.json',
      'team-3v3.json',
    ]);
    for (const m of mainMaps) expect(m.json.pricing, m.file).toBeDefined();
  });

  it('правило одно на все карты основной игры', () => {
    const first = mainMaps[0]!.json.pricing;
    for (const m of mainMaps) expect(m.json.pricing, m.file).toEqual(first);
  });

  it('новые партии: здания и улучшения ×3, юниты ×2, исследования без новой надбавки', () => {
    for (const map of mainMaps) {
      const pricing = MatchPricingSchema.parse(map.json.pricing);
      expect(pricing.buildingHours, map.file).toBe(3);
      expect(pricing.unitHours, map.file).toBe(2);
      const state = { pricing };
      for (const def of Object.values(data.buildings)) {
        for (const step of [def, ...def.upgrades])
          expect(matchBuildingHours(state, step.buildTimeHours), map.file)
            .toBe(matchHours(state, step.buildTimeHours) * 3);
      }
      for (const def of Object.values(data.units))
        expect(matchUnitHours(state, def.buildTimeHours), map.file)
          .toBe(matchHours(state, def.buildTimeHours) * 2);
      expect(matchHours(state, 4), map.file).toBe(8);
    }
  });

  it('the opening metal budget buys either two cruisers or one cruiser and a mine upgrade', () => {
    const pricing = MatchPricingSchema.parse(mainMaps[0]!.json.pricing);
    const state = { pricing };
    const start = matchStart(pricing, { metal: 320 }).metal!;
    const cruiser = matchUnitCost(state, data.units.cruiser!).metal!;
    const upgrade = matchCost(state, buildingLevel(data.buildings.mine!, 2).cost).metal!;
    expect(2 * cruiser).toBeLessThanOrEqual(start);
    expect(cruiser + upgrade).toBeLessThanOrEqual(start);
    expect(2 * cruiser + upgrade).toBeGreaterThan(start);
    expect(matchUnitCost(state, data.units.heavy_cruiser!).metal! + upgrade).toBeGreaterThan(start);
  });

  it('цены партии есть только у карт основной игры', () => {
    for (const m of maps) if (!mainMaps.includes(m)) expect(m.json.pricing, m.file).toBeUndefined();
  });

  for (let mission = 0; mission < PVE_MISSION_COUNT; mission++) {
    it(`глава ${mission + 1} платит цену каталога`, () => {
      const state = pveState(data, mission);
      expect(state.pricing).toBeUndefined();
      expect(matchBuildingHours(state, data.buildings.shipyard!.buildTimeHours)).toBe(12);
      expect(matchUnitHours(state, data.units.cruiser!.buildTimeHours)).toBe(3);
    });
  }
});

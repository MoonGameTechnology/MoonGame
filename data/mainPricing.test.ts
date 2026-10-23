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

  it('цены партии есть только у карт основной игры', () => {
    for (const m of maps) if (!mainMaps.includes(m)) expect(m.json.pricing, m.file).toBeUndefined();
  });

  for (let mission = 0; mission < PVE_MISSION_COUNT; mission++) {
    it(`глава ${mission + 1} платит цену каталога`, () => {
      expect(pveState(data, mission).pricing).toBeUndefined();
    });
  }
});

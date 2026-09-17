/**
 * ГОСПИТАЛЬ ЛЕЧИТ ТРЮМ (FORT-5.9; из описания построек крепости: «когда флот игрока или
 * союзника в центре провинции рядом с крепостью, лечатся наземные войска в трюме флота»).
 *
 * До этого кирпича трюм не лечил НИКТО И НИГДЕ: раненый десант оставался раненым навсегда,
 * если его не высадить в гарнизон. Госпиталь при этом существовал и лечил — но только
 * гарнизон самого узла.
 *
 * Четыре вещи, которые могут отвалиться по отдельности:
 *   1. трюм своего флота лечится;
 *   2. трюм СОЮЗНОГО — тоже (иначе тот же дефект-класс, что у форта и дока);
 *   3. чужой трюм НЕ лечится (иначе правило расползлось до «кто рядом стоял»);
 *   4. гарнизон продолжает лечиться, как лечился — новая ветка не должна вытеснить старую.
 */
import { describe, expect, it } from 'vitest';
import {
  constructionModule,
  createInitialState,
  createKernel,
  diplomacyModule,
  pairKey,
  type Context,
  type Fleet,
  type GameState,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const HOUR = 3_600_000;
const ctx = (now = 0): Context => ({ now, data });
const kernel = createKernel([diplomacyModule, constructionModule]);
const HURT = 10;

/** Госпиталь на своём узле; рядом припаркован флот `owner` с побитым десантом в трюме. */
function world(owner: string, stance?: 'alliance' | 'pact'): GameState {
  const s = createInitialState({ seed: 'hh', version: { data: data.version, manifest: '1' } });
  const visitor: Fleet = {
    id: 'F', owner, location: 'A', movement: null,
    units: [{ unit: 'cruiser', count: 1 }],
    landing: [{ unit: 'militia', count: 4, hp: HURT }],
    traits: [], battleId: null,
  };
  return {
    ...s,
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: {} },
      p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} },
    },
    planets: {
      A: {
        id: 'A', owner: 'p1', kind: 'void_station', position: { x: 0, y: 0 }, links: [],
        resources: {}, buildings: [{ type: 'hospital', level: 1, hp: 100 }],
        garrison: [{ unit: 'militia', count: 3, hp: HURT }], traits: [],
      },
    },
    fleets: { F: visitor },
    ...(stance ? { diplomacy: { [pairKey('p1', 'p2')]: stance } } : {}),
  };
}
/** HP десанта в трюме после нескольких часов стоянки. */
function heldAfter(st: GameState): number {
  const r = kernel.advanceTo(st, ctx(6 * HOUR));
  if (!r.ok) throw new Error('advance отказ');
  return r.state.fleets.F!.landing![0]!.hp ?? 999;
}

describe('госпиталь лечит трюм — FORT-5.9', () => {
  it('СВОЙ флот: десант в трюме подлечивается', () => {
    expect(heldAfter(world('p1'))).toBeGreaterThan(HURT);
  });

  it('СОЮЗНЫЙ флот — тоже', () => {
    expect(heldAfter(world('p2', 'alliance'))).toBeGreaterThan(HURT);
  });

  it('ЧУЖОЙ флот не лечится — правило не расползлось до «кто рядом стоял»', () => {
    expect(heldAfter(world('p2'))).toBe(HURT);
    // И пакт о ненападении тоже не лечит: союзник это ровно `alliance`, как у форта и дока.
    expect(heldAfter(world('p2', 'pact'))).toBe(HURT);
  });

  it('ГАРНИЗОН по-прежнему лечится — новая ветка не вытеснила старую', () => {
    const r = kernel.advanceTo(world('p1'), ctx(6 * HOUR));
    if (!r.ok) throw new Error('advance отказ');
    expect(r.state.planets.A!.garrison[0]!.hp ?? 999).toBeGreaterThan(HURT);
  });
});

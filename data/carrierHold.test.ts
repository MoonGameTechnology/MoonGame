/**
 * ТРЮМ У КОРАБЛЯ ОДИН (резолюция владельца 2026-09-26, SHU-5.1).
 *
 * Прежнее правило (2026-09-16) «носитель возит только челноки, пехоту — нет» снято:
 * шаттлы едут в ОБЩЕМ трюме любого корабля вместе с десантом, и у авианосца вместо
 * отдельного `shuttleBay` обычный `cargoCapacity`. Сторож смотрит на следствие в ядре:
 * авианосец берёт пехоту, а шаттлы на борту занимают те же места, что и десант.
 */
import { describe, expect, it } from 'vitest';
import { shippedGameData } from './bundle';
import { createKernel } from '../packages/shared-core/src/kernel/kernel';
import { armyModule } from '../packages/shared-core/src/modules/army';
import { createInitialState } from '../packages/shared-core/src/state/gameState';
import type { GameState } from '../packages/shared-core/src/state/gameState';
import type { Action } from '../packages/shared-core/src/action/types';

const data = shippedGameData();
const kernel = createKernel([armyModule]);

/** Мир с ротой ополчения и флот из ОДНОГО корпуса на его стоянке. */
function world(hull: string): GameState {
  const s = createInitialState({ seed: 'hold', version: { data: data.version, manifest: '1' } });
  return {
    ...s,
    players: { p1: { id: 'p1', name: 'p1', faction: 'azure', status: 'active', resources: {} } },
    planets: {
      A: {
        id: 'A', owner: 'p1', position: { x: 0, y: 0 }, resources: {}, buildings: [],
        garrison: [{ unit: 'militia', count: 6 }], traits: [], kind: 'planet',
      },
    },
    fleets: {
      F: {
        id: 'F', owner: 'p1', location: 'A', movement: null,
        units: [{ unit: hull, count: 1 }], traits: [], battleId: null,
      },
    },
    heroes: {},
    battles: {},
  };
}

const load = (): Action => ({
  id: 'a:1', type: 'army.load', playerId: 'p1',
  payload: { fleetId: 'F', unit: 'militia', count: 1 }, issuedAt: 0,
});

describe('трюм авианосца — общий', () => {
  it('АВИАНОСЕЦ БЕРЁТ ПЕХОТУ — трюм у корабля один', () => {
    const r = kernel.applyAction(world('shuttle_carrier'), load(), { now: 0, data });
    expect(r.ok).toBe(true);
  });

  it('шаттлы на борту занимают места десанта', () => {
    const s = world('shuttle_carrier');
    const cap = data.units.shuttle_carrier!.stats.cargoCapacity ?? 0;
    expect(cap).toBeGreaterThan(0);
    // Трюм забит перехватчиками по одному месту — пехоте места нет.
    s.fleets.F!.hangar = [{ id: 'sq:1', units: [{ unit: 'interceptor', count: cap }] }];
    const r = kernel.applyAction(s, load(), { now: 0, data });
    expect(r.ok ? 'ПОГРУЗИЛ' : r.code).toBe('E_NO_CAPACITY');
  });

  it('ДЕСАНТНЫЙ КОРАБЛЬ пехоту берёт', () => {
    const r = kernel.applyAction(world('strike_carrier'), load(), { now: 0, data });
    expect(r.ok).toBe(true);
  });
});

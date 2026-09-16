/**
 * НОСИТЕЛЬ ВОЗИТ ЧЕЛНОКИ, А НЕ ПЕХОТУ (правка владельца 2026-09-16).
 *
 * «Носитель (Шаттл) не должен иметь трюма под наземных юнитов, в него грузятся только
 * челноки». В данных это выражено ОТСУТСТВИЕМ поля: у `shuttle_carrier` есть
 * `shuttleBay` и нет `cargoCapacity`. Отсутствие — вещь хрупкая: строчку `cargoCapacity`
 * допишут «за компанию» при следующей правке корпуса, схема примет её молча (дефолт 0
 * превратится в число), и носитель тихо станет войсковым транспортом.
 *
 * Сторож смотрит НЕ в json, а на следствие: ядро отбивает попытку поднять на носитель
 * наземного юнита — значит трюма у него действительно нет. Тавтологию «в файле написано
 * то, что написано» такой тест бы не поймал.
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

describe('трюм носителя челноков', () => {
  it('НОСИТЕЛЬ НЕ БЕРЁТ ПЕХОТУ — у него ангар, а не войсковой трюм', () => {
    const r = kernel.applyAction(world('shuttle_carrier'), load(), { now: 0, data });
    expect(r.ok ? 'ПОГРУЗИЛ' : r.code).toBe('E_NO_CAPACITY');
  });

  it('…и ангар у него при этом ЕСТЬ — иначе он не носитель', () => {
    expect(data.units.shuttle_carrier?.stats.shuttleBay).toBeGreaterThan(0);
  });

  it('ДЕСАНТНЫЙ КОРАБЛЬ пехоту берёт — запрет адресный, а не общий', () => {
    const r = kernel.applyAction(world('strike_carrier'), load(), { now: 0, data });
    expect(r.ok).toBe(true);
  });
});

/**
 * ДОК ЧИНИТ СОЮЗНИКУ (FORT-5.8; из описания верфи крепости: «небольшой ремонт флоту
 * союзника или вашему, стоящему рядом»).
 *
 * До этого кирпича не чинил: проверка была `planet.owner === fleet.owner`. Тот же
 * дефект-класс, что решение 5 нашло у форта, — правило обещало союзников, а код
 * спрашивал владельца, и заметить это можно было только спросив про ВТОРОГО игрока.
 *
 * Проверяются ОБА пути ремонта у дока (платный приказ и пассивная починка со временем):
 * починить один и забыть второй — это и есть «необъяснимо частичный эффект», которым
 * болели два хука наземной защиты форта.
 *
 * И отдельно — что правило не размазалось: перемирие доком не делится. Союзник это
 * ровно `alliance`, как и у форта.
 */
import { describe, expect, it } from 'vitest';
import {
  constructionModule,
  pairKey,
  createInitialState,
  createKernel,
  diplomacyModule,
  fleetRepairModule,
  type Action,
  type Context,
  type Fleet,
  type GameState,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const HOUR = 3_600_000;
const ctx = (now = 0): Context => ({ now, data });

/** Мир СОЮЗНИКА с верфью, и у нашего борта побитый флот на его орбите. */
function world(stance: 'alliance' | 'pact' | null): GameState {
  const s = createInitialState({ seed: 'ad', version: { data: data.version, manifest: '1' } });
  const beaten: Fleet = {
    id: 'F', owner: 'p1', location: 'A', movement: null,
    units: [{ unit: 'cruiser', count: 1, hp: 20 }], landing: [], traits: [], battleId: null,
  };
  return {
    ...s,
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: { metal: 9000, credits: 9000 } },
      p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: { metal: 9000 } },
    },
    planets: {
      A: {
        id: 'A', owner: 'p2', kind: 'planet', position: { x: 0, y: 0 }, links: [],
        resources: {}, buildings: [{ type: 'shipyard', level: 1, hp: 100 }], garrison: [], traits: [],
      },
    },
    fleets: { F: beaten },
    ...(stance ? { diplomacy: { [pairKey('p1', 'p2')]: stance } } : {}),
  };
}
const repairOrder: Action = {
  id: 's:p1:1', type: 'fleet.repair', playerId: 'p1', payload: { fleetId: 'F' }, issuedAt: 0,
};

describe('док союзника — FORT-5.8', () => {
  const kernel = createKernel([diplomacyModule, constructionModule, fleetRepairModule]);

  it('ПЛАТНЫЙ ремонт у союзного дока проходит', () => {
    const r = kernel.applyAction(world('alliance'), repairOrder, ctx());
    expect(r.ok, r.ok ? '' : `отказ ${r.code}`).toBe(true);
  });

  it('ПАССИВНАЯ починка у союзного дока тоже идёт — второй путь не забыт', () => {
    const r = kernel.advanceTo(world('alliance'), ctx(6 * HOUR));
    if (!r.ok) throw new Error('advance отказ');
    expect(r.state.fleets.F!.units[0]!.hp ?? 999).toBeGreaterThan(20);
  });

  it('БЕЗ союза — обоим путям отказ: чужой док остаётся чужим', () => {
    // Контроль в другую сторону: если бы проверка владельца просто исчезла, чинились бы
    // у кого угодно, включая врага.
    const r = kernel.applyAction(world(null), repairOrder, ctx());
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.code).toBe('E_NO_DOCK');
    const passive = kernel.advanceTo(world(null), ctx(6 * HOUR));
    if (!passive.ok) throw new Error('advance отказ');
    expect(passive.state.fleets.F!.units[0]!.hp).toBe(20);
  });

  it('ПАКТ доком не делится — союзник это ровно `alliance`', () => {
    // Та же граница, что у форта (решение 5): пакт о ненападении войсками не делится —
    // значит и доком. Иначе «союзник» расползся бы до «не враг».
    expect(kernel.applyAction(world('pact'), repairOrder, ctx()).ok).toBe(false);
  });
});

/**
 * ДОК ЧИНИТ СОЮЗНИКУ (FORT-5.8; из описания верфи крепости: «небольшой ремонт флоту
 * союзника или вашему, стоящему рядом»).
 *
 * До этого кирпича не чинил: проверка была `planet.owner === fleet.owner`. Тот же
 * дефект-класс, что решение 5 нашло у форта, — правило обещало союзников, а код
 * спрашивал владельца, и заметить это можно было только спросив про ВТОРОГО игрока.
 *
 * У дока остался ОДИН путь ремонта — пассивная починка со временем: платный приказ за
 * металл снят (заказ владельца 2026-11-01, «убрать полное лечение кораблей за металл»).
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
describe('док союзника — FORT-5.8', () => {
  const kernel = createKernel([diplomacyModule, constructionModule]);
  const hull = (stance: 'alliance' | 'pact' | null): number | undefined => {
    const r = kernel.advanceTo(world(stance), ctx(6 * HOUR));
    if (!r.ok) throw new Error('advance отказ');
    return r.state.fleets.F!.units[0]!.hp;
  };

  it('у союзного дока корпус чинится со временем', () => {
    expect(hull('alliance') ?? 999).toBeGreaterThan(20);
  });

  it('БЕЗ союза — не чинится: чужой док остаётся чужим', () => {
    // Контроль в другую сторону: если бы проверка владельца просто исчезла, чинились бы
    // у кого угодно, включая врага.
    expect(hull(null)).toBe(20);
  });

  it('ПАКТ доком не делится — союзник это ровно `alliance`', () => {
    // Та же граница, что у форта (решение 5): пакт о ненападении войсками не делится —
    // значит и доком. Иначе «союзник» расползся бы до «не враг».
    expect(hull('pact')).toBe(20);
  });
});

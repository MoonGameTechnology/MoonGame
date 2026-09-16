/**
 * КРЕПОСТЬ ПОД УДАРОМ (FORT-5.12; решения владельца 16 и 17 — §0.7 роадмапа).
 *
 * Две половины, и обе до этого кирпича НЕ выполнялись:
 *
 *   16. «Бомбардировка невозможна крепости». А она была возможна: обстрел требует у узла
 *       орбитального слоя, и у крепости он есть — нужен ей для собственной зенитки.
 *       Снять орбиту нельзя, поэтому запрет живёт отдельным флагом вида.
 *   17. «Пока идёт бой, производство и лечение/ремонт остановлены». Заморозка в игре
 *       была, но привязана НЕ К ТОМУ: производство глушила БОМБАРДИРОВКА, лечение
 *       гарнизона — только НАЗЕМНЫЙ бой, а корабль не чинился, лишь когда сам был в бою.
 *       То есть орбитальный бой у крепости не останавливал ничего.
 *
 * У каждой проверки есть КОНТРОЛЬНАЯ половина: без неё тест был бы зелёным и на правиле,
 * сломанном в другую сторону (например, «никто никогда ничего не производит»).
 */
import { describe, expect, it } from 'vitest';
import {
  constructionModule,
  createInitialState,
  createKernel,
  economyModule,
  isActivelyBombarding,
  type Action,
  type Battle,
  type Context,
  type Fleet,
  type GameState,
  type Planet,
} from '../packages/shared-core/src/index';
import { shippedGameData } from './bundle';

const data = shippedGameData();
const HOUR = 3_600_000;
const ctx = (now = 0): Context => ({ now, data });

function node(kind: string, over: Partial<Planet> = {}): Planet {
  return {
    id: 'A', owner: 'p1', kind, position: { x: 0, y: 0 }, links: [],
    resources: {}, buildings: [], garrison: [], traits: [], ...over,
  };
}
function world(planet: Planet, over: Partial<GameState> = {}): GameState {
  const s = createInitialState({ seed: 'uf', version: { data: data.version, manifest: '1' } });
  return {
    ...s,
    players: {
      p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: { metal: 9000, credits: 9000, energy: 9000, food: 9000 } },
      p2: { id: 'p2', name: 'p2', faction: 'x', status: 'active', resources: {} },
    },
    planets: { A: planet },
    ...over,
  };
}
/** Бой ОРБИТАЛЬНОЙ фазы на узле — именно он раньше не глушил ничего. */
const orbitalBattle = (location = 'A'): Record<string, Battle> => ({
  'battle:0': {
    id: 'battle:0',
    location,
    phase: 'orbital',
    sides: [
      { ref: { kind: 'fleet', fleetId: 'E' }, owner: 'p2', role: 'attacker' },
      { ref: { kind: 'fleet', fleetId: 'D' }, owner: 'p1', role: 'defender' },
    ],
    round: 0,
  },
});
const act = (type: string, payload: Record<string, unknown>): Action => ({
  id: 's:p1:1', type, playerId: 'p1', payload, issuedAt: 0,
});

describe('решение 16 — крепость не обстреливают', () => {
  const shelling = (kind: string): boolean => {
    const planet = node(kind);
    const bomber: Fleet = {
      id: 'B', owner: 'p2', location: 'A', movement: null, orbit: 'near', bombarding: true,
      units: [{ unit: 'cruiser', count: 3 }], landing: [], traits: [], battleId: null,
    };
    const st = world(planet, { fleets: { B: bomber } });
    return isActivelyBombarding(st, bomber, () => true, data);
  };

  it('над КРЕПОСТЬЮ приказ на обстрел не действует', () => {
    expect(shelling('void_station')).toBe(false);
  });

  it('контроль: над ПЛАНЕТОЙ тот же флот обстреливает', () => {
    // Без этой половины проверка выше была бы зелёной и на «обстрела в игре нет вовсе».
    expect(shelling('planet')).toBe(true);
  });
});

describe('решение 17 — пока идёт бой, узел не работает', () => {
  it('ПРОИЗВОДСТВО встаёт, и возобновляется само после боя', () => {
    const kernel = createKernel([economyModule]);
    const mined = node('planet', { buildings: [{ type: 'mine', level: 1, hp: 100 }] });
    const quiet = kernel.advanceTo(world(mined), ctx(4 * HOUR));
    if (!quiet.ok) throw new Error('advance отказ');
    const earned = quiet.state.players.p1!.resources.metal! - 9000;
    expect(earned, 'контроль: в тишине шахта обязана давать металл').toBeGreaterThan(0);

    const fought = kernel.advanceTo(world(mined, { battles: orbitalBattle() }), ctx(4 * HOUR));
    if (!fought.ok) throw new Error('advance отказ');
    expect(fought.state.players.p1!.resources.metal).toBe(9000); // ни грамма
  });

  it('ЗАКАЗ отбивается своим кодом — не «вас обстреливают», а «здесь бой»', () => {
    // Код важен: `E_BOMBARDED` отправил бы игрока искать чужой флот на орбите, а бой
    // идёт у него под окнами.
    const kernel = createKernel([constructionModule]);
    const st = world(node('planet'), { battles: orbitalBattle() });
    const r = kernel.applyAction(st, act('building.construct', { planetId: 'A', building: 'mine' }), ctx());
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.code).toBe('E_BATTLE_HERE');
    // Контроль: без боя тот же заказ проходит.
    expect(kernel.applyAction(world(node('planet')), act('building.construct', { planetId: 'A', building: 'mine' }), ctx()).ok).toBe(true);
  });

  it('ГОСПИТАЛЬ не лечит гарнизон под ОРБИТАЛЬНЫМ боем — раньше лечил', () => {
    // Самая тихая из дыр: условием был только НАЗЕМНЫЙ бой, поэтому флот врага мог
    // резаться с крепостью на орбите, а госпиталь внизу спокойно штопал гарнизон.
    const kernel = createKernel([constructionModule]);
    const hurt = (): Planet => node('planet', {
      buildings: [{ type: 'hospital', level: 1, hp: 100 }],
      garrison: [{ unit: 'militia', count: 4, hp: 10 }],
    });
    const healed = kernel.advanceTo(world(hurt()), ctx(4 * HOUR));
    if (!healed.ok) throw new Error('advance отказ');
    const after = healed.state.planets.A!.garrison[0]!.hp ?? 999;
    expect(after, 'контроль: в тишине госпиталь обязан лечить').toBeGreaterThan(10);

    const under = kernel.advanceTo(world(hurt(), { battles: orbitalBattle() }), ctx(4 * HOUR));
    if (!under.ok) throw new Error('advance отказ');
    expect(under.state.planets.A!.garrison[0]!.hp).toBe(10); // ни единицы
  });

  it('ДОК не чинит флот, стоящий под боем, даже если сам флот в драку не втянут', () => {
    const kernel = createKernel([constructionModule]);
    const docked = (): Planet => node('planet', { buildings: [{ type: 'shipyard', level: 1, hp: 100 }] });
    const beaten = (): Record<string, Fleet> => ({
      F: {
        id: 'F', owner: 'p1', location: 'A', movement: null,
        units: [{ unit: 'cruiser', count: 1, hp: 20 }], landing: [], traits: [], battleId: null,
      },
    });
    const mended = kernel.advanceTo(world(docked(), { fleets: beaten() }), ctx(6 * HOUR));
    if (!mended.ok) throw new Error('advance отказ');
    expect(mended.state.fleets.F!.units[0]!.hp ?? 999, 'контроль: у дока флот обязан чиниться').toBeGreaterThan(20);

    const busy = kernel.advanceTo(world(docked(), { fleets: beaten(), battles: orbitalBattle() }), ctx(6 * HOUR));
    if (!busy.ok) throw new Error('advance отказ');
    expect(busy.state.fleets.F!.units[0]!.hp).toBe(20); // ни единицы
  });
});

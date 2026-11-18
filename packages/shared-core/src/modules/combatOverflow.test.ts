import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { createInitialState, type BattleSide, type GameState } from '../state/gameState';
import { previewSides } from '../state/previewBattle';
import { parseGameData } from '../data/schemas';
import { OVERCHARGE_HOURS } from '../util/overflow';
import { combatModule } from './combat';

/**
 * Остаток залпа уходит в живые цели; доля без цели — заряд флота на пять игровых минут
 * (резолюция владельца 2026-11-17, `util/overflow.ts`).
 */
const HOUR = 3_600_000;
const WINDOW = OVERCHARGE_HOURS * HOUR;
const data = parseGameData({
  version: 'overflow',
  resources: ['metal'],
  factions: {},
  buildings: {},
  events: {},
  units: {
    ship: { faction: 'x', stats: { hp: 1000, speed: 1, attack: 12, defense: 8 } },
    // Приманка: почти без корпуса и без оружия.
    decoy: { faction: 'x', stats: { hp: 2, speed: 1, attack: 0, defense: 0 } },
  },
});
/** Прилёт флота `d` к миру P — как приходит любой флот (`fleet.arrived`). */
const signals: GameModule = {
  id: 'test-arrive',
  version: '1',
  setup(api) {
    api.onAction('test.arrive', (_, h) => h.emit('fleet.arrived', { fleetId: 'd', at: 'P' }));
  },
};
const kernel = createKernel([combatModule, signals]);
const ctx = (now: number) => ({ now, data });

/** Бой у P: флот `a` атакует, против него — флоты из `foes` (все — владелец `b`). */
function world(foes: Record<string, string>): GameState {
  const state = createInitialState({
    seed: 'overflow',
    version: { data: data.version, manifest: '1' },
  });
  for (const owner of ['a', 'b', 'd']) {
    state.players[owner] = {
      id: owner,
      name: owner,
      faction: 'x',
      status: 'active',
      resources: {},
    };
  }
  state.planets.P = {
    id: 'P',
    owner: null,
    position: { x: 0, y: 0 },
    resources: {},
    buildings: [],
    traits: [],
    garrison: [],
  };
  state.fleets.a = {
    id: 'a',
    owner: 'a',
    location: 'P',
    movement: null,
    units: [{ unit: 'ship', count: 1 }],
    traits: [],
    battleId: 'battle:0',
  };
  const sides: BattleSide[] = [
    {
      ref: { kind: 'fleet', fleetId: 'a' },
      owner: 'a',
      role: 'attacker',
      attackStartedAt: 0,
      nextAttackAt: HOUR,
      attackCount: 0,
    },
  ];
  for (const [id, unit] of Object.entries(foes)) {
    state.fleets[id] = {
      id,
      owner: 'b',
      location: 'P',
      movement: null,
      units: [{ unit, count: 1 }],
      traits: [],
      battleId: 'battle:0',
    };
    sides.push({ ref: { kind: 'fleet', fleetId: id }, owner: 'b', role: 'defender' });
  }
  state.battles['battle:0'] = {
    id: 'battle:0',
    location: 'P',
    phase: 'orbital',
    sides,
    round: 0,
    nextRoundAt: HOUR,
  };
  state.battleSeq = 1;
  state.scheduled = [
    { id: 'evt:0', seq: 0, type: 'combat.tick', at: HOUR, payload: { battleId: 'battle:0' } },
  ];
  state.scheduleSeq = 1;
  return state;
}
function advance(state: GameState, now: number) {
  const result = kernel.advanceTo(state, ctx(now));
  if (!result.ok) throw Error(result.code);
  expect(result.failures).toEqual([]);
  return result;
}
/** Флот `d` прилетает к P в момент `now`. */
function arrive(state: GameState, now: number) {
  state.fleets.d = {
    id: 'd',
    owner: 'd',
    location: 'P',
    movement: null,
    units: [{ unit: 'ship', count: 1 }],
    traits: [],
  };
  const result = kernel.applyAction(
    state,
    { id: 'arrive', type: 'test.arrive', playerId: 'd', issuedAt: now, payload: {} },
    ctx(now),
  );
  if (!result.ok) throw Error(result.code);
  return result;
}

describe('остаток залпа уходит в живые цели (резолюция 2026-11-17)', () => {
  it('приманка забирает свои 2 HP, остаток её доли — основному флоту', () => {
    const result = advance(world({ main: 'ship', bait: 'decoy' }), HOUR);
    // Залп 12: по 6 в main и bait. bait держит 2 — его остаток 4 уходит в main.
    expect(result.state.fleets.bait).toBeUndefined();
    expect(result.state.fleets.main!.units[0]!.hp).toBe(1000 - 6 - 4);
    // Заслуга — ровно залп: 2 в приманку и 10 в основной флот.
    expect(result.state.fleets.a!.units[0]!.damageDealt).toBe(12);
    // Живая цель нашлась — заряда нет.
    expect(result.state.fleets.a!.overcharge).toBeUndefined();
  });

  it('все цели погибли — доля без цели остаётся зарядом на пять игровых минут', () => {
    const result = advance(world({ bait: 'decoy' }), HOUR);
    expect(result.state.battles['battle:0']).toBeUndefined();
    // Залп 12, легло 2 — заряд 10 урона.
    expect(result.state.fleets.a!.overcharge?.damage).toBeCloseTo(10, 9);
    expect(result.state.fleets.a!.overcharge?.until).toBe(HOUR + WINDOW);
  });

  it('новый враг в пределах окна — заряд разряжается в него сразу, без залпа', () => {
    const charged = advance(world({ bait: 'decoy' }), HOUR).state;
    const met = arrive(charged, HOUR + WINDOW / 2);
    expect(met.events.some((e) => e.type === 'battle.started')).toBe(true);
    // Ровно 10 — заряд, хотя флот a после боя получил выслугу и его залп стал сильнее:
    // заряд — число, а не доля будущего залпа. Залпов ещё не было.
    expect(charged.fleets.a!.units[0]!.battles).toBe(1);
    expect(met.state.fleets.d!.units[0]!.hp).toBeCloseTo(1000 - 10, 9);
    expect(met.events.some((e) => e.type === 'combat.round')).toBe(false);
    expect(met.state.fleets.a!.overcharge).toBeUndefined();
  });

  it('окно истекло — заряд пропадает, будто выстрела не было', () => {
    const charged = advance(world({ bait: 'decoy' }), HOUR).state;
    const met = arrive(charged, HOUR + WINDOW + 1);
    expect(met.events.some((e) => e.type === 'battle.started')).toBe(true);
    expect(met.state.fleets.d!.units[0]!.hp).toBeUndefined();
    expect(met.state.fleets.a!.overcharge).toBeUndefined();
  });

  it('окно — игровые минуты: на ускоренной карте оно короче в той же мере', () => {
    const scale = 60;
    const fast = (now: number) => ({ now, data, config: { timeScale: scale } });
    const state = world({ bait: 'decoy' });
    const result = kernel.advanceTo(state, fast(HOUR));
    if (!result.ok) throw Error(result.code);
    expect(result.state.fleets.a!.overcharge?.until).toBe(HOUR + WINDOW / scale);
  });

  it('прогноз считает приманку тем же правилом, что и бой', () => {
    const owners = ['a', 'main', 'bait'];
    const state = world({ main: 'ship', bait: 'decoy' });
    const forecast = previewSides(
      owners.map((id, i) => ({
        units: state.fleets[id]!.units,
        owner: state.fleets[id]!.owner,
        role: i === 0 ? 'attacker' : 'defender',
        key: id,
      })),
      data,
      (x, y) => x !== y,
    );
    const result = advance(state, 400 * HOUR);
    for (const [i, id] of owners.entries()) {
      const live = result.state.fleets[id]?.units ?? [];
      expect(
        forecast.sides[i]!.survivors.map(({ unit, count, hp }) => ({ unit, count, hp })),
      ).toEqual(live.map(({ unit, count, hp }) => ({ unit, count, hp })));
    }
  });
});

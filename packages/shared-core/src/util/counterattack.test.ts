import { describe, it, expect } from 'vitest';
import { counterattackDue, counterattackPlan } from './counterattack';
import type { Fleet, GameState, OperationState, Planet } from '../state/gameState';
import type { GameData } from '../data/schemas';

// Последний контрудар Роя (PVR-8.4, §8.7): потеряв внешние позиции, Рой ведёт к известному
// месту эвакуации то, что уцелело, — и ничего сверх этого.

const data = { units: { drone: {}, relay: { relayRange: 300 } } } as unknown as GameData;

const planet = (id: string, owner: string | null = null): Planet => ({
  id,
  owner,
  position: { x: 0, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
});
const fleet = (id: string, location: string | null, over: Partial<Fleet> = {}): Fleet => ({
  id,
  owner: 'swarm',
  location,
  movement: null,
  units: [{ unit: 'drone', count: 3 }],
  traits: [],
  ...over,
});

/** Литейные потеряны, доки известны игроку: пора. Охрана у комплекса, резерв у дозора,
 *  флот сбора в улье. */
function world(over: Partial<GameState> = {}): GameState {
  const operation: OperationState = {
    production: ['complex', 'foundry'],
    forces: {
      guard: { fleets: ['guard'], hp: 100 },
      reserve: { fleets: ['reserve'], hp: 100 },
    },
    breakAt: 0.2,
    evacuate: 3,
    counterattack: { after: ['foundry', 'outpost'], target: 'docks' },
  };
  return {
    planets: {
      complex: planet('complex', 'swarm'),
      foundry: planet('foundry', 'p1'),
      outpost: planet('outpost', 'ally'),
      watch: planet('watch', 'swarm'),
      docks: planet('docks', 'swarm'),
    },
    fleets: {
      guard: fleet('guard', 'complex'),
      reserve: fleet('reserve', 'watch'),
      wave: fleet('wave', 'complex'),
      rally: fleet('rally', 'complex', { traits: ['rally'] }),
      relay: fleet('relay', 'watch', { traits: ['rally'], units: [{ unit: 'relay', count: 1 }] }),
    },
    pve: { waveNumber: 3, totalWaves: 10, npcPlayerId: 'swarm' },
    operation,
    missionFacts: { found: { p1: ['docks'] } },
    ...over,
  } as unknown as GameState;
}

describe('последний контрудар Роя (PVR-8.4)', () => {
  it('внешние позиции потеряны, доки известны — уцелевшие соединения и построенное идут к докам', () => {
    const plan = counterattackPlan(world(), data, 'swarm');
    expect(plan.moves).toEqual([
      { fleetId: 'guard', to: 'docks' },
      { fleetId: 'rally', to: 'docks' },
      { fleetId: 'reserve', to: 'docks' },
    ]);
    // Волна — не соединение и не флот сбора; узел сети стоит на посту.
    expect([...plan.held].sort()).toEqual(['guard', 'rally', 'reserve']);
  });

  it('хоть одна внешняя позиция у Роя — контрудара нет', () => {
    const s = world();
    s.planets.outpost = { ...s.planets.outpost!, owner: 'swarm' };
    expect(counterattackDue(s, 'swarm')).toBe(false);
    expect(counterattackPlan(s, data, 'swarm')).toEqual({ held: new Set(), moves: [] });
  });

  it('место эвакуации ещё никому не известно — Рой его не выдаёт', () => {
    expect(counterattackDue(world({ missionFacts: {} }), 'swarm')).toBe(false);
    expect(
      counterattackDue(world({ missionFacts: { found: { p1: ['elsewhere'] } } }), 'swarm'),
    ).toBe(false);
  });

  it('разгромленное соединение и уничтоженный флот не воскресают — нового не появляется', () => {
    const s = world();
    s.operation!.forces.reserve!.brokenAt = 5;
    delete s.fleets.guard;
    const plan = counterattackPlan(s, data, 'swarm');
    expect(plan.moves).toEqual([{ fleetId: 'rally', to: 'docks' }]);
    expect(Object.keys(s.fleets).sort()).toEqual(['rally', 'relay', 'reserve', 'wave']);
  });

  it('влитые подкрепления идут с соединением: учёт контракта ведёт за слиянием', () => {
    const s = world();
    s.operation!.forces.guard!.fleets = ['guard', 'guard-2'];
    s.fleets['guard-2'] = fleet('guard-2', 'watch');
    expect(counterattackPlan(s, data, 'swarm').moves.map((m) => m.fleetId)).toContain('guard-2');
  });

  it('идущий, сражающийся и стоящий у цели — держатся, но новых приказов не получают', () => {
    const s = world();
    s.fleets.guard = fleet('guard', null, {
      movement: { from: 'complex', to: 'watch', departedAt: 0, arrivesAt: 9 },
    });
    s.fleets.reserve = fleet('reserve', 'watch', { battleId: 'b1' });
    s.fleets.rally = fleet('rally', 'docks', { traits: ['rally'] });
    const plan = counterattackPlan(s, data, 'swarm');
    expect(plan.moves).toEqual([]);
    expect([...plan.held].sort()).toEqual(['guard', 'rally', 'reserve']);
  });

  it('без замысла на карте, без PvE или для чужого места — ничего', () => {
    const s = world();
    const { counterattack: _ca, ...plainOp } = s.operation!;
    void _ca;
    expect(counterattackDue({ ...s, operation: plainOp }, 'swarm')).toBe(false);
    expect(counterattackDue({ ...s, pve: undefined }, 'swarm')).toBe(false);
    expect(counterattackDue(s, 'p1')).toBe(false);
  });

  it('вход не мутируется', () => {
    const s = world();
    const before = JSON.stringify(s);
    counterattackPlan(s, data, 'swarm');
    expect(JSON.stringify(s)).toBe(before);
  });
});

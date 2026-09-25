import { describe, it, expect } from 'vitest';
import { knowledgeOf, partsOf, swarmNet } from './swarmNet';
import { parseGameData, type GameData } from '../data/schemas';
import type { Fleet, GameState, Planet } from '../state/gameState';

// Сеть Роя — геометрия связи (`docs/swarm-behavior.md`): узлы, пересечение кругов,
// питание от энергии, части сети и держатели знания.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['energy'],
  units: {
    relay: {
      faction: 'swarm',
      stats: { attack: 0, defense: 1, speed: 5, hp: 10 },
      relayRange: 200,
      upkeep: { energy: 10 },
    },
    beacon: {
      faction: 'swarm',
      stats: { attack: 0, defense: 1, speed: 5, hp: 5 },
      relayRange: 80,
      upkeep: { energy: 5 },
    },
    drone: { faction: 'swarm', stats: { attack: 3, defense: 1, speed: 5, hp: 10 } },
  },
  technologies: {},
  factions: { swarm: { name: 'Swarm' } },
  buildings: {
    center: { name: 'Center', hp: 30, relayRange: 150, upkeep: { energy: 10 } },
    synapse: { name: 'Synapse', hp: 20, produces: { energy: 1 } },
  },
  events: {},
});

const planet = (id: string, x: number, owner: string | null, buildings: string[] = []): Planet => ({
  id,
  owner,
  position: { x, y: 0 },
  resources: {},
  buildings: buildings.map((type) => ({ type, level: 1, hp: 20 })),
  garrison: [],
  traits: [],
});
const fleet = (id: string, at: string, units: Array<[string, number]>, owner = 'swarm'): Fleet => ({
  id,
  owner,
  location: at,
  movement: null,
  units: units.map(([unit, count]) => ({ unit, count })),
  traits: [],
});

/** Линия миров: A(0) и C(600) с центрами, B(300) и D(1000) без. */
function world(fleets: Fleet[], over: Partial<GameState> = {}): GameState {
  return {
    time: 0,
    players: {
      swarm: { id: 'swarm', name: 'S', faction: 'swarm', status: 'active', resources: {} },
    },
    planets: {
      A: planet('A', 0, 'swarm', ['center', 'synapse']),
      B: planet('B', 300, 'swarm'),
      C: planet('C', 600, 'swarm', ['center']),
      D: planet('D', 1000, 'swarm'),
    },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
    ...over,
  } as unknown as GameState;
}

describe('связь — пересечение кругов', () => {
  it('два центра дальше суммы радиусов — две части', () => {
    const v = swarmNet(world([]), data, 'swarm', 0);
    expect(v.partOf.get('planet:A')).toBe('planet:A');
    expect(v.partOf.get('planet:C')).toBe('planet:C');
  });

  it('ретранслятор между ними связывает цепочку: круги 150+200 ≥ 300', () => {
    const v = swarmNet(world([fleet('r', 'B', [['relay', 1]])]), data, 'swarm', 0);
    expect(v.partOf.get('planet:A')).toBe('fleet:r');
    expect(v.partOf.get('planet:C')).toBe('fleet:r');
    // Ключ части — наименьший id держателя среди её узлов.
    expect([...partsOf(v).keys()]).toContain('fleet:r');
  });

  it('мир без центра под кругом живого узла — в части узла; вне кругов — отрезан', () => {
    const v = swarmNet(world([fleet('r', 'B', [['relay', 1]])]), data, 'swarm', 0);
    expect(v.partOf.get('planet:B')).toBe(v.partOf.get('planet:A'));
    expect(v.partOf.get('planet:D')).toBe('planet:D');
  });
});

describe('флот без ретранслятора связан только на своём мире с центром', () => {
  it('на мире с центром — в части центра; на мире без центра — отрезан, даже под кругом', () => {
    const v = swarmNet(
      world([
        fleet('home', 'A', [['drone', 2]]),
        fleet('field', 'B', [['drone', 2]]),
        fleet('r', 'B', [['relay', 1]]),
      ]),
      data,
      'swarm',
      0,
    );
    expect(v.partOf.get('fleet:home')).toBe(v.partOf.get('planet:A'));
    expect(v.partOf.get('fleet:field')).toBe('fleet:field');
  });

  it('с малым ретранслятором флот — сам узел и связан, если круги сходятся', () => {
    const v = swarmNet(
      world([
        fleet('scout', 'B', [
          ['drone', 1],
          ['beacon', 1],
        ]),
      ]),
      data,
      'swarm',
      0,
    );
    // 80 + 150 = 230 < 300: до A не дотягивается — каждый сам по себе.
    expect(v.partOf.get('planet:A')).toBe('planet:A');
    const near = world([
      fleet('scout', 'B', [
        ['drone', 1],
        ['beacon', 1],
      ]),
    ]);
    near.planets.B!.position.x = 200; // 80 + 150 = 230 ≥ 200
    const joined = swarmNet(near, data, 'swarm', 0);
    expect(joined.partOf.get('planet:A')).toBe(joined.partOf.get('fleet:scout'));
  });
});

describe('сеть ест энергию', () => {
  it('без долга по энергии питаются все узлы', () => {
    const v = swarmNet(world([fleet('r', 'B', [['relay', 1]])]), data, 'swarm', 0);
    expect(v.powered.size).toBe(3);
  });

  it('долг: работают узлы по выработке, ближние к центрам первыми — дальний гаснет и рвёт связь', () => {
    // Выработка 1/ч = 24/сут: хватает на центр A (10) и центр C (10), ретранслятор (10) — нет.
    const s = world([fleet('r', 'B', [['relay', 1]])]);
    s.players.swarm!.arrears = ['energy'];
    const v = swarmNet(s, data, 'swarm', 0);
    expect([...v.powered].sort()).toEqual(['planet:A', 'planet:C']);
    expect(v.partOf.get('planet:A')).not.toBe(v.partOf.get('planet:C'));
  });
});

describe('знание части — объединение знания её держателей', () => {
  it('без сети знание общее: весь журнал и общий рецепт', () => {
    const s = world([], { swarmRecipes: { veil: 1 } });
    expect(knowledgeOf(s, data, 'swarm', 'fleet:x', 0)).toEqual({
      known: null,
      recipes: { veil: 1 },
    });
  });

  it('с сетью — только то, что лежит у держателей своей части', () => {
    const s = world([fleet('r', 'B', [['relay', 1]]), fleet('far', 'D', [['drone', 1]])], {
      swarmNet: {
        holders: {
          'planet:A': { known: [1, 2] },
          'planet:C': { known: [3], recipes: { veil: 1 } },
          'fleet:far': { known: [4] },
        },
      },
    });
    const a = knowledgeOf(s, data, 'swarm', 'planet:A', 0);
    expect([...a.known!].sort()).toEqual([1, 2, 3]);
    expect(a.recipes).toEqual({ veil: 1 });
    expect([...knowledgeOf(s, data, 'swarm', 'fleet:far', 0).known!]).toEqual([4]);
  });
});

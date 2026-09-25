import { describe, it, expect } from 'vitest';
import { swarmNetPlan } from './swarmNetTactics';
import { parseGameData, type GameData } from '../data/schemas';
import type { Fleet, GameState, Planet } from '../state/gameState';

// Тактика сети Роя: цепочка постов от центра данных к фронту, постройка недостающего,
// отделение ретранслятора со стапеля. Линия миров: H(0) — улей с центром и верфью,
// M1(300), M2(600), F(900) — мир игрока.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    post: {
      faction: 'swarm',
      traits: ['relay', 'relay_post'],
      stats: { attack: 0, defense: 1, speed: 5, hp: 10 },
      relayRange: 200,
      cost: { metal: 10 },
    },
    spark: {
      faction: 'swarm',
      traits: ['relay'],
      stats: { attack: 0, defense: 1, speed: 5, hp: 5 },
      relayRange: 80,
    },
    frigate: { faction: 'swarm', stats: { attack: 3, defense: 1, speed: 5, hp: 10 } },
  },
  technologies: {},
  factions: { swarm: { name: 'Swarm' } },
  buildings: {
    center: { name: 'Center', hp: 30, relayRange: 150, cost: { metal: 10 } },
    yard: { name: 'Yard', hp: 30, enablesShipConstruction: true },
  },
  events: {},
});

const planet = (
  id: string,
  x: number,
  owner: string | null,
  buildings: string[],
  links: string[],
): Planet => ({
  id,
  owner,
  position: { x, y: 0 },
  resources: {},
  buildings: buildings.map((type) => ({ type, level: 1, hp: 30 })),
  garrison: [],
  traits: [],
  links,
});
const fleet = (
  id: string,
  at: string,
  units: Array<[string, number]>,
  traits: string[] = [],
): Fleet => ({
  id,
  owner: 'swarm',
  location: at,
  movement: null,
  units: units.map(([unit, count]) => ({ unit, count })),
  traits,
});

function world(fleets: Fleet[], metal = 100, center = true): GameState {
  return {
    time: 0,
    scheduled: [],
    players: {
      swarm: { id: 'swarm', name: 'S', faction: 'swarm', status: 'active', resources: { metal } },
      p1: { id: 'p1', name: 'P', faction: 'x', status: 'active', resources: {} },
    },
    planets: {
      H: planet('H', 0, 'swarm', center ? ['center', 'yard'] : ['yard'], ['M1']),
      M1: planet('M1', 300, null, [], ['H', 'M2']),
      M2: planet('M2', 600, null, [], ['M1', 'F']),
      F: planet('F', 900, 'p1', [], ['M2']),
    },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
  } as unknown as GameState;
}

describe('цепочка от центра к фронту', () => {
  it('пост встаёт на самое дальнее место пути, до которого сходятся круги', () => {
    // От центра (150) пост (200) дотягивается на 350: M1 (300) — да, M2 (600) — нет.
    const plan = swarmNetPlan(world([fleet('a', 'H', [['post', 1]])]), data, 'swarm');
    expect(plan.moves).toEqual([{ fleetId: 'a', to: 'M1' }]);
    expect([...plan.held]).toEqual(['a']);
  });

  it('постов не хватает до фронта — Рой строит ещё один на верфи', () => {
    const plan = swarmNetPlan(world([fleet('a', 'M1', [['post', 1]])]), data, 'swarm');
    // От поста на M1 до фронта 600 — больше 200 + 80 (малый ретранслятор волны): нужен
    // пост на M2 (300 ≤ 200 + 200), а свободного поста для него нет.
    expect(plan.moves).toEqual([]);
    expect(plan.builds).toEqual([{ planetId: 'H', unit: 'post' }]);
  });

  it('уже заказанный ретранслятор второй раз не заказывается, неоплатный — тоже', () => {
    const queued = world([fleet('a', 'M1', [['post', 1]])]);
    queued.planets.H!.buildQueue = [
      { id: 1, kind: 'unit', playerId: 'swarm', unit: 'post', count: 1 },
    ];
    expect(swarmNetPlan(queued, data, 'swarm').builds).toEqual([]);
    expect(swarmNetPlan(world([fleet('a', 'M1', [['post', 1]])], 0), data, 'swarm').builds).toEqual(
      [],
    );
  });

  it('ретранслятор во флоте сбора с боевыми кораблями отделяется, а не воюет', () => {
    const plan = swarmNetPlan(
      world([
        fleet(
          'rally',
          'H',
          [
            ['post', 1],
            ['frigate', 5],
          ],
          ['rally'],
        ),
      ]),
      data,
      'swarm',
    );
    expect(plan.splits).toEqual([{ fleetId: 'rally', take: [{ unit: 'post', count: 1 }] }]);
    expect(plan.held.has('rally')).toBe(true);
  });

  it('центров не осталось — Рой ставит новый на верфи', () => {
    const plan = swarmNetPlan(world([], 100, false), data, 'swarm');
    expect(plan.builds).toContainEqual({ planetId: 'H', building: 'center' });
  });
});

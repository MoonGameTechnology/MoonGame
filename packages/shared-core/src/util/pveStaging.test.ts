import { describe, it, expect } from 'vitest';
import { musterPlan, producedForcesAt, waveStagingWorld } from './pveStaging';
import { parseGameData, type GameData } from '../data/schemas';
import type { Fleet, GameState, Planet } from '../state/gameState';

// Откуда идут волны и что уходит с ними (решения владельца 2026-09-24).

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    frigate: { faction: 'swarm', stats: { attack: 3, defense: 1, speed: 5, hp: 10 } },
    post: { faction: 'swarm', stats: { attack: 0, defense: 1, speed: 5, hp: 10 }, relayRange: 200 },
  },
  technologies: {},
  factions: { swarm: { name: 'Swarm' } },
  buildings: {},
  events: {},
});

const planet = (id: string, x: number, owner: string | null): Planet => ({
  id,
  owner,
  position: { x, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
});
const fleet = (id: string, at: string, units: string[], traits: string[] = []): Fleet => ({
  id,
  owner: 'swarm',
  location: at,
  movement: null,
  units: units.map((unit) => ({ unit, count: 1 })),
  traits,
});

/** Игрок в X=0, миры Роя: near(100), mid(500), hive(900). */
function world(fleets: Fleet[] = [], home = 'hive'): GameState {
  return {
    players: {
      swarm: { id: 'swarm', faction: 'swarm', resources: {} },
      p1: { id: 'p1', resources: {} },
    },
    planets: {
      you: planet('you', 0, 'p1'),
      near: planet('near', 100, 'swarm'),
      mid: planet('mid', 500, 'swarm'),
      hive: planet('hive', 900, 'swarm'),
    },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
    pve: { waveNumber: 1, totalWaves: 3, npcPlayerId: 'swarm', home },
  } as unknown as GameState;
}

describe('волны идут только из дальнего мира', () => {
  it('улей в руках Роя — волна там, даже если у Роя есть мир с меньшим id', () => {
    expect(waveStagingWorld(world())).toBe('hive');
  });

  it('улей пал — следующий дальний от игрока мир, а не мир у его порога', () => {
    const s = world();
    s.planets.hive!.owner = 'p1';
    // Теперь игрок в 0 и в 900: дальше всех от обоих — mid (500 → 400 до улья).
    expect(waveStagingWorld(s)).toBe('mid');
  });
});

describe('построенное Роем уходит с волной', () => {
  it('флоты сбора в улье — да; стартовые флоты и узлы сети — нет', () => {
    const s = world([
      fleet('built', 'hive', ['frigate'], ['rally']),
      fleet('start', 'hive', ['frigate']),
      fleet('relay', 'hive', ['post'], ['rally']),
    ]);
    expect(producedForcesAt(s, data, 'swarm', 'hive')).toEqual(['built']);
  });

  it('драйвер держит построенное в улье и ведёт туда построенное на другой верфи', () => {
    const plan = musterPlan(
      world([
        fleet('home', 'hive', ['frigate'], ['rally']),
        fleet('away', 'mid', ['frigate'], ['rally']),
      ]),
      data,
      'swarm',
    );
    expect([...plan.held].sort()).toEqual(['away', 'home']);
    expect(plan.moves).toEqual([{ fleetId: 'away', to: 'hive' }]);
  });
});

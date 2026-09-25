import { describe, expect, it } from 'vitest';
import { parseGameData, type GameState } from '../packages/shared-core/src/index';
import { swarmNetMarks } from './swarmNetMarks';

const data = parseGameData({
  version: '0.1.0',
  resources: ['energy'],
  units: {
    relay: {
      faction: 'swarm',
      stats: { attack: 0, defense: 1, speed: 5, hp: 10 },
      relayRange: 200,
    },
  },
  technologies: {},
  factions: { swarm: { name: 'Swarm' } },
  buildings: { center: { name: 'Center', hp: 30, relayRange: 150 } },
  events: {},
});

const planet = (id: string, x: number, owner: string, buildings: string[] = []) => ({
  id,
  owner,
  position: { x, y: 0 },
  resources: {},
  buildings: buildings.map((type) => ({ type, level: 1, hp: 30 })),
  garrison: [],
  traits: [],
});

const world = (): GameState =>
  ({
    time: 0,
    pve: { waveNumber: 1, totalWaves: 3, npcPlayerId: 'swarm' },
    players: {},
    planets: {
      hive: planet('hive', 0, 'swarm', ['center']),
      post: planet('post', 300, 'swarm'),
      far: planet('far', 1000, 'swarm', ['center']),
    },
    fleets: {
      r: {
        id: 'r',
        owner: 'swarm',
        location: 'post',
        movement: null,
        units: [{ unit: 'relay', count: 1 }],
        traits: [],
      },
    },
  }) as unknown as GameState;

describe('сеть Роя на карте — только разведанное', () => {
  it('видимые узлы и связь между сошедшимися кругами', () => {
    const marks = swarmNetMarks(world(), data, (id) => id === 'hive' || id === 'post');
    expect(marks.nodes.map((n) => n.kind)).toEqual(['center', 'relay']);
    expect(marks.links).toEqual([[0, 1]]);
  });

  it('неразведанный узел не рисуется — и связь к нему тоже', () => {
    const marks = swarmNetMarks(world(), data, (id) => id === 'hive');
    expect(marks.nodes).toHaveLength(1);
    expect(marks.links).toEqual([]);
  });

  it('не PvE — сети нет', () => {
    expect(swarmNetMarks({ ...world(), pve: undefined }, data, () => true)).toEqual({
      nodes: [],
      links: [],
    });
  });
});

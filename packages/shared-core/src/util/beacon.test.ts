import { describe, it, expect } from 'vitest';
import { beaconCallouts, beaconSentinels } from './beacon';
import type { Fleet, GameState, Planet } from '../state/gameState';

const planet = (id: string, x: number, owner: string | null = null, traits: string[] = []): Planet => ({
  id,
  owner,
  position: { x, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits,
});
const fleet = (id: string, owner: string, location: string | null, over: Partial<Fleet> = {}): Fleet => ({
  id,
  owner,
  location,
  movement: null,
  units: [{ unit: 'u', count: 1 }],
  traits: [],
  ...over,
});
const world = (fleets: Fleet[], beaconOwner: string | null = null): GameState =>
  ({
    planets: {
      beacon: planet('beacon', 0, beaconOwner, ['beacon']),
      near: planet('near', 10),
      far: planet('far', 100),
    },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
  }) as unknown as GameState;

describe('ответ Роя на маяк', () => {
  it('тихий маяк — никого не шлёт', () => {
    expect(beaconCallouts(world([fleet('scout', 'swarm', 'beacon'), fleet('a', 'swarm', 'near')]), 'swarm')).toEqual([]);
  });

  it('флот игрока прибыл — ближайший свободный флот Роя идёт к маяку', () => {
    const s = world([
      fleet('scout', 'swarm', 'beacon'),
      fleet('you', 'p1', 'beacon'),
      fleet('a', 'swarm', 'far'),
      fleet('b', 'swarm', 'near'),
    ]);
    expect(beaconCallouts(s, 'swarm')).toEqual([{ fleetId: 'b', to: 'beacon' }]);
  });

  it('маяк в чужих руках — тоже тревога', () => {
    expect(beaconCallouts(world([fleet('a', 'swarm', 'near')], 'p1'), 'swarm')).toEqual([{ fleetId: 'a', to: 'beacon' }]);
  });

  it('один отряд за раз: пока ответ в пути, второй не шлётся', () => {
    const s = world([
      fleet('you', 'p1', 'beacon'),
      fleet('b', 'swarm', null, { movement: { from: 'near', to: 'beacon', departedAt: 0, arrivesAt: 1 } }),
      fleet('a', 'swarm', 'far'),
    ]);
    expect(beaconCallouts(s, 'swarm')).toEqual([]);
  });

  it('занятые (в бою, в пути) и пустые флоты не отвечают', () => {
    const s = world([
      fleet('you', 'p1', 'beacon'),
      fleet('fight', 'swarm', 'near', { battleId: 'x' }),
      fleet('empty', 'swarm', 'near', { units: [] }),
    ]);
    expect(beaconCallouts(s, 'swarm')).toEqual([]);
  });
});

describe('дозорный на маяке', () => {
  const sentinel = { traits: ['sentinel'] };

  it('дозорный — помеченный флот Роя, стоящий на маяке; в пути и в чужих руках — нет', () => {
    const s = world([
      fleet('scout', 'swarm', 'beacon', sentinel),
      fleet('passing', 'swarm', null, {
        ...sentinel,
        movement: { from: 'near', to: 'beacon', departedAt: 0, arrivesAt: 1 },
      }),
      fleet('elsewhere', 'swarm', 'near', sentinel),
      fleet('you', 'p1', 'beacon', sentinel),
    ]);
    expect([...beaconSentinels(s, 'swarm')]).toEqual(['scout']);
  });

  it('флот Роя без признака, зашедший на маяк, дозорным не становится', () => {
    // Прогон MC-01: главный флот Роя заходил на маяк, сливался с дозорным и замирал там
    // навсегда — правило «любой флот на маяке» выключало из войны половину Роя.
    const s = world([fleet('scout', 'swarm', 'beacon', sentinel), fleet('main', 'swarm', 'beacon')]);
    expect([...beaconSentinels(s, 'swarm')]).toEqual(['scout']);
  });
});

describe('тревогу поднимает только игрок', () => {
  it('пират на маяке — Рой не отвечает', () => {
    const s = { ...world([fleet('pirate', 'pirates', 'beacon'), fleet('a', 'swarm', 'near')]), players: { pirates: { npc: 'pirate' } } } as unknown as GameState;
    expect(beaconCallouts(s, 'swarm')).toEqual([]);
  });
});

describe('дозорный — только на маяке, которого игрок не взял', () => {
  it('маяк в руках игрока: пришедший отряд Роя штурмует, а не дежурит', () => {
    const s = world([fleet('answer', 'swarm', 'beacon', { traits: ['sentinel'] })], 'p1');
    expect([...beaconSentinels(s, 'swarm')]).toEqual([]);
  });
});

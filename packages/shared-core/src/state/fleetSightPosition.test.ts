import { describe, expect, it } from 'vitest';
import { parseGameData } from '../data/schemas';
import { createInitialState, type Fleet, type Planet } from './gameState';
import { fleetsSeenByPosition, isVisibleTo, radarSignatures, visibleState } from './visibility';
import { pairKey } from './diplomacy';

const data = parseGameData({
  version: '1',
  resources: ['metal'],
  buildings: {},
  technologies: {},
  factions: {},
  events: {},
  units: {
    scout: {
      faction: 'x',
      stats: { attack: 1, defense: 1, speed: 1, hp: 1 },
      radarRange: 200,
      signature: 20,
    },
  },
});
const world = (id: string, x: number): Planet => ({
  id,
  owner: null,
  position: { x, y: 0 },
  links: [id === 'A' ? 'B' : 'A'],
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
});
const ship = (id: string, owner: string, t: number): Fleet => ({
  id,
  owner,
  location: null,
  edge: { from: 'A', to: 'B', t },
  movement: null,
  units: [{ unit: 'scout', count: 1 }],
  traits: [],
});
function makeScene(observer: number, enemy: number, moving: boolean) {
  const s = createInitialState({ seed: 'scout-sight', version: { data: '1', manifest: '1' } });
  s.planets = { A: world('A', 0), B: world('B', 1000) };
  s.players = Object.fromEntries(
    ['p1', 'p2'].map((id) => [
      id,
      { id, name: id, faction: 'x', status: 'active' as const, resources: {} },
    ]),
  );
  s.fleets = { observer: ship('observer', 'p1', observer), enemy: ship('enemy', 'p2', enemy) };
  if (moving)
    for (const f of Object.values(s.fleets)) {
      f.movement = { from: 'A', to: 'B', departedAt: 0, arrivesAt: 1000, startT: f.edge!.t };
      delete f.edge;
    }
  return s;
}
describe.each([false, true])('fleet detection follows the ship (moving=%s)', (moving) => {
  const scene = (observer: number, enemy: number) => makeScene(observer, enemy, moving);
  it('hides a distant scout even when its nearest world is identified', () => {
    const s = scene(0, 0.4);
    expect(isVisibleTo(s, 'p1', { fleetId: 'enemy' }, data)).toBe(false);
    expect(visibleState(s, 'p1', data).fleets.enemy).toBeUndefined();
    expect(radarSignatures(s, 'p1', data)).toEqual([]);
  });
  it('identifies close scouts on opposite sides of a province boundary', () => {
    const s = scene(0.49, 0.51);
    expect(fleetsSeenByPosition(s, 'p1', data).has('enemy')).toBe(true);
    expect(isVisibleTo(s, 'p1', { fleetId: 'enemy' }, data)).toBe(true);
    expect(visibleState(s, 'p1', data).fleets.enemy).toBeDefined();
    expect(radarSignatures(s, 'p1', data)).toEqual([]);
  });
  it('shows only a signature in the outer radar ring even near an identified world', () => {
    const s = scene(0, 0.15);
    expect(visibleState(s, 'p1', data).fleets.enemy).toBeUndefined();
    expect(radarSignatures(s, 'p1', data)).toHaveLength(1);
  });
  it('keeps an allied scout visible through its own shared sight mid-lane', () => {
    const s = scene(0, 0.7);
    s.diplomacy = { [pairKey('p1', 'p2')]: 'alliance' };
    expect(isVisibleTo(s, 'p1', { fleetId: 'enemy' }, data)).toBe(true);
    expect(visibleState(s, 'p1', data).fleets.enemy).toBeDefined();
  });
});

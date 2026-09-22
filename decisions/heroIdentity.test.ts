import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState } from '../packages/shared-core/src/index';

function newGame(): GameState {
  const s = createInitialState({ seed: 1, version: { data: '0.1.0', manifest: 'test' } });
  s.heroes = {};
  for (const owner of ['p1', 'p2']) {
    const fleetId = `${owner}-fleet`;
    s.fleets[fleetId] = {
      id: fleetId,
      owner,
      location: 'home',
      movement: null,
      traits: [],
      units: [{ unit: 'hero', count: 1 }],
    };
    s.heroes[owner] = {
      id: owner,
      owner,
      fleetId,
      location: 'home',
      cooldowns: {},
      archetype: 'commander',
    };
  }
  return s;
}
import { heroAtPoint, heroIdentity, mapHeroes } from './heroIdentity';

describe('hero map privacy and targeting', () => {
  it('never exposes an enemy identity from full solo state, even on an identified fleet', () => {
    const s = newGame();
    const visible = mapHeroes(s, 'p1');
    expect(visible.size).toBe(1);
    expect([...visible.values()].every((h) => h.owner === 'p1')).toBe(true);
    const own = [...visible.values()][0]!;
    own.alive = false;
    expect(mapHeroes(s, 'p1').size).toBe(0);
  });

  it('cannot keep a portrait after the ship is lost or ownership changes', () => {
    const s = newGame();
    const [id] = [...mapHeroes(s, 'p1').keys()];
    s.fleets[id!]!.owner = 'p2';
    expect(mapHeroes(s, 'p1').size).toBe(0);
    delete s.fleets[id!];
    expect(mapHeroes(s, 'p1').size).toBe(0);
  });

  it('uses the displayed portrait bounds rather than the hull position', () => {
    const hits = [{ heroId: 'h1', x: 20, y: 30, width: 58, height: 68 }];
    expect(heroAtPoint(hits, 49, 60)).toBe('h1');
    expect(heroAtPoint(hits, 49, 128)).toBeNull();
    expect(heroAtPoint([], 49, 60)).toBeNull();
    expect(heroIdentity('unknown')).toBeUndefined();
  });
});

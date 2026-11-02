import { describe, expect, it } from 'vitest';
import { parseGameData } from '../data/schemas';
import { createInitialState, type GameState } from './gameState';
import { diffState, applyDelta } from './delta';
import { sensorCoverage, sightCircles, viewCoverage, visibleState } from './visibility';
import { sharedRadarSources, viewSightCircles } from './sensorView';
import { deepClone, deepFreeze } from '../util/clone';

const data = parseGameData({
  version: 'sensors',
  resources: ['metal'],
  factions: {},
  events: {},
  technologies: { survey: { name: 'Survey', effects: { radarRangeBonus: 0.5 } } },
  buildings: { radar: { name: 'Radar', radarRange: 300, radarLevel: 3 } },
  units: {
    scout: {
      faction: 'x',
      radarRange: 100,
      radarLevel: 3,
      stats: { attack: 1, defense: 1, speed: 1, hp: 1 },
    },
  },
});

function scene(): GameState {
  const state = createInitialState({
    seed: 'sensors',
    version: { data: 'sensors', manifest: '1' },
  });
  for (const id of ['me', 'ally', 'other'])
    state.players[id] = { id, name: id, faction: 'x', status: 'active', resources: {} };
  for (const [id, owner, x] of [
    ['home', 'me', 0],
    ['station', 'ally', 1000],
    ['edge', null, 1200],
    ['distant', 'other', 2000],
  ] as const)
    state.planets[id] = {
      id,
      owner,
      position: { x, y: 0 },
      links: [],
      resources: {},
      buildings: [],
      garrison: [],
      traits: [],
    };
  state.planets.station!.buildings = [{ type: 'radar', level: 1, hp: 1 }];
  state.players.ally!.technologies = { completed: ['survey'] };
  state.diplomacy = { 'ally|me': 'alliance' };
  return state;
}

describe('resolved sensors in the network projection', () => {
  it.each([false, true])(
    'keeps allied technology and blackout geometry (blackout=%s)',
    (blackout) => {
      const state = scene();
      if (blackout) state.players.ally!.arrears = ['energy'];
      const before = JSON.stringify(state);
      const coverage = sensorCoverage(state, 'me', data);
      expect(coverage.identify.has('edge')).toBe(!blackout);
      const view = visibleState(deepFreeze(state), 'me', data);
      expect(view.players.ally!.technologies).toBeUndefined();
      expect(view.players.ally!.arrears).toBeUndefined();
      expect(viewCoverage(view, 'me', data)).toEqual(coverage);
      const actual = viewSightCircles(view, 'me', data).map(({ x, y, identify, signature }) => ({
        x,
        y,
        identify,
        signature,
      }));
      const expected = sightCircles(state, 'me', data).map(({ x, y, identify, signature }) => ({
        x,
        y,
        identify,
        signature,
      }));
      expect(actual).toEqual(expected);
      expect(sharedRadarSources(view, 'me', data)).toEqual([
        { x: 1000, y: 0, range: blackout ? 225 : 450 },
      ]);
      expect(JSON.stringify(state)).toBe(before);
      expect(state.sensorView).toBeUndefined();
    },
  );

  it("carries only shared geometry, without private source ids or another ally's sensors", () => {
    const state = scene();
    state.fleets.secret_sensor = {
      id: 'secret_sensor',
      owner: 'ally',
      location: 'station',
      movement: null,
      units: [{ unit: 'scout', count: 1 }],
      traits: [],
    };
    state.diplomacy!['ally|other'] = 'alliance';
    state.planets.distant!.buildings = [{ type: 'radar', level: 1, hp: 1 }];
    const view = visibleState(state, 'me', data);
    const payload = JSON.stringify(view.sensorView);
    expect(payload).not.toContain('secret_sensor');
    expect(payload).not.toContain('survey');
    expect(
      view
        .sensorView!.circles.filter((c) => c.owner === 'ally')
        .every((c) => c.source.kind === 'shared'),
    ).toBe(true);
    expect(view.sensorView!.circles.some((c) => c.owner === 'other')).toBe(false);
    expect(sharedRadarSources(view, 'me', data).every((c) => c.x === 1000)).toBe(true);
    expect(sharedRadarSources(view, 'other', data)).not.toEqual(view.sensorView!.sharedRadars);
  });

  it('updates coverage and sweep sources through JSON deltas when the alliance ends', () => {
    const state = scene();
    const before = visibleState(state, 'me', data);
    const afterState = deepClone(state);
    afterState.diplomacy = {};
    const after = visibleState(afterState, 'me', data);
    const wire = JSON.parse(JSON.stringify(diffState(before, after)));
    const restored = applyDelta(before, wire);
    expect(restored).toEqual(after);
    expect(viewCoverage(restored, 'me', data).identify.has('edge')).toBe(false);
    expect(sharedRadarSources(restored, 'me', data)).toEqual([]);
    expect(viewSightCircles(restored, 'me', data).every((c) => c.owner === 'me')).toBe(true);
  });

  it('keeps live sensor rules independent from projection metadata', () => {
    const state = scene();
    state.sensorView = { viewerId: 'me', circles: [], sharedRadars: [] };
    expect(sensorCoverage(state, 'me', data).identify.has('distant')).toBe(false);
    const view = visibleState(state, 'other', data);
    expect(view.sensorView!.viewerId).toBe('other');
    expect(viewCoverage(view, 'me', data)).toEqual(sensorCoverage(view, 'me', data));
  });
});

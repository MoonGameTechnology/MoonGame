import { describe, expect, it } from 'vitest';
import { parseGameData } from '../data/schemas';
import { createKernel } from '../kernel/kernel';
import { createInitialState, type GameState } from '../state/gameState';
import { capitalVictoryStatus } from '../state/capitalVictory';
import { capitalModule } from './capital';
import { victoryModule } from './victory';
import type { MatchConfig } from '../action/types';
import type { GameModule } from '../kernel/module';

const data = parseGameData({
  version: 'capital-test',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
  sectorKinds: { planet: { scoreValue: 50 } },
});
const kernel = createKernel([victoryModule, capitalModule]);
const config: MatchConfig = {
  timeScale: 1,
  victory: {
    capitalCapture: true,
    scoreLimit: 1,
    dominationPercent: 0.01,
    endsAt: 1,
  },
};
function world(team = false): GameState {
  const s = createInitialState({
    seed: 'capital-victory',
    version: { data: data.version, manifest: 'test' },
  });
  s.capital = {};
  for (let i = 1; i <= (team ? 4 : 2); i++) {
    const id = `p${i}`,
      home = `home${i}`;
    s.players[id] = {
      id,
      name: id,
      faction: '',
      status: 'active',
      resources: {},
      ...(team ? { team: i <= 2 ? 'A' : 'B' } : {}),
    };
    s.capital[id] = home;
    s.planets[home] = {
      id: home,
      owner: id,
      kind: 'planet',
      position: { x: i, y: 0 },
      buildings: [],
      garrison: [],
      resources: {},
      traits: [],
    };
  }
  if (team) s.modeId = 'team_2v2';
  return s;
}
function tick(s: GameState): GameState {
  const r = kernel.advanceTo(s, {
    now: 2,
    data,
    config: { ...config, ...(s.modeId ? { modeId: s.modeId } : {}) },
  });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

describe('capital-only victory', () => {
  it('judges the capture event on the same action, without waiting for a later heartbeat', () => {
    const capture: GameModule = {
      id: 'capture-fixture',
      version: '1',
      setup(api) {
        api.onAction('test.capture', (action, h) => {
          h.state.planets.home2!.owner = action.playerId;
          h.emit('planet.captured', { planetId: 'home2', owner: action.playerId });
        });
      },
    };
    const k = createKernel([victoryModule, capture]);
    const r = k.applyAction(
      world(),
      { id: 'capture', type: 'test.capture', playerId: 'p1', payload: {}, issuedAt: 0 },
      { now: 0, data, config },
    );
    expect(r).toMatchObject({
      ok: true,
      state: {
        match: {
          status: 'ended',
          reason: 'capital-capture',
          winner: 'p1',
          endedAt: 0,
        },
      },
    });
  });
  it('ignores score, domination and timeout while the rival capital stands', () => {
    const s = world();
    s.match.battlePoints = { p1: 100000 };
    expect(tick(s).match.status).toBe('ongoing');
  });
  it('ends a duel at capture, with a public objective and the capital reason', () => {
    const s = world();
    s.planets.home2!.owner = 'p1';
    const result = tick(s);
    expect(result.match).toMatchObject({
      status: 'ended',
      winner: 'p1',
      reason: 'capital-capture',
      capitalObjectives: { p2: { planetId: 'home2', owner: 'p1' } },
    });
    expect(s.match.status).toBe('ongoing');
  });
  it('one captured capital does not end 2v2', () => {
    const s = world(true);
    s.planets.home3!.owner = 'p1';
    expect(tick(s).match.status).toBe('ongoing');
  });
  it('both teammates share the win when each captures one enemy capital', () => {
    const s = world(true);
    s.planets.home3!.owner = 'p1';
    s.planets.home4!.owner = 'p2';
    expect(tick(s).match).toMatchObject({
      status: 'ended',
      reason: 'capital-capture',
      winners: ['p1', 'p2'],
    });
  });
  it('recapturing the first capital leaves an incomplete objective', () => {
    const s = world(true);
    s.planets.home3!.owner = 'p1';
    const first = tick(s);
    first.planets.home3!.owner = 'p4';
    first.planets.home4!.owner = 'p2';
    expect(capitalVictoryStatus(first, first.modeId).winner).toBeNull();
  });
  it.each(['missing', 'duplicate', 'neutral', 'npc', 'mutual', 'incomplete-team'])(
    '%s cannot invent a winner',
    (kind) => {
      const s = world(kind === 'incomplete-team');
      if (kind === 'missing') delete s.capital!.p2;
      if (kind === 'duplicate') s.capital!.p2 = s.capital!.p1!;
      if (kind === 'neutral') s.planets.home2!.owner = null;
      if (kind === 'npc') {
        s.players.pirate = {
          id: 'pirate',
          name: 'Pirate',
          npc: 'pirate',
          faction: '',
          status: 'active',
          resources: {},
        };
        s.planets.home2!.owner = 'pirate';
      }
      if (kind === 'mutual') {
        s.planets.home1!.owner = 'p2';
        s.planets.home2!.owner = 'p1';
      }
      if (kind === 'incomplete-team') {
        delete s.players.p4!.team;
        s.planets.home3!.owner = 'p1';
      }
      expect(capitalVictoryStatus(s, s.modeId).winner).toBeNull();
    },
  );
  it('rejects capital relocation at the authoritative action boundary', () => {
    const s = world();
    const r = kernel.applyAction(
      s,
      {
        id: 'move-capital',
        playerId: 'p1',
        type: 'capital.designate',
        payload: { planetId: 'home1' },
        issuedAt: 0,
      },
      { now: 0, data, config },
    );
    expect(r).toMatchObject({ ok: false, code: 'E_CAPITAL_LOCKED' });
    expect(s.capital!.p1).toBe('home1');
  });
});

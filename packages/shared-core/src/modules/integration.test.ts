import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { economyModule } from './economy';
import { constructionModule } from './construction';
import { controlModule, UNCONTROLLED_OUTPUT } from './control';
import {
  integrationModule,
  integrationShare,
  INTEGRATION_HOURS,
  INTEGRATION_START_OUTPUT,
} from './integration';
import { createInitialState, type GameState, type Planet } from '../state/gameState';
import { visibleState } from '../state/visibility';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: {
      faction: 'x',
      stats: { attack: 5, defense: 5, speed: 5, hp: 40 },
      cost: { metal: 1 },
      buildTimeHours: 1,
    },
  },
  factions: {},
  buildings: {
    mine: { name: 'Mine', produces: { metal: 10 }, cost: { metal: 1 }, buildTimeHours: 1 },
    shipyard: { name: 'Shipyard', hp: 20, enablesShipConstruction: true },
  },
  sectorKinds: {
    planet: { orbit: true },
    asteroid: { orbit: false, allowedBuildings: ['mine'] },
  },
  modes: {
    waves: { name: 'Waves', pve: { waves: 1, npcFaction: 'x', waveIntervalHours: 1 } },
  },
  events: {},
});
const HOUR = 3_600_000;
const DONE = INTEGRATION_HOURS * HOUR;
const ctx = (now: number, modeId?: string): Context => ({
  now,
  data,
  ...(modeId ? { config: { timeScale: 1, modeId } } : {}),
});

function okAdvance(r: AdvanceResult): AdvanceResult & { ok: true } {
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r;
}
function okApply(r: ApplyResult): ApplyResult & { ok: true } {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}

/** Takes a world the way combat does: the owner changes, `from` names the previous one. */
const capture: GameModule = {
  id: 'test-capture',
  version: '1.0.0',
  setup(api) {
    api.onAction('test.capture', (action, h) => {
      const { planetId } = action.payload as { planetId: string };
      const planet = h.state.planets[planetId]!;
      const from = planet.owner;
      planet.owner = action.playerId;
      h.emit('planet.captured', { planetId, owner: action.playerId, from, via: 'assault' });
    });
    // Annihilates a world the way the hero does: it turns neutral and dead.
    api.onAction('test.destroy', (action, h) => {
      const { planetId } = action.payload as { planetId: string };
      const planet = h.state.planets[planetId]!;
      const from = planet.owner;
      planet.owner = null;
      h.emit('planet.destroyed', { planetId, by: action.playerId, from });
    });
  },
};
const take = (playerId: string, planetId: string): Action => ({
  id: `s:${playerId}:take:${planetId}`,
  type: 'test.capture',
  playerId,
  payload: { planetId },
  issuedAt: 0,
});
const unitOrder = (playerId: string, planetId: string): Action => ({
  id: `s:${playerId}:unit`,
  type: 'unit.build',
  playerId,
  payload: { planetId, unit: 'cruiser' },
  issuedAt: 0,
});

/** Each player's home planet plus the prize `n` (p2's), all with a mine and a shipyard. */
function world(prize: Partial<Planet> = {}): GameState {
  const s = createInitialState({ seed: 'int', version: { data: '0.1.0', manifest: '1' } });
  const planet = (id: string, owner: string | null, x: number): Planet => ({
    id,
    owner,
    position: { x, y: 0 },
    links: [],
    resources: {},
    buildings: [
      { type: 'mine', level: 1, hp: 0 },
      { type: 'shipyard', level: 1, hp: 20 },
    ],
    garrison: [],
    traits: [],
  });
  const player = (id: string) => ({
    id,
    name: id,
    faction: 'x',
    status: 'active' as const,
    resources: { metal: 100 },
  });
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2'), p3: player('p3') },
    planets: {
      h1: planet('h1', 'p1', 0),
      h2: planet('h2', 'p2', 100),
      h3: planet('h3', 'p3', 200),
      n: { ...planet('n', 'p2', 50), ...prize },
    },
  };
}

const metal = (s: GameState, playerId: string): number => s.players[playerId]!.resources.metal ?? 0;

describe('integration share', () => {
  it('ramps linearly from the start share to full over the term', () => {
    const term = { claim: 'p2', since: 0, until: DONE };
    expect(integrationShare(term, 0)).toBe(INTEGRATION_START_OUTPUT);
    expect(integrationShare(term, DONE / 2)).toBeCloseTo((INTEGRATION_START_OUTPUT + 1) / 2);
    expect(integrationShare(term, DONE)).toBe(1);
    expect(integrationShare(term, DONE * 2)).toBe(1);
  });
});

describe('integration module', () => {
  const kernel = createKernel([economyModule, constructionModule, integrationModule, capture]);

  it('a planet taken from a player ramps from 25% to full over three days, then is the holder in full', () => {
    const s = okApply(kernel.applyAction(world(), take('p1', 'n'), ctx(0))).state;
    expect(s.planets.n!.integration).toEqual({ claim: 'p2', since: 0, until: DONE });
    const r = okAdvance(kernel.advanceTo(s, ctx(DONE)));
    // h1 in full, n at the ramp's mean: (25% + 100%) / 2.
    const ramp = (10 * INTEGRATION_HOURS * (INTEGRATION_START_OUTPUT + 1)) / 2;
    expect(metal(r.state, 'p1')).toBeCloseTo(100 + 10 * INTEGRATION_HOURS + ramp);
    expect(metal(r.state, 'p2')).toBeCloseTo(100 + 10 * INTEGRATION_HOURS); // n is gone
    expect(r.state.planets.n!.integration).toBeUndefined();
    const after = okAdvance(kernel.advanceTo(r.state, ctx(DONE + HOUR)));
    expect(metal(after.state, 'p1') - metal(r.state, 'p1')).toBeCloseTo(20);
  });

  it('pays the same however the time is cut into spans', () => {
    const s = okApply(kernel.applyAction(world(), take('p1', 'n'), ctx(0))).state;
    const whole = okAdvance(kernel.advanceTo(s, ctx(DONE + 5 * HOUR))).state;
    let step = s;
    for (const at of [1, 7, 7.5, 30, 36, 71, 72, 77].map((x) => x * HOUR))
      step = okAdvance(kernel.advanceTo(step, ctx(at))).state;
    expect(metal(step, 'p1')).toBeCloseTo(metal(whole, 'p1'), 9);
  });

  it('builds no units while integrating, buildings are allowed', () => {
    const s = okApply(kernel.applyAction(world(), take('p1', 'n'), ctx(0))).state;
    const refused = kernel.applyAction(s, unitOrder('p1', 'n'), ctx(HOUR));
    expect(refused).toMatchObject({ ok: false, code: 'E_INTEGRATING' });
    const mine: Action = {
      id: 's:p1:mine',
      type: 'building.construct',
      playerId: 'p1',
      payload: { planetId: 'n', building: 'mine' },
      issuedAt: 0,
    };
    const bare = structuredClone(s);
    bare.planets.n!.buildings = bare.planets.n!.buildings.filter((b) => b.type !== 'mine');
    expect(kernel.applyAction(bare, mine, ctx(HOUR)).ok).toBe(true);
    expect(kernel.applyAction(s, unitOrder('p1', 'h1'), ctx(HOUR)).ok).toBe(true);
    const done = okAdvance(kernel.advanceTo(s, ctx(DONE))).state;
    expect(kernel.applyAction(done, unitOrder('p1', 'n'), ctx(DONE)).ok).toBe(true);
  });

  it('a planet settled from nobody is the taker in full at once', () => {
    const s = okApply(kernel.applyAction(world({ owner: null }), take('p1', 'n'), ctx(0))).state;
    expect(s.planets.n!.integration).toBeUndefined();
    expect(kernel.applyAction(s, unitOrder('p1', 'n'), ctx(0)).ok).toBe(true);
  });

  it('the side it was taken from retakes it in full before integration ends', () => {
    let s = okApply(kernel.applyAction(world(), take('p1', 'n'), ctx(0))).state;
    s = okApply(kernel.applyAction(s, take('p2', 'n'), ctx(10 * HOUR))).state;
    expect(s.planets.n!.integration).toBeUndefined();
    const r = okAdvance(kernel.advanceTo(s, ctx(11 * HOUR)));
    expect(metal(r.state, 'p2') - metal(s, 'p2')).toBeCloseTo(20);
    // The old end event finds nothing to end.
    expect(
      okAdvance(kernel.advanceTo(r.state, ctx(DONE + HOUR))).state.planets.n!.integration,
    ).toBeUndefined();
  });

  it('a third side restarts integration and keeps the claim', () => {
    let s = okApply(kernel.applyAction(world(), take('p1', 'n'), ctx(0))).state;
    s = okApply(kernel.applyAction(s, take('p3', 'n'), ctx(10 * HOUR))).state;
    const until = 10 * HOUR + DONE;
    expect(s.planets.n!.integration).toEqual({ claim: 'p2', since: 10 * HOUR, until });
    // p1's end event fires first and leaves p3's integration running.
    const mid = okAdvance(kernel.advanceTo(s, ctx(DONE + HOUR))).state;
    expect(mid.planets.n!.integration?.until).toBe(until);
    // p1 never held it in full: retaking it starts integration over, the claim stays p2's.
    const back = okApply(kernel.applyAction(mid, take('p1', 'n'), ctx(DONE + HOUR))).state;
    expect(back.planets.n!.integration).toMatchObject({ claim: 'p2', since: DONE + HOUR });
    // p2 still retakes it in full.
    const home = okApply(kernel.applyAction(back, take('p2', 'n'), ctx(DONE + 2 * HOUR))).state;
    expect(home.planets.n!.integration).toBeUndefined();
  });

  it('once integration ends, the claim is gone: the old owner integrates it like anyone', () => {
    let s = okApply(kernel.applyAction(world(), take('p1', 'n'), ctx(0))).state;
    s = okAdvance(kernel.advanceTo(s, ctx(DONE))).state;
    s = okApply(kernel.applyAction(s, take('p2', 'n'), ctx(DONE + HOUR))).state;
    expect(s.planets.n!.integration).toEqual({
      claim: 'p1',
      since: DONE + HOUR,
      until: DONE + HOUR + DONE,
    });
  });

  it('an annihilated world ends integration: nobody is left to retake it from', () => {
    const s = okApply(kernel.applyAction(world(), take('p1', 'n'), ctx(0))).state;
    const destroy: Action = { ...take('p3', 'n'), id: 's:p3:destroy', type: 'test.destroy' };
    const dead = okApply(kernel.applyAction(s, destroy, ctx(HOUR))).state;
    expect(dead.planets.n!.integration).toBeUndefined();
  });

  it('leaves worlds that are not planets, and PvE matches, alone', () => {
    const rock = world({ kind: 'asteroid', buildings: [{ type: 'mine', level: 1, hp: 0 }] });
    expect(
      okApply(kernel.applyAction(rock, take('p1', 'n'), ctx(0))).state.planets.n!.integration,
    ).toBeUndefined();
    const pve = okApply(kernel.applyAction(world(), take('p1', 'n'), ctx(0, 'waves'))).state;
    expect(pve.planets.n!.integration).toBeUndefined();
  });

  it('stacks with the control limit: an integrating planet beyond it ramps to half', () => {
    const both = createKernel([economyModule, controlModule, integrationModule, capture]);
    const s = world();
    s.capital = { p1: 'h1' };
    // p1 holds five planets nearer its capital, h1 included, so n falls beyond the limit.
    for (let i = 0; i < 4; i += 1)
      s.planets[`m${i}`] = {
        ...structuredClone(s.planets.h1!),
        id: `m${i}`,
        position: { x: 1 + i, y: 0 },
      };
    const taken = okApply(both.applyAction(s, take('p1', 'n'), ctx(0))).state;
    const r = okAdvance(both.advanceTo(taken, ctx(HOUR)));
    const share =
      (integrationShare(taken.planets.n!.integration!, 0) +
        integrationShare(taken.planets.n!.integration!, HOUR)) /
      2;
    expect(metal(r.state, 'p1') - metal(taken, 'p1')).toBeCloseTo(
      5 * 10 + 10 * UNCONTROLLED_OUTPUT * share,
    );
  });

  it('the fog shows integration to the holder and the side it was taken from, not to a third', () => {
    const s = okApply(kernel.applyAction(world(), take('p1', 'n'), ctx(0))).state;
    expect(visibleState(s, 'p1', data).planets.n!.integration).toEqual(s.planets.n!.integration);
    expect(visibleState(s, 'p2', data).planets.n!.integration).toEqual(s.planets.n!.integration);
    expect(visibleState(s, 'p3', data).planets.n!.integration).toBeUndefined();
  });
});

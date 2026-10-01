import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { economyModule } from './economy';
import { sprawlModule, sprawlFactor, ownedProvinceCount, SPRAWL_FREE, SPRAWL_RATE } from './sprawl';
import { createInitialState, type GameState, type Planet } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { AdvanceResult, Context } from '../action/types';
import { deepFreeze } from '../util/clone';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: { mine: { name: 'Mine', produces: { metal: 10 } } },
  events: {},
});
const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });

function okAdvance(r: AdvanceResult): AdvanceResult & { ok: true } {
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r;
}

/** `owned` provinces for p1; only the first carries a mine, the rest are empty. */
function empire(owned: number, extra: Record<string, string | null> = {}): GameState {
  const s = createInitialState({ seed: 'spr', version: { data: '0.1.0', manifest: '1' } });
  const planets: Record<string, Planet> = {};
  const node = (id: string, owner: string | null, mine: boolean): Planet => ({
    id, owner, position: { x: 0, y: 0 }, resources: {},
    buildings: mine ? [{ type: 'mine', level: 1, hp: 0 }] : [], garrison: [], traits: [],
  });
  for (let i = 0; i < owned; i += 1) planets[`n${i}`] = node(`n${i}`, 'p1', i === 0);
  for (const [id, owner] of Object.entries(extra)) planets[id] = node(id, owner, true);
  const player = (id: string) => ({ id, name: id, faction: 'x', status: 'active' as const, resources: { metal: 0 } });
  return { ...s, players: { p1: player('p1'), p2: player('p2') }, planets };
}

describe('sprawlFactor', () => {
  it('is 1 up to the threshold and shrinks by SPRAWL_RATE per province above it', () => {
    expect(sprawlFactor(0)).toBe(1);
    expect(sprawlFactor(SPRAWL_FREE)).toBe(1);
    expect(sprawlFactor(SPRAWL_FREE + 1)).toBeCloseTo(1 / (1 + SPRAWL_RATE));
    expect(sprawlFactor(SPRAWL_FREE + 10)).toBeCloseTo(1 / (1 + 10 * SPRAWL_RATE));
  });

  it('counts every node a player owns, and nothing for neutral', () => {
    const s = empire(3, { x: 'p2', y: null });
    expect(ownedProvinceCount(s, 'p1')).toBe(3);
    expect(ownedProvinceCount(s, 'p2')).toBe(1);
    expect(ownedProvinceCount(s, null)).toBe(0);
  });

  it('does not count a fortress pad on a road fork as a province', () => {
    const s = empire(3);
    s.planets.pad = { ...s.planets.n1!, id: 'pad', fork: { province: 'n0', trail: 0 } };
    expect(ownedProvinceCount(s, 'p1')).toBe(3);
  });
});

describe('sprawl module', () => {
  it('leaves an empire at the threshold untouched', () => {
    const kernel = createKernel([economyModule, sprawlModule]);
    const r = okAdvance(kernel.advanceTo(empire(SPRAWL_FREE), ctx(HOUR)));
    expect(r.state.players.p1?.resources.metal).toBeCloseTo(10);
  });

  it('dims the whole output of an empire past the threshold', () => {
    const kernel = createKernel([economyModule, sprawlModule]);
    const r = okAdvance(kernel.advanceTo(empire(SPRAWL_FREE + 5), ctx(HOUR)));
    expect(r.state.players.p1?.resources.metal).toBeCloseTo(10 / (1 + 5 * SPRAWL_RATE));
  });

  it("taxes only the sprawling owner, not a small neighbour", () => {
    const kernel = createKernel([economyModule, sprawlModule]);
    const r = okAdvance(kernel.advanceTo(empire(SPRAWL_FREE + 5, { x: 'p2' }), ctx(HOUR)));
    expect(r.state.players.p2?.resources.metal).toBeCloseTo(10);
  });

  it('without the module output is unchanged (graceful degradation)', () => {
    const kernel = createKernel([economyModule]);
    const r = okAdvance(kernel.advanceTo(empire(SPRAWL_FREE + 5), ctx(HOUR)));
    expect(r.state.players.p1?.resources.metal).toBeCloseTo(10);
  });

  it('does not mutate its input', () => {
    const kernel = createKernel([economyModule, sprawlModule]);
    expect(() => kernel.advanceTo(deepFreeze(empire(SPRAWL_FREE + 5)), ctx(HOUR))).not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { createKernel, createInitialState, type GameState, type Planet, type Player } from '@void/shared-core';
import { loadShippedData, DEV_MODULES } from './scenario';

/**
 * FND-7 (game-vision-roadmap.md, ECON-5 in resource-economy.md): a permanent gate
 * against the canon↔prototype economy drifting apart again. Runs the SHIPPED
 * data/*.json bundle through balance assertions that also hold for the
 * prototype's tuned numbers (resource-economy.md §4's "3–8h payback" rule of
 * thumb, and the Phase-0 finding that canonical credits had NO income loop at
 * all before FND-1/FND-2). Deliberately narrow: this is a floor, not a full
 * balance suite — `prototype/econplaytest.mjs` (ECON-6) owns curve-tuning.
 */

const HOUR = 3_600_000;
const data = loadShippedData();

function player(id: string): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: {} };
}
function world(id: string, owner: string, planetType?: string): Planet {
  return {
    id,
    owner,
    position: { x: 0, y: 0 },
    planetType,
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}
function creditsAfter(planetType?: string): number {
  const kernel = createKernel(DEV_MODULES);
  const s: GameState = {
    ...createInitialState({ seed: 'parity', version: { data: data.version, manifest: '1' } }),
    players: { p1: player('p1') },
    planets: { A: world('A', 'p1', planetType) },
  };
  const r = kernel.advanceTo(s, { now: HOUR, data });
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r.state.players.p1?.resources.credits ?? 0;
}

describe('economy parity (FND-7) — mine payback', () => {
  it('mine L1 pays for itself in 3–8h (resource-economy.md §4 rule of thumb)', () => {
    const def = data.buildings.mine_t1;
    expect(def).toBeDefined();
    const cost = def!.cost.metal ?? 0;
    const rate = def!.produces?.metal ?? 0;
    expect(rate).toBeGreaterThan(0);
    const paybackHours = cost / rate;
    expect(paybackHours).toBeGreaterThanOrEqual(3);
    expect(paybackHours).toBeLessThanOrEqual(8);
  });
});

describe('economy parity (FND-7) — every habitable world has a credits income', () => {
  const types = Object.keys(data.planetTypes);

  it('ships at least the ECON-7 planet-type roster (not an empty/dead bundle)', () => {
    expect(types.length).toBeGreaterThanOrEqual(10);
  });

  it.each(types)('a bare (building-free) %s world yields >0 credits per hour', (planetType) => {
    expect(creditsAfter(planetType)).toBeGreaterThan(0);
  });

  it('a world with no planetType at all (permissive default) still yields >0 credits (civic tax)', () => {
    expect(creditsAfter()).toBeGreaterThan(0);
  });
});

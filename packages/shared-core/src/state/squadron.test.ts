import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadGameData } from '../data/loadGameData';
import type { GameData } from '../data/schemas';
import type { Fleet } from './gameState';
import {
  sortieSpec,
  freshSortie,
  canSortie,
  spendSortie,
  tickRearm,
  squadronTake,
  fleetHasSquadron,
  squadronStrikeRange,
  withinRange,
  squadronReaches,
  type SortieState,
} from './squadron';

// SQ-1.1/SQ-2.1/SQ-3.1 (squadrons-roadmap.md): 1:1 port of the prototype's
// `squadron.ts` pure math onto the real shipped bundle (`fighter_squadron`
// already ships with strikeRange/fuel/rearmRounds — canon just lacked this
// module). Not wired into a `fleet.launch` action yet — pure math only.

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../data');
const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(path.join(dataDir, name), 'utf8'));
const data: GameData = loadGameData(readJson);

function fleet(units: Array<{ unit: string; count: number }>): Fleet {
  return { id: 'f1', owner: 'p1', location: 'p1', movement: null, units, traits: [] };
}

const squadronUnit = Object.keys(data.units).find((u) =>
  data.units[u]!.traits.includes('squadron'),
)!;
const nonSquadronUnit = Object.keys(data.units).find(
  (u) => !data.units[u]!.traits.includes('squadron'),
)!;

describe('squadronTake (SQ-1.1, real shipped data)', () => {
  it('picks out only the squadron-trait stacks aboard a fleet', () => {
    const f = fleet([
      { unit: squadronUnit, count: 2 },
      { unit: nonSquadronUnit, count: 3 },
    ]);
    expect(squadronTake(f, data)).toEqual([{ unit: squadronUnit, count: 2 }]);
  });

  it('is empty for a fleet with no squadron aboard', () => {
    expect(squadronTake(fleet([{ unit: nonSquadronUnit, count: 3 }]), data)).toEqual([]);
  });

  it('ignores a zero-count stack', () => {
    expect(squadronTake(fleet([{ unit: squadronUnit, count: 0 }]), data)).toEqual([]);
  });
});

describe('fleetHasSquadron (real shipped data)', () => {
  it('true when the fleet carries a live squadron stack', () => {
    expect(fleetHasSquadron(fleet([{ unit: squadronUnit, count: 1 }]), data)).toBe(true);
  });

  it('false for undefined, empty, or squadron-free fleets', () => {
    expect(fleetHasSquadron(undefined, data)).toBe(false);
    expect(fleetHasSquadron(fleet([]), data)).toBe(false);
    expect(fleetHasSquadron(fleet([{ unit: nonSquadronUnit, count: 3 }]), data)).toBe(false);
  });
});

describe('sortieSpec (SQ-2.1, reads the wing unit stats off real shipped data)', () => {
  it('reads maxFuel + rearmRounds off the squadron-trait ship', () => {
    const spec = sortieSpec(fleet([{ unit: squadronUnit, count: 2 }]), data);
    expect(spec.maxFuel).toBe(data.units[squadronUnit]!.stats.fuel);
    expect(spec.rearmRounds).toBe(data.units[squadronUnit]!.stats.rearmRounds);
    expect(spec.maxFuel).toBeGreaterThan(0); // the shipped fighter carries fuel
  });

  it('is zeros for a fleet with no squadron aboard', () => {
    expect(sortieSpec(fleet([{ unit: nonSquadronUnit, count: 3 }]), data)).toEqual({
      maxFuel: 0,
      rearmRounds: 0,
    });
  });
});

describe('sortie / rearm counter (SQ-2.1)', () => {
  it('a fresh wing is fully fuelled and flight-ready', () => {
    const s = freshSortie(3);
    expect(s).toEqual({ fuel: 3, rearming: 0 });
    expect(canSortie(s)).toBe(true);
  });

  it('each sortie burns one fuel', () => {
    let s = freshSortie(3);
    s = spendSortie(s, 2);
    expect(s).toEqual({ fuel: 2, rearming: 0 });
    expect(canSortie(s)).toBe(true);
  });

  it('the last drop of fuel drops the wing onto the rearm cooldown', () => {
    let s: SortieState = { fuel: 1, rearming: 0 };
    s = spendSortie(s, 2);
    expect(s).toEqual({ fuel: 0, rearming: 2 });
    expect(canSortie(s)).toBe(false); // grounded, rearming
  });

  it('cannot sortie while rearming (spend is a no-op)', () => {
    const s: SortieState = { fuel: 0, rearming: 2 };
    expect(canSortie(s)).toBe(false);
    expect(spendSortie(s, 2)).toEqual(s); // unchanged
  });

  it('rearming counts down, then refuels to max and is flight-ready again', () => {
    let s: SortieState = { fuel: 0, rearming: 2 };
    s = tickRearm(s, 3);
    expect(s).toEqual({ fuel: 0, rearming: 1 }); // still rearming
    expect(canSortie(s)).toBe(false);
    s = tickRearm(s, 3);
    expect(s).toEqual({ fuel: 3, rearming: 0 }); // refuelled
    expect(canSortie(s)).toBe(true);
  });

  it('tickRearm leaves a flight-ready (idle) wing untouched', () => {
    const s = freshSortie(3);
    expect(tickRearm(s, 3)).toEqual(s);
  });

  it('full cycle: N sorties → rearm → back in the fight', () => {
    const max = 3;
    const rearm = 2;
    let s = freshSortie(max);
    let sorties = 0;
    while (canSortie(s)) {
      s = spendSortie(s, rearm);
      sorties++;
    }
    expect(sorties).toBe(max); // exactly maxFuel strikes before grounding
    expect(s.rearming).toBe(rearm);
    for (let i = 0; i < rearm; i++) {
      expect(canSortie(s)).toBe(false);
      s = tickRearm(s, max);
    }
    expect(canSortie(s)).toBe(true); // returned, ready to fly the next N
    expect(s.fuel).toBe(max);
  });

  it('a zero-rearm config still recovers (clamped to at least one round)', () => {
    let s: SortieState = { fuel: 1, rearming: 0 };
    s = spendSortie(s, 0); // rearmRounds 0 would otherwise strand it at fuel 0
    expect(s.rearming).toBe(1);
    s = tickRearm(s, 2);
    expect(canSortie(s)).toBe(true);
  });
});

describe('squadron strike radius (SQ-3.1, real shipped data)', () => {
  const range = data.units[squadronUnit]!.stats.strikeRange;

  it('reads the longest strikeRange among live squadron ships', () => {
    expect(squadronStrikeRange(fleet([{ unit: squadronUnit, count: 2 }]), data)).toBe(range);
    expect(range).toBeGreaterThan(0);
  });

  it('a fleet without a squadron has no strike radius', () => {
    expect(squadronStrikeRange(fleet([{ unit: nonSquadronUnit, count: 3 }]), data)).toBe(0);
  });

  it('withinRange is boundary-inclusive (exactly on the edge reaches)', () => {
    expect(withinRange({ x: 0, y: 0 }, { x: 180, y: 0 }, 180)).toBe(true); // on the edge
    expect(withinRange({ x: 0, y: 0 }, { x: 181, y: 0 }, 180)).toBe(false); // just beyond
    expect(withinRange({ x: 0, y: 0 }, { x: 100, y: 100 }, 180)).toBe(true); // hypot ≈ 141 < 180
  });

  it('the wing strikes inside its radius and not beyond it (boundary)', () => {
    const wing = fleet([{ unit: squadronUnit, count: 2 }]);
    const from = { x: 500, y: 500 };
    expect(squadronReaches(wing, data, from, { x: 500 + range, y: 500 })).toBe(true); // edge
    expect(squadronReaches(wing, data, from, { x: 500 + range + 1, y: 500 })).toBe(false); // out
  });

  it('a non-strike fleet never reaches (range 0)', () => {
    const nonWing = fleet([{ unit: nonSquadronUnit, count: 3 }]);
    expect(squadronReaches(nonWing, data, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(false);
  });
});

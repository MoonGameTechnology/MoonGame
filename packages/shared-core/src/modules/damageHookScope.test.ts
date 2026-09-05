import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { combatModule } from './combat';
import { orbitalModule } from './orbital';
import { artilleryModule } from './artillery';
import { squadronModule } from './squadron';
import { constructionModule } from './construction';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { buildingLevel, parseGameData, type GameData } from '../data/schemas';
import type { Action, AdvanceResult, ApplyResult, Context } from '../action/types';

/**
 * CORE-DMG-1 — the REACH of the `combat.damage` hook, pinned by test.
 *
 * Every firing channel runs its damage through the hook: the melee round, planetary
 * AA, standoff artillery, ship point-defense and orbital bombardment alike. An owner
 * decision (reversed once — the earlier reading called the melee-only scope deliberate),
 * so it needs a guard in the direction it now holds: a channel that stops consulting
 * the hook silently drops the whole extension point for its share of the damage, which
 * is exactly how three of them drifted out in the first place.
 *
 * Each test proves TWO things at once — the channel really fired (its event is in the
 * stream) and the hook scaled what landed. Asserting the hook was merely CALLED would
 * also pass for a channel that consulted it and threw the answer away, so every case
 * reads the number that reached the target.
 *
 * The probe multiplies by a factor no channel could reach on its own, and the tests
 * measure the announced damage as well as the hull loss: an event carrying the pre-hook
 * figure while a bigger number lands is a lying tracer, and that is a bug of its own.
 */

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    // Melee striker; also the bombardier (bombard power derives from `attack`).
    cruiser: { faction: 'x', stats: { attack: 10, defense: 4, speed: 6, hp: 60 }, line: 'front' },
    // Inert, deep-hulled punching bag: it survives every channel, so a scenario
    // ends with a live target whose HP loss is a readable signal.
    hulk: { faction: 'x', stats: { attack: 0, defense: 0, speed: 4, hp: 4000 }, line: 'front' },
    // Standoff artillery — needs a firing radius to shoot without closing.
    siege: {
      faction: 'x',
      stats: { attack: 12, defense: 0, speed: 4, hp: 40, range: 250 },
      line: 'rear',
      traits: ['artillery'],
    },
    // Point-defense carrier and the squadron its flak intercepts.
    escort: {
      faction: 'x',
      stats: { attack: 0, defense: 0, speed: 4, hp: 200, pointDefense: 20 },
      line: 'front',
    },
    wing: {
      faction: 'x',
      stats: { attack: 0, defense: 0, speed: 8, hp: 300 },
      line: 'front',
      traits: ['squadron'],
    },
  },
  factions: {},
  buildings: {
    flak: { name: 'Flak', cost: { metal: 1 }, buildTimeHours: 0, hp: 100, aaDamage: 25 },
    depot: { name: 'Depot', cost: { metal: 1 }, buildTimeHours: 0, hp: 400 },
  },
  events: {},
});

const HOUR = 3_600_000;
const ctx = (now: number): Context => ({ now, data });

/** Scales every `combat.damage` invocation by a fixed factor and records its args.
 *  Each test runs its scenario twice — with and without this module — and compares:
 *  that needs no knowledge of the channel's internal constants, so a balance edit to
 *  the fixture can never turn the guard into a tautology. */
const BOOST = 3;
function probeModule(calls: unknown[]): GameModule {
  return {
    id: 'damage-probe',
    version: '1.0.0',
    setup(api) {
      api.hook<number>('combat.damage', (dmg, args) => {
        calls.push(args);
        return dmg * BOOST;
      });
    },
  };
}

/** Emits `fleet.arrived` without dragging movement in — the same fixture shape
 *  `combat.test.ts` uses to start a battle on demand. */
const arrivalModule: GameModule = {
  id: 'test-arrival',
  version: '1.0.0',
  setup(api) {
    api.onAction('arrive', (a, h) => {
      const fleetId = (a.payload as { fleetId: string }).fleetId;
      h.emit('fleet.arrived', { fleetId, at: h.state.fleets[fleetId]?.location });
    });
  },
};
const arrive = (fleetId: string, playerId = 'p1'): Action => ({
  id: `s:${playerId}:1`,
  type: 'arrive',
  playerId,
  payload: { fleetId },
  issuedAt: 0,
});

function player(id: string): Player {
  return { id, name: id, faction: 'x', status: 'active', resources: { metal: 100 } };
}
function planet(
  id: string,
  owner: string | null,
  opts: { at?: { x: number; y: number }; buildings?: Array<[string, number]> } = {},
): Planet {
  return {
    id,
    owner,
    position: opts.at ?? { x: 0, y: 0 },
    resources: {},
    buildings: (opts.buildings ?? []).map(([type, level]) => ({
      type,
      level,
      hp: buildingLevel(data.buildings[type]!, level).hp,
    })),
    garrison: [],
    traits: [],
  };
}
function fleet(
  id: string,
  owner: string,
  location: string | null,
  units: Array<[string, number]>,
  opts: { orbit?: 'near'; bombarding?: boolean; homeBase?: string } = {},
): Fleet {
  return {
    id,
    owner,
    location,
    movement: null,
    units: units.map(([unit, count]) => ({ unit, count })),
    orbit: opts.orbit,
    bombarding: opts.bombarding,
    homeBase: opts.homeBase,
    battleId: null,
    traits: [],
  };
}
function stateWith(planets: Planet[], fleets: Fleet[]): GameState {
  const s = createInitialState({ seed: 'dmg', version: { data: '0.1.0', manifest: '1' } });
  const ps: Record<string, Planet> = {};
  for (const x of planets) ps[x.id] = x;
  const fs: Record<string, Fleet> = {};
  for (const x of fleets) fs[x.id] = x;
  return {
    ...s,
    players: { p1: player('p1'), p2: player('p2') },
    planets: ps,
    fleets: fs,
  };
}
function okApply(r: ApplyResult): ApplyResult & { ok: true } {
  if (!r.ok) throw new Error(`apply failed: ${r.code}`);
  return r;
}
function okAdvance(r: AdvanceResult): AdvanceResult & { ok: true } {
  if (!r.ok) throw new Error(`advance failed: ${r.code}`);
  return r;
}
const hullOf = (state: GameState, fleetId: string, unit: string): number | undefined =>
  state.fleets[fleetId]?.units.find((u) => u.unit === unit)?.hp;

describe('combat.damage — every firing channel goes through the hook (CORE-DMG-1)', () => {
  it('scales the melee round', () => {
    const melee = (mods: GameModule[]): number => {
      const kernel = createKernel([orbitalModule, combatModule, arrivalModule, ...mods]);
      const st = stateWith(
        [planet('P', null)],
        [fleet('A', 'p1', 'P', [['cruiser', 1]]), fleet('D', 'p2', 'P', [['hulk', 1]])],
      );
      const started = okApply(kernel.applyAction(st, arrive('A'), ctx(0)));
      const r = okAdvance(kernel.advanceTo(started.state, ctx(HOUR)));
      const round = r.events.find((e) => e.type === 'combat.round');
      expect(round).toBeDefined();
      return (round?.payload as { dmgToDefender: number }).dmgToDefender;
    };

    const calls: unknown[] = [];
    const raw = melee([]);
    expect(raw).toBeGreaterThan(0);
    expect(melee([probeModule(calls)])).toBe(raw * BOOST);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('scales planetary AA, and the flak tracer announces what it really fired', () => {
    const aa = (mods: GameModule[]) => {
      const kernel = createKernel([orbitalModule, ...mods]);
      const st = stateWith(
        [planet('P', 'p2', { buildings: [['flak', 1]] })],
        [fleet('R', 'p1', 'P', [['hulk', 1]], { orbit: 'near' })],
      );
      const r = okAdvance(kernel.advanceTo(st, ctx(HOUR)));
      const fired = r.events.filter((e) => e.type === 'aa.fired');
      expect(fired.length).toBeGreaterThan(0);
      const announced = fired.reduce(
        (sum, e) => sum + (e.payload as { damage: number }).damage,
        0,
      );
      const lost = 4000 - (hullOf(r.state, 'R', 'hulk') ?? 0);
      return { announced, lost };
    };

    const calls: unknown[] = [];
    const raw = aa([]);
    const boosted = aa([probeModule(calls)]);
    expect(raw.announced).toBeGreaterThan(0);
    expect(boosted.announced).toBe(raw.announced * BOOST);
    // The tracer and the hull must agree: an event carrying the pre-hook figure is a lie.
    expect(boosted.lost).toBeCloseTo(boosted.announced, 6);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('scales standoff artillery, and the barrage reports what it really landed', () => {
    const barrage = (mods: GameModule[]) => {
      const kernel = createKernel([artilleryModule, ...mods]);
      const st = stateWith(
        [planet('A', 'p1', { at: { x: 0, y: 0 } }), planet('B', 'p2', { at: { x: 100, y: 0 } })],
        [fleet('S', 'p1', 'A', [['siege', 1]]), fleet('T', 'p2', 'B', [['hulk', 1]])],
      );
      const r = okAdvance(kernel.advanceTo(st, ctx(HOUR)));
      const fired = r.events.find((e) => e.type === 'artillery.fired');
      expect(fired).toBeDefined();
      return {
        announced: (fired?.payload as { power: number }).power,
        lost: 4000 - (hullOf(r.state, 'T', 'hulk') ?? 0),
      };
    };

    const calls: unknown[] = [];
    const raw = barrage([]);
    const boosted = barrage([probeModule(calls)]);
    expect(raw.announced).toBeGreaterThan(0);
    expect(boosted.announced).toBe(raw.announced * BOOST);
    expect(boosted.lost).toBeCloseTo(boosted.announced, 6);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('scales ship point-defense, and the intercept reports what it really landed', () => {
    const pd = (mods: GameModule[]) => {
      const kernel = createKernel([squadronModule, ...mods]);
      const st = stateWith(
        [planet('P', null), planet('H', 'p2')],
        [
          fleet('E', 'p1', 'P', [['escort', 1]]),
          fleet('W', 'p2', 'P', [['wing', 1]], { homeBase: 'H' }),
        ],
      );
      const r = okAdvance(kernel.advanceTo(st, ctx(HOUR)));
      const fired = r.events.find((e) => e.type === 'pd.fired');
      expect(fired).toBeDefined();
      return {
        announced: (fired?.payload as { damage: number }).damage,
        lost: 300 - (hullOf(r.state, 'W', 'wing') ?? 0),
      };
    };

    const calls: unknown[] = [];
    const raw = pd([]);
    const boosted = pd([probeModule(calls)]);
    expect(raw.announced).toBeGreaterThan(0);
    expect(boosted.announced).toBe(raw.announced * BOOST);
    expect(boosted.lost).toBeCloseTo(boosted.announced, 6);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('scales orbital bombardment at the source, before the power leaves on the bus', () => {
    const shell = (mods: GameModule[]) => {
      const kernel = createKernel([orbitalModule, constructionModule, ...mods]);
      const st = stateWith(
        [planet('P', 'p2', { buildings: [['depot', 1]] })],
        [fleet('B', 'p1', 'P', [['cruiser', 1]], { orbit: 'near', bombarding: true })],
      );
      const r = okAdvance(kernel.advanceTo(st, ctx(HOUR)));
      const shelled = r.events.find((e) => e.type === 'planet.bombarded');
      expect(shelled).toBeDefined();
      const depot = r.state.planets.P?.buildings.find((b) => b.type === 'depot');
      return {
        announced: (shelled?.payload as { power: number }).power,
        lost: 400 - (depot?.hp ?? 0),
      };
    };

    const calls: unknown[] = [];
    const raw = shell([]);
    const boosted = shell([probeModule(calls)]);
    expect(raw.announced).toBeGreaterThan(0);
    // `construction` applies whatever arrives, so scaling at the source is the only
    // way a bonus reaches the structures — and the event must already carry it.
    expect(boosted.announced).toBe(raw.announced * BOOST);
    expect(boosted.lost).toBeGreaterThan(raw.lost);
    expect(calls.length).toBeGreaterThan(0);
  });

  it('keeps the defender-side mitigations on the ground phase only', () => {
    // The fort / standing-buildings / planet-type hooks guard on `phase === 'ground'`.
    // None of the newly wired channels claims that phase, so widening the hook's reach
    // moved the ATTACKER's bonuses and nothing else.
    const phases = new Set<string>();
    const kernel = createKernel([
      orbitalModule,
      artilleryModule,
      squadronModule,
      {
        id: 'phase-probe',
        version: '1.0.0',
        setup(api) {
          api.hook<number>('combat.damage', (dmg, args) => {
            phases.add(String((args as { phase?: string }).phase));
            return dmg;
          });
        },
      },
    ]);
    const st = stateWith(
      [
        planet('P', 'p2', { buildings: [['flak', 1]] }),
        planet('A', 'p1', { at: { x: 0, y: 0 } }),
        planet('B', 'p2', { at: { x: 100, y: 0 } }),
        planet('H', 'p2'),
      ],
      [
        fleet('R', 'p1', 'P', [['hulk', 1]], { orbit: 'near' }),
        fleet('Z', 'p1', 'P', [['cruiser', 1]], { orbit: 'near', bombarding: true }),
        fleet('S', 'p1', 'A', [['siege', 1]]),
        fleet('T', 'p2', 'B', [['hulk', 1]]),
        fleet('E', 'p1', 'A', [['escort', 1]]),
        fleet('W', 'p2', 'A', [['wing', 1]], { homeBase: 'H' }),
      ],
    );
    okAdvance(kernel.advanceTo(st, ctx(HOUR)));

    expect(phases).toEqual(new Set(['orbital', 'bombard', 'standoff', 'pointDefense']));
    expect(phases.has('ground')).toBe(false);
  });
});

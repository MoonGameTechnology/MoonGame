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
import type { Action, AdvanceResult, ApplyResult, Context, DomainEvent } from '../action/types';

/**
 * CORE-DMG-1 — the SCOPE of the `combat.damage` hook, pinned by test.
 *
 * The hook is the per-round MELEE extension point and nothing more: only the
 * `combat` module's simultaneous round runs its damage through it. The other
 * firing channels deal their damage raw, on purpose — planetary AA, standoff
 * artillery, ship point-defense and orbital bombardment are NOT scaled by an
 * admiral's tactics, a faction passive, a technology bonus or a hero aura.
 *
 * That is an owner decision, not an oversight, so it needs a guard: without one
 * the next channel is a coin flip, and `combat.ts` already carried a comment
 * promising the hook covered bombardment while `orbital` never called it. Each
 * test below therefore proves TWO things at once — the channel really fired
 * (its event is in the stream, its target really took damage), and the hook was
 * never consulted while it did. A count of zero alone would also pass for a
 * scenario that quietly did nothing.
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

/** Records every `combat.damage` invocation and boosts it beyond recognition:
 *  a channel routed through the hook cannot hide behind rounding. */
function probeModule(calls: unknown[]): GameModule {
  return {
    id: 'damage-probe',
    version: '1.0.0',
    setup(api) {
      api.hook<number>('combat.damage', (dmg, args) => {
        calls.push(args);
        return dmg * 1000;
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
const types = (events: DomainEvent[]): string[] => events.map((e) => e.type);
const hullOf = (state: GameState, fleetId: string, unit: string): number | undefined =>
  state.fleets[fleetId]?.units.find((u) => u.unit === unit)?.hp;

describe('combat.damage — the hook covers the melee round and nothing else (CORE-DMG-1)', () => {
  it('scales the melee round: the extension point works where it is meant to', () => {
    const calls: unknown[] = [];
    const kernel = createKernel([
      orbitalModule,
      combatModule,
      artilleryModule,
      arrivalModule,
      probeModule(calls),
    ]);
    const st = stateWith(
      [planet('P', null)],
      [fleet('A', 'p1', 'P', [['cruiser', 1]]), fleet('D', 'p2', 'P', [['hulk', 1]])],
    );

    const started = okApply(kernel.applyAction(st, arrive('A'), ctx(0)));
    const r = okAdvance(kernel.advanceTo(started.state, ctx(HOUR)));

    const round = r.events.find((e) => e.type === 'combat.round');
    expect(round).toBeDefined();
    expect(calls.length).toBeGreaterThan(0);
    // 10 attack × 1000 — the boost landed, so this channel really is hooked.
    expect((round?.payload as { dmgToDefender: number }).dmgToDefender).toBe(10_000);
  });

  it('leaves planetary AA raw: the flak volley lands unscaled', () => {
    const calls: unknown[] = [];
    const kernel = createKernel([orbitalModule, probeModule(calls)]);
    const st = stateWith(
      [planet('P', 'p2', { buildings: [['flak', 1]] })],
      [fleet('R', 'p1', 'P', [['hulk', 1]], { orbit: 'near' })],
    );

    const r = okAdvance(kernel.advanceTo(st, ctx(4 * HOUR)));

    expect(types(r.events)).toContain('aa.fired');
    // The raider really was shot at — 25 aaDamage per hourly volley, boost-free.
    expect(hullOf(r.state, 'R', 'hulk')).toBeLessThan(4000);
    expect(hullOf(r.state, 'R', 'hulk')).toBeGreaterThan(3000);
    expect(calls).toEqual([]);
  });

  it('leaves standoff artillery raw: the barrage lands unscaled', () => {
    const calls: unknown[] = [];
    const kernel = createKernel([artilleryModule, probeModule(calls)]);
    const st = stateWith(
      [planet('A', 'p1', { at: { x: 0, y: 0 } }), planet('B', 'p2', { at: { x: 100, y: 0 } })],
      [fleet('S', 'p1', 'A', [['siege', 1]]), fleet('T', 'p2', 'B', [['hulk', 1]])],
    );

    const r = okAdvance(kernel.advanceTo(st, ctx(HOUR)));

    expect(types(r.events)).toContain('artillery.fired');
    expect(hullOf(r.state, 'T', 'hulk')).toBeLessThan(4000);
    expect(hullOf(r.state, 'T', 'hulk')).toBeGreaterThan(3000);
    expect(calls).toEqual([]);
  });

  it('leaves ship point-defense raw: the intercept lands unscaled', () => {
    const calls: unknown[] = [];
    const kernel = createKernel([squadronModule, probeModule(calls)]);
    const st = stateWith(
      [planet('P', null), planet('H', 'p2')],
      [
        fleet('E', 'p1', 'P', [['escort', 1]]),
        fleet('W', 'p2', 'P', [['wing', 1]], { homeBase: 'H' }),
      ],
    );

    const r = okAdvance(kernel.advanceTo(st, ctx(HOUR)));

    expect(types(r.events)).toContain('pd.fired');
    expect(hullOf(r.state, 'W', 'wing')).toBeLessThan(300);
    expect(calls).toEqual([]);
  });

  it('leaves orbital bombardment raw: the structures wear down unscaled', () => {
    const calls: unknown[] = [];
    const kernel = createKernel([orbitalModule, constructionModule, probeModule(calls)]);
    const st = stateWith(
      [planet('P', 'p2', { buildings: [['depot', 1]] })],
      [fleet('B', 'p1', 'P', [['cruiser', 1]], { orbit: 'near', bombarding: true })],
    );

    const r = okAdvance(kernel.advanceTo(st, ctx(HOUR)));

    expect(types(r.events)).toContain('planet.bombarded');
    const depot = r.state.planets.P?.buildings.find((b) => b.type === 'depot');
    expect(depot?.hp).toBeLessThan(400);
    expect(depot?.hp).toBeGreaterThan(0);
    expect(calls).toEqual([]);
  });
});

import { expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { createInitialState, type GameState } from '../state/gameState';
import type { CompletePayload } from '../state/construction';
import { parseGameData, type GameData } from '../data/schemas';
import { constructionModule } from './construction';
import { economyModule } from './economy';

const H = 3_600_000;
const kernel = createKernel([constructionModule, economyModule]);
const old = parseGameData({ version: 'before', resources: ['metal'], factions: {}, events: {},
  units: { frigate: { faction: 'x', cost: { metal: 90 }, buildTimeHours: 3,
    stats: { hp: 20, attack: 1, defense: 1, speed: 1 } } },
  buildings: { factory: { name: 'Factory', hp: 100, cost: { metal: 120 }, buildTimeHours: 4, produces: { metal: 12 },
    upgrades: [{ cost: { metal: 120 }, buildTimeHours: 5, hp: 200, produces: { metal: 24 } }] },
    shipyard: { name: 'Yard', hp: 100, enablesShipConstruction: true } },
});
const current = parseGameData({ ...old, version: 'after' });
function world(): GameState {
  const s = createInitialState({ seed: 'accepted-duration', version: { data: old.version, manifest: '1' } });
  s.players.p1 = { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: { metal: 1000 } };
  s.planets.P = { id: 'P', owner: 'p1', position: { x: 0, y: 0 }, buildings: [
    { type: 'shipyard', level: 1, hp: 100 },
  ], resources: {}, garrison: [], traits: [] };
  return s;
}
function currentWorld(): GameState {
  const s = world();
  s.pricing = { buildingHours: 3, unitHours: 2 };
  return s;
}
function act(s: GameState, data: GameData, type: string, payload: object): GameState {
  const r = kernel.applyAction(s, { id: type, playerId: 'p1', type, payload, issuedAt: s.time }, { now: s.time, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function advance(s: GameState, data: GameData, hours: number): GameState {
  const r = kernel.advanceTo(s, { now: hours * H, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
const running = (s: GameState) => s.scheduled.find(e => e.type === 'construction.complete')!;
function legacy(s: GameState): GameState {
  delete (running(s).payload as CompletePayload).durationHours;
  return s;
}
function cancel(s: GameState, data: GameData): GameState {
  return act(s, data, 'construction.cancel', { planetId: 'P', seq: running(s).seq });
}

it.each(['building', 'upgrade'] as const)('retains old %s progress, income threshold and refund across the update and resume', (kind) => {
  const initial = world();
  const hours = kind === 'upgrade' ? 5 : 4;
  if (kind === 'upgrade') initial.planets.P!.buildings.push({ type: 'factory', level: 1, hp: 100 });
  let s = legacy(act(initial, old, kind === 'upgrade' ? 'building.upgrade' : 'building.construct', { planetId: 'P', building: 'factory' }));
  expect(running(s).at).toBe(hours * H);
  s = advance(s, current, hours / 2);
  expect(s.players.p1!.resources.metal).toBe(880 + (kind === 'upgrade' ? 12 * hours / 2 : 0));
  s = cancel(s, current);
  const site = s.planets.P!.pausedConstruction![0]!;
  expect(site).toMatchObject({ progress: 0.5, remainingHours: hours / 2, remainingCost: { metal: 60 } });
  s = act(s, current, 'construction.resume', { planetId: 'P', id: site.id });
  expect(running(s)).toMatchObject({ at: hours * H, payload: { durationHours: hours } });
  s = advance(s, current, hours * 0.75);
  const treasury = s.players.p1!.resources.metal!;
  s = cancel(s, current);
  expect(s.planets.P!.pausedConstruction![0]).toMatchObject({ progress: 0.75, remainingHours: hours / 4 });
  expect(s.players.p1!.resources.metal! - treasury).toBe(30);
});

it('pins the tripled time for new buildings in a new match with category multipliers', () => {
  let s = act(currentWorld(), current, 'building.construct', { planetId: 'P', building: 'factory' });
  expect(running(s)).toMatchObject({ at: 12 * H, payload: { durationHours: 12 } });
  s = advance(s, current, 6);
  expect(s.players.p1!.resources.metal).toBe(880);
  s = cancel(s, current);
  expect(s.planets.P!.pausedConstruction![0]).toMatchObject({ progress: 0.5, remainingHours: 6 });
  expect(s.players.p1!.resources.metal).toBe(940);
});

it('retains the old production deadline and half-price refund for an unpinned unit order', () => {
  let s = legacy(act(world(), old, 'unit.build', { planetId: 'P', unit: 'frigate' }));
  expect(running(s).at).toBe(3 * H);
  s = advance(s, current, 1.5);
  s = cancel(s, current);
  expect(s.planets.P!.pausedConstruction![0]).toMatchObject({ progress: 0.5, remainingHours: 1.5 });
  expect(s.players.p1!.resources.metal).toBe(955);
});

it('pins new production time even if match pricing subsequently changes', () => {
  let s = act(currentWorld(), current, 'unit.build', { planetId: 'P', unit: 'frigate' });
  expect(running(s)).toMatchObject({ at: 6 * H, payload: { durationHours: 6 } });
  s.pricing = { ...s.pricing, unitHours: 4 };
  s = advance(s, current, 3);
  s = cancel(s, current);
  expect(s.planets.P!.pausedConstruction![0]).toMatchObject({ progress: 0.5, remainingHours: 3 });
  expect(s.players.p1!.resources.metal).toBe(955);
});

it('authors duration pins itself rather than accepting a client-supplied duration', () => {
  const s = act(currentWorld(), current, 'unit.build', { planetId: 'P', unit: 'frigate', durationHours: 999 });
  expect(running(s)).toMatchObject({ at: 6 * H, payload: { durationHours: 6 } });
});

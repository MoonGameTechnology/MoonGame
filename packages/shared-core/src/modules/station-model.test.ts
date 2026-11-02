import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import type { GameModule } from '../kernel/module';
import { createInitialState, type GameState, type Planet } from '../state/gameState';
import { parseGameData } from '../data/schemas';
import { effectiveStats, effectiveStat } from '../util/loadout';
import { applyDamageToSide, hookedDamage, removeIfWiped } from '../util/combat';
import { fortressFleetId, fortressRepairQuote, stationSiteId, buildingRepairQuote, serviceSitesForFleet, indexServiceSites } from '../state/fortress';
import { divertFortressDamage } from '../util/fortressDamage';
import { visibleState } from '../state/visibility';
import { forkSiteId, forkSiteEdge } from '../state/forkSite';
import { ownedProvinceCount } from './sprawl';
import { instantRepairModule } from './instantRepair';
import { previewSides } from '../state/previewBattle';
import { movementModule } from './movement';
import { promotionModule } from './promotion';
import { autoMergeModule } from './autoMerge';
import { shuttleModule } from './shuttle';
import { forkTAtStart } from '../state/roads';
import { stationModule } from './station';
import { constructionModule, type BuildingDamage, type ConstructionDelay } from './construction';
import type { Action, ApplyResult, AdvanceResult } from '../action/types';

const H = 3_600_000;
const data = parseGameData({
  version: 'fortress-test', resources: ['metal'], factions: {}, events: {},
  units: { fortress_guns: { faction: 'neutral', traits: ['immobile', 'issued'],
    slots: { weapon: 2, defense: 2, utility: 1 }, stats: { hp: 100, attack: 20, defense: 20, speed: 0 } },
    scout: { faction: 'x', domain: 'space', cost: { metal: 10 }, buildTimeHours: 1,
      stats: { hp: 100, attack: 1, defense: 1, speed: 10 } },
    carrier: { faction: 'x', domain: 'space', stats: { hp: 100, attack: 1, defense: 1, speed: 10, cargoCapacity: 4 } },
    interceptor: { faction: 'x', traits: ['shuttle'], stats: { hp: 10, attack: 2, defense: 2, speed: 100 } },
    marine: { faction: 'x', domain: 'ground', stats: { hp: 100, attack: 1, defense: 1, speed: 1 } } },
  buildings: {
    starfort: { name: 'Core', hp: 100, defenseBonus: 0, buildTimeHours: 6, onlyOn: [], buildSlots: 4,
      upgrades: [{ cost: { metal: 120 }, hp: 200, buildTimeHours: 6, defenseBonus: 0, buildSlots: 5 }] },
    station_radar: { name: 'Station Radar', hp: 100, cost: { metal: 100 }, buildTimeHours: 10, defenseBonus: 0 },
    station_yard: { name: 'Station Yard', hp: 100, enablesShipConstruction: true, shipRepair: 0.1 },
    station_hangar: { name: 'Station Hangar', hp: 100, shuttleBay: 6 },
    station_medbay: { name: 'Station Medbay', hp: 100, healRate: 0.1 },
    mine: { name: 'Mine', hp: 100, cost: { metal: 100 }, buildTimeHours: 10, defenseBonus: 0,
      upgrades: [{ cost: { metal: 100 }, hp: 200, buildTimeHours: 1, defenseBonus: 0 }] },
  },
  modules: {
    cannon: { name: 'Cannon', tag: 'horizontal', slot: 'weapon', cost: { metal: 20 }, effects: { stats: { attack: 4 } } },
    engine: { name: 'Engine', tag: 'vertical', slot: 'utility', effects: { stats: { speed: 100 } } },
    void_shield_i: { name: 'Shield', tag: 'horizontal', slot: 'defense', effects: { stats: { shield: 50 } } },
  },
  sectorKinds: {
    asteroid: { capturable: true, buildable: true, orbit: false, allowedBuildings: ['mine'] },
    planet: { capturable: true, buildable: true, orbit: true, stationable: false },
    station_site: { capturable: false, traversable: false, buildable: true, orbit: false,
      allowedBuildings: ['station_radar'], stationable: false, scoreValue: 0 },
  },
});
const ctx = (now = 0) => ({ now, data });
function action(type: string, payload: object, playerId = 'p1'): Action {
  return { id: 'test-order', playerId, type, payload, issuedAt: 0 };
}
function ok<T extends ApplyResult | AdvanceResult>(r: T): T & { ok: true } {
  if (!r.ok) throw new Error(r.code);
  return r as T & { ok: true };
}
function world(): GameState {
  const base = createInitialState({ seed: 'fortress', version: { data: data.version, manifest: '1' } });
  const node: Planet = { id: 'A', owner: 'p1', kind: 'asteroid', position: { x: 0, y: 0 },
    links: [], resources: { metal: 7 }, buildings: [{ type: 'mine', level: 1, hp: 100 }], garrison: [], traits: [] };
  return { ...base, players: { p1: { id: 'p1', name: 'p1', faction: 'x', status: 'active', resources: { metal: 1000 } } },
    planets: { A: node }, fleets: {} };
}
function forkWorld(): GameState {
  const state = world();
  const a = state.planets.A!;
  a.links = ['B', 'C'];
  a.roads = { crossings: { B: { x: 50, y: -10 }, C: { x: 50, y: 10 } },
    trails: [{ exits: ['B', 'C'], fork: { x: 20, y: 0 } }] };
  for (const [id, y] of [['B', -20], ['C', 20]] as const) state.planets[id] = { ...structuredClone(a), id,
    position: { x: 100, y }, links: ['A'], roads: { crossings: { A: a.roads.crossings[id]! }, trails: [{ exits: ['A'], fork: null }] } };
  return state;
}
const hit: GameModule = { id: 'test-hit', version: '1', setup(api) {
  api.onAction('test.delay', (_a, h) => {
    h.capability<ConstructionDelay>('construction.delay')!(h, siteId, 12);
  });
  api.onAction('test.sabotage', (_a, h) => {
    h.capability<BuildingDamage>('building.damage')!(h, siteId, [
      { index: 0, amount: 1000 }, { index: 1, amount: 1000 },
    ]);
  });
  api.onAction('test.hit', (a, h) => {
    const p = a.payload as { fleetId: string; amount: number };
    applyDamageToSide(h, { kind: 'fleet', fleetId: p.fleetId }, hookedDamage(h, p.amount, {
      phase: 'orbital', location: 'A', attacker: 'p2', defender: 'p1', defenderFleet: p.fleetId,
    }), data, 'A');
    removeIfWiped(h, p.fleetId);
  });
} };
const kernel = createKernel([constructionModule, stationModule, hit]);
const siteId = stationSiteId('A');
const bodyId = fortressFleetId(siteId);
function deployed(): GameState {
  return ok(kernel.applyAction(world(), action('station.deploy', { planetId: 'A' }), ctx())).state;
}
function built(): GameState { return ok(kernel.advanceTo(deployed(), ctx(6 * H))).state; }

describe('separate fortress model', () => {
  it('keeps the province and its buildings unchanged and assembles a targetable body gradually', () => {
    const before = world();
    const state = ok(kernel.applyAction(before, action('station.deploy', { planetId: 'A', modules: ['cannon'] }), ctx())).state;
    expect(state.planets.A).toEqual(before.planets.A);
    expect(state.planets[siteId]?.stationHost).toBe('A');
    expect(state.players.p1?.resources.metal).toBe(860);
    const quarter = ok(kernel.advanceTo(state, ctx(1.5 * H))).state;
    const stack = quarter.fleets[bodyId]!.units[0]!;
    expect(stack.count).toBe(1);
    expect(effectiveStats(data.units.fortress_guns!, stack, data)).toMatchObject({ hp: 25, attack: 6 });
    expect(effectiveStat(data.units.fortress_guns!, stack, data, 'hp')).toBe(25);
    expect(quarter.planets[siteId]?.fortress?.assembly).toBeDefined();
    expect(ok(kernel.advanceTo(quarter, ctx(6 * H))).state.planets[siteId]?.fortress?.assembly).toBeUndefined();
  });

  it('preserves absolute wounds while construction adds hull capacity', () => {
    const quarter = ok(kernel.advanceTo(deployed(), ctx(1.5 * H))).state;
    const damaged = ok(kernel.applyAction(quarter, action('test.hit', { fleetId: bodyId, amount: 10 }), ctx(1.5 * H))).state;
    expect(damaged.fleets[bodyId]?.units[0]?.hp).toBe(15);
    const half = ok(kernel.advanceTo(damaged, ctx(3 * H))).state;
    expect(half.fleets[bodyId]?.units[0]?.hp).toBe(40);
    const complete = ok(kernel.advanceTo(half, ctx(6 * H))).state;
    expect(complete.fleets[bodyId]?.units[0]?.hp).toBe(90);
  });

  it('requires a paid repair order; new damage is not included in the old repair budget', () => {
    let state = built();
    state.fleets[bodyId]!.units[0]!.hp = 50;
    const quote = fortressRepairQuote(state, state.planets[siteId]!, data);
    expect(quote).toMatchObject({ missingHp: 50, cost: { metal: 60 }, hours: 3 });
    expect(ok(kernel.advanceTo(state, ctx(7 * H))).state.fleets[bodyId]?.units[0]?.hp).toBe(50);
    state = ok(kernel.applyAction(state, action('station.repair', { planetId: siteId }), ctx(6 * H))).state;
    state = ok(kernel.advanceTo(state, ctx(7.5 * H))).state;
    expect(state.fleets[bodyId]?.units[0]?.hp).toBe(75);
    state = ok(kernel.applyAction(state, action('test.hit', { fleetId: bodyId, amount: 10 }), ctx(7.5 * H))).state;
    state = ok(kernel.advanceTo(state, ctx(9 * H))).state;
    expect(state.fleets[bodyId]?.units[0]?.hp).toBe(90);
    expect(state.planets[siteId]?.fortress?.repair).toBeUndefined();
  });

  it('repairs planetary buildings manually and preserves wounds through an upgrade', () => {
    let state = world();
    state.planets.A!.buildings[0]!.hp = 25;
    state = ok(kernel.applyAction(state, action('building.upgrade', { planetId: 'A', building: 'mine' }), ctx())).state;
    state = ok(kernel.advanceTo(state, ctx(H))).state;
    expect(state.planets.A!.buildings[0]!.hp).toBe(125); // 75 missing HP stay missing
    const ordered = ok(kernel.applyAction(state, action('building.repair', { planetId: 'A', building: 'mine' }), ctx(H)));
    expect(ordered.state.planets.A!.buildings[0]!.repair?.remainingHp).toBe(75);
    const doneAt = ordered.state.planets.A!.buildings[0]!.repair!.doneAt;
    const healed = ok(kernel.advanceTo(ordered.state, ctx(doneAt))).state;
    expect(healed.planets.A!.buildings[0]!.hp).toBe(200);
    expect(healed.planets.A!.buildings[0]!.repair).toBeUndefined();
  });

  it('absorbs shields first and splits remaining damage once between hull and one internal system', () => {
    let state = built();
    const site = state.planets[siteId]!;
    site.buildings.push({ type: 'station_radar', level: 1, hp: 100 });
    state.fleets[bodyId]!.units[0]!.modules = ['void_shield_i'];
    state = ok(kernel.applyAction(state, action('test.hit', { fleetId: bodyId, amount: 150 }), ctx(6 * H))).state;
    expect(state.fleets[bodyId]?.units[0]?.hp).toBe(20);
    expect(state.planets[siteId]?.buildings.find((b) => b.type === 'station_radar')?.hp).toBe(80);
  });

  it('returns internal-system overkill to the hull and never uses the core as a second HP pool', () => {
    const state = built();
    const site = state.planets[siteId]!;
    site.buildings.push({ type: 'station_radar', level: 1, hp: 3 });
    const units = state.fleets[bodyId]!.units;
    const hit = divertFortressDamage(site, units, 50, data);
    expect(hit).toMatchObject({ internalDamage: 3, hullInput: 47 });
    expect(site.buildings.map((b) => b.type)).toEqual(['starfort']);
    expect(divertFortressDamage(site, units, 50, data)).toMatchObject({ internalDamage: 0, hullInput: 50 });
    expect(site.buildings[0]?.hp).toBe(100);
  });

  it('routes the same shield and internal-system damage in the forecast and live damage path without mutating the forecast inputs', () => {
    const state = built();
    const site = state.planets[siteId]!;
    site.buildings.push({ type: 'station_radar', level: 1, hp: 100 });
    const before = JSON.stringify(state);
    const prediction = previewSides([
      { owner: 'p2', role: 'attacker', units: [{ unit: 'scout', count: 10, hp: 1 }] },
      { owner: 'p1', role: 'defender', units: state.fleets[bodyId]!.units, fortress: site },
    ], data, (a, b) => a !== b);
    expect(prediction.roundsEst).toBe(1);
    const live = ok(kernel.applyAction(state, action('test.hit', { fleetId: bodyId, amount: 10 }), ctx(6 * H))).state;
    expect(prediction.sides[1]?.survivors[0]?.hp).toBe(live.fleets[bodyId]?.units[0]?.hp);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('rejects a second fortress, issued modules, enemy repairs and instant repair bypasses atomically', () => {
    const state = built();
    const before = JSON.stringify(state);
    expect(kernel.applyAction(state, action('station.deploy', { planetId: 'A' }), ctx(6 * H)))
      .toMatchObject({ ok: false, code: 'E_NOT_STATIONABLE' });
    expect(kernel.applyAction(world(), action('station.deploy', { planetId: 'A', modules: ['void_shield_i'] }), ctx()))
      .toMatchObject({ ok: false, code: 'E_STATION_MODULE' });
    expect(kernel.applyAction(state, action('station.repair', { planetId: siteId }, 'p2'), ctx(6 * H)))
      .toMatchObject({ ok: false, code: 'E_NO_STATION' });
    state.fleets[bodyId]!.units[0]!.hp = 50;
    const withInstant = createKernel([constructionModule, stationModule, instantRepairModule]);
    expect(withInstant.applyAction(state, action('fleet.instantRepair', { fleetId: bodyId }), ctx(6 * H)))
      .toMatchObject({ ok: false, code: 'E_USE_STATION_REPAIR' });
    delete state.fleets[bodyId]!.units[0]!.hp;
    expect(JSON.stringify(state)).toBe(before);
  });

  it.each([2, 24])('uses match speed ×%i for progressive construction and survives a JSON restart', (speed) => {
    const context = (now: number) => ({ now, data, config: { timeScale: speed } });
    let state = ok(kernel.applyAction(world(), action('station.deploy', { planetId: 'A' }), context(0))).state;
    state = ok(kernel.advanceTo(state, context(3 * H / speed))).state;
    expect(state.fleets[bodyId]?.units[0]?.stationScale).toBeCloseTo(0.5);
    const restored = JSON.parse(JSON.stringify(state)) as GameState;
    expect(ok(kernel.advanceTo(restored, context(6 * H / speed))).state)
      .toEqual(ok(kernel.advanceTo(state, context(6 * H / speed))).state);
    expect(ownedProvinceCount(state, 'p1')).toBe(1);
  });

  it('enforces module ownership and stamps the same arsenal quality snapshot as ship construction', () => {
    const state = world();
    state.players.p1!.arsenal = { hulls: [], modules: [], stars: { cannon: 2 } };
    expect(kernel.applyAction(state, action('station.deploy', { planetId: 'A', modules: ['cannon'] }), ctx()))
      .toMatchObject({ ok: false, code: 'E_NOT_OWNED' });
    state.players.p1!.arsenal.modules.push('cannon');
    const deployed = ok(kernel.applyAction(state, action('station.deploy', { planetId: 'A', modules: ['cannon'] }), ctx())).state;
    expect(deployed.fleets[bodyId]?.units[0]?.moduleStars).toEqual({ cannon: 2 });
  });

  it('keeps the fortress immobile even when an installed module adds speed, while a regular ship still moves', () => {
    const k = createKernel([constructionModule, stationModule, movementModule]);
    const state = world();
    state.planets.A!.links = ['B'];
    state.planets.B = { ...structuredClone(state.planets.A!), id: 'B', links: ['A'], position: { x: 100, y: 0 } };
    const placed = ok(k.applyAction(state, action('station.deploy', { planetId: 'A', modules: ['engine'] }), ctx())).state;
    expect(effectiveStats(data.units.fortress_guns!, placed.fleets[bodyId]!.units[0]!, data).speed).toBe(0);
    expect(effectiveStat(data.units.fortress_guns!, placed.fleets[bodyId]!.units[0]!, data, 'speed')).toBe(0);
    expect(k.applyAction(placed, action('fleet.move', { fleetId: bodyId, to: 'B' }), ctx()))
      .toMatchObject({ ok: false, code: 'E_FLEET_IMMOBILE' });
    placed.fleets.mobile = { id: 'mobile', owner: 'p1', location: 'A', movement: null,
      units: [{ unit: 'scout', count: 1, modules: ['engine'] }], traits: [] };
    expect(k.applyAction(placed, action('fleet.move', { fleetId: 'mobile', to: 'B' }), ctx()).ok).toBe(true);
  });

  it('pauses readiness and paid repairs during battle, then resumes without healing later wounds for free', () => {
    let state = ok(kernel.advanceTo(deployed(), ctx(3 * H))).state;
    state.battles.b = { id: 'b', location: 'A', phase: 'orbital', round: 0, sides: [] };
    state = ok(kernel.advanceTo(state, ctx(8 * H))).state;
    expect(state.fleets[bodyId]?.units[0]?.stationScale).toBeCloseTo(0.5);
    expect(state.planets[siteId]?.fortress?.assembly?.doneAt).toBe(11 * H);
    delete state.battles.b;
    state = ok(kernel.advanceTo(state, ctx(11 * H))).state;
    state.fleets[bodyId]!.units[0]!.hp = 50;
    state = ok(kernel.applyAction(state, action('station.repair', { planetId: siteId }), ctx(11 * H))).state;
    state.battles.b = { id: 'b', location: 'A', phase: 'orbital', round: 0, sides: [] };
    state = ok(kernel.advanceTo(state, ctx(15 * H))).state;
    expect(state.fleets[bodyId]?.units[0]?.hp).toBe(50);
    delete state.battles.b;
    state = ok(kernel.advanceTo(state, ctx(18 * H))).state;
    expect(state.fleets[bodyId]?.units[0]?.hp).toBeUndefined();
    expect(state.planets[siteId]?.fortress?.repair).toBeUndefined();
  });

  it('preserves upgrade progress, wounds and the remaining paid duration across cancel/resume', () => {
    let state = built();
    state.fleets[bodyId]!.units[0]!.hp = 70;
    state = ok(kernel.applyAction(state, action('building.upgrade', { planetId: siteId, building: 'starfort' }), ctx(6 * H))).state;
    state = ok(kernel.advanceTo(state, ctx(9 * H))).state;
    expect(state.fleets[bodyId]?.units[0]).toMatchObject({ stationScale: 1.5, hp: 120 });
    const event = state.scheduled.find((e) => e.type === 'construction.complete')!;
    state = ok(kernel.applyAction(state, action('construction.cancel', { planetId: siteId, seq: event.seq }), ctx(9 * H))).state;
    state = ok(kernel.advanceTo(state, ctx(12 * H))).state;
    expect(state.fleets[bodyId]?.units[0]).toMatchObject({ stationScale: 1.5, hp: 120 });
    const paused = state.planets[siteId]!.pausedConstruction![0]!;
    state = ok(kernel.applyAction(state, action('construction.resume', { planetId: siteId, id: paused.id }), ctx(12 * H))).state;
    state = ok(kernel.advanceTo(state, ctx(15 * H))).state;
    expect(state.fleets[bodyId]?.units[0]).toMatchObject({ stationScale: 2, hp: 170 });
    expect(state.planets[siteId]?.fortress?.assembly).toBeUndefined();
  });

  it('makes deeper damage cost more resources and time, including the installed loadout', () => {
    const a = { type: 'mine', level: 1, hp: 75 };
    const b = { ...a, hp: 25 };
    expect(buildingRepairQuote(b, data).hours).toBeGreaterThan(buildingRepairQuote(a, data).hours);
    expect(buildingRepairQuote(b, data).cost.metal).toBeGreaterThan(buildingRepairQuote(a, data).cost.metal!);
    const state = built();
    state.planets[siteId]!.fortress!.modules = ['cannon'];
    state.fleets[bodyId]!.units[0]!.hp = 50;
    expect(fortressRepairQuote(state, state.planets[siteId]!, data).cost.metal).toBe(70);
  });

  it.each([1, 24])('keeps readiness, refunds and the remaining delayed work consistent at speed ×%i', (speed) => {
    const context = (now: number) => ({ ...ctx(now), config: { timeScale: speed } });
    const at = (hours: number) => 6 * H + hours * H / speed;
    let state = built();
    state.fleets[bodyId]!.units[0]!.hp = 70;
    state = ok(kernel.applyAction(state, action('building.upgrade', { planetId: siteId, building: 'starfort' }), context(at(0)))).state;
    state = ok(kernel.advanceTo(state, context(at(3)))).state;
    state = ok(kernel.applyAction(state, action('test.delay', {}), context(at(3)))).state;
    expect(state.fleets[bodyId]?.units[0]).toMatchObject({ stationScale: 1.5, hp: 120 });
    expect(state.planets[siteId]?.fortress?.assembly?.doneAt).toBe(at(18));
    state = ok(kernel.advanceTo(state, context(at(6)))).state;
    expect(state.fleets[bodyId]?.units[0]?.stationScale).toBeCloseTo(1.6);
    expect(state.fleets[bodyId]?.units[0]?.hp).toBeCloseTo(130);
    expect(state.planets[siteId]?.buildings[0]?.level).toBe(1);
    const order = state.scheduled.find((e) => e.type === 'construction.complete')!;
    const treasury = state.players.p1!.resources.metal!;
    state = ok(kernel.applyAction(state, action('construction.cancel', { planetId: siteId, seq: order.seq }), context(at(6)))).state;
    const paused = state.planets[siteId]!.pausedConstruction![0]!;
    expect(paused.progress).toBeCloseTo(0.6);
    expect(paused.remainingHours).toBeCloseTo(12);
    expect(state.players.p1!.resources.metal! - treasury).toBeCloseTo(48);
    state = ok(kernel.advanceTo(state, context(at(9)))).state;
    expect(state.fleets[bodyId]?.units[0]?.stationScale).toBeCloseTo(1.6);
    state = ok(kernel.applyAction(state, action('construction.resume', { planetId: siteId, id: paused.id }), context(at(9)))).state;
    state = ok(kernel.advanceTo(state, context(at(15)))).state;
    expect(state.fleets[bodyId]?.units[0]?.stationScale).toBeCloseTo(1.8);
    state = ok(kernel.advanceTo(state, context(at(21)))).state;
    expect(state.fleets[bodyId]?.units[0]).toMatchObject({ stationScale: 2, hp: 170 });
    expect(state.planets[siteId]?.buildings[0]?.level).toBe(2);
  });

  it('destroys only fortress infrastructure and never resurrects it from a later building event', () => {
    let state = built();
    const province = structuredClone(state.planets.A);
    state = ok(kernel.applyAction(state, action('test.hit', { fleetId: bodyId, amount: 500 }), ctx(6 * H))).state;
    expect(state.fleets[bodyId]).toBeUndefined();
    expect(state.planets[siteId]).toMatchObject({ owner: null, buildings: [] });
    expect(state.planets.A).toEqual(province);
    state = ok(kernel.advanceTo(state, ctx(50 * H))).state;
    expect(state.fleets[bodyId]).toBeUndefined();
  });

  it('protects the virtual level controller from targeted sabotage and still releases a damaged legacy-shaped model on hull death', () => {
    const state = built();
    state.planets[siteId]!.buildings.push({ type: 'station_radar', level: 1, hp: 100 });
    const attacked = ok(kernel.applyAction(state, action('test.sabotage', {}), ctx(6 * H))).state;
    expect(attacked.planets[siteId]?.buildings).toEqual([{ type: 'starfort', level: 1, hp: 100 }]);
    expect(attacked.fleets[bodyId]).toBeDefined();
    // Cleanup is also robust to a damaged/imported snapshot without its controller.
    attacked.planets[siteId]!.buildings = [];
    const destroyed = ok(kernel.applyAction(attacked, action('test.hit', { fleetId: bodyId, amount: 500 }), ctx(6 * H))).state;
    expect(destroyed.planets[siteId]?.owner).toBeNull();
    expect(destroyed.planets[siteId]?.fortress).toBeUndefined();
    expect(destroyed.planets.A?.kind).toBe('asteroid');
  });

  it('ships and dock services at a fork use its real road berth, never the bookkeeping node', () => {
    let state = forkWorld();
    state = ok(kernel.applyAction(state, action('station.deploy', { planetId: 'A', trail: 0 }), ctx())).state;
    state = ok(kernel.advanceTo(state, ctx(6 * H))).state;
    const site = state.planets[forkSiteId('A', 0)]!;
    site.buildings.push({ type: 'station_yard', level: 1, hp: 100 });
    state = ok(kernel.applyAction(state, action('unit.build', { planetId: site.id, unit: 'scout' }), ctx(6 * H))).state;
    state = ok(kernel.advanceTo(state, ctx(7 * H))).state;
    const ship = Object.values(state.fleets).find((f) => f.units[0]?.unit === 'scout')!;
    expect(ship.location).toBeNull();
    expect(ship.edge).toEqual(forkSiteEdge(state, { province: 'A', trail: 0 }));
    expect(serviceSitesForFleet(state, ship).map((p) => p.id)).toContain(site.id);
    const index = indexServiceSites(state);
    expect(serviceSitesForFleet(state, ship, undefined, index)).toEqual(serviceSitesForFleet(state, ship));
    const edge = ship.edge!;
    ship.edge = { from: edge.to, to: edge.from, t: 1 - edge.t };
    expect(serviceSitesForFleet(state, ship, undefined, index).map((p) => p.id)).toContain(site.id);
    ship.units[0]!.hp = 50;
    state = ok(kernel.advanceTo(state, ctx(8 * H))).state;
    expect(state.fleets[ship.id]?.units[0]?.hp).toBe(60);
  });

  const carrierKernel = createKernel([constructionModule, stationModule, shuttleModule]);
  function forkCarrier(exit: string, reverse: boolean): GameState {
    let state = ok(carrierKernel.applyAction(forkWorld(), action('station.deploy', { planetId: 'A', trail: 0 }), ctx())).state;
    state = ok(carrierKernel.advanceTo(state, ctx(6 * H))).state;
    const site = state.planets[forkSiteId('A', 0)]!;
    site.buildings.push({ type: 'station_yard', level: 1, hp: 100 },
      { type: 'station_medbay', level: 1, hp: 100 }, { type: 'station_hangar', level: 1, hp: 100 });
    site.hangar = [{ id: 'sq:port', units: [{ unit: 'interceptor', count: 1 }] }];
    const t = forkTAtStart(state, 'A', exit);
    state.fleets.cv = { id: 'cv', owner: 'p1', location: null, movement: null,
      edge: reverse ? { from: exit, to: 'A', t: 1 - t } : { from: 'A', to: exit, t },
      units: [{ unit: 'carrier', count: 1, hp: 50 }], landing: [{ unit: 'marine', count: 1, hp: 50 }], traits: [] };
    return state;
  }

  it.each([['B', false], ['B', true], ['C', false], ['C', true]] as const)('services and squadron transfers share fork identity via exit %s (reversed: %s)', (exit, reverse) => {
      let state = forkCarrier(exit, reverse);
      const pid = forkSiteId('A', 0);
      const index = indexServiceSites(state);
      expect(serviceSitesForFleet(state, state.fleets.cv!, undefined, index).map((p) => p.id)).toContain(pid);
      state = ok(carrierKernel.applyAction(state, action('shuttle.load', { fleetId: 'cv', squadronId: 'sq:port', planetId: pid }), ctx(6 * H))).state;
      expect(state.fleets.cv?.hangar?.[0]?.id).toBe('sq:port');
      state = ok(carrierKernel.applyAction(state, action('shuttle.unload', { fleetId: 'cv', squadronId: 'sq:port', planetId: pid }), ctx(6 * H))).state;
      expect(state.planets[pid]?.hangar?.[0]?.id).toBe('sq:port');
      state = ok(carrierKernel.advanceTo(state, ctx(7 * H))).state;
      expect(state.fleets.cv?.units[0]?.hp).toBe(60);
      expect(state.fleets.cv?.landing?.[0]?.hp).toBe(60);
    });

  it.each(['movement', 'battle', 'landing'])('keeps squadron transfer blocked during %s at a fork', (busy) => {
    const state = forkCarrier('C', false);
    if (busy === 'movement') state.fleets.cv!.movement = { from: 'A', to: 'C', departedAt: 6 * H, arrivesAt: 7 * H };
    if (busy === 'battle') state.fleets.cv!.battleId = 'battle';
    if (busy === 'landing') state.fleets.cv!.assaultLanding = { planetId: 'A', startAt: 6 * H, doneAt: 7 * H };
    const before = JSON.stringify(state);
    expect(carrierKernel.applyAction(state, action('shuttle.load', { fleetId: 'cv', squadronId: 'sq:port', planetId: forkSiteId('A', 0) }), ctx(6 * H)))
      .toMatchObject({ ok: false, code: 'E_FLEET_BUSY' });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('does not transfer squadrons from a remote fork or an enemy fleet', () => {
    const state = forkCarrier('C', false);
    const order = action('shuttle.load', { fleetId: 'cv', squadronId: 'sq:port', planetId: forkSiteId('A', 0) });
    expect(carrierKernel.applyAction(state, { ...order, playerId: 'p2' }, ctx(6 * H)))
      .toMatchObject({ ok: false, code: 'E_NO_FLEET' });
    state.fleets.cv!.edge!.t += 0.01;
    expect(carrierKernel.applyAction(state, order, ctx(6 * H))).toMatchObject({ ok: false, code: 'E_NO_PLANET' });
  });

  it('pauses repairs and dock services when a battle occupies another exit of the same fork', () => {
    const state = forkCarrier('C', false);
    const pid = forkSiteId('A', 0);
    state.fleets.enemy = { ...structuredClone(state.fleets.cv!), id: 'enemy', owner: 'p2', battleId: 'fight' };
    state.battles.fight = { id: 'fight', location: 'A', phase: 'orbital', round: 0,
      sides: [{ owner: 'p2', role: 'attacker', ref: { kind: 'fleet', fleetId: 'enemy' } }] };
    state.fleets[fortressFleetId(pid)]!.units[0]!.hp = 50;
    expect(carrierKernel.applyAction(state, action('station.repair', { planetId: pid }), ctx(6 * H)))
      .toMatchObject({ ok: false, code: 'E_IN_BATTLE' });
    const paused = ok(carrierKernel.advanceTo(state, ctx(7 * H))).state;
    expect(paused.fleets.cv?.units[0]?.hp).toBe(50);
    expect(paused.fleets.cv?.landing?.[0]?.hp).toBe(50);
  });

  it('promotes a fortress-built ship before arrival can merge it into an existing fleet', () => {
    const k = createKernel([constructionModule, stationModule, promotionModule, autoMergeModule]);
    const promoted = { ...data, promotion: { chance: 1, damageBonus: 0.1 } };
    const context = (now: number) => ({ now, data: promoted });
    let state = ok(k.applyAction(world(), action('station.deploy', { planetId: 'A' }), context(0))).state;
    state = ok(k.advanceTo(state, context(6 * H))).state;
    state.planets[siteId]!.buildings.push({ type: 'station_yard', level: 1, hp: 100 });
    state.fleets.old = { id: 'old', owner: 'p1', location: 'A', movement: null,
      units: [{ unit: 'scout', count: 1 }], traits: [] };
    state = ok(k.applyAction(state, action('unit.build', { planetId: siteId, unit: 'scout' }), context(6 * H))).state;
    state = ok(k.advanceTo(state, context(7 * H))).state;
    const ships = Object.values(state.fleets).flatMap((f) => f.units).filter((s) => s.unit === 'scout');
    expect(ships.reduce((n, s) => n + s.count, 0)).toBe(2);
    expect(ships.reduce((n, s) => n + s.count * (s.promoted ?? 0), 0)).toBe(1);
    expect(state.fleets.old?.units[0]).toMatchObject({ count: 2, promoted: 0.5 });
    expect(state.fleets[bodyId]?.units[0]?.count).toBe(1);
  });

  it('does not reveal a newly built remote fortress or private repair work through fog', () => {
    const state = built();
    state.players.p2 = { ...state.players.p1!, id: 'p2', name: 'p2' };
    state.planets[siteId]!.fortress!.repair = { owner: 'p1', remainingHp: 20, hpPerHour: 10, doneAt: 8 * H };
    expect(visibleState(state, 'p2', data).planets[siteId]).toBeUndefined();
    expect(visibleState(state, 'p1', data).planets[siteId]?.fortress?.repair).toBeDefined();
  });
});

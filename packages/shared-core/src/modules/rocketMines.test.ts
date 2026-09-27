import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { createInitialState, type GameState } from '../state/gameState';
import { parseGameData } from '../data/schemas';
import { deepFreeze } from '../util/clone';
import { rocketMinesModule } from './rocketMines';
import { movementModule } from './movement';
import { visibleState } from '../state/visibility';
import { setStance } from '../state/diplomacy';
import { radarSignatures, isVisibleTo } from '../state/visibility';
import { rocketMinelayer } from '../state/ordnance';
import { shuttleModule } from './shuttle';

const HOUR = 3_600_000;
const data = parseGameData({
  version: '1',
  resources: ['metal'],
  factions: {},
  buildings: {},
  events: {},
  units: {
    ship: { faction: 'x', stats: { hp: 100, attack: 1, defense: 1, speed: 100 }, signature: 1 },
    guard: {
      faction: 'x',
      stats: { hp: 100, attack: 1, defense: 1, speed: 100, pointDefense: 90 },
    },
  },
  modules: {
    mine: {
      name: 'Rocket Mine',
      slot: 'utility',
      tag: 'horizontal',
      rarity: 'legendary',
      rocketMine: {
        armHours: 0.25,
        cooldownHours: 1,
        scanHours: 1 / 60,
        maxActive: 6,
        radarRange: 120,
        radarLevel: 3,
        sightRange: 20,
        detectionRange: 20,
        speed: 240,
        minFlightHours: 1 / 60,
        hp: 12,
        damage: 80,
        blastRadius: 10,
        mineSignature: 0.1,
        missileSignature: 13,
        cost: { metal: 20 },
      },
    },
  },
});
const kernel = createKernel([movementModule, rocketMinesModule]);
function world(): GameState {
  const s = createInitialState({ seed: 'rocket', version: { data: '1', manifest: '1' } });
  s.sight = { world: 0, fleet: 10, radarScale: 1 };
  for (const id of ['p', 'q', 'ally'])
    s.players[id] = {
      id,
      name: id,
      faction: 'x',
      status: 'active',
      resources: { metal: 200 },
    };
  for (const [id, x] of [
    ['A', 0],
    ['B', 400],
  ] as const)
    s.planets[id] = {
      id,
      owner: null,
      position: { x, y: 0 },
      resources: {},
      buildings: [],
      garrison: [],
      traits: [],
      links: [id === 'A' ? 'B' : 'A'],
    };
  s.fleets.layer = {
    id: 'layer',
    owner: 'p',
    location: null,
    movement: null,
    edge: { from: 'A', to: 'B', t: 0.5 },
    units: [{ unit: 'ship', count: 1, modules: ['mine'] }],
    traits: [],
  };
  s.fleets.target = {
    id: 'target',
    owner: 'q',
    location: null,
    movement: null,
    edge: { from: 'A', to: 'B', t: 0.7 },
    units: [{ unit: 'ship', count: 1 }],
    traits: [],
  };
  setStance(s, 'p', 'q', 'war');
  return s;
}
function act(s: GameState, type: string, payload: unknown, playerId = 'p') {
  return kernel.applyAction(
    s,
    { id: 's:p:1', playerId, type, payload, issuedAt: s.time },
    { now: s.time, data },
  );
}
function deploy(s = world(), mode: 'any' | 'confirmed' = 'any') {
  const r = act(deepFreeze(structuredClone(s)), 'fleet.deployRocketMine', {
    fleetId: 'layer',
    mode,
  });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function advance(s: GameState, now: number) {
  const r = kernel.advanceTo(s, { now, data });
  if (!r.ok) throw new Error(r.code);
  expect(r.failures).toEqual([]);
  expect(r.partial).toBeUndefined();
  return r.state;
}
function armed(s = world(), mode: 'any' | 'confirmed' = 'any') {
  return advance(deploy(s, mode), HOUR / 4);
}

describe('legendary rocket mine', () => {
  it('requires a fitted module and a parked real road, charges once, and takes time', () => {
    const s = world();
    const start = deploy(s);
    expect(s.ordnance).toBeUndefined();
    expect(start.players.p!.resources.metal).toBe(180);
    expect(start.ordnance!.mines).toHaveLength(0);
    expect(start.ordnance!.installations).toHaveLength(1);
    expect(advance(start, HOUR / 4 - 1).ordnance!.missiles).toHaveLength(0);
    s.fleets.layer!.units[0]!.modules = [];
    expect(act(s, 'fleet.deployRocketMine', { fleetId: 'layer', mode: 'any' })).toMatchObject({
      ok: false,
      code: 'E_NO_ROCKET_MINELAYER',
    });
    s.fleets.layer!.units[0]!.modules = ['mine'];
    s.fleets.layer!.edge = null;
    s.fleets.layer!.location = 'A';
    expect(act(s, 'fleet.deployRocketMine', { fleetId: 'layer', mode: 'any' })).toMatchObject({
      ok: false,
      code: 'E_MINE_ROAD_REQUIRED',
    });
  });
  it('rejects forged ownership and invalid modes without exposing foreign mines', () => {
    for (const fleetId of ['target', 'missing', '__proto__']) {
      expect(act(world(), 'fleet.deployRocketMine', { fleetId, mode: 'any' })).toMatchObject({
        ok: false,
        code: 'E_NO_FLEET',
      });
    }
    expect(
      act(world(), 'fleet.deployRocketMine', { fleetId: 'layer', mode: 'omniscient' }),
    ).toMatchObject({ ok: false, code: 'E_BAD_PAYLOAD' });
    for (const mineId of ['missing', '__proto__'])
      expect(act(world(), 'rocketMine.mode', { mineId, mode: 'any' })).toMatchObject({
        ok: false,
        code: 'E_NO_ROCKET_MINE',
      });
  });
  it('cancels unfinished installation when the carrier moves away', () => {
    const start = deploy();
    const moved = act(start, 'fleet.move', { fleetId: 'layer', to: 'A' });
    if (!moved.ok) throw new Error(moved.code);
    const end = advance(moved.state, HOUR / 4);
    expect(end.ordnance!.installations).toHaveLength(0);
    expect(end.ordnance!.mines).toHaveLength(0);
    expect(end.ordnance!.missiles).toHaveLength(0);
  });
  it('launches on an anonymous signal only in any-signal mode', () => {
    const any = armed();
    expect(any.ordnance!.mines).toHaveLength(0);
    expect(any.ordnance!.missiles).toHaveLength(1);
    expect(any.ordnance!.missiles[0]).not.toHaveProperty('targetId');
    const confirmed = armed(world(), 'confirmed');
    expect(confirmed.ordnance!.mines).toHaveLength(1);
    expect(confirmed.ordnance!.missiles).toHaveLength(0);
  });
  it('accepts own direct sight and current shared illumination, never stale memory', () => {
    const near = world();
    near.fleets.target!.edge!.t = 0.54;
    expect(armed(near, 'confirmed').ordnance!.missiles).toHaveLength(1);
    const shared = world();
    shared.fleets.spotter = {
      ...structuredClone(shared.fleets.target!),
      id: 'spotter',
      owner: 'ally',
    };
    setStance(shared, 'p', 'ally', 'alliance');
    expect(armed(shared, 'confirmed').ordnance!.missiles).toHaveLength(1);
    delete shared.fleets.spotter;
    shared.fog = { p: { B: { at: 0, owner: 'q', buildings: [], garrison: [] } } };
    expect(armed(shared, 'confirmed').ordnance!.missiles).toHaveLength(0);
  });
  it('does not borrow an ally radar range or trigger outside the mine radar', () => {
    const s = world();
    s.fleets.target!.edge!.t = 0.95;
    s.fleets.spotter = { ...structuredClone(s.fleets.target!), id: 'spotter', owner: 'ally' };
    setStance(s, 'p', 'ally', 'alliance');
    expect(armed(s, 'confirmed').ordnance!.missiles).toHaveLength(0);
  });
  it('hits at the scheduled time through shields and can be dodged', () => {
    const launch = armed();
    const m = launch.ordnance!.missiles[0]!;
    expect(advance(launch, m.arrivesAt - 1).fleets.target!.units[0]!.hp).toBeUndefined();
    const hit = advance(launch, m.arrivesAt);
    expect(hit.ordnance!.missiles).toHaveLength(0);
    expect(hit.fleets.target!.units[0]!.hp).toBe(20);
    launch.fleets.target!.edge!.t = 0.9;
    expect(advance(launch, m.arrivesAt).fleets.target!.units[0]!.hp).toBeUndefined();
  });
  it('allows point defense to destroy the missile before damage', () => {
    const s = world();
    s.fleets.target!.units = [{ unit: 'guard', count: 1 }];
    const launch = armed(s);
    const end = advance(launch, launch.ordnance!.missiles[0]!.arrivesAt);
    expect(end.fleets.target!.units[0]!.hp).toBeUndefined();
    expect(end.ordnance!.missiles).toHaveLength(0);
  });
  it('regular attack cannot intercept; a reloading anti-shuttle PD cannot fire either', () => {
    for (const unit of ['ship', 'guard']) {
      const s = world();
      s.fleets.target!.units = [{ unit, count: 1 }];
      s.fleets.target!.pdCooldownUntil = HOUR;
      const launch = armed(s);
      const end = advance(launch, launch.ordnance!.missiles[0]!.arrivesAt);
      expect(end.fleets.target!.units[0]!.hp).toBe(20);
    }
  });
  it('intercepts in flight with the very same cooldown consumed by shuttle fire', () => {
    const s = world();
    s.fleets.target!.units = [{ unit: 'guard', count: 1 }];
    const launch = armed(s);
    const missile = launch.ordnance!.missiles[0]!;
    const shot = advance(launch, launch.time + HOUR / 60);
    expect(shot.time).toBeLessThan(missile.arrivesAt);
    expect(shot.ordnance!.missiles).toHaveLength(0);
    expect(shot.fleets.target!.pdCooldownUntil).toBe(shot.time + HOUR / 3);
    shot.planets.A!.position.x = 280;
    shot.strikes = [
      {
        id: 'shuttle:p:1',
        owner: 'p',
        base: { kind: 'planet', id: 'A' },
        squadronId: 'sq',
        units: [{ unit: 'ship', count: 1 }],
        target: { kind: 'fleet', id: 'target' },
        to: { x: 280, y: 0 },
        departedAt: shot.time,
        arrivesAt: 2 * HOUR,
        leg: 'out',
      },
    ];
    const both = createKernel([shuttleModule, rocketMinesModule]);
    const r = both.advanceTo(shot, { now: shot.time + HOUR / 60, data });
    if (!r.ok) throw new Error(r.code);
    expect(r.events.filter((e) => e.type === 'pd.fired')).toEqual([]);
    expect(r.state.strikes![0]!.units[0]!.hp).toBeUndefined();
  });
  it('only the permissive mode spends a charge on a decoy and never damages allies', () => {
    const s = world();
    delete s.fleets.target;
    s.planets.C = {
      ...structuredClone(s.planets.B!),
      id: 'C',
      position: { x: 280, y: 0 },
      links: [],
    };
    s.heroes = {
      decoy: {
        id: 'decoy',
        owner: 'q',
        location: 'C',
        cooldowns: {},
        alive: true,
        activeDecoys: [{ at: 'C', until: HOUR, signature: 13 }],
      },
    };
    expect(armed(s, 'confirmed').ordnance!.missiles).toHaveLength(0);
    const launch = armed(s, 'any');
    expect(launch.ordnance!.missiles[0]!.to).toEqual({ x: 280, y: 0 });
    launch.fleets.friend = {
      ...structuredClone(s.fleets.layer!),
      id: 'friend',
      owner: 'ally',
      edge: { from: 'A', to: 'B', t: 0.7 },
    };
    setStance(launch, 'p', 'ally', 'alliance');
    expect(
      advance(launch, launch.ordnance!.missiles[0]!.arrivesAt).fleets.friend!.units[0]!.hp,
    ).toBeUndefined();
  });
  it('respects resources, a player-wide cooldown, and an active-charge limit', () => {
    const poor = world();
    poor.players.p!.resources.metal = 0;
    expect(act(poor, 'fleet.deployRocketMine', { fleetId: 'layer', mode: 'any' })).toMatchObject({
      code: 'E_INSUFFICIENT',
    });
    const s = deploy(world(), 'confirmed');
    s.fleets.second = { ...structuredClone(s.fleets.layer!), id: 'second' };
    expect(act(s, 'fleet.deployRocketMine', { fleetId: 'second', mode: 'any' })).toMatchObject({
      code: 'E_MINES_COOLDOWN',
    });
    s.ordnance!.cooldowns.p = 0;
    s.ordnance!.mines = Array.from({ length: 6 }, (_, n) => ({
      id: `m${n}`,
      owner: 'p',
      moduleId: 'mine',
      position: { x: n, y: 0 },
    }));
    expect(act(s, 'fleet.deployRocketMine', { fleetId: 'second', mode: 'any' })).toMatchObject({
      code: 'E_MINE_LIMIT',
    });
  });
  it('changing mode fires at most once and disarm invalidates pending timers', () => {
    const s = armed(world(), 'confirmed');
    const mineId = s.ordnance!.mines[0]!.id;
    expect(act(s, 'rocketMine.mode', { mineId, mode: 'any' }, 'q')).toMatchObject({
      code: 'E_NO_ROCKET_MINE',
    });
    const switched = act(s, 'rocketMine.mode', { mineId, mode: 'any' });
    if (!switched.ok) throw new Error(switched.code);
    expect(advance(switched.state, HOUR).fleets.target!.units[0]!.hp).toBe(20);
    const disarmed = act(s, 'rocketMine.disarm', { mineId });
    if (!disarmed.ok) throw new Error(disarmed.code);
    expect(advance(disarmed.state, HOUR).ordnance!.mines).toEqual([]);
    expect(disarmed.state.players.p!.resources.metal).toBe(180);
  });
  it('cannot finish installation without the module; stars scale the installed warhead', () => {
    const s = deploy();
    s.fleets.layer!.units[0]!.modules = [];
    expect(advance(s, HOUR / 4).ordnance!.mines).toEqual([]);
    expect(advance(s, HOUR / 4).ordnance!.missiles).toEqual([]);
    const starred = structuredClone(data);
    starred.sectorZeroStars.steps = [{ chance: 1, warrants: 1, bonus: 0.1, pity: 0 }];
    const carrier = world().fleets.layer!;
    carrier.units[0]!.moduleStars = { mine: 1 };
    expect(rocketMinelayer(carrier, starred)!.def.damage).toBe(88);
  });
  it('is identical after save/load and different advance partitions; never launches twice', () => {
    const start = deploy();
    const whole = advance(start, HOUR);
    const split = advance(JSON.parse(JSON.stringify(advance(start, HOUR / 4))), HOUR);
    expect(split).toEqual(whole);
    expect(whole.fleets.target!.units[0]!.hp).toBe(20);
  });
  it('hides stationary mines until close approach and strips private timers and controls', () => {
    const s = armed(world(), 'confirmed');
    expect(visibleState(s, 'q', data).ordnance).toBeUndefined();
    s.fleets.target!.edge!.t = 0.54;
    const near = visibleState(s, 'q', data);
    expect(near.ordnance!.mines).toHaveLength(1);
    expect(near.ordnance!.mines[0]).not.toHaveProperty('mode');
    expect(near.ordnance!.cooldowns).toEqual({});
    s.fleets.target!.edge!.t = 0.7;
    expect(visibleState(s, 'q', data).ordnance).toBeUndefined();
  });
  it('mine emissions are the smallest: only a nearby sensitive radar gets an anonymous S blip', () => {
    const s = armed(world(), 'confirmed');
    delete s.fleets.target;
    s.planets.sensor = {
      ...structuredClone(s.planets.A!),
      id: 'sensor',
      owner: 'q',
      position: { x: 210, y: 0 },
      links: [],
      buildings: [{ type: 'dish', level: 1, hp: 100 }],
    };
    const sensorData = parseGameData({
      ...data,
      buildings: { dish: { name: 'Dish', radarRange: 500, radarLevel: 3 } },
    });
    const mineOnly = structuredClone(s);
    delete mineOnly.fleets.layer;
    expect(radarSignatures(mineOnly, 'q', sensorData)).toEqual([
      { location: 'sensor', size: 'S', position: { x: 200, y: 0 } },
    ]);
    sensorData.buildings.dish!.radarLevel = 2;
    expect(radarSignatures(mineOnly, 'q', sensorData)).toEqual([]);
    sensorData.buildings.dish!.radarLevel = 3;
    mineOnly.planets.sensor!.position.x = 240;
    expect(radarSignatures(mineOnly, 'q', sensorData)).toEqual([]);
    expect(visibleState(mineOnly, 'q', sensorData).ordnance).toBeUndefined();
  });
  it('a mine provides real local sight, while incoming missile projections reveal no private identity', () => {
    const s = armed(world(), 'confirmed');
    s.fleets.target!.edge!.t = 0.54;
    expect(isVisibleTo(s, 'p', { fleetId: 'target' }, data)).toBe(true);
    expect(visibleState(s, 'p', data).fleets.target).toBeDefined();
    const launch = armed();
    const seen = visibleState(launch, 'q', data).ordnance!;
    expect(seen.missiles).toHaveLength(1);
    expect(seen.missiles[0]!.owner).toBe('');
    expect(seen.missiles[0]!.id).not.toContain('rocketMine:p:');
    expect(seen.missiles[0]).not.toHaveProperty('hp');
    expect(seen.missiles[0]).not.toHaveProperty('damage');
    expect(seen.cooldowns).toEqual({});
    expect(visibleState(launch, 'ally', data).ordnance).toBeUndefined();
  });
});

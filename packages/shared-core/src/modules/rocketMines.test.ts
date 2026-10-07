import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { createInitialState, type GameState } from '../state/gameState';
import { parseGameData } from '../data/schemas';
import { deepFreeze } from '../util/clone';
import { rocketMinesModule } from './rocketMines';
import { movementModule } from './movement';
import { minefieldModule } from './minefield';
import { visibleState } from '../state/visibility';
import { setStance } from '../state/diplomacy';
import { radarSignatures, radarSources, isVisibleTo } from '../state/visibility';
import { isMissileFleet, isRocketMineFleet, rocketMinelayer } from '../state/ordnance';
import { fleetPositionAt } from '../state/fleetPosition';
import { shuttleModule } from './shuttle';
import { fleetOpsModule } from './fleetOps';
import type { GameModule } from '../kernel/module';

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
    // SM-3.7a: стоящая мина — отряд из этого юнита; `mine` даёт ей правила мины-отряда.
    rocket_mine: {
      faction: 'neutral',
      stats: { hp: 20, attack: 0, defense: 0, speed: 0 },
      signature: 0.1,
      traits: ['immobile', 'issued', 'mine', 'rocketMine'],
    },
    // SM-3.7b: летящая ракета — отряд из этого юнита; корпус и сигнатура — его.
    missile: {
      faction: 'neutral',
      stats: { hp: 12, attack: 0, defense: 0, speed: 0 },
      signature: 13,
      traits: ['immobile', 'issued', 'missile'],
    },
    // Челнок перехвата (SM-3.7b): патруль бьёт ракету, влетевшую в его круг.
    interceptor: {
      faction: 'x',
      traits: ['shuttle'],
      stats: { attack: 40, defense: 3, speed: 100, hp: 10, strikeRange: 180, fuel: 3, rearmRounds: 2, patrolHours: 4, patrolRadius: 60 },
    },
    // Контактная мина (SM-3.6) — в неё ракетная мина не целится.
    mine: {
      faction: 'neutral',
      stats: { hp: 20, attack: 0, defense: 0, speed: 0 },
      signature: 0.1,
      traits: ['immobile', 'issued', 'mine'],
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
        damage: 80,
        blastRadius: 10,
        mineSignature: 0.1,
        cost: { metal: 20 },
      },
    },
    // Контактный заградитель (SM-3.4): его мина в той же точке встаёт своим отрядом.
    contact: {
      name: 'Mine Layer',
      slot: 'weapon',
      tag: 'vertical',
      effects: { stats: { mineCharge: 3, mineHit: 0.2 } },
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
/** Стоящие ракетные мины — отряды во `fleets` (SM-3.7a). */
const mines = (s: GameState) => Object.values(s.fleets).filter((f) => isRocketMineFleet(f, data));
/** Летящие ракеты — тоже отряды во `fleets` (SM-3.7b). */
const missiles = (s: GameState) => Object.values(s.fleets).filter((f) => isMissileFleet(f, data));

describe('legendary rocket mine', () => {
  it('requires a fitted module and a parked real road, charges once, and takes time', () => {
    const s = world();
    const start = deploy(s);
    expect(s.ordnance).toBeUndefined();
    expect(start.players.p!.resources.metal).toBe(180);
    expect(mines(start)).toHaveLength(0);
    expect(start.ordnance!.installations).toHaveLength(1);
    expect(missiles(advance(start, HOUR / 4 - 1))).toHaveLength(0);
    s.fleets.layer!.units[0]!.modules = [];
    expect(act(s, 'fleet.deployRocketMine', { fleetId: 'layer', mode: 'any' })).toMatchObject({
      ok: false,
      code: 'E_NO_ROCKET_MINELAYER',
    });
    s.fleets.layer!.units[0]!.modules = ['mine'];
    // A content error must reject the action, not change the rules: a `rocket_mine` without
    // the shared `mine` trait would stand as a fighting fleet (Codex, #1499).
    const loose = { ...data, units: { ...data.units, rocket_mine: { ...data.units.rocket_mine!, traits: ['immobile', 'issued', 'rocketMine'] } } };
    const r = kernel.applyAction(
      s,
      { id: 's:p:1', playerId: 'p', type: 'fleet.deployRocketMine', payload: { fleetId: 'layer', mode: 'any' }, issuedAt: s.time },
      { now: s.time, data: loose },
    );
    expect(r).toMatchObject({ ok: false, code: 'E_NO_ROCKET_MINELAYER' });
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
    // Ни чужой флот, ни свой корабль, ни ключ прототипа — не мина.
    for (const mineId of ['missing', '__proto__', 'constructor', 'target', 'layer'])
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
    expect(mines(end)).toHaveLength(0);
    expect(missiles(end)).toHaveLength(0);
  });
  it('launches on an anonymous signal only in any-signal mode', () => {
    const any = armed();
    expect(mines(any)).toHaveLength(0);
    expect(any.ordnance!.controls ?? {}).toEqual({});
    expect(missiles(any)).toHaveLength(1);
    // Радар даёт только точку: ни id цели, ни её хозяина ракета не несёт.
    expect(JSON.stringify(missiles(any)[0])).not.toContain('target');
    const confirmed = armed(world(), 'confirmed');
    expect(mines(confirmed)).toHaveLength(1);
    expect(missiles(confirmed)).toHaveLength(0);
  });
  it('accepts own direct sight and current shared illumination, never stale memory', () => {
    const near = world();
    near.fleets.target!.edge!.t = 0.54;
    expect(missiles(armed(near, 'confirmed'))).toHaveLength(1);
    const shared = world();
    shared.fleets.spotter = {
      ...structuredClone(shared.fleets.target!),
      id: 'spotter',
      owner: 'ally',
    };
    setStance(shared, 'p', 'ally', 'alliance');
    expect(missiles(armed(shared, 'confirmed'))).toHaveLength(1);
    delete shared.fleets.spotter;
    shared.fog = { p: { B: { at: 0, owner: 'q', buildings: [], garrison: [] } } };
    expect(missiles(armed(shared, 'confirmed'))).toHaveLength(0);
  });
  it('does not borrow an ally radar range or trigger outside the mine radar', () => {
    const s = world();
    s.fleets.target!.edge!.t = 0.95;
    s.fleets.spotter = { ...structuredClone(s.fleets.target!), id: 'spotter', owner: 'ally' };
    setStance(s, 'p', 'ally', 'alliance');
    expect(missiles(armed(s, 'confirmed'))).toHaveLength(0);
  });
  it('hits at the scheduled time through shields and can be dodged', () => {
    const launch = armed();
    const m = missiles(launch)[0]!.flight!;
    expect(advance(launch, m.arrivesAt - 1).fleets.target!.units[0]!.hp).toBeUndefined();
    const hit = advance(launch, m.arrivesAt);
    expect(missiles(hit)).toHaveLength(0);
    expect(hit.fleets.target!.units[0]!.hp).toBe(20);
    launch.fleets.target!.edge!.t = 0.9;
    expect(advance(launch, m.arrivesAt).fleets.target!.units[0]!.hp).toBeUndefined();
  });
  it('the blast spares mines in its radius: shuttles remove mines, not missiles (Codex, #1499)', () => {
    const s = world();
    // q's contact and rocket mines 4 from the target, well inside the blast radius of 10.
    for (const [id, unit] of [['qmine', 'mine'], ['qrocket', 'rocket_mine']] as const)
      s.fleets[id] = {
        id,
        owner: 'q',
        location: null,
        movement: null,
        edge: { from: 'A', to: 'B', t: 0.71 },
        units: [{ unit, count: 1, ...(unit === 'rocket_mine' ? { modules: ['mine'] } : {}) }],
        traits: [],
      };
    // And q's own missile hanging at the same point (SM-3.7b): the blast spares it too.
    s.fleets.qmissile = {
      id: 'qmissile',
      owner: 'q',
      location: null,
      movement: null,
      edge: null,
      flight: { from: { x: 284, y: 0 }, to: { x: 284, y: 0 }, departedAt: 0, arrivesAt: 4 * HOUR },
      units: [{ unit: 'missile', count: 1, modules: ['mine'] }],
      traits: [],
    };
    const launch = armed(s);
    const m = missiles(launch).find((f) => f.owner === 'p')!.flight!;
    const hit = advance(launch, m.arrivesAt);
    expect(hit.fleets.target!.units[0]!.hp).toBe(20);
    expect(hit.fleets.qmine!.units[0]).not.toHaveProperty('hp');
    expect(hit.fleets.qrocket!.units[0]).not.toHaveProperty('hp');
    expect(hit.fleets.qmissile!.units[0]).not.toHaveProperty('hp');
  });
  it('allows point defense to destroy the missile before damage', () => {
    const s = world();
    s.fleets.target!.units = [{ unit: 'guard', count: 1 }];
    const launch = armed(s);
    const end = advance(launch, missiles(launch)[0]!.flight!.arrivesAt);
    expect(end.fleets.target!.units[0]!.hp).toBeUndefined();
    expect(missiles(end)).toHaveLength(0);
  });
  it('regular attack cannot intercept; a reloading anti-shuttle PD cannot fire either', () => {
    for (const unit of ['ship', 'guard']) {
      const s = world();
      s.fleets.target!.units = [{ unit, count: 1 }];
      s.fleets.target!.pdCooldownUntil = HOUR;
      const launch = armed(s);
      const end = advance(launch, missiles(launch)[0]!.flight!.arrivesAt);
      expect(end.fleets.target!.units[0]!.hp).toBe(20);
    }
  });
  it('intercepts in flight with the very same cooldown consumed by shuttle fire', () => {
    const s = world();
    s.fleets.target!.units = [{ unit: 'guard', count: 1 }];
    const launch = armed(s);
    const missile = missiles(launch)[0]!.flight!;
    const shot = advance(launch, launch.time + HOUR / 60);
    expect(shot.time).toBeLessThan(missile.arrivesAt);
    expect(missiles(shot)).toHaveLength(0);
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
    expect(missiles(armed(s, 'confirmed'))).toHaveLength(0);
    const launch = armed(s, 'any');
    expect(missiles(launch)[0]!.flight!.to).toEqual({ x: 280, y: 0 });
    launch.fleets.friend = {
      ...structuredClone(s.fleets.layer!),
      id: 'friend',
      owner: 'ally',
      edge: { from: 'A', to: 'B', t: 0.7 },
    };
    setStance(launch, 'p', 'ally', 'alliance');
    expect(
      advance(launch, missiles(launch)[0]!.flight!.arrivesAt).fleets.friend!.units[0]!.hp,
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
    // Пять стоящих мин и одна ставится — шестая установка упирается в лимит.
    for (let n = 0; n < 5; n++)
      s.fleets[`m${n}`] = {
        id: `m${n}`,
        owner: 'p',
        location: null,
        movement: null,
        edge: { from: 'A', to: 'B', t: 0.1 + n / 10 },
        units: [{ unit: 'rocket_mine', count: 1, modules: ['mine'] }],
        traits: [],
      };
    expect(act(s, 'fleet.deployRocketMine', { fleetId: 'second', mode: 'any' })).toMatchObject({
      code: 'E_MINE_LIMIT',
    });
  });
  it('changing mode fires at most once and disarm invalidates pending timers', () => {
    const s = armed(world(), 'confirmed');
    const mineId = mines(s)[0]!.id;
    expect(act(s, 'rocketMine.mode', { mineId, mode: 'any' }, 'q')).toMatchObject({
      code: 'E_NO_ROCKET_MINE',
    });
    expect(act(s, 'rocketMine.disarm', { mineId }, 'q')).toMatchObject({ code: 'E_NO_ROCKET_MINE' });
    const switched = act(s, 'rocketMine.mode', { mineId, mode: 'any' });
    if (!switched.ok) throw new Error(switched.code);
    expect(advance(switched.state, HOUR).fleets.target!.units[0]!.hp).toBe(20);
    const disarmed = act(s, 'rocketMine.disarm', { mineId });
    if (!disarmed.ok) throw new Error(disarmed.code);
    // Снятая мина уходит с карты как отработавшая, а не как потеря флота.
    expect(disarmed.events).toContainEqual({
      type: 'fleet.destroyed',
      payload: { fleetId: mineId, owner: 'p', spent: true },
    });
    const later = advance(disarmed.state, HOUR);
    expect(mines(later)).toEqual([]);
    expect(later.ordnance!.controls ?? {}).toEqual({});
    expect(disarmed.state.players.p!.resources.metal).toBe(180);
  });
  it('cannot finish installation without the module; stars scale the installed warhead', () => {
    const s = deploy();
    s.fleets.layer!.units[0]!.modules = [];
    expect(mines(advance(s, HOUR / 4))).toEqual([]);
    expect(missiles(advance(s, HOUR / 4))).toEqual([]);
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
    const mineId = mines(s)[0]!.id;
    expect(visibleState(s, 'q', data).fleets[mineId]).toBeUndefined();
    expect(visibleState(s, 'q', data).ordnance).toBeUndefined();
    s.fleets.target!.edge!.t = 0.54;
    const near = visibleState(s, 'q', data);
    // Вблизи мина видна отрядом, но её режим, следующий скан и боевая часть — нет.
    expect(near.fleets[mineId]).toBeDefined();
    expect(near.ordnance).toBeUndefined();
    s.fleets.target!.edge!.t = 0.7;
    expect(visibleState(s, 'q', data).fleets[mineId]).toBeUndefined();
    // Хозяину — и мина, и её управление.
    expect(visibleState(s, 'p', data).ordnance!.controls?.[mineId]).toMatchObject({
      mode: 'confirmed',
      damage: 80,
    });
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
    // Отметка мины-отряда привязана к её узлу дороги, как у контактной мины (SM-3.6).
    expect(radarSignatures(mineOnly, 'q', sensorData)).toEqual([
      { location: 'A', size: 'S', position: { x: 200, y: 0 } },
    ]);
    sensorData.buildings.dish!.radarLevel = 2;
    expect(radarSignatures(mineOnly, 'q', sensorData)).toEqual([]);
    sensorData.buildings.dish!.radarLevel = 3;
    mineOnly.planets.sensor!.position.x = 240;
    expect(radarSignatures(mineOnly, 'q', sensorData)).toEqual([]);
    expect(visibleState(mineOnly, 'q', sensorData).ordnance).toBeUndefined();
  });
  it('a mine provides real local sight', () => {
    const s = armed(world(), 'confirmed');
    s.fleets.target!.edge!.t = 0.54;
    expect(isVisibleTo(s, 'p', { fleetId: 'target' }, data)).toBe(true);
    expect(visibleState(s, 'p', data).fleets.target).toBeDefined();
  });

  // SM-3.7a: стоящая ракетная мина — неподвижный отряд, как контактная (SM-3.6).
  it('stands as a rocket_mine fleet at the carrier road point, doctrine and warhead kept apart', () => {
    const s = armed(world(), 'confirmed');
    const [mine] = mines(s);
    expect(mine).toMatchObject({
      owner: 'p',
      location: null,
      movement: null,
      edge: { from: 'A', to: 'B', t: 0.5 },
      units: [{ unit: 'rocket_mine', count: 1, modules: ['mine'] }],
    });
    expect(s.ordnance!.controls?.[mine!.id]).toMatchObject({ mode: 'confirmed', damage: 80 });
    expect(s.ordnance!.controls?.[mine!.id]?.nextScanAt).toBeGreaterThan(s.time);
    // Мина — отряд без приказов: ни хода (трейт `immobile`), ни повторной установки собой.
    expect(act(s, 'fleet.move', { fleetId: mine!.id, to: 'A' })).toMatchObject({
      code: 'E_FLEET_IMMOBILE',
    });
    expect(act(s, 'fleet.deployRocketMine', { fleetId: mine!.id, mode: 'any' })).toMatchObject({
      code: 'E_MINE_PASSIVE',
    });
    expect(rocketMinelayer(mine!, data)).toBeNull();
  });

  it('never aims at a mine — contact or rocket — even in the any-signal mode', () => {
    const s = world();
    s.fleets.target!.units = [{ unit: 'mine', count: 3 }];
    s.fleets.rival = {
      id: 'rival',
      owner: 'q',
      location: null,
      movement: null,
      edge: { from: 'A', to: 'B', t: 0.6 },
      units: [{ unit: 'rocket_mine', count: 1, modules: ['mine'] }],
      traits: [],
    };
    const end = armed(s, 'any');
    expect(missiles(end)).toHaveLength(0);
    expect(mines(end).filter((f) => f.owner === 'p')).toHaveLength(1);
  });

  it('a mine destroyed by someone else takes its controls with it', () => {
    const killer: GameModule = {
      id: 'killer',
      version: '1.0.0',
      setup(api) {
        api.onAction('test.kill', (action, h) => {
          const { fleetId } = action.payload as { fleetId: string };
          const owner = h.state.fleets[fleetId]!.owner;
          delete h.state.fleets[fleetId];
          h.emit('fleet.destroyed', { fleetId, owner });
        });
      },
    };
    const both = createKernel([movementModule, rocketMinesModule, killer]);
    const s = armed(world(), 'confirmed');
    const mineId = mines(s)[0]!.id;
    const r = both.applyAction(
      s,
      { id: 's:q:1', playerId: 'q', type: 'test.kill', payload: { fleetId: mineId }, issuedAt: s.time },
      { now: s.time, data },
    );
    if (!r.ok) throw new Error(r.code);
    expect(r.state.ordnance!.controls ?? {}).toEqual({});
  });

  it('a world saved before SM-3.7a/b — no controls, stale mines and missiles lists — still projects and deploys', () => {
    // A Sector Zero run snapshot outlives updates: its ordnance has the old shape.
    const old = world();
    old.ordnance = {
      serials: {},
      cooldowns: {},
      installations: [],
      // Before SM-3.7b a flying missile lived here; the list is read by nothing any more.
      missiles: [{ id: 'rocketMine:p:8', owner: 'p', moduleId: 'mine', from: { x: 200, y: 0 }, to: { x: 280, y: 0 }, launchedAt: 0, arrivesAt: HOUR, damage: 80, hp: 12 }],
      mines: [{ id: 'rocketMine:p:9', owner: 'p', moduleId: 'mine', position: { x: 200, y: 0 }, mode: 'any' }],
    } as unknown as GameState['ordnance'];
    expect(() => visibleState(old, 'p', data)).not.toThrow();
    // The stale record reaches nobody, not even through the opponent's projection.
    expect(visibleState(old, 'q', data).ordnance).toBeUndefined();
    const placed = armed(old, 'confirmed');
    expect(mines(placed)).toHaveLength(1);
    expect(Object.keys(placed.ordnance!.controls!)).toEqual([mines(placed)[0]!.id]);
  });

  it('a contact mine laid at its point stands apart, and the rocket mine still launches (Codex, #1499)', () => {
    const k = createKernel([movementModule, minefieldModule, rocketMinesModule]);
    const step = (s: GameState, type: string, payload: unknown) => {
      const r = k.applyAction(
        s,
        { id: `s:p:${type}`, playerId: 'p', type, payload, issuedAt: s.time },
        { now: s.time, data },
      );
      if (!r.ok) throw new Error(r.code);
      return r.state;
    };
    const run = (s: GameState, now: number) => {
      const r = k.advanceTo(s, { now, data });
      if (!r.ok) throw new Error(r.code);
      expect(r.failures).toEqual([]);
      return r.state;
    };
    const s = world();
    s.fleets.layer!.units.push({ unit: 'ship', count: 1, modules: ['contact'] });
    s.fleets.target!.edge = { from: 'A', to: 'B', t: 0.95 }; // 180 от мины — вне её радара
    const rocket = run(step(s, 'fleet.deployRocketMine', { fleetId: 'layer', mode: 'any' }), HOUR / 4);
    const both = run(step(rocket, 'fleet.layMines', { fleetId: 'layer' }), HOUR / 2);
    expect(mines(both).map((f) => f.units)).toEqual([
      [{ unit: 'rocket_mine', count: 1, modules: ['mine'] }],
    ]);
    expect(
      Object.values(both.fleets).filter((f) => f.units.some((st) => st.unit === 'mine')),
    ).toHaveLength(1);
    // Цель входит в радар — ракетная мина, не испорченная соседкой, пускает ракету.
    const near = structuredClone(both);
    near.fleets.target!.edge = { from: 'A', to: 'B', t: 0.7 };
    const launched = run(near, HOUR / 2 + 60_000);
    expect(missiles(launched)).toHaveLength(1);
    expect(mines(launched)).toHaveLength(0);
  });

  it("is its owner's radar: a contact beyond its sight shows as a blip", () => {
    const s = armed(world(), 'confirmed');
    // Цель в 80 от мины: дальше её глаза (20), но в её радаре (120).
    expect(isVisibleTo(s, 'p', { fleetId: 'target' }, data)).toBe(false);
    expect(radarSignatures(s, 'p', data)).toContainEqual(
      expect.objectContaining({ position: { x: 280, y: 0 } }),
    );
  });
});

// SM-3.7b: летящая ракета — отряд без приказов («Ракета тоже является отрядом. Только его
// невозможно контролировать», решение владельца 2026-09-30); полёт по прямой, обычный туман
// (резолюция 2026-10-06); сбивают её ПРО и челноки, корабли — нет.
describe('a flying missile is a fleet without orders (SM-3.7b)', () => {
  it('flies straight from the mine to the point; its id names no owner; the warhead stays apart', () => {
    const launch = armed();
    const [m] = missiles(launch);
    expect(m).toMatchObject({
      owner: 'p',
      location: null,
      movement: null,
      units: [{ unit: 'missile', count: 1, modules: ['mine'] }],
      flight: { from: { x: 200, y: 0 }, to: { x: 280, y: 0 }, departedAt: HOUR / 4 },
    });
    expect(m!.id).toMatch(/^fleet:missile:\d+:\d+$/);
    expect(launch.ordnance!.warheads).toEqual({ [m!.id]: 80 });
    const fl = m!.flight!;
    expect(fleetPositionAt(launch, m!, (fl.departedAt + fl.arrivesAt) / 2)).toEqual({ x: 240, y: 0 });
    // Приказов нет: ни хода (стоянки, от которой строят маршрут, у ракеты нет), ни своей мины.
    expect(act(launch, 'fleet.move', { fleetId: m!.id, to: 'A' })).toMatchObject({ code: 'E_FLEET_BUSY' });
    expect(act(launch, 'fleet.deployRocketMine', { fleetId: m!.id, mode: 'any' })).toMatchObject({
      code: 'E_MISSILE_PASSIVE',
    });
    // Попала — ушла с карты израсходованной, вместе с боевой частью.
    const r = kernel.advanceTo(launch, { now: fl.arrivesAt, data });
    if (!r.ok) throw new Error(r.code);
    expect(r.events).toContainEqual({
      type: 'fleet.destroyed',
      payload: { fleetId: m!.id, owner: 'p', spent: true },
    });
    expect(missiles(r.state)).toEqual([]);
    expect(r.state.ordnance!.warheads ?? {}).toEqual({});
  });

  it('passes the ordinary fog: a blind target sees nothing, eyes see it whole, a radar a blip', () => {
    const launch = armed();
    const m = missiles(launch)[0]!;
    // Цель без глаз на ракету о ней не знает: ни отряда, ни отметки, ни id где-либо.
    expect(isVisibleTo(launch, 'q', { fleetId: m.id }, data)).toBe(false);
    expect(JSON.stringify(visibleState(launch, 'q', data))).not.toContain(m.id);
    // Пуск поднял счётчики id флотов и таймеров, но до цели они не доезжают: прирост без
    // нового в обзоре выдал бы пуск, а поминутный шаг полёта — саму ракету (Codex на #1503).
    expect(launch.fleetSeq).toBeGreaterThan(0);
    expect(launch.scheduleSeq).toBeGreaterThan(0);
    expect(visibleState(launch, 'q', data)).not.toHaveProperty('fleetSeq');
    expect(visibleState(launch, 'q', data)).not.toHaveProperty('scheduleSeq');
    // Влетела в глаза цели (обзор 10) — видна целиком, с хозяином; боевая часть — нет.
    const fl = m.flight!;
    const close = advance(launch, fl.departedAt + 0.95 * (fl.arrivesAt - fl.departedAt));
    const seen = visibleState(close, 'q', data);
    expect(seen.fleets[m.id]).toMatchObject({ owner: 'p', flight: { to: { x: 280, y: 0 } } });
    expect(seen.ordnance).toBeUndefined();
    // Хозяину — и боевая часть; союзнику — нет.
    expect(visibleState(launch, 'p', data).ordnance!.warheads).toEqual({ [m.id]: 80 });
    setStance(launch, 'p', 'ally', 'alliance');
    expect(visibleState(launch, 'ally', data).ordnance).toBeUndefined();
    // Под одним радаром — безымянная отметка в точке полёта, крупная по сигнатуре ракеты.
    const radar = structuredClone(launch);
    delete radar.fleets.layer;
    radar.planets.sensor = {
      ...structuredClone(radar.planets.A!),
      id: 'sensor',
      owner: 'q',
      position: { x: 200, y: 300 },
      links: [],
      buildings: [{ type: 'dish', level: 1, hp: 100 }],
    };
    const sensorData = parseGameData({
      ...data,
      buildings: { dish: { name: 'Dish', radarRange: 500, radarLevel: 1 } },
    });
    expect(radarSignatures(radar, 'q', sensorData)).toEqual([
      { location: 'A', size: 'L', position: { x: 200, y: 0 } },
    ]);
    expect(visibleState(radar, 'q', sensorData).fleets[m.id]).toBeUndefined();
    // Площадка крепости в 10 от ракеты отметку не якорит: проекция прячет её от того, кто её
    // не видел, а id в отметке выдал бы площадку (замечание Codex на #1503).
    radar.planets.fork1 = {
      ...structuredClone(radar.planets.A!),
      id: 'fork1',
      owner: null,
      position: { x: 210, y: 0 },
      links: [],
      buildings: [],
      fork: { province: 'A', trail: 0 },
    };
    const blips = visibleState(radar, 'q', sensorData).signatures;
    expect(blips).toEqual([{ location: 'A', size: 'L', position: { x: 200, y: 0 } }]);
    expect(JSON.stringify(visibleState(radar, 'q', sensorData))).not.toContain('fork1');
  });

  it('is no radar either, whatever radar the data gives it (Codex, #1503)', () => {
    const launch = armed();
    const m = missiles(launch)[0]!;
    // Радар у юнита ракеты и у модуля заградителя: правило «не радар» держит код, а не данные.
    const layerId = m.units[0]!.modules![0]!;
    const layer = data.modules[layerId]!;
    const radarData = parseGameData({
      ...data,
      units: { ...data.units, missile: { ...data.units.missile!, radarRange: 500, radarLevel: 3 } },
      modules: {
        ...data.modules,
        [layerId]: { ...layer, effects: { ...layer.effects, stats: { ...layer.effects.stats, radarRange: 300 } } },
      },
    });
    const without = structuredClone(launch);
    delete without.fleets[m.id];
    expect(radarSources(launch, 'p', radarData)).toEqual(radarSources(without, 'p', radarData));
  });

  it('is no eye: its owner sees neither a mine nor a ship through it', () => {
    const launch = armed();
    const m = missiles(launch)[0]!;
    // Чужая мина в 4 от ракеты: глаз у ракеты нет, корабля p рядом нет — мина скрыта.
    launch.fleets.qmine = {
      id: 'qmine',
      owner: 'q',
      location: null,
      movement: null,
      edge: { from: 'A', to: 'B', t: 0.51 },
      units: [{ unit: 'mine', count: 1 }],
      traits: [],
    };
    delete launch.fleets.layer;
    expect(fleetPositionAt(launch, m, launch.time)).toEqual({ x: 200, y: 0 });
    expect(isVisibleTo(launch, 'p', { fleetId: 'qmine' }, data)).toBe(false);
    expect(visibleState(launch, 'p', data).fleets.qmine).toBeUndefined();
    // И корабль у конца полёта ей не виден: ракета летит, а не смотрит. Пост q стоит на узле
    // C в 2 от точки ракеты на 95% пути — будь ракета глазом, узел был бы опознан.
    launch.planets.C = { ...structuredClone(launch.planets.A!), id: 'C', position: { x: 278, y: 0 }, links: [] };
    launch.fleets.post = { ...structuredClone(launch.fleets.target!), id: 'post', location: 'C', edge: null };
    const fl = m.flight!;
    const close = advance(launch, fl.departedAt + 0.95 * (fl.arrivesAt - fl.departedAt));
    expect(isVisibleTo(close, 'p', { fleetId: 'post' }, data)).toBe(false);
    expect(visibleState(close, 'p', data).fleets.post).toBeUndefined();
  });

  it('a mine never aims at a missile — the warhead is for ships', () => {
    const s = world();
    s.fleets.target!.edge = { from: 'A', to: 'B', t: 0.95 }; // 180 от мины — вне её радара
    // Чужая ракета пересекает радар мины.
    s.fleets.incoming = {
      id: 'incoming',
      owner: 'q',
      location: null,
      movement: null,
      edge: null,
      flight: { from: { x: 260, y: 30 }, to: { x: 260, y: -30 }, departedAt: 0, arrivesAt: 4 * HOUR },
      units: [{ unit: 'missile', count: 1, modules: ['mine'] }],
      traits: [],
    };
    const end = armed(s, 'any');
    expect(missiles(end).filter((f) => f.owner === 'p')).toEqual([]);
    expect(mines(end).filter((f) => f.owner === 'p')).toHaveLength(1);
  });

  it('a shuttle patrol shoots it down in its circle; the target is never hit', () => {
    const launch = armed();
    const m = missiles(launch)[0]!;
    // Патруль q висит над (250, 0) кругом 40: носитель p (200) вне круга, ракета войдёт.
    launch.strikes = [
      {
        id: 'strike:q:1',
        owner: 'q',
        base: { kind: 'planet', id: 'B' },
        squadronId: 'sq:q:1',
        units: [{ unit: 'interceptor', count: 2 }],
        target: { kind: 'point' },
        to: { x: 250, y: 0 },
        departedAt: launch.time,
        arrivesAt: launch.time + 4 * HOUR,
        leg: 'patrol',
        patrol: { hours: 4, radius: 40 },
      },
    ];
    const clock: GameModule = {
      id: 'clock',
      version: '1.0.0',
      setup(api) {
        api.onAction('test.patrolTick', (action, h) => {
          const { at } = action.payload as { at: number };
          h.schedule(at, 'shuttle.patrol.tick', { strikeId: 'strike:q:1' });
        });
      },
    };
    const k = createKernel([movementModule, rocketMinesModule, shuttleModule, clock]);
    // Тик через 5 минут полёта: ракета в (220, 0), в 30 от центра круга.
    const tick = k.applyAction(
      launch,
      { id: 's:q:1', playerId: 'q', type: 'test.patrolTick', payload: { at: launch.time + 5 * 60_000 }, issuedAt: launch.time },
      { now: launch.time, data },
    );
    if (!tick.ok) throw new Error(tick.code);
    const r = k.advanceTo(tick.state, { now: m.flight!.arrivesAt, data });
    if (!r.ok) throw new Error(r.code);
    expect(r.failures).toEqual([]);
    expect(r.events).toContainEqual(
      expect.objectContaining({ type: 'shuttle.hit', payload: expect.objectContaining({ targetId: m.id }) }),
    );
    expect(missiles(r.state)).toEqual([]);
    expect(r.state.ordnance!.warheads ?? {}).toEqual({});
    expect(r.events.map((e) => e.type)).not.toContain('rocketMine.hit');
    expect(r.state.fleets.target!.units[0]!.hp).toBeUndefined();
    // Сбитая ракета уходит отработавшей, как после попадания: «флот уничтожен» о ней не
    // пишется, конец объявляет своя строка — хозяину ракеты и хозяину челноков.
    expect(r.events).toContainEqual({
      type: 'fleet.destroyed',
      payload: { fleetId: m.id, owner: 'p', spent: true },
    });
    expect(r.events).toContainEqual({
      type: 'shuttle.missileDowned',
      payload: { owner: 'q', playerId: 'p', missileId: m.id },
    });
    // И юнитом она не «гибнет», как и под ПРО: `unit.died` засчитал бы её потерей и
    // убийством в счёте PvE, трофеях и опыте героя (замечание Codex на #1503).
    expect(r.events.map((e) => e.type)).not.toContain('unit.died');
  });

  it('a shuttle strike by order finds it only in sight — its id is predictable', () => {
    const launch = armed();
    const m = missiles(launch)[0]!;
    const fl = m.flight!;
    const strikeData = parseGameData({
      ...data,
      buildings: { spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 12 } },
    });
    const k = createKernel([shuttleModule]);
    const strike = (s: GameState) => {
      s.planets.B = {
        ...s.planets.B!,
        owner: 'q',
        buildings: [{ type: 'spaceport', level: 1, hp: 30 }],
        hangar: [{ id: 'sq:q', units: [{ unit: 'interceptor', count: 2 }] }],
      };
      const r = k.applyAction(
        s,
        {
          id: 's:q:1',
          playerId: 'q',
          type: 'shuttle.strike',
          payload: { planetId: 'B', squadronId: 'sq:q', targetFleetId: m.id },
          issuedAt: s.time,
        },
        { now: s.time, data: strikeData },
      );
      return r.ok ? 'ok' : r.code;
    };
    // На полпути (240, 0): в радиусе удара от B (160 ≤ 180), но цель её не видит.
    const mid = (fl.departedAt + fl.arrivesAt) / 2;
    expect(strike(advance(launch, mid))).toBe('E_NO_TARGET');
    // У самой цели (276, 0) — видна, удар уходит.
    expect(strike(advance(launch, fl.departedAt + 0.95 * (fl.arrivesAt - fl.departedAt)))).toBe('ok');
    // Окно шпионажа по флотам хозяина открывает ракету и в проекции, и для удара: что видно,
    // по тому и бьют (замечание Codex на #1503).
    const spied = advance(launch, mid);
    spied.intel = { q: [{ kind: 'fleets', target: 'p', until: spied.time + HOUR }] };
    expect(visibleState(spied, 'q', data).fleets[m.id]).toBeDefined();
    expect(strike(spied)).toBe('ok');
  });

  it('«Attack» on a missile is the same refusal as on a missing fleet (Codex, #1503)', () => {
    // Корабли ракету не бьют, а её id предсказуем: иной код отказа выдал бы скрытый пуск.
    const launch = armed();
    const m = missiles(launch)[0]!;
    launch.fleets.picket = {
      id: 'picket',
      owner: 'q',
      location: 'A',
      movement: null,
      units: [{ unit: 'ship', count: 1 }],
      traits: [],
    };
    const k = createKernel([movementModule, fleetOpsModule, rocketMinesModule]);
    const order = (type: string, payload: Record<string, unknown>) => {
      const r = k.applyAction(
        launch,
        { id: 's:q:1', playerId: 'q', type, payload, issuedAt: launch.time },
        { now: launch.time, data },
      );
      return r.ok ? 'ok' : r.code;
    };
    const engage = (targetId: string) => order('fleet.engage', { fleetId: 'picket', targetId });
    expect(engage(m.id)).toBe('E_NO_FLEET');
    expect(engage('fleet:missile:0:999')).toBe('E_NO_FLEET');
    // И в любом другом поле приказа чужая ракета — та же пустота, что несуществующий id, а не
    // «не твой» (`E_FORBIDDEN`): поменять поля местами пуск не выдаёт (Codex, #1503).
    for (const id of [m.id, 'fleet:missile:0:999']) {
      expect(order('fleet.engage', { fleetId: id, targetId: 'picket' })).toBe('E_NO_FLEET');
      expect(order('fleet.merge', { from: id, into: 'picket' })).toBe('E_NO_FLEET');
      expect(order('fleet.merge', { from: 'picket', into: id })).toBe('E_NO_FLEET');
      expect(order('fleet.split', { fleetId: id, take: [] })).toBe('E_NO_FLEET');
    }
  });

  it('a missile without a hull is refused at deployment: nothing to shoot down (Codex, #1503)', () => {
    const missile = data.units.missile!;
    const hollow = { ...data, units: { ...data.units, missile: { ...missile, stats: { ...missile.stats, hp: 0 } } } };
    const s = world();
    const r = kernel.applyAction(
      s,
      { id: 's:p:1', playerId: 'p', type: 'fleet.deployRocketMine', payload: { fleetId: 'layer', mode: 'any' }, issuedAt: s.time },
      { now: s.time, data: hollow },
    );
    expect(r).toMatchObject({ ok: false, code: 'E_NO_ROCKET_MINELAYER' });
  });
});

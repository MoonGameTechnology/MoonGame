/**
 * РАКЕТЫ ИЗ АНГАРА (решения владельца 2026-11-09).
 *
 * 1. Ракета строится в порту и встаёт в ангар эскадрой, как челнок.
 * 2. Пуск — `missile.launch`: из порта или трюма, по видимому враждебному флоту или миру,
 *    в дальности ракеты; залп тратит столько ракет, сколько пущено.
 * 3. Ракета самонаводящаяся: идёт за флотом и попадает, где бы он ни был, пока он не дальше
 *    дальности от точки пуска. Дальше — промах (`missile.missed`). По миру промаха нет, и
 *    взрыв бьёт его здания.
 * 4. Ракетная эскадра не вылетает как челноки и не сводится с ними.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { movementModule } from './movement';
import { constructionModule } from './construction';
import { shuttleModule } from './shuttle';
import { rocketMinesModule } from './rocketMines';
import { missilesModule } from './missiles';
import { createInitialState, type Fleet, type GameState } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import { setStance } from '../state/diplomacy';
import { isMissileFleet } from '../state/ordnance';
import { deepFreeze } from '../util/clone';

const HOUR = 3_600_000;

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    ship: { faction: 'x', stats: { attack: 1, defense: 0, speed: 60, hp: 400 } },
    cruise: {
      faction: 'neutral',
      traits: ['shuttle', 'missile'],
      stats: { attack: 0, defense: 0, speed: 240, hp: 12, strikeRange: 240 },
      signature: 13,
      cost: { metal: 10 },
      buildTimeHours: 0,
      warhead: { damage: 100, blastRadius: 12 },
    },
    interceptor: {
      faction: 'x',
      traits: ['shuttle'],
      stats: {
        attack: 14,
        defense: 3,
        speed: 50,
        hp: 10,
        strikeRange: 250,
        fuel: 3,
        rearmRounds: 2,
      },
      cost: { metal: 10 },
      buildTimeHours: 0,
    },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 2 },
    mine: { name: 'Mine', cost: {}, buildTimeHours: 0, hp: 500 },
  },
  events: {},
});

const kernel = createKernel([
  movementModule,
  constructionModule,
  shuttleModule,
  rocketMinesModule,
  missilesModule,
]);

function world(): GameState {
  const s = createInitialState({ seed: 'msl', version: { data: '0.1.0', manifest: '1' } });
  s.sight = { world: 300, fleet: 300, radarScale: 1 };
  for (const id of ['p', 'q'])
    s.players[id] = { id, name: id, faction: 'x', status: 'active', resources: { metal: 1000 } };
  const planet = (
    id: string,
    owner: string | null,
    x: number,
    buildings: Array<[string, number]>,
  ) => ({
    id,
    owner,
    position: { x, y: 0 },
    resources: {},
    buildings: buildings.map(([type, hp]) => ({ type, level: 1, hp })),
    garrison: [],
    traits: [],
    links: [] as string[],
  });
  s.planets.A = planet('A', 'p', 0, [['spaceport', 30]]);
  s.planets.B = planet('B', 'q', 200, [['mine', 500]]);
  s.planets.C = planet('C', null, 600, []);
  s.planets.A.links = ['B'];
  s.planets.B.links = ['A', 'C'];
  s.planets.C.links = ['B'];
  s.planets.A.hangar = [{ id: 'sq:p:1', units: [{ unit: 'cruise', count: 3 }] }];
  s.fleets.target = {
    id: 'target',
    owner: 'q',
    location: 'B',
    movement: null,
    edge: null,
    units: [{ unit: 'ship', count: 1 }],
    traits: [],
    battleId: null,
  } as Fleet;
  setStance(s, 'p', 'q', 'war');
  return s;
}

let seq = 0;
function act(s: GameState, type: string, payload: unknown, playerId = 'p') {
  return kernel.applyAction(
    deepFreeze(structuredClone(s)),
    { id: `m:${seq++}`, playerId, type, payload, issuedAt: s.time },
    { now: s.time, data },
  );
}
function ok(s: GameState, type: string, payload: unknown, playerId = 'p'): GameState {
  const r = act(s, type, payload, playerId);
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function advance(s: GameState, now: number) {
  const r = kernel.advanceTo(s, { now, data });
  if (!r.ok) throw new Error(r.code);
  expect(r.failures).toEqual([]);
  return r;
}
const missiles = (s: GameState) => Object.values(s.fleets).filter((f) => isMissileFleet(f, data));
const launch = (extra: Record<string, unknown> = {}) => ({
  planetId: 'A',
  squadronId: 'sq:p:1',
  targetFleetId: 'target',
  ...extra,
});

describe('missile launch', () => {
  it('a built missile stands in the hangar as a squadron, like a shuttle', () => {
    const s = world();
    s.planets.A!.hangar = [];
    const built = advance(
      ok(s, 'unit.build', { planetId: 'A', unit: 'cruise', count: 2 }),
      1,
    ).state;
    expect(built.planets.A!.hangar).toEqual([
      expect.objectContaining({ units: [expect.objectContaining({ unit: 'cruise', count: 2 })] }),
    ]);
  });

  it('spends one missile per launched one and flies it as a fleet; a salvo spends more', () => {
    const one = ok(world(), 'missile.launch', launch());
    expect(one.planets.A!.hangar![0]!.units[0]!.count).toBe(2);
    expect(missiles(one)).toHaveLength(1);
    const all = ok(world(), 'missile.launch', launch({ count: 3 }));
    expect(all.planets.A!.hangar).toEqual([]);
    expect(missiles(all)).toHaveLength(3);
    expect(act(world(), 'missile.launch', launch({ count: 4 }))).toMatchObject({
      ok: false,
      code: 'E_NOT_ENOUGH',
    });
  });

  it('refuses a target out of range, unseen, friendly, or another missile', () => {
    const far = world();
    far.fleets.target!.location = 'C';
    far.sight = { world: 700, fleet: 700, radarScale: 1 };
    expect(act(far, 'missile.launch', launch())).toMatchObject({
      ok: false,
      code: 'E_OUT_OF_RANGE',
    });
    const blind = world();
    blind.sight = { world: 0, fleet: 0, radarScale: 1 };
    expect(act(blind, 'missile.launch', launch())).toMatchObject({
      ok: false,
      code: 'E_NO_TARGET',
    });
    const peace = world();
    setStance(peace, 'p', 'q', 'peace');
    expect(act(peace, 'missile.launch', launch())).toMatchObject({
      ok: false,
      code: 'E_NOT_HOSTILE',
    });
    const neutral = world();
    expect(
      act(neutral, 'missile.launch', { planetId: 'A', squadronId: 'sq:p:1', targetPlanetId: 'C' }),
    ).toMatchObject({ ok: false, code: 'E_NOT_HOSTILE' });
  });

  it('a damaged port does not launch', () => {
    const s = world();
    s.planets.A!.buildings[0]!.hp = 10;
    expect(act(s, 'missile.launch', launch())).toMatchObject({ ok: false, code: 'E_PORT_DAMAGED' });
  });

  it('hits the fleet that stands still', () => {
    const s = ok(world(), 'missile.launch', launch());
    const fl = missiles(s)[0]!.flight!;
    const hit = advance(s, fl.arrivesAt).state;
    expect(missiles(hit)).toHaveLength(0);
    expect(hit.fleets.target!.units[0]!.hp).toBe(300);
  });

  it('homes on a fleet that moves away and hits it while it stays within range of the launch point', () => {
    const s = ok(world(), 'missile.launch', launch());
    const first = missiles(s)[0]!.flight!.arrivesAt;
    // The target slips 30 units further along the lane — still within 240 of A.
    s.fleets.target = {
      ...s.fleets.target!,
      location: null,
      edge: { from: 'B', to: 'C', t: 0.075 },
    };
    const r = advance(s, first + HOUR);
    expect(r.events.map((e) => e.type)).not.toContain('missile.missed');
    expect(missiles(r.state)).toHaveLength(0);
    expect(r.state.fleets.target!.units[0]!.hp).toBe(300);
  });

  it('misses only when the target is beyond range from the launch point', () => {
    const s = ok(world(), 'missile.launch', launch());
    s.fleets.target = {
      ...s.fleets.target!,
      location: null,
      edge: { from: 'B', to: 'C', t: 0.25 },
    };
    const r = advance(s, HOUR);
    expect(r.events.map((e) => e.type)).toContain('missile.missed');
    expect(missiles(r.state)).toHaveLength(0);
    expect(r.state.fleets.target!.units[0]!.hp).toBeUndefined();
    expect(r.state.ordnance?.guidance ?? {}).toEqual({});
  });

  it('never misses a world and wears its buildings', () => {
    const s = ok(world(), 'missile.launch', {
      planetId: 'A',
      squadronId: 'sq:p:1',
      targetPlanetId: 'B',
    });
    const hit = advance(s, HOUR).state;
    expect(hit.planets.B!.buildings[0]!.hp).toBeLessThan(500);
    expect(hit.fleets.target!.units[0]!.hp).toBe(300);
  });

  it('launches from a carrier hold as well', () => {
    const s = world();
    s.fleets.carrier = {
      id: 'carrier',
      owner: 'p',
      location: 'A',
      movement: null,
      edge: null,
      units: [{ unit: 'ship', count: 1 }],
      traits: [],
      battleId: null,
      hangar: s.planets.A!.hangar,
    } as Fleet;
    s.planets.A!.hangar = [];
    const r = ok(s, 'missile.launch', {
      fleetId: 'carrier',
      squadronId: 'sq:p:1',
      targetFleetId: 'target',
    });
    expect(missiles(r)).toHaveLength(1);
    expect(r.fleets.carrier!.hangar![0]!.units[0]!.count).toBe(2);
  });

  it('a missile squadron does not fly shuttle orders and does not merge with shuttles', () => {
    const s = world();
    expect(
      act(s, 'shuttle.strike', { planetId: 'A', squadronId: 'sq:p:1', targetFleetId: 'target' }),
    ).toMatchObject({ ok: false, code: 'E_MISSILE_SQUADRON' });
    s.planets.A!.hangar!.push({ id: 'sq:p:2', units: [{ unit: 'interceptor', count: 1 }] });
    expect(
      act(s, 'shuttle.merge', { planetId: 'A', squadronId: 'sq:p:2', intoId: 'sq:p:1' }),
    ).toMatchObject({ ok: false, code: 'E_MISSILE_SQUADRON' });
    expect(
      act(s, 'missile.launch', { planetId: 'A', squadronId: 'sq:p:2', targetFleetId: 'target' }),
    ).toMatchObject({ ok: false, code: 'E_NOT_MISSILE' });
  });

  it('missiles in the hangar do not dry up the port: shuttles keep their fuel', () => {
    const s = world();
    s.planets.A!.hangar!.push({ id: 'sq:p:2', units: [{ unit: 'interceptor', count: 1 }] });
    const r = act(s, 'shuttle.strike', {
      planetId: 'A',
      squadronId: 'sq:p:2',
      targetFleetId: 'target',
    });
    expect(r).toMatchObject({ ok: true });
  });

  it('is identical across advance partitions', () => {
    const s = ok(world(), 'missile.launch', launch({ count: 2 }));
    s.fleets.target = {
      ...s.fleets.target!,
      location: null,
      edge: { from: 'B', to: 'C', t: 0.05 },
    };
    const whole = advance(s, HOUR).state;
    let step = s;
    for (let t = 7_000; t < HOUR; t += 7_000) step = advance(step, t).state;
    expect(advance(step, HOUR).state).toEqual(whole);
  });
});

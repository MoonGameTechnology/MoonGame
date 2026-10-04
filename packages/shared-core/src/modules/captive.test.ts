import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createKernel } from '../kernel/kernel';
import { captiveModule, captiveSide } from './captive';
import type { GameModule } from '../kernel/module';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { getStance, setStance } from '../state/diplomacy';
import { parseGameData, type GameData } from '../data/schemas';
import { parseMatchMap } from '../data/mapSchema';
import { buildStateFromMap, validateMatchMap } from '../state/buildFromMap';
import { loadGameData } from '../data/loadGameData';
import type { Action, Context, MatchConfig } from '../action/types';

// Пленный главы V «Голос Единения» (PVR-9.5): взять живым штурмом убежища стороной людей,
// погрузить на один носитель, довезти до базы; потеря убежища или носителя — провал задания.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 5, hp: 40 } },
    marine: { faction: 'x', domain: 'ground', stats: { attack: 2, defense: 2, speed: 0, hp: 10 } },
  },
  technologies: {},
  factions: { x: { name: 'X' } },
  buildings: {},
  events: {},
  modes: { plain: { name: 'Plain' } },
});

/** Звонок — поднимает события мира так же, как их поднимают бой, движение и герой. */
const bell: GameModule = {
  id: 'test-bell',
  version: '1.0.0',
  setup(api) {
    // Захват ставит хозяина до события — как бой, который мир и берёт.
    api.onAction('test.capture', (action, h) => {
      const p = action.payload as { planetId: string; owner: string; from: string };
      h.state.planets[p.planetId]!.owner = p.owner;
      h.emit('planet.captured', p);
    });
    for (const type of ['planet.destroyed', 'fleet.arrived', 'fleet.merged', 'fleet.destroyed'])
      api.onAction(`test.${type}`, (action, h) => h.emit(type, action.payload));
  },
};

const kernel = createKernel([captiveModule, bell]);
const ctx = (now: number): Context => ({ now, data, config: { timeScale: 1 } as MatchConfig });
const player = (id: string, extra: Partial<Player> = {}): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
  ...extra,
});
const planet = (id: string, owner: string | null = null): Planet => ({
  id,
  owner,
  position: { x: 0, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
});
const fleet = (id: string, owner: string, extra: Partial<Fleet> = {}): Fleet => ({
  id,
  owner,
  location: 'hideout',
  movement: null,
  units: [{ unit: 'cruiser', count: 2 }],
  traits: [],
  ...extra,
});

/** Убежище у Завета, база у игрока, союзник на связи по месту встречи и в союзе, Рой
 *  воюет со всеми. */
function world(fleets: Fleet[] = [], hideoutOwner: string | null = 'covenant'): GameState {
  const base = createInitialState({ seed: 'cap', version: { data: '0.1.0', manifest: '1' } });
  const s: GameState = {
    ...base,
    players: {
      p1: player('p1'),
      ally: player('ally', { npc: 'neutral', ai: true }),
      covenant: player('covenant', { npc: 'pirate' }),
      swarm: player('swarm', { ai: true }),
    },
    planets: {
      hideout: planet('hideout', hideoutOwner),
      base: planet('base', 'p1'),
      camp: { ...planet('camp', 'ally'), rendezvous: 'ally' },
    },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
    captive: { hideout: 'hideout', zone: 'base' },
    missionFacts: { contacted: { p1: ['camp'] } },
  };
  setStance(s, 'p1', 'ally', 'alliance');
  setStance(s, 'p1', 'swarm', 'war');
  return s;
}

let seq = 0;
const act = (type: string, payload: unknown, playerId = 'p1'): Action => ({
  id: `t:${++seq}`,
  type,
  playerId,
  payload,
  issuedAt: 0,
});
function apply(s: GameState, type: string, payload: unknown, playerId = 'p1') {
  return kernel.applyAction(s, act(type, payload, playerId), ctx(s.time));
}
function ok(s: GameState, type: string, payload: unknown, playerId = 'p1') {
  const r = apply(s, type, payload, playerId);
  if (!r.ok) throw new Error(r.code);
  return r;
}
const capture = (s: GameState, owner: string, from = 'covenant') =>
  ok(s, 'test.capture', { planetId: 'hideout', owner, from });
const load = (s: GameState, fleetId = 'f1', by = 'p1') =>
  ok(s, 'captive.load', { fleetId }, by).state;
const types = (r: { events: Array<{ type: string }> }) => r.events.map((e) => e.type);

describe('пленный — взять живым', () => {
  it('штурм убежища игроком: пленный взят, событие одно', () => {
    const r = capture(world(), 'p1');
    expect(r.state.captive).toMatchObject({ takenBy: 'p1', takenAt: 0 });
    expect(types(r)).toContain('captive.taken');
    // Мир перешёл внутри стороны людей — пленный там же, второго взятия нет.
    const again = capture(r.state, 'ally', 'p1');
    expect(again.state.captive!.takenBy).toBe('p1');
    expect(types(again)).not.toContain('captive.taken');
  });

  it('союзник на связи засчитывается: житель берёт убежище сам', () => {
    expect(capture(world(), 'ally').state.captive!.takenBy).toBe('ally');
  });

  it('сторона людей — человек и житель на связи в союзе; бот в союзе и житель без связи — нет', () => {
    expect([...captiveSide(world())].sort()).toEqual(['ally', 'p1']);
    const unlinked = { ...world(), missionFacts: {} };
    expect([...captiveSide(unlinked)]).toEqual(['p1']);
    const peace = world();
    setStance(peace, 'p1', 'ally', 'peace');
    expect([...captiveSide(peace)]).toEqual(['p1']);
    const botFriend = world();
    setStance(botFriend, 'p1', 'swarm', 'alliance');
    expect([...captiveSide(botFriend)].sort()).toEqual(['ally', 'p1']);
    // Житель без связи взял убежище — для пленного это чужие руки.
    expect(capture(unlinked, 'ally').state.captive!.lostAt).toBe(0);
  });

  it('Рой взял убежище раньше — пленный потерян навсегда', () => {
    const r = capture(world(), 'swarm');
    expect(r.state.captive).toMatchObject({ lostAt: 0 });
    expect(r.state.captive!.takenBy).toBeUndefined();
    expect(types(r)).toContain('captive.lost');
    // Отбить убежище после этого — пленного уже нет.
    expect(capture(r.state, 'p1', 'swarm').state.captive!.takenBy).toBeUndefined();
  });

  it('взятое убежище пало врагу до погрузки — потеря; уничтожение мира — тоже', () => {
    const taken = capture(world(), 'p1').state;
    expect(capture(taken, 'swarm', 'p1').state.captive!.lostAt).toBe(0);
    const razed = ok(taken, 'test.planet.destroyed', { planetId: 'hideout', by: 'swarm' });
    expect(razed.state.captive!.lostAt).toBe(0);
    expect(types(razed)).toContain('captive.lost');
  });
});

describe('пленный — погрузка', () => {
  it('флот стороны у взятого убежища принимает пленного на борт', () => {
    const taken = capture(world([fleet('f1', 'p1')]), 'p1').state;
    const r = ok(taken, 'captive.load', { fleetId: 'f1' });
    expect(r.state.captive).toMatchObject({ carrier: 'f1', loadedAt: 0 });
    expect(types(r)).toContain('captive.loaded');
    // После погрузки судьба убежища пленного уже не касается.
    const razed = ok(r.state, 'test.planet.destroyed', { planetId: 'hideout' });
    expect(razed.state.captive!.lostAt).toBeUndefined();
  });

  it('союзник грузит на свой флот, если убежище взял игрок', () => {
    const taken = capture(world([fleet('a1', 'ally')]), 'p1').state;
    expect(load(taken, 'a1', 'ally').captive!.carrier).toBe('a1');
  });

  it('отказы стабильными кодами', () => {
    const code = (s: GameState, payload: unknown, by = 'p1') => {
      const r = apply(s, 'captive.load', payload, by);
      return r.ok ? 'ok' : r.code;
    };
    const s = world([
      fleet('f1', 'p1'),
      fleet('moving', 'p1', { movement: { from: 'hideout', to: 'base' } as Fleet['movement'] }),
      fleet('away', 'p1', { location: 'base' }),
      fleet('fight', 'p1', { battleId: 'b1' }),
      fleet('troops', 'p1', { units: [{ unit: 'marine', count: 3 }] }),
      fleet('s1', 'swarm'),
    ]);
    expect(code({ ...s, captive: undefined }, { fleetId: 'f1' })).toBe('E_NO_CAPTIVE');
    expect(code(s, {})).toBe('E_BAD_PAYLOAD');
    expect(code(s, { fleetId: 'f1' })).toBe('E_NOT_TAKEN');
    const taken = capture(s, 'p1').state;
    expect(code(taken, { fleetId: 's1' }, 'swarm')).toBe('E_FORBIDDEN');
    expect(code(taken, { fleetId: 's1' })).toBe('E_FORBIDDEN');
    expect(code(taken, { fleetId: 'ghost' })).toBe('E_NO_FLEET');
    expect(code(taken, { fleetId: 'moving' })).toBe('E_IN_TRANSIT');
    expect(code(taken, { fleetId: 'away' })).toBe('E_NOT_AT_HIDEOUT');
    expect(code(taken, { fleetId: 'fight' })).toBe('E_IN_BATTLE');
    expect(code(taken, { fleetId: 'troops' })).toBe('E_NO_SHIPS');
    // Хозяин сменился мимо захвата (страховка): грузить у чужого убежища нельзя.
    const held = structuredClone(taken);
    held.planets.hideout!.owner = 'covenant';
    expect(code(held, { fleetId: 'f1' })).toBe('E_HIDEOUT_HELD');
    const loaded = load(taken);
    expect(code(loaded, { fleetId: 'f1' })).toBe('E_ALREADY');
  });
});

describe('пленный — носитель, доставка, потеря', () => {
  const carried = () => load(capture(world([fleet('f1', 'p1'), fleet('f2', 'p1')]), 'p1').state);

  it('слияние переносит пленного, второго не появляется', () => {
    const r = ok(carried(), 'test.fleet.merged', { from: 'f1', into: 'f2' });
    expect(r.state.captive!.carrier).toBe('f2');
  });

  it('гибель носителя — потеря; гибель другого флота — ничего', () => {
    const s = carried();
    expect(ok(s, 'test.fleet.destroyed', { fleetId: 'f2' }).state.captive!.lostAt).toBeUndefined();
    const r = ok(s, 'test.fleet.destroyed', { fleetId: 'f1' });
    expect(r.state.captive).toMatchObject({ lostAt: 0, carrier: 'f1' });
    expect(types(r)).toContain('captive.lost');
  });

  it('носитель исчез без события — потеря на следующем шаге часов', () => {
    const s = carried();
    delete s.fleets.f1;
    const r = kernel.advanceTo(s, ctx(s.time + 3_600_000));
    if (!r.ok) throw new Error(r.code);
    expect(r.state.captive!.lostAt).toBeDefined();
  });

  it('прибытие в безопасную зону — доставка, одна на матч', () => {
    const s = carried();
    // Прибытие не носителя и не в зону — не доставка.
    expect(
      ok(s, 'test.fleet.arrived', { fleetId: 'f2', at: 'base' }).state.captive!.deliveredAt,
    ).toBeUndefined();
    expect(
      ok(s, 'test.fleet.arrived', { fleetId: 'f1', at: 'hideout' }).state.captive!.deliveredAt,
    ).toBeUndefined();
    const r = ok(s, 'test.fleet.arrived', { fleetId: 'f1', at: 'base' });
    expect(r.state.captive).toMatchObject({ deliveredAt: 0, takenBy: 'p1' });
    expect(types(r)).toContain('captive.delivered');
    const again = ok(r.state, 'test.fleet.arrived', { fleetId: 'f1', at: 'base' });
    expect(types(again)).not.toContain('captive.delivered');
    // После доставки гибель флота пленного уже не касается.
    expect(
      ok(r.state, 'test.fleet.destroyed', { fleetId: 'f1' }).state.captive!.lostAt,
    ).toBeUndefined();
  });

  it('вход не мутирует', () => {
    const s = world([fleet('f1', 'p1')]);
    const before = JSON.stringify(s);
    load(capture(s, 'p1').state);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('убежище и союзник в карте', () => {
  const shipped = loadGameData((name) =>
    JSON.parse(readFileSync(new URL(`../../../../data/${name}`, import.meta.url), 'utf8')),
  );
  const base = {
    id: 'm',
    seed: 'm',
    sectors: {
      a: { position: { x: 0, y: 0 }, owner: 'p1' },
      b: { position: { x: 300, y: 0 }, owner: 'cov', captive: { zone: 'a' } },
      c: { position: { x: 0, y: 300 }, owner: 'ally', rendezvous: 'ally', contactAtStart: true },
    },
    players: {
      p1: { name: 'P1', faction: 'x' },
      ally: { name: 'Ally', faction: 'x', npc: 'neutral', ai: true },
      cov: { name: 'Cov', faction: 'x', npc: 'pirate' },
    },
  };

  it('загрузчик заводит пленного; союзник со встречей на старте — сторона людей сразу', () => {
    const s = buildStateFromMap(parseMatchMap(base), shipped);
    expect(s.captive).toEqual({ hideout: 'b', zone: 'a' });
    expect(getStance(s, 'p1', 'ally')).toBe('alliance');
    expect([...captiveSide(s)].sort()).toEqual(['ally', 'p1']);
    // Житель с жителем — как прежде: пират воюет со всеми, союза у них нет.
    expect(getStance(s, 'ally', 'cov')).toBe('war');
    const plain = {
      ...base,
      sectors: { ...base.sectors, b: { position: { x: 300, y: 0 }, owner: 'cov' } },
    };
    expect(buildStateFromMap(parseMatchMap(plain), shipped).captive).toBeUndefined();
  });

  it('убежище — у жителя карты, зона — другая существующая провинция, убежище одно', () => {
    const bad = (sector: Record<string, unknown>) =>
      validateMatchMap(parseMatchMap({ ...base, sectors: { ...base.sectors, b: sector } }));
    expect(validateMatchMap(parseMatchMap(base))).toEqual([]);
    expect(bad({ position: { x: 300, y: 0 }, owner: 'cov', captive: { zone: 'ghost' } })).toContain(
      'E_INVALID_CAPTIVE:b',
    );
    expect(bad({ position: { x: 300, y: 0 }, owner: 'cov', captive: { zone: 'b' } })).toContain(
      'E_INVALID_CAPTIVE:b',
    );
    expect(bad({ position: { x: 300, y: 0 }, owner: 'p1', captive: { zone: 'a' } })).toContain(
      'E_INVALID_CAPTIVE:b',
    );
    expect(bad({ position: { x: 300, y: 0 }, captive: { zone: 'a' } })).toContain(
      'E_INVALID_CAPTIVE:b',
    );
    const two = {
      ...base,
      sectors: {
        ...base.sectors,
        c: { position: { x: 0, y: 300 }, owner: 'cov', captive: { zone: 'a' } },
      },
    };
    expect(validateMatchMap(parseMatchMap(two))).toContain('E_MULTIPLE_CAPTIVES');
  });
});

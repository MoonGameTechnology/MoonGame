import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { rendezvousModule, contactedAllies } from './rendezvous';
import { diplomacyModule } from './diplomacy';
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
import { validateMatchMap } from '../state/buildFromMap';
import type { Action, Context, MatchConfig } from '../action/types';

// Сценарный союзник главы IV (PVR-7.2): контакт — ровно прибытие живого корабля игрока в
// место встречи; он ставит союз, не дублируется и не снимает запрет союза с ботами.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 5, hp: 40 } },
    marine: { faction: 'x', domain: 'ground', stats: { attack: 2, defense: 2, speed: 0, hp: 10 } },
    missile: {
      faction: 'x',
      domain: 'space',
      traits: ['immobile', 'issued', 'missile'],
      stats: { attack: 0, defense: 0, speed: 0, hp: 12 },
    },
  },
  technologies: {},
  factions: { x: { name: 'X' } },
  buildings: {},
  events: {},
  modes: { plain: { name: 'Plain' } },
});

/** Звонок — тестовый модуль, поднимающий прибытие так же, как его поднимает движение. */
const bell: GameModule = {
  id: 'test-bell',
  version: '1.0.0',
  setup(api) {
    api.onAction('test.arrived', (action, h) => h.emit('fleet.arrived', action.payload));
    for (const type of ['planet.captured', 'fleet.destroyed', 'fleet.merged', 'player.eliminated'])
      api.onAction(`test.${type}`, (action, h) => h.emit(type, action.payload));
  },
};

const kernel = createKernel([diplomacyModule, rendezvousModule, bell]);
const ctx = (now: number): Context => ({ now, data, config: { timeScale: 1 } as MatchConfig });
const player = (id: string, extra: Partial<Player> = {}): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
  ...extra,
});
const planet = (id: string, extra: Partial<Planet> = {}): Planet => ({
  id,
  owner: null,
  position: { x: 0, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
  ...extra,
});
const fleet = (id: string, owner: string, extra: Partial<Fleet> = {}): Fleet => ({
  id,
  owner,
  location: 'dock',
  movement: null,
  units: [{ unit: 'cruiser', count: 1 }],
  traits: [],
  ...extra,
});

function world(fleets: Fleet[], allyStatus: Player['status'] = 'active'): GameState {
  const base = createInitialState({ seed: 'rv', version: { data: '0.1.0', manifest: '1' } });
  const s: GameState = {
    ...base,
    players: {
      p1: player('p1'),
      ally: player('ally', { npc: 'neutral', ai: true, status: allyStatus }),
      swarm: player('swarm', { ai: true }),
    },
    planets: {
      dock: planet('dock', { rendezvous: 'ally' }),
      road: planet('road'),
    },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
  };
  setStance(s, 'p1', 'ally', 'peace');
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
function run(s: GameState, type: string, payload: unknown, playerId = 'p1') {
  const r = kernel.applyAction(s, act(type, payload, playerId), ctx(0));
  if (!r.ok) throw new Error(r.code);
  return r;
}
const arrive = (s: GameState, fleetId: string, at = 'dock') =>
  run(s, 'test.arrived', { fleetId, at });

describe('сценарный союзник — контакт по прибытию (PVR-7.2)', () => {
  it('живой корабль игрока в месте встречи: факт, союз и событие контакта', () => {
    const r = arrive(world([fleet('f1', 'p1')]), 'f1');
    expect(r.state.missionFacts?.contacted).toEqual({ p1: ['dock'] });
    expect(getStance(r.state, 'p1', 'ally')).toBe('alliance');
    expect(contactedAllies(r.state, 'p1')).toEqual(['ally']);
    expect(r.events.map((e) => e.type)).toEqual([
      'fleet.arrived',
      'diplomacy.changed',
      'ally.contact',
    ]);
    expect(r.events.find((e) => e.type === 'ally.contact')?.payload).toEqual({
      owner: 'p1',
      ally: 'ally',
      at: 'dock',
    });
  });

  it('повторное прибытие и второй флот ничего не дублируют', () => {
    const first = arrive(world([fleet('f1', 'p1'), fleet('f2', 'p1')]), 'f1');
    const again = arrive(first.state, 'f1');
    const second = arrive(again.state, 'f2');
    for (const r of [again, second]) {
      expect(r.state.missionFacts?.contacted).toEqual({ p1: ['dock'] });
      expect(r.events.map((e) => e.type)).toEqual(['fleet.arrived']);
    }
  });

  it('курс, пролёт и чужой узел — не прибытие в место встречи', () => {
    // Флот ещё в пути (курс указан, но не долетел) или стоит в другом месте.
    const moving = fleet('f1', 'p1', { movement: { to: 'dock' } as unknown as Fleet['movement'] });
    const elsewhere = fleet('f2', 'p1', { location: 'road' });
    let s = world([moving, elsewhere]);
    s = arrive(s, 'f1').state;
    s = arrive(s, 'f2').state;
    s = arrive(s, 'f2', 'road').state;
    expect(s.missionFacts?.contacted).toBeUndefined();
    expect(getStance(s, 'p1', 'ally')).toBe('peace');
  });

  it('чужой флот, десант без кораблей и мёртвый стек связь не устанавливают', () => {
    const cases: Fleet[] = [
      fleet('a', 'ally'),
      fleet('s', 'swarm'),
      fleet('g', 'p1', { units: [{ unit: 'marine', count: 3 }] }),
      fleet('z', 'p1', { units: [{ unit: 'cruiser', count: 0 }] }),
      fleet('d', 'p1', { units: [{ unit: 'cruiser', count: 1, hp: 0 }] }),
      fleet('l', 'p1', { units: [], landing: [{ unit: 'marine', count: 2 }] }),
    ];
    for (const f of cases) {
      const r = arrive(world([f]), f.id);
      expect(r.state.missionFacts?.contacted, f.id).toBeUndefined();
      expect(getStance(r.state, 'p1', 'ally'), f.id).toBe('peace');
    }
  });

  it('союзника уже нет — встречаться не с кем', () => {
    const r = arrive(world([fleet('f1', 'p1')], 'defeated'), 'f1');
    expect(r.state.missionFacts?.contacted).toBeUndefined();
  });

  it('вход не мутирует: факт живёт только в новом состоянии', () => {
    const s = world([fleet('f1', 'p1')]);
    const before = JSON.stringify(s);
    arrive(s, 'f1');
    expect(JSON.stringify(s)).toBe(before);
  });

  it('запрет союза с ботом остаётся: ни с союзником до встречи, ни с Роем после', () => {
    const s = world([fleet('f1', 'p1')]);
    const declare = (st: GameState, target: string) =>
      kernel.applyAction(st, act('diplomacy.declare', { target, stance: 'alliance' }), ctx(0));
    expect(declare(s, 'ally')).toMatchObject({ ok: false, code: 'E_BOT_ALLIANCE' });
    const met = arrive(s, 'f1').state;
    expect(declare(met, 'swarm')).toMatchObject({ ok: false, code: 'E_BOT_ALLIANCE' });
  });
});

describe('место встречи в карте', () => {
  const base = {
    id: 'm',
    seed: 'm',
    sectors: {
      a: { position: { x: 0, y: 0 }, owner: 'p1' },
      b: { position: { x: 300, y: 0 }, rendezvous: 'ally' },
    },
    players: {
      p1: { name: 'P1', faction: 'x' },
      ally: { name: 'Ally', faction: 'x', npc: 'neutral', ai: true },
    },
  };

  it('называет жителя карты — место проходит проверку', () => {
    expect(validateMatchMap(parseMatchMap(base))).not.toContain('E_INVALID_RENDEZVOUS:b');
  });

  it('игровое место, пират или неизвестный id — ошибка карты', () => {
    const bad = (players: Record<string, unknown>, who: string) =>
      validateMatchMap(
        parseMatchMap({
          ...base,
          players,
          sectors: { ...base.sectors, b: { ...base.sectors.b, rendezvous: who } },
        }),
      );
    expect(bad(base.players, 'p1')).toContain('E_INVALID_RENDEZVOUS:b');
    expect(
      bad({ ...base.players, ally: { name: 'A', faction: 'x', npc: 'pirate' } }, 'ally'),
    ).toContain('E_INVALID_RENDEZVOUS:b');
    expect(bad(base.players, 'ghost')).toContain('E_INVALID_RENDEZVOUS:b');
  });
});

describe('приказ союзнику (PVR-7.4)', () => {
  /** Мир после встречи: у союзника флот и дом, у Роя — мир и флот. */
  function met(): GameState {
    const s = arrive(
      world([
        fleet('f1', 'p1'),
        fleet('a1', 'ally', { location: 'road' }),
        fleet('s1', 'swarm', { location: 'nest' }),
      ]),
      'f1',
    ).state;
    return {
      ...s,
      planets: {
        ...s.planets,
        // Гнездо далеко: его не видят ни игрок, ни союзник.
        nest: planet('nest', { owner: 'swarm', position: { x: 50_000, y: 50_000 } }),
        mine: planet('mine', { owner: 'p1' }),
        home: planet('home', { owner: 'ally' }),
      },
    };
  }
  const order = (s: GameState, payload: Record<string, unknown>, who = 'p1') =>
    kernel.applyAction(s, act('ally.order', { ally: 'ally', ...payload }, who), ctx(0));

  it('до встречи приказывать нельзя; после — операция встаёт одна на союзника', () => {
    const before = world([fleet('f1', 'p1')]);
    expect(order(before, { kind: 'scout', planet: 'road' })).toMatchObject({
      ok: false,
      code: 'E_NO_CONTACT',
    });
    const r = order(met(), { kind: 'attack', planet: 'nest' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.allyOps).toEqual({
      ally: { by: 'p1', kind: 'attack', planet: 'nest', issuedAt: 0 },
    });
    expect(r.events.map((e) => e.type)).toEqual(['ally.ordered']);
  });

  it('цели по виду приказа: охранять своё, атаковать врага, разведывать чужое', () => {
    const s = met();
    expect(order(s, { kind: 'guard', planet: 'mine' }).ok).toBe(true);
    expect(order(s, { kind: 'guard', fleet: 'f1' }).ok).toBe(true);
    expect(order(s, { kind: 'guard', planet: 'nest' })).toMatchObject({
      ok: false,
      code: 'E_BAD_TARGET',
    });
    expect(order(s, { kind: 'guard', fleet: 's1' })).toMatchObject({
      ok: false,
      code: 'E_BAD_TARGET',
    });
    expect(order(s, { kind: 'attack', planet: 'mine' })).toMatchObject({
      ok: false,
      code: 'E_NOT_HOSTILE',
    });
    // Флот Роя не обнаружен ни игроком, ни союзником — атаковать нечего.
    expect(order(s, { kind: 'attack', fleet: 's1' })).toMatchObject({
      ok: false,
      code: 'E_BAD_TARGET',
    });
    expect(order(s, { kind: 'scout', planet: 'mine' })).toMatchObject({
      ok: false,
      code: 'E_BAD_TARGET',
    });
    expect(order(s, { kind: 'scout', planet: 'nest' }).ok).toBe(true);
    expect(order(s, { kind: 'scout', planet: 'ghost' })).toMatchObject({
      ok: false,
      code: 'E_BAD_TARGET',
    });
  });

  it('летящая ракета — не цель приказа: ни охранять, ни атаковать (SM-3.7b)', () => {
    const s = met();
    const flight = { from: { x: 0, y: 0 }, to: { x: 90, y: 0 }, departedAt: 0, arrivesAt: 60_000 };
    const missile = (id: string, owner: string) =>
      fleet(id, owner, { location: null, flight, units: [{ unit: 'missile', count: 1 }] });
    s.fleets['fleet:missile:0:1'] = missile('fleet:missile:0:1', 'p1');
    s.fleets['fleet:missile:0:2'] = missile('fleet:missile:0:2', 'swarm');
    // Своя ракета: охранять в ней нечего — без отказа план союзника встал бы «нет пути»
    // навсегда, а попадание закрыло бы приказ потерянным.
    expect(order(s, { kind: 'guard', fleet: 'fleet:missile:0:1' })).toMatchObject({
      ok: false,
      code: 'E_BAD_TARGET',
    });
    expect(order(s, { kind: 'attack', fleet: 'fleet:missile:0:2' })).toMatchObject({
      ok: false,
      code: 'E_BAD_TARGET',
    });
    expect(s.allyOps).toBeUndefined();
  });

  it('кривой приказ и чужой приказчик — стабильные отказы', () => {
    const s = met();
    expect(order(s, { kind: 'fly', planet: 'nest' })).toMatchObject({
      ok: false,
      code: 'E_BAD_PAYLOAD',
    });
    expect(order(s, { kind: 'attack' })).toMatchObject({ ok: false, code: 'E_BAD_PAYLOAD' });
    expect(order(s, { kind: 'attack', planet: 'nest', fleet: 's1' })).toMatchObject({
      ok: false,
      code: 'E_BAD_PAYLOAD',
    });
    expect(order(s, { kind: 'scout', fleet: 's1' })).toMatchObject({
      ok: false,
      code: 'E_BAD_PAYLOAD',
    });
    expect(order(s, { kind: 'scout', planet: 'nest' }, 'swarm')).toMatchObject({
      ok: false,
      code: 'E_FORBIDDEN',
    });
    const ghost = kernel.applyAction(
      s,
      act('ally.order', { ally: 'swarm', kind: 'scout', planet: 'nest' }),
      ctx(0),
    );
    expect(ghost).toMatchObject({ ok: false, code: 'E_NO_PLAYER' });
  });

  it('повтор того же не множит операцию; новый приказ явно заменяет прежний', () => {
    const first = run(met(), 'ally.order', { ally: 'ally', kind: 'attack', planet: 'nest' });
    expect(order(first.state, { kind: 'attack', planet: 'nest' })).toMatchObject({
      ok: false,
      code: 'E_ALREADY',
    });
    const next = run(first.state, 'ally.order', { ally: 'ally', kind: 'guard', planet: 'mine' });
    expect(next.state.allyOps?.ally).toMatchObject({ kind: 'guard', planet: 'mine' });
    // `owner` — адресат события для тумана сервера (`eventFogContract.test.ts`).
    expect(next.events.find((e) => e.type === 'ally.ordered')?.payload).toMatchObject({
      owner: 'p1',
      replaced: true,
    });
  });

  it('отмена снимает операцию; снимать нечего — отказ', () => {
    const s = run(met(), 'ally.order', { ally: 'ally', kind: 'attack', planet: 'nest' }).state;
    const r = run(s, 'ally.cancel', { ally: 'ally' });
    expect(r.state.allyOps).toBeUndefined();
    expect(r.events.map((e) => e.type)).toEqual(['ally.order.cancelled']);
    expect(kernel.applyAction(r.state, act('ally.cancel', { ally: 'ally' }), ctx(0))).toMatchObject(
      {
        ok: false,
        code: 'E_NO_ORDER',
      },
    );
  });

  it('ядро закрывает операцию по миру: взяли цель, разведчик дошёл, цель охраны потеряна', () => {
    const attack = run(met(), 'ally.order', { ally: 'ally', kind: 'attack', planet: 'nest' }).state;
    const taken = run(attack, 'test.planet.captured', {
      planetId: 'nest',
      owner: 'ally',
      from: 'swarm',
    });
    expect(taken.state.allyOps).toBeUndefined();
    expect(taken.events.map((e) => e.type)).toContain('ally.order.done');

    const scout = run(met(), 'ally.order', { ally: 'ally', kind: 'scout', planet: 'nest' }).state;
    const moved = {
      ...scout,
      fleets: { ...scout.fleets, a1: { ...scout.fleets.a1!, location: 'nest' } },
    };
    const reported = run(moved, 'test.arrived', { fleetId: 'a1', at: 'nest' });
    expect(reported.events.map((e) => e.type)).toContain('ally.order.done');

    const guard = run(met(), 'ally.order', { ally: 'ally', kind: 'guard', fleet: 'f1' }).state;
    const merged = run(guard, 'test.fleet.merged', { from: 'f1', into: 'f9' });
    expect(merged.state.allyOps?.ally?.fleet).toBe('f9');
    const lost = run(merged.state, 'test.fleet.destroyed', { fleetId: 'f9' });
    expect(lost.events.map((e) => e.type)).toContain('ally.order.lost');

    const post = run(met(), 'ally.order', { ally: 'ally', kind: 'guard', planet: 'mine' }).state;
    const fell = run(post, 'test.planet.captured', {
      planetId: 'mine',
      owner: 'swarm',
      from: 'p1',
    });
    expect(fell.events.map((e) => e.type)).toContain('ally.order.lost');
  });

  it('разведчик союзника уже стоит в цели — доклад сразу', () => {
    const r = run(met(), 'ally.order', { ally: 'ally', kind: 'scout', planet: 'road' });
    // `road` — место, где стоит флот союзника, и не его провинция.
    expect(r.state.allyOps).toBeUndefined();
    expect(r.events.map((e) => e.type)).toEqual(['ally.ordered', 'ally.order.done']);
  });
});

import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { extractionModule, extractionRunning } from './extraction';
import type { GameModule } from '../kernel/module';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { setStance } from '../state/diplomacy';
import { parseGameData, type GameData } from '../data/schemas';
import { parseMatchMap } from '../data/mapSchema';
import { buildStateFromMap, validateMatchMap } from '../state/buildFromMap';
import type { Action, Context, MatchConfig } from '../action/types';
import { loadGameData } from '../data/loadGameData';
import { readFileSync } from 'node:fs';

// Накопитель архива главы IV (PVR-7.3): извлечение у очищенного архива с паузой, носитель —
// один флот (слияние переносит, гибель — потеря), доставка в зону вывода только после связи.

const HOUR = 3_600_000;
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

/** Звонок — поднимает события мира так же, как их поднимают движение, бой и союзник. */
const bell: GameModule = {
  id: 'test-bell',
  version: '1.0.0',
  setup(api) {
    for (const type of ['fleet.arrived', 'fleet.merged', 'fleet.destroyed', 'ally.contact'])
      api.onAction(`test.${type}`, (action, h) => h.emit(type, action.payload));
  },
};

const kernel = createKernel([extractionModule, bell]);
const ctx = (now: number, timeScale = 1): Context => ({
  now,
  data,
  config: { timeScale } as MatchConfig,
});
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
  location: 'archive',
  movement: null,
  units: [{ unit: 'cruiser', count: 2 }],
  traits: [],
  ...extra,
});

function world(fleets: Fleet[], archiveOwner: string | null = null): GameState {
  const base = createInitialState({ seed: 'ex', version: { data: '0.1.0', manifest: '1' } });
  const s: GameState = {
    ...base,
    players: {
      p1: player('p1'),
      ally: player('ally', { npc: 'neutral', ai: true }),
      swarm: player('swarm', { ai: true }),
    },
    planets: { archive: planet('archive', archiveOwner), home: planet('home', 'p1') },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
    extraction: { vault: 'archive', zone: 'home', hours: 4, doneMs: 0 },
  };
  setStance(s, 'p1', 'swarm', 'war');
  setStance(s, 'p1', 'ally', 'alliance');
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
function apply(s: GameState, type: string, payload: unknown, playerId = 'p1', now = s.time) {
  return kernel.applyAction(s, act(type, payload, playerId), ctx(now));
}
function ok(s: GameState, type: string, payload: unknown, playerId = 'p1') {
  const r = apply(s, type, payload, playerId);
  if (!r.ok) throw new Error(r.code);
  return r;
}
function wait(s: GameState, hours: number, timeScale = 1): { state: GameState; types: string[] } {
  const r = kernel.advanceTo(s, ctx(s.time + hours * HOUR, timeScale));
  if (!r.ok) throw new Error(r.code);
  return { state: r.state, types: r.events.map((e) => e.type) };
}
const start = (s: GameState, fleetId = 'f1') => ok(s, 'extraction.start', { fleetId }).state;
const withContact = (s: GameState): GameState => ({
  ...s,
  missionFacts: { ...s.missionFacts, contacted: { p1: ['rv'] } },
});

describe('накопитель — назначение на извлечение', () => {
  it('флот игрока у очищенного архива берётся за работу', () => {
    const r = ok(world([fleet('f1', 'p1')]), 'extraction.start', { fleetId: 'f1' });
    expect(r.state.extraction).toMatchObject({ fleetId: 'f1', owner: 'p1', doneMs: 0 });
    expect(r.events.map((e) => e.type)).toEqual(['extraction.started']);
  });

  it('архив союзника тоже очищен; архив Роя — нет', () => {
    expect(
      apply(world([fleet('f1', 'p1')], 'ally'), 'extraction.start', { fleetId: 'f1' }).ok,
    ).toBe(true);
    expect(apply(world([fleet('f1', 'p1')], 'p1'), 'extraction.start', { fleetId: 'f1' }).ok).toBe(
      true,
    );
    expect(
      apply(world([fleet('f1', 'p1')], 'swarm'), 'extraction.start', { fleetId: 'f1' }),
    ).toMatchObject({
      ok: false,
      code: 'E_VAULT_HELD',
    });
  });

  it('отказы стабильными кодами', () => {
    const cases: Array<[GameState, unknown, string, string]> = [
      [world([fleet('f1', 'p1')]), { fleetId: 7 }, 'p1', 'E_BAD_PAYLOAD'],
      [
        { ...world([fleet('f1', 'p1')]), extraction: undefined },
        { fleetId: 'f1' },
        'p1',
        'E_NO_VAULT',
      ],
      [world([fleet('f1', 'p1')]), { fleetId: 'ghost' }, 'p1', 'E_NO_FLEET'],
      [world([fleet('f1', 'swarm')]), { fleetId: 'f1' }, 'p1', 'E_FORBIDDEN'],
      [world([fleet('f1', 'ally')]), { fleetId: 'f1' }, 'ally', 'E_FORBIDDEN'],
      [world([fleet('f1', 'p1', { location: 'home' })]), { fleetId: 'f1' }, 'p1', 'E_NOT_AT_VAULT'],
      [
        world([fleet('f1', 'p1', { movement: { to: 'home' } as unknown as Fleet['movement'] })]),
        { fleetId: 'f1' },
        'p1',
        'E_IN_TRANSIT',
      ],
      [world([fleet('f1', 'p1', { battleId: 'b1' })]), { fleetId: 'f1' }, 'p1', 'E_IN_BATTLE'],
      [
        world([fleet('f1', 'p1', { units: [], landing: [{ unit: 'marine', count: 3 }] })]),
        { fleetId: 'f1' },
        'p1',
        'E_NO_SHIPS',
      ],
    ];
    for (const [s, payload, who, code] of cases)
      expect(apply(s, 'extraction.start', payload, who), code).toMatchObject({ ok: false, code });
    // Тот же флот второй раз — не новое назначение.
    const s = start(world([fleet('f1', 'p1')]));
    expect(apply(s, 'extraction.start', { fleetId: 'f1' })).toMatchObject({
      ok: false,
      code: 'E_ALREADY',
    });
  });
});

describe('накопитель — работа, пауза, готовность', () => {
  it('копится по времени, уход ставит на паузу, возврат продолжает', () => {
    let s = start(world([fleet('f1', 'p1')]));
    s = wait(s, 1.5).state;
    expect(s.extraction!.doneMs).toBe(1.5 * HOUR);
    // Флот ушёл — работа стоит, сделанное не пропадает.
    s = { ...s, fleets: { f1: { ...s.fleets.f1!, location: 'home' } } };
    expect(extractionRunning(s)).toBe(false);
    s = wait(s, 3).state;
    expect(s.extraction!.doneMs).toBe(1.5 * HOUR);
    // Вернулся — продолжает с того же места и заканчивает точным мигом внутри отрезка.
    s = { ...s, fleets: { f1: { ...s.fleets.f1!, location: 'archive' } } };
    const before = s.time;
    const r = wait(s, 5);
    expect(r.state.extraction).toMatchObject({
      carrier: 'f1',
      doneMs: 4 * HOUR,
      extractedAt: before + 2.5 * HOUR,
    });
    expect(r.types).toContain('extraction.completed');
  });

  it('бой у архива и захват его Роем — пауза', () => {
    const s = start(world([fleet('f1', 'p1')]));
    const inBattle = { ...s, fleets: { f1: { ...s.fleets.f1!, battleId: 'b1' } } };
    expect(wait(inBattle, 2).state.extraction!.doneMs).toBe(0);
    const lost = {
      ...s,
      planets: { ...s.planets, archive: { ...s.planets.archive!, owner: 'swarm' } },
    };
    expect(wait(lost, 2).state.extraction!.doneMs).toBe(0);
  });

  it('другой флот до готовности — сделанное сохраняется', () => {
    let s = start(world([fleet('f1', 'p1'), fleet('f2', 'p1')]));
    s = wait(s, 3).state;
    s = start(s, 'f2');
    expect(s.extraction).toMatchObject({ fleetId: 'f2', doneMs: 3 * HOUR });
    s = wait(s, 1).state;
    expect(s.extraction!.carrier).toBe('f2');
  });

  it('срок в часах карты идёт в темпе матча', () => {
    const s = start(world([fleet('f1', 'p1')]));
    // ×4: четыре игровых часа — один час по часам матча.
    expect(wait(s, 1, 4).state.extraction!.carrier).toBe('f1');
  });

  it('после готовности второго накопителя нет', () => {
    const s = wait(start(world([fleet('f1', 'p1'), fleet('f2', 'p1')])), 4).state;
    expect(apply(s, 'extraction.start', { fleetId: 'f2' })).toMatchObject({
      ok: false,
      code: 'E_ALREADY',
    });
  });
});

describe('накопитель — носитель, доставка, потеря', () => {
  const ready = (): GameState =>
    wait(start(world([fleet('f1', 'p1'), fleet('f2', 'p1')])), 4).state;

  it('слияние переносит пакет в принимающий флот', () => {
    const r = ok(ready(), 'test.fleet.merged', { from: 'f1', into: 'f2' });
    expect(r.state.extraction!.carrier).toBe('f2');
  });

  it('гибель носителя — потеря; гибель другого флота — ничего', () => {
    const other = ok(ready(), 'test.fleet.destroyed', { fleetId: 'f2' });
    expect(other.state.extraction!.lostAt).toBeUndefined();
    const r = ok(ready(), 'test.fleet.destroyed', { fleetId: 'f1' });
    expect(r.state.extraction!.lostAt).toBeDefined();
    expect(r.events.map((e) => e.type)).toContain('extraction.lost');
  });

  it('носитель исчез без события — потеря на следующем шаге часов', () => {
    const s = ready();
    const gone = { ...s, fleets: { f2: s.fleets.f2! } };
    const r = wait(gone, 1);
    expect(r.state.extraction!.lostAt).toBeDefined();
    expect(r.types).toContain('extraction.lost');
  });

  it('зона вывода до связи — не доставка; после связи — доставка', () => {
    const early = ok(ready(), 'test.fleet.arrived', { fleetId: 'f1', at: 'home' });
    expect(early.state.extraction!.deliveredAt).toBeUndefined();
    const r = ok(withContact(ready()), 'test.fleet.arrived', { fleetId: 'f1', at: 'home' });
    expect(r.state.extraction!.deliveredAt).toBeDefined();
    expect(r.events.map((e) => e.type)).toContain('extraction.delivered');
    // Чужая точка и другой флот — не доставка.
    expect(
      ok(withContact(ready()), 'test.fleet.arrived', { fleetId: 'f1', at: 'archive' }).state
        .extraction!.deliveredAt,
    ).toBeUndefined();
    expect(
      ok(withContact(ready()), 'test.fleet.arrived', { fleetId: 'f2', at: 'home' }).state
        .extraction!.deliveredAt,
    ).toBeUndefined();
  });

  it('носитель ждал в зоне, связь пришла позже — доставка в миг контакта', () => {
    let s = ready();
    s = { ...s, fleets: { ...s.fleets, f1: { ...s.fleets.f1!, location: 'home' } } };
    s = ok(s, 'test.fleet.arrived', { fleetId: 'f1', at: 'home' }).state;
    expect(s.extraction!.deliveredAt).toBeUndefined();
    const r = ok(withContact(s), 'test.ally.contact', { owner: 'p1', ally: 'ally', at: 'rv' });
    expect(r.state.extraction!.deliveredAt).toBeDefined();
  });

  it('вход не мутирует', () => {
    const s = world([fleet('f1', 'p1')]);
    const before = JSON.stringify(s);
    start(s);
    wait(start(s), 5);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('архив в карте', () => {
  const base = {
    id: 'm',
    seed: 'm',
    sectors: {
      a: { position: { x: 0, y: 0 }, owner: 'p1' },
      b: { position: { x: 300, y: 0 }, vault: { hours: 4, zone: 'a' } },
    },
    players: { p1: { name: 'P1', faction: 'x' } },
  };

  it('загрузчик заводит извлечение по объявленному архиву; без архива — не заводит', () => {
    const shipped = loadGameData((name) =>
      JSON.parse(readFileSync(new URL(`../../../../data/${name}`, import.meta.url), 'utf8')),
    );
    expect(buildStateFromMap(parseMatchMap(base), shipped).extraction).toEqual({
      vault: 'b',
      zone: 'a',
      hours: 4,
      doneMs: 0,
    });
    const plain = { ...base, sectors: { ...base.sectors, b: { position: { x: 300, y: 0 } } } };
    expect(buildStateFromMap(parseMatchMap(plain), shipped).extraction).toBeUndefined();
  });

  it('зона вывода — существующая провинция, не сам архив; архив один', () => {
    const bad = (vault: unknown) =>
      validateMatchMap(
        parseMatchMap({ ...base, sectors: { ...base.sectors, b: { ...base.sectors.b, vault } } }),
      );
    expect(bad({ hours: 4, zone: 'ghost' })).toContain('E_INVALID_VAULT:b');
    expect(bad({ hours: 4, zone: 'b' })).toContain('E_INVALID_VAULT:b');
    const two = {
      ...base,
      sectors: {
        ...base.sectors,
        c: { position: { x: 0, y: 300 }, vault: { hours: 1, zone: 'a' } },
      },
    };
    expect(validateMatchMap(parseMatchMap(two))).toContain('E_MULTIPLE_VAULTS');
  });
});

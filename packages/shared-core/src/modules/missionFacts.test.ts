import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { missionFactsModule } from './missionFacts';
import type { GameModule } from '../kernel/module';
import { createInitialState, type Fleet, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context, MatchConfig } from '../action/types';

// Память фактов для задач забега: удержание с момента захвата, потерянные миры,
// доставленные беженцы. Модуль задач не знает — только факты.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    transport: { faction: 'x', domain: 'space', stats: { attack: 0, defense: 1, speed: 5, hp: 10 }, traits: ['evacuee'] },
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 5, hp: 40 } },
    trooper: { faction: 'x', domain: 'ground', stats: { attack: 1, defense: 1, speed: 5, hp: 5 } },
  },
  technologies: {},
  factions: { x: { name: 'X' } },
  buildings: {},
  events: {},
  modes: { plain: { name: 'Plain' } },
});

/** Звонок — тестовый модуль, поднимающий события так же, как их поднимают бой и движение. */
const bell: GameModule = {
  id: 'test-bell',
  version: '1.0.0',
  setup(api) {
    api.onAction('test.captured', (action, h) => h.emit('planet.captured', action.payload));
    api.onAction('test.arrived', (action, h) => h.emit('fleet.arrived', action.payload));
  },
};

const kernel = createKernel([missionFactsModule, bell]);
const ctx = (now: number): Context => ({ now, data, config: { timeScale: 1 } as MatchConfig });
const player = (id: string): Player => ({ id, name: id, faction: 'x', status: 'active', resources: {} });
const planet = (id: string, owner: string | null, traits: string[] = []): Planet => ({
  id,
  owner,
  position: { x: 0, y: 0 },
  resources: {},
  buildings: [],
  garrison: [],
  traits,
});
const fleet = (id: string, owner: string, units: Array<[string, number]>): Fleet => ({
  id,
  owner,
  location: 'safe',
  movement: null,
  units: units.map(([unit, count]) => ({ unit, count })),
  traits: [],
});

function world(fleets: Fleet[] = []): GameState {
  const base = createInitialState({ seed: 'mf', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...base,
    players: { p1: player('p1'), swarm: player('swarm') },
    planets: {
      safe: planet('safe', 'p1', ['haven']),
      road: planet('road', 'p1'),
      beacon: planet('beacon', null),
    },
    fleets: Object.fromEntries(fleets.map((f) => [f.id, f])),
  };
}

let seq = 0;
const act = (type: string, payload: unknown): Action => ({
  id: `t:${++seq}`,
  type,
  playerId: 'p1',
  payload,
  issuedAt: 0,
});
function run(s: GameState, type: string, payload: unknown, now = 0): GameState {
  const r = kernel.applyAction(s, act(type, payload), ctx(now));
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

describe('missionFacts — удержание: с какого момента провинция в этих руках', () => {
  it('захват ставит владельца и время, перезахват начинает счёт заново', () => {
    let s = run(world(), 'test.captured', { planetId: 'beacon', owner: 'p1', from: null }, 1000);
    expect(s.missionFacts?.held?.beacon).toEqual({ owner: 'p1', since: 1000 });
    s = run(s, 'test.captured', { planetId: 'beacon', owner: 'swarm', from: 'p1' }, 2000);
    s = run(s, 'test.captured', { planetId: 'beacon', owner: 'p1', from: 'swarm' }, 5000);
    expect(s.missionFacts?.held?.beacon).toEqual({ owner: 'p1', since: 5000 });
    // Закончившаяся серия (1000→2000) запомнена — «держал подряд» не стирается потерей.
    expect(s.missionFacts?.longest?.beacon).toEqual({ p1: 1000, swarm: 3000 });
  });
});

describe('missionFacts — потерянные миры', () => {
  it('захват у прежнего владельца записывает потерю; отбить назад её не отменяет', () => {
    let s = run(world(), 'test.captured', { planetId: 'road', owner: 'swarm', from: 'p1' });
    s = run(s, 'test.captured', { planetId: 'road', owner: 'p1', from: 'swarm' });
    expect(s.missionFacts?.fallen?.p1).toEqual(['road']);
    expect(s.missionFacts?.fallen?.swarm).toEqual(['road']);
  });

  it('занятие ничьего мира потерей не считается', () => {
    const s = run(world(), 'test.captured', { planetId: 'beacon', owner: 'p1', from: null });
    expect(s.missionFacts?.fallen).toBeUndefined();
  });
});

describe('missionFacts — эвакуация', () => {
  it('беженцы в своём убежище уходят из флота в счёт игрока; флот без них остаётся', () => {
    const s = run(world([fleet('f', 'p1', [['transport', 3], ['cruiser', 1]])]), 'test.arrived', { fleetId: 'f', at: 'safe' });
    expect(s.missionFacts?.evacuated?.p1).toBe(3);
    expect(s.fleets.f?.units).toEqual([{ unit: 'cruiser', count: 1 }]);
  });

  it('флот из одних беженцев после высадки исчезает', () => {
    const s = run(world([fleet('f', 'p1', [['transport', 2]])]), 'test.arrived', { fleetId: 'f', at: 'safe' });
    expect(s.missionFacts?.evacuated?.p1).toBe(2);
    expect(s.fleets.f).toBeUndefined();
  });

  it('не убежище или не своё — беженцы остаются на борту', () => {
    const road = run(world([fleet('f', 'p1', [['transport', 2]])]), 'test.arrived', { fleetId: 'f', at: 'road' });
    expect(road.fleets.f?.units).toEqual([{ unit: 'transport', count: 2 }]);
    const foreign = world([fleet('f', 'p1', [['transport', 2]])]);
    foreign.planets.safe!.owner = 'swarm';
    const s = run(foreign, 'test.arrived', { fleetId: 'f', at: 'safe' });
    expect(s.missionFacts?.evacuated).toBeUndefined();
  });
});

describe('missionFacts — ждущие флоты (беженцы появляются по прибытии)', () => {
  /** Мир, где на `road` ждут транспорты игрока: их ещё нет среди флотов матча. */
  function waiting(fleets: Fleet[]): GameState {
    const s = world(fleets);
    s.planets.road!.awaitingFleets = [{ ...fleet('evac', 'p1', [['transport', 3]]), location: 'road' }];
    return s;
  }
  const arrive = (s: GameState, id: string, at = 'road'): GameState => {
    s.fleets[id]!.location = at;
    return run(s, 'test.arrived', { fleetId: id, at });
  };

  it('флот владельца с живым кораблём прибыл — транспорты входят в игру под своим id', () => {
    const r = kernel.applyAction(
      (() => {
        const s = waiting([fleet('f', 'p1', [['cruiser', 1]])]);
        s.fleets.f!.location = 'road';
        return s;
      })(),
      act('test.arrived', { fleetId: 'f', at: 'road' }),
      ctx(0),
    );
    if (!r.ok) throw new Error(r.code);
    expect(r.state.fleets.evac).toMatchObject({ owner: 'p1', location: 'road', movement: null });
    expect(r.state.fleets.evac?.units).toEqual([{ unit: 'transport', count: 3 }]);
    expect(r.state.planets.road?.awaitingFleets).toBeUndefined();
    expect(r.events.some((e) => e.type === 'fleet.joined')).toBe(true);
  });

  it('до прибытия их нет; чужой флот, десант без корабля и флот в пути их не выпускают', () => {
    expect(waiting([]).fleets.evac).toBeUndefined();
    const foreign = arrive(waiting([fleet('s', 'swarm', [['cruiser', 1]])]), 's');
    expect(foreign.fleets.evac).toBeUndefined();
    const troops = arrive(waiting([fleet('g', 'p1', [['trooper', 4]])]), 'g');
    expect(troops.fleets.evac).toBeUndefined();
    const moving = waiting([fleet('m', 'p1', [['cruiser', 1]])]);
    moving.fleets.m!.movement = { to: 'beacon' } as unknown as Fleet['movement'];
    expect(arrive(moving, 'm').fleets.evac).toBeUndefined();
  });

  it('прибытие в другую провинцию их не выпускает', () => {
    const s = arrive(waiting([fleet('f', 'p1', [['cruiser', 1]])]), 'f', 'beacon');
    expect(s.fleets.evac).toBeUndefined();
    expect(s.planets.road?.awaitingFleets).toHaveLength(1);
  });
});

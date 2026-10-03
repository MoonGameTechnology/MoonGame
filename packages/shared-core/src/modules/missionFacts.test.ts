import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { missionFactsModule } from './missionFacts';
import type { GameModule } from '../kernel/module';
import { createInitialState, type Fleet, type GameState, type Planet, type Player } from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, Context, MatchConfig } from '../action/types';
import { setStance } from '../state/diplomacy';
import { visibleState } from '../state/visibility';

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

  it('прибыл флот союзника — транспорты игрока входят в игру; мир — ещё не союз (PVR-8.4)', () => {
    const allied = (stance: 'alliance' | 'peace'): GameState => {
      const s = waiting([fleet('a', 'ally', [['cruiser', 1]])]);
      s.players.ally = player('ally');
      setStance(s, 'p1', 'ally', stance);
      return s;
    };
    const s = arrive(allied('alliance'), 'a');
    expect(s.fleets.evac).toMatchObject({ owner: 'p1', location: 'road' });
    expect(s.planets.road?.awaitingFleets).toBeUndefined();
    expect(arrive(allied('peace'), 'a').fleets.evac).toBeUndefined();
  });
});

describe('missionFacts — сведения о месте эпизода (глава VI §8.4, PVR-8.4)', () => {
  /** Доки далеко от базы: их не видно, пока туда не придёт флот игрока или союзника. */
  function far(fleets: Fleet[]): GameState {
    const s = world(fleets);
    s.players.ally = { ...player('ally'), npc: 'neutral' };
    s.pve = { waveNumber: 1, totalWaves: 3, npcPlayerId: 'swarm' };
    s.planets.docks = { ...planet('docks', 'swarm', ['refuge']), position: { x: 9000, y: 0 } };
    s.planets.ally_camp = { ...planet('ally_camp', 'ally'), position: { x: -9000, y: 0 } };
    setStance(s, 'p1', 'ally', 'alliance');
    return s;
  }
  const at = (f: Fleet, location: string): Fleet => ({ ...f, location });
  const arrive = (s: GameState, id: string): ReturnType<typeof kernel.applyAction> => {
    s.fleets[id]!.location = 'docks';
    return kernel.applyAction(s, act('test.arrived', { fleetId: id, at: 'docks' }), ctx(0));
  };

  it('на старте доков не знает никто; флот игрока опознал их — факт и событие', () => {
    const s = far([fleet('f', 'p1', [['cruiser', 1]])]);
    expect(s.missionFacts?.found).toBeUndefined();
    const r = arrive(s, 'f');
    if (!r.ok) throw new Error(r.code);
    expect(r.state.missionFacts?.found).toEqual({ p1: ['docks'] });
    expect(r.events.filter((e) => e.type === 'refuge.found').map((e) => e.payload)).toEqual([
      { owner: 'p1', at: 'docks' },
    ]);
    // Сведения — его: сетевой клиент видит свои (метки задач читают их), чужому не достаются.
    expect(visibleState(r.state, 'p1', data).missionFacts?.found).toEqual({ p1: ['docks'] });
    expect(visibleState(r.state, 'swarm', data).missionFacts?.found).toBeUndefined();
  });

  it('доки опознал союзник — сведения получает игрок; житель карты своей записи не ведёт', () => {
    const r = arrive(far([fleet('a', 'ally', [['cruiser', 1]])]), 'a');
    if (!r.ok) throw new Error(r.code);
    expect(r.state.missionFacts?.found).toEqual({ p1: ['docks'] });
  });

  it('эпизод — один раз: второй взгляд и потеря обзора факта не меняют', () => {
    const first = arrive(far([fleet('f', 'p1', [['cruiser', 1]])]), 'f');
    if (!first.ok) throw new Error(first.code);
    const again = arrive(first.state, 'f');
    if (!again.ok) throw new Error(again.code);
    expect(again.events.some((e) => e.type === 'refuge.found')).toBe(false);
    const away = again.state;
    away.fleets.f = at(away.fleets.f!, 'safe');
    const later = kernel.advanceTo(away, ctx(3_600_000));
    if (!later.ok) throw new Error(later.code);
    expect(later.state.missionFacts?.found).toEqual({ p1: ['docks'] });
  });

  it('враг штурма у доков сведений никому не даёт; ход часов открывает то, что видно', () => {
    const swarm = arrive(far([fleet('s', 'swarm', [['cruiser', 1]])]), 's');
    if (!swarm.ok) throw new Error(swarm.code);
    expect(swarm.state.missionFacts?.found).toBeUndefined();
    // Флот игрока уже стоит у доков: сведения приходят с ходом часов, без прибытия.
    const r = kernel.advanceTo(far([at(fleet('f', 'p1', [['cruiser', 1]]), 'docks')]), ctx(1000));
    if (!r.ok) throw new Error(r.code);
    expect(r.state.missionFacts?.found).toEqual({ p1: ['docks'] });
  });
});

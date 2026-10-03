import { describe, it, expect } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { operationModule, operationStatus, forceHp } from './operation';
import { victoryModule } from './victory';
import { missionFactsModule } from './missionFacts';
import type { GameModule } from '../kernel/module';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
  type UnitStack,
} from '../state/gameState';
import { setStance } from '../state/diplomacy';
import { parseGameData, type GameData } from '../data/schemas';
import type { Context, MatchConfig } from '../action/types';

// Контракт операции главы VI (PVR-8.3, §8.8): три результата вместе выигрывают главу, ни один
// по отдельности — нет; соединения учитываются через слияние и деление, разгром навсегда;
// беженцев стало меньше порога — поражение.

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    mother: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 5, hp: 50 } },
    drone: { faction: 'x', domain: 'space', stats: { attack: 1, defense: 1, speed: 5, hp: 5 } },
    transport: {
      faction: 'x',
      domain: 'space',
      traits: ['evacuee'],
      stats: { attack: 0, defense: 1, speed: 5, hp: 20 },
    },
    marine: { faction: 'x', domain: 'ground', stats: { attack: 2, defense: 2, speed: 0, hp: 10 } },
  },
  technologies: {},
  factions: { x: { name: 'X' } },
  buildings: {},
  events: {},
  modes: { plain: { name: 'Plain' } },
});

/** Звонок — поднимает события так же, как их поднимают бой, захват и флот. */
const bell: GameModule = {
  id: 'test-bell',
  version: '1.0.0',
  setup(api) {
    api.onAction('test.emit', (action, h) => {
      const { type, payload } = action.payload as { type: string; payload: unknown };
      h.emit(type, payload);
    });
  },
};

// Порядок как в списках сервера и прототипа: факты миссии, затем победа, затем операция.
const kernel = createKernel([missionFactsModule, victoryModule, operationModule, bell]);
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
const fleet = (id: string, owner: string, location: string, units: UnitStack[]): Fleet => ({
  id,
  owner,
  location,
  movement: null,
  units,
  traits: [],
});

/** Мир штурма: два очага и гнездо Роя, два соединения (корпус 100 и 60), четыре
 *  транспорта ждут в доках, порог эвакуации — три. */
function world(): GameState {
  const base = createInitialState({ seed: 'op', version: { data: '0.1.0', manifest: '1' } });
  const s: GameState = {
    ...base,
    players: { p1: player('p1'), swarm: player('swarm', { ai: true }) },
    planets: {
      base: planet('base', { owner: 'p1', traits: ['haven'] }),
      hive: planet('hive', { owner: 'swarm' }),
      foundry: planet('foundry', { owner: 'swarm' }),
      nest: planet('nest', { owner: 'swarm' }),
      docks: planet('docks', {
        awaitingFleets: [fleet('evac', 'p1', 'docks', [{ unit: 'transport', count: 4 }])],
      }),
    },
    fleets: {
      guard: fleet('guard', 'swarm', 'hive', [{ unit: 'mother', count: 2 }]),
      host: fleet('host', 'swarm', 'nest', [
        { unit: 'mother', count: 1 },
        { unit: 'drone', count: 2 },
      ]),
    },
    pve: { waveNumber: 1, totalWaves: 10, npcPlayerId: 'swarm' },
    operation: {
      production: ['hive', 'foundry'],
      forces: { guard: { fleets: ['guard'], hp: 100 }, host: { fleets: ['host'], hp: 60 } },
      breakAt: 0.2,
      evacuate: 3,
    },
  };
  setStance(s, 'p1', 'swarm', 'war');
  return s;
}

let seq = 0;
/** Поднять событие мира в миг `now`. */
function ring(s: GameState, type: string, payload: unknown = {}, now = 1000) {
  const r = kernel.applyAction(
    s,
    {
      id: `t:${++seq}`,
      type: 'test.emit',
      playerId: 'p1',
      payload: { type, payload },
      issuedAt: now,
    },
    ctx(now),
  );
  if (!r.ok) throw new Error(r.code);
  return r;
}

const owned = (s: GameState, owner: string, ...ids: string[]): GameState => ({
  ...s,
  planets: {
    ...s.planets,
    ...Object.fromEntries(ids.map((id) => [id, { ...s.planets[id]!, owner }])),
  },
});
const withFleets = (s: GameState, ...fleets: Fleet[]): GameState => ({
  ...s,
  fleets: { ...s.fleets, ...Object.fromEntries(fleets.map((f) => [f.id, f])) },
});
const without = (s: GameState, ...ids: string[]): GameState => {
  const fleets = { ...s.fleets };
  for (const id of ids) delete fleets[id];
  return { ...s, fleets };
};
const delivered = (s: GameState, n: number): GameState => ({
  ...s,
  missionFacts: { ...s.missionFacts, evacuated: { p1: n } },
});
/** Захват очагов: владелец сменился, и по каждому поднят `planet.captured`, как его шлёт бой
 *  (`missionFacts` пишет по нему факт удержания). */
function capture(s: GameState, owner: string, ...ids: string[]): GameState {
  for (const id of ids) {
    const from = s.planets[id]!.owner;
    s = ring(owned(s, owner, id), 'planet.captured', { planetId: id, owner, from }).state;
  }
  return s;
}

/** Три результата по отдельности — правки мира, как их оставили бы бой, захват и доставка. */
const RESULTS = {
  production: (s: GameState) => capture(s, 'p1', 'hive', 'foundry'),
  forces: (s: GameState) => ring(without(s, 'guard', 'host'), 'fleet.destroyed').state,
  evacuation: (s: GameState) => ring(delivered(s, 3), 'evac.delivered').state,
} as const;
type Result = keyof typeof RESULTS;

describe('контракт операции — учёт соединений (PVR-8.3)', () => {
  it('корпус соединения — Σ count × hp его кораблей, десант не в счёт', () => {
    const s = world();
    s.fleets.host!.landing = [{ unit: 'marine', count: 5 }];
    expect(forceHp(s, data, s.operation!.forces.host!)).toBe(60);
    expect(forceHp(s, data, s.operation!.forces.guard!)).toBe(100);
  });

  it('деление тянет учёт на отделённый флот, слияние переносит его в принимающий', () => {
    let s = withFleets(
      world(),
      fleet('guard-2', 'swarm', 'hive', [{ unit: 'mother', count: 1 }]),
      fleet('wave', 'swarm', 'hive', [{ unit: 'drone', count: 3 }]),
    );
    s = ring(s, 'fleet.split', { from: 'guard', to: 'guard-2' }).state;
    expect(s.operation!.forces.guard!.fleets).toEqual(['guard', 'guard-2']);
    s = ring(s, 'fleet.merged', { from: 'guard', into: 'wave' }).state;
    expect(s.operation!.forces.guard!.fleets).toEqual(['guard-2', 'wave']);
    // Чужое слияние учёта не трогает.
    expect(s.operation!.forces.host!.fleets).toEqual(['host']);
  });

  it('подкрепления, влитые в соединение, — его часть: разгром требует бить и их', () => {
    // В охрану влилась волна из четырёх маток: корпус 300 при стартовых 100.
    let s = world();
    s.fleets.guard!.units = [{ unit: 'mother', count: 6 }];
    s = ring(s, 'fleet.merged', { from: 'wave', into: 'guard' }).state;
    expect(s.operation!.forces.guard!.fleets).toEqual(['guard']);
    // Бой оставил одну матку: 50 больше пятой части стартовых 100 — соединение живо.
    s.fleets.guard!.units = [{ unit: 'mother', count: 1 }];
    s = ring(s, 'battle.resolved').state;
    expect(s.operation!.forces.guard!.brokenAt).toBeUndefined();
  });

  it('остаток не больше порога — соединение разгромлено: спрятавшийся разведчик главу не держит', () => {
    let s = withFleets(world(), fleet('scout', 'swarm', 'nest', [{ unit: 'drone', count: 1 }]));
    s = ring(s, 'fleet.split', { from: 'host', to: 'scout' }).state;
    const r = ring(without(s, 'host'), 'fleet.destroyed', { fleetId: 'host' }, 2000);
    // От 60 остался разведчик на 5: это меньше пятой части (12).
    expect(r.state.operation!.forces.host).toEqual({ fleets: ['scout'], hp: 60, brokenAt: 2000 });
    // Событие — каждому игроку стороны штурма: по `owner` его пропускает туман.
    expect(r.events.find((e) => e.type === 'operation.force.broken')?.payload).toEqual({
      owner: 'p1',
      force: 'host',
    });
    expect(r.state.fleets.scout).toBeDefined();
  });

  it('разгром — навсегда: подкрепления, влитые в остаток, соединение не воскрешают', () => {
    let s = withFleets(world(), fleet('scout', 'swarm', 'nest', [{ unit: 'drone', count: 1 }]));
    s = ring(s, 'fleet.split', { from: 'host', to: 'scout' }).state;
    s = ring(without(s, 'host'), 'fleet.destroyed', {}, 2000).state;
    s.fleets.scout!.units = [{ unit: 'mother', count: 4 }];
    const r = ring(s, 'fleet.merged', { from: 'wave', into: 'scout' }, 3000);
    const again = ring(r.state, 'battle.resolved', {}, 3000);
    expect(again.state.operation!.forces.host!.brokenAt).toBe(2000);
    expect(again.events.map((e) => e.type)).not.toContain('operation.force.broken');
  });
});

describe('контракт операции — исход главы (PVR-8.3)', () => {
  it('на старте: оба очага у врага, разгромов нет, беженцев можно довести четырёх', () => {
    expect(operationStatus(world(), data)).toEqual({
      held: ['hive', 'foundry'],
      broken: [],
      forces: 2,
      delivered: 0,
      need: 3,
      possible: 4,
      done: false,
      lost: false,
    });
  });

  it('ни один результат по отдельности главу не выигрывает — и ни одна пара', () => {
    const names = Object.keys(RESULTS) as Result[];
    const subsets = [
      ...names.map((a) => [a]),
      ...names.flatMap((a, i) => names.slice(i + 1).map((b) => [a, b])),
    ];
    for (const subset of subsets) {
      let s = world();
      for (const name of subset) s = RESULTS[name](s);
      expect(s.match.status, subset.join('+')).toBe('ongoing');
      expect(s.operation!.completedAt, subset.join('+')).toBeUndefined();
    }
  });

  it('три результата вместе — победа тех, кто стоит, в любом порядке', () => {
    const orders: Result[][] = [
      ['production', 'forces', 'evacuation'],
      ['production', 'evacuation', 'forces'],
      ['forces', 'production', 'evacuation'],
      ['forces', 'evacuation', 'production'],
      ['evacuation', 'production', 'forces'],
      ['evacuation', 'forces', 'production'],
    ];
    for (const order of orders) {
      let s = world();
      for (const [i, name] of order.entries()) {
        s = RESULTS[name](s);
        expect(s.match.status, `${order.join('→')} после ${i + 1}`).toBe(
          i === order.length - 1 ? 'ended' : 'ongoing',
        );
      }
      expect(s.match).toMatchObject({ reason: 'pve-operation', winner: 'p1' });
      expect(s.operation!.completedAt).toBe(1000);
    }
  });

  it('союзник берёт очаги наравне с игроком', () => {
    let s = world();
    s.players.ally = player('ally', { npc: 'neutral', ai: true });
    s = capture(s, 'ally', 'hive', 'foundry');
    expect(operationStatus(s, data)!.held).toEqual([]);
  });

  it('очаг, отбитый врагом назад, снова действует', () => {
    let s = RESULTS.production(world());
    s = capture(s, 'swarm', 'foundry');
    // Факт захвата у очага уже есть: правило смотрит, кто держит очаг сейчас.
    expect(s.missionFacts?.held?.foundry?.owner).toBe('swarm');
    s = RESULTS.evacuation(RESULTS.forces(s));
    expect(s.match.status).toBe('ongoing');
    expect(operationStatus(s, data)!.held).toEqual(['foundry']);
    s = RESULTS.production(s);
    expect(s.match).toMatchObject({ status: 'ended', reason: 'pve-operation' });
  });

  it('беженцев стало меньше порога — поражение в тот же миг', () => {
    // Транспорты вышли из доков (как по прибытии флота игрока), бой забрал два из четырёх.
    let s = world();
    s.planets.docks = { ...s.planets.docks!, awaitingFleets: undefined };
    s = withFleets(s, fleet('evac', 'p1', 'docks', [{ unit: 'transport', count: 4 }]));
    s = ring(s, 'fleet.joined').state;
    expect(operationStatus(s, data)!.possible).toBe(4);
    s.fleets.evac!.units = [{ unit: 'transport', count: 2 }];
    const r = ring(s, 'battle.resolved', {}, 5000);
    expect(r.state.operation!.lostAt).toBe(5000);
    expect(r.state.match).toMatchObject({
      status: 'ended',
      reason: 'pve-evac-lost',
      winner: 'swarm',
    });
  });

  it('доставленные в счёт возможного: один в убежище и двое в пути — ещё не поражение', () => {
    let s = delivered(world(), 1);
    s.planets.docks = { ...s.planets.docks!, awaitingFleets: undefined };
    s = withFleets(s, fleet('evac', 'p1', 'docks', [{ unit: 'transport', count: 2 }]));
    const r = ring(s, 'battle.resolved');
    expect(r.state.match.status).toBe('ongoing');
    expect(operationStatus(r.state, data)).toMatchObject({
      delivered: 1,
      possible: 3,
      lost: false,
    });
  });

  it('волны и удержание главу с контрактом не выигрывают — а без контракта выиграли бы', () => {
    const lastWave = (s: GameState): GameState => ({
      ...s,
      pve: { ...s.pve!, waveNumber: 10, holdUntil: 0 },
    });
    const withContract = ring(lastWave(world()), 'time.advanced', { from: 0, to: 1000 });
    expect(withContract.state.match.status).toBe('ongoing');
    const { operation: _contract, ...plain } = lastWave(world());
    void _contract;
    const withoutContract = ring(plain, 'time.advanced', { from: 0, to: 1000 });
    expect(withoutContract.state.match).toMatchObject({ status: 'ended', reason: 'pve-cleared' });
  });

  it('без штурма контракт инертен: врага не знаем — судить не против кого', () => {
    // Без PvE мир судят гонки партии, а не контракт: здесь — только модуль операции.
    const alone = createKernel([operationModule, bell]);
    const { pve: _pve, ...calm } = world();
    void _pve;
    const ready = delivered(without(owned(calm, 'p1', 'hive', 'foundry'), 'guard', 'host'), 3);
    const r = alone.applyAction(
      ready,
      {
        id: 'calm',
        type: 'test.emit',
        playerId: 'p1',
        payload: { type: 'planet.captured' },
        issuedAt: 0,
      },
      ctx(1000),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.operation!.completedAt).toBeUndefined();
    expect(r.events.map((e) => e.type)).toEqual(['planet.captured']);
    expect(operationStatus(r.state, data)).toBeNull();
  });

  it('вход не мутируется', () => {
    const s = withFleets(world(), fleet('scout', 'swarm', 'nest', [{ unit: 'drone', count: 1 }]));
    const before = JSON.stringify(s);
    ring(s, 'fleet.split', { from: 'host', to: 'scout' });
    ring(without(s, 'host'), 'fleet.destroyed');
    RESULTS.production(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

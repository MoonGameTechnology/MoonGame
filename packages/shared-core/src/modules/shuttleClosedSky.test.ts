/**
 * ЗАКРЫТОЕ НЕБО В ПРИКАЗАХ (решение владельца 2026-11-19: «пролетающая авиация через звезду
 * или чёрную дыру выглядела бы странно»). Авиация не летает над звездой, чёрной дырой и их
 * кольцом: каждый путь, который эскадра или ракета проложила бы над ними, ядро отбивает
 * `E_SKY_CLOSED`, а без приказа — погоня и поиск запасной базы — над ними не идёт.
 *
 * Каждый запрет проверен парой: тот же приказ мимо звезды принимается, а тот же мир без
 * звезды (вид провинции снят) даёт прежний исход — так видно, что отказ дало небо, а не
 * дальность или что-то третье.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { shuttleModule } from './shuttle';
import { movementModule } from './movement';
import { constructionModule } from './construction';
import { rocketMinesModule } from './rocketMines';
import { missilesModule } from './missiles';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
  type Squadron,
} from '../state/gameState';
import { setStance } from '../state/diplomacy';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, DomainEvent } from '../action/types';
import { MS_PER_HOUR } from '../util/time';

const H = MS_PER_HOUR;
const shuttle = (stats: Record<string, number>) => ({ faction: 'x', traits: ['shuttle'], stats });

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    cruiser: { faction: 'x', stats: { attack: 5, defense: 5, speed: 6, hp: 100 } },
    // Радиус удара 250, перелёт 500; 100 ед/час.
    bomber: shuttle({
      attack: 20,
      defense: 4,
      speed: 100,
      hp: 16,
      strikeRange: 250,
      siegeDamage: 8,
      patrolHours: 3,
      patrolRadius: 60,
    }),
    // Поводок 450: в погоне ниже цель на всём пути не уходит за него.
    hunter: shuttle({
      attack: 12,
      defense: 3,
      speed: 100,
      hp: 10,
      strikeRange: 450,
      chaseRadius: 20,
    }),
    // Носитель: трюм на две машины, 100 ед/час.
    carrier: { faction: 'x', stats: { attack: 3, defense: 9, speed: 100, hp: 40, cargoCapacity: 2 } },
    cruise: {
      faction: 'neutral',
      traits: ['shuttle', 'missile'],
      stats: { attack: 0, defense: 0, speed: 240, hp: 12, strikeRange: 240 },
      signature: 13,
      cost: { metal: 10 },
      buildTimeHours: 0,
      warhead: { damage: 100, blastRadius: 12 },
    },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 6 },
  },
  events: {},
  sectorKinds: {
    star: { traversable: false, capturable: false, overflight: false },
  },
});

const kernel = createKernel([shuttleModule]);

const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: { metal: 1000 },
});

const planet = (id: string, owner: string | null, x: number, y: number, port = false): Planet => ({
  id,
  owner,
  position: { x, y },
  resources: {},
  buildings: port ? [{ type: 'spaceport', level: 1, hp: 30 }] : [],
  garrison: [],
  traits: [],
});

const star = (id: string, x: number, y: number): Planet => ({
  ...planet(id, null, x, y),
  kind: 'star',
});

/** Тот же мир, но звезда — обычная провинция: так видно, что отказ дало именно небо. */
const unstarred = (s: GameState): GameState => ({
  ...s,
  planets: Object.fromEntries(
    Object.entries(s.planets).map(([id, p]) => {
      const { kind: _kind, ...rest } = p;
      return [id, rest];
    }),
  ),
});

const sq = (id: string, unit: string, count: number): Squadron => ({
  id,
  units: [{ unit, count }],
});

/**
 * Свой порт A(0,0), за ним звезда S(150,0). За звездой — чужой мир B(250,0) и свой порт
 * D(300,60); мимо неё — чужой мир C(0,220) и свой порт F(−300,0). Всё в дальности:
 * B — 250 (ровно радиус удара), D — 306, F — 300 (перелёт до 500).
 */
function world(): GameState {
  const s = createInitialState({ seed: 'sky', version: { data: '0.1.0', manifest: '1' } });
  const home = planet('A', 'p1', 0, 0, true);
  home.hangar = [sq('sq:b', 'bomber', 2)];
  return {
    ...s,
    sight: { world: 5000, fleet: 5000, radarScale: 1 },
    players: { p1: player('p1'), p2: player('p2') },
    planets: {
      A: home,
      S: star('S', 150, 0),
      B: planet('B', 'p2', 250, 0),
      C: planet('C', 'p2', 0, 220),
      D: planet('D', 'p1', 300, 60, true),
      F: planet('F', 'p1', -300, 0, true),
    },
    fleets: {},
    heroes: {},
    battles: {},
  };
}

let seq = 0;
const act = (type: string, payload: Record<string, unknown>, playerId = 'p1'): Action => ({
  id: `a:${seq++}`,
  type,
  playerId,
  payload,
  issuedAt: 0,
});
const strikeOn = (targetPlanetId: string): Action =>
  act('shuttle.strike', { planetId: 'A', squadronId: 'sq:b', targetPlanetId });
const patrolAt = (x: number, y: number): Action =>
  act('shuttle.patrol', { planetId: 'A', squadronId: 'sq:b', at: { x, y } });
const ferryTo = (toPlanetId: string): Action =>
  act('shuttle.relocate', { planetId: 'A', squadronId: 'sq:b', toPlanetId });

function apply(s: GameState, a: Action): GameState {
  const r = kernel.applyAction(s, a, { now: s.time, data });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
function code(s: GameState, a: Action): string | null {
  const r = kernel.applyAction(s, a, { now: s.time, data });
  return r.ok ? null : r.code;
}
function run(s: GameState, hours: number): { state: GameState; events: DomainEvent[] } {
  const r = kernel.advanceTo(s, { now: hours * H, data });
  if (!r.ok) throw new Error('advance failed');
  return { state: r.state, events: r.events };
}
const payloads = (events: DomainEvent[], type: string): Array<Record<string, unknown>> =>
  events.filter((e) => e.type === type).map((e) => e.payload as Record<string, unknown>);
const only = (s: GameState) => (s.strikes ?? [])[0]!;

describe('закрытое небо — приказы из ангара', () => {
  it('УДАР ЗА ЗВЕЗДУ отбит, удар мимо неё уходит; без звезды тот же удар уходит', () => {
    expect(code(world(), strikeOn('B'))).toBe('E_SKY_CLOSED');
    expect(code(world(), strikeOn('C'))).toBeNull();
    expect(code(unstarred(world()), strikeOn('B'))).toBeNull();
  });

  it('ПАТРУЛЬ не встаёт над звездой и не летит за неё; рядом со своим миром встаёт', () => {
    expect(code(world(), patrolAt(150, 0))).toBe('E_SKY_CLOSED'); // над самой звездой
    expect(code(world(), patrolAt(230, 0))).toBe('E_SKY_CLOSED'); // за ней, над B
    expect(code(world(), patrolAt(0, 150))).toBeNull();
    expect(code(unstarred(world()), patrolAt(230, 0))).toBeNull();
  });

  it('ПЕРЕЛЁТ на базу за звездой отбит, на базу мимо неё — уходит', () => {
    expect(code(world(), ferryTo('D'))).toBe('E_SKY_CLOSED');
    expect(code(world(), ferryTo('F'))).toBeNull();
    expect(code(unstarred(world()), ferryTo('D'))).toBeNull();
  });
});

describe('закрытое небо — приказы эскадре в воздухе', () => {
  /** Удар A → C в воздухе: через час эскадра в точке (0, 100). */
  const aloft = (s = world()) => run(apply(s, strikeOn('C')), 1).state;

  it('НОВАЯ ЦЕЛЬ ЗА ЗВЕЗДОЙ отбита; без звезды та же цель принимается', () => {
    const s = aloft();
    expect(only(s).at ?? only(s).to).toBeDefined();
    const redirect = act('shuttle.redirect', { strikeId: only(s).id, targetPlanetId: 'B' });
    expect(code(s, redirect)).toBe('E_SKY_CLOSED');
    const open = aloft(unstarred(world()));
    expect(
      code(open, act('shuttle.redirect', { strikeId: only(open).id, targetPlanetId: 'B' })),
    ).toBeNull();
  });

  it('НОВАЯ ТОЧКА ПАТРУЛЯ над звездой отбита, в стороне от неё — принимается', () => {
    const s = aloft();
    const to = (x: number, y: number) =>
      act('shuttle.redirect', { strikeId: only(s).id, at: { x, y } });
    expect(code(s, to(150, 0))).toBe('E_SKY_CLOSED');
    expect(code(s, to(-100, 100))).toBeNull();
  });

  it('ПЕРЕЛЁТ ИЗ ВОЗДУХА на базу за звездой отбит, на базу мимо неё — принимается', () => {
    const s = aloft();
    const to = (toPlanetId: string) =>
      act('shuttle.relocate', { strikeId: only(s).id, toPlanetId });
    expect(code(s, to('D'))).toBe('E_SKY_CLOSED');
    expect(code(s, to('F'))).toBeNull();
  });
});

describe('закрытое небо — без приказа', () => {
  it('ДОМ ПОТЕРЯН: запасная база — ближайшая, к которой путь не лежит над звездой', () => {
    // Удар по C, и пока эскадра в воздухе, A захвачен. От C до D — 340, но через звезду,
    // до F — 372 мимо неё.
    const lose = (s: GameState): GameState => ({
      ...s,
      planets: { ...s.planets, A: { ...s.planets.A!, owner: 'p2', hangar: [] } },
    });
    const diverted = (s: GameState) =>
      payloads(run(lose(apply(s, strikeOn('C'))), 4).events, 'shuttle.diverted');
    expect(diverted(world())).toEqual([expect.objectContaining({ fromId: 'A', baseId: 'F' })]);
    expect(diverted(unstarred(world()))).toEqual([
      expect.objectContaining({ fromId: 'A', baseId: 'D' }),
    ]);
  });

  /**
   * Свой порт A(0,0) с охотниками, звезда S(200,0); чужой крейсер идёт от M(0,200) к
   * N(400,0) за 4 часа — быстрее эскадры, и через пару часов он уже за звездой.
   */
  function chase(): GameState {
    const s = createInitialState({ seed: 'sky-chase', version: { data: '0.1.0', manifest: '1' } });
    const home = planet('A', 'p1', 0, 0, true);
    home.hangar = [sq('sq:h', 'hunter', 2)];
    const runner: Fleet = {
      id: 'E1',
      owner: 'p2',
      location: null,
      movement: { from: 'M', to: 'N', departedAt: 0, arrivesAt: 4 * H },
      units: [{ unit: 'cruiser', count: 1 }],
      traits: [],
      battleId: null,
    };
    return {
      ...s,
      sight: { world: 5000, fleet: 5000, radarScale: 1 },
      players: { p1: player('p1'), p2: player('p2') },
      planets: {
        A: home,
        S: star('S', 200, 0),
        M: planet('M', 'p2', 0, 200),
        N: planet('N', 'p2', 400, 0),
      },
      fleets: { E1: runner },
      heroes: {},
      battles: {},
    };
  }
  const hunt = act('shuttle.strike', { planetId: 'A', squadronId: 'sq:h', targetFleetId: 'E1' });

  it('ПОГОНЯ: цель ушла за звезду — эскадра не летит за ней над звездой, а поворачивает домой', () => {
    const after = run(apply(chase(), hunt), 10).state;
    expect(after.fleets.E1?.units[0]?.hp).toBeUndefined(); // цел
    expect(after.strikes ?? []).toHaveLength(0); // вернулась
    expect(after.planets.A?.hangar?.[0]?.units[0]?.count).toBe(2);
    // Без звезды та же погоня догоняет и бьёт.
    const open = run(apply(unstarred(chase()), hunt), 10).state;
    expect(open.fleets.E1?.units[0]?.hp).toBeLessThan(100);
  });
});

describe('закрытое небо — путь домой', () => {
  /**
   * Носитель CV идёт от W(−200,0) к E(200,0) за 4 часа и бьёт эскадрой с борта чужой мир
   * C(−200,200). Через 2 часа удар состоялся, а носитель уже в (0,0): прямой путь от C к нему
   * лежит над звездой S(−60,100). Свой порт F(−300,250) — в стороне, путь к нему открыт.
   */
  function carrierWorld(withPort = true): GameState {
    const s = createInitialState({ seed: 'sky-home', version: { data: '0.1.0', manifest: '1' } });
    const cv: Fleet = {
      id: 'CV',
      owner: 'p1',
      location: null,
      movement: { from: 'W', to: 'E', departedAt: 0, arrivesAt: 4 * H },
      units: [{ unit: 'carrier', count: 1 }],
      hangar: [sq('sq:b', 'bomber', 2)],
      traits: [],
      battleId: null,
    };
    return {
      ...s,
      sight: { world: 5000, fleet: 5000, radarScale: 1 },
      players: { p1: player('p1'), p2: player('p2') },
      planets: {
        W: planet('W', null, -200, 0),
        E: planet('E', null, 200, 0),
        S: star('S', -60, 100),
        C: planet('C', 'p2', -200, 200),
        ...(withPort ? { F: planet('F', 'p1', -300, 250, true) } : {}),
      },
      fleets: { CV: cv },
      heroes: {},
      battles: {},
    };
  }
  const strikeC = act('shuttle.strike', { fleetId: 'CV', squadronId: 'sq:b', targetPlanetId: 'C' });

  it('НОСИТЕЛЬ УШЁЛ ЗА ЗВЕЗДУ: эскадра садится на ближайшую базу, путь к которой открыт', () => {
    const { state, events } = run(apply(carrierWorld(), strikeC), 6);
    expect(payloads(events, 'shuttle.diverted')).toEqual([
      expect.objectContaining({ fromId: 'CV', fromKind: 'fleet', baseId: 'F', baseKind: 'planet' }),
    ]);
    expect(state.planets.F?.hangar?.[0]?.units[0]?.count).toBe(2);
    // Без звезды та же эскадра возвращается на носитель.
    const open = run(apply(unstarred(carrierWorld()), strikeC), 6);
    expect(payloads(open.events, 'shuttle.diverted')).toEqual([]);
    expect(open.state.fleets.CV?.hangar?.[0]?.units[0]?.count).toBe(2);
  });

  it('ОТКРЫТОЙ БАЗЫ НЕТ: эскадра летит домой как есть, а не гибнет из-за правила неба', () => {
    const { state, events } = run(apply(carrierWorld(false), strikeC), 6);
    expect(payloads(events, 'shuttle.diverted')).toEqual([]);
    expect(payloads(events, 'shuttle.lost')).toEqual([]);
    expect(state.fleets.CV?.hangar?.[0]?.units[0]?.count).toBe(2);
  });
});

describe('закрытое небо — ракета', () => {
  const missileKernel = createKernel([
    movementModule,
    constructionModule,
    shuttleModule,
    rocketMinesModule,
    missilesModule,
  ]);

  /** Порт A(0,0) с ракетами (радиус 240), звезда S(100,0); чужой флот за ней у B(200,0)
   *  и чужой флот мимо неё у C(0,200). */
  function range(): GameState {
    const s = createInitialState({ seed: 'sky-msl', version: { data: '0.1.0', manifest: '1' } });
    s.sight = { world: 5000, fleet: 5000, radarScale: 1 };
    s.players = { p1: player('p1'), p2: player('p2') };
    const A = planet('A', 'p1', 0, 0, true);
    A.hangar = [sq('sq:m', 'cruise', 3)];
    s.planets = {
      A,
      S: star('S', 100, 0),
      B: planet('B', 'p2', 200, 0),
      C: planet('C', 'p2', 0, 200),
    };
    const ship = (id: string, location: string): Fleet => ({
      id,
      owner: 'p2',
      location,
      movement: null,
      units: [{ unit: 'cruiser', count: 1 }],
      traits: [],
      battleId: null,
    });
    s.fleets = { behind: ship('behind', 'B'), clear: ship('clear', 'C') };
    setStance(s, 'p1', 'p2', 'war');
    return s;
  }
  const launch = (s: GameState, targetFleetId: string): string | null => {
    const r = missileKernel.applyAction(
      s,
      act('missile.launch', { planetId: 'A', squadronId: 'sq:m', targetFleetId }),
      { now: s.time, data },
    );
    return r.ok ? null : r.code;
  };

  it('ПУСК ПО ФЛОТУ ЗА ЗВЕЗДОЙ отбит, мимо неё — уходит; без звезды тот же пуск уходит', () => {
    expect(launch(range(), 'behind')).toBe('E_SKY_CLOSED');
    expect(launch(range(), 'clear')).toBeNull();
    expect(launch(unstarred(range()), 'behind')).toBeNull();
  });
});

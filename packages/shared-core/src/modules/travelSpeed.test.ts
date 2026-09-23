/**
 * ТЕМП ПЕРЕМЕЩЕНИЯ МАТЧА (PVR-2.3, `docs/sector-zero-roadmap.md`).
 *
 * Решение владельца 2026-09-23: в Sector Zero корабли летают впятеро быстрее, и все —
 * флоты игрока и Роя одинаково. Правило живёт в конфиге матча (`travelSpeedFactor`), а не
 * в режиме: онлайн-партия на том же `pve_waves` остаётся на ×1.
 *
 * 1. **Нога флота короче во столько же раз.** Множитель стоит в основании скорости, до
 *    хука `fleet.speed`, поэтому местность, техи и форс-марш множатся поверх него.
 * 2. **Оценки говорят то же, что ядро.** `estimateTravelHours` и `journeyEtaMs` берут ту же
 *    скорость; оценка без множителя врала бы на все пять раз.
 * 3. **Челноки ускоряются вместе с флотами.** Иначе истребитель отстал бы от фрегата, за
 *    которым охотится: цель, которую он ловил на ×1, на ×5 уходила бы от него.
 * 4. **Нет множителя — нет разницы.** Отсутствие, ноль, NaN и бесконечность читаются как ×1.
 */
import { describe, expect, it } from 'vitest';
import { createKernel } from '../kernel/kernel';
import { movementModule } from './movement';
import { shuttleModule } from './shuttle';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import {
  travelSpeedFactorOf,
  type Action,
  type ApplyResult,
  type AdvanceResult,
  type Context,
} from '../action/types';
import { estimateTravelHours, fleetTravelSpeed, journeyEtaMs } from '../state/route';

const HOUR = 3_600_000;

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    scout: { faction: 'x', stats: { attack: 1, defense: 1, speed: 10, hp: 6 } },
    cruiser: { faction: 'x', domain: 'space', stats: { attack: 5, defense: 5, speed: 6, hp: 100 } },
    interceptor: {
      faction: 'x',
      domain: 'space',
      traits: ['shuttle'],
      stats: {
        attack: 12,
        defense: 3,
        speed: 100,
        hp: 10,
        strikeRange: 180,
        chaseRadius: 20,
        fuel: 3,
        rearmRounds: 2,
      },
    },
  },
  factions: {},
  buildings: {
    spaceport: { name: 'Spaceport', cost: {}, buildTimeHours: 0, hp: 30, shuttleBay: 6 },
  },
  events: {},
});

/** Контекст матча на темпе `factor` (`undefined` — матч без множителя). */
const at = (now: number, factor?: number): Context => ({
  now,
  data,
  config: { timeScale: 1, ...(factor === undefined ? {} : { travelSpeedFactor: factor }) },
});

function ok<T extends ApplyResult | AdvanceResult>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`failed: ${r.code}`);
  return r as Extract<T, { ok: true }>;
}

const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
});

function planet(id: string, owner: string | null, x: number, links: string[] = [], y = 0): Planet {
  return {
    id,
    owner,
    position: { x, y },
    links,
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}

describe('множитель читается честно (правило 4)', () => {
  it('нет конфига или поля — ×1', () => {
    expect(travelSpeedFactorOf({})).toBe(1);
    expect(travelSpeedFactorOf({ config: { timeScale: 1 } })).toBe(1);
  });

  it('заданный — как есть', () => {
    expect(travelSpeedFactorOf({ config: { timeScale: 1, travelSpeedFactor: 5 } })).toBe(5);
  });

  it('ноль, минус, NaN и бесконечность — ×1, а не замёрзший или телепортирующийся флот', () => {
    for (const bad of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(travelSpeedFactorOf({ config: { timeScale: 1, travelSpeedFactor: bad } })).toBe(1);
    }
  });
});

describe('флот (правила 1–2)', () => {
  // A(0) — B(100) — C(300): прямые лейны без дорог, разведчик на скорости 10.
  // A→B — 10 часов на ×1 и 2 часа на ×5; A→C — 30 и 6.
  const kernel = createKernel([movementModule]);
  const world = (): GameState => {
    const s = createInitialState({ seed: 'travel', version: { data: '0.1.0', manifest: '1' } });
    const scout: Fleet = {
      id: 'f1',
      owner: 'p1',
      location: 'A',
      movement: null,
      units: [{ unit: 'scout', count: 1 }],
      traits: [],
    };
    return {
      ...s,
      planets: {
        A: planet('A', 'p1', 0, ['B']),
        B: planet('B', null, 100, ['A', 'C']),
        C: planet('C', null, 300, ['B']),
      },
      fleets: { f1: scout },
    };
  };
  const move = (to: string): Action => ({
    id: 's:p1:1',
    type: 'fleet.move',
    playerId: 'p1',
    payload: { fleetId: 'f1', to },
    issuedAt: 0,
  });

  it('скорость флота в матче — самый медленный корабль × множитель', () => {
    expect(fleetTravelSpeed(world().fleets.f1!, at(0))).toBe(10);
    expect(fleetTravelSpeed(world().fleets.f1!, at(0, 5))).toBe(50);
  });

  it('нога на ×5 впятеро короче, и флот прибывает в срок', () => {
    const slow = ok(kernel.applyAction(world(), move('B'), at(0)));
    expect(slow.state.fleets.f1!.movement!.arrivesAt).toBe(10 * HOUR);

    const fast = ok(kernel.applyAction(world(), move('B'), at(0, 5)));
    expect(fast.state.fleets.f1!.movement!.arrivesAt).toBe(2 * HOUR);
    const there = ok(kernel.advanceTo(fast.state, at(2 * HOUR, 5)));
    expect(there.state.fleets.f1!.location).toBe('B');
  });

  it('оценка пути совпадает с тем, что делает ядро', () => {
    expect(estimateTravelHours(world(), at(0), 'A', 'C', world().fleets.f1!)).toBe(30);
    expect(estimateTravelHours(world(), at(0, 5), 'A', 'C', world().fleets.f1!)).toBe(6);
    const sent = ok(kernel.applyAction(world(), move('C'), at(0, 5)));
    const done = ok(kernel.advanceTo(sent.state, at(6 * HOUR, 5)));
    expect(done.state.fleets.f1!.location).toBe('C');
  });

  it('срок прибытия идущего флота считает остаток пути на той же скорости', () => {
    const sent = ok(kernel.applyAction(world(), move('C'), at(0, 5)));
    const f = sent.state.fleets.f1!;
    // Первая нога расписана ядром (2 ч), остаток B→C — 200 на скорости 50, ещё 4 ч.
    expect(journeyEtaMs(sent.state, f, f.movement!, at(0, 5))).toBe(6 * HOUR);
  });
});

describe('челноки ускоряются вместе с флотами (правило 3)', () => {
  const kernel = createKernel([shuttleModule]);
  /** Свой порт A(0,0) с эскадрой перехватчиков и чужой крейсер, идущий B(100,0) → D(500,0)
   *  за `hours` часов — то есть со скоростью 400 / `hours`. */
  const world = (hours: number): GameState => {
    const s = createInitialState({ seed: 'travel-shu', version: { data: '0.1.0', manifest: '1' } });
    const home = planet('A', 'p1', 0);
    home.buildings = [{ type: 'spaceport', level: 1, hp: 30 }];
    home.hangar = [{ id: 'sq:hunt', units: [{ unit: 'interceptor', count: 2 }] }];
    const runner: Fleet = {
      id: 'E1',
      owner: 'p2',
      location: null,
      movement: { from: 'B', to: 'D', departedAt: 0, arrivesAt: hours * HOUR },
      units: [{ unit: 'cruiser', count: 1 }],
      traits: [],
      battleId: null,
    };
    return {
      ...s,
      players: { p1: player('p1'), p2: player('p2') },
      planets: { A: home, B: planet('B', 'p2', 100), D: planet('D', 'p2', 500) },
      fleets: { E1: runner },
      heroes: {},
      battles: {},
    };
  };
  const strike = (target: { targetFleetId: string } | { targetPlanetId: string }): Action => ({
    id: 'a1',
    type: 'shuttle.strike',
    playerId: 'p1',
    payload: { planetId: 'A', squadronId: 'sq:hunt', ...target },
    issuedAt: 0,
  });

  it('вылет к миру на ×5 впятеро короче', () => {
    // До B — 100 единиц на скорости 100: час на ×1, 12 минут на ×5.
    const slow = ok(kernel.applyAction(world(40), strike({ targetPlanetId: 'B' }), at(0)));
    expect(slow.state.strikes![0]!.arrivesAt).toBe(HOUR);
    const fast = ok(kernel.applyAction(world(40), strike({ targetPlanetId: 'B' }), at(0, 5)));
    expect(fast.state.strikes![0]!.arrivesAt).toBe(HOUR / 5);
  });

  it('цель, которую эскадра ловит на ×1, она ловит и впятеро более быструю на ×5', () => {
    // 400 единиц за 16 часов — 25 в час: эскадра на 100 догоняет.
    const plain = ok(kernel.applyAction(world(16), strike({ targetFleetId: 'E1' }), at(0)));
    const plainAfter = ok(kernel.advanceTo(plain.state, at(8 * HOUR)));
    expect(plainAfter.state.fleets.E1!.units[0]!.hp).toBeLessThan(100);

    // Та же погоня на темпе забега: цель идёт 125 в час, эскадра — 500.
    const run = ok(kernel.applyAction(world(16 / 5), strike({ targetFleetId: 'E1' }), at(0, 5)));
    const runAfter = ok(kernel.advanceTo(run.state, at(2 * HOUR, 5)));
    expect(runAfter.state.fleets.E1!.units[0]!.hp).toBeLessThan(100);
  });

  it('без множителя у челноков ускоренная цель уходит — вот почему он общий', () => {
    // Цель на 125 в час, эскадра на 100: поводок рвётся, эскадра садится пустой.
    const s = ok(kernel.applyAction(world(16 / 5), strike({ targetFleetId: 'E1' }), at(0)));
    const after = ok(kernel.advanceTo(s.state, at(8 * HOUR)));
    expect(after.state.fleets.E1!.units[0]!.hp).toBeUndefined();
    expect(after.state.strikes ?? []).toHaveLength(0);
  });
});

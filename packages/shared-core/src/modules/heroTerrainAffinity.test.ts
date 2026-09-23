import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect } from 'vitest';

import { createKernel } from '../kernel/kernel';
import { heroModule } from './hero';
import { movementModule } from './movement';
import { sectorModule } from './sector';
import {
  createInitialState,
  type Fleet,
  type GameState,
  type Planet,
  type Player,
} from '../state/gameState';
import { parseGameData, type GameData } from '../data/schemas';
import type { Action, ApplyResult, Context } from '../action/types';

/**
 * M2.8 — СРОДСТВО К СЕМЕЙСТВУ МЕСТНОСТИ, закреплённое числами.
 *
 * Решение владельца (22 сентября): навык вроде «опытного пилота» не отменяет штраф
 * местности, а ПРИБАВЛЯЕТСЯ к получившемуся числу — сперва среда замедляет флот, потом
 * пассивка выправляет результат. Порядок задан порядком модулей в ядре (инвариант №6):
 * `sectorModule` стоит раньше `heroModule`, поэтому проверять его надо на живом
 * конвейере, а не на вызове одной функции.
 *
 * Три ловушки, каждая из которых уже случалась в этом проекте, держатся тестом:
 *
 * 1. **Клетка не та.** Штраф берёт провинцию, КУДА флот входит; пассивки героя получают
 *    точку ВЫЛЕТА. Спроси условие не ту клетку — и навык сработает наоборот: даст бонус
 *    на выходе из астероидов и промолчит на входе.
 * 2. **Аура вместо своего флота.** Владелец сказал: только флот, которым управляет герой.
 *    Соседний флот того же владельца, идущий той же дорогой, не получает ничего.
 * 3. **Старые данные меняют поведение.** Пассивка без условия обязана работать как
 *    раньше — везде.
 */

const HOUR = 3_600_000;

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {
    runner: { faction: 'x', stats: { attack: 1, defense: 1, speed: 10, hp: 10 } },
  },
  factions: {},
  buildings: {},
  events: {},
  sectorKinds: { planet: { scoreValue: 10, capturable: true, buildable: true } },
  planetTypes: { terran: { productionBonus: 0, defenseBonus: 0 } },
  // Две ступени ОДНОГО семейства и одна чужая: именно это различает условие.
  sectors: {
    rock: { name: 'Rock Field', speedBonus: -0.25, family: 'asteroid' },
    dense: { name: 'Dense Rock', speedBonus: -0.5, family: 'asteroid' },
    open: { name: 'Open', speedBonus: 0, family: 'void' },
    // Среда БЕЗ семейства — законный случай (старый каталог), и условие обязано её
    // отвергнуть, а не подобрать «на всякий случай».
    nameless: { name: 'Nameless', speedBonus: 0 },
  },
  heroPassives: {
    pilot: {
      name: 'Asteroid Pilot',
      hook: 'fleet.speed',
      scope: 'heroFleet',
      terrainFamily: 'asteroid',
      params: { bonus: 0.2 },
    },
    // Та же прибавка без условия — сторож обратной совместимости.
    always: { name: 'Always', hook: 'fleet.speed', scope: 'heroFleet', params: { bonus: 0.2 } },
  },
});

const player = (id: string): Player => ({
  id,
  name: id,
  faction: 'x',
  status: 'active',
  resources: {},
});

function planet(id: string, x: number, y: number, links: string[], terrain?: string): Planet {
  return {
    id,
    owner: 'p1',
    position: { x, y },
    links,
    kind: 'planet',
    planetType: 'terran',
    ...(terrain !== undefined ? { terrain } : {}),
    resources: {},
    buildings: [],
    garrison: [],
    traits: [],
  };
}

const fleet = (id: string, location: string): Fleet => ({
  id,
  owner: 'p1',
  location,
  movement: null,
  units: [{ unit: 'runner', count: 1 }],
  traits: [],
});

/** A — дом, вокруг него три провинции на 250 единицах: две астероидные и одна чужая. */
function world(passives: string[]): GameState {
  const s = createInitialState({ seed: 'affinity', version: { data: '0.1.0', manifest: '1' } });
  return {
    ...s,
    players: { p1: player('p1') },
    planets: {
      A: planet('A', 0, 0, ['R', 'D', 'O', 'N', 'X'], 'open'),
      R: planet('R', 250, 0, ['A'], 'rock'),
      D: planet('D', 0, 250, ['A'], 'dense'),
      O: planet('O', -250, 0, ['A'], 'open'),
      N: planet('N', 0, -250, ['A'], 'nameless'),
      // Провинция БЕЗ местности вообще — так выглядит узел карты, которой среду не
      // объявили. Условие обязано ответить «нет», а не «раз среды нет, то подходит».
      X: planet('X', 0, -500, ['A']),
    },
    fleets: { F1: fleet('F1', 'A'), F2: fleet('F2', 'A') },
    // Герой ЛЕТИТ в F1 — это и есть `scope: heroFleet`.
    heroes: {
      'hero:p1': {
        id: 'hero:p1',
        owner: 'p1',
        location: 'A',
        fleetId: 'F1',
        cooldowns: {},
        alive: true,
        passives,
      },
    },
  };
}

const ctx = (now: number): Context => ({ now, data });
const move = (fleetId: string, to: string): Action => ({
  id: `s:p1:${fleetId}${to}`,
  type: 'fleet.move',
  playerId: 'p1',
  payload: { fleetId, to },
  issuedAt: 0,
});

const kernel = createKernel([sectorModule, heroModule, movementModule]);

/** Часов в пути: 250 единиц делить на итоговую скорость. */
function hours(state: GameState, fleetId: string, to: string): number {
  const r: ApplyResult = kernel.applyAction(state, move(fleetId, to), ctx(0));
  if (!r.ok) throw new Error(`move rejected: ${r.code}`);
  return (r.state.fleets[fleetId]?.movement?.arrivesAt ?? 0) / HOUR;
}

describe('M2.8 — сродство к семейству местности', () => {
  it('ШТРАФ СРЕДЫ, ПОТОМ ПРИБАВКА: поле −25% и навык +20% дают 0.90 от базовой', () => {
    // 10 × 0.75 × 1.2 = 9 → 250/9 часов. Будь порядок иным (прибавка к множителю,
    // 10 × (1 − 0.25 + 0.2) = 9.5), число получилось бы другим — тест различает.
    expect(hours(world(['pilot']), 'F1', 'R')).toBeCloseTo(250 / 9, 6);
    expect(hours(world([]), 'F1', 'R')).toBeCloseTo(250 / 7.5, 6);
  });

  it('ЧЕМ ГУЩЕ СРЕДА, ТЕМ МЕНЬШЕ НАВЫК ЕЁ ВЫПРАВЛЯЕТ: скопление −50% → 0.60', () => {
    // Навык не делает пилота неуязвимым к среде — это и есть смысл выбранной модели.
    expect(hours(world(['pilot']), 'F1', 'D')).toBeCloseTo(250 / 6, 6);
  });

  it('ЧУЖАЯ СРЕДА НЕ ПЛАТИТ: в пустоте астероидный навык молчит', () => {
    expect(hours(world(['pilot']), 'F1', 'O')).toBeCloseTo(250 / 10, 6);
  });

  it('СРЕДА БЕЗ СЕМЕЙСТВА — тоже чужая: условие fail-closed, а не «подходит всему»', () => {
    expect(hours(world(['pilot']), 'F1', 'N')).toBeCloseTo(250 / 10, 6);
  });

  it('СРЕДЫ НЕТ ВОВСЕ — условие молчит: незнание не считается совпадением', () => {
    // Дыру нашла ПОРЧА: прежний набор проверял только среду без семейства, а ветку
    // «terrain не объявлен» не трогал — fail-open прошёл бы мимо всех тестов.
    // X стоит дальше остальных (500 единиц), поэтому и число другое: 500/10 без
    // прибавки против 500/12 с ней — разница видна невооружённым глазом.
    expect(hours(world(['pilot']), 'F1', 'X')).toBeCloseTo(500 / 10, 6);
  });

  it('ТОЛЬКО ФЛОТ ГЕРОЯ, НЕ АУРА: соседний флот того же владельца идёт без прибавки', () => {
    // Решение владельца: скилл действует на флот, которым управляет герой с этим скиллом.
    expect(hours(world(['pilot']), 'F2', 'R')).toBeCloseTo(250 / 7.5, 6);
  });

  it('ПАССИВКА БЕЗ УСЛОВИЯ РАБОТАЕТ КАК РАНЬШЕ — старые данные не меняют поведение', () => {
    expect(hours(world(['always']), 'F1', 'O')).toBeCloseTo(250 / 12, 6);
    expect(hours(world(['always']), 'F1', 'R')).toBeCloseTo(250 / 9, 6);
  });

  it('УСЛОВИЕ СМОТРИТ НА КЛЕТКУ ПРИБЫТИЯ, А НЕ ВЫЛЕТА', () => {
    // Вылет из астероидов в пустоту: бонуса быть НЕ должно — иначе условие читает `from`.
    const fromRock = { ...world(['pilot']) };
    fromRock.fleets = { ...fromRock.fleets, F1: { ...fromRock.fleets.F1!, location: 'R' } };
    fromRock.planets = {
      ...fromRock.planets,
      R: { ...fromRock.planets.R!, links: ['A'] },
      A: { ...fromRock.planets.A!, links: ['R', 'D', 'O', 'N'] },
    };
    // R → A: прибытие в `open`, значит чистая скорость без прибавки.
    expect(hours(fromRock, 'F1', 'A')).toBeCloseTo(250 / 10, 6);
  });
});

describe('ШИПНУТЫЙ КАТАЛОГ: лестница и адресат условия', () => {
  const root = path.resolve(__dirname, '..', '..', '..', '..');
  const read = (name: string): Record<string, Record<string, unknown>> =>
    JSON.parse(readFileSync(path.join(root, 'data', name), 'utf8')) as Record<
      string,
      Record<string, unknown>
    >;
  const sectors = read('sectors.json');
  const passives = read('heroPassives.json');

  it('У КАЖДОЙ СРЕДЫ ЕСТЬ СЕМЕЙСТВО — безымянную правило по семейству пропустит молча', () => {
    const orphans = Object.entries(sectors)
      .filter(([, def]) => typeof def.family !== 'string')
      .map(([id]) => id);
    expect(orphans, 'среда без `family` не попадёт ни под одно сродство').toEqual([]);
  });

  it('АСТЕРОИДНАЯ ЛЕСТНИЦА — три ступени: чем гуще, тем меньше подходов и ниже ход', () => {
    // Средняя ступень (`dust_lane`, бюджет 2) заведена ради оболочки вокруг ядра:
    // клетке кольца нужно ДВА подхода — снаружи внутрь и дальше в ядро, — а между
    // полем (3) и скоплением (1) ничего не было, и кольцо не собиралось.
    const ladder = Object.entries(sectors)
      .filter(([, d]) => d.family === 'asteroid')
      .map(([id, d]) => [id, d.maxLinks as number, d.speedBonus as number] as const)
      .sort((a, b) => b[1] - a[1]);
    expect(ladder.map((r) => r[0])).toEqual(['asteroid_field', 'dust_lane', 'asteroid_cluster']);
    expect(ladder.map((r) => r[1])).toEqual([3, 2, 1]);
    for (let i = 1; i < ladder.length; i++)
      expect(ladder[i]![2], `${ladder[i]![0]} должна быть медленнее предыдущей`).toBeLessThan(
        ladder[i - 1]![2],
      );
  });

  it('СЕМЕЙСТВО В ПАССИВКЕ СУЩЕСТВУЕТ — иначе навык мёртв и это незаметно', () => {
    // Опечатка в `terrainFamily` не падает и не светится: пассивка просто никогда не
    // срабатывает. Ровно тот класс дефекта, который в этом проекте уже ловили трижды.
    const families = new Set(
      Object.values(sectors)
        .map((d) => d.family)
        .filter((f): f is string => typeof f === 'string'),
    );
    for (const [id, def] of Object.entries(passives)) {
      if (typeof def.terrainFamily !== 'string') continue;
      expect([id, families.has(def.terrainFamily)], `${id}: семейства нет в каталоге`).toEqual([
        id,
        true,
      ]);
    }
  });
});

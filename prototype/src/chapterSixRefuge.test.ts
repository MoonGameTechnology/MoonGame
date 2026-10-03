import { describe, it, expect, afterEach } from 'vitest';

import { advance, aiOrders, order, setMatchMode, setMatchTravelSpeed } from './game';
import { data } from './gameData';
import {
  buildStateFromMap,
  identifiedNodes,
  parseMatchMap,
  type DomainEvent,
  type GameState,
} from '../../packages/shared-core/src/index';
import { moveFleet } from '../../decisions/actions';
import { missionTargets } from '../../decisions/missionView';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';
import mapJson from '../../data/maps/pve-6.json';

/**
 * ГЛАВА VI — «Последний приют» и последний контрудар (PVR-8.4, §8.4 и §8.7), на настоящей
 * карте, ядре прототипа и боте Роя: эпизод доков случается один раз, после настоящего
 * обнаружения игроком или союзником; задачи доков до него места не выдают; транспорты
 * выпускает и флот союзника; потеряв обе литейные, Рой ведёт к найденным докам то, что
 * уцелело, — и только это.
 */

const HOUR = 3_600_000;
const DOCK = 'quarantine_docks';
const FORCES = ['swarm_guard', 'swarm_host', 'swarm_reserve'];
const map = parseMatchMap(mapJson);

function start(): GameState {
  setMatchMode('pve_waves');
  setMatchTravelSpeed(RUN_TRAVEL_SPEED);
  // Первый шаг часов заводит PvE-штурм (`state.pve`), как в настоящем забеге.
  return advance({ ...buildStateFromMap(map, data), mapId: map.id }, 1).state;
}

afterEach(() => {
  setMatchMode(undefined);
  setMatchTravelSpeed(1);
});

/** Поставить флот на узел (перелёт по карте здесь не предмет проверки). */
function place(s: GameState, fleetId: string, at: string): GameState {
  return { ...s, fleets: { ...s.fleets, [fleetId]: { ...s.fleets[fleetId]!, location: at } } };
}

/** Довести флот до узла шагами по четверти часа; события пути — в `log`. */
function flyTo(
  s: GameState,
  by: string,
  fleetId: string,
  to: string,
  log: DomainEvent[],
): GameState {
  const sent = order(s, moveFleet(by, fleetId, to), s.time);
  expect(sent.error).toBeUndefined();
  log.push(...sent.events);
  let cur = sent.state;
  for (let q = 1; q <= 48; q++) {
    const step = advance(cur, s.time + (q * HOUR) / 4);
    log.push(...step.events);
    cur = step.state;
    const f = cur.fleets[fleetId];
    if (!f || (f.location === to && !f.movement)) return cur;
  }
  throw new Error(`${fleetId} не долетел до ${to}`);
}

const found = (log: DomainEvent[]) => log.filter((e) => e.type === 'refuge.found');

describe('глава VI: «Последний приют» (PVR-8.4, §8.4)', () => {
  it('флот игрока подошёл к докам — эпизод один раз, и задачи доков открывают метки', () => {
    const s = place(start(), 'p1_2', 'cold_moorings');
    expect(identifiedNodes(s, 'p1', data).has(DOCK)).toBe(false);
    // Метки задач доков: до эпизода их нет, хотя часовня и убежище на карте есть.
    const marks = (w: GameState): string[] =>
      map.objectives
        .filter((o) => o.revealedBy === DOCK)
        .flatMap((o) => missionTargets(o, w, 'p1'))
        .sort();
    expect(marks(s)).toEqual([]);
    const log: DomainEvent[] = [];
    const there = flyTo(s, 'p1', 'p1_2', DOCK, log);
    expect(found(log).map((e) => e.payload)).toEqual([{ owner: 'p1', at: DOCK }]);
    expect(there.missionFacts?.found).toEqual({ p1: [DOCK] });
    expect(marks(there)).toEqual(['dock_approach', 'forward_base', 'voices_chapel']);
    // Транспорты вышли к первому кораблю; второй час у доков эпизода не повторяет.
    expect(there.fleets.p1_evac?.owner).toBe('p1');
    expect(found(advance(there, there.time + HOUR).events)).toEqual([]);
  });

  it('доки нашёл союзник — сведения у игрока; его флот выпускает транспорты игрока', () => {
    const s = place(start(), 'ally_1', 'cold_moorings');
    const log: DomainEvent[] = [];
    const there = flyTo(s, 'ally', 'ally_1', DOCK, log);
    expect(found(log).map((e) => e.payload)).toEqual([{ owner: 'p1', at: DOCK }]);
    expect(there.missionFacts?.found).toEqual({ p1: [DOCK] });
    expect(there.fleets.p1_evac).toMatchObject({ owner: 'p1', location: DOCK });
    expect(there.planets[DOCK]!.awaitingFleets).toBeUndefined();
  });
});

describe('глава VI: последний контрудар Роя (PVR-8.4, §8.7)', () => {
  /** Обе литейные взяты игроком, доки известны — пора. */
  function due(s: GameState, known = true): GameState {
    const planets = { ...s.planets };
    for (const id of ['north_foundry', 'west_foundry'])
      planets[id] = { ...planets[id]!, owner: 'p1', garrison: [] };
    return { ...s, planets, missionFacts: known ? { found: { p1: [DOCK] } } : {} };
  }
  /** Приказы бота флотам контрудара — каждый строкой: лишний приказ виден лишней строкой. */
  const counterOrders = (s: GameState, ids: string[]): string[] =>
    aiOrders(s, 'swarm')
      .flatMap((a) => {
        const p = a.payload as { fleetId?: string; to?: string };
        return p.fleetId && ids.includes(p.fleetId) ? [`${p.fleetId} ${a.type} ${p.to}`] : [];
      })
      .sort();
  const toDocks = (s: GameState): string[] =>
    aiOrders(s, 'swarm')
      .filter((a) => a.type === 'fleet.move' && (a.payload as { to: string }).to === DOCK)
      .map((a) => (a.payload as { fleetId: string }).fleetId)
      .sort();

  it('литейные потеряны, доки известны — соединения и построенное идут к докам, и только туда', () => {
    const s = due(start());
    // Построенное Роем на Бастионе: без контрудара его ждал бы улей (`musterPlan`).
    s.fleets.swarm_built = {
      ...s.fleets.swarm_host!,
      id: 'swarm_built',
      traits: ['rally'],
      units: [{ unit: 'frigate', count: 2 }],
    };
    // Флот игрока на маяке у часовни: ответ на маяк флоты контрудара не уводит.
    s.fleets.p1_2 = { ...s.fleets.p1_2!, location: 'voices_chapel' };
    const ids = [...FORCES, 'swarm_built'];
    expect(counterOrders(s, ids)).toEqual(ids.map((id) => `${id} fleet.move ${DOCK}`).sort());
  });

  it('доки не найдены или литейная ещё у Роя — контрудара нет', () => {
    expect(toDocks(due(start(), false))).toEqual([]);
    const s = due(start());
    s.planets.west_foundry = { ...s.planets.west_foundry!, owner: 'swarm' };
    expect(toDocks(s)).toEqual([]);
  });

  it('уничтоженное заранее не воскресает: идут только уцелевшие', () => {
    const s = due(start());
    delete s.fleets.swarm_guard;
    s.operation!.forces.swarm_reserve!.brokenAt = s.time;
    expect(toDocks(s)).toEqual(['swarm_host']);
    expect(Object.keys(s.fleets).filter((id) => FORCES.includes(id))).toEqual([
      'swarm_host',
      'swarm_reserve',
    ]);
  });
});

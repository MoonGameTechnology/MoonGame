import { describe, it, expect, afterEach } from 'vitest';

import { advance, order, setMatchMode, setMatchTravelSpeed } from './game';
import { data } from './gameData';
import {
  buildStateFromMap,
  operationStatus,
  parseMatchMap,
  type GameState,
} from '../../packages/shared-core/src/index';
import { moveFleet } from '../../decisions/actions';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';
import mapJson from '../../data/maps/pve-6.json';

/**
 * ГЛАВА VI — исход решает контракт операции (PVR-8.3, §8.8), на настоящей карте и ядре
 * прототипа: три результата вместе — победа; эвакуация стала невозможной — поражение; волны
 * и удержание главу с контрактом не выигрывают. Бои здесь не играются: очаги «взяты» и
 * соединения «разбиты» правкой состояния — бой и захват держат другие тесты, а здесь —
 * правило исхода и то, что модуль операции стоит в ядре, которое крутит игру.
 */

const HOUR = 3_600_000;
const SITES = ['complex', 'north_foundry', 'west_foundry'];
const FORCES = ['swarm_guard', 'swarm_host', 'swarm_reserve'];

function start(): GameState {
  setMatchMode('pve_waves');
  setMatchTravelSpeed(RUN_TRAVEL_SPEED);
  const map = parseMatchMap(mapJson);
  // Первый шаг часов заводит PvE-штурм (`state.pve`), как в настоящем забеге.
  return advance({ ...buildStateFromMap(map, data), mapId: map.id }, 1).state;
}

afterEach(() => {
  setMatchMode(undefined);
  setMatchTravelSpeed(1);
});

/** Очаги взяты игроком: гарнизоны сняты, как после штурма. */
function sitesTaken(s: GameState): GameState {
  const planets = { ...s.planets };
  for (const id of SITES) planets[id] = { ...planets[id]!, owner: 'p1', garrison: [] };
  return { ...s, planets };
}

/** Главные соединения уничтожены. */
function forcesGone(s: GameState): GameState {
  const fleets = { ...s.fleets };
  for (const id of FORCES) delete fleets[id];
  return { ...s, fleets };
}

/** Транспорты вышли из доков (как по прибытии флота игрока) и стоят у `at`. */
function transportsOut(s: GameState, at: string, count = 4): GameState {
  const docks = s.planets.quarantine_docks!;
  const evac = docks.awaitingFleets!.find((f) => f.id === 'p1_evac')!;
  return {
    ...s,
    planets: { ...s.planets, quarantine_docks: { ...docks, awaitingFleets: undefined } },
    fleets: {
      ...s.fleets,
      p1_evac: {
        ...evac,
        location: at,
        movement: null,
        units: [{ unit: 'evac_transport', count }],
      },
    },
  };
}

/** Довести флот до узла, шагами по четверти часа. */
function flyTo(s: GameState, fleetId: string, to: string, maxHours = 24): GameState {
  const sent = order(s, moveFleet('p1', fleetId, to), s.time);
  expect(sent.error).toBeUndefined();
  let cur = sent.state;
  for (let q = 1; q <= maxHours * 4; q++) {
    cur = advance(cur, s.time + (q * HOUR) / 4).state;
    const f = cur.fleets[fleetId];
    if (cur.match.status === 'ended' || !f || (f.location === to && !f.movement)) return cur;
  }
  throw new Error(`${fleetId} не долетел до ${to}`);
}

/** Соседняя с базой провинция, откуда транспортам один переход до убежища. */
function nextToBase(s: GameState): string {
  return [...(s.planets.forward_base!.links ?? [])].sort()[0]!;
}

describe('глава VI: исход решает контракт операции (PVR-8.3)', () => {
  it('карта заводит контракт: три очага, три соединения, три транспорта из четырёх', () => {
    const s = start();
    expect(s.operation).toMatchObject({ production: SITES, evacuate: 3, breakAt: 0.2 });
    expect(Object.keys(s.operation!.forces)).toEqual(FORCES);
    expect(operationStatus(s, data)).toMatchObject({
      held: SITES,
      broken: [],
      need: 3,
      possible: 4,
      done: false,
      lost: false,
    });
  });

  it('очаги взяты, соединения разбиты, транспорты доведены — победа тех, кто стоит', () => {
    const ready = advance(forcesGone(sitesTaken(start())), 1 + HOUR).state;
    expect(ready.match.status).toBe('ongoing');
    expect(operationStatus(ready, data)).toMatchObject({ held: [], broken: FORCES });
    const s = flyTo(transportsOut(ready, nextToBase(ready)), 'p1_evac', 'forward_base');
    expect(s.missionFacts?.evacuated).toEqual({ p1: 4 });
    expect(s.match).toMatchObject({ status: 'ended', reason: 'pve-operation', winner: 'p1' });
  });

  it('без эвакуации взятые очаги и разбитые соединения главу не заканчивают', () => {
    const s = advance(forcesGone(sitesTaken(start())), 1 + 2 * HOUR).state;
    expect(s.match.status).toBe('ongoing');
  });

  it('беженцев стало меньше трёх — поражение главы', () => {
    const out = transportsOut(start(), 'quarantine_docks', 2);
    const s = advance(out, out.time + HOUR).state;
    expect(s.match).toMatchObject({ status: 'ended', reason: 'pve-evac-lost', winner: 'swarm' });
  });

  it('волны и удержание главу с контрактом не выигрывают — а без контракта выиграли бы', () => {
    const s = start();
    const done = { ...s, pve: { ...s.pve!, waveNumber: s.pve!.totalWaves, holdUntil: s.time } };
    const withContract = advance(done, s.time + HOUR).state;
    expect(withContract.match.status).not.toBe('ended');
    const { operation: _op, ...plain } = done;
    void _op;
    const control = advance(plain as GameState, s.time + HOUR).state;
    expect(control.match).toMatchObject({ status: 'ended', reason: 'pve-cleared' });
  });
});

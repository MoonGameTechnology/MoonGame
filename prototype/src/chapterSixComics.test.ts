import { describe, it, expect, afterEach } from 'vitest';

import { advance, order, setMatchMode, setMatchTravelSpeed } from './game';
import { data } from './gameData';
import { CHAPTER_COMICS, COMIC_TRIGGERS } from './comicArt';
import {
  buildStateFromMap,
  parseMatchMap,
  type GameState,
} from '../../packages/shared-core/src/index';
import { moveFleet } from '../../decisions/actions';
import { chapterChain } from '../../decisions/chapterChain';
import { comicId, comicsTriggered } from '../../decisions/chapterComics';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';
import mapJson from '../../data/maps/pve-6.json';

/**
 * ГЛАВА VI — сцены комикса по событиям главы (PVR-8.6, §8.9), на настоящей карте, ядре прототипа
 * и подключённом арте: «Последний приют» — когда доки опознаны и пришли запись и живой сигнал,
 * «Мы пришли за людьми» — когда основная эвакуация завершена. Раньше своего события сцена не
 * играет, и каждая — один раз на профиль.
 */

const HOUR = 3_600_000;
const DOCKS = 'quarantine_docks';
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

/** Довести флот игрока до узла шагами по четверти часа. */
function flyTo(s: GameState, fleetId: string, to: string): GameState {
  const sent = order(s, moveFleet('p1', fleetId, to), s.time);
  expect(sent.error).toBeUndefined();
  let cur = sent.state;
  for (let q = 1; q <= 48; q++) {
    cur = advance(cur, s.time + (q * HOUR) / 4).state;
    const f = cur.fleets[fleetId];
    if (!f || (f.location === to && !f.movement)) return cur;
  }
  throw new Error(`${fleetId} не долетел до ${to}`);
}

/** Флот игрока у доков: сведения о них приходят по-настоящему, обзором. */
function atDocks(): GameState {
  const s = start();
  const near = {
    ...s,
    fleets: { ...s.fleets, p1_2: { ...s.fleets.p1_2!, location: 'cold_moorings' } },
  };
  return flyTo(near, 'p1_2', DOCKS);
}

/** Что сыграет хозяин в этом кадре — тем же путём, что `playTaskComic`. */
function due(s: GameState, seen: string[] = []): string[] {
  const done = (chapterChain(s, 'p1', 0, data) ?? []).filter((st) => st.done).map((st) => st.key);
  return comicsTriggered({ comicsSeen: seen }, CHAPTER_COMICS, COMIC_TRIGGERS, 'pve-6', done);
}

describe('глава VI: сцены комикса по событиям (PVR-8.6)', () => {
  it('на старте сцен нет; доки найдены — «Последний приют», один раз', () => {
    expect(due(start())).toEqual([]);
    const there = atDocks();
    expect(there.missionFacts?.found?.p1).toContain(DOCKS);
    expect(due(there)).toEqual(['refuge']);
    expect(due(there, [comicId('pve-6', 'refuge')])).toEqual([]);
  });

  it('основная эвакуация завершена — «Мы пришли за людьми», а не раньше', () => {
    const there = atDocks();
    const read = [comicId('pve-6', 'refuge')];
    // Транспорты вышли, но в убежище их ещё нет: спасение не объявлено.
    expect(there.fleets.p1_evac?.owner).toBe('p1');
    expect(due(there, read)).toEqual([]);
    // Доставку считает `missionFacts` (её путь сторожит `chapterSixOperation.test.ts`).
    const two = { ...there, missionFacts: { ...there.missionFacts, evacuated: { p1: 2 } } };
    expect(due(two, read)).toEqual([]);
    const three = { ...there, missionFacts: { ...there.missionFacts, evacuated: { p1: 3 } } };
    expect(due(three, read)).toEqual(['rescued']);
    expect(due(three, [...read, comicId('pve-6', 'rescued')])).toEqual([]);
  });
});

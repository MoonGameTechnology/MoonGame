import { describe, it, expect, afterEach } from 'vitest';

import { advance, order, setMatchMode, setMatchTravelSpeed } from './game';
import { data } from './gameData';
import {
  buildStateFromMap,
  parseMatchMap,
  type GameState,
} from '../../packages/shared-core/src/index';
import { moveFleet } from '../../decisions/actions';
import { chapterChain } from '../../decisions/chapterChain';
import { objectiveProgress } from '../../decisions/missionObjectives';
import { missionTargets } from '../../decisions/missionView';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';
import mapJson from '../../data/maps/pve-6.json';

/**
 * ГЛАВА VI — интерфейс главы и совместный зачёт (PVR-8.5, §8.3 и §8.8), на настоящей карте и
 * ядре прототипа: цепочка главы видна с первой минуты вместе с порогом эвакуации, эпизод доков
 * закрывает её первый шаг, вышедшие транспорты ведут к базе; цель, взятая союзником,
 * засчитана игроку.
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

const chain = (s: GameState) => chapterChain(s, 'p1', 0, data)!;

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

describe('глава VI: цепочка главы в панели (PVR-8.5)', () => {
  it('с первой минуты: доки, эвакуация с порогом «3 из 4», очаги и главные силы', () => {
    const steps = chain(start());
    expect(steps.map((st) => [st.id, st.active, st.count ?? null])).toEqual([
      ['docks', true, null],
      ['evacuate', false, { done: 0, total: 3 }],
      ['production', false, { done: 0, total: 3 }],
      ['forces', false, { done: 0, total: 3 }],
    ]);
    expect(steps[1]!.rule).toEqual({ need: 3, of: 4 });
  });

  it('флот у доков: эпизод закрывает шаг, а вышедшие транспорты ведут к базе', () => {
    const s = start();
    const near = {
      ...s,
      fleets: { ...s.fleets, p1_2: { ...s.fleets.p1_2!, location: 'cold_moorings' } },
    };
    const there = flyTo(near, 'p1_2', DOCKS);
    expect(there.fleets.p1_evac?.owner).toBe('p1');
    const steps = chain(there);
    expect(steps[0]).toMatchObject({ id: 'docks', done: true });
    expect(steps[1]).toMatchObject({ id: 'evacuate', active: true, target: 'forward_base' });
    expect(steps[1]!.rule).toEqual({ need: 3, of: 4 });
  });
});

describe('глава VI: совместный зачёт задач (PVR-8.5, §8.3)', () => {
  const outer = map.objectives.find((o) => o.id === 'mission.outer-station')!;

  it('станцию взял союзник — задача выполнена у игрока, метки на ней нет', () => {
    const s = start();
    expect(objectiveProgress(outer, s, 'p1').complete).toBe(false);
    expect(missionTargets(outer, s, 'p1')).toEqual(['outer_station']);
    const taken: GameState = {
      ...s,
      planets: { ...s.planets, outer_station: { ...s.planets.outer_station!, owner: 'ally' } },
    };
    expect(objectiveProgress(outer, taken, 'p1').complete).toBe(true);
    expect(missionTargets(outer, taken, 'p1')).toEqual([]);
  });
});

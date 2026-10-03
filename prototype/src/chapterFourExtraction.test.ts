import { describe, it, expect, afterEach } from 'vitest';

import { advance, order, setMatchMode, setMatchTravelSpeed } from './game';
import { data } from './gameData';
import {
  buildStateFromMap,
  parseMatchMap,
  type GameState,
} from '../../packages/shared-core/src/index';
import { extractionStart, moveFleet } from '../../decisions/actions';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';
import mapJson from '../../data/maps/pve-4.json';

/**
 * ГЛАВА IV — исход решает накопитель (PVR-7.3, резолюция владельца 2026-09-27), на настоящей
 * карте и ядре прототипа: связь → извлечение у архива → доставка в зону вывода — победа;
 * гибель носителя — поражение; волны и удержание главу с архивом не выигрывают.
 * Мир строится из карты напрямую — здесь правила исхода, путь через дверь держит
 * `chapterFourRun.test.ts`; штурм архива здесь не играется — архив «очищен» правкой
 * состояния, бой — предмет других тестов.
 */

const HOUR = 3_600_000;

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

/** Довести флот до узла. Долетевший туда, где стоит свой флот, вливается в него
 *  (`autoMerge`) — тогда следим за тем, в кого он влился. */
function flyTo(s: GameState, fleetId: string, to: string, maxHours = 24): GameState {
  const sent = order(s, moveFleet('p1', fleetId, to), s.time);
  expect(sent.error).toBeUndefined();
  let cur = sent.state;
  let id = fleetId;
  for (let q = 1; q <= maxHours * 4; q++) {
    const step = advance(cur, s.time + (q * HOUR) / 4);
    cur = step.state;
    for (const e of step.events) {
      const m = e.payload as { from?: string; into?: string };
      if (e.type === 'fleet.merged' && m.from === id && m.into) id = m.into;
    }
    const f = cur.fleets[id];
    if (cur.match.status === 'ended' || (f && f.location === to && !f.movement)) return cur;
  }
  throw new Error(`${fleetId} не долетел до ${to}`);
}

/** Архив очищен и флот у него: сократить путь, не играя штурм. */
function atArchive(s: GameState, fleetId: string): GameState {
  return {
    ...s,
    planets: { ...s.planets, archive: { ...s.planets.archive!, owner: 'p1', garrison: [] } },
    fleets: {
      ...s.fleets,
      [fleetId]: { ...s.fleets[fleetId]!, location: 'archive', movement: null },
    },
  };
}

/** Извлечь накопитель флотом у архива: назначить и дождаться готовности. */
function extract(s: GameState, fleetId: string): GameState {
  const r = order(s, extractionStart('p1', fleetId), s.time);
  expect(r.error).toBeUndefined();
  let cur = r.state;
  for (let h = 1; h <= 8 && cur.extraction?.carrier === undefined; h++)
    cur = advance(cur, r.state.time + h * HOUR).state;
  expect(cur.extraction?.carrier).toBe(fleetId);
  return cur;
}

describe('глава IV: исход решает накопитель (PVR-7.3)', () => {
  it('карта заводит извлечение: архив, зона вывода у входа, срок из данных', () => {
    const s = start();
    expect(s.extraction).toMatchObject({ vault: 'archive', zone: 'staging', doneMs: 0 });
    expect(s.extraction!.hours).toBeGreaterThan(0);
  });

  it('связь → извлечение → доставка: победа тех, кто стоит', () => {
    let s = flyTo(start(), 'p1_1', 'rendezvous');
    s = extract(atArchive(s, 'p1_2'), 'p1_2');
    // Короткий путь домой: поставить носитель у входа и довести последний переход.
    s = {
      ...s,
      fleets: { ...s.fleets, p1_2: { ...s.fleets.p1_2!, location: 'approach', movement: null } },
    };
    s = flyTo(s, 'p1_2', 'staging');
    expect(s.match).toMatchObject({ status: 'ended', reason: 'pve-extracted', winner: 'p1' });
  });

  it('без связи накопитель в зоне вывода главу не заканчивает', () => {
    let s = extract(atArchive(start(), 'p1_2'), 'p1_2');
    s = {
      ...s,
      fleets: { ...s.fleets, p1_2: { ...s.fleets.p1_2!, location: 'approach', movement: null } },
    };
    s = flyTo(s, 'p1_2', 'staging');
    expect(s.match.status).not.toBe('ended');
    expect(s.extraction!.deliveredAt).toBeUndefined();
  });

  it('носитель уничтожен — поражение главы', () => {
    let s = extract(atArchive(start(), 'p1_2'), 'p1_2');
    const { p1_2: _gone, ...rest } = s.fleets;
    void _gone;
    s = advance({ ...s, fleets: rest }, s.time + HOUR).state;
    expect(s.match).toMatchObject({ status: 'ended', reason: 'pve-carrier-lost', winner: 'swarm' });
  });

  it('волны и удержание главу с архивом не выигрывают — а без архива выиграли бы', () => {
    const s = start();
    const done = { ...s, pve: { ...s.pve!, waveNumber: s.pve!.totalWaves, holdUntil: s.time } };
    const withArchive = advance(done, s.time + HOUR).state;
    expect(withArchive.match.status).not.toBe('ended');
    const { extraction: _x, ...plain } = done;
    void _x;
    const control = advance(plain as GameState, s.time + HOUR).state;
    expect(control.match).toMatchObject({ status: 'ended', reason: 'pve-cleared' });
  });
});

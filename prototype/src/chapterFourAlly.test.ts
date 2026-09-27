import { describe, it, expect, afterEach } from 'vitest';

import { advance, order, setMatchMode, setMatchTravelSpeed } from './game';
import { data } from './gameData';
import {
  buildStateFromMap,
  contactedAllies,
  getStance,
  identifiedNodes,
  parseMatchMap,
  type GameState,
} from '../../packages/shared-core/src/index';
import { moveFleet } from '../../decisions/actions';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';
import mapJson from '../../data/maps/pve-4.json';

/**
 * ГЛАВА IV — встреча с союзником на настоящей карте и настоящем ядре прототипа (PVR-7.2,
 * `docs/sector-zero-map-concepts.md` §6.3–§6.4): флот игрока долетает до точки встречи, и
 * этим одним событием стороны становятся союзниками и начинают видеть друг за друга.
 * Мир строится из карты напрямую; путь через дверь главы держит `chapterFourRun.test.ts`.
 */

const HOUR = 3_600_000;

function start(): GameState {
  setMatchMode('pve_waves');
  setMatchTravelSpeed(RUN_TRAVEL_SPEED);
  const map = parseMatchMap(mapJson);
  return { ...buildStateFromMap(map, data), mapId: map.id };
}

afterEach(() => {
  setMatchMode(undefined);
  setMatchTravelSpeed(1);
});

/** Отправить флот и вести часы, пока он не встанет на месте (или не выйдет срок). */
function flyTo(s: GameState, fleetId: string, to: string, maxHours = 24): GameState {
  const sent = order(s, moveFleet('p1', fleetId, to), s.time);
  expect(sent.error).toBeUndefined();
  let cur = sent.state;
  for (let h = 1; h <= maxHours * 4; h++) {
    cur = advance(cur, s.time + (h * HOUR) / 4).state;
    const f = cur.fleets[fleetId];
    if (f && f.location === to && !f.movement) return cur;
  }
  throw new Error(`${fleetId} не долетел до ${to}`);
}

describe('глава IV: встреча с союзником (PVR-7.2)', () => {
  it('до встречи — мир и раздельный обзор; прибытие в точку — союз и общий обзор', () => {
    let s = start();
    expect(getStance(s, 'p1', 'ally')).toBe('peace');
    expect(contactedAllies(s, 'p1')).toEqual([]);
    const allySees = identifiedNodes(s, 'ally', data);
    expect(identifiedNodes(s, 'p1', data).has('ally_base')).toBe(false);

    s = flyTo(s, 'p1_1', 'rendezvous');
    expect(contactedAllies(s, 'p1')).toEqual(['ally']);
    expect(getStance(s, 'p1', 'ally')).toBe('alliance');
    // Обзор двусторонний: игрок видит всё, что видит союзник, и наоборот.
    const mine = identifiedNodes(s, 'p1', data);
    const theirs = identifiedNodes(s, 'ally', data);
    for (const id of allySees) expect(mine.has(id), id).toBe(true);
    expect(theirs.has('staging')).toBe(true);
    expect([...mine].sort()).toEqual([...theirs].sort());
    // Рой по-прежнему враг обоим.
    expect(getStance(s, 'swarm', 'ally')).toBe('war');
    expect(getStance(s, 'swarm', 'p1')).toBe('war');
  });

  it('факт связи остаётся после ухода флота и не дублируется повторным визитом', () => {
    let s = flyTo(start(), 'p1_1', 'rendezvous');
    s = flyTo(s, 'p1_1', 'south_camp');
    expect(getStance(s, 'p1', 'ally')).toBe('alliance');
    s = flyTo(s, 'p1_1', 'rendezvous');
    expect(s.missionFacts?.contacted).toEqual({ p1: ['rendezvous'] });
  });

  it('пролёт через точку встречи — не прибытие', () => {
    // Со Южной стоянки к Внешнему дрейфу кратчайший путь лежит ЧЕРЕЗ точку встречи: флот
    // проходит её транзитом и останавливается дальше.
    const s = flyTo(start(), 'p1_1', 'south_camp');
    const sent = order(s, moveFleet('p1', 'p1_1', 'outer_w'), s.time);
    expect(sent.error).toBeUndefined();
    expect(sent.state.fleets.p1_1!.movement?.to).toBe('rendezvous');
    let cur = sent.state;
    for (let q = 1; q <= 96; q++) {
      cur = advance(cur, s.time + (q * HOUR) / 4).state;
      const f = cur.fleets.p1_1!;
      if (f.location === 'outer_w' && !f.movement) break;
    }
    expect(cur.fleets.p1_1!.location).toBe('outer_w');
    expect(getStance(cur, 'p1', 'ally')).toBe('peace');
    expect(cur.missionFacts?.contacted).toBeUndefined();
  });
});

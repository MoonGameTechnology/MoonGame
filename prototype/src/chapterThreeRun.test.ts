import { describe, it, expect, afterEach } from 'vitest';

import { advance, order, setMatchMode, setMatchTravelSpeed, setMatchVeteranPower } from './game';
import { data } from './gameData';
import { initSoloDrivers } from './soloDrivers';
import { pveState, pveModeId } from '../../packages/client/src/gameData';
import type { Action, GameState } from '../../packages/shared-core/src/index';
import { runAiSeats } from '../../decisions/runAiSeats';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';

/**
 * ТРЕТЬЯ ГЛАВА ЦЕЛИКОМ — «Карантинный рубеж» (`docs/sector-zero-map-concepts.md` §5),
 * сквозным прогоном через настоящие драйверы хоста, как `pveRun.test.ts` для первой.
 *
 * Геометрию рубежа держит `data/pveThirdMission.test.ts`, а здесь — то, ради чего она
 * строилась: Рой сам (по общим правилам, без сценарных приказов, §5.8) приходит к рубежу
 * БОЛЬШЕ ЧЕМ ОДНИМ переходом. Будь переход один, глава свелась бы к одной крепости у одной
 * двери — ровно то, от чего §5.3 предостерегает.
 */

const HOUR = 3_600_000;
const CHAPTER = 2;
const CROSSINGS = ['west_pass', 'quarantine', 'east_pass'] as const;
/** Подход к переходу с севера: вражеский флот здесь — значит, рубеж пройден этим путём. */
const NORTH_OF: Record<(typeof CROSSINGS)[number], string> = {
  west_pass: 'watch_post',
  quarantine: 'north_gate',
  east_pass: 'east_haze',
};

function run(maxHours: number): { state: GameState; endedAtHour?: number; crossed: Set<string> } {
  setMatchMode(pveModeId(CHAPTER));
  setMatchTravelSpeed(RUN_TRAVEL_SPEED);
  setMatchVeteranPower(true);
  let s: GameState = pveState(data, CHAPTER);
  const crossed = new Set<string>();
  const apply = (a: Action): void => {
    const out = order(s, a, s.time);
    if (!out.error) s = out.state;
  };
  const drivers = initSoloDrivers({
    state: () => s,
    me: () => 'p1',
    aiSeats: () => runAiSeats(s, 'p1', 'weak'),
    applyLocal: apply,
    playerOrder: apply,
    autoAssault: () => false, // игрок пассивен — нижняя граница «что карта делает сама»
    patrols: () => new Map(),
    known: () => true,
  });
  for (let hour = 1; hour <= maxHours; hour++) {
    s = advance(s, hour * HOUR).state;
    for (const f of Object.values(s.fleets)) {
      if (f.owner !== 'swarm' || !f.location) continue;
      for (const c of CROSSINGS) if (f.location === NORTH_OF[c]) crossed.add(c);
    }
    if (s.match.status === 'ended') return { state: s, endedAtHour: hour, crossed };
    drivers.runAI();
    drivers.autoEngage();
    drivers.checkFleetClashes();
  }
  return { state: s, crossed };
}

describe('глава III: забег на карте pve-3', () => {
  afterEach(() => {
    setMatchMode(undefined);
    setMatchTravelSpeed(1);
    setMatchVeteranPower(false);
  });

  it('пассивный игрок проигрывает по-PvE-шному и не мгновенно', () => {
    const { state, endedAtHour } = run(400);
    expect({ ended: state.match.status, reason: state.match.reason }).toEqual({
      ended: 'ended',
      reason: 'pve-failed',
    });
    // Замер 2026-09-25: 42-й час, седьмая волна. Нижняя граница держит «рубеж сам по себе
    // что-то задерживает», верхняя — «забег кончается».
    expect(endedAtHour).toBeGreaterThanOrEqual(30);
    expect(endedAtHour).toBeLessThan(300);
  });

  it('Рой приходит к рубежу больше чем одним переходом (§5.3, §5.10 п. 1–2)', () => {
    const { crossed } = run(400);
    expect(crossed.size).toBeGreaterThanOrEqual(2);
  });
});

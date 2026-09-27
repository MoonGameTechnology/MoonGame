import { describe, it, expect, afterEach } from 'vitest';

import { advance, order, setMatchMode, setMatchTravelSpeed, setMatchVeteranPower } from './game';
import { data } from './gameData';
import { initSoloDrivers } from './soloDrivers';
import {
  buildStateFromMap,
  parseMatchMap,
  type Action,
  type GameState,
} from '../../packages/shared-core/src/index';
import { allyOrder, moveFleet } from '../../decisions/actions';
import { planAllyOperation } from '../../decisions/allyOperation';
import { runAiSeats } from '../../decisions/runAiSeats';
import { RUN_TRAVEL_SPEED } from '../../decisions/runTempo';
import mapJson from '../../data/maps/pve-4.json';

/**
 * ГЛАВА IV — союзный бот на настоящих драйверах хоста (PVR-7.4, §6.5): после встречи союзник
 * сам ведёт свою задачу, а приказ игрока ведёт по плану `planAllyOperation`. Рой в прогоне
 * живой — ходит тем же ботом, что в забеге, так что проверяется не план на бумаге, а то,
 * что из него выходит в мире.
 */

const HOUR = 3_600_000;

interface Run {
  state(): GameState;
  apply(a: Action): string | undefined;
  hours(n: number, until?: (s: GameState) => boolean): number;
}

function start(): Run {
  setMatchMode('pve_waves');
  setMatchTravelSpeed(RUN_TRAVEL_SPEED);
  setMatchVeteranPower(true);
  const map = parseMatchMap(mapJson);
  let s: GameState = { ...buildStateFromMap(map, data), mapId: map.id };
  const apply = (a: Action): string | undefined => {
    const out = order(s, a, s.time);
    if (!out.error) s = out.state;
    return out.error;
  };
  const drivers = initSoloDrivers({
    state: () => s,
    me: () => 'p1',
    aiSeats: () => runAiSeats(s, 'p1', 'weak'),
    applyLocal: apply,
    playerOrder: apply,
    autoAssault: () => false,
    patrols: () => new Map(),
    known: () => true,
  });
  let hour = 0;
  return {
    state: () => s,
    apply,
    hours(n, until) {
      for (let i = 0; i < n; i++) {
        hour += 1;
        s = advance(s, hour * HOUR).state;
        if (s.match.status === 'ended' || until?.(s)) return i + 1;
        drivers.runAI();
        drivers.autoEngage();
        drivers.checkFleetClashes();
      }
      return n;
    },
  };
}

/** Флот игрока долетел до точки встречи — союз заключён. */
function meet(run: Run): void {
  expect(run.apply(moveFleet('p1', 'p1_1', 'rendezvous'))).toBeUndefined();
  run.hours(24, (s) => (s.missionFacts?.contacted?.p1?.length ?? 0) > 0);
  expect(run.state().missionFacts?.contacted?.p1).toEqual(['rendezvous']);
}

describe('глава IV: союзный бот (PVR-7.4)', () => {
  afterEach(() => {
    setMatchMode(undefined);
    setMatchTravelSpeed(1);
    setMatchVeteranPower(false);
  });

  it('до встречи союзник своей задачи не ведёт — станции Роя стоят', () => {
    const run = start();
    run.hours(12);
    const s = run.state();
    expect(s.planets.station_west!.owner).toBe('swarm');
    expect(planAllyOperation(s, 'ally', data).step).toBe('idle');
  });

  it('после встречи без приказа союзник сам возвращает ближайшую станцию', () => {
    const run = start();
    meet(run);
    const took = run.hours(48, (s) => s.planets.station_west!.owner === 'ally');
    expect(run.state().planets.station_west!.owner).toBe('ally');
    expect(took).toBeLessThan(48);
  });

  it('приказ «Разведать»: разведчик доходит до цели, и ядро закрывает операцию докладом', () => {
    const run = start();
    meet(run);
    expect(run.apply(allyOrder('p1', 'ally', 'scout', { planet: 'outer_far' }))).toBeUndefined();
    expect(run.state().allyOps?.ally).toMatchObject({ kind: 'scout', planet: 'outer_far' });
    run.hours(48, (s) => s.allyOps?.ally === undefined);
    expect(run.state().allyOps?.ally).toBeUndefined();
  });

  it('приказ «Охранять»: группа встаёт у цели и держится там', () => {
    const run = start();
    meet(run);
    expect(run.apply(allyOrder('p1', 'ally', 'guard', { planet: 'gloom' }))).toBeUndefined();
    run.hours(24, (s) =>
      Object.values(s.fleets).some(
        (f) => f.owner === 'ally' && f.location === 'gloom' && !f.movement,
      ),
    );
    run.hours(6);
    const s = run.state();
    expect(Object.values(s.fleets).some((f) => f.owner === 'ally' && f.location === 'gloom')).toBe(
      true,
    );
    expect(planAllyOperation(s, 'ally', data)).toMatchObject({ step: 'execute', source: 'order' });
  });
});

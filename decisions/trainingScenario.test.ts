import { describe, expect, it } from 'vitest';
import { RUN_SPEED_NORMAL } from './runTempo';
import { createInitialState, type GameState } from '../packages/shared-core/src/index';
import {
  dueForces,
  RAID,
  RAID_DELAY_MS,
  RAID_IDLE,
  raidDue,
  raidLeft,
  raidTick,
  STAGED_FORCES,
  TRAINING_ENEMY,
  trainingVerdict,
  withForce,
  withVerdict,
} from './trainingScenario';

/** Минута на часах забега — так полигон показывает время. */
const MIN = 60_000 * RUN_SPEED_NORMAL;

function world(owners: Record<string, string | null> = { base: 'p1', target: 'p2' }): GameState {
  const s = createInitialState({ seed: 'trn', version: { data: '0', manifest: '1' } });
  const planets = Object.fromEntries(
    Object.entries(owners).map(([id, owner]) => [
      id,
      { id, owner, position: { x: 0, y: 0 }, resources: {}, buildings: [], garrison: [], traits: [] },
    ]),
  );
  return { ...s, planets } as GameState;
}

describe('TRN-3 · сценарий полигона', () => {
  it('силы вводятся по этапам: до «Боя» никого, патруль с «Боя», охрана цели с «Отхода»', () => {
    const none = new Set<string>();
    expect(dueForces(undefined, none)).toEqual([]);
    expect(dueForces('fleet', none)).toEqual([]);
    expect(dueForces('battle', none).map((f) => f.id)).toEqual(['p2_patrol']);
    expect(dueForces('battle', none).map((f) => f.id)).not.toContain('p2_guard');
    expect(dueForces('retreat', none).map((f) => f.id)).toEqual(['p2_patrol', 'p2_guard']);
    // Пропущенный этап не теряет соединение, введённое не повторяется.
    expect(dueForces('finale', new Set(['p2_patrol'])).map((f) => f.id)).toEqual(['p2_guard']);
  });

  it('соединение входит в мир флотом противника, вход не меняется', () => {
    const s = world();
    const next = withForce(s, STAGED_FORCES[0]!);
    expect(s.fleets.p2_patrol).toBeUndefined();
    expect(next.fleets.p2_patrol).toMatchObject({
      owner: TRAINING_ENEMY,
      location: 'open_reach',
      movement: null,
      units: [{ unit: 'frigate', count: 1 }],
    });
  });

  it('контратака объявлена в начале «Закрепления» и отсчитывает игровое время', () => {
    let c = raidTick(RAID_IDLE, 'assault', 5 * MIN);
    expect(c.announced).toBe(false);
    c = raidTick(c, 'fortify', 5 * MIN);
    expect(c).toMatchObject({ announced: true, elapsed: 0 }); // объявлена — отсчёт с нуля
    c = raidTick(c, 'fortify', 4 * MIN);
    expect(raidLeft(c)).toBe(6 * MIN);
    c = raidTick(c, 'fortify', 0); // тур держит часы или пауза: игровое время стоит
    expect(raidLeft(c)).toBe(6 * MIN);
    expect(raidDue(c)).toBe(false);
    c = raidTick(c, 'finale', 7 * MIN);
    expect(raidLeft(c)).toBe(0);
    expect(raidDue(c)).toBe(true);
    const launched = { ...c, launched: true };
    expect(raidDue(launched)).toBe(false);
    expect(raidTick(launched, 'finale', MIN)).toBe(launched);
  });

  it('контратака — три фрегата с открытого участка на передовой пост', () => {
    expect(RAID).toMatchObject({ at: 'open_reach', to: 'outpost', units: [{ unit: 'frigate', count: 3 }] });
    expect(RAID_DELAY_MS).toBe(10 * MIN);
  });

  it('победа — контратака разбита и цель у игрока; взятие миров само ничего не кончает', () => {
    const launched = { ...RAID_IDLE, announced: true, launched: true, elapsed: RAID_DELAY_MS };
    const held = world({ base: 'p1', outpost: 'p1', target: 'p1' });
    // Цель взята, контратака не выходила — операция идёт.
    expect(trainingVerdict(held, 'p1', RAID_IDLE)).toBeNull();
    // Контратака вышла и ещё жива — идёт.
    expect(trainingVerdict(withForce(held, RAID), 'p1', launched)).toBeNull();
    // Разбита, цель у игрока — победа.
    expect(trainingVerdict(held, 'p1', launched)).toEqual({ winner: 'p1', reason: 'training-held' });
    // Разбита, но цель у противника — идёт.
    expect(trainingVerdict(world({ base: 'p1', target: 'p2' }), 'p1', launched)).toBeNull();
  });

  it('без единого мира игрок операцию проиграл; конец объявляется один раз', () => {
    const lost = world({ base: 'p2', target: 'p2' });
    const verdict = trainingVerdict(lost, 'p1', RAID_IDLE);
    expect(verdict).toEqual({ winner: TRAINING_ENEMY, reason: 'elimination' });
    const ended = withVerdict(lost, verdict!);
    expect(ended.match).toMatchObject({ status: 'ended', winner: 'p2', reason: 'elimination' });
    expect(lost.match.status).not.toBe('ended');
    expect(trainingVerdict(ended, 'p1', RAID_IDLE)).toBeNull();
  });
});

/**
 * ЗАПАС ЗАДАЧ ГЛАВЫ (PVR-5.3). Модель владельца 2026-09-22: за забег видна часть запаса,
 * выполненное закрыто навсегда, видимых становится больше с выполненными — до потолка,
 * счёт у каждой главы свой, номинал падает с числом видимых.
 */
import { describe, expect, it } from 'vitest';
import {
  objectiveNominal,
  objectiveProgress,
  settleObjectives,
  shownObjectives,
  type MissionObjective,
} from './missionObjectives';
import {
  freshSectorZeroProgress,
  parseSectorZeroProgress,
  settleSectorZeroRun,
  type SectorChapter,
} from './sectorZeroProgress';
import { shippedGameData } from '../data/bundle';
import { pveChapter, pveState, PVE_MISSION_COUNT } from '../packages/client/src/gameData';
import type { GameState } from '../packages/shared-core/src/index';

/** Задача, выполненная на любом состоянии: «снести» то, чего на карте нет. */
const easy = (id: string, reward = 3): MissionObjective => ({
  id,
  kind: 'raze',
  targets: ['no_such_building'],
  reward,
});
/** Задача, невыполнимая на любом состоянии. */
const hard = (id: string, reward = 3): MissionObjective => ({
  id,
  kind: 'control',
  targets: ['no_such_planet'],
  reward,
});
const pool = (n: number, make = easy) => Array.from({ length: n }, (_, i) => make(`m${i + 1}`));
const ids = (list: readonly MissionObjective[]) => list.map((o) => o.id);
const empty = { planets: {} } as unknown as GameState;

describe('показ за забег — база плюс выполненное, до потолка', () => {
  it('первый заход — база; выполненное закрыто и уступает место следующим', () => {
    const p = pool(10);
    expect(ids(shownObjectives(p, []))).toEqual(['m1', 'm2', 'm3']);
    expect(ids(shownObjectives(p, ['m1']))).toEqual(['m2', 'm3', 'm4', 'm5']);
    expect(ids(shownObjectives(p, ['m1', 'm2', 'm3']))).toEqual(['m4', 'm5', 'm6', 'm7', 'm8']);
  });

  it('упирается в потолок главы и дальше стоит', () => {
    const p = pool(10);
    expect(shownObjectives(p, ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'])).toHaveLength(4);
    expect(shownObjectives(p, ['m1', 'm2', 'm3'], { base: 3, cap: 5 })).toHaveLength(5);
    expect(shownObjectives(p, ['m1', 'm2', 'm3'], { base: 3, cap: 4 })).toHaveLength(4);
  });

  it('весь запас за один заход не взять — главу проходят несколько раз', () => {
    const p = pool(10);
    let done: string[] = [];
    let runs = 0;
    while (done.length < p.length && runs < 20) {
      done = settleObjectives(p, done, empty, 'p1').done;
      runs += 1;
    }
    expect(done).toHaveLength(10);
    expect(runs).toBeGreaterThan(1);
  });

  it('мусор в слотах не ломает показ', () => {
    expect(shownObjectives(pool(5), [], { base: 0, cap: -1 })).toHaveLength(1);
    expect(shownObjectives(pool(5), [], { base: 2.7, cap: 1 })).toHaveLength(2);
  });
});

describe('номинал падает с числом видимых задач', () => {
  it('до базы — объявленный, сверх — меньше, но не ноль', () => {
    expect(objectiveNominal(3, 3)).toBe(3);
    expect(objectiveNominal(3, 5)).toBe(2);
    expect(objectiveNominal(2, 5)).toBe(1);
    expect(objectiveNominal(1, 5)).toBe(1);
    expect(objectiveNominal(0, 5)).toBe(0);
  });

  it('пять задач по +3 не дают больше самого забега (14)', () => {
    const { bonus } = settleObjectives(pool(10), ['x1', 'x2'].concat([]), empty, 'p1', {
      base: 3,
      cap: 5,
    });
    expect(bonus).toBeLessThanOrEqual(9);
    const five = settleObjectives(pool(10), [], empty, 'p1', { base: 5, cap: 5 });
    expect(five.bonus).toBe(15); // база 5 — номинал ещё не режется: правило про превышение БАЗЫ
    const over = settleObjectives(pool(10), ['m9', 'm10'], empty, 'p1');
    expect(over.results).toHaveLength(5);
    expect(over.bonus).toBe(10);
    expect(over.bonus).toBeLessThan(14);
  });
});

describe('засчёт забега', () => {
  const data = shippedGameData();
  const ended = (): GameState => {
    const s = pveState(data, 0);
    s.pve = { waveNumber: 4, totalWaves: 10, npcPlayerId: 'p3' };
    s.match.status = 'ended';
    s.match.winner = 'p3';
    return s;
  };
  const chapter = (id: string, objectives: MissionObjective[]): SectorChapter => ({
    id,
    objectives,
  });

  it('выполненная задача не платит второй раз', () => {
    const ch = chapter('a', [easy('m1'), hard('m2')]);
    const first = settleSectorZeroRun(
      { ...freshSectorZeroProgress(data), nextAttempt: 3 },
      1,
      ended(),
      ch,
    );
    expect(first.objectivesDone.a).toEqual(['m1']);
    expect(first.lastRun?.bonus).toBe(3);
    const second = settleSectorZeroRun(first, 2, ended(), ch);
    expect(second.lastRun?.objectives.map((o) => o.id)).toEqual(['m2']);
    expect(second.lastRun?.bonus).toBe(0);
  });

  it('счёт у каждой главы свой', () => {
    const run = (p: ReturnType<typeof freshSectorZeroProgress>, attempt: number, id: string) =>
      settleSectorZeroRun(
        { ...p, nextAttempt: attempt + 1 },
        attempt,
        ended(),
        chapter(id, pool(10)),
      );
    const a1 = run(freshSectorZeroProgress(data), 1, 'a');
    expect(a1.objectivesDone.a).toHaveLength(3);
    const b1 = run(a1, 2, 'b');
    // Глава B начинает с базы: открытое в A её не раздувает.
    expect(b1.lastRun?.objectives).toHaveLength(3);
    const a2 = run(b1, 3, 'a');
    expect(a2.lastRun?.objectives).toHaveLength(5);
  });

  it('итог раскладывает забег и надбавку, и говорит, что открылось', () => {
    const p = settleSectorZeroRun(
      { ...freshSectorZeroProgress(data), nextAttempt: 2 },
      1,
      ended(),
      chapter('a', [easy('m1'), hard('m2'), hard('m3'), easy('m4'), easy('m5')]),
    );
    const r = p.lastRun!;
    expect(r.base).toBe(1 + ended().pve!.waveNumber);
    expect(r.bonus).toBe(3);
    expect(r.total).toBe(r.base + r.bonus);
    expect(p.lastReward).toBe(r.total);
    expect(r.objectives.map((o) => [o.id, o.complete, o.paid])).toEqual([
      ['m1', true, 3],
      ['m2', false, 0],
      ['m3', false, 0],
    ]);
    expect(r.unlocked).toBe(2); // m4 на место m1 и m5 за выполненную
    expect(r.won).toBe(false);
    expect(p.chaptersWon).toEqual([]);
  });

  it('победа отмечает главу пройденной один раз', () => {
    const won = ended();
    won.match.winner = 'p1';
    const ch = chapter('a', []);
    const first = settleSectorZeroRun(
      { ...freshSectorZeroProgress(data), nextAttempt: 3 },
      1,
      won,
      ch,
    );
    const second = settleSectorZeroRun(first, 2, won, ch);
    expect(second.chaptersWon).toEqual(['a']);
  });

  it('профиль переживает сохранение, а правленый мусор отбрасывается', () => {
    const p = settleSectorZeroRun(
      { ...freshSectorZeroProgress(data), nextAttempt: 2 },
      1,
      ended(),
      chapter('a', [easy('m1')]),
    );
    const back = parseSectorZeroProgress(JSON.stringify(p), data);
    expect(back.objectivesDone).toEqual(p.objectivesDone);
    expect(back.lastRun).toEqual(p.lastRun);
    const junk = parseSectorZeroProgress(
      JSON.stringify({
        ...p,
        objectivesDone: { a: [1, 'm1', 'm1'] },
        chaptersWon: 'a',
        lastRun: { total: -1 },
      }),
      data,
    );
    expect(junk.objectivesDone).toEqual({ a: ['m1'] });
    expect(junk.chaptersWon).toEqual([]);
    expect(junk.lastRun).toBeNull();
  });
});

describe('главы кампании — запас растёт с номером главы', () => {
  it('у каждой главы запас не меньше базы, и он растёт от главы к главе', () => {
    const pools = Array.from(
      { length: PVE_MISSION_COUNT },
      (_, i) => pveChapter(i).objectives.length,
    );
    expect(pools[0]).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < pools.length; i++) expect(pools[i]).toBeGreaterThan(pools[i - 1]!);
  });

  it('id глав различны — иначе счёт выполненного у них был бы общий', () => {
    const chapters = Array.from({ length: PVE_MISSION_COUNT }, (_, i) => pveChapter(i).id);
    expect(new Set(chapters).size).toBe(chapters.length);
  });

  it('у каждой главы задачи ВЫПОЛНИМЫ и не выполнены на старте', () => {
    const data = shippedGameData();
    for (let i = 0; i < PVE_MISSION_COUNT; i++) {
      const start = pveState(data, i);
      start.pve = { waveNumber: 0, totalWaves: 10, npcPlayerId: 'p3' };
      for (const o of pveChapter(i).objectives) {
        const at = `${pveChapter(i).id}/${o.id}`;
        if (o.kind === 'control')
          for (const id of o.targets)
            expect([at, start.planets[id]?.owner !== 'p1'], id).toEqual([at, true]);
        if (o.kind === 'raze' || o.kind === 'build')
          for (const b of o.targets) expect([at, b in data.buildings]).toEqual([at, true]);
        if (o.kind === 'wave') expect([at, (o.count ?? 0) <= 10]).toEqual([at, true]);
        expect([at, objectiveProgress(o, start, 'p1').complete]).toEqual([at, false]);
      }
    }
  });

  it('новые глаголы: «дожить до волны» и «держать постройки»', () => {
    const s = pveState(shippedGameData(), 0);
    s.pve = { waveNumber: 0, totalWaves: 10, npcPlayerId: 'p3' };
    const wave: MissionObjective = { id: 'w', kind: 'wave', targets: [], count: 2, reward: 1 };
    s.pve!.waveNumber = 1;
    expect(objectiveProgress(wave, s, 'p1')).toMatchObject({ done: 1, total: 2, complete: false });
    s.pve!.waveNumber = 2;
    expect(objectiveProgress(wave, s, 'p1').complete).toBe(true);
    const build: MissionObjective = {
      id: 'b',
      kind: 'build',
      targets: ['shipyard'],
      count: 1,
      reward: 1,
    };
    expect(objectiveProgress(build, s, 'p1').complete).toBe(true);
    expect(objectiveProgress({ ...build, count: 5 }, s, 'p1').complete).toBe(false);
  });
});

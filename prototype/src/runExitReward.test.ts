/**
 * Выход из экспедиции показывает награду (решение владельца 2026-09-26: «и показывает, сколько
 * награды заберёшь сейчас»). Обещанное обязано совпасть с выплаченным, поэтому тест не сверяет
 * формулу саму с собой: превью считается ДО сдачи, а выплата — засчётом ПОСЛЕ настоящего
 * `pve.abandon`, прошедшего через ядро прототипа.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { pveChapter, pveModeId, pveState } from '../../packages/client/src/gameData';
import { abandonRun } from '../../decisions/actions';
import {
  abandonRunReward,
  freshSectorZeroProgress,
  settleSectorZeroRun,
} from '../../decisions/sectorZeroProgress';
import type { GameState } from '../../packages/shared-core/src/index';
import { data } from './gameData';
import { advance, order, setMatchMode } from './protoKernel';

afterEach(() => setMatchMode(undefined));

/** Забег главы I в разгаре: волны прошли, враги уничтожены, у игрока ветераны. */
function midRun(): GameState {
  setMatchMode(pveModeId());
  const s = advance(pveState(data), 1).state;
  const fleet = Object.values(s.fleets).find((f) => f.owner === 'p1');
  if (!fleet) throw new Error('у игрока нет флота');
  const units = fleet.units.map((u, i) => (i === 0 ? { ...u, battles: 999, damageDealt: 1e6 } : u));
  return {
    ...s,
    fleets: { ...s.fleets, [fleet.id]: { ...fleet, units } },
    pve: { ...s.pve!, waveNumber: 3, tally: { p1: { lost: 2, destroyed: 11 } } },
  };
}

describe('выход из экспедиции: превью награды = выплата после сдачи', () => {
  it('данные и Варранты превью — ровно то, что засчитано после pve.abandon', () => {
    const s = midRun();
    const chapter = pveChapter(0);
    const p = { ...freshSectorZeroProgress(data), research: 7, warrants: 30, nextAttempt: 2 };
    const preview = abandonRunReward(p, s, chapter, data);

    const ended = order(s, abandonRun('p1'), s.time);
    expect(ended.error).toBeUndefined();
    expect(ended.state.match).toMatchObject({ status: 'ended', reason: 'pve-failed' });
    const settled = settleSectorZeroRun(p, 1, ended.state, chapter, data);

    expect(settled.lastRun).toMatchObject({ won: false, waves: 3, kills: 11 });
    expect(settled.lastRun!.veterans).toBeGreaterThan(0); // медали сохранённых — в превью тоже
    expect(preview).toEqual({ research: settled.lastRun!.total, warrants: settled.lastRun!.warrants });
    expect(settled.research - p.research).toBe(preview.research);
    expect(settled.warrants - p.warrants).toBe(preview.warrants);
  });

  it('не забег — ноль, а не выдуманная сумма', () => {
    const s = pveState(data);
    const p = freshSectorZeroProgress(data);
    expect(abandonRunReward(p, { ...s, pve: undefined }, pveChapter(0), data)).toEqual({ research: 0, warrants: 0 });
    expect(
      abandonRunReward(p, { ...s, pve: { ...s.pve!, waveNumber: -1 } }, pveChapter(0), data),
    ).toEqual({ research: 0, warrants: 0 });
  });
});

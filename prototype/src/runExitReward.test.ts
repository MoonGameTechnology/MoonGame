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

  it('сдача в первую секунду не платит ничего (баг-репорт владельца 2026-09-28)', () => {
    // «Если сразу завершить экспедицию, я могу получить награду, хотя прошла 1 секунда».
    // Ни волны, ни убитых, ни задач: платить не за что — ни данными, ни Варрантами, ни
    // добычей. Иначе «начать → завершить» печатало валюту и перебрасывало добычу даром.
    setMatchMode(pveModeId());
    const s = advance(pveState(data), 1).state;
    expect(s.pve!.waveNumber).toBe(0);
    const chapter = pveChapter(0);
    const p = { ...freshSectorZeroProgress(data), nextAttempt: 2 };
    expect(abandonRunReward(p, s, chapter, data)).toEqual({ research: 0, warrants: 0 });

    const ended = order(s, abandonRun('p1'), s.time);
    expect(ended.error).toBeUndefined();
    const settled = settleSectorZeroRun(p, 1, ended.state, chapter, data);
    expect(settled.settledThrough).toBe(1); // засчитан — второй раз не засчитается
    expect(settled.research).toBe(p.research);
    expect(settled.warrants).toBe(p.warrants);
    expect(settled.moduleCopies).toEqual(p.moduleCopies);
    expect(settled.blueprints).toEqual(p.blueprints);
    expect(settled.heroTokens).toEqual(p.heroTokens);
    expect(settled.lastRun).toMatchObject({ total: 0, warrants: 0, loot: { copies: {}, blueprints: {} } });

    // Контроль: пришла первая волна — забег сыгран и платит, как раньше.
    const waved = { ...s, pve: { ...s.pve!, waveNumber: 1 } };
    const after = settleSectorZeroRun(p, 1, order(waved, abandonRun('p1'), s.time).state, chapter, data);
    expect(after.research - p.research).toBe(2);
    expect(Object.values(after.lastRun!.loot!.copies).reduce((a, b) => a + b, 0)).toBe(1);
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

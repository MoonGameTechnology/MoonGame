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
  WARRANTS_PER_REWARD,
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

    // Бой до первой волны тоже не платит: Рой главы II высаживается на Холодную отмель в
    // первую же секунду и гибнет о гарнизон, и трое убитых давали сдаче «через секунду» +3 ⌖.
    // Медали ветеранов — туда же.
    const mid = midRun();
    const fought = { ...mid, pve: { ...mid.pve!, waveNumber: 0 } };
    expect(abandonRunReward(p, fought, chapter, data)).toEqual({ research: 0, warrants: 0 });
    const early = settleSectorZeroRun(p, 1, order(fought, abandonRun('p1'), fought.time).state, chapter, data);
    expect(early.lastRun).toMatchObject({ kills: 11, killWarrants: 0, total: 0, warrants: 0 });
    expect(early.lastRun).not.toHaveProperty('veterans');

    // Контроль: пришла первая волна — она и платит, одной единицей данных.
    const waved = { ...s, pve: { ...s.pve!, waveNumber: 1 } };
    const after = settleSectorZeroRun(p, 1, order(waved, abandonRun('p1'), s.time).state, chapter, data);
    expect(after.research - p.research).toBe(1);
    expect(after.warrants - p.warrants).toBe(WARRANTS_PER_REWARD);
  });

  it('«дождаться первой волны и сдаться» по кругу не выгоднее одной долгой экспедиции', () => {
    // Первая волна приходит через шесть игровых часов — 72 секунды на ускорении. До
    // 2026-09-29 такая сдача платила «за сам забег» целиком: +1 данных, гарантированные
    // дубль и жетон и 8% на чертёж. Сто таких кругов давали сто дублей и сто жетонов —
    // впятеро больше честной победной игры за то же время. Теперь ожидаемая добыча за волну
    // одна и та же, как ни режь время на забеги.
    setMatchMode(pveModeId());
    const chapter = pveChapter(0);
    const seeded = advance(pveState(data), 1).state;
    let s = seeded;
    while (s.pve!.waveNumber < 1) s = advance(s, s.time + 3_600_000).state;
    expect(s.time - seeded.time).toBeLessThanOrEqual(6 * 3_600_000);
    const sum = (r: Record<string, number> | undefined): number => Object.values(r ?? {}).reduce((a, b) => a + b, 0);

    const N = 100;
    let p = { ...freshSectorZeroProgress(data, 'farm'), nextAttempt: N + 1 };
    let copies = 0;
    let tokens = 0;
    for (let i = 1; i <= N; i++) {
      // Сдаётся в разные секунды после волны — исходы миров разные, как у живого игрока.
      const at = advance(s, s.time + i * 1000).state;
      p = settleSectorZeroRun(p, i, order(at, abandonRun('p1'), at.time).state, chapter, data);
      copies += sum(p.lastRun!.loot!.copies);
      tokens += sum(p.lastRun!.loot!.heroTokens);
    }
    // Данные и Варранты — ровно за пришедшие волны: сто волн, как у десяти долгих забегов.
    expect(p.research).toBe(N);
    expect(p.warrants).toBe(N * WARRANTS_PER_REWARD);
    // Дубль и жетон «за сам забег» — десятая доля забега на круг: около N/10, а не N.
    expect(copies).toBeLessThanOrEqual(N / 5);
    expect(tokens).toBeLessThanOrEqual(N / 5);

    // Долгий забег, сданный на десятой волне, получает свой дубль и жетон наверняка.
    const long = { ...s, pve: { ...s.pve!, waveNumber: 10 } };
    const full = settleSectorZeroRun(
      { ...freshSectorZeroProgress(data, 'farm'), nextAttempt: 2 },
      1,
      order(long, abandonRun('p1'), long.time).state,
      chapter,
      data,
    );
    expect(full.research).toBe(10);
    expect(sum(full.lastRun!.loot!.copies)).toBe(1);
    expect(sum(full.lastRun!.loot!.heroTokens)).toBe(1);
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

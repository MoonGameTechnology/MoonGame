/**
 * БОСС ЗАБЕГА (PVR-4.7): задача «Убить Левиафана», её строка в панели, выплата в итогах и
 * всё, что не должно пустить босса в руки игрока.
 */
import { describe, expect, it } from 'vitest';
import { bossBounty, bossTask } from './runBoss';
import { bossMissionRow } from './missionView';
import {
  changeSectorZeroProgress,
  freshSectorZeroProgress,
  parseSectorZeroProgress,
  settleSectorZeroRun,
  WARRANTS_PER_REWARD,
} from './sectorZeroProgress';
import { swarmCatalog } from './swarmCodex';
import { grantTokenHeroes, heroTokenUse, rollHeroTokens } from './heroTokens';
import { shippedGameData } from '../data/bundle';
import { pveState } from '../packages/client/src/gameData';
import type { GameState } from '../packages/shared-core/src/index';
import { ru } from '../localization/ru';
import { en } from '../localization/en';

const data = shippedGameData();
const BOSS = data.modes.pve_waves!.pve!.boss!;

/** Забег главы I после последней волны; босс на поле, живой или павший. */
function run(boss: 'none' | 'alive' | 'slain'): GameState {
  const s = pveState(data, 0);
  s.pve = { waveNumber: 10, totalWaves: 10, npcPlayerId: 'p3' };
  s.match.status = 'ended';
  s.match.winner = 'p1';
  if (boss !== 'none')
    s.pve.boss = {
      heroId: 'hero:p3:boss',
      hero: BOSS.hero,
      spawnedAt: 60 * 3_600_000,
      reward: BOSS.reward,
      ...(boss === 'slain' ? { slainAt: 66 * 3_600_000 } : {}),
    };
  return s;
}

const settle = (s: GameState) =>
  settleSectorZeroRun({ ...freshSectorZeroProgress(data), nextAttempt: 2 }, 1, s, undefined, data)
    .lastRun!;

describe('задача босса', () => {
  it('нет босса — нет задачи и нет выплаты: слабый Рой и волны до последней', () => {
    expect(bossTask(run('none'))).toBeNull();
    expect(bossBounty(run('none'))).toBe(0);
  });

  it('босс жив — задача видна и не выполнена; пал — выполнена и платит объявленное', () => {
    expect(bossTask(run('alive'))).toEqual({
      hero: 'leviathan',
      slain: false,
      reward: BOSS.reward,
    });
    expect(bossBounty(run('alive'))).toBe(0);
    expect(bossTask(run('slain'))?.slain).toBe(true);
    expect(bossBounty(run('slain'))).toBe(BOSS.reward);
  });

  it('строка панели: «Убить Левиафана», 0/1 → 1/1, награда целиком и без меток', () => {
    const alive = bossMissionRow(bossTask(run('alive'))!);
    expect(alive).toMatchObject({
      id: 'boss.leviathan.task',
      kind: 'boss',
      done: 0,
      total: 1,
      complete: false,
    });
    expect(alive.targets).toEqual([]);
    expect(alive.reward).toEqual({
      research: BOSS.reward,
      warrants: BOSS.reward * WARRANTS_PER_REWARD,
    });
    expect(bossMissionRow(bossTask(run('slain'))!)).toMatchObject({ done: 1, complete: true });
  });

  it('у каждого босса в данных есть все фразы на обоих языках', () => {
    // Ключ строится из архетипа (`boss.<архетип>.<фраза>`), литералом в коде его нет —
    // разбор ключей его не видит, и забытая фраза уехала бы к игроку сырым ключом.
    const bosses = Object.values(data.modes)
      .map((m) => m.pve?.boss?.hero)
      .filter((h): h is string => h !== undefined);
    expect(bosses.length).toBeGreaterThan(0);
    const missing = bosses
      .flatMap((h) =>
        ['task', 'spawned', 'slain', 'siege', 'siege-broken', 'devoured'].map(
          (phrase) => `boss.${h}.${phrase}`,
        ),
      )
      .filter((k) => !(k in ru) || !(k in en));
    expect(missing).toEqual([]);
  });
});

describe('выплата за босса в итогах', () => {
  it('павший босс — отдельная строка, и она в сумме, данных и Варрантах', () => {
    const base = settle(run('alive'));
    const slain = settle(run('slain'));
    expect(base).not.toHaveProperty('boss');
    expect(slain.boss).toEqual({ hero: 'leviathan', reward: BOSS.reward });
    expect(slain.total).toBe(base.total + BOSS.reward);
    expect(slain.warrants).toBe(slain.total * WARRANTS_PER_REWARD);
  });

  it('строка босса переживает сохранение профиля; мусор в ней отбрасывается', () => {
    const progress = settleSectorZeroRun(
      { ...freshSectorZeroProgress(data), nextAttempt: 2 },
      1,
      run('slain'),
      undefined,
      data,
    );
    const back = parseSectorZeroProgress(JSON.stringify(progress), data);
    expect(back.lastRun?.boss).toEqual({ hero: 'leviathan', reward: BOSS.reward });
    const junk = JSON.parse(JSON.stringify(progress)) as { lastRun: Record<string, unknown> };
    junk.lastRun.boss = { hero: 42, reward: 'много' };
    expect(parseSectorZeroProgress(JSON.stringify(junk), data).lastRun).not.toHaveProperty('boss');
  });
});

describe('босс не попадает в руки игрока', () => {
  it('его нельзя открыть в Академии ни за какие данные', () => {
    const rich = { ...freshSectorZeroProgress(data), research: 10_000 };
    expect(
      changeSectorZeroProgress(rich, { kind: 'unlock-hero', id: 'leviathan' }, data),
    ).toBeNull();
  });

  it('жетоны героев на босса не падают — десятью жетонами его не привести', () => {
    const p = freshSectorZeroProgress(data);
    expect(heroTokenUse(p, BOSS.hero, data)).toBeNull();
    for (let attempt = 1; attempt <= 60; attempt++) {
      const got = rollHeroTokens({ seed: 's', attempt, outcome: 'w', progress: p, data, won: true, newTasks: 2 });
      expect(Object.keys(got)).not.toContain(BOSS.hero);
    }
    const hoard = { ...p, heroTokens: { [BOSS.hero]: 99 } };
    expect(grantTokenHeroes(hoard, data).joined).toEqual([]);
  });

  it('подменённый профиль с боссом-героем читается без него', () => {
    const p = freshSectorZeroProgress(data);
    const forged = JSON.parse(JSON.stringify(p)) as {
      heroes: Record<string, unknown>;
      selectedHero: string;
    };
    forged.heroes.leviathan = { level: 3, skills: [], equipped: [] };
    forged.selectedHero = 'leviathan';
    const back = parseSectorZeroProgress(JSON.stringify(forged), data);
    expect(back.heroes).not.toHaveProperty('leviathan');
    expect(back.selectedHero).not.toBe('leviathan');
  });

  it('досье Роя знает корабль босса — карточкой «?» до первой встречи', () => {
    expect(swarmCatalog(data, []).units).toContain(data.heroes.leviathan!.ship.unit);
  });
});

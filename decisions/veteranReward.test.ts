/**
 * ВЫПЛАТА ЗА ВЕТЕРАНОВ В ЗАБЕГЕ (VET-7, резолюция владельца 2026-09-24: «в Sector Zero —
 * урон, корпус и выплата»).
 *
 * Выплата та же, что в сетевой партии (`veteranXp`, VET-4): медали на ЖИВЫХ юнитах к концу
 * забега, степень дороже — плата выше. Забег переводит её в свою награду курсом
 * `MEDAL_XP_PER_REWARD` и кладёт третьей частью рядом с волнами и задачами.
 */
import { describe, expect, it } from 'vitest';
import {
  freshSectorZeroProgress,
  MEDAL_XP_PER_REWARD,
  parseSectorZeroProgress,
  settleSectorZeroRun,
  veteranReward,
  WARRANTS_PER_REWARD,
} from './sectorZeroProgress';
import { shippedGameData } from '../data/bundle';
import { pveState } from '../packages/client/src/gameData';
import { veteranXp, type GameState, type UnitStack } from '../packages/shared-core/src/index';

const data = shippedGameData();

/** Выигранный забег главы I; у p1 — флот `vets` с заданным составом. */
function wonRun(units: UnitStack[]): GameState {
  const s = pveState(data, 0);
  s.pve = { waveNumber: 10, totalWaves: 10, npcPlayerId: 'p3' };
  s.match.status = 'ended';
  s.match.winner = 'p1';
  const home = Object.values(s.planets).find((p) => p.owner === 'p1' && p.kind === 'planet')!;
  s.fleets.vets = { id: 'vets', owner: 'p1', location: home.id, movement: null, traits: [], units };
  return s;
}

/** Пятнадцать ветеранов с «Немеркнущим строем» — расклад победной обороны из замера. */
const VETERANS: UnitStack[] = [{ unit: 'cruiser', count: 15, battles: 4, damageDealt: 120 }];

const settle = (s: GameState, withData = true) =>
  settleSectorZeroRun(
    { ...freshSectorZeroProgress(data), nextAttempt: 2 },
    1,
    s,
    undefined,
    withData ? data : undefined,
  );

describe('выплата за ветеранов в забеге (VET-7)', () => {
  it('курс — одна и та же выплата медалей, что в сетевой партии, делённая на курс', () => {
    const s = wonRun(VETERANS);
    const xp = veteranXp(s, 'p1', data);
    expect(xp).toBeGreaterThan(0);
    expect(veteranReward(s, 'p1', data)).toBe(Math.round(xp / MEDAL_XP_PER_REWARD));
  });

  it('медали живых ветеранов — третья часть награды, в данных и в Варрантах', () => {
    const baseline = settle(wonRun([])).lastRun!;
    const run = settle(wonRun(VETERANS)).lastRun!;
    const paid = veteranReward(wonRun(VETERANS), 'p1', data);
    expect(paid).toBeGreaterThan(0);
    expect(run.veterans).toBe(paid);
    expect(run.total).toBe(run.base + run.bonus + paid);
    expect(run.total).toBe(baseline.total + paid);
    expect(run.warrants).toBe(run.total * WARRANTS_PER_REWARD);
  });

  it('степень дороже — плата выше (решение владельца 6)', () => {
    const scarred = veteranReward(wonRun([{ unit: 'cruiser', count: 15, battles: 2 }]), 'p1', data);
    const unbroken = veteranReward(wonRun([{ unit: 'cruiser', count: 15, battles: 4 }]), 'p1', data);
    expect(unbroken).toBeGreaterThan(scarred);
  });

  it('погибший ветеран не платит: без живых медалей строки выплаты нет вовсе', () => {
    const run = settle(wonRun([{ unit: 'cruiser', count: 15 }])).lastRun!;
    expect(run).not.toHaveProperty('veterans');
    expect(run.total).toBe(run.base + run.bonus);
  });

  it('без каталога порогов медалей платить не за что — засчёт не падает', () => {
    const run = settle(wonRun(VETERANS), false).lastRun!;
    expect(run).not.toHaveProperty('veterans');
  });

  it('выплата переживает сохранение профиля, а старый итог без неё читается', () => {
    const p = settle(wonRun(VETERANS));
    const back = parseSectorZeroProgress(JSON.stringify(p), data);
    expect(back.lastRun?.veterans).toBe(p.lastRun?.veterans);
    const old = JSON.parse(JSON.stringify(p)) as { lastRun: Record<string, unknown> };
    delete old.lastRun.veterans;
    expect(parseSectorZeroProgress(JSON.stringify(old), data).lastRun).not.toHaveProperty('veterans');
  });
});

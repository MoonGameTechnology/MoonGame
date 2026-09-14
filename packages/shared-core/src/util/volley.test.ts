/**
 * ДЕЛЁЖ ЗАЛПА (MSB-2) — чистая арифметика решения владельца §0.0 №1.
 *
 * «Урон дробится на всех врагов стороны»: выбора цели у игрока нет, спрятаться за спину
 * союзника нельзя. Правило живёт ЗДЕСЬ, рядом с исполнением, потому что читателей у него
 * двое — живой раунд боя и прогноз (`previewBattle`). Две копии одного правила уже
 * расходились, и прогноз обещал игроку не тот бой, который он получал.
 */
import { describe, expect, it } from 'vitest';
import { splitVolley, volleyShare } from './volley';
import type { CombatantRef } from '../state/gameState';

const fleet = (id: string): CombatantRef => ({ kind: 'fleet', fleetId: id });

describe('MSB-2 — доля залпа', () => {
  it('ОДИН ВРАГ БЕРЁТ ВСЁ: на двух сторонах это ровно сегодняшнее поведение', () => {
    expect(volleyShare(100, 1)).toBe(100);
  });

  it('ДЕЛИТСЯ РОВНО, а не по силе сторон: трое врагов — по трети каждому', () => {
    expect(volleyShare(90, 3)).toBe(30);
    expect(volleyShare(100, 3)).toBeCloseTo(33.3333, 3);
  });

  it('ВРАГОВ НЕТ — ЗАЛП НИКУДА НЕ УХОДИТ, а не достаётся кому-то целиком', () => {
    expect(volleyShare(100, 0)).toBe(0);
  });

  it('ПУСТОЙ ЗАЛП ОСТАЁТСЯ ПУСТЫМ при любом числе врагов', () => {
    expect(volleyShare(0, 7)).toBe(0);
  });

  it('СУММА ДОЛЕЙ РАВНА ЗАЛПУ — делёж ничего не создаёт и не теряет', () => {
    const n = 7;
    const total = Array.from({ length: n }, () => volleyShare(100, n)).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 9);
  });
});

describe('MSB-2 — залп по списку врагов', () => {
  it('КАЖДЫЙ ВРАГ ПОЛУЧАЕТ СВОЮ ДОЛЮ, и адресат едет вместе с ней', () => {
    const shares = splitVolley(60, [
      { ref: fleet('B'), owner: 'p2' },
      { ref: fleet('C'), owner: 'p3' },
    ]);
    expect(shares).toEqual([
      { to: fleet('B'), toOwner: 'p2', damage: 30 },
      { to: fleet('C'), toOwner: 'p3', damage: 30 },
    ]);
  });

  it('БЕЗ ВРАГОВ ДОЛЕЙ НЕТ — пустой список, а не доля в никуда', () => {
    expect(splitVolley(60, [])).toEqual([]);
  });

  it('ПОРЯДОК ВРАГОВ СОХРАНЯЕТСЯ: делёж детерминирован порядком вступления в бой', () => {
    const shares = splitVolley(30, [
      { ref: fleet('C'), owner: 'p3' },
      { ref: fleet('A'), owner: 'p1' },
      { ref: fleet('B'), owner: 'p2' },
    ]);
    expect(shares.map((s) => s.toOwner)).toEqual(['p3', 'p1', 'p2']);
  });
});

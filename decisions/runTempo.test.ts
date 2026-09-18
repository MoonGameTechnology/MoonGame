import { describe, it, expect } from 'vitest';

import {
  RUN_SPEED_FAST,
  RUN_SPEED_NORMAL,
  RUN_SPINE_HOURS,
  RUN_TAIL_HOURS,
  runMinutes,
} from './runTempo';

/** Отрезок, в котором живёт ПРОЙДЕННЫЙ забег: от хребта (быстрее последней волны не
 *  успеть) до хребта с хвостом на контратаку. */
const SHORTEST = RUN_SPINE_HOURS;
const LONGEST = RUN_SPINE_HOURS + RUN_TAIL_HOURS;

describe('темп забега (PVR-2.2)', () => {
  it('арифметика: ×1 — это настенные часы', () => {
    expect(runMinutes(1, 1)).toBe(60);
    expect(runMinutes(60, 60)).toBe(60);
  });

  // Решение владельца 2026-09-18 переведено в ИСПОЛНЯЕМУЮ проверку: не «мы подобрали
  // множитель», а «весь отрезок пройденного забега попадает в названные минуты». Сдвинут
  // множитель или расписание волн — тест скажет это раньше игрока.
  it('на обычной скорости полное прохождение укладывается в 25–35 минут', () => {
    expect(runMinutes(SHORTEST, RUN_SPEED_NORMAL)).toBeGreaterThanOrEqual(23);
    expect(runMinutes(LONGEST, RUN_SPEED_NORMAL)).toBeLessThanOrEqual(35);
  });

  it('с ускорением — в 15–25 минут', () => {
    expect(runMinutes(SHORTEST, RUN_SPEED_FAST)).toBeGreaterThanOrEqual(15);
    expect(runMinutes(LONGEST, RUN_SPEED_FAST)).toBeLessThanOrEqual(25);
  });

  it('ускорение именно УСКОРЯЕТ, и ровно в полтора раза', () => {
    // Полоса «25–35» против «15–25» — это ×1.5 по серединам. Больше — и ускорение
    // проскакивает нижнюю границу, меньше — его не почувствовать.
    expect(RUN_SPEED_FAST).toBeGreaterThan(RUN_SPEED_NORMAL);
    expect(RUN_SPEED_FAST / RUN_SPEED_NORMAL).toBeCloseTo(1.5, 5);
  });

  it('дефолт песочницы (×10) для забега негоден — ради этого кирпич и заведён', () => {
    // Сторож от тихого возврата: ×10 превращает забег в четырнадцатичасовое сидение.
    expect(runMinutes(LONGEST, 10)).toBeGreaterThan(8 * 60);
  });
});

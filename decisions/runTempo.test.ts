import { describe, it, expect } from 'vitest';

import { shippedGameData } from '../data/bundle';
import {
  RUN_SPEED_FAST,
  RUN_SPEED_NORMAL,
  RUN_SPINE_HOURS,
  RUN_TAIL_HOURS,
  runMinutes,
} from './runTempo';

/** Отрезок, в котором живёт ПРОЙДЕННЫЙ забег: от хребта (быстрее последней волны не
 *  успеть — это ранний финиш зачисткой) до хребта с удержанием после неё (PVR-2.5). */
const SHORTEST = RUN_SPINE_HOURS;
const LONGEST = RUN_SPINE_HOURS + RUN_TAIL_HOURS;

describe('темп забега (PVR-2.2)', () => {
  it('хвост темпа — это удержание режима, а не отдельное число (PVR-2.5)', () => {
    // Раньше хвост был оценкой; теперь это правило, и живёт оно в данных. Правка одного
    // без другого сдвинула бы полосу минут молча — тест ниже мерил бы не ту игру.
    const pve = shippedGameData().modes.pve_waves?.pve;
    expect(pve?.holdHours).toBe(RUN_TAIL_HOURS);
    expect((pve?.waves ?? 0) * (pve?.waveIntervalHours ?? 0)).toBe(RUN_SPINE_HOURS);
  });

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
    // Сторож от тихого возврата: ×10 растягивает забег на семь с лишним часов — в десятки
    // раз дальше верхней границы владельца (35 минут). Порог — от самой полосы, а не
    // голым числом: хвост с тех пор уже сжимался (PVR-2.5), а смысл сторожа — нет.
    expect(runMinutes(LONGEST, 10)).toBeGreaterThan(10 * 35);
  });
});

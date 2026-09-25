import { describe, it, expect } from 'vitest';

import { shippedGameData } from '../data/bundle';
import {
  RUN_SPEED_DEV,
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

  it('с ускорением — в 12–15 минут', () => {
    expect(runMinutes(SHORTEST, RUN_SPEED_FAST)).toBeGreaterThanOrEqual(12);
    expect(runMinutes(LONGEST, RUN_SPEED_FAST)).toBeLessThanOrEqual(15);
  });

  it('ускорение именно УСКОРЯЕТ, и ровно вдвое (решение владельца 2026-09-25)', () => {
    // Прежние ×1,5 на экране почти не отличались от ▶ — владелец: «на второй стрелочке
    // не сильно быстрее». Вдвое — различимо и всё ещё играбельно.
    expect(RUN_SPEED_FAST).toBeGreaterThan(RUN_SPEED_NORMAL);
    expect(RUN_SPEED_FAST / RUN_SPEED_NORMAL).toBe(2);
  });

  it('дефолт песочницы (×10) для забега негоден — ради этого кирпич и заведён', () => {
    // Сторож от тихого возврата: ×10 растягивает забег на семь с лишним часов — в десятки
    // раз дальше верхней границы владельца (35 минут). Порог — от самой полосы, а не
    // голым числом: хвост с тех пор уже сжимался (PVR-2.5), а смысл сторожа — нет.
    expect(runMinutes(LONGEST, 10)).toBeGreaterThan(10 * 35);
  });
});

describe('дев-темп забега ▶▶▶ (заказ владельца 2026-09-24)', () => {
  it('проводит весь забег за считанные минуты — чтобы проверять волны, а не ждать их', () => {
    expect(runMinutes(RUN_SPINE_HOURS + RUN_TAIL_HOURS, RUN_SPEED_DEV)).toBeLessThanOrEqual(3);
  });

  it('быстрее игроцкого ускорения — иначе третья кнопка ничего не даёт', () => {
    expect(RUN_SPEED_DEV).toBeGreaterThan(RUN_SPEED_FAST);
  });
});

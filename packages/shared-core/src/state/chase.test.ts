/**
 * ПОГОНЯ (SHU-4.4) — геометрия одного пересчёта.
 *
 * Решение чистое и живёт в ядре: его зовёт обработчик `time.advanced` модуля челноков,
 * и вся его детерминированность держится на том, что шаг не зависит ни от чего, кроме
 * своих аргументов.
 */
import { describe, expect, it } from 'vitest';
import { chaseRadius, chaseStep } from './chase';
import type { GameData } from '../data/schemas';

const at = (x: number, y: number) => ({ x, y });

/** Каталог на два челнока: у одного радиус захвата больше, у другого меньше. */
const data = {
  units: {
    interceptor: { stats: { chaseRadius: 20 } },
    bomber: { stats: { chaseRadius: 12 } },
    tug: { stats: {} },
  },
} as unknown as GameData;

describe('SHU-4.4 — радиус захвата соединения', () => {
  it('РАДИУС БЕРЁТСЯ ПО САМОЙ ТУПОЙ МАШИНЕ — как дальность по самой короткой руке', () => {
    expect(chaseRadius([{ unit: 'interceptor', count: 2 }], data)).toBe(20);
    expect(
      chaseRadius(
        [
          { unit: 'interceptor', count: 2 },
          { unit: 'bomber', count: 1 },
        ],
        data,
      ),
    ).toBe(12);
  });

  it('ПУСТЫЕ СТЕКИ НЕ СЧИТАЮТСЯ: списанная машина не правит радиус живому соединению', () => {
    expect(
      chaseRadius(
        [
          { unit: 'bomber', count: 0 },
          { unit: 'interceptor', count: 3 },
        ],
        data,
      ),
    ).toBe(20);
  });

  it('НЕТ СТАТА В ДАННЫХ — НЕТ ЗАХВАТА: радиус живёт в данных, а не в коде', () => {
    expect(chaseRadius([{ unit: 'tug', count: 1 }], data)).toBe(0);
    expect(chaseRadius([], data)).toBe(0);
  });
});

describe('SHU-4.4 — один пересчёт погони', () => {
  it('КУРС ПРАВИТСЯ К ЦЕНТРУ РАДИУСА: шаг идёт прямо на цель, а не по старому курсу', () => {
    const step = chaseStep(at(0, 0), at(100, 0), 25, 10);
    expect(step.at).toEqual({ x: 25, y: 0 });
    expect(step.caught).toBe(false);
  });

  it('ПОПАДАНИЕ — ПО ФАКТУ НА ПЕРЕСЧЁТЕ: оказалась внутри радиуса — догнала', () => {
    const step = chaseStep(at(0, 0), at(100, 0), 95, 10);
    expect(step.caught).toBe(true);
  });

  it('ГРАНИЦА ВКЛЮЧИТЕЛЬНА — та же мерка, по которой ядро пускает удар', () => {
    expect(chaseStep(at(0, 0), at(100, 0), 90, 10).caught).toBe(true);
  });

  it('ПЕРЕЛЁТА НЕ БЫВАЕТ: быстрая эскадра встаёт НА цели, а не проскакивает мимо', () => {
    const step = chaseStep(at(0, 0), at(30, 0), 500, 0);
    expect(step.at).toEqual({ x: 30, y: 0 });
    expect(step.caught).toBe(true);
  });

  it('НУЛЕВОЙ РАДИУС ТРЕБУЕТ ТОЧКИ В ТОЧКУ: без стата догнать можно только стоящего', () => {
    expect(chaseStep(at(0, 0), at(100, 0), 99, 0).caught).toBe(false);
    expect(chaseStep(at(0, 0), at(100, 0), 100, 0).caught).toBe(true);
  });

  it('НУЛЕВОЙ ШАГ НЕ ДВИГАЕТ, но захват на месте засчитывается', () => {
    expect(chaseStep(at(5, 5), at(90, 90), 0, 10).at).toEqual({ x: 5, y: 5 });
    expect(chaseStep(at(5, 5), at(9, 9), 0, 10).caught).toBe(true);
  });

  it('УЖЕ ВНУТРИ РАДИУСА — ДОГНАЛА, не дёргаясь: шаг не нужен', () => {
    const step = chaseStep(at(0, 0), at(3, 4), 25, 10);
    expect(step.caught).toBe(true);
    expect(step.at).toEqual({ x: 0, y: 0 });
  });
});

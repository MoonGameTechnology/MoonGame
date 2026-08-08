import { describe, it, expect } from 'vitest';
import { fadeOf, flashAge, flashDone, flashProgress, growRadius, waveRadius } from './flashFx';

const ЖИЗНЬ = 1500;

describe('вспышка — прогресс по часам', () => {
  it('в начале ноль, в конце единица', () => {
    expect(flashProgress(0, 0, ЖИЗНЬ)).toBe(0);
    expect(flashProgress(ЖИЗНЬ, 0, ЖИЗНЬ)).toBe(1);
  });

  it('середина жизни — половина прогресса', () => {
    expect(flashProgress(750, 0, ЖИЗНЬ)).toBe(0.5);
  });

  it('КАДР МОЖЕТ ОПЕРЕДИТЬ ПОСТАНОВКУ: без клампа радиус уходит в минус и роняет arc()', () => {
    expect(flashAge(90, 100)).toBe(0);
    expect(flashProgress(90, 100, ЖИЗНЬ)).toBe(0);
    expect(waveRadius(flashProgress(90, 100, ЖИЗНЬ), 200, 1.25)).toBe(0);
  });

  it('ПРОГРЕСС НЕ ПЕРЕВАЛИВАЕТ ЗА ЕДИНИЦУ — просроченный кадр не раздувает волну', () => {
    expect(flashProgress(99_999, 0, ЖИЗНЬ)).toBe(1);
  });

  it('нулевая длительность — вспышка сразу отгорела, а не делится на ноль', () => {
    expect(flashProgress(0, 0, 0)).toBe(1);
    expect(Number.isFinite(flashProgress(0, 0, 0))).toBe(true);
  });
});

describe('вспышка — когда снимать', () => {
  it('ИСТЁКШАЯ СНИМАЕТСЯ, А НЕ РИСУЕТСЯ ПРОЗРАЧНОЙ: иначе список копится', () => {
    expect(flashDone(ЖИЗНЬ, 0, ЖИЗНЬ)).toBe(true);
    expect(flashDone(ЖИЗНЬ + 1, 0, ЖИЗНЬ)).toBe(true);
  });

  it('живая вспышка остаётся', () => {
    expect(flashDone(ЖИЗНЬ - 1, 0, ЖИЗНЬ)).toBe(false);
  });

  it('вспышка из будущего живая, а не мёртвая', () => {
    expect(flashDone(90, 100, ЖИЗНЬ)).toBe(false);
  });
});

describe('вспышка — затухание и радиусы', () => {
  it('ЗАТУХАНИЕ — ТОТ ЖЕ ПРОГРЕСС С ДРУГОГО КОНЦА: две шкалы разъехались бы', () => {
    expect(fadeOf(0)).toBe(1);
    expect(fadeOf(1)).toBe(0);
    expect(fadeOf(0.25) + 0.25).toBe(1);
  });

  it('кольцо растёт от базового радиуса к базовому плюс прирост', () => {
    expect(growRadius(14, 10, 0)).toBe(14);
    expect(growRadius(14, 10, 1)).toBe(24);
    expect(growRadius(14, 10, 0.5)).toBe(19);
  });

  it('ВОЛНА УХОДИТ ЗА ГРАНИЦУ КЛЕТКИ, а не замирает ровно на ней', () => {
    expect(waveRadius(1, 200, 1.25)).toBeGreaterThan(200);
  });

  it('в начале волны радиуса нет', () => {
    expect(waveRadius(0, 200, 1.25)).toBe(0);
  });
});

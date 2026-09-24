import { describe, expect, it } from 'vitest';

import { runClockText, runPerMinute, runRealSeconds } from './runClock';
import { RUN_SPEED_FAST, RUN_SPEED_NORMAL } from './runTempo';

const HOUR = 3_600_000;

describe('часы забега (решение владельца 2026-09-24)', () => {
  it('игровой час на обычном темпе — 24 реальные секунды', () => {
    expect(RUN_SPEED_NORMAL).toBe(150);
    expect(runRealSeconds(HOUR)).toBe(24);
    expect(runClockText(HOUR)).toBe('0:24');
  });

  it('волна через шесть игровых часов — это 2:24, а не «6 ч»', () => {
    expect(runClockText(6 * HOUR)).toBe('2:24');
  });

  it('счёт ведётся по ОБЫЧНОМУ темпу: ▶▶ ускоряет таймер, а не меняет его показание', () => {
    // Табло пересчитывает игровое время по одному темпу; быстрее — значит, игровое время
    // убывает быстрее. Другой темп дал бы другое число при той же волне.
    expect(runClockText(6 * HOUR)).not.toBe(runClockText(6 * HOUR, RUN_SPEED_FAST));
  });

  it('от часа — «ч:мм:сс»; секунды вверх, отрицательное — ноль', () => {
    expect(runClockText(150 * HOUR + 1)).toBe('1:00:01');
    expect(runClockText(1)).toBe('0:01');
    expect(runClockText(0)).toBe('0:00');
    expect(runClockText(-5 * HOUR)).toBe('0:00');
  });

  it('приток в минуту — ×2,5 к часовому на обычном темпе', () => {
    expect(runPerMinute(12)).toBe(30);
    expect(runPerMinute(-4)).toBe(-10);
  });
});

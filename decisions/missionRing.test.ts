import { describe, expect, it } from 'vitest';
import { missionRingFrame, RING_R, RIPPLE_MS, RIPPLE_REACH } from './missionRing';

describe('missionRingFrame', () => {
  it('без анимации кольцо неподвижно: пунктир на месте, волны нет, яркость средняя', () => {
    for (const clock of [0, 1234, 99_999])
      expect(missionRingFrame(clock, false)).toEqual({ breath: 0.5, dashOffset: 0, ripple: null });
  });

  it('волна рождается у кольца, расходится до предела и гаснет', () => {
    const start = missionRingFrame(0, true).ripple!;
    expect(start.r).toBe(RING_R);
    expect(start.alpha).toBeCloseTo(0.6);
    const late = missionRingFrame(RIPPLE_MS * 0.95, true).ripple!;
    expect(late.r).toBeGreaterThan(RING_R + RIPPLE_REACH * 0.9);
    expect(late.alpha).toBeLessThan(0.01);
    // Период замкнут: через RIPPLE_MS волна снова у кольца.
    expect(missionRingFrame(RIPPLE_MS, true).ripple).toEqual(start);
  });

  it('пунктир бежит, а яркость остаётся в 0..1', () => {
    expect(missionRingFrame(600, true).dashOffset).toBeLessThan(missionRingFrame(0, true).dashOffset);
    for (let clock = 0; clock < 5000; clock += 137) {
      const { breath } = missionRingFrame(clock, true);
      expect(breath).toBeGreaterThanOrEqual(0);
      expect(breath).toBeLessThanOrEqual(1);
    }
  });
});

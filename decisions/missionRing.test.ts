import { describe, expect, it } from 'vitest';
import {
  missionRingFrame,
  missionRingPhase,
  RING_R,
  RING_W,
  WAVE_ALPHA,
  WAVE_MS,
  WAVE_REACH,
} from './missionRing';

describe('missionRingFrame', () => {
  it('без анимации кольцо неподвижно: пунктир на месте, волн нет, яркость средняя', () => {
    for (const clock of [0, 1234, 99_999])
      for (const phase of [0, 0.3])
        expect(missionRingFrame(clock, false, phase)).toEqual({
          breath: 0.5,
          dashOffset: 0,
          waves: [],
        });
  });

  it('волна — копия пунктира: рождается на кольце, уходит до предела, тончает и гаснет', () => {
    const [start] = missionRingFrame(0, true).waves;
    expect(start).toEqual({ r: RING_R, alpha: WAVE_ALPHA, width: RING_W, scale: 1 });
    const [late] = missionRingFrame(WAVE_MS * 0.95, true).waves;
    expect(late!.r).toBeGreaterThan(RING_R + WAVE_REACH * 0.9);
    expect(late!.alpha).toBeLessThan(0.05);
    expect(late!.width).toBeLessThan(RING_W * 0.6);
    // Штрихи растут вместе с волной: уходит то же кольцо, а не всё более мелкий узор.
    expect(late!.r / late!.scale).toBeCloseTo(RING_R);
    // Период замкнут: через WAVE_MS волны снова те же.
    expect(missionRingFrame(WAVE_MS, true).waves).toEqual(missionRingFrame(0, true).waves);
  });

  it('волн две со сдвигом в полпериода — кольцо не замирает между всплесками', () => {
    for (let clock = 0; clock < WAVE_MS * 2; clock += 97) {
      const { waves } = missionRingFrame(clock, true);
      expect(waves).toHaveLength(2);
      const [a, b] = waves.map((w) => (w.r - RING_R) / WAVE_REACH);
      expect(Math.abs(a! - b!)).toBeCloseTo(0.5);
      // Всегда есть волна ярче половины начальной: пустых промежутков нет.
      expect(Math.max(...waves.map((w) => w.alpha))).toBeGreaterThanOrEqual(WAVE_ALPHA / 2 - 1e-9);
    }
  });

  it('фаза цели сдвигает её волны по времени', () => {
    const shifted = missionRingFrame(1000, true, 0.25).waves;
    const later = missionRingFrame(1000 + 0.25 * WAVE_MS, true).waves;
    shifted.forEach((w, i) => {
      expect(w.r).toBeCloseTo(later[i]!.r);
      expect(w.alpha).toBeCloseTo(later[i]!.alpha);
    });
  });

  it('пунктир бежит, а яркость остаётся в 0..1', () => {
    expect(missionRingFrame(600, true).dashOffset).toBeLessThan(
      missionRingFrame(0, true).dashOffset,
    );
    for (let clock = 0; clock < 5000; clock += 137) {
      const { breath } = missionRingFrame(clock, true, 0.4);
      expect(breath).toBeGreaterThanOrEqual(0);
      expect(breath).toBeLessThanOrEqual(1);
    }
  });
});

describe('missionRingPhase', () => {
  it('фаза от места на карте — в [0, 1), и за левым краем карты тоже', () => {
    for (const x of [-9999, -394, -1, 0, 1, 125, 580, 12_345]) {
      const phase = missionRingPhase({ x, y: -563 });
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(1);
    }
  });

  it('соседние цели не мигают в унисон', () => {
    const a = missionRingPhase({ x: -394, y: -563 });
    const b = missionRingPhase({ x: -358, y: -536 });
    expect(a).not.toBeCloseTo(b);
    expect(missionRingFrame(0, true, a).waves).not.toEqual(missionRingFrame(0, true, b).waves);
  });
});

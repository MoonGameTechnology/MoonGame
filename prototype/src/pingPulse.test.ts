import { describe, it, expect } from 'vitest';
import {
  DROP_IN,
  RING_OFFSETS,
  RING_PERIOD_MS,
  dropInAlpha,
  pinPulse,
  pingPhase,
  ringAlpha,
  ringProgress,
  ringRadius,
  ringWidth,
} from './pingPulse';

describe('метка — собственная фаза', () => {
  it('СОСЕДНИЕ МЕТКИ НЕ МИГАЮТ В УНИСОН: иначе поле меток — одна общая мигалка', () => {
    expect(pingPhase(100)).not.toBe(pingPhase(160));
  });

  it('одна и та же метка на месте держит свою фазу', () => {
    expect(pingPhase(240)).toBe(pingPhase(240));
  });

  it('ДЫХАНИЕ НЕ ГАСНЕТ В НОЛЬ И НЕ ПЕРЕСВЕЧИВАЕТ: булавку видно в любой фазе', () => {
    // 0.7 ± 0.3 — то есть [0.4, 1.0]: даже в нижней точке метка остаётся заметной
    for (const t of [0, 100, 360, 1234, 99_999]) {
      const p = pinPulse(t, pingPhase(37));
      expect(p).toBeGreaterThanOrEqual(0.4 - 1e-12);
      expect(p).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('дыхание доходит до обоих концов диапазона, а не топчется в середине', () => {
    const крайние = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((a) => pinPulse(a * 360, 0));
    expect(Math.max(...крайние)).toBeCloseTo(1, 6);
    expect(Math.min(...крайние)).toBeCloseTo(0.4, 6);
  });
});

describe('метка — прогресс сонарного кольца', () => {
  it('МЕТКА ЗА ЛЕВЫМ КРАЕМ НЕ РОНЯЕТ КАДР: JS-остаток сохраняет знак, радиус ушёл бы в минус', () => {
    const фаза = pingPhase(-800); // метка левее экрана
    for (const off of RING_OFFSETS) {
      const k = ringProgress(0, фаза, off);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(1);
      expect(ringRadius(k)).toBeGreaterThan(0);
    }
  });

  it('прогресс остаётся в [0, 1) на любом времени', () => {
    for (const t of [0, 1, 2199, 2200, 2201, 1e7]) {
      const k = ringProgress(t, pingPhase(120), 0);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(1);
    }
  });

  it('за период кольцо проходит полный круг и возвращается к себе', () => {
    const фаза = pingPhase(50);
    expect(ringProgress(RING_PERIOD_MS, фаза, 0)).toBeCloseTo(ringProgress(0, фаза, 0), 10);
  });

  it('КОЛЬЦА ИДУТ ПАРОЙ СО СДВИГОМ В ПОЛПЕРИОДА — метка не замирает между всплесками', () => {
    expect(RING_OFFSETS).toEqual([0, 0.5]);
    const [a, b] = RING_OFFSETS.map((off) => ringProgress(0, 0, off));
    expect(Math.abs(a! - b!)).toBeCloseTo(0.5, 10);
  });
});

describe('метка — как кольцо выглядит по ходу жизни', () => {
  it('растёт от узла наружу', () => {
    expect(ringRadius(0)).toBe(6);
    expect(ringRadius(1)).toBe(46);
  });

  it('УТОНЧАЕТСЯ И ГАСНЕТ ОТ ТОГО ЖЕ ПРОГРЕССА — иначе толщина и цвет разъедутся', () => {
    expect(ringWidth(1)).toBeLessThan(ringWidth(0));
    expect(ringAlpha(1)).toBeLessThan(ringAlpha(0));
    expect(ringAlpha(1)).toBe(0);
  });

  it('толщина не уходит в отрицательную за время жизни', () => {
    expect(ringWidth(1)).toBeGreaterThan(0);
  });

  it('МОЛОДОЕ КОЛЬЦО ВСПЫХИВАЕТ — иначе волна не рождается, а возникает из ниоткуда', () => {
    expect(dropInAlpha(0)).toBeGreaterThan(0);
    expect(dropInAlpha(DROP_IN / 2)).toBeGreaterThan(0);
  });

  it('после вспышки заливки нет вовсе', () => {
    expect(dropInAlpha(DROP_IN)).toBe(0);
    expect(dropInAlpha(0.9)).toBe(0);
  });
});

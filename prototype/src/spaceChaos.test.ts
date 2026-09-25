import { describe, expect, it } from 'vitest';
import { chaosScene } from './spaceChaos';

const B = { minX: -800, minY: -600, maxX: 800, maxY: 700 };

describe('космический хаос — раскладка сцены', () => {
  it('тот же ключ — та же сцена: перепечка слоя не тасует облака', () => {
    expect(chaosScene('pve-3|b', B)).toEqual(chaosScene('pve-3|b', B));
    expect(chaosScene('pve-3|b', B)).not.toEqual(chaosScene('pve-2|b', B));
  });

  it('всё лежит в поле карты с запасом на четверть — космос не обрывается у края', () => {
    const w = B.maxX - B.minX;
    const h = B.maxY - B.minY;
    const s = chaosScene('k', B);
    for (const p of [...s.clouds, ...s.lanes]) {
      expect(p.x).toBeGreaterThanOrEqual(B.minX - w * 0.25);
      expect(p.x).toBeLessThanOrEqual(B.maxX + w * 0.25);
      expect(p.y).toBeGreaterThanOrEqual(B.minY - h * 0.25);
      expect(p.y).toBeLessThanOrEqual(B.maxY + h * 0.25);
    }
  });

  it('облака разложены по всей карте, а не кучей: заняты все три полосы по высоте', () => {
    for (const key of ['a', 'b', 'c', 'pve-1', 'pve-3']) {
      const big = chaosScene(key, B).clouds.slice(0, -16);
      const h = (B.maxY - B.minY) * 1.5;
      const top = B.minY - (B.maxY - B.minY) * 0.25;
      const rows = new Set(big.map((c) => Math.floor(((c.y - top) / h) * 3)));
      expect(rows.size, key).toBe(3);
    }
  });

  it('есть и туманности, и пылевые рукава, и звёзды с яркими лучами', () => {
    const s = chaosScene('k', B);
    expect(s.clouds.length).toBeGreaterThan(16);
    expect(s.lanes.length).toBeGreaterThanOrEqual(3);
    expect(s.stars.some((st) => st.glint)).toBe(true);
  });
});

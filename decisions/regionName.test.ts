/**
 * ПОДПИСИ ОБЛАСТЕЙ (M2.15): ключ из карты и области, место подписи, проступание при
 * отдалении.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { layoutRegionLabels, regionKey, regionLabelAlpha, regionLabels } from './regionName';
import { setLocale } from '../localization/core';

afterEach(() => setLocale('ru'));

const at: Record<string, { x: number; y: number }> = {
  a: { x: 0, y: 0 },
  b: { x: 100, y: 0 },
  c: { x: 50, y: 90 },
};

describe('ключ имени области', () => {
  it('выводится из карты и области: подчёркивания — в дефисы', () => {
    expect(regionKey('proving-ground', 'asteroid_massif')).toBe('region.proving-ground.asteroid-massif');
  });
});

describe('подписи областей', () => {
  it('имя на языке игрока, место — средняя точка провинций области', () => {
    const labels = regionLabels('proving-ground', [{ id: 'storm_front', sectors: ['a', 'b', 'c'] }], (id) => at[id]);
    expect(labels).toEqual([{ id: 'storm_front', text: 'Штормовой фронт', x: 50, y: 30 }]);
    setLocale('en');
    expect(regionLabels('proving-ground', [{ id: 'storm_front', sectors: ['a'] }], (id) => at[id])[0]!.text).toBe(
      'Storm Front',
    );
  });

  it('область без имени и карта без id подписи не дают: сырой id игроку не показывается', () => {
    expect(regionLabels('proving-ground', [{ id: 'nowhere', sectors: ['a'] }], (id) => at[id])).toEqual([]);
    expect(regionLabels(undefined, [{ id: 'storm_front', sectors: ['a'] }], (id) => at[id])).toEqual([]);
  });

  it('провинция, которой нет на карте, в среднюю точку не идёт', () => {
    const [label] = regionLabels('proving-ground', [{ id: 'storm_front', sectors: ['a', 'ghost', 'b'] }], (id) => at[id]);
    expect(label).toMatchObject({ x: 50, y: 0 });
  });
});

describe('подпись проступает при отдалении', () => {
  it('провинции видны целиком — подписи нет; растворились — подпись полная', () => {
    expect(regionLabelAlpha(1)).toBe(0);
    expect(regionLabelAlpha(0)).toBe(1);
    expect(regionLabelAlpha(0.25)).toBe(0.75);
  });

  it('за пределами 0..1 число зажимается', () => {
    expect(regionLabelAlpha(-2)).toBe(1);
    expect(regionLabelAlpha(3)).toBe(0);
  });
});

describe('подписи не наезжают друг на друга (правило 5)', () => {
  // Моноширинная мерка: 10 px на знак.
  const measure = (text: string): number => text.length * 10;
  const view = { width: 390 };

  it('свободная подпись стоит в своей точке одной строкой', () => {
    expect(layoutRegionLabels([{ id: 'a', text: 'ШТОРМОВОЙ ФРОНТ', x: 200, y: 300 }], measure, view, 16)).toEqual([
      { id: 'a', lines: ['ШТОРМОВОЙ ФРОНТ'], x: 200, y: 300 },
    ]);
  });

  const box = (p: { lines: string[]; x: number; y: number }) => {
    const w = Math.max(...p.lines.map(measure));
    return { l: p.x - w / 2, r: p.x + w / 2, t: p.y - (p.lines.length * 16) / 2, b: p.y + (p.lines.length * 16) / 2 };
  };

  it('соседняя подпись уходит со своей точки, а не ложится поверх первой', () => {
    const placed = layoutRegionLabels([
      { id: 'a', text: 'ПЕПЕЛЬНЫЙ МАССИВ', x: 120, y: 300 },
      { id: 'b', text: 'КЛАДБИЩЕ ЭКСПЕДИЦИИ', x: 230, y: 290 },
    ], measure, view, 16);
    expect(placed[0]).toEqual({ id: 'a', lines: ['ПЕПЕЛЬНЫЙ МАССИВ'], x: 120, y: 300 });
    expect(placed).toHaveLength(2);
    const [a, b] = placed.map(box);
    expect(a!.r <= b!.l || b!.r <= a!.l || a!.b <= b!.t || b!.b <= a!.t).toBe(true);
  });

  it('имя шире экрана встаёт в две строки', () => {
    const [label] = layoutRegionLabels([{ id: 'a', text: 'КЛАДБИЩЕ ЭКСПЕДИЦИИ', x: 80, y: 300 }], measure, { width: 160 }, 16);
    expect(label).toEqual({ id: 'a', lines: ['КЛАДБИЩЕ', 'ЭКСПЕДИЦИИ'], x: 80, y: 300 });
  });

  it('подпись у края сдвигается внутрь экрана; дальняя область не притягивается', () => {
    const [edge] = layoutRegionLabels([{ id: 'a', text: 'ЗАПАДНЫЙ ПРОСТОР', x: 20, y: 300 }], measure, view, 16);
    expect(edge!.x - measure('ЗАПАДНЫЙ ПРОСТОР') / 2).toBeGreaterThanOrEqual(6);
    const [far] = layoutRegionLabels([{ id: 'a', text: 'ЗАПАДНЫЙ ПРОСТОР', x: -60, y: 300 }], measure, view, 16);
    expect(far!.x).toBe(-60);
  });

  it('места нет нигде — подпись не рисуется', () => {
    const crowd = [0, 1, 2, 3, 4, 5].map((i) => ({ id: `r${i}`, text: 'ОБЛАСТЬ', x: 200, y: 300 }));
    const placed = layoutRegionLabels(crowd, measure, view, 16);
    expect(placed.length).toBeLessThan(crowd.length);
    expect(placed.map((p) => p.y)).toEqual([300, 280, 320, 260, 340]);
  });
});

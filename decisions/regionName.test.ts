/**
 * ПОДПИСИ ОБЛАСТЕЙ (M2.15): ключ из карты и области, место подписи, проступание при
 * отдалении.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { regionKey, regionLabelAlpha, regionLabels } from './regionName';
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

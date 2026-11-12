import { describe, it, expect } from 'vitest';
import { rallyOffer, rallyPick, rallyRouteHops } from './rallyPoint';

describe('точка сбора — что предложить в панели мира', () => {
  it('свой мир с верфью предлагает задать точку', () => {
    expect(rallyOffer(true, true, false)).toBe('set');
  });

  it('ЧУЖОЙ МИР НЕ ПРЕДЛАГАЕТ НИЧЕГО — это приказ владельца', () => {
    expect(rallyOffer(false, true, false)).toBe('none');
    expect(rallyOffer(false, true, true)).toBe('none');
  });

  it('без верфи кнопки нет: кораблей там не строят', () => {
    expect(rallyOffer(true, false, false)).toBe('none');
  });

  it('стоящую точку можно сменить и снять, даже если верфи больше нет', () => {
    expect(rallyOffer(true, true, true)).toBe('change');
    expect(rallyOffer(true, false, true)).toBe('change');
  });
});

describe('точка сбора — тап по карте', () => {
  it('другой мир — приказ: свой, ничей, вражеский, неразведанный (RALLY-2)', () => {
    expect(rallyPick('A', { id: 'B', closed: false })).toBe('order');
  });

  it('видимая закрытая территория — объяснить, что прохода нет', () => {
    expect(rallyPick('A', { id: 'B', closed: true })).toBe('closed');
  });

  it('сам мир-верфь — объяснить, что цель — другой мир', () => {
    expect(rallyPick('A', { id: 'A', closed: false })).toBe('same');
  });

  it('промах мимо мира снимает прицел', () => {
    expect(rallyPick('A', null)).toBe('cancel');
  });
});

describe('точка сбора — путь при выборе', () => {
  const closed = (id: string) => id === 'P';
  it('открытый маршрут — целиком', () => {
    expect(rallyRouteHops(['B', 'C'], null, closed)).toEqual(['B', 'C']);
  });
  it('видимая закрытая граница — путь обрывается перед ней', () => {
    expect(rallyRouteHops(['B', 'P', 'T'], null, closed)).toEqual(['B']);
  });
  it('есть обход закрытой территории — летят обходом, как курс ядра', () => {
    expect(rallyRouteHops(['P', 'T'], ['B', 'C', 'T'], closed)).toEqual(['B', 'C', 'T']);
  });
  it('обход, который сам идёт через закрытую цель, не годится', () => {
    expect(rallyRouteHops(['B', 'P'], ['C', 'P'], closed)).toEqual(['B']);
  });
  it('граница первым хопом — пути нет', () => {
    expect(rallyRouteHops(['P', 'T'], null, closed)).toEqual([]);
  });
});

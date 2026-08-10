import { describe, it, expect } from 'vitest';
import {
  LOD_FROM,
  LOD_SPAN,
  artScale,
  calloutAlpha,
  chevronAlpha,
  detailAt,
  sphereBloom,
} from './semanticZoom';

describe('семантический зум — доля детализации', () => {
  it('на пороге и ниже — чистая схема', () => {
    expect(detailAt(LOD_FROM)).toBe(0);
    expect(detailAt(0.4)).toBe(0);
  });

  it('на конце полосы и выше — полная детализация', () => {
    expect(detailAt(LOD_FROM + LOD_SPAN)).toBe(1);
    expect(detailAt(6)).toBe(1);
  });

  it('ЭТО КРОСС-ФЕЙД, А НЕ ПОРОГ: середина полосы даёт середину', () => {
    expect(detailAt(LOD_FROM + LOD_SPAN / 2)).toBeCloseTo(0.5, 12);
  });

  it('ДОЛЯ ЗАЖАТА В [0,1]: ею умножают globalAlpha', () => {
    for (const scale of [-5, 0, 1, 1.3, 1.45, 12]) {
      const d = detailAt(scale);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });
});

describe('семантический зум — размер арта', () => {
  it('на схеме арт ужимается до 45%', () => {
    expect(artScale(0)).toBeCloseTo(0.45, 12);
  });

  it('на полной детализации арт в натуральную величину', () => {
    expect(artScale(1)).toBeCloseTo(1, 12);
  });

  it('УЗЕЛ И ЗАЛП ПО ОДНОМУ ЗАКОНУ: иначе они разъедутся посреди перехода', () => {
    const d = detailAt(1.3);
    expect(artScale(d)).toBe(artScale(d));
    expect(artScale(d)).toBeGreaterThan(artScale(0));
    expect(artScale(d)).toBeLessThan(artScale(1));
  });
});

describe('семантический зум — подписи', () => {
  it('СВОЙ МИР ПОДПИСАН ВСЕГДА: на полной схеме подпись не гаснет', () => {
    expect(calloutAlpha(0, true)).toBe(0.9);
  });

  it('чужая подпись уходит вместе с детализацией', () => {
    expect(calloutAlpha(0, false)).toBe(0);
  });

  it('на полной детализации свой и чужой подписаны одинаково', () => {
    expect(calloutAlpha(1, true)).toBe(1);
    expect(calloutAlpha(1, false)).toBe(1);
  });

  it('свой мир никогда не бледнее чужого', () => {
    for (const d of [0, 0.25, 0.5, 0.75, 1]) {
      expect(calloutAlpha(d, true)).toBeGreaterThanOrEqual(calloutAlpha(d, false));
    }
  });
});

describe('семантический зум — флот', () => {
  it('ВСТРЕЧНЫЙ КРОСС-ФЕЙД: шеврон и выкладка в сумме дают единицу', () => {
    for (const d of [0, 0.3, 0.5, 0.8, 1]) {
      expect(chevronAlpha(d) + d).toBeCloseTo(1, 12);
    }
  });

  it('на схеме флот — только шеврон, на детали шеврона нет', () => {
    expect(chevronAlpha(0)).toBe(1);
    expect(chevronAlpha(1)).toBe(0);
  });
});

describe('семантический зум — гало планеты', () => {
  it('ГАЛО ЖИВЁТ ПО МАСШТАБУ, а не по детализации: растёт и внутри полосы фейда', () => {
    expect(sphereBloom(1.3)).toBeGreaterThan(sphereBloom(1.2));
  });

  it('НЕ ГАСНЕТ НИЖЕ 0.3: сфера должна читаться и на схеме', () => {
    expect(sphereBloom(1)).toBe(0.3);
    expect(sphereBloom(0.2)).toBe(0.3);
  });

  it('на близком зуме гало упирается в единицу', () => {
    expect(sphereBloom(2)).toBe(1);
    expect(sphereBloom(9)).toBe(1);
  });
});

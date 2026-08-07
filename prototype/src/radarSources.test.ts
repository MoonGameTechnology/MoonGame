import { describe, it, expect } from 'vitest';
import {
  hasCoverage,
  identifyRadius,
  radarSources,
  type RadarCandidate,
} from './radarSources';

const cand = (over: Partial<RadarCandidate> = {}): RadarCandidate => ({
  mine: true,
  radius: 100,
  at: { x: 1, y: 2 },
  selected: false,
  ...over,
});

describe('радарное покрытие — кого берём в источники', () => {
  it('ТОЛЬКО СВОИ: чужой радар нарисовать значит выдать и его наличие, и его радиус', () => {
    expect(radarSources([cand({ mine: false })])).toEqual([]);
    expect(radarSources([cand()])).toHaveLength(1);
  });

  it('НУЛЕВОЙ РАДИУС — НЕ ИСТОЧНИК: засечка нарисовалась бы там, где обзора нет', () => {
    expect(radarSources([cand({ radius: 0 })])).toEqual([]);
    expect(radarSources([cand({ radius: -5 })])).toEqual([]);
  });

  it('НЕТ ПОЗИЦИИ — НЕТ КОЛЬЦА: иначе покрытие прыгнет туда, где источника нет', () => {
    expect(radarSources([cand({ at: null })])).toEqual([]);
  });

  it('источник несёт свою позицию и радиус', () => {
    expect(radarSources([cand({ at: { x: 7, y: 8 }, radius: 42 })])).toEqual([
      { x: 7, y: 8, r: 42, selected: false },
    ]);
  });

  it('признак выбора доезжает — у выбранного рисуются собственные кольца', () => {
    expect(radarSources([cand({ selected: true })])[0]!.selected).toBe(true);
  });

  it('порядок источников сохраняется', () => {
    const list = radarSources([
      cand({ at: { x: 1, y: 0 } }),
      cand({ mine: false }),
      cand({ at: { x: 2, y: 0 } }),
    ]);
    expect(list.map((v) => v.x)).toEqual([1, 2]);
  });

  it('пустой вход — пустой выход', () => {
    expect(radarSources([])).toEqual([]);
  });
});

describe('радарное покрытие — радиус опознания', () => {
  it('ОПОЗНАНИЕ — ДОЛЯ ЗАСЕЧКИ: оно физически не может быть дальше неё', () => {
    expect(identifyRadius(100, 0.5)).toBe(50);
    expect(identifyRadius(100, 0.5)).toBeLessThan(100);
  });

  it('доля приходит снаружи — второй копии числа в клиенте нет', () => {
    expect(identifyRadius(80, 0.25)).toBe(20);
    expect(identifyRadius(80, 1)).toBe(80);
  });

  it('нулевая засечка даёт нулевое опознание', () => {
    expect(identifyRadius(0, 0.5)).toBe(0);
  });
});

describe('радарное покрытие — есть ли что рисовать', () => {
  it('без источников в отрисовку не заходим', () => {
    expect(hasCoverage([])).toBe(false);
  });

  it('хотя бы один источник — есть покрытие', () => {
    expect(hasCoverage(radarSources([cand()]))).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import {
  boxSelection,
  closestOnSegment,
  insideBox,
  movedBeyondSlop,
  nearestHit,
  nearestSegment,
  normalizeBox,
  pickRadius,
  pinchOf,
  pinchStep,
  tapSlop,
} from './pointerPick';

describe('ввод — пороги тапа', () => {
  it('ПАЛЕЦ ДРОЖИТ СИЛЬНЕЕ МЫШИ — порог протяжки на касании шире', () => {
    expect(tapSlop(true)).toBeGreaterThan(tapSlop(false));
  });

  it('под палец радиус попадания тоже шире (правило цели 44px)', () => {
    expect(pickRadius(true)).toBeGreaterThan(pickRadius(false));
  });

  it('дрожание в пределах порога — всё ещё тап', () => {
    expect(movedBeyondSlop({ x: 0, y: 0 }, { x: 8, y: 0 }, true)).toBe(false);
    expect(movedBeyondSlop({ x: 0, y: 0 }, { x: 8, y: 0 }, false)).toBe(true); // мышью это уже протяжка
  });

  it('явный сдвиг — протяжка на любом указателе', () => {
    expect(movedBeyondSlop({ x: 0, y: 0 }, { x: 40, y: 30 }, true)).toBe(true);
  });

  it('жест не начинался — движения нет', () => {
    expect(movedBeyondSlop(null, { x: 100, y: 100 }, false)).toBe(false);
  });
});

describe('ввод — ближайшая цель', () => {
  const pts = [
    { id: 'далёкий', x: 30, y: 0 },
    { id: 'ближний', x: 6, y: 0 },
    { id: 'средний', x: 12, y: 0 },
  ];
  const at = (p: { x: number; y: number }) => ({ x: p.x, y: p.y });

  it('выбирается БЛИЖАЙШИЙ, а не первый по порядку обхода', () => {
    expect(nearestHit(pts, at, 0, 0, 40)?.id).toBe('ближний');
  });

  it('за радиусом — никого', () => {
    expect(nearestHit(pts, at, 0, 0, 5)).toBeNull();
  });

  it('ровно на радиусе не считается (радиус — строгая граница)', () => {
    expect(nearestHit([{ id: 'край', x: 10, y: 0 }], at, 0, 0, 10)).toBeNull();
  });

  it('кандидаты без позиции пропускаются', () => {
    const mixed = [{ id: 'призрак' }, { id: 'живой', x: 3, y: 0 }] as Array<{
      id: string;
      x?: number;
      y?: number;
    }>;
    const hit = nearestHit(
      mixed,
      (p) => (p.x === undefined ? null : { x: p.x, y: p.y! }),
      0,
      0,
      20,
    );
    expect(hit?.id).toBe('живой');
  });

  it('пустой список — попадать не во что', () => {
    expect(nearestHit([], at, 0, 0, 100)).toBeNull();
  });
});

describe('ввод — точка на трассе', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };

  it('точка напротив середины падает на середину', () => {
    const at = closestOnSegment(a, b, 50, 20);
    expect(at).toEqual({ t: 0.5, x: 50, y: 0, d: 20 });
  });

  it('ПРОЕКЦИЯ ПРИЖИМАЕТСЯ К ОТРЕЗКУ — за конец дороги точка не уезжает', () => {
    expect(closestOnSegment(a, b, 400, 0)).toMatchObject({ t: 1, x: 100, y: 0, d: 300 });
    expect(closestOnSegment(a, b, -70, 0)).toMatchObject({ t: 0, x: 0, y: 0, d: 70 });
  });

  it('расстояние меряется до ТОЧКИ НА ОТРЕЗКЕ, а не до ближайшего конца', () => {
    // Конец `b` в 51 px, а сама дорога — в 20: приказ ставится на дорогу.
    expect(closestOnSegment(a, b, 50, 20)?.d).toBe(20);
  });

  it('ВЫРОЖДЕННАЯ ТРАССА пропускается — деление на нуль дало бы NaN и тихий промах', () => {
    expect(closestOnSegment({ x: 7, y: 7 }, { x: 7, y: 7 }, 7, 8)).toBeNull();
  });

  it('наклонная трасса считается так же честно', () => {
    const at = closestOnSegment({ x: 0, y: 0 }, { x: 10, y: 10 }, 10, 0);
    expect(at?.t).toBeCloseTo(0.5);
    expect(at?.d).toBeCloseTo(Math.hypot(5, 5));
  });
});

describe('ввод — ближайшая трасса под пальцем', () => {
  const ends = (l: { a: { x: number; y: number }; b: { x: number; y: number } }) => l;
  const near = { id: 'близкая', a: { x: 0, y: 10 }, b: { x: 100, y: 10 } };
  const far = { id: 'дальняя', a: { x: 0, y: 60 }, b: { x: 100, y: 60 } };

  it('БЛИЖАЙШАЯ, а не первая в радиусе — дороги сходятся пучками', () => {
    expect(nearestSegment([far, near], ends, 50, 0, 100)?.seg.id).toBe('близкая');
  });

  it('за радиусом — ни одной', () => {
    expect(nearestSegment([near, far], ends, 50, 0, 9)).toBeNull();
  });

  it('ровно на радиусе не считается — граница строгая, как у nearestHit', () => {
    expect(nearestSegment([near], ends, 50, 0, 10)).toBeNull();
  });

  it('вырожденные трассы не мешают выбрать живую', () => {
    const dead = { id: 'точка', a: { x: 50, y: 1 }, b: { x: 50, y: 1 } };
    expect(nearestSegment([dead, near], ends, 50, 0, 100)?.seg.id).toBe('близкая');
  });

  it('вместе с отрезком возвращается и место попадания на нём', () => {
    const hit = nearestSegment([near], ends, 25, 0, 100);
    expect(hit?.at).toMatchObject({ t: 0.25, x: 25, y: 10 });
  });

  it('равные расстояния достаются ПЕРВОМУ встреченному — порядок обхода задаёт вызывающий', () => {
    const twin = { ...near, id: 'близнец' };
    expect(nearestSegment([near, twin], ends, 50, 0, 100)?.seg.id).toBe('близкая');
  });

  it('пустой список — попадать не во что', () => {
    expect(nearestSegment([], ends, 0, 0, 100)).toBeNull();
  });
});

describe('ввод — щипок', () => {
  it('расстояние и середина считаются по обоим пальцам', () => {
    const p = pinchOf({ x: 0, y: 0 }, { x: 10, y: 0 });
    expect(p.dist).toBe(10);
    expect(p.mid).toEqual({ x: 5, y: 0 });
  });

  it('пальцы разошлись — масштаб больше единицы', () => {
    const step = pinchStep({ dist: 100, mid: { x: 0, y: 0 } }, { dist: 150, mid: { x: 0, y: 0 } });
    expect(step.scale).toBeCloseTo(1.5);
  });

  it('пальцы сошлись — масштаб меньше единицы', () => {
    const step = pinchStep({ dist: 100, mid: { x: 0, y: 0 } }, { dist: 50, mid: { x: 0, y: 0 } });
    expect(step.scale).toBeCloseTo(0.5);
  });

  it('ЩИПОК ВЕЗЁТ КАМЕРУ: сдвиг середины — это панорама, отдельная от масштаба', () => {
    const step = pinchStep(
      { dist: 100, mid: { x: 10, y: 10 } },
      { dist: 100, mid: { x: 40, y: 30 } },
    );
    expect(step.scale).toBe(1);
    expect([step.dx, step.dy]).toEqual([30, 20]);
  });

  it('масштаб и перенос идут ОДНОВРЕМЕННО и не мешают друг другу', () => {
    const step = pinchStep({ dist: 100, mid: { x: 0, y: 0 } }, { dist: 200, mid: { x: 5, y: -5 } });
    expect(step.scale).toBe(2);
    expect([step.dx, step.dy]).toEqual([5, -5]);
  });

  it('прошлого щипка не было — масштаб не трогаем', () => {
    const step = pinchStep(null, { dist: 120, mid: { x: 1, y: 2 } });
    expect(step).toEqual({ scale: 1, dx: 0, dy: 0 });
  });

  it('вырожденное прошлое расстояние не даёт бесконечного масштаба', () => {
    const step = pinchStep({ dist: 0, mid: { x: 0, y: 0 } }, { dist: 80, mid: { x: 0, y: 0 } });
    expect(step.scale).toBe(1);
    expect(Number.isFinite(step.scale)).toBe(true);
  });
});

describe('ввод — рамка выделения', () => {
  it('рамку можно тянуть в любую сторону', () => {
    expect(normalizeBox({ x1: 50, y1: 40, x2: 10, y2: 5 })).toEqual({
      x1: 10,
      y1: 5,
      x2: 50,
      y2: 40,
    });
  });

  it('точка внутри — поймана, снаружи — нет', () => {
    const box = { x1: 0, y1: 0, x2: 10, y2: 10 };
    expect(insideBox(box, { x: 5, y: 5 })).toBe(true);
    expect(insideBox(box, { x: 11, y: 5 })).toBe(false);
  });

  it('точка ровно на краю считается пойманной', () => {
    expect(insideBox({ x1: 0, y1: 0, x2: 10, y2: 10 }, { x: 10, y: 10 })).toBe(true);
  });

  it('рамка, растянутая «назад», ловит те же точки', () => {
    expect(insideBox({ x1: 10, y1: 10, x2: 0, y2: 0 }, { x: 3, y: 7 })).toBe(true);
  });
});

describe('ввод — что осталось выделено после рамки', () => {
  it('обычная рамка ЗАМЕНЯЕТ группу', () => {
    expect(boxSelection(['a', 'b'], ['c'], false)).toEqual(['c']);
  });

  it('рамка с модификатором ДОБИРАЕТ, не теряя прежних', () => {
    expect(boxSelection(['a'], ['b', 'c'], true)).toEqual(['a', 'b', 'c']);
  });

  it('повторно пойманный флот не дублируется', () => {
    expect(boxSelection(['a', 'b'], ['b', 'c'], true)).toEqual(['a', 'b', 'c']);
  });

  it('ПУСТАЯ рамка с модификатором не трогает уже собранное', () => {
    expect(boxSelection(['a', 'b'], [], true)).toEqual(['a', 'b']);
  });

  it('пустая рамка без модификатора снимает выделение', () => {
    expect(boxSelection(['a', 'b'], [], false)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import {
  CLIP_PAD_MIN,
  clipPad,
  clipPolygon,
  clipRect,
  isProvince,
  provinceSeeds,
  seedWeight,
  type SeedSource,
} from './provinceMap';

const node = (id: string, sector = 'core'): { id: string; sector: string } => ({ id, sector });
const src = (over: Partial<SeedSource> = {}): SeedSource => ({
  size: 2,
  at: { x: 10, y: 20 },
  owner: 'p1',
  ...over,
});

describe('политическая карта — какие узлы дают клетки', () => {
  it('ПУСТОЙ УЗЕЛ — НЕ ПРОВИНЦИЯ: его семя отъело бы территорию у настоящих соседей', () => {
    expect(isProvince('empty')).toBe(false);
    expect(isProvince('core')).toBe(true);
    const seeds = provinceSeeds([node('a'), node('void', 'empty')], 1, () => src());
    expect(seeds).toHaveLength(1);
  });

  it('УЗЕЛ БЕЗ МИРА ПРОПУСКАЕТСЯ — несогласованная карта не повод падать', () => {
    expect(provinceSeeds([node('a')], 1, () => null)).toEqual([]);
    expect(provinceSeeds([node('a')], 1, () => src({ size: null }))).toEqual([]);
  });

  it('семя несёт координаты, известного владельца и тип сектора', () => {
    const [seed] = provinceSeeds([node('a', 'nebula')], 1, () =>
      src({ at: { x: 5, y: 6 }, owner: 'p2' }),
    );
    expect(seed).toMatchObject({ x: 5, y: 6, owner: 'p2', kind: 'nebula' });
  });

  it('владелец за туманом приезжает как «неизвестен», а не как правда', () => {
    const [seed] = provinceSeeds([node('a')], 1, () => src({ owner: null }));
    expect(seed!.owner).toBeNull();
  });

  it('пустая карта даёт пустой список', () => {
    expect(provinceSeeds([], 1, () => src())).toEqual([]);
  });
});

describe('политическая карта — вес семени', () => {
  it('ВЕС РАСТЁТ КВАДРАТИЧНО ПО МАСШТАБУ: иначе карта перекраивается при зуме', () => {
    const одно = seedWeight(1, 1);
    expect(seedWeight(1, 2)).toBe(одно * 4);
    expect(seedWeight(1, 3)).toBe(одно * 9);
  });

  it('доли территорий при зуме СОХРАНЯЮТСЯ — отношение весов от масштаба не зависит', () => {
    const дома = (scale: number) => seedWeight(3, scale) / seedWeight(1, scale);
    expect(дома(1)).toBe(дома(2.7));
  });

  it('больший мир весит больше', () => {
    expect(seedWeight(4, 1)).toBeGreaterThan(seedWeight(1, 1));
  });

  it('нулевой размер даёт нулевой вес — клетка схлопнется, а не займёт всё', () => {
    expect(seedWeight(0, 2)).toBe(0);
  });
});

describe('политическая карта — рамка обрезки', () => {
  const bounds = { minX: 0, maxX: 1000, minY: 0, maxY: 600 };

  it('отступ — доля ширины карты', () => {
    expect(clipPad(bounds)).toBe(50);
  });

  it('ОТСТУП НЕ МЕНЬШЕ ПОЛА: на узкой карте доля выродилась бы почти в ноль', () => {
    expect(clipPad({ minX: 0, maxX: 100, minY: 0, maxY: 100 })).toBe(CLIP_PAD_MIN);
    expect(clipPad({ minX: 5, maxX: 5, minY: 0, maxY: 0 })).toBe(CLIP_PAD_MIN);
  });

  it('РАМКА СТРОИТСЯ ПО ГРАНИЦЕ КАРТЫ, а не по экрану — у карты есть свой край', () => {
    const { topLeft, bottomRight } = clipRect(bounds);
    expect(topLeft).toEqual({ x: -50, y: -50 });
    expect(bottomRight).toEqual({ x: 1050, y: 650 });
  });

  it('углы идут по часовой стрелке и замыкают прямоугольник', () => {
    expect(clipPolygon({ x: 0, y: 0 }, { x: 10, y: 6 })).toEqual([
      [0, 0],
      [10, 0],
      [10, 6],
      [0, 6],
    ]);
  });
});

// Правило 6: клетку строит не только политическая заливка — вспышка захвата
// пересобирает её каждый кадр, чтобы обрезать по ней волну. Эти тесты держат ОДИН дом
// формул: пока вспышка зовёт те же функции, её клетка не может разъехаться с заливкой.
describe('мозаика ОДНА на всех, кто её строит (REFM-124)', () => {
  const nodes = [
    { id: 'a', sector: 'planet' },
    { id: 'пустой', sector: 'empty' },
    { id: 'b', sector: 'asteroid' },
    { id: 'нет-мира', sector: 'planet' },
    { id: 'c', sector: 'nebula' },
  ];
  const sizes: Record<string, number> = { a: 1, b: 2, c: 3 };
  const at: Record<string, { x: number; y: number }> = {
    a: { x: 10, y: 10 },
    b: { x: 200, y: 40 },
    c: { x: 90, y: 300 },
  };
  const source = (n: { id: string }) =>
    sizes[n.id] === undefined ? null : { size: sizes[n.id]!, at: at[n.id]!, owner: null };

  it('ВСПЫШКА И ЗАЛИВКА БЕРУТ ОДНИ СЕМЕНА: иначе волна течёт мимо границы провинции', () => {
    // «заливка» и «вспышка» — два независимых вызова одних и тех же функций
    expect(provinceSeeds(nodes, 1.7, source)).toEqual(provinceSeeds(nodes, 1.7, source));
  });

  it('ИНДЕКС КЛЕТКИ СЧИТАЕТСЯ ПО ТЕМ ЖЕ ПРОПУСКАМ: вспышке нужен номер её семени', () => {
    // вспышка нумерует семена в порядке добавления — пустые узлы и узлы без мира
    // выпадают у обеих сторон одинаково, поэтому номер сходится
    const order: string[] = [];
    const seeds = provinceSeeds(nodes, 1, (n) => {
      const src = source(n);
      if (src) order.push(n.id);
      return src;
    });
    expect(order).toEqual(['a', 'b', 'c']);
    expect(seeds).toHaveLength(order.length);
    expect(seeds[order.indexOf('b')]!.x).toBe(at.b!.x);
  });

  it('ВЕС ЗАВИСИТ ОТ МАСШТАБА: клетка вспышки обязана ехать вместе с камерой', () => {
    const near = provinceSeeds(nodes, 2, source);
    const far = provinceSeeds(nodes, 1, source);
    expect(near[0]!.w).toBe(far[0]!.w * 4); // квадратично — правило 3
  });

  it('РАМКА У ОБЕИХ ОДНА: своя копия отступа развела бы края клеток', () => {
    const b = { minX: 0, maxX: 1000, minY: 0, maxY: 600 };
    const fill = clipPolygon(clipRect(b).topLeft, clipRect(b).bottomRight);
    const flash = clipPolygon(clipRect(b).topLeft, clipRect(b).bottomRight);
    expect(flash).toEqual(fill);
    expect(fill[0]).toEqual([-clipPad(b), -clipPad(b)]);
  });
});

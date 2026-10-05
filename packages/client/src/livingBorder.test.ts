import { describe, expect, it } from 'vitest';
import { drawLivingBorders, LIVING_AMP, LIVING_MAX_PX, livingOffset, type LivingFrame } from './livingBorder';
import {
  computePowerCells,
  drawTerritory,
  strokeBorders,
  type BorderSegment,
  type ClassifiedBorders,
  type TerritoryCell,
  type TerritorySeed,
} from './territory';
import { placePoly } from './territoryGeometry';

/** A recording context: every call as `name(args)`, properties as `name=value`. */
function recorder(): { g: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const g = new Proxy({} as Record<string, unknown>, {
    get:
      (_t, key) =>
      (...args: unknown[]) =>
        log.push(`${String(key)}(${args.join(',')})`),
    set: (_t, key, value) => (log.push(`${String(key)}=${String(value)}`), true),
  }) as unknown as CanvasRenderingContext2D;
  return { g, log };
}

const frame: LivingFrame = { x: 100, y: 50, width: 800, height: 600 };
const palette = { ownerColor: () => '#40c0e0', hideOwnedInner: true, provinceDetail: 1 };
const scale = Math.min(frame.width, frame.height);
/** Заявленный размах: доля рамки, не больше потолка в экранных пикселях. */
const amp = Math.min(scale * LIVING_AMP, LIVING_MAX_PX);

describe('M2.11 — живая граница провинций', () => {
  it('одна и та же точка в один и тот же миг — один и тот же сдвиг: стоящие часы замораживают линию', () => {
    // Под reduced motion часы голограммы стоят — и граница обязана стоять вместе с ними.
    expect(livingOffset(321, 222, frame, 4200)).toEqual(livingOffset(321, 222, frame, 4200));
  });

  it('линия живёт: с ходом часов точки двигаются', () => {
    let moved = 0;
    for (let i = 0; i < 20; i++) {
      const [ax, ay] = livingOffset(150 + i * 31, 90 + i * 17, frame, 0);
      const [bx, by] = livingOffset(150 + i * 31, 90 + i * 17, frame, 1500);
      if (Math.hypot(bx - ax, by - ay) > amp * 0.05) moved++;
    }
    expect(moved).toBeGreaterThan(10);
  });

  it('амплитуда ограничена: линия не отходит от застывшей заливки дальше заявленного', () => {
    const cap = amp + 1e-9;
    for (let x = frame.x; x <= frame.x + frame.width; x += 37)
      for (let y = frame.y; y <= frame.y + frame.height; y += 29)
        for (const clock of [0, 777, 9_000, 123_456]) {
          const [dx, dy] = livingOffset(x, y, frame, clock);
          expect(Math.abs(dx)).toBeLessThanOrEqual(cap);
          expect(Math.abs(dy)).toBeLessThanOrEqual(cap);
        }
  });

  it('поле привязано к карте: панорама несёт волну вместе с ней', () => {
    const moved: LivingFrame = { ...frame, x: frame.x - 240, y: frame.y + 75 };
    const [ax, ay] = livingOffset(420, 310, frame, 2500);
    const [bx, by] = livingOffset(420 - 240, 310 + 75, moved, 2500);
    expect(bx).toBeCloseTo(ax, 9);
    expect(by).toBeCloseTo(ay, 9);
  });

  it('и зум тоже: рисунок не переезжает, а ниже потолка размах растёт вместе с картой', () => {
    const small: LivingFrame = { x: 40, y: 30, width: 300, height: 200 }; // размах 0,36 пикселя
    const zoomed: LivingFrame = { x: small.x, y: small.y, width: small.width * 2, height: small.height * 2 };
    const [ax, ay] = livingOffset(120, 90, small, 2500);
    const [bx, by] = livingOffset(small.x + (120 - small.x) * 2, small.y + (90 - small.y) * 2, zoomed, 2500);
    expect(bx).toBeCloseTo(ax * 2, 9);
    expect(by).toBeCloseTo(ay * 2, 9);
  });

  // Просьба владельца 2026-09-30: «сделай, чтоб границы провинций не так сильно "качались"».
  // Рамка растёт с зумом, и без потолка на стартовом виде партии (×3) граница качалась на
  // 3 пикселя на ПК, а вблизи — ещё сильнее.
  it('вблизи размах не растёт выше потолка: тот же рисунок, что и издалека, той же силы', () => {
    const k = 8;
    const near: LivingFrame = { x: frame.x, y: frame.y, width: frame.width * k, height: frame.height * k };
    const [ax, ay] = livingOffset(420, 310, frame, 2500);
    const [bx, by] = livingOffset(frame.x + (420 - frame.x) * k, frame.y + (310 - frame.y) * k, near, 2500);
    expect(bx).toBeCloseTo(ax, 9);
    expect(by).toBeCloseTo(ay, 9);
    for (let x = near.x; x <= near.x + 2000; x += 41)
      for (let y = near.y; y <= near.y + 1500; y += 37)
        for (const clock of [0, 4_321, 88_000]) {
          const [dx, dy] = livingOffset(x, y, near, clock);
          expect(Math.abs(dx)).toBeLessThanOrEqual(LIVING_MAX_PX + 1e-9);
          expect(Math.abs(dy)).toBeLessThanOrEqual(LIVING_MAX_PX + 1e-9);
        }
  });

  it('общая граница остаётся общей: обе стороны фронтира кладут концы в одни точки', () => {
    // Фронтир рисует КАЖДАЯ сторона своим цветом, обходя общую грань навстречу друг другу.
    const borders: ClassifiedBorders = {
      ownedFront: new Map([
        ['p1', [[300, 200, 360, 260]]],
        ['p2', [[360, 260, 300, 200]]],
      ]),
      ownedInner: new Map(),
      neutralEdge: [],
    };
    const { g, log } = recorder();
    drawLivingBorders(g, borders, palette, frame, 3100, { width: 1000, height: 800 });
    const points = log.filter((l) => l.startsWith('moveTo(') || l.startsWith('lineTo('));
    const a = points.find((l) => l.startsWith('moveTo('))!.slice(7, -1);
    const b = points.find((l) => l.startsWith('lineTo('))!.slice(7, -1);
    // Первая сторона идёт a→b, вторая b→a: в журнале обе пары обязаны совпасть.
    expect(points).toContain(`moveTo(${b})`);
    expect(points).toContain(`lineTo(${a})`);
    // И сдвинуты они на самом деле — это не застывший рисунок.
    expect(a).not.toBe('300,200');
  });

  it('невидимое не считается: отрезок за краем экрана в кадр не попадает', () => {
    const borders: ClassifiedBorders = {
      ownedFront: new Map(),
      ownedInner: new Map(),
      neutralEdge: [
        [10, 10, 40, 40],
        [5000, 10, 5100, 40],
      ],
    };
    const { g, log } = recorder();
    drawLivingBorders(g, borders, palette, frame, 0, { width: 1000, height: 800 });
    expect(log.filter((l) => l.startsWith('moveTo('))).toHaveLength(1);
  });

  it('видимая область со сдвигом: камера ушла вправо — виден дальний отрезок, ближний нет', () => {
    const borders: ClassifiedBorders = {
      ownedFront: new Map(),
      ownedInner: new Map(),
      neutralEdge: [
        [10, 10, 40, 40],
        [5000, 10, 5100, 40],
      ],
    };
    const { g, log } = recorder();
    drawLivingBorders(g, borders, palette, frame, 0, { x: 4500, y: 0, width: 1000, height: 800 });
    const moves = log.filter((l) => l.startsWith('moveTo('));
    expect(moves).toHaveLength(1);
    expect(Number(moves[0]!.slice(7).split(',')[0])).toBeGreaterThan(4000);
  });

  it('границы в координатах мозаики встают на место формулой полигонов: кадр тот же, что по поставленным', () => {
    // Выпечка держит классы границ в координатах мозаики (`territoryGeometry.ts`) и говорит,
    // куда их поставить. Отбор у края экрана и сдвиг поля считаются от поставленной точки,
    // поэтому журнал холста обязан совпасть с журналом по заранее поставленным точкам.
    const place = { scale: 2.75, x: -431.5, y: 77.25 };
    const local: ClassifiedBorders = {
      ownedFront: new Map([
        ['p1', [[200.1, 100.3, 260.7, 160.9]]],
        ['p2', [[260.7, 160.9, 200.1, 100.3]]],
      ]),
      ownedInner: new Map([['p1', [[300, 50, 330.5, 70.25]]]]),
      neutralEdge: [
        [10, 10, 40, 40], // левее экрана после постановки
        [5000, 10, 5100, 40], // далеко правее
        [180, 20, 175.5, 60.5],
      ],
    };
    const at = (x: number, y: number): [number, number] => placePoly([[x, y]], place)[0]!;
    const put = (segs: BorderSegment[]): BorderSegment[] =>
      segs.map(([x0, y0, x1, y1]) => {
        const [ax, ay] = at(x0, y0);
        const [bx, by] = at(x1, y1);
        return [ax, ay, bx, by];
      });
    const placed: ClassifiedBorders = {
      ownedFront: new Map([...local.ownedFront].map(([o, segs]) => [o, put(segs)])),
      ownedInner: new Map([...local.ownedInner].map(([o, segs]) => [o, put(segs)])),
      neutralEdge: put(local.neutralEdge),
    };
    const view = { x: 50, y: -20, width: 1000, height: 800 };
    const all = { ...palette, hideOwnedInner: false };
    const fromLocal = recorder();
    drawLivingBorders(fromLocal.g, local, all, frame, 2500, view, place);
    const fromPlaced = recorder();
    drawLivingBorders(fromPlaced.g, placed, all, frame, 2500, view);
    expect(fromLocal.log).toEqual(fromPlaced.log);
    // Две ничьи грани за краем отброшены, остальное нарисовано: фронтир — двумя проходами
    // по обе стороны, внутренняя и ничья грани — по разу.
    expect(fromLocal.log.filter((l) => l.startsWith('moveTo('))).toHaveLength(2 * 2 + 1 + 1);
  });

  it('цепочка граней — одна живая ломаная: общая точка сдвинута один раз и туда же, куда её ведёт поле', () => {
    const place = { scale: 2.5, x: -120.25, y: 33.5 };
    const chain: BorderSegment[] = [
      [150, 80, 162.5, 86],
      [162.5, 86, 171, 99.75],
      [171, 99.75, 186.25, 104],
    ];
    const borders: ClassifiedBorders = { ownedFront: new Map([['p1', chain]]), ownedInner: new Map(), neutralEdge: [] };
    const { g, log } = recorder();
    drawLivingBorders(g, borders, palette, frame, 4321, { width: 1000, height: 800 }, place);
    const point = (x: number, y: number): string => {
      const [px, py] = placePoly([[x, y]], place)[0]!;
      const [dx, dy] = livingOffset(px, py, frame, 4321);
      return `${px + dx},${py + dy}`;
    };
    const path = (l: string) => /^(moveTo|lineTo)\(/.test(l);
    const glow = log.slice(0, log.indexOf('lineWidth=1.15')).filter(path);
    expect(glow).toEqual([
      `moveTo(${point(150, 80)})`,
      `lineTo(${point(162.5, 86)})`,
      `lineTo(${point(171, 99.75)})`,
      `lineTo(${point(186.25, 104)})`,
    ]);
    // Линия поверх свечения идёт по той же ломаной.
    expect(log.slice(log.indexOf('lineWidth=1.15')).filter(path)).toEqual(glow);
  });

  it('стили общие с запечённой картой: те же проходы и толщины, что без сдвига', () => {
    const borders: ClassifiedBorders = {
      ownedFront: new Map([['p1', [[300, 200, 360, 260]]]]),
      ownedInner: new Map(),
      neutralEdge: [[10, 10, 40, 40]],
    };
    const styleOf = (log: string[]): string[] =>
      log.filter((l) => /^(strokeStyle|lineWidth)=|^setLineDash\(|^stroke\(/.test(l));
    const living = recorder();
    drawLivingBorders(living.g, borders, palette, frame, 1234, { width: 1000, height: 800 });
    const baked = recorder();
    strokeBorders(baked.g, borders, palette);
    expect(styleOf(living.log)).toEqual(styleOf(baked.log));
  });
});

describe('drawTerritory — обводку можно отдать живой границе', () => {
  const seeds: TerritorySeed[] = [
    { x: 100, y: 100, w: 1, owner: 'p1', kind: 'planet' },
    { x: 300, y: 100, w: 1, owner: 'p2', kind: 'planet' },
  ];
  const clip: Array<[number, number]> = [
    [0, 0],
    [400, 0],
    [400, 200],
    [0, 200],
  ];
  const fullPalette = {
    ownerColor: () => '#40c0e0',
    neutralFill: '#203040',
    kindAccent: () => undefined,
  };

  it('по умолчанию — рисует и заливку, и границы', () => {
    const { g, log } = recorder();
    drawTerritory(g, seeds, clip, fullPalette);
    expect(log.some((l) => l.startsWith('fill('))).toBe(true);
    expect(log.some((l) => l.startsWith('stroke('))).toBe(true);
  });

  it('strokeBorders: false — только заливка, ни одной линии: иначе граница нарисуется дважды', () => {
    const { g, log } = recorder();
    const cells: TerritoryCell[] = drawTerritory(g, seeds, clip, { ...fullPalette, strokeBorders: false });
    expect(cells).toHaveLength(2);
    expect(log.some((l) => l.startsWith('fill('))).toBe(true);
    expect(log.some((l) => l.startsWith('stroke('))).toBe(false);
  });

  it('`place`: клетки формы, поставленные при обводке, — тот же журнал холста, что поставленные заранее', () => {
    // Выпечка не копирует клетки в свои координаты: каждую точку ставит сама обводка той же
    // формулой, что `placePoly`, — холст обязан получить те же числа, а отбор по `view` (он в
    // координатах холста) — отбросить те же клетки и отрезки.
    const shape: TerritorySeed[] = [
      { x: 60, y: 50, w: 1, owner: 'p1', kind: 'planet' },
      { x: 160, y: 60, w: 1, owner: 'p1', kind: 'asteroid' },
      { x: 260, y: 40, w: 1, owner: null, kind: 'planet' },
      { x: 340, y: 150, w: 1, owner: 'p2', kind: 'asteroid' },
      { x: 120, y: 160, w: 1, owner: null, kind: 'asteroid' },
    ];
    const local = computePowerCells(shape, clip);
    const place = { scale: 2.75, x: -431.5, y: 77.25 };
    const placed = local.map((c) => ({ ...c, poly: placePoly(c.poly, place) }));
    const accent = (k: string): string | undefined => (k === 'asteroid' ? '#71879d' : undefined);
    const accented = { ...fullPalette, kindAccent: accent };
    const view = { x0: 0, y0: 100, x1: 500, y1: 520 };
    const fromLocal = recorder();
    drawTerritory(fromLocal.g, shape, clip, accented, local, view, place);
    const fromPlaced = recorder();
    drawTerritory(fromPlaced.g, shape, clip, accented, placed, view);
    expect(fromLocal.log).toEqual(fromPlaced.log);
    // Отбор действительно работал: без `view` заливок и отрезков больше.
    const whole = recorder();
    drawTerritory(whole.g, shape, clip, accented, placed);
    const count = (log: string[], call: string) => log.filter((l) => l.startsWith(call)).length;
    expect(count(fromLocal.log, 'fill(')).toBeLessThan(count(whole.log, 'fill('));
    expect(count(fromLocal.log, 'fill(')).toBeGreaterThan(0);
    expect(count(fromLocal.log, 'lineTo(')).toBeLessThan(count(whole.log, 'lineTo('));
  });
});

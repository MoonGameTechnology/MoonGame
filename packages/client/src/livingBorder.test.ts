import { describe, expect, it } from 'vitest';
import { drawLivingBorders, LIVING_AMP, livingOffset, type LivingFrame } from './livingBorder';
import {
  drawTerritory,
  strokeBorders,
  type ClassifiedBorders,
  type TerritoryCell,
  type TerritorySeed,
} from './territory';

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
      if (Math.hypot(bx - ax, by - ay) > scale * LIVING_AMP * 0.05) moved++;
    }
    expect(moved).toBeGreaterThan(10);
  });

  it('амплитуда ограничена: линия не отходит от застывшей заливки дальше заявленного', () => {
    const cap = scale * LIVING_AMP + 1e-9;
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

  it('и зум тоже: сдвиг растёт вместе с картой, рисунок не переезжает', () => {
    const zoomed: LivingFrame = { x: frame.x, y: frame.y, width: frame.width * 2, height: frame.height * 2 };
    const [ax, ay] = livingOffset(420, 310, frame, 2500);
    const [bx, by] = livingOffset(frame.x + (420 - frame.x) * 2, frame.y + (310 - frame.y) * 2, zoomed, 2500);
    expect(bx).toBeCloseTo(ax * 2, 9);
    expect(by).toBeCloseTo(ay * 2, 9);
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
      sealedEdge: [],
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
      sealedEdge: [],
    };
    const { g, log } = recorder();
    drawLivingBorders(g, borders, palette, frame, 0, { width: 1000, height: 800 });
    expect(log.filter((l) => l.startsWith('moveTo('))).toHaveLength(1);
  });

  it('стили общие с запечённой картой: те же проходы и толщины, что без сдвига', () => {
    const borders: ClassifiedBorders = {
      ownedFront: new Map([['p1', [[300, 200, 360, 260]]]]),
      ownedInner: new Map(),
      neutralEdge: [[10, 10, 40, 40]],
      sealedEdge: [[100, 100, 140, 120]],
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
});

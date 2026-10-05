import { describe, it, expect } from 'vitest';
import {
  BOUNDARY,
  classifyBorders,
  clipHalfPlane,
  clipHalfPlaneTagged,
  clampPowerWeights,
  computePowerCells,
  computePowerCell,
  strokeBorders,
  type BorderSegment,
  type ClassifiedBorders,
  type TerritorySeed,
} from './territory';
import { waveCells } from './territoryWave';

// The unit square, CCW — the reusable clip fixture for the half-plane primitives.
const SQUARE: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];

describe('territory — clipHalfPlane (Sutherland–Hodgman)', () => {
  it('clips the unit square to x ≤ 0.5 (keeps the left half)', () => {
    // a*x + b*y + c ≤ 0  →  x ≤ 0.5  with a=1, b=0, c=-0.5
    const out = clipHalfPlane(SQUARE, 1, 0, -0.5);
    expect(out).toEqual([
      [0, 0],
      [0.5, 0],
      [0.5, 1],
      [0, 1],
    ]);
  });

  it('drops the polygon entirely when the whole square is outside the half-plane', () => {
    // x ≤ -1 : every vertex has d > 0, nothing survives
    expect(clipHalfPlane(SQUARE, 1, 0, 1)).toEqual([]);
  });
});

describe('territory — clipHalfPlaneTagged (border provenance)', () => {
  it('tags the newly-cut edge with clipTag and keeps original edges as their tag', () => {
    const tags = SQUARE.map(() => BOUNDARY);
    const { poly, tags: outT } = clipHalfPlaneTagged(SQUARE, tags, 1, 0, -0.5, 7);
    expect(poly).toEqual([
      [0, 0],
      [0.5, 0],
      [0.5, 1],
      [0, 1],
    ]);
    // Only the cut edge (0.5,0)→(0.5,1) — poly[1]→poly[2] — belongs to neighbour 7;
    // the surviving original edges stay on the map boundary.
    expect(outT).toEqual([BOUNDARY, 7, BOUNDARY, BOUNDARY]);
  });
});

describe('territory — clampPowerWeights', () => {
  it('is a no-op for fewer than two seeds', () => {
    const one = [{ x: 0, y: 0, w: 99 }];
    clampPowerWeights(one);
    expect(one[0]!.w).toBe(99);
  });

  it('caps a close, lopsided pair below the swallow threshold while keeping order', () => {
    const seeds = [
      { x: 0, y: 0, w: 1 },
      { x: 30, y: 0, w: 9000 }, // close + huge disparity → would swallow seed 0
    ];
    clampPowerWeights(seeds);
    expect(seeds[1]!.w).toBeGreaterThan(seeds[0]!.w); // bigger world still claims more
    expect(seeds[1]!.w - seeds[0]!.w).toBeLessThanOrEqual(30 * 30); // ≤ d² → no swallow
  });
});

describe('territory — computePowerCells', () => {
  const clip: Array<[number, number]> = [
    [-100, -100],
    [100, -100],
    [100, 100],
    [-100, 100],
  ];

  it('splits two equal-weight seeds at the perpendicular bisector', () => {
    const seeds: TerritorySeed[] = [
      { x: 0, y: 0, w: 500, owner: 'p1', kind: 'planet' },
      { x: 10, y: 0, w: 500, owner: 'p2', kind: 'planet' },
    ];
    const cells = computePowerCells(seeds, clip);
    expect(cells).toHaveLength(2);
    const left = cells.find((c) => c.idx === 0)!;
    const right = cells.find((c) => c.idx === 1)!;
    // Equal weights ⇒ the border is the bisector at x = 5.
    for (const [x] of left.poly) expect(x).toBeLessThanOrEqual(5 + 1e-9);
    for (const [x] of right.poly) expect(x).toBeGreaterThanOrEqual(5 - 1e-9);
    // The shared edge of the left cell is tagged with its neighbour (seed 1).
    expect(left.tags).toContain(1);
    expect(left.owner).toBe('p1');
    expect(right.owner).toBe('p2');
  });

  it('keeps every seed a non-empty cell even with a heavy, close neighbour (no swallow)', () => {
    const seeds: TerritorySeed[] = [
      { x: 0, y: 0, w: 1, owner: 'p1', kind: 'planet' },
      { x: 12, y: 0, w: 9000, owner: 'p2', kind: 'nebula' }, // would swallow seed 0 unclamped
      { x: 0, y: 12, w: 4000, owner: null, kind: 'asteroid' },
    ];
    const cells = computePowerCells(seeds, clip);
    expect(cells).toHaveLength(3); // clamp keeps all three cells non-degenerate
    for (const c of cells) expect(c.poly.length).toBeGreaterThanOrEqual(3);
  });

  it('does not mutate the caller’s seed weights (pure)', () => {
    const seeds: TerritorySeed[] = [
      { x: 0, y: 0, w: 1, owner: 'p1', kind: 'planet' },
      { x: 12, y: 0, w: 9000, owner: 'p2', kind: 'planet' },
    ];
    computePowerCells(seeds, clip);
    expect(seeds[0]!.w).toBe(1);
    expect(seeds[1]!.w).toBe(9000);
  });
});

describe('territory — computePowerCell (single cell, capture flash)', () => {
  const clip: Array<[number, number]> = [
    [-100, -100],
    [100, -100],
    [100, 100],
    [-100, 100],
  ];
  const seeds: TerritorySeed[] = [
    { x: 0, y: 0, w: 1, owner: 'p1', kind: 'planet' },
    { x: 12, y: 0, w: 9000, owner: 'p2', kind: 'nebula' },
    { x: 0, y: 12, w: 4000, owner: null, kind: 'asteroid' },
  ];

  it('matches the same-index cell from computePowerCells exactly (identical clamp/math)', () => {
    const all = computePowerCells(seeds, clip);
    for (let i = 0; i < seeds.length; i++) {
      const one = computePowerCell(seeds, clip, i)!;
      const full = all.find((c) => c.idx === i)!;
      expect(one.poly).toEqual(full.poly); // pixel-for-pixel: the flash lines up with the fill
      expect(one.tags).toEqual(full.tags);
      expect(one.owner).toBe(full.owner);
    }
  });

  it('returns null for an out-of-range index and never mutates seeds', () => {
    expect(computePowerCell(seeds, clip, -1)).toBeNull();
    expect(computePowerCell(seeds, clip, 3)).toBeNull();
    expect(seeds[1]!.w).toBe(9000); // pure
  });
});

describe('territory — classifyBorders (political border logic, no canvas)', () => {
  const clip: Array<[number, number]> = [
    [-100, -100],
    [100, -100],
    [100, 100],
    [-100, 100],
  ];

  it('same-owner edges are INNER hairlines drawn once; owner-vs-other is a two-sided frontier', () => {
    // p1 | p1 | p2 in a row: p1's pair shares an inner edge; p1|p2 is a frontier.
    const seeds: TerritorySeed[] = [
      { x: -50, y: 0, w: 0, owner: 'p1', kind: 'planet' },
      { x: 0, y: 0, w: 0, owner: 'p1', kind: 'planet' },
      { x: 50, y: 0, w: 0, owner: 'p2', kind: 'planet' },
    ];
    const { ownedFront, ownedInner, neutralEdge } = classifyBorders(
      computePowerCells(seeds, clip),
      seeds,
    );
    // The p1↔p1 edge appears ONCE (idx < t dedup), keyed by owner.
    expect(ownedInner.get('p1')).toHaveLength(1);
    expect(ownedInner.has('p2')).toBe(false);
    // The p1↔p2 border glows from BOTH sides — one frontier segment per owner, and ONLY
    // that one: the map edge is the map's line, not a frontier (owner, 2026-09-24).
    expect(ownedFront.get('p1')).toHaveLength(1);
    expect(ownedFront.get('p2')).toHaveLength(1);
    expect(neutralEdge).toHaveLength(0); // nothing neutral on this map
  });

  it('neutral-vs-neutral divisions are deduped; the map edge is not a division', () => {
    const seeds: TerritorySeed[] = [
      { x: -50, y: 0, w: 0, owner: null, kind: 'planet' },
      { x: 50, y: 0, w: 0, owner: null, kind: 'planet' },
    ];
    const cells = computePowerCells(seeds, clip);
    const { ownedFront, ownedInner, neutralEdge } = classifyBorders(cells, seeds);
    expect(ownedFront.size).toBe(0);
    expect(ownedInner.size).toBe(0);
    // The one shared division (deduped by idx < t); each cell's 3 map-edge sides are not.
    expect(cells.flatMap((c) => c.tags).filter((t) => t === BOUNDARY)).toHaveLength(6);
    expect(neutralEdge).toHaveLength(1);
  });
});

describe('classifyBorders — край карты не граница провинции (владелец 2026-09-24)', () => {
  // «У провинций у края карты не должно быть своих волнистых краёв»: край рисует сама
  // карта — рамка голограммы или контур доски, — и обводка провинции по нему легла бы
  // второй линией, которая движется отдельно от рамки.
  const clip: Array<[number, number]> = [
    [-200, -200],
    [200, -200],
    [200, 200],
    [-200, 200],
  ];
  const onClip = (x: number, y: number): boolean =>
    Math.abs(Math.abs(x) - 200) < 1e-9 || Math.abs(Math.abs(y) - 200) < 1e-9;

  it('провинция на всю карту — ни одной обводки: весь её край и есть край карты', () => {
    const seeds: TerritorySeed[] = [{ x: 0, y: 0, w: 0, owner: 'p1', kind: 'planet' }];
    const { ownedFront, ownedInner, neutralEdge } = classifyBorders(computePowerCells(seeds, clip), seeds);
    expect(ownedFront.size).toBe(0);
    expect(ownedInner.size).toBe(0);
    expect(neutralEdge).toHaveLength(0);
  });

  it('ни одна обводка не лежит на краю — ни фронтир, ни граница своих, ни нейтральная', () => {
    const seeds: TerritorySeed[] = [
      { x: -100, y: -100, w: 0, owner: 'p1', kind: 'planet' },
      { x: 100, y: -100, w: 0, owner: 'p1', kind: 'planet' },
      { x: -100, y: 100, w: 0, owner: 'p2', kind: 'planet' },
      { x: 100, y: 100, w: 0, owner: null, kind: 'planet' },
    ];
    const { ownedFront, ownedInner, neutralEdge } = classifyBorders(computePowerCells(seeds, clip), seeds);
    const all = [...[...ownedFront.values()].flat(), ...[...ownedInner.values()].flat(), ...neutralEdge];
    expect(all.length).toBeGreaterThan(0); // внутренние границы на месте
    for (const [x0, y0, x1, y1] of all) {
      // отрезок, у которого ОБА конца на одной стороне рамки, лёг бы вдоль края
      const alongX = Math.abs(x0 - x1) < 1e-9 && Math.abs(Math.abs(x0) - 200) < 1e-9;
      const alongY = Math.abs(y0 - y1) < 1e-9 && Math.abs(Math.abs(y0) - 200) < 1e-9;
      expect(alongX || alongY).toBe(false);
      expect(onClip((x0 + x1) / 2, (y0 + y1) / 2)).toBe(false);
    }
  });
});

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

/** Every stroke of the log as the segments it covers, `x0,y0,x1,y1`, in path order. */
function strokedSegments(log: readonly string[]): string[][] {
  const strokes: string[][] = [];
  let segs: string[] = [];
  let at = '';
  for (const line of log) {
    const xy = /^(moveTo|lineTo)\((.*)\)$/.exec(line);
    if (line === 'beginPath()') segs = [];
    else if (line === 'stroke()') strokes.push(segs);
    else if (xy?.[1] === 'moveTo') at = xy[2]!;
    else if (xy) {
      segs.push(`${at},${xy[2]}`);
      at = xy[2]!;
    }
  }
  return strokes;
}

describe('strokeBorders — цепочка граней одной ломаной (плавность 7.4)', () => {
  const palette = { ownerColor: (o: string) => (o === 'p1' ? '#40c0e0' : '#e07040'), provinceDetail: 1 };

  it('отрезки, идущие друг за другом, — одна ломаная; разрыв начинает новую', () => {
    const borders: ClassifiedBorders = {
      ownedFront: new Map(),
      ownedInner: new Map(),
      neutralEdge: [
        [0, 0, 10, 0],
        [10, 0, 20, 5],
        [20, 5, 30, 5],
        [100, 100, 110, 100],
      ],
    };
    const { g, log } = recorder();
    strokeBorders(g, borders, palette);
    expect(log.filter((l) => /^(beginPath|moveTo|lineTo|stroke)\(/.test(l))).toEqual([
      'beginPath()',
      'moveTo(0,0)',
      'lineTo(10,0)',
      'lineTo(20,5)',
      'lineTo(30,5)',
      'moveTo(100,100)',
      'lineTo(110,100)',
      'stroke()',
    ]);
  });

  it('отрезок, не прошедший отбор, рвёт цепочку: нарисовано ровно то, что прошло', () => {
    const borders: ClassifiedBorders = {
      ownedFront: new Map(),
      ownedInner: new Map(),
      neutralEdge: [
        [0, 0, 10, 0],
        [10, 0, 20, 5],
        [20, 5, 30, 5],
      ],
    };
    const { g, log } = recorder();
    strokeBorders(g, borders, palette, undefined, (sg) => sg[0] !== 10);
    expect(strokedSegments(log)).toEqual([['0,0,10,0', '20,5,30,5']]);
    expect(log.filter((l) => l.startsWith('moveTo('))).toHaveLength(2);
  });

  it('на волнистой карте: те же отрезки, что по одному, а каждая точка сдвинута один раз', () => {
    // Волна режет каждую грань на короткие отрезки — так выглядит настоящая карта. Ломаная
    // обязана пройти ровно по отрезкам, прошедшим отбор, в том же порядке, а каждую точку
    // сдвинуть один раз, даже если фронтир обводится дважды (свечение и линия).
    const seeds: TerritorySeed[] = [
      { x: 60, y: 50, w: 4000, owner: 'p1', kind: 'planet' },
      { x: 200, y: 60, w: 4000, owner: 'p1', kind: 'planet' },
      { x: 340, y: 40, w: 4000, owner: null, kind: 'planet' },
      { x: 120, y: 200, w: 4000, owner: 'p2', kind: 'planet' },
      { x: 300, y: 210, w: 4000, owner: null, kind: 'planet' },
      { x: 420, y: 160, w: 4000, owner: null, kind: 'planet' },
    ];
    const clip: Array<[number, number]> = [
      [0, 0],
      [480, 0],
      [480, 280],
      [0, 280],
    ];
    const cells = waveCells(computePowerCells(seeds, clip), { amp: 6, wavelength: 90, segment: 12 });
    const borders = classifyBorders(cells, seeds);
    const move = (x: number, y: number): [number, number] => [x * 1.5 + 3, y * 0.75 - 2];
    let moved = 0;
    const at = (x: number, y: number): [number, number] => (moved++, move(x, y));
    // Отбор с прорехой посреди карты: цепочки обязаны рваться на ней.
    const keep = (sg: BorderSegment): boolean => Math.abs((sg[0] + sg[2]) / 2 - 240) > 25;
    const { g, log } = recorder();
    strokeBorders(g, borders, palette, at, keep);

    const one = (sg: BorderSegment): string => [...move(sg[0], sg[1]), ...move(sg[2], sg[3])].join(',');
    const each = (segs: BorderSegment[]): string[] => segs.filter(keep).map(one);
    const fronts = [...borders.ownedFront.values()].map(each);
    const expected = [
      ...[...borders.ownedInner.values()].map(each),
      each(borders.neutralEdge),
      ...fronts, // свечение под всеми фронтирами
      ...fronts, // и линия поверх всех
    ].filter((segs) => segs.length > 0);
    const drawn = strokedSegments(log);
    expect(drawn).toEqual(expected);

    // Цепочки действительно склеились: подпутей много меньше, чем отрезков.
    const total = expected.flat().length;
    const starts = log.filter((l) => l.startsWith('moveTo(')).length;
    expect(starts).toBeLessThan(total / 3);
    // Точек сдвинуто ровно столько, сколько их легло в ломаные: второй проход фронтира
    // (линия поверх свечения) берёт уже сдвинутые. По одному отрезку их было бы вдвое больше.
    const beforeCrisp = log.slice(0, log.indexOf('lineWidth=1.15'));
    const laid = beforeCrisp.filter((l) => /^(moveTo|lineTo)\(/.test(l)).length;
    const segments = beforeCrisp.filter((l) => l.startsWith('lineTo(')).length;
    expect(moved).toBe(laid);
    expect(moved).toBeLessThan(1.4 * segments);
  });

  it('фронтир: сперва свечение всех владельцев, потом их линии — по одним и тем же ломаным', () => {
    const borders: ClassifiedBorders = {
      ownedFront: new Map([
        [
          'p1',
          [
            [0, 0, 10, 0],
            [10, 0, 20, 5],
          ],
        ],
        ['p2', [[20, 5, 10, 0]]],
      ]),
      ownedInner: new Map(),
      neutralEdge: [],
    };
    const { g, log } = recorder();
    strokeBorders(g, borders, palette);
    expect(log.filter((l) => l.startsWith('lineWidth='))).toEqual([
      'lineWidth=3',
      'lineWidth=3',
      'lineWidth=1.15',
      'lineWidth=1.15',
    ]);
    const [glow1, glow2, crisp1, crisp2] = strokedSegments(log);
    expect(crisp1).toEqual(glow1);
    expect(crisp2).toEqual(glow2);
    expect(glow1).toEqual(['0,0,10,0', '10,0,20,5']);
  });
});

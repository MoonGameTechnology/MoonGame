/**
 * ЗАКРЫТОЕ НЕБО (решение владельца 2026-11-19): авиация не летает над звездой, чёрной дырой
 * и их кольцом. Здесь — сама геометрия: что путь над закрытой провинцией виден, касание угла
 * не считается, а граница неба — ТА ЖЕ, что у нарисованной мозаики и дорог
 * (`mosaicBorderSegments`), в том числе когда веса сжаты `clampPowerWeights`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closedSky, crossesClosedSky } from './closedSky';
import { mosaicBorderSegments } from './mosaic';
import { loadGameData } from '../data/loadGameData';
import { parseGameData, type GameData } from '../data/schemas';
import type { GameState, Planet } from './gameState';

const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['metal'],
  units: {},
  factions: {},
  buildings: {},
  events: {},
  sectorKinds: {
    star: { traversable: false, overflight: false },
    nebula: {},
  },
});

type Spot = { id: string; x: number; y: number; kind?: string; size?: number };

const planetOf = ({ id, x, y, kind, size }: Spot): Planet => ({
  id,
  owner: null,
  position: { x, y },
  resources: {},
  buildings: [],
  garrison: [],
  traits: [],
  ...(kind ? { kind } : {}),
  ...(size !== undefined ? { size } : {}),
});

const mapOf = (spots: Spot[]): Pick<GameState, 'planets'> => ({
  planets: Object.fromEntries(spots.map((s) => [s.id, planetOf(s)])),
});

/**
 * Сетка 3×3 с шагом 200, звезда `e` — в середине. При равных весах её клетка — квадрат
 * [100, 300]², у соседей — свои квадраты вокруг.
 */
function grid(star: Partial<Spot> = {}): Spot[] {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  return ids.map((id, n) => ({
    id,
    x: (n % 3) * 200,
    y: Math.floor(n / 3) * 200,
    ...(id === 'e' ? { kind: 'star', ...star } : {}),
  }));
}

const P = (x: number, y: number) => ({ x, y });

describe('closedSky — путь над звездой', () => {
  const sky = closedSky(mapOf(grid()), data);

  it('ПРЯМО ЧЕРЕЗ ЗВЕЗДУ — закрыто; мимо неё, по своим провинциям — открыто', () => {
    expect(crossesClosedSky(sky, P(0, 200), P(400, 200))).toBe(true); // d → f
    expect(crossesClosedSky(sky, P(200, 0), P(200, 400))).toBe(true); // b → h
    expect(crossesClosedSky(sky, P(0, 0), P(400, 0))).toBe(false); // a → c, верхний ряд
    expect(crossesClosedSky(sky, P(0, 0), P(0, 400))).toBe(false); // a → g, левый столбец
  });

  it('ПУТЬ, КОТОРЫЙ КОНЧАЕТСЯ НАД ЗВЕЗДОЙ, — тоже над ней: важно, где лежит отрезок', () => {
    expect(crossesClosedSky(sky, P(0, 200), P(150, 200))).toBe(true);
    expect(crossesClosedSky(sky, P(250, 250), P(400, 400))).toBe(true);
  });

  it('ТОЧКА: над звездой патруль не встаёт, рядом встаёт', () => {
    expect(crossesClosedSky(sky, P(200, 200), P(200, 200))).toBe(true);
    expect(crossesClosedSky(sky, P(101, 299), P(101, 299))).toBe(true);
    expect(crossesClosedSky(sky, P(99, 200), P(99, 200))).toBe(false);
    expect(crossesClosedSky(sky, P(50, 50), P(50, 50))).toBe(false);
  });

  it('КАСАНИЕ УГЛА — не пролёт над звездой: меньше единицы карты внутри не считается', () => {
    // Прямая x + y = 200.5 срезает угол (100, 100) клетки на 0.7 единицы, x + y = 202 — на 2.8.
    expect(crossesClosedSky(sky, P(0, 200.5), P(200.5, 0))).toBe(false);
    expect(crossesClosedSky(sky, P(0, 202), P(202, 0))).toBe(true);
    // Путь ровно по границе — над соседом, а не над звездой.
    expect(crossesClosedSky(sky, P(0, 100), P(400, 100))).toBe(false);
  });

  it('НАПРАВЛЕНИЕ НЕ ВАЖНО: путь туда и путь обратно — один ответ', () => {
    for (const [a, b] of [
      [P(0, 200), P(400, 200)],
      [P(0, 0), P(400, 0)],
      [P(0, 202), P(202, 0)],
      [P(0, 200.5), P(200.5, 0)],
    ] as const) {
      expect(crossesClosedSky(sky, b, a)).toBe(crossesClosedSky(sky, a, b));
    }
  });
});

describe('closedSky — граница неба совпадает с нарисованной мозаикой', () => {
  /** Каждая граница звезды из мозаики дорог: на полшага внутрь — закрыто, наружу — открыто. */
  function agreesWithMosaic(spots: Spot[]): number {
    const sky = closedSky(mapOf(spots), data);
    const seeds = [...spots]
      .sort((p, q) => (p.id < q.id ? -1 : 1))
      .map((s) => ({ id: s.id, x: s.x, y: s.y, size: s.size ?? 1 }));
    const star = spots.find((s) => s.kind === 'star')!;
    let checked = 0;
    for (const border of mosaicBorderSegments(seeds)) {
      if (border.a !== star.id && border.b !== star.id) continue;
      const other = spots.find((s) => s.id === (border.a === star.id ? border.b : border.a))!;
      // Граница ячеек степенной диаграммы перпендикулярна линии между их центрами.
      const len = Math.hypot(star.x - other.x, star.y - other.y);
      const ux = (star.x - other.x) / len;
      const uy = (star.y - other.y) / len;
      const mx = (border.p[0] + border.q[0]) / 2;
      const my = (border.p[1] + border.q[1]) / 2;
      const inside = P(mx + ux * 0.5, my + uy * 0.5);
      const outside = P(mx - ux * 0.5, my - uy * 0.5);
      expect(crossesClosedSky(sky, inside, inside), `${other.id}: внутри`).toBe(true);
      expect(crossesClosedSky(sky, outside, outside), `${other.id}: снаружи`).toBe(false);
      checked++;
    }
    return checked;
  }

  it('звезда крупнее соседей (size 1.4) — её граница отодвинута, и небо отодвинуто так же', () => {
    expect(agreesWithMosaic(grid({ size: 1.4 }))).toBe(4);
  });

  it('звезда так велика, что веса сжаты (`clampPowerWeights`), — небо меряется по сжатым', () => {
    // 6 × 9000 − 9000 = 45000 > 0.9 × 200²: без сжатия граница ушла бы на 22 единицы.
    expect(agreesWithMosaic(grid({ size: 6 }))).toBeGreaterThanOrEqual(4);
  });
});

describe('closedSky — какие провинции закрывают небо', () => {
  it('КАРТА БЕЗ ЗАКРЫТЫХ ПРОВИНЦИЙ ничего не стоит и ничего не запрещает', () => {
    const open = grid().map(({ kind: _kind, ...s }) => ({ ...s, kind: 'nebula' }));
    const sky = closedSky(mapOf(open), data);
    expect(sky.closed).toEqual([]);
    expect(sky.sites).toEqual([]);
    expect(crossesClosedSky(sky, P(0, 200), P(400, 200))).toBe(false);
    expect(crossesClosedSky(sky, P(200, 200), P(200, 200))).toBe(false);
  });

  it('вид без описания в каталоге — открытое небо, как у обычной провинции', () => {
    const odd = grid().map((s) => (s.id === 'e' ? { ...s, kind: 'unknown_kind' } : s));
    expect(closedSky(mapOf(odd), data).closed).toEqual([]);
  });

  it('в шипнутом каталоге небо закрыто ровно у звезды, чёрной дыры и колец вокруг них', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
    const shipped = loadGameData((name) =>
      JSON.parse(readFileSync(path.join(root, 'data', name), 'utf8')),
    );
    const closed = Object.entries(shipped.sectorKinds)
      .filter(([, def]) => def.overflight === false)
      .map(([id]) => id)
      .sort();
    expect(closed).toEqual([
      'accretion_disk',
      'black_hole',
      'circumbinary_disk',
      'corona',
      'dust_shell',
      'planetary_nebula',
      'pulsar_wind',
      'star',
      'stellar_wind',
    ]);
    // Закрытое небо — у непроходимых провинций: над тем, куда флот войти может, авиация летает.
    for (const id of closed) expect(shipped.sectorKinds[id]!.traversable).toBe(false);
  });
});

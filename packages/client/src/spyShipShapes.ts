/**
 * Корабли шпионов на карте (SPM-1, заказ владельца 2026-11-20): три силуэта — «Игла», «Скат» и
 * «Жало» — в той же сетке 24×24 носом вверх, что и корпуса флотов (`shipShapes.ts`). Каждому
 * шпиону выпадает один из них случайно, но навсегда: выбор — функция хозяина, слота и
 * поколения шпиона, поэтому тот же шпион всегда на том же корабле, а замена погибшего может
 * прилететь на другом. Только геометрия: цвет, пунктир «стелс» и прозрачность задаёт вызов.
 */

export const SPY_SHIP_SHAPES = {
  needle: {
    hull: 'M12 1 14.2 9.5 20.5 18.5 15 17 13.2 22H10.8L9 17 3.5 18.5 9.8 9.5Z',
    detail: 'M12 4V19M9.8 9.5 12 12 14.2 9.5M7 15.5 12 13 17 15.5',
    engines: 'M11 21H13',
  },
  ray: {
    hull: 'M12 2.5 15.5 8.5 22 12.5 17.5 15.5 14 14.5 12.8 21H11.2L10 14.5 6.5 15.5 2 12.5 8.5 8.5Z',
    detail: 'M12 5V18M8.5 8.5 12 11 15.5 8.5M5 12.5 10 12M19 12.5 14 12',
    engines: 'M11.3 20H12.7',
  },
  sting: {
    hull: 'M9.2 1 10.6 7.5H13.4L14.8 1 16.6 9 20.5 16.5 15.2 15.2 13.6 22H10.4L8.8 15.2 3.5 16.5 7.4 9Z',
    detail: 'M10.6 7.5 12 10 13.4 7.5M12 10V19M8.8 15.2 12 13 15.2 15.2',
    engines: 'M10.8 21H13.2',
  },
} as const;

export type SpyShipId = keyof typeof SPY_SHIP_SHAPES;

const SPY_SHIP_IDS = Object.keys(SPY_SHIP_SHAPES) as SpyShipId[];

/** Корабль шпиона `id` поколения `gen` у игрока `owner`: случайный на вид, но всегда один и
 *  тот же для той же тройки (FNV-1a по строке «хозяин:слот:поколение»). */
export function spyShipOf(owner: string, id: number, gen: number): SpyShipId {
  let h = 0x811c9dc5;
  const key = `${owner}:${id}:${gen}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return SPY_SHIP_IDS[h % SPY_SHIP_IDS.length]!;
}

type ShipPaths = { hull: Path2D; detail: Path2D; engines: Path2D };
const paths = new Map<SpyShipId, ShipPaths>();

function spyShipPaths(id: SpyShipId): ShipPaths {
  let cached = paths.get(id);
  if (!cached) {
    const shape = SPY_SHIP_SHAPES[id];
    cached = {
      hull: new Path2D(shape.hull),
      detail: new Path2D(shape.detail),
      engines: new Path2D(shape.engines),
    };
    paths.set(id, cached);
  }
  return cached;
}

/** Нарисовать корабль шпиона в текущей системе координат (бокс 24×24 с центром в 12,12):
 *  пунктирный контур и бледная заливка — «стелс», чтобы его не путали с флотом. Цвет —
 *  `fillStyle`/`strokeStyle` вызова; пунктир и толщины ставит и снимает сама. */
export function drawSpyShip(g: CanvasRenderingContext2D, id: SpyShipId, detail: boolean): void {
  const p = spyShipPaths(id);
  const alpha = g.globalAlpha;
  g.lineJoin = 'round';
  g.globalAlpha = alpha * 0.22;
  g.fill(p.hull, 'evenodd');
  g.globalAlpha = alpha;
  g.lineWidth = 1.2;
  g.setLineDash([1.6, 1.1]);
  g.stroke(p.hull);
  g.setLineDash([]);
  if (!detail) return;
  g.shadowBlur = 0;
  g.lineWidth = 0.65;
  g.stroke(p.detail);
  g.lineWidth = 1.5;
  g.stroke(p.engines);
}

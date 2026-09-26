import { SWARM_SHAPES } from './swarmShapes';

/** Approved hulls, drawn from above in a 24×24 box, bow up.
 * Geometry only: SVG icons and cached Canvas paths consume the same contours.
 * Interiors are omitted at distance; the recognisable hull never becomes a triangle.
 */
export const SHIP_SHAPES = {
  fighter: {
    hull: 'M10.7 1.5 10.7 8 8.5 11 3 15.5 2 20 6.5 18.5 7 22 10 22 10.5 18 13.5 18 14 22 17 22 17.5 18.5 22 20 21 15.5 15.5 11 13.3 8 13.3 1.5 12 4Z',
    detail: 'M12 6V16M10.7 8 9 15 6.5 18.5M13.3 8 15 15 17.5 18.5M9 15H15M4 17 8 15M20 17 16 15',
    engines: 'M7.8 21H9.3M14.7 21H16.2',
  },
  scout: {
    hull: 'M12 1 14 8 14 12 18 16 18 18 16 17 16 22 13.5 22 13 19H11L10.5 22H8V17L6 18V16L10 12V8Z',
    detail: 'M12 3V9M10.5 10 12 8.5 13.5 10V14H10.5ZM12 14V19M9 15V20M15 15V20M8 14 7 12M16 14 17 12',
    engines: 'M8.5 21H10M14 21H15.5',
  },
  strikeCraft: {
    hull: 'M7 2H10V8H14V2H17L18 7 21 9V20H17V22H14V19H10V22H7V20H3V9L6 7Z',
    detail: 'M7 5V16H10M17 5V16H14M10 8 10.5 13H13.5L14 8M4.5 10V17M19.5 10V17M8 18H16',
    engines: 'M4.5 19H6M8 21H9M15 21H16M18 19H19.5',
  },
  heavyStriker: {
    hull: 'M6 2H10V7H14V2H18L19 6H22V16H21V22H17V20H15V22H9V20H7V22H3V16H2V6H5ZM4 8V14H5V8ZM19 8V14H20V8Z',
    detail: 'M7 4V16H10M17 4V16H14M10 7 11 11H13L14 7M9 13H15V17H9ZM3 7H5M19 7H21M8 18H16M4 17V20M20 17V20',
    engines: 'M3.8 21H6M9.5 21H11M13 21H14.5M18 21H20.2',
  },
  frigate: {
    hull: 'M9 1 11 2V7H13V2L15 1 16 10 15 15H17L18.5 18V22H14.5V20L12 22 9.5 20V22H5.5V18L7 15H9L8 10Z',
    detail:
      'M9 4 10 10V17M15 4 14 10V17M10 9H14M10 12H14M11 11V17H13V11M7 17H9V20M15 17H17V20M10 19H14',
    engines: 'M6.5 21H8.5M15.5 21H17.5',
  },
  picketFrigate: {
    hull: 'M9 1 11 2V7H13V2L15 1 16 9 21 7 22 8 20 11 16 13V16H18V22H14.5V20L12 22 9.5 20V22H6V16H8V13L4 11 2 8 3 7 8 9ZM9 10 6 9 7 10 9 11ZM15 10V11L17 10 18 9Z',
    detail: 'M9 4 10 8M15 4 14 8M3 8 7 11 12 12 17 11 21 8M10 13V17H14V13M12 13V18M7 17H9V20M15 17H17V20',
    engines: 'M7 21H8.5M15.5 21H17',
  },
  cruiser: {
    hull: 'M12 1 16.5 5 16.5 9 19 11 21 18 20 22H16L15 20H9L8 22H4L3 18 5 11 7.5 9 7.5 5Z',
    detail:
      'M12 3 9 6V17H15V6ZM9 8H15M10.5 10H13.5V16H10.5ZM7 11 6 18 8 20M17 11 18 18 16 20M10 18H14V21H10Z',
    engines: 'M4.5 21H7.5M10.5 21H13.5M16.5 21H19.5',
  },
  heavyCruiser: {
    hull: 'M12 1 18 5V8L21 10 23 17V22H18V20H15V23H9V20H6V22H1V17L3 10 6 8V5Z',
    detail: 'M12 3 16 6V18H8V6ZM6 9 4 12 3 18H6V20M18 9 20 12 21 18H18V20M10 6H14V9H10ZM12 4V8M9.5 12H14.5V16H9.5ZM12 10V15M9 18H15M10 19V22M14 19V22',
    engines: 'M2 21H5M10 22H14M19 21H22',
  },
  dreadnought: {
    hull: 'M2 4 7 1.5H17L22 4V8L19 9 20 13V21H16V19H14V22H10V19H8V21H4V13L5 9 2 8Z',
    detail:
      'M3.5 6H20.5M6 4H18M7 8 6 14V19M17 8 18 14V19M9 8H15V16H9ZM10.5 10H13.5V14H10.5ZM8 17H16M12 3V6',
    engines: 'M5 20H7M10.5 21H11.5M12.5 21H13.5M17 20H19',
  },
  transport: {
    hull: 'M9 2H15V5H19V8H17V10H19V13H17V15H20V22H16V19H8V22H4V15H7V13H5V10H7V8H5V5H9Z',
    detail:
      'M10 4H14V17H10ZM6 6H8V7H6ZM16 6H18V7H16ZM6 11H8V12H6ZM16 11H18V12H16ZM5 16H8V18H5ZM16 16H19V18H16ZM11 7H13M11 11H13M11 15H13',
    engines: 'M5 21H7M17 21H19',
  },
  dropship: {
    hull: 'M8 6H16V8H18V5H21V9L23 11V16H21V20H17V18H7V20H3V16H1V11L3 9V5H6V8H8ZM9 7V12H15V7Z',
    detail:
      'M8 6V14H16V6M9 9H15M9 11H15M9 15H15V17H9ZM4 7V15M6 10V16M20 7V15M18 10V16M2 12H4M20 12H22',
    engines: 'M4 18H6M18 18H20',
  },
  station: {
    hull: 'M8 1H16L18 5 22 7V17L18 19 16 23H8L6 19 2 17V7L6 5ZM8 5 5 8V16L8 19H16L19 16V8L16 5Z M9 8H15L17 12 15 16H9L7 12Z',
    detail: 'M12 1V8M12 16V23M2 7 8 10M16 14 22 17M2 17 8 14M16 10 22 7M10 10H14V14H10Z',
    engines: 'M10 12H14M12 10V14',
  },
  ...SWARM_SHAPES,
} as const;

export type ShipShapeId = keyof typeof SHIP_SHAPES;

/** Presentation aliases only; never adds a class to the gameplay roster. */
export const UNIT_SHAPE: Readonly<Record<string, ShipShapeId>> = {
  scout_drone: 'fighter',
  scout: 'scout',
  interceptor: 'fighter',
  bomber: 'strikeCraft',
  heavy_striker: 'heavyStriker',
  frigate: 'frigate',
  picket_frigate: 'picketFrigate',
  cruiser: 'cruiser',
  heavy_cruiser: 'heavyCruiser',
  siege: 'dreadnought',
  siege_lance: 'dreadnought',
  hero: 'dreadnought',
  // Owner decision 2026-09-26: the carrier and the landing ship are one hull, the
  // Carrier; the freighter is its picture and the dropship art belongs to the landing
  // shuttle alone.
  shuttle_carrier: 'transport',
  landing_shuttle: 'dropship',
};

/** Swarm appearances for the shared roster, including the units used by PvE waves.
 * An appearance does not grant harvesting, infection, spawning or other abilities.
 */
export const SWARM_UNIT_SHAPE: Readonly<Record<string, ShipShapeId>> = {
  scout_drone: 'swarmScout',
  scout: 'swarmScout',
  interceptor: 'swarmFlock',
  bomber: 'swarmFlock',
  heavy_striker: 'swarmFlock',
  frigate: 'swarmFlock',
  picket_frigate: 'swarmFlock',
  cruiser: 'swarmHunter',
  heavy_cruiser: 'swarmHunter',
  landing_shuttle: 'swarmDevourer',
  siege: 'swarmDestroyer',
  siege_lance: 'swarmDestroyer',
  shuttle_carrier: 'swarmSporeCarrier',
  swarm_brood_mother: 'swarmMatriarch',
  hero: 'swarmLeviathan',
};

type ShipPaths = { hull: Path2D; detail: Path2D; engines: Path2D };
const paths = new Map<ShipShapeId, ShipPaths>();

/** Lazy, bounded cache: no Path2D allocation in a warmed-up animation frame. */
export function shipPaths(id: ShipShapeId): ShipPaths {
  let cached = paths.get(id);
  if (!cached) {
    const shape = SHIP_SHAPES[id];
    cached = {
      hull: new Path2D(shape.hull),
      detail: new Path2D(shape.detail),
      engines: new Path2D(shape.engines),
    };
    paths.set(id, cached);
  }
  return cached;
}

/** Caller owns transform, faction colour, alpha and glow. Never reads game state. */
export function drawShipShape(g: CanvasRenderingContext2D, id: ShipShapeId, detail: boolean): void {
  const p = shipPaths(id);
  g.lineJoin = 'round';
  g.lineWidth = 1.15;
  g.fill(p.hull, 'evenodd');
  g.stroke(p.hull);
  if (!detail) return;
  // Only the exterior receives the caller's glow; interiors stay crisp at small sizes.
  g.shadowBlur = 0;
  g.lineWidth = 0.65;
  g.stroke(p.detail);
  g.lineWidth = 1.5;
  g.stroke(p.engines);
}

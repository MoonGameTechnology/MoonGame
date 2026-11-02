/** Свои активные перевозки и геометрия их световых дорожек. Только картинка. */
import type { Fleet } from '../packages/shared-core/src/index';
import type { TroopTransferKind as TransferKind } from './troopTransferTimers';

export interface TransferLink {
  target: string;
  kind: TransferKind;
}
type TransferFleet = Pick<
  Fleet,
  'owner' | 'location' | 'movement' | 'loading' | 'unloading' | 'assaultLanding'
>;

/** Один путь на флот и вид операции, независимо от числа типов перевозимых войск. */
export function activeTroopTransfers(
  f: TransferFleet,
  viewer: string,
  now: number,
): TransferLink[] {
  if (f.owner !== viewer || !f.location || f.movement) return [];
  const active = (claim: { startAt: number; doneAt: number }): boolean =>
    claim.startAt <= now && now < claim.doneAt;
  const links: TransferLink[] = [];
  if (f.loading?.some((c) => c.from === f.location && c.count > 0 && active(c))) {
    links.push({ target: f.location, kind: 'load' });
  }
  if (f.unloading?.some((c) => c.to === f.location && c.count > 0 && active(c))) {
    links.push({ target: f.location, kind: 'unload' });
  }
  if (f.assaultLanding?.planetId === f.location && active(f.assaultLanding)) {
    links.push({ target: f.location, kind: 'assault' });
  }
  return links;
}

interface Point {
  x: number;
  y: number;
}
export interface TransferArc {
  from: Point;
  control: Point;
  to: Point;
}

/** Экранные концы обрезаны до края объекта и корпуса; встречные операции — разными дугами. */
export function transferArc(planet: Point, fleet: Point, kind: TransferKind): TransferArc | null {
  const dx = fleet.x - planet.x,
    dy = fleet.y - planet.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 12) return null;
  const ux = dx / distance,
    uy = dy / distance;
  const inset = Math.min(12, distance * 0.22);
  const hold = Math.min(5, distance * 0.12);
  const surface = { x: planet.x + ux * inset, y: planet.y + uy * inset };
  const ship = { x: fleet.x - ux * hold, y: fleet.y - uy * hold };
  const bend = Math.min(18, Math.max(8, distance * 0.25)) * (kind === 'load' ? -1 : 1);
  const control = {
    x: (surface.x + ship.x) / 2 - uy * bend,
    y: (surface.y + ship.y) / 2 + ux * bend,
  };
  return kind === 'load'
    ? { from: surface, control, to: ship }
    : { from: ship, control, to: surface };
}

/** Квадратичная дуга и её касательная: капсула и короткий след смотрят по движению. */
export function transferPoint(arc: TransferArc, progress: number): Point & { angle: number } {
  const k = Math.max(0, Math.min(1, progress)),
    v = 1 - k;
  const { from: a, control: c, to: b } = arc;
  return {
    x: v * v * a.x + 2 * v * k * c.x + k * k * b.x,
    y: v * v * a.y + 2 * v * k * c.y + k * k * b.y,
    angle: Math.atan2(v * (c.y - a.y) + k * (b.y - c.y), v * (c.x - a.x) + k * (b.x - c.x)),
  };
}

/** Три капсулы за 2,6 с. При reduced motion остаются три неподвижных маркера направления. */
export function transferProgress(
  now: number,
  phase: number,
  index: number,
  moving: boolean,
  count = 3,
): number {
  if (!moving) return (index + 1) / (count + 1);
  const cycle = now / 2600 + phase + index / count;
  return cycle - Math.floor(cycle);
}

/** Province markers use only public topology; a point never grants survey knowledge. */
import type { PingAnchor } from '../../packages/client/src/multiplayer';

interface MapPoint { id: string; x: number; y: number }

export function provincePingTarget(
  id: string, identified: boolean, map: readonly MapPoint[],
): PingAnchor | null {
  if (identified) return { node: id };
  const point = map.find((node) => node.id === id);
  return point ? { point: { x: point.x, y: point.y } } : null;
}

/** The province UI can display an exact public node centre, never an invented nearest node. */
export function provinceForPing(target: PingAnchor, map: readonly MapPoint[]): string | null {
  if (target.node) return target.node;
  const point = target.point;
  return point ? map.find((node) => node.x === point.x && node.y === point.y)?.id ?? null : null;
}

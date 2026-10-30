import type { RoadPoint } from './gameState';
import { polylineLength } from './roads';

/** First arc-length fraction inside a sensor circle; null when the road misses it. */
export function sensorEntry(
  road: readonly RoadPoint[],
  center: RoadPoint,
  radius: number,
): number | null {
  const total = polylineLength(road);
  let covered = 0;
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1]!,
      b = road[i]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const x = a.x - center.x,
      y = a.y - center.y;
    const length2 = dx * dx + dy * dy;
    if (x * x + y * y <= radius * radius) return total > 0 ? covered / total : 0;
    if (length2 === 0) continue;
    const dot = x * dx + y * dy;
    const discriminant = dot * dot - length2 * (x * x + y * y - radius * radius);
    const length = Math.sqrt(length2);
    if (discriminant >= 0) {
      const t = (-dot - Math.sqrt(discriminant)) / length2;
      if (t >= 0 && t <= 1) return (covered + t * length) / total;
    }
    covered += length;
  }
  return null;
}

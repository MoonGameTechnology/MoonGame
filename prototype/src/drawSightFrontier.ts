import { rgba } from '../../packages/client/src/holoDraw';
import { frontierLook, unionArcs, type ScreenCircle, type SightTier } from './sightFrontier';

/** The same outer union minus its inset union, without a full-screen raster mask.
 * Each inverse clip removes ONE inner disc. Applying them successively intersects
 * their complements, so overlaps stay empty rather than toggling back on (which
 * one evenodd path containing all the circles would do).
 * Inputs are already viewer-owned radar sources; this paints, never grants intel.
 */
export function drawSightFrontier(
  g: CanvasRenderingContext2D,
  circles: readonly ScreenCircle[],
  tier: SightTier,
  color: string,
  width: number,
  height: number,
): void {
  const outer = unionArcs(circles, 0);
  if (!outer.length) return;
  const look = frontierLook(tier);
  const path = (): void => {
    g.beginPath();
    for (const c of outer) {
      g.moveTo(c.x + c.r, c.y);
      g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    }
  };
  g.save();
  path();
  g.fillStyle = rgba(color, look.fillAlpha);
  g.fill(); // nonzero winding merges the faint fill, with no internal seams
  for (const c of unionArcs(circles, look.lineWidth)) {
    g.beginPath();
    g.rect(-1, -1, width + 2, height + 2);
    g.moveTo(c.x + c.r, c.y);
    g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    g.clip('evenodd');
  }
  path();
  g.fillStyle = rgba(color, look.strokeAlpha);
  g.fill();
  g.restore();
}

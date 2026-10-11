import { rgba } from '../../packages/client/src/holoDraw';
import {
  frontierBox,
  frontierLook,
  frontierTiles,
  unionArcs,
  type ScreenCircle,
  type SightTier,
} from './sightFrontier';

/** The same outer union minus its inset union, without a full-screen raster mask.
 * Each inverse clip removes ONE inner disc. Applying them successively intersects
 * their complements, so overlaps stay empty rather than toggling back on (which
 * one evenodd path containing all the circles would do). The outline is drawn tile
 * by tile along the union's edge, each tile clipping only the discs that touch it:
 * the canvas masks each clip over its whole area (rule 9). `dpr` puts the tile edges
 * on whole device pixels, so no pixel is painted twice.
 * Inputs are already viewer-owned radar sources; this paints, never grants intel.
 */
export function drawSightFrontier(
  g: CanvasRenderingContext2D,
  circles: readonly ScreenCircle[],
  tier: SightTier,
  color: string,
  width: number,
  height: number,
  dpr: number,
): void {
  const outer = unionArcs(circles, 0);
  if (!outer.length || !frontierBox(outer, width, height)) return;
  const look = frontierLook(tier);
  const inner = unionArcs(circles, look.lineWidth);
  g.save();
  g.beginPath();
  for (const c of outer) {
    g.moveTo(c.x + c.r, c.y);
    g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
  }
  g.fillStyle = rgba(color, look.fillAlpha);
  g.fill(); // nonzero winding merges the faint fill, with no internal seams
  g.fillStyle = rgba(color, look.strokeAlpha);
  for (const t of frontierTiles(outer, inner, width, height, dpr)) {
    g.save();
    // The tile first: rect + disc under evenodd is their XOR, and a disc wider than
    // the tile would otherwise reopen the part of it that lies outside.
    g.beginPath();
    g.rect(t.x, t.y, t.width, t.height);
    g.clip();
    for (const i of t.cut) {
      const c = inner[i]!;
      g.beginPath();
      g.rect(t.x, t.y, t.width, t.height);
      g.moveTo(c.x + c.r, c.y);
      g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      g.clip('evenodd');
    }
    g.beginPath();
    for (const i of t.fill) {
      const c = outer[i]!;
      g.moveTo(c.x + c.r, c.y);
      g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    }
    g.fill();
    g.restore();
  }
  g.restore();
}

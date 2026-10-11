import { rgba } from '../../packages/client/src/holoDraw';
import {
  frontierLook,
  frontierOnScreen,
  unionArcs,
  unionLoops,
  type FrontierArc,
  type ScreenCircle,
  type SightTier,
} from './sightFrontier';

/** The same outer union minus its inset union, without a full-screen raster mask and
 * without clips: the band's two edges, the outer union's and the inset union's, go into
 * one path, and the even-odd fill paints exactly the band between them (rule 9). Clips
 * used to subtract the inset discs, and the canvas masks each clip over its whole area.
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
  const outer = frontierOnScreen(unionArcs(circles, 0), width, height);
  if (!outer.length) return;
  const look = frontierLook(tier);
  g.save();
  g.beginPath();
  for (const c of outer) {
    g.moveTo(c.x + c.r, c.y);
    g.arc(c.x, c.y, c.r, 0, Math.PI * 2);
  }
  g.fillStyle = rgba(color, look.fillAlpha);
  g.fill(); // nonzero winding merges the faint fill, with no internal seams
  g.beginPath();
  traceLoops(g, unionLoops(outer));
  traceLoops(g, unionLoops(unionArcs(outer, look.lineWidth)));
  g.fillStyle = rgba(color, look.strokeAlpha);
  // Two loops wind around a point of the inset union, one around a point of the band.
  g.fill('evenodd');
  g.restore();
}

function traceLoops(g: CanvasRenderingContext2D, loops: readonly FrontierArc[][]): void {
  for (const loop of loops) {
    const [a] = loop;
    if (!a) continue;
    g.moveTo(a.x + a.r * Math.cos(a.from), a.y + a.r * Math.sin(a.from));
    for (const arc of loop) g.arc(arc.x, arc.y, arc.r, arc.from, arc.to);
    g.closePath();
  }
}

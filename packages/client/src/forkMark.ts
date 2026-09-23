/**
 * Fork marks (ROADS-4), shared by both map renderers — one drawing, not two.
 *
 * A fork is the one point of a trail that sees every road of it (the ROADS-3 ambush), but
 * in the drawn road network it is only a bend, so nothing tells the player that it is a
 * PLACE one can stand at. A small diamond says it; a fleet standing on it gets a larger
 * dashed diamond in its owner's colour — the ambush, readable at a glance. Both are static:
 * no pulse, nothing to return to rest, nothing for reduced motion to switch off.
 */

/** A fork: a small filled diamond of half-diagonal `r` px, in the current fill style. */
export function drawForkMark(g: CanvasRenderingContext2D, x: number, y: number, r = 3): void {
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
  g.fill();
}

/** A fleet in ambush at a fork: a dashed diamond around it in `color`. */
export function drawAmbushMark(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  r = 15,
): void {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 1.2;
  g.setLineDash([3, 3]);
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
  g.stroke();
  g.restore();
}

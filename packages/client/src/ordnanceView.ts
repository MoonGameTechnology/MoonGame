import type { GameState } from '@void/shared-core';
import { drawMineShape } from './mineShape';

/** Input MUST be the server projection or visibleOrdnance, never unfiltered state. */
export function drawOrdnance(
  g: CanvasRenderingContext2D,
  ord: GameState['ordnance'],
  viewer: string,
  project: (p: { x: number; y: number }) => { x: number; y: number },
  scale: number,
): void {
  if (!ord) return;
  g.save();
  // Only a charge still being installed is drawn here: a standing mine (SM-3.7a) and a
  // flying missile (SM-3.7b) are fleets, drawn wherever the fleet fog lets the viewer see them.
  for (const mine of ord.installations) {
    const p = project(mine.position);
    const color = mine.owner === viewer ? '#60dbe8' : '#ffac62';
    g.save();
    g.translate(p.x, p.y);
    g.scale(0.8, 0.8);
    g.translate(-12, -12);
    g.strokeStyle = color;
    g.fillStyle = 'rgba(20,60,70,.12)';
    g.lineWidth = 1.2;
    g.setLineDash([2, 2]);
    g.shadowBlur = 0;
    drawMineShape(g, scale >= 0.9);
    g.restore();
  }
  g.restore();
}

/**
 * A flying missile (SM-3.7b) is a fleet but not a ship: an arrow along its course and a
 * dashed line to the point it flies at — no hull and no ship count. `at` and `to` are
 * screen points, `color` is its owner's; `label`, when given, is written above it.
 */
export function drawMissile(
  g: CanvasRenderingContext2D,
  at: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
  label?: string,
): void {
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 1.4;
  g.setLineDash([3, 4]);
  g.beginPath();
  g.moveTo(at.x, at.y);
  g.lineTo(to.x, to.y);
  g.stroke();
  g.setLineDash([]);
  g.translate(at.x, at.y);
  g.rotate(Math.atan2(to.y - at.y, to.x - at.x));
  g.beginPath();
  g.moveTo(9, 0);
  g.lineTo(-5, -3);
  g.lineTo(-3, 0);
  g.lineTo(-5, 3);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(-6, 0);
  g.lineTo(-13, 0);
  g.stroke();
  g.restore();
  if (label) {
    g.save();
    g.fillStyle = color;
    g.font = '11px sans-serif';
    g.textAlign = 'center';
    g.fillText(label, at.x, at.y - 14);
    g.restore();
  }
}

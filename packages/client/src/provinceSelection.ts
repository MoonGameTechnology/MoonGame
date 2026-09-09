import { rgba } from './holoDraw';

export type ProvincePolygon = ReadonlyArray<readonly [number, number]>;

/** Hit the existing convex power cell, including its edge. No new tessellation. */
export function insideProvince(poly: ProvincePolygon, x: number, y: number): boolean {
  if (poly.length < 3) return false;
  let side = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (Math.abs(cross) < 1e-7) continue;
    const sign = Math.sign(cross);
    if (side && sign !== side) return false;
    side = sign;
  }
  return side !== 0;
}

/** One brief acquisition pulse; settled and reduced-motion selections stay still. */
export function selectionPulse(elapsed: number, motion: boolean): number {
  if (!motion || elapsed < 0 || elapsed >= 650) return 0;
  return (1 - elapsed / 650) ** 2;
}

/** Trace the exact painted province beneath contacts/routes, without reading game intel. */
export function drawProvinceSelection(
  g: CanvasRenderingContext2D,
  poly: ProvincePolygon,
  pulse = 0,
  color = '#7df0d0',
): void {
  if (poly.length < 3) return;
  g.save();
  g.beginPath();
  g.moveTo(poly[0]![0], poly[0]![1]);
  for (let i = 1; i < poly.length; i++) g.lineTo(poly[i]![0], poly[i]![1]);
  g.closePath();
  g.lineJoin = 'round';
  g.fillStyle = rgba(color, 0.035 + pulse * 0.035);
  g.fill();
  // Broad low-opacity emission + a hairline retain the polygon's real silhouette.
  g.strokeStyle = rgba(color, 0.08 + pulse * 0.08);
  g.lineWidth = 4 + pulse * 3;
  g.stroke();
  g.strokeStyle = rgba(color, 0.8 + pulse * 0.18);
  g.lineWidth = 1.2 + pulse * 0.5;
  g.stroke();
  // Short illuminated ends make the corners read as a locked tactical boundary.
  g.beginPath();
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1) continue;
    const t = Math.min(0.22, 9 / length);
    g.moveTo(a[0], a[1]);
    g.lineTo(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
    g.moveTo(b[0], b[1]);
    g.lineTo(b[0] + (a[0] - b[0]) * t, b[1] + (a[1] - b[1]) * t);
  }
  g.strokeStyle = rgba('#d2fff5', 0.85);
  g.lineWidth = 1.5;
  g.stroke();
  g.restore();
}

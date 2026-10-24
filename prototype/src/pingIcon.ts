import type { PingMarkerKind } from '../../decisions/pingKind';

/** Canvas paths keep shield/sword markers legible even when the system font lacks emoji. */
export function drawTacticalPingIcon(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: Exclude<PingMarkerKind, 'mark'>,
): void {
  const points = kind === 'defend'
    ? [[0, -10], [9, -6], [7, 4], [0, 11], [-7, 4], [-9, -6]]
    : [[0, -12], [4, -7], [2, 3], [7, 3], [7, 6], [2, 6], [2, 11], [-2, 11], [-2, 6], [-7, 6], [-7, 3], [-2, 3], [-4, -7]];
  g.beginPath();
  points.forEach(([dx, dy], i) => {
    if (i === 0) g.moveTo(x + dx!, y + dy!);
    else g.lineTo(x + dx!, y + dy!);
  });
  g.closePath();
  g.fill();
  g.stroke();
}

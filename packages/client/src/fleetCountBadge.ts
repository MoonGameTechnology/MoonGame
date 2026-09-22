/** Screen-aligned, high-contrast count header shared by both map renderers. */
export function fleetCountWidth(cx: CanvasRenderingContext2D, ships: number): number {
  cx.save();
  cx.font = '700 16px ui-monospace,Menlo,monospace';
  const width = Math.max(38, cx.measureText(String(ships)).width + 28);
  cx.restore();
  return width;
}

export function drawFleetCount(
  cx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ships: number,
  color: string,
): void {
  cx.save();
  cx.globalAlpha = 1;
  const width = fleetCountWidth(cx, ships);
  cx.fillStyle = '#071720';
  cx.fillRect(x, y, width, 26);
  cx.strokeStyle = color;
  cx.lineWidth = 1;
  cx.strokeRect(x + 0.5, y + 0.5, width - 1, 25);
  cx.fillStyle = color;
  cx.fillRect(x, y, 3, 26);
  cx.textBaseline = 'middle';
  cx.textAlign = 'left';
  cx.font = '600 10px sans-serif';
  cx.fillText('▱', x + 7, y + 13);
  cx.font = '700 16px ui-monospace,Menlo,monospace';
  cx.fillStyle = '#f4f8fc';
  cx.fillText(String(ships), x + 20, y + 13);
  cx.restore();
}

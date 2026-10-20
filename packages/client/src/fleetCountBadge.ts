/** Screen-aligned, high-contrast count header shared by both map renderers. */

/** The font of the ship count. */
export const FLEET_COUNT_FONT = '700 16px ui-monospace,Menlo,monospace';

// Text widths in the count font, per context. A badge is drawn for every fleet on every
// frame, and measuring its text each time is not free: `measureText` and a font switch each
// leave an object on the browser's heap that only a major GC frees. A phone in a fast pinch
// has no idle time for one, so that garbage piles up until the WebView is killed.
const widths = new WeakMap<CanvasRenderingContext2D, Map<string, number>>();
/** Distinct texts kept per context; past it the cache starts over. */
const MAX_WIDTHS = 512;

/** Width of `text` in {@link FLEET_COUNT_FONT}, measured once per context. The context's
 *  font is left as it was. */
export function countTextWidth(cx: CanvasRenderingContext2D, text: string): number {
  let known = widths.get(cx);
  if (!known) widths.set(cx, (known = new Map()));
  let width = known.get(text);
  if (width === undefined) {
    const font = cx.font;
    cx.font = FLEET_COUNT_FONT;
    width = cx.measureText(text).width;
    cx.font = font;
    if (known.size >= MAX_WIDTHS) known.clear();
    known.set(text, width);
  }
  return width;
}

export function fleetCountWidth(cx: CanvasRenderingContext2D, ships: number): number {
  return Math.max(38, countTextWidth(cx, String(ships)) + 28);
}

/** The fleet sign before the count, ▱, as a path in the current stroke style: the glyph
 *  needs a font of its own, and a font switch per badge is heap garbage (see above).
 *  `(x, y)` is where the glyph stood: its left edge, on the count's middle line. */
export function drawFleetSign(cx: CanvasRenderingContext2D, x: number, y: number): void {
  cx.beginPath();
  cx.moveTo(x + 0.75, y + 1.75);
  cx.lineTo(x + 2.75, y - 1.25);
  cx.lineTo(x + 8.25, y - 1.25);
  cx.lineTo(x + 6.25, y + 1.75);
  cx.closePath();
  cx.stroke();
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
  drawFleetSign(cx, x + 7, y + 13);
  cx.textBaseline = 'middle';
  cx.textAlign = 'left';
  cx.font = FLEET_COUNT_FONT;
  cx.fillStyle = '#f4f8fc';
  cx.fillText(String(ships), x + 20, y + 13);
  cx.restore();
}

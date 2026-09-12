/** Screen-space layout only. No game state, targeting rules or camera mutations. */
import { isMobileViewport } from './viewport';
import {
  fitTransform,
  screenToWorld,
  worldToScreen,
  clampScale,
  type Cam,
  type Viewport,
  type Bounds,
} from '../../packages/client/src/camera';

/** A skin toggle must not teleport the selected region or reset the user's zoom. */
export function reframePresentation(
  cam: Cam,
  before: Viewport,
  after: Viewport,
  bounds: Bounds,
): Cam {
  const focus = { x: (before.left + before.right) / 2, y: (before.top + before.bottom) / 2 };
  const at = screenToWorld(focus, cam, before, bounds);
  const scale = clampScale(
    (cam.scale * fitTransform(before, bounds).scale) / fitTransform(after, bounds).scale,
  );
  const next = { ...cam, scale };
  const projected = worldToScreen(at, next, after, bounds);
  return { scale, x: next.x + focus.x - projected.x, y: next.y + focus.y - projected.y };
}

export interface HoloPoint {
  x: number;
  y: number;
}
export interface HoloRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A fine leader ends on the nearest straight side, clear of the window's corners. */
export function selectionThread(anchor: HoloPoint, box: HoloRect): { from: HoloPoint; to: HoloPoint } | null {
  const right = box.x + box.width, bottom = box.y + box.height;
  if (anchor.x >= box.x && anchor.x <= right && anchor.y >= box.y && anchor.y <= bottom) return null;
  const x = Math.max(box.x + 14, Math.min(anchor.x, right - 14));
  const y = Math.max(box.y + 14, Math.min(anchor.y, bottom - 14));
  const ends = [{ x: box.x, y }, { x: right, y }, { x, y: box.y }, { x, y: bottom }];
  const distance = (p: HoloPoint): number => Math.hypot(p.x - anchor.x, p.y - anchor.y);
  const to = ends.reduce((nearest, point) => distance(point) < distance(nearest) ? point : nearest);
  const length = distance(to);
  if (length <= 14) return null;
  return { from: { x: anchor.x + (to.x - anchor.x) * 10 / length,
    y: anchor.y + (to.y - anchor.y) * 10 / length }, to };
}

/** Place the compact command window beside the object once, without covering its marker. */
export function selectionWindowPosition(
  anchor: HoloPoint, size: { width: number; height: number },
  viewport: { width: number; height: number }, chromeBottom: number,
): HoloPoint {
  const gap = 30;
  const right = anchor.x + gap;
  const left = anchor.x - size.width - gap;
  const x = right + size.width <= viewport.width - 12 ? right : left;
  return {
    x: Math.max(12, Math.min(x, viewport.width - size.width - 12)),
    y: Math.max(12, Math.min(Math.max(chromeBottom, anchor.y - 48), viewport.height - size.height - 12)),
  };
}

/** Phones keep their existing layout, including a phone rotated into landscape. */
export function supportsHolography(width: number, height: number, coarse: boolean): boolean {
  return width > 720 && !isMobileViewport(width, height, coarse);
}

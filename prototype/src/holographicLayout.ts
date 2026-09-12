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

/** Phones keep their existing layout, including a phone rotated into landscape. */
export function supportsHolography(width: number, height: number, coarse: boolean): boolean {
  return width > 720 && !isMobileViewport(width, height, coarse);
}

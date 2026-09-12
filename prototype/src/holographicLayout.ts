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

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
const overlap = (a: HoloRect, b: HoloRect): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

export interface FleetPanelPlacement extends HoloRect {
  /** Where the short leader touches the panel; the fleet itself remains uncovered. */
  attach: HoloPoint;
  anchorVisible: boolean;
}

/** Prefer the marker's right, then left. Clamp against the actual usable viewport. */
export function placeFleetPanel(
  anchor: HoloPoint,
  size: { width: number; height: number },
  area: HoloRect,
  obstacles: readonly HoloRect[] = [],
): FleetPanelPlacement {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  const gap = 26;
  const candidates = [
    { x: anchor.x + gap, y: anchor.y - 22 },
    { x: anchor.x - gap - width, y: anchor.y - 22 },
    { x: anchor.x - width / 2, y: anchor.y + gap },
    { x: anchor.x - width / 2, y: anchor.y - gap - height },
  ].map((p) => ({
    x: clamp(p.x, area.x, area.x + area.width - width),
    y: clamp(p.y, area.y, area.y + area.height - height),
    width,
    height,
  }));
  const marker = { x: anchor.x - 18, y: anchor.y - 18, width: 36, height: 36 };
  const penalty = (r: HoloRect): number =>
    overlap(r, marker) * 100 + obstacles.reduce((sum, b) => sum + overlap(r, b), 0);
  const chosen = candidates.reduce((best, next) => (penalty(next) < penalty(best) ? next : best));
  const attach = {
    x: clamp(anchor.x, chosen.x, chosen.x + width),
    y: clamp(anchor.y, chosen.y + 16, chosen.y + height - 16),
  };
  return {
    ...chosen,
    attach,
    anchorVisible:
      anchor.x >= area.x &&
      anchor.x <= area.x + area.width &&
      anchor.y >= area.y &&
      anchor.y <= area.y + area.height,
  };
}

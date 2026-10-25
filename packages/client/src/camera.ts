/**
 * Map camera — the view transform shared by every render surface (the prototype's
 * Canvas2D map and the Stage-4 web client; docs/cross-platform-roadmap.md CP0.2 —
 * "one render implementation, not two"). Pure math: a node-graph style zoom where node
 * and label sizes stay constant in screen pixels and only positions transform.
 *
 * Framework-agnostic and side-effect-free — every function takes the viewport + map
 * bounds explicitly and returns a value (the camera is a plain `{ scale, x, y }`),
 * so it is trivially unit-tested and reused by any renderer. No DOM, no globals.
 */

/** Pan offset (screen px) over a zoom factor above the whole-map fit. */
export interface Cam {
  scale: number;
  x: number;
  y: number;
}

/** The on-screen play area (screen px): where the map is allowed to draw. */
export interface Viewport {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The map's extent in map space. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Extra pan slack per screen edge (screen px) ON TOP of PAN_SLACK — lets the camera
 *  overshoot the map border where an overlay (e.g. the open bottom-sheet panel) covers
 *  the play area, so content hidden behind it can be dragged into the clear part.
 *  `bottom` widens the UP-drag range, `right` the LEFT-drag range, etc. */
export interface EdgeSlack {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

/** Breathing room around the whole-map (scale-1) view so it reads as a framed board. */
export const FIT_MARGIN = 0.94;
/** 1 = the whole-map fit (can't zoom out past it into empty void). */
export const MIN_SCALE = 1;
/** Close enough to read one province + its neighbours on a phone. */
export const MAX_SCALE = 6;
/** Fraction of the play area you may pan past each content edge (easy edge navigation).
 *  The content edge is the outermost node, and the drawn frame sits further out: at 0.16
 *  the frame stayed under the HUD on PC (owner's ask 2026-10-24: let the camera fly a
 *  little further past the map edge). */
export const PAN_SLACK = 0.3;

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
/** Clamp a zoom factor into the allowed range. */
export const clampScale = (s: number, max = MAX_SCALE): number => clamp(s, MIN_SCALE, max);
/** Large authored boards need the same physical province detail as small maps. */
export function maxScaleForBounds(b: Bounds): number {
  const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  return MAX_SCALE * (span > 3000 ? Math.min(8, Math.ceil(span / 1600)) : 1);
}

/** The whole-map fit (map space → screen at scale 1): a UNIFORM scale (aspect preserved,
 *  so a circle stays a circle) that fits the whole map inside the play area and centres it
 *  (the spare axis gets symmetric letterbox margins). */
export function fitTransform(
  vp: Viewport,
  b: Bounds,
  margin = FIT_MARGIN,
): { scale: number; offX: number; offY: number } {
  const aw = Math.max(60, vp.right - vp.left);
  const ah = Math.max(60, vp.bottom - vp.top);
  const mapW = b.maxX - b.minX || 1;
  const mapH = b.maxY - b.minY || 1;
  const scale = Math.min(aw / mapW, ah / mapH) * margin;
  const offX = vp.left + (aw - mapW * scale) / 2;
  const offY = vp.top + (ah - mapH * scale) / 2;
  return { scale, offX, offY };
}

/** Map point → its base (scale-1) screen position, before the camera zoom/pan. */
export function projectBase(
  p: { x: number; y: number },
  vp: Viewport,
  b: Bounds,
  margin = FIT_MARGIN,
): { x: number; y: number } {
  const { scale, offX, offY } = fitTransform(vp, b, margin);
  return { x: offX + (p.x - b.minX) * scale, y: offY + (p.y - b.minY) * scale };
}

/** Map point → screen point at the current camera. */
export function worldToScreen(
  p: { x: number; y: number },
  cam: Cam,
  vp: Viewport,
  b: Bounds,
): { x: number; y: number } {
  const base = projectBase(p, vp, b);
  return { x: base.x * cam.scale + cam.x, y: base.y * cam.scale + cam.y };
}

/** `worldToScreen` as its coefficients: screen = `a`·p + (`x`, `y`). The projection is a
 *  uniform scale plus a shift, so a picture painted under one camera can be shown under
 *  another by one affine transform — this is what the cached map layer relies on. */
export function projection(cam: Cam, vp: Viewport, b: Bounds): { a: number; x: number; y: number } {
  const { scale, offX, offY } = fitTransform(vp, b);
  return {
    a: scale * cam.scale,
    x: (offX - b.minX * scale) * cam.scale + cam.x,
    y: (offY - b.minY * scale) * cam.scale + cam.y,
  };
}

/** Screen point → map point (inverse of `worldToScreen`). */
export function screenToWorld(
  pt: { x: number; y: number },
  cam: Cam,
  vp: Viewport,
  b: Bounds,
): { x: number; y: number } {
  const { scale, offX, offY } = fitTransform(vp, b);
  const baseX = (pt.x - cam.x) / cam.scale;
  const baseY = (pt.y - cam.y) / cam.scale;
  return { x: b.minX + (baseX - offX) / scale, y: b.minY + (baseY - offY) / scale };
}

/** The pan range at `scale`: the camera rests with `x` in [minX, maxX], `y` in [minY, maxY].
 *  The map fills the play area with SLACK at the edges (an edge can sit a margin inside);
 *  at the whole-map floor a smaller-than-viewport axis parks centred. Optional `extra`
 *  (EdgeSlack) widens the range past a given edge — the "panel open" overshoot — including
 *  from the parked centre, so the map can be pulled out from under an overlay even at the
 *  min-zoom fit. */
export function panRange(
  scale: number,
  vp: Viewport,
  b: Bounds,
  extra: EdgeSlack = {},
): { minX: number; maxX: number; minY: number; maxY: number } {
  const tl = projectBase({ x: b.minX, y: b.minY }, vp, b);
  const br = projectBase({ x: b.maxX, y: b.maxY }, vp, b);
  const pL = tl.x * scale;
  const pR = br.x * scale;
  const pT = tl.y * scale;
  const pB = br.y * scale;
  // Open the edge slack continuously as the map grows past the fitted axis.
  // Switching straight from a parked centre to full slack causes a visible jump.
  const mx = Math.min(
    (vp.right - vp.left) * PAN_SLACK,
    Math.max(0, pR - pL - (vp.right - vp.left)) / 2,
  );
  const my = Math.min(
    (vp.bottom - vp.top) * PAN_SLACK,
    Math.max(0, pB - pT - (vp.bottom - vp.top)) / 2,
  );
  const eL = extra.left ?? 0;
  const eR = extra.right ?? 0;
  const eT = extra.top ?? 0;
  const eB = extra.bottom ?? 0;
  // A covered right edge lets you drag further LEFT (lower x bound); a covered bottom
  // edge further UP (lower y bound) — and symmetrically for left/top overlays.
  const parkedX = (vp.left + vp.right - pL - pR) / 2;
  const [minX, maxX] =
    pR - pL >= vp.right - vp.left
      ? [vp.right - pR - mx - eR, vp.left - pL + mx + eL]
      : [parkedX - eR, parkedX + eL];
  const parkedY = (vp.top + vp.bottom - pT - pB) / 2;
  const [minY, maxY] =
    pB - pT >= vp.bottom - vp.top
      ? [vp.bottom - pB - my - eB, vp.top - pT + my + eT]
      : [parkedY - eB, parkedY + eT];
  return { minX, maxX, minY, maxY };
}

/** Bound the camera into its pan range ({@link panRange}). Returns a new camera with
 *  `scale` unchanged, `x`/`y` bounded. */
export function clampCam(cam: Cam, vp: Viewport, b: Bounds, extra: EdgeSlack = {}): Cam {
  const r = panRange(cam.scale, vp, b, extra);
  return { scale: cam.scale, x: clamp(cam.x, r.minX, r.maxX), y: clamp(cam.y, r.minY, r.maxY) };
}

/** Elastic edge (owner's ask 2026-10-25: at the map border the camera "hit a wall"). A
 *  drag past the pan range is not stopped dead: the map keeps following the finger with
 *  growing resistance, and on release it eases back ({@link settleCam}). The stretch never
 *  reaches this fraction of the play area, however far the finger goes. */
export const ELASTIC_REACH = 0.25;
/** How readily the edge gives at first: just past the range the map follows the finger at
 *  this rate, and slower the further it is stretched. */
const ELASTIC_GIVE = 0.55;
/** Time constant (ms) of the ease back into range: ~95% of the way in three of them. */
const SETTLE_MS = 70;

/** A pull `over` px past the edge → the stretch shown (asymptotic to `reach`). */
export function rubberBand(over: number, reach: number): number {
  if (over <= 0 || reach <= 0) return 0;
  return reach * (1 - 1 / ((over * ELASTIC_GIVE) / reach + 1));
}
/** The pull that shows as stretch `shown` (inverse of {@link rubberBand}). */
function unband(shown: number, reach: number): number {
  if (shown <= 0 || reach <= 0) return 0;
  const s = Math.min(shown, reach * 0.999);
  return s / (ELASTIC_GIVE * (1 - s / reach));
}
// One axis: where the finger has pulled → where the camera shows, and back.
const stretch = (raw: number, lo: number, hi: number, reach: number): number =>
  raw > hi ? hi + rubberBand(raw - hi, reach) : raw < lo ? lo - rubberBand(lo - raw, reach) : raw;
const unstretch = (shown: number, lo: number, hi: number, reach: number): number =>
  shown > hi ? hi + unband(shown - hi, reach) : shown < lo ? lo - unband(lo - shown, reach) : shown;

/** {@link clampCam} with an elastic edge: an unbounded camera (where the gesture would put
 *  it) → the one shown, stretched past the range instead of stopped at it. */
export function elasticCam(cam: Cam, vp: Viewport, b: Bounds, extra: EdgeSlack = {}): Cam {
  const r = panRange(cam.scale, vp, b, extra);
  return {
    scale: cam.scale,
    x: stretch(cam.x, r.minX, r.maxX, (vp.right - vp.left) * ELASTIC_REACH),
    y: stretch(cam.y, r.minY, r.maxY, (vp.bottom - vp.top) * ELASTIC_REACH),
  };
}

/** The pull behind a shown camera: where the gesture had put it before the elastic edge
 *  stretched it (inverse of {@link elasticCam}). A gesture that starts on a stretched
 *  camera takes this as its baseline, so it carries on from where the map is, without a
 *  jump. */
export function elasticPull(cam: Cam, vp: Viewport, b: Bounds, extra: EdgeSlack = {}): Cam {
  const r = panRange(cam.scale, vp, b, extra);
  return {
    scale: cam.scale,
    x: unstretch(cam.x, r.minX, r.maxX, (vp.right - vp.left) * ELASTIC_REACH),
    y: unstretch(cam.y, r.minY, r.maxY, (vp.bottom - vp.top) * ELASTIC_REACH),
  };
}

/** Drag the shown camera by a finger delta (dx, dy) with the elastic edge. Stateless: the
 *  pull is recovered from the camera itself ({@link elasticPull}), so a finger that grabs
 *  the map mid-ease carries on from where it is. */
export function dragCam(
  cam: Cam,
  dx: number,
  dy: number,
  vp: Viewport,
  b: Bounds,
  extra: EdgeSlack = {},
): Cam {
  const pull = elasticPull(cam, vp, b, extra);
  return elasticCam({ scale: cam.scale, x: pull.x + dx, y: pull.y + dy }, vp, b, extra);
}

/** One frame (`dtMs`) of the ease back into range after an elastic drag. Returns the next
 *  camera and whether it has arrived (then it is exactly {@link clampCam}). */
export function settleCam(
  cam: Cam,
  dtMs: number,
  vp: Viewport,
  b: Bounds,
  extra: EdgeSlack = {},
): { cam: Cam; done: boolean } {
  const to = clampCam(cam, vp, b, extra);
  const k = 1 - Math.exp(-Math.max(0, dtMs) / SETTLE_MS);
  const x = cam.x + (to.x - cam.x) * k;
  const y = cam.y + (to.y - cam.y) * k;
  if (Math.abs(to.x - x) < 0.5 && Math.abs(to.y - y) < 0.5) return { cam: to, done: true };
  return { cam: { scale: cam.scale, x, y }, done: false };
}

/** Zoom by `factor` anchored on the focal point (cursor / pinch centre): the map-space
 *  point under it stays put, so zoom grows toward where you're looking. Returns a new
 *  clamped camera. */
export function zoomAt(
  cam: Cam,
  fx: number,
  fy: number,
  factor: number,
  vp: Viewport,
  b: Bounds,
  extra: EdgeSlack = {},
): Cam {
  const bx = (fx - cam.x) / cam.scale;
  const by = (fy - cam.y) / cam.scale;
  const scale = clampScale(cam.scale * factor, maxScaleForBounds(b));
  return clampCam({ scale, x: fx - bx * scale, y: fy - by * scale }, vp, b, extra);
}

/** A whole two-finger gesture, relative to its starting camera and touch pair.
 * Clamping intermediate pointer events must never become the next zoom baseline.
 * `edge` bounds the result: the hard {@link clampCam}, or {@link elasticCam} for a
 * surface that eases the camera back after the gesture. */
export function pinchAt(
  startCam: Cam,
  start: { dist: number; mid: { x: number; y: number } },
  current: { dist: number; mid: { x: number; y: number } },
  vp: Viewport,
  b: Bounds,
  extra: EdgeSlack = {},
  edge: (cam: Cam, vp: Viewport, b: Bounds, extra: EdgeSlack) => Cam = clampCam,
): Cam {
  if (start.dist <= 0) return { ...startCam };
  const scale = clampScale(startCam.scale * (current.dist / start.dist), maxScaleForBounds(b));
  const bx = (start.mid.x - startCam.x) / startCam.scale;
  const by = (start.mid.y - startCam.y) / startCam.scale;
  return edge(
    { scale, x: current.mid.x - bx * scale, y: current.mid.y - by * scale },
    vp,
    b,
    extra,
  );
}

/** Put map-point `p` at the centre of the play area at `scale` (clamped + bounded). */
export function centerOn(
  cam: Cam,
  p: { x: number; y: number },
  scale: number,
  vp: Viewport,
  b: Bounds,
  extra: EdgeSlack = {},
): Cam {
  const s = clampScale(scale, maxScaleForBounds(b));
  const base = projectBase(p, vp, b);
  return clampCam(
    { scale: s, x: (vp.left + vp.right) / 2 - base.x * s, y: (vp.top + vp.bottom) / 2 - base.y * s },
    vp,
    b,
    extra,
  );
}

/** Is a screen point within (padded) view bounds `vw`×`vh`? Cheap viewport cull. */
export function inView(c: { x: number; y: number }, vw: number, vh: number, pad = 80): boolean {
  return c.x >= -pad && c.x <= vw + pad && c.y >= -pad && c.y <= vh + pad;
}

/**
 * Holographic draw primitives — the cyan-on-void terminal look shared by every render
 * surface (the prototype's Canvas2D map and the Stage-4 client; docs/cross-platform-roadmap.md
 * CP0.2 — "one render implementation, not two"). Stateless with respect to GAME state:
 * every function takes the target canvas context + device-pixel-ratio explicitly, so any
 * renderer can call them. The only owned state is per-colour sprite caches, keyed by dpr so
 * one module serves surfaces at different pixel ratios.
 */

import { SPHERE_FRAMES, sphereFrame, sphereWire } from './holoSphere';

const TAU = Math.PI * 2;

/** hex `#rrggbb` → `rgba()` with alpha — for tinted rings, ticks and trails. */
export function rgba(hex: string, a: number): string {
  const v = hex.replace('#', '');
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Cached radial-glow sprites: baking one soft glow disc per (colour, radius, dpr) once and
// blitting it with drawImage + globalAlpha is far cheaper than a per-node createRadialGradient
// + shadowBlur every frame, so the map glow scales to many provinces.
const glowCache = new Map<string, HTMLCanvasElement>();
function glowSprite(dpr: number, color: string, radius: number): HTMLCanvasElement {
  const rad = Math.max(4, Math.round(radius));
  const key = `${color}:${rad}:${dpr}`;
  const hit = glowCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  const px = Math.ceil(rad * 2 * dpr);
  cv.width = px;
  cv.height = px;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const grd = g.createRadialGradient(rad, rad, 0, rad, rad, rad);
  grd.addColorStop(0, rgba(color, 0.95));
  grd.addColorStop(0.5, rgba(color, 0.32));
  grd.addColorStop(1, rgba(color, 0));
  g.fillStyle = grd;
  g.fillRect(0, 0, rad * 2, rad * 2);
  glowCache.set(key, cv);
  return cv;
}

/** Blit a cached glow disc of `color` centred at (x,y), radius r, at opacity `a`. */
export function blitGlow(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  color: string,
  x: number,
  y: number,
  r: number,
  a: number,
): void {
  if (a <= 0.004) return;
  const spr = glowSprite(dpr, color, r);
  const rad = Math.max(4, Math.round(r));
  ctx.globalAlpha = Math.min(1, a);
  ctx.drawImage(spr, x - rad, y - rad, rad * 2, rad * 2);
  ctx.globalAlpha = 1;
}

// A 4×4 wireframe atlas per colour/DPR. Rotation is a source-rectangle choice, not
// hundreds of trigonometric calculations on every node every frame. The LRU bound
// also covers colour-picker changes and moving the window between density scales.
const sphereCache = new Map<string, HTMLCanvasElement>();
const SPHERE_TILE = 48;
const MAX_SPHERE_ATLASES = 16;
function sphereSprite(dpr: number, color: string): HTMLCanvasElement {
  const key = `${color}:${dpr}`;
  const hit = sphereCache.get(key);
  if (hit) {
    sphereCache.delete(key);
    sphereCache.set(key, hit);
    return hit;
  }
  const tile = Math.ceil(SPHERE_TILE * dpr);
  const rad = SPHERE_TILE / 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = tile * 4;
  const g = cv.getContext('2d') as CanvasRenderingContext2D;
  for (let frame = 0; frame < SPHERE_FRAMES; frame++) {
    g.setTransform(
      tile / SPHERE_TILE,
      0,
      0,
      tile / SPHERE_TILE,
      (frame % 4) * tile,
      Math.floor(frame / 4) * tile,
    );
    const wire = sphereWire(frame);
    for (const side of ['back', 'front'] as const) {
      g.strokeStyle = rgba(color, side === 'front' ? 0.86 : 0.2);
      g.lineWidth = side === 'front' ? 0.85 : 0.6;
      g.beginPath();
      for (const [x0, y0, x1, y1] of wire[side]) {
        g.moveTo(rad + x0 * (rad - 2), rad + y0 * (rad - 2));
        g.lineTo(rad + x1 * (rad - 2), rad + y1 * (rad - 2));
      }
      g.stroke();
    }
    g.strokeStyle = rgba(color, 0.9);
    g.lineWidth = 1.05;
    g.beginPath();
    g.arc(rad, rad, rad - 2, 0, TAU);
    g.stroke();
  }
  if (sphereCache.size >= MAX_SPHERE_ATLASES) {
    sphereCache.delete(sphereCache.keys().next().value!);
  }
  sphereCache.set(key, cv);
  return cv;
}

/** Pure vector hologram, cached at device density. Pass a paused/reduced-motion clock
 *  to freeze the same atlas frame; omitting the clock preserves a static sphere. */
export function blitSphere(
  ctx: CanvasRenderingContext2D,
  dpr: number,
  color: string,
  x: number,
  y: number,
  r: number,
  a = 1,
  timeMs = 0,
): void {
  if (a <= 0.02) return;
  const atlas = sphereSprite(dpr, color);
  const tile = atlas.width / 4;
  const frame = sphereFrame(timeMs);
  ctx.save();
  ctx.globalAlpha *= a;
  ctx.drawImage(
    atlas,
    (frame % 4) * tile,
    Math.floor(frame / 4) * tile,
    tile,
    tile,
    x - r,
    y - r,
    r * 2,
    r * 2,
  );
  ctx.restore();
}

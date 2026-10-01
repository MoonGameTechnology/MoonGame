import spaceUrl from './art/deep-space.webp';
import holographicUrl from './art/holographic-space.webp';

const skies: Partial<Record<'simple' | 'holographic', HTMLImageElement>> = {};
const preparations: Partial<Record<'simple' | 'holographic', Promise<void>>> = {};

/** Embedded artwork is decoded once; unavailable art keeps the existing flat fallback. */
export function prepareSpaceBackdrop(holographic = false): Promise<void> {
  const key = holographic ? 'holographic' : 'simple';
  if (preparations[key]) return preparations[key];
  spaceBackdropReady(holographic);
  const sky = skies[key];
  if (!sky) return Promise.resolve();
  return (preparations[key] = sky.decode().catch(() => undefined));
}

/** Lazy and optional in non-browser harnesses; a missing image leaves the dark flat fallback. */
export function spaceBackdropReady(holographic = false): boolean {
  const key = holographic ? 'holographic' : 'simple';
  let sky = skies[key];
  if (!sky && typeof Image !== 'undefined') {
    sky = new Image();
    sky.src = holographic ? holographicUrl : spaceUrl;
    skies[key] = sky;
  }
  return !!sky?.complete && sky.naturalWidth > 0;
}

/** The sky scaled to cover the viewport once and blended over the flat fill, per skin and
 *  size: a moving frame copies it instead of resampling the whole image again. */
const covers: Partial<
  Record<'simple' | 'holographic', { size: string; surface: HTMLCanvasElement }>
> = {};

function coverOf(
  key: 'simple' | 'holographic',
  sky: HTMLImageElement,
  width: number,
  height: number,
  alpha: number,
): HTMLCanvasElement | null {
  const size = `${width}x${height}`;
  const cached = covers[key];
  if (cached?.size === size) return cached.surface;
  if (typeof document === 'undefined') return null;
  let surface = cached?.surface;
  if (!surface) {
    const created = document.createElement('canvas');
    // A lost or restored context keeps the canvas but not its pixels: paint it again.
    const invalidate = (): void => {
      const entry = covers[key];
      if (entry?.surface === created) entry.size = '';
    };
    created.addEventListener?.('contextlost', invalidate);
    created.addEventListener?.('contextrestored', invalidate);
    surface = created;
  }
  surface.width = width;
  surface.height = height;
  const g = surface.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#02060b';
  g.fillRect(0, 0, width, height);
  g.globalAlpha = alpha;
  g.drawImage(sky, 0, 0, width, height);
  covers[key] = { size, surface };
  return surface;
}

/**
 * Painted under the static map. Camera parallax is bounded inside the overscan.
 *
 * With `dpr` the context must draw in CSS pixels scaled by `dpr` from the origin (the
 * map canvas does): the image is then scaled once into a cached cover and placed at a
 * whole device pixel — a copy per frame instead of a resample, at most half a pixel
 * away from the exact parallax.
 */
export function drawSpaceBackdrop(
  g: CanvasRenderingContext2D,
  width: number,
  height: number,
  panX: number,
  panY: number,
  enabled: boolean,
  holographic = false,
  dpr?: number,
): void {
  g.fillStyle = '#02060b';
  g.fillRect(0, 0, width, height);
  if (!enabled || !spaceBackdropReady(holographic)) return;
  const key = holographic ? 'holographic' : 'simple';
  const sky = skies[key]!;
  // Cover without stretching: the two skins use different native aspect ratios.
  const scale = Math.max((width + 48) / sky.naturalWidth, (height + 48) / sky.naturalHeight);
  const w = sky.naturalWidth * scale;
  const h = sky.naturalHeight * scale;
  const x = (width - w) / 2 + Math.tanh(panX / 800) * 20;
  const y = (height - h) / 2 + Math.tanh(panY / 800) * 20;
  // The distant room/space stays behind the luminous plotting plane.
  const alpha = holographic ? 0.3 : 1;
  const cover = dpr ? coverOf(key, sky, Math.ceil(w * dpr), Math.ceil(h * dpr), alpha) : null;
  g.save();
  if (cover && dpr) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(cover, Math.round(x * dpr), Math.round(y * dpr));
  } else {
    g.globalAlpha = alpha;
    g.drawImage(sky, x, y, w, h);
  }
  g.restore();
}

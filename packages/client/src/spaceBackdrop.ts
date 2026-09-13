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

/** Painted into the static map cache. Camera parallax is bounded inside the overscan. */
export function drawSpaceBackdrop(
  g: CanvasRenderingContext2D,
  width: number,
  height: number,
  panX: number,
  panY: number,
  enabled: boolean,
  holographic = false,
): void {
  g.fillStyle = '#02060b';
  g.fillRect(0, 0, width, height);
  if (!enabled || !spaceBackdropReady(holographic)) return;
  const sky = skies[holographic ? 'holographic' : 'simple']!;
  // Cover without stretching: the two skins use different native aspect ratios.
  const scale = Math.max((width + 48) / sky.naturalWidth, (height + 48) / sky.naturalHeight);
  const w = sky.naturalWidth * scale;
  const h = sky.naturalHeight * scale;
  const x = (width - w) / 2 + Math.tanh(panX / 800) * 20;
  const y = (height - h) / 2 + Math.tanh(panY / 800) * 20;
  g.save();
  // The distant room/space stays behind the luminous plotting plane.
  g.globalAlpha = holographic ? 0.3 : 1;
  g.drawImage(sky, x, y, w, h);
  g.restore();
}

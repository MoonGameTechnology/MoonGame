import spaceUrl from './art/deep-space.webp';

let sky: HTMLImageElement | undefined;

/** Lazy and optional in non-browser harnesses; a missing image leaves the dark flat fallback. */
export function spaceBackdropReady(): boolean {
  if (!sky && typeof Image !== 'undefined') {
    sky = new Image();
    sky.src = spaceUrl;
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
): void {
  g.fillStyle = '#02060b';
  g.fillRect(0, 0, width, height);
  if (!enabled || !spaceBackdropReady() || !sky) return;
  const size = Math.max(width, height) + 48;
  const x = (width - size) / 2 + Math.tanh(panX / 800) * 20;
  const y = (height - size) / 2 + Math.tanh(panY / 800) * 20;
  g.drawImage(sky, x, y, size, size);
}

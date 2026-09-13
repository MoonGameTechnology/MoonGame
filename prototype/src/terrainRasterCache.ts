/** Static terrain strokes cached at native device resolution; live glints stay vector. */
import { drawTerrainField, type TerrainField } from './holographicSurface';

const PAD = 2;
const MAX_PIXELS = 8 * 1024 * 1024; // at most 32 MiB of retained RGBA pixels
interface Entry {
  key: string;
  surface: HTMLCanvasElement;
  pixels: number;
}

function signature(field: TerrainField, dpr: number): string {
  const b = field.box;
  // Camera projection introduces roundoff at ~1e-12. Keep subpixel precision,
  // without treating a translated copy of the same province as new terrain.
  const q = (n: number): number => Math.round(n * 1e6);
  const point = (x: number, y: number): string =>
    `${q((x - b.x) / b.width)},${q((y - b.y) / b.height)}`;
  const polygon = (poly: TerrainField['poly']): string =>
    poly.map(([x, y]) => point(x, y)).join(';');
  return [
    field.kind,
    field.color,
    field.phase,
    dpr,
    q(b.width),
    q(b.height),
    polygon(field.poly),
    field.marker ? point(field.marker.x, field.marker.y) : '',
    field.asteroids?.map((r) => `${point(r.x, r.y)}:${q(r.radius)}:${polygon(r.poly)}`).join('|') ??
      '',
  ].join('/');
}

export class TerrainRasterCache {
  private entries = new Map<string, Entry>();
  private pixels = 0;
  constructor(private readonly maxPixels = MAX_PIXELS) {}

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.pixels -= entry.pixels;
    this.entries.delete(id);
    // Drop the backing allocation as well as the JS reference.
    entry.surface.width = 0;
    entry.surface.height = 0;
  }

  prepare(field: TerrainField, dpr: number): Entry | undefined {
    if (field.kind === 'planet' || field.kind === 'empty' || field.kind === 'void_station') return;
    const b = field.box;
    const width = Math.ceil((b.width + PAD * 2) * dpr);
    const height = Math.ceil((b.height + PAD * 2) * dpr);
    const pixels = width * height;
    if (pixels > this.maxPixels || width > 4096 || height > 4096) {
      return;
    }
    const key = signature(field, dpr);
    let entry = this.entries.get(field.id);
    if (entry?.key !== key) {
      this.remove(field.id);
      while (this.pixels + pixels > this.maxPixels && this.entries.size)
        this.remove(this.entries.keys().next().value!);
      const surface = document.createElement('canvas');
      surface.width = width;
      surface.height = height;
      const context = surface.getContext('2d');
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, (PAD - b.x) * dpr, (PAD - b.y) * dpr);
      drawTerrainField(context, field);
      entry = { key, surface, pixels };
      this.pixels += pixels;
    }
    this.entries.delete(field.id);
    this.entries.set(field.id, entry);
    return entry;
  }

  draw(g: CanvasRenderingContext2D, field: TerrainField, dpr: number): void {
    const entry = this.prepare(field, dpr);
    if (!entry) {
      drawTerrainField(g, field);
      return;
    }
    const b = field.box;
    g.save();
    // Terrain strokes use screen blending; preserve it against the political fill.
    g.globalCompositeOperation = 'screen';
    g.drawImage(
      entry.surface,
      b.x - PAD,
      b.y - PAD,
      entry.surface.width / dpr,
      entry.surface.height / dpr,
    );
    g.restore();
  }
}

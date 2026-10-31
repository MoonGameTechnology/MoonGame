/**
 * Static terrain strokes cached at native device resolution; live glints stay vector.
 *
 * Every environment tile also keeps a FLOOR: the same drawing at a fixed small density
 * ({@link FLOOR_DENSITY}), packed with the others into one atlas canvas and never evicted.
 * A sharp raster is evicted or not yet made more often than a player can bear on a phone: a
 * fast zoom out from a close view met hundreds of tiles whose rasters the close view had
 * pushed out, and the map showed holes in its terrain that filled a few per frame — the
 * terrain blinked. The floor stands in where no sharp raster is at hand: the terrain turns
 * soft for a moment instead of disappearing. Far out, where a sharp raster would be no larger
 * than the floor, the floor IS the raster: the whole map seen at once costs one canvas, not
 * one per tile.
 *
 * The vector work is done on the CPU: sharp rasters and the floors' scratch are
 * {@link VECTOR_CONTEXT} canvases. A GPU canvas only records the strokes, and the GPU rasterizes
 * them later, unseen by the budgets that pace the loading and the bakes: they measure the main
 * thread. A phone's GPU got seconds of clipped strokes at once (one flush of the loading took
 * 13 s on an emulated GPU), and the whole screen stood still until it drained. On the CPU the
 * cost is paid where it is measured; the GPU gets finished pixels. The atlas keeps the map's
 * own context policy: floors are blitted into it, and far out the map draws from it.
 */
import { drawTerrainField, type TerrainField } from './holographicSurface';
import { projectTerrainTile } from './terrainEnvironmentView';

/** How far a field's raster reaches past its box, CSS px: room for the strokes on its edge. */
export const TERRAIN_PAD = 2;
const PAD = TERRAIN_PAD;
// At most 24 MiB of retained RGBA pixels: a view's sharp rasters fit, and an evicted one
// leaves its floor behind, not a hole.
const MAX_PIXELS = 6 * 1024 * 1024;
/** Device pixels per world unit of a tile's floor, at most: sharp enough to serve the whole
 *  map seen at once on a phone. */
export const FLOOR_DENSITY = 0.4;
/** The floors of a whole map take about this many pixels: a huge map gets softer floors, so
 *  its whole terrain still fits one atlas (`floorDensityFor`). */
export const FLOOR_BUDGET = 2 * 1024 * 1024;
/** Tiles reach past the map's frame and overlap each other by about this share of its area. */
const TILE_OVERLAP = 1.4;
/** The floor atlas: its width, the most rows it may grow to, and the rows of its shelves. */
const ATLAS_WIDTH = 2048;
const ATLAS_MAX_HEIGHT = 2048;
const ATLAS_STEP = 256;
/** A packed atlas keeps the rows its floors take, to this step. */
const ATLAS_PACKED_STEP = 16;
/** A shelf's height is the first of these that holds the cell: about a sixth of a cell's
 *  height at most is lost, and a few shelf heights serve the whole map. */
const SHELF_HEIGHTS = [8, 12, 16, 20, 24, 28, 32, 38, 44, 52, 60, 70, 82, 96, 112, 130, 152, 176, 204, 236, 272,
  316, 366, 424, 492, 570, 660, 766, 888, 1030, 1194, 1384, 1606, 1862, 2048];
/** Free pixels between cells: a scaled draw may sample a pixel past its source rectangle. */
const GUTTER = 1;
/** The canvases the vector strokes are painted into: on the CPU, where the frame measures them. */
export const VECTOR_CONTEXT: CanvasRenderingContext2DSettings = { willReadFrequently: true };
interface Entry {
  key: string;
  surface: HTMLCanvasElement;
  pixels: number;
  width: number;
  height: number;
  fieldWidth: number;
  fieldHeight: number;
}
/** A tile's floor: its cell in the atlas and the size of its box in that drawing, CSS px. */
interface Floor {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fieldWidth: number;
  fieldHeight: number;
}
/** A raster to blit: a sharp entry, or a floor's cell of the atlas (`cell`). */
interface Raster {
  surface: HTMLCanvasElement;
  width: number;
  height: number;
  fieldWidth: number;
  fieldHeight: number;
  cell?: { x: number; y: number };
}

function signature(field: TerrainField, dpr: number): string {
  const b = field.box;
  // Camera projection introduces roundoff at ~1e-12. Keep subpixel precision,
  // without treating a translated copy of the same province as new terrain.
  const q = (n: number): number => Math.round(n * 1e6);
  // A tile fingerprint covers its world-space features AND the permitted fog mask.
  // Camera placement is not content; width/height below decide when a sharper bake is
  // needed, while gesture frames can keep the same drawing at a temporary scale.
  if (field.environment) return ['environment', field.environment.tile.fingerprint,
    dpr, q(b.width / b.height)].join('/');
  const point = (x: number, y: number): string =>
    `${q((x - b.x) / b.width)},${q((y - b.y) / b.height)}`;
  const polygon = (poly: TerrainField['poly']): string =>
    poly.map(([x, y]) => point(x, y)).join(';');
  return [
    field.kind,
    field.color,
    field.phase,
    dpr,
    q(b.width / b.height),
    polygon(field.poly),
    field.marker ? point(field.marker.x, field.marker.y) : '',
    field.asteroids?.map((r) => `${point(r.x, r.y)}:${q(r.radius / b.width)}:${polygon(r.poly)}`).join('|') ??
      '',
  ].join('/');
}

/** The floor density for a map whose frame covers `area` square world units: the most
 *  ({@link FLOOR_DENSITY}), or less, so that its whole terrain fits {@link FLOOR_BUDGET}. */
export function floorDensityFor(area: number): number {
  if (!(area > 0)) return FLOOR_DENSITY;
  return Math.min(FLOOR_DENSITY, Math.sqrt(FLOOR_BUDGET / (area * TILE_OVERLAP)));
}

/** A floor is the tile's drawing, whatever the camera: its features and permitted mask. */
function floorSignature(field: TerrainField, dpr: number, density: number): string {
  return `${field.environment!.tile.fingerprint}/${dpr}/${density}`;
}

/** The floor's cell in device pixels: the tile's world box at `density`, plus the stroke
 *  gutter every raster keeps. */
function floorSize(field: TerrainField, dpr: number, density: number): { width: number; height: number } {
  const box = field.environment!.tile.box;
  return {
    width: Math.ceil(box.width * density + PAD * 2 * dpr),
    height: Math.ceil(box.height * density + PAD * 2 * dpr),
  };
}

/** A sharp raster of `field` in device pixels; `null` — it keeps none: real worlds keep their
 *  own wire renderers, and an oversized province is painted as vector instead. */
function rasterSize(field: TerrainField, dpr: number, maxPixels: number): { width: number; height: number } | null {
  if (!field.environment && (field.kind === 'planet' || field.kind === 'empty' || field.kind === 'void_station')) return null;
  const width = Math.ceil((field.box.width + PAD * 2) * dpr);
  const height = Math.ceil((field.box.height + PAD * 2) * dpr);
  return width * height > maxPixels || width > 4096 || height > 4096 ? null : { width, height };
}

export class TerrainRasterCache {
  private entries = new Map<string, Entry>();
  private pixels = 0;
  private remaining = Infinity;
  private floors = new Map<string, Floor>();
  private atlas: HTMLCanvasElement | null = null;
  private atlasX: CanvasRenderingContext2D | null = null;
  /** Shelves of the atlas: a row of cells of one height, filled from the left. */
  private shelves: { y: number; height: number; x: number }[] = [];
  private atlasBottom = 0;
  /** Atlas pixels in cells, and in cells a current floor still uses. */
  private atlasUsed = 0;
  private atlasLive = 0;
  /** Floors the last compaction packed: a full atlas of the same floors is not packed twice. */
  private packed = -1;
  /** Device pixels per world unit of the floors ({@link floorDensityFor}). */
  private density = FLOOR_DENSITY;
  /** A floor is painted here from vector, then blitted into its cell of the atlas. */
  private scratch: HTMLCanvasElement | null = null;
  private scratchX: CanvasRenderingContext2D | null = null;
  /** Missing sharp bakes keep the stationary background invalid until completed. */
  pending = false;
  /** `atlasOptions` — the atlas's context, as the map's own canvases request theirs. */
  constructor(
    private readonly maxPixels = MAX_PIXELS,
    private readonly atlasOptions?: CanvasRenderingContext2DSettings,
  ) {}

  /** Loading can prewarm freely; interactive frames admit only a few new bakes. */
  beginFrame(maxBakes: number): void {
    this.remaining = maxBakes;
    this.pending = false;
  }

  clear(): void {
    for (const id of this.entries.keys()) this.remove(id);
    this.resetAtlas();
    for (const surface of [this.atlas, this.scratch]) {
      if (!surface) continue;
      surface.width = 0;
      surface.height = 0;
    }
    this.atlas = null;
    this.atlasX = null;
    this.scratch = null;
    this.scratchX = null;
    this.pending = false;
  }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.pixels -= entry.pixels;
    this.entries.delete(id);
    // Drop the backing allocation as well as the JS reference.
    entry.surface.width = 0;
    entry.surface.height = 0;
  }

  /** Forget every floor; the atlas keeps its allocation for the next ones. */
  private resetAtlas(): void {
    this.floors.clear();
    this.shelves = [];
    this.atlasBottom = 0;
    this.atlasUsed = 0;
    this.atlasLive = 0;
    this.packed = -1;
  }

  /** The floors' density for the map on the screen; a new one paints them all anew. */
  setFloorDensity(density: number): void {
    if (!(density > 0) || density === this.density) return;
    this.density = density;
    this.resetAtlas();
  }

  /** Far out the floor is no smaller than a sharp raster would be: it serves as one. */
  private floorServes(field: TerrainField, dpr: number): boolean {
    return !!field.environment && field.environment.projection.scale * dpr <= this.density;
  }

  /** The floor of `field`'s tile, only if it shows the tile as it is now. */
  private freshFloor(field: TerrainField, dpr: number): Floor | undefined {
    if (!field.environment) return;
    const floor = this.floors.get(field.id);
    return floor?.key === floorSignature(field, dpr, this.density) ? floor : undefined;
  }

  /** A cell for `field`'s floor, cleared: its old one if the drawing still fits there.
   *  `undefined` — the atlas is full of floors in use. */
  private floorCell(field: TerrainField, dpr: number): Floor | undefined {
    const { width, height } = floorSize(field, dpr, this.density);
    const key = floorSignature(field, dpr, this.density);
    const box = field.environment!.tile.box;
    const fieldWidth = (box.width * this.density) / dpr;
    const fieldHeight = (box.height * this.density) / dpr;
    const old = this.floors.get(field.id);
    let at: { x: number; y: number } | undefined;
    if (old && old.width >= width && old.height >= height && this.atlasX) at = old;
    else {
      if (old) this.atlasLive -= old.width * old.height;
      this.floors.delete(field.id);
      at = this.place(width, height);
      if (!at) return;
      this.atlasUsed += width * height;
      this.atlasLive += width * height;
    }
    const floor: Floor = { key, x: at.x, y: at.y, width: old && at === old ? old.width : width,
      height: old && at === old ? old.height : height, fieldWidth, fieldHeight };
    const g = this.atlasX!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(floor.x, floor.y, floor.width, floor.height);
    this.floors.set(field.id, floor);
    return floor;
  }

  /** Room for a `width × height` cell: the first shelf with room whose height wastes little,
   *  or a new shelf below; once the atlas is full of stale cells, a compaction makes room. */
  private place(width: number, height: number): { x: number; y: number } | undefined {
    if (width + GUTTER > ATLAS_WIDTH || height + GUTTER > ATLAS_MAX_HEIGHT) return;
    const at = this.placeShelf(width, height) ?? (this.compact() ? this.placeShelf(width, height) : undefined);
    return at && this.ensureAtlas(this.atlasBottom) ? at : undefined;
  }

  /** Shelf packing, no pixels moved: `undefined` — no shelf has room and none fits below. */
  private placeShelf(width: number, height: number): { x: number; y: number } | undefined {
    const rows = SHELF_HEIGHTS.find((h) => h >= height + GUTTER) ?? ATLAS_MAX_HEIGHT;
    const span = width + GUTTER;
    // Its own height first; else a taller shelf with room, not half as tall again: every
    // half-empty shelf is a strip of the atlas lost.
    let best = this.shelves.find((shelf) => shelf.height === rows && shelf.x + span <= ATLAS_WIDTH);
    for (const shelf of this.shelves)
      if (!best && shelf.height > rows && shelf.height * 2 <= rows * 3 && shelf.x + span <= ATLAS_WIDTH) best = shelf;
    if (!best) {
      if (this.atlasBottom + rows > ATLAS_MAX_HEIGHT) return;
      best = { y: this.atlasBottom, height: rows, x: 0 };
      this.shelves.push(best);
      this.atlasBottom += rows;
    }
    const at = { x: best.x, y: best.y };
    best.x += span;
    return at;
  }

  /** Pack the floors anew once their atlas wastes a fifth of its rows: on stale cells, or on
   *  shelves that filled as tiles came. The loading and the frames at rest call it when they
   *  have made the floors of the whole map. */
  packFloors(): void {
    if (this.atlasLive < this.atlasBottom * ATLAS_WIDTH * 0.8) this.compact();
  }

  /** The canvas that holds the floors, if any. */
  get floorAtlas(): HTMLCanvasElement | null {
    return this.atlas;
  }

  /** Pack the floors in use anew into an atlas of their own, tallest first, each shelf as tall
   *  as its first cell: the cells that exploration made stale are gone, and every shelf but the
   *  last is full. `false` — the same floors were packed so already. */
  private compact(): boolean {
    const old = this.atlas;
    if (!old || !this.atlasX || (this.atlasUsed <= this.atlasLive && this.floors.size === this.packed)) return false;
    const live = [...this.floors.entries()].sort((a, b) => b[1].height - a[1].height || b[1].width - a[1].width);
    this.shelves = [];
    this.atlasBottom = 0;
    this.atlasUsed = 0;
    this.atlasLive = 0;
    const moves: [Floor, { x: number; y: number }][] = [];
    let shelf: { y: number; height: number; x: number } | undefined;
    for (const [id, floor] of live) {
      const span = floor.width + GUTTER;
      if (!shelf || shelf.x + span > ATLAS_WIDTH) {
        const rows = floor.height + GUTTER;
        if (this.atlasBottom + rows > ATLAS_MAX_HEIGHT) {
          this.floors.delete(id);
          continue;
        }
        shelf = { y: this.atlasBottom, height: rows, x: 0 };
        this.shelves.push(shelf);
        this.atlasBottom += rows;
      }
      moves.push([floor, { x: shelf.x, y: shelf.y }]);
      shelf.x += span;
      this.atlasUsed += floor.width * floor.height;
      this.atlasLive += floor.width * floor.height;
    }
    // Rows for these floors only: the next ones grow it again.
    const made = this.newAtlas(Math.max(ATLAS_PACKED_STEP, Math.ceil(this.atlasBottom / ATLAS_PACKED_STEP) * ATLAS_PACKED_STEP));
    if (!made) {
      this.resetAtlas();
      return true;
    }
    for (const [floor, at] of moves) {
      made.context.drawImage(old, floor.x, floor.y, floor.width, floor.height, at.x, at.y, floor.width, floor.height);
      floor.x = at.x;
      floor.y = at.y;
    }
    this.useAtlas(made.surface, made.context);
    this.packed = this.floors.size;
    return true;
  }

  /** A blank atlas canvas `height` rows tall. */
  private newAtlas(height: number): { surface: HTMLCanvasElement; context: CanvasRenderingContext2D } | undefined {
    const surface = document.createElement('canvas');
    surface.width = ATLAS_WIDTH;
    surface.height = height;
    const context = this.atlasOptions
      ? surface.getContext('2d', this.atlasOptions)
      : surface.getContext('2d');
    if (!context) return;
    // A floor is often drawn from a sharp raster many times its size.
    context.imageSmoothingQuality = 'high';
    const lost = (): void => {
      if (this.atlas === surface) this.resetAtlas();
    };
    surface.addEventListener?.('contextlost', lost);
    surface.addEventListener?.('contextrestored', lost);
    return { surface, context };
  }

  /** Make `surface` the atlas and give the old one's pixels back. */
  private useAtlas(surface: HTMLCanvasElement, context: CanvasRenderingContext2D): void {
    const old = this.atlas;
    if (old && old !== surface) {
      old.width = 0;
      old.height = 0;
    }
    this.atlas = surface;
    this.atlasX = context;
  }

  /** The atlas, at least `rows` tall: it grows by {@link ATLAS_STEP} rows and keeps the cells
   *  it holds. A phone pays for every row it allocates, filled or not. */
  private ensureAtlas(rows: number): boolean {
    const have = this.atlas?.height ?? 0;
    if (this.atlas && this.atlasX && have >= rows) return true;
    const made = this.newAtlas(Math.min(ATLAS_MAX_HEIGHT, Math.ceil(rows / ATLAS_STEP) * ATLAS_STEP));
    if (!made) return false;
    if (this.atlas && this.atlasX && have) made.context.drawImage(this.atlas, 0, 0);
    this.useAtlas(made.surface, made.context);
    return true;
  }

  /** Paint `field`'s floor from its vector drawing, if the frame still admits a bake. Loading
   *  and the frames at rest make the floors of the whole map this way. */
  prepareFloor(field: TerrainField, dpr: number): Raster | undefined {
    if (!field.environment) return;
    const fresh = this.freshFloor(field, dpr);
    if (fresh) return this.floorRaster(fresh);
    if (this.remaining <= 0) {
      this.pending = true;
      return;
    }
    this.remaining--;
    const floor = this.floorCell(field, dpr);
    if (!floor) return;
    const g = this.scratchFor(floor.width, floor.height);
    if (!g) return;
    const scale = this.density / dpr;
    const drawn = projectTerrainTile(field.environment.tile, { scale, x: 0, y: 0 });
    const b = drawn.box;
    g.setTransform(dpr, 0, 0, dpr, (PAD - b.x) * dpr, (PAD - b.y) * dpr);
    drawTerrainField(g, drawn);
    this.atlasX!.drawImage(
      this.scratch!,
      0,
      0,
      floor.width,
      floor.height,
      floor.x,
      floor.y,
      floor.width,
      floor.height,
    );
    return this.floorRaster(floor);
  }

  /** The scratch, blank and exactly `width × height`: the cell's own size keeps every stroke
   *  inside the cell, as a clip would. */
  private scratchFor(width: number, height: number): CanvasRenderingContext2D | null {
    if (!this.scratch) {
      this.scratch = document.createElement('canvas');
      this.scratchX = this.scratch.getContext('2d', VECTOR_CONTEXT);
    }
    // A new size blanks the canvas and its state; the same size is blanked by hand.
    if (this.scratch.width !== width || this.scratch.height !== height) {
      this.scratch.width = width;
      this.scratch.height = height;
    } else if (this.scratchX) {
      this.scratchX.setTransform(1, 0, 0, 1, 0, 0);
      this.scratchX.clearRect(0, 0, width, height);
    }
    return this.scratchX;
  }

  /** The floor of `field` made from its new sharp raster: a scaled copy, no vector work. */
  private floorFrom(entry: Entry, field: TerrainField, dpr: number): void {
    const floor = this.floorCell(field, dpr);
    if (!floor) return;
    const g = this.atlasX!;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(entry.surface, PAD * dpr, PAD * dpr, entry.fieldWidth * dpr, entry.fieldHeight * dpr,
      floor.x + PAD * dpr, floor.y + PAD * dpr, floor.fieldWidth * dpr, floor.fieldHeight * dpr);
    g.restore();
  }

  private floorRaster(floor: Floor): Raster {
    return { surface: this.atlas!, width: floor.width, height: floor.height, fieldWidth: floor.fieldWidth,
      fieldHeight: floor.fieldHeight, cell: { x: floor.x, y: floor.y } };
  }

  /** Does `field`'s tile have a floor that shows it as it is now? */
  hasFloor(field: TerrainField, dpr: number): boolean {
    return !!this.freshFloor(field, dpr);
  }

  /** The pixels of the sharp raster `field` still owes at `dpr`: 0 — it is here, or none is kept. */
  owed(field: TerrainField, dpr: number): number {
    if (this.floorServes(field, dpr)) {
      if (this.freshFloor(field, dpr)) return 0;
      const size = floorSize(field, dpr, this.density);
      return size.width * size.height;
    }
    const size = rasterSize(field, dpr, this.maxPixels);
    if (!size) return 0;
    const entry = this.entries.get(field.id);
    const sharp = entry?.key === signature(field, dpr) && entry.width === size.width && entry.height === size.height;
    return sharp ? 0 : size.width * size.height;
  }

  prepare(field: TerrainField, dpr: number, reuseScale = false): Raster | undefined {
    if (this.floorServes(field, dpr)) return this.prepareFloor(field, dpr);
    const size = rasterSize(field, dpr, this.maxPixels);
    if (!size) return;
    const b = field.box;
    const { width, height } = size;
    const pixels = width * height;
    const key = signature(field, dpr);
    let entry = this.entries.get(field.id);
    const sameShape = entry?.key === key;
    const sharp = sameShape && entry?.width === width && entry.height === height;
    if (!sharp && !(sameShape && reuseScale)) {
      if (this.remaining <= 0) {
        this.pending = true;
        // Same shape can remain softly scaled during refinement. A changed
        // terrain or polygon must NEVER reuse old pixels, even for one frame.
        if (!sameShape) this.remove(field.id);
        return sameShape ? entry : undefined;
      }
      this.remaining--;
      this.remove(field.id);
      while (this.pixels + pixels > this.maxPixels && this.entries.size)
        this.remove(this.entries.keys().next().value!);
      const surface = document.createElement('canvas');
      surface.width = width;
      surface.height = height;
      const context = surface.getContext('2d', VECTOR_CONTEXT);
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, (PAD - b.x) * dpr, (PAD - b.y) * dpr);
      drawTerrainField(context, field);
      entry = { key, surface, pixels, width, height, fieldWidth: b.width, fieldHeight: b.height };
      const painted = entry;
      const invalidate = (): void => {
        painted.key = '';
      };
      surface.addEventListener?.('contextlost', invalidate);
      surface.addEventListener?.('contextrestored', invalidate);
      this.pixels += pixels;
      // The tile's floor follows its newest drawing, so an evicted tile still has one.
      if (field.environment && !this.freshFloor(field, dpr)) this.floorFrom(entry, field, dpr);
    } else if (!sharp) {
      // A gesture shows the last raster at another scale: a sharp one is still owed.
      this.pending = true;
    }
    this.entries.delete(field.id);
    this.entries.set(field.id, entry!);
    return entry;
  }

  draw(g: CanvasRenderingContext2D, field: TerrainField, dpr: number, reuseScale = false): void {
    let raster = this.prepare(field, dpr, reuseScale);
    if (!raster) {
      if (!this.pending) {
        drawTerrainField(g, field);
        return;
      }
      // No sharp raster this frame: the tile's floor stands in for it, never a hole.
      const floor = this.freshFloor(field, dpr);
      if (!floor) return;
      raster = this.floorRaster(floor);
    }
    const b = field.box;
    // Terrain strokes use screen blending; preserve it against the political fill. Set and put
    // back by hand: a save() per field leaves ~0.8 KB on the browser's heap that only a major
    // GC frees, and a gesture redraws every field on screen in each frame.
    const blend = g.globalCompositeOperation;
    g.globalCompositeOperation = 'screen';
    // Padding belongs to the source raster. Scale it with the source rectangle,
    // otherwise a zoom shifts the image relative to its exact province polygon.
    const sx = b.width / raster.fieldWidth;
    const sy = b.height / raster.fieldHeight;
    const x = b.x - PAD * sx;
    const y = b.y - PAD * sy;
    const w = (raster.width / dpr) * sx;
    const h = (raster.height / dpr) * sy;
    if (raster.cell) g.drawImage(raster.surface, raster.cell.x, raster.cell.y, raster.width, raster.height, x, y, w, h);
    else g.drawImage(raster.surface, x, y, w, h);
    g.globalCompositeOperation = blend;
  }
}

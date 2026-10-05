/**
 * Political territory layer — the weighted-Voronoi (power-diagram) province map shared by
 * every render surface (the prototype's Canvas2D map and the Stage-4 client;
 * docs/cross-platform-roadmap.md CP0.2 — "one render implementation, not two"). This is
 * the CPU-heavy, purely-geometric core of the map: given the sector centres as weighted
 * seeds and a clip polygon, it tiles the plane into province cells (a bigger `w` claims
 * more land, adjacent cells share a border), fills each cell in its owner's colour, and
 * optionally draws same-owner divisions, and keeps owner frontiers as a bright glow.
 *
 * Stateless with respect to GAME state and fog: the caller builds the seeds (already
 * projected to screen space, owner resolved as the viewer may know it) and injects the
 * colour palette, so any renderer can call it. `computePowerCells` is pure and touches no
 * canvas (unit-testable); `drawTerritory` paints those cells into a provided 2D context.
 */
import { clampPowerWeights, clipHalfPlaneTagged } from '@void/shared-core';

import { rgba } from './holoDraw';
import type { ShapePlacement } from './territoryGeometry';

// MAP-MOSAIC (M4.3): the weight clamp and the tagged clipper live in `@void/shared-core`,
// because the CORE now derives the lane graph from this very tessellation. Two copies of
// this math would mean the mosaic drawn and the mosaic travelled are different mosaics —
// the drift this brick exists to end. Re-exported so this module stays the render surface's
// single import.
export { clampPowerWeights, clipHalfPlaneTagged };

/** A sector centre as a power-diagram site: screen-space centre, weight (px²), the owner
 *  as the viewer may know it (`null` = neutral), and the sector kind (for the terrain tint). */
export interface TerritorySeed {
  x: number;
  y: number;
  w: number;
  owner: string | null;
  kind: string;
}

/** A tessellated province cell: its clipped polygon, a per-edge neighbour tag (a seed
 *  index ≥ 0, or {@link BOUNDARY} for the map edge), plus the owner/kind/seed-index. */
export interface TerritoryCell {
  poly: Array<[number, number]>;
  tags: number[];
  owner: string | null;
  kind: string;
  idx: number;
}

/** Resolves the colours the political fill/borders use — injected so the palette stays a
 *  renderer concern (the prototype's owner-relative hues, a future client's own scheme). */
export interface TerritoryPalette {
  /** Fill/border colour for an owned province (hex `#rrggbb`). */
  ownerColor: (owner: string) => string;
  /** Fill colour for a neutral (unowned) province (hex `#rrggbb`). */
  neutralFill: string;
  /** Optional terrain accent tint for a sector kind (hex `#rrggbb`), or `undefined`. */
  kindAccent: (kind: string) => string | undefined;
  /** Hide only same-owner divisions; frontiers, neutral edges and cells stay intact. */
  hideOwnedInner?: boolean;
  /** Zoom detail in [0,1]; outer political frontiers remain legible at zero. */
  provinceDetail?: number;
  /** `false` paints the cells only and leaves the borders to the caller — the living
   *  border (M2.11) strokes them every frame from {@link classifyBorders}, so baking them
   *  here as well would draw each line twice, once frozen. Default: stroke them. */
  strokeBorders?: boolean;
}

/** Sentinel edge-tag: this province edge sits on the map boundary, not a neighbour. */
export const BOUNDARY = -1;

/** Clip a convex polygon to the half-plane a*x + b*y + c ≤ 0 (Sutherland–Hodgman).
 *  Used to carve the weighted-Voronoi (power-diagram) province cells. */
export function clipHalfPlane(
  poly: Array<[number, number]>,
  a: number,
  b: number,
  c: number,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!;
    const nxt = poly[(i + 1) % poly.length]!;
    const dc = a * cur[0] + b * cur[1] + c;
    const dn = a * nxt[0] + b * nxt[1] + c;
    if (dc <= 0) out.push(cur);
    if (dc < 0 !== dn < 0) {
      const t = dc / (dc - dn);
      out.push([cur[0] + t * (nxt[0] - cur[0]), cur[1] + t * (nxt[1] - cur[1])]);
    }
  }
  return out;
}

/** Tessellate the seeds into power-diagram province cells clipped to `clip` (a convex
 *  polygon, e.g. the map-boundary rectangle). Weights are clamped internally so no cell is
 *  swallowed; the caller's seed array is NOT mutated (pure — no canvas touched). Cells with
 *  a degenerate (<3-vertex) polygon are dropped. `tags`/`idx` index into `seeds`. */
/** One seed's power-diagram cell: THE half-plane pass, shared by the full
 *  tessellation and the single-cell variant so the formula (and its clamped
 *  weights) exists in exactly one place — the two must stay bit-identical for
 *  the capture-flash overlay to line up with the baked fill. `null` when the
 *  cell degenerates (fully swallowed). */
function powerCellAt(
  seeds: TerritorySeed[],
  work: ReadonlyArray<{ x: number; y: number; w: number }>,
  clip: Array<[number, number]>,
  i: number,
): TerritoryCell | null {
  const si = work[i]!;
  let poly: Array<[number, number]> = clip.map((q) => [q[0], q[1]]);
  let tags: number[] = clip.map(() => BOUNDARY);
  for (let j = 0; j < seeds.length && poly.length >= 3; j++) {
    if (i === j) continue;
    const sj = work[j]!;
    // power-diagram half-plane: keep |x-ci|² - wi ≤ |x-cj|² - wj
    const a = 2 * (sj.x - si.x);
    const b = 2 * (sj.y - si.y);
    const cc = si.x * si.x + si.y * si.y - si.w - (sj.x * sj.x + sj.y * sj.y - sj.w);
    ({ poly, tags } = clipHalfPlaneTagged(poly, tags, a, b, cc, j));
  }
  if (poly.length < 3) return null;
  return { poly, tags, owner: seeds[i]!.owner, kind: seeds[i]!.kind, idx: i };
}

/** A pure copy of the weights, clamped so no cell is swallowed — the caller's
 *  seed array is never mutated. */
function clampedWork(seeds: TerritorySeed[]): Array<{ x: number; y: number; w: number }> {
  const work = seeds.map((s) => ({ x: s.x, y: s.y, w: s.w }));
  clampPowerWeights(work);
  return work;
}

export function computePowerCells(
  seeds: TerritorySeed[],
  clip: Array<[number, number]>,
): TerritoryCell[] {
  const work = clampedWork(seeds);
  const cells: TerritoryCell[] = [];
  for (let i = 0; i < seeds.length; i++) {
    const cell = powerCellAt(seeds, work, clip, i);
    if (cell) cells.push(cell);
  }
  return cells;
}

/** The single province cell for seed `idx` — the same power-diagram result
 *  `computePowerCells` would give for that index, but clipping only that one seed's
 *  half-planes (O(n), not O(n²)). Returns `null` if the cell is empty (fully
 *  swallowed) or `idx` is out of range. Used for the capture-flash: an animated
 *  overlay traces just the flipped province's border, so it must line up
 *  pixel-for-pixel with the static fill beneath it. */
export function computePowerCell(
  seeds: TerritorySeed[],
  clip: Array<[number, number]>,
  idx: number,
): TerritoryCell | null {
  if (idx < 0 || idx >= seeds.length) return null;
  return powerCellAt(seeds, clampedWork(seeds), clip, idx);
}

/** Points left where they are: `v·1 + 0` is `v` itself. */
const UNPLACED: ShapePlacement = { scale: 1, x: 0, y: 0 };

/** Paint the political territory map into `g`: filled province cells (owner colour, or a
 *  faint neutral wash) with a terrain accent, then classified borders — same-owner inner
 *  hairlines, neutral divisions, and glowing owner frontiers. Fog is the caller's concern
 *  (it bakes `owner` as last-known); this just draws what the seeds say. Owned land is
 *  read through a restrained tint and precise frontiers; dark space remains visible
 *  through the projection, including on dense whole-map views.
 *
 *  `place` — the cells are in a shape's local space (`territoryGeometry.ts`): every point is
 *  placed as it is traced, by `placePoly`'s own expression, so the canvas gets the very
 *  numbers a placed copy would hold, without the copy (a bake of the whole map would
 *  otherwise copy nearly every vertex of it). `view` is in the placed space. */
export function drawTerritory(
  g: CanvasRenderingContext2D,
  seeds: TerritorySeed[],
  clip: Array<[number, number]>,
  palette: TerritoryPalette,
  cells: TerritoryCell[] = computePowerCells(seeds, clip),
  view?: TerritoryView,
  place: ShapePlacement = UNPLACED,
): TerritoryCell[] {
  const detail = palette.provinceDetail ?? 1;
  const { scale, x: ox, y: oy } = place;
  const trace = (poly: Array<[number, number]>): void => {
    g.beginPath();
    g.moveTo(poly[0]![0] * scale + ox, poly[0]![1] * scale + oy);
    for (let k = 1; k < poly.length; k++)
      g.lineTo(poly[k]![0] * scale + ox, poly[k]![1] * scale + oy);
    g.closePath();
  };

  // Pass 1 — fill every province cell. Same owner ⇒ same colour, so a captured cluster
  // paints as one political field; a faint terrain tint reads through the owner fill.
  // A cell wholly outside `view` covers no pixel there: tracing it would cost path
  // building for nothing (most of a big map is off screen at a playing zoom).
  for (const cell of cells) {
    if (view && !polyMeets(cell.poly, view, 1, place)) continue;
    trace(cell.poly);
    g.fillStyle = rgba(
      cell.owner ? palette.ownerColor(cell.owner) : palette.neutralFill,
      cell.owner ? 0.075 : 0.018,
    );
    g.fill();
    const accent = detail > 0 ? palette.kindAccent(cell.kind) : undefined;
    if (accent) {
      trace(cell.poly);
      g.fillStyle = rgba(accent, (cell.owner ? 0.025 : 0.07) * detail);
      g.fill();
    }
  }

  // Pass 2 — classify every cell edge (pure, see classifyBorders), then stroke.
  if (palette.strokeBorders !== false)
    strokeBorders(
      g,
      classifyBorders(cells, seeds),
      palette,
      place === UNPLACED ? undefined : (x, y) => [x * scale + ox, y * scale + oy],
      // Pad by the widest stroke (the frontier glow) so a line along the edge survives.
      view ? (sg) => segmentMeets(sg, view, 4, place) : undefined,
    );
  return cells;
}

/** The part of the canvas a draw call is for, where the cells land (placed, if they are). */
export interface TerritoryView {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Can `poly`, placed by `at` and grown by `pad`, touch `view`? A cheap box test — never a
 *  false «no». The placement is a positive scale, so the placed box is the local one placed. */
function polyMeets(
  poly: Array<[number, number]>,
  view: TerritoryView,
  pad: number,
  at: ShapePlacement,
): boolean {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of poly) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return (
    x1 * at.scale + at.x >= view.x0 - pad &&
    x0 * at.scale + at.x <= view.x1 + pad &&
    y1 * at.scale + at.y >= view.y0 - pad &&
    y0 * at.scale + at.y <= view.y1 + pad
  );
}

function segmentMeets(
  sg: BorderSegment,
  view: TerritoryView,
  pad: number,
  at: ShapePlacement,
): boolean {
  const ax = sg[0] * at.scale + at.x;
  const ay = sg[1] * at.scale + at.y;
  const bx = sg[2] * at.scale + at.x;
  const by = sg[3] * at.scale + at.y;
  return !(
    (ax < view.x0 - pad && bx < view.x0 - pad) ||
    (ax > view.x1 + pad && bx > view.x1 + pad) ||
    (ay < view.y0 - pad && by < view.y0 - pad) ||
    (ay > view.y1 + pad && by > view.y1 + pad)
  );
}

/** Where a border point lands on the canvas. The baked map leaves points where they are;
 *  the living border (M2.11) shifts them with the clock. It must be a function of the
 *  POINT alone: two cells hand their shared border in with the same coordinates and must
 *  get the same answer back, or the line splits into two. */
export type BorderProjection = (x: number, y: number) => readonly [number, number];

/** Border runs laid out for the stroke in progress ({@link strokeBorders}): each run is its
 *  point count followed by its points, already moved. One buffer for every call, grown when
 *  a call needs more — the living border lays out thousands of points a frame, and fresh
 *  arrays for them were that frame's garbage. */
let runs = new Float64Array(4096);

function roomFor(n: number): void {
  if (n <= runs.length) return;
  const grown = new Float64Array(Math.max(n, runs.length * 2));
  grown.set(runs);
  runs = grown;
}

/**
 * Lay `segs` out as runs from `from` in {@link runs}; returns where they end. A segment that
 * begins where the kept segment before it ended continues that segment's run, so a chain of
 * cell edges becomes one polyline whose every point is moved once, where it used to be a
 * capped stroke per segment with each shared point moved twice.
 *
 * The polyline covers the same ground: its joins are round like the caps were, and a round-
 * joined polyline is exactly the union of its round-capped segments (both are the segments
 * swept by the pen's disc). A segment dropped by `keep` ends the run, so what is drawn is
 * still exactly the kept segments.
 */
function layRuns(
  segs: readonly BorderSegment[],
  at: BorderProjection | undefined,
  keep: ((seg: BorderSegment) => boolean) | undefined,
  from: number,
): number {
  let end = from;
  let head = -1; // where the open run keeps its count; -1 — no run is open
  let lastX = NaN; // the end of the last kept segment, as it came in
  let lastY = NaN;
  for (const sg of segs) {
    if (keep && !keep(sg)) {
      head = -1;
      continue;
    }
    const goesOn = head >= 0 && sg[0] === lastX && sg[1] === lastY;
    roomFor(end + (goesOn ? 2 : 5));
    const r = runs;
    if (goesOn) {
      r[head] = r[head]! + 1;
    } else {
      head = end;
      r[end++] = 2;
      if (at) {
        const [x, y] = at(sg[0], sg[1]);
        r[end++] = x;
        r[end++] = y;
      } else {
        r[end++] = sg[0];
        r[end++] = sg[1];
      }
    }
    if (at) {
      const [x, y] = at(sg[2], sg[3]);
      r[end++] = x;
      r[end++] = y;
    } else {
      r[end++] = sg[2];
      r[end++] = sg[3];
    }
    lastX = sg[2];
    lastY = sg[3];
  }
  return end;
}

/** Stroke the runs laid out in [`from`, `to`) as one path. Nothing laid out — no call at all. */
function strokeRuns(
  g: CanvasRenderingContext2D,
  from: number,
  to: number,
  style: string,
  width: number,
): void {
  if (to === from) return;
  g.strokeStyle = style;
  g.lineWidth = width;
  g.beginPath();
  for (let i = from; i < to; ) {
    const n = runs[i++]!;
    g.moveTo(runs[i]!, runs[i + 1]!);
    i += 2;
    for (let k = 1; k < n; k++, i += 2) g.lineTo(runs[i]!, runs[i + 1]!);
  }
  g.stroke();
}

/** Stroke classified borders: same-owner inner hairlines, neutral divisions and glowing
 *  owner frontiers. The political STYLES live here and only here, so the baked
 *  map and the living border cannot drift apart in colour or weight.
 *
 *  `at` moves every point (omit — they stay put), `keep` drops a segment before it costs
 *  anything (omit — all are drawn). Each class is laid out once as polylines and stroked
 *  from that (`layRuns`), so the frontier's two passes do not move the same points twice. */
export function strokeBorders(
  g: CanvasRenderingContext2D,
  borders: ClassifiedBorders,
  palette: Pick<TerritoryPalette, 'ownerColor' | 'hideOwnedInner' | 'provinceDetail'>,
  at?: BorderProjection,
  keep?: (seg: BorderSegment) => boolean,
): void {
  const detail = palette.provinceDetail ?? 1;
  const { ownedFront, ownedInner, neutralEdge } = borders;
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (!palette.hideOwnedInner && detail > 0) {
    for (const [owner, segs] of ownedInner)
      strokeRuns(g, 0, layRuns(segs, at, keep, 0), rgba(palette.ownerColor(owner), 0.3 * detail), 0.65); // inner hairlines
  }
  if (detail > 0) strokeRuns(g, 0, layRuns(neutralEdge, at, keep, 0), rgba('#5fb0c5', 0.55 * detail), 0.75);
  // Every owner's frontier is laid out before any is stroked: all the glows go under all the
  // crisp lines, so where two frontiers meet neither glow veils the other's line.
  const fronts: Array<[string, number, number]> = [];
  let laid = 0;
  for (const [owner, segs] of ownedFront) {
    const from = laid;
    laid = layRuns(segs, at, keep, from);
    fronts.push([owner, from, laid]);
  }
  for (const [owner, from, to] of fronts)
    strokeRuns(g, from, to, rgba(palette.ownerColor(owner), 0.08), 3); // restrained emission
  for (const [owner, from, to] of fronts)
    strokeRuns(g, from, to, rgba(palette.ownerColor(owner), 0.85), 1.15); // frontier crisp
  g.restore();
}

/** A cell edge as a stroke segment: [x0, y0, x1, y1]. */
export type BorderSegment = [number, number, number, number];

export interface ClassifiedBorders {
  /** Empire frontiers, per owner — the glowing outer border (each side glows). */
  ownedFront: Map<string, BorderSegment[]>;
  /** Same-owner province divisions, per owner — faint inner hairlines, deduped
   *  (`idx < t` keeps one of the two coincident edges). */
  ownedInner: Map<string, BorderSegment[]>;
  /** Neutral-vs-neutral divisions, deduped. */
  neutralEdge: BorderSegment[];
}

/** Classify every cell edge by what lies across it — the political-border logic
 *  behind {@link drawTerritory}, pure so the dedup and owner-comparison rules are
 *  unit-testable without a canvas. Same-owner borders are thin INNER hairlines
 *  (an empire stays one colour field with subtle province divisions); an
 *  owner-vs-(other owner / neutral) border is that owner's FRONTIER.
 *
 *  The map edge is NOT a province border (owner, 2026-09-24: «provinces at the map edge
 *  must not have wavy edges of their own»). There is no province across it, and the map
 *  draws its own edge — the glass rim on the holographic map, the faint frame on the flat
 *  one — so a province stroke there would be a second, separately moving line. */
export function classifyBorders(
  cells: readonly TerritoryCell[],
  seeds: readonly TerritorySeed[],
): ClassifiedBorders {
  const ownedFront = new Map<string, BorderSegment[]>();
  const ownedInner = new Map<string, BorderSegment[]>();
  const neutralEdge: BorderSegment[] = [];
  const bucket = (m: Map<string, BorderSegment[]>, key: string): BorderSegment[] => {
    let arr = m.get(key);
    if (!arr) m.set(key, (arr = []));
    return arr;
  };
  for (const cell of cells) {
    const { poly, tags, owner, idx } = cell;
    const m = poly.length;
    for (let k = 0; k < m; k++) {
      const t = tags[k]!;
      if (t === BOUNDARY) continue; // the map's own edge, see above
      const p0 = poly[k]!;
      const p1 = poly[(k + 1) % m]!;
      const seg: BorderSegment = [p0[0], p0[1], p1[0], p1[1]];
      if (owner !== null && seeds[t]!.owner === owner) {
        if (idx < t) bucket(ownedInner, owner).push(seg); // same empire, draw once
      } else if (owner !== null) {
        bucket(ownedFront, owner).push(seg); // empire frontier (each side glows)
      } else if (idx < t) {
        neutralEdge.push(seg); // neutral province division (faint, drawn once)
      }
    }
  }
  return { ownedFront, ownedInner, neutralEdge };
}

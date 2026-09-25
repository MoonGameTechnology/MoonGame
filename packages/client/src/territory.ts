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

/** Paint the political territory map into `g`: filled province cells (owner colour, or a
 *  faint neutral wash) with a terrain accent, then classified borders — same-owner inner
 *  hairlines, neutral divisions, and glowing owner frontiers. Fog is the caller's concern
 *  (it bakes `owner` as last-known); this just draws what the seeds say. Owned land is
 *  read through a restrained tint and precise frontiers; dark space remains visible
 *  through the projection, including on dense whole-map views. */
export function drawTerritory(
  g: CanvasRenderingContext2D,
  seeds: TerritorySeed[],
  clip: Array<[number, number]>,
  palette: TerritoryPalette,
  cells: TerritoryCell[] = computePowerCells(seeds, clip),
): TerritoryCell[] {
  const detail = palette.provinceDetail ?? 1;
  const trace = (poly: Array<[number, number]>): void => {
    g.beginPath();
    g.moveTo(poly[0]![0], poly[0]![1]);
    for (let k = 1; k < poly.length; k++) g.lineTo(poly[k]![0], poly[k]![1]);
    g.closePath();
  };

  // Pass 1 — fill every province cell. Same owner ⇒ same colour, so a captured cluster
  // paints as one political field; a faint terrain tint reads through the owner fill.
  for (const cell of cells) {
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
    strokeBorders(g, classifyBorders(cells, seeds), palette);
  return cells;
}

/** Where a border point lands on the canvas. The baked map leaves points where they are;
 *  the living border (M2.11) shifts them with the clock. It must be a function of the
 *  POINT alone: two cells hand their shared border in with the same coordinates and must
 *  get the same answer back, or the line splits into two. */
export type BorderProjection = (x: number, y: number) => readonly [number, number];

/** Stroke classified borders: same-owner inner hairlines, neutral divisions and glowing
 *  owner frontiers. The political STYLES live here and only here, so the baked
 *  map and the living border cannot drift apart in colour or weight.
 *
 *  `at` moves every point (omit — they stay put), `keep` drops a segment before it costs
 *  anything (omit — all are drawn). Each class is prepared once and stroked from that,
 *  so the frontier's two passes do not project the same points twice. */
export function strokeBorders(
  g: CanvasRenderingContext2D,
  borders: ClassifiedBorders,
  palette: Pick<TerritoryPalette, 'ownerColor' | 'hideOwnedInner' | 'provinceDetail'>,
  at?: BorderProjection,
  keep?: (seg: BorderSegment) => boolean,
): void {
  const detail = palette.provinceDetail ?? 1;
  const { ownedFront, ownedInner, neutralEdge } = borders;
  const prepare = (segs: BorderSegment[]): BorderSegment[] => {
    if (!at && !keep) return segs;
    const out: BorderSegment[] = [];
    for (const sg of segs) {
      if (keep && !keep(sg)) continue;
      if (!at) {
        out.push(sg);
        continue;
      }
      const [x0, y0] = at(sg[0], sg[1]);
      const [x1, y1] = at(sg[2], sg[3]);
      out.push([x0, y0, x1, y1]);
    }
    return out;
  };
  const strokeSegs = (segs: BorderSegment[], style: string, width: number): void => {
    if (segs.length === 0) return;
    g.strokeStyle = style;
    g.lineWidth = width;
    g.beginPath();
    for (const sg of segs) {
      g.moveTo(sg[0], sg[1]);
      g.lineTo(sg[2], sg[3]);
    }
    g.stroke();
  };
  g.save();
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (!palette.hideOwnedInner && detail > 0) {
    for (const [owner, segs] of ownedInner)
      strokeSegs(prepare(segs), rgba(palette.ownerColor(owner), 0.3 * detail), 0.65); // inner hairlines
  }
  // Ничейные границы приглушены (заказ владельца 2026-09-25, «прослеживается топология»):
  // сетка ячеек не должна читаться сильнее самого космоса. Границы держав — прежние.
  if (detail > 0) strokeSegs(prepare(neutralEdge), rgba('#5fb0c5', 0.3 * detail), 0.7);
  const fronts = [...ownedFront].map(([owner, segs]) => [owner, prepare(segs)] as const);
  for (const [owner, segs] of fronts)
    strokeSegs(segs, rgba(palette.ownerColor(owner), 0.08), 3); // restrained emission
  for (const [owner, segs] of fronts)
    strokeSegs(segs, rgba(palette.ownerColor(owner), 0.85), 1.15); // frontier crisp
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

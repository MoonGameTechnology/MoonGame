/**
 * Province borders at the detail the zoom can show. The wave (`territoryWave.ts`) cuts every
 * province edge into short pieces so it reads as a curve up close. Zoomed far out, the same
 * pieces are about two device pixels long and the curve between them is flatter than a pixel
 * can show, yet the living border (`livingBorder.ts`) strokes every one of them, twice (glow
 * and line), each frame the camera moves and band by band while it rests. That raster is
 * what the far zoom of a divided map pays for.
 *
 * A border drawn at tolerance `t` keeps only the points of each edge that Douglas–Peucker
 * keeps at `t`, so the line strays from the full one by no more than `t`. The recursion is
 * run once per shape, with no tolerance, and each point remembers the largest tolerance that
 * still keeps it ({@link borderWeights}); a zoom level then only filters by it
 * ({@link simplifyBorderCells}). Three rules keep it honest:
 *
 * 1. **Both sides of a border keep the SAME points.** Each province strokes the shared edge
 *    from its own side, in its own colour; a point kept on one side and dropped on the other
 *    would split the line in two. So each edge is weighed once, walked from the cell with the
 *    lower seed index, and the other cell takes the mirror of that answer. An edge whose two
 *    sides do not match point for point keeps all its points.
 * 2. **Corners stay.** A point where the neighbour changes is where two edges meet; the next
 *    edge's line starts there, so it is never dropped. Neither is a point of the map's edge.
 * 3. **Only the borders use it.** Fill, hit tests and the capture flash keep the full
 *    polygon, so a tap lands where it always did.
 */
import { BOUNDARY } from './territory';
import type { ShapeCell } from './territoryGeometry';

/** How far a simplified border may stray from the full one, in device pixels. */
export const BORDER_TOLERANCE_PX = 0.25;

/** Below this length on screen, in device pixels, the wave's pieces are worth merging. */
export const BORDER_LOD_SEGMENT_PX = 6;

/**
 * The tolerance, in local units, for borders drawn at `pxPerUnit` device pixels per local
 * unit: the largest power of two within {@link BORDER_TOLERANCE_PX}, so a zoom changes it
 * only at each doubling and a gesture reuses the same few levels. 0 — keep every point: the
 * wave's pieces (`segment` local units long) are long enough on screen that merging them
 * would save little.
 */
export function borderTolerance(pxPerUnit: number, segment: number): number {
  if (!(pxPerUnit > 0) || !(segment > 0) || segment * pxPerUnit >= BORDER_LOD_SEGMENT_PX) return 0;
  return 2 ** Math.floor(Math.log2(BORDER_TOLERANCE_PX / pxPerUnit));
}

/** A run of a cell's points facing one neighbour: from `start`, `interior` points follow it,
 *  and the next run's first point ends it. */
interface Edge {
  start: number;
  interior: number;
  tag: number;
}

/** The cell's runs of points facing one neighbour, in order (map-edge runs included). */
function edgesOf(tags: readonly number[]): Edge[] {
  const n = tags.length;
  let first = -1;
  for (let k = 0; k < n; k++) {
    if (tags[k] !== tags[(k + n - 1) % n]) {
      first = k;
      break;
    }
  }
  if (first < 0) return [];
  const edges: Edge[] = [];
  for (let k = 0; k < n;) {
    const start = (first + k) % n;
    let len = 1;
    while (k + len < n && tags[(first + k + len) % n] === tags[start]) len++;
    edges.push({ start, interior: len - 1, tag: tags[start]! });
    k += len;
  }
  return edges;
}

/** Scratch for {@link weighEdge}: the edge's points, x then y, grown when an edge outgrows it. */
let edgeXY = new Float64Array(64);
/** Scratch for {@link weighEdge}: the spans still to split, three numbers each. */
let spans = new Float64Array(96);

/**
 * Douglas–Peucker with no tolerance over the edge from `poly[start]` through its `interior`
 * points to the point after them: `out[j]` is the largest tolerance that still keeps interior
 * point `j`. A point is split off at its distance from the chord of the span it splits, and
 * never kept longer than the point that opened that span, which is what makes "kept at `t`"
 * the same as "weight above `t`".
 */
function weighEdge(
  poly: ReadonlyArray<readonly [number, number]>,
  start: number,
  interior: number,
): Float64Array {
  const n = poly.length;
  const m = interior + 2;
  if (edgeXY.length < m * 2) edgeXY = new Float64Array(m * 4);
  if (spans.length < m * 3) spans = new Float64Array(m * 6);
  const xy = edgeXY;
  for (let i = 0; i < m; i++) {
    const p = poly[(start + i) % n]!;
    xy[i * 2] = p[0];
    xy[i * 2 + 1] = p[1];
  }
  const out = new Float64Array(interior);
  // Spans [a, b] in edge positions (0 = start, m − 1 = the end), each with its cap.
  let top = 0;
  spans[top++] = 0;
  spans[top++] = m - 1;
  spans[top++] = Infinity;
  while (top) {
    const cap = spans[--top]!;
    const b = spans[--top]!;
    const a = spans[--top]!;
    if (b - a < 2) continue;
    const ax = xy[a * 2]!;
    const ay = xy[a * 2 + 1]!;
    const dx = xy[b * 2]! - ax;
    const dy = xy[b * 2 + 1]! - ay;
    const len2 = dx * dx + dy * dy;
    let worst = a + 1;
    let far = -1;
    for (let i = a + 1; i < b; i++) {
      const px = xy[i * 2]! - ax;
      const py = xy[i * 2 + 1]! - ay;
      // Distance to the chord as a segment, not a line: an edge may bulge past its ends.
      const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
      const ex = px - t * dx;
      const ey = py - t * dy;
      const d2 = ex * ex + ey * ey;
      if (d2 > far) {
        far = d2;
        worst = i;
      }
    }
    const weight = Math.min(Math.sqrt(far), cap);
    out[worst - 1] = weight;
    spans[top++] = a;
    spans[top++] = worst;
    spans[top++] = weight;
    spans[top++] = worst;
    spans[top++] = b;
    spans[top++] = weight;
  }
  return out;
}

/**
 * Each cell's points weighed for {@link simplifyBorderCells}: `weights[c][k]` is the largest
 * tolerance at which point `k` of `cells[c]` is still kept; `Infinity` for corners, the map's
 * edge and edges whose two sides do not match (rules 1 and 2).
 */
export function borderWeights(cells: readonly ShapeCell[]): Float64Array[] {
  const edges = cells.map((cell) => edgesOf(cell.tags));
  let seeds = 0;
  for (const cell of cells) seeds = Math.max(seeds, cell.idx + 1);
  for (const cell of cells) for (const t of cell.tags) seeds = Math.max(seeds, t + 1);
  const keyOf = (a: number, b: number): number => (a < b ? a * seeds + b : b * seeds + a);
  // Rule 1: a border is weighed only when each of its cells faces the other along exactly one
  // edge, with as many points. `sides` counts them: [low, high, low points, high points].
  const sides = new Map<number, [number, number, number, number]>();
  cells.forEach((cell, c) => {
    for (const e of edges[c]!) {
      if (e.tag === BOUNDARY || e.tag === cell.idx) continue;
      const key = keyOf(cell.idx, e.tag);
      let side = sides.get(key);
      if (!side) sides.set(key, (side = [0, 0, -1, -1]));
      const low = cell.idx < e.tag ? 0 : 1;
      side[low]++;
      side[low + 2] = e.interior;
    }
  });
  const answers = new Map<number, Float64Array>();
  cells.forEach((cell, c) => {
    for (const e of edges[c]!) {
      if (e.interior === 0 || e.tag === BOUNDARY || !(cell.idx < e.tag)) continue;
      const key = keyOf(cell.idx, e.tag);
      const side = sides.get(key)!;
      if (side[0] !== 1 || side[1] !== 1 || side[2] !== side[3]) continue;
      answers.set(key, weighEdge(cell.poly, e.start, e.interior));
    }
  });
  return cells.map((cell, c) => {
    const n = cell.poly.length;
    const weights = new Float64Array(n).fill(Infinity);
    for (const e of edges[c]!) {
      if (e.interior === 0 || e.tag === BOUNDARY || e.tag === cell.idx) continue;
      const answer = answers.get(keyOf(cell.idx, e.tag));
      if (!answer) continue;
      const low = cell.idx < e.tag;
      for (let j = 0; j < e.interior; j++)
        weights[(e.start + 1 + j) % n] = answer[low ? j : e.interior - 1 - j]!;
    }
    return weights;
  });
}

/**
 * The cells with the points their borders can spare at `tolerance` (local units) dropped:
 * each border strays from its full line by no more than `tolerance`, and the two cells of a
 * border keep the same points (rule 1). `weights` — {@link borderWeights} of these cells.
 * Each kept point keeps its tag; a cell that loses no point is returned as it was, and
 * `tolerance` ≤ 0 returns the cells themselves.
 */
export function simplifyBorderCells(
  cells: readonly ShapeCell[],
  weights: readonly Float64Array[],
  tolerance: number,
): ShapeCell[] {
  if (!(tolerance > 0)) return cells as ShapeCell[];
  return cells.map((cell, c) => {
    const w = weights[c]!;
    let dropped = 0;
    for (let k = 0; k < w.length; k++) if (!(w[k]! > tolerance)) dropped++;
    if (!dropped) return cell;
    const poly: Array<[number, number]> = [];
    const tags: number[] = [];
    for (let k = 0; k < w.length; k++) {
      if (!(w[k]! > tolerance)) continue;
      poly.push(cell.poly[k]!);
      tags.push(cell.tags[k]!);
    }
    return { poly, tags, idx: cell.idx };
  });
}

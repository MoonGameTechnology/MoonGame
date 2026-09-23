/**
 * Mosaic adjacency — who borders whom (map-roadmap.md §0, M4.3).
 *
 * The map is a province mosaic (Bytro-style), and in a mosaic **adjacency IS the shared
 * border**: the player reads "I can go there" off the fill, not off a line. For as long
 * as `paths` was authored by hand next to a mosaic drawn from coordinates, those were two
 * independent graphs — and they disagreed on every shipped map (20 borders promised a
 * passage that did not exist). This module removes the second graph: the border list is
 * DERIVED from the same power diagram the renderer draws, so the two cannot drift.
 *
 * What the world then explains, in order:
 *
 * 1. **Geometry proposes.** Two provinces border each other when their power-diagram
 *    cells share an edge. Position and `size` are the author's only levers — a bigger
 *    world pushes its borders out and gains neighbours.
 * 2. **Terrain disposes.** A region admits only so many approaches (`maxLinks`); the
 *    surplus borders are SEALED. A sealed border still exists and is still drawn — it is
 *    shut, not absent, which is the whole point: the mosaic stops lying.
 * 3. **An impassable kind seals everything.** A rift is a hole in the map, so it admits
 *    zero approaches — the same rule as (2) with a budget of 0, rather than a separate
 *    mechanism (this is what `E_IMPASSABLE_HAS_LANE` asked for, now enforced by
 *    construction instead of by an after-the-fact check).
 *
 * Pure and deterministic: same sectors → same borders → same seals. Only `+ - * /` and
 * `Math.sqrt`, all IEEE-754-exact, so the derivation is stable across machines (no
 * `Math.hypot`, whose result is not bit-specified).
 */

/** A province centre as a power-diagram site, in WORLD units. */
export interface MosaicSeed {
  id: string;
  x: number;
  y: number;
  /** Relative world size (`Planet.size`, default 1) — drives how much land it claims. */
  size: number;
}

/** A shared border between two provinces. `a < b` (canonical), `length` in world units. */
export interface MosaicBorder {
  a: string;
  b: string;
  length: number;
}

/** Weight multiplier: a world's `size` → area in world units². Shared with the renderer
 *  (`prototype/src/provinceMap.ts`), because a power diagram's SHAPE depends on weights
 *  being in the same units as distance² — a second copy of this number would silently
 *  draw a different mosaic than the one the rules are derived from. */
export const SEED_WEIGHT = 9000;

/** Frame padding around the province bounding box: a share of the width, floored. */
export const CLIP_PAD_RATIO = 0.05;
export const CLIP_PAD_MIN = 40;

/**
 * Shortest edge still counted as a border, in world units.
 *
 * Two cells can meet along a hairline — a contact of a fraction of a unit, produced by
 * the last bits of a division rather than by anything the author placed. Counting those
 * would make a lane appear or vanish under a rounding change, and they are invisible on
 * screen anyway. 24 units is roughly a tenth of the closest sector spacing on the shipped
 * maps (~200): far below any border a hand-placed map means to have, far above the
 * numerical noise floor. This threshold is a GAME RULE, not a tolerance — it decides
 * whether a passage exists — so it is pinned by a golden test.
 */
export const MIN_BORDER = 24;

/** Sentinel edge tag: this edge sits on the map frame, not on a neighbour. */
export const BOUNDARY = -1;

/**
 * Cap the spread of power-diagram weights so no cell is ever swallowed by a heavier
 * neighbour. A site keeps a non-empty cell iff `w_j - w_i ≤ d_ij²` for every other site
 * `j`; the binding case is the closest pair, so capping the total weight RANGE strictly
 * below the minimum squared inter-seed distance keeps EVERY cell non-empty. Size ordering
 * survives — a bigger world still claims a little more land, just never enough to erase a
 * close neighbour. Mutates `w` in place; a no-op for <2 seeds or coincident points.
 *
 * This lives HERE, next to the derivation, because the renderer applies it too: were the
 * two to hold different copies, the mosaic drawn and the mosaic the lanes are derived from
 * would be different mosaics — the exact drift M4.3 exists to end. Scale-invariant (both
 * `w` and `d²` scale by k²), so the screen-space renderer and world-space core agree.
 */
export function clampPowerWeights(seeds: Array<{ x: number; y: number; w: number }>): void {
  const n = seeds.length;
  if (n < 2) return;
  let minD2 = Infinity;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = seeds[i]!.x - seeds[j]!.x;
      const dy = seeds[i]!.y - seeds[j]!.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD2) minD2 = d2;
    }
  }
  if (!Number.isFinite(minD2) || minD2 <= 0) return;
  let wmin = Infinity;
  let wmax = -Infinity;
  for (const s of seeds) {
    if (s.w < wmin) wmin = s.w;
    if (s.w > wmax) wmax = s.w;
  }
  const range = wmax - wmin;
  const cap = minD2 * 0.9; // strictly below the swallow threshold (d_ij² ≥ minD2 for all pairs)
  if (range <= cap || range <= 0) return;
  const k = cap / range;
  for (const s of seeds) s.w = wmin + (s.w - wmin) * k;
}

/**
 * Clip a convex polygon to the half-plane `a*x + b*y + c ≤ 0` (Sutherland–Hodgman),
 * carrying a per-edge tag so the caller can tell WHAT lies across each edge. `tags[k]`
 * belongs to the edge `poly[k] → poly[k+1]`: the newly-cut edge along the clip line gets
 * `clipTag`, surviving original edges keep theirs.
 */
export function clipHalfPlaneTagged(
  poly: ReadonlyArray<readonly [number, number]>,
  tags: readonly number[],
  a: number,
  b: number,
  c: number,
  clipTag: number,
): { poly: Array<[number, number]>; tags: number[] } {
  const out: Array<[number, number]> = [];
  const outT: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i]!;
    const nxt = poly[(i + 1) % poly.length]!;
    const t = tags[i]!;
    const dc = a * cur[0] + b * cur[1] + c;
    const dn = a * nxt[0] + b * nxt[1] + c;
    const inC = dc <= 0;
    const inN = dn <= 0;
    if (inC) {
      out.push([cur[0], cur[1]]);
      outT.push(t);
    }
    if (inC !== inN) {
      const s = dc / (dc - dn);
      out.push([cur[0] + s * (nxt[0] - cur[0]), cur[1] + s * (nxt[1] - cur[1])]);
      outT.push(inC ? clipTag : t);
    }
  }
  return { poly: out, tags: outT };
}

/** The clip frame: the province bounding box plus padding, in world units. Outside it the
 *  map simply ends — without a frame the outermost cells run to infinity and every pair of
 *  them would "border" each other out in the void. */
export function mosaicFrame(seeds: readonly MosaicSeed[]): {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
} {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const s of seeds) {
    if (s.x < x0) x0 = s.x;
    if (s.x > x1) x1 = s.x;
    if (s.y < y0) y0 = s.y;
    if (s.y > y1) y1 = s.y;
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  const pad = Math.max(CLIP_PAD_MIN, (x1 - x0) * CLIP_PAD_RATIO);
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/** One province's cell from already-clamped sites: the clipped polygon plus, per edge,
 *  the neighbour index (≥0) or {@link BOUNDARY}. */
function cellOf(
  sites: ReadonlyArray<{ x: number; y: number; w: number }>,
  frame: { x0: number; y0: number; x1: number; y1: number },
  i: number,
): { poly: Array<[number, number]>; tags: number[] } {
  let poly: Array<[number, number]> = [
    [frame.x0, frame.y0],
    [frame.x1, frame.y0],
    [frame.x1, frame.y1],
    [frame.x0, frame.y1],
  ];
  let tags: number[] = [BOUNDARY, BOUNDARY, BOUNDARY, BOUNDARY];
  const si = sites[i]!;
  const wi = si.w;
  for (let j = 0; j < sites.length; j++) {
    if (j === i) continue;
    const sj = sites[j]!;
    const wj = sj.w;
    // |p-si|² - wi ≤ |p-sj|² - wj  ⇔  2(sj-si)·p + (|si|²-|sj|²) + (wj-wi) ≤ 0
    const a = 2 * (sj.x - si.x);
    const b = 2 * (sj.y - si.y);
    const c = si.x * si.x + si.y * si.y - (sj.x * sj.x + sj.y * sj.y) + (wj - wi);
    const next = clipHalfPlaneTagged(poly, tags, a, b, c, j);
    poly = next.poly;
    tags = next.tags;
    if (poly.length === 0) break;
  }
  return { poly, tags };
}

/** A shared border WITH its geometry: the edge itself, as the cell that measured it
 *  longest drew it. Roads (`roads.ts`) need the edge, not just its length — the road
 *  crosses into the neighbour somewhere ON it. */
export interface MosaicBorderSegment extends MosaicBorder {
  p: [number, number];
  q: [number, number];
}

/**
 * Every shared border of the mosaic, canonical and sorted (so the derivation is
 * JSON-stable). A pair is collected from BOTH cells and deduplicated: along a thin
 * contact the edge can survive in one cell and be clipped away in the other, and taking
 * only one side would silently drop that border.
 */
export function mosaicBorders(seeds: readonly MosaicSeed[]): MosaicBorder[] {
  return mosaicBorderSegments(seeds).map(({ a, b, length }) => ({ a, b, length }));
}

/** {@link mosaicBorders} with each border's edge kept — the ONE loop both read, so the
 *  borders a lane is derived from and the edge its road crosses cannot disagree. */
export function mosaicBorderSegments(seeds: readonly MosaicSeed[]): MosaicBorderSegment[] {
  const longest = new Map<string, { length: number; p: [number, number]; q: [number, number] }>();
  const frame = mosaicFrame(seeds);
  const sites = seeds.map((s) => ({ x: s.x, y: s.y, w: s.size * SEED_WEIGHT }));
  clampPowerWeights(sites); // same capping the renderer applies — one mosaic, not two
  for (let i = 0; i < seeds.length; i++) {
    const cell = cellOf(sites, frame, i);
    for (let k = 0; k < cell.poly.length; k++) {
      const t = cell.tags[k]!;
      if (t < 0) continue;
      const p = cell.poly[k]!;
      const q = cell.poly[(k + 1) % cell.poly.length]!;
      const dx = q[0] - p[0];
      const dy = q[1] - p[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      const ida = seeds[i]!.id;
      const idb = seeds[t]!.id;
      const key = ida < idb ? `${ida}|${idb}` : `${idb}|${ida}`;
      // Both sides measure the same edge; keep the longer reading so a border is never
      // lost to the side that clipped it shorter.
      if (len > (longest.get(key)?.length ?? 0)) {
        longest.set(key, { length: len, p: [p[0], p[1]], q: [q[0], q[1]] });
      }
    }
  }
  const out: MosaicBorderSegment[] = [];
  for (const [key, edge] of longest) {
    if (edge.length < MIN_BORDER) continue;
    const [a, b] = key.split('|') as [string, string];
    out.push({ a, b, length: edge.length, p: edge.p, q: edge.q });
  }
  out.sort((p, q) => (p.a === q.a ? (p.b < q.b ? -1 : 1) : p.a < q.a ? -1 : 1));
  return out;
}

/** Result of applying terrain budgets to the derived borders. */
export interface SealPlan {
  /** Borders that stay open — the province's actual lanes, canonical and sorted. */
  open: MosaicBorder[];
  /** Borders terrain shut. Still real borders; drawn as barriers, impassable to fleets. */
  sealed: MosaicBorder[];
  /** Provinces still over budget after sealing everything that could be sealed without
   *  cutting the map in two — the author has to move dots, so this is reported, not
   *  silently accepted. */
  overBudget: string[];
}

/**
 * Decide which borders terrain keeps shut (M2.4's link budget, re-expressed).
 *
 * The rule the world tells: **a region closes its thinnest contacts first.** A hairline
 * where two cells barely graze each other is a scrape, not a corridor; the wide frontage
 * is what a fleet would actually use. So while some province carries more borders than
 * its terrain admits, the worst-over-budget province seals its shortest remaining border
 * — never one whose loss would cut the map in two, because a sealed border must be a
 * closed door, not an exiled province.
 *
 * Deterministic throughout: provinces are picked by (overrun desc, id asc) and borders by
 * (length asc, pair asc), so the same map always yields the same seals.
 */
export function sealPlan(
  borders: readonly MosaicBorder[],
  budgetOf: (id: string) => number,
  ids: readonly string[],
): SealPlan {
  const keyOf = (b: MosaicBorder): string => `${b.a}|${b.b}`;
  const sealed = new Set<string>();
  const openOf = (): MosaicBorder[] => borders.filter((b) => !sealed.has(keyOf(b)));

  const connected = (edges: readonly MosaicBorder[], drop: string | null): boolean => {
    const reach = ids.filter((id) => budgetOf(id) > 0); // a rift is a hole, not a province
    if (reach.length < 2) return true;
    const adj = new Map<string, string[]>(reach.map((id) => [id, []]));
    for (const e of edges) {
      if (keyOf(e) === drop) continue;
      if (!adj.has(e.a) || !adj.has(e.b)) continue;
      adj.get(e.a)!.push(e.b);
      adj.get(e.b)!.push(e.a);
    }
    const seen = new Set<string>([reach[0]!]);
    const queue = [reach[0]!];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const n of adj.get(cur) ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    return seen.size === reach.length;
  };

  for (;;) {
    const open = openOf();
    const degree = new Map<string, number>(ids.map((id) => [id, 0]));
    for (const b of open) {
      degree.set(b.a, (degree.get(b.a) ?? 0) + 1);
      degree.set(b.b, (degree.get(b.b) ?? 0) + 1);
    }
    const over = ids
      .filter((id) => (degree.get(id) ?? 0) > budgetOf(id))
      .sort((p, q) => {
        const dp = (degree.get(p) ?? 0) - budgetOf(p);
        const dq = (degree.get(q) ?? 0) - budgetOf(q);
        return dp === dq ? (p < q ? -1 : 1) : dq - dp;
      });
    if (over.length === 0) break;

    let cut: string | null = null;
    for (const id of over) {
      const candidates = open
        .filter((b) => b.a === id || b.b === id)
        .sort((p, q) =>
          p.length === q.length ? (keyOf(p) < keyOf(q) ? -1 : 1) : p.length - q.length,
        );
      const pick = candidates.find((b) => connected(open, keyOf(b)));
      if (pick) {
        cut = keyOf(pick);
        break;
      }
    }
    if (cut === null) {
      // Nothing left to seal without stranding somebody: report and stop.
      return { open, sealed: borders.filter((b) => sealed.has(keyOf(b))), overBudget: over };
    }
    sealed.add(cut);
  }

  return {
    open: openOf(),
    sealed: borders.filter((b) => sealed.has(keyOf(b))),
    overBudget: [],
  };
}

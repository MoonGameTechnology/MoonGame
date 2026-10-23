/** Continuous decorative terrain in world coordinates. The input is a viewer's allowed
 * map, never a GameState: ownership, fleets and the camera cannot move the environment.
 * A fixed spatial lattice gives neighbouring provinces one drawing, even without a road.
 * Polygon influence is local; roads only calm decoration and never generate new routes. */
export type TerrainPoint = readonly [number, number];
export type TerrainFamily = 'asteroid' | 'nebula' | 'dust' | 'debris' | 'wreck' | 'storm' | 'orbit';
export interface TerrainEnvironmentCell {
  id: string;
  kind?: string;
  terrain?: string;
  poly: readonly TerrainPoint[];
  /** Unknown metadata is ignored before profiles, fingerprints or sampling are computed. */
  known: boolean;
}
export interface TerrainEnvironmentMarker {
  x: number;
  y: number;
  kind: 'capture' | 'fork';
}
export interface TerrainEnvironmentInput {
  cells: readonly TerrainEnvironmentCell[];
  /** Actual, already permitted road polylines, including internal trails and forks. */
  roads?: readonly (readonly { x: number; y: number }[])[];
  markers?: readonly TerrainEnvironmentMarker[];
  seed?: string;
}
export interface TerrainEnvironmentPath {
  points: readonly TerrainPoint[];
  closed: boolean;
  alpha: number;
  /** Nominal CSS-pixel stroke width; points alone are scaled by the camera. */
  width: number;
}
export interface TerrainEnvironmentFeature {
  id: string;
  family: TerrainFamily;
  paths: readonly TerrainEnvironmentPath[];
  color: string;
  detail: 'major' | 'minor';
}
export interface TerrainEnvironmentBox { x: number; y: number; width: number; height: number }
export interface TerrainEnvironmentTile {
  id: string;
  x: number;
  y: number;
  size: number;
  /** Full feature extent, including objects extending into another spatial tile. */
  box: TerrainEnvironmentBox;
  features: readonly TerrainEnvironmentFeature[];
  /** Draw all polygons as ONE nonzero-winding clipping path: only the fog perimeter clips. */
  clipPolygons: readonly (readonly TerrainPoint[])[];
  fingerprint: string;
}
export interface TerrainEnvironment {
  tiles: readonly TerrainEnvironmentTile[];
  clipPolygons: readonly (readonly TerrainPoint[])[];
  signature: string;
}

export const TERRAIN_ENVIRONMENT_TILE_SIZE = 256;
const STEP = 64;
const MAX_INFLUENCE = 80;
const FAMILIES: readonly TerrainFamily[] = ['asteroid', 'nebula', 'dust', 'debris', 'wreck', 'storm', 'orbit'];
const COLORS: Readonly<Record<TerrainFamily, string>> = {
  asteroid: '#95b8c5', nebula: '#929edb', dust: '#b6a2bd',
  debris: '#819fac', wreck: '#819fac', storm: '#80c4d5', orbit: '#8593b2',
};
interface Profile { family: TerrainFamily; density: number; scale: number; contrast: number }
const PROFILES: Readonly<Record<string, Profile>> = {
  asteroid: { family: 'asteroid', density: 0.8, scale: 1, contrast: 0.42 },
  asteroid_field: { family: 'asteroid', density: 0.8, scale: 1, contrast: 0.42 },
  asteroid_cluster: { family: 'asteroid', density: 1, scale: 1.45, contrast: 0.51 },
  nebula: { family: 'nebula', density: 0.74, scale: 1, contrast: 0.21 },
  dense_nebula: { family: 'nebula', density: 1, scale: 1.2, contrast: 0.3 },
  dust_lane: { family: 'dust', density: 0.8, scale: 1, contrast: 0.24 },
  debris_field: { family: 'debris', density: 0.72, scale: 0.7, contrast: 0.32 },
  graveyard: { family: 'wreck', density: 0.9, scale: 1.4, contrast: 0.4 },
  ion_storm: { family: 'storm', density: 0.68, scale: 1, contrast: 0.3 },
  solar_flare: { family: 'storm', density: 0.8, scale: 1.2, contrast: 0.3 },
  dead_world: { family: 'orbit', density: 0.34, scale: 1, contrast: 0.22 },
  depleted_system: { family: 'orbit', density: 0.25, scale: 0.8, contrast: 0.2 },
};

interface PreparedCell {
  id: string;
  poly: readonly TerrainPoint[];
  box: TerrainEnvironmentBox;
  influence: number;
  profile?: Profile;
}
interface Segment { a: TerrainPoint; b: TerrainPoint; box: TerrainEnvironmentBox }
interface Mixture { family: TerrainFamily; density: number; scale: number; contrast: number }

function hash(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
function randomFrom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
function boxOf(points: readonly TerrainPoint[]): TerrainEnvironmentBox {
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
  for (const [px, py] of points) {
    x = Math.min(x, px); y = Math.min(y, py);
    right = Math.max(right, px); bottom = Math.max(bottom, py);
  }
  return { x, y, width: right - x, height: bottom - y };
}
function meets(a: TerrainEnvironmentBox, b: TerrainEnvironmentBox, pad = 0): boolean {
  return a.x <= b.x + b.width + pad && a.x + a.width >= b.x - pad &&
    a.y <= b.y + b.height + pad && a.y + a.height >= b.y - pad;
}
function pointDistance(x: number, y: number, a: TerrainPoint, b: TerrainPoint): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / length2)) : 0;
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}
function polygonDistance(x: number, y: number, poly: readonly TerrainPoint[]): { inside: boolean; distance: number } {
  let inside = false, distance = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!, b = poly[i]!;
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    distance = Math.min(distance, pointDistance(x, y, a, b));
  }
  return { inside: inside || distance < 1e-8, distance };
}
function normalizedPolygon(poly: readonly TerrainPoint[]): TerrainPoint[] {
  // Every subpath has the same winding, so overlapping known cells form a union mask.
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area < 0 ? [...poly].reverse() : [...poly];
}
function prepareCells(cells: readonly TerrainEnvironmentCell[]): PreparedCell[] {
  return cells.filter(c => c.known && c.poly.length >= 3 && c.poly.every(p => p.every(Number.isFinite)))
    .map(c => {
      const poly = normalizedPolygon(c.poly);
      const box = boxOf(poly);
      // Small provinces retain an interior: their transitions cannot have the width of
      // a neighbouring giant. Special bodies keep their own existing node renderer.
      const influence = Math.min(MAX_INFLUENCE, Math.max(12, Math.min(box.width, box.height) * 0.16));
      const profile = c.kind === 'black_hole' || c.kind === 'rift' ? undefined
        : PROFILES[c.terrain ?? ''] ?? PROFILES[c.kind ?? ''];
      return { id: c.id, poly, box, influence, profile };
    }).sort((a, b) => a.id.localeCompare(b.id));
}
function mixtures(x: number, y: number, cells: readonly PreparedCell[]): Mixture[] {
  let total = 0, contained = false, localWidth = MAX_INFLUENCE;
  const nearby: { cell: PreparedCell; inside: boolean; distance: number }[] = [];
  const weighted: { cell: PreparedCell; weight: number }[] = [];
  for (const cell of cells) {
    if (!meets(cell.box, { x, y, width: 0, height: 0 }, cell.influence)) continue;
    const { inside, distance } = polygonDistance(x, y, cell.poly);
    contained ||= inside;
    if (inside) localWidth = Math.min(localWidth, cell.influence);
    nearby.push({ cell, inside, distance });
  }
  // Cap incoming influence by the receiving cell too: a tiny province keeps its own
  // interior instead of being consumed by transitions from several large neighbours.
  for (const { cell, inside, distance } of nearby) {
    const t = inside ? 1 : Math.max(0, 1 - distance / Math.min(cell.influence, localWidth));
    const weight = t * t * (3 - 2 * t);
    if (weight <= 0) continue;
    weighted.push({ cell, weight }); total += weight;
  }
  // No unknown metadata contributes an offscreen halo or a transition into a known cell.
  if (!contained || total === 0) return [];
  const result: Mixture[] = [];
  for (const family of FAMILIES) {
    let density = 0, scale = 0, contrast = 0;
    for (const { cell, weight } of weighted) {
      const p = cell.profile;
      if (p?.family !== family) continue;
      const w = weight / total;
      density += w * p.density; scale += w * p.density * p.scale; contrast += w * p.density * p.contrast;
    }
    // Equivalent partitions of one environment must not differ by accumulated floating
    // point noise. This precision is far below a display pixel at any supported zoom.
    const q = (n: number): number => Math.round(n * 1e9) / 1e9;
    if (density > 0.005) result.push({ family, density: q(density), scale: q(scale / density), contrast: q(contrast / density) });
  }
  return result;
}

/** Continuous profile sampling is exposed for transition/three-way junction contracts.
 * It ignores unknown metadata exactly as the full planner does. */
export function sampleTerrainEnvironment(
  cells: readonly TerrainEnvironmentCell[], x: number, y: number,
): readonly Mixture[] {
  return mixtures(x, y, prepareCells(cells));
}

function feature(
  id: string, x: number, y: number, mix: Mixture, random: () => number,
  quiet: number,
): TerrainEnvironmentFeature {
  const paths: TerrainEnvironmentPath[] = [];
  const major = random() > 0.38;
  const scale = mix.scale * (0.7 + random() * 0.6);
  // A broad world-space flow, not a new orientation at each administrative boundary.
  const angle = -0.38 + Math.sin(x / 740 + y / 1100) * 0.3 + Math.cos(y / 630) * 0.2;
  const point = (u: number, v: number): TerrainPoint =>
    [x + (u * Math.cos(angle) - v * Math.sin(angle)) * scale,
      y + (u * Math.sin(angle) + v * Math.cos(angle)) * scale];
  const path = (points: readonly TerrainPoint[], closed = false, alpha = 1, width = 0.75): void => {
    paths.push({ points, closed, alpha: mix.contrast * quiet * alpha, width });
  };
  if (mix.family === 'asteroid') {
    const radius = (major ? 9 : 4) + random() * (major ? 12 : 6);
    const rotation = random() * Math.PI * 2;
    const points = Array.from({ length: 7 }, (_, j) => {
      const a = rotation + j * Math.PI * 2 / 7;
      const r = radius * (0.67 + random() * 0.33);
      return point(Math.cos(a) * r, Math.sin(a) * r);
    });
    path(points, true);
    if (major) {
      path([points[0]!, point(-radius * 0.2, radius * 0.1), points[3]!], false, 0.48);
      path([points[5]!, point(-radius * 0.2, radius * 0.1)], false, 0.38);
    }
  } else if (mix.family === 'nebula' || mix.family === 'dust') {
    const dust = mix.family === 'dust';
    // Irregular, overlapping wisps: neither a fixed-length hatch nor a province-centred
    // cloud stamp. Long curves share the broad flow, with independent tapered ends.
    const length = (dust ? 110 : 165) + random() * (dust ? 125 : 185);
    const bands = 1 + Math.floor(random() * (dust ? 2 : 3));
    const bend = (dust ? 12 : 22) + random() * (dust ? 15 : 36);
    const phase = random() * Math.PI * 2;
    for (let band = 0; band < bands; band++) {
      const span = length * (0.62 + random() * 0.38);
      const offset = (band - (bands - 1) / 2) * (dust ? 7 : 14);
      const shift = (random() - 0.5) * length * 0.25;
      const points = Array.from({ length: 25 }, (_, j) => {
        const t = j / 24;
        const u = (t - 0.5) * span + shift;
        const v = Math.sin((x + u) / 190 + y / 310) * bend +
          Math.sin(t * Math.PI * 1.7 + phase) * bend * 0.45 +
          offset * Math.sin(t * Math.PI);
        return point(u, v);
      });
      // Six connected portions keep round soft ends; neighbouring filaments do not
      // end on the same line, and the brightest segment never makes a rectangular pack.
      for (let part = 0; part < 6; part++) {
        const taper = Math.sin((part + 0.5) / 6 * Math.PI);
        path(points.slice(part * 4, part * 4 + 5), false,
          (0.2 + taper * 0.65) * (band === 0 ? 1 : 0.72), dust ? 0.6 : 0.85);
      }
    }
  } else if (mix.family === 'debris') {
    // A loose drift of torn plating: shards of uneven size, each tumbling on its own
    // axis, thinning out from a dense middle. No shared silhouette, no shared heading.
    const shards = (major ? 6 : 3) + Math.floor(random() * 4);
    const spread = 30 * mix.scale;
    for (let i = 0; i < shards; i++) {
      const a = random() * Math.PI * 2;
      const reach = spread * Math.pow(random(), 0.7);
      const cx = x + Math.cos(a) * reach, cy = y + Math.sin(a) * reach * 0.75;
      const size = (2.4 + random() * random() * 10) * mix.scale;
      const spin = random() * Math.PI * 2;
      const corners = 3 + Math.floor(random() * 2);
      const points = Array.from({ length: corners }, (_, j): TerrainPoint => {
        const t = spin + (j + random() * 0.6) / corners * Math.PI * 2;
        const r = size * (0.35 + random() * 0.65);
        return [cx + Math.cos(t) * r, cy + Math.sin(t) * r];
      });
      const far = reach / spread;
      path(points, true, 0.95 - far * 0.45, 0.65);
    }
    // A bent strip of hull now and then, and fine grit between the larger pieces.
    if (major && random() < 0.6) {
      const t = random() * Math.PI * 2, len = (8 + random() * 9) * mix.scale;
      const kink = (random() - 0.5) * 1.2;
      const p0: TerrainPoint = [x - Math.cos(t) * len, y - Math.sin(t) * len];
      const p2: TerrainPoint = [x + Math.cos(t + kink) * len * 0.8, y + Math.sin(t + kink) * len * 0.8];
      path([p0, [x, y], p2], false, 0.7, 0.7);
    }
    for (let i = 0, grit = 2 + Math.floor(random() * 4); i < grit; i++) {
      const a = random() * Math.PI * 2, reach = spread * (0.4 + random() * 0.8);
      const gx = x + Math.cos(a) * reach, gy = y + Math.sin(a) * reach * 0.75;
      const t = random() * Math.PI, d = 0.6 + random() * 1.2;
      path([[gx, gy], [gx + Math.cos(t) * d, gy + Math.sin(t) * d]], false, 0.4, 0.6);
    }
  } else if (mix.family === 'wreck') {
    // A ship graveyard in the fleet's own build: modular hulls with engine pods, station ring
    // segments, bare truss and drifting panel arrays. The previous hulk was one tapered hull
    // with a pointed prow, and from above it read as a sea boat (owner, 2026-10-23). The
    // cues that say «spacecraft» here are the ones a boat never has: parallel engine pods
    // with flared nozzles, a stepped modular hull, lattice frames and panel grids.
    const heading = random() * Math.PI * 2;
    const cx = x + (random() - 0.5) * 26, cy = y + (random() - 0.5) * 26;
    const s = mix.scale;
    type Frame = (u: number, v: number) => TerrainPoint;
    const local = (a: number, ox: number, oy: number): Frame => (u, v) =>
      [ox + u * Math.cos(a) - v * Math.sin(a), oy + u * Math.sin(a) + v * Math.cos(a)];
    const box = (f: Frame, u0: number, u1: number, v0: number, v1: number, alpha = 1, width = 0.75): void =>
      path([f(u0, v0), f(u1, v0), f(u1, v1), f(u0, v1)], true, alpha, width);
    const line = (f: Frame, u0: number, v0: number, u1: number, v1: number, alpha = 0.5, width = 0.5): void =>
      path([f(u0, v0), f(u1, v1)], false, alpha, width);
    const shard = (px: number, py: number, size: number, alpha: number): void => {
      const spin = random() * Math.PI * 2;
      path([0, 2.1 + random() * 0.4, 4 + random() * 0.4].map((t): TerrainPoint =>
        [px + Math.cos(spin + t) * size, py + Math.sin(spin + t) * size]), true, alpha, 0.6);
    };
    // An engine pod: a block with its nozzle flared open behind it.
    const pod = (f: Frame, u: number, v: number, length: number, half: number, alpha = 0.9): void => {
      box(f, u, u + length, v - half, v + half, alpha);
      path([f(u, v - half * 0.7), f(u - length * 0.35, v - half * 1.15),
        f(u - length * 0.35, v + half * 1.15), f(u, v + half * 0.7)], false, alpha * 0.8, 0.6);
    };
    // A lattice frame between two rails: what is left of a hull once its plating is gone.
    const truss = (f: Frame, u0: number, u1: number, half: number, alpha: number): void => {
      line(f, u0, -half, u1, -half, alpha, 0.6);
      line(f, u0, half, u1, half, alpha, 0.6);
      const bays = Math.max(2, Math.round((u1 - u0) / (half * 2.2)));
      for (let i = 0; i < bays; i++) {
        const a = u0 + (u1 - u0) * i / bays, b = u0 + (u1 - u0) * (i + 1) / bays;
        line(f, a, i % 2 ? half : -half, b, i % 2 ? -half : half, alpha * 0.8, 0.45);
      }
    };
    const form = random();
    if (major && form < 0.55) {
      // A broken warship: engine pods, a stepped hull of modules and a blunt armoured
      // prow, snapped at one module joint. The stern drifted off the break, twisted.
      const length = (30 + random() * 24) * (random() < 0.2 ? 1.4 : 1) * s;
      const beam = length * (0.075 + random() * 0.035);
      const stern = -length / 2;
      const pods = random() < 0.55 ? 2 : 3;
      const podLength = length * 0.16;
      const podHalf = beam * (pods === 2 ? 0.48 : 0.36);
      // Module joints from the engine block to the prow; the hull breaks at one of them.
      const joints = [stern + podLength, -length * 0.12, length * 0.08, length * 0.26];
      const breakAt = 1 + Math.floor(random() * 2);
      const cut = joints[breakAt]!;
      const twist = (random() < 0.5 ? -1 : 1) * (0.15 + random() * 0.35);
      const gap = (3 + random() * 5) * s;
      const aft = local(heading, cx, cy);
      const [bx, by] = aft(cut + gap, (random() - 0.5) * gap);
      const fore = local(heading + twist, bx, by);
      const at = (u: number, v: number): TerrainPoint => u < cut ? aft(u, v) : fore(u - cut, v);
      const shape = (['fork', 'hammer', 'wedge'] as const)[Math.floor(random() * 3)]!;
      // Hull halves: each module keeps its own width, so the outline steps.
      const widths = [beam, beam * 0.82, beam * 0.9];
      const hull = (from: number, to: number, f: Frame): void => {
        const top: TerrainPoint[] = [], bottom: TerrainPoint[] = [];
        for (let i = 0; i < 3; i++) {
          const a = Math.max(from, joints[i]!), b = Math.min(to, joints[i + 1]!);
          if (b <= a) continue;
          top.push(f(a, -widths[i]!), f(b, -widths[i]!));
          bottom.push(f(a, widths[i]!), f(b, widths[i]!));
        }
        if (to > joints[3]!) {
          // The prow is never a pointed bow: twin prongs, a hammerhead or a stepped wedge.
          const prow: Array<readonly [number, number]> = shape === 'fork'
            ? [[joints[3]!, 0.9], [length / 2, 0.8], [length / 2, 0.36], [joints[3]! + length * 0.07, 0.12]]
            : shape === 'hammer'
              ? [[joints[3]!, 0.7], [length * 0.41, 0.7], [length * 0.41, 1.35], [length / 2, 1.2], [length / 2, 0.3]]
              : [[joints[3]!, 0.9], [length * 0.38, 0.9], [length * 0.38, 0.62], [length / 2, 0.3]];
          for (const [u, w] of prow) {
            top.push(f(u, -beam * w));
            bottom.push(f(u, beam * w));
          }
        }
        // The broken edge is ragged, not a clean saw cut.
        if (to === cut) {
          path([...top, f(cut + 0.7 * s, -beam * 0.2), f(cut - 0.9 * s, beam * 0.3), ...bottom.reverse()], true);
        } else {
          path([...top, ...bottom.reverse(), f(cut - 0.7 * s, beam * 0.3), f(cut + 0.9 * s, -beam * 0.2)], true);
        }
      };
      hull(joints[0]!, cut, aft);
      hull(cut, length / 2, (u, v) => fore(u - cut, v));
      // Engine block: pods side by side on the stern.
      for (let i = 0; i < pods; i++) {
        const v = (i - (pods - 1) / 2) * podHalf * 2.3;
        pod(aft, stern, v, podLength, podHalf);
      }
      // Seams between modules, a side module and the command block.
      for (const u of joints.slice(1)) if (u !== cut) path([at(u, -beam * 0.82), at(u, beam * 0.82)], false, 0.45, 0.5);
      const side = random() < 0.5 ? -1 : 1;
      const m0 = joints[2]! - cut + length * 0.02;
      box(fore, m0, m0 + length * 0.14, side * beam * 0.9, side * beam * 1.45, 0.7);
      const bridge = joints[3]! - cut - length * 0.12;
      box(fore, bridge, bridge + length * 0.07, -side * beam * 0.1, -side * beam * 0.5, 0.75);
      // The frame shows at the break, and plating tumbles off it.
      for (const v of [-0.5, 0.15]) line(aft, cut - 0.4 * s, v * beam, cut + gap * 0.6, (v + 0.2) * beam, 0.55, 0.45);
      for (let i = 0, n = 2 + Math.floor(random() * 3); i < n; i++) {
        const a = random() * Math.PI * 2, reach = (0.08 + random() * 0.22) * length;
        const [px, py] = aft(cut + Math.cos(a) * reach, Math.sin(a) * reach * 0.6);
        shard(px, py, (1 + random() * 2) * s, 0.6);
      }
    } else if (major && form < 0.75) {
      // A segment of a station ring: two arcs, habitat bulkheads between them, the
      // stump of a spoke towards a centre that is no longer there.
      const radius = (15 + random() * 12) * s;
      const span = 0.8 + random() * 1.1;
      const inner = radius * (0.78 + random() * 0.06);
      // The segment lies on its slot; the ring's centre is empty space behind it.
      const ox = cx - Math.cos(heading) * radius, oy = cy - Math.sin(heading) * radius;
      const arc = (r: number): TerrainPoint[] => Array.from({ length: 9 }, (_, j) => {
        const a = heading + (j / 8 - 0.5) * span;
        return [ox + Math.cos(a) * r, oy + Math.sin(a) * r];
      });
      const outer = arc(radius), within = arc(inner);
      // Both ends tear across the ring at a slant.
      const end = (side: number, t: number): TerrainPoint => {
        const a = heading + side * (span / 2 + 0.05 + random() * 0.06), r = inner + (radius - inner) * t;
        return [ox + Math.cos(a) * r, oy + Math.sin(a) * r];
      };
      path([...outer, end(1, 0.55), ...[...within].reverse(), end(-1, 0.4)], true);
      for (const j of [2, 4, 6]) path([outer[j]!, within[j]!], false, 0.5, 0.5);
      const j = random() < 0.5 ? 3 : 5;
      const a = heading + (j / 8 - 0.5) * span;
      const reach = inner * (0.25 + random() * 0.25);
      path([within[j]!, [ox + Math.cos(a) * (inner - reach), oy + Math.sin(a) * (inner - reach)]], false, 0.6, 0.6);
      shard(outer[8]![0] + Math.cos(heading) * 3 * s, outer[8]![1] + Math.sin(heading) * 3 * s, 1.6 * s, 0.55);
    } else if (major) {
      // A bare keel: the truss of a hull stripped to its frame, bent where it broke.
      const length = (14 + random() * 14) * s;
      const halfWidth = (1.2 + random() * 0.8) * s;
      const bend = (random() - 0.5) * 0.5;
      const first = local(heading, cx, cy);
      const [kx, ky] = first(length * 0.15, 0);
      truss(first, -length * 0.5, length * 0.15, halfWidth, 0.8);
      truss(local(heading + bend, kx, ky), 0, length * 0.35, halfWidth, 0.7);
    } else if (form < 0.4) {
      // A panel array torn loose: a radiator or solar wing, its grid still whole.
      const f = local(heading, cx, cy);
      const length = (7 + random() * 6) * s, width = (2.4 + random() * 1.6) * s;
      const cells = 3 + Math.floor(random() * 2);
      box(f, -length / 2, length / 2, -width / 2, width / 2, 0.8, 0.6);
      for (let i = 1; i < cells; i++) {
        const u = -length / 2 + length * i / cells;
        line(f, u, -width / 2, u, width / 2, 0.45, 0.4);
      }
      line(f, -length / 2, 0, length / 2, 0, 0.35, 0.4);
      line(f, -length / 2, 0, -length / 2 - 2.5 * s, 0.6 * s, 0.6, 0.5);
    } else if (form < 0.65) {
      // A lone engine pod, with its mounting strut.
      const f = local(heading, cx, cy);
      const length = (4.5 + random() * 3) * s, half = (1 + random() * 0.6) * s;
      pod(f, -length / 2, 0, length, half, 0.75);
      line(f, length / 2, 0, length / 2 + 2 * s, (random() - 0.5) * 2 * s, 0.55, 0.5);
    } else {
      for (let i = 0, n = 1 + Math.floor(random() * 3); i < n; i++)
        shard(cx + (random() - 0.5) * 20, cy + (random() - 0.5) * 20, (1 + random() * 2.2) * s, 0.55);
    }
  } else if (mix.family === 'storm') {
    const points = Array.from({ length: 7 }, (_, j) => point((j - 3) * 15, (random() - 0.5) * 24));
    path(points, false, 0.9);
    if (major) path([points[3]!, point(10, -22), point(15, -38)], false, 0.55);
  } else {
    // Exhausted fragments are environmental marks; they do not replace a celestial body.
    path([point(-14, -5), point(6, -5), point(12, 2)], false, 0.85);
    path([point(-9, 8), point(4, 8)], false, 0.6);
  }
  return { id, family: mix.family, color: COLORS[mix.family], detail: major ? 'major' : 'minor', paths };
}

/** Prepare a bounded amount of decoration per occupied world tile. Spatial indexing keeps
 * samples dependent only on nearby polygons/roads; a distant edit cannot reshuffle them. */
export function buildTerrainEnvironment(input: TerrainEnvironmentInput): TerrainEnvironment {
  const cells = prepareCells(input.cells);
  const size = TERRAIN_ENVIRONMENT_TILE_SIZE;
  const index = new Map<string, { tx: number; ty: number; cells: PreparedCell[] }>();
  for (const cell of cells) {
    const loX = Math.floor((cell.box.x - MAX_INFLUENCE) / size);
    const hiX = Math.floor((cell.box.x + cell.box.width + MAX_INFLUENCE) / size);
    const loY = Math.floor((cell.box.y - MAX_INFLUENCE) / size);
    const hiY = Math.floor((cell.box.y + cell.box.height + MAX_INFLUENCE) / size);
    for (let ty = loY; ty <= hiY; ty++) for (let tx = loX; tx <= hiX; tx++) {
      const id = `${tx},${ty}`;
      let tile = index.get(id);
      if (!tile) { tile = { tx, ty, cells: [] }; index.set(id, tile); }
      tile.cells.push(cell);
    }
  }
  const segments: Segment[] = [];
  for (const road of input.roads ?? []) for (let i = 1; i < road.length; i++) {
    const a: TerrainPoint = [road[i - 1]!.x, road[i - 1]!.y], b: TerrainPoint = [road[i]!.x, road[i]!.y];
    if ([...a, ...b].every(Number.isFinite)) segments.push({ a, b, box: boxOf([a, b]) });
  }
  const markers = (input.markers ?? []).filter(m => Number.isFinite(m.x) && Number.isFinite(m.y));
  const tiles: TerrainEnvironmentTile[] = [];
  const ordered = [...index.entries()].sort((a, b) => a[1].ty - b[1].ty || a[1].tx - b[1].tx);
  for (const [id, tile] of ordered) {
    const x0 = tile.tx * size, y0 = tile.ty * size;
    const baseBox = { x: x0, y: y0, width: size, height: size };
    const nearbyRoads = segments.filter(s => meets(baseBox, s.box, 56));
    const nearbyMarkers = markers.filter(m => meets(baseBox, { x: m.x, y: m.y, width: 0, height: 0 }, 72));
    const features: TerrainEnvironmentFeature[] = [];
    for (let gy = 0; gy < size / STEP; gy++) for (let gx = 0; gx < size / STEP; gx++) {
      const anchor = `${input.seed ?? 'terrain'}:${tile.tx * (size / STEP) + gx},${tile.ty * (size / STEP) + gy}`;
      const jitter = randomFrom(hash(anchor));
      const x = x0 + (gx + 0.15 + jitter() * 0.7) * STEP;
      const y = y0 + (gy + 0.15 + jitter() * 0.7) * STEP;
      if (nearbyMarkers.some(m => Math.hypot(x - m.x, y - m.y) < (m.kind === 'capture' ? 43 : 31))) continue;
      let distance = Infinity;
      for (const s of nearbyRoads) distance = Math.min(distance, pointDistance(x, y, s.a, s.b));
      // A variable-width, partial contrast reduction, never a uniformly empty tube.
      const calmWidth = 25 + 10 * (0.5 + Math.sin(x / 99 + y / 137) * 0.5);
      const quiet = 0.3 + 0.7 * Math.min(1, distance / calmWidth);
      for (const mix of mixtures(x, y, tile.cells)) {
        const random = randomFrom(hash(`${anchor}:${mix.family}`));
        const distribution = 0.66 + 0.34 * (0.5 + Math.sin(x / 151 + Math.sin(y / 270) * 1.4) * 0.5);
        if (random() > mix.density * distribution * (0.62 + quiet * 0.38)) continue;
        features.push(feature(`${anchor}:${mix.family}`, x, y, mix, random, quiet));
      }
    }
    if (!features.length) continue;
    const featureBox = boxOf(features.flatMap(f => f.paths.flatMap(p => p.points)));
    // Padding is world-space. Raster consumers add their own CSS-pixel stroke gutter.
    const box = { x: featureBox.x - 2, y: featureBox.y - 2, width: featureBox.width + 4, height: featureBox.height + 4 };
    const clipPolygons = cells.filter(c => meets(box, c.box)).map(c => c.poly);
    const fingerprint = hash(JSON.stringify([features, clipPolygons])).toString(16);
    tiles.push({ id, x: x0, y: y0, size, box, features, clipPolygons, fingerprint });
  }
  return { tiles, clipPolygons: cells.map(c => c.poly), signature: hash(tiles.map(t => `${t.id}:${t.fingerprint}`).join('|')).toString(16) };
}

/**
 * The rings round the stars (owner 2026-11-18/19), one look per star class, drawn like the
 * Abyss's accretion disk: every stroke circles the star (the field's marker), not the ring
 * province, and lies on a bearing or a radius that every province of the ring shares, so
 * the ring reads as one piece across its borders. Measured in box pixels and divided back,
 * so circles stay round in a wide box. Pure geometry; `holographicTerrainArt.ts` draws it.
 */
type Point = readonly [number, number];

export interface RingPen {
  marker: Point;
  box: { width: number; height: number };
  poly: readonly Point[];
  path: (points: readonly Point[], alpha?: number) => void;
  line: (a: Point, z: Point, alpha?: number) => void;
  random: () => number;
}

interface Frame {
  /** Nearest and farthest reach of the province from the star, in box pixels. */
  near: number;
  far: number;
  /** The province's span of bearings, relative to `base`. */
  lo: number;
  hi: number;
  base: number;
  /** A point at radius `r` on the absolute bearing `a`. */
  at: (r: number, a: number) => Point;
}

const TAU = Math.PI * 2;

function frameOf({ marker, box: b, poly }: RingPen): Frame {
  const cx = marker[0] * b.width;
  const cy = marker[1] * b.height;
  let near = Infinity;
  let far = 0;
  let lo = Infinity;
  let hi = -Infinity;
  const base = Math.atan2(0.5 * b.height - cy, 0.5 * b.width - cx);
  for (const [x, y] of poly) {
    const dx = x * b.width - cx;
    const dy = y * b.height - cy;
    const r = Math.hypot(dx, dy);
    near = Math.min(near, r);
    far = Math.max(far, r);
    let a = Math.atan2(dy, dx) - base;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    lo = Math.min(lo, a);
    hi = Math.max(hi, a);
  }
  const at = (r: number, a: number): Point => [
    (cx + Math.cos(a) * r) / b.width,
    (cy + Math.sin(a) * r) / b.height,
  ];
  return { near, far, lo, hi, base, at };
}

/** A repeatable 0…1 per integer, so a bearing looks the same from either province. */
const hash = (k: number): number => {
  const v = Math.sin(k * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

/** The absolute bearings of a `count`-spoke wheel that fall on the province. */
function spokes(f: Frame, count: number): Array<{ k: number; a: number }> {
  const out: Array<{ k: number; a: number }> = [];
  for (let k = 0; k < count; k++) {
    const abs = (k / count) * TAU;
    let rel = abs - f.base;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    if (rel >= f.lo - 0.05 && rel <= f.hi + 0.05) out.push({ k, a: f.base + rel });
  }
  return out;
}

/** An arc across the province at radius `r(a)` (absolute bearing in, pixels out). */
function arc(pen: RingPen, f: Frame, r: (a: number) => number, alpha: number): void {
  pen.path(
    Array.from({ length: 41 }, (_, j) => {
      const a = f.base + f.lo + ((f.hi - f.lo) * j) / 40;
      return f.at(r(a), a);
    }),
    alpha,
  );
}

/** A ray from the star outward, fading with distance, bent by `bend(r)` radians. */
function ray(pen: RingPen, f: Frame, a: number, r0: number, r1: number, alpha: number, bend = (_r: number) => 0): void {
  const n = 8;
  for (let i = 0; i < n; i++) {
    const ra = r0 + ((r1 - r0) * i) / n;
    const rb = r0 + ((r1 - r0) * (i + 1)) / n;
    pen.line(f.at(ra, a + bend(ra)), f.at(rb, a + bend(rb)), alpha * (1 - (i / n) * 0.75));
  }
}

/** Yellow dwarf → corona: streamers of the star's hot outer air, a bright limb. */
function corona(pen: RingPen, f: Frame): void {
  arc(pen, f, () => f.near * 1.04, 0.55);
  for (const { k, a } of spokes(f, 90)) {
    const reach = f.near + (f.far - f.near) * (0.3 + 0.7 * hash(k));
    ray(pen, f, a, f.near, reach, 0.3 + 0.25 * hash(k + 7), (r) => 0.05 * Math.sin((r / f.near) * 3 + k));
  }
  for (const m of [1.35, 1.8]) arc(pen, f, (a) => f.near * m * (1 + 0.03 * Math.sin(a * 9)), 0.12);
}

/** Red giant → dust shell: broken shells of the dust the swollen star shed, and specks. */
function dustShell(pen: RingPen, f: Frame): void {
  const step = f.near * 0.11;
  for (let band = 0; f.near + band * step < f.far; band++) {
    const r = f.near + (band + 0.5) * step;
    for (const { k, a } of spokes(f, 120)) {
      if (hash(k * 31 + band) < 0.4) continue;
      pen.line(f.at(r, a), f.at(r, a + TAU / 120 * 0.8), Math.max(0.1, 0.42 - band * 0.035));
    }
  }
  for (let i = 0; i < 46; i++) {
    const r = f.near + (f.far - f.near) * Math.pow(pen.random(), 1.4);
    const a = f.base + f.lo + (f.hi - f.lo) * pen.random();
    pen.line(f.at(r, a), f.at(r * 1.004, a + 0.015), 0.3 + pen.random() * 0.25);
  }
}

/** Blue giant → stellar wind: streamlines blown outward, gust fronts across them. */
function stellarWind(pen: RingPen, f: Frame): void {
  for (const { k, a } of spokes(f, 64)) {
    const start = f.near * (1 + 0.08 * hash(k));
    ray(pen, f, a, start, f.far, 0.36, (r) => 0.07 * Math.sin(((r - f.near) / f.near) * 6 + k));
  }
  for (const m of [1.22, 1.55, 1.95])
    arc(pen, f, (a) => f.near * m * (1 + 0.05 * Math.sin(a * 5 + m * 4)), 0.17);
}

/** White dwarf → planetary nebula: the nested shells it threw off, pinched to two lobes. */
function planetaryNebula(pen: RingPen, f: Frame): void {
  const tilt = 0.6;
  for (let j = 0; j < 7; j++) {
    const R = f.near * (1.02 + 0.17 * j);
    arc(pen, f, (a) => R * (1 + 0.32 * Math.cos(2 * (a - tilt))), Math.max(0.1, 0.46 - j * 0.05));
  }
  for (let i = 0; i < 30; i++) {
    const a = f.base + f.lo + (f.hi - f.lo) * pen.random();
    const r = f.near * (1.05 + pen.random() * 0.8);
    pen.line(f.at(r, a), f.at(r * (1.08 + pen.random() * 0.1), a), 0.22);
  }
}

/** Pulsar → pulsar wind: a tilted torus of dashes and the two beams across it. */
function pulsarWind(pen: RingPen, f: Frame): void {
  const tilt = -0.35;
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  for (const m of [1.25, 1.6, 2.0]) {
    const R = f.near * m;
    for (let j = 0; j < 96; j += 2) {
      const point = (t: number): Point => {
        const ex = Math.cos(t) * R;
        const ey = Math.sin(t) * R * 0.42;
        const x = ex * c - ey * s;
        const y = ex * s + ey * c;
        return f.at(Math.hypot(x, y), Math.atan2(y, x));
      };
      pen.line(point((j / 96) * TAU), point(((j + 1) / 96) * TAU), 0.42 - m * 0.1);
    }
  }
  for (const side of [0, Math.PI]) {
    const beam = tilt + Math.PI / 2 + side;
    ray(pen, f, beam, f.near, f.far, 0.62);
    for (const d of [-0.035, 0.035]) ray(pen, f, beam + d, f.near, f.far * 0.85, 0.24);
  }
}

/** Binary star → circumbinary disk: bands rippled by the pair's two-armed pull. */
function circumbinaryDisk(pen: RingPen, f: Frame): void {
  const step = f.near * 0.09;
  for (let band = 0; f.near + band * step < f.far; band++) {
    const r0 = f.near + (band + 0.5) * step;
    arc(pen, f, (a) => r0 + step * 0.35 * Math.sin(2 * a + band * 0.6), Math.max(0.1, 0.46 - band * 0.03));
  }
  for (const arm of [0, Math.PI]) {
    pen.path(
      Array.from({ length: 36 }, (_, j) => {
        const r = f.near * (1 + (j / 35) * 1.4);
        return f.at(r, arm + 1.8 * Math.log(r / f.near));
      }),
      0.36,
    );
  }
}

const ART: Readonly<Record<string, (pen: RingPen, f: Frame) => void>> = {
  corona,
  dust_shell: dustShell,
  stellar_wind: stellarWind,
  planetary_nebula: planetaryNebula,
  pulsar_wind: pulsarWind,
  circumbinary_disk: circumbinaryDisk,
};

/** Ring kind → its stroke colour, the class's light (`data/sectorKinds.json` appearance). */
export const RING_ART_COLORS: Readonly<Record<string, string>> = {
  corona: '#ffd36a',
  dust_shell: '#ff6f4f',
  stellar_wind: '#8fc0ff',
  planetary_nebula: '#7ff0d0',
  pulsar_wind: '#8ff0ff',
  circumbinary_disk: '#ffe7a8',
};

/** A ring is a wall the player must read at a glance: its strokes burn brighter than the
 *  open terrain round it. */
const GAIN = 1.6;

/** Draws a star ring's province; false for a kind that is not one. */
export function drawStarRing(kind: string, pen: RingPen): boolean {
  const art = ART[kind];
  if (!art) return false;
  const bright: RingPen = {
    ...pen,
    line: (a, z, alpha = 0.3) => pen.line(a, z, Math.min(0.9, alpha * GAIN)),
    path: (points, alpha = 0.3) => pen.path(points, Math.min(0.9, alpha * GAIN)),
  };
  art(bright, frameOf(bright));
  return true;
}

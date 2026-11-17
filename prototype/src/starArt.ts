/**
 * The star at the heart of a solar-flare zone, drawn in the map's own hand: the same
 * transparent rotating wire sphere as a planet, in the star's colour, plus what each class of
 * star does — a corona of rays, a stellar wind of rings, a pulsar's beams, a binary's orbit.
 * Lines only, no fills, so it reads as kin of the planets. `clockMs` is the map's visual
 * clock: it freezes on pause and under reduced motion, and the star then stands still.
 */
import type { StarClass } from '../../decisions/starClass';

const TAU = Math.PI * 2;
const TILT = 0.38;
const COS_T = Math.cos(TILT);
const SIN_T = Math.sin(TILT);

const COLOR: Readonly<Record<StarClass | 'companion', string>> = {
  yellow_dwarf: '255,211,106',
  red_giant: '255,111,79',
  blue_giant: '143,192,255',
  white_dwarf: '230,240,255',
  pulsar: '143,240,255',
  binary: '255,211,106',
  companion: '143,192,255',
};

const stroke = (cx: CanvasRenderingContext2D, rgb: string, a: number, w: number): void => {
  cx.strokeStyle = `rgba(${rgb},${a})`;
  cx.lineWidth = w;
};

/** A wire sphere: 8 meridians and 5 parallels, the front half bright and the back dim — two
 *  paths per sphere, so a star costs a few strokes, not one per segment. */
function wire(cx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, rot: number): void {
  const front: number[] = [];
  const back: number[] = [];
  const point = (lat: number, lon: number): [number, number, number] => {
    const cl = Math.cos(lat);
    const X = cl * Math.sin(lon);
    const Y = Math.sin(lat);
    const Z = cl * Math.cos(lon);
    return [x + X * r, y - (Y * COS_T - Z * SIN_T) * r, Y * SIN_T + Z * COS_T];
  };
  const segment = (a: [number, number, number], b: [number, number, number]): void => {
    (a[2] + b[2] > 0 ? front : back).push(a[0], a[1], b[0], b[1]);
  };
  for (let m = 0; m < 8; m++) {
    const lon = rot + (m * TAU) / 8;
    let p = point(-Math.PI / 2, lon);
    for (let i = 1; i <= 16; i++) {
      const q = point(-Math.PI / 2 + (Math.PI * i) / 16, lon);
      segment(p, q);
      p = q;
    }
  }
  for (const lat of [-0.9, -0.45, 0, 0.45, 0.9]) {
    let p = point(lat, 0);
    for (let i = 1; i <= 24; i++) {
      const q = point(lat, (TAU * i) / 24);
      segment(p, q);
      p = q;
    }
  }
  const draw = (segs: number[]): void => {
    cx.beginPath();
    for (let i = 0; i < segs.length; i += 4) {
      cx.moveTo(segs[i]!, segs[i + 1]!);
      cx.lineTo(segs[i + 2]!, segs[i + 3]!);
    }
    cx.stroke();
  };
  stroke(cx, rgb, 0.2, 0.6);
  draw(back);
  stroke(cx, rgb, 0.86, 0.85);
  draw(front);
  stroke(cx, rgb, 0.9, 1.05);
  cx.beginPath();
  cx.arc(x, y, r, 0, TAU);
  cx.stroke();
}

/** A corona: `n` rays from `r0`, every other one shorter, a slow wave running round them. */
function rays(cx: CanvasRenderingContext2D, x: number, y: number, r0: number, rgb: string, n: number, len: number, t: number, alt: number, rot = 0): void {
  cx.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const a = rot + (i * TAU) / n;
    const w = 0.5 + 0.5 * Math.sin(t * 1.2 + i * 1.9);
    const l = len * (i % 2 ? alt : 1) * (0.7 + 0.3 * w);
    cx.strokeStyle = `rgba(${rgb},${0.35 + 0.5 * w})`;
    cx.beginPath();
    cx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    cx.lineTo(x + Math.cos(a) * (r0 + l), y + Math.sin(a) * (r0 + l));
    cx.stroke();
  }
}

/** Rings leaving the star and fading: its wind, or a pulsar's pulse. */
function waves(cx: CanvasRenderingContext2D, x: number, y: number, r0: number, r1: number, rgb: string, n: number, t: number, speed: number, a: number): void {
  cx.lineWidth = 1;
  for (let k = 0; k < n; k++) {
    const f = ((k + t * speed) % n) / n;
    cx.strokeStyle = `rgba(${rgb},${a * (1 - f)})`;
    cx.beginPath();
    cx.arc(x, y, r0 + (r1 - r0) * f, 0, TAU);
    cx.stroke();
  }
}

export function drawStar(cx: CanvasRenderingContext2D, x: number, y: number, r: number, cls: StarClass, clockMs: number): void {
  const t = clockMs / 1000;
  const rgb = COLOR[cls];
  cx.save();
  cx.lineCap = 'round';
  switch (cls) {
    case 'yellow_dwarf':
      wire(cx, x, y, r, rgb, t * 0.3);
      rays(cx, x, y, r * 1.18, rgb, 16, r * 0.45, t, 0.55);
      break;
    case 'red_giant': {
      const g = r * 1.5 * (1 + 0.04 * Math.sin(t * 0.6)); // a giant breathes, slowly
      wire(cx, x, y, g, rgb, t * 0.08);
      rays(cx, x, y, g * 1.08, rgb, 28, r * 0.16, t, 0.6);
      break;
    }
    case 'blue_giant': {
      const g = r * 1.2;
      waves(cx, x, y, g, g * 2, rgb, 4, t, 0.35, 0.35);
      wire(cx, x, y, g, rgb, t * 0.5);
      rays(cx, x, y, g * 1.15, rgb, 8, r * 0.9, t, 0.35, Math.PI / 8);
      break;
    }
    case 'white_dwarf':
      wire(cx, x, y, r * 0.5, rgb, t * 0.9);
      cx.setLineDash([3, 5]);
      cx.lineDashOffset = -t * 5;
      stroke(cx, rgb, 0.4, 0.8);
      cx.beginPath();
      cx.arc(x, y, r * 1.1, 0, TAU);
      cx.stroke();
      break;
    case 'pulsar': {
      waves(cx, x, y, r * 0.4, r * 1.9, rgb, 3, t, 0.9, 0.5);
      const a = t * 1.4;
      stroke(cx, rgb, 0.7, 1);
      cx.beginPath();
      for (const d of [1, -1]) {
        for (const o of [-0.09, 0.09]) {
          cx.moveTo(x, y);
          cx.lineTo(x + Math.cos(a + o) * d * r * 2.6, y + Math.sin(a + o) * d * r * 1.3);
        }
      }
      cx.stroke();
      wire(cx, x, y, r * 0.36, rgb, t * 3);
      break;
    }
    case 'binary': {
      const o = r * 1.5;
      const at = (ang: number, rad: number): [number, number] => {
        const ex = Math.cos(ang) * rad;
        const ey = Math.sin(ang) * rad * 0.45;
        return [x + ex * Math.cos(-0.3) - ey * Math.sin(-0.3), y + ex * Math.sin(-0.3) + ey * Math.cos(-0.3)];
      };
      cx.setLineDash([4, 5]);
      stroke(cx, '127,227,255', 0.35, 0.8);
      cx.beginPath();
      cx.ellipse(x, y, o, o * 0.45, -0.3, 0, TAU);
      cx.stroke();
      cx.setLineDash([]);
      const [a, b] = [at(t * 0.45 + Math.PI, o * 0.6), at(t * 0.45, o)];
      wire(cx, a[0], a[1], r * 0.62, rgb, t * 0.3);
      rays(cx, a[0], a[1], r * 0.74, rgb, 12, r * 0.22, t, 0.55);
      wire(cx, b[0], b[1], r * 0.38, COLOR.companion, t * 0.6);
      break;
    }
  }
  cx.restore();
}

/** Decorative map material. Inputs contain visible geometry, never simulation state. */
import { rgba } from '../../packages/client/src/holoDraw';
import { holographicTheme as theme } from '../../packages/client/src/theme';
import type { ProvincePolygon } from '../../packages/client/src/provinceSelection';
import type { HoloRect } from './holographicLayout';

export interface TerrainField {
  id: string;
  kind: string;
  color: string;
  poly: ProvincePolygon;
  box: HoloRect;
  phase: number;
}

const TERRAIN_KINDS = new Set([
  'asteroid',
  'nebula',
  'dense_nebula',
  'ion_storm',
  'solar_flare',
  'graveyard',
  'dead_world',
  'debris_field',
]);

/** Only these decorative terrain families replace their old standalone glyph. */
export const hasTerrainMaterial = (kind: string): boolean => TERRAIN_KINDS.has(kind);

/** Unknown terrain remains under the same fog as its former floating type badge. */
export function makeTerrainField(
  id: string,
  kind: string,
  color: string,
  poly: ProvincePolygon,
  discovered: boolean,
): TerrainField | null {
  if (!discovered || !hasTerrainMaterial(kind) || poly.length < 3) return null;
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(...xs) - x;
  const height = Math.max(...ys) - y;
  if (width < 18 || height < 18) return null;
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { id, kind, color, poly, box: { x, y, width, height }, phase: (hash % 1000) / 1000 };
}

function polygon(g: CanvasRenderingContext2D, poly: ProvincePolygon): void {
  g.beginPath();
  poly.forEach(([x, y], i) => {
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  });
  g.closePath();
}

function glassPath(g: CanvasRenderingContext2D, r: HoloRect, offset = 0): void {
  const x = r.x + offset;
  const y = r.y + offset;
  const w = r.width;
  const h = r.height;
  const radius = Math.min(20, w / 4, h / 4);
  g.beginPath();
  g.moveTo(x + radius, y);
  g.lineTo(x + w - radius, y);
  g.quadraticCurveTo(x + w, y, x + w, y + radius);
  g.lineTo(x + w, y + h - radius);
  g.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  g.lineTo(x + radius, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - radius);
  g.lineTo(x, y + radius);
  g.quadraticCurveTo(x, y, x + radius, y);
  g.closePath();
}

/** Cached with the political map, including its world-boundary projection. */
export function drawGlassScreen(g: CanvasRenderingContext2D, frame: HoloRect, glow: boolean): void {
  g.save();
  glassPath(g, frame);
  const wash = g.createLinearGradient(
    frame.x,
    frame.y,
    frame.x + frame.width,
    frame.y + frame.height,
  );
  wash.addColorStop(0, rgba(theme.surface, 0.3));
  wash.addColorStop(0.45, rgba(theme.surface, 0.04));
  wash.addColorStop(1, rgba(theme.surface, 0.2));
  g.fillStyle = wash;
  g.fill();
  g.strokeStyle = rgba(theme.cyan, 0.72);
  g.lineWidth = 1.2;
  g.shadowColor = theme.cyan;
  g.shadowBlur = glow ? 10 : 0;
  g.stroke();
  g.shadowBlur = 0;
  glassPath(g, frame, 5);
  g.strokeStyle = rgba(theme.reflection, 0.24);
  g.lineWidth = 0.7;
  g.stroke();
  g.restore();
}

const fraction = (n: number): number => n - Math.floor(n);

/** Different geometry, not just different colours, makes each terrain family legible. */
export function drawTerrainField(
  g: CanvasRenderingContext2D,
  field: TerrainField,
  clock = 0,
  live = false,
): void {
  const { box: b, phase, kind, color } = field;
  g.save();
  polygon(g, field.poly);
  g.clip();
  g.lineWidth = 0.8;
  const drift = Math.sin(clock / 14000 + phase * 6.28) * 0.035;
  if (kind === 'nebula' || kind === 'dense_nebula') {
    const dense = kind === 'dense_nebula';
    const count = live ? 2 : dense ? 9 : 5;
    g.strokeStyle = rgba(color, live ? 0.1 : dense ? 0.17 : 0.12);
    for (let i = 0; i < count; i++) {
      const y = b.y + b.height * ((i + 1) / (count + 1) + (live ? drift : 0));
      const curl = b.height * (0.1 + 0.07 * Math.sin(i * 1.7 + phase * 6.28));
      g.beginPath();
      g.moveTo(b.x - 5, y);
      g.bezierCurveTo(
        b.x + b.width * 0.24,
        y - curl,
        b.x + b.width * 0.58,
        y + curl * 1.6,
        b.x + b.width + 5,
        y - curl * 0.4,
      );
      g.stroke();
    }
  } else if (kind === 'ion_storm') {
    g.strokeStyle = rgba(color, live ? 0.1 + 0.06 * Math.sin(clock / 4300 + phase * 6.28) : 0.19);
    for (let i = 0; i < (live ? 1 : 3); i++) {
      let x = b.x + b.width * (0.2 + i * 0.27 + (live ? drift : 0));
      g.beginPath();
      g.moveTo(x, b.y - 3);
      for (let j = 1; j < 8; j++) {
        x += Math.sin(j * 4.1 + phase * 9 + i) * b.width * 0.16;
        g.lineTo(x, b.y + (b.height * j) / 7);
      }
      g.stroke();
    }
  } else if (kind === 'solar_flare') {
    g.strokeStyle = rgba(color, live ? 0.12 : 0.18);
    for (let i = 0; i < (live ? 2 : 7); i++) {
      const y = b.y + b.height * ((i + 1) / (live ? 3 : 8) + (live ? drift : 0));
      g.beginPath();
      g.moveTo(b.x - 5, y + b.height * 0.22);
      g.bezierCurveTo(
        b.x + b.width * 0.38,
        y + b.height * 0.12,
        b.x + b.width * 0.7,
        y - b.height * 0.16,
        b.x + b.width + 5,
        y - b.height * 0.25,
      );
      g.stroke();
    }
  } else {
    // Asteroid belts use closed rock contours; wreck fields use broken angular ribs.
    const rocks = kind === 'asteroid' || kind === 'dead_world';
    const count = live ? 4 : rocks ? 20 : 15;
    g.strokeStyle = rgba(color, live ? 0.12 : 0.24);
    for (let i = 0; i < count; i++) {
      const x = b.x + b.width * fraction(i * 0.618 + phase + (live ? drift : 0));
      const y = b.y + b.height * fraction(i * 0.381 + phase * 1.7);
      const size = Math.min(8, Math.max(2, b.width * 0.016)) * (0.65 + fraction(i * 0.72));
      g.beginPath();
      g.moveTo(x - size, y - size * 0.3);
      g.lineTo(x - size * 0.3, y - size * 0.8);
      g.lineTo(x + size, y - size * 0.1);
      g.lineTo(x + size * 0.45, y + size * 0.7);
      if (rocks) g.closePath();
      g.stroke();
    }
    if (kind === 'dead_world' && !live) {
      g.strokeStyle = rgba(color, 0.18);
      g.setLineDash([2, 7]);
      g.beginPath();
      g.ellipse(
        b.x + b.width * 0.5,
        b.y + b.height * 0.5,
        b.width * 0.3,
        b.height * 0.2,
        -0.4,
        0,
        Math.PI * 2,
      );
      g.stroke();
    }
  }
  g.restore();
}

/** A gentle refresh of the glass, separate from sensor sweeps and contact memory. */
export function drawGlassWave(
  g: CanvasRenderingContext2D,
  frame: HoloRect,
  width: number,
  height: number,
  clock: number,
): void {
  const phase = (clock % 26000) / 26000;
  if (phase > 0.7) return;
  const y = -height * 0.45 + (phase / 0.7) * height * 1.9;
  const opacity = Math.sin((phase / 0.7) * Math.PI) * 0.06;
  g.save();
  g.beginPath();
  g.rect(frame.x, frame.y, frame.width, frame.height);
  g.clip();
  g.strokeStyle = rgba(theme.reflection, opacity);
  g.lineWidth = 26;
  g.beginPath();
  g.moveTo(0, y);
  g.bezierCurveTo(width * 0.3, y - 65, width * 0.7, y + 125, width, y + 20);
  g.stroke();
  g.strokeStyle = rgba(theme.cyan, opacity * 1.3);
  g.lineWidth = 1;
  g.stroke();
  g.restore();
}

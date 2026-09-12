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

/** Soft volume is rasterized only with the cached map, never in the live pass. */
function terrainGlow(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  angle: number,
  color: string,
  opacity: number,
): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(width, height);
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  glow.addColorStop(0, rgba(color, opacity));
  glow.addColorStop(0.38, rgba(color, opacity * 0.55));
  glow.addColorStop(1, rgba(color, 0));
  g.fillStyle = glow;
  g.fillRect(-1, -1, 2, 2);
  g.restore();
}

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
    if (!live) {
      for (let i = 0; i < 3; i++) {
        terrainGlow(
          g,
          b.x + b.width * (0.2 + i * 0.3),
          b.y + b.height * (0.36 + Math.sin(i * 2.4 + phase * 6.28) * 0.18),
          b.width * 0.44,
          b.height * (dense ? 0.34 : 0.23),
          Math.sin(i + phase * 6.28) * 0.5,
          color,
          dense ? 0.19 : 0.14,
        );
      }
    }
    const count = live ? 2 : dense ? 9 : 5;
    g.strokeStyle = rgba(color, live ? 0.16 : dense ? 0.17 : 0.12);
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
    const charge = live ? 0.14 + 0.08 * Math.sin(clock / 4300 + phase * 6.28) : 0.24;
    for (let i = 0; i < (live ? 1 : 3); i++) {
      let x = b.x + b.width * (0.2 + i * 0.27 + (live ? drift : 0));
      g.beginPath();
      g.moveTo(x, b.y - 3);
      for (let j = 1; j < 8; j++) {
        x += Math.sin(j * 4.1 + phase * 9 + i) * b.width * 0.16;
        g.lineTo(x, b.y + (b.height * j) / 7);
      }
      if (!live) {
        g.strokeStyle = rgba(color, 0.055);
        g.lineWidth = 5;
        g.stroke();
      }
      g.strokeStyle = rgba(color, charge);
      g.lineWidth = live ? 1.1 : 0.8;
      g.stroke();
    }
  } else if (kind === 'solar_flare') {
    if (!live) {
      terrainGlow(
        g,
        b.x + b.width * 0.5,
        b.y + b.height * 0.52,
        b.width * 0.58,
        b.height * 0.2,
        -0.35,
        color,
        0.16,
      );
    }
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
      if (!live && i % 2 === 0) {
        g.strokeStyle = rgba(color, 0.035);
        g.lineWidth = 5;
        g.stroke();
      }
      g.strokeStyle = rgba(color, live ? 0.2 : 0.18);
      g.lineWidth = live ? 1 : 0.8;
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
      g.save();
      g.translate(x, y);
      g.rotate(phase * 6.28 + i * 1.7);
      g.beginPath();
      if (rocks) {
        g.moveTo(-size, -size * 0.3);
        g.lineTo(-size * 0.3, -size * 0.8);
        g.lineTo(size, -size * 0.1);
        g.lineTo(size * 0.45, size * 0.7);
        g.closePath();
        if (!live) {
          g.fillStyle = rgba(color, 0.06);
          g.fill();
        }
      } else {
        // Parallel fragments read as broken hulls, rather than loose asteroids.
        const length = kind === 'graveyard' ? 1.7 : 1;
        g.moveTo(-size * length, -size * 0.35);
        g.lineTo(size * length, -size * 0.35);
        g.lineTo(size * 0.65, size * 0.5);
        g.moveTo(-size * 0.4, size * 0.5);
        g.lineTo(size * 0.25, size * 0.5);
      }
      g.stroke();
      g.restore();
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

/** Cool thin-film reflection on the glass, unrelated to sensors or game events.
 * Wide translucent shoulders and fine caustics use gradients instead of per-frame
 * blur. The existing visual clock owns pause/reduced motion; nothing ticks here. */
export function drawGlassWave(
  g: CanvasRenderingContext2D,
  frame: HoloRect,
  width: number,
  height: number,
  clock: number,
  glow = true,
): void {
  if (width <= 0 || height <= 0 || frame.width <= 0 || frame.height <= 0) return;
  const phase = ((Math.max(0, clock) + 4200) % 22000) / 22000;
  const envelope = Math.sin(phase * Math.PI) ** 1.3;
  if (envelope < 0.01) return;
  const y = height * (-0.42 + phase * 1.84);
  const bend = Math.sin(clock / 5700) * Math.min(38, height * 0.045);
  const shoulder = Math.min(126, Math.max(74, height * 0.13));
  const drift = Math.sin(clock / 6900) * 0.09;
  g.save();
  // Use the same rounded world frame as the underlying screen, even after a pan.
  glassPath(g, frame);
  g.clip();
  g.globalCompositeOperation = 'screen';
  g.lineCap = 'round';
  // Only cool wavelengths: cyan, blue, violet and a pearlescent white crest.
  const spectrum = g.createLinearGradient(0, 0, width, 0);
  spectrum.addColorStop(0, '#4986df');
  spectrum.addColorStop(0.19 + drift, '#68eadf');
  spectrum.addColorStop(0.38 + drift, '#69bcff');
  spectrum.addColorStop(0.58 + drift, '#b6a7ff');
  spectrum.addColorStop(0.79 + drift, '#bdf8ff');
  spectrum.addColorStop(1, '#4b9ce5');
  const trace = (offset: number, flex = 0): void => {
    g.beginPath();
    g.moveTo(-40, y + height * 0.10 + offset);
    g.bezierCurveTo(
      width * 0.28, y - height * 0.13 + offset + bend + flex,
      width * 0.69, y + height * 0.16 + offset - bend - flex,
      width + 40, y - height * 0.08 + offset,
    );
  };
  g.strokeStyle = spectrum;
  if (glow) {
    // The broad reflection trails its leading edge rather than looking like a scan bar.
    // Small Gaussian increments avoid hard, nested translucent stripes.
    let previous = 0;
    for (let i = 0; i < 18; i++) {
      const radius = shoulder * 0.9 * (1 - i / 18);
      const density = Math.exp(-0.5 * (radius / (shoulder * 0.24)) ** 2);
      g.globalAlpha = envelope * (density - previous) * 0.34;
      g.lineWidth = radius * 2;
      trace(-radius * 0.18);
      g.stroke();
      previous = density;
    }
    // Two grazing reflections gently separate and reunite like a thin optical film.
    for (const [offset, flex, alpha] of [
      [-10, Math.sin(clock / 4100) * 19, 0.19],
      [7, Math.cos(clock / 5300) * 13, 0.13],
    ] as const) {
      g.globalAlpha = envelope * alpha;
      g.lineWidth = 1.1;
      trace(offset, flex);
      g.stroke();
    }
  }
  g.globalAlpha = envelope * (glow ? 0.6 : 0.2);
  g.lineWidth = 1.45;
  trace(0);
  g.stroke();
  if (glow) {
    // A soft travelling specular highlight; no blinking sparks or full-screen flash.
    const glint = g.createLinearGradient(0, 0, width, 0);
    const at = 0.48 + Math.sin(clock / 4600) * 0.26;
    glint.addColorStop(0, 'rgba(217,251,255,0)');
    glint.addColorStop(at - 0.2, 'rgba(217,251,255,0)');
    glint.addColorStop(at, 'rgba(225,253,255,0.94)');
    glint.addColorStop(at + 0.2, 'rgba(217,251,255,0)');
    glint.addColorStop(1, 'rgba(217,251,255,0)');
    g.strokeStyle = glint;
    g.globalAlpha = envelope * 0.85;
    g.lineWidth = 2.2;
    g.stroke();
  }
  g.restore();
}

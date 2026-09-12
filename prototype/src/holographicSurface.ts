/** Decorative map material. Inputs contain visible geometry, never simulation state. */
import { rgba } from '../../packages/client/src/holoDraw';
import { holographicTheme as theme } from '../../packages/client/src/theme';
import type { ProvincePolygon } from '../../packages/client/src/provinceSelection';
import type { HoloRect } from './holographicLayout';
import { drawTerrainArt } from './holographicTerrainArt';

export interface TerrainField {
  id: string;
  kind: string;
  color: string;
  poly: ProvincePolygon;
  box: HoloRect;
  phase: number;
  marker?: { x: number; y: number };
  asteroids?: readonly AsteroidRock[];
}

interface AsteroidRock {
  x: number;
  y: number;
  radius: number;
  poly: ProvincePolygon;
}

const TERRAIN_KINDS = new Set([
  'planet',
  'empty',
  'void_station',
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
  marker?: { x: number; y: number },
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
  const box = { x, y, width, height };
  return {
    id, kind, color, poly, box, phase: (hash % 1000) / 1000, marker,
    ...(kind === 'asteroid' ? { asteroids: asteroidRocks(hash, poly, box, marker) } : {}),
  };
}

/** Seeded in province-local space, so camera rebakes never reshuffle the rocks. */
function asteroidRocks(
  seed: number,
  poly: ProvincePolygon,
  box: HoloRect,
  marker?: { x: number; y: number },
): AsteroidRock[] {
  let state = seed;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const scale = Math.min(box.width, box.height);
  const width = box.width / scale;
  const height = box.height / scale;
  const markerX = marker ? (marker.x - box.x) / scale : width / 2;
  const markerY = marker ? (marker.y - box.y) / scale : height / 2;
  const boundary = poly.map(([x, y]) => [(x - box.x) / scale, (y - box.y) / scale] as const);
  const inside = (x: number, y: number, radius: number): boolean => {
    let contained = false;
    for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
      const [ax, ay] = boundary[j]!;
      const [bx, by] = boundary[i]!;
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) {
        contained = !contained;
      }
      const dx = bx - ax;
      const dy = by - ay;
      const length2 = dx * dx + dy * dy;
      const t = length2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2)) : 0;
      // The whole silhouette stays inside, including beside a concave boundary.
      if (Math.hypot(x - ax - t * dx, y - ay - t * dy) < radius + 0.012) return false;
    }
    return contained;
  };
  const clusters = Array.from({ length: 3 }, () => ({
    x: width * (0.18 + random() * 0.64),
    y: height * (0.18 + random() * 0.64),
    spread: 0.13 + random() * 0.13,
  }));
  const rocks: AsteroidRock[] = [];
  // A few large bodies, irregular clumps and scattered chips, with breathing room.
  for (let i = 0; i < 210 && rocks.length < 44; i++) {
    const cluster = clusters[Math.floor(random() * clusters.length)]!;
    const theta = random() * Math.PI * 2;
    const spread = Math.sqrt(random()) * cluster.spread;
    const clustered = random() < 0.72;
    const x = clustered ? cluster.x + Math.cos(theta) * spread : random() * width;
    const y = clustered ? cluster.y + Math.sin(theta) * spread : random() * height;
    const size = random();
    const radius = size < 0.16 ? 0.033 + random() * 0.017
      : size < 0.56 ? 0.014 + random() * 0.015 : 0.004 + random() * 0.007;
    // The actual survey node can sit off-centre in a weighted Voronoi province.
    if (Math.hypot((x - markerX) / width, (y - markerY) / height) < 0.15 + radius) continue;
    if (!inside(x, y, radius)) continue;
    const px = box.x + x * scale;
    const py = box.y + y * scale;
    const r = radius * scale;
    if (rocks.some((rock) => Math.hypot(px - rock.x, py - rock.y) < (r + rock.radius) * 1.25)) continue;
    const rotation = random() * Math.PI * 2;
    const corners = 5 + Math.floor(random() * 4);
    const shape = Array.from({ length: corners }, (_, corner) => {
      const angle = rotation + ((corner + random() * 0.35) / corners) * Math.PI * 2;
      const reach = r * (0.67 + random() * 0.33);
      return [px + Math.cos(angle) * reach, py + Math.sin(angle) * reach] as const;
    });
    rocks.push({ x: px, y: py, radius: r, poly: shape });
  }
  return rocks;
}

/** All rock shading is cached; no drifting duplicate glyphs in the animation pass. */
function drawAsteroids(g: CanvasRenderingContext2D, rocks: readonly AsteroidRock[]): void {
  for (const rock of rocks) {
    polygon(g, rock.poly);
    g.fillStyle = rgba('#354855', 0.72);
    g.fill();
    g.strokeStyle = rgba('#a1b9c8', 0.5);
    g.lineWidth = Math.min(0.9, Math.max(0.4, rock.radius * 0.13));
    g.stroke();
    if (rock.radius < 2) continue;
    // Uneven triangulated faces catch a consistent cool light from the upper left.
    rock.poly.forEach(([x, y], i) => {
      const [nx, ny] = rock.poly[(i + 1) % rock.poly.length]!;
      const light = Math.max(0, (rock.x * 2 - x - nx + rock.y * 2 - y - ny) / (rock.radius * 3));
      g.beginPath();
      g.moveTo(rock.x - rock.radius * 0.12, rock.y + rock.radius * 0.07);
      g.lineTo(x, y);
      g.lineTo(nx, ny);
      g.closePath();
      g.fillStyle = rgba(light > 0.1 ? '#c4d8e2' : '#0d1b29', light > 0.1 ? light * 0.42 : 0.3);
      g.fill();
    });
  }
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
  if (frame.width <= 0 || frame.height <= 0) return;
  g.save();
  const depth = frame.width * 0.005;
  // A second, lower light plane gives the projection a visible thickness.
  // Both planes belong to the world rectangle and follow its camera transform.
  const lower = { ...frame, x: frame.x + depth * 0.28, y: frame.y + depth };
  glassPath(g, lower);
  g.fillStyle = rgba('#010b12', 0.2);
  g.fill();
  g.strokeStyle = rgba(theme.cyan, glow ? 0.19 : 0.1);
  g.lineWidth = 0.8;
  g.stroke();
  g.beginPath();
  for (const [x, y] of [
    [frame.x + 20, frame.y],
    [frame.x + frame.width - 20, frame.y],
    [frame.x + 20, frame.y + frame.height],
    [frame.x + frame.width - 20, frame.y + frame.height],
  ]) {
    g.moveTo(x!, y!);
    g.lineTo(x! + depth * 0.28, y! + depth);
  }
  g.stroke();
  glassPath(g, frame);
  const wash = g.createLinearGradient(
    frame.x,
    frame.y,
    frame.x + frame.width,
    frame.y + frame.height,
  );
  wash.addColorStop(0, rgba('#143f4c', 0.23));
  wash.addColorStop(0.45, rgba('#071f2c', 0.12));
  wash.addColorStop(1, rgba('#153c49', 0.2));
  g.fillStyle = wash;
  g.fill();
  g.strokeStyle = rgba(theme.cyan, 0.46);
  g.lineWidth = 1;
  g.shadowColor = theme.cyan;
  g.shadowBlur = glow ? 7 : 0;
  g.stroke();
  g.shadowBlur = 0;
  glassPath(g, frame, 5);
  g.strokeStyle = rgba(theme.reflection, 0.12);
  g.lineWidth = 0.7;
  g.stroke();
  g.save();
  glassPath(g, frame);
  g.clip();
  const spacing = frame.width / 40;
  // Faint plotting lines sit in the same plane, rather than on the viewport.
  g.strokeStyle = rgba(theme.cyan, 0.04);
  g.lineWidth = 0.55;
  g.beginPath();
  for (let x = frame.x + spacing; x < frame.x + frame.width; x += spacing) {
    g.moveTo(x, frame.y);
    g.lineTo(x, frame.y + frame.height);
  }
  for (let y = frame.y + spacing; y < frame.y + frame.height; y += spacing) {
    g.moveTo(frame.x, y);
    g.lineTo(frame.x + frame.width, y);
  }
  g.stroke();
  g.restore();
  // Registration marks on the rim make this read as a deployed tactical surface.
  g.strokeStyle = rgba(theme.cyan, 0.32);
  g.lineWidth = 0.9;
  g.beginPath();
  for (let i = 1; i < 40; i++) {
    const x = frame.x + spacing * i;
    const tick = frame.width * (i % 5 === 0 ? 0.003 : 0.0015);
    g.moveTo(x, frame.y + 3);
    g.lineTo(x, frame.y + 3 + tick);
    g.moveTo(x, frame.y + frame.height - 3);
    g.lineTo(x, frame.y + frame.height - 3 - tick);
  }
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
  if (drawTerrainArt(g, field, clock, live)) return;
  // Actual celestial nodes retain their original wire renderers.
  if (field.kind === 'planet' || field.kind === 'empty' || field.kind === 'void_station') return;
  const { box: b, phase, kind, color } = field;
  if (kind === 'asteroid' && live) return;
  g.save();
  polygon(g, field.poly);
  g.clip();
  g.lineWidth = 0.8;
  const drift = Math.sin(clock / 14000 + phase * 6.28) * 0.035;
  if (kind === 'asteroid') {
    drawAsteroids(g, field.asteroids ?? []);
  } else if (kind === 'nebula' || kind === 'dense_nebula') {
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
    // Dead worlds use closed rock contours; wreck fields use broken angular ribs.
    const rocks = kind === 'dead_world';
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

/** Faint, fixed-anchor interference along the world plane's rim, not free particles. */
export function drawGlassRim(
  g: CanvasRenderingContext2D, frame: HoloRect, clock: number, glow = true,
): void {
  if (frame.width <= 0 || frame.height <= 0) return;
  const colors = ['#78cfe8', '#829ee5', '#a39bdc'];
  const time = Math.max(0, clock) / 1000;
  const thickness = Math.min(frame.width, frame.height);
  g.save();
  g.globalCompositeOperation = 'screen';
  g.lineCap = 'round';
  for (let color = 0; color < colors.length; color++) {
    g.beginPath();
    for (let edge = 0; edge < 4; edge++) {
      for (let i = color; i < 18; i += colors.length) {
        const phase = i * 2.39996 + edge * 4.13;
        const center = 0.045 + (i / 17) * 0.91;
        const life = 0.5 + 0.5 * Math.sin(time * 0.78 + phase);
        const reach = 0.003 + life * 0.007;
        for (let j = 0; j <= 8; j++) {
          const along = center + ((j - 4) / 4) * reach;
          const envelope = Math.sin((j / 8) * Math.PI);
          const boil = Math.sin(j * 1.62 + time * 1.65 + phase) *
            Math.sin(j * 0.61 - time * 0.82 + phase);
          const normal = envelope * (0.0007 + life * 0.0028) * boil;
          const x = edge % 2 === 0 ? along : (edge === 1 ? 1 : 0) + normal;
          const y = edge % 2 === 0 ? (edge === 0 ? 0 : 1) + normal : along;
          const px = frame.x + x * frame.width;
          const py = frame.y + y * frame.height;
          if (j === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
      }
    }
    g.strokeStyle = colors[color]!;
    if (glow) {
      g.globalAlpha = 0.045;
      g.lineWidth = thickness * 0.008;
      g.stroke();
      g.globalAlpha = 0.075;
      g.lineWidth = thickness * 0.003;
      g.stroke();
    }
    g.globalAlpha = (glow ? 0.24 : 0.085) * (0.8 + 0.2 * Math.sin(time * 0.63 + color * 2.1));
    g.lineWidth = thickness * 0.00085;
    g.stroke();
  }
  g.restore();
}

/** Subtle interference on the world plane. Every point and stroke width is world-
 * relative: camera translation/zoom carries the reflection along with the map. */
export function drawGlassWave(
  g: CanvasRenderingContext2D,
  frame: HoloRect,
  width: number,
  height: number,
  clock: number,
  glow = true,
): void {
  if (width <= 0 || height <= 0 || frame.width <= 0 || frame.height <= 0) return;
  const phase = ((Math.max(0, clock) + 8000) % 52000) / 52000;
  const envelope = Math.sin(phase * Math.PI) ** 2;
  if (envelope < 0.004) return;
  const w = frame.width;
  const h = frame.height;
  const y = frame.y + h * (-0.15 + phase * 1.3);
  const bend = Math.sin(clock / 11000) * h * 0.008;
  const shoulder = h * 0.018;
  g.save();
  glassPath(g, frame);
  g.clip();
  g.globalCompositeOperation = 'screen';
  g.lineCap = 'round';
  const spectrum = g.createLinearGradient(frame.x, 0, frame.x + w, 0);
  spectrum.addColorStop(0, '#4f90ba');
  spectrum.addColorStop(0.35, '#89d7e1');
  spectrum.addColorStop(0.7, '#9a9cdc');
  spectrum.addColorStop(1, '#69bad2');
  const trace = (offset: number): void => {
    g.beginPath();
    g.moveTo(frame.x - w * 0.02, y + h * 0.025 + offset);
    g.bezierCurveTo(
      frame.x + w * 0.28, y - h * 0.035 + bend + offset,
      frame.x + w * 0.69, y + h * 0.045 - bend + offset,
      frame.x + w * 1.02, y - h * 0.02 + offset,
    );
  };
  g.strokeStyle = spectrum;
  if (glow) {
    let previous = 0;
    for (let i = 0; i < 10; i++) {
      const radius = shoulder * (1 - i / 10);
      const density = Math.exp(-0.5 * (radius / (shoulder * 0.28)) ** 2);
      g.globalAlpha = envelope * (density - previous) * 0.045;
      g.lineWidth = radius * 2;
      trace(-radius * 0.16);
      g.stroke();
      previous = density;
    }
  }
  g.globalAlpha = envelope * (glow ? 0.11 : 0.055);
  g.lineWidth = w * 0.00032;
  trace(0);
  g.stroke();
  g.globalAlpha = envelope * (glow ? 0.035 : 0.015);
  g.lineWidth = w * 0.00017;
  trace(h * 0.0035);
  g.stroke();
  g.restore();
}

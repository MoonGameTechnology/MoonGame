/** Schematic light projected over visible province geometry; no simulation inputs. */
import type { ProvincePolygon } from "../../packages/client/src/provinceSelection";

export interface TerrainArtField {
  id: string;
  kind: string;
  poly: ProvincePolygon;
  box: { x: number; y: number; width: number; height: number };
  phase: number;
  marker?: { x: number; y: number };
  asteroids?: readonly {
    x: number;
    y: number;
    radius: number;
    poly?: ProvincePolygon;
  }[];
}

const COLORS: Readonly<Record<string, string>> = {
  asteroid: "#8ac6d5",
  nebula: "#8baceb",
  dense_nebula: "#aaa2e8",
  ion_storm: "#73dce9",
  solar_flare: "#c89ee8",
  debris_field: "#689caf",
  graveyard: "#8ab6c1",
  dead_world: "#929ac0",
};
const ANIMATED = new Set([
  "nebula",
  "dense_nebula",
  "ion_storm",
  "solar_flare",
]);

/** Smooth interior coverage, including concave boundaries. Outside is transparent. */
export function terrainEdgeAlpha(
  x: number,
  y: number,
  poly: ProvincePolygon,
  fade: number,
): number {
  let inside = false;
  let distance = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j]!;
    const [bx, by] = poly[i]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax)
      inside = !inside;
    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    const t = length2
      ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2))
      : 0;
    distance = Math.min(distance, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  if (!inside || poly.length < 3) return 0;
  const t = Math.min(1, distance / Math.max(0.001, fade));
  return t * t * (3 - 2 * t);
}

type Point = readonly [number, number];
interface Segment {
  a: Point;
  b: Point;
  alpha: number;
}
interface Geometry {
  lines: Segment[];
  glints: Segment[];
}
const fieldCache = new WeakMap<TerrainArtField, Geometry>();
const geometryCache = new Map<string, Geometry>();

function geometry(field: TerrainArtField): Geometry {
  const found = fieldCache.get(field);
  if (found) return found;
  const b = field.box;
  const local = ([x, y]: Point): Point => [
    (x - b.x) / b.width,
    (y - b.y) / b.height,
  ];
  const poly = field.poly.map(local);
  const marker = field.marker
    ? local([field.marker.x, field.marker.y])
    : ([0.5, 0.5] as const);
  const shape = poly
    .map(([x, y]) => `${Math.round(x * 10000)},${Math.round(y * 10000)}`)
    .join(";");
  // A camera translation changes floating-point roundoff, not the local marker.
  // Exact decimal strings here defeated the cache on almost every moved frame,
  // including the live pass that only needs four highlights.
  const markerKey = marker.map((n) => Math.round(n * 1e6)).join(",");
  const rockDetail = field.asteroids?.map((rock) => rock.radius > 2 ? '1' : '0').join('') ?? '';
  const key = `${field.id}:${field.kind}:${field.phase}:${shape}:${markerKey}:${rockDetail}`;
  let result = geometryCache.get(key);
  if (result) {
    fieldCache.set(field, result);
    return result;
  }
  const lines: Segment[] = [];
  const line = (a: Point, z: Point, alpha = 0.3): void => {
    // Small segments give continuous edge attenuation without blurred raster masks.
    const pieces = Math.max(
      1,
      Math.ceil(Math.hypot(z[0] - a[0], z[1] - a[1]) / 0.028),
    );
    for (let i = 0; i < pieces; i++) {
      const p: Point = [
        a[0] + ((z[0] - a[0]) * i) / pieces,
        a[1] + ((z[1] - a[1]) * i) / pieces,
      ];
      const q: Point = [
        a[0] + ((z[0] - a[0]) * (i + 1)) / pieces,
        a[1] + ((z[1] - a[1]) * (i + 1)) / pieces,
      ];
      const x = (p[0] + q[0]) / 2;
      const y = (p[1] + q[1]) / 2;
      const edge = terrainEdgeAlpha(x, y, poly, 0.12);
      // Leave the actual survey node and its orders legible, even off-centre.
      const clearance = Math.min(
        1,
        Math.max(
          0.15,
          (Math.hypot(x - marker[0], y - marker[1]) - 0.035) / 0.1,
        ),
      );
      if (edge > 0.002)
        lines.push({ a: p, b: q, alpha: alpha * edge * clearance });
    }
  };
  const path = (points: readonly Point[], alpha = 0.3): void => {
    for (let i = 1; i < points.length; i++)
      line(points[i - 1]!, points[i]!, alpha);
  };
  const phase = field.phase * Math.PI * 2;
  let seed = 2166136261;
  for (const ch of field.id)
    seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  if (field.kind === "asteroid") {
    for (const [i, rock] of (field.asteroids ?? []).entries()) {
      const center = local([rock.x, rock.y]);
      const points =
        rock.poly?.map(local) ??
        Array.from({ length: 7 }, (_, j): Point => {
          const angle = phase + i * 2.4 + (j * Math.PI * 2) / 7;
          const reach = rock.radius * (0.73 + random() * 0.27);
          return [
            center[0] + (Math.cos(angle) * reach) / b.width,
            center[1] + (Math.sin(angle) * reach) / b.height,
          ];
        });
      path([...points, points[0]!], 0.53);
      // Transparent triangulation suggests depth; stars remain visible through it.
      if (rock.radius > 2) {
        const hub: Point = [
          center[0] - (rock.radius * 0.13) / b.width,
          center[1] + (rock.radius * 0.08) / b.height,
        ];
        for (let j = 0; j < points.length; j += 2) line(hub, points[j]!, 0.2);
        line(points[0]!, points[Math.floor(points.length / 2)]!, 0.11);
      }
    }
  } else if (field.kind === "nebula" || field.kind === "dense_nebula") {
    const dense = field.kind === "dense_nebula";
    const count = dense ? 8 : 5;
    for (let ring = 0; ring < count; ring++) {
      const radius = 0.14 + ring * (dense ? 0.047 : 0.065);
      const points = Array.from({ length: 57 }, (_, j): Point => {
        const a = (j * Math.PI * 2) / 56;
        const curl =
          1 + Math.sin(a * 3 + phase) * 0.13 + Math.cos(a * 5 - phase) * 0.055;
        return [
          0.5 + Math.cos(a) * radius * curl,
          0.48 +
            Math.sin(a) * radius * 0.69 * curl +
            Math.cos(a + phase) * 0.08,
        ];
      });
      path(points, dense ? 0.24 : 0.2);
    }
    // A second offset contour plane reads as projected volume, not a filled cloud.
    for (let band = 0; band < 3; band++) {
      path(
        Array.from({ length: 33 }, (_, j): Point => {
          const x = j / 32;
          return [
            x,
            0.26 + band * 0.19 + Math.sin(x * 5 + phase + band * 0.55) * 0.115,
          ];
        }),
        0.095,
      );
    }
  } else if (field.kind === "ion_storm") {
    for (let branch = 0; branch < 3; branch++) {
      const points = Array.from({ length: 9 }, (_, j): Point => [
        0.2 + branch * 0.29 + Math.sin(j * 2.8 + phase + branch) * 0.12,
        j / 8,
      ]);
      path(points, 0.29);
      for (let j = 2; j < points.length - 1; j += 2) {
        const p = points[j]!;
        path([p, [p[0] + 0.09, p[1] - 0.05], [p[0] + 0.14, p[1] - 0.16]], 0.14);
      }
    }
  } else if (field.kind === "solar_flare") {
    for (let band = 0; band < 7; band++) {
      path(
        Array.from({ length: 41 }, (_, j): Point => {
          const x = j / 40;
          return [
            x,
            0.1 +
              band * 0.13 +
              0.22 * Math.cos(x * Math.PI + phase * 0.13) +
              Math.sin(x * 7 + phase) * 0.025,
          ];
        }),
        band % 2 ? 0.16 : 0.26,
      );
    }
  } else if (field.kind === "dead_world") {
    for (let ring = 0; ring < 4; ring++) {
      const radius = 0.2 + ring * 0.057;
      const points = Array.from({ length: 39 }, (_, j): Point => {
        const a = phase + (j * Math.PI * 1.57) / 38 + ring * 0.6;
        return [
          marker[0] + Math.cos(a) * radius,
          marker[1] + Math.sin(a) * radius * 0.64,
        ];
      });
      path(points, ring % 2 ? 0.1 : 0.19);
    }
  } else {
    const graveyard = field.kind === "graveyard";
    for (let i = 0; i < (graveyard ? 11 : 22); i++) {
      const x = 0.08 + random() * 0.84;
      const y = 0.08 + random() * 0.84;
      if (
        terrainEdgeAlpha(x, y, poly, 0.12) < 0.3 ||
        Math.hypot(x - marker[0], y - marker[1]) < 0.16
      )
        continue;
      const length =
        (graveyard ? 0.026 : 0.009) + random() * (graveyard ? 0.045 : 0.02);
      const angle = random() * Math.PI * 2;
      const point = (u: number, v: number): Point => [
        x + (u * Math.cos(angle) - v * Math.sin(angle)) * length,
        y + (u * Math.sin(angle) + v * Math.cos(angle)) * length,
      ];
      if (graveyard) {
        path(
          [
            point(-1, -0.24),
            point(0.4, -0.24),
            point(1, 0),
            point(0.4, 0.3),
            point(-0.3, 0.3),
          ],
          0.38,
        );
        path([point(-0.8, 0.3), point(-1.1, 0.3), point(-1.1, -0.08)], 0.24);
        for (const rib of [-0.5, 0.05, 0.5])
          line(point(rib, -0.24), point(rib, 0.3), 0.18);
        line(point(-0.3, 0), point(0.8, 0), 0.16);
      } else {
        path([point(-1, 0), point(0.5, 0), point(0.8, 0.5)], 0.3);
        line(point(-0.5, 0.36), point(0.1, 0.36), 0.16);
      }
    }
  }
  const glints: Segment[] = [];
  if (ANIMATED.has(field.kind)) {
    // At most four short fixed-position highlights per province, no moving texture.
    for (let i = 0; i < 4 && lines.length; i++) {
      glints.push(
        lines[Math.floor(((i + 0.35 + field.phase * 0.3) * lines.length) / 4)]!,
      );
    }
  }
  result = { lines, glints };
  geometryCache.set(key, result);
  if (geometryCache.size > 96)
    geometryCache.delete(geometryCache.keys().next().value!);
  fieldCache.set(field, result);
  return result;
}

/** All geometry stays in province-local coordinates, including through camera rebakes.
 * The main map already caches the static pass. Live light uses its frozen visual clock. */
export function drawTerrainArt(
  g: CanvasRenderingContext2D,
  field: TerrainArtField,
  clock = 0,
  live = false,
): boolean {
  const color = COLORS[field.kind];
  if (!color) return false;
  const b = field.box;
  if (b.width <= 0 || b.height <= 0 || field.poly.length < 3) return true;
  if (live && !ANIMATED.has(field.kind)) return true;
  const art = geometry(field);
  const alpha = g.globalAlpha;
  g.save();
  g.beginPath();
  field.poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.clip();
  g.globalCompositeOperation = "screen";
  g.strokeStyle = color;
  g.lineWidth = live ? 0.85 : 0.7;
  g.lineCap = "round";
  const light = live
    ? 0.12 + 0.11 * (0.5 + Math.sin(clock / 7100 + field.phase * 6.28) * 0.5)
    : 1;
  for (const segment of live ? art.glints : art.lines) {
    g.globalAlpha = alpha * segment.alpha * light;
    g.beginPath();
    g.moveTo(b.x + segment.a[0] * b.width, b.y + segment.a[1] * b.height);
    g.lineTo(b.x + segment.b[0] * b.width, b.y + segment.b[1] * b.height);
    g.stroke();
  }
  g.restore();
  return true;
}

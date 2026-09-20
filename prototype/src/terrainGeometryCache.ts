/** Province-local terrain is prepared once, then only projected with the camera. */
import { makeTerrainField, type TerrainField } from './holographicSurface';
import type { ProvincePolygon } from '../../packages/client/src/provinceSelection';

export class TerrainGeometryCache {
  private entries = new Map<string, { key: string; field: TerrainField }>();

  constructor(private readonly limit = 2048) {}

  clear(): void {
    this.entries.clear();
  }

  prepare(
    id: string,
    kind: string,
    color: string,
    poly: ProvincePolygon,
    discovered: boolean,
    marker?: { x: number; y: number },
  ): TerrainField | null {
    if (!discovered || poly.length < 3) return null;
    const xs = poly.map((p) => p[0]),
      ys = poly.map((p) => p[1]);
    const x = Math.min(...xs),
      y = Math.min(...ys);
    const width = Math.max(...xs) - x,
      height = Math.max(...ys) - y;
    if (width <= 0 || height <= 0) return null;
    const scale = Math.min(width, height) / 128;
    const local = (px: number, py: number): [number, number] => [
      (px - x) / scale,
      (py - y) / scale,
    ];
    const shape = poly.map(([px, py]) => local(px, py));
    const at = marker ? local(marker.x, marker.y) : undefined;
    const q = (p: readonly number[]): string => p.map((v) => Math.round(v * 1e6)).join(',');
    const key = `${kind}:${color}:${shape.map(q).join(';')}:${at ? q(at) : ''}`;
    let entry = this.entries.get(id);
    if (entry?.key !== key) {
      const field = makeTerrainField(
        id,
        kind,
        color,
        shape,
        true,
        at ? { x: at[0], y: at[1] } : undefined,
      );
      if (!field) return null;
      entry = { key, field };
    }
    this.entries.delete(id);
    this.entries.set(id, entry);
    if (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    return entry.field;
  }

  project(
    id: string,
    kind: string,
    color: string,
    poly: ProvincePolygon,
    discovered: boolean,
    marker?: { x: number; y: number },
  ): TerrainField | null {
    const field = this.prepare(id, kind, color, poly, discovered, marker);
    if (!field) return null;
    const xs = poly.map((p) => p[0]),
      ys = poly.map((p) => p[1]);
    const x = Math.min(...xs),
      y = Math.min(...ys);
    const width = Math.max(...xs) - x,
      height = Math.max(...ys) - y;
    if (width < 18 || height < 18) return null;
    const scale = Math.min(width, height) / 128;
    const point = (px: number, py: number): [number, number] => [x + px * scale, y + py * scale];
    return {
      ...field,
      poly,
      box: { x, y, width, height },
      marker,
      ...(field.asteroids
        ? {
            asteroids: field.asteroids.map((r) => ({
              x: x + r.x * scale,
              y: y + r.y * scale,
              radius: r.radius * scale,
              poly: r.poly.map(([px, py]) => point(px, py)),
            })),
          }
        : {}),
    };
  }
}

import type {
  TerrainEnvironment,
  TerrainEnvironmentBox,
  TerrainEnvironmentFeature,
  TerrainEnvironmentTile,
  TerrainPoint,
} from '../../../decisions/terrainEnvironment';
import { rgba } from './holoDraw';

/** World → CSS pixels. Geometry and its seed are prepared before this projection exists. */
export interface TerrainEnvironmentProjection { scale: number; x: number; y: number }

function trace(
  g: CanvasRenderingContext2D,
  points: readonly TerrainPoint[],
  at: TerrainEnvironmentProjection,
  closed: boolean,
): void {
  if (points.length === 0) return;
  g.moveTo(points[0]![0] * at.scale + at.x, points[0]![1] * at.scale + at.y);
  for (let i = 1; i < points.length; i++) {
    g.lineTo(points[i]![0] * at.scale + at.x, points[i]![1] * at.scale + at.y);
  }
  if (closed) g.closePath();
}

/** One union mask, not a clip for every province. Interior administrative edges cannot
 * cut a rock or brighten overlapping fog masks. Planner polygons share one winding. */
function clipKnown(
  g: CanvasRenderingContext2D,
  polys: readonly (readonly TerrainPoint[])[],
  at: TerrainEnvironmentProjection,
): void {
  g.beginPath();
  for (const poly of polys) trace(g, poly, at, true);
  g.clip('nonzero');
}

function paintFeatures(
  g: CanvasRenderingContext2D,
  features: readonly TerrainEnvironmentFeature[],
  at: TerrainEnvironmentProjection,
  detail: number,
): void {
  g.lineJoin = 'round';
  g.lineCap = 'round';
  // Simplification fades small details in place; it never resamples the larger forms.
  const micro = Math.max(0, Math.min(1, detail));
  for (const feature of features) {
    const opacity = feature.detail === 'minor' ? micro : 1;
    if (opacity === 0) continue;
    for (const path of feature.paths) {
      if (path.points.length < 2) continue;
      const alpha = path.alpha * opacity;
      g.beginPath();
      trace(g, path.points, at, path.closed);
      // Rock silhouettes have a solid, restrained face. Gas remains open flowing bands;
      // wreck ribs and lightning keep their angular paths rather than becoming halos.
      if (path.closed) {
        g.fillStyle = rgba(feature.color, alpha * 0.14);
        g.fill();
      }
      if (feature.family === 'nebula' || feature.family === 'dust' || feature.family === 'storm') {
        g.strokeStyle = rgba(feature.color, alpha * 0.12);
        g.lineWidth = path.width + (feature.family === 'storm' ? 1.4 : 2.6);
        g.stroke();
      }
      g.strokeStyle = rgba(feature.color, alpha);
      g.lineWidth = path.width;
      g.stroke();
    }
  }
}

/** Draw a complete spatial tile into a caller-owned raster. Its objects may extend beyond
 * the spatial grid square; clip only against known geography, never that grid square.
 * The caller allocates tile.box plus a CSS-pixel stroke gutter and owns the bounded cache. */
export function drawTerrainEnvironmentTile(
  g: CanvasRenderingContext2D,
  tile: TerrainEnvironmentTile,
  at: TerrainEnvironmentProjection,
  detail = 1,
): void {
  if (tile.features.length === 0 || tile.clipPolygons.length === 0) return;
  g.save();
  clipKnown(g, tile.clipPolygons, at);
  paintFeatures(g, tile.features, at, detail);
  g.restore();
}

/** Shared direct painter. Political borders, routes and interaction marks are drawn by
 * the caller afterwards, above the environment. `view` is an optional CSS-pixel crop. */
export function drawTerrainEnvironment(
  g: CanvasRenderingContext2D,
  environment: TerrainEnvironment,
  at: TerrainEnvironmentProjection,
  detail = 1,
  view?: TerrainEnvironmentBox,
): void {
  if (environment.tiles.length === 0 || environment.clipPolygons.length === 0) return;
  g.save();
  clipKnown(g, environment.clipPolygons, at);
  for (const tile of environment.tiles) {
    if (view) {
      const x = tile.box.x * at.scale + at.x;
      const y = tile.box.y * at.scale + at.y;
      const right = x + tile.box.width * at.scale;
      const bottom = y + tile.box.height * at.scale;
      if (right < view.x - 3 || x > view.x + view.width + 3 ||
        bottom < view.y - 3 || y > view.y + view.height + 3) continue;
    }
    paintFeatures(g, tile.features, at, detail);
  }
  g.restore();
}

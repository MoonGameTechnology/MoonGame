/** Stationary space-lane mine: octagonal casing, four probes and a central sensor.
 * Native 24×24 geometry matching road-mine.webp, with no raster dependency.
 * The caller MUST filter fields through authoritative visibility before drawing.
 * This shape neither grants detection nor determines placement or arming time.
 */
export const MINE_SHAPE = {
  hull: 'M10 1H14V4H17L20 7V10H23V14H20V17L17 20H14V23H10V20H7L4 17V14H1V10H4V7L7 4H10Z',
  detail:
    'M10 4V7M14 4V7M17 10H20M17 14H20M10 17V20M14 17V20M4 10H7M4 14H7M7 7 9 9M15 9 17 7M7 17 9 15M15 15 17 17M16 12A4 4 0 1 1 8 12A4 4 0 1 1 16 12Z',
  sensor: 'M13.5 12A1.5 1.5 0 1 1 10.5 12A1.5 1.5 0 1 1 13.5 12Z',
} as const;

let paths: { hull: Path2D; detail: Path2D; sensor: Path2D } | undefined;

/** The caller owns position, colour, glow and visibility. No motion or engine plume.
 * Detail can be removed at low LOD without replacing the silhouette with a dot.
 */
export function drawMineShape(g: CanvasRenderingContext2D, detail: boolean): void {
  paths ??= {
    hull: new Path2D(MINE_SHAPE.hull),
    detail: new Path2D(MINE_SHAPE.detail),
    sensor: new Path2D(MINE_SHAPE.sensor),
  };
  g.lineJoin = 'round';
  g.lineWidth = 1.15;
  g.fill(paths.hull, 'evenodd');
  g.stroke(paths.hull);
  if (!detail) return;
  g.shadowBlur = 0;
  g.lineWidth = 0.65;
  g.stroke(paths.detail);
  g.fill(paths.sensor);
}

/** Stationary space-lane mine: spherical naval-mine casing and radial sensor horns.
 * Native 24×24 geometry matching road-mine.webp, with no raster dependency.
 * The caller MUST filter fields through authoritative visibility before drawing.
 * This shape neither grants detection nor determines placement or arming time.
 */
export const MINE_SHAPE = {
  hull: 'M10.9 .9H13.1L13.45 4.95C14.3 5.1 15.08 5.42 15.78 5.92L18.4 3.5 20.5 5.6 18.08 8.22C18.58 8.92 18.9 9.7 19.05 10.55L23.1 10.9V13.1L19.05 13.45C18.9 14.3 18.58 15.08 18.08 15.78L20.5 18.4 18.4 20.5 15.78 18.08C15.08 18.58 14.3 18.9 13.45 19.05L13.1 23.1H10.9L10.55 19.05C9.7 18.9 8.92 18.58 8.22 18.08L5.6 20.5 3.5 18.4 5.92 15.78C5.42 15.08 5.1 14.3 4.95 13.45L.9 13.1V10.9L4.95 10.55C5.1 9.7 5.42 8.92 5.92 8.22L3.5 5.6 5.6 3.5 8.22 5.92C8.92 5.42 9.7 5.1 10.55 4.95Z',
  detail:
    'M19.2 12A7.2 7.2 0 1 1 4.8 12A7.2 7.2 0 1 1 19.2 12ZM12 4.8C7.8 7 7.8 17 12 19.2M12 4.8C16.2 7 16.2 17 12 19.2M5.4 9.1C9 11.4 15 11.4 18.6 9.1M5.4 14.9C9 17.2 15 17.2 18.6 14.9',
  sensor: 'M12 1.8V3.1M18.5 5.5 17.6 6.4M20.9 12H22.2M18.5 18.5 17.6 17.6M12 20.9V22.2M5.5 18.5 6.4 17.6M1.8 12H3.1M5.5 5.5 6.4 6.4',
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
  g.lineWidth = 1.1;
  g.stroke(paths.sensor);
}

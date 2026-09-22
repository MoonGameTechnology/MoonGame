/** Presentation detail follows CSS-pixel spacing, not a map-specific zoom number. */
export const LOD_FROM = 1.2;
export const LOD_SPAN = 0.25;
const REFERENCE_GAP = 64;
const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export function detailAt(scale: number): number {
  return clamp01((scale - LOD_FROM) / LOD_SPAN);
}

export interface MapLod {
  /** Density-adjusted zoom, also used by orbit geometry and hit testing. */
  scale: number;
  /** Flat symbols → node artwork / static terrain, over a 32–64 CSS-pixel gap. */
  art: number;
  /** Labels, cargo, rings and decorative animation return only after the art. */
  detail: number;
  /** Inner borders, terrain tint and roads dissolve into political regions. */
  provinceDetail: number;
  markerRadius: number;
}

export function mapLod(gap: number, cameraScale = Infinity): MapLod {
  const scale = gap / REFERENCE_GAP;
  const overview = detailAt(cameraScale);
  const province = clamp01((gap - 40) / 56);
  return {
    scale,
    art: Math.min(clamp01((gap - 32) / 32), overview),
    detail: Math.min(detailAt(scale), overview),
    provinceDetail: Math.min(province * province * (3 - 2 * province), overview),
    markerRadius: Math.max(1.2, Math.min(3.2, gap * 0.09)),
  };
}

interface MapPoint {
  id: string;
  x: number;
  y: number;
  links?: readonly string[];
}

/** Median nearest-linked gap in map units. Compute once when geometry is installed.
 * Isolated black holes and broken links cannot skew the map's presentation density. */
export function mapSpacing(nodes: readonly MapPoint[]): number {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const gaps: number[] = [];
  for (const n of nodes) {
    let nearest = Infinity;
    for (const id of n.links ?? []) {
      const peer = byId.get(id);
      if (!peer) continue;
      const gap = Math.hypot(peer.x - n.x, peer.y - n.y);
      if (gap > 0) nearest = Math.min(nearest, gap);
    }
    if (Number.isFinite(nearest)) gaps.push(nearest);
  }
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? REFERENCE_GAP;
}

/** Every overview node has the same neutral ring. No kind, owner or memory input:
 * neither the shape nor the presence of a marker can disclose hidden contents. */
export function drawSchematicNode(
  g: CanvasRenderingContext2D,
  at: { x: number; y: number },
  radius: number,
): void {
  const { x, y } = at;
  g.strokeStyle = '#506773';
  g.lineWidth = 0.85;
  g.beginPath();
  g.arc(x, y, radius, 0, Math.PI * 2);
  g.stroke();
}

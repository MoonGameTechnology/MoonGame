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
  markerRadius: number;
}

export function mapLod(gap: number): MapLod {
  const scale = gap / REFERENCE_GAP;
  return {
    scale,
    art: clamp01((gap - 32) / 32),
    detail: detailAt(scale),
    markerRadius: Math.max(1.5, Math.min(4.5, gap * 0.12)),
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

/** A bounded-cost marker with no textures, text, shadows or procedural geometry.
 * The caller supplies only known terrain / ownership; unknown nodes stay anonymous. */
export function drawSchematicNode(
  g: CanvasRenderingContext2D,
  at: { x: number; y: number },
  kind: string,
  color: string,
  radius: number,
): void {
  const { x, y } = at;
  g.fillStyle = color;
  g.strokeStyle = color;
  g.lineWidth = 1;
  g.beginPath();
  if (kind === 'void_station' || kind === 'pirate_base' || kind === 'neutral_base') {
    g.moveTo(x, y - radius - 1);
    g.lineTo(x + radius + 1, y);
    g.lineTo(x, y + radius + 1);
    g.lineTo(x - radius - 1, y);
    g.closePath();
    g.stroke();
  } else if (kind === 'planet' || kind === 'dead_world' || kind === 'unknown') {
    g.arc(x, y, radius, 0, Math.PI * 2);
    g.stroke();
  } else {
    g.rect(x - radius / 2, y - radius / 2, radius, radius);
    g.fill();
  }
}

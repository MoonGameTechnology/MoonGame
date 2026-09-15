/** A finite, convex galaxy edge built once from snapshot geometry, independent of camera/fog. */
interface Point {
  x: number;
  y: number;
}
interface Node extends Point {
  id: string;
  links: readonly string[];
}

function hull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Point, b: Point, c: Point): number =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (list: Point[]): Point[] => {
    const out: Point[] = [];
    for (const point of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, point) <= 0)
        out.pop();
      out.push(point);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}

/** The rectangular canvas is a presentation surface, not the extent of rim provinces.
 * Expand the seed hull by half a typical lane, so all rim centres stay inside their
 * cells, without filling the empty corners of the galaxy's bounding rectangle.
 * A convex clip also keeps the power diagram's half-plane intersections connected. */
export function frontierOutline(nodes: readonly Node[]): Point[] {
  if (nodes.length < 3) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const gaps: number[] = [];
  for (const n of nodes)
    for (const id of n.links) {
      const peer = byId.get(id);
      if (peer && n.id < id) {
        const gap = Math.hypot(peer.x - n.x, peer.y - n.y);
        if (gap > 0) gaps.push(gap);
      }
    }
  gaps.sort((a, b) => a - b);
  const pad = (gaps[Math.floor(gaps.length / 2)] ?? 80) / 2;
  const outer = hull(nodes);
  return hull(
    outer.flatMap((p) =>
      Array.from({ length: 16 }, (_, i) => ({
        x: p.x + pad * Math.cos((i * Math.PI) / 8),
        y: p.y + pad * Math.sin((i * Math.PI) / 8),
      })),
    ),
  );
}

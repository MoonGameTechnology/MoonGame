/**
 * The ring round a body (owner 2026-11-18/19: «вокруг чёрной дыры должны быть непроходимые
 * провинции. И вокруг других таких объектов тоже»). A black hole stands inside its accretion
 * disk, a star inside the ring its class makes of the space next to it; every ring province
 * is impassable and closed to aviation (`data/sectorKinds.json`). A ring province is drawn
 * round its body, not round its own centre, so the ring reads as one piece.
 */

/** Ring kind → the kind of the province it rings. */
export const RING_BODY: Readonly<Record<string, 'black_hole' | 'star'>> = {
  accretion_disk: 'black_hole',
  corona: 'star',
  dust_shell: 'star',
  stellar_wind: 'star',
  planetary_nebula: 'star',
  pulsar_wind: 'star',
  circumbinary_disk: 'star',
};

/** Body → the kind of its ring: a black hole's accretion disk, or what a star's class (the
 *  star's `terrain`) makes of the space next to it. The author tool
 *  `scripts/celestial-rings.mjs` lays rings by the same table, and `data/celestialRings.test.ts`
 *  holds the shipped maps to this one. */
export const RING_OF: Readonly<Record<string, string>> = {
  black_hole: 'accretion_disk',
  yellow_dwarf: 'corona',
  red_giant: 'dust_shell',
  blue_giant: 'stellar_wind',
  white_dwarf: 'planetary_nebula',
  pulsar: 'pulsar_wind',
  binary_star: 'circumbinary_disk',
};

/** The kind of the ring round a province, or `undefined` when it is not a body. */
export function ringKindOf(sector: { readonly kind?: string; readonly terrain?: string }): string | undefined {
  if (sector.kind === 'black_hole') return RING_OF.black_hole;
  if (sector.kind === 'star' && sector.terrain !== undefined) return RING_OF[sector.terrain];
  return undefined;
}

/** Whether a province kind is a body's ring. */
export const isCelestialRing = (kind: string | undefined): kind is string =>
  kind !== undefined && Object.prototype.hasOwnProperty.call(RING_BODY, kind);

/** How far a body's ring reaches: the median distance from the body to the centres of the
 *  ring provinces drawn round it (`ringBodyOf`), or `undefined` when it has none. The median,
 *  so a lone disk province far off (a test map's scar) does not stretch it. */
export function ringReach<N extends { readonly x: number; readonly y: number; readonly sector: string }>(
  nodes: readonly N[],
  body: N,
): number | undefined {
  const reach: number[] = [];
  for (const n of nodes)
    if (isCelestialRing(n.sector) && ringBodyOf(nodes, n, n.sector) === body)
      reach.push(Math.hypot(n.x - body.x, n.y - body.y));
  if (!reach.length) return undefined;
  reach.sort((a, b) => a - b);
  const mid = reach.length >> 1;
  return reach.length % 2 ? reach[mid] : (reach[mid - 1]! + reach[mid]!) / 2;
}

/** The body a ring province is drawn round: the nearest province of the ring's body kind,
 *  or `undefined` when the map has none (an edited map), and the province falls back to
 *  its own centre. */
export function ringBodyOf<N extends { readonly x: number; readonly y: number; readonly sector: string }>(
  nodes: readonly N[],
  node: { readonly x: number; readonly y: number },
  kind: string,
): N | undefined {
  const body = RING_BODY[kind];
  let best: N | undefined;
  let bestD = Infinity;
  for (const n of nodes) {
    if (n.sector !== body) continue;
    const d = (n.x - node.x) ** 2 + (n.y - node.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}

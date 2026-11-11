/**
 * The free provinces of the large free-for-all maps (`generate-ffa.mjs`): an unsaturated
 * Poisson sample of the board, and the accretion disk laid round a black hole that has one.
 * Author tool, split out of the generator so neither outgrows the size guard (SLIM-1).
 */

// Spacing of the team maps (`generate-team-3v3.py`): pace per hop stays the same.
export const MIN_GAP = 355;
export const HOME_CLEAR = 480;
/** World area per province — the density of the 3v3 map (121 provinces in its ellipse). */
export const CELL_AREA = 252_000;
/** The black hole of a map with an accretion disk, in average provinces of area. */
const HEART_PROVINCES = 2;

export function rngFrom(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const pos = (s) => [s.position.x, s.position.y];

/**
 * The provinces the generator places freely, around the authored ones already in `sectors`:
 * an unsaturated Poisson sample drawn from the map's main stream `rnd`, varied sizes and
 * degrees, then — with `cfg.disk` — the accretion disk round the hole ({@link layDisk}).
 */
export function freeCells(cfg, total, rnd, board) {
  const { sectors, homes, inside, rx, ry } = board;
  const taken = Object.values(sectors).map(pos);
  const cells = [];
  for (let attempt = 0; attempt < total * 400 && taken.length < total; attempt++) {
    const p = [(rnd() * 2 - 1) * rx * 1.05, (rnd() * 2 - 1) * ry * 1.05];
    if (!inside(p, MIN_GAP * 0.35)) continue;
    if (homes.some((h) => dist(h, p) < HOME_CLEAR)) continue;
    if (taken.some((q) => dist(q, p) < MIN_GAP)) continue;
    taken.push(p);
    cells.push(p);
  }
  if (taken.length !== total)
    throw new Error(`${cfg.id}: layout search exhausted at ${taken.length}/${total}`);

  return cfg.disk ? layDisk(cfg, total, { ...board, cells }) : cells;
}

/**
 * The accretion disk (`cfg.disk`): that many provinces evenly round the hole. Equal sites at
 * radius R cut the hole a regular polygon of apothem R/2, so R is chosen for an area of
 * HEART_PROVINCES average provinces. Free provinces keep clear of the ring's outer half, so
 * none of them reaches the hole: the disk closes it on every side.
 *
 * The disk is laid over the finished sample and the provinces it displaced are placed again
 * from a stream of its own, so the main stream — and every area, name and inhabitant dealt
 * from it — stays as it was without the disk. Returns the free provinces.
 */
function layDisk(cfg, total, { hole, cells, sectors, homes, add, FIXED, inside, rx, ry }) {
  const k = cfg.disk;
  const ring = 2 * Math.sqrt((HEART_PROVINCES * CELL_AREA) / (k * Math.tan(Math.PI / k)));
  const clear = ring + MIN_GAP * 1.1;
  const kept = cells.filter((p) => dist(hole, p) >= clear);
  const displaced = cells.length - kept.length - k;
  if (displaced < 0) throw new Error(`${cfg.id}: the disk displaced fewer provinces than it adds`);
  for (let i = 0; i < k; i++) {
    const a = (i * 2 * Math.PI) / k;
    add(
      `disk_${i + 1}`,
      [hole[0] + ring * Math.cos(a), hole[1] + ring * Math.sin(a)],
      'accretion_disk',
    );
    FIXED.add(`disk_${i + 1}`);
  }
  const spare = rngFrom(`${cfg.seed}:disk`);
  const placed = [...Object.values(sectors).map(pos), ...kept];
  let left = displaced;
  for (let attempt = 0; attempt < total * 400 && left > 0; attempt++) {
    const p = [(spare() * 2 - 1) * rx * 1.05, (spare() * 2 - 1) * ry * 1.05];
    if (!inside(p, MIN_GAP * 0.35)) continue;
    if (homes.some((h) => dist(h, p) < HOME_CLEAR)) continue;
    if (dist(hole, p) < clear) continue;
    if (placed.some((q) => dist(q, p) < MIN_GAP)) continue;
    placed.push(p);
    kept.push(p);
    left--;
  }
  if (left) throw new Error(`${cfg.id}: no room for ${left} provinces the disk displaced`);
  return kept;
}

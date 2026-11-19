/**
 * Star systems on a generated free-for-all map (owner 2026-11-19: the duel, the 2 на 2 map and
 * the FFA for 4 became battles between star systems, then «И на 20»). `generate-ffa.mjs` lays
 * them over the finished map, where it laid a star in a flare zone before:
 *
 * - every plain dead world becomes open space (owner on the duel: «Слишком много мёртвых
 *   миров. И мало пустого космического пространства»); a world, a prize, an inhabitant or a
 *   story keeps its province;
 * - a star stands behind each capital, `steps` map steps past it on the line from the middle
 *   of all the seats (`setStarsBehind`), its class dealt so that seats side by side differ;
 *   it stands alone, like the duel's: its neighbours keep their kinds;
 * - once the rings are laid, a ring the map does not close round — a star near the outline —
 *   gets provinces on its open side (`setRimBehind`): the ring then stands among provinces,
 *   with a road behind the star, not at the edge of the map; the ends of that side take the
 *   kinds the class makes of the space round it, its middle is open space;
 * - open space fills the long stretches of the outline the systems leave between them, or
 *   the provinces there would stretch out to it (`provinceMap.test.ts`).
 *
 * Pure geometry on the map content: no randomness, so the generator stays reproducible.
 */
import { RING_KIND, spacingOf } from './celestial-rings.mjs';
import { STAR_RING, TERRAIN_OF, STORY, setRimBehind, setStarsBehind } from './star-systems.mjs';

export const SYSTEMS = {
  // «Двадцать огней»: twenty stars, one behind each seat, instead of the binary star in the
  // storms. Classes in seat order (the outer ring by bearing, then the inner one), dealt so
  // that no two seats next to each other share one.
  'ffa-20': {
    classes: [
      'yellow_dwarf',
      'red_giant',
      'blue_giant',
      'white_dwarf',
      'pulsar',
      'binary_star',
      'yellow_dwarf',
      'red_giant',
      'blue_giant',
      'white_dwarf',
      'pulsar',
      'binary_star',
      'red_giant',
      'white_dwarf',
      'pulsar',
      'yellow_dwarf',
      'red_giant',
      'white_dwarf',
      'yellow_dwarf',
      'blue_giant',
    ],
    steps: 1.2,
    plan: { k: 8, turn: 0.5, clear: 1.3 },
    // Round each ringed star, `R` map steps out, one place every `turn` of a circle up to
    // `span` of a circle either side of the way out (the capital's side stays as dealt); a
    // place nearer than `gap` steps to a province is already covered.
    rim: { R: 1.6, turn: 0.1, span: 0.3, gap: 0.8 },
    // Open space along the outline: one every `spacing` steps, `inset` steps inside it, never
    // nearer than `gap` steps to a province.
    fringe: { spacing: 1, inset: 0.2, gap: 0.75 },
  },
};

/** Convex hull of points (Andrew's monotone chain), counter-clockwise. */
export function hullOf(points) {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list) => {
    const out = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    return out.slice(0, -1);
  };
  return [...half(p), ...half([...p].reverse())];
}

/** Plain dead worlds → open space. `keep` — provinces the generator gave a part to. */
export function openSpace(map, keep = new Set()) {
  const opened = [];
  for (const [id, s] of Object.entries(map.sectors)) {
    if (s.kind !== 'dead_world' || s.planetType !== undefined || s.owner || keep.has(id)) continue;
    if (STORY.some((k) => s[k] !== undefined)) continue;
    s.kind = 'empty';
    opened.push(id);
  }
  return opened;
}

/**
 * Before the rings: open space and a star behind each of `capitals`. Returns the stars, their
 * ring plans, the middle of the seats and the map's step before the stars (what the places
 * round the rings are measured in: ring provinces stand closer).
 */
export function laySystems(map, sys, { capitals, keep }) {
  openSpace(map, keep);
  const step = spacingOf(map);
  const placements = capitals.map((h, i) => [h, `home_sun_${i + 1}`, sys.classes[i]]);
  const mid = setStarsBehind(map, placements, step, sys.steps);
  const stars = placements.map(([, id]) => id);
  return { stars, plans: Object.fromEntries(stars.map((id) => [id, sys.plan])), mid, step };
}

const CLOSED = new Set([...Object.values(RING_KIND), 'star', 'black_hole', 'rift']);

/** The kinds at the two ends of a star's open side: what its class makes of the space round
 *  it, with open space for the dead worlds the owner wanted fewer of. */
function flanks(cls) {
  const kinds = STAR_RING[cls].kinds.filter((k) => k !== 'dead_world');
  return [kinds[0], kinds[kinds.length - 1]];
}

/**
 * After the rings: the open side of each star's ring (places round it that no province
 * covers), then the fringe of the outline. A place that would touch nothing but rings is
 * dropped: it could not be reached. Returns `[id, the province whose area it joins]`.
 */
export function layOutskirts(map, sys, { stars, mid, step }, neighbours) {
  const { R, turn, span, gap } = sys.rim;
  const free = (q, extra = []) =>
    [...Object.values(map.sectors).map((s) => s.position), ...extra].every(
      (p) => Math.hypot(p.x - q.x, p.y - q.y) >= gap * step,
    );
  const rim = {};
  const placed = [];
  for (const star of stars) {
    const c = map.sectors[star].position;
    const out = Math.atan2(c.y - mid.y, c.x - mid.x);
    const spots = [];
    // From one flank round to the other, so the open side reads in order.
    for (let i = 0; i < Math.round(1 / turn); i++) {
      const f = -0.5 + (i + 0.5) * turn;
      if (Math.abs(f) > span) continue;
      const a = out + f * 2 * Math.PI;
      const q = { x: Math.round(c.x + R * step * Math.cos(a)), y: Math.round(c.y + R * step * Math.sin(a)) };
      if (free(q, [...placed, ...spots])) spots.push(q);
    }
    if (spots.length) rim[star] = spots;
    placed.push(...spots);
  }
  // Drop the places the map cannot reach past the rings, until every one left is reached.
  for (;;) {
    const trial = JSON.parse(JSON.stringify(map));
    setRimBehind(trial, kinded(map, rim), mid);
    const near = neighbours(trial);
    const open = (id) => !CLOSED.has(trial.sectors[id].kind);
    const reached = new Set(Object.keys(map.sectors).filter(open));
    const queue = [...reached];
    for (const id of queue)
      for (const n of near.get(id))
        if (!reached.has(n) && open(n)) {
          reached.add(n);
          queue.push(n);
        }
    let dropped = false;
    for (const [star, spots] of Object.entries(rim)) {
      const keep = spots.filter((_, i) => reached.has(`${star}_rim_${i + 1}`));
      dropped ||= keep.length < spots.length;
      if (keep.length) rim[star] = keep;
      else delete rim[star];
    }
    if (!dropped) break;
  }
  setRimBehind(map, kinded(map, rim), mid);
  const added = Object.entries(rim).flatMap(([star, spots]) => spots.map((_, i) => [`${star}_rim_${i + 1}`, star]));
  return [...added, ...layFringe(map, step, sys.fringe)];
}

/** `{ star: [{x, y}] }` → `setRimBehind`'s places, the ends of each side of its class's kinds. */
function kinded(map, rim) {
  return Object.fromEntries(
    Object.entries(rim).map(([star, spots]) => {
      const [first, last] = flanks(map.sectors[star].terrain);
      return [
        star,
        spots.map((q, i) => {
          const kind = i === 0 ? first : i === spots.length - 1 ? last : 'empty';
          return [q.x, q.y, kind, kind === 'empty' ? 'empty_space' : TERRAIN_OF[kind]];
        }),
      ];
    }),
  );
}

/** Open space along the long edges of the outline; each joins the area of its nearest
 *  province. Returns `[id, nearest]` for each. */
export function layFringe(map, step, { spacing, inset, gap }, prefix = 'fringe') {
  const pts = Object.values(map.sectors).map((s) => s.position);
  const hull = hullOf(pts);
  const spots = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.round(len / (spacing * step)) - 1;
    // Counter-clockwise: the inward normal is the edge turned left.
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    for (let k = 1; k <= count; k++) {
      const t = k / (count + 1);
      const q = {
        x: Math.round(a.x + (b.x - a.x) * t + nx * inset * step),
        y: Math.round(a.y + (b.y - a.y) * t + ny * inset * step),
      };
      if ([...pts, ...spots].every((p) => Math.hypot(p.x - q.x, p.y - q.y) >= gap * step)) spots.push(q);
    }
  }
  const added = [];
  const entries = Object.entries(map.sectors);
  spots.forEach((q, i) => {
    const id = `${prefix}_${String(i + 1).padStart(2, '0')}`;
    if (map.sectors[id]) throw new Error(`${map.id}: ${id} already stands`);
    const host = entries.reduce((best, e) =>
      Math.hypot(e[1].position.x - q.x, e[1].position.y - q.y) <
      Math.hypot(best[1].position.x - q.x, best[1].position.y - q.y)
        ? e
        : best,
    )[0];
    map.sectors[id] = { position: q, kind: 'empty', terrain: 'empty_space' };
    (map.regions ?? []).find((r) => r.sectors.includes(host))?.sectors.push(id);
    added.push([id, host]);
  });
  return added;
}

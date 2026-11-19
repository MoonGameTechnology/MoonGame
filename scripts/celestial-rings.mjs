/**
 * Rings round the bodies of a map (owner 2026-11-18/19): «На любой карте вокруг чёрной дыры
 * должны быть непроходимые провинции. И вокруг других таких объектов тоже…». A body — a
 * star or a black hole — stands inside a closed ring of impassable provinces of its own
 * kind: the accretion disk round a hole, and round a star what its class makes of the space
 * next to it. The body and its ring cover about three provinces, and aviation does not fly
 * over any of them (`overflight: false`, `state/closedSky.ts`).
 *
 * The ring needs room, so the provinces round the body step outward (owner: «Раздвинуть
 * соседей»): each moves away from the body by Δ·(1 − smoothstep((r − r₀)/L)) — the nearest
 * by the whole Δ, those L further out not at all — so the map away from the body keeps its
 * shape and no two provinces swap order along a ray (L ≥ 1.6Δ). Seats and the worlds beside
 * them never move, so every start stays alike, nor do a transit route's hub and ends: the
 * body steps away from them instead. A body ringed before moves with its ring as one piece.
 *
 * Author tool: `lay-rings.mjs` rings the hand-made and Python-generated maps,
 * `generate-ffa.mjs` its own; `data/celestialRings.test.ts` holds the committed maps to the
 * contract (the body touches only its ring, the ring is closed and of the body's kind).
 */

/** Body → the kind of its ring: a black hole's, or a star class's (its `terrain`). */
export const RING_KIND = {
  black_hole: 'accretion_disk',
  yellow_dwarf: 'corona',
  red_giant: 'dust_shell',
  blue_giant: 'stellar_wind',
  white_dwarf: 'planetary_nebula',
  pulsar: 'pulsar_wind',
  binary_star: 'circumbinary_disk',
};

/** The ring kind a sector would be ringed with, or `undefined` if it is not a body. */
export function ringKindOf(sector) {
  if (sector.kind === 'black_hole') return RING_KIND.black_hole;
  if (sector.kind === 'star') return RING_KIND[sector.terrain];
  return undefined;
}

/** What every ring shares: its provinces stand at `ringFrac` of the clearing and weigh
 *  `ringSize`, the body weighs `size`, and the push fades over `decay` map steps. Found by
 *  search over all the maps (2026-11-19): the body and its ring then cover about three
 *  provinces, and each ring province keeps at least a fifth of an ordinary one. */
export const RING_DEFAULTS = { ringFrac: 0.55, ringSize: 0.62, size: 1.4, decay: 2.5 };

/** Median distance from a province to its nearest neighbour: the map's step. */
export function spacingOf(map) {
  const pts = Object.values(map.sectors).map((s) => s.position);
  const nn = pts
    .map((p) => Math.min(...pts.filter((q) => q !== p).map((q) => Math.hypot(q.x - p.x, q.y - p.y))))
    .sort((a, b) => a - b);
  return nn[nn.length >> 1];
}

/** The provinces a ring never moves: every seat and the planets whose cells touch it, and a
 *  transit route's hub with both its ends (`transit` must keep running between neighbours). */
export function anchorsOf(map, neighbours) {
  const isSeat = (s) => s.owner != null && Boolean(map.slots?.[s.owner] || map.players?.[s.owner]);
  const near = neighbours(map);
  const out = new Set();
  for (const [id, s] of Object.entries(map.sectors)) {
    for (const pair of s.transit ?? []) for (const end of [id, ...pair]) out.add(end);
    if (!isSeat(s)) continue;
    out.add(id);
    for (const n of near.get(id) ?? []) if (map.sectors[n].kind === 'planet') out.add(n);
  }
  return out;
}

const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Lays the ring of `bodyId` on `map`. `plan`: `k` ring provinces, the first `turn` of the
 * step between them past due east; the nearest province that stays ends up `clear` map
 * steps from the body; `anchorClear` (default `clear`) map steps is how far the body keeps
 * from an anchor, stepping away when nearer; the rest is {@link RING_DEFAULTS}. `anchors`
 * never move; `rigid` lists bodies ringed before (`{ body, ids }`), each moving as one piece.
 */
export function layRing(map, bodyId, plan, { anchors = new Set(), rigid = [], step } = {}) {
  const P = { ...RING_DEFAULTS, ...plan };
  const body = map.sectors[bodyId];
  const kind = ringKindOf(body);
  if (!kind) throw new Error(`${map.id}: ${bodyId} is not a star or a black hole`);
  const s = step ?? spacingOf(map);
  const target = P.clear * s;
  // The body steps away from the anchored provinces it would crowd.
  let O = { ...body.position };
  for (let it = 0; it < 40; it++) {
    let vx = 0;
    let vy = 0;
    for (const id of anchors) {
      const a = map.sectors[id].position;
      const d = Math.hypot(O.x - a.x, O.y - a.y);
      const need = (P.anchorClear ?? P.clear) * s;
      if (d < need && d > 0) {
        vx += ((O.x - a.x) / d) * (need - d) * 0.5;
        vy += ((O.y - a.y) / d) * (need - d) * 0.5;
      }
    }
    if (Math.hypot(vx, vy) < 0.5) break;
    O = { x: O.x + vx, y: O.y + vy };
  }
  O = { x: Math.round(O.x), y: Math.round(O.y) };
  const shift = Math.round(Math.hypot(O.x - body.position.x, O.y - body.position.y));
  body.position = O;

  // What moves: every province but the body, the anchors and the members of a rigid group,
  // which move as their body does.
  const member = new Map();
  for (const group of rigid) for (const id of group.ids) member.set(id, group.body);
  const dist = (p) => Math.hypot(p.x - O.x, p.y - O.y);
  const movers = Object.keys(map.sectors).filter(
    (id) => id !== bodyId && !anchors.has(id) && (!member.has(id) || member.get(id) === id),
  );
  const dmin = Math.min(...movers.map((id) => dist(map.sectors[id].position)));
  const delta = Math.max(0, target - dmin);
  const L = Math.max(P.decay * s, 1.6 * delta);
  const moved = [];
  for (const id of movers) {
    const p = map.sectors[id].position;
    const r = dist(p);
    if (r >= dmin + L || r === 0) continue;
    const f = (r + delta * (1 - smooth((r - dmin) / L))) / r;
    const dx = Math.round(O.x + (p.x - O.x) * f) - p.x;
    const dy = Math.round(O.y + (p.y - O.y) * f) - p.y;
    if (dx === 0 && dy === 0) continue;
    const group = rigid.find((g) => g.body === id);
    for (const m of group ? group.ids : [id]) {
      const q = map.sectors[m].position;
      map.sectors[m].position = { x: q.x + dx, y: q.y + dy };
      moved.push(m);
    }
  }

  const R = P.ringFrac * target;
  const ring = [];
  for (let i = 0; i < P.k; i++) {
    const a = (((P.turn ?? 0) + i) * 2 * Math.PI) / P.k;
    const id = `${bodyId}_ring_${i + 1}`;
    if (map.sectors[id]) throw new Error(`${map.id}: ${id} already stands`);
    ring.push(id);
    map.sectors[id] = {
      position: { x: Math.round(O.x + R * Math.cos(a)), y: Math.round(O.y + R * Math.sin(a)) },
      kind,
      terrain: 'empty_space',
      ...(P.ringSize !== 1 ? { size: P.ringSize } : {}),
    };
  }
  if (P.size === 1) delete body.size;
  else body.size = P.size;
  // The ring belongs to the body's area.
  const region = (map.regions ?? []).find((r) => r.sectors.includes(bodyId));
  if (region) region.sectors.splice(region.sectors.indexOf(bodyId) + 1, 0, ...ring);
  return { ring, moved, shift, delta: Math.round(delta) };
}

/**
 * Rings every body of `plans` (`{ bodyId: plan }`, laid in that order) on `map`, measured
 * against the map as it stood before the first: its step and its anchors (plus `hold`, the
 * provinces this map keeps where they are). `rigid` — bodies ringed earlier, which ride
 * along. Fails unless each body ends up touching only its ring and each ring is closed.
 */
export function layRings(map, plans, neighbours, { hold = [], rigid = [] } = {}) {
  const anchors = new Set([...anchorsOf(map, neighbours), ...hold]);
  const step = spacingOf(map);
  const groups = [...rigid];
  const laid = {};
  for (const [bodyId, plan] of Object.entries(plans)) {
    const info = layRing(map, bodyId, plan, { anchors, rigid: groups, step });
    groups.push({ body: bodyId, ids: [bodyId, ...info.ring] });
    laid[bodyId] = info;
  }
  const near = neighbours(map);
  for (const [bodyId, { ring }] of Object.entries(laid)) {
    const own = new Set(ring);
    const stray = near.get(bodyId).filter((n) => !own.has(n));
    if (stray.length) throw new Error(`${map.id}: ${bodyId} still touches ${stray.join(', ')}`);
    const open = ring.filter((id) => near.get(id).filter((n) => own.has(n)).length !== 2);
    if (open.length) throw new Error(`${map.id}: the ring of ${bodyId} is open at ${open.join(', ')}`);
  }
  return laid;
}

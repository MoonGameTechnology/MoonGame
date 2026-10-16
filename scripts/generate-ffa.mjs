#!/usr/bin/env node
/**
 * Large free-for-all maps of the main game: «Двадцать огней» (`ffa-20`) and
 * «Пятьдесят солнц» (`ffa-50`). Author tool — the committed JSON is the runtime input;
 * nothing here runs when a match starts.
 *
 *   node scripts/generate-ffa.mjs          # both maps
 *   node scripts/generate-ffa.mjs 50       # one of them
 *
 * The rules come from the map docs, not from this script:
 * - the province mosaic and its lanes are the CORE's (`docs/map-roadmap.md` M4.3): the map
 *   carries no `paths`, and this script asks the real core (`matchMapEdges`) which borders
 *   are open before it places anything that depends on hops;
 * - areas follow the templates of `docs/map-terrain-regions-concept.md` §5.3–5.5 (core →
 *   shell → edge from the area's anchor), they are labels only (`regions`, M2.15);
 * - the whole catalogue of kinds, terrains and world types is on the map, except `empty`
 *   (kept off combat maps) and the fork fortress (only a player builds it);
 * - wrecks are a rare find: one graveyard and one debris field per map (owner,
 *   2026-10-14);
 * - geometry is an irregular sample, never mirrored quadrants; the owner trades a little
 *   balance for better-looking areas (2026-10-14).
 *
 * FAIRNESS IN A FREE-FOR-ALL comes from where things stand, not from symmetry. Starts are
 * a centroidal Voronoi tessellation of the map (Lloyd's relaxation), so every seat gets
 * about the same share of space; the centre is held by a fixed site, the black hole. An
 * area is anchored at a junction of that tessellation — a point equally far from the
 * three seats around it — so every prize area is shared by its neighbours and no seat
 * owns one by being closer. Area templates are dealt so each seat touches a mix.
 *
 * Bounded repair, no silent weakening (concept §6): terrain that cannot carry its lanes is
 * opened one step, inhabitants go only where the hop rules hold, and the script FAILS
 * when a contract cannot be met. `prototype/src/ffaMap.test.ts` checks the same contracts
 * on the committed maps.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

const ROOT = new URL('..', import.meta.url).pathname;

/** Per-map settings. `perSeat` is provinces per playable seat, everything included. */
const MAPS = {
  20: {
    id: 'ffa-20',
    seed: 'twenty-lights-20261015',
    perSeat: 16,
    pirates: 3,
    hives: 2,
    neutrals: 4,
    rimRifts: 2,
    hub: 'dark_heart',
    names: [
      'kaira',
      'orin',
      'vella',
      'talos',
      'arvena',
      'erim',
      'tessa',
      'solan',
      'mirra',
      'morven',
      'larna',
      'ardan',
      'ormina',
      'kestrel',
      'elda',
      'vandor',
      'narla',
      'xanor',
      'sabra',
      'beltar',
      'korna',
      'tiron',
      'ilva',
      'zephyr',
      'tavra',
      'ostar',
    ],
  },
  50: {
    id: 'ffa-50',
    seed: 'fifty-suns-20261015',
    perSeat: 16,
    pirates: 6,
    hives: 4,
    neutrals: 8,
    rimRifts: 4,
    hub: 'abyss',
    names: [
      'zorna',
      'karven',
      'lirna',
      'dorn',
      'deira',
      'iltar',
      'kvara',
      'meron',
      'melga',
      'savel',
      'senna',
      'phaethon',
      'eira',
      'gravis',
      'valda',
      'lumen',
      'ristra',
      'rax',
      'ossia',
      'ceron',
      'ilania',
      'niam',
      'farra',
      'horvet',
      'gella',
      'elmar',
      'nerissa',
      'palar',
      'aela',
      'veylan',
      'selvra',
      'tarmon',
      'morna',
      'sardan',
      'brina',
      'quirin',
      'cirra',
      'ulmar',
      'yaska',
      'boreas',
      'okta',
      'irmen',
      'pyrenna',
      'askol',
      'helma',
      'nodar',
      'reina',
      'heimar',
      'assara',
      'ortan',
      'virta',
      'veles',
      'luena',
      'kadmon',
      'thessa',
      'corvin',
      'idris',
      'mareth',
      'oleya',
      'vintar',
    ],
  },
};

// Spacing of the team maps (`generate-team-3v3.py`): pace per hop stays the same.
const MIN_GAP = 355;
const HOME_CLEAR = 480;
const OPENING_REACH = 270;
/** World area per province — the density of the 3v3 map (121 provinces in its ellipse). */
const CELL_AREA = 252_000;
const ASPECT = 1.25;

// ── the real core, bundled once ──────────────────────────────────────────────────────
async function loadCore() {
  const res = await build({
    stdin: {
      contents:
        "export { parseMatchMap, matchMapEdges, validateMatchMap } from './packages/shared-core/src/index';\n" +
        "export { shippedGameData } from './data/bundle';\n",
      resolveDir: ROOT,
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'es2020',
    write: false,
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', res.outputFiles[0].text)(
    mod,
    mod.exports,
    () => ({}),
  );
  return mod.exports;
}
const core = await loadCore();
const data = core.shippedGameData();
const factions = JSON.parse(readFileSync(ROOT + 'data/factions.json', 'utf8'));

// ── helpers ──────────────────────────────────────────────────────────────────────────
function rngFrom(seed) {
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
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pos = (s) => [s.position.x, s.position.y];

function generate(seats, cfg) {
  const rnd = rngFrom(cfg.seed);
  const total = seats * cfg.perSeat;
  // The map: an ellipse with a wavy rim — space has no straight edges (M2.9).
  const ry = Math.sqrt((total * CELL_AREA) / (Math.PI * ASPECT));
  const rx = ry * ASPECT;
  const waves = [0, 1, 2].map(() => rnd() * Math.PI * 2);
  const rimAt = (theta) =>
    1 +
    0.05 * Math.sin(3 * theta + waves[0]) +
    0.035 * Math.sin(5 * theta + waves[1]) +
    0.02 * Math.sin(7 * theta + waves[2]);
  const inside = ([x, y], margin = 0) => {
    const u = x / rx,
      v = y / ry;
    return Math.hypot(u, v) <= rimAt(Math.atan2(v, u)) - margin / ry;
  };

  // ── starts: Lloyd's relaxation with the centre held by the black hole ──
  const step = Math.sqrt((Math.PI * rx * ry) / 40000);
  const grid = [];
  for (let y = -ry * 1.1; y <= ry * 1.1; y += step)
    for (let x = -rx * 1.1; x <= rx * 1.1; x += step) if (inside([x, y])) grid.push([x, y]);
  const sites = [[0, 0]];
  // Best-candidate seeding spreads the first guess; Lloyd then evens out the cells.
  while (sites.length < seats + 1) {
    let best = null,
      bestD = -1;
    for (let k = 0; k < 30; k++) {
      const p = grid[Math.floor(rnd() * grid.length)];
      const d = Math.min(...sites.map((s) => dist(s, p)));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    sites.push([...best]);
  }
  for (let it = 0; it < 80; it++) {
    const sum = sites.map(() => [0, 0, 0]);
    for (const p of grid) {
      let k = 0,
        kd = Infinity;
      for (let i = 0; i < sites.length; i++) {
        const d = (sites[i][0] - p[0]) ** 2 + (sites[i][1] - p[1]) ** 2;
        if (d < kd) {
          kd = d;
          k = i;
        }
      }
      sum[k][0] += p[0];
      sum[k][1] += p[1];
      sum[k][2]++;
    }
    for (let i = 1; i < sites.length; i++)
      sites[i] = [sum[i][0] / sum[i][2], sum[i][1] / sum[i][2]];
  }
  const homes = sites.slice(1).map(([x, y]) => [Math.round(x / 10) * 10, Math.round(y / 10) * 10]);
  // Seats are numbered around the map, outer ring first, so neighbouring slots are
  // neighbouring places on the map and the order reads naturally on the setup screen.
  homes.sort((a, b) => {
    const ra = Math.hypot(a[0] / rx, a[1] / ry) > 0.62,
      rb = Math.hypot(b[0] / rx, b[1] / ry) > 0.62;
    return ra !== rb ? (ra ? -1 : 1) : Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]);
  });
  const spacing = Math.sqrt((Math.PI * rx * ry) / (seats + 1));

  // ── authored provinces: homes, their two opening worlds, the black hole ──
  const sectors = {},
    players = {},
    fleets = {},
    slots = {};
  const add = (sid, [x, y], kind, terrain = 'empty_space', extra = {}) => {
    sectors[sid] = { position: { x: Math.round(x), y: Math.round(y) }, kind, terrain, ...extra };
  };
  homes.forEach((home, i) => {
    const slot = `slot_${i + 1}`;
    slots[slot] = { team: slot, spawn: 'fixed', resources: { credits: 300, metal: 300 } };
    add(`home_${i + 1}`, home, 'planet', 'empty_space', {
      planetType: 'terran',
      owner: slot,
      buildings: [{ type: 'mine_t1' }, { type: 'shipyard', level: 2 }],
      garrison: [{ unit: 'militia', count: 3 }],
    });
    fleets[`fleet_${i + 1}`] = {
      owner: slot,
      location: `home_${i + 1}`,
      units: [{ unit: 'scout', count: 1 }],
    };
    // Every seat opens with the same pair — a temperate world and an ocean — at the same
    // distance; their bearing is the seat's own, so no two districts are copies.
    const facing = Math.atan2(-home[1], -home[0]) + (rnd() - 0.5) * 1.6;
    const spread = 1.6 + rnd() * 0.5;
    ['terran', 'oceanic'].forEach((world, j) => {
      const a = facing + (j === 0 ? -spread / 2 : spread / 2);
      add(
        `opening_${i + 1}_${j + 1}`,
        [home[0] + OPENING_REACH * Math.cos(a), home[1] + OPENING_REACH * Math.sin(a)],
        'planet',
        'empty_space',
        { planetType: world, garrison: [{ unit: 'militia', count: 2 }] },
      );
    });
  });
  const hole = [Math.round((rnd() - 0.5) * 120), Math.round((rnd() - 0.5) * 120)];
  add('heart', hole, 'black_hole', 'deep_void');
  const FIXED = new Set(Object.keys(sectors));

  // ── the free provinces: an unsaturated Poisson sample, varied sizes and degrees ──
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

  // ── areas: anchored at the junctions of the seat tessellation ──
  const junctions = [];
  const sq = (p) => p[0] * p[0] + p[1] * p[1];
  for (let i = 0; i < sites.length; i++)
    for (let j = i + 1; j < sites.length; j++)
      for (let k = j + 1; k < sites.length; k++) {
        const [a, b, c] = [sites[i], sites[j], sites[k]];
        const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
        if (Math.abs(d) < 1e-6) continue;
        const cx = (sq(a) * (b[1] - c[1]) + sq(b) * (c[1] - a[1]) + sq(c) * (a[1] - b[1])) / d;
        const cy = (sq(a) * (c[0] - b[0]) + sq(b) * (a[0] - c[0]) + sq(c) * (b[0] - a[0])) / d;
        const r = dist([cx, cy], a);
        if (sites.some((s, m) => m !== i && m !== j && m !== k && dist(s, [cx, cy]) < r - 1e-6))
          continue;
        // A junction past the rim (an open triangle on the hull) is pulled in along its
        // ray: the rim between two outer seats is an area too.
        let at = [cx, cy];
        for (let t = 0; t < 80 && !inside(at, spacing * 0.3); t++)
          at = [at[0] * 0.97, at[1] * 0.97];
        if (dist(at, hole) < spacing * 0.8) continue;
        junctions.push({ at, r });
      }
  // Thin to about one area per seat, the widest gaps first.
  junctions.sort((p, q) => q.r - p.r || p.at[0] - q.at[0]);
  const thin = (gap) => {
    const kept = [];
    for (const jn of junctions) if (kept.every((a) => dist(a.at, jn.at) >= gap)) kept.push(jn);
    return kept;
  };
  let lo = 0,
    hi = spacing * 2;
  for (let it = 0; it < 30; it++) {
    const mid = (lo + hi) / 2;
    if (thin(mid).length > seats) lo = mid;
    else hi = mid;
  }
  const anchors = thin(hi).map((jn) => ({ at: jn.at }));
  const gap = hi;

  // One graveyard on the whole map, half-way between the rim and the black hole: the
  // expedition that went for the heart and never reached it.
  const mid = Math.sqrt(rx * ry) * 0.5;
  const grave = anchors.reduce((best, a) =>
    Math.abs(Math.hypot(...a.at) - mid) < Math.abs(Math.hypot(...best.at) - mid) ? a : best,
  );
  grave.template = 'graveyard';
  // The rest are dealt so every seat touches a mix; metal and energy matter most.
  const SHARE = { massif: 0.3, nebula: 0.28, storm: 0.15, wastes: 0.12, expanse: 0.15 };
  const touching = anchors.map((a) =>
    homes.map((h, i) => (dist(h, a.at) <= spacing * 1.05 ? i : -1)).filter((i) => i >= 0),
  );
  const has = homes.map(() => ({ massif: 0, nebula: 0, storm: 0, wastes: 0, expanse: 0 }));
  const count = { massif: 0, nebula: 0, storm: 0, wastes: 0, expanse: 0 };
  const order = anchors
    .map((_, i) => i)
    .sort(
      (p, q) =>
        touching[q].length - touching[p].length ||
        Math.atan2(anchors[p].at[1], anchors[p].at[0]) -
          Math.atan2(anchors[q].at[1], anchors[q].at[0]),
    );
  for (const i of order) {
    const a = anchors[i];
    if (a.template) continue;
    let best = null,
      bestScore = -Infinity;
    for (const t of Object.keys(SHARE)) {
      let score = 0;
      for (const seat of touching[i])
        if (has[seat][t] === 0) score += t === 'massif' || t === 'nebula' ? 2 : 1;
      score -= (2 * count[t]) / (SHARE[t] * anchors.length);
      score -=
        0.8 *
        anchors.filter((b) => b !== a && b.template === t && dist(b.at, a.at) < gap * 1.25).length;
      score += rnd() * 0.05;
      if (score > bestScore) {
        bestScore = score;
        best = t;
      }
    }
    a.template = best;
    count[best]++;
    for (const seat of touching[i]) has[seat][best]++;
  }
  const areas = [...anchors, { at: hole, template: 'hub', weight: 1.25 }];
  const areaOf = (p) => {
    let k = 0,
      kd = Infinity;
    areas.forEach((a, i) => {
      const d = dist(a.at, p) / (a.weight ?? 1);
      if (d < kd) {
        kd = d;
        k = i;
      }
    });
    return k;
  };

  // ── ladders: core → shell → edge from each anchor (concept §5.3) ──
  const LADDERS = {
    massif: (n) => [
      [1, 'dead_world', 'dust_lane'],
      [2, 'asteroid', 'dust_lane'],
      [Math.max(1, Math.round(n * 0.3)), 'asteroid', 'asteroid_field'],
      [null, ['dead_world', 'planet/barren', 'asteroid', 'planet/terran'], 'empty_space'],
    ],
    nebula: (n) => [
      [2, 'dense_nebula', 'dense_nebula'],
      [Math.max(2, Math.round(n * 0.3)), 'nebula', 'nebula'],
      [null, ['dead_world', 'planet/terran', 'asteroid', 'planet/barren'], 'empty_space'],
    ],
    storm: (n) => [
      [Math.max(2, Math.round(n * 0.22)), 'ion_storm', 'ion_storm'],
      [2, 'solar_flare', 'solar_flare_zone'],
      [null, ['dead_world', 'asteroid', 'planet/terran'], 'empty_space'],
    ],
    wastes: () => [
      [2, 'dead_world', 'depleted_system'],
      [1, 'asteroid', 'depleted_system'],
      [null, ['dead_world', 'planet/barren', 'asteroid'], 'deep_void'],
    ],
    expanse: () => [
      [1, 'void_station', 'deep_void'],
      [2, 'dead_world', 'deep_void'],
      [null, ['planet/terran', 'dead_world', 'asteroid', 'planet/barren'], 'empty_space'],
    ],
    graveyard: () => [
      [1, 'graveyard', 'derelict_graveyard'],
      [1, 'debris_field', 'derelict_graveyard'],
      [null, ['dead_world', 'planet/barren', 'asteroid'], 'empty_space'],
    ],
    hub: () => [
      [3, ['planet/relic_world', 'void_station', 'planet/ringworld'], 'deep_void'],
      [6, ['dead_world', 'asteroid'], 'deep_void'],
      [null, ['dead_world', 'planet/terran', 'asteroid', 'planet/barren'], 'empty_space'],
    ],
  };
  const prefix = cfg.id === 'ffa-20' ? 'lights' : 'suns';
  const members = areas.map(() => []);
  for (const p of cells) members[areaOf(p)].push(p);
  const ROLE = {},
    AREA = {},
    RANK = {};
  let n = 0;
  members.forEach((ps, ai) => {
    ps.sort((p, q) => dist(p, areas[ai].at) - dist(q, areas[ai].at) || p[0] - q[0]);
    const steps = LADDERS[areas[ai].template](ps.length);
    let i = 0;
    steps.forEach(([cnt, kind, terrain], step) => {
      const take = cnt === null ? ps.slice(i) : ps.slice(i, i + cnt);
      const role = step === steps.length - 1 ? 'edge' : step === 0 ? 'core' : 'shell';
      take.forEach((p, k) => {
        const sid = `${prefix}_${String(++n).padStart(3, '0')}`;
        const pick = Array.isArray(kind) ? kind[(k + ai) % kind.length] : kind;
        const [this_, world] = pick.split('/');
        add(sid, p, this_, terrain, world ? { planetType: world } : {});
        ROLE[sid] = role;
        AREA[sid] = ai;
        RANK[sid] = i++;
      });
    });
  });
  for (const sid of Object.keys(sectors))
    if (AREA[sid] === undefined) AREA[sid] = areaOf(pos(sectors[sid]));
  const inArea = (ai, role) =>
    Object.keys(ROLE).filter((s) => AREA[s] === ai && (!role || ROLE[s] === role));
  const PRIZE = new Set();
  const nearHome = (sid) => Math.min(...homes.map((h) => dist(h, pos(sectors[sid]))));
  const set = (sid, fields) => {
    PRIZE.add(sid);
    Object.assign(sectors[sid], fields);
    if (fields.kind && fields.kind !== 'planet' && !fields.planetType)
      delete sectors[sid].planetType;
  };
  // Prizes inside each area, picked by place, not by lottery.
  areas.forEach((a, ai) => {
    const core = inArea(ai, 'core'),
      shell = inArea(ai, 'shell'),
      edge = inArea(ai, 'edge');
    const far = (ids) => [...ids].sort((p, q) => nearHome(q) - nearHome(p))[0];
    if (a.template === 'massif') {
      if (core[0]) set(core[0], { planetType: 'crystalline' }); // the heart of the dust (§5.4)
      const field = shell.filter((s) => sectors[s].terrain === 'asteroid_field');
      if (field.length)
        set(field[Math.floor(field.length / 2)], { kind: 'planet', planetType: 'gas_giant' });
      const pocket = far(edge.filter((s) => !PRIZE.has(s)));
      if (pocket) set(pocket, { kind: 'asteroid_cluster', terrain: 'asteroid_cluster' });
    } else if (a.template === 'nebula') {
      if (core[0]) set(core[0], { planetType: 'energy_nexus' });
      const rim = far(edge.filter((s) => !PRIZE.has(s)));
      if (rim) set(rim, { kind: 'planet', planetType: 'volcanic' });
    } else if (a.template === 'storm') {
      const flare = shell.find((s) => sectors[s].kind === 'solar_flare');
      if (flare) set(flare, { kind: 'planet', planetType: 'irradiated' });
    } else if (a.template === 'expanse') {
      const rim = far(edge.filter((s) => !PRIZE.has(s)));
      if (rim) set(rim, { kind: 'planet', planetType: 'fortress_world' });
      if (core[0]) PRIZE.add(core[0]);
    } else if (a.template === 'wastes') {
      if (core[0]) set(core[0], { kind: 'planet', planetType: 'barren' }); // the spent mines
      if (core[1]) set(core[1], { planetType: 'dead_world' });
    } else if (a.template === 'graveyard') {
      for (const s of [...core, ...shell]) PRIZE.add(s);
      const camp = far(edge);
      if (camp) set(camp, { kind: 'planet', planetType: 'oceanic' }); // the expedition's last camp
    } else if (a.template === 'hub') {
      for (const s of core) PRIZE.add(s);
    }
  });

  // Rifts — impassable scars. Two round the black hole narrow the ways in; a few on the
  // rim close the far edge behind the outer seats. Each is kept only if the map stays whole.
  const rifts = [];
  const hubRing = inArea(areas.length - 1, 'shell');
  const rimOf = (sid) => {
    const [x, y] = pos(sectors[sid]);
    return rimAt(Math.atan2(y / ry, x / rx)) - Math.hypot(x / rx, y / ry);
  };
  const riftCandidates = [
    ...hubRing.filter((_, i) => i % 3 === 1).slice(0, 2),
    ...Object.keys(ROLE)
      .filter(
        (s) =>
          ROLE[s] === 'edge' &&
          !PRIZE.has(s) &&
          nearHome(s) > 900 &&
          ['expanse', 'wastes', 'storm'].includes(areas[AREA[s]].template),
      )
      .sort((p, q) => rimOf(p) - rimOf(q)),
  ];
  const edgesOf = () => {
    const map = core.parseMatchMap({ id: cfg.id, seed: cfg.seed, sectors, players, slots, fleets });
    return core.matchMapEdges(map, data);
  };
  let rimLeft = cfg.rimRifts,
    hubLeft = 2;
  for (const sid of riftCandidates) {
    const atHub = AREA[sid] === areas.length - 1;
    if (atHub ? hubLeft === 0 : rimLeft === 0) continue;
    if (
      rifts.some(
        (r) => dist(pos(sectors[r]), pos(sectors[sid])) < (atHub ? MIN_GAP * 1.6 : spacing),
      )
    )
      continue;
    const before = { ...sectors[sid] };
    set(sid, { kind: 'rift', terrain: 'empty_space' });
    const map = core.parseMatchMap({ id: cfg.id, seed: cfg.seed, sectors, players, slots, fleets });
    if (
      core
        .validateMatchMap(map, data)
        .some((e) => e.startsWith('E_MAP_DISCONNECTED') || e.startsWith('E_SECTOR_OVERLINKED'))
    ) {
      sectors[sid] = before;
      PRIZE.delete(sid);
      continue;
    }
    rifts.push(sid);
    if (atHub) hubLeft--;
    else rimLeft--;
  }

  // ── terrain that cannot carry its lanes opens one step (bounded repair) ──
  const OPEN_UP = {
    dust_lane: 'asteroid_field',
    ion_storm: 'nebula',
    derelict_graveyard: 'nebula',
    asteroid_field: 'empty_space',
    dense_nebula: 'nebula',
    nebula: 'empty_space',
  };
  const OPEN_KIND = { ion_storm: 'nebula', dense_nebula: 'nebula' };
  let edges = edgesOf();
  for (let round = 0; round < 40 && edges.overBudget.length; round++) {
    for (const sid of edges.overBudget) {
      const s = sectors[sid];
      const next = OPEN_UP[s.terrain];
      if (!next) throw new Error(`${cfg.id}: ${sid} (${s.terrain}) cannot carry its lanes`);
      s.terrain = next;
      if (OPEN_KIND[s.kind]) s.kind = OPEN_KIND[s.kind];
    }
    edges = edgesOf();
  }
  if (edges.overBudget.length) throw new Error(`${cfg.id}: over budget ${edges.overBudget}`);
  const adj = new Map(Object.keys(sectors).map((s) => [s, []]));
  for (const [a, b] of edges.paths) {
    adj.get(a).push(b);
    adj.get(b).push(a);
  }

  // A home borders exactly its two opening worlds: no third world next door.
  homes.forEach((_, i) => {
    for (const nb of adj.get(`home_${i + 1}`))
      if (sectors[nb].kind === 'planet' && !nb.startsWith(`opening_${i + 1}_`)) {
        sectors[nb].kind = 'dead_world';
        delete sectors[nb].planetType;
        PRIZE.delete(nb);
      }
  });

  return {
    rnd,
    rx,
    ry,
    homes,
    hole,
    spacing,
    gap,
    sectors,
    players,
    fleets,
    slots,
    areas,
    AREA,
    ROLE,
    RANK,
    PRIZE,
    adj,
    edges,
    rifts,
    FIXED,
  };
}

function hops(adj, sources, blocked = new Set()) {
  const d = new Map(sources.map((s) => [s, 0]));
  const queue = [...sources];
  for (let qi = 0; qi < queue.length; qi++)
    for (const nb of adj.get(queue[qi]))
      if (!d.has(nb) && !blocked.has(nb)) {
        d.set(nb, d.get(queue[qi]) + 1);
        queue.push(nb);
      }
  return d;
}

const TYPE_WORD = {
  massif: 'massif',
  nebula: 'nebula',
  storm: 'storm',
  wastes: 'wastes',
  expanse: 'expanse',
};
const NEUTRAL_HALLS = [
  'lighthouse',
  'exchange',
  'abbey',
  'arsenal',
  'observatory',
  'anchorage',
  'commune',
  'freehold',
];

/** Names areas, seats the inhabitants and checks every contract on the finished map. */
function finish(seats, cfg, g) {
  const { sectors, players, fleets, slots, areas, AREA, ROLE, PRIZE, adj, homes } = g;
  let noun = 0;
  for (const a of areas) {
    if (a.template === 'hub') a.id = cfg.hub;
    else if (a.template === 'graveyard') a.id = 'expedition_graveyard';
    else {
      a.noun = cfg.names[noun++];
      a.id = `${a.noun}_${TYPE_WORD[a.template]}`;
    }
  }
  if (noun > cfg.names.length)
    throw new Error(`${cfg.id}: ${noun} areas, ${cfg.names.length} names`);
  const homeIds = homes.map((_, i) => `home_${i + 1}`);
  const fromHomes = hops(adj, homeIds);

  // ── inhabitants: hostile and neutral bases at least three hops from every seat, spread
  // across the map so no seat lives next to more of them than its neighbours ──
  const WHERE = { swarm: ['massif', 'wastes'], pirate: ['nebula'], neutral: ['expanse', 'storm'] };
  const placed = [];
  let hall = 0;
  for (const [npc, total] of [
    ['swarm', cfg.hives],
    ['pirate', cfg.pirates],
    ['neutral', cfg.neutrals],
  ]) {
    for (let k = 0; k < total; k++) {
      const free = (s) =>
        !PRIZE.has(s) &&
        ROLE[s] !== 'core' &&
        !g.rifts.includes(s) &&
        sectors[s].kind !== 'asteroid_cluster' &&
        (fromHomes.get(s) ?? 0) >= 3 &&
        adj.get(s).length >= 2 &&
        !placed.some((p) => p === s || adj.get(p).includes(s));
      const unclaimed = (s) => !placed.some((p) => AREA[p] === AREA[s]);
      let candidates = Object.keys(ROLE).filter(
        (s) => free(s) && unclaimed(s) && WHERE[npc].includes(areas[AREA[s]].template),
      );
      if (!candidates.length)
        candidates = Object.keys(ROLE).filter(
          (s) => free(s) && unclaimed(s) && areas[AREA[s]].noun,
        );
      if (!candidates.length) throw new Error(`${cfg.id}: no room for ${npc} #${k + 1}`);
      const at = (s) => pos(sectors[s]);
      const sid = candidates
        .map((s) => [
          s,
          placed.length ? Math.min(...placed.map((p) => dist(at(p), at(s)))) : Math.hypot(...at(s)),
        ])
        .sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : 1))[0][0];
      placed.push(sid);
      const area = areas[AREA[sid]];
      const pid = `npc-${sid}`;
      const resources = { credits: 500, metal: 500, food: 200, energy: 200, microelectronics: 100 };
      let name, faction, buildings, units, guard, kind, planetType;
      if (npc === 'swarm') {
        const kit = factions.swarm.startingLoadout;
        resources.biomass = 240;
        name = `${area.noun} brood`;
        faction = 'swarm';
        kind = 'planet';
        planetType = 'barren';
        buildings = [...kit.homeBuildings, 'shipyard', 'power_plant'];
        units = kit.fleet;
        guard = kit.garrison;
      } else {
        const pir = factions.pirates.startingLoadout;
        buildings = ['shipyard', 'radar', 'power_plant', 'fabricator'];
        if (npc === 'pirate') {
          name = `${area.noun} corsairs`;
          faction = 'pirates';
          kind = 'pirate_base';
          planetType = 'terran';
          units = pir.fleet;
          guard = pir.garrison;
        } else {
          name = `${area.noun} ${NEUTRAL_HALLS[hall++ % NEUTRAL_HALLS.length]}`;
          faction = 'violet';
          kind = 'neutral_base';
          planetType = 'terran';
          units = [
            { unit: 'cruiser', count: 3 },
            { unit: 'scout', count: 1 },
          ];
          guard = [{ unit: 'heavy_infantry', count: 3 }];
        }
      }
      players[pid] = {
        name: name.replace(/\b\w/g, (c) => c.toUpperCase()),
        faction,
        resources,
        ai: true,
        npc,
      };
      Object.assign(sectors[sid], {
        kind,
        planetType,
        owner: pid,
        buildings: buildings.map((b) => ({ type: b, level: b === 'shipyard' ? 2 : 1 })),
        garrison: guard,
      });
      PRIZE.add(sid);
      fleets[`${pid}-fleet`] = {
        owner: pid,
        location: sid,
        units,
        landing: npc === 'swarm' ? [{ unit: 'swarm_lander', count: 3 }] : [],
      };
    }
  }

  const regions = areas
    .map((a, ai) => ({ id: a.id, sectors: Object.keys(sectors).filter((s) => AREA[s] === ai) }))
    .filter((r) => r.sectors.length);
  const content = {
    id: cfg.id,
    seed: cfg.seed,
    sectors,
    regions,
    players,
    slots,
    fleets,
    techRules: { ruleset: 'main', starting: ['scout_design'], dayGates: true, exclude: [] },
  };

  // ── contracts (prototype/src/ffaMap.test.ts holds the same on the committed file) ──
  const map = core.parseMatchMap(content);
  const issues = core.validateMatchMap(map, data);
  if (issues.length) throw new Error(`${cfg.id}: ${issues.slice(0, 8)}`);
  const fail = [];
  const pair = [];
  homeIds.forEach((h, i) => {
    const d = hops(adj, [h]);
    for (const o of homeIds) if (o !== h) pair.push(d.get(o));
    const worlds = adj
      .get(h)
      .filter((s) => sectors[s].kind === 'planet')
      .sort();
    if (worlds.join() !== `opening_${i + 1}_1,opening_${i + 1}_2`)
      fail.push(`${h} worlds ${worlds}`);
    for (const p of placed) if (d.get(p) < 3) fail.push(`${h} -> ${p} ${d.get(p)}`);
    const bypass = hops(adj, [h], new Set(placed));
    for (const o of homeIds) if (!bypass.has(o)) fail.push(`${h} bypass ${o}`);
  });
  for (const v of Object.keys(sectors)) {
    if (homeIds.includes(v) || !adj.get(v).length) continue;
    const d = hops(adj, [homeIds[0] === v ? homeIds[1] : homeIds[0]], new Set([v]));
    if (homeIds.some((h) => !d.has(h))) fail.push(`cut ${v}`);
  }
  const all = Object.values(sectors);
  const missing = (field, catalogue) =>
    Object.keys(catalogue).filter((k) => !all.some((s) => s[field] === k));
  const kinds = missing('kind', data.sectorKinds).filter(
    (k) => k !== 'empty' && k !== 'fork_station',
  );
  if (kinds.length) fail.push(`kinds ${kinds}`);
  if (missing('terrain', data.sectors).length)
    fail.push(`terrains ${missing('terrain', data.sectors)}`);
  if (missing('planetType', data.planetTypes).length)
    fail.push(`worlds ${missing('planetType', data.planetTypes)}`);
  for (const k of ['graveyard', 'debris_field'])
    if (all.filter((s) => s.kind === k).length !== 1) fail.push(`${k} count`);
  const minPair = Math.min(...pair);
  if (minPair < 4) fail.push(`seats ${minPair} hops apart`);
  if (fail.length) throw new Error(`${cfg.id}: ${fail.slice(0, 12).join('; ')}`);

  // Report: who is near what, for the eye and for the PR.
  const tally = (pick) =>
    Object.entries(all.reduce((m, s) => ((m[pick(s)] = (m[pick(s)] ?? 0) + 1), m), {}))
      .sort((p, q) => q[1] - p[1])
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
  const hist = pair.reduce((m, h) => ((m[h] = (m[h] ?? 0) + 1), m), {});
  console.log(
    `${cfg.id}: ${all.length} provinces, ${g.edges.paths.length} lanes, ${g.edges.sealed.length} sealed, ` +
      `${regions.length} areas, ${placed.length} inhabitants, seats ≥${minPair} hops apart`,
  );
  console.log(
    '  nearest-seat hops:',
    homeIds
      .map((h) => Math.min(...homeIds.filter((o) => o !== h).map((o) => hops(adj, [h]).get(o))))
      .join(' '),
  );
  console.log(
    '  pair hops histogram:',
    JSON.stringify(Object.fromEntries(Object.entries(hist).slice(0, 6))),
  );
  console.log(
    '  kinds',
    tally((s) => s.kind),
  );
  console.log(
    '  areas',
    tally((s) => areas[AREA[Object.keys(sectors).find((k) => sectors[k] === s)]].template),
  );
  return content;
}

for (const seats of process.argv[2] ? [Number(process.argv[2])] : [20, 50]) {
  const cfg = MAPS[seats];
  if (!cfg) throw new Error(`no map for ${seats} seats`);
  const started = performance.now();
  const content = finish(seats, cfg, generate(seats, cfg));
  writeFileSync(`${ROOT}data/maps/${cfg.id}.json`, JSON.stringify(content, null, 2) + '\n');
  console.log(`  wrote data/maps/${cfg.id}.json in ${Math.round(performance.now() - started)} ms`);
}

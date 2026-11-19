/**
 * Lays the star systems of the hand-made and Python-generated maps (`star-systems.mjs`):
 * `node scripts/lay-stars.mjs` rewrites each map below in place. The FFA maps lay theirs in
 * `generate-ffa.mjs`. Run it again after regenerating one of these maps: the generators do
 * not know about stars, and `data/starSystems.test.ts` fails on a map whose star went missing.
 *
 * Where: a star takes a flare zone's place — flares exist because a star is there. Only
 * where it keeps the map fair: the 3 на 3 map has a single flare zone, on one side, so its
 * pair stands in the storms of the middle. The duel, the 2 на 2 map and the FFA for 4 are a
 * battle between star systems (owner 2026-11-19): no body between the sides, a new star behind
 * each side (`BEHIND`), a different class on each, and provinces round each system — authored
 * in the duel itself, laid here on the far side of each 2 на 2 and FFA-4 star (`rim`). The
 * competitive maps
 * take no ring (`RING`): their provinces are not mirror-exact, so a ring would re-kind a
 * province on one side only. The test maps show other classes with their rings.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { layStars, setRimBehind, setStarsBehind } from './star-systems.mjs';
import { spacingOf } from './celestial-rings.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

export const STARS = {
  // The 3 на 3 map's one flare zone lies on one side; its stars are blue giants in the
  // ion storms of the middle, mirror to mirror.
  'team-3v3': [
    ['crown_104', 'blue_giant'],
    ['crown_105', 'blue_giant'],
  ],
  'duel-testbed': [['flare_2', 'pulsar']],
  'proving-ground': [['C12R8', 'blue_giant']],
};

/** Maps whose stars bring their ring of neighbours (the rest lay the star alone). */
const RING = new Set(['duel-testbed', 'proving-ground']);

/** New stars behind each side, a different class on each (owner 2026-11-19), set
 *  `BEHIND_STEPS` map steps past the side (`setStarsBehind`); `rim` — the provinces on the far
 *  side of a star, `turn` — a star whose far side is another's turned half round
 *  (`setRimBehind`). */
export const BEHIND = {
  'duel-1': {
    stars: [
      ['home_1', 'home_sun_1', 'red_giant'],
      ['home_2', 'home_sun_2', 'blue_giant'],
    ],
  },
  // 2 на 2 like the duel (owner 2026-11-19, schematic v1 approved): a star behind each team's
  // pair of capitals. Five provinces behind team A's star, turned half round for team B, put
  // the ring among provinces with a road behind the star; found by search, none of the lanes
  // round the capitals moves. Turned exactly, the two corner districts (home_1, home_4) would
  // come out copies two lanes deep; team B's star stands 72 units off, the smallest nudge that
  // keeps every contract of `teamMap.test.ts` (its corner world loses the road to the open
  // space north of it).
  'team-2v2': {
    stars: [
      [['home_1', 'home_2'], 'home_sun_a', 'red_giant'],
      [['home_3', 'home_4'], 'home_sun_b', 'blue_giant', [-60, 40]],
    ],
    rim: {
      home_sun_a: [
        [-3091, -665, 'nebula', 'nebula'],
        [-3251, -365, 'asteroid', 'asteroid_field'],
        [-3131, 554, 'solar_flare', 'solar_flare_zone'],
        [-2771, -945, 'asteroid', 'asteroid_field'],
        [-3006, -30, 'empty', 'empty_space'],
      ],
    },
    turn: { home_sun_b: 'home_sun_a' },
  },
  // FFA for 4 the same way (owner 2026-11-19, «И ФФА на 4 тоже придумай и сделай. Меня не
  // спрашивай»): the star in the middle goes (its place is open deep space, authored in the map
  // as `hollow`), a star of its own class behind each capital and five provinces beyond it,
  // found by search so that no capital's neighbourhood copies another's two lanes deep and
  // rivals stay five lanes apart. The map is not mirror-exact, so each star's far side is laid
  // where it is, not turned from another's.
  'ffa-4': {
    stars: [
      ['home_1', 'home_sun_1', 'red_giant'],
      ['home_2', 'home_sun_2', 'blue_giant'],
      ['home_3', 'home_sun_3', 'yellow_dwarf'],
      ['home_4', 'home_sun_4', 'white_dwarf'],
    ],
    rim: {
      home_sun_1: [
        [-1597, -512, 'solar_flare', 'solar_flare_zone'],
        [-1730, -781, 'empty', 'empty_space'],
        [-1658, -1073, 'empty', 'empty_space'],
        [-1416, -1251, 'empty', 'empty_space'],
        [-1116, -1231, 'solar_flare', 'solar_flare_zone'],
      ],
      home_sun_2: [
        [830, -1356, 'ion_storm', 'ion_storm'],
        [1121, -1431, 'empty', 'empty_space'],
        [1393, -1302, 'empty', 'empty_space'],
        [1517, -1028, 'empty', 'empty_space'],
        [1437, -739, 'dense_nebula', 'dense_nebula'],
      ],
      home_sun_3: [
        [1466, 362, 'solar_flare', 'solar_flare_zone'],
        [1812, 624, 'empty', 'empty_space'],
        [1796, 1059, 'empty', 'empty_space'],
        [1431, 1295, 'empty', 'empty_space'],
        [1028, 1131, 'asteroid', 'asteroid_field'],
      ],
      home_sun_4: [
        [-829, 1527, 'nebula', 'nebula'],
        [-1118, 1607, 'empty', 'empty_space'],
        [-1392, 1482, 'empty', 'empty_space'],
        [-1521, 1211, 'empty', 'empty_space'],
        [-1446, 920, 'nebula', 'nebula'],
      ],
    },
  },
};
const BEHIND_STEPS = 1.2;

/** The real core's mosaic, bundled once: who touches whom on the map as it stands. */
export async function mosaicNeighbours() {
  const res = await build({
    stdin: {
      contents: "export { mosaicBorderSegments } from './packages/shared-core/src/index';\n",
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
  new Function('module', 'exports', 'require', res.outputFiles[0].text)(mod, mod.exports, () => ({}));
  return (map) => {
    const seeds = Object.keys(map.sectors)
      .sort()
      .map((id) => {
        const s = map.sectors[id];
        return { id, x: s.position.x, y: s.position.y, size: s.size ?? 1 };
      });
    const near = new Map(seeds.map((s) => [s.id, []]));
    for (const { a, b } of mod.exports.mosaicBorderSegments(seeds, map.edge)) {
      near.get(a).push(b);
      near.get(b).push(a);
    }
    return near;
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const neighbours = await mosaicNeighbours();
  for (const id of new Set([...Object.keys(STARS), ...Object.keys(BEHIND)])) {
    const placements = STARS[id] ?? [];
    const file = `${ROOT}data/maps/${id}.json`;
    const map = JSON.parse(readFileSync(file, 'utf8'));
    const { stars: behind = [], rim, turn } = BEHIND[id] ?? {};
    const laid = (sid, cls) => map.sectors[sid]?.kind === 'star' && map.sectors[sid].terrain === cls;
    if (placements.every(([sid, cls]) => laid(sid, cls)) && behind.every(([, sid, cls]) => laid(sid, cls))) {
      console.log(`${id}: stars already laid`);
      continue;
    }
    // Measured before any star stands, so a star set behind a capital keeps the map's step.
    const step = spacingOf(map);
    layStars(map, placements, neighbours, { ring: RING.has(id) });
    if (behind.length) {
      const mid = setStarsBehind(map, behind, step, BEHIND_STEPS);
      if (rim) setRimBehind(map, rim, mid, turn);
    }
    writeFileSync(file, JSON.stringify(map, null, 2) + '\n');
    console.log(`${id}: ${[...placements, ...behind.map(([, s, c]) => [s, c])].map(([s, c]) => `${s} ${c}`).join(', ')}`);
  }
}

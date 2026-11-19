/**
 * Lays the star systems of the hand-made and Python-generated maps (`star-systems.mjs`):
 * `node scripts/lay-stars.mjs` rewrites each map below in place. The FFA maps lay theirs in
 * `generate-ffa.mjs`. Run it again after regenerating one of these maps: the generators do
 * not know about stars, and `data/starSystems.test.ts` fails on a map whose star went missing.
 *
 * Where: a star takes a flare zone's place — flares exist because a star is there. Only
 * where it keeps the map fair: on the 2 на 2 map both sides get one, mirror to mirror; the
 * 3 на 3 map has a single flare zone, on one side, so its pair stands in the storms of the
 * middle. The duel is a battle between two star systems (owner 2026-11-19): no star between
 * the capitals, a new one behind each (`BEHIND`), a different class on each side, and the
 * provinces round each system are authored in the map itself. The competitive maps take no
 * ring (`RING`):
 * their provinces are not mirror-exact, so a ring would re-kind a province on one side only.
 * The test maps show other classes with their rings.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { layStars, setStarsBehind } from './star-systems.mjs';
import { spacingOf } from './celestial-rings.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

export const STARS = {
  'team-2v2': [
    ['reach_82', 'yellow_dwarf'],
    ['reach_83', 'yellow_dwarf'],
  ],
  // The 3 на 3 map's one flare zone lies on one side; its stars are blue giants in the
  // ion storms of the middle, mirror to mirror.
  'team-3v3': [
    ['crown_104', 'blue_giant'],
    ['crown_105', 'blue_giant'],
  ],
  'ffa-4': [['cinder', 'yellow_dwarf']],
  'duel-testbed': [['flare_2', 'pulsar']],
  'proving-ground': [['C12R8', 'blue_giant']],
};

/** Maps whose stars bring their ring of neighbours (the rest lay the star alone). */
const RING = new Set(['duel-testbed', 'proving-ground']);

/** New stars behind the duel's capitals, a different class on each side (owner 2026-11-19),
 *  set `BEHIND_STEPS` map steps past each capital (`setStarsBehind`). */
export const BEHIND = {
  'duel-1': [
    ['home_1', 'home_sun_1', 'red_giant'],
    ['home_2', 'home_sun_2', 'blue_giant'],
  ],
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
    const behind = BEHIND[id] ?? [];
    const laid = (sid, cls) => map.sectors[sid]?.kind === 'star' && map.sectors[sid].terrain === cls;
    if (placements.every(([sid, cls]) => laid(sid, cls)) && behind.every(([, sid, cls]) => laid(sid, cls))) {
      console.log(`${id}: stars already laid`);
      continue;
    }
    // Measured before any star stands, so a star set behind a capital keeps the map's step.
    const step = spacingOf(map);
    layStars(map, placements, neighbours, { ring: RING.has(id) });
    if (behind.length) setStarsBehind(map, behind, step, BEHIND_STEPS);
    writeFileSync(file, JSON.stringify(map, null, 2) + '\n');
    console.log(`${id}: ${[...placements, ...behind.map(([, s, c]) => [s, c])].map(([s, c]) => `${s} ${c}`).join(', ')}`);
  }
}

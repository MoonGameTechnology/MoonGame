/**
 * Lays the star systems of the hand-made and Python-generated maps (`star-systems.mjs`):
 * `node scripts/lay-stars.mjs` rewrites each map below in place. The FFA maps lay theirs in
 * `generate-ffa.mjs`. Run it again after regenerating one of these maps: the generators do
 * not know about stars, and `data/starSystems.test.ts` fails on a map whose star went missing.
 *
 * Where: a star takes a flare zone's place — flares exist because a star is there. Only
 * where it keeps the map fair: on the 2 на 2 map both sides get one, mirror to mirror; the
 * duel's lies between the capitals; the 3 на 3 map has a single flare zone, on one side, so
 * its pair stands in the storms of the middle. The competitive maps take no ring (`RING`):
 * their provinces are not mirror-exact, so a ring would re-kind a province on one side only.
 * The test maps show other classes with their rings.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { layStars } from './star-systems.mjs';

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
  'duel-1': [['crossing', 'yellow_dwarf']],
  'ffa-4': [['cinder', 'yellow_dwarf']],
  'duel-testbed': [['flare_2', 'pulsar']],
  'proving-ground': [['C12R8', 'blue_giant']],
};

/** Maps whose stars bring their ring of neighbours (the rest lay the star alone). */
const RING = new Set(['duel-testbed', 'proving-ground']);

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
  for (const [id, placements] of Object.entries(STARS)) {
    const file = `${ROOT}data/maps/${id}.json`;
    const map = JSON.parse(readFileSync(file, 'utf8'));
    if (placements.every(([sid, cls]) => map.sectors[sid]?.kind === 'star' && map.sectors[sid].terrain === cls)) {
      console.log(`${id}: stars already laid`);
      continue;
    }
    layStars(map, placements, neighbours, { ring: RING.has(id) });
    writeFileSync(file, JSON.stringify(map, null, 2) + '\n');
    console.log(`${id}: ${placements.map(([s, c]) => `${s} ${c}`).join(', ')}`);
  }
}

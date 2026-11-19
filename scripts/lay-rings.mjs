/**
 * Lays the rings round the stars and black holes of the hand-made and Python-generated maps
 * (`celestial-rings.mjs`): `node scripts/lay-rings.mjs` rewrites each map below in place,
 * after `lay-stars.mjs` has laid its stars. The FFA maps lay theirs in `generate-ffa.mjs`.
 * Run it again after regenerating one of these maps: the generators know nothing of rings,
 * and `data/celestialRings.test.ts` fails on a body left without one.
 *
 * Each plan was found by search (2026-11-19): of the rings that close round the body
 * without moving a seat or its opening worlds, the one that changes the fewest lanes, the
 * body and its ring covering about three provinces. Bodies are ringed in the order listed.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { layRings } from './celestial-rings.mjs';
import { mosaicNeighbours } from './lay-stars.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

export const RINGS = {
  // The stars behind the capitals (`lay-stars.mjs` BEHIND) take the same plan: turned half
  // round with the map, the two rings fall on each other.
  'duel-1': {
    plans: {
      home_sun_1: { k: 8, turn: 0.5, clear: 1.3 },
      home_sun_2: { k: 8, turn: 0.5, clear: 1.3 },
    },
  },
  // Four star systems (`lay-stars.mjs` BEHIND), each star with the duel's plan; the
  // provinces beyond each star hold, like the 2 на 2 map's.
  'ffa-4': {
    hold: [1, 2, 3, 4].flatMap((s) => [1, 2, 3, 4, 5].map((n) => `home_sun_${s}_rim_${n}`)),
    plans: {
      home_sun_1: { k: 8, turn: 0.5, clear: 1.3 },
      home_sun_2: { k: 8, turn: 0.5, clear: 1.3 },
      home_sun_3: { k: 8, turn: 0.5, clear: 1.3 },
      home_sun_4: { k: 8, turn: 0.5, clear: 1.3 },
    },
  },
  // Two star systems like the duel: the same plan, turned half round with the map. The
  // provinces beyond each star (`lay-stars.mjs` BEHIND) hold: they were found round the
  // rings as laid.
  'team-2v2': {
    hold: [1, 2, 3, 4, 5].flatMap((n) => [`home_sun_a_rim_${n}`, `home_sun_b_rim_${n}`]),
    plans: {
      home_sun_a: { k: 8, turn: 0.5, clear: 1.3 },
      home_sun_b: { k: 8, turn: 0.5, clear: 1.3 },
    },
  },
  'team-3v3': {
    plans: {
      crown_104: { k: 10, turn: 0, clear: 1.22 },
      crown_105: { k: 8, turn: 0.25, clear: 1.3 },
      remnant: { k: 8, turn: 0.75, clear: 1.14 },
    },
  },
  // The storm south of the pulsar holds: pushed north, it would cut the nebula's transit
  // route to the world beside the star.
  'duel-testbed': {
    hold: ['storm_2'],
    plans: {
      singularity: { k: 8, turn: 0.5, clear: 1.3 },
      flare_2: { k: 8, turn: 0.75, clear: 1.3, anchorClear: 1.2 },
    },
  },
  'proving-ground': {
    plans: {
      C12R8: { k: 10, turn: 0.75, clear: 1.14 },
      C8R4: { k: 10, turn: 0.25, clear: 1.06 },
    },
  },
  'pve-4': { plans: { black_hole: { k: 8, turn: 0.5, clear: 1.22 } } },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const neighbours = await mosaicNeighbours();
  for (const [id, { plans, hold }] of Object.entries(RINGS)) {
    const file = `${ROOT}data/maps/${id}.json`;
    const map = JSON.parse(readFileSync(file, 'utf8'));
    if (Object.keys(plans).every((b) => map.sectors[`${b}_ring_1`])) {
      console.log(`${id}: rings already laid`);
      continue;
    }
    const laid = layRings(map, plans, neighbours, { hold });
    writeFileSync(file, JSON.stringify(map, null, 2) + '\n');
    console.log(
      `${id}: ${Object.entries(laid)
        .map(([b, r]) => `${b} ${r.ring.length} (moved ${r.moved.length}, body ${r.shift})`)
        .join(', ')}`,
    );
  }
}

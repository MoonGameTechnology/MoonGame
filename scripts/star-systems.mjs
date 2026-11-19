/**
 * Star systems (owner 2026-11-17): «каждая такая моделька должна иметь свою провинцию, а
 * вокруг неё логичные и возможные для неё другие провинции». A star is a province of kind
 * `star` — impassable and uncapturable, like the Abyss black hole — whose class is its
 * terrain (`data/sectors.json`, family `star`). Its first ring of neighbours takes what that
 * class of star makes of its surroundings:
 *
 * - yellow dwarf — flares close in, asteroid belts; its planets keep their worlds (the zone
 *   where life is possible);
 * - red giant — flares and burnt-out dead worlds: the swollen star scorched its inner planets
 *   (volcanic worlds);
 * - blue giant — ion storms from its hard radiation and the dense nebula of the cloud it was
 *   born in (irradiated worlds);
 * - white dwarf — dead worlds and the nebula of the shell it shed (barren worlds);
 * - pulsar — ion storms from its beams and the dead cores of what the supernova left
 *   (irradiated worlds);
 * - binary star — flares and asteroid fields: two stars leave no stable orbit for a planet
 *   to form on, and what was to become one stays rubble.
 *
 * Only a neutral province of a plain kind is touched: never a seat or a world next to one (a
 * seat's opening worlds are its start, and every seat must start alike), an inhabitant, a
 * station, another star, a hole or a disk, a prize (a world set in a nebula, a garrison, a
 * building), nor a province with a story on it (hero, vault, captive…). A province two stars
 * touch keeps the first star's mark (stars run in id order).
 *
 * Pure: takes the map content and a neighbour function, mutates the sectors it re-kinds.
 */

/** Size of the star's own province: a giant claims more space. A dwarf keeps the size of
 *  the flare zone it replaced — a smaller cell would hand its land to the neighbours, and a
 *  seat next door would gain a third opening world. */
export const STAR_SIZE = {
  yellow_dwarf: 1,
  red_giant: 1.6,
  blue_giant: 1.4,
  white_dwarf: 1,
  pulsar: 1,
  binary_star: 1.3,
};

/** Kind → the terrain that kind of province stands on in a star's ring. */
const TERRAIN_OF = {
  solar_flare: 'solar_flare_zone',
  asteroid: 'asteroid_field',
  dead_world: 'depleted_system',
  ion_storm: 'ion_storm',
  dense_nebula: 'dense_nebula',
  nebula: 'nebula',
};

/** What a class makes of its first ring: the kinds plain neighbours take in turn (round the
 *  star, starting from the east), and the world its neutral planets become (`null` — they
 *  stay as they are). */
export const STAR_RING = {
  yellow_dwarf: { kinds: ['solar_flare', 'asteroid'], world: null },
  red_giant: { kinds: ['solar_flare', 'dead_world'], world: 'volcanic' },
  blue_giant: { kinds: ['ion_storm', 'dense_nebula'], world: 'irradiated' },
  white_dwarf: { kinds: ['dead_world', 'nebula'], world: 'barren' },
  pulsar: { kinds: ['ion_storm', 'dead_world'], world: 'irradiated' },
  binary_star: { kinds: ['solar_flare', 'asteroid'], world: null },
};

/** Plain kinds a star may re-kind. Graveyards and debris fields are one of a kind on the
 *  big maps, and a dense cluster is an area's prize: none of them moves. */
const PLAIN = new Set(['asteroid', 'nebula', 'dead_world', 'ion_storm', 'dense_nebula', 'solar_flare']);
const STORY = ['recruitHero', 'rendezvous', 'vault', 'captive', 'transit'];

const isSeat = (map, sector) =>
  sector.owner !== null && sector.owner !== undefined && (map.slots?.[sector.owner] || map.players?.[sector.owner]);

/**
 * Lays the stars of `placements` (`[sectorId, class]`) on `map`. `neighbours(map)` answers,
 * for the map as it stands, `id → ids of the provinces whose cells touch it` — asked once,
 * after every star took its size, because a star's size moves its borders. `ring: false`
 * lays the stars alone: on a competitive map a ring would hand one side other provinces
 * than the other.
 */
export function layStars(map, placements, neighbours, { ring: withRing = true } = {}) {
  // A star beside a capital would shut one of its ways and, the capital's lane budget
  // freed, open another to a third world: that seat would no longer start like the rest.
  // Asked before the star takes its size and after, since a giant's cell grows.
  const besideCapital = (near) => {
    for (const [id] of placements) {
      const capital = (near.get(id) ?? []).find((n) => map.slots?.[map.sectors[n].owner]);
      if (capital) throw new Error(`${map.id}: ${id} borders the capital ${capital}`);
    }
  };
  besideCapital(neighbours(map));
  for (const [id, cls] of placements) {
    const s = map.sectors[id];
    if (!s) throw new Error(`${map.id}: no sector ${id} for a star`);
    if (!STAR_RING[cls]) throw new Error(`${map.id}: unknown star class ${cls}`);
    if (s.owner) throw new Error(`${map.id}: ${id} is owned, a star cannot stand there`);
    const through = Object.keys(map.sectors).find((k) =>
      (map.sectors[k].transit ?? []).some((pair) => pair.includes(id)),
    );
    if (through) throw new Error(`${map.id}: a route through ${through} leads to ${id}`);
    s.kind = 'star';
    s.terrain = cls;
    if (STAR_SIZE[cls] !== 1) s.size = STAR_SIZE[cls];
    else delete s.size;
    delete s.planetType;
    s.buildings = [];
    s.garrison = [];
  }
  const near = neighbours(map);
  besideCapital(near);
  if (!withRing) return map;
  const marked = new Set();
  // A ring never takes the map's last world of a type or last province of a kind: the maps
  // show the whole catalogue, and a star must not quietly narrow it.
  const count = (field) => {
    const m = new Map();
    for (const s of Object.values(map.sectors)) if (s[field] !== undefined) m.set(s[field], (m.get(s[field]) ?? 0) + 1);
    return m;
  };
  const types = count('planetType');
  const kindsLeft = count('kind');
  const terrainsLeft = count('terrain');
  const take = (m, k) => {
    if ((m.get(k) ?? 0) <= 1) return false;
    m.set(k, m.get(k) - 1);
    return true;
  };
  for (const [id, s] of Object.entries(map.sectors))
    if (isSeat(map, s)) for (const n of [id, ...(near.get(id) ?? [])]) marked.add(n);
  for (const [id, cls] of [...placements].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const star = map.sectors[id];
    const ring = (near.get(id) ?? [])
      .filter((n) => !marked.has(n))
      .map((n) => [n, map.sectors[n]])
      .filter(
        ([, s]) =>
          !(s.owner ?? null) &&
          !STORY.some((k) => s[k] !== undefined) &&
          !(s.buildings ?? []).length &&
          !(s.garrison ?? []).length &&
          (s.kind === 'planet' || s.planetType === undefined),
      )
      // round the star from the east, so the alternation is fixed by geometry, not by ids
      .sort(([, a], [, b]) => angle(star, a) - angle(star, b));
    const { kinds, world } = STAR_RING[cls];
    let turn = 0;
    for (const [n, s] of ring) {
      if (s.kind === 'planet') {
        marked.add(n);
        if (world && s.planetType !== world && (s.planetType === undefined || take(types, s.planetType))) {
          s.planetType = world;
          types.set(world, (types.get(world) ?? 0) + 1);
        }
      } else if (PLAIN.has(s.kind)) {
        marked.add(n);
        const kind = kinds[turn++ % kinds.length];
        const terrain = TERRAIN_OF[kind];
        if (s.kind === kind || (kindsLeft.get(s.kind) ?? 0) <= 1) continue;
        if (s.terrain !== terrain && !take(terrainsLeft, s.terrain)) continue;
        take(kindsLeft, s.kind);
        kindsLeft.set(kind, (kindsLeft.get(kind) ?? 0) + 1);
        if (s.terrain !== terrain) terrainsLeft.set(terrain, (terrainsLeft.get(terrain) ?? 0) + 1);
        s.kind = kind;
        s.terrain = terrain;
      }
    }
  }
  return map;
}

/**
 * Once a star stands inside its impassable ring (`celestial-rings.mjs`), its first ring of
 * places is what borders that ring from outside, and the push brought new provinces there. A
 * neutral world among them takes the class's world, as the star's own neighbours did in
 * `layStars`: a seat's side, an inhabitant, a prize or a story keeps its province, and the
 * map's last world of a type keeps its type. Plain kinds stay as they are: a kind sets a
 * province's lane budget, and the ring was laid on the lanes as they stood.
 */
export function markRingWorlds(map, stars, near) {
  const types = new Map();
  for (const s of Object.values(map.sectors))
    if (s.planetType !== undefined) types.set(s.planetType, (types.get(s.planetType) ?? 0) + 1);
  const seatSide = new Set();
  for (const [id, s] of Object.entries(map.sectors))
    if (isSeat(map, s)) for (const n of [id, ...(near.get(id) ?? [])]) seatSide.add(n);
  for (const id of [...stars].sort()) {
    const { world } = STAR_RING[map.sectors[id].terrain];
    if (!world) continue;
    const ring = new Set(near.get(id) ?? []);
    const first = [...new Set([...ring].flatMap((r) => near.get(r) ?? []))].filter((n) => n !== id && !ring.has(n));
    for (const n of first.sort()) {
      const s = map.sectors[n];
      if (s.kind !== 'planet' || s.planetType === world || seatSide.has(n) || (s.owner ?? null)) continue;
      if (STORY.some((k) => s[k] !== undefined) || (s.buildings ?? []).length || (s.garrison ?? []).length) continue;
      if (s.planetType !== undefined) {
        if ((types.get(s.planetType) ?? 0) <= 1) continue;
        types.set(s.planetType, types.get(s.planetType) - 1);
      }
      s.planetType = world;
      types.set(world, (types.get(world) ?? 0) + 1);
    }
  }
  return map;
}

function angle(c, s) {
  const a = Math.atan2(s.position.y - c.position.y, s.position.x - c.position.x);
  return a < 0 ? a + 2 * Math.PI : a;
}

/**
 * Sets a new star behind each capital of a duel (owner 2026-11-19: «Добавь сзади столиц по
 * звездам», «Пусть разные типы звёзд будут с разных сторон»): on the line through the two
 * capitals, `steps` map steps past each one, away from the enemy. The second stands exactly
 * where the first does with the map turned half round the capitals' midpoint, so both starts
 * keep the same space round them; only the class differs. `pairs` is
 * `[[capitalId, starId, class], [capitalId, starId, class]]`; each star joins its capital's
 * area. Its ring (`celestial-rings.mjs`) is laid after, and may step it a little further out.
 */
export function setStarsBehind(map, pairs, step, steps) {
  const [[c1, id1, cls1], [c2, id2, cls2]] = pairs;
  const h1 = map.sectors[c1].position;
  const h2 = map.sectors[c2].position;
  const mid = { x: (h1.x + h2.x) / 2, y: (h1.y + h2.y) / 2 };
  const len = Math.hypot(h1.x - h2.x, h1.y - h2.y);
  const p1 = {
    x: Math.round(h1.x + ((h1.x - h2.x) / len) * steps * step),
    y: Math.round(h1.y + ((h1.y - h2.y) / len) * steps * step),
  };
  const p2 = { x: Math.round(2 * mid.x - p1.x), y: Math.round(2 * mid.y - p1.y) };
  for (const [capital, id, cls, position] of [
    [c1, id1, cls1, p1],
    [c2, id2, cls2, p2],
  ]) {
    if (map.sectors[id]) throw new Error(`${map.id}: ${id} already stands`);
    if (!STAR_RING[cls]) throw new Error(`${map.id}: unknown star class ${cls}`);
    map.sectors[id] = { position, kind: 'star', terrain: cls, buildings: [], garrison: [] };
    const region = (map.regions ?? []).find((r) => r.sectors.includes(capital));
    if (region) region.sectors.push(id);
  }
  return map;
}

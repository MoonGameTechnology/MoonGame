import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { GameData } from '../data/schemas';
import { hashGameDataBundle, loadGameData } from '../data/loadGameData';
import { avaShape, parseMatchMap, type MatchMap } from '../data/mapSchema';
import { buildStateFromMap, validateMatchMap } from './buildFromMap';
import { getStance } from './diplomacy';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const readJson = (p: string): unknown => JSON.parse(readFileSync(path.join(repoRoot, p), 'utf8'));

function shippedData(): GameData {
  return loadGameData((name) => readJson('data/' + name));
}

const data = shippedData();
const exampleMap = (): MatchMap => parseMatchMap(readJson('data/maps/skirmish-1.json'));

/** Тот же пример, но с АВТОРСКИМ списком путей — как карты писались до M4.3. Правила
 *  авторских путей (соседство по Габриэлю, бюджет связей, самопетли) живут только на
 *  этой ветке: у выведенной из мозаики карты нарушить их нечем, потому что список путей
 *  не пишет человек. Держим обе, пока формат поддерживает обе. */
const authoredMap = (): MatchMap => {
  const map = exampleMap();
  map.paths = [
    ['nexus', 'home_green'],
    ['nexus', 'home_red'],
    ['nexus', 'drift'],
    ['nexus', 'veil'],
  ];
  return map;
};

describe('buildStateFromMap (map-roadmap.md M1.2)', () => {
  it('builds a GameState from the example map', () => {
    const state = buildStateFromMap(exampleMap(), data);
    expect(Object.keys(state.planets).sort()).toEqual(['drift', 'home_green', 'home_red', 'nexus', 'veil']);
    expect(state.planets.home_green!.owner).toBe('green');
    expect(state.planets.nexus!.owner).toBeNull();
    expect(state.players.green!.faction).toBe('vanguard');
    expect(state.fleets.green_1!.location).toBe('home_green');
    expect(state.fleets.green_1!.units).toEqual([
      { unit: 'cruiser', count: 2 },
      { unit: 'scout_drone', count: 1 },
    ]);
  });

  it('модули стартового флота доезжают из карты в стек (AUD-28)', () => {
    // Матки Роя на `pve-1` объявлены с выводковой камерой — и в игре они с ней.
    const map = parseMatchMap(readJson('data/maps/pve-1.json'));
    const state = buildStateFromMap(map, data);
    const brood = state.fleets.p3_1!.units.find((u) => u.unit === 'swarm_brood_mother');
    expect(brood?.modules).toEqual(['swarm_brood_chamber']);
    // Стек без модулей поля не получает — как и раньше.
    expect(state.fleets.p3_1!.units.find((u) => u.unit === 'scout_drone')).not.toHaveProperty('modules');
  });

  it('модуль, который корпусу не встать, карта не пропускает (AUD-28)', () => {
    const map = exampleMap();
    map.fleets.green_1!.units = [{ unit: 'cruiser', count: 2, modules: ['swarm_brood_chamber'] }];
    expect(validateMatchMap(map, data).some((i) => i.startsWith('E_MAP_LOADOUT:green_1:cruiser'))).toBe(true);
    map.fleets.green_1!.units = [{ unit: 'cruiser', count: 2, modules: ['no_such_module'] }];
    expect(validateMatchMap(map, data).some((i) => i.startsWith('E_MAP_LOADOUT:green_1:cruiser'))).toBe(true);
  });

  it('carries a map player ai flag onto the seated player', () => {
    const map = exampleMap();
    map.players.red!.ai = true;
    const state = buildStateFromMap(map, data);
    expect(state.players.red!.ai).toBe(true);
    expect(state.players.green!.ai).toBeUndefined();
  });

  it('preserves an NPC role independently of its field AI controller', () => {
    const map = parseMatchMap({
      ...exampleMap(),
      players: {
        ...exampleMap().players,
        pirates: { name: 'Pirate Base', faction: 'vanguard', npc: 'pirate', ai: false },
      },
    });
    const state = buildStateFromMap(map, data);
    expect(state.players.pirates!.npc).toBe('pirate');
    expect(state.players.pirates!.ai).not.toBe(true);
    expect(state.players.green!.npc).toBeUndefined();
    expect(getStance(state, 'green', 'pirates')).toBe('war');
  });

  it('derives sector links from the undirected paths (sorted, symmetric)', () => {
    const state = buildStateFromMap(authoredMap(), data);
    // nexus is the hub → linked to all four spokes; a spoke links back to nexus
    expect(state.planets.nexus!.links).toEqual(['drift', 'home_green', 'home_red', 'veil']);
    expect(state.planets.home_green!.links).toEqual(['nexus']);
    expect(state.planets.drift!.links).toEqual(['nexus']);
  });

  it('a map WITHOUT `paths` takes its neighbours from the mosaic (M4.3)', () => {
    // Та же карта, но без авторского списка. Раньше звезда обещала переход по каждой
    // общей границе и давала его только через центр: четыре границы из восьми молча
    // врали. Теперь соседи — те, с кем клетка делит границу, и лжи взяться неоткуда.
    const state = buildStateFromMap(exampleMap(), data);
    expect(state.planets.home_green!.links).toEqual(['drift', 'nexus', 'veil']);
    expect(state.planets.nexus!.links).toEqual(['drift', 'home_green', 'home_red', 'veil']);
    // Симметрия соседства — не следствие аккуратности автора, а следствие геометрии.
    for (const [id, p] of Object.entries(state.planets))
      for (const n of p.links ?? [])
        expect([id, n, state.planets[n]?.links ?? []]).toEqual([
          id,
          n,
          expect.arrayContaining([id]),
        ]);
    expect(validateMatchMap(exampleMap(), data)).toEqual([]);
  });

  it('an impassable kind gets NO lanes and strands nobody (M2.6 by construction)', () => {
    // Разлом — дыра в карте. Раньше это проверялось постфактум («у непроходимого не
    // должно быть путей»), и держалось тем, что генератор случайно не дал ему рёбер.
    // Теперь это тот же бюджет связей, равный нулю: все его границы закрыты сразу.
    const map = exampleMap();
    map.sectors.drift!.kind = 'rift';
    const state = buildStateFromMap(map, data);
    expect(state.planets.drift!.links).toEqual([]);
    expect(state.planets.drift!.sealed).toEqual(['home_green', 'home_red', 'nexus']);
    expect(validateMatchMap(map, data)).toEqual([]); // остальная карта осталась связной
  });

  it('sets building HP from the data and carries terrain/planetType', () => {
    const state = buildStateFromMap(exampleMap(), data);
    const mine = state.planets.home_green!.buildings.find((b) => b.type === 'mine_t1');
    expect(mine).toBeDefined();
    expect(mine!.hp).toBe(data.buildings.mine_t1!.hp);
    expect(state.planets.drift!.terrain).toBe('asteroid_field');
    expect(state.planets.veil!.planetType).toBe('gas_giant');
  });

  it('is deterministic — same map+data → identical state', () => {
    expect(buildStateFromMap(exampleMap(), data)).toEqual(buildStateFromMap(exampleMap(), data));
  });

  it('stamps version.dataHash with the deployed bundle\'s fingerprint (MP-4)', () => {
    const state = buildStateFromMap(exampleMap(), data);
    expect(state.version.dataHash).toBe(hashGameDataBundle(data));
  });
});

describe('validateMatchMap — neighbour-only paths + integrity (M1.3)', () => {
  it('passes the example map clean', () => {
    expect(validateMatchMap(exampleMap(), data)).toEqual([]);
  });

  it('rejects a path that is not between neighbours (a third sector lies between)', () => {
    const map = authoredMap();
    // home_green↔home_red would cross straight through nexus (which sits between)
    map.paths!.push(['home_green', 'home_red']);
    const issues = validateMatchMap(map, data);
    expect(issues.some((c) => c.startsWith('E_PATH_NOT_NEIGHBOR'))).toBe(true);
    expect(() => buildStateFromMap(map, data)).toThrow(/E_INVALID_MAP/);
  });

  it('flags a disconnected sector', () => {
    const map = authoredMap();
    map.sectors.isle = { position: { x: 999, y: 999 }, kind: 'planet', size: 1, owner: null, buildings: [], garrison: [], traits: [] };
    expect(validateMatchMap(map, data)).toContain('E_MAP_DISCONNECTED');
  });

  it('flags unknown owners, units and a self-loop', () => {
    const map = authoredMap();
    map.sectors.home_green!.owner = 'ghost';
    map.sectors.home_red!.garrison.push({ unit: 'nope', count: 1 });
    map.paths!.push(['nexus', 'nexus']);
    const issues = validateMatchMap(map, data);
    expect(issues).toContain('E_SECTOR_UNKNOWN_OWNER:home_green');
    expect(issues).toContain('E_UNKNOWN_UNIT:nope');
    expect(issues).toContain('E_PATH_SELF_LOOP:nexus');
  });
});

describe('slot-based maps — team-aware start slots (corporation-wars.md §4)', () => {
  const avaMap = (): MatchMap => parseMatchMap(readJson('data/maps/ava-duel-1.json'));

  it('seats assigned players into slots and resolves slot owners', () => {
    const state = buildStateFromMap(avaMap(), data, {
      slots: {
        slot_a: { playerId: 'p1', name: 'Alpha' },
        slot_b: { playerId: 'p2' },
      },
    });
    // slot owners resolved to the concrete players
    expect(state.planets.home_a!.owner).toBe('p1');
    expect(state.planets.home_b!.owner).toBe('p2');
    expect(state.fleets.fleet_a!.owner).toBe('p1');
    // players created from the assignment; start kit = the slot's resources
    expect(state.players.p1!.name).toBe('Alpha');
    expect(state.players.p2!.name).toBe('p2'); // defaults to the id
    expect(state.players.p1!.resources).toEqual({ credits: 300, metal: 300 });
    expect(Object.keys(state.players).sort()).toEqual(['p1', 'p2']);
  });

  it('rejects a slot owner with no assignment (fail-secure)', () => {
    expect(() => buildStateFromMap(avaMap(), data, { slots: { slot_a: { playerId: 'p1' } } })).toThrow(
      /E_SLOT_UNASSIGNED/,
    );
  });

  it('seats the arsenal snapshot onto the slot player, deduped + sorted (ARS-3)', () => {
    const arsenal = {
      hulls: ['cruiser', 'cruiser', 'scout_drone'],
      modules: ['radar_module', 'cargo_bay'],
    };
    const state = buildStateFromMap(avaMap(), data, {
      slots: { slot_a: { playerId: 'p1', arsenal }, slot_b: { playerId: 'p2' } },
    });
    expect(state.players.p1!.arsenal).toEqual({
      hulls: ['cruiser', 'scout_drone'], // deduped + sorted — canonical in state
      modules: ['cargo_bay', 'radar_module'],
    });
    expect(state.players.p2!.arsenal).toBeUndefined(); // no snapshot → unrestricted
    // the seated copy is detached: mutating the caller's object never reaches the match
    arsenal.hulls.push('siege_lance');
    expect(state.players.p1!.arsenal!.hulls).toEqual(['cruiser', 'scout_drone']);
  });

  it('seats a chosen scientist onto the slot player, snapshotting id + level', () => {
    const state = buildStateFromMap(avaMap(), data, {
      slots: {
        slot_a: { playerId: 'p1', scientist: 'void_admiral', scientistLevel: 3 },
        slot_b: { playerId: 'p2' },
      },
    });
    // Legacy single `scientist` input is seated as a one-leader council (`scientists`).
    expect(state.players.p1!.scientists).toEqual([{ id: 'void_admiral', level: 3 }]);
    expect(state.players.p1!.scientist).toBeUndefined(); // legacy field no longer written
    expect(state.players.p2!.scientists).toBeUndefined(); // no leader chosen
  });

  it('rejects a slot assigning an unknown scientist (fail-secure at boot)', () => {
    expect(() =>
      buildStateFromMap(avaMap(), data, {
        slots: { slot_a: { playerId: 'p1', scientist: 'ghost' }, slot_b: { playerId: 'p2' } },
      }),
    ).toThrow(/E_UNKNOWN_SCIENTIST/);
  });

  it('seats a 2-leader council; rejects a duplicate or a third leader (fail-secure)', () => {
    const state = buildStateFromMap(avaMap(), data, {
      slots: {
        slot_a: {
          playerId: 'p1',
          scientists: [{ id: 'void_admiral', level: 3 }, { id: 'polymath' }],
        },
        slot_b: { playerId: 'p2' },
      },
    });
    expect(state.players.p1!.scientists).toEqual([
      { id: 'void_admiral', level: 3 },
      { id: 'polymath', level: 1 }, // level defaults to 1
    ]);
    // Distinct + capped at two — fail-secure at boot.
    expect(() =>
      buildStateFromMap(avaMap(), data, {
        slots: {
          slot_a: { playerId: 'p1', scientists: [{ id: 'void_admiral' }, { id: 'void_admiral' }] },
          slot_b: { playerId: 'p2' },
        },
      }),
    ).toThrow(/E_DUPLICATE_SCIENTIST/);
    expect(() =>
      buildStateFromMap(avaMap(), data, {
        slots: {
          slot_a: {
            playerId: 'p1',
            scientists: [{ id: 'void_admiral' }, { id: 'polymath' }, { id: 'overseer' }],
          },
          slot_b: { playerId: 'p2' },
        },
      }),
    ).toThrow(/E_TOO_MANY_SCIENTISTS/);
  });

  it('seeds a pre-match hero roster as undeployed instances (HERO-9)', () => {
    const state = buildStateFromMap(avaMap(), data, {
      slots: {
        slot_a: { playerId: 'p1', heroes: ['commander', 'warden'] },
        slot_b: { playerId: 'p2' },
      },
    });
    const roster = Object.values(state.heroes ?? {}).filter((x) => x.owner === 'p1');
    expect(roster.map((x) => x.archetype)).toEqual(['commander', 'warden']);
    const main = state.heroes!['hero:p1:1']!;
    // Anchored at the slot's owned world, carrying the archetype loadout, undeployed.
    expect(main.home).toBe('home_a');
    expect(main.location).toBe('home_a');
    // AUD-13: НИКАКОГО отображаемого текста в состоянии — имя героя собирает рендер
    // из `archetype`. Состояние одно на всех игроков, а локаль у каждого своя, поэтому
    // проза из каталога, попавшая сюда, доехала бы до экрана непереведённой.
    expect(main.name).toBeUndefined();
    expect(main.archetype).toBe('commander');
    expect(JSON.stringify(state.heroes)).not.toContain(data.heroes.commander!.name);
    expect(main.abilities).toEqual(data.heroes.commander!.startAbilities);
    expect(main.passives).toEqual(['rally_beacon']);
    expect(main.fleetId).toBeUndefined(); // no ship yet — hero.spawn raises it
    expect(state.heroes!['hero:p2:1']).toBeUndefined(); // p2 chose no roster
    // No roster at all → the heroes record stays absent (back-compat).
    const bare = buildStateFromMap(avaMap(), data, {
      slots: { slot_a: { playerId: 'p1' }, slot_b: { playerId: 'p2' } },
    });
    expect(bare.heroes).toBeUndefined();
  });

  it('rejects an unknown, duplicate or oversized hero roster (fail-secure at boot)', () => {
    const seat = (heroes: string[]) => () =>
      buildStateFromMap(avaMap(), data, {
        slots: { slot_a: { playerId: 'p1', heroes }, slot_b: { playerId: 'p2' } },
      });
    expect(seat(['nobody'])).toThrow(/E_UNKNOWN_HERO/);
    expect(seat(['warden', 'warden'])).toThrow(/E_DUPLICATE_HERO/);
    expect(seat(['commander', 'ravager', 'vanguard', 'warden'])).toThrow(/E_TOO_MANY_HEROES/);
  });

  it('grants pre-match technology picks as completed research (C3)', () => {
    const state = buildStateFromMap(avaMap(), data, {
      slots: {
        // duplicates collapse — the pick lands once
        slot_a: { playerId: 'p1', technologies: ['orbital_logistics', 'orbital_logistics'] },
        slot_b: { playerId: 'p2' },
      },
    });
    expect(state.players.p1!.technologies).toEqual({ completed: ['orbital_logistics'] });
    expect(state.players.p2!.technologies).toBeUndefined(); // no picks → untouched
  });

  it('marks AI-driven seats on the player (bots are not invitable to coalitions)', () => {
    const state = buildStateFromMap(avaMap(), data, {
      slots: { slot_a: { playerId: 'p1', ai: true }, slot_b: { playerId: 'p2' } },
    });
    expect(state.players.p1!.ai).toBe(true);
    expect(state.players.p2!.ai).toBeUndefined(); // human seat stays unmarked
  });

  it('rejects a player id carrying the pair-key separator "|" (fail-secure at boot)', () => {
    // seated via a slot…
    expect(() =>
      buildStateFromMap(avaMap(), data, {
        slots: { slot_a: { playerId: 'clan|alpha' }, slot_b: { playerId: 'p2' } },
      }),
    ).toThrow(/E_BAD_PLAYER_ID/);
    // …and declared statically on the map (schema-level guard)
    const raw = readJson('data/maps/skirmish-1.json') as { players: Record<string, unknown> };
    raw.players['clan|alpha'] = { name: 'X', faction: 'vanguard' };
    expect(() => parseMatchMap(raw)).toThrow();
  });

  it('rejects a player id carrying the offer-key separator ">" too', () => {
    // `>` splices DIRECTED offer keys (`from>to`) — an id containing it could
    // misattribute a standing diplomatic offer to the wrong pair.
    expect(() =>
      buildStateFromMap(avaMap(), data, {
        slots: { slot_a: { playerId: 'a>b' }, slot_b: { playerId: 'p2' } },
      }),
    ).toThrow(/E_BAD_PLAYER_ID/);
  });

  it('rejects a slot granting an unknown technology (fail-secure at boot)', () => {
    expect(() =>
      buildStateFromMap(avaMap(), data, {
        slots: { slot_a: { playerId: 'p1', technologies: ['ghost_tech'] }, slot_b: { playerId: 'p2' } },
      }),
    ).toThrow(/E_UNKNOWN_TECHNOLOGY/);
  });

  it('accepts slot ids as sector/fleet owners (validation clean)', () => {
    expect(validateMatchMap(avaMap(), data)).toEqual([]);
  });

  it('seeds opposing slots at war by default (AVA-1: team → diplomacy)', () => {
    const state = buildStateFromMap(avaMap(), data, {
      slots: { slot_a: { playerId: 'p1' }, slot_b: { playerId: 'p2' } },
    });
    expect(state.diplomacy).toEqual({ 'p1|p2': 'war' });
  });

  it('crossTeamStart:"peace" starts a teamed match peaceful (the AvA peaceful start)', () => {
    const state = buildStateFromMap(avaMap(), data, {
      slots: { slot_a: { playerId: 'p1' }, slot_b: { playerId: 'p2' } },
      crossTeamStart: 'peace',
    });
    expect(state.diplomacy).toEqual({ 'p1|p2': 'peace' });
  });

  it('seeds a 2v2: same side allied, across the sides per crossTeamStart', () => {
    const map = avaMap();
    map.slots.slot_a2 = { team: 'A', spawn: 'fixed', resources: {} };
    map.slots.slot_b2 = { team: 'B', spawn: 'fixed', resources: {} };
    const slots = {
      slot_a: { playerId: 'a1' },
      slot_a2: { playerId: 'a2' },
      slot_b: { playerId: 'b1' },
      slot_b2: { playerId: 'b2' },
    };
    const state = buildStateFromMap(map, data, { slots });
    expect(state.diplomacy).toEqual({
      'a1|a2': 'alliance',
      'b1|b2': 'alliance',
      'a1|b1': 'war',
      'a1|b2': 'war',
      'a2|b1': 'war',
      'a2|b2': 'war',
    });
    // deterministic: the same seats → an identical (canonically ordered) record
    expect(buildStateFromMap(map, data, { slots })).toEqual(state);
  });

  it('a map without teams (plain declared players) seeds a peace free-for-all', () => {
    const state = buildStateFromMap(exampleMap(), data);
    expect(state.diplomacy).toEqual({ 'green|red': 'peace' });
  });

  it('flags a slot id that collides with a player id', () => {
    const map = exampleMap(); // has players green/red
    map.slots.green = { team: 'A', spawn: 'fixed', resources: {} };
    expect(validateMatchMap(map, data)).toContain('E_SLOT_PLAYER_ID_CLASH:green');
  });
});

describe('AvA pool eligibility (AVA-5) — avaEligible tag + shape derived from slots', () => {
  const duel = (): MatchMap => parseMatchMap(readJson('data/maps/ava-duel-1.json'));
  const twoVTwo = (): MatchMap => parseMatchMap(readJson('data/maps/ava-2v2-1.json'));

  it('shipped AvA maps are tagged eligible and validate clean', () => {
    expect(duel().avaEligible).toBe(true);
    expect(twoVTwo().avaEligible).toBe(true);
    expect(validateMatchMap(duel(), data)).toEqual([]);
    expect(validateMatchMap(twoVTwo(), data)).toEqual([]);
  });

  it('avaEligible defaults to false — a regular map stays out of the pool', () => {
    expect(exampleMap().avaEligible).toBe(false);
  });

  it('derives the shape from the slots: duel 2×1, the 2v2 map 2×2, a slotless map null', () => {
    expect(avaShape(duel())).toEqual({ sides: 2, slotsPerSide: 1 });
    expect(avaShape(twoVTwo())).toEqual({ sides: 2, slotsPerSide: 2 });
    expect(avaShape(exampleMap())).toBeNull(); // no slots at all
  });

  it('flags an eligible map whose slots are not a symmetric ≥2-side split', () => {
    const oneSide = duel();
    oneSide.slots.slot_b!.team = 'A'; // both slots end up on one side
    expect(validateMatchMap(oneSide, data)).toContain('E_AVA_SHAPE');
    const lopsided = twoVTwo();
    lopsided.slots.slot_a3 = { team: 'A', spawn: 'fixed', resources: {} }; // A:3 vs B:2
    expect(validateMatchMap(lopsided, data)).toContain('E_AVA_SHAPE');
    // the same lopsided layout WITHOUT the tag is fine — shape only gates the pool
    lopsided.avaEligible = false;
    expect(validateMatchMap(lopsided, data)).toEqual([]);
  });

  it('builds a 2v2 state — four seated players own their corners', () => {
    const state = buildStateFromMap(twoVTwo(), data, {
      slots: {
        slot_a1: { playerId: 'a1' },
        slot_a2: { playerId: 'a2' },
        slot_b1: { playerId: 'b1' },
        slot_b2: { playerId: 'b2' },
      },
    });
    expect(Object.keys(state.players).sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
    expect(state.planets.home_a1!.owner).toBe('a1');
    expect(state.planets.home_b2!.owner).toBe('b2');
    expect(state.fleets.fleet_a2!.owner).toBe('a2');
    expect(state.planets.west!.owner).toBeNull(); // side prizes start neutral
  });
});

describe('every shipped map validates (M1.3)', () => {
  // A map is content, and content nobody loads rots silently: `pve-1.json` shipped
  // four criss-crossing lanes for as long as no test ever built it, so the only PvE
  // door in the prototype died on `E_INVALID_MAP` without a word. This loop is the
  // guard — a new map joins it by existing.
  const files = readdirSync(path.join(repoRoot, 'data/maps')).filter((f) => f.endsWith('.json'));

  it('there are shipped maps at all — otherwise the cases below are green on nothing', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file}: valid — known refs, neighbour-only lanes, one connected graph`, () => {
      const map = parseMatchMap(readJson(`data/maps/${file}`));
      expect([file, validateMatchMap(map, data)]).toEqual([file, []]);
    });
  }
});

describe('validateMatchMap — terrain decides how many lanes a sector carries (MAP-LINK)', () => {
  /** Four sectors around a centre, close enough that geometry offers every spoke. */
  const star = (centreTerrain: string): MatchMap =>
    parseMatchMap({
      id: 'star',
      seed: 'star',
      sectors: {
        hub: { position: { x: 0, y: 0 }, kind: 'empty', terrain: centreTerrain },
        n: { position: { x: 0, y: -200 }, kind: 'planet', terrain: 'empty_space' },
        s: { position: { x: 0, y: 200 }, kind: 'planet', terrain: 'empty_space' },
        e: { position: { x: 200, y: 0 }, kind: 'planet', terrain: 'empty_space' },
        w: { position: { x: -200, y: 0 }, kind: 'planet', terrain: 'empty_space' },
      },
      paths: [
        ['hub', 'n'],
        ['hub', 's'],
        ['hub', 'e'],
        ['hub', 'w'],
      ],
    });

  it('open space carries all four spokes', () => {
    // `empty_space` budgets 5 lanes, so the same geometry is legal here.
    expect(validateMatchMap(star('empty_space'), data)).toEqual([]);
  });

  it('a dense asteroid cluster carries one, and the map is rejected for drawing four', () => {
    // This is the whole point: the author did not "draw fewer lines", the WORLD
    // refuses to carry them. Same coordinates, same paths — only the terrain differs.
    const issues = validateMatchMap(star('asteroid_cluster'), data);
    expect(issues).toContain('E_SECTOR_OVERLINKED:hub:4>1');
  });

  it('an ion storm carries two', () => {
    expect(validateMatchMap(star('ion_storm'), data)).toContain('E_SECTOR_OVERLINKED:hub:4>2');
  });

  it('the budget is a ceiling, not a quota — fewer lanes is fine', () => {
    const map = star('ion_storm');
    // Drop the two spokes the storm cannot carry, and the sectors they served with
    // them — an ion storm legally carries two, and a two-lane map is valid.
    delete map.sectors.e;
    delete map.sectors.w;
    map.paths = [
      ['hub', 'n'],
      ['hub', 's'],
    ];
    expect(validateMatchMap(map, data)).toEqual([]);
  });

  it('geometry proposes by the Gabriel rule: a lane is legal unless something is IN it', () => {
    // The relative-neighbourhood rule this replaced capped every node at ~2-3 lanes on
    // its own, so no terrain budget could ever bind. Gabriel still forbids a lane with
    // a sector genuinely in the way, but offers the rest — leaving terrain as the real
    // limiter. `c` sits beside the a—b line, not on it, so a—b stays legal.
    const beside = parseMatchMap({
      id: 'beside',
      seed: 'beside',
      sectors: {
        a: { position: { x: -100, y: 0 }, kind: 'planet', terrain: 'empty_space' },
        b: { position: { x: 100, y: 0 }, kind: 'planet', terrain: 'empty_space' },
        c: { position: { x: 0, y: 140 }, kind: 'planet', terrain: 'empty_space' },
      },
      paths: [
        ['a', 'b'],
        ['a', 'c'],
        ['c', 'b'],
      ],
    });
    expect(validateMatchMap(beside, data)).toEqual([]);

    // Move the same sector ONTO the line and the direct lane dies — a junction on a
    // line does not add to it, it cuts it (PVR-0.4).
    const onTheLine = parseMatchMap({
      ...beside,
      sectors: { ...beside.sectors, c: { position: { x: 0, y: 0 }, kind: 'planet', terrain: 'empty_space' } },
    });
    expect(validateMatchMap(onTheLine, data)).toContain('E_PATH_NOT_NEIGHBOR:a|b');
  });
});

describe('validateMatchMap — an impassable sector is a hole in the map (MAP-BARRIER)', () => {
  /** Two provinces far enough apart that geometry would happily join them… */
  const pair = (middle?: Record<string, unknown>): MatchMap =>
    parseMatchMap({
      id: 'rift',
      seed: 'rift',
      sectors: {
        west: { position: { x: -300, y: 0 }, kind: 'planet', terrain: 'empty_space' },
        east: { position: { x: 300, y: 0 }, kind: 'planet', terrain: 'empty_space' },
        north: { position: { x: 0, y: -420 }, kind: 'planet', terrain: 'empty_space' },
        ...(middle ? { middle } : {}),
      },
      paths: [
        ['west', 'north'],
        ['north', 'east'],
      ],
    });

  it('without the rift the two provinces may be joined directly', () => {
    const map = pair();
    map.paths!.push(['west', 'east']);
    expect(validateMatchMap(map, data)).toEqual([]);
  });

  it('a rift standing between them kills the direct lane — it blocks by EXISTING', () => {
    // The barrier needs no router support: the neighbour rule already refuses a lane
    // through the space the rift occupies. That is the whole mechanism.
    const map = pair({ position: { x: 0, y: 0 }, kind: 'rift' });
    map.paths!.push(['west', 'east']);
    expect(validateMatchMap(map, data)).toContain('E_PATH_NOT_NEIGHBOR:east|west');
  });

  it('no lane may lead INTO it', () => {
    // The flag used to be decorative: the shipped black hole was impassable only
    // because its generator happened to give it no edges. Now it is a rule.
    const map = pair({ position: { x: 0, y: 0 }, kind: 'rift' });
    map.paths!.push(['north', 'middle']);
    expect(validateMatchMap(map, data)).toContain('E_IMPASSABLE_HAS_LANE:middle');
  });

  it('and nobody has to reach it: connectivity exempts what a fleet cannot enter', () => {
    // Otherwise the author would have to drill a lane into the barrier or switch the
    // check off — and both defeat the barrier.
    const map = pair({ position: { x: 0, y: 0 }, kind: 'rift' });
    expect(validateMatchMap(map, data)).toEqual([]);
  });

  it('a passable sector is still required to be reachable', () => {
    const map = pair({ position: { x: 0, y: 0 }, kind: 'planet', terrain: 'empty_space' });
    expect(validateMatchMap(map, data)).toContain('E_MAP_DISCONNECTED');
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseGameData, safeParseGameData, buildingLevel, buildingMaxLevel } from './schemas';
import { composeGameDataBundle } from './loadGameData';
import { canEquip, moduleAllowed } from '../util/loadout';
import {
  DEFAULT_COALITION_FACTOR,
  DEFAULT_DOMINATION_PERCENT,
  DEFAULT_SCORE_LIMIT,
} from '../modules/victory';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const dataDir = path.join(repoRoot, 'data');

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(path.join(dataDir, name), 'utf8'));
}

/** Composes the shipped data fragments into one bundle via the shared composer (CP0.3),
 *  injecting the Node file reader — the fragment list now lives in one place. */
function loadShippedBundle(): Record<string, unknown> {
  return composeGameDataBundle(readJson);
}

describe('game data schema (docs/architecture.md §2)', () => {
  it('validates the shipped data bundle', () => {
    const data = parseGameData(loadShippedBundle());
    expect(data.version).toBe('0.1.9');
    expect(data.resources).toContain('microelectronics');
    expect(data.units.siege_lance?.stats.range).toBe(300); // artillery firing radius (map units)
    expect(data.units.cruiser?.upkeep.credits).toBe(64); // daily upkeep, BAL-3 scale
    // fleet ⊕ ground-army separation: domains + transport capacity.
    expect(data.units.cruiser?.domain).toBe('space'); // schema default
    expect(data.units.tank?.domain).toBe('ground');
    // H4-REVERT: «один юнит занимает один трюм» — правило игрока, а не таблица весов.
    // Танк вёз 3 слота, пока трюм мерили тоннажем; теперь вместимость считается
    // ШТУКАМИ, и все наземные стоят по 1. Это data-driven шов: ядро (`armyModule`)
    // по-прежнему складывает cargoSize, просто слагаемые стали единицами.
    for (const id of ['militia', 'drop_infantry', 'tank']) {
      expect(data.units[id]?.stats.cargoSize).toBe(1);
    }
    expect(data.units.dropship?.stats.cargoCapacity).toBe(12); // dedicated lift
    expect(data.units.scout_drone?.stats.cargoCapacity).toBe(0); // default, carries nothing
    expect(data.buildings.orbital_aa?.aaDamage).toBe(14); // anti-ship orbital AA — a defensive building
    expect(data.units.cruiser?.stats.aaDamage).toBe(0); // default, no AA
    expect(data.buildings.mine_t1?.aaDamage).toBe(0); // buildings default to no AA
    // squadrons-roadmap SQ-0.1: a carrier-borne fighter squadron + the new squadron stats.
    expect(data.units.fighter_squadron?.traits).toContain('squadron');
    expect(data.units.fighter_squadron?.stats.strikeRange).toBe(180); // Euclidean reach
    expect(data.units.fighter_squadron?.stats.fuel).toBe(3); // sorties before rearm
    expect(data.units.fighter_squadron?.stats.rearmRounds).toBe(2);
    expect(data.units.strike_carrier?.stats.cargoCapacity).toBe(6); // hangar = shared cargo hold
    expect(data.units.cruiser?.stats.strikeRange).toBe(0); // schema default (not a squadron)
    // reanimate_on_kill/Necromancer cut (designer-role) → assert a surviving event instead.
    expect(data.events.infect_planet?.trigger).toBe('planet_captured');
    expect(data.sectors.asteroid_field?.speedBonus).toBeCloseTo(-0.25);
    expect(data.sectors.asteroid_field?.hpBonus).toBeCloseTo(0.1);
    // planet types: production multiplier + ground-defense edge (data-driven).
    expect(data.planetTypes.volcanic?.productionBonus).toBeCloseTo(0.25);
    expect(data.planetTypes.terran?.defenseBonus).toBeCloseTo(0.1);
    expect(data.planetTypes.barren?.defenseBonus).toBe(0); // schema default
    expect(data.technologies.orbital_logistics?.unlocks.units).toContain('dropship');
    expect(data.technologies.siege_doctrine?.prerequisites).toEqual(['orbital_logistics']);
    expect(data.technologies.industrial_automation?.effects.productionBonus).toBeCloseTo(0.1);
    // ship modules: typed hull slots + a data-driven module catalog.
    expect(data.units.cruiser?.slots).toEqual({ weapon: 1, defense: 1, utility: 1 });
    expect(data.units.scout_drone?.slots).toEqual({ weapon: 0, defense: 0, utility: 0 }); // default
    expect(data.modules.cargo_bay?.effects.stats.cargoCapacity).toBe(6);
    expect(data.modules.cargo_bay?.tag).toBe('horizontal');
    expect(data.modules.shield_booster?.slot).toBe('defense');
    expect(data.modules.targeting_array?.tag).toBe('vertical');
  });

  // Дальнее зрение — роль ОДНОГО корабля, а не опция для любого крейсера. Правило
  // объявлено данными (`allowed.units`) и исполняется общим гейтом `canEquip`; тест
  // держит и данные, и гейт — чтобы «только сенсорный фрегат» не осталось на словах.
  it('радар-модуль ставится ТОЛЬКО на сенсорный фрегат, у которого ровно один слот', () => {
    const data = parseGameData(loadShippedBundle());
    const radar = data.modules.radar_module!;
    expect(radar.allowed?.units).toEqual(['sensor_frigate']);
    const frigate = data.units.sensor_frigate!;
    expect(frigate.slots).toEqual({ weapon: 0, defense: 0, utility: 1 });
    expect(moduleAllowed('sensor_frigate', frigate, radar)).toBe(true);
    expect(canEquip('sensor_frigate', frigate, [], 'radar_module', data)).toEqual({ ok: true });
    // …и ни на кого больше. Причина ВСЕГДА `E_NOT_ALLOWED`, даже у корпуса без
    // utility-слота: гейт спрашивает «этому кораблю вообще можно?» раньше, чем «есть
    // ли место», и это правильный порядок — иначе крейсер со свободным отсеком и
    // эскадрилья без него объяснялись бы игроку по-разному.
    for (const id of Object.keys(data.units)) {
      if (id === 'sensor_frigate') continue;
      const def = data.units[id]!;
      expect(moduleAllowed(id, def, radar), id).toBe(false);
      expect(canEquip(id, def, [], 'radar_module', data), id).toEqual({
        ok: false,
        code: 'E_NOT_ALLOWED',
      });
    }
    // Второй модуль в единственный отсек уже не влезет — слот занят радаром.
    expect(canEquip('sensor_frigate', frigate, ['radar_module'], 'cargo_bay', data)).toEqual({
      ok: false,
      code: 'E_NO_SLOT',
    });
  });

  it('rejects a module that expands its own slot capacity (anti self-buff)', () => {
    const res = safeParseGameData({
      ...loadShippedBundle(),
      modules: {
        bad: { name: 'x', slot: 'utility', tag: 'horizontal', effects: { stats: { moduleSlots: 1 } } },
      },
    });
    expect(res.success).toBe(false);
  });

  it('rejects a soulbound vertical (combat) module (anti pay-to-win)', () => {
    const res = safeParseGameData({
      ...loadShippedBundle(),
      modules: {
        bad: { name: 'x', slot: 'weapon', tag: 'vertical', soulbound: true, effects: { stats: { attack: 5 } } },
      },
    });
    expect(res.success).toBe(false);
  });

  it('ships producers for every economy resource (ECON-3: energy + microelectronics)', () => {
    const data = parseGameData(loadShippedBundle());
    // Fusion reactor feeds energy, scaling across its 3 levels.
    const power = data.buildings.power_plant;
    expect(power).toBeDefined();
    expect(buildingMaxLevel(power!)).toBe(3);
    expect(buildingLevel(power!, 1).produces.energy).toBe(25);
    expect(buildingLevel(power!, 3).produces.energy).toBe(110);
    // The fab turns energy+metal into microelectronics (premium, gated by tech).
    const fab = data.buildings.fabricator;
    expect(fab).toBeDefined();
    expect(buildingLevel(fab!, 1).produces.microelectronics).toBe(8);
    expect(buildingLevel(fab!, 1).cost.energy).toBe(60); // consumes energy to build
    expect(data.technologies.microelectronics_fabrication?.unlocks.buildings).toContain('fabricator');
    // Every economy resource now has at least one building that produces it.
    const produced = new Set<string>();
    for (const def of Object.values(data.buildings)) {
      for (let lvl = 1; lvl <= buildingMaxLevel(def); lvl++) {
        for (const res of Object.keys(buildingLevel(def, lvl).produces)) produced.add(res);
      }
    }
    for (const res of data.resources) {
      if (res === 'credits') continue; // credits are a sink/trade currency, not building-produced
      expect(produced.has(res)).toBe(true);
    }
  });

  it('every resource referenced by content exists in the resource list (referential integrity)', () => {
    const data = parseGameData(loadShippedBundle());
    const known = new Set(data.resources);
    const check = (bag: Record<string, number>, where: string) => {
      for (const res of Object.keys(bag)) {
        expect(known.has(res), `${where} references unknown resource "${res}"`).toBe(true);
      }
    };
    for (const [id, def] of Object.entries(data.buildings)) {
      for (let lvl = 1; lvl <= buildingMaxLevel(def); lvl++) {
        const level = buildingLevel(def, lvl);
        check(level.cost, `building ${id} L${lvl} cost`);
        check(level.produces, `building ${id} L${lvl} produces`);
      }
    }
    for (const [id, def] of Object.entries(data.units)) {
      check(def.cost, `unit ${id} cost`);
      check(def.upkeep, `unit ${id} upkeep`);
    }
    for (const [id, def] of Object.entries(data.modules)) {
      check(def.cost, `module ${id} cost`);
    }
    for (const [id, def] of Object.entries(data.technologies)) {
      check(def.cost, `technology ${id} cost`);
    }
    for (const [id, def] of Object.entries(data.heroAbilities)) {
      check(def.cost, `hero ability ${id} cost`);
    }
    for (const [id, def] of Object.entries(data.heroSkillTrees)) {
      check(def.cost, `skill node ${id} cost`);
    }
    for (const [id, def] of Object.entries(data.heroFittings)) {
      check(def.cost, `hero fitting ${id} cost`);
    }
  });

  it('builds the fortress up to level 3 (HP and defense both grow)', () => {
    const data = parseGameData(loadShippedBundle());
    const fort = data.buildings.fort;
    expect(fort).toBeDefined();
    // "от 35 до 65 на 3 уровне" — both HP and the ground-defense bonus scale.
    expect(buildingLevel(fort!, 1).hp).toBe(35);
    expect(buildingLevel(fort!, 3).hp).toBe(65);
    expect(buildingLevel(fort!, 1).defenseBonus).toBeCloseTo(0.35);
    expect(buildingLevel(fort!, 3).defenseBonus).toBeCloseTo(0.65);
    // Every ordinary building still grants the baseline +1%.
    expect(buildingLevel(data.buildings.barracks!, 1).defenseBonus).toBeCloseTo(0.01);
  });

  it('the radar array widens its detection radius (distance) across its 3 levels', () => {
    const data = parseGameData(loadShippedBundle());
    const radar = data.buildings.radar;
    expect(radar).toBeDefined();
    expect(buildingMaxLevel(radar!)).toBe(3);
    // radarRange is a Euclidean distance (map units), not jumps.
    expect(buildingLevel(radar!, 1).radarRange).toBe(180);
    expect(buildingLevel(radar!, 2).radarRange).toBe(300);
    expect(buildingLevel(radar!, 3).radarRange).toBe(420);
  });

  it('applies defaults for omitted optional fields', () => {
    const data = parseGameData(loadShippedBundle());
    // scout_drone declares no traits in JSON → schema default [].
    expect(data.units.scout_drone?.traits).toEqual([]);
    // a custom `chance` is preserved, not defaulted to 1.
    expect(data.events.void_anomaly?.chance).toBeCloseTo(0.5);
  });

  it('allows extra numeric unit stats (data-driven, open stat set)', () => {
    const bundle = loadShippedBundle();
    const res = safeParseGameData({
      ...bundle,
      units: {
        ...(bundle.units as Record<string, unknown>),
        psi_ship: {
          faction: 'vanguard',
          stats: { attack: 4, defense: 4, speed: 7, psi: 9 },
        },
      },
    });
    expect(res.success).toBe(true);
  });

  it('rejects an empty resource list (fail-closed validation)', () => {
    const res = safeParseGameData({ ...loadShippedBundle(), resources: [] });
    expect(res.success).toBe(false);
  });

  it('rejects a non-numeric unit stat', () => {
    const res = safeParseGameData({
      ...loadShippedBundle(),
      units: { broken: { faction: 'x', stats: { attack: 'lots', defense: 1, speed: 1 } } },
    });
    expect(res.success).toBe(false);
  });

  it('rejects a chance outside [0, 1]', () => {
    const res = safeParseGameData({
      ...loadShippedBundle(),
      events: { bad: { trigger: 't', effect: 'e', chance: 2 } },
    });
    expect(res.success).toBe(false);
  });
});

describe('hero archetypes + abilities (HERO-1, docs/heroes.md)', () => {
  it('validates the shipped hero content and its shape', () => {
    const data = parseGameData(loadShippedBundle());
    // Archetypes carry a branch, a ship, module slots and start abilities.
    const commander = data.heroes.commander;
    expect(commander).toBeDefined();
    expect(commander!.branch).toBe('transhuman');
    expect(commander!.ship.unit).toBe('hero');
    expect(commander!.slots).toBe(4);
    // «Коридор» больше НЕ стартовая способность (заказ владельца): его открывает узел
    // дерева `overclocked_helm`, иначе узел выдавал бы то, что у героя и так есть.
    expect(commander!.startAbilities).not.toContain('corridor');
    expect(data.heroSkillTrees.overclocked_helm?.grants.ability).toBe('corridor');
    // A hero branch is its OWN axis (transhuman/psionic), not a tech branch.
    expect(data.heroes.ravager?.branch).toBe('psionic');
    // Abilities are data-driven effects: a dispatch type + cooldown/range/params.
    const annihilate = data.heroAbilities.annihilate;
    expect(annihilate!.type).toBe('annihilate');
    expect(annihilate!.cooldownHours).toBe(48);
    expect(annihilate!.range).toBe(500);
    expect(data.heroAbilities.rally?.params.combatBonus).toBe(0.1);
  });

  it('every hero references known abilities, passives and a known ship unit (referential integrity)', () => {
    const data = parseGameData(loadShippedBundle());
    const abilities = new Set(Object.keys(data.heroAbilities));
    const passives = new Set(Object.keys(data.heroPassives));
    const units = new Set(Object.keys(data.units));
    for (const [id, def] of Object.entries(data.heroes)) {
      for (const ab of def.startAbilities) {
        expect(abilities.has(ab), `hero ${id} references unknown ability "${ab}"`).toBe(true);
      }
      for (const pa of def.startPassives) {
        expect(passives.has(pa), `hero ${id} references unknown passive "${pa}"`).toBe(true);
      }
      if (def.ship.unit !== undefined) {
        expect(units.has(def.ship.unit), `hero ${id} references unknown unit "${def.ship.unit}"`).toBe(true);
      }
    }
  });

  it('ships hero passives wired to hooks (HERO-5) and rejects an unknown hook/scope', () => {
    const data = parseGameData(loadShippedBundle());
    // The two shipped passives: the hero-fleet impulse and the nearby-fleets war beacon.
    expect(data.heroPassives.vanguard_impulse?.hook).toBe('fleet.speed');
    expect(data.heroPassives.vanguard_impulse?.scope).toBe('heroFleet');
    expect(data.heroPassives.rally_beacon?.params.radius).toBe(300);
    expect(data.heroes.vanguard?.startPassives).toContain('vanguard_impulse');
    // Params default when omitted (bonus 0 / radius 0), and enums are fail-closed.
    const min = parseGameData({
      ...loadShippedBundle(),
      heroPassives: { bare: { name: 'X', hook: 'fleet.speed', scope: 'heroFleet' } },
    });
    expect(min.heroPassives.bare?.params).toEqual({ bonus: 0, radius: 0 });
    expect(
      safeParseGameData({
        ...loadShippedBundle(),
        heroPassives: { bad: { name: 'X', hook: 'economy.production', scope: 'heroFleet' } },
      }).success,
    ).toBe(false);
    expect(
      safeParseGameData({
        ...loadShippedBundle(),
        heroPassives: { bad: { name: 'X', hook: 'fleet.speed', scope: 'everywhere' } },
      }).success,
    ).toBe(false);
  });

  it('applies defaults for omitted optional hero fields (graceful, back-compat)', () => {
    const data = parseGameData({
      ...loadShippedBundle(),
      heroes: { minimal: { name: 'Аноним' } },
      heroAbilities: { blink: { name: 'Мигание', type: 'recall' } },
    });
    const h = data.heroes.minimal!;
    expect(h.ship).toEqual({}); // no unit / no inline stats
    expect(h.slots).toBe(0);
    expect(h.startAbilities).toEqual([]);
    expect(h.startPassives).toEqual([]);
    expect(h.branch).toBeUndefined(); // branchless is allowed
    const a = data.heroAbilities.blink!;
    expect(a.cooldownHours).toBe(0);
    expect(a.range).toBe(0);
    expect(a.cost).toEqual({});
    expect(a.params).toEqual({});
  });

  it('the two live abilities map to the engine built-in effect types', () => {
    // The prototype marks exactly corridor/annihilate as live (prototype/src/heroes.ts);
    // the core wires exactly temp_lane/annihilate. Guard the pairing so catalog↔engine
    // drift (a "live" ability with an unwired type ⇒ E_NO_EFFECT at cast) is caught here.
    const data = parseGameData(loadShippedBundle());
    expect(data.heroAbilities.corridor?.type).toBe('temp_lane');
    expect(data.heroAbilities.annihilate?.type).toBe('annihilate');
  });

  it('every ability STEP names a real tree node — otherwise the step is unreachable', () => {
    // `HeroAbilityDef.tiers[].skill` is the ONE link between an ability's ladder and the
    // tree that sells it, and nothing else validates it: a typo there parses fine and
    // simply never fires, so the node the player paid for does nothing. Both ladders
    // (corridor, scan) ride this link.
    const data = parseGameData(loadShippedBundle());
    const nodes = new Set(Object.keys(data.heroSkillTrees));
    const laddered: string[] = [];
    for (const [id, def] of Object.entries(data.heroAbilities)) {
      for (const step of def.tiers) {
        expect(nodes.has(step.skill), `ability ${id} has a step keyed to unknown node "${step.skill}"`).toBe(true);
        laddered.push(id);
      }
    }
    expect([...new Set(laddered)].sort()).toEqual(['corridor', 'scan']);
  });

  it('the shipped skill tree is internally consistent (HERO-7 referential integrity)', () => {
    const data = parseGameData(loadShippedBundle());
    const nodes = data.heroSkillTrees;
    const abilities = new Set(Object.keys(data.heroAbilities));
    const passives = new Set(Object.keys(data.heroPassives));
    for (const [id, def] of Object.entries(nodes)) {
      for (const parent of def.requires) {
        expect(nodes[parent], `node ${id} requires unknown node "${parent}"`).toBeDefined();
      }
      if (def.grants.ability !== undefined) {
        expect(abilities.has(def.grants.ability), `node ${id} grants unknown ability`).toBe(true);
      }
      if (def.grants.passive !== undefined) {
        expect(passives.has(def.grants.passive), `node ${id} grants unknown passive`).toBe(true);
      }
    }
    // Both design branches ship a root node.
    expect(nodes.neural_lace?.branch).toBe('transhuman');
    expect(nodes.void_attunement?.branch).toBe('psionic');
    // Both ship a full LADDER of four: `corridor` up the transhuman side, `scan` up the
    // psionic one. A branch is a progression, not a pair of perks — and the owner's
    // complaint that started this ("I don't see nodes 3 and 4") is only ever answered
    // by a check, never by looking.
    const ladder = (branch: string): string[] =>
      Object.entries(nodes)
        .filter(([, n]) => n.branch === branch)
        .map(([id]) => id)
        .sort();
    expect(ladder('transhuman')).toEqual([
      'corridor_open',
      'corridor_sustained',
      'neural_lace',
      'overclocked_helm',
    ]);
    expect(ladder('psionic')).toEqual([
      'psi_evasion',
      'psi_veil',
      'psi_weak_points',
      'void_attunement',
    ]);
    // Fail-closed: an unknown branch or a negative cost never parses.
    expect(
      safeParseGameData({
        ...loadShippedBundle(),
        heroSkillTrees: { bad: { name: 'X', branch: 'cyborg' } },
      }).success,
    ).toBe(false);
    expect(
      safeParseGameData({
        ...loadShippedBundle(),
        heroSkillTrees: { bad: { name: 'X', cost: { metal: -5 } } },
      }).success,
    ).toBe(false);
  });

  it('shipped fittings are consistent and fail-closed (HERO-6)', () => {
    const data = parseGameData(loadShippedBundle());
    const abilities = new Set(Object.keys(data.heroAbilities));
    const passives = new Set(Object.keys(data.heroPassives));
    for (const [id, def] of Object.entries(data.heroFittings)) {
      if (def.grants.ability !== undefined) {
        expect(abilities.has(def.grants.ability), `fitting ${id} grants unknown ability`).toBe(true);
      }
      if (def.grants.passive !== undefined) {
        expect(passives.has(def.grants.passive), `fitting ${id} grants unknown passive`).toBe(true);
      }
    }
    expect(data.heroFittings.psi_amplifier?.grants.ability).toBe('scan');
    expect(data.heroFittings.ablative_plating?.statMods.hp).toBe(40);
    // Anti self-expansion: a fitting may not grow slot capacity; costs stay nonnegative.
    expect(
      safeParseGameData({
        ...loadShippedBundle(),
        heroFittings: { bad: { name: 'X', statMods: { slots: 1 } } },
      }).success,
    ).toBe(false);
    expect(
      safeParseGameData({
        ...loadShippedBundle(),
        heroFittings: { bad: { name: 'X', cost: { metal: -5 } } },
      }).success,
    ).toBe(false);
  });

  it('rejects a hero ability with a negative cost (no resource minting)', () => {
    expect(
      safeParseGameData({
        ...loadShippedBundle(),
        heroAbilities: { mint: { name: 'X', type: 'aura', cost: { metal: -1000 } } },
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown hero branch and an ability with no type (fail-closed)', () => {
    expect(
      safeParseGameData({
        ...loadShippedBundle(),
        heroes: { cyborg: { name: 'X', branch: 'cyborg' } },
      }).success,
    ).toBe(false);
    expect(
      safeParseGameData({
        ...loadShippedBundle(),
        heroAbilities: { void: { name: 'X' } },
      }).success,
    ).toBe(false);
  });
});

describe('game modes (PVE-0.1, docs/pve-team-modes-roadmap.md)', () => {
  /** A shipped bundle with `modes` swapped for the given catalog — the same
   *  "tweak one fragment, re-parse" shape the fail-closed tests above use. */
  const withModes = (modes: unknown): ReturnType<typeof safeParseGameData> =>
    safeParseGameData({ ...loadShippedBundle(), modes });

  it('validates the shipped mode catalog', () => {
    const data = parseGameData(loadShippedBundle());
    const standard = data.modes.standard;
    expect(standard?.name).toBe('Standard');
    expect(standard?.teamFormat).toBe('ffa');
    expect(standard?.modules).toEqual([]); // no optional mode-module — the base rules
    expect(standard?.pve).toBeUndefined(); // PvP: no NPC enemy
  });

  it('КАЖДЫЙ КОМАНДНЫЙ ФОРМАТ ИМЕЕТ СВОЙ ПРЕСЕТ, И ФОРМАТ В НЁМ — ТОТ, ЧТО В ИМЕНИ', () => {
    // PVE-1.2. Пресет с именем «Team 3v3» и `teamFormat: '2v2'` схема пропустит: оба
    // поля валидны по отдельности. Разъедутся — игрок выберет «трое на трое» и сядет
    // за стол на четверых, поэтому пару проверяем именно вместе.
    const data = parseGameData(loadShippedBundle());
    expect(data.modes.duel?.teamFormat).toBe('1v1');
    for (const n of [2, 3, 4, 5]) {
      const mode = data.modes[`team_${n}v${n}`];
      expect({ id: `team_${n}v${n}`, format: mode?.teamFormat }).toEqual({
        id: `team_${n}v${n}`,
        format: `${n}v${n}`,
      });
    }
  });

  it('КОМАНДНЫЕ ПРЕСЕТЫ НЕ ПЕРЕОПРЕДЕЛЯЮТ ПОБЕДУ — формат это модификатор, а не правила', () => {
    // Пустой `victory` значит «базовые правила»; вписать туда числа значило бы, что
    // дуэль и 5v5 незаметно играются по РАЗНЫМ условиям победы.
    const data = parseGameData(loadShippedBundle());
    for (const id of ['duel', 'team_2v2', 'team_3v3', 'team_4v4', 'team_5v5']) {
      expect({ id, victory: data.modes[id]?.victory, modules: data.modes[id]?.modules }).toEqual({
        id,
        victory: {},
        modules: [],
      });
      expect(data.modes[id]?.pve).toBeUndefined(); // командный формат сам по себе PvP
    }
  });

  it('the `standard` preset restates the victory module\'s base rules, verbatim', () => {
    // PVE-0.3 makes today's implicit defaults an explicit preset, which puts the same
    // fact in two places (data and `victory.ts`). Pinning the preset TO the constants
    // — instead of to copied literals — is what keeps the pair from drifting once
    // PVE-0.2 starts merging the preset into `config.victory`.
    const { victory } = parseGameData(loadShippedBundle()).modes.standard!;
    expect(victory).toEqual({
      dominationPercent: DEFAULT_DOMINATION_PERCENT,
      scoreLimit: DEFAULT_SCORE_LIMIT,
      coalitionFactor: DEFAULT_COALITION_FACTOR,
    });
  });

  it('applies defaults for omitted optional mode fields', () => {
    const parsed = withModes({ bare: { name: 'Bare' } });
    expect(parsed.success).toBe(true);
    const mode = parsed.success ? parsed.data.modes.bare : undefined;
    expect(mode).toEqual({ name: 'Bare', victory: {}, teamFormat: 'ffa', modules: [] });
  });

  it('accepts a PvE mode (waves + NPC faction) across every team format', () => {
    for (const teamFormat of ['1v1', '2v2', '3v3', '4v4', '5v5', 'ffa']) {
      const parsed = withModes({
        waves: {
          name: 'Waves',
          teamFormat,
          modules: ['pve'],
          pve: { waves: 10, npcFaction: 'swarm', waveIntervalHours: 6 },
        },
      });
      expect({ teamFormat, ok: parsed.success }).toEqual({ teamFormat, ok: true });
    }
  });

  it('every mode references a known faction and only known team formats (referential integrity)', () => {
    const data = parseGameData(loadShippedBundle());
    const unknown = Object.entries(data.modes)
      .filter(([, mode]) => mode.pve && !(mode.pve.npcFaction in data.factions))
      .map(([id, mode]) => `${id}: ${mode.pve?.npcFaction}`);
    expect(unknown.sort()).toEqual([]);
  });

  it('rejects an unknown team format and a malformed PvE section (fail-closed)', () => {
    expect(withModes({ m: { name: 'M', teamFormat: '6v6' } }).success).toBe(false);
    expect(withModes({ m: { name: 'M', pve: { waves: 0, npcFaction: 'swarm', waveIntervalHours: 6 } } }).success).toBe(
      false,
    );
    expect(withModes({ m: { name: 'M', pve: { waves: 5, waveIntervalHours: 6 } } }).success).toBe(false);
    expect(withModes({ m: { name: 'M', pve: { waves: 5, npcFaction: 'swarm', waveIntervalHours: 0 } } }).success).toBe(
      false,
    );
  });

  it('rejects a per-match timestamp in a mode victory preset (content pins rules, not a clock)', () => {
    // `VictoryConfig.endsAt` is an absolute match timestamp — it cannot be shipped
    // content. Without `.strict()` zod would silently DROP it, leaving a mode that
    // reads as configured and is not; the loud rejection is the fail-secure half.
    expect(withModes({ m: { name: 'M', victory: { endsAt: 42 } } }).success).toBe(false);
    expect(withModes({ m: { name: 'M', victory: { scoreLimit: 0 } } }).success).toBe(false);
  });
});

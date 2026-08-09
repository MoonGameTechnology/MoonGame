/**
 * The prototype's inline game-content catalogue — a `parseGameData({...})` literal
 * that mirrors the shipped `data/*.json` bundle with prototype-specific tweaks
 * (2 resources, session tech tree, 4 lore factions, …). Kept as one literal so the
 * prototype's world is self-contained and diffable alongside the gameplay code.
 *
 * Extracted from `game.ts` (REFP-1): the block had no internal dependencies on the
 * rest of `game.ts` (no `HOUR`/`DAY`/`ARCHETYPE_OF_GRADE`/`DEFAULT_*` references), so
 * it moves verbatim. `game.ts` re-exports `data` for back-compat.
 */
import { parseGameData, type GameData } from '../../packages/shared-core/src/index';

export const data: GameData = parseGameData({
  version: '0.1.0',
  resources: ['credits', 'metal'],
  // Session tech tree (technologyModule). Effect bonuses only in the prototype — no
  // `unlocks`, so researching never locks the content you can already build. Branch /
  // tier / prerequisite / day-gating all apply. Costs use the prototype's 2 resources.
  technologies: {
    // --- meta-progression grants (прокачка командира, prototype/src/meta.ts) ----
    // Hidden session techs granted as `completed` at newGame for unlocked meta nodes.
    // the meta_ prefix keeps them out of the research window (renderTech).
    meta_drill_speed: {
      name: 'Commander Drill: Logistics',
      description: 'tech.node.meta-drill-speed.desc',
      branch: 'command',
      tier: 1,
      cost: {},
      researchTimeHours: 0,
      effects: { fleetSpeedBonus: 0.05 },
    },
    meta_drill_combat: {
      name: 'Commander Drill: Gunnery',
      description: 'tech.node.meta-drill-combat.desc',
      branch: 'command',
      tier: 1,
      cost: {},
      researchTimeHours: 0,
      effects: { combatDamageBonus: 0.05 },
    },
    meta_drill_radar: {
      name: 'Commander Drill: Recon',
      description: 'tech.node.meta-drill-radar.desc',
      branch: 'command',
      tier: 1,
      cost: {},
      researchTimeHours: 0,
      effects: { radarRangeBonus: 0.15 },
    },
    meta_drill_veteran: {
      name: 'Commander Drill: Veterancy',
      description: 'tech.node.meta-drill-veteran.desc',
      branch: 'command',
      tier: 1,
      cost: {},
      researchTimeHours: 0,
      effects: { fleetSpeedBonus: 0.05, combatDamageBonus: 0.05 },
    },
    meta_industry: {
      name: 'Commander Drill: Industry',
      description: 'tech.node.meta-industry.desc',
      branch: 'command',
      tier: 1,
      cost: {},
      researchTimeHours: 0,
      effects: { productionBonus: 0.05 },
    },
    meta_industry_2: {
      name: 'Commander Drill: Magnate',
      description: 'tech.node.meta-industry-2.desc',
      branch: 'command',
      tier: 1,
      cost: {},
      researchTimeHours: 0,
      effects: { productionBonus: 0.05 },
    },
    industrial_automation: {
      name: 'Industrial Automation',
      description: 'tech.node.industrial-automation.desc',
      branch: 'space',
      tier: 1,
      cost: { credits: 120, metal: 80 },
      researchTimeHours: 4,
      effects: { productionBonus: 0.1 },
    },
    orbital_logistics: {
      name: 'Orbital Logistics',
      description: 'tech.node.orbital-logistics.desc',
      branch: 'space',
      tier: 1,
      cost: { credits: 160, metal: 120 },
      researchTimeHours: 6,
      effects: { fleetSpeedBonus: 0.12 },
    },
    siege_doctrine: {
      name: 'Siege Doctrine',
      description: 'tech.node.siege-doctrine.desc',
      branch: 'space',
      tier: 2,
      cost: { credits: 260, metal: 220, microelectronics: 40 },
      researchTimeHours: 10,
      dayGate: 3,
      prerequisites: ['orbital_logistics'],
      effects: { combatDamageBonus: 0.08 },
    },
    fortified_infrastructure: {
      name: 'Fortified Infrastructure',
      description: 'tech.node.fortified-infrastructure.desc',
      branch: 'ground',
      tier: 2,
      cost: { credits: 180, metal: 240 },
      researchTimeHours: 8,
      dayGate: 3,
      prerequisites: ['industrial_automation'],
    },
    microelectronics_fabrication: {
      name: 'Microelectronics Fabrication',
      description: 'tech.node.microelectronics-fabrication.desc',
      branch: 'space',
      tier: 2,
      cost: { credits: 220, metal: 180 },
      researchTimeHours: 10,
      dayGate: 2,
      prerequisites: ['industrial_automation'],
      effects: { productionBonus: 0.05 },
    },
    // --- эпохи (TT-3.1 контент): новые узлы всех пяти веток. Философия прототипа
    // сохранена — только аддитивные эффекты, доступный контент не запирается.
    // dayGate ЖЁСТКИЙ (ядро: E_TOO_EARLY); в UI подпись «День N» = dayGate+1 —
    // счёт статус-бара (день 1 — первый). Капстоуны веток гейтит учёный ветки
    // (has_scientist — качественный доступ, не % скорости).
    deep_survey: {
      name: 'Deep-Space Survey',
      description: 'tech.node.deep-survey.desc',
      branch: 'space',
      tier: 2,
      cost: { credits: 200, metal: 140 },
      researchTimeHours: 8,
      dayGate: 2,
      prerequisites: ['industrial_automation'],
      effects: { radarRangeBonus: 0.15 },
    },
    void_armadas: {
      name: 'Void Armadas',
      description: 'tech.node.void-armadas.desc',
      branch: 'space',
      tier: 3,
      cost: { credits: 420, metal: 300, microelectronics: 60 },
      researchTimeHours: 16,
      dayGate: 8,
      prerequisites: ['siege_doctrine'],
      conditions: [{ type: 'own_sectors', min: 5 }],
      effects: { combatDamageBonus: 0.06, fleetSpeedBonus: 0.06 },
    },
    combined_arms: {
      name: 'Combined Arms',
      description: 'tech.node.combined-arms.desc',
      branch: 'ground',
      tier: 1,
      cost: { credits: 140, metal: 100 },
      researchTimeHours: 5,
      effects: { combatDamageBonus: 0.05 },
    },
    garrison_networks: {
      name: 'Garrison Networks',
      description: 'tech.node.garrison-networks.desc',
      branch: 'ground',
      tier: 2,
      cost: { credits: 240, metal: 200 },
      researchTimeHours: 10,
      dayGate: 5,
      prerequisites: ['combined_arms'],
      effects: { productionBonus: 0.05 },
    },
    planetary_bastions: {
      name: 'Planetary Bastions',
      description: 'tech.node.planetary-bastions.desc',
      branch: 'ground',
      tier: 3,
      cost: { credits: 480, metal: 360, microelectronics: 40 },
      researchTimeHours: 18,
      dayGate: 12,
      prerequisites: ['fortified_infrastructure'],
      conditions: [{ type: 'has_scientist', branch: 'ground' }],
      effects: { combatDamageBonus: 0.08 },
    },
    flight_decks: {
      name: 'Flight Decks',
      description: 'tech.node.flight-decks.desc',
      branch: 'squadron',
      tier: 1,
      cost: { credits: 160, metal: 120 },
      researchTimeHours: 6,
      dayGate: 2,
      effects: { fleetSpeedBonus: 0.06 },
    },
    strike_vectors: {
      name: 'Strike Vectors',
      description: 'tech.node.strike-vectors.desc',
      branch: 'squadron',
      tier: 2,
      cost: { credits: 280, metal: 220, microelectronics: 30 },
      researchTimeHours: 12,
      dayGate: 5,
      prerequisites: ['flight_decks'],
      effects: { combatDamageBonus: 0.08 },
    },
    ace_programs: {
      name: 'Ace Programs',
      description: 'tech.node.ace-programs.desc',
      branch: 'squadron',
      tier: 3,
      cost: { credits: 500, metal: 380, microelectronics: 60 },
      researchTimeHours: 20,
      dayGate: 12,
      prerequisites: ['strike_vectors'],
      conditions: [{ type: 'has_scientist', branch: 'squadron' }],
      effects: { combatDamageBonus: 0.06, fleetSpeedBonus: 0.06 },
    },
    guidance_arrays: {
      name: 'Guidance Arrays',
      description: 'tech.node.guidance-arrays.desc',
      branch: 'missile',
      tier: 1,
      cost: { credits: 150, metal: 110 },
      researchTimeHours: 6,
      dayGate: 2,
      effects: { radarRangeBonus: 0.1 },
    },
    warhead_miniaturization: {
      name: 'Warhead Miniaturization',
      description: 'tech.node.warhead-miniaturization.desc',
      branch: 'missile',
      tier: 2,
      cost: { credits: 260, metal: 240, microelectronics: 30 },
      researchTimeHours: 12,
      dayGate: 5,
      prerequisites: ['guidance_arrays'],
      effects: { combatDamageBonus: 0.06 },
    },
    saturation_barrage: {
      name: 'Saturation Barrage',
      description: 'tech.node.saturation-barrage.desc',
      branch: 'missile',
      tier: 3,
      cost: { credits: 520, metal: 400, microelectronics: 80 },
      researchTimeHours: 20,
      dayGate: 12,
      prerequisites: ['warhead_miniaturization'],
      conditions: [{ type: 'has_scientist', branch: 'missile' }],
      effects: { combatDamageBonus: 0.1 },
    },
    signal_corps: {
      name: 'Signal Corps',
      description: 'tech.node.signal-corps.desc',
      branch: 'command',
      tier: 1,
      cost: { credits: 130, metal: 90 },
      researchTimeHours: 4,
      effects: { radarRangeBonus: 0.08 },
    },
    logistics_command: {
      name: 'Logistics Command',
      description: 'tech.node.logistics-command.desc',
      branch: 'command',
      tier: 2,
      cost: { credits: 300, metal: 220 },
      researchTimeHours: 12,
      dayGate: 5,
      prerequisites: ['signal_corps'],
      effects: { productionBonus: 0.05, fleetSpeedBonus: 0.05 },
    },
    // «Хранитель» — the automation pillar. Strong, so it's gated behind choosing the
    // command scientist (Куратор) AND a mid-session day-gate (day 15). Unlocks the
    // `steward` ability, which `stewardModule` requires before `steward.delegate` works.
    ai_stewardship: {
      name: 'Steward Protocol',
      description: 'tech.node.ai-stewardship.desc',
      branch: 'command',
      tier: 3,
      cost: { credits: 400, metal: 260 },
      researchTimeHours: 14,
      dayGate: 15,
      conditions: [{ type: 'has_scientist', branch: 'command' }],
      unlocks: { abilities: ['steward'] },
    },
  },
  // Research leaders (scientistModule). Pick TWO at setup (before the start-point) — a
  // council: `has_scientist` passes if either matches, `+slot` bonuses sum. The
  // command-branch «Куратор» gates the Steward; «Полимат» trades a branch focus for +1 slot.
  scientists: {
    overseer: {
      name: 'sci.overseer.name',
      description: 'sci.overseer.desc',
      branch: 'command',
    },
    void_admiral: {
      name: 'sci.void-admiral.name',
      description: 'sci.void-admiral.desc',
      branch: 'space',
    },
    ground_marshal: {
      name: 'sci.ground-marshal.name',
      description: 'sci.ground-marshal.desc',
      branch: 'ground',
    },
    wing_commander: {
      name: 'sci.wing-commander.name',
      description: 'sci.wing-commander.desc',
      branch: 'squadron',
    },
    missile_chief: {
      name: 'sci.missile-chief.name',
      description: 'sci.missile-chief.desc',
      branch: 'missile',
    },
    polymath: {
      name: 'sci.polymath.name',
      description: 'sci.polymath.desc',
      slotBonus: 1,
    },
  },
  units: {
    scout: {
      faction: 'blue',
      stats: { attack: 5, defense: 4, speed: 64, hp: 12, cargoCapacity: 1 },
      signature: 1, // quiet recon hull
      radarRange: 105, // projects fleet radar — read by both the core fog and the prototype view (плейтест 2026-07-18: −50%)
      cost: { metal: 20 },
      buildTimeHours: 1,
      upkeep: { credits: 1 },
      slots: { utility: 1 }, // a lone utility bay — a recon drone flexes its sensors
    },
    // Сенсорный фрегат — носитель дальнего радара и больше почти ничего. Своя антенна
    // маленькая: далеко видит именно СВЯЗКА «фрегат + радар-модуль» (60 + 180), и это
    // единственный корпус, куда модуль встаёт (`modules.radar_module.allowed.units`).
    // Драться не умеет — теряя его, теряешь глаза, а не огневую мощь.
    sensor_frigate: {
      faction: 'blue',
      stats: { attack: 4, defense: 6, speed: 56, hp: 22, cargoCapacity: 1 },
      signature: 1, // слушает, а не кричит — читается как разведкорпус
      radarRange: 60, // своя антенна скромная; дальнее зрение даёт модуль
      cost: { metal: 55, microelectronics: 2 }, // ECON-7: сенсоры — хай-тек
      buildTimeHours: 2,
      upkeep: { credits: 2 },
      slots: { utility: 1 }, // ровно один отсек — и он же единственный дом радара
    },
    cruiser: {
      faction: 'blue',
      stats: { attack: 16, defense: 14, speed: 40, hp: 60, cargoCapacity: 5, pointDefense: 8 },
      line: 'front',
      signature: 4, // big warship — broadcasts
      // ECON-7: modern warships need microelectronics — the hi-tech good gates a
      // real fleet, so you must run fabricators to keep building (Bytro model).
      cost: { metal: 60, credits: 20, microelectronics: 3 },
      buildTimeHours: 3,
      upkeep: { credits: 4 },
      slots: { weapon: 1, defense: 1, utility: 1 }, // the balanced warship: one of each bay
    },
    siege: {
      // Artillery: a backline platform that fires from range at one target —
      // a pure standoff (no return fire) within `range` map units (combat
      // runArtillery). Reaches ~one neighbouring world (~205 apart), no further.
      faction: 'blue',
      stats: { attack: 30, defense: 6, speed: 30, hp: 40, range: 240 },
      traits: ['artillery'],
      signature: 5, // huge siege platform — loudest
      cost: { metal: 90, credits: 40, microelectronics: 4 }, // ECON-7: guided munitions
      buildTimeHours: 5,
      upkeep: { credits: 6 },
      slots: { weapon: 1, utility: 1 }, // a gun bay + a utility bay — a glass cannon
    },
    dropship: {
      // Carrier hull (GDD §6.1 / backlog SHIP): the biggest hold in the fleet but almost
      // no guns — it hauls divisions (and, later, squadrons) and wants an escort.
      faction: 'blue',
      stats: { attack: 2, defense: 6, speed: 44, hp: 50, cargoCapacity: 8 },
      signature: 3, // a fat hauler — easy to spot
      cost: { metal: 70, credits: 20 },
      buildTimeHours: 4,
      upkeep: { credits: 3 },
      slots: { defense: 1, utility: 2 }, // no guns — it armours up and carries утилиту
    },
    fighter_squadron: {
      // Carrier-borne strike wing (squadrons-roadmap SQ-0.1): very fast + hard-hitting
      // but paper-thin — launch it ahead to strike, orbital AA (orbital_aa) is its counter.
      faction: 'blue',
      stats: {
        attack: 14,
        defense: 3,
        speed: 92,
        hp: 10,
        strikeRange: 180,
        fuel: 3,
        rearmRounds: 2,
      },
      traits: ['squadron'],
      signature: 2,
      cost: { metal: 90, credits: 40, microelectronics: 10 },
      buildTimeHours: 2,
      upkeep: { credits: 4 },
      slots: { weapon: 1 }, // a single gun mount — upgun the paper-thin strike wing
    },
    strike_carrier: {
      // A slow, tanky flat-top with few guns of its own — its punch is the squadrons it carries.
      faction: 'blue',
      stats: { attack: 4, defense: 10, speed: 40, hp: 70, cargoCapacity: 6 },
      traits: ['carrier'],
      signature: 6,
      cost: { metal: 320, credits: 160 },
      buildTimeHours: 6,
      upkeep: { credits: 12 },
      slots: { defense: 1, utility: 2 }, // a flat-top: armour + sensor/cargo bays
    },
    // (Orbital AA is not a unit: it's a defensive *building* — anti-ship, immobile,
    //  player-built, see `orbital_aa` under buildings.)
    // --- НАЗЕМНЫЙ РОСТЕР. Четыре рода войск, каждый со своей ролью. Строятся как
    // обычные юниты, стоят в гарнизоне мира и ездят в трюме флота (armyModule);
    // высадку разрешает combatModule — десант против гарнизона.
    // ВАЖНО (H4-REVERT): `attack`/`defense` здесь — ЖИВЫЕ числа, по ним и считается
    // наземный бой. Пока войска водили дивизии, бой шёл по матрице GROUND_ROSTER, а
    // эти поля лежали мёртвым грузом; после сноса надстройки они снова читаются.
    // `cargoSize: 1` у всех — правило «один юнит занимает один трюм».
    // Ополчение — дешёвое мясо, держит землю числом. Тяжёлая пехота — щит обороны.
    // Спецназ — элита с высоким уроном. Танк — тяжёлый кулак: дорог и в металле, и
    // в содержании.
    militia: {
      faction: 'blue',
      stats: { attack: 4, defense: 8, speed: 44, hp: 14, cargoSize: 1 },
      domain: 'ground',
      traits: ['ground'],
      signature: 1,
      cost: { metal: 15 },
      buildTimeHours: 1,
      upkeep: { credits: 1, food: 1 },
    },
    heavy_infantry: {
      faction: 'blue',
      stats: { attack: 8, defense: 20, speed: 40, hp: 34, cargoSize: 1 },
      domain: 'ground',
      traits: ['ground'],
      signature: 1,
      cost: { metal: 55, credits: 15 },
      buildTimeHours: 2,
      upkeep: { credits: 2, food: 1 },
    },
    special_forces: {
      faction: 'blue',
      stats: { attack: 18, defense: 12, speed: 52, hp: 26, cargoSize: 1 },
      domain: 'ground',
      traits: ['ground'],
      signature: 1,
      cost: { metal: 60, credits: 45, microelectronics: 5 },
      buildTimeHours: 3,
      upkeep: { credits: 4, food: 1 },
    },
    // Танк — heavy front line: high attack and hull, but pricey and bulky to lift.
    tank: {
      faction: 'blue',
      stats: { attack: 22, defense: 14, speed: 40, hp: 46, cargoSize: 1 },
      domain: 'ground',
      traits: ['ground'],
      signature: 2,
      cost: { metal: 120, credits: 30 },
      buildTimeHours: 4,
      upkeep: { credits: 4, food: 2 },
    },
    // The player's projection hero — cruiser-tier guns but TRIPLE the hull, and the
    // +5% attack/defense aura it grants its fleet (heroModule). Seeded, not built.
    hero: {
      faction: 'blue',
      stats: { attack: 16, defense: 14, speed: 40, hp: 180 },
      line: 'front',
      traits: ['hero'],
      signature: 6, // a flagship — loud on radar
      cost: { metal: 400, credits: 200 },
      buildTimeHours: 10,
      upkeep: { credits: 8 },
    },
  },
  // Ship modules (mirror of data/modules.json) — the «Оснащение корабля» loadout
  // constructor fits these into a hull's typed slots (weapon/defense/utility). The
  // core `loadout.ts` engine (effectiveStats/canEquip/loadoutCost) validates and
  // prices them; `unit.build{modules}` stamps the chosen set onto the built stack.
  modules: {
    cargo_bay: {
      name: 'Cargo Bay',
      slot: 'utility',
      tag: 'horizontal',
      effects: { stats: { cargoCapacity: 6 } },
      cost: { metal: 45 },
      allowed: { domain: 'space' },
    },
    // Единственный модуль с именным списком корпусов: дальнее зрение — роль ОДНОГО
    // корабля, а не опция, которую довешивает любой крейсер. Ограничение живёт в
    // данных (`allowed.units`), ядро исполняет его через общий гейт `canEquip`
    // (E_NOT_ALLOWED) — в коде нет ни одного `if (unit === …)`.
    radar_module: {
      name: 'Radar Module',
      slot: 'utility',
      tag: 'horizontal',
      effects: { stats: { radarRange: 180 } },
      cost: { metal: 55 },
      allowed: { domain: 'space', units: ['sensor_frigate'] },
    },
    ion_engine: {
      name: 'Ion Engine',
      slot: 'utility',
      tag: 'vertical',
      effects: { stats: { speed: 2 } },
      cost: { metal: 40 },
      allowed: { domain: 'space' },
    },
    targeting_array: {
      name: 'Targeting Array',
      slot: 'weapon',
      tag: 'vertical',
      effects: { stats: { attack: 4 } },
      cost: { metal: 60 },
      allowed: { domain: 'space' },
    },
    ablative_plating: {
      name: 'Ablative Plating',
      slot: 'defense',
      tag: 'vertical',
      effects: { stats: { hp: 12 } },
      cost: { metal: 50 },
      allowed: { domain: 'space' },
    },
    shield_booster: {
      name: 'Shield Booster',
      slot: 'defense',
      tag: 'vertical',
      effects: { stats: { shield: 15 } },
      cost: { metal: 80 },
      allowed: { domain: 'space' },
    },
  },
  // --- фракции (H3): четыре лор-дома. Пока фракция — ЧИСТО пассивные бонусы к
  // экономике или юнитам (никаких уникальных юнитов/способностей) — их применяет
  // ядровый factionModule через те же хуки, что и технологии
  // (economy.production / fleet.speed / combat.damage). Человек выбирает дом на
  // setup-экране; ИИ-места разбирают оставшиеся.
  // Ids MUST match the seat assignments (matchSetup.ts / main.ts SEAT_META) — the
  // core factionModule reads `data.factions[player.faction] ?? 0`, so a mismatched
  // id silently plays with NO passives (caught 2026-07: azure/crimson seats vs a
  // blue/red catalog). Pinned by factions.test.ts «seat factions resolve».
  factions: {
    azure: {
      name: 'Azure Compact',
      description: 'faction.azure.desc',
      passives: { productionBonus: 0.12 },
    },
    crimson: {
      name: 'Crimson Hegemony',
      description: 'faction.crimson.desc',
      passives: { combatDamageBonus: 0.1 },
    },
    amber: {
      name: 'Amber Concord',
      description: 'faction.amber.desc',
      passives: { fleetSpeedBonus: 0.15 },
    },
    violet: {
      name: 'Violet Ascendancy',
      description: 'faction.violet.desc',
      passives: { productionBonus: 0.05, combatDamageBonus: 0.05 },
    },
  },
  buildings: {
    // Every building is worth victory points by TIER — the score module multiplies
    // `scoreValue` by the instance's level, so investing in upgrades (and losing them)
    // moves the scoreboard. Modest next to a planet's 50 base; tune in this data.
    // metal mine — the economy's backbone; each level digs into denser ore and
    // lifts output by +50% (12 → 18 → 27 metal/h), at a steeper cost in kind.
    mine: {
      name: 'Metal Mine',
      cost: { metal: 80 },
      buildTimeHours: 3,
      produces: { metal: 12 },
      hp: 20,
      scoreValue: 4,
      upgrades: [
        { cost: { metal: 140 }, buildTimeHours: 4, produces: { metal: 18 }, hp: 26 },
        { cost: { metal: 230, credits: 50 }, buildTimeHours: 5, produces: { metal: 27 }, hp: 32 },
      ],
    },
    refinery: {
      name: 'Credit Refinery',
      cost: { metal: 110 },
      buildTimeHours: 4,
      produces: { credits: 8 },
      upkeep: { energy: 8 }, // refined credit production runs on grid power
      hp: 20,
      scoreValue: 3,
    },
    // --- the resource loop's missing three: food, energy, microelectronics ----------
    // Together with the mine they close all five session resources into one economy:
    // reactors feed the powered buildings (refinery/radar/AA/rig/fab), farms feed the
    // ground army (units' food upkeep), fabs turn power+food into the high-tech good.
    // Missing a resource doesn't kill a building — it BROWNOUTS its consumers to half
    // output until the bill is coverable again (economy.ts arrears).
    farm: {
      name: 'Hydroponics Farm',
      cost: { metal: 90 },
      buildTimeHours: 3,
      produces: { food: 10 },
      upkeep: { energy: 6 },
      hp: 18,
      scoreValue: 3,
      upgrades: [
        {
          cost: { metal: 160, credits: 40 },
          buildTimeHours: 4,
          produces: { food: 16 },
          upkeep: { energy: 10 },
          hp: 24,
        },
        {
          cost: { metal: 260, credits: 90 },
          buildTimeHours: 6,
          produces: { food: 24 },
          upkeep: { energy: 16 },
          hp: 30,
        },
      ],
    },
    power_plant: {
      name: 'Fusion Plant',
      cost: { metal: 110, credits: 30 },
      buildTimeHours: 4,
      produces: { energy: 14 },
      upkeep: { credits: 6 },
      hp: 20,
      scoreValue: 4,
      upgrades: [
        {
          cost: { metal: 240, credits: 100 },
          buildTimeHours: 6,
          produces: { energy: 26 },
          upkeep: { credits: 12 },
          hp: 28,
        },
        {
          cost: { metal: 400, credits: 190 },
          buildTimeHours: 8,
          produces: { energy: 42 },
          upkeep: { credits: 20 },
          hp: 36,
        },
      ],
    },
    // Bootstrap chain on purpose: the fab's UPGRADES cost the very good it produces —
    // the first one runs on imports (market) or patience, the rest compound.
    fabricator: {
      name: 'Microelectronics Fab',
      cost: { metal: 180, credits: 100 },
      buildTimeHours: 6,
      produces: { microelectronics: 5 },
      upkeep: { energy: 30, food: 8 },
      hp: 22,
      scoreValue: 6,
      upgrades: [
        {
          cost: { metal: 320, credits: 200, microelectronics: 30 },
          buildTimeHours: 8,
          produces: { microelectronics: 11 },
          upkeep: { energy: 55, food: 14 },
          hp: 32,
        },
        {
          cost: { metal: 520, credits: 340, microelectronics: 80 },
          buildTimeHours: 10,
          produces: { microelectronics: 19 },
          upkeep: { energy: 90, food: 22 },
          hp: 42,
        },
      ],
    },
    // tax office — a one-time civic upgrade (no levels): lifts the whole credit take
    // of the inhabited world it sits on (taxModule). Cannot stack (maxPerPlanet: 1 —
    // дефолт схемы). RULES-2: сама прибавка теперь ОБЪЯВЛЕНА тут, а не спрятана
    // константой TAX_OFFICE_BONUS в коде трёх модулей.
    tax_office: {
      name: 'Tax Office',
      cost: { metal: 120, credits: 60 },
      buildTimeHours: 4,
      hp: 16,
      scoreValue: 3,
      creditsBonus: 0.25,
    },
    // salvage metal rig — the ONLY thing raisable on a dead world (sectorKinds roster);
    // mines the corpse for metal, boosted +30% by the dead world's metal bonus.
    metal_station: {
      name: 'Salvage Metal Rig',
      cost: { metal: 80, credits: 30 },
      buildTimeHours: 4,
      produces: { metal: 30 },
      upkeep: { energy: 8 },
      hp: 20,
      scoreValue: 5,
      upgrades: [
        {
          cost: { metal: 220, credits: 90 },
          buildTimeHours: 6,
          produces: { metal: 60 },
          upkeep: { energy: 14 },
          hp: 30,
        },
        {
          cost: { metal: 380, credits: 170 },
          buildTimeHours: 8,
          produces: { metal: 100 },
          upkeep: { energy: 22 },
          hp: 40,
        },
      ],
    },
    barracks: {
      name: 'Barracks',
      cost: { metal: 70 },
      buildTimeHours: 3,
      hp: 25,
      enablesGroundConstruction: true,
      scoreValue: 2,
      upgrades: [
        { cost: { metal: 100, credits: 30 }, buildTimeHours: 6, hp: 35, enablesGroundConstruction: true, upkeep: { energy: 3 } },
        { cost: { metal: 150, credits: 60 }, buildTimeHours: 9, hp: 45, enablesGroundConstruction: true, upkeep: { energy: 5 } },
        { cost: { metal: 200, credits: 90 }, buildTimeHours: 12, hp: 60, enablesGroundConstruction: true, buildSpeedBonus: 0.05, upkeep: { energy: 7 } },
      ],
    },
    // Полевой госпиталь — единственный источник восстановления ГАРНИЗОНА: `healRate`
    // это доля полного HP, которую пехота мира отхиливает за игровой час
    // (constructionModule, обработчик `time.advanced`). Во время наземного штурма
    // лечение не идёт — раненых не штопают под огнём. Уже есть в бандле
    // (`data/buildings.json`), в каталоге прототипа его не было; числа те же, кроме
    // цены и срока — они приведены к прототипной шкале.
    hospital: {
      name: 'Field Hospital',
      cost: { metal: 120, credits: 40 },
      buildTimeHours: 4,
      hp: 22,
      healRate: 0.15,
      scoreValue: 4,
    },
    // Factory — builds ground vehicles (tank) and squadrons (fighter_squadron).
    // enablesGroundConstruction + enablesSquadronConstruction: the gate for
    // vehicle/squadron unit.build on this planet.
    factory: {
      name: 'Vehicle Factory',
      cost: { metal: 150, credits: 60 },
      buildTimeHours: 6,
      hp: 25,
      enablesGroundConstruction: true,
      scoreValue: 5,
      upkeep: { energy: 6 },
      upgrades: [
        { cost: { metal: 180, credits: 80 }, buildTimeHours: 8, hp: 35, enablesGroundConstruction: true, enablesSquadronConstruction: true, upkeep: { energy: 10 } },
        { cost: { metal: 250, credits: 120 }, buildTimeHours: 12, hp: 45, enablesGroundConstruction: true, enablesSquadronConstruction: true, buildSpeedBonus: 0.5, upkeep: { energy: 14 } },
      ],
    },
    // spaceport — the yard a space-domain hull needs to be laid down at all
    // (construction.ts `hasShipyard`/`enablesShipConstruction`); every homeworld
    // starts with one (see `newGame`) so turn-1 fleet-building always works.
    spaceport: {
      name: 'Spaceport',
      cost: { metal: 200, credits: 80 },
      buildTimeHours: 5,
      hp: 25,
      shipRepair: 0.05,
      enablesShipConstruction: true,
      scoreValue: 4,
    },
    // radar array — projects a detection radius (in jumps) that grows with its
    // level; enemy fleets inside it show up as coarse signatures (not identified).
    radar: {
      name: 'Radar Array',
      cost: { metal: 90, credits: 40 },
      buildTimeHours: 3,
      hp: 18,
      // Detection radius (map units) per level — the single source read by BOTH the
      // core fog (`visibility.ts`, networked view) and the prototype's own vision, so
      // they agree by construction. A radar only paints a SIGNATURE for a node in its
      // outer band that is not already identified, so the reach must clear your own
      // border to the next ring of worlds — on the current map neighbours sit ~205 out
      // (auto-identified, 1 hop) and the next ring ~349, so only L3 (420) reaches past 349.
      radarRange: 240,
      upkeep: { energy: 6 },
      scoreValue: 2,
      upgrades: [
        {
          cost: { metal: 180, credits: 80 },
          buildTimeHours: 5,
          hp: 28,
          radarRange: 330,
          upkeep: { energy: 10 },
        },
        {
          cost: { metal: 300, credits: 140 },
          buildTimeHours: 7,
          hp: 38,
          radarRange: 420,
          upkeep: { energy: 16 },
        },
      ],
    },
    // space fortress — only built in an asteroid field; turns the junction into a
    // defended, assaultable strongpoint (it comes with a fixed orbital-AA by default)
    starfort: {
      name: 'Void Fortress',
      cost: { metal: 180, credits: 60 },
      buildTimeHours: 6,
      hp: 70,
      defenseBonus: 0.4,
      scoreValue: 6,
    },
    // Orbital-AA emplacement — a fixed anti-ship battery. It fires on hostile fleets on
    // the near orbit (core `aaStrengthAt` now sums building AA too). Immobile and costly;
    // the player builds it like a fort. It does NOT block ground capture — only ground
    // troops do that — it just bleeds a fleet trying to sit over (or bombard) the world.
    orbital_aa: {
      name: 'Orbital AA',
      cost: { metal: 140, credits: 50 },
      buildTimeHours: 5,
      hp: 30,
      aaDamage: 12,
      upkeep: { energy: 6 },
      scoreValue: 3,
    },
    fort: {
      name: 'Fort',
      cost: { metal: 100 },
      buildTimeHours: 4,
      hp: 40,
      defenseBonus: 0.3,
      scoreValue: 5,
      upgrades: [
        { cost: { metal: 200, credits: 80 }, buildTimeHours: 6, hp: 60, defenseBonus: 0.45 },
        { cost: { metal: 340, credits: 160 }, buildTimeHours: 8, hp: 85, defenseBonus: 0.6 },
      ],
    },
  },
  events: {},
  sectors: {
    empty_space: { name: 'Open space', speedBonus: 0.15, hpBonus: 0 },
    asteroid_field: { name: 'Asteroid field', speedBonus: -0.25, hpBonus: 0.1 },
    nebula: { name: 'Nebula', speedBonus: -0.1, hpBonus: 0.05 },
    ion_storm: { name: 'Ion Storm', speedBonus: -0.35, hpBonus: -0.15 },
    dense_nebula: { name: 'Dense Nebula', speedBonus: -0.2, hpBonus: 0.2 },
    solar_flare_zone: { name: 'Solar Flare Zone', speedBonus: 0.05, hpBonus: -0.25 },
    derelict_graveyard: { name: 'Derelict Graveyard', speedBonus: -0.15, hpBonus: 0.05 },
    deep_void: { name: 'Deep Void', speedBonus: 0.3, hpBonus: -0.1 },
  },
  // Sector kinds (capturable/buildable/orbit) — mirrors SECTOR_TYPES so the kernel's
  // capture-on-arrival treats empty void as uncapturable (matches data/sectorKinds.json).
  sectorKinds: {
    // The province KIND carries the territory score: a `planet` is the prize (50), every
    // other capturable kind the flat 10 (the schema default — so asteroid/nebula/… and the
    // KEY's terrain kinds all score 10 without listing it here).
    planet: { name: 'Planet', scoreValue: 50, capturable: true, buildable: true, orbit: true },
    asteroid: { name: 'Asteroid Field', capturable: true, buildable: true, orbit: false },
    nebula: { name: 'Nebula', capturable: true, buildable: true, orbit: true },
    // Listed only to pin orbit:false — a wreck field is salvageable but not a colony (no
    // orbital layer, so not taxed as an inhabited world), matching SECTOR_TYPES. Without
    // this it fell through to the permissive default (orbit:true) and was wrongly taxed.
    graveyard: { name: 'Derelict Graveyard', capturable: true, buildable: true, orbit: false },
    empty: { name: 'Empty Space', capturable: false, buildable: false, orbit: false },
    debris_field: { name: 'Debris Field', capturable: false, buildable: false, orbit: false },
    // a destroyed planet — re-claimable + metal-rich, but worth only the flat 10; the
    // salvage rig is the one thing buildable there. (Annihilation = a future hero.)
    dead_world: {
      name: 'Dead World',
      scoreValue: 10,
      capturable: true,
      buildable: true,
      orbit: true,
      allowedBuildings: ['metal_station'],
    },
  },
  planetTypes: {
    // ECON-7: каждый мир пассивно даёт 4 базовых ресурса (в час) с перекосом по типу
    // (Bytro-модель провинций). Микроэлектроники в baseOutput НЕТ — она только из
    // фабрикатора. productionBonus остаётся общим множителем богатства мира.
    terran: {
      name: 'Terran',
      baseOutput: { food: 5, credits: 6, energy: 3, metal: 4 },
      productionBonus: 0,
      defenseBonus: 0.1,
    },
    barren: {
      name: 'Barren',
      baseOutput: { metal: 7, credits: 3, energy: 2, food: 1 },
      productionBonus: -0.25,
      defenseBonus: 0,
    },
    oceanic: {
      name: 'Oceanic',
      baseOutput: { food: 8, credits: 5, energy: 3, metal: 3 },
      productionBonus: 0.15,
      defenseBonus: 0.05,
    },
    volcanic: {
      name: 'Volcanic',
      baseOutput: { metal: 11, energy: 5, credits: 4, food: 1 },
      productionBonus: 0.25,
      defenseBonus: -0.05,
    },
    gas_giant: {
      name: 'Gas Giant',
      baseOutput: { energy: 8, credits: 6, metal: 4, food: 1 },
      productionBonus: 0.35,
      defenseBonus: -0.15,
    },
    crystalline: {
      name: 'Crystalline',
      baseOutput: { metal: 13, energy: 5, credits: 6, food: 1 },
      productionBonus: 0.45,
      defenseBonus: -0.25,
    },
    fortress_world: {
      name: 'Fortress World',
      baseOutput: { metal: 4, credits: 5, energy: 3, food: 2 },
      productionBonus: -0.15,
      defenseBonus: 0.4,
    },
    relic_world: {
      name: 'Relic World',
      baseOutput: { credits: 12, energy: 4, metal: 4, food: 3 },
      productionBonus: 0.05,
      defenseBonus: 0,
    },
    irradiated: {
      name: 'Irradiated',
      baseOutput: { energy: 6, metal: 8, credits: 4, food: 1 },
      productionBonus: 0.2,
      defenseBonus: 0.15,
    },
    ringworld: {
      name: 'Ringworld',
      baseOutput: { food: 5, credits: 8, energy: 5, metal: 6 },
      productionBonus: 0.3,
      defenseBonus: 0.1,
    },
    dead_world: {
      name: 'Dead World',
      baseOutput: { metal: 10, credits: 1, energy: 1 },
      productionBonus: 0,
      productionByResource: { metal: 0.3 },
      defenseBonus: 0,
    },
  },
  // --- герои: 5 data-каталогов ядра (HERO-1..9), зеркало data/*.json --------------
  // Архетипы 1:1 совпадают с четырьмя ростер-героями меню (main→commander,
  // legendary→ravager, rare→vanguard, common→warden), а id способностей — с легаси-пулом
  // heroes.ts, так что меню-дизайнер продолжает работать поверх новой модели. Костов
  // хватает у прототипных валют (credits/metal/energy/microelectronics).
  heroes: {
    commander: {
      name: 'hero.unit.commander.name',
      description: 'hero.unit.commander.desc',
      branch: 'transhuman',
      ship: { unit: 'hero' },
      slots: 4,
      startAbilities: ['corridor', 'rally', 'scan', 'bulwark', 'diplomatic_landing'],
      startPassives: ['rally_beacon'],
    },
    ravager: {
      name: 'hero.unit.ravager.name',
      description: 'hero.unit.ravager.desc',
      branch: 'psionic',
      ship: { unit: 'hero' },
      slots: 3,
      startAbilities: ['annihilate', 'scan', 'recall', 'boarding_translocation'],
      startPassives: [],
    },
    vanguard: {
      name: 'hero.unit.vanguard.name',
      description: 'hero.unit.vanguard.desc',
      branch: 'transhuman',
      ship: { unit: 'hero' },
      slots: 2,
      startAbilities: ['corridor', 'rally'],
      startPassives: ['vanguard_impulse'],
    },
    warden: {
      name: 'hero.unit.warden.name',
      description: 'hero.unit.warden.desc',
      branch: 'psionic',
      ship: { unit: 'hero' },
      slots: 1,
      startAbilities: ['bulwark'],
      startPassives: [],
    },
  },
  // Способности: `temp_lane`/`annihilate` — встроенные эффекты heroModule (кастуются),
  // `spawn_*` — пассивные маркеры точек развёртывания (читает `hero.spawn`), остальные
  // типы (`aura`/`reveal`/`recall`) типизированы в данных, но эффекта в движке ещё нет —
  // `hero.ability` на них честно отвечает `E_NO_EFFECT` (UI показывает «скоро»).
  heroAbilities: {
    corridor: {
      name: 'hero.ability.corridor.name',
      description: 'hero.ability.corridor.desc',
      type: 'temp_lane',
      cooldownHours: 12,
      range: 600,
      params: {},
    },
    annihilate: {
      name: 'hero.ability.annihilate.name',
      description: 'hero.ability.annihilate.desc',
      type: 'annihilate',
      cooldownHours: 48,
      range: 500,
      params: {},
    },
    rally: {
      name: 'hero.ability.rally.name',
      description: 'hero.ability.rally.desc',
      type: 'aura',
      cooldownHours: 18,
      range: 0,
      params: { combatBonus: 0.1, durationHours: 2, radius: 300 },
    },
    scan: {
      name: 'hero.ability.scan.name',
      description: 'hero.ability.scan.desc',
      type: 'reveal',
      cooldownHours: 10,
      range: 400,
      params: { radius: 250, durationHours: 3 },
    },
    recall: {
      name: 'hero.ability.recall.name',
      description: 'hero.ability.recall.desc',
      type: 'recall',
      cooldownHours: 24,
      range: 0,
      params: {},
    },
    bulwark: {
      name: 'hero.ability.bulwark.name',
      description: 'hero.ability.bulwark.desc',
      type: 'aura',
      cooldownHours: 20,
      range: 0,
      params: { defenseBonus: 0.15, durationHours: 2, radius: 300 },
    },
    boarding_translocation: {
      name: 'hero.ability.boarding-translocation.name',
      description: 'hero.ability.boarding-translocation.desc',
      type: 'spawn_fleet',
      cooldownHours: 0,
      range: 0,
      params: {},
    },
    diplomatic_landing: {
      name: 'hero.ability.diplomatic-landing.name',
      description: 'hero.ability.diplomatic-landing.desc',
      type: 'spawn_allied',
      cooldownHours: 0,
      range: 0,
      params: {},
    },
  },
  heroPassives: {
    vanguard_impulse: {
      name: 'hero.passive.vanguard-impulse.name',
      description: 'hero.passive.vanguard-impulse.desc',
      hook: 'fleet.speed',
      scope: 'heroFleet',
      params: { bonus: 0.1 },
    },
    rally_beacon: {
      name: 'hero.passive.rally-beacon.name',
      description: 'hero.passive.rally-beacon.desc',
      hook: 'combat.damage',
      scope: 'ownFleetsNear',
      params: { bonus: 0.08, radius: 300 },
    },
  },
  heroSkillTrees: {
    neural_lace: {
      name: 'hero.tree.neural-lace.name',
      description: 'hero.tree.neural-lace.desc',
      branch: 'transhuman',
      cost: { microelectronics: 20 },
      grants: { passive: 'vanguard_impulse' },
    },
    overclocked_helm: {
      name: 'hero.tree.overclocked-helm.name',
      description: 'hero.tree.overclocked-helm.desc',
      branch: 'transhuman',
      requires: ['neural_lace'],
      cost: { microelectronics: 45, credits: 100 },
      grants: { ability: 'corridor' },
    },
    void_attunement: {
      name: 'hero.tree.void-attunement.name',
      description: 'hero.tree.void-attunement.desc',
      branch: 'psionic',
      cost: { energy: 60 },
      grants: { passive: 'rally_beacon' },
    },
    psi_veil: {
      name: 'hero.tree.psi-veil.name',
      description: 'hero.tree.psi-veil.desc',
      branch: 'psionic',
      requires: ['void_attunement'],
      cost: { energy: 90, credits: 100 },
      grants: { ability: 'scan' },
    },
  },
  heroFittings: {
    psi_amplifier: {
      name: 'Psi Amplifier',
      description: 'hero.fit.psi-amplifier.desc',
      grants: { ability: 'scan' },
      cost: { microelectronics: 30 },
    },
    aegis_matrix: {
      name: 'Aegis Matrix',
      description: 'hero.fit.aegis-matrix.desc',
      grants: { passive: 'rally_beacon' },
      cost: { metal: 60 },
    },
    ablative_plating: {
      name: 'Ablative Cladding',
      description: 'hero.fit.ablative-plating.desc',
      statMods: { hp: 40 },
      cost: { metal: 30 },
    },
  },
});

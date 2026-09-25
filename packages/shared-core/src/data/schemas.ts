import { z } from 'zod';

/**
 * Validation schemas for the data-driven game content (docs/architecture.md
 * §2). The engine knows nothing about concrete units/factions/resources — it
 * only enforces these shapes and then operates over the data. New content =
 * new JSON entries, no code changes.
 *
 * All input from disk or from the wire is validated here before it ever
 * reaches the core (OWASP A05 — Injection; A08 — Integrity).
 */

/** A dynamic resource ledger, e.g. { "metal": 220, "credits": 80 }. */
export const ResourceBagSchema = z.record(z.string(), z.number());

/** A strictly-nonnegative cost bag — the anti-mint guard shared by every hero-content
 *  price (a catalog line must never be able to CREDIT the treasury through payCost). */
const NonnegativeCostSchema = z.record(z.string(), z.number().nonnegative());

/** Combat/movement stats. Extra numeric stats are allowed (data-driven). */
export const UnitStatsSchema = z
  .object({
    /** Damage dealt when attacking. */
    attack: z.number(),
    /** Damage dealt when defending (return fire of a standing fleet). */
    defense: z.number(),
    speed: z.number(),
    /** Hit points per ship — aggregate fleet HP = Σ count × hp (GDD §7.1). */
    hp: z.number().nonnegative().default(1),
    /** Ablative shield points per ship (shields-roadmap SH-0.1): damage hits the
     *  shield pool before the hull; a ship dies when its HULL reaches 0. 0 = no
     *  shield. (Out-of-combat regen is a later brick, SH-1.1.) */
    shield: z.number().nonnegative().default(0),
    /** ДОБАВКА к скорости восстановления щита (доля пула в игровой час) поверх общей
     *  базовой скорости (`SHIELD_REGEN`, `construction.ts`). 0 = восстанавливается с
     *  общей скоростью, как весь флот игры.
     *
     *  Добавкой, а не полной величиной, НАМЕРЕННО. База — одно число на всю игру, и
     *  корпус без этого поля обязан вести себя ровно как прежде. Если бы стат означал
     *  полную скорость, то «поле не заполнено» читалось бы как «щит не восстанавливается
     *  вовсе», и каждый существующий корабль молча лишился бы регенерации — ровно тот
     *  способ, которым дефолт схемы тихо переписывает баланс (прецедент: `defenseBonus`
     *  в уровнях зданий). */
    shieldRegen: z.number().nonnegative().default(0),
    /** Legacy standoff firing radius in MAP UNITS. Nothing reads it since the
     *  standoff-fire subsystem was removed; kept so shipped content that still
     *  states it keeps parsing. Shuttle reach is `strikeRange`, not this. */
    range: z.number().nonnegative().default(0),
    /** Ground-army transport capacity of a ship (0 = carries nothing; a
     *  dedicated dropship carries a lot). Bigger hulls carry more. */
    cargoCapacity: z.number().nonnegative().default(0),
    /** Transport space a ground unit occupies when carried (a tank > infantry). */
    cargoSize: z.number().nonnegative().default(1),
    /** Orbital-AA damage per hour a (ground) unit deals to a hostile fleet on the
     *  NEAR orbit while the planet is not under a ground assault. 0 = no AA. */
    aaDamage: z.number().nonnegative().default(0),
    /** Structural damage per game hour this hull rains on a bombarded planet's
     *  BUILDINGS (ROS-1.3). 0 = not a siege hull: bombardment then falls back to
     *  `attack × BOMBARD_FRACTION`, as it did for every hull before this stat.
     *
     *  A separate number from `attack` on purpose: while structural damage was a
     *  fraction of `attack`, «weak against ships, terrible for buildings» could
     *  not be expressed at all — a siege platform could only wreck a world by
     *  also being a strong warship. It does NOT feed fleet-vs-fleet combat. */
    siegeDamage: z.number().nonnegative().default(0),
    /** Урон в час, которым НАЗЕМНЫЙ юнит гарнизона зачищает органы Роя (`infected`) на
     *  захваченном мире (решение владельца 2026-09-24: «постройки имеют хп, а наземные
     *  юниты — урон по зданиям»). 0 = не зачищает. Бой флотов и штурм не трогает. */
    buildingDamage: z.number().nonnegative().default(0),
    /** Damage this hull deals to an enemy SHUTTLE STRIKE when it scrambles against
     *  it (SHU-1.3). 0 = not an interceptor: the hull stays in the hangar and lets
     *  the strike through.
     *
     *  Distinct from `pointDefense` (flak a SHIP or a building fires reactively) and
     *  from `attack` (what the shuttle deals to fleets): an interceptor is meant to
     *  be terrible against hulls and murderous against other shuttles, and one
     *  number could not say both. */
    shuttleDamage: z.number().nonnegative().default(0),
    /** Point-defense damage per hour — anti-shuttle/anti-missile flak that a
     *  SHIP (not just a planet) carries. Distinct from `aaDamage` (which is
     *  planet-side orbital AA): `pointDefense` fires on incoming shuttle/missile
     *  strikes, NOT on regular fleets. 0 = no point defense. */
    pointDefense: z.number().nonnegative().default(0),
    /** Range (Euclidean, map units) at which point-defense engages enemy
     *  shuttles/missiles. 0 = use the default PD_RANGE (120). */
    pointDefenseRange: z.number().nonnegative().default(0),
    /** Урон по роду войск (решение владельца 2026-09-25, `util/groundTargets.ts`): атака и
     *  оборона отдельно по ПЕХОТЕ и по ТЕХНИКЕ. Бьют только наземные войска — корабли по земле
     *  не стреляют. Не объявлено — юнит бьёт этот род своей `attack`/`defense`; живой
     *  наземный каталог объявляет все четыре явно (сторож в `schemas.test.ts`). */
    attackVsInfantry: z.number().nonnegative().optional(),
    attackVsVehicle: z.number().nonnegative().optional(),
    defenseVsInfantry: z.number().nonnegative().optional(),
    defenseVsVehicle: z.number().nonnegative().optional(),
    /** Shuttle reach (shuttles-roadmap SQ-3.1): the Euclidean distance in MAP
     *  UNITS a launched `shuttle` may strike from its carrier. 0 = no reach. */
    strikeRange: z.number().nonnegative().default(0),
    /** How close a strike must get to a MOVING target before the hit counts —
     *  the chase radius (SHU-4.4). A strike at a fleet no longer flies to a
     *  snapshot point: it re-aims at the target's live position every recompute
     *  and lands the blow once it is within this radius.
     *
     *  0 is a meaningful value, not a missing one: it means "must reach the point
     *  exactly", i.e. only a stationary target can ever be caught. There is no
     *  code-side default on purpose (unlike `pointDefenseRange`, whose 0 falls
     *  back to PD_RANGE) — the numbers of this mechanic live in the data, and a
     *  silent fallback would hide an underfilled hull. A squadron uses its
     *  TIGHTEST radius, the same weakest-link rule as `strikeRange` and `speed`. */
    chaseRadius: z.number().nonnegative().default(0),
    /** Shuttle sorties before it must rearm (SQ-2.1). 0 = not a shuttle / no
     *  sortie limit. Decrements per sortie; at 0 the shuttle goes to `rearmRounds`. */
    fuel: z.number().nonnegative().default(0),
    /** Combat rounds a spent shuttle sits rearming on its carrier before it can
     *  sortie again (SQ-2.1). Deterministic cooldown, like a hero ability. */
    rearmRounds: z.number().nonnegative().default(0),
    /** How many shuttles this HULL can base — a carrier is a mobile spaceport
     *  (SHU-2.1). Same meaning as a building's `shuttleBay`, and the same rule
     *  follows from it: a hull that bases zero is indistinguishable from one that
     *  cannot base at all, so there is no separate "is a carrier" flag to drift
     *  out of step with the number. A fleet's capacity is Σ count × shuttleBay. */
    shuttleBay: z.number().nonnegative().default(0),
  })
  .catchall(z.number());

/** The three module-slot categories a hull exposes. Typed slots: a module fits
 *  only its own category. Kept small so slots compete — fitting is opportunity
 *  cost, not an open stack (ship-modules-roadmap.md §0). */
export const SHIP_SLOT_TYPES = ['weapon', 'defense', 'utility'] as const;
export const ShipSlotTypeSchema = z.enum(SHIP_SLOT_TYPES);

/**
 * PVR-6.4: редкость предмета — та же лестница цветов, что у героев (hero-progression §0.2,
 * решение владельца): простой · уникальный · мифический · легендарный = зелёный · синий ·
 * фиолетовый · красный. Порядок массива и есть порядок ступеней. Пока это только ВИД:
 * на силу модуля редкость не влияет (решение владельца 2026-09-23).
 */
export const RARITIES = ['simple', 'unique', 'mythic', 'legendary'] as const;
export const RaritySchema = z.enum(RARITIES);
export type Rarity = z.infer<typeof RaritySchema>;
/** How many slots of each category a hull carries. Default 0 everywhere ⇒ the
 *  hull fits no modules (backward-compatible: existing units are unaffected). */
export const ShipSlotsSchema = z.object({
  weapon: z.number().int().nonnegative().default(0),
  defense: z.number().int().nonnegative().default(0),
  utility: z.number().int().nonnegative().default(0),
});

export const UnitDefSchema = z.object({
  faction: z.string(),
  stats: UnitStatsSchema,
  /** Where the unit operates: `space` units crew fleets and fight in orbit;
   *  `ground` units are the planetary army (garrison / transported as cargo /
   *  the landing force in a ground assault). Fleets carry ground units up to
   *  their ships' `cargoCapacity`. */
  domain: z.enum(['space', 'ground']).default('space'),
  /** Род наземных войск (ROS-1.1): пехота строится в КАЗАРМАХ, техника — на ЗАВОДЕ.
   *  Читается только при `domain: 'ground'`; у космических корпусов поля нет смысла.
   *
   *  Дефолт — пехота, а не «обязательно объяви»: наземный юнит без рода строился бы
   *  нигде (fail-secure превратил бы забытое поле в непостроимый юнит), а так забытое
   *  поле стоит казарм. Чтобы «забыли» не доехало до каталога, живой контент обязан
   *  объявлять род ЯВНО — это держит сторож в `schemas.test.ts`. */
  kind: z.enum(['infantry', 'vehicle']).default('infantry'),
  /** Damage-receiving line (GDD §7.2). No trait overrides it. */
  line: z.enum(['front', 'mid', 'rear']).default('front'),
  traits: z.array(z.string()).default([]),
  abilities: z.array(z.string()).default([]),
  cost: ResourceBagSchema.default({}),
  /** Build time in hours to produce the unit at a planet (real-time,
   *  timeScale-scaled). Mirrors BuildingDef.buildTimeHours. */
  buildTimeHours: z.number().nonnegative().default(0),
  /** Daily upkeep paid to keep the unit (per day). */
  upkeep: ResourceBagSchema.default({}),
  /** Radar "signature": how detectable the unit is. A fleet's signature is the
   *  sum of count × signature; radar reveals a coarse size bucket, never the
   *  exact composition (fog-of-war — `visibleState`). */
  signature: z.number().nonnegative().default(1),
  /**
   * КЛАСС КОРПУСА (решение владельца 15): какого размера стапель нужен кораблю.
   * `light` → верфь 1 уровня, `medium` → 2, `heavy` → 3.
   *
   * До этого поля отличить «небольшой корабль» от линкора было НЕЧЕМ: у наземных есть
   * род войск (`kind`), а у кораблей не было ничего. Поле необязательное, потому что
   * касается только строящихся КОРАБЛЕЙ: у наземных свой гейт (казармы/завод), челноки
   * гейтит ангар, а выдаваемое (`issued`) не заказывают вовсе. Явность там, где поле
   * значимо, держит сторож в `schemas.test.ts` — как и у рода наземных войск.
   */
  hullClass: z.enum(['light', 'medium', 'heavy']).optional(),
  /** Radar reach (Euclidean distance, map units) the unit projects as a radar-ship (0 = none). */
  radarRange: z.number().nonnegative().default(0),
  /** Радиус СВЯЗИ Роя (map units): флот с таким юнитом — узел сети ретрансляторов
   *  (`docs/swarm-behavior.md`). Два узла связаны, когда их круги пересекаются. Связь —
   *  не радар: в радиусе ничего не разведывается, по ней передаётся опыт боёв. 0 — не узел. */
  relayRange: z.number().nonnegative().default(0),
  /** Typed module slots this hull exposes (ship-modules-roadmap.md). A player
   *  fills them BEFORE building; the built ship is locked (no refit). Omitted →
   *  all-zero → carries no modules (a partial object defaults the rest to 0). */
  slots: ShipSlotsSchema.default({ weapon: 0, defense: 0, utility: 0 }),
});

/** One stack in a faction's starting loadout (a unit id + how many). */
export const StartingStackSchema = z.object({
  unit: z.string(),
  count: z.number().int().positive(),
  modules: z.array(z.string()).optional(),
});

/** What a player of this faction begins a match with (consumed by the match-start
 *  assembly, brick B3). All fields default to empty so a faction can describe only
 *  what differs. */
export const FactionLoadoutSchema = z.object({
  /** Starting treasury. */
  resources: ResourceBagSchema.default({}),
  /** Ships in the starting fleet. */
  fleet: z.array(StartingStackSchema).default([]),
  /** Ground units in the homeworld garrison. */
  garrison: z.array(StartingStackSchema).default([]),
  /** Buildings already standing on the homeworld (ids → `data.buildings`). */
  homeBuildings: z.array(z.string()).default([]),
});

/** Passive faction bonuses — mirrors `TechnologyEffects` so the faction module
 *  (brick B2) can apply them through the same `economy.production` / `fleet.speed` /
 *  `combat.damage` hooks. Absent module → no effect (graceful degradation). */
export const FactionPassivesSchema = z.object({
  /** Multiplier on owned planetary production, e.g. 0.15 = +15%. */
  productionBonus: z.number().default(0),
  /** Multiplier on owned fleet movement speed. */
  fleetSpeedBonus: z.number().default(0),
  /** Multiplier on outgoing combat damage. */
  combatDamageBonus: z.number().default(0),
  /** Multiplier on the reach of every radar the player fields (buildings and
   *  ships). Read by the `visibleState` projection (A2), like the tech effect. */
  radarRangeBonus: z.number().default(0),
  /** Насколько у этой фракции выше ПОТОЛОК выданного гарнизона (FORT-2.3) — в штуках,
   *  а не долей: потолок считается головами, и множитель дал бы дробных защитников. */
  fortGarrisonBonus: z.number().default(0),
});

export const FactionDefSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  traits: z.array(z.string()).default([]),
  abilities: z.array(z.string()).default([]),
  /** Unit ids this faction can field that others cannot (its signature roster). */
  uniqueUnits: z.array(z.string()).default([]),
  /** Match-start loadout (resources / fleet / garrison / homeworld buildings).
   *  `.prefault({})` pipes the empty object through the schema, so the per-field
   *  defaults there stay the single source of truth (no literal to drift). */
  startingLoadout: FactionLoadoutSchema.prefault({}),
  /** Always-on faction bonuses, applied by the faction module via hooks. */
  passives: FactionPassivesSchema.prefault({}),
  /** Растут ли у сил фракции ВЕТЕРАНЫ — счётчик пережитых боёв и нанесённого урона, а с
   *  ними медали, надбавка выслуги и шевроны. `false` — у фракции ветеранов нет вовсе
   *  (Рой: решение владельца 2026-09-25 «у Роя ветеранов нет»). */
  veterans: z.boolean().default(true),
});

/** Per-level stats of a building (level 2..N). Level 1 uses the base fields. */
export const BuildingLevelSchema = z.object({
  cost: ResourceBagSchema.default({}),
  buildTimeHours: z.number().nonnegative().default(0),
  produces: ResourceBagSchema.default({}),
  /** Daily running cost of the standing building (per day, like unit upkeep). When the
   *  owner can't pay a resource of it (treasury pinned at zero — arrears), buildings
   *  consuming THAT resource produce at half rate until the debt clears (economy.ts). */
  upkeep: ResourceBagSchema.default({}),
  /** Structural HP at this level. */
  hp: z.number().nonnegative().default(0),
  /** Ground-defense bonus this level grants the garrison (0.01 = +1%). */
  defenseBonus: z.number().default(0.01),
  /** Radar reach (Euclidean distance, map units) at this level — lets a radar array widen its
   *  detection radius as it is upgraded. */
  radarRange: z.number().nonnegative().default(0),
  /** Радиус связи Роя на этом уровне (см. `UnitDef.relayRange`): здание — узел сети. */
  relayRange: z.number().nonnegative().default(0),
  /** Fraction of a garrison stack's max-HP pool restored per game hour (0.1 = 10%/h).
   *  Stacks heal continuously while the planet is owned; destroyed buildings don't heal. */
  healRate: z.number().nonnegative().default(0),
  /** Fraction of a docked friendly fleet's HULL restored per game hour (0.1 = 10%/h) —
   *  a shipyard / spaceport (shields-roadmap SH-2.1). 0 = this building can't mend hulls. */
  shipRepair: z.number().nonnegative().default(0),
  /** Anti-ship orbital-AA firepower this level fires per game hour at a hostile fleet on the
   *  near orbit (an emplacement building). Summed alongside garrison `aaDamage` in combat. */
  aaDamage: z.number().nonnegative().default(0),
  /** Point-defense (anti-shuttle/anti-missile) firepower per game hour at this level.
   *  Distinct from `aaDamage`: intercepts shuttle/missile strikes, not regular fleets. */
  pointDefense: z.number().nonnegative().default(0),
  /** How many shuttles this level can base (SHU-1.1). A shuttle is not a fleet: it
   *  lives INSIDE the spaceport (`planet.hangar`), so the port's bay is both the gate
   *  ("can a shuttle be built here at all") and the cap ("how many"). 0 = this building
   *  bases no shuttles. */
  shuttleBay: z.number().nonnegative().default(0),
  /**
   * Сколько ПОСТРОЕК несёт это сооружение (решения владельца 10 и 11). Ноль у всех,
   * кроме ядра крепости: у неё мест ровно столько, сколько уровней прокачано.
   *
   * ЛИМИТ ВКЛЮЧАЕТСЯ САМИМ НАЛИЧИЕМ мест, а не отдельным флагом: пока на узле нет ни
   * одного сооружения с местами, лимита нет вовсе — планета застраивается как раньше
   * (решение 11: слоты только у крепости). Поэтому «0 у всех» и «нет лимита» — одно и
   * то же состояние, и второго поля заводить не пришлось.
   *
   * Само место-носитель слот НЕ занимает: корпус крепости несёт причалы, а не стоит в
   * одном из них. Правило по свойству, а не по имени здания, — новое сооружение с
   * местами получит его само.
   */
  buildSlots: z.number().nonnegative().default(0),
  /**
   * Сколько ЮНИТОВ ГАРНИЗОНА выставляет этот уровень сооружения (FORT-2.2). Ноль у всех,
   * кроме форта. Гарнизон — не войско на довольствии, а часть здания: пока здание стоит,
   * стоит и он, разрушили — ушёл вместе с ним.
   *
   * Число, а не флаг: прокачка форта должна ДОБАВЛЯТЬ защитников, и «сколько» обязано
   * жить в данных рядом с остальными свойствами уровня, а не лестницей в коде.
   */
  issuesGarrison: z.number().nonnegative().default(0),
  /** Доля, на которую здание поднимает ВЕСЬ кредитный доход своего мира на этом
   *  уровне (0.25 = +25%). См. одноимённое поле в `BuildingDefSchema`. */
  creditsBonus: z.number().default(0),
  /** Доля ускорения постройки юнитов на этом уровне (0.5 = +50% скорости, т.е.
   *  buildTime × (1 − 0.5)). Применяется к `unit.build` на планете, где стоит это
   *  здание. 0 = нет бонуса. */
  buildSpeedBonus: z.number().nonnegative().default(0),
  /** Строительные способности, ОТКРЫВАЕМЫЕ этим уровнем (верфь / ангар / наземное
   *  производство). Ровно те же флаги, что у `BuildingDefSchema`, только здесь они
   *  означают «уровень открывает», а не «здание умеет с постройки».
   *
   *  Способность НАКАПЛИВАЕТСЯ и обратно не выключается: раз открыв ангар апгрейдом,
   *  здание остаётся ангаром и на следующих уровнях, даже если те флага не повторяют.
   *  Поэтому поля опциональные — `undefined` значит «этот уровень ничего не добавляет»,
   *  а не «отнимает».
   *
   *  Почему они здесь появились: данные (и `data/buildings.json`, и каталог прототипа)
   *  давно писали способность в АПГРЕЙДАХ здания. Схема этих полей на уровне не знала,
   *  zod их молча отбрасывал, и гейт `unit.build` читал только базовый def. Итог: юнит
   *  был непостроим НИ НА КАКОМ уровне. Та же опасность у `shuttleBay` (SHU-1.1), и
   *  сторож в `construction.test.ts` держит оба случая. */
  enablesShipConstruction: z.boolean().optional(),
  enablesInfantryConstruction: z.boolean().optional(),
  enablesVehicleConstruction: z.boolean().optional(),
});

export const BuildingDefSchema = z.object({
  name: z.string(),
  cost: ResourceBagSchema.default({}),
  buildTimeHours: z.number().nonnegative().default(0),
  produces: ResourceBagSchema.default({}),
  /** Daily running cost of the standing building (see BuildingLevelSchema.upkeep). */
  upkeep: ResourceBagSchema.default({}),
  /** Structural HP — bombarded from orbit and stormed on the ground (GDD §7.4);
   *  a destroyed building stops granting its defense bonus. */
  hp: z.number().nonnegative().default(0),
  /** Shuttle capacity of the building's FIRST level (see BuildingLevelSchema). */
  shuttleBay: z.number().nonnegative().default(0),
  /**
   * Сколько ПОСТРОЕК несёт это сооружение (решения владельца 10 и 11). Ноль у всех,
   * кроме ядра крепости: у неё мест ровно столько, сколько уровней прокачано.
   *
   * ЛИМИТ ВКЛЮЧАЕТСЯ САМИМ НАЛИЧИЕМ мест, а не отдельным флагом: пока на узле нет ни
   * одного сооружения с местами, лимита нет вовсе — планета застраивается как раньше
   * (решение 11: слоты только у крепости). Поэтому «0 у всех» и «нет лимита» — одно и
   * то же состояние, и второго поля заводить не пришлось.
   *
   * Само место-носитель слот НЕ занимает: корпус крепости несёт причалы, а не стоит в
   * одном из них. Правило по свойству, а не по имени здания, — новое сооружение с
   * местами получит его само.
   */
  buildSlots: z.number().nonnegative().default(0),
  /**
   * Сколько ЮНИТОВ ГАРНИЗОНА выставляет этот уровень сооружения (FORT-2.2). Ноль у всех,
   * кроме форта. Гарнизон — не войско на довольствии, а часть здания: пока здание стоит,
   * стоит и он, разрушили — ушёл вместе с ним.
   *
   * Число, а не флаг: прокачка форта должна ДОБАВЛЯТЬ защитников, и «сколько» обязано
   * жить в данных рядом с остальными свойствами уровня, а не лестницей в коде.
   */
  issuesGarrison: z.number().nonnegative().default(0),
  /** Ground-defense bonus the building grants the garrison (0.01 = +1%); a
   *  fortress grants much more, and it grows with level. */
  defenseBonus: z.number().default(0.01),
  /** Overrides for levels 2..N (index 0 = level 2). maxLevel = 1 + length. */
  upgrades: z.array(BuildingLevelSchema).default([]),
  /**
   * Виды провинций, где это здание вообще возводится. Отсутствует — где угодно (роль
   * играет только ростер вида).
   *
   * ЗАЧЕМ ОГРАНИЧЕНИЕ СО СТОРОНЫ ЗДАНИЯ, когда уже есть `sectorKinds.allowedBuildings`.
   * Ростер вида отвечает на вопрос «что тут можно», и этого достаточно, пока правило
   * формулируется от МЕСТА. Решение владельца 3 сформулировано от ЗДАНИЯ — «добывающая
   * станция строится ТОЛЬКО в мёртвых мирах и астероидных полях», — и ростером его не
   * выразить: у планеты ростера нет вовсе (`undefined` = любое здание), так что запретить
   * ей станцию можно было бы только выписав ей поимённый список ВСЕХ прочих зданий. Такой
   * список устаревает на первом же новом здании, причём молча.
   *
   * Здесь же правило живёт в одном месте и переживает новые виды местности само: вид, о
   * котором здание не знает, станцию не получит.
   */
  onlyOn: z.array(z.string()).optional(),
  traits: z.array(z.string()).default([]),
  /** Victory-score worth of this building; the victory module multiplies it by
   *  the instance's level, so investing in upgrades raises (and losing the
   *  building lowers) the owner's score. */
  scoreValue: z.number().nonnegative().default(0),
  /** Radar reach (Euclidean distance, map units) the building projects from the world it sits on
   *  (0 = none). Drives signature detection in `visibleState`. */
  radarRange: z.number().nonnegative().default(0),
  /** Радиус связи Роя (map units): здание — узел сети ретрансляторов, как центр данных
   *  (`docs/swarm-behavior.md`). 0 — не узел. */
  relayRange: z.number().nonnegative().default(0),
  /** Fraction of garrison max-HP restored per game hour (see BuildingLevelSchema). */
  healRate: z.number().nonnegative().default(0),
  /** Fraction of a docked friendly fleet's HULL restored per game hour — a
   *  shipyard / spaceport (shields-roadmap SH-2.1). 0 = can't mend hulls. */
  shipRepair: z.number().nonnegative().default(0),
  /** Anti-ship orbital-AA firepower per game hour (an emplacement building like an
   *  orbital-AA battery). Fires on hostile near-orbit fleets, summed with garrison AA. */
  aaDamage: z.number().nonnegative().default(0),
  /** Point-defense (anti-shuttle/anti-missile) firepower per game hour. Distinct
   *  from `aaDamage` (anti-ship orbital AA): `pointDefense` intercepts incoming
   *  shuttle/missile strikes, not regular fleets. 0 = no point defense. */
  pointDefense: z.number().nonnegative().default(0),
  /** True for a building that can lay down hulls (shipyard/spaceport) — a planet needs
   *  at least one standing (undestroyed) building with this flag to build any
   *  space-domain unit (`unit.build`). Уровень МОЖЕТ открыть способность позже — см.
   *  одноимённое поле в `BuildingLevelSchema`. */
  enablesShipConstruction: z.boolean().default(false),
  /** True for a building that can build and base shuttles (a hangar bay /
   *  airbase). A planet needs at least one standing building with this flag
   *  to build any unit with the `shuttle` trait (`unit.build`). Уровень МОЖЕТ
   *  открыть способность позже — см. `BuildingLevelSchema`. */
  /** True for a building that trains INFANTRY — barracks (ROS-1.1). A planet needs
   *  at least one standing building with this flag to build a ground unit whose
   *  `kind` is `infantry`. Уровень МОЖЕТ открыть способность позже — см.
   *  одноимённое поле в `BuildingLevelSchema`. */
  enablesInfantryConstruction: z.boolean().default(false),
  /** True for a building that assembles VEHICLES — a factory (ROS-1.1). The same
   *  rule as above, for `kind: 'vehicle'`. Два флага, а не один: заказ владельца
   *  разводит рода войск по зданиям, и «наземное производство» вообще перестало
   *  быть одной способностью. */
  enablesVehicleConstruction: z.boolean().default(false),
  /** RULES-2. Сколько экземпляров этого здания может стоять на ОДНОМ мире.
   *
   *  Правило «одно здание такого типа на мир, уровень растят улучшением» жило
   *  СТРОКОЙ в редьюсере (`planet.buildings.some(...)`, причём в ТРЁХ местах: заказ,
   *  возобновление паузы и обработчик завершения) — в данных о нём не было ни слова,
   *  и прочитать «правила игры» было негде. Дефолт `1` сохраняет прежнее поведение
   *  для всего каталога; здание, которому можно стоять в нескольких экземплярах,
   *  объявляет это числом, а не правкой ядра.
   *
   *  ВНИМАНИЕ, прежде чем объявить здесь число > 1. Стройка второго экземпляра уже
   *  работает сквозняком (заказ → оплата → завершение), а вот УЛУЧШЕНИЕ — нет:
   *  у `BuildingInstance` нет идентификатора, и `building.upgrade` адресует здание
   *  ТИПОМ (`buildings.find(b => b.type === …)`). При двух экземплярах улучшение
   *  всегда садится на первый, второй поднять нечем, а оплаченный апгрейд может
   *  молча пропасть, если первый найденный экземпляр не того уровня. Меню стройки
   *  прототипа второй экземпляр к тому же вовсе не показывает. Поэтому сегодня во
   *  всём каталоге стоит дефолт 1; полноценная поддержка — отдельный кирпич
   *  (адресация экземпляра + меню + локальная очередь + бот), см. `docs/backlog.md`. */
  maxPerPlanet: z.number().int().positive().default(1),
  /** RULES-2. Доля, на которую здание поднимает ВЕСЬ кредитный доход своего мира
   *  (0.25 = +25%).
   *
   *  Раньше это правило звучало как константа `TAX_OFFICE_BONUS` плюс проверка по
   *  ИДЕНТИФИКАТОРУ здания прямо в модуле налога — и в трёх копиях (ядро, налоговый
   *  модуль прототипа, его же экономика). Причём здания `tax_office` в поставляемом
   *  `data/buildings.json` нет вовсе: ядро знало про контент, которого у него не было.
   *  Теперь эффект объявляет само здание, как уже объявляет `produces`/`radarRange`. */
  creditsBonus: z.number().default(0),
  /** Доля ускорения постройки юнитов (0.5 = +50% скорости). См. BuildingLevelSchema. */
  buildSpeedBonus: z.number().nonnegative().default(0),
});

/**
 * A trigger -> effect rule: the universal vocabulary for traits, abilities and
 * dark events (docs/architecture.md §2.2). `params` is effect-specific and is
 * validated more tightly by the effect handler that consumes it.
 */
export const EffectRuleSchema = z.object({
  trigger: z.string(),
  effect: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  chance: z.number().min(0).max(1).default(1),
});

/**
 * A sector type — terrain of a map node (GDD §1: секторная структура). Carries
 * buffs/debuffs applied through hooks, never hard-coded in the core.
 */
export const SectorTypeDefSchema = z.object({
  name: z.string().optional(),
  /** Fleet speed change for a leg entering this sector, e.g. -0.25 = −25%. */
  speedBonus: z.number().default(0),
  /** Effective fleet HP change for battles in this sector, e.g. 0.1 = +10%. */
  hpBonus: z.number().default(0),
  /** Victory-score worth of controlling a node in this sector (terrain like an
   *  asteroid field is worth holding even without a habitable planet). */
  scoreValue: z.number().nonnegative().default(0),
  /** How many lanes the terrain can physically carry (MAP-LINK). Geometry proposes
   *  the candidates — the relative-neighbourhood rule already says which sectors can
   *  see each other — and this says how many of them a region of THIS kind actually
   *  admits: open space routes freely, a dense asteroid cluster admits a single
   *  approach and is therefore a dead end. Enforced by `validateMatchMap`
   *  (`E_SECTOR_OVERLINKED`), so a map cannot draw a lane the world would not allow.
   *  The generous default keeps every pre-existing map legal. */
  maxLinks: z.number().int().positive().default(8),
  /** Which FAMILY of environments this terrain belongs to (`asteroid`, `nebula`,
   *  `storm`, `void`, `wreck`) — the handle rules take hold of when they mean "in the
   *  asteroids" rather than one exact terrain id (M2.8).
   *
   *  It exists because a ladder has steps: asteroids alone are a field, a dust lane and
   *  a dense cluster. A rule naming ids would silently miss every step added after it —
   *  and the ladder grows, that is its whole point. Absent = the terrain belongs to no
   *  family, and a family-conditioned rule does NOT take it: an unnamed member is not a
   *  member (fail-closed, A10).
   *
   *  A family is NOT a map region. Regions are an authoring/generation template with no
   *  game entity behind them (`map-terrain-regions-concept.md` §1), so the core must
   *  never key off a region's name — a rule that did would force regions into the state. */
  family: z.string().optional(),
  /** How many ROADS leave a world of this terrain (ROADS-1, `docs/roads-roadmap.md` §0.3).
   *  Open space sends a straight road to every neighbour; a dense field funnels its
   *  neighbours into a few trails that fork further out, and a fork is where a fleet can
   *  be caught. Absent = one road per neighbour. A count, not a list: which neighbours
   *  share a trail is decided by geometry (the widest angular gaps between them split the
   *  trails), so a map edit can never leave a stale assignment behind. */
  corridors: z.number().int().positive().optional(),
  /** Passive per-hour output an OWNED sector of this terrain yields, mirroring
   *  `PlanetTypeDefSchema.baseOutput` (a metal-rich asteroid cluster is worth taking
   *  even though nothing can be built on it). Added by `sectorModule` into the
   *  `economy.production` bag. Empty {} = the terrain yields nothing by itself. */
  baseOutput: ResourceBagSchema.default({}),
  /** Per-resource production multipliers for an owned sector of this terrain, e.g.
   *  `{ metal: 0.5 }` = +50% metal mined here, `{ metal: -0.4 }` = a worked-out system
   *  that yields 40% less. Layered like the planet-type twin. Floored at −1 ("yields
   *  nothing"): below that the multiplier flips sign and the sector would quietly DRAIN
   *  the treasury, which no terrain is meant to do. */
  productionByResource: z.record(z.string(), z.number().gte(-1)).default({}),
});

/**
 * A planet type — the world's own nature (terran / barren / volcanic / oceanic /
 * gas giant …), distinct from the sector it sits in. Like a sector it carries
 * buffs/debuffs applied purely through hooks, never hard-coded in the core.
 */
export const PlanetTypeDefSchema = z.object({
  name: z.string().optional(),
  /** Passive per-hour base output every OWNED world of this type yields, biased
   *  toward the type's dominant resource (ECON-7, Bytro province model): a metal
   *  world leans metal, an oceanic one food, etc. Microelectronics is deliberately
   *  EXCLUDED — it is the hi-tech good, produced only by a fabricator and consumed
   *  by advanced content, never passively mined. Empty {} = no passive output
   *  (buildings still produce). Added into the `economy.production` bag by
   *  `planetTypeModule` before the richness multipliers scale it. */
  baseOutput: ResourceBagSchema.default({}),
  /** Multiplier on the world's production, e.g. 0.25 = +25% (rich), −0.25 = poor. */
  productionBonus: z.number().default(0),
  /** Per-resource production multipliers layered ON TOP of `productionBonus`, e.g.
   *  `{ metal: 0.3 }` = +30% metal only (a depleted dead world is metal-rich). Lets a
   *  type favour one resource without touching the others; applied by `planetTypeModule`. */
  productionByResource: z.record(z.string(), z.number()).default({}),
  /** Ground-defense edge for the owner's garrison: incoming assault damage is
   *  divided by (1 + this). Positive = defensible world, negative = exposed.
   *  Stacks with building defense. */
  defenseBonus: z.number().default(0),
  /** Victory-score worth of owning a world of this type (a developed terran
   *  world is worth more than a barren rock); added on top of the base. */
  scoreValue: z.number().nonnegative().default(0),
});

export const TechnologyUnlocksSchema = z.object({
  units: z.array(z.string()).default([]),
  buildings: z.array(z.string()).default([]),
  abilities: z.array(z.string()).default([]),
});

export const TechnologyEffectsSchema = z.object({
  /** Multiplier on owned planetary production, e.g. 0.1 = +10%. */
  productionBonus: z.number().default(0),
  /** Multiplier on owned fleet movement speed, e.g. 0.15 = +15%. */
  fleetSpeedBonus: z.number().default(0),
  /** Multiplier on outgoing combat damage, e.g. 0.1 = +10%. */
  combatDamageBonus: z.number().default(0),
  /** Multiplier on the reach of every radar the player fields (buildings and
   *  ships), e.g. 0.25 = +25%. Read by the `visibleState` projection (A2). */
  radarRangeBonus: z.number().default(0),
});

/** The five tech-tree branches (UI tabs), shared by technologies, scientists and the
 *  `has_scientist` gate. `command` is the automation / command-and-control branch (AI
 *  delegation "Steward", and later order chains and standing postures). */
const BranchSchema = z.enum(['ground', 'space', 'shuttle', 'missile', 'command']);

/** Shared "at least N" threshold for a condition (default 1 = mere existence). This
 *  single `min` knob is the main data lever for tuning a gate without touching code. */
const conditionMin = z.number().int().positive().default(1);

/** One curated tech-unlock condition (a "ready-made block", not a constructor —
 *  §7.5): evaluated deterministically from state, each an "at least `min`" count.
 *  Balancing a tech = composing these in JSON (adjust `min`); a genuinely new KIND of
 *  gate = a new variant here + one evaluator case in the technology module. ALL of a
 *  tech's conditions must hold for it to unlock. */
export const TechnologyConditionSchema = z.discriminatedUnion('type', [
  /** Own at least `min` sectors (owned map nodes / planets). */
  z.object({ type: z.literal('own_sectors'), min: conditionMin }),
  /** Own at least `min` built copies of `building` across your worlds. */
  z.object({ type: z.literal('has_building'), building: z.string(), min: conditionMin }),
  /** Own at least `min` worlds of `planetType`. */
  z.object({ type: z.literal('controls_planet_type'), planetType: z.string(), min: conditionMin }),
  /** Field at least `min` of `unit` across fleets, their cargo, and garrisons. */
  z.object({ type: z.literal('has_unit'), unit: z.string(), min: conditionMin }),
  /** Have a chosen scientist (optionally of `branch`) at level ≥ `minLevel` — the
   *  seam for branch-focus and late-game capstone content. `minLevel` is a meta level;
   *  a capstone should anchor it to the account/scientist max once account-level lands
   *  (docs-only today), not a guessed magic number. */
  z.object({
    type: z.literal('has_scientist'),
    branch: BranchSchema.optional(),
    minLevel: z.number().int().positive().default(1),
  }),
]);
export type TechnologyCondition = z.infer<typeof TechnologyConditionSchema>;

export const TechnologyDefSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  tier: z.number().int().positive().default(1),
  /** Tech-tree branch (UI tab). Defaults to 'space' so existing nodes that omit
   *  it stay valid (back-compat); shuttle/missile branches may have no content yet. */
  branch: BranchSchema.default('space'),
  /** Session day from which the node becomes researchable (0 = from match start).
   *  A "day" is game-time, timeScale-scaled — mirrors how `researchTimeHours`
   *  compresses (enforced in the technology module). */
  dayGate: z.number().int().nonnegative().default(0),
  /** Extra unlock conditions beyond prerequisites/day-gate — a curated, data-driven
   *  catalog (§7.5). ALL must hold. Default: none. */
  conditions: z.array(TechnologyConditionSchema).default([]),
  cost: ResourceBagSchema.default({}),
  researchTimeHours: z.number().nonnegative().default(0),
  /** Узел, который в сессии НЕ исследуется: его только ВЫДАЮТ (мета-прокачка
   *  командира, усиление забега). Такие узлы бесплатны и мгновенны по самой сути —
   *  они награда, а не работа, — и без этого флага любой игрок исследовал бы их
   *  даром в любом матче. Модуль технологий отбивает их `E_GRANT_ONLY`, дерево
   *  технологий не показывает. */
  grantOnly: z.boolean().default(false),
  prerequisites: z.array(z.string()).default([]),
  // `.prefault({})` re-runs the nested schema, keeping its per-field defaults
  // the single source of truth instead of a duplicate literal that can drift.
  unlocks: TechnologyUnlocksSchema.prefault({}),
  effects: TechnologyEffectsSchema.prefault({}),
});

/** How a province type draws on the map — resolved by kind id on the client, never
 *  stored on `Planet` (keeps `GameState` minimal). A missing field degrades to a
 *  neutral default, never a crash. */
export const SectorKindAppearanceSchema = z.object({
  /** Map accent fill / glyph tint (hex). */
  color: z.string().default('#46606e'),
  /** On-map callout. Falls back to the kind's `name`, then the kind id. */
  label: z.string().optional(),
  /** On-map marker family. */
  shape: z.enum(['city', 'junction', 'marker', 'station']).default('city'),
});

/** A sector **kind** = a **province type** (planet / asteroid / nebula / void_station
 *  / empty …): the single registry that decides whether a province can be owned, built
 *  on, what it can be built with, and how it looks on the map. Data-driven
 *  (map-roadmap.md M2.1) — add a province type by adding an entry, no code change.
 *  Absent / unknown kind degrades to the permissive defaults below. */
export const SectorKindDefSchema = z.object({
  /** False forbids artificial routes into isolated map features. Absent = traversable. */
  traversable: z.boolean().optional(),
  name: z.string().optional(),
  /** Victory-score base for controlling a province of this kind (GDD §8.1). A
   *  habitable `planet` is the prize (50); every other province type — asteroid,
   *  nebula, a depleted dead world — is worth a flat 10. Data-driven so the whole
   *  scoring economy is balanced in content, not code. */
  scoreValue: z.number().nonnegative().default(10),
  /** Can this province be owned (captured)? Empty space cannot. */
  capturable: z.boolean().default(true),
  /** Can structures be raised here? */
  buildable: z.boolean().default(true),
  /** Does it have the orbital layer? Only a province WITH one can be shelled from
   *  above and can answer with orbital AA — in the shipped catalogue
   *  planets and station-class bases carry it. Enforced in
   *  the orbital module: the `fleet.bombard` gate (`E_WRONG_SECTOR`), the shared
   *  `isActivelyBombarding` predicate (so damage and the economy freeze cannot
   *  disagree), and the AA/bombardment span itself. NOT a gate on entering orbit:
   *  a fleet still arrives, fights and lands anywhere — an asteroid field is
   *  capturable, and assault reads `fleet.orbit`, not this flag. */
  orbit: z.boolean().default(true),
  /** Можно ли возвести здесь КОСМИЧЕСКУЮ КРЕПОСТЬ (`station.deploy`, fortress-roadmap
   *  §0.6, решение владельца 2026-09-15: «на захваченной территории, на всех видах кроме
   *  тех, где уже есть планета»).
   *
   *  Дефолт `true` намеренно: правило владельца — это РАЗРЕШЕНИЕ с коротким списком
   *  исключений, и записывать надо исключения, а не перечислять заново каждую местность.
   *  Новый вид местности получает крепость сам собой; если он ею быть не должен, автор
   *  обязан сказать это явно — ровно тот выбор, который дешевле сделать, чем поймать
   *  глазами на ревью.
   *
   *  Незахватываемые виды (`empty`, обломки, чёрная дыра) флага не требуют: крепость
   *  ставится только на СВОЁМ узле, а своим незахватываемое не станет никогда. */
  stationable: z.boolean().default(true),
  /**
   * Можно ли обстреливать этот узел с орбиты. По умолчанию да.
   *
   * ОТДЕЛЬНЫЙ ФЛАГ, А НЕ «СНЯТЬ ОРБИТУ», и это не перестраховка: обстрел требует у узла
   * орбитального слоя, но слой нужен узлу и для СОБСТВЕННОЙ зенитки. Снимешь орбиту у
   * крепости, чтобы её не обстреливали, — она перестанет и отстреливаться. Поэтому
   * запрет живёт своим полем (решение владельца 16: «бомбардировка невозможна крепости;
   * прилетевший флот вступает в бой и бьёт по корпусу»).
   */
  bombardable: z.boolean().default(true),
  /** Province-centric build roster: the building ids raisable on this province type.
   *  Absent/undefined = ANY building (the permissive default, so kind-less / roster-less
   *  worlds keep building as before). Explicit `[]` = no construction here (empty /
   *  debris). Enforced in the construction module (`E_WRONG_SECTOR`). */
  allowedBuildings: z.array(z.string()).optional(),
  /** Map appearance (color / label / shape); neutral default if absent. */
  appearance: SectorKindAppearanceSchema.default({ color: '#46606e', shape: 'city' }),
});

/** A research leader (scientist) — a per-player entity CHOSEN at match start and
 *  snapshotted immutably (NOT a unit, NOT a hero). `branch` is its focus; `slotBonus`
 *  is the "+slot" leader's extra research slots. Effects ride the `research.slots`
 *  hook and the `has_scientist` unlock gate. */
export const ScientistDefSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  /** The branch this leader focuses (gates `has_scientist { branch }` content). Omit
   *  for a branchless generalist (e.g. the +slot leader): with no branch it satisfies
   *  no branch-focus gate, which is what makes "+slot INSTEAD of a focus" a real
   *  opportunity cost. */
  branch: BranchSchema.optional(),
  /** Extra concurrent research slots this leader grants (the "+slot" leader). Flows
   *  through the `research.slots` hook, which the technology module clamps to the
   *  design max of 3 — so only 0 or 1 is meaningful under the base rule. Default 0. */
  slotBonus: z.number().int().nonnegative().default(0),
});

/** What a hull must satisfy for a module to be installable (all given fields must
 *  hold). Anchors a module to a class of ships (a cargo expander → only transports). */
export const ModuleAllowedSchema = z.object({
  domain: z.enum(['space', 'ground']).optional(),
  traits: z.array(z.string()).default([]),
  units: z.array(z.string()).default([]),
});
/** A module's effect. Two separate channels (kept apart on the balance axis):
 *  `stats` = flat additive stat deltas (×count); `enables` = action/ability flags
 *  the carrier unlocks. */
export const ModuleEffectsSchema = z.object({
  stats: z.record(z.string(), z.number()).default({}),
  enables: z.array(z.string()).default([]),
});
/** A ship module (loadout item). Chosen at BUILD time and locked onto the built
 *  stack — there is deliberately NO refit action (owner rule; supersedes the
 *  roadmap's port equip/unequip). `tag` splits the balance/monetisation axis:
 *  `horizontal` (logistics/utility) vs `vertical` (combat power). A paid/lootbox
 *  source must never carry a `vertical` module — enforced downstream and by the
 *  soulbound refine here. Extensible via data, like `UnitDef`. */
/**
 * SZE-4.2 — чем класс сигнала контрится.
 *
 * Уровень адаптации Роя имеет право усиливать ТОЛЬКО эти характеристики. Без правила
 * прокачанный Рой становится всезнающим: дай модулю-ответу обычный `attack`, и
 * «перехватывающий покров» третьего уровня начнёт бить сильнее по группе, в которой
 * ударных машин нет вовсе, — а §3.4 требует ровно обратного, чтобы контригра против
 * памяти существовала.
 *
 * Таблица живёт в КОДЕ, а не в данных, намеренно: это инвариант, как соседние refine
 * («модуль не правит вместимость слотов», «боевой модуль не бывает soulbound»), а не
 * балансное число. Данные, объявляющие себе разрешённое, запрет не удержали бы.
 */
export const SIGNAL_COUNTERS: Record<string, readonly string[]> = {
  /** Ударный вылет челноков и бомбардировщиков — его гасит зональное ПВО. */
  strike: ['pointDefense', 'pointDefenseRange'],
};

export const ModuleDefSchema = z
  .object({
    name: z.string(),
    /** Optional localized description key, shared by both clients. */
    description: z.string().optional(),
    slot: ShipSlotTypeSchema,
    tag: z.enum(['horizontal', 'vertical']),
    effects: ModuleEffectsSchema.default({ stats: {}, enables: [] }),
    cost: ResourceBagSchema.default({}),
    allowed: ModuleAllowedSchema.optional(),
    /** PVR-6.4: ступень редкости; нет поля — «простой». */
    rarity: RaritySchema.optional(),
    /**
     * SZE-5.1: НОВЫЙ параметр, который модуль получает на каждой ступени редкости выше
     * своей базовой (решение владельца 2026-09-24: «редкость даёт дополнительный
     * параметр, звёздность усиливает»). Прибавки ступеней складываются: мифический
     * модуль несёт и прибавку уникальной ступени. Ступень не выше базовой прибавки не
     * имеет — refine ниже.
     */
    rarityBonus: z
      .object({
        unique: z.record(z.string(), z.number()).optional(),
        mythic: z.record(z.string(), z.number()).optional(),
        legendary: z.record(z.string(), z.number()).optional(),
      })
      .optional(),
    /**
     * PVR-4.3: модуль — ОТВЕТ Роя на класс оружия. Лестница живёт рядом с модулем
     * (`SZE-4.1`), а не отдельной таблицей: уровень осмыслен только вместе с тем,
     * что он усиливает, и разнесённые данные разъехались бы молча.
     *
     * `signal` — класс наблюдения из `swarmMemory` (v1 — `strike`). `levels` — шаги
     * лестницы по порядку: цена в ресурсах Роя и срок выращивания в игровых часах.
     * Длина массива и есть потолок: пустого уровня «сверх лестницы» не существует.
     */
    adaptation: z
      .object({
        signal: z.string().min(1),
        levels: z
          .array(z.object({ cost: ResourceBagSchema, hours: z.number().positive() }))
          .min(1),
      })
      .optional(),
    /** Automatic onboard growth: one ground organism per fitted hull and cycle.
     * Costs come from the organism's unit definition, never from the client. */
    brood: z
      .object({
        unit: z.string(),
        intervalHours: z.number().positive(),
      })
      .optional(),
    /** Bound to the owning player (anti-RMT). A `vertical` module must never be
     *  soulbound — a paid source can't sell combat power (refined below). */
    soulbound: z.boolean().optional(),
  })
  .refine((m) => !Object.keys(m.effects.stats).some((k) => /slot/i.test(k)), {
    message: 'a module may not modify slot capacity (anti self-expansion)',
  })
  .refine(
    (m) =>
      !Object.values(m.rarityBonus ?? {}).some((bag) =>
        Object.keys(bag ?? {}).some((k) => /slot/i.test(k)),
      ),
    { message: 'SZE-5.1: a rarity bonus may not modify slot capacity (anti self-expansion)' },
  )
  .refine(
    (m) =>
      Object.keys(m.rarityBonus ?? {}).every(
        (r) =>
          RARITIES.indexOf(r as Rarity) > RARITIES.indexOf(m.rarity ?? 'simple'),
      ),
    { message: 'SZE-5.1: a rarity bonus is declared only for steps ABOVE the base rarity' },
  )
  .refine(
    (m) =>
      !m.adaptation ||
      (SIGNAL_COUNTERS[m.adaptation.signal] !== undefined &&
        Object.keys(m.effects.stats).every((k) =>
          SIGNAL_COUNTERS[m.adaptation!.signal]!.includes(k),
        )),
    {
      message:
        'SZE-4.2: an adaptation module may only carry stats that counter its own signal ' +
        '(a level must not raise general combat power)',
    },
  )
  .refine((m) => !(m.tag === 'vertical' && m.soulbound === true), {
    message: 'a vertical (combat) module may not be soulbound (anti pay-to-win)',
  });

/** A hero's skill-tree branch (docs/heroes.md): `transhuman` (implant-users) vs
 *  `psionic`. Deliberately distinct from the tech-tree `BranchSchema` — a hero belongs
 *  to a hero branch, not a research branch. Optional on an archetype (a branchless hero
 *  simply draws from no branch tree until skill trees land, HERO-7).
 *
 *  ⚠️ **PARKED IN THE SHIPPED CATALOG (HERO-11, owner's order 2026-09-22.)** The
 *  mechanism below is intact and still gates `hero.skill.unlock` — but no shipped
 *  archetype and no shipped tree node declares a `branch` any more: every one of them
 *  carries the value under `parkedBranch` instead, a key this schema deliberately does
 *  NOT know, so zod drops it and the game sees one common tree. Bringing the split back
 *  is a rename of that key in `data/heroes.json` + `data/heroSkillTrees.json` and
 *  nothing else. `data/heroBranchParked.test.ts` guards both halves: that nothing ships
 *  a live branch, and that no parked value gets lost on the way. */
export const HERO_BRANCHES = ['transhuman', 'psionic'] as const;
export const HeroBranchSchema = z.enum(HERO_BRANCHES);

/** One hero ability (a "module" in design terms) — a data-driven effect the `heroModule`
 *  dispatches on `type` (built-in handler, else capability `hero.effect.<type>`; HERO-4).
 *  `params` is effect-specific and validated more tightly by that handler, mirroring
 *  `EffectRuleSchema`. Balancing an ability = editing these numbers, not code. */
export const HeroAbilityDefSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  /** Effect dispatch key (e.g. `temp_lane` / `annihilate` / `aura` / `reveal`). */
  type: z.string(),
  /** Cooldown in game-hours before it can fire again (deterministic `readyAt`). 0 = none. */
  cooldownHours: z.number().nonnegative().default(0),
  /** Targeting reach in MAP UNITS (Euclidean). 0 = self / untargeted; for the built-in
   *  targeted types (`temp_lane`/`annihilate`) the engine falls back to its legacy
   *  constant instead — an omitted range never means "unlimited reach" (fail-secure). */
  range: z.number().nonnegative().default(0),
  /** Treasury cost to activate (absent / empty = cooldown-only). */
  cost: NonnegativeCostSchema.default({}),
  /** Effect-specific parameters, interpreted by the type's handler. */
  params: z.record(z.string(), z.unknown()).default({}),
  /** Progression steps of ONE ability (HERO-CORRIDOR-СПЕКА: «три ступени вместо
   *  одной»). A step is earned by unlocking its skill-tree node (`Hero.skills` →
   *  `data.heroSkillTrees`), and its `params` override the base `params` for that
   *  hero. Every unlocked step applies IN ARRAY ORDER, so the ladder is written
   *  top-down in data and the last unlocked step wins on a shared key. No steps ⇒
   *  the ability behaves exactly as its base `params` say (fail-secure default:
   *  an unknown/unreachable node grants nothing). */
  tiers: z
    .array(
      z.object({
        /** Node id in `data.heroSkillTrees` that unlocks this step. */
        skill: z.string(),
        /** Params replacing the base ones once the step is unlocked. */
        params: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .default([]),
});

/** The hook pipelines a hero passive may feed (HERO-5). A curated enum, not an open
 *  string — each hook needs an interpreter in the hero module (like the tech-condition
 *  catalog §7.5); a new hook = one enum entry + one evaluator case. */
/** `salvage` (EVT-3) кормит долю трофеев (`salvage.share`, модуль `salvage`) и, в
 *  отличие от двух соседей, СКЛАДЫВАЕТСЯ с базой, а не умножает её: база — сама доля
 *  (5%), и множитель ×1.1 превратил бы всю лестницу прокачки в полпроцента. */
export const HERO_PASSIVE_HOOKS = ['fleet.speed', 'combat.damage', 'salvage'] as const;
/** Where a passive applies: the hero's OWN ship's fleet, or every owner fleet within
 *  `params.radius` of the hero's node (the fleet-empowerment aura of docs/heroes.md). */
export const HERO_PASSIVE_SCOPES = ['heroFleet', 'ownFleetsNear'] as const;

/** A hero passive (docs/heroes.md §Данные) — an always-on, data-driven contribution to
 *  a hook while its hero is alive. Carried by a hero instance (`Hero.passives`, copied
 *  from the archetype's `startPassives` at seed). Balancing = editing these numbers. */
/** Ступень редкости героя — сколько СКИЛЛОВ он носит одновременно (HPR-1.2).
 *  Заведено данными, а не константой, потому что это число сегодня живёт ДВАЖДЫ
 *  (`HERO_GRADES` в прототипе и нигде в ядре) и уже успело разъехаться со слотами
 *  ФИТТИНГОВ архетипа (`HeroArchetypeDef.slots`) — обратной лестницей похожих чисел.
 *  Здесь оно одно, и его читают оба каталога.
 *
 *  ВАЖНО: `slots` архетипа и `skillSlots` редкости — РАЗНЫЕ бюджеты. Первый ограничивает
 *  `hero.fit` (компоненты корабля), второй — `hero.equip` (способности). Путать их нельзя:
 *  у `commander` 4 фиттинга и у `main` 4 скилла — совпадение чисел, а не одно правило. */
/** Одна ступень звёздности Sector Zero: шанс успеха и цена попытки (SZE-0.2).
 *
 *  Лестница ОДНА на модули и навыки: звезда модуля и звезда навыка — это уровень заточки
 *  `EC-2.1` под своим именем, и заводить вторую лестницу запрещено (§0.4
 *  `hero-progression-roadmap.md`, §0.2 `sector-zero-economy-roadmap.md`). Шанс `1` —
 *  гарантированная ступень; меньше — бросок.
 *
 *  Числа в `data/sectorZeroStars.json` — **v0**, отправная точка для калибровки
 *  телеметрией, а не утверждённый баланс. */
export const SectorZeroStarStepSchema = z.object({
  /** Вероятность успеха попытки, (0, 1]. Ровно `1` = ступень без броска. */
  chance: z.number().gt(0).lte(1).default(1),
  /** Цена попытки в Варрантах. Сгорает и при неудаче — но звёздность не падает
   *  (инвариант провала, резолюция владельца 2026-09-20). */
  warrants: z.number().int().nonnegative().default(0),
  /** Насколько эта ступень усиливает предмет — ДОЛЯ его собственного вклада, а не
   *  характеристики носителя (SZE-1.1). Для модуля: `+4 к атаке` при `bonus` 0.25
   *  становится `+5`, а базовая атака корпуса не трогается — иначе звезда модуля
   *  усиливала бы корабль, на котором модуля нет. Прибавки ступеней складываются:
   *  множитель на ★N = 1 + Σ bonus первых N ступеней. Ноль = ступень даёт только
   *  право на следующую. */
  bonus: z.number().nonnegative().default(0),
  /** Потолок попыток на ЭТОЙ ступени (`EC-2.2`): попытка с этим номером уже не бросает,
   *  а удаётся. `pity: 3` = «третья попытка гарантирована», то есть после двух сгоревших.
   *  Ноль = гарантии нет, ступень остаётся чистым броском.
   *
   *  Зачем вообще: без потолка серия неудач упирается в бесконечность, и игрок может
   *  лить валюту без предела. Это и есть то, за что штрафуют сторы, — а не сам бросок. */
  pity: z.number().int().nonnegative().default(0),
});

/** Лестница звёздности Sector Zero целиком. */
export const SectorZeroStarsSchema = z.object({
  /** Потолок звёзд. Выше него попытка не предлагается вовсе. */
  cap: z.number().int().nonnegative().default(0),
  /** Сколько первых ступеней гарантированы. Держится ОТДЕЛЬНЫМ числом, а не выводится из
   *  `chance === 1`: так «гарант кончается здесь» остаётся авторским решением, а не
   *  побочным эффектом правки вероятности. Расхождение с `steps` ловит тест. */
  guaranteed: z.number().int().nonnegative().default(0),
  /** Ступени по порядку: `steps[0]` — попытка получить первую звезду. */
  steps: z.array(SectorZeroStarStepSchema).default([]),
  /** SZE-5.1: потолок звёзд по редкости модуля (решение владельца 2026-09-24). Нет
   *  ступени в таблице — действует общий {@link cap}. Больше `cap` не бывает. */
  capByRarity: z
    .object({
      simple: z.number().int().nonnegative().optional(),
      unique: z.number().int().nonnegative().optional(),
      mythic: z.number().int().nonnegative().optional(),
      legendary: z.number().int().nonnegative().optional(),
    })
    .default({}),
});

/** Цена товара магазина Sector Zero по способам оплаты (§0.4 `sector-zero-economy-roadmap`).
 *  Товар знает, какими способами он продаётся, — это ДАННЫЕ, а не ветки в коде: нет ключа
 *  = этим способом товар не продаётся. `ad` — сколько просмотров rewarded требуется. */
export const SectorZeroPriceSchema = z.object({
  warrants: z.number().int().positive().optional(),
  sovereigns: z.number().int().positive().optional(),
  ad: z.number().int().positive().optional(),
});

/** Один лот витрины. `grants` трактуется по `kind`: id модуля, id узла навыка, имя
 *  ресурса профиля (`research` / `warrants`) — тогда значим ещё и `amount` — ступень
 *  редкости чертежа (`blueprint`, SZE-5.3: `unique` / `mythic` / `legendary`) либо id
 *  героя, чьи жетоны продаются (`hero-tokens`, тоже с `amount`). */
export const SectorZeroOfferSchema = z.object({
  kind: z.enum(['module', 'skill', 'resource', 'blueprint', 'hero-tokens']),
  grants: z.string(),
  /** Сколько выдать. Значим для `kind: 'resource'` и `'hero-tokens'`. */
  amount: z.number().int().positive().default(1),
  prices: SectorZeroPriceSchema.prefault({}),
  /** Вес в суточной ротации (`SZE-3.2`): чем больше, тем чаще лот попадает на витрину.
   *  Ноль = из ротации исключён, но товаром остаётся — пригодится для событийных лотов. */
  weight: z.number().int().nonnegative().default(1),
});

/** Витрина магазина Sector Zero целиком. Пустая = магазина в этой сборке нет — та же
 *  форма выключения данными, что у лестницы звёздности и медалей. */
export const SectorZeroShopSchema = z.object({
  /** Сколько лотов показывать в сутки. Больше каталога — покажется весь каталог. */
  slots: z.number().int().nonnegative().default(0),
  offers: z.record(z.string(), SectorZeroOfferSchema).default({}),
  /** Суверены за rewarded-ролик (SZE-3.5, резолюция владельца §0.6б): малая порция и
   *  дневной лимит. Числа — предмет плейтеста, поэтому здесь, а не в коде. Ноль в любом
   *  поле выключает кран целиком: кнопки нет, действие отказывает. */
  adSovereigns: z
    .object({
      amount: z.number().int().nonnegative().default(0),
      perDay: z.number().int().nonnegative().default(0),
    })
    .prefault({}),
  /** Цена пакета снабжения забега в Суверенах (решение владельца 2026-09-24). Что в пакете
   *  и сколько раз за забег — правило МИРА, оно в режиме (`pve.supply`). Ноль — покупки нет. */
  runSupply: z
    .object({
      price: z.number().int().nonnegative().default(0),
    })
    .prefault({}),
});

export const HeroGradeDefSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  /** Сколько способностей ступень позволяет держать НАДЕТЫМИ одновременно. */
  skillSlots: z.number().int().nonnegative().default(1),
  /** ПРИБАВКА к отсекам под модули КОРАБЛЯ поверх корпуса (§0.38 hero-progression-roadmap).
   *  Железо у героев одинаковое — его даёт корпус (`units.hero.slots`), — и лишь основной
   *  герой, личный флагман игрока, несёт на один отсек больше. Дельта, а не полный бюджет:
   *  иначе правка корпуса тихо разъедется со ступенями. Ноль везде ⇒ ступень железо не
   *  трогает (так у всех, кроме `main`). */
  moduleSlots: ShipSlotsSchema.default({ weapon: 0, defense: 0, utility: 0 }),
});

export const HeroPassiveDefSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  hook: z.enum(HERO_PASSIVE_HOOKS),
  scope: z.enum(HERO_PASSIVE_SCOPES),
  /** WHERE the passive counts (M2.8): only where the terrain belongs to this family
   *  (`SectorTypeDefSchema.family`). Absent = everywhere, which is how every passive
   *  behaved before and still does — old data keeps its meaning.
   *
   *  `scope` and this are different questions and both are asked: `scope` says WHOSE
   *  fleet (the hero's own ship, or the owner's fleets near it), this says on WHICH
   *  ground. A pilot skilled in asteroids helps the ship he flies, in the asteroids.
   *
   *  The terrain read is the one the rule it corrects reads: for `fleet.speed` that is
   *  the province being ENTERED, because that is where `sectorModule` takes its toll.
   *  Unresolvable terrain contributes nothing rather than defaulting to "applies". */
  terrainFamily: z.string().optional(),
  /** Worn in a skill slot (PVR-6.16, owner's decision 2026-09-24): the passive counts only
   *  while it sits in `Hero.equipped`, and it shares the slot budget with abilities. Absent
   *  = always on, which is how every passive behaved before. */
  slotted: z.boolean().default(false),
  params: z
    .object({
      /** Multiplier contribution, e.g. 0.1 = +10% — applied as ×(1 + Σ bonuses). */
      bonus: z.number().default(0),
      /** Euclidean reach in MAP UNITS for `ownFleetsNear`. 0 ⇒ same node only. */
      radius: z.number().nonnegative().default(0),
    })
    .default({ bonus: 0, radius: 0 }),
});

/** What a skill node grants when unlocked (HERO-7). Deliberately only the two grants
 *  the engine already interprets — an ability slot-in (`Hero.abilities`, HERO-4) or a
 *  passive (`Hero.passives`, HERO-5). Stat / ability-param bonuses join when their
 *  engine seams exist (don't ship data promising what nothing implements). */
export const HeroSkillGrantsSchema = z.object({
  /** Ability id (→ `data.heroAbilities`) added to the hero's loadout. */
  ability: z.string().optional(),
  /** Passive id (→ `data.heroPassives`) switched on for the hero. */
  passive: z.string().optional(),
  /** Несколько пассивок одним узлом (EVT-3). Последняя ступень лестницы «мародёра»
   *  поднимает СРАЗУ обе половины — и долю трофеев, и урон, — а узел дерева это одна
   *  ступень: дробить его на два узла ради формы поля значило бы соврать игроку в
   *  дереве. Складывается с `passive`, не заменяет его. */
  passives: z.array(z.string()).default([]),
});

/** One node of the hero skill tree (docs/heroes.md — «дерево = бонусы к способностям»,
 *  ветки transhuman/psionic). Unlock order is gated by `requires` (parent nodes) and
 *  the hero's archetype branch; `cost` is an optional treasury price (default free —
 *  the points economy is an open design question). */
export const HeroSkillNodeSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  /** Branch this node belongs to; omit for a common node any hero may take. */
  branch: HeroBranchSchema.optional(),
  /** Parent node ids that must be unlocked first (the tree edges). */
  requires: z.array(z.string()).default([]),
  /** Treasury cost to unlock. */
  cost: NonnegativeCostSchema.default({}),
  grants: HeroSkillGrantsSchema.prefault({}),
});

/** The ship a hero commands: either an existing unit archetype (`unit` → `data.units`) or
 *  inline stat overrides. A hero reuses the fleet for position/movement/combat, so its
 *  ship is described the same way a unit is (docs/heroes.md §Модель состояния). Both
 *  optional so an archetype can lean on a unit id, tweak it, or define stats outright. */
export const HeroShipSchema = z.object({
  unit: z.string().optional(),
  stats: UnitStatsSchema.partial().optional(),
});

/** A hero archetype (docs/heroes.md §Данные) — the persona a player fields, distinct from
 *  a `UnitDef` (it carries abilities/branch/slots and reuses a ship for its body). The
 *  data-first core model behind the prototype's roster; passives/fittings/skill-trees are
 *  later bricks (HERO-5/6/7), so `startPassives` is a plain id list here. */
export const HeroArchetypeDefSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  branch: HeroBranchSchema.optional(),
  /** The ship the hero commands (unit ref and/or inline stats). */
  ship: HeroShipSchema.default({}),
  /** Module slots the hero's ship exposes (fittings fill these — HERO-6). */
  slots: z.number().int().nonnegative().default(0),
  /** Ability ids granted at spawn (→ `data.heroAbilities`). */
  startAbilities: z.array(z.string()).default([]),
  /** Passive ids active from spawn (→ `data.heroPassives`, HERO-5). Ids only here. */
  startPassives: z.array(z.string()).default([]),
});

/** Session-end reward scale (SES-2 first slice, GDD §3.4) — the data knob for the
 *  XP table `victoryModule` reports on `match.ended`. XP per player =
 *  `xpParticipation + min(xpScoreCap, floor(score / xpScoreDivisor)) + (won ? xpWin : 0)`.
 *  Defaults mirror the prototype's meta formula (`prototype/src/meta.ts matchXp`:
 *  участие 40 + счёт до 100 + победа 160). GDD leaves smooth-vs-league place
 *  scaling open — the reported `place` is the substrate either maps onto. */
export const RewardsDefSchema = z.object({
  /** XP for showing up — paid to every seated player, even in defeat. */
  xpParticipation: z.number().int().nonnegative().default(40),
  /** Score points per 1 XP of the score share. */
  xpScoreDivisor: z.number().positive().default(10),
  /** Cap on the score-share XP. */
  xpScoreCap: z.number().int().nonnegative().default(100),
  /** Win bonus — paid to every member of the winning unit (a coalition wins together). */
  xpWin: z.number().int().nonnegative().default(160),
  /**
   * XP за ОДНУ медаль на ОДНОМ уцелевшем юните, по степеням (VET-4): индекс 0 — первая
   * степень. Решение владельца 6 — «чем выше степень, тем выше награда», поэтому шкала
   * обязана СТРОГО расти, и это проверяется здесь, а не остаётся договорённостью:
   * невозрастающая шкала молча отменила бы решение, и заметить это было бы некому.
   *
   * Пусто (по умолчанию) — медали не платят вовсе. Это не «выключено на всякий случай»,
   * а тот же приём, что у `data.medals`: механика снимается данными, без флага в коде.
   */
  medalXp: z
    .array(z.number().int().nonnegative())
    .default([])
    .refine((xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]!), {
      message: 'medalXp обязана строго расти со степенью (решение владельца 6)',
    }),
});

/**
 * Пороги степеней медали ветерана (VET-3) — data-ручка для `medalsOf` (`state/medals.ts`).
 *
 * Одна линия = одна шкала. `grades` — пороги ПО ВОЗРАСТАНИЮ, от первой степени к высшей;
 * длина массива и есть число степеней у линии. Величина сравнивается с порогом
 * ВКЛЮЧИТЕЛЬНО (ровно на пороге медаль уже есть), не дотянула до первого — медали НЕТ, и
 * это не «нулевая степень»: отсутствие медали и низшая медаль по-разному выглядят в
 * карточке и по-разному платят.
 *
 * Числа в `data/medalGrades.json` взяты ЗАМЕРОМ на self-play, а не назначены — см.
 * `docs/unit-medals-roadmap.md` §0.5. Держать их данными важно ровно потому, что замер
 * устареет: заслуга считается из состояния, а грейд в состоянии не лежит, поэтому
 * перебалансировка порогов ничего не мигрирует и действует на идущих матчах.
 */
export const MedalLineDefSchema = z.object({
  grades: z.array(z.number().positive()).min(1),
});

/** Premium research-boost scale (SES-3, GDD §4.3) — the data knob for
 *  `technology.boost`: sink the premium resource (owner's decision: **energy**,
 *  mined on rare energy-rich worlds — see `planetTypes.energy_nexus`) into
 *  faster research. One boost pays `cost` and cuts the REMAINING research time
 *  by `initialPercent × decay^boostsAlreadyApplied` — geometric diminishing
 *  returns per GDD's fairness rule (✓ ускорение исследований, ✗ юниты/боевая
 *  мощь/опыт героев): pouring more never buys instant completion. */
export const ResearchBoostDefSchema = z.object({
  /** Treasury price of ONE boost (any resource mix; default — the premium energy). */
  cost: ResourceBagSchema.default({ energy: 50 }),
  /** Share of the remaining time the FIRST boost removes. */
  initialPercent: z.number().gt(0).lt(1).default(0.25),
  /** Geometric falloff per successive boost of the same research. */
  decay: z.number().gt(0).lt(1).default(0.5),
});

/** How a match is seated: N against N in two teams, or every player for themselves.
 *  A mode names the format; the lobby turns it into concrete seats (PVE-1.1). */
export const TEAM_FORMATS = ['1v1', '2v2', '3v3', '4v4', '5v5', 'ffa'] as const;
export const TeamFormatSchema = z.enum(TEAM_FORMATS);

/**
 * The victory rules a mode pins — `VictoryConfig` MINUS `endsAt`. `endsAt` is an
 * absolute match timestamp, so it belongs to the match, never to shipped content;
 * `.strict()` turns writing it here into a loud validation error instead of a field
 * zod would silently drop, which would leave a mode that reads as configured and
 * isn't (A08 — validate before use, fail-closed). Every field is optional: an
 * omitted one falls back to the victory module's base rule, which is how a preset
 * says "standard rules here".
 */
export const ModeVictorySchema = z
  .object({
    dominationPercent: z.number().gt(0).max(1).optional(),
    scoreLimit: z.number().positive().optional(),
    coalitionFactor: z.number().positive().optional(),
  })
  .strict();

/**
 * The PvE section of a mode: one common NPC enemy attacking in scheduled waves
 * (docs/game-modes-roadmap.md GM-4.6). Present ⇒ the mode is PvE. The numbers are
 * the balance knobs — waves and their spacing are tuned in content, never in code.
 */
export const ModePveSchema = z
  .object({
    /** Waves the players must survive to clear the mode. */
    waves: z.number().int().positive(),
    /** Faction the NPC seat plays (→ `data.factions`). */
    npcFaction: z.string(),
    /** Game-hours between waves — a real-time duration, timeScale-scaled like every other. */
    waveIntervalHours: z.number().positive(),
    /** What ONE wave is made of (unit ids → `data.units`), fielded ×N on wave N.
     *
     *  The mode owns this rather than the NPC faction's `startingLoadout.fleet`
     *  because those are two different questions with one answer only by accident:
     *  the loadout says what a PLAYER of that faction opens a match with, and the
     *  Swarm is playable. Tuning the assault through it would re-balance every match
     *  someone picks the Swarm, and tuning the faction would silently re-balance the
     *  assault. Omitted ⇒ the wave falls back to the faction's opening force, which
     *  is the pre-existing behaviour (invariant #3: absent data → base default).
     *
     *  Declared EMPTY is rejected rather than treated as "omitted": the module skips
     *  a wave it has nothing to field, so an empty list would ship a mute assault that
     *  reads as configured. Fail-closed at load (A05/A08), like every other catalog. */
    waveFleet: z.array(StartingStackSchema).min(1).optional(),
    /** Ground troops each wave carries as cargo (unit ids → `data.units`), fielded ×N
     *  on wave N exactly like {@link ModePve.waveFleet}.
     *
     *  Without one a wave can take an EMPTY sector by arrival and nothing else: taking
     *  a garrisoned world is a two-phase capture, and phase two needs boots. A defended
     *  homeworld was therefore unloseable — the assault parked in orbit forever and
     *  `pve-failed` could not be reached (PVR-1.6). Scaling with the wave keeps the
     *  landing party proportional to the hulls carrying it. */
    waveLanding: z.array(StartingStackSchema).min(1).optional(),
    /** Корабли, которые каждая волна несёт в ОДНОМ и том же числе, без умножения на номер
     *  волны: малый ретранслятор Роя идёт с волной по одному (решение владельца
     *  2026-09-24), десятая волна не везёт десять. Нет — волна как была. */
    waveFixed: z.array(StartingStackSchema).min(1).optional(),
    /** Boons the run offers between waves (PVR-1.4) — ids from `data.technologies`.
     *
     *  Reuses the seam `metaGrant` proved: a hidden session technology handed out as
     *  `completed`, whose bonuses ride the ordinary technology hooks. No engine code
     *  per boon, and a new one is a JSON entry. Absent ⇒ the run offers nothing, which
     *  is the pre-existing behaviour. */
    boons: z.array(z.string()).min(1).optional(),
    /** How long the human seats must still hold a world after the LAST wave lands for
     *  the mode to count as cleared (PVR-2.5, owner's resolution 2026-09-23: «победа —
     *  выстоять»). Game-hours, timeScale-scaled like every other duration here.
     *
     *  Without it the only clear is the older one — every wave landed AND the NPC holds
     *  nothing — and on the shipped chapters that one alone was out of reach: waves are
     *  free, fielded ×N and staged INSIDE the NPC's own world, so "take everything after
     *  the last wave" meant beating the whole accumulated assault (55× the declared force
     *  by wave ten). The wipe stays as the early finish. Absent ⇒ the pre-existing rule
     *  only (invariant #3: absent data → base default). */
    holdHours: z.number().positive().optional(),
    /** Множитель скорости флотов NPC-стороны в этом режиме (решение владельца 2026-09-25:
     *  «слишком большая скорость у кораблей Роя»). Только режим: Рой основной игры и
     *  сыгранный игроком — прежней скорости. Нет поля ⇒ ×1 (инвариант №3). */
    npcSpeedFactor: z.number().positive().max(1).optional(),
    /** Пакет снабжения за Суверены (решение владельца 2026-09-24): что приходит в казну
     *  за одну покупку и сколько покупок на забег. Цену в Суверенах знает магазин профиля
     *  (`sectorZeroShop.runSupply`) — у матча этой валюты нет. Нет раздела ⇒ `pve.supply`
     *  отказывает (`E_NO_SUPPLY`). */
    supply: z
      .object({
        perRun: z.number().int().nonnegative(),
        pack: z.record(z.string(), z.number().int().positive()),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Радиусы зрения режима (`SightRules`, `state/gameState.ts`): «единый радиус; для
 *  Sector Zero — свой по цифрам» (решение владельца 2026-09-24). Нет раздела ⇒ общие
 *  числа ядра `DEFAULT_SIGHT`. */
const ModeSightSchema = z
  .object({
    world: z.number().nonnegative(),
    /** Свой обзор по виду провинции вместо `world` (решение владельца 2026-09-25). */
    byKind: z.record(z.string(), z.number().nonnegative()).optional(),
    fleet: z.number().nonnegative(),
    radarScale: z.number().positive(),
  })
  .strict();

/** PVR-6.17. Дерево технологий режима (заказ владельца 2026-09-24: «технологии из
 *  сетевой игры надо переделать под Sector Zero — там дневные ограничения, Хранитель,
 *  которого нет, и т. д.»). Сетевой матч идёт неделями, и узлы в нём открываются по
 *  дням; забег проходится за часы и до третьего дня не доживает. Нет раздела ⇒ дерево
 *  как в сетевом матче.
 *  - `dayGates: false` — ворота дней снимаются целиком: остаются предки, условия и цена;
 *  - `exclude` — узлы, которых в режиме нет вовсе: их не исследовать и не показывать. */
const ModeTechnologySchema = z
  .object({
    dayGates: z.boolean().default(true),
    exclude: z.array(z.string()).default([]),
  })
  .strict();

/**
 * A game mode — the named preset of rules a match runs under (docs/game-modes-roadmap.md
 * GM-0.1). A mode is DATA: "3v3 against the Swarm" is a JSON entry plus an optional
 * module, not a kernel change. The record key is the mode id (`standard`), as in
 * every other catalog here.
 */
export const GameModeDefSchema = z.object({
  /** English display name, localized through `tData()` → `data.<slug>`. */
  name: z.string(),
  description: z.string().optional(),
  /** Victory rules this mode pins; omitted fields keep the base rules. */
  victory: ModeVictorySchema.prefault({}),
  /** How the match is seated. */
  teamFormat: TeamFormatSchema.default('ffa'),
  /** Ids of the OPTIONAL core modules the mode wants (e.g. `pve`). A kernel built
   *  without one degrades to base behaviour rather than crashing (invariant #3). */
  modules: z.array(z.string()).default([]),
  /** Present ⇒ PvE mode (a common NPC enemy attacking in waves). */
  pve: ModePveSchema.optional(),
  /** Свои радиусы зрения режима; нет ⇒ общие числа ядра. */
  sight: ModeSightSchema.optional(),
  /** Своё дерево технологий режима (PVR-6.17); нет ⇒ как в сетевом матче. */
  technology: ModeTechnologySchema.optional(),
});

/** Session-market rules that belong to CONTENT, not to the mechanic (CONV-9).
 *
 *  `goods` — what may be listed at all. The prototype kept this whitelist as a
 *  `MARKET_GOODS` constant inside its module, which made "what is tradable" a code
 *  change; the core traded any declared resource, which on the prototype's catalog
 *  would have opened credits-for-credits trading. Declaring it here settles both:
 *  a new tradable good is a data edit, and the currency simply isn't on the list.
 *
 *  An EMPTY list means "no whitelist" — every declared resource is tradable. That is
 *  the core's historical behaviour, so catalogs that say nothing keep working. */
export const MarketDefSchema = z
  .object({
    goods: z.array(z.string()).default([]),
  })
  .strict();

/**
 * Боевая надбавка ветерана (PERK-3.1) — ПОСЛЕДОВАТЕЛЬНЫЙ множитель, растущий с числом
 * пережитых сражений (`UnitStack.battles`, VET-2).
 *
 * ⚠️ Это НЕ медаль, и живёт оно отдельно от `medals` намеренно. Решение владельца 2
 * (`docs/unit-medals-roadmap.md` §0.0) — «медаль не даёт силы в бою, только награда» —
 * владелец сузил 2026-09-23: выплата за медаль силы по-прежнему не даёт, а СЧЁТЧИК боёв
 * теперь ещё и питает боевой множитель. Держать ставку рядом с порогами медалей значило
 * бы снова склеить эти две вещи в одну, и сужение перестало бы читаться из данных.
 *
 * ГДЕ ДЕЙСТВУЕТ (VET-6, резолюция владельца 2026-09-24): только там, где хост включил
 * силу ветерана (`MatchConfig.veteranPower`) — в Sector Zero. Сетевая партия платит
 * ветерану одной наградой в конце матча, и эти ставки в ней не действуют вовсе. Сами
 * ставки лежат здесь, а не у хоста: сколько даёт бой — баланс, его крутят данными.
 *
 * Ноль в поле ВЫКЛЮЧАЕТ свою половину целиком, без флага в коде — та же посадка, что у
 * `medals`.
 */
export const VeteranDefSchema = z
  .object({
    /** Прибавка к множителю урона за КАЖДЫЙ пережитый бой в среднем на юнит стороны.
     *  Потолок ставит сама механика, а не это число: по замеру (`docs/unit-medals-roadmap.md`
     *  §0.5) на юнит приходится максимум 4 боя, и удлинение матча вдвое распределения не
     *  двигает — много дерущийся стек погибает раньше, чем накопит больше. */
    damagePerBattle: z.number().min(0).default(0),
    /** Очки пула снижения урона (`combat.mitigation`) за КАЖДЫЙ пережитый бой в среднем на
     *  юнит стороны (VET-6): сторона с пулом R принимает `1 / (1 + R)` входящего урона, то
     *  есть держит в `1 + R` раз больше — это и есть «корпус» ветерана. */
    hullPerBattle: z.number().min(0).default(0),
  })
  .strict();

/**
 * СЛУЧАЙНЫЙ ПРОМОУШЕН (PERK-3.2): изредка построенная партия выходит «отмеченной», и её
 * прибавка идёт ПОСЛЕДОВАТЕЛЬНЫМ множителем — то есть не тонет в сумме массовых
 * процентов, а множится поверх неё.
 *
 * ⚠️ Кирпич предупреждает: это не маленький бафф. Те же проценты, сложенные с десятком
 * чужих, стоят копейки, а вынесенные в отдельный множитель дают почти всю свою величину.
 * Отсюда и форма чисел: величина заметная, но вероятность НИЗКАЯ.
 *
 * Ноль в любом из полей выключает механику целиком, без флага в коде.
 */
export const PromotionDefSchema = z
  .object({
    /** Вероятность отметить ОДИН выполненный заказ постройки. Бросок один на заказ, а не
     *  на корабль: «прочный видимый момент» из кирпича — это событие постройки. */
    chance: z.number().min(0).max(1).default(0),
    /** Прибавка урона у полностью отмеченного стека. Сторона получает её долей: средняя
     *  отметка на юнит × эта величина. */
    damageBonus: z.number().min(0).default(0),
  })
  .strict();

export const GameDataSchema = z.object({
  version: z.string(),
  resources: z.array(z.string()).min(1),
  units: z.record(z.string(), UnitDefSchema),
  factions: z.record(z.string(), FactionDefSchema),
  buildings: z.record(z.string(), BuildingDefSchema),
  events: z.record(z.string(), EffectRuleSchema),
  sectors: z.record(z.string(), SectorTypeDefSchema).default({}),
  sectorKinds: z.record(z.string(), SectorKindDefSchema).default({}),
  planetTypes: z.record(z.string(), PlanetTypeDefSchema).default({}),
  technologies: z.record(z.string(), TechnologyDefSchema).default({}),
  scientists: z.record(z.string(), ScientistDefSchema).default({}),
  modules: z.record(z.string(), ModuleDefSchema).default({}),
  heroes: z.record(z.string(), HeroArchetypeDefSchema).default({}),
  heroAbilities: z.record(z.string(), HeroAbilityDefSchema).default({}),
  heroPassives: z.record(z.string(), HeroPassiveDefSchema).default({}),
  heroSkillTrees: z.record(z.string(), HeroSkillNodeSchema).default({}),
  heroGrades: z.record(z.string(), HeroGradeDefSchema).default({}),
  /** Лестница звёздности Sector Zero (SZE-0.2). Пусто = мастерская и академия выключены
   *  данными, без флага в коде. */
  sectorZeroStars: SectorZeroStarsSchema.prefault({}),
  sectorZeroShop: SectorZeroShopSchema.prefault({}),
  modes: z.record(z.string(), GameModeDefSchema).default({}),
  // `.prefault({})` pipes the empty object through the nested schema, so its
  // per-field defaults stay the single source of truth (no literal to drift).
  rewards: RewardsDefSchema.prefault({}),
  /** Шкалы степеней медалей ветерана (VET-3). Пусто = медалей в этой партии нет вовсе:
   *  механика выключается снятием данных, без единого флага в коде. */
  medals: z.record(z.string(), MedalLineDefSchema).prefault({}),
  researchBoost: ResearchBoostDefSchema.prefault({}),
  /** Боевая надбавка ветерана (PERK-3.1). Ноль = надбавки в этой партии нет вовсе. */
  veteran: VeteranDefSchema.prefault({}),
  /** Случайный промоушен (PERK-3.2). Ноль в любом поле = механики нет вовсе. */
  promotion: PromotionDefSchema.prefault({}),
  market: MarketDefSchema.prefault({}),
});

export type MarketDef = z.infer<typeof MarketDefSchema>;
export type VeteranDef = z.infer<typeof VeteranDefSchema>;
export type PromotionDef = z.infer<typeof PromotionDefSchema>;
export type ResourceBag = z.infer<typeof ResourceBagSchema>;
export type UnitStats = z.infer<typeof UnitStatsSchema>;
export type UnitDef = z.infer<typeof UnitDefSchema>;
export type ShipSlotType = z.infer<typeof ShipSlotTypeSchema>;
export type ShipSlots = z.infer<typeof ShipSlotsSchema>;
export type ModuleDef = z.infer<typeof ModuleDefSchema>;
export type ModuleEffects = z.infer<typeof ModuleEffectsSchema>;
export type FactionDef = z.infer<typeof FactionDefSchema>;
export type FactionLoadout = z.infer<typeof FactionLoadoutSchema>;
export type FactionPassives = z.infer<typeof FactionPassivesSchema>;
export type StartingStack = z.infer<typeof StartingStackSchema>;
export type BuildingDef = z.infer<typeof BuildingDefSchema>;
export type BuildingLevel = z.infer<typeof BuildingLevelSchema>;
export type EffectRule = z.infer<typeof EffectRuleSchema>;
export type SectorTypeDef = z.infer<typeof SectorTypeDefSchema>;
export type SectorKindDef = z.infer<typeof SectorKindDefSchema>;
export type SectorKindAppearance = z.infer<typeof SectorKindAppearanceSchema>;
export type PlanetTypeDef = z.infer<typeof PlanetTypeDefSchema>;
export type TechnologyUnlocks = z.infer<typeof TechnologyUnlocksSchema>;
export type TechnologyEffects = z.infer<typeof TechnologyEffectsSchema>;
export type TechnologyDef = z.infer<typeof TechnologyDefSchema>;
export type ScientistDef = z.infer<typeof ScientistDefSchema>;
export type HeroBranch = z.infer<typeof HeroBranchSchema>;
export type HeroAbilityDef = z.infer<typeof HeroAbilityDefSchema>;
export type HeroShip = z.infer<typeof HeroShipSchema>;
export type HeroArchetypeDef = z.infer<typeof HeroArchetypeDefSchema>;
export type HeroPassiveDef = z.infer<typeof HeroPassiveDefSchema>;
export type HeroSkillNode = z.infer<typeof HeroSkillNodeSchema>;
export type HeroSkillGrants = z.infer<typeof HeroSkillGrantsSchema>;
export type TeamFormat = z.infer<typeof TeamFormatSchema>;
export type ModeVictory = z.infer<typeof ModeVictorySchema>;
export type ModePve = z.infer<typeof ModePveSchema>;
export type GameModeDef = z.infer<typeof GameModeDefSchema>;
export type RewardsDef = z.infer<typeof RewardsDefSchema>;
export type ResearchBoostDef = z.infer<typeof ResearchBoostDefSchema>;
export type GameData = z.infer<typeof GameDataSchema>;

/** Stats of a building at a given level (1-based). Level 1 = the base fields;
 *  levels 2..N come from `upgrades`. Out-of-range levels fall back to level 1. */
export function buildingLevel(def: BuildingDef, level: number): BuildingLevel {
  if (level <= 1) {
    const { cost, buildTimeHours, produces, upkeep, hp, defenseBonus, radarRange, relayRange, healRate, shipRepair, aaDamage, pointDefense, shuttleBay, buildSlots, issuesGarrison, creditsBonus, buildSpeedBonus } = def;
    return { cost, buildTimeHours, produces, upkeep, hp, defenseBonus, radarRange, relayRange, healRate, shipRepair, aaDamage, pointDefense, shuttleBay, buildSlots, issuesGarrison, creditsBonus, buildSpeedBonus };
  }
  return def.upgrades[level - 2] ?? buildingLevel(def, 1);
}

/** Highest level this building can reach (level 1 plus its upgrades). */
export function buildingMaxLevel(def: BuildingDef): number {
  return 1 + def.upgrades.length;
}

/** Parses and validates a full game-data bundle, throwing on invalid input. */
export function parseGameData(raw: unknown): GameData {
  return GameDataSchema.parse(raw);
}

/** Non-throwing variant — returns a discriminated result. */
export function safeParseGameData(raw: unknown): z.ZodSafeParseResult<GameData> {
  return GameDataSchema.safeParse(raw);
}

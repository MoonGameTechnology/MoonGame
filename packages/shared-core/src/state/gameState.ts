import { seedRng, type RngState } from '../rng/rng';
import type { FleetChain } from './chain';

/**
 * The authoritative game state. Stored as JSONB on the server
 * (docs/architecture.md §4.3) and mirrored on the client. Pure data: no class
 * instances, no functions — it must round-trip through JSON unchanged.
 *
 * Note: the core is data-driven (docs/architecture.md §2). Identifiers below
 * (units, buildings, traits, resources) are plain strings that resolve against
 * the loaded game data — the engine never hard-codes any concrete content.
 */

export type PlayerId = string;
export type PlanetId = string;
export type FleetId = string;
export type BattleId = string;
export type ResourceId = string;
export type UnitId = string;
export type ModuleId = string;
export type BuildingId = string;
export type TechnologyId = string;
export type TraitId = string;

/** A dynamic resource ledger. The engine never assumes a fixed set of
 *  resources (docs/architecture.md §2.3). */
export type ResourceBag = Record<ResourceId, number>;

export interface UnitStack {
  unit: UnitId;
  count: number;
  /** Remaining HP pool of this stack during a battle (≤ count × def.hp).
   *  Undefined outside combat = full health. */
  hp?: number;
  /** Remaining ablative shield pool of this stack (≤ count × def.shield). Absorbs
   *  damage before `hp`; a ship still dies only when its HULL (`hp`) hits 0.
   *  Undefined = full shield (shields-roadmap SH-0.1). */
  shieldHp?: number;
  /** Installed ship modules (the loadout). For a BUILT stack it is chosen at build
   *  time and locked after — there is no refit of a built ship. The one stack minted
   *  another way is the hero's: `deployHero` stamps it from {@link Hero.modules}, which
   *  the player refits between deployments (HPR-1.5.2). Ids → `data.modules`; ×count.
   *  Part of the stack's merge identity: stacks with different loadouts never
   *  merge (ship-modules-roadmap.md SM-0.3). Absent = no modules. */
  modules?: ModuleId[];
  /** Звёздность УСТАНОВЛЕННЫХ модулей этого стека (SZE-1.1), `id → ★`. Снимок меты
   *  Sector Zero, снятый в момент, когда стек родился: `prepareSectorZeroRun` на старте
   *  забега, верфь — из {@link PlayerArsenal.stars} при постройке. Ядро во время матча
   *  мету НЕ перечитывает, поэтому заточка на ходу уже летающий корабль не меняет —
   *  та же доктрина «нет рефита», что и у самого {@link UnitStack.modules}.
   *
   *  ⚠️ **В идентичность слияния НЕ входит** (`loadoutKey` её не видит), и это
   *  осознанно: звёзды — замороженное свойство ВЛАДЕЛЬЦА, снятое один раз на матч,
   *  поэтому два стека одного игрока с одним лоадаутом всегда несут одинаковые звёзды,
   *  и слияние ничего не теряет. Начни звёзды меняться под живым матчем — правило
   *  сломается, и тогда их придётся заводить в ключ.
   *
   *  Отсутствует / пусто = ★0 у всех, то есть прежние числа байт-в-байт. Записываются
   *  только НЕнулевые звёзды НАДЕТЫХ модулей. */
  moduleStars?: Record<ModuleId, number>;
  /** Поднятая РЕДКОСТЬ установленных модулей (SZE-5.1), `id → ступень` из `RARITIES`.
   *  Тот же род поля, что {@link UnitStack.moduleStars}: снимок меты, снятый при рождении
   *  стека, за матч не меняется и потому в идентичность слияния не входит. Пишутся только
   *  модули, поднятые ВЫШЕ своей базовой ступени; отсутствует = базовая редкость у всех,
   *  прежние числа байт-в-байт. Неизвестная ступень читается как базовая. */
  moduleRarity?: Record<ModuleId, string>;
  /** Заслуга ветерана: сколько урона нанёс ОДИН юнит этого стека за матч, и сколько
   *  сражений он пережил (VET-2). Из этих двух чисел VET-3 считает грейд медали; сам
   *  грейд в состоянии НЕ лежит — значит пороги можно перебалансировать на живом матче,
   *  ничего не мигрируя. Отсутствуют = стек не воевал (это не то же самое, что ноль:
   *  «медали нет» и «медаль низшей степени» — разные вещи и для карточки, и для выплаты).
   *
   *  ⚠️ **Оба числа — НА ЮНИТ, а не итог на стек**, и это не стилистический выбор.
   *  Итог ломается на убыли: 5 корпусов с итогом 300 — это 60 на корпус; погиб один —
   *  итог всё ещё 300, а корпусов четыре, то есть 75 на корпус. Гибель товарища
   *  повышала бы награду выжившим. Поэтому арифметика носителя такая:
   *    · СПЛИТ копирует (величина на юнит от размера отделённой части не зависит);
   *    · СЛИЯНИЕ усредняет по весу — долив свежих кораблей разбавляет честь
   *      подразделения по новым, и это содержательное правило, а не побочный ущерб;
   *    · УБЫЛЬ не трогает — выжившие сохраняют запись подразделения. */
  damageDealt?: number;
  /** Пережитых сражений на юнит — см. {@link UnitStack.damageDealt} про арифметику. */
  battles?: number;
  /** ДОЛЯ отмеченных юнитов в стеке, 0..1 (PERK-3.2, «промоушен»). Бросок делается один
   *  раз на выполненный заказ постройки; отмеченный корабль бьёт с ПОСЛЕДОВАТЕЛЬНЫМ
   *  множителем, то есть его прибавка не тонет в общей сумме массовых процентов.
   *
   *  Хранится долей, а не флагом, ровно чтобы работать по арифметике заслуги
   *  {@link UnitStack.damageDealt}: сплит копирует, слияние усредняет по весу, убыль не
   *  трогает. Флаг на слиянии пришлось бы округлять, и «отмеченность» либо размножалась
   *  бы даром, либо пропадала. */
  promoted?: number;
}

/** A constructed building on a planet. Buildings are leveled (1..maxLevel) and
 *  carry structural HP that orbital bombardment / ground assault wear down
 *  (GDD §7.4); a destroyed building is removed and stops granting its bonus. */
export interface BuildingInstance {
  /** Unique instance id (RULES-2.1): allows `building.upgrade` to address a
   *  SPECIFIC instance when `maxPerPlanet > 1`. Without it, `find(b => b.type === …)`
   *  always hits the first instance. Auto-assigned at construction time;
   *  optional for back-compat (old state without uid → find-by-type). */
  uid?: string;
  type: BuildingId;
  level: number;
  hp: number;
}

/** A construction/upgrade/unit order cancelled mid-build: the paid-in-full order was
 *  refunded its unbuilt share and halted rather than lost outright — `resume` pays
 *  `remainingCost` (exactly what was refunded) to re-schedule the same
 *  `remainingHours` and finish from here, not from scratch. `id` is the original
 *  scheduled event's `seq` (stable across cancel → resume). Planet-scoped: buildings,
 *  upgrades and unit orders are all placed against a specific planet. */
export interface PausedConstructionSite {
  id: number;
  kind: 'building' | 'upgrade' | 'unit';
  playerId: PlayerId;
  building?: BuildingId;
  /** Upgrade target level (kind: 'upgrade' only). */
  level?: number;
  unit?: UnitId;
  count?: number;
  modules?: ModuleId[];
  /** Наземный юнит внутри десантного челнока (SHU-5.2). */
  troop?: UnitId;
  /** RULES-2.1: instance uid for upgrade resume (when maxPerPlanet > 1). */
  uid?: string;
  /** Fraction (0..1) already complete at the moment of the pause. */
  progress: number;
  /** Game-hours still needed to finish, same units as `buildTimeHours`. */
  remainingHours: number;
  /** Exactly what was refunded; exactly what `resume` charges again. */
  remainingCost: ResourceBag;
}

export interface Player {
  id: PlayerId;
  name: string;
  faction: string;
  status: 'active' | 'defeated';
  /** True for an AI-driven seat (bot). Absent = human. Game rules may key off it —
   *  e.g. diplomacy: a coalition (alliance) is between humans only, bots are not
   *  invitable (`diplomacyModule` rejects `E_BOT_ALLIANCE`). */
  ai?: boolean;
  /** Map inhabitants, never claimable player seats or PvP contenders. */
  npc?: 'pirate' | 'neutral';
  /** The player's treasury — production accrues here, upkeep/costs drain it. */
  resources: ResourceBag;
  /** Resources whose upkeep went UNPAID at the last settlement (treasury pinned at
   *  zero with a remainder owed). While a resource is in arrears, buildings whose
   *  upkeep consumes it run at half output (economy.ts BROWNOUT) — a brownout, not
   *  a shutdown. Sorted for determinism; absent = all bills paid. Private to the
   *  owner (stripped from other players' views like the treasury itself). */
  arrears?: string[];
  technologies?: PlayerTechnologyState;
  /** Chosen research leaders (a council of up to 2), snapshotted at match start and
   *  immutable (GDD §2/§5.2): each `id` into `data.scientists`, `level` from the account
   *  meta. A `has_scientist` gate passes if ANY leader matches; `research.slots` bonuses
   *  sum across them. Read via {@link scientistsOf}. Absent/empty = no leader chosen. */
  scientists?: Array<{ id: string; level: number }>;
  /** @deprecated Legacy single-leader field (snapshots from before the 2-slot council).
   *  Never written now; still READ through {@link scientistsOf} for old persisted state. */
  scientist?: { id: string; level: number };
  /** ИГРОВОЕ время заявки на место (`seat.claim`, ENTRY-3): дом и совет выбраны и
   *  больше не меняются. Отсутствует — место ещё никем не занималось, за него играет
   *  серверный ИИ. Держать маркер В СОСТОЯНИИ обязательно: `seat.claim` — КЛИЕНТСКИЙ
   *  тип, игрок может прислать его сам, поэтому «заявить можно один раз» обязан
   *  проверять редьюсер, а не память сервера.
   *
   *  Время игровое, а РЕАЛЬНОЕ из него выводится делением на `timeScale` — та же
   *  дисциплина, что у окна входа (`MatchRegistry.entryOpen`). Настенных часов в
   *  `GameState` нет и быть не должно: они сделали бы реплей невоспроизводимым. */
  claimedAt?: number;
  /** Игрок ДОШЁЛ до карты (`seat.confirm`): с этого момента место закреплено за ним
   *  насовсем. До подтверждения заявка временная — место, взятое по ссылке и брошенное,
   *  освобождается по истечении окна (`seat.release`), иначе один не пришедший человек
   *  запирал бы кресло до конца партии. */
  seated?: true;
  /** Когда кресло в ПОСЛЕДНИЙ раз освободили — по истечении заявки (`seat.release`)
   *  или властью администратора (`seat.kick`). Игровое время, как и `claimedAt`.
   *
   *  Поле существует не для показа, а чтобы у СЛЕДУЮЩЕЙ заявки на это кресло был
   *  свой идентификатор действия. Идентификатор `seat-claim:<матч>:<место>` детерминирован
   *  по (матч, место) — это правильно для повторного входа одного и того же человека
   *  (квитанции дедупят повтор), но после смены владельца становится ловушкой: заявка
   *  нового игрока совпала бы по id с квитанцией старого, и комната вернула бы
   *  кэшированный успех, НЕ применив её. Кресло тогда числится занятым в сторе и
   *  незаявленным в состоянии: `seat.confirm` не проходит, место не закрепляется и
   *  снова истекает по окну. Ровно это и ловилось живым прогоном после ADM-1.
   *
   *  Отсутствует, пока кресло никто не освобождал. */
  freedAt?: number;
  /** Steward delegation ("hand the seat to the AI while I sleep"): while set and the
   *  world clock is before `until`, the server AI plays this seat with `posture`. The
   *  server-side driver reads it via `stewardActive`; it auto-expires on the clock
   *  crossing `until` (stewardModule). Absent = the player commands the seat. */
  steward?: StewardState;
  /** The Steward's decision journal (SITREP, ST-2.4): what the AI did on this seat's
   *  last watch, stamped by the server driver via `steward.report` and kept AFTER the
   *  delegation lapses — the sleeping player's client is offline, so the morning
   *  report must live in state, not in a client log. Bounded FIFO; a new delegation
   *  starts a fresh journal. Owner-private (stripped from rivals' views, like the
   *  treasury — both the journal and the autopilot status itself read as «спит»). */
  stewardLog?: StewardLogEntry[];
  /** Hold points (ST-2.1, guard): OWN worlds the player ORDERED held — a standing
   *  order (the CC-4 family), honored by the Steward under any posture: a hold
   *  point is never auto-evacuated; a threatened one is REINFORCED instead. Set
   *  via `steward.holdpoint` (client-submittable, capped at
   *  `MAX_STEWARD_HOLD_POINTS`). Owner-private — a rival reading your anchors is
   *  targeting intel. Absent = no points. */
  stewardHoldPoints?: PlanetId[];
  /** Arsenal snapshot (ARS-3): the catalog ids this seat OWNS and may build with —
   *  taken from the account's `ArsenalStore` when the session is assembled (AvA:
   *  at roster lock, GDD §2 «консервация»). While present, `unit.build` requires
   *  the hull and every module to be listed (`E_NOT_OWNED`) and `hero.fit` the
   *  fitting; ABSENT = no restriction (regular/dev matches — graceful degradation).
   *  Owner-private like the treasury (stripped from other players' views). LARS-1
   *  will complement this with the live server-side ownership read (LARS-0.2). */
  arsenal?: PlayerArsenal;
}


/** The build-permission snapshot of a seat (see `Player.arsenal`): unique, sorted
 *  catalog ids per kind — the shape both the core gate and the UI filter read. */
export interface PlayerArsenal {
  /** Buildable hulls → `data.units` ids. */
  hulls: string[];
  /** Installable ship modules → `data.modules` ids. */
  modules: string[];
  /** Звёздность модулей этого места (SZE-1.1), `id → ★` — снимок меты Sector Zero,
   *  из которого верфь штампует {@link UnitStack.moduleStars} на всё, что построит за
   *  забег. Без него стартовый флот летал бы на ★N, а построенное на верфи — на ★0:
   *  один модуль с двумя разными числами в одном матче. Отсутствует = ★0 у всех
   *  (обычные матчи — мягкая деградация, как и у самого арсенала). */
  stars?: Record<string, number>;
  /** Поднятая редкость модулей этого места (SZE-5.1), `id → ступень` — снимок, из
   *  которого верфь штампует {@link UnitStack.moduleRarity}. Та же причина, что у
   *  {@link PlayerArsenal.stars}: иначе стартовый флот и построенное за забег несли бы
   *  один модуль с разными числами. Отсутствует = базовая редкость у всех. */
  rarity?: Record<string, string>;
}

/** A live Steward delegation on a player (see `Player.steward`). */
export interface StewardState {
  /** Behaviour profile the AI follows (see `STEWARD_POSTURES`). */
  posture: string;
  /** Game-time (ms) the delegation lapses at — control returns to the player then. */
  until: number;
}

/** One recorded Steward decision (see `Player.stewardLog`): a compact, JSON-safe fact
 *  the driver stamps; the client renders it localized. `kind` is the driver's
 *  vocabulary (evac / ferry / strike / watch / hold / stranded — extensible), the
 *  optional fields carry only what that kind needs. */
export interface StewardLogEntry {
  /** Game-time (ms) of the decision. */
  at: number;
  kind: string;
  /** Node (planet id) the decision concerns. */
  node?: string;
  /** Fleet the decision tasked. */
  fleetId?: string;
  /** Destination node (evacuation target etc.). */
  to?: string;
  /** A relevant count (fleets moved, units lifted, ...). */
  count?: number;
  /** Forecast hull-loss fraction (0..1) the decision keyed off. */
  fraction?: number;
}

/** The player's chosen research leaders (0–2). Reads the current `scientists` council and
 *  falls back to the legacy single `scientist` (older snapshots) — the one accessor the
 *  `+slot` bonus and `has_scientist` gate use, so both stay agnostic to the field shape. */
export function scientistsOf(
  player: Player | undefined,
): ReadonlyArray<{ id: string; level: number }> {
  if (!player) return [];
  if (player.scientists) return player.scientists;
  return player.scientist ? [player.scientist] : [];
}

export interface ActiveResearch {
  technology: TechnologyId;
  startedAt: number;
  completesAt: number;
  /** Premium boosts already applied (SES-3): drives the geometric diminishing
   *  returns of `technology.boost`. Absent = never boosted. */
  boosts?: number;
}

export interface PlayerTechnologyState {
  completed: TechnologyId[];
  /** Research currently in progress — one entry per occupied slot (base 2,
   *  raisable to a max of 3 via the `research.slots` hook). Absent/empty = idle labs. */
  active?: ActiveResearch[];
}

/** Diplomatic stance between two players (symmetric). Richer than the combat
 *  `hostile|ally|neutral` relation the `diplomacy` capability projects (D2):
 *  - `war`      → hostile (fleets engage, worlds can be assaulted)
 *  - `peace`    → neutral (no auto-combat; the plain "we are not fighting" state)
 *  - `pact`     → neutral (a non-aggression pact — like peace, but a declared,
 *                 breakable agreement rather than mere absence of war)
 *  - `alliance` → ally (shared side; an ally's world can't be attacked)
 *  The stance→relation mapping is `stanceToRelation` (`state/diplomacy.ts`),
 *  provided as the `diplomacy` capability by `diplomacyModule` (D2). */
export type DiplomaticStance = 'war' | 'peace' | 'pact' | 'alliance';


/** A stolen, time-boxed intel window (espionage): while `until` is ahead of the
 *  world clock, `visibleState` lets the OWNING viewer see through the fog at the
 *  granted target. What each kind opens:
 *  - `treasury` — the target player's resource bag stays visible;
 *  - `planet`   — the granted world's contents (owner/garrison/buildings) read live;
 *  - `fleets`   — the target player's fleets stay in view (position + composition).
 *  Grants are produced by `espionageModule` and expire on their own. */
export interface IntelGrant {
  kind: 'treasury' | 'planet' | 'fleets';
  /** `treasury`/`fleets` → target player id; `planet` → the granted planet id. */
  target: string;
  /** World-time (ms) the window closes. */
  until: number;
}

export type MatchStatus = 'ongoing' | 'ended';
export type MatchEndReason =
  | 'domination'
  | 'elimination'
  | 'score'
  | 'timeout'
  /** PVE-4: the wave assault was survived and the enemy cleared — everyone still
   *  standing wins TOGETHER (`match.winners`), there is no single champion. */
  | 'pve-cleared'
  /** PVE-4: every human seat fell. The NPC is the formal winner. */
  | 'pve-failed';

export interface MatchScore {
  /** Map control: owned planet/sectors. */
  controlledPlanets: number;
  /** Standing fleets the player still commands. */
  fleets: number;
  /** Ships, carried ground troops and planetary garrisons. */
  units: number;
  /** Aggregate score used by score-limit and timeout victories. */
  total: number;
}

/** One row of the session-end reward table (SES-2 first slice, GDD §3.4). The
 *  core only REPORTS the table — crediting accounts (XP / meta-resources) is the
 *  server's job once the meta-economy lands (EC-*). */
export interface PlayerReward {
  /** Standing in the final score table — standard competition ranking (1224):
   *  equal totals share a place, the next place skips the tied count. */
  place: number;
  /** Account XP earned: participation + capped score share + win bonus, scaled
   *  by `GameData.rewards`. */
  xp: number;
}

export interface MatchState {
  status: MatchStatus;
  winner: PlayerId | null;
  /** Every winner of a coalition (alliance) score win, sorted (GDD §3.3). Present
   *  only when a coalition won together; `winner` then holds its top scorer. */
  winners?: PlayerId[];
  endedAt?: number;
  reason?: MatchEndReason;
  scores: Record<PlayerId, MatchScore>;
  /** Session-end reward table (GDD §3.4), written once when the match ends —
   *  every seated player gets a row (participation pays even in defeat). */
  rewards?: Record<PlayerId, PlayerReward>;
}

export interface Planet {
  id: PlanetId;
  /** Owning player, or null for a neutral / unclaimed sector. */
  owner: PlayerId | null;
  position: { x: number; y: number };
  /** Star lanes: ids of directly-connected planets. The map is this graph;
   *  fleets travel along lanes (GDD §1 — секторная структура, узлы-планеты). */
  links?: PlanetId[];
  /** Which pairs of neighbours connect THROUGH this sector (MAP-TRANSIT), projected
   *  from the map. Undefined = full interchange (every earlier sector, and most still):
   *  arrive by any lane, leave by any other. Present = these pairs are the only
   *  through-connections, so two lanes crossing this province do not meet and a fleet
   *  running one cannot switch to the other in passing. Read by `planRoute`; a fleet
   *  that STOPS here is not in transit, so its next order starts fresh. */
  transit?: Array<[PlanetId, PlanetId]>;
  /** Neighbours on the MOSAIC that terrain keeps SHUT (M4.3). They share a drawn border
   *  with this sector but carry no lane, so a fleet cannot cross — the border is a closed
   *  door, not an open one. Published here because the renderer must be able to draw the
   *  barrier without re-deriving the geometry (a second copy of the tessellation is
   *  exactly how the drawn map and the travelable map drifted apart in the first place).
   *  Symmetric: if `a` lists `b`, `b` lists `a`. Undefined = nothing sealed. */
  sealed?: PlanetId[];
  /** The roads inside this province (ROADS-1, `docs/roads-roadmap.md` §0.3): where each
   *  lane crosses the border and how the trails leaving the world fork towards the
   *  neighbours. Derived from the mosaic at map build, like `links` and `sealed`, so the
   *  server and every client read ONE network. Undefined = no road geometry (a state
   *  built before roads, or a province without lanes) — movement then runs the straight
   *  lane, the pre-road rule, instead of failing. */
  roads?: PlanetRoads;
  /** Sector terrain type id (resolved against game data `sectors`); its buffs
   *  /debuffs are applied through hooks. Undefined = plain space, no modifier. */
  terrain?: string;
  /** Sector kind id (planet / asteroid / nebula / empty …; resolved against game
   *  data `sectorKinds`) — decides capturable / buildable / orbit. Undefined
   *  degrades to the permissive defaults (see `sectorKindDef`). */
  kind?: string;
  /** Чем узел был ДО того, как его превратили в космическую крепость (`station.deploy`
   *  затирает `kind`). Гибель крепости возвращает узел к этому виду, иначе разрушенная
   *  крепость навсегда стирала бы то, что под ней стояло: астероидное поле не выдумать
   *  заново, когда вид уже перезаписан. Присутствует только у стоящей крепости и
   *  снимается вместе с ней; отсутствует у всех остальных узлов. */
  priorKind?: string;
  /** Relative size / weight of the sector (default 1). Drives how much territory
   *  it claims: a sector's border with a neighbour sits proportionally to their
   *  sizes, so resizing one shifts its neighbours' borders evenly. Undefined = 1. */
  size?: number;
  /** Planet type id — the world's nature (resolved against game data
   *  `planetTypes`); production/defense modifiers are applied through hooks.
   *  Undefined = generic world, no modifier. */
  planetType?: string;
  resources: ResourceBag;
  buildings: BuildingInstance[];
  garrison: UnitStack[];
  /** Sortie readiness of the world's port (SHU-1.2): `fuel` strikes left before the
   *  port must rearm, `rearming` hours left on that cooldown. Undefined = full.
   *
   *  Счётчик принадлежит ПОРТУ, а не отдельной машине: челноки в ангаре — стеки без
   *  своей личности (они сливаются по юниту и лоадауту), и завести топливо на стек
   *  значило бы запретить им сливаться вовсе. Игроку это ещё и понятнее: у порта одно
   *  читаемое состояние «готов / перезаряжается», а не N счётчиков. */
  sortie?: { fuel: number; rearming: number; carry?: number };
  /** ЭСКАДРЫ, базирующиеся в космопорте мира (SHU-1.1, форма — SHU-4.2). НЕ флот и НЕ
   *  часть гарнизона: челнок стоит внутри порта, на орбите не появляется и в наземной
   *  обороне мира не участвует. Вместимость — `shuttleBay` портов; потерян порт
   *  (снесён или захвачен) — потеряно и то, что в нём стояло.
   *  Undefined/пусто = здесь ничего не базируется. */
  hangar?: Squadron[];
  traits: TraitId[];
  /** Cancelled-mid-build construction/upgrade/unit orders, paused and resumable
   *  (see `PausedConstructionSite`). Undefined/empty = nothing paused here. */
  pausedConstruction?: PausedConstructionSite[];
  /** ПЛАЦДАРМ — чужие войска, высаженные на этот мир десантным челноком (ROS-1.5).
   *
   *  Это ВРЕМЕННАЯ сторона наземного боя, а не второй гарнизон: она живёт ровно пока
   *  идёт бой за мир. Выиграла — становится гарнизоном и берёт мир; проиграла —
   *  исчезает. Постоянных «чужих войск на моей земле» в модели нет, и заводить их
   *  этот кирпич не стал: одна планета — один хозяин.
   *
   *  Почему не `Fleet.landing`, как у высадки с флота: у вылета челноков флота нет
   *  вовсе, а `landing` адресуется id флота. Плацдарм — тот же десант, только его
   *  держит МИР, потому что держать больше некому.
   *
   *  Владелец здесь обязателен: без него после гибели последнего защитника было бы
   *  непонятно, кому достался мир.
   *
   *  MSB-4: это СПИСОК, а не одно поле — решение владельца §0.0 №3 «у каждого
   *  штурмующего свой плацдарм». Мир за одного хозяина по-прежнему дерётся один, но
   *  штурмовать его могут сразу несколько, и каждый держит свой берег. **Порядок в
   *  списке — это порядок ВЫСАДКИ**, и он значащий: по решению §0.0 №4 мир получает
   *  владелец самого раннего ВЫЖИВШЕГО плацдарма, то есть тот, кто начал штурм. Push в
   *  порядке действий детерминирован, поэтому «первый» — факт состояния, а не гонка.
   *  Не заводить сюда сортировку и не переставлять элементы.
   *
   *  Undefined или пустой список = плацдармов нет. */
  beachheads?: Array<{ owner: PlayerId; units: UnitStack[] }>;
  /** Orders waiting their turn on this world (BLD-1; see `QueuedConstruction`).
   *  Undefined/empty = nothing waiting. */
  buildQueue?: QueuedConstruction[];
}

/**
 * BLD-1. Заказ стройки, ЖДУЩИЙ своей очереди на мире.
 *
 * Мир строит по ОДНОЙ вещи в полосе (`buildings` — здание и апгрейд, `units` — юниты;
 * полосы независимы). Всё, что заказано сверх идущего, встаёт сюда и стартует само,
 * когда полоса освободится. До старта заказ НЕ ОПЛАЧЕН: деньги списываются в момент
 * старта, там же, где и проверяются, — поэтому отмена ждущего заказа это просто
 * удаление записи, без арифметики возврата (её ведёт `PausedConstructionSite` для уже
 * начатой стройки).
 *
 * `id` берётся из того же счётчика `scheduleSeq`, что раздаёт `seq` запланированным
 * событиям, поэтому номера двух пространств НЕ ПЕРЕСЕКАЮТСЯ: `construction.cancel`
 * принимает один `seq` и по нему однозначно находит либо идущую стройку, либо ждущий
 * заказ — игроку это одна и та же кнопка «отменить», а не две.
 *
 * Поля заказа повторяют полезную нагрузку `construction.complete` один в один: очередь
 * хранит САМ ПРИКАЗ, а не ссылку на что-то ещё, поэтому старт из очереди — это ровно
 * то же планирование, что и прямой заказ.
 */
export interface QueuedConstruction {
  /** Личность заказа — тем же номером его отменяют (см. выше про `scheduleSeq`). */
  id: number;
  kind: 'building' | 'upgrade' | 'unit';
  /** Кто заказал. Захват мира стирает очередь целиком, так что чужих записей тут не
   *  остаётся; поле держит ответ на «чьи это деньги списывать» явным. */
  playerId: PlayerId;
  building?: string;
  /** Целевой уровень — для `upgrade`. */
  level?: number;
  /** Экземпляр здания (RULES-2.1), когда `maxPerPlanet > 1`. */
  uid?: string;
  unit?: string;
  count?: number;
  modules?: string[];
  /** Наземный юнит внутри десантного челнока (SHU-5.2). */
  troop?: string;
}

export interface FleetMovement {
  /** Origin of the current leg. */
  from: PlanetId;
  /** Next hop (the planet this leg ends at). */
  to: PlanetId;
  /** Server-authoritative timestamps (ms). */
  departedAt: number;
  arrivesAt: number;
  /** Remaining hops after `to`, in order, ending at `destination`. */
  path?: PlanetId[];
  /** Final destination of the whole journey. */
  destination?: PlanetId;
  /** Fraction along (`from`,`to`) this leg STARTS at, in [0,1) (default 0). >0
   *  only on the first leg out of a mid-lane parked position — the fleet resumes
   *  partway down the road instead of from a node. */
  startT?: number;
  /** Fraction along (`from`,`to`) this (final) leg ENDS at, in (0,1] (default 1).
   *  <1 means the journey stops at a point ON the lane: on arrival the fleet
   *  parks (`edge`) at this fraction instead of reaching node `to`. */
  endT?: number;
  /** Journey-wide park fraction carried across hops: when the LAST leg fires it
   *  parks at `parkT` (becomes that leg's `endT`). Absent = arrive at a node. */
  parkT?: number;
}

/** A point of the road network, in world units. */
export interface RoadPoint {
  x: number;
  y: number;
}

/** One trail leaving a province's world (ROADS-1). */
export interface RoadTrail {
  /** Neighbours this trail leads to, in angular order around the world. */
  exits: PlanetId[];
  /** Where the trail splits towards its exits. Null when the trail runs straight (it
   *  serves one neighbour) or its exits lie so far apart that it runs through the world
   *  itself — a fork on top of the planet would be a fork in name only. */
  fork: RoadPoint | null;
}

/** A province's share of the road network (`Planet.roads`). */
export interface PlanetRoads {
  /** Where each lane crosses this province's border, keyed by the neighbour. The same
   *  point is stored on both sides of the border. */
  crossings: Record<PlanetId, RoadPoint>;
  /** The trails leaving the world; every neighbour with a lane is on exactly one. */
  trails: RoadTrail[];
}

/** A fleet parked at a continuous point ALONG a lane (it stopped mid-march, or
 *  marched to a point on the path — not a node). `t` ∈ (0,1) is the fraction
 *  from `from` to `to`. Mutually exclusive with `location`/`movement`: a fleet is
 *  either at a node, in transit, or parked on a lane. */
export interface FleetEdge {
  from: PlanetId;
  to: PlanetId;
  t: number;
}

/** The target of an interrupted march (`Fleet.resume`, ROADS-8) — the same two shapes a
 *  `fleet.move` aims at: a node, or a point on a lane. */
export type FleetResume = { to: PlanetId } | { toEdge: FleetEdge };

/** One ground lift in progress — see `Fleet.loading` (CARGO-1). A CLAIM, not custody:
 *  the units stay in the garrison until the hour is up, so nothing is ever in limbo. */
export interface LoadingClaim {
  unit: string;
  count: number;
  /** The world the units are lifted from. The lift only completes while the fleet is
   *  still docked THERE — flying away is how a player cancels it. */
  from: PlanetId;
  /** World-time (ms) the lift began — the client draws the filling pip from it. */
  startAt: number;
  /** World-time (ms) the lift finishes. */
  doneAt: number;
}

export interface Fleet {
  id: FleetId;
  owner: PlayerId;
  /** Current location, or null while in transit / parked on a lane. */
  location: PlanetId | null;
  movement: FleetMovement | null;
  /** Parked at a continuous point on a lane (stopped mid-march or marched to a
   *  point on the path). Set only while `location` and `movement` are both null. */
  edge?: FleetEdge | null;
  units: UnitStack[];
  /** Ground army carried as cargo (the landing force of a ground assault),
   *  bounded by the ships' transport capacity — see the `army` module. */
  landing?: UnitStack[];
  /** Ground lifts in progress (CARGO-1): a lift takes a game-hour, so the order
   *  lives HERE, in the world, instead of in a client's memory. The units are still
   *  in the world's garrison — they defend it, and no other order can draw them —
   *  but they are promised to this fleet and become `landing` when the hour is up.
   *  Absent/empty = nothing being winched aboard. */
  loading?: LoadingClaim[];
  /** Standing "merge into that fleet once we are together" (MRG-1). Set when
   *  `fleet.merge` is ordered while this fleet is already FLYING to the target's
   *  node: the order then waits in the world instead of in a client's memory, and
   *  the fuse happens on arrival even if nobody is watching. Cleared when it
   *  resolves — or when it cannot (target gone / moved on / not co-located). */
  mergeInto?: FleetId | null;
  /** ЭСКАДРЫ в трюме этого флота (SHU-2.1) — подвижный близнец `Planet.hangar`, и форма
   *  у них ОДНА (SHU-4.2). НЕ часть `units`: базирующийся челнок не корабль линии, он не
   *  стреляет в раунде боя и не принимает на себя залп, он только летает в вылеты. Трюм
   *  ОБЩИЙ с `landing` (SHU-5.1): Σ `cargoCapacity` корпусов, машина занимает свой
   *  `cargoSize`; погибли корпуса — погибло и то, что не влезает, ровно как при потере порта.
   *  Undefined/пусто = на борту ничего не базируется. */
  hangar?: Squadron[];
  /** Sortie budget of the shuttles based aboard (fuel + rearm countdown) — the
   *  fleet-side twin of `Planet.sortie`, and for the same reason: the counter belongs
   *  to the BASE, not to the machine, so stacks in the hangar stay mergeable. */
  sortie?: { fuel: number; rearming: number; carry?: number };
  /** Set (`'near'`) while the fleet is stationed in orbit at a planet; undefined while
   *  in transit. There is a SINGLE orbit (GDD §7.4): a stationed fleet can bombard /
   *  land and is exposed to the planet's orbital AA — no separate "far" safe standoff.
   *  (The value stays `'near'` for back-compat; the old near/far split was collapsed.) */
  orbit?: 'near';
  /** Whether the fleet is actively bombarding the planet below (in orbit over a
   *  hostile world). Damages structures and freezes the owner's production. */
  bombarding?: boolean;
  traits: TraitId[];
  /** Id of the battle this fleet is engaged in; absent/null when free to move. */
  battleId?: BattleId | null;
  /** World-time (ms) this fleet last took damage. Gates shield regen: shields stay
   *  down for a delay after the last hit (shields-roadmap SH-1.1). Absent = never hit. */
  lastDamagedAt?: number;
  /** World-time (ms) until which this fleet's travel speed is boosted after a
   *  `fleet.retreat` — the disengaging fleet flees faster while `now < it`. Absent =
   *  no boost. Read by the `fleet.speed` hook. */
  retreatHasteUntil?: number;
  /** Where a fleet a ROAD battle pulled off its march was heading (ROADS-8): the rest of
   *  its order, kept while it fights and resumed once the fight is over and the fleet is
   *  free. Set only while the fleet is in that battle — every way out of it consumes the
   *  field. Absent = the fleet stood still when the fight found it (an ambush, a parked
   *  fleet) or it was not a road battle. */
  resume?: FleetResume;
  // ЗДЕСЬ БЫЛИ `freePosition`/`freeMovement`/`homeBase` — свободный полёт «крыла как
  // флота» (SQ-1.1). Сняты в SHU-2.2 вместе с остальной старой машинерией: с SHU-1.1
  // челнок живёт в `Planet.hangar`/`Fleet.hangar` и в `Fleet.units` не попадает ниоткуда
  // (сторож — правило 5 в `shuttleHangar.test.ts`), поэтому полей никто не выставлял, а
  // читатели получали `undefined` и молча шли по ветке «обычный флот».
  /** Point-defense cooldown: world-time (ms) until which this fleet's PD system
   *  is recharging after a volley. Absent/0 = ready to fire. PD fires reactively
   *  when an enemy shuttle enters range, then cools down for 20 game-minutes. */
  pdCooldownUntil?: number;
}


/**
 * A combatant in a battle — the ship units of a fleet (orbital), the landing
 * troops a fleet carries (ground assault), the BEACHHEAD a shuttle drop put ashore
 * (ROS-1.5), or a planet's garrison (ground defense). One round engine drives all
 * four (GDD §7.3).
 */
export type CombatantRef =
  | { kind: 'fleet'; fleetId: FleetId }
  | { kind: 'landing'; fleetId: FleetId }
  /** MSB-4: ВЛАДЕЛЕЦ входит в ссылку. Пока плацдарм был один, мира хватало, чтобы его
   *  назвать; с несколькими десантами на одном мире ссылка без владельца адресовала бы
   *  их всех разом — стороны боя схлопнулись бы в одну, и совместный штурм считался бы
   *  как одиночный. */
  | { kind: 'beachhead'; planetId: PlanetId; owner: PlayerId }
  | { kind: 'garrison'; planetId: PlanetId };

export interface BattleSide {
  ref: CombatantRef;
  /** Owner of this side (for victory / planet ownership). */
  owner: PlayerId | null;
  /** MSB-1: which stat this side fires with — an ATTACKER strikes with `attack`, a
   *  DEFENDER answers with `defense` only. The role belongs to the SIDE, not to the
   *  pair: once a battle can hold five participants, four of them may be attacking at
   *  once and «attacker ↔ defender» stops describing the battle as a whole. */
  role: 'attacker' | 'defender';
}

/**
 * An ongoing battle — a stateful entity that resolves over real hours, one
 * round per `combat.tick` (GDD §7). Capturing a planet is two sequential
 * battles: `orbital` (fleet vs fleet) then `ground` (landing vs garrison) — §7.4.
 */
export interface Battle {
  id: BattleId;
  /** Contested planet where the engagement happens. */
  location: PlanetId;
  phase: 'orbital' | 'ground';
  /** MSB-1: the sides, in JOIN ORDER. A list, not two named fields — `{ attacker,
   *  defender }` expressed exactly two and could not physically hold a third. Today
   *  every battle carries exactly two entries and behaves as before; the rules that
   *  USE a longer list (damage split, joining a running battle, joint assault) are
   *  MSB-2/3/4. Read roles via `state/battle.ts`, never by index: the order here is
   *  join order, which MSB-4 reads to decide whose world a joint assault takes. */
  sides: BattleSide[];
  /** Rounds resolved so far. */
  round: number;
  /** Server time (ms) the next hourly round fires — the live battle timer the
   *  client counts down to. Set whenever a round is scheduled. */
  nextRoundAt?: number;
}

/**
 * A future occurrence on the world timeline: fleet arrival, construction
 * complete, a recurring combat tick, a dark event, ... The game is real-time
 * (continuous wall-clock time, like the Bytro titles), so durations are
 * expressed by scheduling an event at a future `at` and letting `advanceTo`
 * fire it when the world reaches that instant (docs/architecture.md §4.1).
 *
 * The schedule lives inside the state so it is serializable, deterministic and
 * survives a server restart (the server also mirrors it as delayed jobs to know
 * *when to wake up*, but the source of truth is here).
 */
export interface ScheduledEvent {
  /** Stable id, e.g. `evt:42`. */
  id: string;
  /** When it fires (ms, server-authoritative). */
  at: number;
  /** Domain event type dispatched to module subscribers when it fires. */
  type: string;
  /** Event payload. */
  payload: unknown;
  /** Deterministic tiebreaker among events sharing the same `at`. */
  seq: number;
}

/**
 * Versions pinned to a match. Rules and the active module set are frozen per
 * match (docs/architecture.md §4.4, docs/modulesystem.md) — in-flight matches
 * keep their original rules, integrity-relevant for OWASP A08.
 */
export interface GameVersion {
  /** Game-data (JSON content) version. */
  data: string;
  /** Module-manifest version. */
  manifest: string;
  /** MP-4: content-integrity fingerprint of the game-data bundle this match was
   *  created with (`hashGameDataBundle`, `data/loadGameData.ts`) — deterministic,
   *  non-cryptographic. Stamped once at creation and persisted verbatim; a match
   *  LOADER re-hashes the currently-deployed bundle and refuses to resume on a
   *  mismatch ("подмена бандла меняет правила"). Optional: snapshots persisted
   *  before this field existed carry none and skip the check (graceful
   *  degradation, not a crash — matches the module system's own discipline). */
  dataHash?: string;
}

export interface GameState {
  /** Authored map identity, persisted and public; absent on legacy saves. */
  mapId?: string;
  /** Game mode the match was created with (`data.modes`), pinned at birth like the map
   *  and persisted for the same reason: the snapshot is the ONLY thing that survives a
   *  restart, and a mode that lived solely in the host's `MatchConfig` would evaporate
   *  with the process — the room would come back applying base rules while the state
   *  still carries `pve` progress. That is exactly the "rules changed under the match"
   *  failure `resolveMatchConfig` refuses for an unknown mode (BRW-0).
   *
   *  The reducer never reads this field: rules come from `ctx.config.modeId`, resolved
   *  once at room construction. It is the persisted ORIGIN of that config, and the
   *  match browser's `modeId` — so there is one source, not two. Absent on matches
   *  created before modes existed, and on any match deliberately run without one. */
  modeId?: string;
  /** Радиусы зрения этого матча (решение владельца 2026-09-24: «круги везде», «единый
   *  радиус; для Sector Zero — свой по цифрам»). Приходят из режима (`data.modes[id].sight`)
   *  на первом шаге часов и дальше не меняются — как `pve`: правка баланса не переписывает
   *  идущий матч. Нет поля ⇒ общие числа ядра (`DEFAULT_SIGHT`, `state/visibility.ts`). */
  sight?: SightRules;
  /** Дерево технологий этого матча (PVR-6.17): свои правила режима
   *  (`data.modes[id].technology`), закреплённые на первом шаге часов — как `sight`. Нет
   *  поля ⇒ дерево сетевого матча (`DEFAULT_TECH_RULES`, `modules/technology.ts`). */
  techRules?: TechRules;
  version: GameVersion;
  /** Current simulation time (ms), server-authoritative. */
  time: number;
  /** World time (ms) at which the match began — the anchor for "session day N"
   *  gates (e.g. a technology's `dayGate`). Set to the initial `time` at creation;
   *  the match's elapsed day count is `(time − startedAt) / MS_PER_DAY`, the same
   *  formula the match browser shows (matchRegistry). Optional: matches persisted
   *  before this field existed read as 0 — correct for the 0-based world clock, and
   *  all such nodes are ungated (dayGate 0) anyway. */
  startedAt?: number;
  /** Terminal match state and the latest scoreboard. */
  match: MatchState;
  rng: RngState;
  players: Record<PlayerId, Player>;
  planets: Record<PlanetId, Planet>;
  fleets: Record<FleetId, Fleet>;
  battles: Record<BattleId, Battle>;
  /** Monotonic counter handing each battle its id. */
  battleSeq: number;
  /** EVT-2, owned by `salvageModule`: per-node value of what died in the battle running
   *  there, waiting to be claimed by its winners, plus (for the rest of one drain) who
   *  those winners were — `station.destroyed` arrives after `battle.resolved` and needs
   *  an address. It lives in the state because a battle spans many steps while events
   *  drain within one; `visibleState` strips it, since it names losses on nodes a viewer
   *  may not see. Absent = nothing is being fought over. */
  salvage?: Record<PlanetId, { pool: Record<string, number>; winners?: PlayerId[] }>;
  /** Челночные удары в полёте (SHU-1.2). Пусто/отсутствует = никто никуда не летит. */
  strikes?: ShuttleStrike[];
  /** Monotonic counter handing each strike its id — детерминированный, как `battleSeq`. */
  strikeSeq?: number;
  /** Monotonic counter handing each SQUADRON its id (SHU-4.2) — той же природы, что
   *  `battleSeq`/`strikeSeq`: id обязан быть выводим одинаково на сервере и в реплее, а
   *  `Math.random` в ядре запрещён. */
  squadronSeq?: number;
  /** Pending timeline, processed in (at, seq) order by `advanceTo`. */
  scheduled: ScheduledEvent[];
  /** Monotonic counter handing each scheduled event its deterministic `seq`. */
  scheduleSeq: number;
  /** Per-player fog-of-war memory (variant B): the last identified snapshot of
   *  each seen world. Maintained by `visibilityModule`; read by `visibleState`
   *  to show greyed "last known" worlds. Internal — stripped from projections. */
  fog?: Record<PlayerId, FogMemory>;
  /** Per-observer last identified Swarm fleet composition; persists with this match. */
  swarmIntel?: Record<PlayerId, Record<FleetId, SwarmContact>>;
  /** Hero instances, keyed by instance id (`Hero.id`), maintained by `heroModule`.
   *  A player may field several — filter by `owner`. (Key was the `PlayerId` in the
   *  one-hero-per-player skeleton; instance-keyed since the roster migration.) */
  heroes?: Record<string, Hero>;
  /** Active temporary lanes opened by hero abilities — real graph edges for their
   *  duration (added to `Planet.links`), with a per-owner speed bonus. */
  tempLanes?: TempLane[];
  /** Topology version — bumped whenever `Planet.links` change (a temp lane opens or
   *  expires) so the movement route cache can invalidate. */
  topology?: number;
  /** Monotonic counter handing each temp lane its id. */
  heroSeq?: number;
  /** Pairwise diplomatic stances between players, keyed by a canonical unordered
   *  pair key (`pairKey`). Symmetric and PUBLIC (not fog-gated — who is at war /
   *  allied is open knowledge). A pair with no entry defaults to `DEFAULT_STANCE`
   *  (war), so absence = the engine's no-diplomacy FFA. Read/written through
   *  `state/diplomacy.ts`; `diplomacyModule` (D2) owns the actions and exposes it
   *  as the `diplomacy` capability that drives combat's `isHostile`. */
  diplomacy?: Record<string, DiplomaticStance>;
  /** Standing DE-ESCALATION offers (D3), keyed by the directed `offerKey`
   *  (`from>to`) → the friendlier stance offered. An offer is recorded by a
   *  friendly `diplomacy.declare` and commits when the other side declares the
   *  same stance (mutual consent); any escalation between the pair voids both
   *  directions. Unlike `diplomacy`, offers are PRIVATE to the two parties —
   *  `visibleState` strips everyone else's negotiations. Maintained by
   *  `diplomacyModule`; helpers in `state/diplomacy.ts`. */
  diplomacyOffers?: Record<string, DiplomaticStance>;
  /** MAPSHARE-1. Договоры об ОБМЕНЕ КАРТАМИ, ключ — симметричный `pairKey`.
   *
   *  Это НЕ ступень дипломатической лестницы, а отдельное соглашение поверх неё:
   *  лестница `war→peace→pact→alliance` линейна и задаёт враждебность, а обмен
   *  картами ортогонален — его заключают и при мире, и при пакте, и он не делает
   *  участников союзниками. Даёт ровно два права: делится разведкой (`coverageFor`
   *  пулит покрытие так же, как по `alliance`) и пускает чужой десант на свою землю
   *  (`army.unload`). НЕ даёт: союзного отношения в бою (`stanceToRelation` не
   *  трогается) и места в коалиции для победы (`victory.ts` считает только
   *  взаимно-союзные клики).
   *
   *  Заключается по взаимному согласию (тот же consent-протокол, что у смягчения
   *  стойки), расторгается односторонне и рвётся сам при объявлении войны. Симметричен
   *  и ПУБЛИЧЕН, как `diplomacy`: кто с кем делится картой — не тайна. */
  mapShares?: Record<string, true>;
  /** Стоящие ПРЕДЛОЖЕНИЯ обмена картами, ключ — направленный `offerKey` (`from>to`).
   *  Приватны для двух сторон, как `diplomacyOffers` — `visibleState` вырезает чужие
   *  переговоры. */
  mapShareOffers?: Record<string, true>;
  /** Stolen intel windows per beneficiary (`espionageModule`). PRIVATE: a viewer's
   *  projection carries only their own grants — who spies on whom is never public. */
  intel?: Record<PlayerId, IntelGrant[]>;
  /** Session resource market: a public per-match order book maintained by
   *  `marketModule`. Sellers escrow a resource at a price; buyers pay money. */
  market?: MarketOrder[];
  /** Monotonic counter handing each market order its id. */
  marketSeq?: number;
  /** A player's designated capital world (`capitalModule`, `capital.designate`) — the
   *  hero respawn anchor (`heroModule` falls back to `[hero.home, hero.location]`).
   *  Absent for a player who never (re-)designated ⇒ their heroes' `home` is whatever
   *  was seeded at match start (usually the homeworld); designating updates both this
   *  map AND every owned hero's `home` in one action. */
  capital?: Record<PlayerId, PlanetId>;
  /** CC-2 auto-storm: fleet ids with "auto-assault when idle at a hostile world"
   *  armed (`standingOrdersModule`, `order.auto`). A driver reads this; the module
   *  itself only stores the flag and garbage-collects it for dead fleets. */
  autoAssault?: Record<FleetId, true>;
  /** RETR-2, владелец `standingOrdersModule`: авто-отступление. `at` — доля ОСТАВШЕГОСЯ
   *  корпуса от максимального (решение владельца: 0.2/0.3/0.4/0.5), `to` — узел, куда
   *  уходить. Приказ, а не состояние боя: живёт, пока игрок его не снял, и убирается
   *  вместе с погибшим флотом. Туманом фильтруется как остальные стоячие приказы —
   *  будущее намерение видит только хозяин флота. */
  autoRetreat?: Record<FleetId, { at: number; to: PlanetId }>;
  /** CC-4 дежурный вылет: БАЗЫ (мир с портом или носитель), которым разрешено самим
   *  поднимать эскадру навстречу опознанному врагу поблизости. Ключ — id базы, значение
   *  называет, в каком пространстве имён этот id живёт.
   *
   *  Это ФЛАГ и только флаг — согласие игрока, а не правило. Центр берётся живой
   *  (позиция базы сейчас: порт не двигается, а ушедший носитель обязан прикрывать себя
   *  ТАМ, где он теперь), радиус — `squadronReach` эскадры, которая полетит, топливо и
   *  перезарядка принадлежат БАЗЕ (SHU-1.2) и тратятся тем же `shuttle.strike`. До
   *  SHU-2.2 здесь лежал снимок центра, радиуса и СВОЕГО запаса топлива — это осталось
   *  от модели «крыло как флот», где дежурило подвижное соединение со своим баком. */
  patrols?: Record<string, { kind: 'planet' | 'fleet' }>;
  /** CC-1 order chains: a fleet's queued plan (`standingOrdersModule`, `order.chain`
   *  sets/replaces it; `chain.stamp` is the server driver's own runtime update of
   *  the consumed head / armed wait deadline — never client-issuable). */
  orders?: Record<FleetId, FleetChain>;
  /** BOOST-1 форс-марш: fleet ids currently marching at +50% speed for 5% max-hp
   *  wear per game-hour in transit (`forcedMarchModule`, `fleet.forcemarch`). */
  forcedMarch?: Record<FleetId, true>;
  /** PVE-3: the wave counter of a PvE match (`pveModule`). Present only once the
   *  module has recognised the match as PvE (its mode carries a `pve` section) AND
   *  found the NPC seat; absent everywhere else, so a PvP match carries no trace of
   *  the mechanic. The next wave's time lives in `scheduled`, like every other future
   *  occurrence — `nextWaveAt` is a READ-ONLY echo for the HUD, never the source of
   *  truth about when the wave fires. */
  pve?: PveState;
  /** PVR-4.2: память Роя — что против него ФАКТИЧЕСКИ применили в завершённых
   *  столкновениях. Появляется только с первым зачтённым наблюдением, поэтому матч
   *  без Роя (и забег, в котором его ещё ни разу не задели) следов механики не несёт.
   *  Здесь лежат только ФАКТЫ симуляции — реплеируемые и сериализуемые; насколько
   *  далеко Рой смотрит назад, решает не состояние, а драйвер (см. `swarmMemory.ts`). */
  swarmMemory?: SwarmMemory;
  /** PVR-4.3: идущие проекты развития модулей Роя. По одному на часть сети (решение
   *  владельца 2026-09-24: отрезанная часть учится сама); без сети — один на весь Рой
   *  (§3.4: один запас нельзя потратить дважды). Отсутствует, пока Рой ничего не растит.
   *  Форма описана в `modules/swarmAdapt.ts`. */
  swarmAdapts?: SwarmAdaptProject[];
  /** AUD-20: рецепты Роя — до какого уровня он умеет растить модуль-ответ. Пишется по
   *  завершении проекта и штампуется на новые формы (волны). Живёт отдельно от стеков:
   *  погибли все матки с покровом — знание «как его растить» остаётся. Снимается с
   *  клиентской проекции вместе с проектом: рецепт — разведка, которой не было. */
  swarmRecipes?: Record<string, number>;
  /** Сеть Роя (`swarmNetModule`, `docs/swarm-behavior.md`): что знает каждый держатель —
   *  центр данных, флот, мир. Знание течёт только по связи, разрыв сети не стирает
   *  полученного. Снимается с клиентской проекции: это память Роя, а не разведка игрока. */
  swarmNet?: SwarmNetState;
  /** PVR-4.5: журнал адаптаций — что об ответах Роя знает КАЖДЫЙ ИГРОК. Пишется из
   *  того, что игрок наблюдал лично (его удар отражён), и фильтруется по зрителю тем
   *  же швом, что `swarmIntel`. Память самого Роя лежит отдельно и клиенту не уходит
   *  вовсе: журнал — это знание игрока, а не подсмотренная правда. */
  swarmJournal?: Record<PlayerId, SwarmRepelRecord>;
  /** Факты для задач забега (`missionFactsModule`): кто и с какого момента держит
   *  провинцию, какие миры игрок терял, сколько беженцев доставил. Задачи — чистые
   *  предикаты над состоянием, а «N часов подряд» и «гарнизон уже пал» из одного кадра
   *  не прочесть: нужна память. Здесь только ФАКТЫ, без знания о конкретных задачах. */
  missionFacts?: MissionFacts;
}

/** Память фактов для задач забега (`missionFactsModule`). */
export interface MissionFacts {
  /** Провинция → кто её держит и с какого момента (ставится на каждом захвате). Нет
   *  записи — провинция не переходила из рук в руки с начала матча. */
  held?: Record<PlanetId, { owner: PlayerId; since: number }>;
  /** Провинция → игрок → самая длинная ЗАВЕРШЁННАЯ серия удержания (мс). «Держал N
   *  часов подряд» не отменяется потерей после: серия уже состоялась. */
  longest?: Record<PlanetId, Record<PlayerId, number>>;
  /** Игрок → провинции, которые он терял (захват у него). Только растёт. */
  fallen?: Record<PlayerId, PlanetId[]>;
  /** Игрок → сколько беженцев (юниты с признаком `evacuee`) доставлено в убежище. */
  evacuated?: Record<PlayerId, number>;
}

/**
 * Что игрок лично видел про перехват Роя (PVR-4.5).
 *
 * Первое и последнее наблюдение хранятся ОБА, потому что из них строится единственная
 * честная гипотеза: «перехват стал сильнее» — это сравнение двух собственных замеров
 * игрока, а не взгляд в уровень модуля. Уровень игроку не показывается никогда: §3.9
 * говорит, что он узнаёт об адаптации по её проявлению, а не по счётчику.
 */
export interface SwarmRepelRecord {
  firstAt: number;
  lastAt: number;
  /** Сколько вылетов игрока Рой отразил. */
  sorties: number;
  /** Урон ПВО в первом и последнем отражении — основа гипотезы об усилении. */
  firstDamage: number;
  lastDamage: number;
  /** Сильнейшее отражение, которое игрок видел. */
  maxDamage?: number;
  /** Сколько раз, уже увидев сильный перехват, игрок встречал отряд Роя, отвечающий в разы
   *  слабее, — отряд, похоже, отрезан от сети и воюет по старой памяти. */
  stale?: number;
}

/**
 * Одно наблюдение Роя: в столкновении `engagement` против него применили класс `kind`,
 * и это дало измеримый эффект (`sector-zero-roadmap.md` §3.9).
 *
 * `ordinal` — порядковый номер столкновения в забеге, а не время. Окно памяти считается
 * в столкновениях («последние 4 боя»), и хранить для этого игровые часы значило бы
 * пересчитывать окно при каждой смене темпа забега.
 */
export interface SwarmObservation {
  ordinal: number;
  /** Класс применённого оружия. Строка, а не enum: классы добавляются данными и
   *  механиками (v1 — только `strike`, ударный вылет), и закрытый союз пришлось бы
   *  расширять в ядре ради каждого нового. */
  kind: string;
  /** Идентификатор столкновения. Защита от повторной телеметрии: одно столкновение
   *  даёт классу не больше одного наблюдения, сколько бы попаданий в нём ни было. */
  engagement: string;
}

/**
 * Идущий проект развития модуля Роя (`swarmAdaptModule`, PVR-4.3).
 *
 * По одному на часть сети Роя (без сети — один на весь Рой). Срок дублирует
 * запланированное событие и нужен журналу — источник правды о времени по-прежнему
 * `scheduled`, как у волн.
 */
export interface SwarmAdaptProject {
  /** Стабильный id проекта: по нему отложенный срок находит СВОЙ проект, когда их
   *  несколько (по одному на часть сети). */
  id: string;
  moduleId: string;
  /** Уровень, который проект ДАСТ (1 — первый шаг лестницы модуля). */
  level: number;
  /** Флот-носитель с камерой вывода: его гибель проект прекращает. */
  fleetId: string;
  dueAt: number;
}

/** Сеть Роя (`swarmNetModule`): знание держателей. Ключ — `planet:<id>` / `fleet:<id>`. */
export interface SwarmNetState {
  holders: Record<string, SwarmKnowledge>;
  /** Миры NPC, которые хоть раз были на связи с ульем (`PveState.home`). */
  linked?: PlanetId[];
  /** Миры NPC, отрезанные от улья ПОСЛЕ того, как были с ним на связи: разрыв сети — это
   *  событие, починка его не отменяет. Отсюда задача «Разорвать сеть». */
  cut?: PlanetId[];
}

/** Что знает один держатель сети Роя. */
export interface SwarmKnowledge {
  /** Номера столкновений (`SwarmObservation.ordinal`), о которых держатель знает, по
   *  возрастанию. Номер, а не id столкновения: знание копируется каждому держателю части,
   *  и число вместо строки держит снапшот коротким. */
  known: number[];
  /** Рецепты: модуль → уровень, который держатель умеет растить. */
  recipes?: Record<string, number>;
}

/** Память Роя внутри одного забега (`swarmMemoryModule`, PVR-4.2). */
export interface SwarmMemory {
  /** Сколько столкновений Рой уже зачёл. Монотонный счётчик — он же выдаёт `ordinal`. */
  engagements: number;
  /** Наблюдения в порядке появления. Порядок детерминирован: наблюдение добавляется
   *  в обработчике события, а события ядро доставляет в фиксированном порядке. */
  observations: SwarmObservation[];
}

/** PvE wave progress (`pveModule`, docs/pve-team-modes-roadmap.md Фаза 3). */
export interface PveState {
  /** Waves that have already landed. 0 until the first one fires. */
  waveNumber: number;
  /** Waves this match must survive, copied from the mode's `pve.waves` at seed —
   *  the match keeps running under the rules it started with even if content changes. */
  totalWaves: number;
  /** The seat the NPC enemy plays (resolved once, by the mode's `npcFaction`). */
  npcPlayerId: PlayerId;
  /** Улей: мир, где волна рождалась на посеве. Волны рождаются здесь, пока мир в руках
   *  NPC; потерян — по прежнему правилу (наименьший id). Без этого Рой, занявший пустой
   *  мир с меньшим id, переносил роды волн к нему — у главы I это был мир в двух шагах от
   *  дома игрока. Отсутствует у матчей, посеянных до поля: там прежнее правило. */
  home?: PlanetId;
  /** World time the next wave is due — an echo of the scheduled event, for the HUD.
   *  Absent once the last wave has landed. */
  nextWaveAt?: number;
  /** Unspent boon picks per human seat (PVR-1.4): a wave that LANDS while you still
   *  hold ground owes you one choice. Per seat rather than one shared counter because
   *  co-op PvE seats each survive for themselves — a shared number would let one
   *  player spend the other's pick. Absent/0 = nothing owed. */
  boons?: Record<PlayerId, number>;
  /** Сколько пакетов снабжения каждое место уже купило в этом забеге (`pve.supply`, решение
   *  владельца 2026-09-24): лимит — на забег, поэтому счёт живёт в матче, а не в профиле. */
  supplies?: Record<PlayerId, number>;
  /** World time the match counts as CLEARED if a human seat still holds a world — set
   *  when the last wave lands, the mode's `holdHours` later (PVR-2.5). Absent until then,
   *  and absent for good under a mode without `holdHours`: there the only clear is taking
   *  every NPC world. Echoed here for the HUD's «hold out» countdown as well. */
  holdUntil?: number;
  /** Боевой счёт каждого места за забег (PVR-6.20, окно итогов экспедиции): сколько СВОИХ
   *  юнитов и машин оно потеряло и сколько чужих уничтожило. Павшие засчитываются тому,
   *  чей огонь их добил (`unit.died.killedBy`, стрелок сбитых машин). Только места игроков:
   *  Рой, пираты и нейтралы счёта не ведут. Нет записи — ноль. */
  tally?: Record<PlayerId, PveTally>;
  /** The assault's boss once it is on the field (PVR-4.7): its hero, the bounty the mode
   *  declared for it — stamped at spawn, like every other number a match keeps once it
   *  started — and when it fell. Absent until the boss spawns, and for good in a match the
   *  host sent no boss to. */
  boss?: PveBoss;
}

/** Строка боевого счёта одного места (см. {@link PveState.tally}). */
export interface PveTally {
  /** Своих юнитов и машин погибло. */
  lost: number;
  /** Чужих юнитов и машин уничтожено его огнём. */
  destroyed: number;
}

/** The PvE boss on the field (`PveState.boss`). Its ship is found through its hero
 *  (`heroes[heroId].fleetId`), never stored here: the seat's AI merges the wave into the
 *  boss's fleet or the boss into the wave's, and a copied fleet id would go stale. */
export interface PveBoss {
  heroId: string;
  /** The mode's `boss.hero` archetype. */
  hero: string;
  spawnedAt: number;
  /** Bounty for slaying it (`data.modes[].pve.boss.reward`); the host decides what it pays in. */
  reward: number;
  /** World time it fell; absent while it lives. */
  slainAt?: number;
}

/** Which side of the book a standing order sits on (CONV-9). */
export type MarketSide = 'sell' | 'buy';

/** A standing order on the session market. Both sides ESCROW up front, so nothing
 *  on the book can be double-spent:
 *
 *   - `sell` — the owner escrowed `amount` of `resource` and wants credits for it;
 *   - `buy`  — the owner escrowed `amount × price` credits and wants the goods.
 *
 *  Filled (partially) by `market.take`; the remainder is refunded on cancel. The
 *  book used to be sell-only here and two-sided in the prototype's copy — CONV-9
 *  merged them, taking the richer shape. */
export interface MarketOrder {
  id: string;
  side: MarketSide;
  /** Who placed it and whose escrow is held (was `seller` while the book was sell-only). */
  owner: PlayerId;
  resource: ResourceId;
  /** Remaining units on offer (escrowed). */
  amount: number;
  /** Price per unit, in money (`credits`). */
  price: number;
}

/** A player's hero — a per-player entity with a position on the map and ability
 *  cooldowns. Acts from its current node (`location`); a reserve hero is raised where the
 *  player chooses with `hero.spawn` (the legacy `hero.move` is gone, AUD-18). */
export interface Hero {
  /** Instance id — the key under which this hero lives in `GameState.heroes`.
   *  Identifies the hero across events (death/respawn) independently of `owner`. */
  id: string;
  owner: PlayerId;
  /** SEAT identity of a main hero — the callsign the player signed in with, or the
   *  house id of the seat in a solo match. Written only where a seat exists (the
   *  prototype's `matchSetup`); a roster hero carries none.
   *
   *  NOT a display name (AUD-13): human-readable text must never be stored in
   *  `GameState`, because the state is shared by every player while the locale is
   *  per-viewer — anything written here reaches the screen untranslated. A hero's
   *  NAME is built by the renderer from `archetype` (→ `data.heroes[a].name`);
   *  what lives here is an identity that has no translation (a nick) or that the
   *  renderer localises by key (a house). */
  name?: string;
  /** The node the hero currently occupies / respawns at (abilities act from here,
   *  the projection hero returns here after dying). */
  location: PlanetId;
  /** Per-ability `readyAt` timestamp (ms): the ability is on cooldown while now < it.
   *  The projection hero's death timer lives under the `respawn` key. */
  cooldowns: Record<string, number>;
  /** False while the hero is dead and awaiting respawn; absent/true ⇒ alive. */
  alive?: boolean;
  /** Rarity tier (e.g. `common` | `rare` | `legendary` | `main`) → `data.heroGrades`.
   *  Drives BOTH of the hero's budgets, and the core enforces them: how many abilities
   *  may be worn (`skillSlots`, HPR-1.2) and the bonus module bays on top of the hull
   *  (`moduleSlots`, HPR-1.5.2 — the main hero's extra bay). Unknown/absent ⇒ base
   *  defaults, never a crash. */
  grade?: string;
  /** Ability "modules" the hero OWNS — the pool it may equip from. Filled by the
   *  archetype's `startAbilities` and by skill-tree / fitting grants. Owning is not
   *  wearing: what the hero can actually CAST is {@link Hero.equipped}. */
  abilities?: (string | null)[];
  /** Ability ids currently IN SLOTS, bounded by the hero's skill-slot budget
   *  (`heroSkillSlots` — the rarity's `skillSlots`, HPR-1.2). Moved in and out by
   *  `hero.equip` / `hero.unequip`.
   *
   *  ABSENT ⇒ legacy loadout: everything owned counts as worn. That fallback is what
   *  keeps old matches and replays working — before this field the two concepts were
   *  one, and a saved hero has no way to say which of its abilities were "worn". A
   *  legacy hero over its budget is grandfathered: it keeps casting what it has, and
   *  the budget only bites when the player adds something new. */
  equipped?: string[];
  /** Active passive ids (→ `data.heroPassives`, HERO-5): always-on hook contributions
   *  while the hero is alive. Copied from the archetype's `startPassives` at seed. */
  passives?: string[];
  /** The archetype this hero instantiates (→ `data.heroes`, HERO-3): resolves the ship
   *  unit its fleet forms with on spawn/respawn. Absent ⇒ the default `hero` unit. */
  archetype?: string;
  /** Unlocked skill-tree node ids (→ `data.heroSkillTrees`, HERO-7). Grants applied on
   *  unlock land in `abilities`/`passives`; the list itself gates `requires` chains. */
  skills?: string[];
  /** Installed ship MODULES of the hero's ship (→ `data.modules`, HPR-1.5.2) — the same
   *  hardware every other hull carries, bounded by the hull's typed bays plus the grade's
   *  `moduleSlots` bonus (the main hero's extra bay). Stored on the HERO, not on the stack:
   *  death destroys the fleet and the stack, and a flagship that came back stripped after a
   *  game-day of downtime would be impossible to explain. `deployHero` stamps this list
   *  onto the ship it forms. Absent/empty ⇒ a bare hull, exactly as before. */
  modules?: ModuleId[];
  /** Respawn anchor — the owner's capital. A slain hero re-forms here if still held;
   *  absent ⇒ the core falls back to the hero's last node, then any owned world. */
  home?: PlanetId;
  /** The fleet this hero commands (its ship) while deployed; cleared on death. Lets a
   *  death be attributed to the right hero when several share an owner. */
  fleetId?: FleetId;
  /** Active time-boxed combat auras cast via `hero.effect.aura` (rally/bulwark) — each
   *  adds `bonus` to the `combat.damage` of the owner's fleets within `radius` of the
   *  hero's node until `until` (ms). Filtered by `until` at read time; pruned on cast. */
  activeAuras?: { bonus: number; radius: number; until: number }[];
  /** Active time-boxed fog reveals cast via `hero.effect.reveal` (scan) — each lifts the
   *  fog to full-identify detail for every world within `radius` of `center` until `until`
   *  (ms), but only in the OWNER's own visibility projection. Filtered by `until` at read
   *  time; pruned on cast.
   *
   *  PSI-LADDER. The scan's upper steps turn the same lit zone into a combat zone, so a
   *  reveal also carries what it does to a battle fought inside it. Both are stamped AT
   *  CAST from the hero's own ability step (`abilityParams`), never re-read from the
   *  catalogue afterwards: a live scan keeps the numbers it was cast with, exactly like
   *  `activeAuras.bonus`. Absent ⇒ the pre-ladder scan, which only lifts fog.
   *  · `weakPoints` — extra damage taken by fleets HOSTILE to the owner (`psi_weak_points`);
   *  · `evasion` — incoming damage divided for the owner's and its ALLIES' fleets
   *    (`psi_evasion`). Everyone else (neutral, at peace, in a pact) is untouched. */
  activeReveals?: {
    center: PlanetId;
    radius: number;
    until: number;
    weakPoints?: number;
    evasion?: number;
  }[];
  /** Active phantom radar contacts planted via `hero.effect.decoy` — each makes `at`
   *  read as an occupied node to EVERY viewer but the owner, until `until` (ms).
   *
   *  A decoy is deliberately NOT a fleet. An empty fleet would join battles, capture
   *  planets and count toward victory (`fleetOps` rejects ghost battles for exactly this
   *  reason); a phantom must change what rivals SEE and nothing else. So it lives here,
   *  in state, and is mixed into `signatures` inside `visibleState` — the per-viewer
   *  projection — which is why the simulation cannot tell a decoy exists at all.
   *
   *  `signature` is the same scale a real fleet radiates (Σ count × unit signature), so
   *  the reader buckets it into S/M/L with the identical rule and nothing new is
   *  invented for fakes. Filtered by `until` at read time; pruned on cast. */
  activeDecoys?: { at: PlanetId; signature: number; until: number }[];
  /** A running «Devour World» siege (`devour`, PVR-4.7). Absent ⇒ no siege. See
   *  {@link HeroSiege} for what ends it early. */
  siege?: HeroSiege;
}

/** A world under a hero's «Devour World» siege (PVR-4.7; owner's resolution 2026-09-25:
 *  «Поглощение после 4 ч осады»). The world dies at `until` only if the hero's fleet has
 *  bombarded it the whole time. Anything that interrupts the bombardment ends the siege
 *  early: a battle involving the hero's fleet, the fleet leaving orbit or ceasing fire,
 *  the hero's death, or the world changing hands. */
export interface HeroSiege {
  target: PlanetId;
  /** Owner of `target` when the siege began: a world that has since changed hands is no
   *  longer the world under siege. */
  victim: PlayerId;
  since: number;
  until: number;
}

/** A temporary lane a hero opened: a real, routable graph edge between two nodes for
 *  a limited time, granting the owner's fleets a speed bonus along it. */
export interface TempLane {
  id: string;
  owner: PlayerId;
  from: PlanetId;
  to: PlanetId;
  /** Speed multiplier bonus for the owner's fleets traversing this lane (e.g. 0.5). */
  speedBonus: number;
  /** Simulation time (ms) the lane closes. */
  expiresAt: number;
  /** Whether the lane ADDED the `links` edge (vs the nodes were already linked) — so
   *  expiry only removes a link the lane itself created. */
  addedLink: boolean;
  /** HERO-CORRIDOR — ступень способности, она же ПРАВО ПРОХОДА:
   *  · `1` — одноразовый: идёт только стак с этим героем, коридор закрывается, как
   *    только эта армия ПРИБЫЛА (не когда вышла — иначе она летела бы по уже
   *    закрытому коридору);
   *  · `2` — временный: то же право прохода, но живёт до `expiresAt`;
   *  · `3` — общий: по нему двигаются ВСЕ — враг, союзник, свои, нейтральные.
   *
   *  Ступени 1–2 держатся ВЕТО ПО РЕБРУ в маршрутизаторе: ребро в графе есть (без него
   *  не посчитать геометрию), но чужому оно закрыто. Раньше ступени не было вовсе, и
   *  коридор вёл себя как ступень 3 ДЛЯ ВСЕХ — то есть уже был проходим врагом, просто
   *  без бонуса скорости. Отсутствие поля читается как `1` (fail-secure: по умолчанию
   *  коридор ЛИЧНЫЙ, а не общий). */
  tier?: number;
  /** Герой, чей это коридор — на ступенях 1–2 право прохода у флота, который его несёт.
   *  Флот меняется (герой пересаживается), поэтому храним героя, а не флот. */
  heroId?: string;
}

/** A player's remembered last-known state of one world (fog-of-war memory). */
/**
 * Летящий удар челноков (SHU-1.2) — то, чего в старой модели не было вовсе.
 *
 * Челнок не флот: на карте его нет, по линиям он не ходит и в бой не вступает. Но и
 * мгновенным удар быть не может — иначе против него нечего выставить, и модуль зональной
 * обороны теряет смысл (резолюция владельца 2026-09-08). Поэтому вылет живёт в состоянии
 * ровно столько, сколько длится полёт: откуда, чем, куда и когда долетит.
 */
/** Откуда челноки вылетели — туда же они и возвращаются. Мир (космопорт) ИЛИ
 *  флот-носитель: носитель — это мобильный космопорт (SHU-2.1), и всё, что делает
 *  порт (вместимость, топливо, дом для возврата), он делает тоже. Форма та же
 *  размеченная пара, что и у `target` ниже: две ссылки на разные сущности читаются
 *  одинаково, и добавить третью базу можно, не переписывая проверки. */
export type StrikeBase = { kind: 'planet'; id: PlanetId } | { kind: 'fleet'; id: FleetId };

/**
 * ЭСКАДРА — соединение челноков одной базы (SHU-4.2, заказ владельца 2026-09-10).
 *
 * До этого кирпича ангар был плоским списком стеков, и у машин не было никакой
 * личности: стеки сливаются по юниту и лоадауту, поэтому «разделить и объединить»
 * было нечего, а трюм на стеке запретил бы им сливаться вовсе (это стояло прямо в
 * комментарии `ShuttleStrike.cargo`). Эскадра даёт машинам ту самую личность: свой
 * id, свой состав и свой трюм, переживающий вылет.
 *
 * ПОЗЫВНОЙ ЗДЕСЬ НЕ ХРАНИТСЯ. Он выводится из `id` чистой функцией на клиенте — ровно
 * как имя флота (`fleetName.ts`): выведенное имя одинаково у всех клиентов, не едет по
 * сети и не может разъехаться с состоянием.
 */
export interface Squadron {
  id: string;
  /** Машины эскадры. Стеки внутри ОДНОЙ эскадры по-прежнему сливаются по юниту и
   *  лоадауту — личность у соединения, а не у каждой машины. */
  units: UnitStack[];
  /** ТРЮМ — наземные войска, погруженные ЗАРАНЕЕ (ROS-1.5 + SHU-4.2). До этого груз
   *  брали с базы в момент вылета, и до вылета его не существовало вовсе. Теперь он
   *  живёт здесь: покинул гарнизон, занял место в трюме и ждёт приказа.
   *  Undefined/пусто = эскадра идёт налегке. */
  cargo?: UnitStack[];
  /** Недобитый урон по корпусам (SHU-5.3) — тот же пул, что {@link ShuttleStrike.damage}:
   *  вылет, вернувшись, сдаёт его эскадре, а следующий вылет забирает обратно, поэтому
   *  подбитый страйкер падает от второго такого же залпа. Чинится в ангаре у дока.
   *  Undefined = машины целы. */
  damage?: number;
}

export interface ShuttleStrike {
  id: string;
  owner: PlayerId;
  /** База вылета — она же база возврата (мир с космопортом или флот-носитель). */
  base: StrikeBase;
  /** id ЭСКАДРЫ, которая ушла в этот вылет (SHU-4.2). Соединение переживает вылет:
   *  вернувшись, оно встаёт в ангар под тем же именем. Личность, пропадающая на час
   *  полёта, — не личность. */
  squadronId: string;
  /** Что именно летит (стеки покидают ангар на время вылета). */
  units: UnitStack[];
  /** Цель: чужой флот или чужой мир (по нему бьют ЗДАНИЯ, как бомбардировка). */
  target: { kind: 'fleet'; id: FleetId } | { kind: 'planet'; id: PlanetId };
  /** Точка удара. По МИРУ — снимок, снятый в момент вылета (мир не двигается, и
   *  снимать нечего). По ФЛОТУ — текущий прицел ПОГОНИ (SHU-4.4): центр радиуса цели на
   *  последнем пересчёте, который правится, пока эскадра идёт. На обратной ноге — точка,
   *  в которой эскадра развернулась. */
  to: { x: number; y: number };
  /** Где эскадра СЕЙЧАС — живой след погони (SHU-4.4). Есть ТОЛЬКО у идущей погони
   *  (нога `out` по флоту): у неё нет линейного расписания, по которому позицию можно
   *  было бы вывести, — курс правится каждый пересчёт, поэтому точку приходится
   *  ХРАНИТЬ. У всех остальных вылетов поля нет, и позиция выводится из
   *  `departedAt`/`arrivesAt`, как позиция флота на лейне: хранимая копия там
   *  разъехалась бы с расписанием.
   *
   *  Читают его все трое, кто видит вылет на карте, — сама трасса, зональное ПВО и
   *  перехват, — через `strikePosition`. Иначе оборона стреляла бы по призраку курса,
   *  снятого на вылете. */
  at?: { x: number; y: number };
  departedAt: number;
  /** Момент прибытия. У погони (`at` есть) это не расписание, а ОЦЕНКА: сколько осталось
   *  до нынешнего прицела на нынешней скорости. Пересчитывается каждым шагом — цель
   *  волна за волной уходит или приближается, и замороженная оценка врала бы игроку. */
  arrivesAt: number;
  /** `out` — летит к цели, `back` — возвращается в порт. */
  leg: 'out' | 'back';
  /** Урон, накопленный от зонального ПВО и перехвата и ещё не переведённый в сбитые машины.
   *  Без накопления залп слабее корпуса не делал бы вообще ничего, и оборона молча
   *  простаивала бы. С SHU-5.3 остаток переживает вылет: берётся у эскадры на старте и
   *  возвращается ей на посадке ({@link Squadron.damage}). */
  damage?: number;
  /** ТРЮМ вылета — наземные войска, которые везёт десантный челнок (ROS-1.5).
   *
   *  Груз берётся с базы В МОМЕНТ ВЫЛЕТА и живёт здесь, а не в ангаре: машины в ангаре —
   *  стеки без своей личности (они сливаются по юниту и лоадауту), и трюм на стеке
   *  запретил бы им сливаться вовсе. Долетевший груз сходит на землю, вылет при этом
   *  гибнет; сбитая по дороге машина уносит свою долю трюма. Undefined = обычный удар. */
  cargo?: UnitStack[];
}

export interface PlanetSnapshot {
  owner: PlayerId | null;
  garrison: UnitStack[];
  buildings: BuildingInstance[];
  terrain?: string;
  planetType?: string;
  /** Province type (`kind`) at snapshot time — so a remembered node renders its
   *  last-known appearance, and an unseen node never leaks its true kind. */
  kind?: string;
  /** Simulation time (ms) this snapshot was taken. */
  at: number;
}
/** One player's memory: last-known snapshot per world they have ever identified. */
export type FogMemory = Record<PlanetId, PlanetSnapshot>;

/**
 * Зрение — ТОЛЬКО КРУГИ (решение владельца 2026-09-24). Каждый свой мир и флот видит
 * вокруг себя круг полного обзора; радары (постройки, корабли, модули) расширяют его
 * вторым, внешним кругом засечки. Связи между мирами на зрение не влияют: раньше свой
 * мир раскрывал соседей ПО ЛИНИЯМ на любом расстоянии, и игрок видел мир в 781 единице,
 * но не видел мир в 521 без линии. Расстояния — в единицах карты.
 */
export interface SightRules {
  /** Радиус полного обзора вокруг каждого своего мира — у вида провинции без своего числа в
   *  `byKind`. */
  world: number;
  /** Свой радиус обзора по виду провинции (`Planet.kind`) вместо `world`. Решение владельца
   *  2026-09-25 для забега: вокруг себя видят только колонии и космические крепости, по 100;
   *  захваченное поле, туманность или мёртвый мир — только себя, дальше — радар. */
  byKind?: Record<string, number>;
  /** Радиус полного обзора вокруг каждого своего флота — в его фактическом месте. */
  fleet: number;
  /** Множитель дальности всех радаров, мировых и корабельных: карты Sector Zero крупнее. */
  radarScale: number;
}

/** Правила дерева технологий матча (PVR-6.17). */
export interface TechRules {
  /** Действуют ли ворота дней (`dayGate`) — в забеге нет. */
  dayGates: boolean;
  /** Узлы, которых в этом матче нет вовсе. */
  exclude: string[];
}

/** Creates an empty, deterministically-seeded initial state. */
export function createInitialState(params: {
  seed: string | number;
  version: GameVersion;
  time?: number;
}): GameState {
  return {
    version: params.version,
    time: params.time ?? 0,
    startedAt: params.time ?? 0,
    match: { status: 'ongoing', winner: null, scores: {} },
    rng: seedRng(params.seed),
    players: {},
    planets: {},
    fleets: {},
    battles: {},
    battleSeq: 0,
    scheduled: [],
    scheduleSeq: 0,
  };
}

/** An observation, never a live fleet or a claim about the entire Swarm. */
export interface SwarmContact {
  owner: PlayerId;
  location: PlanetId;
  at: number;
  units: Array<{ unit: UnitId; count: number }>;
}

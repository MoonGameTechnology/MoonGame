/** Sector Zero's local roguelite progression. Deliberately independent of account
 * XP and the commander's PvP tree. Catalog abilities, skill requirements, module
 * compatibility and combat effects remain the shared game's rules. Prices below
 * are the first playable tuning, not the final campaign economy. */
import { COMIC_ID } from './chapterComics';
import { forgeOutcome } from './sectorZeroForge';
import { dailyOffers } from './sectorZeroShop';
import { addHeroTokens, heroStarCost, heroTokenUse, rollHeroTokens } from './heroTokens';
import { emptySwarmCodex, learnSwarm, parseSwarmCodex, type SwarmCodex } from './swarmCodex';
import {
  addLoot,
  moduleLadder,
  profileRarity,
  raiseCheck,
  runLoot,
  RARITY_COPIES,
  type RarityLadder,
  type RunLoot,
} from './moduleRarity';
import {
  DEFAULT_OBJECTIVE_SLOTS,
  settleObjectives,
  type ObjectiveResult,
  type ObjectiveSlots,
} from './missionObjectives';
import {
  canEquip,
  hashState,
  knownSkillNodes,
  moduleAllowed,
  starsOf,
  rarityOf,
  RARITIES,
  veteranXp,
  type GameData,
  type Rarity,
  type GameState,
  type Hero,
  type MapObjective,
} from '../packages/shared-core/src/index';

export interface SectorHero {
  level: number;
  skills: string[];
  equipped: string[];
}
export interface SectorZeroProgress {
  v: 1;
  /** Сид профиля — постоянная часть ключа броска Мастерской (SZE-0.3). Задаётся
   *  хозяином ОДИН РАЗ при рождении профиля: `decisions/` обязаны оставаться чистыми,
   *  поэтому источник случайности живёт на стороне вызывающего. Пусто — тоже рабочий
   *  профиль: тогда последовательность бросков у всех игроков одна. */
  seed: string;
  research: number;
  /** Кошелёк Варрантов ⌖ — валюта ВЕРТИКАЛИ (§0.1 роадмапа экономики): попытки в
   *  Мастерской и Академии, позже магазин. Отдельно от `research`, который открывает
   *  НОВОЕ: на одной валюте заточка конкурировала бы с открытием контента, и это был
   *  бы ложный выбор — игрок всегда берёт новое.
   *
   *  ⚠️ Имя взято у аукционной валюты основной игры, но СЧЁТ СВОЙ: у Sector Zero свой
   *  профиль и своя награда, без записей в карьеру командующего (`PVR-3.1`). */
  warrants: number;
  /** Кошелёк Суверенов ◆ — золотая валюта (§0.1). Кранов ДВА: покупка за деньги и
   *  rewarded-ролик малой порцией с дневным лимитом (`SZE-3.5`, §0.6б). IAP в продукте
   *  пока нет (`YAG-4.*`), так что сегодня кран один — ролик, там, где площадка его умеет.
   *  Нет ни одного крана — Суверены не тратятся вовсе (`shopCapabilities`), а витрина всё
   *  равно называет цену: `EC-2.3` требует показывать стоимость до возможности платить. */
  sovereigns: number;
  /** Сколько попыток улучшения уже потрачено НА КАЖДЫЙ предмет, `id → n`.
   *
   *  ⚠️ Счётчик именно ПОИМЁННЫЙ, а не общий на профиль, и это защита от эксплойта.
   *  Бросок — чистая функция от ключа, а игрок в офлайновой игре может его посчитать.
   *  Будь счётчик общим, стало бы выгодно жечь ДЕШЁВЫЕ попытки на дешёвом модуле,
   *  пока номер не встанет на удачный для дорогого. С поимённым счётчиком единственный
   *  способ сдвинуть бросок предмета — заплатить цену ЭТОГО предмета, то есть подкрутка
   *  стоит ровно столько же, сколько честная попытка. */
  forgeTries: Record<string, number>;
  /** Осколки (`EC-2.2`): сколько попыток сгорело на ТЕКУЩЕЙ ступени каждого предмета.
   *  Копятся при неудаче, обнуляются взятой звездой — гарантия принадлежит СТУПЕНИ, а не
   *  предмету навсегда, иначе один раз накопив, игрок покупал бы все следующие звёзды.
   *
   *  Поимённые, как и {@link SectorZeroProgress.forgeTries}, и по той же причине: общий
   *  счёт позволил бы копить гарантию дешёвыми неудачами, а тратить на дорогой ступени. */
  forgeShards: Record<string, number>;
  /** Номер суток витрины магазина (`SZE-3.2`), МОНОТОННЫЙ. Двигает его только
   *  `advanceShopDay`; см. там, почему уменьшать его нельзя. */
  day: number;
  /** Раунд витрины в пределах суток (`SZE-3.4`): 0 — суточная ротация, дальше — обновления
   *  за ролик, не больше {@link SHOP_AD_REFRESHES_PER_DAY}. Растёт только действием
   *  `refresh-shop`, обнуляется только сменой суток — поэтому часы назад попытку не
   *  возвращают. */
  shopRound: number;
  /** Сколько роликов за Суверены засчитано В ЭТИ сутки (`SZE-3.5`). Растёт только
   *  действием `ad-sovereigns`, обнуляется только сменой суток — как {@link shopRound}. */
  adSovereignsToday: number;
  /** Лоты, купленные В ЭТИ сутки (решение владельца 2026-09-23): купленный товар уходит с
   *  прилавка до смены суток, каким бы способом за него ни заплатили. Без этого лот с
   *  ресурсом (он «своим» не становится) покупался за ролик снова и снова. Обнуляется
   *  только сменой суток — как {@link shopRound}. */
  shopSold: string[];
  nextAttempt: number;
  settledThrough: number;
  lastReward: number;
  /** Номер забега, чья награда уже удвоена за ролик (`YAG-3.2`). Удвоение доступно, пока
   *  он меньше {@link settledThrough}: один забег — одно удвоение, и новый расчёт открывает
   *  его снова. */
  doubledThrough: number;
  /** Задачи, закрытые НАВСЕГДА, по главам: `id главы (карты) → id задач` (PVR-5.3). Счёт у
   *  каждой главы свой — решение владельца против общего на профиль. */
  objectivesDone: Record<string, string[]>;
  /** Главы, выигранные хоть раз (id карты): отметка «пройдена» на маршруте глав. */
  chaptersWon: string[];
  /** Комиксы глав, уже показанные этому профилю (`pve-1:intro`, `pve-1:outro`) — каждый
   *  один раз (`decisions/chapterComics.ts`). В профиле, а не в браузере: отметка едет с
   *  профилем через облако, и на новом устройстве комикс второй раз не всплывёт. */
  comicsSeen: string[];
  /** Разведка главы, накопленная за все засчитанные забеги: `id главы → id провинций`,
   *  опознанных игроком (его память тумана). Панель карты главы в меню показывает по ней,
   *  что уже известно, а что лежит в тумане. */
  chapterScouted: Record<string, string[]>;
  /** Разбивка последнего засчитанного забега — экран итогов (PVR-5.4). `null` — ещё не было. */
  lastRun: RunSummary | null;
  modules: string[];
  /** Звёздность модулей (SZE-1.1), `id → ★`: вертикальная ось Мастерской. Открытие
   *  модуля («Данные экспедиций») и его заточка («Варранты») — разные оси и разные
   *  валюты, §0.1 роадмапа экономики, поэтому звезда живёт здесь, а не в `modules`.
   *  Потолок — `data.sectorZeroStars.cap`; отсутствие записи = ★0. */
  stars: Record<string, number>;
  /** Поднятая редкость модулей (SZE-5.2), `id → ступень` — только выше базовой из
   *  каталога. Вторая ось прокачки рядом со звёздами: редкость даёт новый параметр и
   *  поднимает потолок звёзд (`moduleRarity.ts`). */
  moduleRarity: Record<string, string>;
  /** Дубли модулей (SZE-5.2), `id → сколько`: 3 дубля + чертёж поднимают редкость. */
  moduleCopies: Record<string, number>;
  /** Чертежи по ступеням (SZE-5.2), `ступень → сколько`: чертёж той ступени, НА которую
   *  поднимают. */
  blueprints: Record<string, number>;
  loadouts: Record<string, string[]>;
  heroes: Record<string, SectorHero>;
  /** Жетоны героев (`heroTokens.ts`), `id → сколько`: у каждого героя свой счёт. Звезда
   *  героя стоит его жетоны, 10 жетонов приводят героя, которого приводят только жетоны. */
  heroTokens: Record<string, number>;
  selectedHero: string;
  /** Что игрок знает о Рое за все забеги (`swarmCodex.ts`, досье в меню — заказ владельца
   *  2026-09-24). Пополняется на закрытии забега, только растёт. */
  swarmCodex: SwarmCodex;
  /** Купленное, которого нет в каталоге ЭТОЙ версии игры (AUD-31). Нет поля — полка пуста. */
  shelf?: ProfileShelf;
}

/**
 * Полка профиля (AUD-31) — содержимое, которое разбор НЕ узнал по каталогу своей версии.
 *
 * Раньше разбор выбрасывал незнакомое как мусор, и это молча стирало купленное при откате
 * версии игры: профиль новой версии, разобранный старой (откат релиза), терял модуль, его
 * звёзды и героя, а следующая запись и облако закрепляли потерю на всех устройствах —
 * потраченные данные и Варранты не возвращались. Теперь незнакомое едет рядом с профилем
 * и возвращается в него, как только каталог его снова знает. Мусор с формой хуже
 * (дробное, отрицательное, не строка) на полку не попадает — его по-прежнему отбрасывают.
 *
 * Снаряжение кораблей и экипировку героя полка не держит: их переставляют бесплатно.
 */
export interface ProfileShelf {
  modules?: string[];
  stars?: Record<string, number>;
  forgeTries?: Record<string, number>;
  forgeShards?: Record<string, number>;
  moduleRarity?: Record<string, string>;
  moduleCopies?: Record<string, number>;
  blueprints?: Record<string, number>;
  heroes?: Record<string, SectorHero>;
  heroTokens?: Record<string, number>;
  /** Навыки ЗНАКОМЫХ героев, которые каталог не принял: узел другой версии или его
   *  предпосылка. `герой → id узлов`. */
  skills?: Record<string, string[]>;
}
type ShelfRecordField = Exclude<keyof ProfileShelf, 'modules'>;
/** Глава забега: id карты, её запас задач и правило показа (PVR-5.3). */
export interface SectorChapter {
  id: string;
  objectives: readonly MapObjective[];
  slots?: ObjectiveSlots;
  /** Чертёж за ПЕРВУЮ победу в главе (SZE-5.3, `chapterBlueprint`). Нет — не положен. */
  blueprint?: Rarity | null;
}
const NO_CHAPTER: SectorChapter = { id: '', objectives: [] };

/** Итог засчитанного забега по частям (PVR-5.4): сам забег отдельно от надбавки за задачи. */
export interface RunSummary {
  /** Номер засчитанной попытки: экран итогов сверяет его со своим забегом. */
  attempt: number;
  chapter: string;
  won: boolean;
  waves: number;
  totalWaves: number;
  /** Плата за сам забег: 1 + волны + 3 за победу. */
  base: number;
  objectives: ObjectiveResult[];
  /** Сумма за задачи. */
  bonus: number;
  /** Плата за медали сохранённых ветеранов (VET-7, {@link veteranReward}). Нет — итог
   *  засчитан до VET-7 или платить было не за что. */
  veterans?: number;
  /** Уничтожено врагов и Варранты за них ({@link WARRANTS_PER_KILL}). Нет — итог засчитан
   *  до этой строки. */
  kills?: number;
  killWarrants?: number;
  /** Всего данных экспедиций (`base + bonus + veterans`) и Варрантов — за них и за
   *  уничтоженных. */
  total: number;
  warrants: number;
  /** Сколько новых задач главы откроется к следующему заходу. */
  unlocked: number;
  /** Дубли и чертежи, выпавшие за этот забег (SZE-5.3). Нет — старый итог до редкости. */
  loot?: RunLoot;
}

export const SECTOR_ZERO_PROGRESS_KEY = 'sector-zero.progress.v1';
/** Покупка героя за данные — запасной путь; главный — награда за главу (`heroRecruits.ts`),
 *  поэтому цена в несколько забегов, а не в один (решение владельца 2026-09-23). */
export const HERO_UNLOCK_COST = 18;
export const MODULE_UNLOCK_COST = 3;
const GRADES = ['common', 'rare', 'legendary'] as const;
const STARTER_MODULES = ['cargo_bay', 'ion_engine'];

/** Лестница звёздности из каталога. Пустая (`cap` 0 / нет ступеней) = Мастерской и
 *  Академии в этой сборке нет — механика выключается ДАННЫМИ, без флага в коде. */
export function forgeLadderOf(data: GameData): RarityLadder {
  return data.sectorZeroStars;
}

/** Множитель награды за забег, переведённый в Варранты (§2 роадмапа экономики: вторая
 *  половина награды). **v0**: забег с четырьмя волнами и победой даёт 40 ⌖, первая звезда
 *  стоит 20, полная лестница одного модуля — 695. Числа калибруются телеметрией. */
export const WARRANTS_PER_REWARD = 5;
/** Варранты за каждого уничтоженного врага (решение владельца 2026-09-25: «проигрывать —
 *  нормально, каждая экспедиция должна что-то приносить»). Платит и поражение: счёт
 *  уничтоженных ведёт ядро (`PveState.tally`, PVR-6.20). **v0** — калибруется телеметрией. */
export const WARRANTS_PER_KILL = 1;
/** Сколько чужих юнитов уничтожил `player` в этом забеге. Мусор в счёте — ноль. */
function runKills(state: GameState, player: string): number {
  const destroyed = state.pve?.tally?.[player]?.destroyed;
  return typeof destroyed === 'number' && Number.isSafeInteger(destroyed) && destroyed > 0 ? destroyed : 0;
}
/** Варранты последнего засчитанного забега — вся сумма, с уничтоженными. Итог без разбивки
 *  (засчитан до неё) — по старому правилу, от данных. */
export function lastRunWarrants(progress: SectorZeroProgress): number {
  return progress.lastRun?.attempt === progress.settledThrough
    ? progress.lastRun.warrants
    : progress.lastReward * WARRANTS_PER_REWARD;
}

/**
 * Курс медалей в награду забега (VET-7, резолюция владельца 2026-09-24: «в Sector Zero —
 * урон, корпус и выплата»): сколько очков выплаты ядра за медали сохранённых ветеранов
 * (`veteranXp`) стоят одно очко награды забега.
 *
 * Выплата та же, что в сетевой партии, — одни медали, одни степени и одна шкала «чем выше
 * степень, тем дороже» (решение владельца 6). Своей шкалы у забега нет намеренно: две
 * лестницы ценности одной медали разошлись бы при первой же правке. Курс нужен потому,
 * что награды забега мелкие (1 + волны + 3 за победу), а шкала медалей — 5–100 за юнит.
 *
 * **Число — по замеру** (2026-09-24, стенд глав, игрок-оборонец): победный забег приносит
 * 1620–1980 очков медалей, то есть +4…+5 к награде при базе 14 — полторы надбавки за
 * победу. В проигранных забегах выживших ветеранов у игрока к концу не остаётся вовсе, и
 * медали не платят ничего.
 */
export const MEDAL_XP_PER_REWARD = 400;

/** Сколько очков награды забега стоят медали на ЖИВЫХ юнитах `owner` к концу забега. */
export function veteranReward(state: GameState, owner: string, data: GameData): number {
  return Math.round(veteranXp(state, owner, data) / MEDAL_XP_PER_REWARD);
}

/** Сколько корпуса чинит один Суверен (заказ владельца 2026-09-24: платный ремонт в
 *  забеге — за донат-валюту). Корпуса забега — десятки HP: флот из десятка фрегатов
 *  (300 HP) встаёт в 12 Суверенов, дешевле любого лота витрины (15–80). */
export const REPAIR_HP_PER_SOVEREIGN = 25;

/** Цена ремонта в Суверенах: 0 — чинить нечего, иначе не меньше одного. */
export function sovereignRepairCost(missingHull: number): number {
  if (!(missingHull > 0) || !Number.isFinite(missingHull)) return 0;
  return Math.max(1, Math.ceil(missingHull / REPAIR_HP_PER_SOVEREIGN));
}

export function freshSectorZeroProgress(data: GameData, seed = ''): SectorZeroProgress {
  const first = data.heroes.commander ? 'commander' : (Object.keys(data.heroes)[0] ?? '');
  return {
    v: 1,
    seed,
    research: 0,
    warrants: 0,
    sovereigns: 0,
    forgeTries: {},
    forgeShards: {},
    day: 0,
    shopRound: 0,
    adSovereignsToday: 0,
    shopSold: [],
    nextAttempt: 1,
    settledThrough: 0,
    lastReward: 0,
    doubledThrough: 0,
    objectivesDone: {},
    chaptersWon: [],
    comicsSeen: [],
    chapterScouted: {},
    lastRun: null,
    modules: STARTER_MODULES.filter((id) => data.modules[id]),
    stars: {},
    moduleRarity: {},
    moduleCopies: {},
    blueprints: {},
    loadouts: {},
    heroes: first ? { [first]: newSectorHero(first, data) } : {},
    heroTokens: {},
    selectedHero: first,
    swarmCodex: emptySwarmCodex(),
  };
}

/** Герой, только что пришедший в отряд: первая ступень, без навыков, с одной стартовой
 *  способностью (призывы — не в счёт). Один рецепт на все пути прихода: стартовый герой,
 *  покупка за данные и награда за главу (`heroRecruits.ts`). */
export function newSectorHero(id: string, data: GameData): SectorHero {
  return {
    level: 1,
    skills: [],
    equipped: (data.heroes[id]?.startAbilities ?? [])
      .filter((key) => !data.heroAbilities[key]?.type.startsWith('spawn_'))
      .slice(0, 1),
  };
}

export function sectorHeroGrade(hero: SectorHero): string {
  return GRADES[hero.level - 1] ?? 'common';
}
export function sectorHeroSlots(hero: SectorHero, data: GameData): number {
  return data.heroGrades[sectorHeroGrade(hero)]?.skillSlots ?? 1;
}
export function sectorHeroAbilities(id: string, hero: SectorHero, data: GameData): string[] {
  const ids = [...(data.heroes[id]?.startAbilities ?? [])];
  for (const skill of hero.skills) {
    const ability = data.heroSkillTrees[skill]?.grants.ability;
    if (ability) ids.push(ability);
  }
  return [...new Set(ids)].filter((key) => data.heroAbilities[key]);
}
/** Что можно надеть в слоты героя (PVR-6.16): его способности и НАДЕВАЕМЫЕ пассивки —
 *  стартовые и из узлов дерева. Постоянная пассивка сюда не входит: она работает всегда. */
export function sectorHeroSlotItems(id: string, hero: SectorHero, data: GameData): string[] {
  const passives = [
    ...(data.heroes[id]?.startPassives ?? []),
    ...hero.skills.flatMap((skill) => {
      const grants = data.heroSkillTrees[skill]?.grants;
      return [
        ...(grants?.passive !== undefined ? [grants.passive] : []),
        ...(grants?.passives ?? []),
      ];
    }),
  ].filter((p) => data.heroPassives[p]?.slotted);
  return [...new Set([...sectorHeroAbilities(id, hero, data), ...passives])];
}
/** Имя и описание предмета слота — способности или надеваемой пассивки. */
export function sectorSlotItem(
  id: string,
  data: GameData,
): { name: string; description?: string } | undefined {
  const passive = data.heroPassives[id];
  return data.heroAbilities[id] ?? (passive?.slotted ? passive : undefined);
}
export function sectorSkillCost(id: string, data: GameData): number {
  // Branch roots cost two; every prerequisite step adds two. Catalog trees are DAGs.
  const depth = (key: string, seen: Set<string>): number => {
    if (seen.has(key)) return 0;
    const node = data.heroSkillTrees[key];
    return node
      ? 1 + Math.max(0, ...node.requires.map((r) => depth(r, new Set([...seen, key]))))
      : 0;
  };
  return 2 * depth(id, new Set());
}
/** Может ли ВЫБРАННЫЙ герой изучить узел прямо сейчас: ветка его, узел не изучен,
 *  предпосылки взяты. Правила каталога, и деньги их не отменяют — поэтому проверка
 *  вынесена сюда, а не продублирована в магазине второй копией. */
export function sectorSkillLegal(
  progress: SectorZeroProgress,
  id: string,
  data: GameData,
): boolean {
  const hero = own(progress.heroes, progress.selectedHero);
  return hero !== undefined && skillLearnable(progress.selectedHero, hero.skills, id, data);
}

/** Карточка узла в Академии: изучен ли (куплен или врождён, AUD-22) и каких предпосылок
 *  не хватает. Та же правда, что у покупки, — иначе экран повесил бы цену на узел, который
 *  у героя уже есть, или замок на тот, что покупается. */
export function sectorSkillCard(
  heroId: string,
  hero: SectorHero,
  id: string,
  data: GameData,
): { owned: boolean; missing: string[] } {
  const known = knownSkillNodes(hero.skills, heroId, data);
  const requires = data.heroSkillTrees[id]?.requires ?? [];
  return { owned: known.has(id), missing: requires.filter((r) => !known.has(r)) };
}

/**
 * Одно правило «можно изучить» для Академии, магазина и чтения профиля. Изученным
 * считается и купленный узел, и ВРОЖДЁННЫЙ — тот, чья награда у архетипа со старта
 * (AUD-22, решение владельца 2026-09-24): его не продают, а узлы за ним открыты. Набор
 * известных узлов считает ядро (`knownSkillNodes`), тот же, что в `hero.skill.unlock`.
 */
function skillLearnable(
  heroId: string,
  skills: readonly string[],
  id: string,
  data: GameData,
): boolean {
  const node = own(data.heroSkillTrees, id);
  if (!node || !sectorSkillOpenTo(node, heroId, data)) return false;
  const known = knownSkillNodes(skills, heroId, data);
  return !known.has(id) && node.requires.every((r) => known.has(r));
}

/**
 * Узел открыт герою? Правило ровно то же, что в ядре (`hero.skill.unlock`): узел БЕЗ
 * ветки — общий и доступен любому, узел с веткой — только своей.
 *
 * Здесь раньше стояло строгое равенство `node.branch === def.branch`, и оно тихо
 * расходилось с ядром: безветочный узел (`undefined !== 'transhuman'`) в подготовке
 * Sector Zero НЕ покупался, хотя на настоящей карте то же ядро его пускало. Восемь из
 * девятнадцати узлов каталога были общими — то есть треть дерева на экране подготовки
 * была недостижима, и выглядело это как «узла просто нет».
 *
 * Парковка веток (HERO-11) сделала дефект невидимым: сейчас обе стороны `undefined`, и
 * строгое равенство случайно даёт верный ответ. Именно поэтому правило приведено к
 * ядерному СЕЙЧАС, а не «когда понадобится»: иначе распарковка вернула бы вместе с
 * ветками и эту дыру, и искать её пришлось бы заново.
 */
export function sectorSkillOpenTo(
  node: { branch?: string },
  archetype: string | undefined,
  data: GameData,
): boolean {
  return (
    node.branch === undefined ||
    node.branch === (archetype !== undefined ? data.heroes[archetype]?.branch : undefined)
  );
}

/**
 * Корпуса, которые игрок забега реально СТРОИТ (PVR-6.2). Раньше сюда шёл любой
 * космический юнит со слотами — и в подготовке лежали матка Роя и пушки крепости.
 * Фильтр повторяет ворота ядра, а не заводит свои: уникальный юнит фракции строит
 * только она (`faction.ts`, `uniqueUnits` — у Роя матка и десантник), а `issued` значит
 * «приходит вместе с сооружением и не заказывается» (`construction.ts`, орудия крепости).
 */
export function sectorHullIds(data: GameData): string[] {
  const factionOnly = new Set(Object.values(data.factions).flatMap((f) => f.uniqueUnits));
  return Object.keys(data.units).filter((id) => {
    const def = data.units[id]!;
    return (
      def.domain === 'space' &&
      id !== 'hero' &&
      Object.values(def.slots).some((n) => n > 0) &&
      !def.traits.includes('issued') &&
      !factionOnly.has(id)
    );
  });
}

/** Сколько раз в сутки витрину можно обновить за ролик — резолюция владельца (§0.7
 *  роадмапа экономики): «1 раз в сутки + 1 раз за рекламу». */
export const SHOP_AD_REFRESHES_PER_DAY = 1;

/**
 * Модули, которые игрок забега может хоть куда-то ПОСТАВИТЬ (PVR-6.5). Список подготовки
 * брал весь каталог — и в нём лежали модули Роя (только для `brood_host`) и щиты пустоты
 * (только для пушек крепости): игрок платил бы данные за то, что поставить некуда. Правило —
 * то же, что у корпусов: модуль остаётся, если встаёт хотя бы на один корпус игрока.
 */
export function sectorModuleIds(data: GameData): string[] {
  const hulls = sectorHullIds(data);
  return Object.keys(data.modules).filter((id) =>
    hulls.some((hull) => moduleAllowed(hull, data.units[hull]!, data.modules[id]!)),
  );
}

/**
 * Модули в подготовке выбранного корпуса: только те, что на него встают (решение владельца
 * 2026-09-25 «если нельзя надеть модуль, то его не должно показывать»). Уже надетый остаётся
 * при любом раскладе: сохранение из старой версии данных может держать на корпусе то, что
 * туда больше не встаёт, и без карточки его было бы не снять. Неизвестный корпус — пусто.
 */
export function sectorModulesFor(hull: string, fitted: readonly string[], data: GameData): string[] {
  const def = data.units[hull];
  if (!def) return [];
  return sectorModuleIds(data).filter(
    (id) => fitted.includes(id) || moduleAllowed(hull, def, data.modules[id]!),
  );
}

export type SectorProgressAction =
  | { kind: 'unlock-module'; id: string }
  | { kind: 'refresh-shop' }
  | { kind: 'ad-sovereigns' }
  | { kind: 'double-reward' }
  /** Ремонт флота в забеге: списать цену за `hull` недостающего корпуса. Сам ремонт
   *  делает ядро (`fleet.premiumRepair`) — хост зовёт его, только если списание прошло. */
  | { kind: 'premium-repair'; hull: number }
  /** Пакет снабжения забега: списать его цену. Сам пакет выдаёт ядро (`pve.supply`) —
   *  хост зовёт его, только если списание прошло (решение владельца 2026-09-24). */
  | { kind: 'run-supply' }
  | { kind: 'forge'; id: string }
  | { kind: 'raise-rarity'; id: string }
  | { kind: 'buy'; id: string; pay: 'warrants' | 'sovereigns' | 'ad' }
  | { kind: 'fit'; hull: string; id: string }
  | { kind: 'unlock-hero'; id: string }
  | { kind: 'select-hero'; id: string }
  | { kind: 'upgrade-hero'; id: string }
  | { kind: 'skill'; hero: string; id: string }
  | { kind: 'ability'; hero: string; id: string };

/** Invalid or unaffordable choices leave the profile intact. Selection is free;
 * unlocks spend persistent research, never the resources inside a live run. */
export function changeSectorZeroProgress(
  progress: SectorZeroProgress,
  action: SectorProgressAction,
  data: GameData,
): SectorZeroProgress | null {
  const next: SectorZeroProgress = JSON.parse(JSON.stringify(progress));
  const pay = (cost: number): boolean => {
    if (cost > next.research || cost <= 0) return false;
    next.research -= cost;
    return true;
  };
  switch (action.kind) {
    case 'unlock-module':
      if (!own(data.modules, action.id) || next.modules.includes(action.id) || !pay(MODULE_UNLOCK_COST))
        return null;
      next.modules.push(action.id);
      break;
    case 'forge': {
      // Попытка улучшения — один движок на Мастерскую и Академию (§0.3 роадмапа
      // экономики): заводить вторую лестницу запрещено. Здесь только предмет и кошелёк,
      // правило исхода целиком в `sectorZeroForge.ts`.
      if (!own(data.modules, action.id) || !next.modules.includes(action.id)) return null;
      const tries = next.forgeTries[action.id] ?? 0;
      const shards = next.forgeShards[action.id] ?? 0;
      const out = forgeOutcome(
        {
          seed: next.seed,
          attempt: tries,
          target: action.id,
          star: next.stars[action.id] ?? 0,
          shards,
        },
        // Потолок звёзд — от редкости модуля (SZE-5.2): у простого их меньше, чем у легендарного.
        moduleLadder(forgeLadderOf(data), profileRarity(next, action.id, data)),
        next.warrants,
      );
      if (!out.allowed) return null;
      next.warrants -= out.warrants; // сгорает и при неудаче
      next.forgeTries[action.id] = tries + 1;
      if (out.success) {
        next.stars[action.id] = out.star;
        delete next.forgeShards[action.id]; // ступень пройдена — гарантия начинается заново
      } else next.forgeShards[action.id] = shards + 1;
      break;
    }
    case 'raise-rarity': {
      // Чертёж той ступени, НА которую поднимают, и 3 дубля того же модуля (SZE-5.2).
      if (!own(data.modules, action.id)) return null;
      const check = raiseCheck(next, action.id, data);
      if (!check.can || !check.to) return null;
      next.blueprints[check.to] = check.blueprints - 1;
      if (next.blueprints[check.to] === 0) delete next.blueprints[check.to];
      next.moduleCopies[action.id] = check.copies - RARITY_COPIES;
      if (next.moduleCopies[action.id] === 0) delete next.moduleCopies[action.id];
      next.moduleRarity[action.id] = check.to;
      break;
    }
    case 'refresh-shop':
      // Платой служит просмотр ролика, подтверждённый адаптером, — списывать здесь нечего.
      // Отказ от ролика действие не зовёт вовсе, поэтому попытку он не тратит.
      if (next.shopRound >= SHOP_AD_REFRESHES_PER_DAY) return null;
      next.shopRound += 1;
      break;
    case 'double-reward':
      // Повтор награды ПОСЛЕДНЕГО рассчитанного забега — ровно той, что пришла за волны
      // и задачи, обеими валютами. Платой служит досмотренный ролик: до действия дело
      // доходит только после подтверждения адаптера.
      if (next.lastReward <= 0 || next.doubledThrough >= next.settledThrough) return null;
      next.research += next.lastReward;
      // Все Варранты забега, с уничтоженными врагами: удваивается награда целиком.
      next.warrants += lastRunWarrants(next);
      next.doubledThrough = next.settledThrough;
      break;
    case 'premium-repair': {
      const price = sovereignRepairCost(action.hull);
      if (price <= 0 || next.sovereigns < price) return null;
      next.sovereigns -= price;
      break;
    }
    case 'run-supply': {
      const { price } = data.sectorZeroShop.runSupply;
      if (price <= 0 || next.sovereigns < price) return null;
      next.sovereigns -= price;
      break;
    }
    case 'ad-sovereigns': {
      // Порция и лимит — в данных (§0.6б: числа — предмет плейтеста). Ноль в любом из
      // двух выключает кран. Как и у обновления витрины, платой служит просмотр,
      // подтверждённый адаптером: отказ от ролика действие не зовёт.
      const { amount, perDay } = data.sectorZeroShop.adSovereigns;
      if (amount <= 0 || next.adSovereignsToday >= perDay) return null;
      next.sovereigns += amount;
      next.adSovereignsToday += 1;
      break;
    }
    case 'buy': {
      // Выдача и списание живут ВМЕСТЕ: разведи их — и однажды товар выдастся без оплаты.
      const offer = own(data.sectorZeroShop.offers, action.id);
      if (!offer || next.shopSold.includes(action.id)) return null;
      // Продаётся только то, что СЕГОДНЯ на витрине (сутки и раунд профиля). Иначе ротация
      // держалась бы одним интерфейсом, и вчерашний или никогда не выставлявшийся лот
      // покупался бы в обход неё (ревью Sector Zero).
      if (!dailyOffers(next.seed, next.day, data, next.shopRound).some((o) => o.id === action.id))
        return null;
      const price = offer.prices[action.pay];
      if (price === undefined) return null; // этим способом товар не продаётся
      if (action.pay === 'warrants') {
        if (next.warrants < price) return null;
        next.warrants -= price;
      } else if (action.pay === 'sovereigns') {
        if (next.sovereigns < price) return null;
        next.sovereigns -= price;
      }
      // `ad` не списывает НИЧЕГО: просмотр уже состоялся, и подтвердил его адаптер
      // площадки. Награду выдаёт игра только после подтверждённого результата
      // (`platform-adapters.md`), поэтому сюда действие доходит уже оплаченным.
      switch (offer.kind) {
        case 'module':
          if (!data.modules[offer.grants]) return null;
          // Уже открытый модуль приходит ДУБЛЕМ — материалом для повышения редкости (SZE-5.3).
          if (next.modules.includes(offer.grants))
            next.moduleCopies[offer.grants] = (next.moduleCopies[offer.grants] ?? 0) + 1;
          else next.modules.push(offer.grants);
          break;
        case 'blueprint': {
          // Чертёж ступени редкости (SZE-5.3). Простой ступени не бывает: на неё не поднимают.
          const tier = offer.grants as Rarity;
          if (tier === 'simple' || !RARITIES.includes(tier)) return null;
          next.blueprints[tier] = (next.blueprints[tier] ?? 0) + 1;
          break;
        }
        case 'skill': {
          if (!sectorSkillLegal(next, offer.grants, data)) return null;
          next.heroes[next.selectedHero]!.skills.push(offer.grants);
          break;
        }
        case 'hero-tokens':
          // Жетоны покупаются тому, кому они нужны (`heroTokenUse`): герою на потолке звёзд
          // и герою непройденной главы лот не продаётся.
          if (heroTokenUse(next, offer.grants, data) === null) return null;
          next.heroTokens[offer.grants] = (next.heroTokens[offer.grants] ?? 0) + offer.amount;
          break;
        case 'resource':
          if (offer.grants === 'research') next.research += offer.amount;
          else if (offer.grants === 'warrants') next.warrants += offer.amount;
          else return null;
          break;
      }
      next.shopSold.push(action.id);
      break;
    }
    case 'fit': {
      if (!sectorHullIds(data).includes(action.hull) || !next.modules.includes(action.id))
        return null;
      const equipped = next.loadouts[action.hull] ?? [];
      if (equipped.includes(action.id))
        next.loadouts[action.hull] = equipped.filter((id) => id !== action.id);
      else {
        if (!canEquip(action.hull, data.units[action.hull]!, equipped, action.id, data).ok)
          return null;
        next.loadouts[action.hull] = [...equipped, action.id];
      }
      break;
    }
    case 'unlock-hero': {
      if (!own(data.heroes, action.id) || own(next.heroes, action.id) || !pay(HERO_UNLOCK_COST))
        return null;
      next.heroes[action.id] = newSectorHero(action.id, data);
      break;
    }
    case 'select-hero':
      if (!own(next.heroes, action.id)) return null;
      next.selectedHero = action.id;
      break;
    case 'upgrade-hero': {
      // Звезда героя стоит ЕГО жетоны (`heroTokens.ts`, решение владельца 2026-09-24), а не
      // данные экспедиций: данные открывают новое, жетоны растят звёздность.
      const hero = own(next.heroes, action.id);
      const cost = hero && hero.level < GRADES.length ? heroStarCost(hero.level) : null;
      const have = next.heroTokens[action.id] ?? 0;
      if (!hero || cost === null || have < cost) return null;
      next.heroTokens[action.id] = have - cost;
      if (next.heroTokens[action.id] === 0) delete next.heroTokens[action.id];
      hero.level++;
      break;
    }
    case 'skill': {
      const hero = own(next.heroes, action.hero);
      if (
        !hero ||
        !skillLearnable(action.hero, hero.skills, action.id, data) ||
        !pay(sectorSkillCost(action.id, data))
      )
        return null;
      hero.skills.push(action.id);
      break;
    }
    case 'ability': {
      const hero = own(next.heroes, action.hero);
      if (
        !hero ||
        !sectorHeroSlotItems(action.hero, hero, data).includes(action.id) ||
        data.heroAbilities[action.id]?.type.startsWith('spawn_')
      )
        return null;
      if (hero.equipped.includes(action.id))
        hero.equipped = hero.equipped.filter((id) => id !== action.id);
      else {
        if (hero.equipped.length >= sectorHeroSlots(hero, data)) return null;
        hero.equipped.push(action.id);
      }
      break;
    }
  }
  return next;
}

/**
 * Запись таблицы по id — только СОБСТВЕННЫЙ ключ (AUD-30). `data.modules['constructor']`
 * находит не запись каталога, а наследство `Object.prototype`, и профиль из `localStorage`
 * или облака принимал такие «модули» и «героев»: «Новый забег» падал на
 * `selectedHero: "constructor"`, Мастерская — на модуле `constructor`, а действие с id
 * `__proto__` дописывало поле прямо в `Object.prototype` — все объекты игры получали
 * `level: NaN`. `hasOwnProperty.call`, а не `Object.hasOwn`: клиент идёт и в старые WebView.
 */
function own<T>(table: Readonly<Record<string, T>>, id: unknown): T | undefined {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(table, id)
    ? table[id]
    : undefined;
}

/** Объект-словарь из хранилища или пустой: массив и примитив словарём не считаются. */
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const counter = (n: unknown, fallback = 0): number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : fallback;
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((id): id is string => typeof id === 'string'))] : [];

/** Разбивка из хранилища: только целые неотрицательные числа и строки, иначе `null` —
 *  экран итогов не покажет правленый мусор. */
function parseRunSummary(v: unknown): RunSummary | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const n = (x: unknown): number | null =>
    typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : null;
  const nums = [
    'attempt',
    'waves',
    'totalWaves',
    'base',
    'bonus',
    'total',
    'warrants',
    'unlocked',
  ].map((k) => n(r[k]));
  if (nums.some((x) => x === null) || typeof r.chapter !== 'string' || !Array.isArray(r.objectives))
    return null;
  const objectives: ObjectiveResult[] = [];
  for (const o of r.objectives as unknown[]) {
    const x = o as Record<string, unknown> | null;
    if (!x || typeof x.id !== 'string' || n(x.total) === null || n(x.paid) === null) return null;
    const needMs = n(x.needMs);
    objectives.push({
      id: x.id,
      total: x.total as number,
      ...(needMs ? { needMs } : {}),
      complete: x.complete === true,
      paid: x.paid as number,
    });
  }
  const [attempt, waves, totalWaves, base, bonus, total, warrants, unlocked] = nums as number[];
  const bag = (v: unknown): Record<string, number> => {
    const out: Record<string, number> = {};
    if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const c = n(x);
        if (c) out[k] = c;
      }
    return out;
  };
  const rawLoot = r.loot as Record<string, unknown> | undefined;
  const veterans = n(r.veterans);
  const kills = n(r.kills);
  const killWarrants = n(r.killWarrants);
  return {
    attempt: attempt!,
    chapter: r.chapter,
    won: r.won === true,
    waves: waves!,
    totalWaves: totalWaves!,
    base: base!,
    objectives,
    bonus: bonus!,
    ...(veterans ? { veterans } : {}),
    ...(kills !== null && killWarrants !== null ? { kills, killWarrants } : {}),
    total: total!,
    warrants: warrants!,
    unlocked: unlocked!,
    ...(rawLoot && typeof rawLoot === 'object'
      ? {
          loot: {
            copies: bag(rawLoot.copies),
            blueprints: bag(rawLoot.blueprints),
            ...(rawLoot.heroTokens ? { heroTokens: bag(rawLoot.heroTokens) } : {}),
          },
        }
      : {}),
  };
}

/** `seed` нужен только НОВОМУ профилю: у сохранённого свой, и он важнее (перебьёт).
 *  Источник случайности — на стороне хозяина, тут по-прежнему чистая функция. */
export function parseSectorZeroProgress(
  raw: string | null,
  data: GameData,
  seed = '',
): SectorZeroProgress {
  const fresh = freshSectorZeroProgress(data, seed);
  if (!raw) return fresh;
  try {
    const p = JSON.parse(raw) as Partial<SectorZeroProgress>;
    if (!p || p.v !== 1) return fresh;
    fresh.research = counter(p.research);
    fresh.nextAttempt = Math.max(1, counter(p.nextAttempt, 1));
    fresh.settledThrough = Math.min(fresh.nextAttempt - 1, counter(p.settledThrough));
    fresh.lastReward = counter(p.lastReward);
    // Отметка удвоения не может обогнать расчёт: «из будущего» она закрыла бы удвоение
    // следующего забега заранее.
    fresh.doubledThrough = Math.min(counter(p.doubledThrough), fresh.settledThrough);
    // Профиль правится игроком: только строки, без дублей. Чужие id задач безвредны — их
    // нет в запасе карты, значит они ничего не закрывают и не открывают.
    for (const [chapter, ids] of Object.entries(p.objectivesDone ?? {})) {
      const list = strings(ids);
      if (list.length > 0 && chapter !== '__proto__') fresh.objectivesDone[chapter] = list;
    }
    fresh.chaptersWon = strings(p.chaptersWon);
    fresh.comicsSeen = strings(p.comicsSeen).filter((id) => COMIC_ID.test(id));
    for (const [chapter, ids] of Object.entries(p.chapterScouted ?? {})) {
      const list = strings(ids);
      if (list.length > 0 && chapter !== '__proto__') fresh.chapterScouted[chapter] = list;
    }
    fresh.lastRun = parseRunSummary(p.lastRun);
    fresh.warrants = counter(p.warrants);
    fresh.sovereigns = counter(p.sovereigns);
    fresh.day = counter(p.day);
    // Сверху — срез до лимита: «999» из правленого localStorage значит только «сегодня
    // уже обновлял», а не бесконечные обновления.
    fresh.shopRound = Math.min(counter(p.shopRound), SHOP_AD_REFRESHES_PER_DAY);
    fresh.adSovereignsToday = Math.min(
      counter(p.adSovereignsToday),
      data.sectorZeroShop.adSovereigns.perDay,
    );
    fresh.shopSold = [...new Set(strings(p.shopSold).filter((id) => own(data.sectorZeroShop.offers, id)))];
    if (typeof p.seed === 'string') fresh.seed = p.seed;
    // Полка (AUD-31): то, что прошлая запись отложила как незнакомое своему каталогу,
    // разбирается ВМЕСТЕ с основными полями — знакомое этому каталогу возвращается в
    // профиль, незнакомое снова уходит на полку. Основное поле важнее полочного.
    const shelved = (p.shelf && typeof p.shelf === 'object' ? p.shelf : {}) as Record<string, unknown>;
    const shelf: ProfileShelf = {};
    const merged = (field: string): [string, unknown][] =>
      Object.entries({ ...record(shelved[field]), ...record((p as Record<string, unknown>)[field]) });
    const shelve = (field: ShelfRecordField, id: string, value: unknown): void => {
      if (id !== '__proto__') ((shelf[field] ??= {}) as Record<string, unknown>)[id] = value;
    };
    const rawModules = [...new Set([...strings(p.modules), ...strings(shelved.modules)])];
    fresh.modules = [...new Set([...fresh.modules, ...rawModules.filter((id) => own(data.modules, id))])];
    const unknownModules = rawModules.filter((id) => !own(data.modules, id));
    if (unknownModules.length > 0) shelf.modules = unknownModules;
    // Профиль лежит в localStorage — то есть правится игроком. Звезда сверх потолка,
    // дробная, отрицательная и звезда несуществующего модуля не доезжают: срезаем здесь,
    // один раз, а не в каждом месте, которое потом звезду прочтёт.
    // Счётчик попыток живёт по тем же правилам, что и звёзды: профиль лежит в
    // localStorage, так что дробное, отрицательное и чужое до механики не доезжает.
    // Модуль, которого нет в ЭТОМ каталоге, — не мусор, а, может быть, контент другой
    // версии игры: его счётчики едут на полку (AUD-31).
    for (const field of ['forgeTries', 'forgeShards', 'moduleCopies', 'stars'] as const)
      for (const [id, value] of merged(field)) {
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) continue;
        if (!own(data.modules, id)) shelve(field, id, value);
        else if (field !== 'stars') fresh[field][id] = value;
        else fresh.stars[id] = Math.min(data.sectorZeroStars.cap, value);
      }
    // Редкость, дубли и чертежи (SZE-5.2): профиль лежит в localStorage и правится
    // игроком, поэтому мусорный счётчик — мимо; незнакомые модуль или ступень — на полку.
    for (const [id, value] of merged('moduleRarity')) {
      if (typeof value !== 'string') continue;
      const def = own(data.modules, id);
      const tier = RARITIES.indexOf(value as (typeof RARITIES)[number]);
      if (!def || tier < 0) shelve('moduleRarity', id, value);
      else if (tier > RARITIES.indexOf(def.rarity ?? 'simple')) fresh.moduleRarity[id] = value;
    }
    for (const [r, value] of merged('blueprints')) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || r === 'simple')
        continue;
      if (RARITIES.includes(r as (typeof RARITIES)[number])) fresh.blueprints[r] = value;
      else shelve('blueprints', r, value);
    }
    const hulls = sectorHullIds(data);
    for (const [hull, ids] of Object.entries(p.loadouts ?? {})) {
      if (!hulls.includes(hull)) continue;
      const equipped: string[] = [];
      for (const id of strings(ids))
        if (fresh.modules.includes(id) && canEquip(hull, data.units[hull]!, equipped, id, data).ok)
          equipped.push(id);
      fresh.loadouts[hull] = equipped;
    }
    const shelvedSkills = record(shelved.skills);
    for (const [id, raw] of merged('heroes')) {
      if (!raw || typeof raw !== 'object') continue;
      const value = raw as Partial<Record<keyof SectorHero, unknown>>;
      const level = Math.max(1, Math.min(3, counter(value.level, 1)));
      const candidates = [...new Set([...strings(value.skills), ...strings(own(shelvedSkills, id))])];
      if (!own(data.heroes, id)) {
        shelve('heroes', id, { level, skills: candidates, equipped: strings(value.equipped) });
        continue;
      }
      const hero: SectorHero = { level, skills: [], equipped: [] };
      // Repeat in catalog-independent order so valid prerequisites survive JSON key order.
      for (let pass = 0; pass < candidates.length; pass++)
        for (const skill of candidates)
          if (skillLearnable(id, hero.skills, skill, data)) hero.skills.push(skill);
      // Не принятые навыки — на полку (AUD-31): узел другой версии, его предпосылка или
      // ветка, которой у героя сейчас нет. Кроме тех, что герой и так знает — врождённых
      // (AUD-22): их не покупают, и полка их не держит.
      const known = knownSkillNodes(hero.skills, id, data);
      const left = candidates.filter((skill) => !known.has(skill));
      if (left.length > 0) shelve('skills', id, left);
      const owned = sectorHeroSlotItems(id, hero, data);
      hero.equipped = strings(value.equipped)
        .filter((a) => owned.includes(a) && !data.heroAbilities[a]?.type.startsWith('spawn_'))
        .slice(0, sectorHeroSlots(hero, data));
      fresh.heroes[id] = hero;
    }
    // Жетоны героев (`heroTokens.ts`) покупаются, поэтому жетоны героя, которого нет в ЭТОМ
    // каталоге, не стираются, а едут на полку вместе с самим героем (AUD-31).
    for (const [id, value] of merged('heroTokens')) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) continue;
      if (own(data.heroes, id)) fresh.heroTokens[id] = value;
      else shelve('heroTokens', id, value);
    }
    if (Object.keys(shelf).length > 0) fresh.shelf = shelf;
    if (own(fresh.heroes, p.selectedHero)) fresh.selectedHero = p.selectedHero!;
    fresh.swarmCodex = parseSwarmCodex(p.swarmCodex, data);
    return fresh;
  } catch {
    return fresh;
  }
}

/** An attempt's serial belongs to this profile, not to wall time. No reward for
 * leaving the map. A terminal run is settled once, including after page reload. */
export function settleSectorZeroRun(
  progress: SectorZeroProgress,
  attempt: number,
  state: GameState,
  /** Глава забега: её запас задач (решение владельца 2026-09-22) и правило показа
   *  (PVR-5.3). Без запаса забег платит ровно как раньше: задачи ДОПОЛНИТЕЛЬНЫЕ. */
  chapter: SectorChapter = NO_CHAPTER,
  /** Каталог игры — с ним закрытие забега пополняет досье Роя (`learnSwarm`). Без него
   *  досье не трогается: выплата от него не зависит. */
  data?: GameData,
): SectorZeroProgress {
  if (
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    attempt >= progress.nextAttempt ||
    attempt <= progress.settledThrough ||
    !state.pve ||
    state.match.status !== 'ended' ||
    !Number.isSafeInteger(state.pve.waveNumber) ||
    state.pve.waveNumber < 0 ||
    !Number.isSafeInteger(state.pve.totalWaves) ||
    state.pve.waveNumber > state.pve.totalWaves
  )
    return progress;
  const won = state.match.winner === 'p1' || state.match.winners?.includes('p1');
  // Надбавка за ВЫПОЛНЕННЫЕ задачи складывается с выплатой за волны, а не заменяет её:
  // иначе игрок, сделавший задачи и проигравший рано, получал бы больше того, кто дошёл
  // до конца, — и «дополнительная» задача перестала бы быть дополнительной.
  // Платят только задачи, ПОКАЗАННЫЕ в этом забеге: закрытые раньше в показ не входят и
  // второй раз не платят (PVR-5.3).
  const base = 1 + Math.max(0, state.pve.waveNumber) + (won ? 3 : 0);
  const done = progress.objectivesDone[chapter.id] ?? [];
  const tasks = settleObjectives(
    chapter.objectives,
    done,
    state,
    'p1',
    chapter.slots ?? DEFAULT_OBJECTIVE_SLOTS,
  );
  // VET-7: медали сохранённых ветеранов — третья часть награды, рядом с волнами и
  // задачами. Каталог нужен для порогов медалей; без него платить не за что.
  const veterans = data ? veteranReward(state, 'p1', data) : 0;
  const reward = base + tasks.bonus + veterans;
  const kills = runKills(state, 'p1');
  const killWarrants = kills * WARRANTS_PER_KILL;
  const warrants = reward * WARRANTS_PER_REWARD + killWarrants;
  const firstWin = !!won && !!chapter.id && !progress.chaptersWon.includes(chapter.id);
  // Дубли и чертежи (SZE-5.3): бросок от сида профиля, номера попытки и отпечатка итогового
  // мира (AUD-26) — повторный засчёт того же забега невозможен (проверка выше), перезагрузка
  // итог не перекатывает, а номер попытки удачу не выбирает.
  const newTasks = Math.max(0, tasks.done.length - done.length);
  const outcome = hashState(state);
  const loot: RunLoot = {
    ...runLoot({
      seed: progress.seed,
      attempt,
      modules: progress.modules,
      won: !!won,
      newTasks,
      firstWinBlueprint: firstWin ? (chapter.blueprint ?? null) : null,
      outcome,
    }),
    // Жетоны героя (`heroTokens.ts`): тем же ключом, что дубли. Без каталога неизвестно,
    // кому они нужны, — тогда не падают.
    ...(data
      ? {
          heroTokens: rollHeroTokens({ seed: progress.seed, attempt, outcome, progress, data, won: !!won, newTasks }),
        }
      : {}),
  };
  return {
    ...progress,
    research: progress.research + reward,
    ...addLoot(progress, loot),
    heroTokens: addHeroTokens(progress.heroTokens, loot.heroTokens ?? {}),
    // Забег — кран ОБЕИХ валют (§2 роадмапа экономики): данные открывают горизонталь,
    // Варранты обслуживают вертикаль. Без второго крана Мастерская недостижима.
    warrants: progress.warrants + warrants,
    settledThrough: attempt,
    lastReward: reward,
    objectivesDone:
      chapter.id && tasks.done.length > done.length
        ? { ...progress.objectivesDone, [chapter.id]: tasks.done }
        : progress.objectivesDone,
    chaptersWon: firstWin ? [...progress.chaptersWon, chapter.id] : progress.chaptersWon,
    swarmCodex: data ? learnSwarm(progress.swarmCodex, state, 'p1', data) : progress.swarmCodex,
    chapterScouted: chapter.id
      ? {
          ...progress.chapterScouted,
          [chapter.id]: [
            ...new Set([
              ...(progress.chapterScouted[chapter.id] ?? []),
              ...Object.keys(state.fog?.p1 ?? {}),
            ]),
          ].sort(),
        }
      : progress.chapterScouted,
    lastRun: {
      attempt,
      chapter: chapter.id,
      won: !!won,
      waves: state.pve.waveNumber,
      totalWaves: state.pve.totalWaves,
      base,
      objectives: tasks.results,
      bonus: tasks.bonus,
      ...(veterans > 0 ? { veterans } : {}),
      kills,
      killWarrants,
      total: reward,
      warrants,
      unlocked: tasks.unlocked,
      loot,
    },
  };
}

/** Snapshot preparation onto a NEW run only. Restoring a save must never call this:
 * the old hero and fleets keep the equipment and skills they began with. */
export function prepareSectorZeroRun(
  state: GameState,
  progress: SectorZeroProgress,
  data: GameData,
): GameState {
  const next: GameState = JSON.parse(JSON.stringify(state));
  const player = next.players.p1;
  if (!player) return next;
  // Звёздность едет в забег ТЕМ ЖЕ снимком, что арсенал и совет учёных (SZE-1.1):
  // мету ядро читает ровно один раз, на старте. Поэтому заточка во время идущего забега
  // на него не влияет, а реплей уже сыгранного остаётся воспроизводимым.
  const stars = { ...progress.stars };
  // Поднятая редкость едет тем же снимком (SZE-5.2): верфь забега штампует её на всё построенное.
  const rarity = { ...progress.moduleRarity };
  player.arsenal = {
    hulls: Object.keys(data.units)
      .filter((id) => data.units[id]?.domain === 'space')
      .sort(),
    modules: [...progress.modules].sort(),
    ...(Object.keys(stars).length > 0 ? { stars } : {}),
    ...(Object.keys(rarity).length > 0 ? { rarity } : {}),
  };
  for (const fleet of Object.values(next.fleets))
    if (fleet.owner === 'p1') {
      for (const stack of fleet.units) {
        stack.modules = [...(progress.loadouts[stack.unit] ?? [])];
        const own = starsOf(stack.modules, stars);
        if (own) stack.moduleStars = own;
        else delete stack.moduleStars;
        const raised = rarityOf(stack.modules, rarity);
        if (raised) stack.moduleRarity = raised;
        else delete stack.moduleRarity;
      }
    }
  const selected = own(progress.heroes, progress.selectedHero);
  const def = own(data.heroes, progress.selectedHero);
  const home = Object.values(next.planets).find((p) => p.owner === 'p1' && p.kind === 'planet');
  if (!selected || !def || !home) return next;
  const id = 'sector-zero:hero';
  const fleetId = 'sector-zero:flagship';
  const hero: Hero = {
    id,
    owner: 'p1',
    archetype: progress.selectedHero,
    grade: sectorHeroGrade(selected),
    location: home.id,
    home: home.id,
    cooldowns: {},
    alive: true,
    fleetId,
    skills: [...selected.skills],
    abilities: sectorHeroAbilities(progress.selectedHero, selected, data),
    equipped: [...selected.equipped],
    passives: [
      ...new Set([
        ...def.startPassives,
        // Узел даёт пассивку одиночной (`passive`) или списком (`passives`, «Мастерство
        // обломков» — две сразу). Список здесь раньше не читался, и такой узел в забег не
        // привозил ничего (AUD-22).
        ...selected.skills.flatMap((skill) => {
          const grants = data.heroSkillTrees[skill]?.grants;
          return [
            ...(grants?.passive !== undefined ? [grants.passive] : []),
            ...(grants?.passives ?? []),
          ];
        }),
      ]),
    ],
  };
  next.heroes ??= {};
  // Map-defined player heroes are replaced by the chosen expedition hero.
  for (const [key, existing] of Object.entries(next.heroes))
    if (existing.owner === 'p1') delete next.heroes[key];
  next.heroes[id] = hero;
  next.fleets[fleetId] = {
    id: fleetId,
    owner: 'p1',
    location: home.id,
    movement: null,
    units: [{ unit: def.ship.unit ?? 'hero', count: 1 }],
    traits: [],
    orbit: 'near',
  };
  next.capital ??= {};
  next.capital.p1 = home.id;
  return next;
}

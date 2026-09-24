/** Sector Zero's local roguelite progression. Deliberately independent of account
 * XP and the commander's PvP tree. Catalog abilities, skill requirements, module
 * compatibility and combat effects remain the shared game's rules. Prices below
 * are the first playable tuning, not the final campaign economy. */
import { forgeOutcome } from './sectorZeroForge';
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
  moduleAllowed,
  starsOf,
  rarityOf,
  RARITIES,
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
  selectedHero: string;
}
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
  /** Всего данных экспедиций (`base + bonus`) и Варрантов за них. */
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
    chapterScouted: {},
    lastRun: null,
    modules: STARTER_MODULES.filter((id) => data.modules[id]),
    stars: {},
    moduleRarity: {},
    moduleCopies: {},
    blueprints: {},
    loadouts: {},
    heroes: first ? { [first]: newSectorHero(first, data) } : {},
    selectedHero: first,
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
export function sectorHeroUpgradeCost(hero: SectorHero): number {
  return hero.level * 4;
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
  const hero = progress.heroes[progress.selectedHero];
  const node = data.heroSkillTrees[id];
  if (!hero || !node) return false;
  return (
    nodeOpenTo(node, progress.selectedHero, data) &&
    !hero.skills.includes(id) &&
    node.requires.every((r) => hero.skills.includes(r))
  );
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
function nodeOpenTo(
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

export type SectorProgressAction =
  | { kind: 'unlock-module'; id: string }
  | { kind: 'refresh-shop' }
  | { kind: 'ad-sovereigns' }
  | { kind: 'double-reward' }
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
      if (!data.modules[action.id] || next.modules.includes(action.id) || !pay(MODULE_UNLOCK_COST))
        return null;
      next.modules.push(action.id);
      break;
    case 'forge': {
      // Попытка улучшения — один движок на Мастерскую и Академию (§0.3 роадмапа
      // экономики): заводить вторую лестницу запрещено. Здесь только предмет и кошелёк,
      // правило исхода целиком в `sectorZeroForge.ts`.
      if (!data.modules[action.id] || !next.modules.includes(action.id)) return null;
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
      next.warrants += next.lastReward * WARRANTS_PER_REWARD;
      next.doubledThrough = next.settledThrough;
      break;
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
      const offer = data.sectorZeroShop.offers[action.id];
      if (!offer || next.shopSold.includes(action.id)) return null;
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
      const def = data.heroes[action.id];
      if (!def || next.heroes[action.id] || !pay(HERO_UNLOCK_COST)) return null;
      next.heroes[action.id] = newSectorHero(action.id, data);
      break;
    }
    case 'select-hero':
      if (!next.heroes[action.id]) return null;
      next.selectedHero = action.id;
      break;
    case 'upgrade-hero': {
      const hero = next.heroes[action.id];
      if (!hero || hero.level >= GRADES.length || !pay(sectorHeroUpgradeCost(hero))) return null;
      hero.level++;
      break;
    }
    case 'skill': {
      const hero = next.heroes[action.hero];
      const node = data.heroSkillTrees[action.id];
      if (
        !hero ||
        !node ||
        !nodeOpenTo(node, action.hero, data) ||
        hero.skills.includes(action.id) ||
        !node.requires.every((id) => hero.skills.includes(id)) ||
        !pay(sectorSkillCost(action.id, data))
      )
        return null;
      hero.skills.push(action.id);
      break;
    }
    case 'ability': {
      const hero = next.heroes[action.hero];
      if (
        !hero ||
        !sectorHeroAbilities(action.hero, hero, data).includes(action.id) ||
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
    objectives.push({
      id: x.id,
      total: x.total as number,
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
  return {
    attempt: attempt!,
    chapter: r.chapter,
    won: r.won === true,
    waves: waves!,
    totalWaves: totalWaves!,
    base: base!,
    objectives,
    bonus: bonus!,
    total: total!,
    warrants: warrants!,
    unlocked: unlocked!,
    ...(rawLoot && typeof rawLoot === 'object'
      ? { loot: { copies: bag(rawLoot.copies), blueprints: bag(rawLoot.blueprints) } }
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
      if (list.length > 0) fresh.objectivesDone[chapter] = list;
    }
    fresh.chaptersWon = strings(p.chaptersWon);
    for (const [chapter, ids] of Object.entries(p.chapterScouted ?? {})) {
      const list = strings(ids);
      if (list.length > 0) fresh.chapterScouted[chapter] = list;
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
    fresh.shopSold = [...new Set(strings(p.shopSold).filter((id) => data.sectorZeroShop.offers[id]))];
    if (typeof p.seed === 'string') fresh.seed = p.seed;
    fresh.modules = [
      ...new Set([...fresh.modules, ...strings(p.modules).filter((id) => data.modules[id])]),
    ];
    // Профиль лежит в localStorage — то есть правится игроком. Звезда сверх потолка,
    // дробная, отрицательная и звезда несуществующего модуля не доезжают: срезаем здесь,
    // один раз, а не в каждом месте, которое потом звезду прочтёт.
    // Счётчик попыток живёт по тем же правилам, что и звёзды: профиль лежит в
    // localStorage, так что дробное, отрицательное и чужое до механики не доезжает.
    for (const [id, value] of Object.entries(p.forgeTries ?? {})) {
      if (!data.modules[id] || typeof value !== 'number' || !Number.isSafeInteger(value)) continue;
      if (value > 0) fresh.forgeTries[id] = value;
    }
    for (const [id, value] of Object.entries(p.forgeShards ?? {})) {
      if (!data.modules[id] || typeof value !== 'number' || !Number.isSafeInteger(value)) continue;
      if (value > 0) fresh.forgeShards[id] = value;
    }
    // Редкость, дубли и чертежи (SZE-5.2): профиль лежит в localStorage и правится
    // игроком, поэтому чужая ступень, мусорный счётчик или неизвестный модуль — мимо.
    for (const [id, value] of Object.entries(p.moduleRarity ?? {})) {
      if (!data.modules[id] || typeof value !== 'string') continue;
      const base = RARITIES.indexOf(data.modules[id]!.rarity ?? 'simple');
      if (RARITIES.indexOf(value as (typeof RARITIES)[number]) > base) fresh.moduleRarity[id] = value;
    }
    for (const [id, value] of Object.entries(p.moduleCopies ?? {})) {
      if (!data.modules[id] || typeof value !== 'number' || !Number.isSafeInteger(value)) continue;
      if (value > 0) fresh.moduleCopies[id] = value;
    }
    for (const [r, value] of Object.entries(p.blueprints ?? {})) {
      if (!RARITIES.includes(r as (typeof RARITIES)[number]) || r === 'simple') continue;
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) continue;
      if (value > 0) fresh.blueprints[r] = value;
    }
    for (const [id, value] of Object.entries(p.stars ?? {})) {
      if (!data.modules[id] || typeof value !== 'number' || !Number.isSafeInteger(value)) continue;
      const star = Math.min(data.sectorZeroStars.cap, value);
      if (star > 0) fresh.stars[id] = star;
    }
    for (const [hull, ids] of Object.entries(p.loadouts ?? {})) {
      if (!sectorHullIds(data).includes(hull)) continue;
      const equipped: string[] = [];
      for (const id of strings(ids))
        if (fresh.modules.includes(id) && canEquip(hull, data.units[hull]!, equipped, id, data).ok)
          equipped.push(id);
      fresh.loadouts[hull] = equipped;
    }
    for (const [id, value] of Object.entries(p.heroes ?? {})) {
      if (!data.heroes[id] || !value || typeof value !== 'object') continue;
      const hero: SectorHero = {
        level: Math.max(1, Math.min(3, counter(value.level, 1))),
        skills: [],
        equipped: [],
      };
      const candidates = strings(value.skills);
      // Repeat in catalog-independent order so valid prerequisites survive JSON key order.
      for (let pass = 0; pass < candidates.length; pass++)
        for (const skill of candidates) {
          const node = data.heroSkillTrees[skill];
          if (
            node &&
            nodeOpenTo(node, id, data) &&
            !hero.skills.includes(skill) &&
            node.requires.every((r) => hero.skills.includes(r))
          )
            hero.skills.push(skill);
        }
      const owned = sectorHeroAbilities(id, hero, data);
      hero.equipped = strings(value.equipped)
        .filter((a) => owned.includes(a) && !data.heroAbilities[a]?.type.startsWith('spawn_'))
        .slice(0, sectorHeroSlots(hero, data));
      fresh.heroes[id] = hero;
    }
    if (p.selectedHero && fresh.heroes[p.selectedHero]) fresh.selectedHero = p.selectedHero;
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
  const reward = base + tasks.bonus;
  const warrants = reward * WARRANTS_PER_REWARD;
  const firstWin = !!won && !!chapter.id && !progress.chaptersWon.includes(chapter.id);
  // Дубли и чертежи (SZE-5.3): бросок от сида профиля и номера попытки — повторный засчёт
  // того же забега невозможен (проверка выше), перезагрузка итог не перекатывает.
  const loot = runLoot({
    seed: progress.seed,
    attempt,
    modules: progress.modules,
    won: !!won,
    newTasks: Math.max(0, tasks.done.length - done.length),
    firstWinBlueprint: firstWin ? (chapter.blueprint ?? null) : null,
  });
  return {
    ...progress,
    research: progress.research + reward,
    ...addLoot(progress, loot),
    // Забег — кран ОБЕИХ валют (§2 роадмапа экономики): данные открывают горизонталь,
    // Варранты обслуживают вертикаль. Без второго крана Мастерская недостижима.
    warrants: progress.warrants + warrants,
    settledThrough: attempt,
    lastReward: reward,
    objectivesDone:
      chapter.id && tasks.done.length > done.length
        ? { ...progress.objectivesDone, [chapter.id]: tasks.done }
        : progress.objectivesDone,
    chaptersWon:
      won && chapter.id && !progress.chaptersWon.includes(chapter.id)
        ? [...progress.chaptersWon, chapter.id]
        : progress.chaptersWon,
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
  const selected = progress.heroes[progress.selectedHero];
  const def = data.heroes[progress.selectedHero];
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
        ...selected.skills.flatMap((skill) => data.heroSkillTrees[skill]?.grants.passive ?? []),
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

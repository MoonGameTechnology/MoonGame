/** Sector Zero's local roguelite progression. Deliberately independent of account
 * XP and the commander's PvP tree. Catalog abilities, skill requirements, module
 * compatibility and combat effects remain the shared game's rules. Prices below
 * are the first playable tuning, not the final campaign economy. */
import { forgeOutcome, type ForgeLadder } from './sectorZeroForge';
import {
  canEquip,
  starsOf,
  type GameData,
  type GameState,
  type Hero,
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
  /** Кошелёк Суверенов ◆ — золотая валюта (§0.1). Кран у неё ОДИН: покупка за деньги.
   *  ⚠️ IAP в продукте сегодня нет (`platform-adapters.md` его описывает, кода ноль),
   *  поэтому кошелёк честно стоит на нуле, а магазин отказывает `E_SHOP_UNAVAILABLE`.
   *  Поле заведено заранее не «на будущее», а чтобы витрина умела называть цену в
   *  Суверенах уже сейчас: `EC-2.3` требует показывать стоимость до возможности платить. */
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
  nextAttempt: number;
  settledThrough: number;
  lastReward: number;
  modules: string[];
  /** Звёздность модулей (SZE-1.1), `id → ★`: вертикальная ось Мастерской. Открытие
   *  модуля («Данные экспедиций») и его заточка («Варранты») — разные оси и разные
   *  валюты, §0.1 роадмапа экономики, поэтому звезда живёт здесь, а не в `modules`.
   *  Потолок — `data.sectorZeroStars.cap`; отсутствие записи = ★0. */
  stars: Record<string, number>;
  loadouts: Record<string, string[]>;
  heroes: Record<string, SectorHero>;
  selectedHero: string;
}
export const SECTOR_ZERO_PROGRESS_KEY = 'sector-zero.progress.v1';
export const HERO_UNLOCK_COST = 6;
export const MODULE_UNLOCK_COST = 3;
const GRADES = ['common', 'rare', 'legendary'] as const;
const STARTER_MODULES = ['cargo_bay', 'ion_engine'];

/** Лестница звёздности из каталога. Пустая (`cap` 0 / нет ступеней) = Мастерской и
 *  Академии в этой сборке нет — механика выключается ДАННЫМИ, без флага в коде. */
export function forgeLadderOf(data: GameData): ForgeLadder {
  return data.sectorZeroStars;
}

/** Множитель награды за забег, переведённый в Варранты (§2 роадмапа экономики: вторая
 *  половина награды). **v0**: забег с четырьмя волнами и победой даёт 40 ⌖, первая звезда
 *  стоит 20, полная лестница одного модуля — 695. Числа калибруются телеметрией. */
export const WARRANTS_PER_REWARD = 5;

export function freshSectorZeroProgress(data: GameData, seed = ''): SectorZeroProgress {
  const first = data.heroes.commander ? 'commander' : (Object.keys(data.heroes)[0] ?? '');
  const equipped = (data.heroes[first]?.startAbilities ?? [])
    .filter((id) => !data.heroAbilities[id]?.type.startsWith('spawn_'))
    .slice(0, 1);
  return {
    v: 1,
    seed,
    research: 0,
    warrants: 0,
    sovereigns: 0,
    forgeTries: {},
    forgeShards: {},
    nextAttempt: 1,
    settledThrough: 0,
    lastReward: 0,
    modules: STARTER_MODULES.filter((id) => data.modules[id]),
    stars: {},
    loadouts: {},
    heroes: first ? { [first]: { level: 1, skills: [], equipped } } : {},
    selectedHero: first,
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
    node.branch === data.heroes[progress.selectedHero]?.branch &&
    !hero.skills.includes(id) &&
    node.requires.every((r) => hero.skills.includes(r))
  );
}

export function sectorHullIds(data: GameData): string[] {
  return Object.keys(data.units).filter((id) => {
    const def = data.units[id]!;
    return def.domain === 'space' && id !== 'hero' && Object.values(def.slots).some((n) => n > 0);
  });
}

export type SectorProgressAction =
  | { kind: 'unlock-module'; id: string }
  | { kind: 'forge'; id: string }
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
        forgeLadderOf(data),
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
    case 'buy': {
      // Выдача и списание живут ВМЕСТЕ: разведи их — и однажды товар выдастся без оплаты.
      const offer = data.sectorZeroShop.offers[action.id];
      if (!offer) return null;
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
          if (!data.modules[offer.grants] || next.modules.includes(offer.grants)) return null;
          next.modules.push(offer.grants);
          break;
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
      next.heroes[action.id] = {
        level: 1,
        skills: [],
        equipped: def.startAbilities
          .filter((id) => !data.heroAbilities[id]?.type.startsWith('spawn_'))
          .slice(0, 1),
      };
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
        node.branch !== data.heroes[action.hero]?.branch ||
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
    fresh.warrants = counter(p.warrants);
    fresh.sovereigns = counter(p.sovereigns);
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
            node.branch === data.heroes[id]?.branch &&
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
  const reward = 1 + Math.max(0, state.pve.waveNumber) + (won ? 3 : 0);
  return {
    ...progress,
    research: progress.research + reward,
    // Забег — кран ОБЕИХ валют (§2 роадмапа экономики): данные открывают горизонталь,
    // Варранты обслуживают вертикаль. Без второго крана Мастерская недостижима.
    warrants: progress.warrants + reward * WARRANTS_PER_REWARD,
    settledThrough: attempt,
    lastReward: reward,
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
  player.arsenal = {
    hulls: Object.keys(data.units)
      .filter((id) => data.units[id]?.domain === 'space')
      .sort(),
    modules: [...progress.modules].sort(),
    ...(Object.keys(stars).length > 0 ? { stars } : {}),
  };
  for (const fleet of Object.values(next.fleets))
    if (fleet.owner === 'p1') {
      for (const stack of fleet.units) {
        stack.modules = [...(progress.loadouts[stack.unit] ?? [])];
        const own = starsOf(stack.modules, stars);
        if (own) stack.moduleStars = own;
        else delete stack.moduleStars;
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

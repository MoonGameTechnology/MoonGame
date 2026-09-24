/**
 * Витрина магазина Sector Zero (SZE-3.1) — что продаётся и чем за это можно заплатить.
 *
 * Чистое решение: ни DOM, ни хранилища, ни SDK площадки. Выдаёт покупку
 * `changeSectorZeroProgress`, рисует прототип, рекламу показывает адаптер площадки.
 *
 * ## Способ оплаты — это ДАННЫЕ
 *
 * Резолюция §0.4: магазин принимает Варранты, Суверены и просмотр рекламы — «деньги /
 * игра / время». Какими из трёх продаётся КОНКРЕТНЫЙ товар, знает сам товар
 * (`data/sectorZeroShop.json`, ключ отсутствует = этим способом не продаётся). Ветки
 * `if (kind === 'ad')` в коде витрины нет и заводить её не надо: добавить товар «только
 * за рекламу» должно быть правкой JSON.
 *
 * ## Способы, которых у площадки может не быть
 *
 * Суверены и просмотр рекламы приходят сюда через {@link ShopCapabilities} — флаги площадки,
 * а не её имя. Рекламу показывает адаптер площадки (`YAG-3.1`; в дев-сборке веба —
 * симуляция), покупок за деньги в продукте нет до `YAG-4.*`. Нет способа у площадки —
 * он честно отказывает кодом `E_SHOP_UNAVAILABLE`.
 *
 * Это прямое требование `platform-adapters.md`: «если `rewardedAds === false`, кнопка бонуса
 * за рекламу не показывается», и отсутствие рекламы — нормальное состояние, а не поломка
 * игрового цикла. Включение способа — смена флага, а не переписывание витрины.
 */
import type { GameData } from '../packages/shared-core/src/index';
import { hashUnit } from './sectorZeroForge';
import {
  sectorSkillLegal,
  SHOP_AD_REFRESHES_PER_DAY,
  WARRANTS_PER_REWARD,
  type SectorZeroProgress,
} from './sectorZeroProgress';

/** Чем платят. Перечисление закрытое: новый способ — это изменение экономики, а не данных. */
export type PayKind = 'warrants' | 'sovereigns' | 'ad';
export const PAY_KINDS: readonly PayKind[] = ['warrants', 'sovereigns', 'ad'];

/** Что умеет ПЛОЩАДКА, а не игра. Решения UI принимаются по capability, а не по имени
 *  площадки (`platform-adapters.md`) — поэтому флаги приходят снаружи. */
export interface ShopCapabilities {
  /** Есть ли на площадке покупки: без них Суверены неоткуда взять. */
  sovereigns: boolean;
  /** Показывает ли площадка rewarded-рекламу. */
  ads: boolean;
}

/** Почему платить нельзя. `null` = можно. */
export type ShopRefusal =
  | 'E_SHOP_OWNED'
  | 'E_SHOP_UNAVAILABLE'
  | 'E_SHOP_NOT_ENOUGH'
  | 'E_SHOP_LOCKED';

/** Одна цена товара: способ, сколько и можно ли им заплатить сейчас. */
export interface ShopPrice {
  kind: PayKind;
  /** Для валют — сколько списать; для `ad` — сколько просмотров нужно. */
  amount: number;
  /** Умеет ли этот способ ПЛОЩАДКА. Отдельно от {@link ShopPrice.can}, и это не
   *  дублирование: «площадка так не умеет» и «этот товар тебе сейчас нельзя» — разные
   *  факты с разными последствиями. Первый значит, что кнопки быть не должно вовсе
   *  (`platform-adapters.md`); второй — что кнопка есть, но погашена, и игрок видит цену.
   *  Смешай их в одно поле — и закрытый герою навык покажет кнопку за валюту, которой
   *  на площадке не существует. */
  available: boolean;
  can: boolean;
  reason: ShopRefusal | null;
}

/** Строка витрины. */
export interface ShopRow {
  id: string;
  kind: 'module' | 'skill' | 'resource' | 'blueprint';
  grants: string;
  /** Сколько выдаётся (значимо для ресурса). */
  amount: number;
  /** Уже есть — модуль открыт или узел навыка изучен. Ресурс «своим» не бывает. */
  owned: boolean;
  /** Цены в фиксированном порядке {@link PAY_KINDS} — только объявленные товаром. */
  prices: ShopPrice[];
}

/** Уже есть ли у игрока то, что даёт товар. Ресурс и чертёж выдаются всегда — они
 *  расходуемые. Открытый модуль «свой», но с SZE-5.3 продаётся ДУБЛЕМ (см. `shopRows`). */
export function offerOwned(
  row: Pick<ShopRow, 'kind' | 'grants'>,
  progress: SectorZeroProgress,
): boolean {
  if (row.kind === 'module') return progress.modules.includes(row.grants);
  // Навык покупается ВЫБРАННОМУ герою (`buy` → `selectedHero`), поэтому и «уже есть»
  // спрашивается у него: знание навыка другим героем покупку не закрывает.
  if (row.kind === 'skill')
    return progress.heroes[progress.selectedHero]?.skills.includes(row.grants) ?? false;
  return false;
}

/**
 * Витрина по профилю и возможностям площадки. Порядок строк — порядок каталога, порядок
 * цен — {@link PAY_KINDS}: и то и другое фиксировано, чтобы экран не прыгал между рендерами.
 *
 * Отказ НЕ прячет цену: `EC-2.3` требует, чтобы игрок понимал стоимость до того, как
 * сможет заплатить, — иначе неясно, на что копить и ради чего смотреть рекламу.
 */
export function shopRows(
  progress: SectorZeroProgress,
  data: GameData,
  caps: ShopCapabilities,
): ShopRow[] {
  const rows: ShopRow[] = [];
  // Витрина — та, что выпала НА ЭТИ сутки (`SZE-3.2`), а не весь каталог. Порядок задаёт
  // ротация и он фиксирован для дня: иначе экран прыгал бы между рендерами.
  for (const { id } of dailyOffers(progress.seed, progress.day, data, progress.shopRound)) {
    const offer = data.sectorZeroShop.offers[id];
    // Купленный сегодня лот ушёл с прилавка (`shopSold`) — до смены суток его нет.
    if (!offer || progress.shopSold.includes(id)) continue;
    const owned = offerOwned(offer, progress);
    // Узел навыка продаётся, только если его ВООБЩЕ можно изучить выбранному герою:
    // ветка и предпосылки — правила каталога, и деньги их не отменяют.
    const locked =
      offer.kind === 'skill' && !owned && !sectorSkillLegal(progress, offer.grants, data);
    const prices: ShopPrice[] = [];
    for (const kind of PAY_KINDS) {
      const amount = offer.prices[kind];
      if (amount === undefined) continue;
      const have = kind === 'warrants' ? progress.warrants : kind === 'sovereigns' ? progress.sovereigns : Infinity;
      const available = kind === 'ad' ? caps.ads : kind === 'sovereigns' ? caps.sovereigns : true;
      // Возможность площадки идёт ПЕРВОЙ: способа, которого у площадки нет, для игрока
      // не существует вовсе, и объяснять про него что-то ещё бессмысленно.
      // Открытый модуль не отказывает: он продаётся дублем для повышения редкости
      // (SZE-5.3, решение владельца 2026-09-24). «Уже есть» остаётся только у навыка.
      const reason: ShopRefusal | null = !available
        ? 'E_SHOP_UNAVAILABLE'
        : owned && offer.kind === 'skill'
          ? 'E_SHOP_OWNED'
          : locked
            ? 'E_SHOP_LOCKED'
            : have < amount
              ? 'E_SHOP_NOT_ENOUGH'
              : null;
      prices.push({ kind, amount, available, can: reason === null, reason });
    }
    rows.push({ id, kind: offer.kind, grants: offer.grants, amount: offer.amount, owned, prices });
  }
  return rows;
}

/* ------------------------------------------------------------------------- *
 * Суточная ротация (`SZE-3.2`)
 * ------------------------------------------------------------------------- */

/** Сколько миллисекунд в сутках. Часовые пояса сознательно НЕ учитываются: витрина
 *  «его» суток у каждого игрока своя, и привязка к UTC-полуночи ничего бы не добавила,
 *  кроме ночного обновления посреди сессии у половины мира. */
const DAY_MS = 86_400_000;

/**
 * Номер локальных суток из отметки времени. Время приходит ЧИСЛОМ снаружи — `decisions/`
 * обязаны оставаться чистыми, поэтому `Date.now()` живёт у хозяина, а не здесь.
 *
 * Отрицательное (часы выставлены до эпохи) читается как нулевой день: уходить в минус
 * незачем, а падать тем более.
 */
export function localShopDay(nowMs: number): number {
  if (!Number.isFinite(nowMs)) return 0;
  return Math.max(0, Math.floor(nowMs / DAY_MS));
}

/**
 * Подвинуть номер дня профиля, НИКОГДА не уменьшая его.
 *
 * ⚠️ Монотонность — это защита, а не аккуратность. Единственные часы у офлайнового
 * клиента — часы игрока, и наивное «какой сегодня день» означало бы: перевёл дату вперёд →
 * новая витрина → не понравилась → ещё раз, пока не выпадет нужное. Тот же класс, что
 * `SZE-0.3` закрыл у Мастерской, только вход другой.
 *
 * Поэтому: часы назад не меняют ничего, часы вперёд двигают витрину НАВСЕГДА и сжигают
 * промотанные дни вместе с их товаром. Накрутка не запрещена — она наказывает сама себя.
 *
 * Возвращает ТОТ ЖЕ объект, когда менять нечего: вызывающий по этому признаку решает,
 * надо ли сохранять профиль.
 */
export function advanceShopDay(
  progress: SectorZeroProgress,
  day: number,
): SectorZeroProgress {
  if (!Number.isSafeInteger(day) || day <= progress.day) return progress;
  // Новые сутки — новая суточная ротация, новое обновление за ролик (`SZE-3.4`) и новые
  // Суверены за ролик (`SZE-3.5`).
  return { ...progress, day, shopRound: 0, adSovereignsToday: 0, shopSold: [] };
}

/**
 * Способы оплаты по возможностям площадки (`SZE-3.5`).
 *
 * Суверены тратятся там, где их можно ПОЛУЧИТЬ: за деньги (IAP) или за ролик. До
 * `SZE-3.5` кран был один — покупка, и тратить разрешалось только при IAP; с роликами на
 * площадке без покупок игрок копил бы валюту, которую некуда деть. Реклама как способ
 * оплаты лота — по-прежнему только за `rewardedAds`.
 */
export function shopCapabilities(platform: {
  iap: boolean;
  rewardedAds: boolean;
}): ShopCapabilities {
  return { sovereigns: platform.iap || platform.rewardedAds, ads: platform.rewardedAds };
}

/**
 * Кнопка «Суверены за ролик» (`SZE-3.5`): порция, остаток на сегодня и состояние.
 *
 * `hidden` — у площадки нет рекламы или кран выключен данными: кнопки нет вовсе.
 * `used` — сегодняшние попытки кончились: погашена, но видна, возможность вернётся завтра.
 */
export function adSovereigns(
  progress: SectorZeroProgress,
  data: GameData,
  caps: ShopCapabilities,
): { state: 'hidden' | 'ready' | 'used'; amount: number; left: number } {
  const { amount, perDay } = data.sectorZeroShop.adSovereigns;
  const left = Math.max(0, perDay - progress.adSovereignsToday);
  if (!caps.ads || amount <= 0 || perDay <= 0) return { state: 'hidden', amount, left };
  return { state: left > 0 ? 'ready' : 'used', amount, left };
}

/**
 * Кнопка «обновить витрину за ролик» (`SZE-3.4`).
 *
 * `hidden` — у площадки рекламы нет: кнопки нет вовсе, погашенная обещала бы механику,
 * которой у игрока не будет никогда. `used` — сегодняшнее обновление потрачено: кнопка
 * видна, но погашена, чтобы было понятно, что возможность есть и вернётся завтра.
 */
export function shopRefresh(
  progress: SectorZeroProgress,
  caps: ShopCapabilities,
): 'hidden' | 'ready' | 'used' {
  if (!caps.ads) return 'hidden';
  return progress.shopRound < SHOP_AD_REFRESHES_PER_DAY ? 'ready' : 'used';
}

/**
 * Кнопка «удвоить награду за ролик» (`YAG-3.2`) и то, сколько она принесёт.
 *
 * `hidden` — у площадки нет рекламы, удваивать нечего или этот забег уже удвоен. Состояния
 * «погашена» здесь нет: удвоение принадлежит забегу, а не суткам, и «вернётся завтра»
 * было бы неправдой — оно вернётся со следующим забегом.
 */
export function doubleReward(
  progress: SectorZeroProgress,
  caps: ShopCapabilities,
): { state: 'hidden' | 'ready'; research: number; warrants: number } {
  const research = progress.lastReward;
  const warrants = research * WARRANTS_PER_REWARD;
  const open = research > 0 && progress.doubledThrough < progress.settledThrough;
  return { state: caps.ads && open ? 'ready' : 'hidden', research, warrants };
}

/** Лот витрины: сам товар плюс его id. */
export interface DailyOffer {
  id: string;
  weight: number;
}

/**
 * Витрина конкретных суток — ВЫВОДИТСЯ из `сид профиля ∥ номер дня`, а не хранится.
 * Список вычислим, значит переживёт перезагрузку без единого байта в сохранении.
 *
 * Отбор — взвешенный, БЕЗ возврата: каждому лоту считается ключ `hashUnit(сид ∥ день ∥ id)`,
 * и берутся `slots` лучших по `ключ^(1/вес)`. Это классический приём взвешенной выборки
 * одним проходом: вес поднимает шанс попасть наверх, но не гарантирует место, а повторов
 * не бывает по устройству — каждый лот участвует ровно раз.
 *
 * Сортировка по (ключу, затем id) — порядок фиксирован даже при совпадении ключей, иначе
 * витрина прыгала бы между рендерами одного и того же дня.
 *
 * `round` — раунд суток (`SZE-3.4`). ⚠️ Раунд 0 хешируется ПРЕЖНЕЙ строкой
 * `сид ∥ день ∥ id`, без номера: иначе в день выхода обновления витрина молча сменилась
 * бы у каждого существующего профиля. Раунды дальше дописывают номер в конец ключа.
 */
export function dailyOffers(seed: string, day: number, data: GameData, round = 0): DailyOffer[] {
  const shop = data.sectorZeroShop;
  const pool = Object.entries(shop.offers).filter(([, offer]) => offer.weight > 0);
  if (pool.length === 0 || shop.slots <= 0) return [];
  const scored = pool.map(([id, offer]) => ({
    id,
    weight: offer.weight,
    // `u^(1/w)`: чем больше вес, тем ближе значение к единице, то есть тем выше в списке.
    key: Math.pow(hashUnit(offerKey(seed, day, id, round)), 1 / offer.weight),
  }));
  scored.sort((a, b) => (b.key - a.key) || (a.id < b.id ? -1 : 1));
  return scored.slice(0, shop.slots).map(({ id, weight }) => ({ id, weight }));
}

/** Ключ броска лота. Раунд 0 — прежняя строка без номера (см. {@link dailyOffers}). */
function offerKey(seed: string, day: number, id: string, round: number): string {
  const base = `${seed}\u0000${day}\u0000${id}`;
  return round === 0 ? base : `${base}\u0000${round}`;
}

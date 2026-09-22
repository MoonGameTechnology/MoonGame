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
 * ## Чего здесь ЗАВЕДОМО нет
 *
 * ⚠️ Ни кошелька Суверенов, ни показа рекламы в продукте сегодня не существует: IAP и
 * `PlatformAds` описаны в `platform-adapters.md`, но в коде их ноль (сверено `rg`, ни один
 * `YAG-*` кирпич не закрыт). Поэтому оба способа приходят сюда ВЫКЛЮЧЕННЫМИ через
 * {@link ShopCapabilities} и честно отказывают кодом `E_SHOP_UNAVAILABLE`.
 *
 * Это не заглушка «как будто работает», а прямое требование `platform-adapters.md`:
 * «если `rewardedAds === false`, кнопка бонуса за рекламу не показывается», и отсутствие
 * рекламы — нормальное состояние, а не поломка игрового цикла. Когда адаптер появится,
 * включение обоих способов будет сменой флага, а не переписыванием витрины.
 */
import type { GameData } from '../packages/shared-core/src/index';
import { hashUnit } from './sectorZeroForge';
import {
  sectorSkillLegal,
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
  kind: 'module' | 'skill' | 'resource';
  grants: string;
  /** Сколько выдаётся (значимо для ресурса). */
  amount: number;
  /** Уже есть — модуль открыт или узел навыка изучен. Ресурс «своим» не бывает. */
  owned: boolean;
  /** Цены в фиксированном порядке {@link PAY_KINDS} — только объявленные товаром. */
  prices: ShopPrice[];
}

/** Уже есть ли у игрока то, что даёт товар. Ресурс выдаётся всегда — он расходуемый. */
export function offerOwned(
  row: Pick<ShopRow, 'kind' | 'grants'>,
  progress: SectorZeroProgress,
): boolean {
  if (row.kind === 'module') return progress.modules.includes(row.grants);
  if (row.kind === 'skill')
    return Object.values(progress.heroes).some((h) => h.skills.includes(row.grants));
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
  for (const { id } of dailyOffers(progress.seed, progress.day, data)) {
    const offer = data.sectorZeroShop.offers[id];
    if (!offer) continue;
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
      const reason: ShopRefusal | null = !available
        ? 'E_SHOP_UNAVAILABLE'
        : owned
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
  return { ...progress, day };
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
 */
export function dailyOffers(seed: string, day: number, data: GameData): DailyOffer[] {
  const shop = data.sectorZeroShop;
  const pool = Object.entries(shop.offers).filter(([, offer]) => offer.weight > 0);
  if (pool.length === 0 || shop.slots <= 0) return [];
  const scored = pool.map(([id, offer]) => ({
    id,
    weight: offer.weight,
    // `u^(1/w)`: чем больше вес, тем ближе значение к единице, то есть тем выше в списке.
    key: Math.pow(hashUnit(`${seed}\u0000${day}\u0000${id}`), 1 / offer.weight),
  }));
  scored.sort((a, b) => (b.key - a.key) || (a.id < b.id ? -1 : 1));
  return scored.slice(0, shop.slots).map(({ id, weight }) => ({ id, weight }));
}

/**
 * Аукцион хаба: как разложить лоты по категориям, плиткам и полке продавца.
 *
 * Устройство экрана — макет «Аукцион Void Dominion» (владелец 2026-11-03): вкладки
 * «Купить» и «Продать», полоса категорий, плитка на ТИП предмета с числом предложений
 * и самой низкой ценой, а у продавца — полка с открытыми и закрытыми местами.
 * Здесь только решения; разметка у `prototype/src/metaMarketScreen.ts`, лимит полки
 * применяет сервер (`packages/server/src/auctionShelf.ts`).
 */

export type AuctionCategory =
  'all' | 'weapon' | 'defense' | 'utility' | 'hull' | 'blueprint' | 'material';

/** Порядок кнопок на полосе категорий. */
export const AUCTION_CATEGORIES: readonly AuctionCategory[] = [
  'all',
  'weapon',
  'defense',
  'utility',
  'hull',
  'blueprint',
  'material',
];

export interface CategorizedItem {
  kind: 'module' | 'hull';
  form: 'instance' | 'blueprint';
  /** Тип отсека модуля из игровых данных; у корпуса нет. */
  slot?: string;
}

/** Категория предмета арсенала. Чертёж — своя категория, какой бы модуль он ни открывал:
 *  покупатель чертежа ищет именно чертёж. Модуль без известного отсека — «Системы». */
export function itemCategory(item: CategorizedItem): Exclude<AuctionCategory, 'all' | 'material'> {
  if (item.form === 'blueprint') return 'blueprint';
  if (item.kind === 'hull') return 'hull';
  return item.slot === 'weapon' ? 'weapon' : item.slot === 'defense' ? 'defense' : 'utility';
}

export function inCategory(selected: AuctionCategory, category: AuctionCategory): boolean {
  return selected === 'all' || selected === category;
}

export interface PricedOffer {
  id: string;
  price: number;
}

export interface OfferGroup<T extends PricedOffer> {
  key: string;
  /** Предложения от дешёвого к дорогому; при равной цене — по id, чтобы порядок не прыгал. */
  offers: T[];
  lowest: number;
}

/** Плитки «Купить»: одна на ключ типа (`keyOf`), сначала самые дешёвые. */
export function groupOffers<T extends PricedOffer>(
  offers: readonly T[],
  keyOf: (offer: T) => string,
): OfferGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const offer of offers) {
    const key = keyOf(offer);
    const list = groups.get(key);
    if (list) list.push(offer);
    else groups.set(key, [offer]);
  }
  return [...groups]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => a.price - b.price || a.id.localeCompare(b.id));
      return { key, offers: sorted, lowest: sorted[0]!.price };
    })
    .sort((a, b) => a.lowest - b.lowest || a.key.localeCompare(b.key));
}

export type ShelfSlot =
  { state: 'used'; index: number } | { state: 'free' } | { state: 'locked'; xp: number };

/**
 * Места полки по порядку: занятые (индекс в списке лотов), свободные, закрытые с порогом
 * опыта. Лотов может быть больше открытых мест — их выставили до появления полки, они
 * остаются видны и снимаются как обычно, а свободных мест тогда нет.
 */
export function shelfSlots(used: number, open: number, lockedXp: readonly number[]): ShelfSlot[] {
  const slots: ShelfSlot[] = [];
  for (let index = 0; index < used; index++) slots.push({ state: 'used', index });
  for (let n = used; n < open; n++) slots.push({ state: 'free' });
  for (const xp of lockedXp) slots.push({ state: 'locked', xp });
  return slots;
}

/** Остаток торгов «чч:мм:сс»; больше 99 часов не бывает (торги до 48 ч), меньше нуля — нули. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return parts.map((n) => String(n).padStart(2, '0')).join(':');
}

/** Меньше 10 минут — таймер подсвечивается: лот вот-вот уйдёт. */
export const AUCTION_HOT_MS = 600_000;

/** Шаг кнопок «−/+» у ставки: 5% от суммы, не меньше 1. Тот же шаг держит сервер
 *  (`BID_STEP_PERCENT` в `packages/server/src/metaAuction.ts`); здесь только подсказка. */
export function bidStep(amount: number): number {
  return Math.max(1, Math.ceil((Math.max(0, amount) * 5) / 100));
}

/** Сколько варрантов заморожено: лидирующие ставки и неисполненный остаток заказов. */
export function frozenWarrants(
  lots: readonly { leading: boolean; current?: number }[],
  orders: readonly { price: number; quantity: number; filled: number }[],
): number {
  const bids = lots.reduce((sum, l) => sum + (l.leading ? (l.current ?? 0) : 0), 0);
  return orders.reduce((sum, o) => sum + o.price * Math.max(0, o.quantity - o.filled), bids);
}

/**
 * Плитки «Купить» по макету: весь каталог в его порядке, у каждой плитки — группа
 * предложений или пусто («нет в продаже»). Предложение на тип вне каталога (чертёж,
 * корпус) идёт после каталога, чтобы ни один лот не пропал с экрана.
 */
export function catalogTiles<G extends { key: string }>(
  catalog: readonly string[],
  groups: readonly G[],
): Array<{ key: string; group?: G }> {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const known = new Set(catalog);
  return [
    ...catalog.map((key) => {
      const group = byKey.get(key);
      return group ? { key, group } : { key };
    }),
    ...groups.filter((g) => !known.has(g.key)).map((g) => ({ key: g.key, group: g })),
  ];
}

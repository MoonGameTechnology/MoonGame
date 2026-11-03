/**
 * Полка продавца на аукционе: сколько лотов аккаунт держит одновременно.
 *
 * Мест `base` сразу и по одному за каждый порог опыта из `unlockXp`
 * (`data/metaEconomy.json` → `market.shelf`; 3850 и 6750 опыта — это 12 и 16 уровни).
 * Лоты модулей и материалов делят одну полку. Сервер — единственный, кто её
 * применяет: клиент получает `open` и пороги закрытых мест только чтобы нарисовать их.
 */
export interface ShelfRule {
  base: number;
  unlockXp: readonly number[];
}

export interface ShelfView {
  /** Сколько мест открыто. */
  open: number;
  /** Пороги опыта ещё закрытых мест, по возрастанию. */
  lockedXp: number[];
}

export function shelfAt(rule: ShelfRule, xp: number): ShelfView {
  const thresholds = [...rule.unlockXp].sort((a, b) => a - b);
  const reached = thresholds.filter((t) => xp >= t).length;
  return { open: rule.base + reached, lockedXp: thresholds.slice(reached) };
}

/** Зависимость `shelf` для `registerMetaMarketApi`: без правила в каталоге — нет полки
 *  (действует прежний общий лимит), с правилом — полка по опыту аккаунта. */
export function shelfByXp(
  rule: ShelfRule | undefined,
  xpOf: (accountId: string) => Promise<number>,
): { shelf?: (accountId: string) => Promise<ShelfView> } {
  return rule ? { shelf: async (accountId) => shelfAt(rule, await xpOf(accountId)) } : {};
}

/**
 * «Магазин» хаба: что лежит на каждой полке и что говорит кнопка покупки (заказ владельца
 * 2026-10-20, макет одобрен: «норм, реализовывай»).
 *
 * Цены и запреты решает сервер (`MetaEconomy.storeTerms`): полка приходит уже оценённой
 * для ЭТОГО аккаунта — уже открытые модули выпали из цены набора, купленная дорожка сезона
 * помечена `owned`. Здесь только то, что клиент выводит из готового ответа:
 *
 * 1. **Кнопка не обещает того, что сервер отклонит.** Запрет сервера (`blocked`) сильнее
 *    баланса; нехватка показывается числом недостающих ◆, а не серой кнопкой без причины.
 * 2. **Пакеты Суверенов — товары Commerce за деньги площадки.** Пока провайдера оплаты
 *    нет, они видны (игрок знает, что будет) и честно недоступны.
 * 3. **Покрытие рецепта считается в единицах материала**, как прогресс в Арсенале
 *    (`recipeProgress`): «Ферросплавы 25 из 25 и ничего больше» — не 100% рецепта.
 * 4. **Выгода срока — к самому короткому сроку**, по цене дня: игрок сравнивает ровно это.
 *
 * Стили базы корпорации (полка «Стили») покупает глава для всей корпорации: их кнопку
 * решает `decisions/corpStyle.ts`, а не `buyState`.
 */
import type { CommerceOffer } from '../packages/protocol/src/commerce';
import type { MetaRecipeView, MetaStoreOfferView } from '../packages/protocol/src/metaEconomyView';

export const SHOP_TABS = ['sovereigns', 'premium', 'modules', 'materials', 'styles'] as const;
export type ShopTab = (typeof SHOP_TABS)[number];

const DAY = 86_400_000;

/** Пакеты Суверенов: товары Commerce с ◆ внутри, от меньшего к большему. */
export function sovereignPacks(offers: readonly CommerceOffer[]): CommerceOffer[] {
  return offers
    .filter((o) => (o.contents.sovereigns ?? 0) > 0)
    .sort((a, b) => packTotal(a) - packTotal(b));
}

/** Сколько ◆ придёт на счёт: база и подарок. */
export function packTotal(offer: CommerceOffer): number {
  return (offer.contents.sovereigns ?? 0) + (offer.contents.bonusSovereigns ?? 0);
}

/** Пакет с самой большой долей подарка — метка «Лучшая цена». */
export function bestPack(packs: readonly CommerceOffer[]): string | undefined {
  let best: CommerceOffer | undefined;
  let share = 0;
  for (const p of packs) {
    const s = (p.contents.bonusSovereigns ?? 0) / packTotal(p);
    if (s > share) [best, share] = [p, s];
  }
  return best?.productId;
}

/** Снабжение за рекламу — бесплатная полка «Материалов». */
export function adSupply(offers: readonly CommerceOffer[]): CommerceOffer | undefined {
  return offers.find((o) => o.source === 'rewarded_ad');
}

/** Полка вкладки в порядке каталога. У «Суверенов» полки витрины нет. */
export function shelf(store: readonly MetaStoreOfferView[], tab: ShopTab): MetaStoreOfferView[] {
  return tab === 'sovereigns' ? [] : store.filter((o) => o.category === tab);
}

export type BuyState =
  | { kind: 'buy' }
  | { kind: 'short'; lack: number }
  | { kind: 'blocked'; reason: NonNullable<MetaStoreOfferView['blocked']> };

/** Что говорит кнопка: запрет сервера, нехватка ◆ или «Купить» (правило 1). */
export function buyState(offer: MetaStoreOfferView, balance: number): BuyState {
  if (offer.blocked) return { kind: 'blocked', reason: offer.blocked };
  if (balance < offer.price) return { kind: 'short', lack: offer.price - balance };
  return { kind: 'buy' };
}

/** Скидка набора в процентах к сумме модулей поштучно; 0 без скидки. */
export function discountOf(offer: MetaStoreOfferView): number {
  if (!offer.fullPrice || offer.fullPrice <= offer.price) return 0;
  return Math.round((1 - offer.price / offer.fullPrice) * 100);
}

/** Какую долю каждого рецепта набор материалов закрывает сам, лучшие сначала (правило 3). */
export function recipeCoverage(
  materials: Readonly<Record<string, number>>,
  recipes: readonly MetaRecipeView[],
  limit = 3,
): Array<{ recipeId: string; defId: string; percent: number }> {
  return recipes
    .map((r) => {
      const need = r.ingredients.reduce((sum, i) => sum + i.required, 0);
      const got = r.ingredients.reduce(
        (sum, i) => sum + Math.min(i.required, materials[i.materialId] ?? 0),
        0,
      );
      return { recipeId: r.id, defId: r.defId, percent: need ? Math.floor((got / need) * 100) : 0 };
    })
    .filter((c) => c.percent > 0)
    .sort((a, b) => b.percent - a.percent)
    .slice(0, limit);
}

/** Насколько срок дешевле самого короткого в пересчёте на день, % (правило 4). */
export function premiumSavings(plans: readonly MetaStoreOfferView[]): Record<string, number> {
  const terms = plans.filter((p) => p.premiumDays);
  const base = terms.reduce<MetaStoreOfferView | undefined>(
    (min, p) => (!min || p.premiumDays! < min.premiumDays! ? p : min),
    undefined,
  );
  const out: Record<string, number> = {};
  if (!base) return out;
  const basePerDay = base.price / base.premiumDays!;
  for (const p of terms) {
    const saving = Math.round((1 - p.price / p.premiumDays! / basePerDay) * 100);
    if (saving > 0) out[p.id] = saving;
  }
  return out;
}

/** Полных и начатых дней премиума впереди; 0 без премиума. */
export function premiumDaysLeft(until: number | null | undefined, now: number): number {
  return until && until > now ? Math.ceil((until - now) / DAY) : 0;
}

/** Товар поштучно для модуля из Арсенала — пока его ещё можно купить. */
export function moduleOfferFor(
  store: readonly MetaStoreOfferView[],
  defId: string,
): MetaStoreOfferView | undefined {
  return store.find(
    (o) =>
      o.category === 'modules' &&
      !o.blocked &&
      o.modules?.length === 1 &&
      o.modules[0]!.defId === defId,
  );
}

/** Что открыть на вкладке, пока игрок ничего не выбрал: первое, что можно купить, иначе первое. */
export function defaultPick(ids: ReadonlyArray<{ id: string; open: boolean }>): string | undefined {
  return (ids.find((x) => x.open) ?? ids[0])?.id;
}

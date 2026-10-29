/**
 * Стиль базы корпорации (CORP-14, заказ владельца 2026-10-27: «Имперскую готику и хайтек
 * помести в магазин»). Стиль покупает глава за свои ◆ для всей корпорации; при смене главы
 * стиль остаётся у корпорации. Применяет стиль тоже глава. Здесь — что показать игроку в
 * магазине и на вкладке «Корпорация»:
 *
 * 1. **Что есть у корпорации, решает сервер** (`GET /meta-economy/corp-style`): клиент не
 *    помнит покупок. Стандартный стиль есть у каждой корпорации.
 * 2. **Кнопка не обещает того, что сервер отклонит.** Купить и применить может только глава;
 *    остальные видят, какой стиль применён и что у корпорации есть.
 * 3. **Нет ответа о корпорации — кнопка погашена.** Без него клиент не знает, глава ли
 *    игрок и куплен ли стиль.
 *
 * Фон базы (CORP-15, заказ владельца 2026-10-28) покупается и применяется так же, как стиль,
 * и стоит рядом с ним: применённый фон не снимает стиль. Правила те же.
 */
import {
  CORP_BACKDROP_STANDARD,
  CORP_STYLE_STANDARD,
  type MetaCorpStyleView,
} from '../packages/protocol/src/corpStyle';
import type { MetaStoreOfferView } from '../packages/protocol/src/metaEconomyView';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Ответ `GET /meta-economy/corp-style`: `null` — игрок не в корпорации, `undefined` —
 *  ответа нет или его не разобрать (правило 3). */
export function parseCorpStyle(raw: unknown): MetaCorpStyleView | null | undefined {
  if (!isObj(raw) || !('corp' in raw)) return undefined;
  const corp = raw.corp;
  if (corp === null) return null;
  if (
    !isObj(corp) ||
    typeof corp.head !== 'boolean' ||
    typeof corp.active !== 'string' ||
    typeof corp.backdrop !== 'string' ||
    !Array.isArray(corp.owned) ||
    !corp.owned.every((style) => typeof style === 'string')
  )
    return undefined;
  return {
    head: corp.head,
    active: corp.active,
    backdrop: corp.backdrop,
    owned: [...(corp.owned as string[])],
  };
}

/** Что продаёт товар корпорации: id стиля или фона; `undefined` — товар не для базы. */
export function corpLook(
  offer: Pick<MetaStoreOfferView, 'corpStyle' | 'corpBackdrop'>,
): string | undefined {
  return offer.corpStyle ?? offer.corpBackdrop;
}

/** Стиль или фон у корпорации есть: куплен или бесплатный (правило 1). */
export function corpOwnsStyle(view: MetaCorpStyleView, style: string): boolean {
  return (
    style === CORP_STYLE_STANDARD || style === CORP_BACKDROP_STANDARD || view.owned.includes(style)
  );
}

/** Карточка стиля или фона на вкладке «Корпорация»: применён; можно применить (глава); есть у
 *  корпорации; купить в магазине (глава); не куплен. */
export type CorpStyleCard = 'applied' | 'apply' | 'owned' | 'shop' | 'locked';

export function corpStyleCard(view: MetaCorpStyleView, style: string): CorpStyleCard {
  if (style === view.active || style === view.backdrop) return 'applied';
  if (corpOwnsStyle(view, style)) return view.head ? 'apply' : 'owned';
  return view.head ? 'shop' : 'locked';
}

/** Кнопка стиля или фона в магазине. `offline` — нет ответа о корпорации, `corp` — игрок не в
 *  корпорации, `head` — покупает глава, `owned` — стиль уже у корпорации, а игрок не глава. */
export type StyleOfferState =
  | { kind: 'buy' }
  | { kind: 'short'; lack: number }
  | { kind: 'apply' }
  | { kind: 'applied' }
  | { kind: 'blocked'; reason: 'offline' | 'corp' | 'head' | 'owned' };

export function styleOfferState(
  offer: MetaStoreOfferView,
  corp: MetaCorpStyleView | null | undefined,
  balance: number,
): StyleOfferState {
  const style = corpLook(offer) ?? '';
  if (corp === undefined) return { kind: 'blocked', reason: 'offline' };
  if (corp === null) return { kind: 'blocked', reason: 'corp' };
  const card = corpStyleCard(corp, style);
  if (card === 'applied' || card === 'apply') return { kind: card };
  if (card === 'owned') return { kind: 'blocked', reason: 'owned' };
  if (card === 'locked') return { kind: 'blocked', reason: 'head' };
  if (balance < offer.price) return { kind: 'short', lack: offer.price - balance };
  return { kind: 'buy' };
}

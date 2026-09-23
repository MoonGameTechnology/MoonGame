import { RARITIES, type GameData } from '../packages/shared-core/src/index';
import { moduleRarity } from './itemRarity';
import type { ShopRow } from './sectorZeroShop';

/**
 * Главное предложение витрины (PVR-6.7): одна карточка крупнее остальных — то, ради чего
 * стоит заглянуть сегодня. Витрина и так ротируется посуточно (`SZE-3.2`), так что это
 * «предложение дня» без отдельного таймера.
 *
 * Правило: только то, что можно купить хоть одним способом площадки и чего у игрока ещё
 * нет (выделять уже купленное или непродаваемое — обещать то, чего не будет). Среди таких —
 * самый редкий модуль; узел навыка стоит как «уникальный» (он открывает способность, а не
 * число); ресурс — ниже всех. Равенство решает порядок витрины, чтобы выбор не прыгал.
 * Нечего выделить — `null`, и витрина рисуется ровной сеткой.
 */
export function featuredOffer(rows: readonly ShopRow[], data: GameData): string | null {
  let best: { id: string; rank: number } | null = null;
  for (const row of rows) {
    if (row.owned || !row.prices.some((price) => price.available)) continue;
    const rank =
      row.kind === 'module'
        ? RARITIES.indexOf(moduleRarity(data.modules[row.grants]))
        : row.kind === 'skill'
          ? RARITIES.indexOf('unique')
          : -1;
    if (!best || rank > best.rank) best = { id: row.id, rank };
  }
  return best?.id ?? null;
}

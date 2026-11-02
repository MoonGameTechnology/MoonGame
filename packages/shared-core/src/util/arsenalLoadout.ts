import { RARITIES } from '../data/schemas';
import type { ArsenalItem } from '../data/arsenalSchema';
import type { GameState, PlayerArsenal } from '../state/gameState';
import type { CompletePayload } from '../state/construction';

/** A preference wins, then stars, rarity and a stable identity break ties. */
export function buildModuleCopies(items: readonly ArsenalItem[]): ArsenalItem[] {
  const chosen = new Map<string, ArsenalItem>();
  for (const item of [...items]
    .filter((i) => i.kind === 'module' && i.durability !== 0)
    .sort(
      (a, b) =>
        Number(!!b.preferred) - Number(!!a.preferred) ||
        (b.grade ?? 0) - (a.grade ?? 0) ||
        RARITIES.indexOf(b.rarity ?? 'simple') - RARITIES.indexOf(a.rarity ?? 'simple') ||
        (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0),
    )) {
    if (!chosen.has(item.defId)) chosen.set(item.defId, item);
  }
  return [...chosen.values()].sort((a, b) => (a.defId < b.defId ? -1 : a.defId > b.defId ? 1 : 0));
}

/** Admission-time value snapshot. An empty object deliberately pins ★0. */
export function constructionModuleSnapshot(
  modules: readonly string[] | undefined,
  arsenal?: PlayerArsenal,
): { stars: Record<string, number>; rarity: Record<string, string> } {
  return {
    stars: Object.fromEntries(
      (modules ?? []).filter((id) => arsenal?.stars?.[id]).map((id) => [id, arsenal!.stars![id]!]),
    ),
    rarity: Object.fromEntries(
      (modules ?? [])
        .filter((id) => arsenal?.rarity?.[id])
        .map((id) => [id, arsenal!.rarity![id]!]),
    ),
  };
}

export function completionModuleSnapshot(
  order: {
    moduleSnapshot?: { stars: Record<string, number>; rarity: Record<string, string> };
    modules?: string[];
  },
  arsenal?: PlayerArsenal,
): { stars: Record<string, number>; rarity: Record<string, string> } {
  return order.moduleSnapshot ?? constructionModuleSnapshot(order.modules, arsenal);
}

/** Pin pre-migration orders and heroes before replacing their old arsenal values. */
export function pinLegacyModuleSnapshots(
  state: GameState,
  playerId: string,
  arsenal: PlayerArsenal,
): void {
  const pinOrder = (order: CompletePayload) => {
    if (order.kind === 'unit' && order.playerId === playerId)
      order.moduleSnapshot ??= constructionModuleSnapshot(order.modules, arsenal);
  };
  for (const event of state.scheduled) {
    if (event.type === 'construction.complete' && event.payload)
      pinOrder(event.payload as CompletePayload);
  }
  for (const planet of Object.values(state.planets)) {
    for (const order of planet.buildQueue ?? []) pinOrder(order);
    for (const order of planet.pausedConstruction ?? []) pinOrder(order);
  }
  for (const hero of Object.values(state.heroes ?? {}))
    if (hero.owner === playerId)
      hero.moduleSnapshot ??= constructionModuleSnapshot(hero.modules, arsenal);
}

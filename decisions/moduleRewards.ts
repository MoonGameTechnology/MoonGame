import { RARITIES, type ArsenalItem } from '../packages/shared-core/src/index';

export interface ModuleReward {
  kind: 'received' | 'upgraded' | 'rarity';
  item: ArsenalItem;
  previousGrade: number;
  previousRarity?: ArsenalItem['rarity'];
}

/** Compare confirmed inventories, never a preview or an optimistic write. The first
 * read establishes a baseline: an existing collection is not a new reward. */
export function moduleRewards(
  previous: readonly ArsenalItem[] | null,
  current: readonly ArsenalItem[],
): ModuleReward[] {
  if (previous === null) return [];
  const before = new Map(previous.map((item) => [item.itemId, item]));
  return current.flatMap((item): ModuleReward[] => {
    if (item.kind !== 'module' || item.origin === 'rent') return [];
    const old = before.get(item.itemId);
    if (!old || old.defId !== item.defId || old.kind !== item.kind)
      return item.origin === 'starter' ? [] : [{ kind: 'received', item, previousGrade: 0 }];
    const previousGrade = old.grade ?? 0;
    if ((item.grade ?? 0) > previousGrade) return [{ kind: 'upgraded', item, previousGrade }];
    return item.rarity && RARITIES.indexOf(item.rarity) > RARITIES.indexOf(old.rarity ?? 'simple')
      ? [{ kind: 'rarity', item, previousGrade, previousRarity: old.rarity }] : [];
  });
}

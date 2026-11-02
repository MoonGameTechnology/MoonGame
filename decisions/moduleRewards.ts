import type { ArsenalItem } from '../packages/shared-core/src/index';

export interface ModuleReward {
  kind: 'received' | 'upgraded';
  item: ArsenalItem;
  previousGrade: number;
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
    return (item.grade ?? 0) > previousGrade ? [{ kind: 'upgraded', item, previousGrade }] : [];
  });
}

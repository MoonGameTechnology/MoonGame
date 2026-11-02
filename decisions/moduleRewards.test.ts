import { expect, it } from 'vitest';
import type { ArsenalItem } from '../packages/shared-core/src/index';
import { moduleRewards } from './moduleRewards';
const item = (over: Partial<ArsenalItem> = {}): ArsenalItem => ({
  itemId: 'one',
  defId: 'shield_booster',
  kind: 'module',
  form: 'instance',
  origin: 'craft',
  acquiredAt: 1,
  soulbound: false,
  ...over,
});
it('baselines an existing collection, but celebrates new copies after an empty inventory', () => {
  expect(moduleRewards(null, [item()])).toEqual([]);
  expect(moduleRewards([], [item()])).toEqual([
    { kind: 'received', item: item(), previousGrade: 0 },
  ]);
  expect(moduleRewards([item()], [item(), item({ itemId: 'two' })])).toHaveLength(1);
});
it('celebrates only a real increase on the same module and preserves both grades', () => {
  const before = [item({ grade: 1 })];
  const after = [item({ grade: 3 })];
  expect(moduleRewards(before, after)).toEqual([
    { kind: 'upgraded', item: after[0], previousGrade: 1 },
  ]);
  expect(moduleRewards(after, after)).toEqual([]);
  expect(moduleRewards(after, before)).toEqual([]);
  expect(before[0]!.grade).toBe(1);
});
it('does not turn durability changes, removals, starter kits, hulls or rentals into rewards', () => {
  expect(moduleRewards([item()], [item({ durability: 3 })])).toEqual([]);
  expect(moduleRewards([item()], [])).toEqual([]);
  expect(
    moduleRewards(
      [],
      [item({ origin: 'starter' }), item({ origin: 'rent' }), item({ kind: 'hull' })],
    ),
  ).toEqual([]);
});
it('a different new instance with more stars is a receipt, not a fictitious upgrade', () => {
  expect(moduleRewards([item({ grade: 1 })], [item({ itemId: 'two', grade: 2 })])[0]?.kind).toBe(
    'received',
  );
});

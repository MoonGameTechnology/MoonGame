import { beforeAll, expect, it } from 'vitest';
import { setLocale } from '../../localization/runtime';
import type { ArsenalItem } from '../../packages/shared-core/src/index';
import { moduleRewardHtml } from './moduleRewards';
beforeAll(() => setLocale('ru'));
const item: ArsenalItem = {
  itemId: 'one',
  kind: 'module',
  form: 'instance',
  defId: 'shield_booster',
  grade: 3,
  origin: 'craft',
  soulbound: false,
  acquiredAt: 1,
};
it('shows the confirmed grade transition and animates only newly gained stars', () => {
  const html = moduleRewardHtml({ kind: 'upgraded', item, previousGrade: 1 }, 1);
  expect(html).toContain('Новая звезда!');
  expect(html).toContain('1 → 3');
  expect(html.match(/class="mr-new"/g)).toHaveLength(2);
  expect(html.match(/class="mr-existing"/g)).toHaveLength(1);
  expect(html).not.toContain('disabled');
});
it('renders the receipt, rarity and queue without assigning stars to a blueprint', () => {
  const { grade: _grade, ...blueprint } = item;
  const html = moduleRewardHtml(
    { kind: 'received', item: { ...blueprint, form: 'blueprint' }, previousGrade: 0 },
    2,
  );
  expect(html).toContain('Модуль получен');
  expect(html).toContain('Ещё наград: 1');
  expect(html).not.toContain('★');
  expect(html).toContain('id="module-reward-title"');
});

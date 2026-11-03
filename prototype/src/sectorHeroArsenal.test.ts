import { beforeAll, expect, it } from 'vitest';
import { shippedGameData } from '../../data/bundle';
import { freshSectorZeroProgress } from '../../decisions/sectorZeroProgress';
import { setLocale } from '../../localization/runtime';
import { sectorHeroArsenalHtml, type HeroArsenalTab } from './sectorHeroArsenal';
import { arsenalHeroesHtml } from './arsenalHeroes';
import { heroRewardHtml } from './heroRewards';

const data = shippedGameData();
beforeAll(() => setLocale('ru'));
const p = freshSectorZeroProgress(data);
const html = (tab: HeroArsenalTab) =>
  sectorHeroArsenalHtml(
    p,
    data,
    { heroId: 'commander', tab, skill: null, fx: null },
    () => '<div data-test-ship></div>',
  );
it('корабль открыт в карточке своего героя, рядом способности и развитие', () => {
  expect(html('ship')).toContain('data-test-ship');
  expect(html('ship')).toContain('data-prep="hero-tab" data-id="battle"');
  expect(html('battle')).not.toContain('data-test-ship');
});
it('врождённые узлы уже изучены, закрытые имеют предпосылки, цена недоступна без средств', () => {
  const result = html('tree');
  expect(result).toContain('class="ha-skills"');
  expect(result).toMatch(/ha-skill owned[^>]+data-id="void_attunement"/);
  expect(result).toMatch(/ha-skill locked[^>]+data-id="overclocked_helm"/);
  expect(result).toMatch(/data-prep="skill"[^>]+disabled/);
});
it('закрытый герой и босс не получают доступ к оснащению', () => {
  const boss = Object.keys(data.heroes).find((id) => data.heroes[id]!.boss)!;
  expect(html('ship')).not.toContain(`data-prep="hero" data-id="${boss}"`);
  const closed = sectorHeroArsenalHtml(
    p,
    data,
    { heroId: 'vanguard', tab: 'ship', skill: null, fx: null },
    () => 'SHIP-SHOULD-NOT-RENDER',
  );
  expect(closed).not.toContain('SHIP-SHOULD-NOT-RENDER');
});
it('каталог хаба основной игры говорит о партии и не ведёт в Sector Zero', () => {
  const result = arsenalHeroesHtml('commander');
  expect(result).toContain('конкретной партии');
  expect(result).not.toContain('data-ar-hero-sector');
  expect(result).toContain('class="ar-hero-skills"');
  expect(result).not.toContain('undefined');
});
it('звёзды показывают точный переход, умение показывает эффект без вымышленных звёзд', () => {
  const star = heroRewardHtml(
    { kind: 'star', hero: 'commander', id: 'commander', from: 1, to: 3 },
    2,
    data,
  );
  expect(star).toContain('1 → 3');
  expect(star.match(/class="mr-new"/g)).toHaveLength(2);
  expect(star.match(/class="mr-existing"/g)).toHaveLength(1);
  const skill = heroRewardHtml(
    { kind: 'skill', hero: 'commander', id: 'neural_lace', from: 0, to: 1 },
    1,
    data,
  );
  expect(skill).toContain('Способность изучена!');
  expect(skill).not.toContain('★');
});

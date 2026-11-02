import { describe, expect, it } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { freshSectorZeroProgress, changeSectorZeroProgress } from './sectorZeroProgress';
import { heroRewards, matchHeroRewards } from './heroRewards';
import type { Hero } from '../packages/shared-core/src/index';

const data = shippedGameData();
describe('получение и развитие героев', () => {
  it('повторный снимок, перестановка модулей и расход валюты ничего не празднуют', () => {
    const p = freshSectorZeroProgress(data);
    const after = structuredClone(p);
    after.research = 1;
    after.heroes.commander!.ship = ['ion_engine'];
    after.heroes.commander!.equipped = [];
    expect(heroRewards(p, after, data)).toEqual([]);
    expect(heroRewards(p, p, data)).toEqual([]);
  });
  it('новый герой — одна награда, его врождённые умения не создают очередь дублей', () => {
    const p = freshSectorZeroProgress(data);
    const after = structuredClone(p);
    after.heroes.vanguard = { level: 0, skills: [], equipped: ['rally'] };
    expect(heroRewards(p, after, data)).toEqual([
      { kind: 'hero', hero: 'vanguard', id: 'vanguard', from: 0, to: 0 },
    ]);
  });
  it('реальные покупки дают новое умение и только успешное повышение звезды', () => {
    const p = freshSectorZeroProgress(data);
    p.research = 10000;
    p.heroTokens.commander = 100;
    const skill = changeSectorZeroProgress(
      p,
      { kind: 'skill', hero: 'commander', id: 'neural_lace' },
      data,
    )!;
    expect(skill).not.toBeNull();
    expect(heroRewards(p, skill, data)).toEqual([
      { kind: 'skill', hero: 'commander', id: 'neural_lace', from: 0, to: 1 },
    ]);
    const starred = changeSectorZeroProgress(
      skill,
      { kind: 'upgrade-hero', id: 'commander' },
      data,
    )!;
    expect(heroRewards(skill, starred, data)).toEqual([
      {
        kind: 'star',
        hero: 'commander',
        id: 'commander',
        from: skill.heroes.commander!.level,
        to: starred.heroes.commander!.level,
      },
    ]);
    expect(heroRewards(starred, starred, data)).toEqual([]);
  });
  it('босс, неизвестный каталог и понижение не считаются наградой', () => {
    const p = freshSectorZeroProgress(data);
    const after = structuredClone(p);
    after.heroes.commander!.level = 0;
    after.heroes.unknown = { level: 3, skills: [], equipped: [] };
    const boss = Object.keys(data.heroes).find((id) => data.heroes[id]!.boss)!;
    after.heroes[boss] = { level: 3, skills: [], equipped: [] };
    expect(heroRewards(p, after, data)).toEqual([]);
  });
  it('в партии учитываются экземпляры героев и подтверждённое изучение, не экипировка', () => {
    const hero: Hero = {
      id: 'one',
      owner: 'p1',
      location: 'home',
      cooldowns: {},
      archetype: 'commander',
      skills: [],
    };
    expect(matchHeroRewards([hero], [{ ...hero, equipped: ['scan'] }], data)).toEqual([]);
    expect(matchHeroRewards([hero], [{ ...hero, skills: ['neural_lace'] }], data)).toHaveLength(1);
    expect(matchHeroRewards([hero], [hero, { ...hero, id: 'two' }], data)).toEqual([
      { kind: 'hero', hero: 'commander', id: 'commander', from: 0, to: 0 },
    ]);
  });
});

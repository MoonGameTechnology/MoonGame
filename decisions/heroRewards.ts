import { knownSkillNodes, type GameData, type Hero } from '../packages/shared-core/src/index';
import type { SectorZeroProgress } from './sectorZeroProgress';

/** Только фактическое развитие; смена оснащения, расход валюты и повторный снимок — тишина. */
export interface HeroReward {
  kind: 'hero' | 'star' | 'skill';
  hero: string;
  id: string;
  from: number;
  to: number;
}

export function matchHeroRewards(
  before: readonly Hero[],
  after: readonly Hero[],
  data: GameData,
): HeroReward[] {
  const result: HeroReward[] = [];
  for (const hero of after) {
    const id = hero.archetype;
    if (!id || !data.heroes[id] || data.heroes[id]!.boss) continue;
    const previous = before.find((old) => old.id === hero.id);
    if (!previous) result.push({ kind: 'hero', hero: id, id, from: 0, to: 0 });
    else {
      const known = knownSkillNodes(previous.skills ?? [], id, data);
      for (const skill of knownSkillNodes(hero.skills ?? [], id, data))
        if (!known.has(skill) && data.heroSkillTrees[skill])
          result.push({ kind: 'skill', hero: id, id: skill, from: 0, to: 1 });
    }
  }
  return result;
}

export function heroRewards(
  before: Pick<SectorZeroProgress, 'heroes'>,
  after: Pick<SectorZeroProgress, 'heroes'>,
  data: GameData,
): HeroReward[] {
  const result: HeroReward[] = [];
  for (const [id, hero] of Object.entries(after.heroes)) {
    if (!data.heroes[id] || data.heroes[id]!.boss) continue;
    const previous = before.heroes[id];
    if (!previous) {
      result.push({ kind: 'hero', hero: id, id, from: 0, to: hero.level });
      continue; // Врождённые способности входят в карточку полученного героя.
    }
    if (hero.level > previous.level)
      result.push({ kind: 'star', hero: id, id, from: previous.level, to: hero.level });
    const known = knownSkillNodes(previous.skills, id, data);
    for (const skill of knownSkillNodes(hero.skills, id, data))
      if (!known.has(skill) && data.heroSkillTrees[skill])
        result.push({ kind: 'skill', hero: id, id: skill, from: 0, to: 1 });
  }
  return result;
}

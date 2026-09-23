import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { CHAPTER_HEROES, chapterHero, grantChapterHeroes, heroChapter } from './heroRecruits';
import { freshSectorZeroProgress } from './sectorZeroProgress';

const data = shippedGameData();
const fresh = () => freshSectorZeroProgress(data);

describe('герои за главы Sector Zero', () => {
  it('каждый герой-награда есть в каталоге и не совпадает со стартовым', () => {
    const start = Object.keys(fresh().heroes);
    for (const id of CHAPTER_HEROES) {
      expect(data.heroes[id]).toBeDefined();
      expect(start).not.toContain(id);
    }
    expect(new Set(CHAPTER_HEROES).size).toBe(CHAPTER_HEROES.length);
  });

  it('номер главы ↔ герой читаются в обе стороны', () => {
    expect(chapterHero(0)).toBe(CHAPTER_HEROES[0]);
    expect(heroChapter(CHAPTER_HEROES[1]!)).toBe(1);
    expect(chapterHero(99)).toBeNull();
    expect(chapterHero(0.5)).toBeNull();
    expect(heroChapter('commander')).toBeNull();
  });

  it('победа в главе приводит её героя; без победы — никого', () => {
    const p = fresh();
    expect(grantChapterHeroes(p, ['m1', 'm2'], data).progress).toBe(p);
    const won = { ...p, chaptersWon: ['m2'] };
    const r = grantChapterHeroes(won, ['m1', 'm2'], data);
    expect(r.joined).toEqual([CHAPTER_HEROES[1]]);
    expect(r.progress.heroes[CHAPTER_HEROES[1]!]).toMatchObject({ level: 1, skills: [] });
    expect(r.progress.heroes[CHAPTER_HEROES[0]!]).toBeUndefined();
  });

  it('герой уже в отряде (куплен или пришёл раньше) — второй раз не приходит и не сбрасывается', () => {
    const hero = CHAPTER_HEROES[0]!;
    const p = {
      ...fresh(),
      chaptersWon: ['m1'],
      heroes: { ...fresh().heroes, [hero]: { level: 3, skills: ['x'], equipped: [] } },
    };
    const r = grantChapterHeroes(p, ['m1'], data);
    expect(r.joined).toEqual([]);
    expect(r.progress).toBe(p);
  });

  it('старый профиль с выигранными главами догоняет наград при чтении', () => {
    const p = { ...fresh(), chaptersWon: ['m1', 'm2'] };
    expect(grantChapterHeroes(p, ['m1', 'm2'], data).joined).toEqual(CHAPTER_HEROES.slice(0, 2));
  });
});

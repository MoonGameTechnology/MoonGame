import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { CHAPTER_HEROES, chapterHero, grantChapterHeroes, heroChapter } from './heroRecruits';
import { pveState } from '../packages/client/src/gameData';
import {
  changeSectorZeroProgress,
  freshSectorZeroProgress,
  HERO_UNLOCK_COST,
  newSectorHero,
  prepareSectorZeroRun,
} from './sectorZeroProgress';

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

  it('решение владельца 2026-09-24: глава I — Учёный, II — Авангард, III — Страж', () => {
    expect(CHAPTER_HEROES).toEqual(['scientist', 'vanguard', 'warden']);
    // Разрушитель — только покупка: за главу он больше не приходит, но купить его можно.
    expect(heroChapter('ravager')).toBeNull();
    const p = { ...fresh(), research: HERO_UNLOCK_COST };
    const bought = changeSectorZeroProgress(p, { kind: 'unlock-hero', id: 'ravager' }, data);
    expect(bought?.heroes.ravager).toBeDefined();
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

describe('Учёный — пятый герой (решение владельца 2026-09-24)', () => {
  it('навыки надеваются, врождённый один: у каждого героя не больше одной пассивки со старта', () => {
    for (const [id, def] of Object.entries(data.heroes))
      expect([id, def.startPassives.length <= 1]).toEqual([id, true]);
    const def = data.heroes.scientist!;
    expect(def.startPassives).toHaveLength(1);
    expect(data.heroPassives[def.startPassives[0]!]).toBeDefined();
    expect(def.startAbilities.length).toBeGreaterThan(1); // есть что надевать и менять
  });

  it('приходит с первой способностью в слоте и везёт в забег врождённое и весь пул', () => {
    const def = data.heroes.scientist!;
    expect(newSectorHero('scientist', data).equipped).toEqual([def.startAbilities[0]]);
    const won = { ...fresh(), chaptersWon: ['m1'] };
    const joined = grantChapterHeroes(won, ['m1'], data).progress;
    const s = prepareSectorZeroRun(pveState(data), { ...joined, selectedHero: 'scientist' }, data);
    const hero = Object.values(s.heroes ?? {}).find((h) => h.owner === 'p1')!;
    expect(hero).toMatchObject({
      archetype: 'scientist',
      passives: def.startPassives,
      abilities: def.startAbilities,
      equipped: [def.startAbilities[0]],
    });
  });
});

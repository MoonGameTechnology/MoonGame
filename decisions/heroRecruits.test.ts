import { describe, it, expect } from 'vitest';
import { shippedGameData } from '../data/bundle';
import { CHAPTER_HEROES, chapterHero, grantChapterHeroes, heroChapter } from './heroRecruits';
import { pveState } from '../packages/client/src/gameData';
import {
  changeSectorZeroProgress,
  freshSectorZeroProgress,
  HERO_UNLOCK_COST,
  newSectorHero,
  parseSectorZeroProgress,
  prepareSectorZeroRun,
  sectorHeroSlotItems,
  sectorSlotItem,
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
  /** Врождённые — постоянные пассивки старта; надеваемые (`slotted`) сюда не входят. */
  const innateOf = (id: string): string[] =>
    data.heroes[id]!.startPassives.filter((p) => !data.heroPassives[p]?.slotted);
  const slottedOf = (id: string): string[] =>
    data.heroes[id]!.startPassives.filter((p) => data.heroPassives[p]?.slotted);

  it('навыки надеваются, врождённый один: у каждого героя не больше одной постоянной пассивки', () => {
    for (const id of Object.keys(data.heroes))
      expect([id, innateOf(id).length <= 1]).toEqual([id, true]);
    expect(innateOf('scientist')).toHaveLength(1);
    expect(data.heroes.scientist!.startAbilities.length).toBeGreaterThan(0);
  });

  it('вторая пассивка Учёного надевается: +10% к урону флота героя', () => {
    const slotted = slottedOf('scientist');
    expect(slotted).toHaveLength(1);
    const p = data.heroPassives[slotted[0]!]!;
    expect([p.hook, p.scope, p.params.bonus]).toEqual(['combat.damage', 'heroFleet', 0.1]);
  });

  it('пассивку надевают в Академии, профиль её помнит, в забеге она надета', () => {
    const passive = slottedOf('scientist')[0]!;
    let p = grantChapterHeroes({ ...fresh(), chaptersWon: ['m1'] }, ['m1'], data).progress;
    expect(sectorHeroSlotItems('scientist', p.heroes.scientist!, data)).toEqual(['scan', passive]);
    expect(sectorSlotItem(passive, data)?.name).toBe(data.heroPassives[passive]!.name);
    // Уровень 1 — один слот, в нём «Разведка»: снять её и надеть пассивку.
    p = changeSectorZeroProgress(p, { kind: 'ability', hero: 'scientist', id: 'scan' }, data)!;
    p = changeSectorZeroProgress(p, { kind: 'ability', hero: 'scientist', id: passive }, data)!;
    expect(p.heroes.scientist!.equipped).toEqual([passive]);
    expect(parseSectorZeroProgress(JSON.stringify(p), data).heroes.scientist!.equipped).toEqual([
      passive,
    ]);
    const s = prepareSectorZeroRun(pveState(data), { ...p, selectedHero: 'scientist' }, data);
    const hero = Object.values(s.heroes ?? {}).find((h) => h.owner === 'p1')!;
    expect(hero.equipped).toEqual([passive]);
    expect(hero.passives).toContain(passive);
    expect(hero.abilities).not.toContain(passive);
    // Постоянная пассивка — не предмет для слота: она и так работает всегда.
    expect(
      changeSectorZeroProgress(
        p,
        { kind: 'ability', hero: 'scientist', id: innateOf('scientist')[0]! },
        data,
      ),
    ).toBeNull();
  });

  it('решение владельца 2026-09-24: без «Ложного сигнала», врождённое — +10% трофеев', () => {
    // Фантомные цели видит только живой игрок на своём радаре; бот Роя читает мир как
    // есть, поэтому в Sector Zero способность бесполезна.
    const def = data.heroes.scientist!;
    expect(def.startAbilities).not.toContain('decoy_signal');
    const innate = data.heroPassives[def.startPassives[0]!]!;
    expect([innate.hook, innate.params.bonus]).toEqual(['salvage', 0.1]);
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

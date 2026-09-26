import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createInitialState, type GameState } from '../packages/shared-core/src/index';
import { shippedGameData } from '../data/bundle';

function newGame(): GameState {
  const s = createInitialState({ seed: 1, version: { data: '0.1.0', manifest: 'test' } });
  s.heroes = {};
  for (const owner of ['p1', 'p2']) {
    const fleetId = `${owner}-fleet`;
    s.fleets[fleetId] = {
      id: fleetId,
      owner,
      location: 'home',
      movement: null,
      traits: [],
      units: [{ unit: 'hero', count: 1 }],
    };
    s.heroes[owner] = {
      id: owner,
      owner,
      fleetId,
      location: 'home',
      cooldowns: {},
      archetype: 'commander',
    };
  }
  return s;
}
import {
  HERO_GRADE_COLORS,
  heroGradeColor,
  heroGradeGlyph,
  heroGradeKey,
  heroIdentity,
  mapHeroes,
} from './heroIdentity';

describe('hero map privacy and targeting', () => {
  it('never exposes an enemy identity from full solo state, even on an identified fleet', () => {
    const s = newGame();
    const visible = mapHeroes(s, 'p1');
    expect(visible.size).toBe(1);
    expect([...visible.values()].every((h) => h.owner === 'p1')).toBe(true);
    const own = [...visible.values()][0]!;
    own.alive = false;
    expect(mapHeroes(s, 'p1').size).toBe(0);
  });

  it('cannot keep a portrait after the ship is lost or ownership changes', () => {
    const s = newGame();
    const [id] = [...mapHeroes(s, 'p1').keys()];
    s.fleets[id!]!.owner = 'p2';
    expect(mapHeroes(s, 'p1').size).toBe(0);
    delete s.fleets[id!];
    expect(mapHeroes(s, 'p1').size).toBe(0);
  });

  it('редкость даёт цвет обводки, неизвестная степень опускается до common', () => {
    // HERO-12. Четыре степени — четыре РАЗНЫХ цвета: совпади два, игрок перестал бы
    // видеть разницу ровно там, где она и нужна.
    expect(new Set(Object.values(HERO_GRADE_COLORS)).size).toBe(
      Object.keys(HERO_GRADE_COLORS).length,
    );
    expect(Object.keys(HERO_GRADE_COLORS)).toEqual(['common', 'rare', 'legendary', 'main']);
    for (const [grade, color] of Object.entries(HERO_GRADE_COLORS)) {
      expect(heroGradeColor(grade)).toBe(color);
      expect(heroGradeKey(grade)).toBe(grade);
      expect(color).toMatch(/^#[0-9a-f]{6}$/); // канвас кладёт строку в `strokeStyle` как есть
    }
    // Степень есть не у всякого героя (`Hero.grade` необязателен) — и это не повод
    // не нарисовать обводку: падаем на `common`, как `heroGradeGlyph` рядом.
    expect(heroGradeKey(undefined)).toBe('common');
    expect(heroGradeKey('обломки')).toBe('common');
    expect(heroGradeColor(undefined)).toBe(HERO_GRADE_COLORS.common);
    expect(heroGradeGlyph(undefined)).toBe('\u25e6');
  });

  it('портрет героя на карте — без рамки (заказ владельца 2026-09-23)', () => {
    // Обводку редкости с карты сняли: редкость читается значком на щитке, а портрет
    // идёт без рамки. Выноска и щиток остаются цвета владельца — «чей это герой».
    const src = readFileSync(
      new URL('../packages/client/src/heroPortraits.ts', import.meta.url),
      'utf8',
    );
    expect(src).not.toContain('strokeRect(box.x');
    expect(src).not.toContain('heroGradeColor(');
    expect(src).toContain('heroGradeGlyph(hero.grade)');
  });

  it('unknown hero has no identity', () => {
    expect(heroIdentity('unknown')).toBeUndefined();
  });
});

describe('личность героя — у каждого героя каталога', () => {
  it('у каждого героя каталога есть личность, а значит и портрет', () => {
    // Босс Роя (PVR-4.7) — не герой игрока: к игроку он не приходит (Академия, жетоны,
    // профиль — `runBoss.test.ts`), а на карте чужого героя рисует корабль, не портрет.
    for (const [id, def] of Object.entries(shippedGameData().heroes)) {
      if (def.boss === true) continue;
      expect([id, heroIdentity(id) !== undefined]).toEqual([id, true]);
    }
  });

  it('Учёный: портрет — черновик вне атласа, имя не согласовано (sector-zero-roadmap §3.1.8)', () => {
    const scientist = heroIdentity('scientist')!;
    expect(scientist.cell).toBeUndefined();
    // Без личного имени панель героя показывает имя архетипа — выдумывать канон нельзя.
    expect(scientist.name).toBeUndefined();
    expect(scientist.bio).toBe('hero.person.scientist.bio');
  });
});

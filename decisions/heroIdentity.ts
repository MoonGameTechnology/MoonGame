/** Presentation identities, separate from the simulated archetypes and their balance. */
import type { GameState, Hero } from '../packages/shared-core/src/index';

export interface HeroIdentity {
  /** Клетка атласа `portraits.webp` (2×2). Нет — портрет лежит отдельным файлом
   *  (`packages/client/src/heroPortraits.ts`). */
  readonly cell?: number;
  /** Ключ личного имени. Нет — имя не согласовано, и показывается имя архетипа. */
  readonly name?: string;
  readonly bio: string;
}

export const HERO_IDENTITIES: Readonly<Record<string, HeroIdentity>> = {
  commander: { cell: 0, name: 'hero.person.commander.name', bio: 'hero.person.commander.bio' },
  ravager: { cell: 1, name: 'hero.person.ravager.name', bio: 'hero.person.ravager.bio' },
  vanguard: { cell: 2, name: 'hero.person.vanguard.name', bio: 'hero.person.vanguard.bio' },
  warden: { cell: 3, name: 'hero.person.warden.name', bio: 'hero.person.warden.bio' },
  // Пятый герой (решение владельца 2026-09-24). Портрет — отдельный файл вне атласа.
  // Имя не выдумываем: сюжет требует согласовать его (sector-zero-roadmap §3.1.8).
  scientist: { bio: 'hero.person.scientist.bio' },
};

export function heroIdentity(archetype: string | undefined): HeroIdentity | undefined {
  return archetype && Object.hasOwn(HERO_IDENTITIES, archetype)
    ? HERO_IDENTITIES[archetype]
    : undefined;
}

/** Solo hosts hold full state, while network hosts receive only their own heroes.
 * Use the same privacy boundary in both; an identified enemy ship is not its dossier. */
export function mapHeroes(state: GameState, me: string): Map<string, Hero> {
  return new Map(
    Object.values(state.heroes ?? {})
      .filter(
        (h) =>
          h.owner === me && h.alive !== false && h.fleetId && state.fleets[h.fleetId]?.owner === me,
      )
      .map((h) => [h.fleetId!, h]),
  );
}

/** Grades exist in the shipped game; hero levels do not. Never invent a level. */
export function heroGradeGlyph(grade: string | undefined): string {
  switch (grade) {
    case 'main':
      return '♛';
    case 'legendary':
      return '★';
    case 'rare':
      return '◈';
    default:
      return '◦';
  }
}

/**
 * Цвет РЕДКОСТИ героя (HERO-12, заказ владельца 2026-09-22): обводка портрета на карте
 * и в штабе берётся отсюда — и только отсюда.
 *
 * Один дом на канвас и на CSS намеренно. Разошлись бы они молча: канвас пишет цвет
 * строкой в `strokeStyle`, таблица стилей — в своей переменной `--hx-g-*`, и «золотой»
 * в двух местах оказался бы двумя разными золотыми, причём заметил бы это только игрок.
 * Собрать CSS из этой таблицы на сборке нельзя — `prototype/build.mjs` не тянет TS, —
 * поэтому копия в шапке сверяется С ЭТОЙ таблицей текстом: сторож в
 * `prototype/src/heroStaff.test.ts` читает `build.mjs` и требует посимвольного
 * совпадения. Правка цвета здесь без правки там роняет гейт.
 *
 * Почему это НЕ цвет владельца. На карте обводка владельца уже есть — это линия-выноска
 * и щиток со значком степени, они остаются цвета хозяина. Ответ на «чей герой» портрет
 * не теряет; редкость добавляется вторым, независимым сигналом. Подменять одно другим
 * нельзя: «чей» важнее «какой», и в бою его читают первым.
 *
 * Неизвестная степень опускается до `common` — ровно как `heroGradeGlyph` и как
 * `heroSkillSlots` в штабе: герой без степени рисуется скромно, но рисуется.
 */
export const HERO_GRADE_COLORS = {
  common: '#8fa6ad',
  rare: '#5aa9ff',
  legendary: '#e8b45a',
  main: '#b98cff',
} as const;

export type HeroGradeKey = keyof typeof HERO_GRADE_COLORS;

/** Степень в её ключ палитры; неизвестная — `common`. */
export function heroGradeKey(grade: string | undefined): HeroGradeKey {
  return grade !== undefined && Object.hasOwn(HERO_GRADE_COLORS, grade)
    ? (grade as HeroGradeKey)
    : 'common';
}

/** Цвет обводки для степени героя. */
export function heroGradeColor(grade: string | undefined): string {
  return HERO_GRADE_COLORS[heroGradeKey(grade)];
}

export interface PortraitHit {
  heroId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

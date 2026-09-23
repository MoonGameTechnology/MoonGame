import type { GameData } from '../packages/shared-core/src/index';
import { newSectorHero, type SectorZeroProgress } from './sectorZeroProgress';

/**
 * Откуда в Sector Zero берутся новые герои (решение владельца 2026-09-23).
 *
 * 1. **Герой — награда за главу.** Первая победа в главе приводит в отряд её героя. Цель
 *    видна заранее: на маршруте глав у главы стоит силуэт героя с подписью, кто придёт.
 *    Покупка за «Данные экспедиций» остаётся запасным путём и стоит дороже.
 * 2. **Порядок — строкой данных, а не условием в коде.** Новая глава с новым героем =
 *    одна строка в {@link CHAPTER_HEROES}. Героя, которого нет в каталоге, правило
 *    пропускает, а не роняет профиль.
 * 3. **Выдача — от ПОБЕД, а не от события «забег кончился».** Поэтому правило догоняет и
 *    старые профили: глава, выигранная до появления наград, приводит своего героя при
 *    первом же чтении профиля. Повторная победа второго героя не даёт — герой уже в отряде.
 */

/** Герой за первую победу в главе с этим номером (0 — первая глава). */
export const CHAPTER_HEROES: readonly string[] = ['ravager', 'vanguard', 'warden'];

/** Кто придёт за главу `index`, либо null — у главы героя-награды нет. */
export function chapterHero(index: number): string | null {
  return Number.isInteger(index) ? (CHAPTER_HEROES[index] ?? null) : null;
}

/** Номер главы, за которую приходит герой, либо null — его только покупают. */
export function heroChapter(heroId: string): number | null {
  const i = CHAPTER_HEROES.indexOf(heroId);
  return i < 0 ? null : i;
}

/**
 * Привести в отряд героев выигранных глав (правило 3). `chapterIds[i]` — id главы с
 * номером `i`. Возвращает тот же профиль, если приходить некому, — хост по ссылке
 * понимает, что сохранять нечего.
 */
export function grantChapterHeroes(
  progress: SectorZeroProgress,
  chapterIds: readonly string[],
  data: GameData,
): { progress: SectorZeroProgress; joined: string[] } {
  const joined = chapterIds.flatMap((id, index) => {
    const hero = chapterHero(index);
    return hero && data.heroes[hero] && !progress.heroes[hero] && progress.chaptersWon.includes(id)
      ? [hero]
      : [];
  });
  if (joined.length === 0) return { progress, joined };
  const heroes = { ...progress.heroes };
  for (const id of joined) heroes[id] = newSectorHero(id, data);
  return { progress: { ...progress, heroes }, joined };
}

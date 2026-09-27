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
 * 4. **Спасённый задачей главы герой приходит и без победы** (баг-репорт владельца
 *    2026-09-27: спас учёного, завершил экспедицию сам — задача засчитана, а в подготовке
 *    учёного нет). Смотрит правило, как и в п. 3, на профиль — на задачу в `objectivesDone`,
 *    поэтому уже засчитанное спасение догоняется при чтении профиля.
 */

/** Герой за первую победу в главе с этим номером (0 — первая глава). Решение владельца
 *  2026-09-24: глава I приводит Учёного — по сюжету его спасают в самом начале
 *  (sector-zero-roadmap §3.1.3), — II Авангарда, III Стража; Разрушитель — только покупка. */
export const CHAPTER_HEROES: readonly string[] = ['scientist', 'vanguard', 'warden'];

/** Кто придёт за главу `index`, либо null — у главы героя-награды нет. */
export function chapterHero(index: number): string | null {
  return Number.isInteger(index) ? (CHAPTER_HEROES[index] ?? null) : null;
}

/** Номер главы, за которую приходит герой, либо null — его только покупают. */
export function heroChapter(heroId: string): number | null {
  const i = CHAPTER_HEROES.indexOf(heroId);
  return i < 0 ? null : i;
}

/** Задача `objective` главы `chapter` спасает героя `hero` (правило 4). Список собирается
 *  из карт глав (`pveRescues` в `packages/client/src/gameData.ts`). */
export interface HeroRescue {
  chapter: string;
  objective: string;
  hero: string;
}

/**
 * Привести в отряд героев выигранных глав (правило 3) и спасённых задачами (правило 4).
 * `chapterIds[i]` — id главы с номером `i`. Возвращает тот же профиль, если приходить
 * некому, — хост по ссылке понимает, что сохранять нечего.
 */
export function grantChapterHeroes(
  progress: SectorZeroProgress,
  chapterIds: readonly string[],
  data: GameData,
  rescues: readonly HeroRescue[] = [],
): { progress: SectorZeroProgress; joined: string[] } {
  const won = chapterIds.flatMap((id, index) => {
    const hero = chapterHero(index);
    return hero && progress.chaptersWon.includes(id) ? [hero] : [];
  });
  const rescued = rescues.flatMap((r) =>
    (progress.objectivesDone[r.chapter] ?? []).includes(r.objective) ? [r.hero] : [],
  );
  const joined = [...new Set([...won, ...rescued])].filter((hero) => data.heroes[hero] && !progress.heroes[hero]);
  if (joined.length === 0) return { progress, joined };
  const heroes = { ...progress.heroes };
  for (const id of joined) heroes[id] = newSectorHero(id, data);
  return { progress: { ...progress, heroes }, joined };
}

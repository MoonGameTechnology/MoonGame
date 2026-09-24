/**
 * Жетоны героев Sector Zero (решения владельца 2026-09-23 и 2026-09-24): «будущие герои —
 * жетоны; 10 жетонов = герой; дубли идут в звёзды; жетоны нужны для звёздности; их можно
 * купить в магазине».
 *
 * 1. **Жетон принадлежит герою.** Счёт у каждого героя свой (`SectorZeroProgress.heroTokens`):
 *    жетоны Налётчика не поднимут Стража.
 * 2. **Звезда героя стоит жетоны.** Звёздность — это ступень героя (`SectorHero.level`,
 *    ★1–★3): звезда открывает слот под навык и ничего больше — статов не даёт
 *    (§0.396 `hero-progression-roadmap.md`). Данные экспедиций на героя больше не тратятся.
 * 3. **10 жетонов — герой.** Герой, которого приводят ТОЛЬКО жетоны, присоединяется, как
 *    только их набралось {@link HERO_TOKENS_TO_JOIN}; остаток идёт в его звёзды.
 * 4. **Жетоны падают тому, кому они нужны.** Своему герою ниже потолка звёзд или герою,
 *    которого приводят жетоны. Герой главы получает жетоны только ПОСЛЕ своей главы: иначе
 *    жетоны обгоняли бы награду за главу, и силуэт на маршруте перестал бы быть целью.
 * 5. **Бросок детерминирован** — тем же ключом, что дубли модулей (`moduleRarity.ts`): сид
 *    профиля, номер попытки и отпечаток итогового мира (AUD-26). Перезагрузка итог не
 *    перекатывает, прокрутка номера попытки героя не выбирает.
 */
import type { GameData } from '../packages/shared-core/src/index';
import { hashUnit } from './sectorZeroForge';
import { heroChapter } from './heroRecruits';
import { newSectorHero, type SectorZeroProgress } from './sectorZeroProgress';

/** Сколько жетонов приводит героя. */
export const HERO_TOKENS_TO_JOIN = 10;
/** Потолок звёзд героя: три ступени, как у лестницы подготовки. */
export const HERO_MAX_STARS = 3;
/** Цена звезды: `[★2, ★3]` — сколько жетонов стоит следующая звезда. **v0**. */
export const HERO_STAR_COSTS: readonly number[] = [10, 20];
/** Сколько жетонов падает за забег (решение владельца 2026-09-24). */
export const HERO_TOKEN_DROP = { run: 1, win: 2, perTask: 1 } as const;

/** Сколько жетонов стоит следующая звезда героя со ступенью `stars`; null — потолок. */
export function heroStarCost(stars: number): number | null {
  return HERO_STAR_COSTS[stars - 1] ?? null;
}

/** Куда идут жетоны героя: в звёзды своего героя, в приход нового или никуда. */
export type TokenUse = 'star' | 'join' | null;

/**
 * Нужны ли жетоны этому герою. `null` — не нужны: героя нет в каталоге, звёзды на
 * потолке или это герой главы, которую ещё не прошли (правило 4).
 */
export function heroTokenUse(
  progress: Pick<SectorZeroProgress, 'heroes'>,
  id: string,
  data: GameData,
): TokenUse {
  if (!data.heroes[id]) return null;
  const hero = progress.heroes[id];
  if (hero) return hero.level < HERO_MAX_STARS ? 'star' : null;
  return heroChapter(id) === null ? 'join' : null;
}

/** Цель счётчика жетонов героя: 10 до прихода, цена следующей звезды после; null — потолок. */
export function heroTokenGoal(
  progress: Pick<SectorZeroProgress, 'heroes'>,
  id: string,
  data: GameData,
): number | null {
  const use = heroTokenUse(progress, id, data);
  if (use === 'join') return HERO_TOKENS_TO_JOIN;
  if (use === 'star') return heroStarCost(progress.heroes[id]!.level);
  return null;
}

/** Сколько жетонов даёт забег. */
export function heroTokenCount(won: boolean, newTasks: number): number {
  return (
    HERO_TOKEN_DROP.run +
    (won ? HERO_TOKEN_DROP.win : 0) +
    Math.max(0, newTasks) * HERO_TOKEN_DROP.perTask
  );
}

/**
 * Жетоны за забег: все одному герою из тех, кому они нужны, — одна понятная строка итога
 * («+4 жетона · Налётчик»), а не россыпь по одному. Никому не нужны — ничего не падает.
 */
export function rollHeroTokens(input: {
  seed: string;
  attempt: number;
  /** Отпечаток итогового мира (`hashState`, AUD-26): без него номер попытки выбирал бы,
   *  кому падают жетоны. */
  outcome: string;
  progress: Pick<SectorZeroProgress, 'heroes'>;
  data: GameData;
  won: boolean;
  newTasks: number;
}): Record<string, number> {
  const wanted = Object.keys(input.data.heroes)
    .filter((id) => heroTokenUse(input.progress, id, input.data) !== null)
    .sort();
  if (wanted.length === 0) return {};
  const pick =
    wanted[
      Math.floor(
        hashUnit(`${input.seed}\u0000${input.attempt}\u0000${input.outcome}\u0000hero-tokens`) *
          wanted.length,
      )
    ]!;
  return { [pick]: heroTokenCount(input.won, input.newTasks) };
}

/** Сложить жетоны в счётчик профиля (новый объект, вход не трогается). */
export function addHeroTokens(
  tokens: Readonly<Record<string, number>>,
  add: Readonly<Record<string, number>>,
): Record<string, number> {
  const out = { ...tokens };
  for (const [id, n] of Object.entries(add)) if (n > 0) out[id] = (out[id] ?? 0) + n;
  return out;
}

/**
 * Привести героев, для которых набралось {@link HERO_TOKENS_TO_JOIN} жетонов (правило 3).
 * Зовётся на ЛЮБОМ пути сохранения профиля, как награда за главу (`grantChapterHeroes`):
 * жетоны приходят и с итогов забега, и из магазина.
 */
export function grantTokenHeroes(
  progress: SectorZeroProgress,
  data: GameData,
): { progress: SectorZeroProgress; joined: string[] } {
  const joined = Object.keys(data.heroes)
    .sort()
    .filter(
      (id) =>
        heroTokenUse(progress, id, data) === 'join' &&
        (progress.heroTokens[id] ?? 0) >= HERO_TOKENS_TO_JOIN,
    );
  if (joined.length === 0) return { progress, joined };
  const heroes = { ...progress.heroes };
  const heroTokens = { ...progress.heroTokens };
  for (const id of joined) {
    heroes[id] = newSectorHero(id, data);
    heroTokens[id] = heroTokens[id]! - HERO_TOKENS_TO_JOIN;
    if (heroTokens[id] === 0) delete heroTokens[id];
  }
  return { progress: { ...progress, heroes, heroTokens }, joined };
}

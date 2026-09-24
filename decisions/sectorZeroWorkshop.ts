/**
 * Витрина Мастерской Sector Zero (SZE-1.2) — ЧТО игрок видит до того, как нажмёт.
 *
 * Здесь нет ни DOM, ни хранилища, ни случайности: модуль отвечает на вопрос «что
 * показать по каждому предмету и можно ли жать», а рисует это прототип. Исход попытки
 * считает `sectorZeroForge.ts`, профиль меняет `sectorZeroProgress.ts` — своей копии
 * правил тут нет и быть не должно (§0.3 `sector-zero-economy-roadmap.md` запрещает
 * второй движок улучшения).
 *
 * ## Почему цена и шанс лежат в строке, а не считаются в разметке
 *
 * `EC-2.3` требует раскрытия шансов ДО подтверждения, и это требование сторов, а не
 * удобство. Требование выполнимо только если «сколько стоит» и «каков шанс» приходят
 * из ТОГО ЖЕ вычисления, которое потом спишет Варранты. Посчитай их рядом в вёрстке —
 * и однажды игрок увидит один шанс, а получит другой.
 *
 * Поэтому строка берётся из `forgeOutcome`: тот же вызов, те же ступени, те же коды
 * отказа. Отказ не прячет числа — при нехватке Варрантов цена и шанс всё равно видны,
 * иначе игрок не узнает, на что копить.
 */
import {
  moduleRarityBonus,
  moduleStarMultiplier,
  type GameData,
  type Rarity,
} from '../packages/shared-core/src/index';
import { moduleLadder, profileRarity } from './moduleRarity';
import { forgeOutcome, type ForgeLadder, type ForgeRefusal } from './sectorZeroForge';
import { forgeLadderOf, type SectorZeroProgress } from './sectorZeroProgress';

export { forgeLadderOf as forgeLadder };

/** Одна строка витрины: предмет, его звёздность и цена СЛЕДУЮЩЕЙ ступени. */
export interface WorkshopRow {
  /** Идентификатор модуля → `data.modules`. */
  id: string;
  /** Текущая звёздность: 0 = ни одной звезды. */
  star: number;
  /** Потолок звёзд ЭТОГО модуля — от его редкости (SZE-5.2): сколько делений рисовать. */
  cap: number;
  /** Текущая редкость модуля: базовая из каталога или поднятая в профиле. */
  rarity: Rarity;
  /** Объявленный шанс следующей попытки, доля [0, 1]. На потолке — 0. */
  chance: number;
  /** Цена следующей попытки в Варрантах. Сгорает и при неудаче. */
  warrants: number;
  /** Можно ли нажать прямо сейчас. */
  can: boolean;
  /** Почему нельзя, или `null`. */
  reason: ForgeRefusal | null;
  /** Вклад модуля СЕЙЧАС — то, что корабль получает от него уже. */
  now: Record<string, number>;
  /** Вклад ПОСЛЕ следующей звезды, или `null` на потолке: предлагать нечего. */
  next: Record<string, number> | null;
  /** Осколки — сгоревших попыток на текущей ступени (`EC-2.2`). */
  shards: number;
  /** Потолок попыток ступени: на этой по счёту попытке звезда даётся без броска.
   *  Ноль = гарантии у ступени нет, и показывать накопление незачем. */
  pity: number;
}

/** Вклад модуля на звезде `star` и ступени `rarity` — базовые дельты и параметры
 *  редкости (SZE-5.1), помноженные на множитель звезды: тот же счёт, что в `effectiveStats`. */
export function contribution(
  id: string,
  star: number,
  data: GameData,
  rarity?: Rarity,
): Record<string, number> {
  const mult = moduleStarMultiplier(star, data);
  const def = data.modules[id];
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(def?.effects.stats ?? {})) out[key] = value * mult;
  if (def && rarity)
    for (const [key, value] of Object.entries(moduleRarityBonus(def, rarity)))
      out[key] = (out[key] ?? 0) + value * mult;
  return out;
}

/**
 * Витрина по профилю: только ОТКРЫТЫЕ модули, в порядке профиля.
 *
 * Пустая лестница (`cap` 0) даёт пустую витрину — Мастерская выключается ДАННЫМИ,
 * без флага в коде, ровно как медали и магазин.
 */
export function workshopRows(
  progress: SectorZeroProgress,
  data: GameData,
): WorkshopRow[] {
  const ladder = forgeLadderOf(data);
  if (ladder.cap <= 0 || ladder.steps.length === 0) return [];
  const rows: WorkshopRow[] = [];
  for (const id of progress.modules) {
    if (!data.modules[id]) continue;
    const star = progress.stars[id] ?? 0;
    const shards = progress.forgeShards[id] ?? 0;
    const rarity = profileRarity(progress, id, data);
    const own = moduleLadder(ladder, rarity);
    const out = forgeOutcome(
      { seed: progress.seed, attempt: progress.forgeTries[id] ?? 0, target: id, star, shards },
      own,
      progress.warrants,
    );
    rows.push({
      id,
      star,
      cap: own.cap,
      rarity,
      chance: out.chance,
      warrants: out.warrants,
      can: out.allowed,
      reason: out.reason,
      shards,
      pity: ladder.steps[star]?.pity ?? 0,
      now: contribution(id, star, data, rarity),
      next: out.reason === 'E_FORGE_AT_CAP' ? null : contribution(id, star + 1, data, rarity),
    });
  }
  return rows;
}

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
import { moduleStarMultiplier, type GameData } from '../packages/shared-core/src/index';
import { forgeOutcome, type ForgeLadder, type ForgeRefusal } from './sectorZeroForge';
import { forgeLadderOf, type SectorZeroProgress } from './sectorZeroProgress';

export { forgeLadderOf as forgeLadder };

/** Одна строка витрины: предмет, его звёздность и цена СЛЕДУЮЩЕЙ ступени. */
export interface WorkshopRow {
  /** Идентификатор модуля → `data.modules`. */
  id: string;
  /** Текущая звёздность: 0 = ни одной звезды. */
  star: number;
  /** Потолок из данных — сколько делений рисовать. */
  cap: number;
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

/** Вклад модуля на звезде `star` — базовые дельты, помноженные на множитель ступени. */
function contribution(id: string, star: number, data: GameData): Record<string, number> {
  const mult = moduleStarMultiplier(star, data);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(data.modules[id]?.effects.stats ?? {}))
    out[key] = value * mult;
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
  const ladder: ForgeLadder = forgeLadderOf(data);
  if (ladder.cap <= 0 || ladder.steps.length === 0) return [];
  const rows: WorkshopRow[] = [];
  for (const id of progress.modules) {
    if (!data.modules[id]) continue;
    const star = progress.stars[id] ?? 0;
    const shards = progress.forgeShards[id] ?? 0;
    const out = forgeOutcome(
      { seed: progress.seed, attempt: progress.forgeTries[id] ?? 0, target: id, star, shards },
      ladder,
      progress.warrants,
    );
    rows.push({
      id,
      star,
      cap: ladder.cap,
      chance: out.chance,
      warrants: out.warrants,
      can: out.allowed,
      reason: out.reason,
      shards,
      pity: ladder.steps[star]?.pity ?? 0,
      now: contribution(id, star, data),
      next: out.reason === 'E_FORGE_AT_CAP' ? null : contribution(id, star + 1, data),
    });
  }
  return rows;
}

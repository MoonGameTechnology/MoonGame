/**
 * Карточка мины (SM-3.6, решение владельца 2026-09-30: «мину можно так же выделить и
 * прочитать характеристики»). Мина — неподвижный отряд, но читать её как флот нечего: у неё
 * нет залпа, хода и трюма. Игроку нужны три числа — сколько зарядов осталось, сколько
 * корпуса снимает один подрыв и сколько прочности у самой мины (её бьют челноки).
 *
 * Чистая функция: что показать. Слова и разметку рисует хост.
 */
import type { Fleet, GameData } from '../packages/shared-core/src/index';
import { effectiveStats } from '../packages/shared-core/src/index';

export interface MineCard {
  /** Сколько раз мина ещё сработает — живые мины в отряде. */
  charges: number;
  /** Доля корпуса кораблей за один подрыв, в процентах — у самой сильной боевой части. */
  hitPct: number;
  /** Прочность отряда мин: текущая и полная. */
  hull: { cur: number; max: number };
}

export function mineCard(fleet: Pick<Fleet, 'units'>, data: GameData): MineCard {
  let charges = 0;
  let hit = 0;
  let cur = 0;
  let max = 0;
  for (const st of fleet.units) {
    const def = data.units[st.unit];
    if (!def || !(st.count > 0)) continue;
    const eff = effectiveStats(def, st, data);
    const per = eff.hp ?? 0;
    charges += st.count;
    hit = Math.max(hit, eff.mineHit ?? 0);
    max += st.count * per;
    cur += st.hp ?? st.count * per;
  }
  return { charges, hitPct: Math.round(hit * 100), hull: { cur: Math.round(cur), max: Math.round(max) } };
}

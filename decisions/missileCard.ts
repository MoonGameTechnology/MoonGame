/**
 * Карточка летящей ракеты (SM-3.7b, решение владельца 2026-09-30: «Ракета тоже является
 * отрядом. Только его невозможно контролировать»). Ракету выделяют общим путём, приказов у
 * неё нет, поэтому в карточке только то, что о ней можно прочесть: прочность (её сбивают
 * ПРО и челноки), когда она будет в точке цели, радиус взрыва и — только хозяину —
 * боевая часть.
 *
 * Боевая часть живёт в `ordnance.warheads`, и проекция отдаёт её одному хозяину: чужой
 * карточке её взять неоткуда, поэтому здесь она `null`, а не «спрятана».
 *
 * Чистая функция: что показать. Слова и разметку рисует хост.
 */
import type { Fleet, GameData } from '../packages/shared-core/src/index';
import { effectiveStats, missileWarhead } from '../packages/shared-core/src/index';

export interface MissileCard {
  /** Своя ракета — ей показывают боевую часть. */
  own: boolean;
  /** Урон боевой части, зафиксированный при постановке мины; только хозяину. */
  damage: number | null;
  /** Радиус взрыва — из модуля мины или из юнита ракеты. */
  blast: number;
  /** Прочность ракеты: текущая и полная. */
  hull: { cur: number; max: number };
  /** Когда ракета будет в точке цели (мировые мс). Срок, а не остаток: остаток менялся бы
   *  с часами, и карточка, сравнивающая разметку, пересобиралась бы каждый кадр. */
  arrivesAt: number;
}

export function missileCard(
  fleet: Pick<Fleet, 'owner' | 'units' | 'flight'>,
  warhead: number | undefined,
  viewer: string,
  data: GameData,
): MissileCard | null {
  const warheadDef = missileWarhead(fleet, data);
  if (!warheadDef || !fleet.flight) return null;
  let cur = 0;
  let max = 0;
  for (const st of fleet.units) {
    const def = data.units[st.unit];
    if (!def || !(st.count > 0)) continue;
    const per = effectiveStats(def, st, data).hp ?? 0;
    max += st.count * per;
    cur += st.hp ?? st.count * per;
  }
  const own = fleet.owner === viewer;
  return {
    own,
    damage: own ? (warhead ?? null) : null,
    blast: warheadDef.blastRadius,
    hull: { cur: Math.round(cur), max: Math.round(max) },
    arrivesAt: fleet.flight.arrivesAt,
  };
}

/**
 * Карточка летящей ракеты (SM-3.7b, решение владельца 2026-09-30: «Ракета тоже является
 * отрядом. Только его невозможно контролировать»). Ракету выделяют общим путём, приказов у
 * неё нет, поэтому в карточке только то, что о ней можно прочесть: прочность (её сбивают
 * ПРО и челноки), сколько ей лететь до точки цели, радиус взрыва и — только хозяину —
 * боевая часть.
 *
 * Боевая часть живёт в `ordnance.warheads`, и проекция отдаёт её одному хозяину: чужой
 * карточке её взять неоткуда, поэтому здесь она `null`, а не «спрятана».
 *
 * Чистая функция: что показать. Слова и разметку рисует хост.
 */
import type { Fleet, GameData } from '../packages/shared-core/src/index';
import { effectiveStats, missileModule } from '../packages/shared-core/src/index';

export interface MissileCard {
  /** Своя ракета — ей показывают боевую часть. */
  own: boolean;
  /** Урон боевой части, зафиксированный при постановке мины; только хозяину. */
  damage: number | null;
  /** Радиус взрыва в точке цели — из модуля, которым ракету пустили. */
  blast: number;
  /** Прочность ракеты: текущая и полная. */
  hull: { cur: number; max: number };
  /** Сколько ещё лететь до точки цели, мс; 0 — уже у цели. */
  leftMs: number;
}

export function missileCard(
  fleet: Pick<Fleet, 'owner' | 'units' | 'flight'>,
  warhead: number | undefined,
  viewer: string,
  now: number,
  data: GameData,
): MissileCard | null {
  const launcher = missileModule(fleet, data);
  if (!launcher || !fleet.flight) return null;
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
    blast: launcher.def.blastRadius,
    hull: { cur: Math.round(cur), max: Math.round(max) },
    leftMs: Math.max(0, fleet.flight.arrivesAt - now),
  };
}

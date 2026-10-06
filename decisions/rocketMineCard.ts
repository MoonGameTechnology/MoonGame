/**
 * Карточка ракетной мины (SM-3.7a, решение владельца 2026-09-30: «ракетная мина по
 * сущности — неподвижный космический юнит»). Мина — отряд, выделяется общим путём, а
 * читать в ней нечего, кроме её оружия: радар и обзор, которыми она ищет цель, прочность
 * (её бьют челноки) и — только хозяину — режим пуска и боевая часть.
 *
 * Режим и удар живут в `ordnance.controls`, и проекция отдаёт их одному хозяину: чужой
 * карточке их взять неоткуда, поэтому здесь они `null`, а не «спрятаны».
 *
 * Чистая функция: что показать. Слова и разметку рисует хост.
 */
import type {
  Fleet,
  GameData,
  RocketMineControl,
  RocketMineMode,
} from '../packages/shared-core/src/index';
import { effectiveStats, rocketMineModule } from '../packages/shared-core/src/index';

export interface RocketMineCard {
  /** Своя мина — режим, удар и кнопки управления. */
  own: boolean;
  /** Режим пуска; у чужой мины его нет в проекции. */
  mode: RocketMineMode | null;
  /** Урон боевой части, зафиксированный при постановке; только хозяину. */
  damage: number | null;
  /** Дальность радара, которым мина ищет цель. */
  radar: number;
  /** Дальность обзора мины — её подтверждённые цели. */
  sight: number;
  /** Прочность мины: текущая и полная. */
  hull: { cur: number; max: number };
}

export function rocketMineCard(
  fleet: Pick<Fleet, 'owner' | 'units'>,
  control: RocketMineControl | undefined,
  viewer: string,
  data: GameData,
): RocketMineCard | null {
  const layer = rocketMineModule(fleet, data);
  if (!layer) return null;
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
    mode: own ? (control?.mode ?? null) : null,
    damage: own ? (control?.damage ?? null) : null,
    radar: layer.def.radarRange,
    sight: layer.def.sightRange,
    hull: { cur: Math.round(cur), max: Math.round(max) },
  };
}

import { effectiveStats, type GameData, type UnitDef } from '../packages/shared-core/src/index';

/**
 * Что станет с характеристиками корабля, если выбрать этот модуль в открытом отсеке
 * (заказ владельца 2026-11-17: «не показывает изменение в характеристиках»).
 *
 * Плитка модуля в окне оснащения показывает не сам эффект модуля, а РАЗНИЦУ для этого
 * корабля: в пустом отсеке это прибавка модуля, в занятом — замена (снятый модуль уходит,
 * новый встаёт), поэтому там бывают и минусы. У надетого модуля — его вклад. Звёзды и
 * поднятая редкость места считаются, как у построенного корабля (`effectiveStats`).
 *
 * Только изменившиеся статы, в порядке {@link STAT_ORDER}, затем по алфавиту.
 */
export interface StatChange {
  stat: string;
  delta: number;
}

export interface SwapBoosts {
  moduleStars?: Record<string, number>;
  moduleRarity?: Record<string, string>;
}

/** Порядок строк — как в превью характеристик верфи. */
const STAT_ORDER = [
  'attack',
  'defense',
  'hp',
  'shield',
  'speed',
  'cargoCapacity',
  'radarRange',
  'sightRange',
];

/**
 * @param modules  надетые сейчас модули черновика
 * @param fitted   модуль в открытом отсеке (его заменит кандидат), если отсек занят
 * @param candidate модуль плитки
 */
export function moduleSwapDelta(
  def: UnitDef,
  modules: readonly string[],
  fitted: string | undefined,
  candidate: string,
  boosts: SwapBoosts,
  data: GameData,
): StatChange[] {
  const stats = (mods: readonly string[]) =>
    effectiveStats(
      def,
      {
        modules: [...mods],
        ...(boosts.moduleStars ? { moduleStars: boosts.moduleStars } : {}),
        ...(boosts.moduleRarity ? { moduleRarity: boosts.moduleRarity } : {}),
      },
      data,
    );
  let before: Record<string, number>;
  let after: Record<string, number>;
  if (candidate === fitted || (fitted === undefined && modules.includes(candidate))) {
    before = stats(modules.filter((id) => id !== candidate));
    after = stats(modules);
  } else {
    before = stats(modules);
    after = stats(
      fitted !== undefined
        ? modules.map((id) => (id === fitted ? candidate : id))
        : [...modules, candidate],
    );
  }
  const rank = (k: string) => {
    const i = STAT_ORDER.indexOf(k);
    return i < 0 ? STAT_ORDER.length : i;
  };
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .map((stat) => ({
      stat,
      delta: Math.round(((after[stat] ?? 0) - (before[stat] ?? 0)) * 1000) / 1000,
    }))
    .filter((c) => c.delta !== 0)
    .sort((a, b) => rank(a.stat) - rank(b.stat) || a.stat.localeCompare(b.stat));
}

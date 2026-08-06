/**
 * Вкладки карточки мира: что лежит в каждой и что стоит на её счётчике (REFM-41).
 *
 * Счётчик вкладки «Флот» — не то, что кажется. Построенные корабли САМИ уходят на
 * орбиту (`fleetLaunchModule`), поэтому в гарнизоне мира их обычно нет: считай
 * вкладку только по гарнизону — и над полной орбитой будет висеть честный ноль.
 * Здесь счётчик складывает гарнизонные корабли и стоящие тут флоты, и это правило
 * держит тест, а не память того, кто правит вёрстку.
 *
 * Деление на домены берётся из `planetSummary.ts` (REFM-38) — там же и объяснение,
 * почему авианосец считается крылом, а не кораблём линии: иначе одна группа попадёт
 * в две вкладки сразу. Ростер стройки делится ТЕМ ЖЕ правилом, поэтому вкладка
 * никогда не предложит строить то, что сама же не покажет.
 */
import type { Fleet, GameData, Planet, UnitStack } from '../../packages/shared-core/src/index';
import { isGroundUnit, isShipUnit, isWingUnit } from './planetSummary';

/** Вкладки карточки мира в порядке показа. */
export const PLANET_TABS = ['ground', 'ships', 'squadron', 'buildings'] as const;
export type PlanetTabId = (typeof PLANET_TABS)[number];

/** Гарнизон, разложенный по вкладкам. Порядок стеков внутри — как в гарнизоне. */
export interface GarrisonByTab {
  ground: UnitStack[];
  ships: UnitStack[];
  wings: UnitStack[];
}

/** Разложить гарнизон по вкладкам. Пустые стеки остаются: их показывает вкладка. */
export function garrisonByTab(stacks: readonly UnitStack[], data: GameData): GarrisonByTab {
  return {
    ground: stacks.filter((st) => isGroundUnit(st.unit, data)),
    ships: stacks.filter((st) => isShipUnit(st.unit, data)),
    wings: stacks.filter((st) => isWingUnit(st.unit, data)),
  };
}

/**
 * Числа на вкладках. `ships` — гарнизонные корабли ПЛЮС флоты на орбите: иначе
 * вкладка показывает ноль над полной орбитой (см. шапку модуля).
 */
export function tabCounts(
  p: Pick<Planet, 'garrison' | 'buildings'>,
  data: GameData,
  orbit: readonly Fleet[],
): Record<PlanetTabId, number> {
  const g = garrisonByTab(p.garrison, data);
  return {
    ground: g.ground.length,
    ships: g.ships.length + orbit.length,
    squadron: g.wings.length,
    buildings: p.buildings.length,
  };
}

/** Что предлагать строить на этой вкладке — тем же делением, что и показ состава. */
export function buildRoster(tab: PlanetTabId, units: readonly string[], data: GameData): string[] {
  if (tab === 'ground') return units.filter((u) => isGroundUnit(u, data));
  if (tab === 'ships') return units.filter((u) => isShipUnit(u, data));
  if (tab === 'squadron') return units.filter((u) => isWingUnit(u, data));
  return [];
}

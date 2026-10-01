/**
 * Вкладки карточки мира: что лежит в каждой и что стоит на её счётчике (REFM-41).
 *
 * Счётчик вкладки «Флот» — не то, что кажется. Построенные корабли САМИ уходят на
 * орбиту (`fleetLaunchModule`), поэтому в гарнизоне мира их обычно нет: считай
 * вкладку только по гарнизону — и над полной орбитой будет висеть честный ноль.
 * Здесь счётчик складывает гарнизонные корабли и корабли стоящих тут флотов, и это
 * правило держит тест, а не память того, кто правит вёрстку.
 *
 * Счётчики считают ЮНИТЫ, а не стеки (переработка окна мира, 2026-09-29). Раньше над
 * вкладками стоял ряд фишек с юнитами, а вкладки считали стеки, и «◆ 4» висело над
 * «Земля 2». Ряд фишек ушёл, и число на вкладке теперь единственное число состава.
 *
 * Деление на домены берётся из `planetSummary.ts` (REFM-38) — там же и объяснение,
 * почему авианосец считается крылом, а не кораблём линии: иначе одна группа попадёт
 * в две вкладки сразу. Ростер стройки делится ТЕМ ЖЕ правилом, поэтому вкладка
 * никогда не предложит строить то, что сама же не покажет.
 */
import { hangarMachines, type Fleet, type GameData, type Planet, type UnitStack } from '../../packages/shared-core/src/index';
import { isGroundUnit, isShipUnit, isWingUnit } from './planetSummary';

/** Вкладки карточки мира в порядке показа. */
export const PLANET_TABS = ['ground', 'ships', 'shuttle', 'buildings'] as const;
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
 * Числа на вкладках — юниты (см. шапку модуля). `ships` — гарнизонные корабли ПЛЮС
 * корабли флотов на орбите: иначе вкладка показывает ноль над полной орбитой. `shuttle`
 * — машины АНГАРА (SHU-3.1): челнок в гарнизоне не живёт, и счёт по одному гарнизону
 * держал вкладку «Эскадра» на вечном нуле при полном ангаре.
 */
export function tabCounts(
  p: Pick<Planet, 'garrison' | 'buildings' | 'hangar'>,
  data: GameData,
  orbit: readonly Fleet[],
): Record<PlanetTabId, number> {
  const g = garrisonByTab(p.garrison, data);
  const heads = (stacks: readonly UnitStack[]): number => stacks.reduce((n, st) => n + st.count, 0);
  return {
    ground: heads(g.ground),
    ships: heads(g.ships) + orbit.reduce((n, f) => n + heads(f.units), 0),
    shuttle: heads(g.wings) + heads(hangarMachines(p)),
    buildings: p.buildings.length,
  };
}

/** Что предлагать строить на этой вкладке — тем же делением, что и показ состава. */
export function buildRoster(tab: PlanetTabId, units: readonly string[], data: GameData): string[] {
  if (tab === 'ground') return units.filter((u) => isGroundUnit(u, data));
  if (tab === 'ships') return units.filter((u) => isShipUnit(u, data));
  if (tab === 'shuttle') return units.filter((u) => isWingUnit(u, data));
  return [];
}

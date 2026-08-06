/**
 * Сводка мира: что показывает карточка планеты по тапу на имя (REFM-38).
 *
 * Здесь только числа и разбор состава — разметку и подписи собирает хозяин.
 *
 * Главная ловушка секции — **разделение гарнизона по домену**. Их ТРИ, а не два, и
 * правила не симметричны: авианосец с трюмом истребителей это «крыло», а не корабль
 * линии, иначе одна и та же группа посчитается дважды — в кораблях и в крыльях. При
 * этом принадлежность к земле определяется по `domain`, а «не корабль» — по трейту
 * `ground`: так исторически сложилось в данных, и подменить одно другим значит тихо
 * переселить юнит в чужую вкладку. Обе проверки живут здесь, в одном месте.
 *
 * Второе правило: **базовый выход мира перечисляет и НУЛИ.** Перекос типа планеты
 * («металл есть, еды нет») читается только тогда, когда пустая строка показана —
 * иначе бесплодный мир выглядит так же, как богатый.
 *
 * Третье: **очки победы приходят из ядра** (`provinceScore`). Своя формула в панели
 * означала бы, что игрок планирует захват по одному числу, а победа считается по
 * другому.
 */
import { provinceScore } from '../../packages/shared-core/src/state/sectorKind';
import {
  type Fleet,
  type GameData,
  type Planet,
  type UnitStack,
} from '../../packages/shared-core/src/index';

/** Ресурсы, которые карточка мира перечисляет всегда — включая нулевые. */
export const BASE_OUTPUT_RESOURCES = ['metal', 'credits', 'food', 'energy'] as const;

/** Крыло: сама эскадрилья И несущий её авианосец — они живут одной вкладкой. */
export function isWingUnit(unit: string, data: GameData): boolean {
  const traits = data.units[unit]?.traits ?? [];
  return traits.includes('squadron') || traits.includes('carrier');
}

/** Корабль линии: всё, что не наземное и не крыло. */
export function isShipUnit(unit: string, data: GameData): boolean {
  return !(data.units[unit]?.traits ?? []).includes('ground') && !isWingUnit(unit, data);
}

/** Наземный юнит — по домену определения, а не по трейту. */
export function isGroundUnit(unit: string, data: GameData): boolean {
  return data.units[unit]?.domain === 'ground';
}

/** Разбивка состава по трём доменам. Каждая группа попадает РОВНО в одну корзину. */
export function garrisonSplit(
  stacks: readonly UnitStack[],
  data: GameData,
): { ground: number; ships: number; wings: number } {
  const out = { ground: 0, ships: 0, wings: 0 };
  for (const st of stacks) {
    if (st.count <= 0) continue;
    if (isGroundUnit(st.unit, data)) out.ground += st.count;
    else if (isWingUnit(st.unit, data)) out.wings += st.count;
    else if (isShipUnit(st.unit, data)) out.ships += st.count;
  }
  return out;
}

/** Всё, что показывает карточка мира. Числа готовые, подписи не наши. */
export interface PlanetSummary {
  /** Пассивный выход в час: все `BASE_OUTPUT_RESOURCES`, включая нули. */
  baseOutput: Record<string, number>;
  /** Бонусы типа планеты долями (0.15 = +15%); нулевые сюда не попадают. */
  bonuses: { production?: number; defense?: number };
  garrison: { ground: number; ships: number; wings: number };
  buildings: Array<{ type: string; level: number }>;
  /** Очки победы за провинцию — из ядра, не из своей формулы. */
  victoryPoints: number;
  /** Флоты НА ОРБИТЕ: те, что стоят здесь; идущие мимо не в счёт. */
  orbit: { fleets: number; ships: number };
}

/** Сводка мира одним проходом. Чистая: ни DOM, ни состояния, ни текста. */
export function planetSummary(
  p: Planet,
  data: GameData,
  fleets: readonly Fleet[],
): PlanetSummary {
  const pt = p.planetType ? data.planetTypes[p.planetType] : undefined;
  const base = (pt?.baseOutput ?? {}) as Record<string, number>;
  const bonuses: { production?: number; defense?: number } = {};
  if (pt && pt.productionBonus !== 0) bonuses.production = pt.productionBonus;
  if (pt && (pt.defenseBonus ?? 0) !== 0) bonuses.defense = pt.defenseBonus ?? 0;

  const here = fleets.filter((f) => f.location === p.id);
  return {
    baseOutput: Object.fromEntries(BASE_OUTPUT_RESOURCES.map((r) => [r, base[r] ?? 0])),
    bonuses,
    garrison: garrisonSplit(p.garrison, data),
    buildings: p.buildings.map((b) => ({ type: b.type, level: b.level })),
    victoryPoints: Math.round(provinceScore(data, p)),
    orbit: {
      fleets: here.length,
      ships: here.reduce((n, f) => n + f.units.reduce((m, st) => m + st.count, 0), 0),
    },
  };
}

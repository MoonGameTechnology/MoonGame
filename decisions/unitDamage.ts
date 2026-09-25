/**
 * Урон юнита по целям (заказ владельца 2026-09-25: «в карточках юнитов всех должно
 * отображаться, сколько наносит урона кораблям, зданиям, авиации, технике наземной и
 * пехоте»).
 *
 * Пять чисел на ОДНОГО юнита, каждое — из того стата, которым по этой цели бьют живые
 * правила ядра. Отдельного «урона по пехоте» в данных нет: карточка не выдумывает число,
 * а называет канал, которым юнит до цели дотягивается, и 0 там, где канала нет.
 *
 * 1. **Корабль.** Корабли — `attack` (бой флотов). Здания — обстрел с орбиты:
 *    `siegeDamage`, а без него `attack × BOMBARD_FRACTION` (как `bombardPower`).
 *    Авиация — точечная оборона `pointDefense`. По наземным войскам корабль не бьёт:
 *    обстрел стачивает только постройки.
 * 2. **Шаттл.** Корабли — `attack` (удар по флоту). Здания — `siegeDamage`, а без него
 *    полный `attack` (как `strikePower` по миру). Авиация — `shuttleDamage` перехватчика.
 * 3. **Наземный юнит.** Корабли — `aaDamage` (ПВО гарнизона по флоту на орбите). Здания —
 *    `buildingDamage` (зачистка органов Роя). Техника и пехота — СВОИ числа штурма
 *    (решение владельца 2026-09-25, `util/groundTargets.ts`): атака по роду в нападении и
 *    оборона по роду в ответном огне. Оборону ряд несёт отдельным полем — у ячеек техники
 *    и пехоты два числа.
 *
 * Статы — уже с оснащением (`effectiveStats`), если карточка их так посчитала: тогда
 * модуль, добавивший урон по постройкам, виден и здесь.
 */
import { BOMBARD_FRACTION, statVs, type UnitDef } from '../packages/shared-core/src/index';

export type DamageTarget = 'ships' | 'buildings' | 'air' | 'vehicles' | 'infantry';

/** Порядок строк карточки. */
export const DAMAGE_TARGETS: readonly DamageTarget[] = [
  'ships',
  'buildings',
  'air',
  'vehicles',
  'infantry',
];

/** Ключ подписи строки. */
export const DAMAGE_TARGET_KEY: Record<DamageTarget, string> = {
  ships: 'codex.dmg.ships',
  buildings: 'codex.dmg.buildings',
  air: 'codex.dmg.air',
  vehicles: 'codex.dmg.vehicles',
  infantry: 'codex.dmg.infantry',
};

export interface UnitDamageRow {
  target: DamageTarget;
  /** Урон одного юнита в нападении. */
  value: number;
  /** Урон в ответном огне, когда он считается отдельно (род войск у наземных). */
  defense?: number;
}

type Stats = Partial<Record<string, number>>;

/** Урон одного юнита по каждой цели, в порядке {@link DAMAGE_TARGETS}. `stats` — статы,
 *  которые показывает карточка (голые из данных или с оснащением). */
export function unitDamageProfile(
  def: Pick<UnitDef, 'domain' | 'traits'>,
  stats: Stats,
): UnitDamageRow[] {
  const n = (k: string): number => Math.max(0, stats[k] ?? 0);
  const siege = n('siegeDamage');
  let by: Record<DamageTarget, number>;
  if (def.domain === 'ground') {
    const full = stats as Record<string, number>;
    const vs = (role: 'attack' | 'defense', cls: 'infantry' | 'vehicle'): number =>
      Math.max(0, statVs(full, role, cls));
    return [
      { target: 'ships', value: n('aaDamage') },
      { target: 'buildings', value: n('buildingDamage') },
      { target: 'air', value: 0 },
      { target: 'vehicles', value: vs('attack', 'vehicle'), defense: vs('defense', 'vehicle') },
      { target: 'infantry', value: vs('attack', 'infantry'), defense: vs('defense', 'infantry') },
    ];
  }
  if (def.traits.includes('shuttle')) {
    by = {
      ships: n('attack'),
      buildings: siege > 0 ? siege : n('attack'),
      air: n('shuttleDamage'),
      vehicles: 0,
      infantry: 0,
    };
  } else {
    by = {
      ships: n('attack'),
      buildings: siege > 0 ? siege : n('attack') * BOMBARD_FRACTION,
      air: n('pointDefense'),
      vehicles: 0,
      infantry: 0,
    };
  }
  return DAMAGE_TARGETS.map((target) => ({ target, value: by[target] }));
}

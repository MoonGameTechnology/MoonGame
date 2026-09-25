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
 *    `buildingDamage` (зачистка органов Роя). Техника и пехота — `attack` штурма: бой на
 *    земле не делит цели по роду войск, поэтому оба числа честно одинаковы.
 *
 * Статы — уже с оснащением (`effectiveStats`), если карточка их так посчитала: тогда
 * модуль, добавивший урон по постройкам, виден и здесь.
 */
import { BOMBARD_FRACTION, type UnitDef } from '../packages/shared-core/src/index';

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
  value: number;
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
    by = {
      ships: n('aaDamage'),
      buildings: n('buildingDamage'),
      air: 0,
      vehicles: n('attack'),
      infantry: n('attack'),
    };
  } else if (def.traits.includes('shuttle')) {
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

/** Ground, orbital and air damage share target classes and echelons.
 * Orbital/air channels retain the last garrison hull point: troops capture worlds.
 * Class-specific weapon potency is applied to equal unit shares inside each line. */
import type { HandlerContext } from '../kernel/module';
import type { Planet, PlayerId, UnitStack } from '../state/gameState';
import type { GameData } from '../data/schemas';
import { effectiveStats } from './loadout';
import { cappedUnitBreakdown } from './stacks';
import { applyDamageToSide, capHooked, stackHull, type HookedDamage } from './combat';
import { TARGET_CLASSES, classShares, type ClassPools, type TargetClass } from './groundTargets';

/** Доля атаки корабля, которая за час обстрела ложится на войска мира, по роду цели
 *  (правила 1 и 7). `other` — не наземный юнит в гарнизоне (корабль, ждущий вылета). */
export const SHIP_GROUND_FRACTION: Readonly<Record<TargetClass, number>> = {
  infantry: 0.1,
  vehicle: 0.05,
  other: 0.1,
};
/** Доля атаки шаттла, которая за удар по миру ложится на его войска, по роду цели
 *  (правила 2 и 7). */
export const SHUTTLE_GROUND_FRACTION: Readonly<Record<TargetClass, number>> = {
  infantry: 0.125,
  vehicle: 0.25,
  other: 0.25,
};
/** Сколько прочности огонь сверху оставляет гарнизону (правило 4). */
export const GARRISON_FLOOR_HP = 1;

type Stats = Partial<Record<string, number>>;

/** Урон ОДНОГО корабля по войскам рода `cls` за час обстрела — для ядра и для карточки. */
export function shipGroundDamage(stats: Stats, cls: TargetClass): number {
  return Math.max(0, stats.attack ?? 0) * SHIP_GROUND_FRACTION[cls];
}

/** Урон ОДНОЙ целой машины по войскам рода `cls` за удар по миру — для ядра и для карточки. */
export function shuttleGroundDamage(stats: Stats, cls: TargetClass): number {
  return Math.max(0, stats.attack ?? 0) * SHUTTLE_GROUND_FRACTION[cls];
}

/** Залп сверху по гарнизону: урон до хука и урон стрелков по каждому роду (вес рода). */
export interface GroundVolley {
  total: number;
  weights: ClassPools;
}

/** A single volley with class potency, HP scaling and the source's soft size limit. */
export function groundVolley(
  shooters: readonly UnitStack[],
  garrison: readonly UnitStack[],
  data: GameData,
  perUnit: (stats: Stats, cls: TargetClass) => number,
): GroundVolley {
  const shares = classShares(garrison, data);
  const weights: ClassPools = { infantry: 0, vehicle: 0, other: 0 };
  const present = TARGET_CLASSES.filter(cls => shares[cls] > 0);
  if (!present.length) return { total: 0, weights };
  const rows = cappedUnitBreakdown(shooters, data, (stats) =>
    present.reduce((sum, cls) => sum + shares[cls] * perUnit(stats, cls), 0),
  );
  let total = 0;
  for (const row of rows) {
    const stack = shooters[row.index]!;
    // Те же эффективные статы залпа, — здесь их читают заново, чтобы разложить залп по родам.
    const stats = effectiveStats(data.units[stack.unit]!, stack, data);
    for (const cls of present) weights[cls] += row.firing * row.powerScale * perUnit(stats, cls);
    total += row.damage;
  }
  return { total, weights };
}

/** Сколько урона гарнизон ещё примет сверху: весь его корпус без порога (правило 4). */
export function garrisonRoom(planet: Planet, data: GameData): number {
  let pool = 0;
  for (const s of planet.garrison) {
    const def = data.units[s.unit];
    if (s.count <= 0 || !def) continue;
    pool += stackHull(s, effectiveStats(def, s, data).hp).pool;
  }
  return Math.max(0, pool - GARRISON_FLOOR_HP);
}

/** Положить огонь сверху на гарнизон `planet`. Урон уже прошёл хук своего канала; здесь
 *  только порог и приёмник, который делит урон поровну на юнитов с весом их рода
 *  (`weights` из {@link groundVolley}, правила 6 и 7). Павших записывает на `killedBy`, как
 *  и любой другой канал. */
export function fireOnGarrison(
  h: HandlerContext,
  planet: Planet,
  dealt: HookedDamage,
  killedBy: PlayerId,
  weights: ClassPools,
): void {
  const landed = capHooked(dealt, garrisonRoom(planet, h.ctx.data));
  if (!(landed > 0)) return;
  const ref = { kind: 'garrison' as const, planetId: planet.id };
  applyDamageToSide(
    h,
    ref,
    landed,
    h.ctx.data,
    planet.id,
    undefined,
    undefined,
    killedBy,
    weights,
  );
}

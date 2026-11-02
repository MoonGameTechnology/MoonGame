/** Class-specific weapons applied to equal unit shares within 50/30/20 echelons. */
import type { GameData, UnitDef } from '../data/schemas';
import type { UnitStack } from '../state/gameState';
import { formationShares } from './formation';
import { effectiveStats } from './loadout';
import { cappedUnitBreakdown, type StackContribution } from './stacks';

export type TargetClass = 'infantry' | 'vehicle' | 'other';
export const TARGET_CLASSES: readonly TargetClass[] = ['infantry', 'vehicle', 'other'];
export type ClassPools = Record<TargetClass, number>;

/** Роль стороны в бою: атакующий бьёт атакой, обороняющийся — обороной. */
export type FireRole = 'attack' | 'defense';

const VS_STAT: Record<FireRole, Record<Exclude<TargetClass, 'other'>, string>> = {
  attack: { infantry: 'attackVsInfantry', vehicle: 'attackVsVehicle' },
  defense: { infantry: 'defenseVsInfantry', vehicle: 'defenseVsVehicle' },
};

/** Класс юнита как ЦЕЛИ (правило 1). */
export function targetClassOf(def: Pick<UnitDef, 'domain' | 'kind'> | undefined): TargetClass {
  if (!def || def.domain !== 'ground') return 'other';
  return def.kind === 'vehicle' ? 'vehicle' : 'infantry';
}

/** Урон одного юнита по классу (правило 4). */
export function statVs(stats: Record<string, number>, role: FireRole, cls: TargetClass): number {
  if (cls === 'other') return stats[role] ?? 0;
  return stats[VS_STAT[role][cls]] ?? stats[role] ?? 0;
}

const emptyPools = (): ClassPools => ({ infantry: 0, vehicle: 0, other: 0 });

/** Class shares of the formation's volley, independent of target hull HP. */
export function classShares(targets: readonly UnitStack[], data: GameData): ClassPools {
  const pool = emptyPools();
  const shares = formationShares(targets, data);
  targets.forEach((stack, i) => { pool[targetClassOf(data.units[stack.unit])] += shares[i]!; });
  return pool;
}

/** Залп стороны ПРОТИВ конкретной цели: разбивка по стекам (для заслуги ветерана) и
 *  разложение по классам цели (правила 2–3). `total` = Σ `rows` = Σ `pools`. */
export interface TargetedVolley {
  total: number;
  rows: StackContribution[];
  pools: ClassPools;
}

export function targetedVolley(
  shooters: readonly UnitStack[],
  targets: readonly UnitStack[],
  data: GameData,
  role: FireRole,
): TargetedVolley {
  const shares = classShares(targets, data);
  const present = TARGET_CLASSES.filter((cls) => shares[cls] > 0);
  // Цель без корпуса (пустая сторона) — бьём прежним статом, как по `other`: залп тот же,
  // что до правила, а класть его всё равно некуда.
  if (present.length === 0) present.push('other');
  const weight = (cls: TargetClass): number => (shares[cls] > 0 ? shares[cls] : 1);
  const rows = cappedUnitBreakdown(shooters, data, (stats) =>
    present.reduce((sum, cls) => sum + weight(cls) * statVs(stats, role, cls), 0),
  );
  const pools = emptyPools();
  let total = 0;
  for (const row of rows) {
    const stack = shooters[row.index]!;
    const def = data.units[stack.unit]!;
    // Те же эффективные статы, что использует разбивка залпа, — здесь их читают
    // заново только чтобы разложить залп по классам.
    const stats = effectiveStats(def, stack, data);
    for (const cls of present) pools[cls] += row.firing * row.powerScale * weight(cls) * statVs(stats, role, cls);
    total += row.damage;
  }
  return { total, rows, pools };
}

/** Есть ли у цели наземные войска, которым нужна матрица урона по классам. */
export function hasGroundTargets(units: readonly UnitStack[], data: GameData): boolean {
  return units.some((s) => s.count > 0 && targetClassOf(data.units[s.unit]) !== 'other');
}

/** Разложить `dealt` (урон после хука) по классам в пропорции залпа до хука. Последний
 *  непустой класс берёт точный остаток: разложение не теряет и не чеканит урон на округлении,
 *  а при одном классе он получает `dealt` ровно. */
export function splitDealt(pools: ClassPools, total: number, dealt: number): ClassPools {
  const out = emptyPools();
  const present = TARGET_CLASSES.filter((cls) => pools[cls] > 0);
  if (present.length === 0 || total <= 0) return out;
  let given = 0;
  for (const [i, cls] of present.entries()) {
    const part = i === present.length - 1 ? dealt - given : (pools[cls] / total) * dealt;
    out[cls] = part;
    given += part;
  }
  return out;
}

/** Сложить два разложения (несколько стрелков по одной цели). */
export function addPools(a: ClassPools, b: ClassPools): ClassPools {
  return {
    infantry: a.infantry + b.infantry,
    vehicle: a.vehicle + b.vehicle,
    other: a.other + b.other,
  };
}

/** Разложение, умноженное на `k` (доля залпа одному врагу, множитель хука). */
export function scalePools(p: ClassPools, k: number): ClassPools {
  return { infantry: p.infantry * k, vehicle: p.vehicle * k, other: p.other * k };
}

export function poolsTotal(p: ClassPools): number {
  return p.infantry + p.vehicle + p.other;
}

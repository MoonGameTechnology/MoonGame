/**
 * УРОН ПО РОДУ ВОЙСК (решение владельца 2026-09-25): «есть два типа наземных юнитов —
 * техника и пехота, и у каждого юнита свой урон по этим типам». Четыре числа на юнит —
 * атака и оборона отдельно по пехоте и по технике (`attackVsInfantry`, `attackVsVehicle`,
 * `defenseVsInfantry`, `defenseVsVehicle`). Прежде наземный бой бил всех одной `attack` /
 * `defense`, а матрица «танк давит пехоту, спецназ грызёт броню» (`GROUND_ROSTER`, FND-4)
 * лежала рядом неподключённой.
 *
 * Правило ОДНО на живой бой (`modules/combat.ts`) и оба прогноза (`state/previewBattle.ts`,
 * `decisions/groundForecast.ts`): прогноз, считающий другим правилом, обещает игроку
 * другой бой. Урон по классам кладёт `damageByClass` (`util/combat.ts`).
 *
 * 1. **Класс цели — из данных.** Наземный юнит — его род (`kind`), всё остальное (корабли,
 *    челноки) — `other`. По `other` стреляют прежней `attack`/`defense`, поэтому бой
 *    флотов этим правилом не задет ни на единицу.
 * 2. **Смешанный отряд — раздельно по долям** (решение владельца). Доля класса — его доля
 *    в пуле корпуса цели (`count × hp`). Залп против цели = Σ по классам `доля × урон по
 *    классу`, и урон по пехоте ложится ТОЛЬКО на пехоту, по технике — только на технику:
 *    танки не прикрывают пехоту своей бронёй.
 * 3. **Кап линии огня выбирает стрелков по ВЗВЕШЕННОМУ урону** — по тому, насколько юнит
 *    опасен именно этому составу. Против брони вперёд выходит спецназ, против пехоты —
 *    танк. Разбивка по классам — точное разложение того же залпа, а не второй счёт.
 * 4. **Числа не объявлены — прежний стат.** Юнит без `…Vs…` бьёт по классу своей
 *    `attack`/`defense`: корабль, челнок, контент модов. Живой наземный каталог объявляет
 *    все четыре явно — это держит сторож в `schemas.test.ts`.
 */
import type { GameData, UnitDef } from '../data/schemas';
import type { UnitStack } from '../state/gameState';
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

/** Доли классов в пуле корпуса цели (правило 2). Пустая цель — все нули. */
export function classShares(targets: readonly UnitStack[], data: GameData): ClassPools {
  const pool = emptyPools();
  let total = 0;
  for (const s of targets) {
    if (s.count <= 0) continue;
    const def = data.units[s.unit];
    const hp = s.count * Math.max(0, def?.stats.hp ?? 0);
    pool[targetClassOf(def)] += hp;
    total += hp;
  }
  if (total <= 0) return pool;
  for (const cls of TARGET_CLASSES) pool[cls] /= total;
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
    // Те же статы, что взял кап (`effectiveStats` внутри разбивки), — здесь их читают
    // заново только чтобы разложить уже выбранный залп по классам.
    const stats = effectiveStats(def, stack, data);
    for (const cls of present) pools[cls] += row.firing * weight(cls) * statVs(stats, role, cls);
    total += row.damage;
  }
  return { total, rows, pools };
}

/** Есть ли у цели наземные войска. Нет — правило рода войск не участвует вовсе, и бой идёт
 *  прежним путём бит в бит (бой флотов, орбита): реплеи и золотые тесты его не заметят. */
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

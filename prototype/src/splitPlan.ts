/**
 * Сколько кораблей уводим в новый флот — арифметика диалога «Разделить» (REFM-76).
 *
 * Диалог живёт поверх ЖИВОГО флота: пока игрок жмёт «+10», состав может измениться
 * (бой, стыковка, приказ). Поэтому числа пересчитываются на каждой перерисовке, а не
 * копятся вслепую.
 *
 * 1. **Больше, чем есть, увести нельзя.** Зажим применяется и при перерисовке: если
 *    корабли погибли, вчерашний отбор обязан ужаться, а не уехать в отказ на сервере.
 * 2. **Отрицательного отбора не бывает** — «−1» на нуле не должен уводить флот в минус.
 * 3. **Ноль увести нельзя — это не деление.** Кнопка подтверждения гаснет.
 * 4. **Всё увести тоже нельзя:** это переименование флота, а не новый флот; в исходном
 *    обязан остаться хотя бы один корабль.
 * 5. **«Всё» берёт ровно наличное, а «+10» у остатка меньше десяти — остаток.** Шаг
 *    упирается в потолок, а не ломается и не пропускается.
 */

/** Стопка кораблей одного типа в составе флота. */
export interface UnitStackLike {
  unit: string;
  count: number;
}

/** Состав флота по типам: несколько стопок одного типа складываются. */
export function shipCounts(units: readonly UnitStackLike[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const st of units) out[st.unit] = (out[st.unit] ?? 0) + st.count;
  return out;
}

/** Отбор, зажатый наличным числом с обеих сторон (правила 1–2). */
export function clampTake(take: number, have: number): number {
  return Math.max(0, Math.min(have, take));
}

/** Шаг кнопки: `+n`, `−n` или «всё» — всегда в пределах наличного (правило 5). */
export function stepTake(cur: number, have: number, step: 'inc' | 'dec' | 'all', n = 0): number {
  if (step === 'all') return have;
  return clampTake(step === 'inc' ? cur + n : cur - n, have);
}

/**
 * Пересчёт всего отбора под текущий состав (правило 1). Типы, которых во флоте больше
 * нет, из отбора исчезают.
 */
export function normalizeTake(
  take: Readonly<Record<string, number>>,
  counts: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [unit, have] of Object.entries(counts)) out[unit] = clampTake(take[unit] ?? 0, have);
  return out;
}

/** Сколько уйдёт, сколько было и сколько останется. */
export function splitTotals(
  counts: Readonly<Record<string, number>>,
  take: Readonly<Record<string, number>>,
): { takeTotal: number; total: number; left: number } {
  let total = 0;
  let takeTotal = 0;
  for (const [unit, have] of Object.entries(counts)) {
    total += have;
    takeTotal += clampTake(take[unit] ?? 0, have);
  }
  return { takeTotal, total, left: total - takeTotal };
}

/** Можно ли подтверждать: не ноль и не всё (правила 3–4). */
export function canConfirm(takeTotal: number, total: number): boolean {
  return takeTotal > 0 && takeTotal < total;
}

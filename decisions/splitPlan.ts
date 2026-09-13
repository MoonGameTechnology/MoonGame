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
 * 6. **Адрес отбора — СТЕК, а не тип корабля (FSPLIT-1).** Один и тот же корпус летает
 *    и с начинкой, и голым, а лоадаут — часть личности стека (SM-0.3): «увести два
 *    крейсера» ничего не значит, пока не сказано КАКИХ. Поэтому строка окна — стек, а
 *    ключ строки несёт и юнит, и лоадаут.
 * 7. **Десант делится тем же отбором (FSPLIT-2)**, но упирается не в число, а в ТРЮМ:
 *    вместимость даёт корпус, поэтому увести транспорты, бросив на них войска, — такой
 *    же перегруз, как забрать войска без транспортов. Обе половины считаются здесь,
 *    чтобы кнопка гасла ДО отказа сервера.
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

// --- Стеки как адреса отбора (FSPLIT-1/2) -----------------------------------------

/** Канонический ключ лоадаута: набор, а не список (порядок модулей ничего не значит). */
export function loadoutKey(modules?: readonly string[]): string {
  if (!modules || modules.length === 0) return '';
  return [...modules].sort().join(',');
}

/** Строка отбора: конкретный стек флота — корабли или десант в трюме. */
export interface SplitSlot {
  /** Адрес строки: `юнит|лоадаут`. Совпадающие стеки складываются в один слот. */
  key: string;
  unit: string;
  modules?: string[];
  have: number;
  kind: 'ship' | 'landing';
}

/** Стопка с лоадаутом — то, из чего состоит живой флот. */
export interface LoadoutStackLike extends UnitStackLike {
  modules?: readonly string[];
}

/** Слоты флота: сначала корабли, затем десант; стеки с одинаковым «юнит+лоадаут»
 *  складываются (правило 6). Порядок стеков сохраняется — окно перерисовывается на
 *  каждый шаг счётчика, и прыгающие строки уводили бы палец не на ту кнопку. */
export function splitSlots(
  units: readonly LoadoutStackLike[],
  landing: readonly UnitStackLike[] = [],
): SplitSlot[] {
  const out: SplitSlot[] = [];
  const at = new Map<string, SplitSlot>();
  const add = (kind: 'ship' | 'landing', unit: string, count: number, modules?: readonly string[]) => {
    const key = `${kind}:${unit}|${loadoutKey(modules)}`;
    const seen = at.get(key);
    if (seen) {
      seen.have += count;
      return;
    }
    const slot: SplitSlot = { key, unit, have: count, kind };
    if (modules && modules.length > 0) slot.modules = [...modules];
    at.set(key, slot);
    out.push(slot);
  };
  for (const st of units) add('ship', st.unit, st.count, st.modules);
  for (const st of landing) add('landing', st.unit, st.count);
  return out;
}

/** Пересчёт отбора под живые слоты (правило 1): исчезнувший стек уходит и из отбора. */
export function normalizeSlotTake(
  take: Readonly<Record<string, number>>,
  slots: readonly SplitSlot[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const slot of slots) out[slot.key] = clampTake(take[slot.key] ?? 0, slot.have);
  return out;
}

/** Итоги по КОРАБЛЯМ — правила «не ноль и не всё» касаются только их: флот без единого
 *  корабля не флот, а десант сам по себе никуда не летит. */
export function shipTotals(
  slots: readonly SplitSlot[],
  take: Readonly<Record<string, number>>,
): { takeTotal: number; total: number; left: number } {
  let total = 0;
  let takeTotal = 0;
  for (const slot of slots) {
    if (slot.kind !== 'ship') continue;
    total += slot.have;
    takeTotal += clampTake(take[slot.key] ?? 0, slot.have);
  }
  return { takeTotal, total, left: total - takeTotal };
}

/** Сколько места в трюме и сколько занято — у каждой половины своё (правило 7). */
export interface CargoSplit {
  takenUsed: number;
  takenCapacity: number;
  keptUsed: number;
  keptCapacity: number;
  /** Влезает ли десант в обе половины. */
  fits: boolean;
}

/** Трюм обеих половин по текущему отбору. `capacity`/`size` читают данные игры
 *  (вместимость корпуса с его начинкой и объём наземного юнита) — сам модуль остаётся
 *  чистой арифметикой и в тесте обходится двумя функциями. */
export function cargoSplit(
  slots: readonly SplitSlot[],
  take: Readonly<Record<string, number>>,
  capacity: (unit: string, modules?: readonly string[]) => number,
  size: (unit: string) => number,
): CargoSplit {
  let takenCapacity = 0;
  let keptCapacity = 0;
  let takenUsed = 0;
  let keptUsed = 0;
  for (const slot of slots) {
    const tk = clampTake(take[slot.key] ?? 0, slot.have);
    const stay = slot.have - tk;
    if (slot.kind === 'ship') {
      takenCapacity += tk * capacity(slot.unit, slot.modules);
      keptCapacity += stay * capacity(slot.unit, slot.modules);
    } else {
      takenUsed += tk * size(slot.unit);
      keptUsed += stay * size(slot.unit);
    }
  }
  return {
    takenUsed,
    takenCapacity,
    keptUsed,
    keptCapacity,
    fits: takenUsed <= takenCapacity && keptUsed <= keptCapacity,
  };
}

/** Можно ли подтверждать раскол: корабли делятся честно (правила 3–4) И десант влезает
 *  в обе половины (правило 7). */
export function canConfirmSplit(
  slots: readonly SplitSlot[],
  take: Readonly<Record<string, number>>,
  cargo: CargoSplit,
): boolean {
  const { takeTotal, total } = shipTotals(slots, take);
  return canConfirm(takeTotal, total) && cargo.fits;
}

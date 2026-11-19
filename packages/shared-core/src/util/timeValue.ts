/**
 * МАТРИЦА ВРЕМЕНИ (TEC-1, резолюция владельца 2026-11-19, `docs/time-economy-roadmap.md`).
 *
 * Единица всех цен основной игры — эталонный игровой час (ЭЧ): то, что эталонная держава
 * добывает за игровой час (`data.timeValue.referenceHour`). Ресурсы, Суверены ◆ и Варранты ⌖
 * переводятся друг в друга только через ЭЧ, поэтому у любой цены один знаменатель.
 *
 * 1. **Цена линейна.** Единица ресурса стоит `weight / referenceHour` ЭЧ, и цена набора —
 *    сумма цен его частей: купить ресурсы по одному не дешевле и не дороже, чем набором.
 *    Веса в сумме дают 1, поэтому весь набор эталонного часа стоит ровно 1 ЭЧ.
 * 2. **Час игровой.** Ядро меряет время в игровых часах; на скорости партии ×N реальный час
 *    содержит N игровых, и его цена для игрока в N раз выше. Быстрая партия не распродажа.
 * 3. **Потолок ускорения K.** За каждый прошедший игровой час партии можно ускорить не
 *    больше `K − 1` часа: платящий идёт не больше чем в K раз быстрее бесплатного.
 * 4. **Матрицы нет — нуль, а не исключение.** Пустой `referenceHour` значит, что в этих
 *    данных цена часа не задана; функции отвечают нулём, и правила, построенные на ней,
 *    считаются выключенными (как пустые медали или нулевой ветеран).
 *
 * Только сложение, умножение и деление: результат одинаков на любом движке.
 */
import type { ResourceBag } from '../data/schemas';
import type { TimeValueDef } from '../data/timeValueSchema';

/** Цена единицы ресурса в ЭЧ (правило 1); ресурс вне матрицы — 0. */
export function unitHours(resource: string, def: TimeValueDef): number {
  const rate = def.referenceHour[resource];
  const weight = def.weights[resource];
  return rate !== undefined && rate > 0 && weight !== undefined ? weight / rate : 0;
}

/** Цена набора ресурсов в ЭЧ — сумма цен частей (правило 1). */
export function bundleHours(bag: ResourceBag, def: TimeValueDef): number {
  let hours = 0;
  for (const resource of Object.keys(bag).sort()) {
    const amount = bag[resource] ?? 0;
    if (amount > 0) hours += amount * unitHours(resource, def);
  }
  return hours;
}

/** Сколько единицы ресурса стоят `hours` ЭЧ; ресурс вне матрицы — 0. */
export function resourceForHours(resource: string, hours: number, def: TimeValueDef): number {
  const unit = unitHours(resource, def);
  return unit > 0 && hours > 0 ? hours / unit : 0;
}

/** Набор эталонного часа, умноженный на `hours`: ровно `hours` ЭЧ. */
export function hourBundle(hours: number, def: TimeValueDef): ResourceBag {
  const bag: ResourceBag = {};
  if (!(hours > 0)) return bag;
  for (const resource of Object.keys(def.referenceHour).sort())
    bag[resource] = (def.referenceHour[resource] ?? 0) * hours;
  return bag;
}

/** Есть ли в данных матрица (правило 4). */
export function hasTimeValue(def: TimeValueDef): boolean {
  return Object.keys(def.referenceHour).length > 0;
}

/** Цена `hours` игровых часов в ◆. */
export function sovereignsForHours(hours: number, def: TimeValueDef): number {
  return hasTimeValue(def) && hours > 0 ? hours * def.sovereignsPerHour : 0;
}

/** Сколько ⌖ стоят `hours` игровых часов — столько их зарабатывается игрой. */
export function warrantsForHours(hours: number, def: TimeValueDef): number {
  return hasTimeValue(def) && hours > 0 ? hours * def.warrantsPerHour : 0;
}

/** Сколько игровых часов в `realHours` реальных на скорости партии `timeScale` (правило 2). */
export function gameHoursOfReal(realHours: number, timeScale: number): number {
  return realHours > 0 && timeScale > 0 ? realHours * timeScale : 0;
}

/** Сколько игровых часов можно ускорить, когда партии `elapsedHours` игровых часов
 *  (правило 3). */
export function speedupBudgetHours(elapsedHours: number, def: TimeValueDef): number {
  return hasTimeValue(def) && elapsedHours > 0 ? (def.speedupCap - 1) * elapsedHours : 0;
}

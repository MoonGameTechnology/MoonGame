/**
 * Досягаемые миры в прицеле «Курс» (UIX-7.2): какие миры отметить кольцом и сроком пути,
 * пока «Курс» взведён, — до наведения, чтобы игрок видел варианты, а не держал их в
 * голове (правило Нильсена 6).
 *
 * На связной карте флот дойдёт почти до любого мира, и подпись у каждого на картах в
 * 50–100 миров стала бы кашей из цифр. Решение владельца 2026-10-19: метки только у
 * ближайших по сроку пути.
 *
 * 1. **Только миры с конечным положительным сроком.** Нет маршрута, флот не движется или
 *    это мир, где флот стоит, — срока нет, и метка обещала бы путь, которого нет.
 * 2. **Не больше {@link COURSE_REACH_LIMIT} миров, ближайшие по сроку.** Ровный срок —
 *    по id мира, чтобы набор не мигал от кадра к кадру.
 * 3. **Мир под указателем не метится.** У него уже есть путь и срок превью (`aimPreview`),
 *    второй срок рядом с первым только мешал бы.
 */

/** Сколько миров отмечать. */
export const COURSE_REACH_LIMIT = 6;

/** Мир-кандидат и срок пути до него в игровых часах (`null` — маршрута нет). */
export interface ReachCandidate {
  id: string;
  hours: number | null;
}

/** Миры с меткой, ближние первыми. `aimed` — мир под указателем (правило 3). */
export function courseReach(
  candidates: readonly ReachCandidate[],
  aimed: string | null = null,
  limit: number = COURSE_REACH_LIMIT,
): Array<{ id: string; hours: number }> {
  const out: Array<{ id: string; hours: number }> = [];
  for (const c of candidates) {
    if (c.id === aimed) continue; // правило 3
    if (c.hours === null || !Number.isFinite(c.hours) || c.hours <= 0) continue; // правило 1
    out.push({ id: c.id, hours: c.hours });
  }
  out.sort((a, b) => a.hours - b.hours || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)); // правило 2
  return out.slice(0, Math.max(0, limit));
}

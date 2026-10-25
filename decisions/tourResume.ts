/** «Вернуть обучение» (заказ владельца 2026-10-25): подсказки, закрытые кнопкой
 *  «Пропустить», возвращаются с начала этапа, на котором их закрыли. Начало этапа, а не
 *  сам шаг: середина этапа без первых шагов теряет смысл, а уже сделанное этапом шаги по
 *  состоянию засчитают сами. */

/** Индекс шага, с которого вернуть подсказки. `stages` — этап каждого шага по порядку,
 *  `reached` — дальний шаг, на который игрок успел зайти (`TourResult.reachedStep`). */
export function resumeStep(stages: readonly (string | undefined)[], reached: number): number {
  if (stages.length === 0 || !Number.isInteger(reached) || reached < 0) return 0;
  const at = Math.min(reached, stages.length - 1);
  const stage = stages[at];
  if (stage === undefined) return at;
  let first = at;
  while (first > 0 && stages[first - 1] === stage) first--;
  return first;
}

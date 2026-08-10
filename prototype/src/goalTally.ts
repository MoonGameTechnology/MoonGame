/**
 * Чем меряется прогресс списка первых целей ONB-7 (REFM-99).
 *
 * Список показывается в обучающем матче и отмечает «шахта построена», «флот поднят»,
 * «мир взят». Счётчики жили тремя стрелками рядом с живым состоянием, и из них не
 * читалось главное: почему сравнение идёт С БАЗОЙ, а шахты считаются уровнями.
 *
 * 1. **Прогресс меряется ОТ БАЗЫ на момент запуска списка, а не абсолютом.** У игрока
 *    на старте уже есть и мир, и флот, и шахта — абсолютный счёт отметил бы половину
 *    списка сразу, ничему не научив.
 * 2. **Шахты считаются СУММОЙ УРОВНЕЙ, а не числом зданий.** Домашняя шахта уже стоит,
 *    поэтому «построить шахту» на деле значит поднять ей уровень; счёт зданий этого не
 *    заметил бы. То же правило продолжает работать, если захваченный мир добавит вторую
 *    шахту — уровни просто складываются.
 * 3. **Считается только СВОЁ.** Чужие миры, флоты и шахты к списку отношения не имеют.
 * 4. **Нужно СТРОГО БОЛЬШЕ базы:** равенство — это отсутствие прогресса, а не его край.
 */

/** Мир, каким его видит счётчик целей. */
export interface TallyWorld {
  owner: string | null;
  buildings: readonly { type: string; level: number }[];
}

/** Флот, каким его видит счётчик целей. */
export interface TallyFleet {
  owner: string | null;
}

/** Снимок, от которого отсчитывается прогресс (правило 1). */
export interface GoalBase {
  worlds: number;
  mineLevel: number;
  fleets: number;
}

/** Сумма УРОВНЕЙ своих шахт (правила 2–3). */
export function mineLevels(worlds: readonly TallyWorld[], me: string): number {
  let n = 0;
  for (const w of worlds) {
    if (w.owner !== me) continue;
    for (const b of w.buildings) if (b.type === 'mine') n += b.level;
  }
  return n;
}

/** Сколько миров принадлежит игроку (правило 3). */
export function worldCount(worlds: readonly TallyWorld[], me: string): number {
  return worlds.filter((w) => w.owner === me).length;
}

/** Сколько флотов принадлежит игроку (правило 3). */
export function fleetCount(fleets: readonly TallyFleet[], me: string): number {
  return fleets.filter((f) => f.owner === me).length;
}

/** Снять базу на момент запуска списка (правило 1). */
export function goalBaseline(
  worlds: readonly TallyWorld[],
  fleets: readonly TallyFleet[],
  me: string,
): GoalBase {
  return {
    worlds: worldCount(worlds, me),
    mineLevel: mineLevels(worlds, me),
    fleets: fleetCount(fleets, me),
  };
}

/** Есть ли прогресс: строго больше базы, равенство не считается (правило 4). */
export function grew(now: number, base: number): boolean {
  return now > base;
}

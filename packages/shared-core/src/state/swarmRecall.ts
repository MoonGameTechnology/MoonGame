/**
 * Чтение памяти Роя (`GameState.swarmMemory`) с окном — общее модулю адаптации и драйверу.
 *
 * Живёт в `state/`, а не в `modules/swarmMemory.ts`, который память ПИШЕТ: модули ядра
 * не импортируют друг друга (инвариант 3 в `CLAUDE.md`), а читать её нужно и
 * `modules/swarmAdapt.ts`, и прототипу (SLIM-7).
 */
import type { SwarmMemory } from './gameState';

/**
 * Что Рой ПОМНИТ о классе при заданной глубине взгляда — чистая функция, общая ядру и
 * драйверу.
 *
 * `window` в столкновениях; `null` — «весь забег» (профиль операции). Окно отсчитывается
 * от последнего зачтённого столкновения, а не от текущего времени: столкновений может
 * не быть часами, и привязка ко времени означала бы, что память тает сама собой, пока
 * игрок отстраивается.
 */
export function recalled(
  memory: SwarmMemory | undefined,
  kind: string,
  window: number | null,
  known: ReadonlySet<number> | null = null,
): number {
  if (!memory) return 0;
  if (known === null) {
    const from = window === null ? 0 : memory.engagements - window;
    return memory.observations.filter((o) => o.kind === kind && o.ordinal > from).length;
  }
  // Сеть Роя (`docs/swarm-behavior.md`): часть помнит только то, что до неё ДОШЛО, и
  // окно считается по её собственным столкновениям — последние `window` из известных
  // ей, а не из всего журнала забега.
  const mine = [...known].sort((a, b) => a - b);
  const from =
    window === null || mine.length <= window ? -Infinity : mine[mine.length - window - 1]!;
  return memory.observations.filter(
    (o) => o.kind === kind && known.has(o.ordinal) && o.ordinal > from,
  ).length;
}

/**
 * Покой карты (правило 10 `decisions/simClock.ts`): когда игрок последний раз касался экрана,
 * жал клавишу, крутил колесо или водил мышью, и идёт ли поэтому карта в покое редко. Сам закон —
 * в `simClock.ts`; здесь только часы ввода, которых у чистого решения нет.
 */
import { mapResting, type MapRest } from '../../decisions/simClock';

/** Ввод, который будит кадр и отодвигает покой. */
export const WAKE_EVENTS = ['pointerdown', 'pointermove', 'wheel', 'keydown'] as const;

let lastWakeAt = 0;

/** Ввод будит кадр (`ask`) сразу и отодвигает покой. Возвращает побудку для других поводов
 *  (смена экрана), которая тоже считается вводом. */
export function wakeOnInput(ask: () => void): () => void {
  const wake = (): void => {
    lastWakeAt = performance.now();
    ask();
  };
  for (const type of WAKE_EVENTS) addEventListener(type, wake, { capture: true, passive: true });
  return wake;
}

/** Идёт ли карта в `now` редко (правило 10): тишина ввода считается здесь. */
export function mapRestsAt(now: number, rest: Omit<MapRest, 'quietMs'>): boolean {
  return mapResting({ ...rest, quietMs: now - lastWakeAt });
}

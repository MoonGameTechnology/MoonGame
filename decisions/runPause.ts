/**
 * Пауза забега Sector Zero (`YAG-6.2`) — чистое решение, без DOM и таймеров.
 *
 * **Резолюция владельца 2026-09-24:** мир забега ЗАМИРАЕТ, пока игрока нет, и у игрока
 * есть кнопка паузы на любом устройстве. До неё забег тикал без игрока по наследству от
 * основной игры: при темпе ~150× десять минут в другой вкладке — это несколько волн,
 * отыгранных без него.
 *
 * Правила — ровно четыре события, и у каждого одно поведение:
 *
 * 1. **Кнопка** переключает: идёт — встаёт, стоит — идёт с тем темпом, что был до паузы
 *    (обычным или ускоренным, а не «по умолчанию»).
 * 2. **Уход со страницы** (вкладка в фоне, свёрнутое окно) ставит паузу, и на возврате мир
 *    ЖДЁТ игрока: продолжит его кнопка. Возобновись мир сам, случайный возврат вкладки
 *    отыграл бы волну раньше, чем игрок понял, где он.
 * 3. **Пауза площадки** (её оверлей, реклама) ставит паузу, а её «продолжить» снимает —
 *    но только ту паузу, которую поставила она сама. Игрок, вставший на паузу раньше,
 *    не должен получить идущий мир из-за чужого события.
 * 4. **Уход со страницы поверх паузы площадки** передаёт паузу игроку: площадка её уже не
 *    снимет, мир ждёт кнопки.
 *
 * Нагон времени паузы — не забота этого файла: клиент, возобновляя мир, сбрасывает свою
 * отметку реального времени (как у соло-сохранения), и отсутствие не отыгрывается.
 */

/** Часы забега глазами паузы. `speed` — текущий темп мира (0 — стоит). */
export interface RunClock {
  speed: number;
  /** С каким темпом продолжить. Клиент обязан передать > 0 (темп «играть»). */
  resumeSpeed: number;
  /** Пауза поставлена площадкой — её «продолжить» и снимает (правило 3). */
  platformHeld: boolean;
}

export type RunPauseEvent = 'toggle' | 'hidden' | 'platform-pause' | 'platform-resume';

/** Мир стоит. */
export const runPaused = (clock: RunClock): boolean => clock.speed <= 0;

/** Поставить паузу, запомнив, с каким темпом шли. Уже стоит — темп не трогаем. */
const hold = (clock: RunClock, platformHeld: boolean): RunClock =>
  runPaused(clock) ? clock : { speed: 0, resumeSpeed: clock.speed, platformHeld };

/** Продолжить с запомненным темпом. Темпа нет — мир остаётся стоять: лучше лишнее
 *  нажатие, чем мир, пошедший с нулевой или отрицательной скоростью. */
const release = (clock: RunClock): RunClock =>
  clock.resumeSpeed > 0
    ? { speed: clock.resumeSpeed, resumeSpeed: clock.resumeSpeed, platformHeld: false }
    : { ...clock, platformHeld: false };

export function runPauseStep(clock: RunClock, event: RunPauseEvent): RunClock {
  switch (event) {
    case 'toggle':
      return runPaused(clock) ? release(clock) : hold(clock, false);
    case 'hidden':
      // Правила 2 и 4: пауза — игрока, даже если до этого её держала площадка.
      return { ...hold(clock, false), platformHeld: false };
    case 'platform-pause':
      return hold(clock, true);
    case 'platform-resume':
      return clock.platformHeld ? release(clock) : clock;
  }
}

/**
 * Как мир выглядит на карте вне обзора (владелец 2026-10-23: «если было разведано, то
 * должно запоминаться»).
 *
 * 1. **Разведанный мир рисуется так же, как при разведке.** Вид провинции, владелец,
 *    постройки и гарнизон берутся из снимка памяти. Раньше такой мир сжимался в бледную
 *    подпись в две строки, и карта будто забывала разведанное, стоило флоту улететь.
 * 2. **Память приглушена и неподвижна.** Живое на карте дышит и вращается, снимок нет:
 *    так видно, что сведения старые, без лишней надписи на каждом мире.
 * 3. **Вид провинции — из снимка, а не из живого мира.** Крепость, поставленная после
 *    разведки, не должна проступить сквозь туман (тот же принцип, что у владельца).
 *
 * Снимок хранит только то, что глаз видел: в нём нет прочности построек, поэтому полосы
 * прочности у памяти нет. Это решает рисующий: у постройки снимка просто нет `hp`.
 */

/** Что видно в живом мире. */
export interface LiveWorld<B> {
  owner: string | null;
  garrison: readonly { count: number }[];
  buildings: readonly B[];
}

/** Снимок памяти разведки. */
export interface RememberedWorld<B> {
  owner: string | null;
  garrison: number;
  buildings: readonly B[];
  environment?: { kind?: string };
}

/** То, по чему карта рисует мир. */
export interface WorldLook<B> {
  owner: string | null;
  garrison: number;
  buildings: readonly B[];
  /** Вид провинции, которым рисовать. */
  sector: string;
  /** Нарисован по памяти, а не по живому миру. */
  stale: boolean;
}

/** Насколько память тусклее живого мира (правило 2). */
export const STALE_ALPHA = 0.75;

/**
 * Чем рисовать мир: живым, если он в обзоре (`remembered` не передан), иначе снимком памяти.
 * `sector` — вид, которым мир рисовался бы вживую; снимок без вида (сохранение до него)
 * оставляет его.
 */
export function worldLook<L, R>(
  live: LiveWorld<L>,
  sector: string,
  remembered?: RememberedWorld<R>,
): WorldLook<L | R> {
  if (!remembered)
    return {
      owner: live.owner,
      garrison: live.garrison.reduce((n, st) => n + st.count, 0),
      buildings: live.buildings,
      sector,
      stale: false,
    };
  return {
    owner: remembered.owner,
    garrison: remembered.garrison,
    buildings: remembered.buildings,
    sector: remembered.environment?.kind ?? sector,
    stale: true,
  };
}

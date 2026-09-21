/** Battle badges have their own screen-space target above the clash centre.
 * Armed map orders win. The province-area fallback is selection, not an order:
 * it must run AFTER badge picking or every battle inside a province is unreachable.
 * Invisible battles are rejected; overlapping badges choose nearest, then stable id.
 */

/** Бой в том виде, в каком его читает тап: где кольцо и опознан ли узел. */
export interface BattleTapTarget {
  id: string;
  /** Точка схватки на ЭКРАНЕ (уже спроецированная камерой), либо null — кольца нет. */
  at: { x: number; y: number } | null;
  /** Узел опознан игроком: под туманом кольца не рисуют и тапать нечего (правило 3). */
  identified: boolean;
}

/** Радиус попадания по значку боя: у пальца шире, чем у курсора (правило 2). */
export function battleTapRadius(byTouch: boolean): number {
  return byTouch ? 26 : 20;
}

/**
 * Какой бой забирает тап — или null, если никакой.
 *
 * `taken` — занят ли тап вооружённым приказом; выбор провинции сюда не относится.
 */
export function battleAtTap(
  battles: readonly BattleTapTarget[],
  point: { x: number; y: number },
  byTouch: boolean,
  taken: boolean,
): string | null {
  if (taken) return null; // правило 1
  const r = battleTapRadius(byTouch);
  let best: { id: string; d: number } | null = null;
  for (const b of battles) {
    if (!b.identified || !b.at) continue; // правило 3
    const dx = b.at.x - point.x;
    const dy = b.at.y - point.y;
    const d = Math.hypot(dx, dy);
    if (d > r) continue; // «в пределах», а не «ближе всех»
    // Правило 4: ближайший, ничья — по id, чтобы исход не зависел от порядка обхода.
    if (best === null || d < best.d || (d === best.d && b.id < best.id)) best = { id: b.id, d };
  }
  return best?.id ?? null;
}

/** Shared by rendering and picking: a distinct badge above the combat centre. */
export function battleBadgePoint(at: { x: number; y: number }): { x: number; y: number } {
  return { x: at.x, y: at.y - 34 };
}

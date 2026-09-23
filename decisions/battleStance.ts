/**
 * Боевая стойка флотов на орбите (заказ владельца 2026-09-23): флот, вступивший в бой, не
 * исчезает и не кружит по кольцу — он встаёт в строй своей стороны лицом к противнику.
 *
 * Стороны — владельцы флотов этого боя. Сторона смотрящего всегда СЛЕВА (угол π), чужие
 * расходятся по кругу от неё равными долями: при двух сторонах противник ровно справа. Внутри
 * стороны флоты веером вокруг её угла, в стабильном порядке id. Нос флота смотрит в центр
 * кольца — туда, где идёт бой. Чистая функция: ни кадра, ни фазы орбиты.
 */
export interface StanceSlot {
  /** Угол места на орбитальном кольце, радианы (экранные: 0 — вправо, π/2 — вниз). */
  angle: number;
  /** Куда смотрит нос: в центр кольца. */
  heading: number;
}

/** Шаг веера флотов одной стороны, радианы. */
export const STANCE_FAN = 0.34;

export function battleStance(
  fleets: ReadonlyArray<{ id: string; owner: string }>,
  viewer: string,
): Map<string, StanceSlot> {
  const owners = [...new Set(fleets.map((f) => f.owner))].sort((a, b) =>
    a === viewer ? -1 : b === viewer ? 1 : a < b ? -1 : a > b ? 1 : 0,
  );
  const out = new Map<string, StanceSlot>();
  owners.forEach((owner, k) => {
    const side = Math.PI + (k * 2 * Math.PI) / owners.length;
    const mine = fleets
      .filter((f) => f.owner === owner)
      .map((f) => f.id)
      .sort();
    mine.forEach((id, i) => {
      const angle = side + (i - (mine.length - 1) / 2) * STANCE_FAN;
      out.set(id, { angle, heading: angle + Math.PI });
    });
  });
  return out;
}

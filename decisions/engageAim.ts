/**
 * Цель «Атаки» под указателем (сообщение владельца 2026-09-24: «кнопка атаки не работает;
 * должен показываться путь красным пунктиром и выделяться красным объект, который можно
 * атаковать флотом»).
 *
 * «Атака» бьёт по ФЛОТУ (ATK-1), и прежде принимала только тап точно в маркер флота:
 * тап по миру, где этот флот стоит, — по базе пиратов, по гнезду Роя — снимал прицел с
 * подсказкой, а игрок видел «кнопка не работает». Здесь одно правило на прицел, превью
 * и нажатие, чтобы превью не обещало цель, которую нажатие не возьмёт.
 *
 * 1. **Флот рядом с указателем — он и цель.** Ближайший в радиусе касания.
 * 2. **Иначе — мир под указателем: цель — флот противника на нём.** Самый крупный: по
 *    нему игрок и целился, щёлкая по базе; при равенстве — по id, чтобы превью и
 *    нажатие выбрали один и тот же.
 * 3. **Нет ни того, ни другого — цели нет.** Мир без флота противника «Атаке» не цель:
 *    для мира есть «Штурм» и «Курс».
 */

/** Флот противника, по которому может ударить «Атака». */
export interface EngageCandidate {
  id: string;
  /** Узел, где флот стоит; `null` — в пути. */
  location: string | null;
  /** Точка маркера на карте (в тех же координатах, что указатель). */
  x: number;
  y: number;
  ships: number;
}

/** Цель под указателем (правила 1–3). `nodeAt` — мир под указателем, если он есть. */
export function engageFoeAt<T extends EngageCandidate>(
  candidates: readonly T[],
  point: { x: number; y: number },
  radius: number,
  nodeAt: string | null,
): T | null {
  let best: T | null = null;
  let bestD = radius;
  for (const c of candidates) {
    const d = Math.hypot(c.x - point.x, c.y - point.y);
    if (d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  if (best || !nodeAt) return best;
  let there: T | null = null;
  for (const c of candidates) {
    if (c.location !== nodeAt) continue;
    if (!there || c.ships > there.ships || (c.ships === there.ships && c.id < there.id)) there = c;
  }
  return there;
}

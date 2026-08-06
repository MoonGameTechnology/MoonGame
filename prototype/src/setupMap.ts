/**
 * Мини-карта экрана сетапа: где стартовать (REFM-45).
 *
 * Мини-карта рисуется SVG'ом, и в ней есть три вещи, которые ломаются молча.
 *
 * 1. **Каждая трасса рисуется ОДИН раз.** Связи в данных двусторонние: узел A знает
 *    про B, а B — про A. Пройди по ним в лоб, и половина карты получит по две линии
 *    друг на друге: полупрозрачные штрихи сложатся и станут ярче соседних, будто там
 *    важная магистраль. Правило «рисуем ребро, только когда встретили его младший
 *    конец» и есть то, что держит вид карты честным.
 * 2. **Кандидаты идут ПОСЛЕДНИМИ.** Кружок стартовой точки крупнее обычного узла, и
 *    если нарисовать его раньше, обычные узлы лягут сверху и перекроют цель тапа —
 *    экран будет выглядеть кликабельным, но не отзываться.
 * 3. **Рамка с отступом.** Без него узлы у края обрезаются ровно наполовину, а
 *    выбранный кандидат — он ещё крупнее — тем более.
 */

/** Узел карты в том виде, в каком его держит `map.ts`. */
export interface MapNodeLike {
  id: string;
  x: number;
  y: number;
  links: readonly string[];
}

/** Отрезок трассы между двумя узлами. */
export interface Lane<T extends MapNodeLike = MapNodeLike> {
  from: T;
  to: T;
}

/** Рамка мини-карты: охватывает все узлы плюс отступ, чтобы края не срезались. */
export function mapViewBox(
  nodes: readonly MapNodeLike[],
  pad: number,
): { x: number; y: number; w: number; h: number } {
  if (nodes.length === 0) return { x: -pad, y: -pad, w: pad * 2, h: pad * 2 };
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/**
 * Трассы без повторов: ребро берётся только со стороны МЛАДШЕГО конца (см. шапку).
 * Ссылки в никуда пропускаются — карта не обязана быть согласованной, чтобы рисоваться.
 */
export function lanes<T extends MapNodeLike>(nodes: readonly T[]): Array<Lane<T>> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: Array<Lane<T>> = [];
  for (const n of nodes) {
    for (const id of n.links) {
      const m = byId.get(id);
      if (!m || m.id < n.id) continue;
      out.push({ from: n, to: m });
    }
  }
  return out;
}

/** Порядок рисования узлов: сначала фон, потом стартовые кандидаты поверх него. */
export function drawOrder<T extends MapNodeLike>(
  nodes: readonly T[],
  candidates: readonly string[],
): { plain: T[]; candidates: T[] } {
  const cand = new Set(candidates);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    plain: nodes.filter((n) => !cand.has(n.id)),
    // Порядок кандидатов — как в списке стартовых точек, а не как на карте:
    // список и есть то, по чему игрок их перебирает.
    candidates: candidates.flatMap((id) => {
      const n = byId.get(id);
      return n ? [n] : [];
    }),
  };
}

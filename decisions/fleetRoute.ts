/**
 * Пунктирный маршрут идущего флота на карте (REFM-95).
 *
 * Линия строится из трёх разных источников — фактическое место флота, узлы маршрута и
 * возможная ТОЧКА остановки на последнем лейне, — и всё это лежало одним циклом внутри
 * рисования, вперемешку с настройкой канвы. Из-за этого не читалось главное: почему
 * последняя точка иногда не узел и чей вообще маршрут виден.
 *
 * 1. **Виден только СВОЙ маршрут и только у идущего флота.** Чужой план — это разведка,
 *    которой у игрока нет (сервер её и не присылает), а у стоящего флота маршрута нет
 *    вовсе.
 * 2. **Линия начинается с ФАКТИЧЕСКОГО места флота,** а не с узла, откуда он вышел:
 *    иначе она тянулась бы из уже покинутой точки и врала бы про пройденный путь.
 * 3. **Приказ «встать НА ЛЕЙНЕ» кончается точкой, а не узлом.** Когда доля `parkT`/`endT`
 *    меньше единицы, последняя точка — доля последнего отрезка; дотянуть линию до узла
 *    значило бы обещать прибытие, которого приказ не содержит.
 * 4. **Пропавший узел маршрут не рвёт:** его просто нет в списке — карта могла обогнать
 *    состояние, и падать из-за этого линия не должна.
 * 5. **Выделенный маршрут ярче и толще** — среди десятка своих линий выбранная должна
 *    читаться сразу.
 *
 * Диапазон доли здесь НЕ зажимается намеренно: его держит ядро — `targetsOf`
 * (`movement.ts`) схлопывает `t <= EPS` и `t >= 1 - EPS` в узел, так что `parkT` вне
 * (0,1) не доезжает до карты по построению. Зажим на клиенте был бы обработкой
 * невозможного случая и вторым местом, где живёт одно правило.
 */

/** Точка в мировых координатах. */
export interface RoutePoint {
  x: number;
  y: number;
}

/** Ход флота, каким его видит карта. */
export interface RouteMovement {
  from: string;
  to: string;
  path?: string[];
  parkT?: number;
  endT?: number;
}

/** Показываем ли маршрут этого флота (правило 1). */
export function routeShown(owner: string | null, me: string, moving: boolean): boolean {
  return moving && owner === me;
}

/** Доля последнего отрезка, на которой флот встанет; единица — идёт до узла. */
export function parkFraction(mv: RouteMovement): number {
  return mv.parkT ?? mv.endT ?? 1;
}

/** Узлы маршрута по порядку: ближайший пункт, затем остаток пути. */
export function routeNodes(mv: RouteMovement): string[] {
  return [mv.to, ...(mv.path ?? [])];
}

/**
 * Опорные точки маршрута в МИРОВЫХ координатах, без места самого флота (его добавляет
 * вызывающий уже в экранных — правило 2). `posOf` возвращает позицию узла или `undefined`,
 * если узла нет в состоянии (правило 4).
 */
export function routeStops(
  mv: RouteMovement,
  posOf: (id: string) => RoutePoint | undefined,
): RoutePoint[] {
  const nodes = routeNodes(mv);
  const frac = parkFraction(mv);
  const out: RoutePoint[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const dest = posOf(nodes[i]!);
    if (!dest) continue;
    if (i === nodes.length - 1 && frac < 1) {
      const prev = posOf(i === 0 ? mv.from : nodes[i - 1]!);
      if (prev) {
        out.push({ x: prev.x + (dest.x - prev.x) * frac, y: prev.y + (dest.y - prev.y) * frac });
        continue;
      }
    }
    out.push(dest);
  }
  return out;
}

/** Начертание линии: выделенный маршрут ярче и толще (правило 5). */
export function routeStroke(selected: boolean): { alpha: number; width: number; blur: number } {
  return selected ? { alpha: 0.85, width: 1.8, blur: 8 } : { alpha: 0.32, width: 1.1, blur: 2 };
}

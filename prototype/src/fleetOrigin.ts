/**
 * ГДЕ ФЛОТ ЕСТЬ — точка, от которой меряют правила (в отличие от того, где он нарисован).
 *
 * У стоящего флота на карте ДВЕ разные точки, и путать их — баг:
 *
 *  - **Якорь картинки** (`fleetAnchor` в `main.ts`) — слот на орбитальном кольце мира.
 *    Он ездит вокруг планеты: кольцо вращается по игровому времени, его радиус дышит с
 *    зумом и зажимается зазором до соседа (`orbitRing.ts`, правила 1–7). Это ЧИСТО
 *    картинка плюс мишень для пальца.
 *  - **Точка отсчёта** (здесь) — то, где флот находится по правилам: центр мира, на
 *    орбите которого он стоит.
 *
 * Ядро знает флот на УЗЛЕ, а не на кольце: дальность способности героя меряется от
 * `planets[heroNode(state, hero)].position` (`modules/hero.ts`, гейт `E_OUT_OF_RANGE`),
 * маршрут строится от узла. Поэтому круг досягаемости или начало линии приказа,
 * нарисованные от кружащей модельки, врут на радиус кольца в любую сторону — причём
 * молча и по-разному в каждом кадре: игрок целится по границе, которой у ядра нет.
 *
 * Правила:
 *
 * 1. **Стоит на орбите → центр мира.** Кольцо не сдвигает флот: `location` и есть ответ.
 * 2. **В пути → живая интерполяция** по доле пройденного времени в границах отрезка
 *    (`startT`..`endT`): нога может покрывать не весь лейн, а его кусок — выход из
 *    стоянки посреди дороги или приказ встать в точке на ней.
 * 3. **Припаркован НА лейне → доля `t`** этого лейна, а не ближайший узел: приказ
 *    «встать на дороге» оставляет флот между мирами, и мерить от узла значило бы
 *    приписать ему прибытие, которого не было.
 * 4. **Свободный полёт (эскадрильи/ракеты) — вне графа лейнов:** интерполяция от
 *    `freePosition` к точке цели, а стоящий на месте — сама `freePosition`.
 * 5. **Нет позиции — нет точки.** Неизвестный узел (туман обогнал состояние) или флот
 *    без места даёт `null`, а не подставной ноль: рисующий просто пропускает его.
 *
 * Доля времени зажимается в [0,1]: кадр может прийти после `arrivesAt`, пока ядро ещё
 * не перевело флот в узел, и без зажима точка уехала бы за конец дороги.
 */

/** Точка в МИРОВЫХ координатах (экранная проекция — забота рисующего). */
export interface OriginPoint {
  x: number;
  y: number;
}

/** Нога пути: отрезок лейна `from`→`to`, пройденный между двумя отметками времени. */
export interface OriginMovement {
  from: string;
  to: string;
  departedAt: number;
  arrivesAt: number;
  startT?: number;
  endT?: number;
}

/** Стоянка в точке НА лейне: доля `t` от `from` к `to`. */
export interface OriginEdge {
  from: string;
  to: string;
  t: number;
}

/** Свободный полёт вне графа лейнов (эскадрильи/ракеты). */
export interface OriginFreeMovement {
  targetX: number;
  targetY: number;
  departedAt: number;
  arrivesAt: number;
}

/** Флот глазами этой модели — только поля, определяющие место. */
export interface OriginFleet {
  location?: string | null;
  movement?: OriginMovement | null;
  edge?: OriginEdge | null;
  freePosition?: OriginPoint | null;
  freeMovement?: OriginFreeMovement | null;
}

/** Доля пройденного пути на момент `now`, зажатая в [0,1]. */
function progress(departedAt: number, arrivesAt: number, now: number): number {
  const span = arrivesAt - departedAt;
  if (!(span > 0)) return 1; // мгновенная нога (и защита от деления на ноль)
  return Math.min(1, Math.max(0, (now - departedAt) / span));
}

/** Точка на отрезке `a`→`b` по доле `t`. */
function lerp(a: OriginPoint, b: OriginPoint, t: number): OriginPoint {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/**
 * Где флот НАХОДИТСЯ по правилам — мировая точка, от которой меряют дальности и от
 * которой начинают маршруты. `nodeAt` отдаёт позицию узла карты (или `null`, если узел
 * неизвестен), `now` — игровое время кадра.
 */
export function fleetOrigin(
  f: OriginFleet,
  now: number,
  nodeAt: (planetId: string) => OriginPoint | null,
): OriginPoint | null {
  // Правило 4: свободный полёт живёт вне графа лейнов.
  if (f.freeMovement) {
    const from = f.freePosition;
    if (!from) return null;
    const fm = f.freeMovement;
    const t = progress(fm.departedAt, fm.arrivesAt, now);
    return lerp(from, { x: fm.targetX, y: fm.targetY }, t);
  }
  if (f.freePosition) return { x: f.freePosition.x, y: f.freePosition.y };
  // Правило 1: стоит на орбите — центр мира, кольцо ни при чём.
  if (f.location) {
    const p = nodeAt(f.location);
    return p ? { x: p.x, y: p.y } : null;
  }
  // Правило 3: стоянка в точке на лейне.
  if (f.edge) {
    const a = nodeAt(f.edge.from);
    const b = nodeAt(f.edge.to);
    return a && b ? lerp(a, b, f.edge.t) : null;
  }
  // Правило 2: в пути — доля внутри границ ноги.
  const m = f.movement;
  if (!m) return null; // правило 5
  const a = nodeAt(m.from);
  const b = nodeAt(m.to);
  if (!a || !b) return null;
  const s0 = m.startT ?? 0;
  const e0 = m.endT ?? 1;
  return lerp(a, b, s0 + (e0 - s0) * progress(m.departedAt, m.arrivesAt, now));
}

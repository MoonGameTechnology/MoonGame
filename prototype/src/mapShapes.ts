/**
 * Геометрия фигур карты: многоугольники, уголки прицела и поля астероидов (REFM-34).
 *
 * Рисование остаётся в `main.ts` — сюда переехало то, ЧТО рисовать, отдельно от того,
 * чем. Канва проверяется только глазами; чистые точки — тестом.
 *
 * Правило, ради которого поле астероидов вообще считается формулой, а не случайностью:
 * **камни не должны мерцать между кадрами.** Поле раскладывается детерминированным
 * генератором, засеянным КООРДИНАТАМИ узла, поэтому один и тот же перекрёсток всегда
 * выглядит одинаково — и в этом кадре, и в следующем, и после перезахода.
 */

const TAU = Math.PI * 2;

/** Вершины правильного многоугольника — контур форта/станции. */
export function polyPoints(
  x: number,
  y: number,
  r: number,
  sides: number,
  rot = 0,
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * TAU;
    out.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
  }
  return out;
}

/** Один угловой штрих прицела: от «хвоста» к углу и дальше по другой стороне. */
export interface BracketStroke {
  from: { x: number; y: number };
  corner: { x: number; y: number };
  to: { x: number; y: number };
}

/** Четыре уголка «захваченной цели»: по одному в каждом квадранте. */
export function bracketStrokes(r: number, len: number): BracketStroke[] {
  const quadrants: ReadonlyArray<readonly [number, number]> = [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ];
  return quadrants.map(([sx, sy]) => ({
    from: { x: sx * r - sx * len, y: sy * r },
    corner: { x: sx * r, y: sy * r },
    to: { x: sx * r, y: sy * r - sy * len },
  }));
}

/** Камень пояса: смещение от узла, радиус, поворот и число граней. */
export interface Rock {
  dx: number;
  dy: number;
  r: number;
  rot: number;
  sides: number;
}

/** Пояс сплюснут по вертикали — так он читается как кольцо, а не как облако. */
export const BELT_FLATTEN = 0.72;

/**
 * Разложить поле астероидов вокруг точки. Генератор засеян координатами узла и
 * полностью детерминирован: тот же перекрёсток — то же поле в каждом кадре (см. шапку).
 */
export function makeRocks(x: number, y: number): Rock[] {
  let seed = (Math.floor(x * 3457) ^ Math.floor(y * 8761) ^ 0x9e3779b9) >>> 0;
  const rnd = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  const rocks: Rock[] = [];
  const count = 9 + Math.floor(rnd() * 4);
  for (let i = 0; i < count; i++) {
    const ang = rnd() * TAU;
    const dist = 7 + rnd() * 21;
    rocks.push({
      dx: Math.cos(ang) * dist,
      dy: Math.sin(ang) * dist * BELT_FLATTEN,
      r: 1.5 + rnd() * 2.8,
      rot: rnd() * TAU,
      sides: 3 + Math.floor(rnd() * 3),
    });
  }
  return rocks;
}

/** Поля, уже разложенные в этом сеансе: раскладка стоит прогона генератора, а узлов
 *  на карте много и рисуются они каждый кадр. */
const cache = new Map<string, Rock[]>();

/** Поле астероидов узла — считается один раз и потом отдаётся из памяти. */
export function asteroidsFor(id: string, x: number, y: number): Rock[] {
  const hit = cache.get(id);
  if (hit) return hit;
  const rocks = makeRocks(x, y);
  cache.set(id, rocks);
  return rocks;
}

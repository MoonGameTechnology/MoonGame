/**
 * Как план ложится на карту: линия маршрута и раскладка капсул шагов (REFM-71).
 *
 * План — это список шагов, а карта — граф лейнов. Между ними стоит раскладка, и её
 * правила были размазаны по телу отрисовки.
 *
 * 1. **Линия идёт ПО ЛЕЙНАМ, а не по прямой.** План обязан рисоваться там, где флот
 *    реально полетит; прямая между точками врала бы про путь и про время.
 * 2. **Маршрут не нашёлся — ставим хотя бы конечную точку.** Линия оборвётся честно, но
 *    шаг не исчезнет с карты молча.
 * 3. **Шаги НЕ-перелёты текущую точку не двигают.** Ждать, штурмовать, бить залпом —
 *    всё это происходит ТАМ ЖЕ, и линия от них расти не должна.
 * 4. **Перелёт «сюда же» пропускается.** Иначе полилиния получит нулевой сегмент, а
 *    точка задвоится в списке узлов.
 * 5. **Несколько шагов в одной точке — капсулы стопкой вправо.** Иначе они лягут друг
 *    на друга и план станет нечитаемым именно там, где он самый плотный.
 * 6. **Подпись «~T» — под ПОСЛЕДНЕЙ капсулой точки:** время точки это момент, когда она
 *    отработана целиком, а не когда начат её первый шаг.
 */

/** Шаг плана глазами раскладки: важно лишь, перелёт это и куда. */
export interface PathStep {
  kind: string;
  to?: string;
}

/**
 * Узлы линии плана по порядку (без якоря флота): каждый перелёт раскрывается в свои
 * лейн-хопы (правила 1–4). `routeOf` возвращает хопы или `null`, если пути нет.
 */
export function chainPathNodes(
  steps: readonly PathStep[],
  fromId: string,
  routeOf: (from: string, to: string) => readonly string[] | null,
): string[] {
  const out: string[] = [];
  let cur = fromId;
  for (const st of steps) {
    if (st.kind !== 'move' || !st.to || st.to === cur) continue; // правила 3–4
    const hops = routeOf(cur, st.to) ?? [st.to]; // правило 2
    out.push(...hops);
    cur = st.to;
  }
  return out;
}

/** Смещение капсулы от центра точки и шаг стопки вправо. */
export const CAPSULE_DX = 16;
export const CAPSULE_DY = -16;
export const CAPSULE_STACK = 20;

/** Где рисовать `k`-ю капсулу этой точки (правило 5). */
export function capsuleAt(
  centre: { x: number; y: number },
  stackIndex: number,
): { x: number; y: number } {
  return { x: centre.x + CAPSULE_DX + stackIndex * CAPSULE_STACK, y: centre.y + CAPSULE_DY };
}

/**
 * Номер каждого шага в стопке своей точки: сколько капсул уже стоит в этой точке
 * (правило 5). Шаг без точки получает `null` — рисовать его негде.
 */
export function stackIndexes(pointIds: readonly (string | null | undefined)[]): (number | null)[] {
  const seen = new Map<string, number>();
  return pointIds.map((pid) => {
    if (!pid) return null;
    const k = seen.get(pid) ?? 0;
    seen.set(pid, k + 1);
    return k;
  });
}

/** Индекс ПОСЛЕДНЕГО шага каждой точки — под ним встаёт подпись «~T» (правило 6). */
export function lastStepAtPoint(
  pointIds: readonly (string | null | undefined)[],
): Map<string, number> {
  const last = new Map<string, number>();
  pointIds.forEach((pid, i) => {
    if (pid) last.set(pid, i);
  });
  return last;
}

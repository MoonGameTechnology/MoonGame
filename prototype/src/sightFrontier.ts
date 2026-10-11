/**
 * Сводная граница видимости: как множество радарных кругов становится ОДНОЙ границей
 * и чем внешний слой отличается от внутреннего (REFM-120).
 *
 * Радаров у игрока много, и их круги перекрываются. Рисовать их по одному нельзя: на
 * карте получалась бы паутина из колец, по которой невозможно прочесть главное — где
 * кончается обзор. Поэтому круги сводятся в одну область: общая заливка плюс один
 * контур по ВНЕШНЕМУ краю. Вся эта сборка стояла в кадре голыми числами, и из неё не
 * читалось ни почему круги идут раздельными подпутями, ни почему тиров ровно два.
 *
 * 1. **Каждый круг — свой подпуть.** Дуги в общем пути соединяются прямыми: без
 *    `moveTo` перед каждой из них два разнесённых радара стянуло бы хордой, и вместо
 *    границы обзора игрок увидел бы натянутые между радарами верёвки.
 * 2. **Контур — это заливка МИНУС её сжатая копия.** Так контур обводит только внешний
 *    край объединения: круг, целиком лежащий внутри другого, не даёт своего кольца —
 *    «граница видимости» ровно одна, а не по кольцу на источник. `drawSightFrontier`
 *    рисует контур прямо на карте (правило 9); полноэкранная оффскрин-канва не нужна.
 * 3. **Сжатие не может съесть круг целиком.** Круг тоньше линии контура при сжатии
 *    ушёл бы в неположительный радиус; такая дуга не исчезает, а выворачивается и
 *    выедает дыру в уже собранной заливке — дыра посреди зоны обзора читалась бы как
 *    слепое пятно, которого нет.
 * 4. **Пустой набор — в отрисовку не заходим.** Это не защита от невозможного: игрок
 *    без единого радара — обычное начало партии, а этап контура строит пути и заливки;
 *    пустой набор не должен делать это каждый кадр.
 * 5. **Внутренний тир читается СИЛЬНЕЕ внешнего по ВСЕМ трём признакам** — заливка,
 *    контур, толщина линии. Внешний край — дальность засечки (там контакт виден
 *    пятном), внутренний — дальность опознания (там видно, ЧТО это). Сравняй их — и
 *    граница опознания растворится во внешней, а именно она отвечает на вопрос
 *    «долетит ли мой разведчик до места, где я разгляжу флот».
 * 6. **У ВЫБРАННОГО источника внешнее кольцо ПУНКТИРНОЕ, внутреннее — сплошное и
 *    ярче.** Это та же пара «засечка / опознание», но одного объекта поверх сводной
 *    границы; пунктир и здесь означает «тут только засечка». Сплошным внешним кольцом
 *    оно бы обещало опознание по всей дальности.
 * 7. **Кольцо неположительного экранного радиуса не рисуется** — при сильном отдалении
 *    радиус схлопывается в ноль, и `arc` отрицательного радиуса бросает.
 * 8. **Видимость тира держит СБОРКА, а не кадр** (REFM-120.1). Раньше в отрисовке стояли
 *    гейты «прозрачность > 0» и «толщина > 0», недостижимые по построению: числа тира
 *    приходят только отсюда, и все они положительны. Гейты сняты — они сторожили не
 *    падение, а работу впустую (нулевая прозрачность — законная заливка «ничем», нулевая
 *    толщина — пустое кольцо), причём в конфигурации, которой не бывает. Сравни с
 *    правилом 4: там проверка ОСТАЁТСЯ, потому что пустой набор радаров — обычное начало
 *    партии, а не невозможность. Инвариант «тир видим» теперь заперт тестом по
 *    `SIGHT_TIERS`: он падает на сборке, тогда как гейт молчал бы в кадре вечно. Отсюда и
 *    перечень тиров — третий тир попадёт под проверку сам, а гейт пропустил бы его молча.
 * 9. **Контур — одна заливка между двумя краями, без клипов.** Полоса контура (правило 2) —
 *    объединение кругов без объединения их сжатых копий. Её граница — край первого и край
 *    второго: дуги, не накрытые другими кругами того же объединения, сцепленные в замкнутые
 *    петли ({@link unionLoops}). Петли обоих краёв идут в один путь, и заливка по правилу
 *    чёт-нечет закрашивает ровно полосу: точку внутри сжатого объединения обходит чётное
 *    число петель, точку полосы — нечётное. Раньше сжатые диски вычитались клипами, а холст
 *    строит маску каждого клипа на всю его площадь: во весь экран это стоило около 24 мс у
 *    дома на телефоне, плитками вдоль кромки — всё ещё около 5 мс. Обводка видимых дуг
 *    вместо заливки тоже дешева, но не точна: где круги почти касаются, линия на стыке
 *    толще или рвётся. Круг целиком за экраном в отрисовку не идёт ({@link frontierOnScreen}):
 *    на экране он ничего не меняет, а петли считаются по парам кругов.
 */

/**
 * Слои обзора, ПЕРЕЧНЕМ, а не типом: тип из него выводится, а не наоборот (правило 8).
 * Внешний — дальность засечки, внутренний — дальность опознания.
 */
export const SIGHT_TIERS = ['signature', 'reveal'] as const;

/** Слой обзора: внешний — дальность засечки, внутренний — дальность опознания. */
export type SightTier = (typeof SIGHT_TIERS)[number];

/** Круг обзора на экране. */
export interface ScreenCircle {
  x: number;
  y: number;
  r: number;
}

/** Как выглядит сводная граница тира (правило 5). */
export interface FrontierLook {
  /** Толщина контура; она же — сжатие вычитаемой копии (правило 2). */
  lineWidth: number;
  /** Прозрачность общей заливки. */
  fillAlpha: number;
  /** Прозрачность контура. */
  strokeAlpha: number;
}

const FRONTIER: Record<SightTier, FrontierLook> = {
  // Внешний край: почти прозрачная дымка — она отвечает лишь «сюда добивает засечка».
  signature: { lineWidth: 0.8, fillAlpha: 0.012, strokeAlpha: 0.14 },
  // Внутренний: заметно плотнее и толще — это рабочая граница, по ней ведут разведку.
  reveal: { lineWidth: 1, fillAlpha: 0.02, strokeAlpha: 0.26 },
};

/** Вид сводной границы — одной записью, чтобы тиры не сползлись друг к другу. */
export function frontierLook(tier: SightTier): FrontierLook {
  return FRONTIER[tier];
}

/** Как выглядит собственное кольцо выбранного источника (правило 6). */
export interface OwnRingLook {
  /** Пунктир; пустой массив — сплошная линия. */
  dash: readonly number[];
  alpha: number;
}

const OWN_RING: Record<SightTier, OwnRingLook> = {
  // «Здесь только засечка» — пунктиром, как и всё неточное на этой карте.
  signature: { dash: [3, 6], alpha: 0.32 },
  // «Здесь опознание» — сплошной и ярче.
  reveal: { dash: [], alpha: 0.5 },
};

/** Вид собственного кольца выбранного источника (правило 6). */
export function ownRingLook(tier: SightTier): OwnRingLook {
  return OWN_RING[tier];
}

/**
 * Круги, участвующие в пути при сжатии на `inset`, уже со сжатым радиусом
 * (правила 1, 3). Сжатие `0` даёт саму заливку.
 */
export function unionArcs(circles: readonly ScreenCircle[], inset: number): ScreenCircle[] {
  const out: ScreenCircle[] = [];
  for (const c of circles) {
    const r = c.r - inset;
    if (r > 0) out.push({ x: c.x, y: c.y, r }); // правило 3
  }
  return out;
}

/** Поле за краем экрана (правило 9): сглаживание края при любой плотности экрана. */
const FRONTIER_MARGIN = 4;

/**
 * Круги, задевающие экран `width × height` с полем {@link FRONTIER_MARGIN} (правило 9).
 * Диск остальных лежит за экраном целиком, и ни заливка, ни край на экране без них не меняются.
 */
export function frontierOnScreen(
  circles: readonly ScreenCircle[],
  width: number,
  height: number,
): ScreenCircle[] {
  const m = FRONTIER_MARGIN;
  return circles.filter(
    (c) => c.x + c.r > -m && c.x - c.r < width + m && c.y + c.r > -m && c.y - c.r < height + m,
  );
}

const TAU = Math.PI * 2;

/** Дуга края (правило 9): окружность от угла `from` до `to` по возрастанию угла, в радианах.
 *  Углы могут уходить за 2π: дуга, идущая через нулевой угол, остаётся одной. */
export interface FrontierArc {
  x: number;
  y: number;
  r: number;
  from: number;
  to: number;
}

/** Дуга края и её соседи: номер своего круга и кругов, с края которых она начинается и на
 *  краю которых кончается; `-1` — соседа нет, дуга — весь круг. */
interface EdgeArc extends FrontierArc {
  circle: number;
  startBy: number;
  endBy: number;
}

/** Кусок окружности, накрытый соседом (или подряд несколькими): первый и последний из них. */
interface Covered {
  from: number;
  to: number;
  startBy: number;
  endBy: number;
}

/**
 * Край объединения кругов (правило 9): замкнутые петли из дуг, не накрытых другими кругами.
 * В петле дуги идут подряд: каждая кончается там, где начинается следующая, последняя — там,
 * где начинается первая. Круг внутри другого края не даёт, из совпадающих его даёт первый.
 */
export function unionLoops(circles: readonly ScreenCircle[]): FrontierArc[][] {
  const arcs: EdgeArc[] = [];
  const onCircle: number[][] = circles.map(() => []);
  for (let i = 0; i < circles.length; i++) {
    for (const arc of edgeArcs(circles, i)) {
      onCircle[i]!.push(arcs.length);
      arcs.push(arc);
    }
  }
  const used = arcs.map(() => false);
  const loops: FrontierArc[][] = [];
  for (let first = 0; first < arcs.length; first++) {
    const loop: FrontierArc[] = [];
    for (let i = first; i >= 0 && !used[i]; i = nextArc(arcs, onCircle, i)) {
      used[i] = true;
      const { x, y, r, from, to } = arcs[i]!;
      loop.push({ x, y, r, from, to });
    }
    if (loop.length) loops.push(loop);
  }
  return loops;
}

/** Дуги круга `i`, не накрытые другими кругами, с соседями на концах. */
function edgeArcs(circles: readonly ScreenCircle[], i: number): EdgeArc[] {
  const c = circles[i]!;
  const spans: Covered[] = [];
  for (let j = 0; j < circles.length; j++) {
    if (j === i) continue;
    const o = circles[j]!;
    const d = Math.hypot(o.x - c.x, o.y - c.y);
    if (d + c.r <= o.r && (d + o.r > c.r || j < i)) return [];
    if (d >= c.r + o.r || d + o.r <= c.r) continue; // порознь, или сосед внутри круга
    const at = Math.atan2(o.y - c.y, o.x - c.x);
    const half = Math.acos(
      Math.min(1, Math.max(-1, (d * d + c.r * c.r - o.r * o.r) / (2 * d * c.r))),
    );
    const from = (((at - half) % TAU) + TAU) % TAU;
    spans.push({ from, to: from + 2 * half, startBy: j, endBy: j });
  }
  if (!spans.length) {
    return [{ x: c.x, y: c.y, r: c.r, from: 0, to: TAU, circle: i, startBy: -1, endBy: -1 }];
  }
  spans.sort((p, q) => p.from - q.from);
  const runs: Covered[] = [];
  for (const s of spans) {
    const run = runs[runs.length - 1];
    if (!run || s.from > run.to) runs.push({ ...s });
    else if (s.to > run.to) {
      run.to = s.to;
      run.endBy = s.endBy;
    }
  }
  // Последний накрытый кусок может перейти через нулевой угол и накрыть первые.
  const last = runs[runs.length - 1]!;
  while (runs.length > 1 && runs[0]!.from + TAU <= last.to) {
    const run = runs.shift()!;
    if (run.to + TAU > last.to) {
      last.to = run.to + TAU;
      last.endBy = run.endBy;
    }
  }
  if (last.to - last.from >= TAU) return []; // соседи накрыли весь круг
  return runs.map((run, k) => {
    const next = k + 1 < runs.length ? runs[k + 1]! : { ...runs[0]!, from: runs[0]!.from + TAU };
    return {
      x: c.x,
      y: c.y,
      r: c.r,
      from: run.to,
      to: next.from,
      circle: i,
      startBy: run.endBy,
      endBy: next.startBy,
    };
  });
}

/** Дальше какого разрыва петля не сцепляется наугад: короткая перемычка незаметна, длинная
 *  закрасила бы хорду. */
const LOOP_GAP = 0.5;

/**
 * Следующая дуга петли после дуги `i`: на круге, в который она входит, — дуга, выходящая из
 * её круга, ближайшая к её концу. Если такой нет (три круга сошлись в одной точке и счёт
 * разошёлся в последнем знаке) — ближайшая из всех, но не дальше {@link LOOP_GAP}.
 * `-1` — петля кончилась: дуга — весь круг, или продолжить нечем.
 */
function nextArc(arcs: readonly EdgeArc[], onCircle: readonly number[][], i: number): number {
  const a = arcs[i]!;
  if (a.endBy < 0) return -1;
  const x = a.x + a.r * Math.cos(a.to);
  const y = a.y + a.r * Math.sin(a.to);
  const gap = (k: number): number => {
    const b = arcs[k]!;
    return Math.hypot(b.x + b.r * Math.cos(b.from) - x, b.y + b.r * Math.sin(b.from) - y);
  };
  const nearest = (ks: readonly number[]): number =>
    ks.reduce((best, k) => (best < 0 || gap(k) < gap(best) ? k : best), -1);
  const next = nearest(onCircle[a.endBy]!.filter((k) => arcs[k]!.startBy === a.circle));
  if (next >= 0) return next;
  const any = nearest(arcs.map((_, k) => k));
  return gap(any) < LOOP_GAP ? any : -1;
}

/** Есть ли что рисовать в тире (правило 4). */
export function frontierShown(circles: readonly ScreenCircle[]): boolean {
  return unionArcs(circles, 0).length > 0;
}

/** Рисовать ли собственное кольцо такого экранного радиуса (правило 7). */
export function ownRingShown(radius: number): boolean {
  return radius > 0;
}

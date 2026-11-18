/**
 * Стрелки залпов на схеме окна боя: геометрия — чистая функция, рисование — по уже
 * положенным плиткам (`[data-tile]`), когда известны их места.
 *
 * 1. **Между рядами — плавная дуга** от верхнего края плитки снизу к нижнему краю плитки
 *    сверху; внутри одного ряда — дуга наружу, чтобы не пересекать сами плитки.
 * 2. **Несколько концов на одной плитке расходятся веером**, иначе стрелки слились бы в
 *    одну линию и «по кому ещё бьют» не прочитать.
 * 3. **Ответ — тонкий пунктир, залп — сплошная;** толщина залпа падает с долей: весь залп
 *    толще половины. Доля подписана только на МОИХ залпах — свои приказы игрок
 *    взвешивает, а подписи союзников лишь зашумили бы схему.
 */
import { shareLabel, type SchemeArrow } from './battleRows';

/** Место плитки в координатах схемы. */
export interface TileBox {
  top: number;
  bottom: number;
  cx: number;
}

export interface ArrowShape {
  /** Путь кривой (до основания наконечника). */
  d: string;
  /** Три точки наконечника. */
  head: string;
  /** Где подписать долю. */
  label: { x: number; y: number };
}

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** Кривая от `a` к `b` (правило 1); `oa`/`ob` — сдвиг концов веером (правило 2). */
export function arrowShape(
  a: TileBox,
  b: TileBox,
  fromTop: boolean,
  toTop: boolean,
  oa: number,
  ob: number,
  reply: boolean,
): ArrowShape {
  const sx = a.cx + oa;
  const ex = b.cx + ob;
  let sy: number;
  let ey: number;
  let c1y: number;
  let c2y: number;
  if (fromTop === toTop) {
    const bulge = fromTop ? -22 : 22;
    sy = fromTop ? a.top : a.bottom;
    ey = fromTop ? b.top : b.bottom;
    c1y = sy + bulge;
    c2y = ey + bulge;
  } else {
    sy = fromTop ? a.bottom : a.top;
    ey = fromTop ? b.top : b.bottom;
    const dy = (ey - sy) * 0.5;
    c1y = sy + dy;
    c2y = ey - dy;
  }
  // Вторая опорная точка стоит над концом, поэтому наконечник смотрит строго по вертикали.
  const ang = Math.atan2(ey - c2y, 0);
  const len = reply ? 6 : 9;
  const half = reply ? 3.5 : 5;
  const bx = ex - Math.cos(ang) * len;
  const by = ey - Math.sin(ang) * len;
  const px = -Math.sin(ang) * half;
  const py = Math.cos(ang) * half;
  // Подпись — на трети пути от стрелка: у цели концы сходятся веером и теснее.
  const tt = 0.3;
  const mt = 1 - tt;
  const lx = mt ** 3 * sx + 3 * mt * mt * tt * sx + 3 * mt * tt * tt * ex + tt ** 3 * ex;
  const ly = mt ** 3 * sy + 3 * mt * mt * tt * c1y + 3 * mt * tt * tt * c2y + tt ** 3 * ey;
  return {
    d: `M${r1(sx)},${r1(sy)} C${r1(sx)},${r1(c1y)} ${r1(ex)},${r1(c2y)} ${r1(bx)},${r1(by)}`,
    head: `${r1(ex)},${r1(ey)} ${r1(bx + px)},${r1(by + py)} ${r1(bx - px)},${r1(by - py)}`,
    label: { x: r1(lx), y: r1(ly) },
  };
}

/** Толщина линии (правило 3). */
export function arrowWidth(arrow: Pick<SchemeArrow, 'reply' | 'of' | 'n'>): number {
  if (arrow.reply) return 1.2;
  if (arrow.n > 1) return 2.2;
  return arrow.of <= 1 ? 2.6 : arrow.of === 2 ? 2 : 1.6;
}

/** Подпись стрелки или `null` (правило 3). */
export function arrowLabel(arrow: Pick<SchemeArrow, 'reply' | 'of' | 'n' | 'mine'>): string | null {
  if (arrow.reply || !arrow.mine) return null;
  if (arrow.n > 1) return `${arrow.n}×${arrow.of > 1 ? shareLabel(arrow.of) : '1'}`;
  return arrow.of > 1 ? shareLabel(arrow.of) : null;
}

/** Нарисовать стрелки в `svg.bw-arrows` схемы по местам плиток. */
export function drawSchemeArrows(scheme: HTMLElement, arrows: readonly SchemeArrow[]): void {
  const svg = scheme.querySelector<SVGSVGElement>('svg.bw-arrows');
  if (!svg) return;
  const box = scheme.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${Math.round(box.width)} ${Math.round(box.height)}`);
  const tile = (id: string): TileBox | null => {
    const el = scheme.querySelector<HTMLElement>(`[data-tile="${CSS.escape(id)}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      top: r.top - box.top,
      bottom: r.bottom - box.top,
      cx: (r.left + r.right) / 2 - box.left,
    };
  };
  const ends = new Map<string, string[]>();
  const slot = (id: string, end: string): void => {
    const list = ends.get(id) ?? [];
    list.push(end);
    ends.set(id, list);
  };
  arrows.forEach((a, i) => {
    slot(a.from, `o${i}`);
    slot(a.to, `i${i}`);
  });
  const fan = (id: string, end: string): number => {
    const list = ends.get(id) ?? [];
    if (list.length <= 1) return 0;
    return (list.indexOf(end) - (list.length - 1) / 2) * Math.min(9, 30 / (list.length - 1));
  };
  // Много стрелок из одного стрелка — доля у них одна: подписывается один раз, у самого
  // стрелка, а не на каждой стрелке, где подписи легли бы друг на друга.
  const labeled = new Map<string, number>();
  for (const a of arrows) if (arrowLabel(a)) labeled.set(a.from, (labeled.get(a.from) ?? 0) + 1);
  const badge = (x: number, y: number, text: string, color: string): string => {
    const w = text.length > 2 ? 34 : 18;
    return (
      `<rect x="${r1(x - w / 2)}" y="${r1(y - 8)}" width="${w}" height="16" rx="5" fill="#04141a" stroke="${color}" stroke-width="1"/>` +
      `<text x="${r1(x)}" y="${r1(y + 4)}" text-anchor="middle">${text}</text>`
    );
  };
  const once = new Set<string>();
  let out = '';
  arrows.forEach((a, i) => {
    const from = tile(a.from);
    const to = tile(a.to);
    if (!from || !to) return;
    const shape = arrowShape(
      from,
      to,
      a.fromLane === 'theirs',
      a.toLane === 'theirs',
      fan(a.from, `o${i}`),
      fan(a.to, `i${i}`),
      a.reply,
    );
    const dim = a.reply ? ' stroke-dasharray="3 4" opacity=".6"' : ' opacity=".95"';
    out +=
      `<path d="${shape.d}" fill="none" stroke="${a.color}" stroke-width="${arrowWidth(a)}" stroke-linecap="round"${dim}/>` +
      `<polygon points="${shape.head}" fill="${a.color}"${a.reply ? ' opacity=".6"' : ''}/>`;
    const text = arrowLabel(a);
    if (!text) return;
    if ((labeled.get(a.from) ?? 0) <= 2) out += badge(shape.label.x, shape.label.y, text, a.color);
    else if (a.n === 1 && !once.has(a.from)) {
      once.add(a.from);
      const up = a.fromLane === 'ours';
      out += badge(from.cx, up ? from.top - 12 : from.bottom + 12, text, a.color);
    }
  });
  svg.innerHTML = out;
}

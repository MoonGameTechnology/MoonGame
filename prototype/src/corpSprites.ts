/**
 * Здания базы корпорации на панораме и в карточках (CORP-3, рисунки CORP-13, стили CORP-14).
 *
 * Панорама — сцена базы: фон окружения и здания на палубе в два ряда (дальний и ближний). На ПК
 * это мир 1200×630, на узкой вкладке (телефон) — 600×945, и вся база видна без прокрутки вбок:
 * дальний ряд из трёх зданий и два ближних ряда по два. Участок здания (`CORP_LOTS`, низ участка
 * — земля) в обеих сценах одной формы, меняются только место и размер (`CORP_LOTS_PHONE`), поэтому
 * один рисунок участка годится обеим. Земля каждого ряда — ниже горизонта фона: здание стоит на
 * палубе, а не в небе.
 *
 * Нарисованное здание (`corpArt.ts`) стоит в участке картинкой своего уровня в стиле базы.
 * Строящийся уровень — картинка следующего уровня янтарной голограммой позади нынешнего
 * здания, доступное к стройке — голубая голограмма первого уровня, закрытое — тёмный силуэт
 * первого уровня (фильтры `#corpScaf`, `#corpGhost` и `#corpShade` лежат в разметке хаба).
 *
 * Здание без рисунка (новое в каталоге раньше, чем нарисованное) получает простой корпус
 * SVG и в панораму не встаёт — карточка и лист у него всё равно есть.
 */
import type { CorpLotState } from '../../decisions/corpBase';
import { CORP_BACKDROP_STANDARD, CORP_STYLE_STANDARD } from '../../packages/protocol/src/corpStyle';
import { corpArt, type CorpArt } from './corpArt';
import orbitBackdrop from '../art/corp/backdrops/orbit.webp';
import nebulaBackdrop from '../art/corp/backdrops/nebula.webp';
import iceMoonBackdrop from '../art/corp/backdrops/ice_moon.webp';
import gasGiantBackdrop from '../art/corp/backdrops/gas_giant.webp';

/** Участок здания на панораме. */
export interface CorpLot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const CORP_PANORAMA = { w: 1200, h: 630 };

/** Сцена узкой вкладки: та же база стоймя. */
export const CORP_PANORAMA_PHONE = { w: 600, h: 945 };

/** Участок на ПК: дальний ряд стоит на земле 305, ближний — на 512; горизонт фона — около 243.
 *  Участок штаба выше рисунка его уровня: холст держит место под верхние уровни. */
export const CORP_LOTS: Readonly<Record<string, CorpLot>> = {
  headquarters: { x: 416, y: 17, w: 368, h: 288 },
  operations_center: { x: 77, y: 120, w: 266, h: 185 },
  hall_of_fame: { x: 857, y: 105, w: 266, h: 200 },
  supply_center: { x: 68, y: 362, w: 245, h: 150 },
  warehouse: { x: 330, y: 342, w: 250, h: 170 },
  engineering_complex: { x: 612, y: 352, w: 265, h: 160 },
  monument: { x: 945, y: 332, w: 170, h: 180 },
};

/** Табличка над зданием, в небе, — у соседей штаба по дальнему ряду: под ними до ближнего ряда
 *  места нет. Табличка штаба — под ним, на палубе между рядами; у ближнего ряда — под зданием. */
export const CORP_TAG_ABOVE: ReadonlySet<string> = /* @__PURE__ */ new Set(['operations_center', 'hall_of_fame']);

/** Участок на телефоне — середина, земля и масштаб участка ПК: форма та же. Горизонт — около
 *  280, ряды стоят на земле 320, 540 и 795. */
const PHONE_PLACES: Readonly<Record<string, { cx: number; ground: number; k: number }>> = {
  headquarters: { cx: 300, ground: 320, k: 0.83 },
  operations_center: { cx: 108, ground: 320, k: 0.7 },
  hall_of_fame: { cx: 492, ground: 320, k: 0.7 },
  supply_center: { cx: 150, ground: 540, k: 1 },
  warehouse: { cx: 450, ground: 540, k: 1 },
  engineering_complex: { cx: 165, ground: 795, k: 1 },
  monument: { cx: 450, ground: 795, k: 0.9 },
};

export const CORP_LOTS_PHONE: Readonly<Record<string, CorpLot>> = /* @__PURE__ */ Object.fromEntries(
  Object.entries(PHONE_PLACES).map(([id, { cx, ground, k }]) => {
    const lot = CORP_LOTS[id]!;
    const w = lot.w * k;
    const h = lot.h * k;
    return [id, { x: cx - w / 2, y: ground - h, w, h }];
  }),
);

/** Порядок рисования: дальние раньше ближних — в обеих сценах. */
export const CORP_DRAW_ORDER: readonly string[] = [
  'operations_center',
  'headquarters',
  'hall_of_fame',
  'supply_center',
  'warehouse',
  'engineering_complex',
  'monument',
];

function bx(x: number, y: number, w: number, h: number, d: number): string {
  const k = Math.round(d * 0.6);
  return (
    `<rect class="f" x="${x}" y="${y}" width="${w}" height="${h}"/>` +
    `<path class="s" d="M${x + w} ${y}L${x + w + d} ${y - k}V${y + h - k}L${x + w} ${y + h}Z"/>` +
    `<path class="t" d="M${x} ${y}L${x + d} ${y - k}H${x + w + d}L${x + w} ${y}Z"/>`
  );
}

function wins(
  x: number,
  y: number,
  cols: number,
  rows: number,
  dx: number,
  dy: number,
  w: number,
  h: number,
): string {
  let s = '';
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      s += `<rect class="${(r * 7 + c * 3) % 5 === 0 ? 'wd' : 'w'}" x="${x + c * dx}" y="${y + r * dy}" width="${w}" height="${h}"/>`;
  return s;
}

/** Корпус здания без рисунка. */
const PLAIN_LOT: CorpLot = { x: 0, y: 0, w: 200, h: 170 };
const PLAIN = bx(40, 90, 110, 72, 12) + wins(52, 104, 4, 2, 24, 22, 10, 8);

const svg = (lot: CorpLot, body: string): string =>
  `<svg class="spr" viewBox="0 0 ${lot.w} ${lot.h}" preserveAspectRatio="xMidYMax meet" aria-hidden="true">${body}</svg>`;

const n = (v: number): number => Math.round(v * 10) / 10;

/** Нарисованное здание в участке: холст вписан в участок и стоит на его нижней кромке.
 *  `drawn` — рамка всех показанных уровней в единицах участка: x0, y0, x1, y1. */
interface Placed {
  lot: CorpLot;
  top: CorpArt;
  current: CorpArt | null;
  x: number;
  y: number;
  w: number;
  h: number;
  drawn: readonly [number, number, number, number];
}

function place(id: string, level: number, mode: CorpLotState, style: string): Placed | null {
  // Строится следующий уровень; закрытое и доступное к стройке здание показывает первый.
  const top = corpArt(id, mode === 'built' ? level : mode === 'build' ? level + 1 : 1, style);
  if (!top) return null;
  const lot = CORP_LOTS[id] ?? PLAIN_LOT;
  const k = Math.min(lot.w / top.w, lot.h / top.h);
  const w = top.w * k;
  const h = top.h * k;
  const x = (lot.w - w) / 2;
  const y = lot.h - h;
  const current = mode === 'build' && level > 0 ? corpArt(id, level, style) : null;
  const boxes = current ? [top.box, current.box] : [top.box];
  const lo = (i: number): number => Math.min(...boxes.map((b) => b[i] ?? 0));
  const hi = (i: number): number => Math.max(...boxes.map((b) => b[i] ?? 1));
  const drawn = [x + lo(0) * w, y + lo(1) * h, x + hi(2) * w, y + hi(3) * h] as const;
  return { lot, top, current, x, y, w, h, drawn };
}

function artSprite(
  { lot, top, current, x, y, w, h, drawn }: Placed,
  mode: CorpLotState,
  hit: boolean,
): string {
  const image = (art: CorpArt, attrs = ''): string => {
    const f = art.frame;
    if (!f) return `<image href="${art.src}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${attrs}/>`;
    return `<svg x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" viewBox="0 0 ${art.w} ${art.h}"${attrs}>` +
      `<svg x="${n(f.dx)}" y="${n(f.dy)}" width="${n(f.dw)}" height="${n(f.dh)}" viewBox="${f.sx} ${f.sy} ${f.sw} ${f.sh}" overflow="hidden">` +
      `<image href="${art.src}" width="${f.iw}" height="${f.ih}"/></svg></svg>`;
  };
  const body =
    mode === 'built'
      ? image(top)
      : mode === 'build'
        ? image(top, ' class="scaf" filter="url(#corpScaf)"') + (current ? image(current) : '')
        : mode === 'open'
          ? image(top, ' class="ghost" filter="url(#corpGhost)"')
          : image(top, ' class="shade" filter="url(#corpShade)"');
  // Нажимается нарисованное, а не пустое небо холста.
  const [x0, y0, x1, y1] = drawn;
  const zone = hit
    ? `<g><rect class="hit" x="${n(x0)}" y="${n(y0)}" width="${n(x1 - x0)}" height="${n(y1 - y0)}"/></g>`
    : '';
  return svg(lot, zone + body);
}

/** Здание уровня `level` в состоянии участка `mode` и в стиле базы `style`. `hit` — прозрачная
 *  зона нажатия по нарисованному (только на панораме, где участки перекрываются). */
export function corpSprite(
  id: string,
  level: number,
  mode: CorpLotState,
  style: string = CORP_STYLE_STANDARD,
  hit = false,
): string {
  const placed = place(id, level, mode, style);
  if (placed) return artSprite(placed, mode, hit);
  const solid = mode === 'built' || (mode === 'build' && level > 0) ? PLAIN : '';
  const ghost = mode === 'built' ? '' : PLAIN;
  return svg(
    PLAIN_LOT,
    `<g class="solid">${solid}</g><g class="ghost${mode === 'build' ? ' scaf' : ''}">${ghost}</g>`,
  );
}

/** Рамка нарисованного здания в долях участка: середина основания, ширина и верх. По ней под
 *  зданием стоит площадка, табличка встаёт по его середине, а у соседей штаба — над крышей.
 *  У здания без рисунка — середина участка, половина его ширины и верх участка. */
export function corpSpriteBox(
  id: string,
  level: number,
  mode: CorpLotState,
  style: string = CORP_STYLE_STANDARD,
): { x: number; w: number; top: number } {
  const placed = place(id, level, mode, style);
  if (!placed) return { x: 0.5, w: 0.5, top: 0 };
  const [x0, y0, x1] = placed.drawn;
  return { x: (x0 + x1) / 2 / placed.lot.w, w: (x1 - x0) / placed.lot.w, top: y0 / placed.lot.h };
}

/** Изображение окружения без зданий. Градиенты остаются под ним на время загрузки;
 *  цвет площадок и место самих зданий не зависят от загрузки картинки. `plate` — металл
 *  площадок, снятый с палубы рисунка (с поправкой на притушенный фон сцены): верх и борт от
 *  дальнего края к ближнему и блик кромки. `accent` — огни палубы рисунка, ими горят и
 *  огни площадок. */
interface Backdrop {
  nameKey: string;
  src: string;
  sky: readonly [string, string, string];
  deck: readonly [string, string];
  plate: { top: readonly [string, string]; wall: readonly [string, string]; rim: string };
  accent: string;
}

const BACKDROPS: Readonly<Record<string, Backdrop>> = {
  orbit: {
    nameKey: 'corp.backdrop.orbit',
    src: orbitBackdrop,
    sky: ['#020b13', '#05192a', '#0a3044'],
    deck: ['#0b2d3c', '#031019'],
    plate: { top: ['#55616d', '#262d35'], wall: ['#2b333c', '#0b0f13'], rim: '#a9c1d1' },
    accent: '#35d6e6',
  },
  nebula: {
    nameKey: 'corp.backdrop.nebula',
    src: nebulaBackdrop,
    sky: ['#0a0414', '#1a0b2e', '#2b1240'],
    deck: ['#22102f', '#0a0510'],
    plate: { top: ['#554b66', '#262230'], wall: ['#2c2738', '#0c0a12'], rim: '#c0b0e0' },
    accent: '#c48cff',
  },
  ice_moon: {
    nameKey: 'corp.backdrop.ice-moon',
    src: iceMoonBackdrop,
    sky: ['#03101e', '#0b2742', '#3f6f93'],
    deck: ['#7fa9c4', '#1b3550'],
    plate: { top: ['#5d6a79', '#28303a'], wall: ['#2c3540', '#0b1015'], rim: '#d5e8f5' },
    accent: '#bdf3ff',
  },
  gas_giant: {
    nameKey: 'corp.backdrop.gas-giant',
    src: gasGiantBackdrop,
    sky: ['#120604', '#3a1408', '#a2441a'],
    deck: ['#3b1a0c', '#0f0603'],
    plate: { top: ['#5e4b3e', '#2a221b'], wall: ['#33281f', '#0f0b08'], rim: '#e0b98f' },
    accent: '#ffb43a',
  },
};

/** Фоны базы, бесплатный первым. Ключ — id фона из каталога магазина (`corpBackdrop`). */
export const CORP_BACKDROPS: readonly string[] = /* @__PURE__ */ Object.keys(BACKDROPS);

const backdropKey = (id: string): string =>
  Object.hasOwn(BACKDROPS, id) ? id : CORP_BACKDROP_STANDARD;
const backdropOf = (id: string): Backdrop => BACKDROPS[backdropKey(id)]!;

/** Ключ имени фона; незнакомый фон называется бесплатным, как и рисуется. */
export function corpBackdropName(id: string): string {
  return backdropOf(id).nameKey;
}

/** Фон превью (магазин, шторка «Стиль базы»): нарисованные небо и палуба целиком. `backdrop` —
 *  фон базы. */
export function corpPanoramaBg(backdrop: string = CORP_BACKDROP_STANDARD): string {
  const b = backdropOf(backdrop);
  // Общие градиенты — с id фона: превью разных фонов на одной странице не делят их.
  const k = backdropKey(backdrop);
  return (
    `<svg class="bg" viewBox="0 0 1200 540" preserveAspectRatio="none" aria-hidden="true"><defs>` +
    `<linearGradient id="cbSky-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b.sky[0]}"/><stop offset=".5" stop-color="${b.sky[1]}"/><stop offset=".62" stop-color="${b.sky[2]}"/></linearGradient>` +
    `<linearGradient id="cbDeck-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b.deck[0]}"/><stop offset="1" stop-color="${b.deck[1]}"/></linearGradient>` +
    `</defs><rect width="1200" height="540" fill="url(#cbSky-${k})"/>` +
    `<rect x="0" y="330" width="1200" height="210" fill="url(#cbDeck-${k})"/>` +
    `<image data-corp-backdrop="${k}" href="${b.src}" width="1200" height="540" preserveAspectRatio="none"/></svg>`
  );
}

/** Металл площадок сцены: градиенты `CORP_PAD` в цветах палубы фона. Сцена на странице одна,
 *  поэтому id общие. */
function padDefs(b: Backdrop): string {
  const { top, wall, rim } = b.plate;
  const lin = (id: string, stops: string): string =>
    `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>`;
  return (
    `<svg class="cb-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>` +
    lin('cbPadTop', `<stop offset="0" stop-color="${top[0]}"/><stop offset="1" stop-color="${top[1]}"/>`) +
    lin('cbPadWall', `<stop offset="0" stop-color="${wall[0]}"/><stop offset="1" stop-color="${wall[1]}"/>`) +
    lin(
      'cbPadRim',
      `<stop offset="0" stop-color="${rim}" stop-opacity=".2"/><stop offset=".55" stop-color="${rim}" stop-opacity=".12"/>` +
        `<stop offset="1" stop-color="${rim}" stop-opacity=".75"/>`,
    ) +
    // Борт темнеет к краям: он круглый и уходит от света.
    `<linearGradient id="cbPadSide" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".7"/>` +
    `<stop offset=".22" stop-color="#000" stop-opacity=".12"/><stop offset=".5" stop-color="#000" stop-opacity="0"/>` +
    `<stop offset=".78" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".7"/></linearGradient>` +
    `<radialGradient id="cbPadShadow"><stop offset="0" stop-color="#000" stop-opacity=".6"/>` +
    `<stop offset=".7" stop-color="#000" stop-opacity=".3"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>` +
    `</defs></svg>`
  );
}

/** Площадка под зданием: круглое основание из металла палубы в перспективе — верх с кольцом и
 *  швами плит, борт с огнями, тень на палубе. Холст 200×60, верх — эллипс с серединой (100, 20):
 *  эта точка стоит на земле участка. Огни (`lts`) — отдельным слоем: CSS красит их по состоянию
 *  участка и мигает ими, не перерисовывая металл; там же разметка `mk` — пунктир «здесь можно
 *  строить». */
const PAD_TOP = { cx: 100, cy: 20, rx: 98, ry: 18 };
const PAD_WALL = 8;

const onTop = (k: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [n(PAD_TOP.cx + PAD_TOP.rx * k * Math.cos(a)), n(PAD_TOP.cy + PAD_TOP.ry * k * Math.sin(a))];
};

export const CORP_PAD: string = /* @__PURE__ */ (() => {
  const { cx, cy, rx, ry } = PAD_TOP;
  const l = cx - rx;
  const r = cx + rx;
  const wall = `M${l} ${cy}A${rx} ${ry} 0 0 0 ${r} ${cy}V${cy + PAD_WALL}A${rx} ${ry} 0 0 1 ${l} ${cy + PAD_WALL}Z`;
  const ellipse = (k: number, attrs: string, dy = 0): string =>
    `<ellipse cx="${cx}" cy="${n(cy + dy)}" rx="${n(rx * k)}" ry="${n(ry * k)}" ${attrs}/>`;
  // Швы плит — от внутреннего кольца к кромке, мимо середины переда и зада.
  const seams = [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5]
    .map((deg) => {
      const [x0, y0] = onTop(0.72, deg);
      const [x1, y1] = onTop(1, deg);
      return `M${x0} ${y0}L${x1} ${y1}`;
    })
    .join('');
  const metal =
    `<svg class="cb-pad-m" viewBox="0 0 200 60" aria-hidden="true">` +
    `<ellipse cx="${cx}" cy="${cy + PAD_WALL}" rx="${rx + 12}" ry="${ry + 9}" fill="url(#cbPadShadow)"/>` +
    `<path d="${wall}" fill="url(#cbPadWall)"/><path d="${wall}" fill="url(#cbPadSide)"/>` +
    `<path d="M${l} ${cy + PAD_WALL}A${rx} ${ry} 0 0 0 ${r} ${cy + PAD_WALL}" fill="none" stroke="#000" stroke-opacity=".6"/>` +
    ellipse(1, 'fill="url(#cbPadTop)"') +
    ellipse(0.72, 'fill="none" stroke="#fff" stroke-opacity=".07"', 0.8) +
    ellipse(0.72, 'fill="none" stroke="#000" stroke-opacity=".45" stroke-width="1.2"') +
    `<path d="${seams}" stroke="#000" stroke-opacity=".4"/>` +
    ellipse(1, 'fill="none" stroke="url(#cbPadRim)" stroke-width="1.4"') +
    `</svg>`;
  // Огни — по передней половине борта; к краям они короче: борт поворачивается от глаза.
  const lights = [38, 64, 90, 116, 142]
    .map((deg) => {
      const [x, y] = onTop(1, deg);
      const w = n(7 * Math.sin((deg * Math.PI) / 180));
      const yc = n(y + PAD_WALL / 2);
      return (
        `<rect class="lg" x="${n(x - w / 2 - 2)}" y="${n(yc - 2.4)}" width="${n(w + 4)}" height="4.8" rx="2.4"/>` +
        `<rect class="lt" x="${n(x - w / 2)}" y="${n(yc - 1.2)}" width="${w}" height="2.4" rx="1.2"/>`
      );
    })
    .join('');
  return (
    metal +
    `<svg class="lts" viewBox="0 0 200 60" aria-hidden="true">` +
    ellipse(0.86, 'class="mk"') +
    lights +
    `</svg>`
  );
})();

/** Фон сцены базы в хабе. Картинка стоит на нижней кромке сцены и крупнее её: палуба занимает
 *  больше места, чем в самом рисунке, и оба ряда зданий стоят на ней (кадр задаёт CSS — на ПК и
 *  на телефоне свой). Под картинкой — градиенты неба и палубы на время загрузки; `--pad` —
 *  цвет огней площадок, металл площадок — градиенты `padDefs`. */
export function corpSceneBg(backdrop: string = CORP_BACKDROP_STANDARD): { style: string; html: string } {
  const b = backdropOf(backdrop);
  return {
    style:
      `--sky0:${b.sky[0]};--sky1:${b.sky[1]};--sky2:${b.sky[2]};` +
      `--deck0:${b.deck[0]};--deck1:${b.deck[1]};--pad:${b.accent}`,
    html:
      `<img class="cb-sky" data-corp-backdrop="${backdropKey(backdrop)}" src="${b.src}" alt="" aria-hidden="true" decoding="async">` +
      `<span class="cb-shade" aria-hidden="true"></span>` +
      padDefs(b),
  };
}

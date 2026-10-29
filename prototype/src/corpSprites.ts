/**
 * Здания базы корпорации на панораме и в карточках (CORP-3, рисунки CORP-13, стили CORP-14).
 *
 * Панорама — мир 1200×540: у каждого здания свой участок (`CORP_LOTS`, низ участка — земля).
 * Нарисованное здание (`corpArt.ts`) стоит в участке картинкой своего уровня в стиле базы. Строящийся
 * уровень — картинка следующего уровня янтарной голограммой позади нынешнего здания,
 * закрытое и доступное к стройке здание — голограмма первого уровня (фильтры `#corpScaf` и
 * `#corpGhost` лежат в разметке хаба).
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

/** Участок здания на панораме и где у его подписи место — над участком или под ним. */
export interface CorpLot {
  x: number;
  y: number;
  w: number;
  h: number;
  tag: 'top' | 'bottom';
}

export const CORP_PANORAMA = { w: 1200, h: 540 };

export const CORP_LOTS: Readonly<Record<string, CorpLot>> = {
  headquarters: { x: 440, y: 48, w: 320, h: 250, tag: 'bottom' },
  operations_center: { x: 90, y: 100, w: 280, h: 195, tag: 'bottom' },
  hall_of_fame: { x: 805, y: 90, w: 280, h: 210, tag: 'bottom' },
  supply_center: { x: 85, y: 325, w: 245, h: 150, tag: 'bottom' },
  warehouse: { x: 340, y: 305, w: 250, h: 170, tag: 'bottom' },
  engineering_complex: { x: 610, y: 315, w: 265, h: 160, tag: 'bottom' },
  monument: { x: 935, y: 310, w: 170, h: 180, tag: 'bottom' },
};

/** Порядок рисования: дальние раньше ближних. */
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
const PLAIN_LOT: CorpLot = { x: 0, y: 0, w: 200, h: 170, tag: 'bottom' };
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
        : image(top, ' class="ghost" filter="url(#corpGhost)"');
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

/** Правый верхний угол нарисованного здания в долях участка — там на телефоне стоит значок
 *  уровня, а не в пустом небе участка. У здания без рисунка — null. */
export function corpSpriteRoof(
  id: string,
  level: number,
  mode: CorpLotState,
  style: string = CORP_STYLE_STANDARD,
): { x: number; y: number } | null {
  const placed = place(id, level, mode, style);
  return placed && { x: placed.drawn[2] / placed.lot.w, y: placed.drawn[1] / placed.lot.h };
}

/** Изображение окружения без зданий. Градиенты остаются под ним на время загрузки;
 *  цвет площадок и место самих зданий не зависят от загрузки картинки. */
interface Backdrop {
  nameKey: string;
  src: string;
  sky: readonly [string, string, string];
  deck: readonly [string, string];
  accent: string;
}

const BACKDROPS: Readonly<Record<string, Backdrop>> = {
  orbit: {
    nameKey: 'corp.backdrop.orbit',
    src: orbitBackdrop,
    sky: ['#020b13', '#05192a', '#0a3044'],
    deck: ['#0b2d3c', '#031019'],
    accent: '#35d6e6',
  },
  nebula: {
    nameKey: 'corp.backdrop.nebula',
    src: nebulaBackdrop,
    sky: ['#0a0414', '#1a0b2e', '#2b1240'],
    deck: ['#22102f', '#0a0510'],
    accent: '#c48cff',
  },
  ice_moon: {
    nameKey: 'corp.backdrop.ice-moon',
    src: iceMoonBackdrop,
    sky: ['#03101e', '#0b2742', '#3f6f93'],
    deck: ['#7fa9c4', '#1b3550'],
    accent: '#bdf3ff',
  },
  gas_giant: {
    nameKey: 'corp.backdrop.gas-giant',
    src: gasGiantBackdrop,
    sky: ['#120604', '#3a1408', '#a2441a'],
    deck: ['#3b1a0c', '#0f0603'],
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

/** Фон панорамы: нарисованные небо и палуба, поверх — живые площадки под участками. `built` — у здания
 *  есть уровень, тогда его площадка светится сплошной линией. `backdrop` — фон базы. */
export function corpPanoramaBg(
  pads: ReadonlyArray<{ id: string; built: boolean }>,
  backdrop: string = CORP_BACKDROP_STANDARD,
): string {
  const b = backdropOf(backdrop);
  // Общие градиенты — с id фона: превью разных фонов на одной странице не делят их.
  const k = backdropKey(backdrop);
  const padsSvg = pads
    .map(({ id, built }) => {
      const l = CORP_LOTS[id];
      if (!l) return '';
      return `<ellipse class="pad${built ? ' on' : ''}" cx="${l.x + l.w / 2}" cy="${l.y + l.h - 8}" rx="${Math.round(l.w * 0.44)}" ry="${Math.round(Math.max(8, l.w * 0.06))}"/>`;
    })
    .join('');
  return (
    `<svg class="bg" viewBox="0 0 1200 540" preserveAspectRatio="none" style="--pad:${b.accent}" aria-hidden="true"><defs>` +
    `<linearGradient id="cbSky-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b.sky[0]}"/><stop offset=".5" stop-color="${b.sky[1]}"/><stop offset=".62" stop-color="${b.sky[2]}"/></linearGradient>` +
    `<linearGradient id="cbDeck-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b.deck[0]}"/><stop offset="1" stop-color="${b.deck[1]}"/></linearGradient>` +
    `</defs><rect width="1200" height="540" fill="url(#cbSky-${k})"/>` +
    `<rect x="0" y="330" width="1200" height="210" fill="url(#cbDeck-${k})"/>` +
    `<image data-corp-backdrop="${k}" href="${b.src}" width="1200" height="540" preserveAspectRatio="none"/>` +
    `${padsSvg}</svg>`
  );
}

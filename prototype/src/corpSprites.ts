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
import { CORP_STYLE_STANDARD } from '../../packages/protocol/src/corpStyle';
import { corpArt, type CorpArt } from './corpArt';

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
  headquarters: { x: 470, y: 100, w: 260, h: 330, tag: 'bottom' },
  supply_center: { x: 236, y: 290, w: 210, h: 190, tag: 'bottom' },
  engineering_complex: { x: 744, y: 294, w: 230, h: 190, tag: 'bottom' },
};

/** Порядок рисования: дальние раньше ближних. */
export const CORP_DRAW_ORDER: readonly string[] = ['headquarters', 'supply_center', 'engineering_complex'];

function bx(x: number, y: number, w: number, h: number, d: number): string {
  const k = Math.round(d * 0.6);
  return (
    `<rect class="f" x="${x}" y="${y}" width="${w}" height="${h}"/>` +
    `<path class="s" d="M${x + w} ${y}L${x + w + d} ${y - k}V${y + h - k}L${x + w} ${y + h}Z"/>` +
    `<path class="t" d="M${x} ${y}L${x + d} ${y - k}H${x + w + d}L${x + w} ${y}Z"/>`
  );
}

function wins(x: number, y: number, cols: number, rows: number, dx: number, dy: number, w: number, h: number): string {
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

/** Картинки здания в участке: холст вписан в участок и стоит на его нижней кромке. */
function artSprite(
  id: string,
  lot: CorpLot,
  level: number,
  mode: CorpLotState,
  style: string,
  top: CorpArt,
  hit: boolean,
): string {
  const k = Math.min(lot.w / top.w, lot.h / top.h);
  const w = top.w * k;
  const h = top.h * k;
  const x = (lot.w - w) / 2;
  const y = lot.h - h;
  const image = (art: CorpArt, attrs = ''): string =>
    `<image href="${art.src}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${attrs}/>`;
  const current = mode === 'build' && level > 0 ? corpArt(id, level, style) : null;
  const body =
    mode === 'built'
      ? image(top)
      : mode === 'build'
        ? image(top, ' class="scaf" filter="url(#corpScaf)"') + (current ? image(current) : '')
        : image(top, ' class="ghost" filter="url(#corpGhost)"');
  let zone = '';
  if (hit) {
    // Нажимается нарисованное, а не пустое небо холста: рамка всех показанных уровней.
    const boxes = current ? [top.box, current.box] : [top.box];
    const lo = (i: number): number => Math.min(...boxes.map((b) => b[i] ?? 0));
    const hi = (i: number): number => Math.max(...boxes.map((b) => b[i] ?? 1));
    const x0 = x + lo(0) * w;
    const y0 = y + lo(1) * h;
    zone = `<g><rect class="hit" x="${n(x0)}" y="${n(y0)}" width="${n(x + hi(2) * w - x0)}" height="${n(y + hi(3) * h - y0)}"/></g>`;
  }
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
  // Строится следующий уровень; закрытое и доступное к стройке здание показывает первый.
  const top = corpArt(id, mode === 'built' ? level : mode === 'build' ? level + 1 : 1, style);
  if (top) return artSprite(id, CORP_LOTS[id] ?? PLAIN_LOT, level, mode, style, top, hit);
  const solid = mode === 'built' || (mode === 'build' && level > 0) ? PLAIN : '';
  const ghost = mode === 'built' ? '' : PLAIN;
  return svg(PLAIN_LOT, `<g class="solid">${solid}</g><g class="ghost${mode === 'build' ? ' scaf' : ''}">${ghost}</g>`);
}

/** Генератор с зерном (mulberry32): звёзды неба одни и те же при каждой отрисовке. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let stars = '';
function starField(): string {
  if (stars) return stars;
  const r = seeded(7);
  for (let i = 0; i < 150; i++)
    stars += `<circle cx="${(r() * 1200).toFixed(1)}" cy="${(r() * 320).toFixed(1)}" r="${(0.4 + r() * 1.2).toFixed(2)}" fill="#dff8ff" opacity="${(0.25 + r() * 0.65).toFixed(2)}"/>`;
  return stars;
}

/** Фон панорамы: небо, планета, палуба с сеткой и площадки под участками. `built` —
 *  у здания есть уровень, тогда его площадка светится сплошной линией. */
export function corpPanoramaBg(pads: ReadonlyArray<{ id: string; built: boolean }>): string {
  let grid = '';
  for (let x = -1800; x <= 3000; x += 150) grid += `<line x1="600" y1="250" x2="${x}" y2="540"/>`;
  for (let i = 1; i <= 9; i++) {
    const y = (330 + 210 * Math.pow(i / 9, 1.7)).toFixed(1);
    grid += `<line x1="0" y1="${y}" x2="1200" y2="${y}"/>`;
  }
  const padsSvg = pads
    .map(({ id, built }) => {
      const l = CORP_LOTS[id];
      if (!l) return '';
      return `<ellipse class="pad${built ? ' on' : ''}" cx="${l.x + l.w / 2}" cy="${l.y + l.h - 8}" rx="${Math.round(l.w * 0.44)}" ry="${Math.round(Math.max(8, l.w * 0.06))}"/>`;
    })
    .join('');
  return (
    `<svg class="bg" viewBox="0 0 1200 540" preserveAspectRatio="none" aria-hidden="true"><defs>` +
    `<linearGradient id="cbSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020b13"/><stop offset=".5" stop-color="#05192a"/><stop offset=".62" stop-color="#0a3044"/></linearGradient>` +
    `<radialGradient id="cbPlanet" cx=".62" cy=".08" r=".9"><stop offset="0" stop-color="#1b4a5e"/><stop offset=".45" stop-color="#0b2534"/><stop offset="1" stop-color="#030c14"/></radialGradient>` +
    `<linearGradient id="cbDeck" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b2d3c"/><stop offset="1" stop-color="#031019"/></linearGradient>` +
    `<radialGradient id="cbHaze" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#35d6e6" stop-opacity=".22"/><stop offset="1" stop-color="#35d6e6" stop-opacity="0"/></radialGradient>` +
    `<clipPath id="cbClip"><rect x="0" y="330" width="1200" height="210"/></clipPath></defs>` +
    `<rect width="1200" height="540" fill="url(#cbSky)"/>${starField()}` +
    `<circle cx="724" cy="62" r="20" fill="#0c2a38" stroke="#1d6b70" stroke-width="1.5"/>` +
    `<circle cx="250" cy="600" r="420" fill="url(#cbPlanet)"/><circle cx="250" cy="600" r="420" fill="none" stroke="#35d6e6" stroke-opacity=".35" stroke-width="2"/>` +
    `<path d="M60 330Q250 260 520 330" fill="none" stroke="#35d6e6" stroke-opacity=".08" stroke-width="10"/>` +
    `<ellipse cx="600" cy="330" rx="760" ry="46" fill="url(#cbHaze)"/>` +
    `<rect x="0" y="330" width="1200" height="210" fill="url(#cbDeck)"/>` +
    `<g clip-path="url(#cbClip)" stroke="#35d6e6" stroke-opacity=".1" stroke-width="1">${grid}</g>` +
    `<line x1="0" y1="330" x2="1200" y2="330" stroke="#35d6e6" stroke-opacity=".5" stroke-width="1.5"/>` +
    `${padsSvg}</svg>`
  );
}

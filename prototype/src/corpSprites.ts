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
  headquarters: { x: 410, y: 158, w: 380, h: 272, tag: 'bottom' },
  supply_center: { x: 150, y: 283, w: 300, h: 197, tag: 'bottom' },
  engineering_complex: { x: 740, y: 270, w: 320, h: 214, tag: 'bottom' },
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

function artSprite({ lot, top, current, x, y, w, h, drawn }: Placed, mode: CorpLotState, hit: boolean): string {
  const image = (art: CorpArt, attrs = ''): string =>
    `<image href="${art.src}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}"${attrs}/>`;
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
  return svg(PLAIN_LOT, `<g class="solid">${solid}</g><g class="ghost${mode === 'build' ? ' scaf' : ''}">${ghost}</g>`);
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

/** Звёзды неба: зерно и цвет у каждого фона свои. */
function starField(seed: number, color: string, count: number): string {
  const r = seeded(seed);
  let stars = '';
  for (let i = 0; i < count; i++)
    stars += `<circle cx="${(r() * 1200).toFixed(1)}" cy="${(r() * 320).toFixed(1)}" r="${(0.4 + r() * 1.2).toFixed(2)}" fill="${color}" opacity="${(0.25 + r() * 0.65).toFixed(2)}"/>`;
  return stars;
}

/** Фон базы (CORP-15): небо над горизонтом y=330, пейзаж и палуба под зданиями. Горизонт и
 *  палуба у всех фонов на одном месте, поэтому участки зданий от фона не зависят. `accent` —
 *  цвет сетки палубы, горизонта и площадок под участками. */
interface Backdrop {
  nameKey: string;
  sky: readonly [string, string, string];
  deck: readonly [string, string];
  accent: string;
  stars: { seed: number; color: string; count: number };
  /** Пейзаж между небом и палубой; градиенты — в `defs`. */
  defs: string;
  scene: string;
}

const BACKDROPS: Readonly<Record<string, Backdrop>> = {
  orbit: {
    nameKey: 'corp.backdrop.orbit',
    sky: ['#020b13', '#05192a', '#0a3044'],
    deck: ['#0b2d3c', '#031019'],
    accent: '#35d6e6',
    stars: { seed: 7, color: '#dff8ff', count: 150 },
    defs: `<radialGradient id="cbPlanet" cx=".62" cy=".08" r=".9"><stop offset="0" stop-color="#1b4a5e"/><stop offset=".45" stop-color="#0b2534"/><stop offset="1" stop-color="#030c14"/></radialGradient>`,
    scene:
      `<circle cx="724" cy="62" r="20" fill="#0c2a38" stroke="#1d6b70" stroke-width="1.5"/>` +
      `<circle cx="250" cy="600" r="420" fill="url(#cbPlanet)"/><circle cx="250" cy="600" r="420" fill="none" stroke="#35d6e6" stroke-opacity=".35" stroke-width="2"/>` +
      `<path d="M60 330Q250 260 520 330" fill="none" stroke="#35d6e6" stroke-opacity=".08" stroke-width="10"/>`,
  },
  nebula: {
    nameKey: 'corp.backdrop.nebula',
    sky: ['#0a0414', '#1a0b2e', '#2b1240'],
    deck: ['#22102f', '#0a0510'],
    accent: '#c48cff',
    stars: { seed: 11, color: '#f3e6ff', count: 190 },
    defs:
      `<radialGradient id="cbNeb1" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ff5fb4" stop-opacity=".55"/><stop offset=".55" stop-color="#8a3cff" stop-opacity=".22"/><stop offset="1" stop-color="#8a3cff" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="cbNeb2" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#4fd8ff" stop-opacity=".4"/><stop offset="1" stop-color="#4fd8ff" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="cbStar" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="#ffd6f2" stop-opacity=".8"/><stop offset="1" stop-color="#ff7fd0" stop-opacity="0"/></radialGradient>`,
    scene:
      `<ellipse cx="860" cy="150" rx="420" ry="150" fill="url(#cbNeb1)" transform="rotate(-14 860 150)"/>` +
      `<ellipse cx="300" cy="110" rx="330" ry="110" fill="url(#cbNeb1)" opacity=".7" transform="rotate(10 300 110)"/>` +
      `<ellipse cx="640" cy="220" rx="300" ry="90" fill="url(#cbNeb2)"/>` +
      `<circle cx="930" cy="128" r="46" fill="url(#cbStar)"/>` +
      `<path d="M0 330L90 296L170 314L260 282L350 306L430 290L520 318L600 330Z" fill="#160a22"/>` +
      `<path d="M700 330L780 300L880 318L960 288L1050 312L1130 296L1200 314V330Z" fill="#160a22"/>`,
  },
  ice_moon: {
    nameKey: 'corp.backdrop.ice-moon',
    sky: ['#03101e', '#0b2742', '#3f6f93'],
    deck: ['#7fa9c4', '#1b3550'],
    accent: '#bdf3ff',
    stars: { seed: 23, color: '#ffffff', count: 120 },
    defs:
      `<radialGradient id="cbGiant" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#d9c8a8"/><stop offset=".5" stop-color="#9c7f5c"/><stop offset="1" stop-color="#3a2c22"/></radialGradient>` +
      `<linearGradient id="cbIce" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8f7ff"/><stop offset="1" stop-color="#8db6cf"/></linearGradient>`,
    scene:
      `<g transform="rotate(-12 330 150)"><ellipse cx="330" cy="150" rx="250" ry="34" fill="none" stroke="#e9dcc0" stroke-opacity=".35" stroke-width="10"/>` +
      `<circle cx="330" cy="150" r="110" fill="url(#cbGiant)"/>` +
      `<path d="M80 150A250 34 0 0 0 580 150" fill="none" stroke="#f4ead2" stroke-opacity=".55" stroke-width="10"/></g>` +
      `<circle cx="980" cy="70" r="14" fill="#cfe8f5" opacity=".8"/>` +
      `<path d="M0 330L70 284L120 300L190 252L250 290L320 270L400 330Z" fill="url(#cbIce)" opacity=".85"/>` +
      `<path d="M760 330L840 262L900 296L980 240L1060 288L1130 268L1200 300V330Z" fill="url(#cbIce)" opacity=".85"/>` +
      `<path d="M190 252L176 280L204 276ZM980 240L964 272L996 266Z" fill="#ffffff" opacity=".9"/>`,
  },
  gas_giant: {
    nameKey: 'corp.backdrop.gas-giant',
    sky: ['#120604', '#3a1408', '#a2441a'],
    deck: ['#3b1a0c', '#0f0603'],
    accent: '#ffb43a',
    stars: { seed: 31, color: '#ffe7c4', count: 90 },
    defs:
      `<radialGradient id="cbJove" cx=".5" cy=".2" r=".8"><stop offset="0" stop-color="#ffcf7a"/><stop offset=".45" stop-color="#e2772e"/><stop offset="1" stop-color="#5a1f0c"/></radialGradient>` +
      `<clipPath id="cbJoveClip"><circle cx="600" cy="560" r="430"/></clipPath>`,
    scene:
      `<circle cx="600" cy="560" r="450" fill="#ff9a3c" opacity=".12"/>` +
      `<circle cx="600" cy="560" r="430" fill="url(#cbJove)"/>` +
      `<g clip-path="url(#cbJoveClip)" fill="none" stroke-linecap="round">` +
      `<path d="M150 210Q600 170 1050 210" stroke="#ffe0a3" stroke-opacity=".45" stroke-width="14"/>` +
      `<path d="M170 250Q600 222 1030 252" stroke="#8a3412" stroke-opacity=".5" stroke-width="18"/>` +
      `<path d="M190 296Q600 276 1010 298" stroke="#ffd08a" stroke-opacity=".35" stroke-width="10"/></g>` +
      `<ellipse cx="760" cy="238" rx="38" ry="14" fill="#7a2a10" opacity=".7"/>` +
      `<circle cx="180" cy="90" r="24" fill="#3a1408" stroke="#ffb43a" stroke-opacity=".5" stroke-width="1.5"/>`,
  },
};

/** Фоны базы, бесплатный первым. Ключ — id фона из каталога магазина (`corpBackdrop`). */
export const CORP_BACKDROPS: readonly string[] = /* @__PURE__ */ Object.keys(BACKDROPS);

const backdropOf = (id: string): Backdrop => BACKDROPS[id] ?? BACKDROPS.orbit!;

/** Ключ имени фона; незнакомый фон называется бесплатным, как и рисуется. */
export function corpBackdropName(id: string): string {
  return backdropOf(id).nameKey;
}

/** Фон панорамы: небо, пейзаж, палуба с сеткой и площадки под участками. `built` — у здания
 *  есть уровень, тогда его площадка светится сплошной линией. `backdrop` — фон базы. */
export function corpPanoramaBg(
  pads: ReadonlyArray<{ id: string; built: boolean }>,
  backdrop: string = CORP_BACKDROP_STANDARD,
): string {
  const b = backdropOf(backdrop);
  // Общие градиенты — с id фона: превью разных фонов на одной странице не делят их.
  const k = BACKDROPS[backdrop] ? backdrop : CORP_BACKDROP_STANDARD;
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
    `<svg class="bg" viewBox="0 0 1200 540" preserveAspectRatio="none" style="--pad:${b.accent}" aria-hidden="true"><defs>` +
    `<linearGradient id="cbSky-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b.sky[0]}"/><stop offset=".5" stop-color="${b.sky[1]}"/><stop offset=".62" stop-color="${b.sky[2]}"/></linearGradient>` +
    `<linearGradient id="cbDeck-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b.deck[0]}"/><stop offset="1" stop-color="${b.deck[1]}"/></linearGradient>` +
    `<radialGradient id="cbHaze-${k}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${b.accent}" stop-opacity=".22"/><stop offset="1" stop-color="${b.accent}" stop-opacity="0"/></radialGradient>` +
    `<clipPath id="cbClip-${k}"><rect x="0" y="330" width="1200" height="210"/></clipPath>${b.defs}</defs>` +
    `<rect width="1200" height="540" fill="url(#cbSky-${k})"/>${starField(b.stars.seed, b.stars.color, b.stars.count)}` +
    b.scene +
    `<ellipse cx="600" cy="330" rx="760" ry="46" fill="url(#cbHaze-${k})"/>` +
    `<rect x="0" y="330" width="1200" height="210" fill="url(#cbDeck-${k})"/>` +
    `<g clip-path="url(#cbClip-${k})" stroke="${b.accent}" stroke-opacity=".1" stroke-width="1">${grid}</g>` +
    `<line x1="0" y1="330" x2="1200" y2="330" stroke="${b.accent}" stroke-opacity=".5" stroke-width="1.5"/>` +
    `${padsSvg}</svg>`
  );
}

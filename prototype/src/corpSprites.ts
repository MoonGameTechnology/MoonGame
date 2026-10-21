/**
 * Голограммы базы корпорации (CORP-3) — заглушки зданий, пока нет картинок (CORP-13).
 *
 * Панорама — мир 1200×540: у каждого здания свой участок (`CORP_LOTS`, низ участка — земля),
 * в нём здание рисуется SVG по частям, по одной на уровень: уровень N — первые N частей.
 * Строящийся уровень — следующая часть штриховкой лесов, закрытое здание — контур первой
 * части. Картинки CORP-13 лягут в те же участки (`corp/<здание>-<уровень>.webp`).
 *
 * Здание без своей голограммы (новое в каталоге раньше, чем нарисованное) получает
 * простой корпус и в панораму не встаёт — карточка и лист у него всё равно есть.
 */
import type { CorpLotState } from '../../decisions/corpBase';

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

/** Где по спрайту нажимается здание (x, y, w, h в координатах участка) — без пустого неба. */
const HIT: Readonly<Record<string, readonly [number, number, number, number]>> = {
  headquarters: [80, 56, 110, 266],
  supply_center: [10, 56, 196, 126],
  engineering_complex: [12, 60, 212, 122],
};

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

/** Части голограмм по уровням. */
const PARTS: Readonly<Record<string, readonly string[]>> = {
  headquarters: [
    bx(28, 294, 196, 28, 10) + bx(84, 152, 92, 142, 12) + bx(98, 136, 64, 16, 8) + wins(96, 166, 4, 5, 18, 22, 8, 10) +
      '<rect class="s" x="118" y="268" width="24" height="26"/><path class="vi" d="M130 139l5 3v6l-5 3l-5-3v-6Z"/>',
    '<rect class="f" x="36" y="224" width="48" height="70"/><path class="t" d="M36 224L44 219H84V224Z"/>' +
      bx(188, 224, 44, 70, 8) + wins(44, 238, 2, 2, 18, 24, 8, 10) + wins(196, 238, 2, 2, 18, 24, 8, 10),
    '<path class="t" d="M124 131L130 66L136 131Z"/><circle class="acc" cx="130" cy="62" r="4.5"/>' +
      '<path class="ln" d="M104 133V108M100 114H108M156 133V104M152 110H160"/>',
    '<path class="t" d="M40 219A21 18 0 0 1 82 219Z"/><path class="ln" d="M61 201V193"/><circle class="w" cx="61" cy="191" r="2.5"/>' +
      '<path class="ln" d="M212 219V198"/><ellipse class="t" cx="212" cy="193" rx="20" ry="8" transform="rotate(-18 212 193)"/><path class="ln" d="M212 193L224 178"/>',
    '<ellipse class="ln" cx="130" cy="98" rx="96" ry="17" style="opacity:.35"/><ellipse class="ln" cx="130" cy="98" rx="84" ry="14"/>' +
      '<circle class="acc" cx="47" cy="99" r="3.5"/><circle class="w" cx="211" cy="94" r="3"/>',
  ],
  supply_center: [
    bx(14, 120, 104, 62, 10) +
      '<rect class="s" x="40" y="146" width="40" height="36"/><path class="ln" d="M40 158H80M40 170H80" style="opacity:.6"/><rect class="acc" x="20" y="128" width="30" height="4"/>' +
      '<rect class="f" x="150" y="62" width="7" height="120"/><path class="ln" d="M150 80L157 92L150 104L157 116L150 128L157 140L150 152" style="stroke-width:1"/>' +
      '<rect class="t" x="145" y="54" width="17" height="10"/><path class="ln" d="M124 64H206"/><path class="ln" d="M194 64V98" style="stroke-width:1"/><rect class="acc" x="190" y="98" width="8" height="6"/>' +
      bx(162, 160, 36, 22, 6),
    bx(162, 138, 36, 22, 6) + bx(122, 166, 24, 16, 5),
    '<ellipse class="t" cx="66" cy="116" rx="40" ry="5"/><path class="f" d="M44 94L92 94L104 86L64 80L50 86Z"/><path class="w" d="M92 88L100 87L94 92Z"/>' +
      '<circle class="acc" cx="46" cy="91" r="3"/><path class="ln" d="M60 97L56 110M84 97L88 110" style="opacity:.5"/>',
  ],
  engineering_complex: [
    bx(56, 112, 104, 70, 12) +
      '<rect class="s" x="80" y="134" width="56" height="48"/><path class="ln" d="M80 146H136M80 158H136M80 170H136" style="opacity:.5"/>' +
      '<rect class="acc" x="56" y="120" width="104" height="4"/><path class="ln" d="M64 106V72M152 106V72M60 72H158M108 72V88"/><rect class="acc" x="104" y="88" width="8" height="5"/>' +
      bx(176, 144, 40, 38, 7) + '<rect class="w" x="186" y="154" width="20" height="8"/>',
    '<path class="ln" d="M200 140L210 114L188 98" style="stroke-width:3.4"/><circle class="w" cx="200" cy="140" r="3.2"/><circle class="w" cx="210" cy="114" r="3.2"/><path class="acc" d="M188 98l-6-3l2 6Z"/>',
    bx(18, 74, 20, 108, 6) +
      '<ellipse class="ln" cx="30" cy="96" rx="17" ry="4"/><ellipse class="ln" cx="30" cy="116" rx="17" ry="4"/><ellipse class="ln" cx="30" cy="136" rx="17" ry="4"/><ellipse class="ln" cx="30" cy="156" rx="17" ry="4"/>' +
      '<circle class="acc" cx="31" cy="64" r="6"/><path class="ln" d="M31 58l-6-10l8 2l-4-10" style="stroke:#ffb43a"/>',
  ],
};

/** Корпус здания без своей голограммы. */
const PLAIN_LOT: CorpLot = { x: 0, y: 0, w: 200, h: 170, tag: 'bottom' };
const PLAIN = [bx(40, 90, 110, 72, 12) + wins(52, 104, 4, 2, 24, 22, 10, 8)];

/** Голограмма здания уровня `level` в состоянии участка `mode`. `hit` — прозрачная зона
 *  нажатия по силуэту (только на панораме, где участки перекрываются). */
export function corpSprite(id: string, level: number, mode: CorpLotState, hit = false): string {
  const lot = CORP_LOTS[id] ?? PLAIN_LOT;
  const parts = PARTS[id] ?? PLAIN;
  let solid = '';
  let ghost = '';
  if (mode === 'built') solid = parts.slice(0, level).join('');
  else if (mode === 'build') {
    solid = parts.slice(0, level).join('');
    ghost = parts[level] ?? parts[parts.length - 1] ?? '';
  } else ghost = parts[0] ?? '';
  const zone = HIT[id];
  const hitRect = hit && zone ? `<rect class="hit" x="${zone[0]}" y="${zone[1]}" width="${zone[2]}" height="${zone[3]}"/>` : '';
  return (
    `<svg class="spr" viewBox="0 0 ${lot.w} ${lot.h}" preserveAspectRatio="xMidYMax meet" aria-hidden="true">` +
    `<g>${hitRect}</g><g class="solid">${solid}</g><g class="ghost${mode === 'build' ? ' scaf' : ''}">${ghost}</g></svg>`
  );
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

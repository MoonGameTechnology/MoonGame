/**
 * Плашки перевозок у мира и кольцо-часы штурмовой высадки — верхний слой карты, без выбора
 * флота и на схеме. Что в строках — `decisions/troopTransferTimers.ts`, размер и место
 * плашки — `decisions/transferTags.ts`; здесь только канва.
 *
 * Плашка — из того же семейства, что плашка флота: тёмное поле, полоса цвета слева. Знак
 * операции нарисован линиями (у шрифта телефона глифа может не оказаться), время — крупно и
 * светло, подпись вида — мелко над ним, по низу — полоса пройденной доли. Кольцо-часы
 * обводит мир, на который идёт штурмовая высадка: дуга растёт от «12 часов» к касанию.
 */
import type { GameState } from '../../packages/shared-core/src/index';
import { drawFleetSign } from '../../packages/client/src/fleetCountBadge';
import { t } from '../../localization/runtime';
import {
  troopTransferTimers,
  type TroopTransferKind,
  type TroopTransferRow,
} from '../../decisions/troopTransferTimers';
import {
  placeTagStack,
  TAG,
  tagClearance,
  tagRowHeight,
  tagRowWidth,
  tagTitleAlpha,
} from '../../decisions/transferTags';
import { orbitRingRadius } from './fleetGeometry';
import { countdownHMS } from './format';
import { insets, viewWidth, visible, world } from './mapCamera';
import { ASSAULT_TONE, ownerColor, TAU } from './mapPalette';
import { artScale } from './semanticZoom';

const TIME_FONT = '700 12px ui-monospace,Menlo,monospace';
const TITLE_FONT = '600 9.5px ui-monospace,Menlo,monospace';
const COUNT_FONT = '600 10px ui-monospace,Menlo,monospace';
const TIME_COLOR = '#f4f8fc';
const PLATE = 'rgba(3,14,22,.92)';
const BAR_TRACK = 'rgba(190,219,229,.16)';
/** Кольцо-часы — на столько дальше края сферы мира, px при полной детализации. */
const CLOCK_GAP = 7;

const TITLE_KEY: Record<TroopTransferKind, string> = {
  load: 'map.transfer.load',
  unload: 'map.transfer.unload',
  assault: 'map.transfer.assault',
};

// Ширины текстов: плашки рисуются каждый кадр, а замер и смена шрифта оставляют мусор на
// куче браузера (`fleetCountBadge.ts`). Цифры моноширинные — время меряем по маске нулей,
// и ширина плашки не дрожит, пока идёт отсчёт.
const widths = new Map<string, number>();
function textWidth(cx: CanvasRenderingContext2D, font: string, text: string): number {
  const key = `${font}|${text}`;
  let width = widths.get(key);
  if (width === undefined) {
    cx.font = font;
    width = cx.measureText(text).width;
    if (widths.size >= 128) widths.clear();
    widths.set(key, width);
  }
  return width;
}

const titleOf = (kind: TroopTransferKind): string => t(TITLE_KEY[kind]).toUpperCase();
const timeMask = (time: string): string => time.replace(/\d/g, '0');
/** Знак флота и число после времени, px; один флот — ничего. */
function countWidth(cx: CanvasRenderingContext2D, fleets: number): number {
  return fleets > 1 ? 7 + 9 + 3 + textWidth(cx, COUNT_FONT, String(fleets)) : 0;
}

/** Знак операции линиями: стрелка вверх от земли — погрузка, вниз к земле — выгрузка,
 *  двойной шеврон к земле — штурмовая высадка. `(x, y)` — центр знака. */
function drawKindSign(
  cx: CanvasRenderingContext2D,
  kind: TroopTransferKind,
  x: number,
  y: number,
): void {
  cx.lineWidth = 1.5;
  cx.beginPath();
  cx.moveTo(x - 5, y + 5.5);
  cx.lineTo(x + 5, y + 5.5);
  if (kind === 'load') {
    cx.moveTo(x, y + 3);
    cx.lineTo(x, y - 5.5);
    cx.moveTo(x - 3.5, y - 2);
    cx.lineTo(x, y - 5.5);
    cx.lineTo(x + 3.5, y - 2);
  } else if (kind === 'unload') {
    cx.moveTo(x, y - 5.5);
    cx.lineTo(x, y + 2.5);
    cx.moveTo(x - 3.5, y - 1);
    cx.lineTo(x, y + 2.5);
    cx.lineTo(x + 3.5, y - 1);
  } else {
    cx.moveTo(x - 4, y - 5.5);
    cx.lineTo(x, y - 2);
    cx.lineTo(x + 4, y - 5.5);
    cx.moveTo(x - 4, y - 1.5);
    cx.lineTo(x, y + 2);
    cx.lineTo(x + 4, y - 1.5);
  }
  cx.stroke();
}

function drawRow(
  cx: CanvasRenderingContext2D,
  row: TroopTransferRow,
  color: string,
  x: number,
  y: number,
  width: number,
  height: number,
  titleAlpha: number,
): void {
  cx.globalAlpha = 1;
  cx.fillStyle = PLATE;
  cx.fillRect(x, y, width, height);
  cx.lineWidth = 1;
  cx.strokeStyle = color;
  cx.globalAlpha = 0.55;
  cx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  cx.globalAlpha = 1;
  cx.fillStyle = color;
  cx.fillRect(x, y, TAG.accent, height);
  drawKindSign(cx, row.kind, x + TAG.iconX, y + (height - 3) / 2);

  const textX = x + TAG.textX;
  if (titleAlpha > 0) {
    cx.globalAlpha = titleAlpha * 0.9;
    cx.font = TITLE_FONT;
    cx.fillText(titleOf(row.kind), textX, y + 10);
  }
  const time = countdownHMS(row.leftMs);
  const timeY = y + height - 12;
  cx.globalAlpha = 1;
  cx.font = TIME_FONT;
  cx.fillStyle = TIME_COLOR;
  cx.fillText(time, textX, timeY);
  if (row.fleets > 1) {
    const at = textX + textWidth(cx, TIME_FONT, timeMask(time)) + 7;
    cx.globalAlpha = 0.9;
    cx.lineWidth = 1;
    drawFleetSign(cx, at, timeY);
    cx.font = COUNT_FONT;
    cx.fillStyle = color;
    cx.fillText(String(row.fleets), at + 12, timeY);
  }
  // Пройденная доля — по низу плашки, внутри рамки.
  const barX = x + TAG.accent + 1;
  const barW = width - TAG.accent - 2;
  cx.globalAlpha = 1;
  cx.fillStyle = BAR_TRACK;
  cx.fillRect(barX, y + height - 3, barW, 2);
  cx.fillStyle = color;
  cx.fillRect(barX, y + height - 3, barW * row.progress, 2);
}

/** Кольцо-часы штурмовой высадки: бледный круг и растущая от «12 часов» дуга с точкой на
 *  конце. Засечка наверху — откуда идёт и куда вернётся отсчёт. */
function drawLandingClock(
  cx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  progress: number,
): void {
  cx.strokeStyle = ASSAULT_TONE;
  cx.fillStyle = ASSAULT_TONE;
  cx.lineWidth = 1;
  cx.globalAlpha = 0.24;
  cx.beginPath();
  cx.arc(x, y, r, 0, TAU);
  cx.stroke();
  cx.globalAlpha = 0.8;
  cx.beginPath();
  cx.moveTo(x, y - r - 3);
  cx.lineTo(x, y - r + 3);
  cx.stroke();
  if (progress <= 0) return;
  const end = -Math.PI / 2 + TAU * progress;
  cx.globalAlpha = 0.95;
  cx.lineWidth = 2;
  cx.beginPath();
  cx.arc(x, y, r, -Math.PI / 2, end);
  cx.stroke();
  cx.beginPath();
  cx.arc(x + Math.cos(end) * r, y + Math.sin(end) * r, 2.2, 0, TAU);
  cx.fill();
}

/** Свои перевозки у мира: кольцо-часы штурма, выноска и стопка плашек. `detail` — детализация
 *  карты при текущем зуме: на общем плане плашки короче и стоят у самого мира. */
export function drawTransferTags(
  s: GameState,
  viewer: string,
  cx: CanvasRenderingContext2D,
  detail: number,
): void {
  const marks = troopTransferTimers(Object.values(s.fleets), viewer, s.time);
  if (marks.length === 0) return;
  const titleAlpha = tagTitleAlpha(detail);
  const rowH = tagRowHeight(titleAlpha);
  const sphereR = 13 * artScale(detail);
  const clockR = sphereR + CLOCK_GAP * artScale(detail);
  const frame = insets();
  const view = { left: 0, top: frame.top, right: viewWidth(), bottom: frame.bottom };
  const own = ownerColor(viewer);
  cx.save();
  cx.textAlign = 'left';
  cx.textBaseline = 'middle';
  cx.lineCap = 'round';
  cx.lineJoin = 'round';
  for (const m of marks) {
    const p = s.planets[m.target];
    if (!p) continue;
    const c = world(p.position);
    if (!visible(c, 160)) continue;
    const assault = m.rows.find((row) => row.kind === 'assault');
    if (assault) drawLandingClock(cx, c.x, c.y, clockR, assault.progress);

    let width = 0;
    for (const row of m.rows) {
      const time = textWidth(cx, TIME_FONT, timeMask(countdownHMS(row.leftMs)));
      const title = textWidth(cx, TITLE_FONT, titleOf(row.kind));
      width = Math.max(width, tagRowWidth(time, countWidth(cx, row.fleets), title, titleAlpha));
    }
    const height = m.rows.length * rowH + (m.rows.length - 1) * TAG.gap;
    const clearance = tagClearance(orbitRingRadius(p), sphereR, detail);
    const stack = placeTagStack(
      c,
      width,
      height,
      clearance,
      assault ? clockR + 2 : sphereR + 5,
      view,
    );
    const tone = assault ? ASSAULT_TONE : own;
    if (stack.leader) {
      const l = stack.leader;
      cx.strokeStyle = tone;
      cx.fillStyle = tone;
      cx.lineWidth = 1;
      cx.globalAlpha = 0.5;
      cx.beginPath();
      cx.moveTo(l.x1, l.y1);
      cx.lineTo(l.x2, l.y2);
      cx.stroke();
      cx.globalAlpha = 0.85;
      cx.beginPath();
      cx.arc(l.x2, l.y2, 1.6, 0, TAU);
      cx.fill();
    }
    m.rows.forEach((row, i) => {
      const color = row.kind === 'assault' ? ASSAULT_TONE : own;
      cx.strokeStyle = color;
      cx.fillStyle = color;
      drawRow(
        cx,
        row,
        color,
        stack.left,
        stack.top + i * (rowH + TAG.gap),
        width,
        rowH,
        titleAlpha,
      );
    });
  }
  cx.restore();
}

/**
 * ЗНАЧОК АНГАРА НА КАРТЕ (концепт «Управление эскадрой», заказ владельца 2026-11-08): рядом
 * с именем своей базы, где стоит хотя бы одна эскадра, — «◇ N». Бирюзовый — база готова к
 * вылету, серый с жёлтой точкой — ждёт перезарядки или топлива. Выбранная эскадра
 * обводит значок своей базы рамкой. У своего носителя с эскадрами в трюме такой же значок
 * стоит справа от плашки флота.
 *
 * Значок один на базу, чужих нет, цвет — по готовности базы (`decisions/hangarBadge.ts`).
 * Модуль рисует и запоминает, где нарисовал: тап по значку разбирает `mapInput.ts` по
 * {@link hangarHits} этого кадра, как метки пингов и планов.
 *
 * На общем обзоре карты (миры — точки схемы) значков нет: там они слипаются с именами, а
 * эскадру в этот момент всё равно не разглядеть. Рисуется только то, что на экране.
 */
import type { GameState } from '../../packages/shared-core/src/index';
import type { MapLod } from '../../packages/client/src/mapLod';
import { hangarBadge, type BadgeHit, type HangarBadge } from '../../decisions/hangarBadge';
import { data } from './game';
import { fleetHangar, planetHangar, type HangarView } from './hangarPanel';
import { selSquadron } from './interaction';
import { visible, world } from './mapCamera';
import { fleetBadgeBox } from './mapFleets';
import { worldName } from './planetName';
import { artScale } from './semanticZoom';

/** Что значкам нужно от игры. */
export interface MapHangarsHost {
  world(): GameState;
  me(): string;
  ctx(): CanvasRenderingContext2D;
}

let game: MapHangarsHost;
let hits: BadgeHit[] = [];
/** Значок этого кадра по месту: id мира или флота-носителя. Его ищет обучение. */
let bySpot = new Map<string, BadgeHit>();

/** Подключить значки к игре. Зовётся из `main.ts` один раз, до первого кадра. */
export function initMapHangars(host: MapHangarsHost): void {
  game = host;
}

/** Значки, нарисованные в этом кадре: их точки и эскадры за ними. */
export function hangarHits(): readonly BadgeHit[] {
  return hits;
}

/** Прямоугольник значка места (`id` мира или носителя) в этом кадре; `null` — не нарисован. */
export function hangarBadgeRect(
  spot: string,
): { left: number; top: number; width: number; height: number } | null {
  const h = bySpot.get(spot);
  if (!h) return null;
  // Подсветка обучения шире значка: пальцу нужна цель побольше, и её разбирает `mapTapSelect.ts`.
  const halfW = Math.max(h.halfW, 22);
  const halfH = Math.max(h.halfH, 22);
  return { left: h.x - halfW, top: h.y - halfH, width: halfW * 2, height: halfH * 2 };
}

const READY = '#5fe0d0';
const WAIT = '#8a9aa0';
const DOT = '#f2c94c';
/** Шрифт имени мира (`mapWorlds.ts`) — по нему меряется, где имя кончается. */
const NAME_FONT = '700 12px ui-monospace,Menlo,monospace';
const BADGE_FONT = '700 11px ui-monospace,Menlo,monospace';

/** Нарисовать значки своих баз: мира — в строке его имени, носителя — у его плашки. */
export function drawHangarBadges(lod: MapLod): void {
  hits = [];
  bySpot = new Map();
  if (lod.art <= 0) return;
  const s = game.world();
  const me = game.me();
  const cx = game.ctx();
  const R = 13 * artScale(lod.detail);
  cx.save();
  cx.textAlign = 'left';
  cx.textBaseline = 'middle';
  for (const p of Object.values(s.planets)) {
    if (p.owner !== me || !p.hangar?.length) continue;
    const view = planetHangar(p, data);
    const badge = view && badgeOf(view);
    if (!badge) continue;
    const c = world(p.position);
    if (!visible(c)) continue;
    // В строке имени мира, сразу за ним: под именем стоят строка гарнизона и ряд построек,
    // и значок там слипался с ними. Шрифт тот же, что у имени, — ширина совпадает.
    const labelX = c.x + (lod.detail > 0 ? R + 12 : lod.markerRadius + 6);
    cx.font = NAME_FONT;
    chip(cx, p.id, badge, labelX + cx.measureText(worldName(s, p.id)).width + 8, c.y - 5);
  }
  // Трюм своего носителя — значок справа от плашки флота («▲ 3 ◇1»).
  for (const f of Object.values(s.fleets)) {
    if (f.owner !== me || !f.hangar?.length) continue;
    const box = fleetBadgeBox(f.id);
    const view = box && fleetHangar(f, data, s);
    const badge = view && badgeOf(view);
    if (!box || !badge) continue;
    chip(cx, f.id, badge, box.x + box.w + 3, box.y + box.h / 2);
  }
  cx.restore();
}

function badgeOf(view: HangarView) {
  return hangarBadge({ squadronIds: view.squadrons.map((sq) => sq.id), blocked: view.blocked });
}

/** Один значок «◇ N» левым краем в `x`, серединой по `y`; запоминает цель для тапа. */
function chip(
  cx: CanvasRenderingContext2D,
  spot: string,
  badge: HangarBadge,
  x: number,
  y: number,
): void {
  cx.font = BADGE_FONT;
  const text = `◇ ${badge.count}`;
  const w = cx.measureText(text).width + (badge.ready ? 10 : 18);
  const h = 16;
  const picked = selSquadron !== null && badge.squadronIds.includes(selSquadron);
  const col = badge.ready ? READY : WAIT;
  cx.fillStyle = 'rgba(2,9,13,.82)';
  cx.strokeStyle = picked ? '#ffffff' : col;
  cx.lineWidth = picked ? 1.6 : 1;
  cx.beginPath();
  cx.rect(x, y - h / 2, w, h);
  cx.fill();
  cx.stroke();
  cx.fillStyle = col;
  cx.fillText(text, x + 5, y + 0.5);
  if (!badge.ready) {
    cx.fillStyle = DOT;
    cx.beginPath();
    cx.arc(x + w - 6, y, 2.5, 0, Math.PI * 2);
    cx.fill();
  }
  const hit = { x: x + w / 2, y, halfW: w / 2, halfH: h / 2, squadronIds: badge.squadronIds };
  hits.push(hit);
  bySpot.set(spot, hit);
}

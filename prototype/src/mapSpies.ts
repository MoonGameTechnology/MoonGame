/**
 * ШПИОНЫ НА КАРТЕ (SPM-1, заказ владельца 2026-11-20). Свой шпион в пути — корабль-«стелс» на
 * лейне (силуэт свой у каждого шпиона, `spyShipShapes.ts`), пунктир остатка пути по дорогам до
 * цели, кольцо у цели и плашка «позывной · сколько осталось». Шпионы, что стоят в мире, — один
 * значок «🕵 N» в строке его имени, за значком ангара, как «◇ N». Удача, провал и прибытие
 * вспыхивают кольцом у мира.
 *
 * Кого и где рисовать, решает `decisions/spyMarks.ts`; здесь только холст и цели для тапа.
 * Чужих шпионов нет: в реестре игрока только свои (туман, `visibleState`). Слой зовёт
 * `drawHangarBadges` (`mapHangars.ts`) — его хозяин даёт мир, своё место и холст. Тап
 * разбирает `mapTapSelect.ts` по {@link spyAt}.
 */
import type { GameState, SpyWayPoint } from '../../packages/shared-core/src/index';
import { spyRoster as coreSpyRoster } from '../../packages/shared-core/src/index';
import type { MapLod } from '../../packages/client/src/mapLod';
import { rgba } from '../../packages/client/src/holoDraw';
import { drawSpyShip, spyShipOf } from '../../packages/client/src/spyShipShapes';
import {
  spyFlightRoad,
  spyMarks,
  type SpyFlashKind,
  type SpyFlight,
} from '../../decisions/spyMarks';
import { spyRoster } from '../../decisions/spyRoster';
import { t } from '../../localization/runtime';
import { flashDone, flashProgress, noticeRing } from './flashFx';
import { motionOn } from './graphicsPrefs';
import { known, memory } from './mapFog';
import { visible, world } from './mapCamera';
import { TAU, youColor } from './mapPalette';
import { worldName } from './planetName';
import { artScale } from './semanticZoom';
import { timeLeft } from './worldQueries';

/** Что слою нужно от игры. */
export interface MapSpiesHost {
  world(): GameState;
  me(): string;
  ctx(): CanvasRenderingContext2D;
}

/** Цель тапа: корабль в пути или значок мира, и шпионы за ней. */
export interface SpyHit {
  kind: 'flight' | 'spot';
  x: number;
  y: number;
  halfW: number;
  halfH: number;
  spyIds: readonly number[];
}

let hits: SpyHit[] = [];
/** Последний виденный путь туда каждого своего шпиона: отозванный разворачивается на дороге
 *  так, как летел (`decisions/spyMarks.ts`, правило 2а). */
const outbound = new Map<number, readonly SpyWayPoint[]>();

const NAME_FONT = '700 12px ui-monospace,Menlo,monospace';
const BADGE_FONT = '700 11px ui-monospace,Menlo,monospace';
const LABEL_FONT = '600 11px ui-monospace,Menlo,monospace';
/** Корабль шпиона на экране, px, при полном зуме. */
const SHIP_PX = 26;
/** Палец ловит корабль и значок в этом полуразмере, даже если они меньше. */
const TOUCH_HALF = 22;

const FLASH: Record<SpyFlashKind, { color: string; ms: number }> = {
  win: { color: '#3ddc84', ms: 700 },
  fail: { color: '#ff5a6a', ms: 700 },
  arrive: { color: '#5fe0d0', ms: 320 },
};
const FLASHES_MAX = 8;
const flashes: { at: { x: number; y: number }; kind: SpyFlashKind; t: number }[] = [];

/** Цели тапа этого кадра (для харнеса `prototype/spymaptest.mjs`). */
export function spyHits(): readonly SpyHit[] {
  return hits;
}

/** Виды вспышек, что сейчас горят (для харнеса). */
export function spyFlashKinds(): SpyFlashKind[] {
  return flashes.map((f) => f.kind);
}

/** Вспышка у мира `at` (позиция карты) по событию своего шпиона. */
export function flashSpy(at: { x: number; y: number } | undefined, kind: SpyFlashKind): void {
  if (!at) return;
  flashes.push({ at: { x: at.x, y: at.y }, kind, t: performance.now() });
  if (flashes.length > FLASHES_MAX) flashes.splice(0, flashes.length - FLASHES_MAX);
}

/** Шпионы под точкой экрана: ближайшая цель этого кадра; `touch` расширяет её до пальца. */
export function spyAt(x: number, y: number, touch: boolean): readonly number[] | null {
  let best: SpyHit | null = null;
  let bestD = Infinity;
  for (const h of hits) {
    const hw = touch ? Math.max(h.halfW, TOUCH_HALF) : h.halfW;
    const hh = touch ? Math.max(h.halfH, TOUCH_HALF) : h.halfH;
    if (Math.abs(x - h.x) > hw || Math.abs(y - h.y) > hh) continue;
    const d = Math.hypot(x - h.x, y - h.y);
    if (d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return best ? best.spyIds : null;
}

/** Нарисовать своих шпионов: корабли в пути и значки миров. `chipAfter` — правый край
 *  значка ангара мира в этом кадре (значок шпионов встаёт за ним), если он нарисован. */
export function drawSpyMarks(
  host: MapSpiesHost,
  lod: MapLod,
  chipAfter: (planetId: string) => number | undefined,
  now: number,
): void {
  hits = [];
  const s = host.world();
  const me = host.me();
  const cx = host.ctx();
  const own = s.spies?.[me] ?? coreSpyRoster(s, me);
  for (const spy of own) if (spy.state === 'travel' && spy.way) outbound.set(spy.id, spy.way);
  const marks = spyMarks(own, s.time, outbound);
  const callsign = new Map(spyRoster(own).map((r) => [r.id, r.callsign]));
  cx.save();
  cx.textAlign = 'left';
  for (const fl of marks.flights) drawFlight(cx, s, me, fl, lod, callsign.get(fl.id));
  if (lod.art > 0) {
    const R = 13 * artScale(lod.detail);
    cx.textBaseline = 'middle';
    for (const spot of marks.spots) {
      const p = s.planets[spot.planetId];
      if (!p) continue;
      const c = world(p.position);
      if (!visible(c)) continue;
      const labelX = c.x + (lod.detail > 0 ? R + 12 : lod.markerRadius + 6);
      // За значком ангара; иначе за именем мира — если имя нарисовано: у неопознанного
      // мира вместо имени знак вопроса, и значок встаёт сразу за ним.
      const after = chipAfter(p.id);
      cx.font = NAME_FONT;
      const named = known(p.id) || memory.has(p.id);
      const x =
        after !== undefined
          ? after + 4
          : named
            ? labelX + cx.measureText(worldName(s, p.id)).width + 8
            : labelX;
      chip(cx, spot.spyIds, x, c.y - 5);
    }
  }
  drawFlashes(cx, now);
  cx.restore();
}

function drawFlight(
  cx: CanvasRenderingContext2D,
  s: GameState,
  me: string,
  fl: SpyFlight,
  lod: MapLod,
  sign: number | undefined,
): void {
  const color = youColor;
  // Путь впереди по дорогам, как у флота: мимо промежуточного мира — по развилке.
  const pts = spyFlightRoad(s, fl);
  const at = pts[0];
  if (!at) return;
  const screen = pts.map((p) => world(p));
  const ship = world(at);
  const target = s.planets[fl.target];
  if (screen.length > 1) {
    cx.setLineDash([5, 5]);
    cx.lineWidth = 1.6;
    cx.strokeStyle = rgba(color, fl.home ? 0.4 : 0.75);
    cx.beginPath();
    cx.moveTo(screen[0]!.x, screen[0]!.y);
    for (let i = 1; i < screen.length; i++) cx.lineTo(screen[i]!.x, screen[i]!.y);
    cx.stroke();
  }
  if (target && !fl.home) {
    const c = world(target.position);
    if (visible(c, 40)) {
      cx.setLineDash([3, 3]);
      cx.lineWidth = 1;
      cx.strokeStyle = rgba(color, 0.8);
      cx.beginPath();
      cx.arc(c.x, c.y, 20 * artScale(lod.detail) + 6, 0, TAU);
      cx.stroke();
    }
  }
  cx.setLineDash([]);
  if (!visible(ship, 40)) return;
  // Курс — направление дороги в точке корабля; в мире без пути — нос вверх.
  const next = screen[1];
  const heading = next ? Math.atan2(next.y - ship.y, next.x - ship.x) + Math.PI / 2 : 0;
  const px = SHIP_PX * (0.6 + 0.4 * lod.detail);
  cx.save();
  cx.translate(ship.x, ship.y);
  cx.rotate(heading);
  cx.scale(px / 24, px / 24);
  cx.translate(-12, -12);
  cx.fillStyle = color;
  cx.strokeStyle = color;
  drawSpyShip(cx, spyShipOf(me, fl.id, fl.gen), lod.detail > 0.4);
  cx.restore();
  hits.push({
    kind: 'flight',
    x: ship.x,
    y: ship.y,
    halfW: px / 2,
    halfH: px / 2,
    spyIds: [fl.id],
  });
  if (lod.detail <= 0.3 || sign === undefined) return;
  const text = `🕵 ${t(`spy.callsign.${sign}`)} · ${timeLeft(fl.until)}`;
  cx.font = LABEL_FONT;
  cx.textBaseline = 'middle';
  const w = cx.measureText(text).width + 14;
  // Плашка — по другую сторону от пути впереди, чтобы не лечь на пунктир.
  const ahead = next ? next.x - ship.x : 1;
  const x = ahead >= 0 ? ship.x - px / 2 - 6 - w : ship.x + px / 2 + 6;
  const y = ship.y - px / 2 - 4;
  cx.fillStyle = 'rgba(2,9,13,.82)';
  cx.strokeStyle = rgba(color, 0.55);
  cx.lineWidth = 1;
  cx.beginPath();
  cx.roundRect(x, y - 9, w, 18, 9);
  cx.fill();
  cx.stroke();
  cx.fillStyle = '#d6ecff';
  cx.fillText(text, x + 7, y + 0.5);
}

/** Значок «🕵 N» левым краем в `x`, серединой по `y`. */
function chip(cx: CanvasRenderingContext2D, spyIds: readonly number[], x: number, y: number): void {
  cx.font = BADGE_FONT;
  const text = `🕵 ${spyIds.length}`;
  const w = cx.measureText(text).width + 10;
  const h = 16;
  cx.fillStyle = 'rgba(2,9,13,.82)';
  cx.strokeStyle = youColor;
  cx.lineWidth = 1;
  cx.setLineDash([2, 1.5]);
  cx.beginPath();
  cx.rect(x, y - h / 2, w, h);
  cx.fill();
  cx.stroke();
  cx.setLineDash([]);
  cx.fillStyle = youColor;
  cx.fillText(text, x + 5, y + 0.5);
  hits.push({ kind: 'spot', x: x + w / 2, y, halfW: w / 2, halfH: h / 2, spyIds });
}

function drawFlashes(cx: CanvasRenderingContext2D, now: number): void {
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i]!;
    const look = FLASH[f.kind];
    if (flashDone(now, f.t, look.ms)) {
      flashes.splice(i, 1);
      continue;
    }
    const c = world(f.at);
    if (!visible(c, 40)) continue;
    const ring = noticeRing(flashProgress(now, f.t, look.ms), motionOn(), 14, 16);
    cx.strokeStyle = rgba(look.color, 0.9 * ring.alpha);
    cx.lineWidth = f.kind === 'arrive' ? 2 : 3;
    cx.beginPath();
    cx.arc(c.x, c.y, ring.r, 0, TAU);
    cx.stroke();
  }
}

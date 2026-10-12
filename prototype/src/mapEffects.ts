/**
 * Вспышки и залпы карты (REFM-234): то, что живёт на карте доли секунды и гаснет само, —
 * трассы огня ПКО, перехвата, корабельного ПВО и удара шаттлов, волна над перекрашенной
 * провинцией, вспышка сработавших мин, кольцо над миром, куда игрок перешёл ссылкой плана,
 * и малая вспышка «своя постройка готова, свой флот дошёл».
 *
 * Очереди вспышек — состояние модуля, и пишут их только двери ниже: события партии
 * (`handleEvents`) ставят залпы, захваты и мины, камера ставит кольцо перехода, смена
 * партии очищает залпы. Жизнь, затухание и радиусы — `flashFx.ts`, вид залпа по тиру —
 * `flakTiers.ts`; здесь только очереди и холст. Мир и контекст кадра модуль получает
 * хуками {@link initMapEffects}: они живут в `main.ts`, и импорт оттуда был бы циклом.
 * Рисовалки зовёт кадр `renderMap()`.
 */
import type { GameState } from '../../packages/shared-core/src/index';
import { rgba } from '../../packages/client/src/holoDraw';
import { toBake } from '../../decisions/mapLayerView';
import { AA_SHOTS_MAX, capShots } from './fireEffects';
import { FLAK_LIFE_MS, flakBurstRadius, flakDashOffset, flakLook, type FlakTier } from './flakTiers';
import { fadeOf, flashDone, flashProgress, growRadius, noticeRing, waveRadius } from './flashFx';
import { fxBlur, motionOn } from './graphicsPrefs';
import { visible, world } from './mapCamera';
import { mapView, provincePolygon } from './mapLayer';
import { LOCK, TAU, ownerColor } from './mapPalette';

/** Что вспышкам нужно от игры. */
export interface MapEffectsHost {
  /** Мир, который показывает кадр. */
  world(): GameState;
  /** Контекст канваса карты. */
  ctx(): CanvasRenderingContext2D;
}

let game: MapEffectsHost;

/** Подключить вспышки к игре. */
export function initMapEffects(host: MapEffectsHost): void {
  game = host;
}

/** Один залп на карте: концы в координатах карты, момент и тир огня. */
export interface FlakShot {
  from: { x: number; y: number };
  to: { x: number; y: number };
  at: number;
  // ТИР, а не «ближняя ли это зенитка»: с остатком SHU-3.1 сюда же встаёт ВСТРЕЧНЫЙ
  // ПЕРЕХВАТ (`shuttle.intercepted`), а с AUD-17 — КОРАБЕЛЬНОЕ ПВО (`pd.fired`); признака
  // «ближний/орбитальный» у них нет вовсе. Очередь и кадр отрисовки у всех тиров один —
  // расходится только вид (`flakTiers.ts`), поэтому второй копии этого блока не заводим.
  tier: FlakTier;
}

// Orbital-AA volleys to visualize (H2): map-space endpoints captured at event time
// (the target may die in that very volley), drawn as a fading flak burst ~0.7s.
export const aaShots: FlakShot[] = [];
// Capture flashes: a province that changed hands lights up in its NEW owner's colour —
// a wave sweeps across its cell and the frontier ignites, fading over ~1.5s, so a
// silent capture (previously only a toast) reads on the map at a glance. Fog-gated at
// push time (a hidden flip never flashes). Keyed by node so a re-capture restarts it.
export const captureFlashes = new Map<string, { owner: string; at: number }>();
// SM-3.5: вспышка срабатывания мин — узел → момент (performance.now). Ставится, только
// если мины задели меня или сработало моё поле.
export const mineFlashes = new Map<string, { at: number; position?: { x: number; y: number } }>();

/** Поставить залп в очередь; старые сверх предела уходят первыми. */
export function addFlak(shot: FlakShot): void {
  aaShots.push(shot);
  capShots(aaShots, AA_SHOTS_MAX);
}

/** Очистить залпы: они принадлежат прежней партии. */
export function clearFlak(): void {
  aaShots.length = 0;
}

/** Зажечь перекрашенную провинцию цветом нового хозяина; повторный захват начинает волну
 *  заново. */
export function flashProvince(node: string, owner: string): void {
  captureFlashes.set(node, { owner, at: performance.now() });
}

/** Вспышка сработавших мин на узле; точка на дороге — своя `position`. */
export function flashMines(node: string, position: { x: number; y: number } | undefined): void {
  mineFlashes.set(node, { at: performance.now(), position });
}

/** orbital-AA flak (H2): a dashed ground-to-orbit tracer with a burst at the
 *  target end, fading out — a fleet under AA fire no longer melts silently. */
export function drawFlak(): void {
  const cx = game.ctx();
  if (aaShots.length) {
    const nowMs = performance.now();
    cx.save();
    for (let i = aaShots.length - 1; i >= 0; i--) {
      const shot = aaShots[i]!;
      // Жизнь и затухание трассы — `flashFx.ts` (REFM-70): своей шкалы у неё нет.
      if (flashDone(nowMs, shot.at, FLAK_LIFE_MS)) {
        aaShots.splice(i, 1);
        continue;
      }
      const a = world(shot.from);
      const b = world(shot.to);
      if (!visible(a, 160) && !visible(b, 160)) continue;
      const k = flashProgress(nowMs, shot.at, FLAK_LIFE_MS);
      const fade = fadeOf(k);
      // Тир — весь вид разом, таблицей в `flakTiers.ts` (REFM-112): часовой ОРБИТАЛЬНЫЙ
      // залп тяжелее и заметнее 15-минутной БЛИЖНЕЙ зенитки по всем осям сразу, а
      // ВСТРЕЧНЫЙ ПЕРЕХВАТ отличается от обоих — это не выстрел с земли.
      const look = flakLook(shot.tier);
      cx.strokeStyle = rgba(look.color, look.alpha * fade);
      cx.lineWidth = look.width;
      cx.setLineDash([...look.dash]);
      cx.lineDashOffset = flakDashOffset(nowMs - shot.at); // трасса ползёт от поверхности
      cx.shadowColor = look.color;
      cx.shadowBlur = fxBlur(look.blur);
      cx.beginPath();
      cx.moveTo(a.x, a.y);
      cx.lineTo(b.x, b.y);
      cx.stroke();
      cx.setLineDash([]);
      cx.fillStyle = rgba(look.burstColor, 0.8 * fade);
      cx.beginPath();
      cx.arc(b.x, b.y, flakBurstRadius(look, k), 0, TAU);
      cx.fill();
    }
    cx.restore();
  }
}

const MINE_FLASH_MS = 1200;
/** SM-3.5: кольцо срабатывания мин расходится от узла и гаснет. */
export function drawMineFlashes(now: number): void {
  const s = game.world();
  const cx = game.ctx();
  for (const [node, flash] of mineFlashes) {
    const { at } = flash;
    if (flashDone(now, at, MINE_FLASH_MS)) {
      mineFlashes.delete(node);
      continue;
    }
    const position = flash.position ?? s.planets[node]?.position;
    if (!position) continue;
    const c = world(position);
    if (!visible(c, 80)) continue;
    const k = flashProgress(now, at, MINE_FLASH_MS);
    cx.save();
    cx.strokeStyle = `rgba(255,179,71,${0.9 * fadeOf(k)})`;
    cx.lineWidth = 3;
    cx.beginPath();
    cx.arc(c.x, c.y, waveRadius(k, 60, 1), 0, TAU);
    cx.stroke();
    cx.restore();
  }
}

const GO_FLASH_MS = 1600;
export let goFlash: { id: string; at: number } | null = null;
/** Кольцо над миром, куда игрок перешёл ссылкой цели в строке плана. */
export function flashGo(id: string): void {
  goFlash = { id, at: performance.now() };
}
export function drawGoFlash(now: number): void {
  const s = game.world();
  const cx = game.ctx();
  if (!goFlash) return;
  if (flashDone(now, goFlash.at, GO_FLASH_MS)) {
    goFlash = null;
    return;
  }
  const pl = s.planets[goFlash.id];
  if (!pl) return;
  const c = world(pl.position);
  // Шкала одна на обе вспышки (`flashFx.ts`): прогресс 0→1, затухание — он же наоборот.
  const k = fadeOf(flashProgress(now, goFlash.at, GO_FLASH_MS));
  cx.save();
  cx.strokeStyle = rgba(LOCK, 0.25 + 0.55 * k);
  cx.lineWidth = 1.6;
  cx.setLineDash([4, 4]);
  cx.beginPath();
  cx.arc(c.x, c.y, growRadius(14, 10, 1 - k), 0, TAU);
  cx.stroke();
  cx.restore();
}
/** Малая вспышка (UIX-4.1, скилл `mobile-game-feel`): своя постройка готова, свой флот
 *  дошёл. Одно кольцо на 200 мс — малый тир; размер и затухание — `noticeRing`. */
const NOTICE_FLASH_MS = 200;
const NOTICE_FLASHES_MAX = 16;
export const noticeFlashes: { at: { x: number; y: number }; t: number }[] = [];
export function noticeFlash(at: { x: number; y: number } | null | undefined): void {
  if (!at) return;
  noticeFlashes.push({ at: { x: at.x, y: at.y }, t: performance.now() });
  capShots(noticeFlashes, NOTICE_FLASHES_MAX);
}
export function drawNoticeFlashes(now: number): void {
  const cx = game.ctx();
  for (let i = noticeFlashes.length - 1; i >= 0; i--) {
    const f = noticeFlashes[i]!;
    if (flashDone(now, f.t, NOTICE_FLASH_MS)) {
      noticeFlashes.splice(i, 1);
      continue;
    }
    const c = world(f.at);
    if (!visible(c, 30)) continue;
    const ring = noticeRing(flashProgress(now, f.t, NOTICE_FLASH_MS), motionOn(), 12, 10);
    cx.save();
    cx.strokeStyle = rgba(LOCK, 0.9 * ring.alpha);
    cx.lineWidth = 2;
    cx.beginPath();
    cx.arc(c.x, c.y, ring.r, 0, TAU);
    cx.stroke();
    cx.restore();
  }
}
const CAPTURE_FLASH_MS = 1500;
/** Capture waves use the exact projected polygons just painted by blitStaticLayer.
 * No per-flash weight clamp or n² geometry pass, including while the camera moves. */
export function drawCaptureFlashes(now: number): void {
  const s = game.world();
  const cx = game.ctx();
  if (captureFlashes.size === 0) return;
  const trace = (poly: readonly (readonly [number, number])[]): void => {
    cx.beginPath();
    cx.moveTo(poly[0]![0], poly[0]![1]);
    for (let i = 1; i < poly.length; i++) cx.lineTo(poly[i]![0], poly[i]![1]);
    cx.closePath();
  };
  for (const [node, flash] of captureFlashes) {
    if (flashDone(now, flash.at, CAPTURE_FLASH_MS)) {
      captureFlashes.delete(node);
      continue;
    }
    const poly = provincePolygon(node);
    const planet = s.planets[node];
    if (!poly || !planet) continue;
    const cell = { poly };
    // The cell comes from the map layer's bake — its centre goes into the same space.
    const at = world(planet.position);
    const c = toBake(mapView, at.x, at.y);
    // Кламп прогресса и затухание — `flashFx.ts`: метка кадра rAF может опередить
    // постановку вспышки, а отрицательный радиус роняет cx.arc().
    const k = flashProgress(now, flash.at, CAPTURE_FLASH_MS); // 0 → 1
    const fade = fadeOf(k);
    const col = ownerColor(flash.owner);
    // cell radius (centre → farthest vertex) sets how far the wave travels
    let maxR = 0;
    for (const [px, py] of cell.poly) maxR = Math.max(maxR, Math.hypot(px - c.x, py - c.y));
    cx.save();
    // 1) colour wash of the whole cell, fading — the province "flips" to the new hue
    trace(cell.poly);
    cx.fillStyle = rgba(col, 0.3 * fade);
    cx.fill();
    // 2) the wave: a bright ring expanding from the centre, CLIPPED to the cell so it
    //    reads as energy sweeping across the province out to its border
    trace(cell.poly);
    cx.clip();
    cx.globalCompositeOperation = 'lighter';
    const rr = waveRadius(k, maxR, 1.25);
    cx.strokeStyle = rgba(col, 0.85 * fade);
    cx.lineWidth = 3 + 5 * fade;
    cx.shadowColor = col;
    cx.shadowBlur = fxBlur(12 * fade);
    cx.beginPath();
    cx.arc(c.x, c.y, rr, 0, TAU);
    cx.stroke();
    cx.restore();
    // 3) the frontier igniting — the cell outline pulses bright then settles
    cx.save();
    trace(cell.poly);
    cx.strokeStyle = rgba(col, 0.9 * fade);
    cx.lineWidth = 1.5 + 2.5 * fade;
    cx.shadowColor = col;
    cx.shadowBlur = fxBlur(8 * fade);
    cx.stroke();
    cx.restore();
  }
}

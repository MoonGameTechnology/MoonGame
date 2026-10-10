/**
 * Камера карты и рамка — у одного владельца (REFM-231, первый PR): рамка карты, поле игры
 * внутри HUD, сама камера (сдвиг и зум), перевод «карта ↔ экран», зажим, стартовый вид и
 * переходы к миру из текста и из панели (`jumpTo`).
 *
 * Камеру меняли не только её функции: ввод тянул её пальцем, лист выбора на телефоне
 * подвигал её к маркеру, щипок и подгонка вида под новый размер окна присваивали её целиком,
 * а выпечка карты подтягивала её на сетку пикселей. Теперь они зовут двери модуля
 * ({@link panBy}, {@link setView}), а снаружи камера видна только для чтения (`Readonly`):
 * присвоить её поля мимо владельца не даст компилятор. Рамку ставит установка геометрии
 * карты — дверью {@link frameMap}.
 *
 * Размер экрана, раскладка, консоль, мир, своё место и побочные действия перехода (выбор
 * мира, окно дипломатии, вспышка) живут в `main.ts`; модуль получает их хуками
 * {@link initMapCamera} — импорт оттуда был бы циклом.
 */
import type { GameState } from '../../packages/shared-core/src/index';
import {
  worldToScreen as camWorldToScreen,
  screenToWorld as camScreenToWorld,
  zoomAt as camZoomAt,
  clampCam as camClampCam,
  centerOn as camCenterOn,
  fitTransform as camFitTransform,
} from '../../packages/client/src/camera';
import { data } from './gameData';
import { isFrontier } from './mapCatalog';
import { jumpStep, type JumpKind } from './mapJump';
import { mapScale, screenRadius } from './mapRadius';
import { openingView, openingZoom, pickHome } from './openingView';
import { leftCardSlackFor, panelSlackFor, type Slack } from './panelSlack';
import { matchMode } from './protoKernel';

/** Что камере нужно от игры. Экран, раскладка, мир и побочные действия перехода — в `main.ts`. */
export interface MapCameraHost {
  /** Ширина экрана в CSS-пикселях. */
  vw(): number;
  /** Высота экрана в CSS-пикселях. */
  vh(): number;
  /** Телефонная раскладка: поле игры без левой полосы, лист выбора снизу. */
  mobile(): boolean;
  /** Голографическая консоль: у неё своё поле игры. */
  console(): boolean;
  /** Мир на экране: стартовый вид ищет в нём родной мир, переход — цель. */
  world(): GameState;
  /** Своё место. */
  me(): string;
  /** Переход с выбором: выбрать мир и перерисовать панель. */
  select(id: string): void;
  /** Переход из текста закрывает окно дипломатии. */
  closeDiplo(): void;
  /** Короткое кольцо на мире, куда перешли. */
  ring(id: string): void;
}

let game: MapCameraHost;

/** Поднять камеру: хуки игры. Зовётся из `main.ts` один раз, до первого кадра. */
export function initMapCamera(host: MapCameraHost): void {
  game = host;
}

const TOP = 50; // top-bar height
const RAIL = 50; // left-rail width

// Project a map-space point into the on-screen play area (inside the HUD insets).
let MINX = Infinity;
let MAXX = -Infinity;
let MINY = Infinity;
let MAXY = -Infinity;
/** Рамка карты — границы её узлов. Ставит её установка геометрии карты: старт и смена карты. */
export function frameMap(nodes: ReadonlyArray<{ x: number; y: number }>): void {
  MINX = Math.min(...nodes.map((n) => n.x));
  MAXX = Math.max(...nodes.map((n) => n.x));
  MINY = Math.min(...nodes.map((n) => n.y));
  MAXY = Math.max(...nodes.map((n) => n.y));
}
// The play area: the screen rectangle the map lives in, inside the HUD insets. Mobile
// no longer reserves the left rail (it folds into the drawer) → the map claims that
// space; desktop keeps the rail + label gutter and the right panel column.
export function insets(): { left: number; right: number; top: number; bottom: number } {
  const VW = game.vw();
  const VH = game.vh();
  if (game.console()) {
    return { left: 20, right: VW - 20, top: VW > 1200 ? 138 : 182, bottom: VH - 76 };
  }
  if (game.mobile()) {
    return { left: 14, right: VW - 24, top: VH < 520 ? 86 : TOP + 54, bottom: VH - 96 };
  }
  // Wide screens (tablets + landscape): frame the board with reserves that SCALE to the
  // viewport rather than fixed desktop constants. The old fixed 372px right column and
  // 80/150 top/bottom bars wasted most of a tablet's width and squeezed a short landscape
  // screen to a sliver — so the whole-map fit rendered tiny. Clamped so it stays sane
  // across a 9" tablet up to a desktop window.
  const rightPad = Math.min(360, Math.max(120, VW * 0.16));
  const topPad = Math.min(80, Math.max(44, VH * 0.09));
  const botPad = Math.min(150, Math.max(78, VH * 0.16));
  return { left: RAIL + 80, right: VW - rightPad, top: TOP + topPad, bottom: VH - botPad };
}
// The view transform (fit / zoom / pan / projection) lives in the shared camera module
// (@void/client · camera.ts, CP0.2 — one render implementation for the prototype and the
// Stage-4 client). MINX..MAXY (set by frameMap above) are the map bounds it projects.
export const mapBounds = () => ({ minX: MINX, minY: MINY, maxX: MAXX, maxY: MAXY });

// Camera: pan offset + zoom over the base fit (scale range MIN_SCALE..MAX_SCALE lives in
// the module: 1 = whole-map fit, 6 = one province + neighbours). Node/label sizes stay
// constant in screen px; only positions transform (node-graph style zoom). On a phone the
// opening view zooms onto the home region; double-tap resets, pinch out to the overview.
const camera = { scale: 1, x: 0, y: 0 };
/** Камера для чтения: менять её можно только дверями модуля. */
export const cam: Readonly<typeof camera> = camera;

export function world(p: { x: number; y: number }): { x: number; y: number } {
  return camWorldToScreen(p, cam, insets(), mapBounds());
}
/** Обратный перевод: точка экрана → мировые координаты. Нужен там, где целью служит
 *  САМА ТОЧКА карты, а не мир или флот под пальцем (точка патруля, SHU-6.3). */
export function unworld(p: { x: number; y: number }): { x: number; y: number } {
  return camScreenToWorld(p, cam, insets(), mapBounds());
}
/** Дальность карты в пикселях — ЕДИНСТВЕННЫЙ перевод на весь рендер (`mapRadius.ts`,
 *  REFM-132). Там же причина, почему множитель — подгон карты под экран × зум камеры:
 *  взять один зум (как когда-то) значит рисовать круг меньше настоящей дальности. */
export function worldDist(d: number): number {
  return screenRadius(d, mapScale(camFitTransform(insets(), mapBounds()).scale, cam.scale));
}

export function visible(c: { x: number; y: number }, pad = 80): boolean {
  const VW = game.vw();
  const VH = game.vh();
  return c.x >= -pad && c.x <= VW + pad && c.y >= -pad && c.y <= VH + pad;
}
/** Extra pan slack while the selection panel (#side) covers the play area: let the
 *  camera overshoot the map border by the covered strip, so worlds hidden behind the
 *  open panel can be dragged into the clear part of the screen. The panel is a
 *  full-width bottom sheet on phones (→ slack below) and a right-hand column on wide
 *  screens (→ slack on the right); measure its live rect so both layouts just work. */
export function panelSlack(): Slack {
  const VW = game.vw();
  const VH = game.vh();
  const el =
    typeof document !== 'undefined'
      ? document.getElementById(game.mobile() ? 'mobile-sheet' : 'side')
      : null;
  const open = el && getComputedStyle(el).display !== 'none';
  // The arithmetic (which side is covered, and by how much) is `panelSlack.ts`
  // (REFM-54); measuring the live element stays here. YAG-7.2: the first-fight hint is a
  // left column on PC — the camera may pull the home corner out from under it too.
  return {
    ...panelSlackFor(open ? el.getBoundingClientRect() : null, VW, VH),
    ...leftCardSlackFor(pirateIntroRect(), VW),
  };
}
/** Прямоугольник подсказки первого боя, пока она видна (YAG-7.2), иначе `null`. */
export function pirateIntroRect(): DOMRect | null {
  const el = typeof document !== 'undefined' ? document.getElementById('pirate-intro') : null;
  return el && !el.hidden ? el.getBoundingClientRect() : null;
}

export function zoomAt(fx: number, fy: number, factor: number) {
  // Zoom anchored on the focal point (cursor / pinch centre) — camera.ts clamps scale + pan.
  const n = camZoomAt(cam, fx, fy, factor, insets(), mapBounds(), panelSlack());
  camera.scale = n.scale;
  camera.x = n.x;
  camera.y = n.y;
}

/** Keep the map filling the play area with SLACK at the edges (module: PAN_SLACK) so the
 *  outermost provinces don't jam against the border. Delegates to the shared camera;
 *  an open panel widens the range (panelSlack) so it never traps the view. */
export function clampCam(): void {
  const n = camClampCam(cam, insets(), mapBounds(), panelSlack());
  camera.x = n.x;
  camera.y = n.y;
}

/** Put map-point `p` at the centre of the play area at `scale` (clamped + bounded). */
export function centerOn(p: { x: number; y: number }, scale: number): void {
  const n = camCenterOn(cam, p, scale, insets(), mapBounds(), panelSlack());
  camera.scale = n.scale;
  camera.x = n.x;
  camera.y = n.y;
}
/** The opening / reset view. Phones and the flagship console open on the home region;
 *  the simple desktop view keeps its whole-map fit. Zoom is relative to the screen-fit. */
export function defaultView(): void {
  // Кого считать домом и когда приближаться к нему — `openingView.ts` (REFM-56).
  // Забег узнаётся по режиму матча: `s.pve` ядро заводит только на первом ходе часов.
  const s = game.world();
  const ME = game.me();
  const run = data.modes[matchMode() ?? '']?.pve !== undefined;
  const zoom = openingZoom({ phone: game.mobile(), console: game.console(), run });
  const view = openingView(
    zoom !== null,
    pickHome(Object.values(s.planets), ME),
    zoom ?? undefined,
  );
  if (view.kind === 'home') {
    centerOn(view.at, view.scale * (isFrontier(s.mapId) ? 5 : 1));
    return;
  }
  camera.scale = 1;
  camera.x = 0;
  camera.y = 0;
  clampCam();
}
/** Сдвинуть камеру на (dx, dy) экранных пикселей без зажима: зажимает тот, кто тянет
 *  (палец, лист выбора), а выпечка карты так подтягивает камеру на сетку пикселей. */
export function panBy(dx: number, dy: number): void {
  camera.x += dx;
  camera.y += dy;
}
/** Поставить камеру целиком: щипок и подгонка вида под новый размер окна считают её сами. */
export function setView(v: { scale: number; x: number; y: number }): void {
  camera.scale = v.scale;
  camera.x = v.x;
  camera.y = v.y;
}

/** Обе дороги к точке карты. Чем прыжок из текста отличается от перехода по ссылке из
 *  панели (масштаб, выделение, диплоокно, вспышка) — `mapJump.ts` (REFM-108). */
export function jumpTo(id: string, kind: JumpKind): void {
  const pl = game.world().planets[id];
  const step = jumpStep(kind, !!pl, cam.scale);
  if (!pl || step.do !== 'jump') return;
  centerOn(pl.position, step.scale);
  if (step.select) game.select(id);
  if (step.closeDiplo) game.closeDiplo();
  if (step.ring) game.ring(id);
}
/** Pan the camera to a world referenced from a plan row (data-goto) — selection stays
 *  untouched (the fleet panel must survive the tap) and a short ring marks the spot. */
export function focusWorld(id: string): void {
  jumpTo(id, 'goto');
}

/** Fly to a world referenced from TEXT (toast / recap row / diplo ping): the map is not
 *  in front of the player yet, so this one zooms in and takes over the selection. */
export function jumpToPing(id: string): void {
  jumpTo(id, 'ping');
}

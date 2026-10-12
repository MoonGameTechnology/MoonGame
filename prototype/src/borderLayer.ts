/**
 * Слой живых границ (REFM-232, часть 2; M2.11, `decisions/livingBorderLayer.ts`): границы
 * провинций голографической карты в своём холсте размером с экран. Кадр обновляет его по
 * полосе за кадр на часах голограммы, а в жесте слой едет за камерой — сдвигается на целые
 * пиксели с дорисовкой открывшейся полосы или растягивается вместе с выпечкой под ним.
 *
 * Модуль — владелец холста слоя и всего, что тот помнит о своей картинке. Снаружи его зовут
 * двумя дверями: кадр — {@link blitBorderLayer}, потеря поверхностей карты —
 * {@link forgetBorderLayer}. Выпечку, геометрию провинций, перенос кадра и покой камеры слой
 * читает у слоя карты (`mapLayer.ts`); контекст кадра, экран и часы голограммы живут в
 * `main.ts` и приходят хуками {@link initBorderLayer} — импорт оттуда был бы циклом.
 */
import { drawLivingBorders } from '../../packages/client/src/livingBorder';
import type { BorderSegment, ClassifiedBorders, TerritoryPalette } from '../../packages/client/src/territory';
import { layerTransform, type LayerTransform, type MapProjection, type PixelRect } from '../../decisions/mapLayerView';
import {
  LIVING_BANDS,
  MIN_LAYER_SEGMENTS,
  bandEdges,
  borderLayerAction,
  framedRect,
  glassPixels,
  intersectRect,
  layerShift,
  staleBand,
  uncoveredRects,
} from '../../decisions/livingBorderLayer';
import { canvasCompatibilityOptions } from './canvasCompatibility';
import { clipGlassSurface } from './holographicSurface';
import {
  backgroundContextEvents,
  holographicFrame,
  livingLevel,
  mapSettled,
  mapView,
  provinceGeometry,
  territoryGeometry,
  type MapLayerGeometry,
} from './mapLayer';
import { ownerColor } from './mapPalette';

/** Что слою живых границ нужно от игры. */
export interface BorderLayerHost {
  /** Контекст канваса карты: в него кладётся слой. */
  ctx(): CanvasRenderingContext2D;
  /** Ширина экрана в CSS-пикселях. */
  vw(): number;
  /** Высота экрана в CSS-пикселях. */
  vh(): number;
  /** Плотность пикселей отрисовки. */
  dpr(): number;
  /** Часы голограммы: на них дышат границы; стоят при выключенном движении. */
  clock(): number;
}

let game: BorderLayerHost;
let canvas: HTMLCanvasElement;

/** Поднять слой живых границ: хуки игры и холст `#map`, чей размер слой повторяет. Зовётся
 *  из `main.ts` один раз, до первого кадра. */
export function initBorderLayer(host: BorderLayerHost): void {
  game = host;
  canvas = document.getElementById('map') as unknown as HTMLCanvasElement;
}

const mapContextOptions = canvasCompatibilityOptions();

/** M2.11 (`decisions/livingBorderLayer.ts`): the living borders in a layer of their own, the
 *  canvas's size, that the frame refreshes a band at a time and that rides the camera in a
 *  gesture. Only the glass's pixels of it are drawn and shown; it keeps its pixels for the
 *  match, so neither a stop of the camera nor a gesture costs a new backing store. */
const borderLayer = document.createElement('canvas');
const borderLayerX = (mapContextOptions ? borderLayer.getContext('2d', mapContextOptions) : borderLayer.getContext('2d')) as CanvasRenderingContext2D;
let borderHeld = ''; // what the layer holds but the camera and detail ('' — nothing): screen, glass, colours
let borderAt: MapProjection = { a: 1, x: 0, y: 0 }; // the projection of the map its pixels stand at
let borderDetail = 0; // the province detail it was drawn at (`mapLod.ts`)
let borderLevel = 0; // the points of the borders it was drawn with (`territoryLod.ts`)
let borderSource: ClassifiedBorders | null = null; // the borders it was drawn from
let borderRect: PixelRect = { x: 0, y: 0, width: 0, height: 0 }; // the glass on it, device px
let borderEdges: number[] = []; // its bands' rows on the canvas; `[]` — the frame draws them
let borderClocks: number[] = []; // the hologram time each band was drawn at
let borderNext = 0; // the band to refresh next
let borderShifted = false; // it moved since its bands were shared out
let borderBake: MapLayerGeometry | null = null; // the bake the last frame stood on
let borderWaited = false; // it waited out a bake last frame (rule 4)

// The living-border layer's context can also be lost on its own; its events do not bubble.
borderLayer.addEventListener?.('contextlost', () => { backgroundContextEvents.lost++; borderHeld = ''; });
borderLayer.addEventListener?.('contextrestored', () => { backgroundContextEvents.restored++; borderHeld = ''; });

/** Холсты карты потеряли пиксели: слой забывает свою картинку и рисуется заново. */
export function forgetBorderLayer(): void {
  borderHeld = '';
}

/**
 * The living province borders over the map (M2.11): they live in {@link borderLayer}, drawn
 * whole at rest and then a band a frame, and in a gesture the layer rides the camera — moved by
 * whole device pixels with only the uncovered strip drawn, or stretched with the bake under it
 * while the frame strokes the edges it leaves uncovered (`decisions/livingBorderLayer.ts`).
 * Called in the bake's space: `cx` holds its transform. `false` — no layer this frame: the
 * caller strokes them straight into the frame, inside the glass clip it sets for the rest of
 * the map anyway.
 */
export function blitBorderLayer(detail: number, borders: ClassifiedBorders): boolean {
  const VW = game.vw();
  const VH = game.vh();
  const DPR = game.dpr();
  const cx = game.ctx();
  const hologramTime = game.clock();
  const geo = provinceGeometry;
  if (!geo || borderLayerX.isContextLost?.()) {
    borderHeld = '';
    return false;
  }
  // Owner colours follow diplomacy, not the bake: a declared war recolours the frontier now.
  let tints = '';
  for (const owner of borders.ownedFront.keys()) tints += ownerColor(owner) + ',';
  const { at } = geo;
  const f = holographicFrame;
  // Rule 1: the layer stands at a projection of the map, not at a bake: the glass is held in
  // the map's own units, and a new bake under the same camera keeps the layer.
  const glass = [(f.x - at.x) / at.a, (f.y - at.y) / at.a, f.width / at.a, f.height / at.a];
  const held = `${VW}x${VH}:${DPR}|${glass.map((v) => v.toPrecision(9)).join(',')}|${tints}`;
  const framed: MapProjection = { a: at.a * mapView.k, x: at.x * mapView.k + mapView.tx, y: at.y * mapView.k + mapView.ty };
  const level = livingLevel(geo);
  const rest = mapSettled && mapView.k === 1;
  // Rule 4: in motion the layer keeps its own province detail; at rest it takes the frame's.
  const fresh = held === borderHeld && borderSource !== null && (detail === borderDetail || !rest) &&
    (level === borderLevel ? borders : territoryGeometry.borders(geo.shape, geo.seeds, borderLevel)) === borderSource;
  const rel = layerTransform(borderAt, framed);
  // Rule 4: not in the frame that baked the map anew, unless it waited one already.
  const baked = geo !== borderBake && !borderWaited;
  borderBake = geo;
  const judged = { fresh, transform: rel, dpr: DPR, settled: mapSettled, sharp: mapView.k === 1 };
  let action = borderLayerAction({ ...judged, baked });
  borderWaited = baked && action !== borderLayerAction(judged);
  // Rule 5: a layer over few borders holds nothing — the frame strokes them, and the layer
  // counts them again where the camera next rests or the borders change.
  if (!borderEdges.length && fresh) {
    if (!rest || action === 'keep') return false;
    action = 'paint';
  }
  if (action === 'paint') {
    borderHeld = held;
    borderAt = framed;
    borderDetail = detail;
    borderLevel = level;
    borderSource = borders;
    borderShifted = false;
    const rect = glassPixels(f, mapView, DPR, canvas.width, canvas.height);
    borderEdges = rect ? borderBands(borders, detail, geo, rect) : [];
    if (!rect || !borderEdges.length) return false;
    borderRect = rect;
    if (borderLayer.width !== canvas.width) borderLayer.width = canvas.width;
    if (borderLayer.height !== canvas.height) borderLayer.height = canvas.height;
    // Nothing of an earlier place may show through the edge of a stretched layer (rule 3).
    borderLayerX.clearRect(0, 0, borderLayer.width, borderLayer.height);
    paintBorderRect(borders, geo, rect);
    borderClocks = borderEdges.slice(1).map(() => hologramTime);
    borderNext = 0;
  } else {
    const source = borderSource!;
    if (action === 'scroll') scrollBorderLayer(layerShift(rel, DPR)!, source, geo);
    if (mapSettled && borderShifted) {
      // The bands were shared out where the layer stood: share them out where it rests.
      borderShifted = false;
      borderEdges = borderBands(source, borderDetail, geo, borderRect);
      if (!borderEdges.length) return false;
      borderClocks = borderEdges.slice(1).map(() => -1);
      borderNext = 0;
    }
    // Rule 2: one band a frame, at the hologram's time now; none while that clock stands, nor
    // while a zoom stretches the layer (rule 3): it is painted whole once the zoom is over.
    const band = action === 'show' ? -1 : staleBand(borderClocks, borderNext, hologramTime);
    if (band >= 0) {
      const rows = intersectRect(borderRect, { x: 0, y: borderEdges[band]!, width: borderLayer.width, height: borderEdges[band + 1]! - borderEdges[band]! });
      if (rows) paintBorderRect(source, geo, rows);
      borderClocks[band] = hologramTime;
      borderNext = band + 1;
    }
  }
  const r = borderRect;
  if (action !== 'show') {
    if (r.width > 0 && r.height > 0) {
      cx.save();
      cx.setTransform(1, 0, 0, 1, 0, 0);
      cx.drawImage(borderLayer, r.x, r.y, r.width, r.height, r.x, r.y, r.width, r.height);
      cx.restore();
    }
    return true;
  }
  // Rule 3: a zoom shows the layer stretched, as the bake under it is, and the frame strokes
  // the edges of the glass it leaves uncovered.
  const glassNow = glassPixels(f, mapView, DPR, canvas.width, canvas.height);
  if (!glassNow) return true;
  const shown = r.width > 0 && r.height > 0 ? framedRect(r, rel, DPR) : null;
  const inside = shown && intersectRect(shown, glassNow);
  if (inside) {
    // The pixels of the layer that land on `inside`: a source rect, not a clip — a clip around a
    // stretched image costs the software raster as much again.
    const s = rel.k;
    cx.save();
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.drawImage(borderLayer, (inside.x - rel.tx * DPR) / s, (inside.y - rel.ty * DPR) / s, inside.width / s, inside.height / s,
      inside.x, inside.y, inside.width, inside.height);
    cx.restore();
  }
  const palette = { ownerColor, hideOwnedInner: true, provinceDetail: detail };
  for (const strip of uncoveredRects(glassNow, inside)) strokeBordersIn(cx, borders, palette, geo, mapView, strip);
  return true;
}

/**
 * Rule 3: move {@link borderLayer} by `shift` device pixels under the camera — its pixels by a
 * copy, and only the glass the move uncovered drawn anew.
 */
function scrollBorderLayer(shift: { x: number; y: number }, borders: ClassifiedBorders, geo: MapLayerGeometry): void {
  const DPR = game.dpr();
  borderAt = { a: borderAt.a, x: borderAt.x + shift.x / DPR, y: borderAt.y + shift.y / DPR };
  borderShifted = true;
  const old = borderRect;
  const rect = glassPixels(holographicFrame, layerTransform(geo.at, borderAt), DPR, borderLayer.width, borderLayer.height);
  const kept = rect && intersectRect(rect, { x: old.x + shift.x, y: old.y + shift.y, width: old.width, height: old.height });
  const g = borderLayerX;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (kept) {
    g.globalCompositeOperation = 'copy'; // a canvas drawn onto itself reads it as it was
    g.drawImage(borderLayer, kept.x - shift.x, kept.y - shift.y, kept.width, kept.height, kept.x, kept.y, kept.width, kept.height);
  } else {
    g.clearRect(0, 0, borderLayer.width, borderLayer.height);
  }
  g.restore();
  borderRect = rect ?? { x: 0, y: 0, width: 0, height: 0 };
  if (rect) for (const strip of uncoveredRects(rect, kept)) paintBorderRect(borders, geo, strip);
}

/** Rule 2: the border layer's bands — rows of the canvas holding even shares of the segments
 *  the frame strokes inside `rect`, counted by the row of their middle; `[]` when they are few
 *  (rule 5). */
function borderBands(borders: ClassifiedBorders, detail: number, geo: MapLayerGeometry, rect: PixelRect): number[] {
  const DPR = game.dpr();
  const work = new Float64Array(canvas.height);
  const tr = layerTransform(geo.at, borderAt);
  const { place } = geo;
  const k = place.scale * DPR * tr.k;
  const ox = (place.x * tr.k + tr.tx) * DPR;
  const oy = (place.y * tr.k + tr.ty) * DPR;
  const x1 = rect.x + rect.width;
  const y1 = rect.y + rect.height;
  let total = 0;
  const count = (segs: readonly BorderSegment[]): void => {
    for (const sg of segs) {
      const x = ((sg[0] + sg[2]) / 2) * k + ox;
      const y = Math.floor(((sg[1] + sg[3]) / 2) * k + oy);
      if (x < rect.x || x >= x1 || y < rect.y || y >= y1) continue;
      work[y]!++;
      total++;
    }
  };
  for (const segs of borders.ownedFront.values()) count(segs);
  if (detail > 0) count(borders.neutralEdge);
  return total < MIN_LAYER_SEGMENTS ? [] : bandEdges(work, LIVING_BANDS);
}

/** Repaint `rect` (device px) of {@link borderLayer} at the hologram's time now, in the
 *  layer's own province detail. */
function paintBorderRect(borders: ClassifiedBorders, geo: MapLayerGeometry, rect: PixelRect): void {
  const g = borderLayerX;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(rect.x, rect.y, rect.width, rect.height);
  g.restore();
  const palette = { ownerColor, hideOwnedInner: true, provinceDetail: borderDetail };
  strokeBordersIn(g, borders, palette, geo, layerTransform(geo.at, borderAt), rect);
}

/** Stroke the living borders inside `rect` (device px) of `g`, whose map stands at `tr` from the
 *  bake's space, at the hologram's time now: the same strokes, glass clip and cull as the frame. */
function strokeBordersIn(
  g: CanvasRenderingContext2D,
  borders: ClassifiedBorders,
  palette: Pick<TerritoryPalette, 'ownerColor' | 'hideOwnedInner' | 'provinceDetail'>,
  geo: MapLayerGeometry,
  tr: LayerTransform,
  rect: PixelRect,
): void {
  const DPR = game.dpr();
  const hologramTime = game.clock();
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.beginPath();
  g.rect(rect.x, rect.y, rect.width, rect.height);
  g.clip();
  g.setTransform(DPR * tr.k, 0, 0, DPR * tr.k, DPR * tr.tx, DPR * tr.ty);
  clipGlassSurface(g, holographicFrame);
  // The rect in the bake's space: what the strokes are culled by.
  const s = DPR * tr.k;
  const box = { x: rect.x / s - tr.tx / tr.k, y: rect.y / s - tr.ty / tr.k, width: rect.width / s, height: rect.height / s };
  drawLivingBorders(g, borders, palette, holographicFrame, hologramTime, box, geo.place);
  g.restore();
}

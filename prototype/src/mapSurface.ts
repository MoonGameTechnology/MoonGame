/**
 * Поверхность карты (REFM-235, часть 2): всё, что кадр рисует в пространстве выпечки поверх
 * политической карты, — живые границы провинций голографической карты, стекло с бликами
 * рельефа и волной, выделение выбранной провинции и волна над перекрашенной, рамка стекла.
 *
 * Своё у модуля — пульс выделения: с какого момента провинция выбрана. Выбор другого мира
 * перезапускает его сам, а повторный тап по тому же миру — дверью {@link markSelection}.
 * Геометрию провинций, выпечку и её перенос модуль читает у слоя карты (`mapLayer.ts`), слой
 * границ — у `borderLayer.ts`, вспышку захвата — у `mapEffects.ts`. Контекст кадра, экран и
 * часы и вид голограммы живут в `main.ts` и приходят хуками {@link initMapSurface}: импорт
 * оттуда был бы циклом. Слой зовёт кадр `renderMap()`.
 */
import { drawLivingBorders } from '../../packages/client/src/livingBorder';
import type { MapLod } from '../../packages/client/src/mapLod';
import { drawProvinceSelection, selectionPulse } from '../../packages/client/src/provinceSelection';
import { visibleInBake } from '../../decisions/mapLayerView';
import { blitBorderLayer } from './borderLayer';
import { glowOn, motionOn } from './graphicsPrefs';
import { clipGlassSurface, drawGlassRim, drawGlassWave, drawTerrainField } from './holographicSurface';
import { selPlanet } from './interaction';
import { drawCaptureFlashes } from './mapEffects';
import { holographicFrame, livingBorders, mapView, provinceGeometry, provincePolygon, terrainFields } from './mapLayer';
import { LOCK, ownerColor } from './mapPalette';

/** Что поверхности карты нужно от игры. */
export interface MapSurfaceHost {
  /** Контекст канваса карты. */
  ctx(): CanvasRenderingContext2D;
  /** Ширина экрана в CSS-пикселях. */
  vw(): number;
  /** Высота экрана в CSS-пикселях. */
  vh(): number;
  /** Плотность пикселей отрисовки. */
  dpr(): number;
  /** Часы голограммы: стоят на паузе и при отключённой анимации. */
  clock(): number;
  /** Голографический вид карты. */
  holographic(): boolean;
}

let game: MapSurfaceHost;

/** Подключить поверхность карты к игре. */
export function initMapSurface(host: MapSurfaceHost): void {
  game = host;
}

const holographicMapOn = (): boolean => game.holographic();

// Пульс выделения провинции: какой мир он подсвечивает и с какого момента.
let paintedSelection: string | null = null;
let selectionStarted = 0;

/** Мир выбран тапом заново (тот же или другой): пульс выделения начинается с момента `at`. */
export function markSelection(at: number): void {
  selectionStarted = at;
}

/**
 * Поверхность карты в пространстве выпечки. Всё, что нарисовано по геометрии провинций
 * выпечки, живёт в её пространстве: то же преобразование, что положило слой карты, кладёт
 * стекло, границы, блики и волны.
 */
export function drawMapSurface(now: number, lod: MapLod): void {
  const cx = game.ctx();
  const VW = game.vw();
  const VH = game.vh();
  const DPR = game.dpr();
  const hologramTime = game.clock();
  const detail = lod.detail;
  const sight = visibleInBake(mapView, VW, VH);
  cx.save();
  cx.setTransform(DPR * mapView.k, 0, 0, DPR * mapView.k, DPR * mapView.tx, DPR * mapView.ty);
  if (holographicMapOn()) {
    // M2.11: границы провинций — живые, как рамка карты, и на тех же часах голограммы
    // (под reduced motion стоят — линия замирает видимой). Сразу над заливкой, чтобы
    // порядок слоёв остался прежним, когда граница жила в выпечке.
    const borders = livingBorders();
    const layered = borders !== null && blitBorderLayer(lod.provinceDetail, borders);
    cx.save();
    clipGlassSurface(cx, holographicFrame);
    if (!layered && borders && provinceGeometry) {
      drawLivingBorders(cx, borders, {
        ownerColor,
        hideOwnedInner: true,
        provinceDetail: lod.provinceDetail,
      }, holographicFrame, hologramTime, sight, provinceGeometry.place);
    }
    if (detail > 0) {
      cx.save(); cx.globalAlpha *= detail;
      // The bake holds fields beyond the screen too (its margin): glints only where seen.
      for (const field of terrainFields) {
        const b = field.box;
        if (b.x > sight.x + sight.width || b.y > sight.y + sight.height ||
          b.x + b.width < sight.x || b.y + b.height < sight.y) continue;
        drawTerrainField(cx, field, hologramTime, true);
      }
      cx.restore();
    }
    drawGlassWave(cx, holographicFrame, VW, VH, hologramTime, glowOn());
  }
  if (paintedSelection !== selPlanet) {
    paintedSelection = selPlanet;
    selectionStarted = now;
  }
  const selectedPoly = selPlanet ? provincePolygon(selPlanet) : undefined;
  if (selectedPoly) drawProvinceSelection(cx, selectedPoly, selectionPulse(now - selectionStarted, motionOn()), LOCK);
  drawCaptureFlashes(now); // wave over a just-flipped province, over the political fill
  if (holographicMapOn()) {
    cx.restore();
    drawGlassRim(cx, holographicFrame, hologramTime, glowOn());
  }
  cx.restore(); // back to screen space
}

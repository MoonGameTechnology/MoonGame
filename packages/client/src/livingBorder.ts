/**
 * M2.11 — ЖИВАЯ ГРАНИЦА ПРОВИНЦИЙ: обводка колышется так же, как рамка карты.
 *
 * Замечание владельца (2026-09-24): «границы провинций не идут волнами, как границы карты —
 * нет анимации». Рамка голографической карты (`drawGlassRim`) перерисовывается каждый кадр и
 * «кипит» по нормали; границы провинций запекались в статичный слой вместе с заливкой и
 * стояли. Волна у них была и раньше (M2.9, `territoryWave.ts`), но застывшая: её форма —
 * функция одних координат, и это правило никуда не делось — ЗАЛИВКА и попадание тапом по-
 * прежнему идут по застывшему полигону. Живёт только ЛИНИЯ, и живёт поверх него.
 *
 * Три правила, на которых здесь легко обжечься:
 *
 * 1. **Смещение — функция ТОЧКИ и часов, а не грани.** Две соседние клетки обходят общую
 *    границу в разные стороны, а владельческий фронтир рисует каждая сторона своим цветом.
 *    Сдвинь их по нормали — нормали противоположны, и линия раздвоится. Поле от одних
 *    координат двигает общую точку одинаково для обеих.
 * 2. **Поле привязано к ПЛОСКОСТИ КАРТЫ, а не к экрану.** Координаты берутся относительно
 *    голографической рамки и в её масштабе, поэтому панорама и зум несут рисунок волны
 *    вместе с картой, как несут отражение `drawGlassWave`. Посчитай поле в экранных — и волна
 *    поедет по границе, стоит сдвинуть камеру.
 * 3. **Амплитуда — доля от меньшей стороны рамки, но с потолком в экранных пикселях.** На
 *    обзоре это полтора пикселя, как у кипения рамки. Рамка растёт с зумом, и без потолка
 *    рос и размах: на стартовом виде партии (×3) граница качалась на 3 пикселя на ПК и на 2
 *    на телефоне, вблизи — сильнее. Владелец (2026-09-30): «сделай, чтоб границы провинций не
 *    так сильно "качались"». Потолок {@link LIVING_MAX_PX} ограничивает РАЗМАХ, а рисунок
 *    волны по-прежнему едет с картой (правило 2).
 *
 * Время — часы голограммы (`hologramTime` прототипа): под reduced motion они стоят, и граница
 * ЗАМИРАЕТ видимой, а не пропадает (скилл `mobile-game-feel`, §4).
 */
import { strokeBorders, type BorderSegment, type ClassifiedBorders, type TerritoryPalette } from './territory';
import type { ShapePlacement } from './territoryGeometry';

/** Голографическая рамка карты в экранных пикселях — та, что несёт `drawGlassRim`. */
export interface LivingFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Амплитуда колыхания — доля меньшей стороны рамки (правило 3). */
export const LIVING_AMP = 0.0018;

/** Потолок размаха в экранных пикселях: вблизи граница качается не сильнее (правило 3). */
export const LIVING_MAX_PX = 1;

/** Размах колыхания для рамки `frame`: доля её меньшей стороны, не больше потолка. */
function livingAmp(frame: LivingFrame): number {
  return Math.min(Math.min(frame.width, frame.height) * LIVING_AMP, LIVING_MAX_PX);
}

/**
 * Смещение точки границы в момент `clock` (мс часов голограммы). Гладкое поле двух «октав»:
 * медленная зыбь и мелкое кипение, как у рамки. Ограничено по каждой оси размахом
 * `livingAmp` (доля рамки, не больше потолка). Детерминированно: одна и та же точка в один и тот же
 * момент всегда даёт одно и то же — кадр не «шумит» сам по себе.
 */
export function livingOffset(
  x: number,
  y: number,
  frame: LivingFrame,
  clock: number,
): [number, number] {
  const scale = Math.min(frame.width, frame.height);
  if (!(scale > 0)) return [0, 0];
  const u = (x - frame.x) / scale;
  const v = (y - frame.y) / scale;
  const t = Math.max(0, clock) / 1000;
  // Доли подобраны так, что сумма не выходит за 1: зыбь ≤ 1/3, кипение ≤ 2/3.
  const swellX = Math.sin(v * 11 + t * 0.8) * Math.cos(u * 13 - t * 0.6);
  const swellY = Math.sin(u * 11 - t * 0.7) * Math.cos(v * 13 + t * 0.5);
  const boilX = Math.sin(u * 53 + t * 1.6) * Math.sin(v * 47 - t * 1.1);
  const boilY = Math.sin(v * 53 - t * 1.4) * Math.sin(u * 41 + t * 1.2);
  const amp = livingAmp(frame);
  return [amp * (swellX / 3 + (2 * boilX) / 3), amp * (swellY / 3 + (2 * boilY) / 3)];
}

/**
 * Нарисовать классифицированные границы живыми: те же стили, что у запечённой карты
 * (`strokeBorders` — один дом для цветов и толщин), но каждая точка сдвинута полем
 * {@link livingOffset}. Отрезок, целиком ушедший за край экрана, не считается вовсе:
 * граница рисуется каждый кадр, и платить за невидимое нельзя.
 *
 * `place` — границы пришли в локальных координатах мозаики (`territoryGeometry.ts`, их там
 * классифицируют раз на смену владельцев): каждая точка сперва встаёт на место той же
 * формулой, что и полигоны (`placePoly`), и отбор с полем считаются уже от неё. Без `place`
 * точки уже на месте.
 */
export function drawLivingBorders(
  g: CanvasRenderingContext2D,
  borders: ClassifiedBorders,
  palette: Pick<TerritoryPalette, 'ownerColor' | 'hideOwnedInner' | 'provinceDetail'>,
  frame: LivingFrame,
  clock: number,
  view: { x?: number; y?: number; width: number; height: number },
  place?: ShapePlacement,
): void {
  if (!(frame.width > 0 && frame.height > 0)) return;
  // Запас на сдвиг и толщину самой широкой линии (свечение фронтира — 3 пикселя).
  const pad = livingAmp(frame) + 3;
  // Видимая область начинается не в нуле, когда граница рисуется в координатах
  // выпечки карты, сдвинутой камерой (`decisions/mapLayerView.ts`).
  const x0 = (view.x ?? 0) - pad;
  const y0 = (view.y ?? 0) - pad;
  const x1 = (view.x ?? 0) + view.width + pad;
  const y1 = (view.y ?? 0) + view.height + pad;
  const k = place?.scale ?? 1;
  const ox = place?.x ?? 0;
  const oy = place?.y ?? 0;
  const keep = (sg: BorderSegment): boolean => {
    const ax = sg[0] * k + ox;
    const ay = sg[1] * k + oy;
    const bx = sg[2] * k + ox;
    const by = sg[3] * k + oy;
    return !(
      (ax < x0 && bx < x0) ||
      (ax > x1 && bx > x1) ||
      (ay < y0 && by < y0) ||
      (ay > y1 && by > y1)
    );
  };
  strokeBorders(
    g,
    borders,
    palette,
    (x, y) => {
      const px = x * k + ox;
      const py = y * k + oy;
      const [dx, dy] = livingOffset(px, py, frame, clock);
      return [px + dx, py + dy];
    },
    keep,
  );
}

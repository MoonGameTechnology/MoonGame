/**
 * Мост слоя карты для роботов (REFM-232). Выпечка, её холсты и кэш местности живут в
 * `src/mapLayer.ts`, а мост робота дописывается в `main.ts`, где их нет или они — импорты:
 * присвоить импорт нельзя. Плагин сборки дописывает в сам модуль `globalThis.__mapLayer` —
 * ручки к выпечке (её можно обернуть), к выпечке в фоне, к холсту готового кадра и к сбросу
 * поверхностей. Только в сборках роботов: игра собирается без плагина, и в ней этих ручек нет.
 */
import { readFileSync } from 'node:fs';

const BRIDGE = `
globalThis.__mapLayer = {
  get bakeMapLayer() { return bakeMapLayer; },
  set bakeMapLayer(fn) { bakeMapLayer = fn; },
  get startBakeJob() { return startBakeJob; },
  set startBakeJob(fn) { startBakeJob = fn; },
  get swapBakeJob() { return swapBakeJob; },
  set swapBakeJob(fn) { swapBakeJob = fn; },
  get bakeJob() { return bakeJob; },
  get terrainRefine() { return terrainRefine; },
  get mapLayerBakes() { return mapLayerBakes; },
  get mapLayerGeometry() { return mapLayerGeometry; },
  get mapLayerScroll() { return mapLayerScroll; },
  terrainRaster,
  bg,
  paintSky,
  paintMapLayer,
  showMapLayer,
  invalidateMapSurfaces,
};
`;

/** Плагин esbuild: `mapLayer.ts` с мостом в конце. */
export const mapLayerBridge = {
  name: 'map-layer-bridge',
  setup(build) {
    build.onLoad({ filter: /[\\/]mapLayer\.ts$/ }, ({ path }) => ({
      contents: readFileSync(path, 'utf8') + BRIDGE,
      loader: 'ts',
    }));
  },
};

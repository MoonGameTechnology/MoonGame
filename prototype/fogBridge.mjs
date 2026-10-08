/**
 * Мост тумана для роботов (REFM-231). Зрение кадра, его кэш и память разведки живут в
 * `src/mapFog.ts`, а мост робота дописывается в `main.ts`, где они — импорты: присвоить
 * импорт нельзя. Плагин сборки дописывает в сам модуль `globalThis.__fog` — ручки к
 * зрению, к пересчёту зрения и к окнам шпионажа. Только в сборках роботов: игра собирается
 * без плагина, и в ней этих ручек нет.
 */
import { readFileSync } from 'node:fs';

const BRIDGE = `
globalThis.__fog = {
  get vision() { return vision; },
  set vision(v) { vision = v; },
  get computeVision() { return computeVision; },
  set computeVision(fn) { computeVision = fn; },
  get intelFleetOwners() { return intelFleetOwners; },
  set intelFleetOwners(v) { intelFleetOwners = v; },
  scans,
  updateMemory,
};
`;

/** Плагин esbuild: `mapFog.ts` с мостом в конце. */
export const fogBridge = {
  name: 'fog-bridge',
  setup(build) {
    build.onLoad({ filter: /[\\/]mapFog\.ts$/ }, ({ path }) => ({
      contents: readFileSync(path, 'utf8') + BRIDGE,
      loader: 'ts',
    }));
  },
};

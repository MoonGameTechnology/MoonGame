/**
 * Что вердикт «слабое» может поменять сейчас (`decisions/mapSharpness.ts`, правила 3–6):
 * выборы игрока в «Графике» и то, что есть у устройства. Кадры судят устройство, пока
 * вердикту есть что менять.
 */
import { slowVerdictReach, type SlowVerdictReach } from '../../decisions/mapSharpness';
import { canvasCompatibilityChosen, canvasCompatibilitySupported } from './canvasCompatibility';
import { mapSharpChosen, motionChosen, reducedMotionAsked } from './graphicsPrefs';

export const slowVerdictReachNow = (screenDpr: number): SlowVerdictReach =>
  slowVerdictReach(
    screenDpr,
    mapSharpChosen(),
    motionChosen(),
    reducedMotionAsked(),
    canvasCompatibilityChosen(),
    canvasCompatibilitySupported(),
  );

/** A reversible software-preferred Canvas2D request, fixed for one page lifetime.
 * This does not detect or guarantee a browser's actual raster backend.
 *
 * Without the player's choice the slow-device verdict decides (`decisions/mapSharpness.ts`,
 * rule 6): the verdict is stored, so the next start asks for the mode from its first frame.
 */
import { canvasCompatible } from '../../decisions/mapSharpness';
import { mapSlowStored } from './graphicsPrefs';
import { readChoice, writeBool } from './prefs';

const KEY = 'void.canvasCompatibility';

/** The switch is in «Графика» on Android only: the mode was made for its WebView. */
const supported = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent ?? '');
let choice = readChoice(KEY);

/** What a start asks for with the storage as it is: the player's choice, else the stored verdict. */
const wanted = (): boolean => canvasCompatible(readChoice(KEY), mapSlowStored(), supported);

const active = wanted();

export const canvasCompatibilitySupported = (): boolean => supported;
export const canvasCompatibilityActive = (): boolean => active;
export const canvasCompatibilityRequested = (): boolean => wanted();
/** The player's choice; `null` — never chosen, the slow-device verdict decides. */
export const canvasCompatibilityChosen = (): boolean | null => choice;
export function setCanvasCompatibility(enabled: boolean): void {
  choice = enabled;
  writeBool(KEY, enabled);
}

/** Leave the ordinary path unspecified so browser heuristics remain unchanged. */
export function canvasCompatibilityOptions(): CanvasRenderingContext2DSettings | undefined {
  return active ? { willReadFrequently: true } : undefined;
}

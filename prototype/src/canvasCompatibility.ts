/** A reversible software-preferred Canvas2D request, fixed for one page lifetime.
 * This does not detect or guarantee a browser's actual raster backend.
 */
import { readBool, writeBool } from './prefs';

const KEY = 'void.canvasCompatibility';
const active = readBool(KEY, false);

export const canvasCompatibilityActive = (): boolean => active;
export const canvasCompatibilityRequested = (): boolean => readBool(KEY, active);
export function setCanvasCompatibility(enabled: boolean): void {
  writeBool(KEY, enabled);
}

/** Leave the ordinary path unspecified so browser heuristics remain unchanged. */
export function canvasCompatibilityOptions(): CanvasRenderingContext2DSettings | undefined {
  return active ? { willReadFrequently: true } : undefined;
}

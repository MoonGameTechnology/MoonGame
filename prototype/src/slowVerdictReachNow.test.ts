import { describe, expect, it, vi } from 'vitest';
import { slowVerdictReachNow } from './slowVerdictReachNow';

// vi.mock is hoisted above the import. Every choice answers differently, so a swapped
// argument changes the result.
vi.mock('./graphicsPrefs', () => ({
  mapSharpChosen: () => true,
  motionChosen: () => null,
  reducedMotionAsked: () => false,
}));
vi.mock('./canvasCompatibility', () => ({
  canvasCompatibilityChosen: () => null,
  canvasCompatibilitySupported: () => true,
}));

describe('slowVerdictReachNow', () => {
  it("hands each of the player's choices and the device to its own rule", () => {
    // Sharpness was chosen; motion and the rendering mode were not, and the mode has a switch.
    expect(slowVerdictReachNow(2)).toEqual({ sharp: false, motion: true, compat: true });
  });
});

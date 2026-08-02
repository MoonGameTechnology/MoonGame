/**
 * Wall-clock units of the prototype's GAME time, in ms (REFP-28). Extracted from
 * the `game.ts` facade so leaf modules (`economy.ts`, hosts, tests) import them
 * without touching the barrel — several extracted modules used to mirror the
 * literal locally just to avoid that reverse edge; this is the one shared home.
 */
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

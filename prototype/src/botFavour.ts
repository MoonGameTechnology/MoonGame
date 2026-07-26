/**
 * Bot favour (approval) scale — a bot's opinion of each other seat on a 0..100
 * meter, seeded neutral-friendly. Extracted from `game.ts` (REFP-6): pure functions
 * over `GameState` reading the prototype's `approval` extension field. `game.ts`
 * re-exports the constants and functions for `main.ts` / `botdiplomacy.test.ts`.
 */

/** Minimal view of the prototype's state extension for the approval meter. The full
 *  `DivState` lives with the division module; botFavour only reads `approval`. */
interface ApprovalState {
  approval?: Record<string, Record<string, number>>;
}

export const FAVOUR_BASE = 60; // starting favour toward every seat
export const FAVOUR_EMBARGO = 35; // below → the bot embargoes you on the market (future)
export const FAVOUR_WAR = 15; // below → the bot itself declares war (the extreme case)
// = FAVOUR_WAR: a bot too calm to start a war won't refuse to end one. One war
// declaration (60→30) leaves a ~3-day window to sue for peace before war decay
// (5/day) drops the meter below the line — then the bot fights to the end.
export const FAVOUR_PEACE_ACCEPT = 15;
export const FAVOUR_PACT_ACCEPT = 55; // an offered PACT needs real goodwill
export const FAVOUR_WAR_DECLARED_HIT = 30; // drop when a seat declares WAR on the bot
export const FAVOUR_SPY_CAUGHT_HIT = 20; // drop when the bot catches that seat's spy red-handed
export const FAVOUR_WAR_DECAY_PER_DAY = 5; // sustained war keeps eroding favour
export const FAVOUR_HEAL_PER_DAY = 6; // peace slowly mends it back toward FAVOUR_BASE

/** A bot's favour toward `player` (FAVOUR_BASE if untracked / not a bot). */
export function botFavour(state: { approval?: Record<string, Record<string, number>> }, bot: string, player: string): number {
  return (state as ApprovalState).approval?.[bot]?.[player] ?? FAVOUR_BASE;
}
/** Does `bot` embargo `player` on the market (favour below the embargo line)? */
export function botEmbargoes(state: { approval?: Record<string, Record<string, number>> }, bot: string, player: string): boolean {
  return (
    (state as ApprovalState).approval?.[bot] !== undefined &&
    botFavour(state, bot, player) < FAVOUR_EMBARGO
  );
}
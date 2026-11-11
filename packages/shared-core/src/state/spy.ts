import type { PlanetId } from './gameState';

/** An espionage operation a spy is sent on (SPY-8). `relocate` (SPY-23) only moves the
 *  spy to the world, where it waits for its next order. */
export type SpyOp =
  'relocate' | 'recon' | 'sabotage' | 'delay' | 'disrupt' | 'theft' | 'research' | 'counter';

/** What a spy is doing (SPY-23, owner's resolution 2026-11-10):
 *  - `rest` — at home in the capital, free;
 *  - `travel` — on the way to `location` for `op`;
 *  - `wait` — on `location`, free for the next order (arrived by `relocate`, or the
 *    operation could not start there on arrival);
 *  - `work` — on `location` doing `op` (until `arrivesAt`, or — `posted` — until cancelled);
 *  - `return` — on the way home to the capital `location`;
 *  - `recruit` — killed or turned; the replacement is found by `arrivesAt`;
 *  - `hidden` — «залёг на дно»: its civilisation has no capital, so it cannot work and
 *    cannot be caught; it heads for the capital as soon as there is one again. */
export type SpyState = 'rest' | 'travel' | 'wait' | 'work' | 'return' | 'recruit' | 'hidden';

/** One named spy of a player's network (`espionageModule`, SPY-23). */
export interface Spy {
  /** Stable among the player's spies (1..N); a replacement keeps the slot's id. */
  id: number;
  /** The slot's generation: grows by one with every replacement of a dead spy. */
  gen: number;
  state: SpyState;
  /** Where the spy is, or — `travel` / `return` — where it is heading. */
  location: PlanetId;
  /** Where a journey started (`travel` / `return`). */
  from?: PlanetId;
  /** World-time (ms) the current journey or deed started. */
  departedAt?: number;
  /** World-time (ms) the journey ends, the deed resolves, or the replacement arrives. */
  arrivesAt?: number;
  /** The operation it travels for or works at (kept on every leg of it). */
  op?: SpyOp;
  /** The order's id among the player's orders: every scheduled step carries it, so a
   *  step of a cancelled order finds nothing to do. */
  mission?: number;
  /** Working with no end: a recon or counter-intelligence agent on post (SPY-11/13). */
  posted?: true;
  /** World-time (ms) it took up its post. */
  postedAt?: number;
  /** A turned enemy agent of an older save (SPY-18): it serves its catcher until this
   *  world-time. New turned agents are offered instead (`SpyOffer`). */
  turnedUntil?: number;
  /** A defector the player took in (owner's resolution 2026-11-11): the player it came over
   *  from. It serves for good on top of the network, and its place is not refilled when it
   *  is lost. */
  defector?: string;
  /** Experience (the spy-levels module; absent = 0). Reset for a replacement. */
  xp?: number;
}

/** An enemy agent the player's counter-intelligence turned (SPY-18), waiting for the
 *  player's answer (owner's resolution 2026-11-11): taken in, it becomes one of the player's
 *  spies (`Spy.defector`); turned down — or left unanswered until `until` — it flees. For
 *  its old master it is dead either way, from the moment it was turned. */
export interface SpyOffer {
  /** Stable among the player's open offers. */
  id: number;
  /** The player it served. */
  from: string;
  /** Where it was caught. */
  planetId: PlanetId;
  /** What it was doing there: an operation, or `wait`. */
  kind: string;
  /** The experience it brings (absent = 0). */
  xp?: number;
  /** World-time (ms) it was turned. */
  at: number;
  /** World-time (ms) it flees if the player has not answered. */
  until: number;
}

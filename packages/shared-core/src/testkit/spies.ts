/**
 * Test-only helpers for the espionage tests (SPY-23). Not part of the runtime surface.
 *
 * Since spies fly to their target, every espionage test needs a map a spy can cross and a
 * capital to set out from. `spyMap` links every world with every other and makes each
 * player's first world (by id) their capital; `instantSpies` makes the journey take no time,
 * so a test about what happens ON a world keeps the old timings: the deed starts at the order
 * and resolves `MISSION_HOURS` later, and a spy on its way home is home at once.
 */
import type { GameModule } from '../kernel/module';
import type { GameState } from '../state/gameState';

/** Spies cover any distance at once (`espionage.speed` → effectively infinite). */
export const instantSpies: GameModule = {
  id: 'instant-spies',
  version: '1.0.0',
  setup(api) {
    api.hook<number>('espionage.speed', () => 1e15);
  },
};

/** `state` with every world linked to every other and each player's first world as capital
 *  (a capital already set stays). Every player knows whose each world is, as if their spies
 *  had reconnoitred it (`scouted`, SPY-24): a test about a deed is not a test about the fog —
 *  those build their state with `unscouted`. */
export function spyMap(state: GameState): GameState {
  const ids = Object.keys(state.planets).sort();
  const planets = Object.fromEntries(
    ids.map((id) => [id, { ...state.planets[id]!, links: ids.filter((other) => other !== id) }]),
  );
  const capital: Record<string, string> = { ...state.capital };
  for (const id of ids) {
    const owner = state.planets[id]!.owner;
    if (owner !== null && capital[owner] === undefined) capital[owner] = id;
  }
  return { ...state, planets, capital, scouted: scoutedAll({ ...state, planets }) };
}

/** Every player's record of every world's owner, as the worlds are held now (SPY-24). */
export function scoutedAll(state: GameState): NonNullable<GameState['scouted']> {
  const found = Object.fromEntries(
    Object.values(state.planets).map((p) => [p.id, { owner: p.owner, at: state.time }]),
  );
  return Object.fromEntries(Object.keys(state.players).map((id) => [id, { ...found }]));
}

/** `state` with no spy's record of any world: only sight tells whose a world is. */
export function unscouted(state: GameState): GameState {
  const { scouted: _gone, ...rest } = state;
  return rest;
}

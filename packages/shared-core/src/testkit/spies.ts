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
 *  (a capital already set stays). */
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
  return { ...state, planets, capital };
}

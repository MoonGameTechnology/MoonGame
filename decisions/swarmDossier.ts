import type { GameState } from '../packages/shared-core/src/index';
import { observedSwarm } from '../packages/shared-core/src/state/swarmIntel';

/** Caller supplies resolved sight, never coarse radar coverage. Hidden live fleets
 * must not influence either the remembered composition or its status. */
export function swarmDossier(state: GameState, viewer: string, identified: ReadonlySet<string>) {
  const current = observedSwarm(state, viewer, identified);
  const contacts = { ...state.swarmIntel?.[viewer], ...current };
  return Object.keys(contacts).sort().map(id => ({
    id, ...contacts[id]!, live: Object.hasOwn(current, id),
  }));
}

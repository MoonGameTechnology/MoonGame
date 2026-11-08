import {
  getStance,
  isActivelyBombarding,
  type Fleet,
  type GameData,
  type GameState,
} from '../packages/shared-core/src/index';
import { isOrdnanceFleet } from '../packages/shared-core/src/state/ordnance';

/** Presentation guard for the visible world. A network action catalogue only says
 * a command exists; it cannot tell whether this fleet has a valid target now.
 * Use the match's catalogue and the shared shelling predicate, never run today's
 * reducer over an older match. The server still decides every submitted order. */
export function bombardCommandAvailable(
  state: GameState,
  fleet: Fleet,
  viewer: string,
  data: GameData,
  on: boolean,
): boolean {
  if (
    fleet.owner !== viewer ||
    !fleet.location ||
    fleet.movement ||
    fleet.battleId ||
    fleet.assaultLanding ||
    isOrdnanceFleet(fleet, data)
  )
    return false;
  // Keep cancellation available even after the target changes owner or diplomacy.
  if (!on) return !!fleet.bombarding;
  if (fleet.bombarding || !fleet.units.some((stack) => stack.count > 0)) return false;
  return isActivelyBombarding(
    state,
    { ...fleet, bombarding: true },
    (a, b) => getStance(state, a, b) === 'war',
    data,
  );
}

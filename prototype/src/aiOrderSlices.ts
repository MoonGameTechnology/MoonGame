import type { Action } from '../../packages/shared-core/src/index';

/** Retreat must leave the sector before standing drivers can re-engage the fleet.
 * Keep this dependent pair in one slice (at most two orders); other orders yield.
 * No reordering and no change to the AI's planner or the authoritative reducer. */
export function aiOrderSlices(actions: Action[]): Action[][] {
  const slices: Action[][] = [];
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    const next = actions[i + 1];
    const pair =
      action.type === 'fleet.retreat' &&
      next?.type === 'fleet.move' &&
      action.playerId === next.playerId &&
      (action.payload as { fleetId?: string }).fleetId !== undefined &&
      (action.payload as { fleetId?: string }).fleetId ===
        (next.payload as { fleetId?: string }).fleetId;
    slices.push(pair ? [action, actions[++i]!] : [action]);
  }
  return slices;
}

/**
 * Browser side of the shared game-data loader (CP0.3). The fragment list itself lives
 * in `data/bundle.ts` — ONE copy for both browser consumers (this client and the
 * prototype), next to the data, the same way `localization/core.ts` is one runtime for
 * both. Re-exported here so this module stays the client's single door to game data.
 * Maps stay local: they are the client's own screens, not shared content.
 */
import { parseMatchMap, buildStateFromMap } from '@void/shared-core';
import type { GameData, GameState } from '@void/shared-core';

import { FRAGMENTS, shippedGameData } from '../../../data/bundle';
import skirmishMap from '../../../data/maps/skirmish-1.json';
import pveMap from '../../../data/maps/pve-1.json';

export { FRAGMENTS, shippedGameData };

/** A ready-to-render single-player `GameState` built from the shipped skirmish map. */
export function skirmishState(data: GameData): GameState {
  return buildStateFromMap(parseMatchMap(skirmishMap), data);
}

/** A ready-to-render PvE `GameState` built from the shipped PvE map. */
export function pveState(data: GameData): GameState {
  return buildStateFromMap(parseMatchMap(pveMap), data);
}

import type { Context } from '../../packages/shared-core/src/action/types';
import type { GameData } from '../../packages/shared-core/src/data/schemas';

/** Create a pre-upgrade saved station; all subsequent assertions run against the
 * current shipped catalogue, exercising the retained legacy compatibility path. */
export function legacyFortressDeploymentContext(now: number, data: GameData): Context {
  return { now, data: { ...data, sectorKinds: Object.fromEntries(
    Object.entries(data.sectorKinds).filter(([kind]) => kind !== 'station_site'),
  ) } };
}

import {
  buildingLevel,
  buildingMaxLevel,
  unitBuildSiteBlocker,
  unitYardLevelBlocker,
  type GameData,
  type GameState,
  type Planet,
} from '../packages/shared-core/src/index';
import { feedsOnBiomass } from '../packages/shared-core/src/util/infestation';
import { canBuildHere } from './buildGate';
import { techNeed, type TechNeed } from './techNeed';

export interface FacilityOffer {
  building: string;
  level: number;
}
export interface ProductionRequirements {
  technology: TechNeed | null;
  facilityCode: string | null;
  facilities: FacilityOffer[];
}

/** Query the same facility gates as unit.build against an isolated catalog instance.
 * No table of unit IDs/capabilities is maintained by the UI. */
export function facilityLevel(
  data: GameData,
  planet: Planet,
  building: string,
  unit: string,
): number | null {
  const def = data.buildings[building];
  const target = data.units[unit];
  if (!def || !target) return null;
  for (let level = 1; level <= buildingMaxLevel(def); level++) {
    const candidate = {
      ...planet,
      buildings: [{ type: building, level, hp: buildingLevel(def, level).hp }],
    };
    if (
      !unitBuildSiteBlocker(candidate, target, data) &&
      !unitYardLevelBlocker(candidate, target, data)
    )
      return level;
  }
  return null;
}

/** Reasons may coexist: completing research must not hide a missing facility. */
export function productionRequirements(
  state: GameState,
  me: string,
  planetId: string,
  data: GameData,
  kind: 'building' | 'unit',
  id: string,
): ProductionRequirements {
  const result: ProductionRequirements = {
    technology: techNeed(state, me, data, kind, id),
    facilityCode: null,
    facilities: [],
  };
  const planet = state.planets[planetId];
  const unit = kind === 'unit' ? data.units[id] : undefined;
  if (!planet || planet.owner !== me || !unit) return result;
  result.facilityCode =
    unitBuildSiteBlocker(planet, unit, data) ?? unitYardLevelBlocker(planet, unit, data);
  if (!result.facilityCode) return result;
  for (const building of Object.keys(data.buildings)) {
    if (!canBuildHere(planet, building, data, feedsOnBiomass(state, me, data))) continue;
    const level = facilityLevel(data, planet, building, id);
    if (level !== null) result.facilities.push({ building, level });
  }
  return result;
}

import type { GameData, RocketMineDef } from '../data/schemas';
import type { Fleet, FleetEdge, RoadPoint } from './gameState';
import { defHasTrait } from '../data/traits';
import { MINE_TRAIT } from './minefields';
import { moduleStarMultiplier } from '../util/loadout';

export type RocketMineMode = 'any' | 'confirmed';

/** Юнит ракетной мины (SM-3.7a): стоящая мина — отряд во `fleets`, как обычная (SM-3.6). */
export const ROCKET_MINE_UNIT = 'rocket_mine';
/** Трейт, по которому ядро отличает ракетную мину от контактной. У юнита есть и `mine`:
 *  правила мины-отряда (без приказов, не воюет, видна только вблизи) он получает от него. */
export const ROCKET_MINE_TRAIT = 'rocketMine';

/** Private controls of a standing mine, by its fleet id. Absent in an opponent's
 *  projection: the mine itself is visible up close, its doctrine and warhead never. */
export interface RocketMineControl {
  mode: RocketMineMode;
  nextScanAt?: number;
  /** Warhead strength is fixed when the charge is installed. */
  damage: number;
}
export interface MineInstallation {
  id: string;
  owner: string;
  moduleId: string;
  position: RoadPoint;
  mode: RocketMineMode;
  damage: number;
  fleetId: string;
  edge: FleetEdge;
  startedAt: number;
  readyAt: number;
}
export interface MineMissile {
  id: string;
  owner: string;
  moduleId: string;
  from: RoadPoint;
  to: RoadPoint;
  launchedAt: number;
  arrivesAt: number;
  damage?: number;
  hp?: number;
}
export interface OrdnanceState {
  serials: Record<string, number>;
  cooldowns: Record<string, number>;
  installations: MineInstallation[];
  /** Standing mines' controls, by mine fleet id (SM-3.7a). Absent in a world saved before
   *  SM-3.7a (a Sector Zero run snapshot outlives updates): read it as empty. */
  controls?: Record<string, RocketMineControl>;
  missiles: MineMissile[];
}
export function emptyOrdnance(): OrdnanceState {
  return { serials: {}, cooldowns: {}, installations: [], controls: {}, missiles: [] };
}
export function inRadius(a: RoadPoint, b: RoadPoint, radius: number): boolean {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= radius * radius;
}
/** The legendary module that lets a ship lay a rocket mine. A mine is never a layer:
 *  the mine's own stack carries the module too, but a mine takes no orders. */
export function rocketMinelayer(
  fleet: Pick<Fleet, 'units'>,
  data: GameData,
): { id: string; def: RocketMineDef } | null {
  for (const stack of fleet.units) {
    const unit = data.units[stack.unit];
    if (stack.count <= 0 || unit?.domain !== 'space' || defHasTrait(unit, MINE_TRAIT)) continue;
    for (const id of stack.modules ?? []) {
      const mod = data.modules[id];
      if (mod?.rocketMine && mod.rarity === 'legendary')
        return {
          id,
          def: {
            ...mod.rocketMine,
            damage:
              mod.rocketMine.damage * moduleStarMultiplier(stack.moduleStars?.[id] ?? 0, data),
          },
        };
    }
  }
  return null;
}
/** Ракетная мина ли отряд: в нём живы только ракетные мины (как `isMineFleet`). */
export function isRocketMineFleet(fleet: Pick<Fleet, 'units'>, data: GameData): boolean {
  const live = fleet.units.filter((s) => s.count > 0);
  return live.length > 0 && live.every((s) => defHasTrait(data.units[s.unit], ROCKET_MINE_TRAIT));
}
/** The module a standing rocket mine was laid with — its sight, radar and flight. */
export function rocketMineModule(
  fleet: Pick<Fleet, 'units'>,
  data: GameData,
): { id: string; def: RocketMineDef } | null {
  if (!isRocketMineFleet(fleet, data)) return null;
  for (const stack of fleet.units) {
    if (stack.count <= 0) continue;
    for (const id of stack.modules ?? []) {
      const def = data.modules[id]?.rocketMine;
      if (def) return { id, def };
    }
  }
  return null;
}
export function missilePositionAt(m: MineMissile, now: number): RoadPoint {
  const t = Math.max(0, Math.min(1, (now - m.launchedAt) / (m.arrivesAt - m.launchedAt)));
  return { x: m.from.x + (m.to.x - m.from.x) * t, y: m.from.y + (m.to.y - m.from.y) * t };
}

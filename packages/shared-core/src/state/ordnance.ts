import type { GameData, RocketMineDef } from '../data/schemas';
import type { Fleet, FleetEdge, GameState, RoadPoint } from './gameState';
import { fleetPositionAt } from './fleetPosition';
import { moduleStarMultiplier } from '../util/loadout';

export type RocketMineMode = 'any' | 'confirmed';
export interface RocketMine {
  id: string;
  owner: string;
  moduleId: string;
  position: RoadPoint;
  /** Private controls are absent in an opponent's projection. */
  mode?: RocketMineMode;
  nextScanAt?: number;
  /** Warhead strength is fixed when the charge is installed. */
  damage?: number;
}
export interface MineInstallation extends RocketMine {
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
  mines: RocketMine[];
  missiles: MineMissile[];
}
export function emptyOrdnance(): OrdnanceState {
  return { serials: {}, cooldowns: {}, installations: [], mines: [], missiles: [] };
}
export function inRadius(a: RoadPoint, b: RoadPoint, radius: number): boolean {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= radius * radius;
}
export function rocketMinelayer(
  fleet: Pick<Fleet, 'units'>,
  data: GameData,
): { id: string; def: RocketMineDef } | null {
  for (const stack of fleet.units) {
    if (stack.count <= 0 || data.units[stack.unit]?.domain !== 'space') continue;
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
export function missilePositionAt(m: MineMissile, now: number): RoadPoint {
  const t = Math.max(0, Math.min(1, (now - m.launchedAt) / (m.arrivesAt - m.launchedAt)));
  return { x: m.from.x + (m.to.x - m.from.x) * t, y: m.from.y + (m.to.y - m.from.y) * t };
}
/** Physical proximity, never identification of a whole province or dossier memory. */
export function mineVisibleTo(
  state: GameState,
  mine: RocketMine,
  viewer: string,
  data: GameData,
): boolean {
  if (mine.owner === viewer) return true;
  const reach = data.modules[mine.moduleId]?.rocketMine?.detectionRange;
  if (!reach) return false;
  return Object.values(state.fleets).some((f) => {
    if (f.owner !== viewer || !f.units.some((s) => s.count > 0)) return false;
    const at = fleetPositionAt(state, f, state.time);
    return at !== null && inRadius(at, mine.position, reach);
  });
}

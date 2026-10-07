import type { GameData, RocketMineDef } from '../data/schemas';
import type { Fleet, FleetEdge, RoadPoint } from './gameState';
import { defHasTrait } from '../data/traits';
import { isMineFleet, isMissileFleet, MINE_TRAIT } from './minefields';
import { moduleStarMultiplier } from '../util/loadout';

export type RocketMineMode = 'any' | 'confirmed';

/** Юнит ракетной мины (SM-3.7a): стоящая мина — отряд во `fleets`, как обычная (SM-3.6). */
export const ROCKET_MINE_UNIT = 'rocket_mine';
/** Трейт, по которому ядро отличает ракетную мину от контактной. У юнита есть и `mine`:
 *  правила мины-отряда (без приказов, не воюет, видна только вблизи) он получает от него. */
export const ROCKET_MINE_TRAIT = 'rocketMine';
/** Юнит ракеты (SM-3.7b): летящая ракета — отряд без приказов, летит по прямой
 *  (`Fleet.flight`). Корпус и сигнатура — у юнита, скорость и боевая часть — у модуля. */
export const MISSILE_UNIT = 'missile';
// Трейт и признак ракеты живут в `minefields.ts`: глазам мины надо отличать ракету, а этот
// файл сам импортирует тот — обратный импорт замкнул бы круг.
export { isMissileFleet, MISSILE_TRAIT } from './minefields';

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
export interface OrdnanceState {
  serials: Record<string, number>;
  cooldowns: Record<string, number>;
  installations: MineInstallation[];
  /** Standing mines' controls, by mine fleet id (SM-3.7a). Absent in a world saved before
   *  SM-3.7a (a Sector Zero run snapshot outlives updates): read it as empty. */
  controls?: Record<string, RocketMineControl>;
  /** A flying missile's warhead, by its fleet id (SM-3.7b): fixed at launch, seen by its
   *  owner only — the missile itself is a fleet and passes the ordinary fog. A world saved
   *  before SM-3.7b keeps its old `missiles` list, which nothing reads any more. */
  warheads?: Record<string, number>;
}
export function emptyOrdnance(): OrdnanceState {
  return { serials: {}, cooldowns: {}, installations: [], controls: {}, warheads: {} };
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
/** Боеприпас ли отряд — мина или ракета: отряд без приказов, не воюет, не держит игрока в
 *  живых. Свои правила тумана у каждого: мину видно только вблизи, ракету — обычным. */
export function isOrdnanceFleet(fleet: Pick<Fleet, 'units'>, data: GameData): boolean {
  return isMineFleet(fleet, data) || isMissileFleet(fleet, data);
}
/** The module a missile was launched with — its speed, warhead and blast. */
export function missileModule(
  fleet: Pick<Fleet, 'units'>,
  data: GameData,
): { id: string; def: RocketMineDef } | null {
  if (!isMissileFleet(fleet, data)) return null;
  for (const stack of fleet.units) {
    if (stack.count <= 0) continue;
    for (const id of stack.modules ?? []) {
      const def = data.modules[id]?.rocketMine;
      if (def) return { id, def };
    }
  }
  return null;
}

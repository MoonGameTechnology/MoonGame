/** Cargo occupancy, shared by map badges and fleet cards. Ground cargo and shuttles
 * share ONE hold (SHU-5.1): each meter shows its own share, and its capacity is the
 * hold minus what the other share already occupies, so both read the same free space. Loading reserves its whole volume until the snapshot
 * moves it aboard; animation progress never changes custody or free space. */
import {
  fleetShuttleBay,
  hangarSize,
  sumUnitStat,
  type Fleet,
  type GameData,
} from '../packages/shared-core/src/index';

export interface FleetHold {
  kind: 'troops' | 'hangar';
  used: number;
  capacity: number;
  reserved: number;
  free: number;
  over: number;
  usedFraction: number;
  reservedFraction: number;
  /** Volume-weighted progress of the active ground lifts, 0..1. */
  loadingProgress: number;
}

const clamp = (n: number): number => Math.max(0, Math.min(1, n));

function hold(
  kind: FleetHold['kind'],
  used: number,
  capacity: number,
  reserved = 0,
  loadingProgress = 0,
): FleetHold {
  const usedFraction = capacity > 0 ? clamp(used / capacity) : used > 0 ? 1 : 0;
  return {
    kind,
    used,
    capacity,
    reserved,
    loadingProgress,
    free: Math.max(0, capacity - used - reserved),
    over: Math.max(0, used + reserved - capacity),
    usedFraction,
    reservedFraction: capacity > 0 ? Math.min(1 - usedFraction, reserved / capacity) : 0,
  };
}

export function fleetHolds(fleet: Fleet, data: GameData, now: number): FleetHold[] {
  const capacity = sumUnitStat(fleet.units, data, 'cargoCapacity');
  const used = sumUnitStat(fleet.landing ?? [], data, 'cargoSize');
  let reserved = 0;
  let progressed = 0;
  for (const claim of fleet.loading ?? []) {
    const volume = claim.count * (data.units[claim.unit]?.stats.cargoSize ?? 1);
    const duration = claim.doneAt - claim.startAt;
    const progress =
      duration > 0 ? clamp((now - claim.startAt) / duration) : Number(now >= claim.doneAt);
    reserved += volume;
    progressed += volume * progress;
  }
  const machines = hangarSize(fleet, data);
  const meters: FleetHold[] = [];
  if (capacity > 0 || used > 0 || reserved > 0)
    meters.push(
      hold(
        'troops',
        used,
        Math.max(0, capacity - machines),
        reserved,
        reserved > 0 ? progressed / reserved : 0,
      ),
    );
  if (machines > 0) meters.push(hold('hangar', machines, fleetShuttleBay(fleet, data)));
  return meters;
}

/** Screen-aligned badge outside a parked fleet's orbit. In transit it stays below
 * the ship, so turning never rotates the readings or flips them across the ship. */
export function holdBadgePosition(
  anchor: { x: number; y: number },
  planet: { x: number; y: number } | null,
  width: number,
  height: number,
): { x: number; y: number } {
  const dx = planet ? anchor.x - planet.x : 0;
  const dy = planet ? anchor.y - planet.y : 1;
  const length = Math.hypot(dx, dy);
  const nx = length > 0 ? dx / length : 0;
  const ny = length > 0 ? dy / length : 1;
  // The nearest corner stays beyond the ship, even on a narrow orbit.
  const distance = 18 + (Math.abs(nx) * width) / 2 + (Math.abs(ny) * height) / 2;
  return { x: anchor.x + nx * distance - width / 2, y: anchor.y + ny * distance - height / 2 };
}

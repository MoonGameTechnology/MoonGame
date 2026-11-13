/** Cargo occupancy, shared by map badges and fleet cards. Ground cargo and shuttles
 * share ONE hold (SHU-5.1): each meter shows its own share, and its capacity is the
 * hold minus what the other share already occupies, so both read the same free space. Loading reserves its whole volume until the snapshot
 * moves it aboard; animation progress never changes custody or free space. Unloading is
 * the mirror: the troops going ashore stay in `used` until the snapshot moves them out. */
import {
  fleetHoldFree,
  fleetShuttleBay,
  hangarSize,
  sumUnitStat,
  type Fleet,
  type GameData,
  type GameState,
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
  /** The active ground lifts — progress at any moment is {@link holdProgress}. */
  loadingWindows: readonly HoldWindow[];
  /** Volume already going ashore (`fleet.unloading`) — still aboard, so part of `used`. */
  unloading: number;
  /** The active disembarkations — progress at any moment is {@link holdProgress}. */
  unloadingWindows: readonly HoldWindow[];
}

/** One timed lift: its window and the volume it moves. The meter carries windows rather
 *  than a progress figure, because a figure would change the card's markup with every
 *  tick of the clock and rebuild the card under the cursor; the card patches it live. */
export interface HoldWindow {
  startAt: number;
  doneAt: number;
  volume: number;
}

const clamp = (n: number): number => Math.max(0, Math.min(1, n));

/** Progress of a timed claim at `now`, 0..1; a zero-length window is done at its end. */
function windowProgress(claim: { startAt: number; doneAt: number }, now: number): number {
  const duration = claim.doneAt - claim.startAt;
  return duration > 0 ? clamp((now - claim.startAt) / duration) : Number(now >= claim.doneAt);
}

/** Volume-weighted progress of the lifts at `now`, 0..1; no lifts → 0. */
export function holdProgress(windows: readonly HoldWindow[], now: number): number {
  let total = 0;
  let done = 0;
  for (const w of windows) {
    total += w.volume;
    done += w.volume * windowProgress(w, now);
  }
  return total > 0 ? done / total : 0;
}

function hold(
  kind: FleetHold['kind'],
  used: number,
  capacity: number,
  reserved = 0,
  loadingWindows: readonly HoldWindow[] = [],
  unloading = 0,
  unloadingWindows: readonly HoldWindow[] = [],
): FleetHold {
  const usedFraction = capacity > 0 ? clamp(used / capacity) : used > 0 ? 1 : 0;
  return {
    kind,
    used,
    capacity,
    reserved,
    loadingWindows,
    unloading,
    unloadingWindows,
    free: Math.max(0, capacity - used - reserved),
    over: Math.max(0, used + reserved - capacity),
    usedFraction,
    reservedFraction: capacity > 0 ? Math.min(1 - usedFraction, reserved / capacity) : 0,
  };
}

/** Places held by the fleet's squadrons that are OUT on a sortie (SHU-5.1): the hull
 * keeps them for the return, so they are neither aboard nor free. Derived from the
 * core's own `fleetHoldFree`, the number both load orders are measured against. */
export function fleetAloftPlaces(state: GameState, fleet: Fleet, data: GameData): number {
  return Math.max(
    0,
    fleetShuttleBay(fleet, data) - hangarSize(fleet, data) - fleetHoldFree(state, fleet, data),
  );
}

/** Places the fleet's shuttles take in the shared hold (SHU-5.1): those in the hangar
 * plus those out on a sortie. A split leaves them all with the fleet that keeps its name,
 * which is what the core checks the kept half against. */
export function fleetMachinePlaces(state: GameState, fleet: Fleet, data: GameData): number {
  return hangarSize(fleet, data) + fleetAloftPlaces(state, fleet, data);
}

/** A timed lift as the fleet stores it (`loading` and `unloading` claims). */
type LiftClaim = { unit: string; count: number; startAt: number; doneAt: number };

/** `aloft` — places of squadrons out on a sortie (`fleetAloftPlaces`): they count as
 * shuttle places, so the troops meter never offers space the core would refuse. The meter
 * does not read the clock: lifts come as windows, and their progress is
 * {@link holdProgress} at the moment the reader shows it. */
export function fleetHolds(fleet: Fleet, data: GameData, aloft = 0): FleetHold[] {
  const capacity = sumUnitStat(fleet.units, data, 'cargoCapacity');
  const used = sumUnitStat(fleet.landing ?? [], data, 'cargoSize');
  const windows = (claims: readonly LiftClaim[] | undefined): HoldWindow[] =>
    (claims ?? []).map((c) => ({
      startAt: c.startAt,
      doneAt: c.doneAt,
      volume: c.count * (data.units[c.unit]?.stats.cargoSize ?? 1),
    }));
  const loading = windows(fleet.loading);
  const reserved = loading.reduce((n, w) => n + w.volume, 0);
  // Выгрузка идёт по таймеру, как погрузка (MSB-9): объём ещё на борту, прогресс — тот же.
  const unloading = windows(fleet.unloading);
  const leaving = unloading.reduce((n, w) => n + w.volume, 0);
  const machines = hangarSize(fleet, data) + aloft;
  const meters: FleetHold[] = [];
  if (capacity > 0 || used > 0 || reserved > 0)
    meters.push(
      hold(
        'troops',
        used,
        Math.max(0, capacity - machines),
        reserved,
        loading,
        leaving,
        unloading,
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

import type { GameData } from '../data/schemas';
import type { Fleet, PlanetId } from './gameState';

export const SIG_MEDIUM = 5;
export const SIG_LARGE = 13;
/** Maximum distance from a group's anchor, in map units. No transitive chaining. */
export const SIGNAL_CLUSTER_RADIUS = 40;
export type SignatureSize = 'S' | 'M' | 'L';

export interface SignatureContact {
  location: PlanetId;
  size: SignatureSize;
  /** Present for an in-transit contact; no fleet id, owner or composition. */
  position?: { x: number; y: number };
}

export function signatureSize(strength: number): SignatureSize {
  return strength >= SIG_LARGE ? 'L' : strength >= SIG_MEDIUM ? 'M' : 'S';
}

/** Base hull emissions stay unchanged when ships form or leave a group. */
export function fleetSignalStrength(fleet: Pick<Fleet, 'units'>, data: GameData): number {
  let strength = 0;
  for (const stack of fleet.units) {
    if (stack.count > 0) strength += stack.count * (data.units[stack.unit]?.signature ?? 1);
  }
  return strength;
}

export function radarThreshold(level: number): number {
  return level >= 3 ? 0 : level >= 2 ? SIG_MEDIUM : SIG_LARGE;
}

export interface RadarSource {
  x: number;
  y: number;
  range: number;
  level: number;
}

export interface SignalEmitter {
  location: PlanetId;
  x: number;
  y: number;
  strength: number;
  /** The actual position differs from the public node that anchors the blip. */
  inTransit?: boolean;
}

function within(a: { x: number; y: number }, b: { x: number; y: number }, radius: number): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy <= radius * radius;
}

/** Groups are anchored within 40 units; a chain cannot connect distant fleets. */
function groupSignals(ordered: readonly SignalEmitter[]): SignalEmitter[][] {
  const groups: SignalEmitter[][] = [];
  const cells = new Map<string, number[]>();
  for (const emitter of ordered) {
    const gx = Math.floor(emitter.x / SIGNAL_CLUSTER_RADIUS);
    const gy = Math.floor(emitter.y / SIGNAL_CLUSTER_RADIUS);
    let index = groups.length;
    for (let x = gx - 1; x <= gx + 1; x++) {
      for (let y = gy - 1; y <= gy + 1; y++) {
        for (const candidate of cells.get(`${x}:${y}`) ?? []) {
          if (candidate < index && within(emitter, groups[candidate]![0]!, SIGNAL_CLUSTER_RADIUS))
            index = candidate;
        }
      }
    }
    if (index === groups.length) {
      groups.push([]);
      const key = `${gx}:${gy}`;
      const cell = cells.get(key) ?? [];
      cell.push(index);
      cells.set(key, cell);
    }
    groups[index]!.push(emitter);
  }
  return groups;
}

function compareSignals(a: SignalEmitter, b: SignalEmitter): number {
  return (
    a.x - b.x ||
    a.y - b.y ||
    (a.location < b.location ? -1 : a.location > b.location ? 1 : 0) ||
    a.strength - b.strength
  );
}

/** Each radar groups only emissions in its own range and applies its own sensitivity.
 * Adding a sensor cannot repartition what an existing sensor detects. Shared contacts
 * merge only AFTER detection; their strength is the strongest reading, never a sum. */
export function detectSignals(
  emitters: readonly SignalEmitter[],
  sources: readonly RadarSource[],
): SignatureContact[] {
  const ordered = emitters.filter((e) => e.strength > 0).sort(compareSignals);
  // Co-located/overlapping radars often report the same anchor; retain its best reading.
  const readings = new Map<SignalEmitter, number>();
  for (const source of sources) {
    // Increasing reach appends farther emissions, preserving all nearer groups.
    const distance = (e: SignalEmitter): number => (e.x - source.x) ** 2 + (e.y - source.y) ** 2;
    const local = ordered
      .filter((e) => within(e, source, source.range))
      .sort((a, b) => distance(a) - distance(b) || compareSignals(a, b));
    const groups = groupSignals(local);
    for (const group of groups) {
      const strength = group.reduce((sum, e) => sum + e.strength, 0);
      const anchor = group.reduce((first, e) => (compareSignals(e, first) < 0 ? e : first));
      if (strength >= radarThreshold(source.level) && strength > (readings.get(anchor) ?? 0))
        readings.set(anchor, strength);
    }
  }
  const resolved = [...readings].map(([anchor, strength]) => ({ ...anchor, strength }));
  return groupSignals(resolved.sort(compareSignals))
    .map((group) => {
      const strongest = group.reduce((best, e) => (e.strength > best.strength ? e : best));
      const contact: SignatureContact = {
        location: strongest.location,
        size: signatureSize(strongest.strength),
      };
      if (strongest.inTransit) contact.position = { x: strongest.x, y: strongest.y };
      return contact;
    })
    .sort((a, b) => (a.location < b.location ? -1 : a.location > b.location ? 1 : 0));
}

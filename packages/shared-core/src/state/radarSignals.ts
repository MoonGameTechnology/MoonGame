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

/** Coarse contacts over nearby emitters. Each sensor keeps its own reach AND quality:
 * a short sensitive dish cannot lend its sensitivity to a distant basic dish.
 * Only emissions inside that sensor's range contribute to what it detects. */
export function detectSignals(
  emitters: readonly SignalEmitter[],
  sources: readonly RadarSource[],
): SignatureContact[] {
  const sensors = [...sources].sort(
    (a, b) => a.x - b.x || a.y - b.y || a.range - b.range || a.level - b.level,
  );
  const ordered = emitters
    .filter((e) => e.strength > 0 && sources.some((s) => within(e, s, s.range)))
    .sort(
      (a, b) =>
        a.x - b.x ||
        a.y - b.y ||
        (a.location < b.location ? -1 : a.location > b.location ? 1 : 0) ||
        a.strength - b.strength,
    );
  const groups: SignalEmitter[][] = [];
  // Local grid avoids scanning every existing group for every ship on large maps.
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
  const contacts: SignatureContact[] = [];
  for (const group of groups) {
    let strongest = 0;
    let anchor: SignalEmitter | undefined;
    for (const source of sensors) {
      let strength = 0;
      let first: SignalEmitter | undefined;
      for (const e of group) {
        if (!within(e, source, source.range)) continue;
        strength += e.strength;
        first ??= e;
      }
      if (strength > strongest && strength >= radarThreshold(source.level)) {
        strongest = strength;
        anchor = first;
      }
    }
    if (!anchor) continue;
    const contact: SignatureContact = { location: anchor.location, size: signatureSize(strongest) };
    if (anchor.inTransit) contact.position = { x: anchor.x, y: anchor.y };
    contacts.push(contact);
  }
  return contacts.sort((a, b) => (a.location < b.location ? -1 : a.location > b.location ? 1 : 0));
}

/** A phone tap stages an address, never screen coordinates or an already-sent action. */
export type MobileOrderKind = 'move' | 'assault' | 'engage' | 'merge';
export type MobileOrderTarget =
  | { kind: 'planet'; id: string }
  | { kind: 'fleet'; id: string }
  | { kind: 'lane'; from: string; to: string; t: number };
export interface MobileOrderDraft {
  order: MobileOrderKind;
  fleetIds: string[];
  target: MobileOrderTarget;
}

/** A new selection/mode must never inherit the previous fleet's unsent target. */
export function mobileDraftMatches(
  draft: MobileOrderDraft | null,
  order: MobileOrderKind | null,
  fleetIds: readonly string[],
): draft is MobileOrderDraft {
  return (
    !!draft &&
    draft.order === order &&
    fleetIds.length > 0 &&
    draft.fleetIds.length === fleetIds.length &&
    fleetIds.every((id) => draft.fleetIds.includes(id))
  );
}

interface Point {
  x: number;
  y: number;
}

/** Reproject the same address after camera motion; a fleet target may itself move. */
export function mobileTargetPoint(
  target: MobileOrderTarget,
  planet: (id: string) => Point | null,
  fleet: (id: string) => Point | null,
): Point | null {
  if (target.kind === 'planet') return planet(target.id);
  if (target.kind === 'fleet') return fleet(target.id);
  const a = planet(target.from),
    b = planet(target.to);
  if (!a || !b) return null;
  return { x: a.x + (b.x - a.x) * target.t, y: a.y + (b.y - a.y) * target.t };
}

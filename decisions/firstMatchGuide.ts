/** Progress facts for the bot-free duel-1 lesson. Count hulls, not fleet records:
 * construction can join an existing fleet. Only the named destination counts. */
import type { GameState } from '../packages/shared-core/src/index';

export const GUIDE_TARGET = 'shale';
export const GUIDE_MAP = 'duel-1';
export const GUIDE_HULL = 'frigate';
export const GUIDE_TECH = 'frigate_design';

export function guideShipCount(s: GameState, me: string): number {
  return Object.values(s.fleets)
    .filter((f) => f.owner === me)
    .reduce(
      (n, f) => n + f.units.reduce((sum, u) => sum + (u.unit === GUIDE_HULL ? u.count : 0), 0),
      0,
    );
}

export function guideFleet(s: GameState, me: string) {
  return Object.values(s.fleets).find(
    (f) => f.owner === me && f.units.some((u) => u.unit === GUIDE_HULL && u.count > 0),
  );
}

export function guideMineLevel(s: GameState, home: string): number {
  return s.planets[home]?.buildings.find((b) => b.type === 'mine')?.level ?? 0;
}

export function guideCourseSet(s: GameState, me: string): boolean {
  const fleet = guideFleet(s, me);
  return (
    !!fleet &&
    (fleet.location === GUIDE_TARGET ||
      (fleet.movement?.destination ?? fleet.movement?.to) === GUIDE_TARGET)
  );
}

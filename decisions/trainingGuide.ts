/** Live recipients of Sector Zero exercises. Fleet identities can change on auto-merge. */
import type { Fleet, GameState } from '../packages/shared-core/src/index';

export type TrainingFleetRole = 'hero' | 'support' | 'carrier';

/** Put the expedition flagship with the prepared assault force, keeping the second
 * fleet and carrier separate for their exercises. The host applies this as a merge order. */
export function trainingFlagshipMerge(
  s: GameState,
  me: string,
): { from: string; into: string } | null {
  const hero = trainingFleet(s, me, 'hero');
  const force = s.fleets.p1_1;
  return hero &&
    force &&
    force.owner === me &&
    hero.id !== force.id &&
    hero.location &&
    hero.location === force.location &&
    !hero.movement &&
    !force.movement &&
    !hero.battleId &&
    !force.battleId
    ? { from: hero.id, into: force.id }
    : null;
}

export function trainingFleet(s: GameState, me: string, role: TrainingFleetRole): Fleet | null {
  const mine = Object.values(s.fleets).filter(
    (f) => f.owner === me && f.units.some((u) => u.count > 0),
  );
  const hero = Object.values(s.heroes ?? {}).find((h) => h.owner === me && h.alive)?.fleetId;
  if (role === 'hero') return mine.find((f) => f.id === hero) ?? null;
  if (role === 'carrier')
    return (
      mine.find((f) => (f.hangar ?? []).some((sq) => sq.units.some((u) => u.count > 0))) ?? null
    );
  return (
    mine.find((f) => f.id === 'p1_2') ??
    mine.find((f) => f.id !== hero && f.units.some((u) => u.unit === 'cruiser' && u.count > 0)) ??
    null
  );
}

export const trainingGridDone = (s: GameState, me: string): boolean =>
  s.players[me]?.technologies?.completed.includes('orbital_defense_grid') === true;

export const trainingCourse = (f: Fleet | null | undefined, to: string): boolean =>
  !!f && (f.movement ? (f.movement.destination ?? f.movement.to) === to : f.location === to);

export const trainingTroopsReady = (f: Fleet | null | undefined, heavy: number): boolean =>
  (f?.landing ?? []).reduce((n, u) => n + (u.unit === 'heavy_infantry' ? u.count : 0), 0) >= heavy;

/** Recruitment already ordered, including the active job and the waiting queue. */
export function trainingRecruits(s: GameState, me: string): number {
  const p = s.planets.base;
  if (p?.owner !== me) return 0;
  const done = (p.garrison ?? []).reduce(
    (n, u) => n + (u.unit === 'heavy_infantry' ? u.count : 0),
    0,
  );
  const queued = (p.buildQueue ?? []).filter(
    (q) => q.playerId === me && q.unit === 'heavy_infantry',
  );
  const active = s.scheduled
    .filter((e) => e.type === 'construction.complete')
    .map(
      (e) => e.payload as { planetId?: string; playerId?: string; unit?: string; count?: number },
    )
    .filter((q) => q.planetId === 'base' && q.playerId === me && q.unit === 'heavy_infantry');
  return done + [...queued, ...active].reduce((n, q) => n + (q.count ?? 1), 0);
}

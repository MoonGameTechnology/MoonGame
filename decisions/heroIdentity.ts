/** Presentation identities, separate from the simulated archetypes and their balance. */
import type { GameState, Hero } from '../packages/shared-core/src/index';

export const HERO_IDENTITIES = {
  commander: { cell: 0, name: 'hero.person.commander.name', bio: 'hero.person.commander.bio' },
  ravager: { cell: 1, name: 'hero.person.ravager.name', bio: 'hero.person.ravager.bio' },
  vanguard: { cell: 2, name: 'hero.person.vanguard.name', bio: 'hero.person.vanguard.bio' },
  warden: { cell: 3, name: 'hero.person.warden.name', bio: 'hero.person.warden.bio' },
} as const;

export function heroIdentity(archetype: string | undefined) {
  return archetype && Object.hasOwn(HERO_IDENTITIES, archetype)
    ? HERO_IDENTITIES[archetype as keyof typeof HERO_IDENTITIES]
    : undefined;
}

/** Solo hosts hold full state, while network hosts receive only their own heroes.
 * Use the same privacy boundary in both; an identified enemy ship is not its dossier. */
export function mapHeroes(state: GameState, me: string): Map<string, Hero> {
  return new Map(
    Object.values(state.heroes ?? {})
      .filter(
        (h) =>
          h.owner === me && h.alive !== false && h.fleetId && state.fleets[h.fleetId]?.owner === me,
      )
      .map((h) => [h.fleetId!, h]),
  );
}

/** Grades exist in the shipped game; hero levels do not. Never invent a level. */
export function heroGradeGlyph(grade: string | undefined): string {
  switch (grade) {
    case 'main':
      return '♛';
    case 'legendary':
      return '★';
    case 'rare':
      return '◈';
    default:
      return '◦';
  }
}

export interface PortraitHit {
  heroId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function heroAtPoint(hits: readonly PortraitHit[], x: number, y: number): string | null {
  return (
    [...hits]
      .reverse()
      .find((h) => x >= h.x && x <= h.x + h.width && y >= h.y && y <= h.y + h.height)?.heroId ??
    null
  );
}

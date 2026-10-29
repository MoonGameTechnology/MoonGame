import type { MatchClock } from './store/types';

/** A saved match keeps its own wall/game rate; the host default seeds new matches. */
export function sessionSpeed(clock: MatchClock | undefined, fallback: number, requested?: number): number {
  const scale = clock?.timeScale ?? requested ?? fallback;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('E_BAD_MATCH_CLOCK');
  return scale;
}

import type { GameData } from '../data/schemas';
import type { GameState } from './gameState';
import { orderLane } from './buildLane';

/** Read-only shared arbitration; construction and hero modules communicate through events. */
export function mobilizationHead(
  state: GameState,
  planetId: string,
  data: GameData,
): { seq: number; heroId?: string } | null {
  const heads: { seq: number; heroId?: string }[] = (state.planets[planetId]?.buildQueue ?? [])
    .filter((q) => orderLane(data, q) === 'mobilization')
    .map((q) => ({ seq: q.id }));
  for (const hero of Object.values(state.heroes ?? {})) {
    const p = hero.mobilization;
    if (p?.queued && p.target === planetId && p.orderId !== undefined)
      heads.push({ seq: p.orderId, heroId: hero.id });
  }
  return heads.sort((a, b) => a.seq - b.seq)[0] ?? null;
}
export function mobilizationBusy(state: GameState, planetId: string, data: GameData): boolean {
  return (
    Object.values(state.heroes ?? {}).some(
      (h) => h.mobilization?.target === planetId && !h.mobilization.queued,
    ) ||
    state.scheduled.some((e) => {
      if (e.type !== 'construction.complete') return false;
      const p = e.payload as { planetId?: string; kind?: string; unit?: string };
      return p.planetId === planetId && orderLane(data, p) === 'mobilization';
    })
  );
}
export function queuedHeroCount(state: GameState, planetId: string): number {
  return Object.values(state.heroes ?? {}).filter(
    (h) => h.mobilization?.queued && h.mobilization.target === planetId,
  ).length;
}

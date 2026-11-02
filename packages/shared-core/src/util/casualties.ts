import type { HandlerContext } from '../kernel/module';

/** Immediate death-state update, before another source fires in this exchange. */
export type HeroCasualty = (h: HandlerContext, payload: Record<string, unknown>) => string | undefined;

export function announceCasualty(h: HandlerContext, payload: Record<string, unknown>): void {
  const heroId = h.capability<HeroCasualty>('hero.casualty')?.(h, payload);
  // Death clears fleetId. Pin the identity so the queued event cannot choose another hero.
  h.emit('unit.died', heroId === undefined ? payload : { ...payload, heroId });
}

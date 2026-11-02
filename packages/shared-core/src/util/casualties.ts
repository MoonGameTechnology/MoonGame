import type { HandlerContext } from '../kernel/module';

/** Immediate death-state update, before another source fires in this exchange. */
export type HeroCasualty = (h: HandlerContext, payload: Record<string, unknown>) => void;

export function announceCasualty(h: HandlerContext, payload: Record<string, unknown>): void {
  h.capability<HeroCasualty>('hero.casualty')?.(h, payload);
  h.emit('unit.died', payload);
}

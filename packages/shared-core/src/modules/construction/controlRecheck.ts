import type { HandlerContext, ModuleSetupApi } from '../../kernel/module';
import type { CompletePayload } from '../../state/construction';
import type { Planet, ScheduledEvent } from '../../state/gameState';

interface ConstructionRequirement {
  allowed: boolean;
  code?: string;
}

/**
 * BAL-19. A unit builds only on a world under control, for the whole build. When control
 * moves (`control.changed`: a new capital, or a planet taken nearer to it), each running
 * unit build of that owner re-asks `construction.requirement`, and a refused one is parked
 * (`park`, the body of a player's cancel): its progress waits for control to return instead
 * of finishing beyond the limit. No control module → no event → nothing to re-ask.
 */
export function registerControlRecheck(
  api: ModuleSetupApi,
  park: (h: HandlerContext, planet: Planet, event: ScheduledEvent) => boolean,
): void {
  api.on('control.changed', (event, h) => {
    const { owner } = (event.payload ?? {}) as { owner?: unknown };
    if (typeof owner !== 'string') return;
    const running = h.state.scheduled.filter((e) => {
      const p = e.payload as CompletePayload | null;
      return e.type === 'construction.complete' && p?.kind === 'unit' && p.playerId === owner;
    });
    for (const scheduled of running) {
      const p = scheduled.payload as CompletePayload;
      const planet = p.planetId === undefined ? undefined : h.state.planets[p.planetId];
      if (!planet || planet.owner !== owner || typeof p.unit !== 'string') continue;
      const args = { playerId: owner, kind: 'unit', id: p.unit, planetId: planet.id };
      if (!h.hook<ConstructionRequirement>('construction.requirement', { allowed: true }, args).allowed)
        park(h, planet, scheduled);
    }
  });
}

import type { HandlerContext } from '../../kernel/module';
import type { CompletePayload } from '../../state/construction';
import { constructionModuleSnapshot } from '../../util/arsenalLoadout';
import { hoursToMs } from '../../action/types';

/** Schedules completion with the match timeScale. Only the authoritative scheduler
 *  writes accepted duration and module snapshots. */
export function scheduleCompletion(h: HandlerContext, hours: number, payload: CompletePayload, fullHours = hours): void {
  payload.durationHours = fullHours;
  if (payload.kind === 'unit') payload.moduleSnapshot ??= constructionModuleSnapshot(payload.modules, h.state.players[payload.playerId ?? '']?.arsenal);
  h.schedule(h.ctx.now + hoursToMs(h.ctx, hours), 'construction.complete', payload);
}

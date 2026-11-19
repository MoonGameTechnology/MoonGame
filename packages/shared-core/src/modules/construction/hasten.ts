/**
 * Возможность `construction.hasten` (TEC-3): сдвинуть идущий заказ стройки раньше — зеркало
 * шпионской задержки `construction.delay` (SPY-14). Заказ сохраняет свой `seq` (отмена и
 * пауза по номеру остаются верными), очередь остаётся упорядоченной по `(at, seq)`, а
 * прогресс заказа считается от нового срока: пропущенное время засчитано как сделанное.
 *
 * Сборка ядра крепости идёт своим графиком (`fortress.assembly`) и не ускоряется: её срок
 * держит не событие, а сама сборка.
 */
import type { HandlerContext, ModuleSetupApi } from '../../kernel/module';
import type { CompletePayload } from '../../state/construction';
import type { GameState, ScheduledEvent } from '../../state/gameState';
import { FORTRESS_CORE } from '../../state/fortress';
import { hoursToMs } from '../../action/types';
import type { QueueHasten, QueueRef } from '../../util/speedup';

/** Идущий заказ игрока с номером `seq`, или `undefined`. */
function orderOf(state: GameState, playerId: string, ref: QueueRef): ScheduledEvent | undefined {
  if (ref.kind !== 'construction') return undefined;
  const event = state.scheduled.find((e) => e.type === 'construction.complete' && e.seq === ref.seq);
  const p = event?.payload as CompletePayload | undefined;
  if (!event || p?.playerId !== playerId) return undefined;
  if (p.kind === 'upgrade' && p.building === FORTRESS_CORE) return undefined;
  return event;
}

const remaining = (h: HandlerContext, playerId: string, ref: QueueRef): number | null => {
  const event = orderOf(h.state, playerId, ref);
  return event ? Math.max(0, event.at - h.ctx.now) / hoursToMs(h.ctx, 1) : null;
};

const hasten = (h: HandlerContext, playerId: string, ref: QueueRef, hours: number): boolean => {
  const event = orderOf(h.state, playerId, ref);
  if (!event || !(hours > 0)) return false;
  const moved = { ...event, at: Math.max(h.ctx.now, Math.round(event.at - hoursToMs(h.ctx, hours))) };
  const rest = h.state.scheduled.filter((e) => e !== event);
  const pos = rest.findIndex((e) => e.at > moved.at || (e.at === moved.at && e.seq > moved.seq));
  rest.splice(pos < 0 ? rest.length : pos, 0, moved);
  h.state.scheduled = rest;
  return true;
};

export function registerHasten(api: ModuleSetupApi): void {
  api.provideCapability<QueueHasten>('construction.hasten', { remaining, hasten });
}

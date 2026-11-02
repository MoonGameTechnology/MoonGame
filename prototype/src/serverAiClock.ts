/** Offline AI wakes for eligible policies and for the end of a delegated watch. */
import type { MatchRoom } from '../../packages/server/src/matchRoom';
import type { StaggeredAi } from './aiScheduler';

export function serverAiHeartbeat<T>(
  room: Pick<MatchRoom, 'state' | 'isStarted' | 'clockScale'>,
  schedule: StaggeredAi<T>,
  policy: (seat: string) => string | null,
  heartbeatMs: number,
): number | null {
  if (!room.isStarted || room.state.match.status === 'ended') return null;
  const seats = Object.keys(room.state.players);
  let delay = schedule.nextDelay(room.state.time, seats, policy);
  // Expire without waiting for another game event or a later decision phase.
  for (const seat of seats) {
    const watch = room.state.players[seat]?.steward;
    if (watch && policy(seat)?.startsWith('steward:'))
      delay = Math.min(delay ?? Infinity, watch.until - room.state.time);
  }
  // No eligible policy means no extra timer. Pending work is paced, never a 0ms spin.
  return delay === null ? null : Math.max(heartbeatMs, delay / room.clockScale);
}

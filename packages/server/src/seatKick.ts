import type { Action, PlayerId } from '@void/shared-core';
import type { MatchRoom } from './matchRoom';
import type { AccountStore } from './store';
import type { AdminKickRefusal } from './adminApi';

/**
 * ADM-1 — снятие игрока с места, общий порядок для ОБОИХ хостов.
 *
 * Кик состоит из трёх шагов, живущих в трёх разных слоях, и порядок между ними — не
 * вкусовщина, а единственный, при котором нет полусостояния:
 *
 * 1. **Ядро** (`seat.kick`) снимает `seated`/`claimedAt` — только после этого кресло
 *    снова заявляемо (`seat.claim` отказал бы по правилу 1).
 * 2. **Стор** отвязывает позывной от места — только после этого `resolveSeat` отдаст
 *    кресло следующему.
 * 3. **Транспорт** закрывает сокеты снятого, назвав причину.
 *
 * Порядок именно 1→2→3, потому что обратный оставляет партию сломанной: отвязав
 * позывной первым и не сумев применить действие, мы получили бы «свободное» по стору
 * кресло, в которое ядро никого не пустит — вход стал бы отказывать без объяснения, и
 * чинилось бы это только рестартом. Отказ на шаге 1 не трогает ничего.
 *
 * Отдельно про `E_SEAT_UNCLAIMED` на шаге 1: он значит «в состоянии эту сторону никто
 * не заявлял» — так бывает у партий, поднятых до ENTRY-3, и у LAN-хоста без учёток.
 * Привязка в сторе при этом реальна, и снимать её надо: считаем шаг 1 выполненным.
 * Любой другой отказ — настоящий, и кик прерывается.
 */

/** Действие кика. Идентификатор несёт момент ЗАЯВКИ: два кика одного кресла (сняли
 *  одного, сел другой, сняли и его) обязаны различаться, иначе квитанции комнаты
 *  вернут второму кэшированный успех первого и место останется занятым. */
export function seatKickAction(
  matchId: string,
  playerId: string,
  claimedAt: number | undefined,
  gameTime: number,
): Action {
  return {
    id: `seat-kick:${matchId}:${playerId}:${claimedAt ?? 'unclaimed'}`,
    type: 'seat.kick',
    playerId,
    payload: {},
    issuedAt: gameTime,
  };
}

export interface KickSeatDeps {
  matchId: string;
  /** Комната матча, или undefined — тогда снимать нечего (`E_NO_MATCH`). */
  room: MatchRoom | undefined;
  accounts: AccountStore;
}

export async function kickSeat(
  deps: KickSeatDeps,
  nick: string,
): Promise<{ ok: true; playerId: PlayerId; closed: number } | { ok: false; code: AdminKickRefusal }> {
  const { matchId, room, accounts } = deps;
  if (!room) return { ok: false, code: 'E_NO_MATCH' };
  const seat = await accounts.seatOf(matchId, nick);
  // Никого нет в этом кресле — состав у администратора устарел. Честнее сказать, чем
  // отчитаться об успехе над пустотой.
  if (!seat) return { ok: false, code: 'E_NOT_SEATED' };

  // Шаг 1 — ядро.
  const claimedAt = room.state.players[seat]?.claimedAt;
  const applied = await room.submitServerAction(
    seat,
    seatKickAction(matchId, seat, claimedAt, room.state.time),
  );
  if (!applied.ok && applied.code !== 'E_SEAT_UNCLAIMED') return { ok: false, code: 'E_INTERNAL' };

  // Шаг 2 — стор. `releaseSeat` возвращает снятое место; null значит, что привязка
  // исчезла между чтением и удалением (чужой параллельный кик) — исход тот же, кресло
  // свободно, но отчитываться об этом киком нельзя.
  const freed = await accounts.releaseSeat(matchId, nick);
  if (!freed) return { ok: false, code: 'E_NOT_SEATED' };

  // Шаг 3 — транспорт. Ноль закрытых соединений — не ошибка: кик про кресло, а не
  // про сокет, и снять можно того, кто уже ушёл.
  return { ok: true, playerId: freed, closed: room.evict(freed) };
}

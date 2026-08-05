/**
 * PING-PANEL — список всех пингов коалиции (своих и союзных) как ЧИСТАЯ модель.
 *
 * Заказ владельца: «в хаб кнопок меню надо добавить кнопку, где откроется — будут видны
 * все твои и союзников пинги; и там можно отредактировать текст, или выключить
 * отображение, или переместить камеру к этому пингу».
 *
 * Почему отдельным модулем, а не разметкой внутри `main.ts`: права на СВОЙ и на ЧУЖОЙ
 * пинг разные, и это правило легко потерять в JSX-подобной простыне.
 *  · СВОЙ — можно переписать текст и снять совсем (пинг общий, снятие видят все).
 *  · ЧУЖОЙ — редактировать нельзя (это чужое сообщение), снять у всех тоже нельзя;
 *    можно лишь СПРЯТАТЬ У СЕБЯ. Поэтому «выключить отображение» — это ЛОКАЛЬНОЕ
 *    состояние клиента, а не правка общей модели: иначе один игрок стирал бы метки
 *    союзникам.
 * Камера — всегда, к любому пингу: смотреть не запрещено никому.
 *
 * `main.ts` — DOM-вход без юнит-харнеса; вынесенная, эта модель накрывается гейтом.
 */
import type { SessionMsg } from './conversations';
import { COALITION } from './conversations';

/** Строка списка: один пинг + что с ним МОЖНО делать. */
export interface PingRow {
  /** Провинция, на которую поставлен пинг (он же ключ: одна метка на мир). */
  loc: string;
  /** Автор. */
  from: string;
  /** Текст пинга (может быть пустым — метка без описания). */
  text: string;
  /** Когда поставлен (игровое время). */
  at: number;
  /** Серверный id — нужен, чтобы снять пинг по сети. */
  pingId?: string;
  /** Мой ли это пинг: только свой можно править и снимать. */
  mine: boolean;
  /** Спрятан ли он локально (метка не рисуется на карте у МЕНЯ). */
  hidden: boolean;
}

/**
 * Все активные пинги коалиции, одна строка на провинцию (последний пинг на мире
 * побеждает — та же свёртка, что у маркеров карты, чтобы список и карта не разошлись).
 *
 * Сортировка: сначала СВОИ, потом чужие, внутри — по свежести (новые сверху). Порядок
 * фиксированный и не зависит от порядка ключей: список не должен прыгать между кадрами.
 */
export function pingRows(
  messages: readonly SessionMsg[],
  me: string,
  hidden: ReadonlySet<string>,
): PingRow[] {
  const byLoc = new Map<string, SessionMsg>();
  for (const m of messages) {
    if (m.to === COALITION && m.ping) byLoc.set(m.ping, m);
  }
  const rows: PingRow[] = [];
  for (const m of byLoc.values()) {
    rows.push({
      loc: m.ping!,
      from: m.from,
      text: m.text,
      at: m.at,
      ...(m.pingId !== undefined ? { pingId: m.pingId } : {}),
      mine: m.from === me,
      hidden: hidden.has(m.ping!),
    });
  }
  rows.sort((a, b) => {
    if (a.mine !== b.mine) return a.mine ? -1 : 1;
    if (a.at !== b.at) return b.at - a.at;
    return a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0; // стабильный хвост
  });
  return rows;
}

/** Можно ли править текст этого пинга. Чужое сообщение переписывать нельзя. */
export function canEditPing(row: PingRow): boolean {
  return row.mine;
}

/** Можно ли снять пинг ДЛЯ ВСЕХ. Только свой — иначе игрок стирал бы метки союзникам. */
export function canRemovePing(row: PingRow): boolean {
  return row.mine;
}

/** Переключить локальное сокрытие метки. Возвращает НОВЫЙ набор (чистая функция —
 *  вызывающий сам решает, когда подменить состояние). */
export function toggleHidden(hidden: ReadonlySet<string>, loc: string): Set<string> {
  const next = new Set(hidden);
  if (!next.delete(loc)) next.add(loc);
  return next;
}

/** Метки, которые карта должна нарисовать: активные минус спрятанные локально. */
export function visiblePingLocs(
  messages: readonly SessionMsg[],
  me: string,
  hidden: ReadonlySet<string>,
): string[] {
  return pingRows(messages, me, hidden)
    .filter((r) => !r.hidden)
    .map((r) => r.loc);
}

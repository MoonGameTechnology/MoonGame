/**
 * Ники соседей по сетевой партии — хозяин карты «кресло → ник».
 *
 * Правила разбора и частоты — `decisions/seatNicks.ts`; здесь только запрос и хранение.
 * Карта живёт, пока игрок в сети: выход из партии её стирает, иначе в следующей партии
 * на тех же креслах стояли бы чужие ники.
 */
import { nicksFromSeats, nicksRefreshDue } from '../../decisions/seatNicks';
import { detach } from './detach';
import { fetchSeats } from './matchJoin';

let nicks: Record<string, string> = {};
let lastAt: number | null = null;
/** Партия, которой принадлежит карта: запрос, вернувшийся из прошлой, не пишет в новую. */
let forMatch = '';

/** Ник игрока в этом кресле; `undefined` — неизвестен (соло, бот, сервер без поля). */
export function seatNick(seat: string): string | undefined {
  return nicks[seat];
}

/** Переспросить расклад мест (не чаще промежутка из `decisions`, `force` — сразу).
 *  `changed` зовётся, только если ответ пришёл и что-то поменял. */
export function refreshSeatNicks(
  base: string,
  matchId: string,
  nick: string,
  changed: () => void,
  force = false,
): void {
  if (matchId !== forMatch) {
    nicks = {};
    lastAt = null;
    forMatch = matchId;
  }
  const now = Date.now();
  if (!force && !nicksRefreshDue(lastAt, now)) return;
  lastAt = now;
  detach(
    'ники игроков',
    (async () => {
      let next: Record<string, string>;
      try {
        const res = await fetchSeats(base, matchId, nick);
        if (!res.ok) return;
        next = nicksFromSeats(await res.json());
      } catch {
        return; // тихий опрос: связь моргнула — останутся прежние ники
      }
      if (matchId !== forMatch || JSON.stringify(next) === JSON.stringify(nicks)) return;
      nicks = next;
      changed();
    })(),
  );
}

/** Забыть ники: игрок вышел из сетевой партии. */
export function clearSeatNicks(): void {
  nicks = {};
  lastAt = null;
  forMatch = '';
}

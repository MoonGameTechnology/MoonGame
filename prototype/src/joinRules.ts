/**
 * Обмен сессии на место в матче: что просить и как читать отказ (REFM-48).
 *
 * Сессия живёт днями, а join-токен — минуты: сервер выдаёт короткий пропуск под
 * конкретный матч, и клиент меняет на него свою долгую сессию. Отсюда правила.
 *
 * 1. **401 — это не «не получилось», это «сессии больше нет».** Токен отозвали или он
 *    истёк, и держать его дальше бессмысленно: клиент будет вечно стучаться в дверь
 *    просроченным пропуском, показывая игроку одну и ту же невнятную ошибку. Такой
 *    ответ ОБЯЗАН стирать сохранённую сессию — тогда следующий шаг сам попросит пароль.
 *    Прочие отказы сессию не трогают: она в порядке, закрыт вход именно в этот матч.
 * 2. **Отказы различимы.** «Окно входа закрыто» (403), «мест нет» (409) и «что-то
 *    пошло не так» — три разных сообщения, и слить их в одно значит заставить игрока
 *    гадать, ждать ему или искать другой матч.
 * 3. **Пустые параметры не попадают в запрос.** `?slot=&faction=` — не то же, что их
 *    отсутствие: сервер читает пустую строку как заданное значение и отвечает отказом
 *    на месте, которого игрок не выбирал.
 */

/** Чем кончилась попытка занять место. */
export type JoinOutcome =
  | 'ok'
  | 'session-expired' // 401: сессию надо забыть и попросить пароль заново
  | 'entry-closed' // 403: окно входа в этот матч закрыто (SES-2.3)
  | 'seats-full' // 409: свободных мест нет
  | 'failed'; // прочее

/** Разобрать код ответа сервера в причину. */
export function joinOutcome(status: number): JoinOutcome {
  if (status === 401) return 'session-expired';
  if (status === 403) return 'entry-closed';
  if (status === 409) return 'seats-full';
  return status >= 200 && status < 300 ? 'ok' : 'failed';
}

/** Надо ли забыть сохранённую сессию после такого ответа — см. правило 1. */
export function dropsSession(outcome: JoinOutcome): boolean {
  return outcome === 'session-expired';
}

/**
 * Строка запроса места: `slot` — конкретное кресло (REL-7), `faction` — дом поверх
 * умолчания кресла (BF-30, дом отвязан от стартовой точки). Пустые значения
 * опускаются целиком (правило 3), непустые экранируются.
 */
export function joinQuery(slot?: string, faction?: string): string {
  const params = new URLSearchParams();
  if (slot) params.set('slot', slot);
  if (faction) params.set('faction', faction);
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Пропуск на матч: сервер обязан прислать ОБА поля — иначе это не успех. */
export interface JoinPass {
  token: string;
  playerId: string;
}

/** Разобрать тело ответа. Половина пропуска — не пропуск. */
export function parseJoinPass(body: unknown): JoinPass | null {
  const b = body as { token?: unknown; playerId?: unknown } | null;
  return b && typeof b.token === 'string' && typeof b.playerId === 'string' && b.token && b.playerId
    ? { token: b.token, playerId: b.playerId }
    : null;
}

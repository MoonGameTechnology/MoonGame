/**
 * Строка журнала о пути шпиона (SPY-23, заказ владельца 2026-11-10): ядро шлёт владельцу
 * шпиона события «приступил», «прибыл», «ждёт», «вернулся», «отменено», «раскрыт»,
 * «завербован»; здесь — каким ключом локали каждое звучит.
 *
 * 1. **Только своему.** Все эти события адресованы владельцу шпиона (`owner`); остальным
 *    строки нет.
 * 2. **Имя шпиона — позывной.** Строка называет шпиона тем же позывным, что и вкладка
 *    «Шпионаж» (`{who}`), и мир, где это случилось (`{at}`).
 * 3. **Раскрытый на ожидании шпион — три исхода.** Замечен и ушёл, убит, перевербован:
 *    у каждого своя строка, как у раскрытой операции.
 * 4. **Передислокация — не операция.** Отправленный на передислокацию шпион просто летит:
 *    у строки нет длительности операции.
 */

/** События пути шпиона. */
export const SPY_JOURNEY_EVENTS = [
  'espionage.started',
  'espionage.arrived',
  'espionage.waiting',
  'espionage.home',
  'espionage.cancelled',
  'espionage.caught',
  'espionage.recruited',
] as const;

export type SpyJourneyEvent = (typeof SPY_JOURNEY_EVENTS)[number];

/** Правила 1–4: ключ строки или `null`, если строки нет. */
export function spyJourneyKey(type: string, p: Record<string, unknown>, me: string): string | null {
  if (p.owner !== me) return null;
  switch (type) {
    case 'espionage.started':
      return 'log.spy.started';
    case 'espionage.arrived':
      return 'log.spy.arrived';
    case 'espionage.waiting':
      return 'log.spy.waiting';
    case 'espionage.home':
      return 'log.spy.home';
    case 'espionage.cancelled':
      return 'log.spy.cancelled';
    case 'espionage.caught':
      return p.agentLost === true
        ? p.agentTurned === true
          ? 'log.spy.blown.turned'
          : 'log.spy.blown.killed'
        : 'log.spy.blown';
    case 'espionage.recruited':
      return 'log.spy.recruited';
    case 'espionage.sent':
      return p.op === 'relocate' ? 'log.spy.relocate' : null;
    default:
      return null;
  }
}

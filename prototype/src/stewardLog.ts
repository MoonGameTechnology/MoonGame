/**
 * Что «Хранитель» сообщает игроку: постановка, снятие и возврат вахты (REFM-176).
 *
 * Само окно и его метрики — `stewardScreen.ts` (REFM-7); здесь то, что до сих пор стояло
 * прямо в кадре: КАКУЮ строку печатает каждое из трёх событий и что при этом делается с
 * опорным снимком.
 *
 * 1. **Всё это — только про СЕБЯ.** Чужая вахта не твоё дело, и её строки в твоей ленте
 *    были бы шумом, которого игрок не может ни проверить, ни использовать.
 * 2. **Поза меняет текст.** «Активная оборона» и «оборона» — разные обещания, и игрок
 *    должен видеть, какое именно он дал: иначе утром он не поймёт, чего ждать от отчёта.
 * 3. **Опорный снимок берётся при ПОСТАНОВКЕ и обнуляется и при снятии, и при возврате.**
 *    Разница «что стало» обязана считаться от начала ЭТОЙ вахты; оставленный снимок
 *    прошлой сравнил бы игрока со вчерашним днём и назвал бы это ночной работой.
 * 4. **Возврат печатает разницу, ТОЛЬКО если есть от чего считать.** Снимка может не быть
 *    (вахту поставили до перезагрузки страницы) — тогда отчёт идёт без цифр. Выдуманный
 *    ноль хуже отсутствия числа: он утверждает, что не изменилось ничего.
 * 5. **Знак пишется явно, `+` или `−`.** Отчёт читают за секунду; «3» не говорит, прибыло
 *    или убыло, а именно это и есть весь смысл строки.
 * 6. **Ресурс несёт свой ГЛИФ, а не HTML-чип.** Тост печатается через `textContent` — в
 *    ленту попадает и чужой текст, поэтому разметке там места нет (XSS).
 * 7. **Число решений добавляется, только если решения были.** «Решений за вахту: 0» —
 *    строка ни о чём: она удлиняет отчёт и обесценивает соседние цифры.
 */

/** Событие вахты. */
export type StewardEvent = 'delegated' | 'recalled' | 'expired';

/** Метрики, по которым считается ночная разница. */
export interface StewardSnapshot {
  planets: number;
  metal: number;
  credits: number;
}

/** Что печатать и что делать с опорным снимком (правила 2–3). */
export interface StewardReport {
  key:
    | 'log.steward.on.active'
    | 'log.steward.on.defense'
    | 'log.steward.off'
    | 'log.steward.handback.active'
    | 'log.steward.handback.defense';
  /** `take` — взять снимок сейчас, `clear` — забыть прежний. */
  snapshot: 'take' | 'clear';
}

/** Поза, при которой Хранитель не только обороняется. */
export const ACTIVE_POSTURE = 'active_defend';

/** Моё ли это событие (правило 1). */
export function stewardMine(playerId: unknown, me: string): boolean {
  return playerId === me;
}

/** Строка события и судьба снимка (правила 2–3). */
export function stewardReport(kind: StewardEvent, posture: string | undefined): StewardReport {
  const active = posture === ACTIVE_POSTURE;
  if (kind === 'delegated') {
    return { key: active ? 'log.steward.on.active' : 'log.steward.on.defense', snapshot: 'take' };
  }
  if (kind === 'recalled') return { key: 'log.steward.off', snapshot: 'clear' };
  return {
    key: active ? 'log.steward.handback.active' : 'log.steward.handback.defense',
    snapshot: 'clear',
  };
}

/** Число со знаком: прибыло или убыло (правило 5). */
export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `−${Math.abs(n)}`;
}

/** Подстановки строки ночной разницы; `null` — считать не от чего (правила 4–6). */
export function diffFields(
  base: StewardSnapshot | null,
  now: StewardSnapshot,
  /** Словарь глифов ресурсов; читаются `metal` и `credits` — те же, что на капсулах бара. */
  glyph: Readonly<Record<string, string>>,
): { p0: string; p1: string; bag: string } | null {
  if (!base) return null;
  const m = glyph.metal ?? '';
  const c = glyph.credits ?? '';
  return {
    p0: String(base.planets),
    p1: String(now.planets),
    bag: `${m}${signed(now.metal - base.metal)} ${c}${signed(now.credits - base.credits)}`,
  };
}

/** Подстановка строки о решениях; `null` — решений не было (правило 7). */
export function decisionsField(logged: number): { n: string } | null {
  return logged > 0 ? { n: String(logged) } : null;
}

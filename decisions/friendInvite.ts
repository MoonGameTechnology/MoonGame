/**
 * «Позвать друга в партию» (FRIENDS-2): куда звать и надо ли спрашивать.
 *
 * 1. **Звать можно только в СВОЮ идущую партию.** Приглашение — это «иди ко мне»; сервер
 *    принимает его, только если у отправителя есть место в этой партии. Закончившаяся
 *    партия никого уже не примет, поэтому в выбор она не попадает.
 * 2. **Одна партия — без вопроса.** Спрашивать «куда?», когда ответ один, — лишнее нажатие.
 * 3. **Несколько — спросить.** Порядок тот же, что у «Моих партий»: сервер его уже решил.
 * 4. **Ни одной — сказать, что звать некуда.** Кнопка, которая молча ничего не делает,
 *    читается как поломка.
 */

interface HasStatus {
  status?: string;
}

export type InviteStep<R> =
  | { kind: 'none' }
  | { kind: 'send'; match: R }
  | { kind: 'pick'; matches: R[] };

/** Правило 1: свои партии, в которые ещё можно позвать. */
export function inviteMatches<R extends HasStatus>(active: readonly R[]): R[] {
  return active.filter((m) => m.status !== 'ended');
}

/** Правила 2–4: что сделать по нажатию «Позвать». */
export function inviteStep<R>(matches: readonly R[]): InviteStep<R> {
  if (matches.length === 0) return { kind: 'none' };
  if (matches.length === 1) return { kind: 'send', match: matches[0]! };
  return { kind: 'pick', matches: [...matches] };
}

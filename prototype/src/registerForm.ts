/**
 * Страница регистрации: проверка формы и подсказка позывного (REFM-52).
 *
 * Регистрация здесь — это ПЕРВЫЙ вход (`ensureSession`: login → 401 → register), и
 * сервер на любую беду отвечает одинаковым сухим отказом. Поэтому форма обязана
 * разобраться сама, пока дело не дошло до сети.
 *
 * 1. **Каждая беда называет СВОЁ поле.** «Отказано» без указания, что именно не так,
 *    заставляет игрока перебирать поля вслепую; поэтому проверка возвращает не только
 *    причину, но и поле, на которое ставить курсор.
 * 2. **Повтор пароля проверяется ПОСЛЕ длины.** Порядок не косметический: набравшему
 *    короткий пароль надо сказать про длину, а не про несовпадение — иначе он
 *    исправит не то и упрётся в тот же отказ второй раз.
 * 3. **Почта НЕОБЯЗАТЕЛЬНА, и пустая не уходит вовсе.** Пустая строка в теле запроса —
 *    это «почта задана, и она пустая»: сервер ответит отказом на поле, которого игрок
 *    не заполнял. Её просто нет (то же правило, что в `joinRules.ts` и `pendingJoin.ts`).
 * 4. **Подсказка позывного детерминирована.** Ни `Math.random`, ни `Date` даже в
 *    интерфейсной обвязке: счётчик шагает по фиксированному списку, поэтому один и тот
 *    же экран на одном и том же счётчике выглядит одинаково, а второе нажатие «Новый
 *    командир» не предлагает то же имя снова.
 *
 * Порог пароля берётся из `authRules.ts` — второй копии этого числа быть не должно.
 */

import { validPassword } from './authRules';

/** Поле формы, на которое надо вернуть курсор. */
export type RegisterField = 'nick' | 'pass' | 'pass2';

/** Что игрок набрал в форме. */
export interface RegisterDraft {
  nick: string;
  pass: string;
  pass2: string;
  email: string;
}

/** Беда формы: ключ подписи и поле, которое её вызвало (правило 1). */
export interface RegisterProblem {
  key: string;
  field: RegisterField;
}

/** Проверить форму. `null` — форма цела, можно идти в сеть. */
export function checkRegister(draft: RegisterDraft): RegisterProblem | null {
  if (!draft.nick.trim()) return { key: 'auth.need-name', field: 'nick' };
  // Правило 2: сначала длина, потом совпадение.
  if (!validPassword(draft.pass)) return { key: 'acc.pass.rule', field: 'pass' };
  if (draft.pass !== draft.pass2) return { key: 'auth.pass-mismatch', field: 'pass2' };
  return null;
}

/** Что уходит на сервер. Почты нет вовсе, если её не заполнили (правило 3). */
export interface RegisterPayload {
  nick: string;
  pass: string;
  email?: string;
}

/** Собрать запрос из формы. `null`, если форма не цела — проверку не обойти. */
export function registerPayload(draft: RegisterDraft): RegisterPayload | null {
  if (checkRegister(draft)) return null;
  const payload: RegisterPayload = { nick: draft.nick.trim(), pass: draft.pass };
  const email = draft.email.trim();
  if (email) payload.email = email;
  return payload;
}

/** Список позывных для подсказки — ключи, а не текст: имена живут в /localization. */
export const CALLSIGNS = [
  'callsign.rhino',
  'callsign.comet',
  'callsign.viper',
  'callsign.orion',
  'callsign.vector',
  'callsign.falcon',
  'callsign.titan',
  'callsign.quasar',
] as const;

/** Подсказка по номеру: ключ имени и его номер. Чистая — вся случайность снаружи. */
export function callsignFor(n: number): { key: string; suffix: number } {
  // Счётчик начинается с единицы; всё, что меньше, — тоже первый (правило 4: экран
  // не должен зависеть от того, чем оказалось испорчено хранилище).
  const suffix = Math.max(1, Math.floor(n));
  return { key: CALLSIGNS[(suffix - 1) % CALLSIGNS.length]!, suffix };
}

/** Следующий номер подсказки из того, что лежало в хранилище (мусор — это ноль). */
export function nextCallsignNumber(stored: string | null): number {
  return (Number(stored ?? '0') || 0) + 1;
}

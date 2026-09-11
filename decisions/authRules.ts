/**
 * Правила учётных данных и разбор ответов сервера авторизации (REFM-47).
 *
 * Вход в этой игре устроен ОДНОЙ кнопкой: свежий позывной регистрируется, знакомый —
 * входит (Bytro-стиль). Отсюда две вещи, которые легко сделать неверно.
 *
 * 1. **Правила логина и пароля — ЗЕРКАЛО серверных.** Сервер (`authApi.ts`) отвечает
 *    на плохой позывной одинаковым сухим отказом, и без местной проверки игрок видит
 *    «отказано» без единой подсказки, что не так. Зеркало существует ради объяснения,
 *    а не ради безопасности: решает всё равно сервер.
 * 2. **«Вход 401, а регистрация 409» означает НЕВЕРНЫЙ ПАРОЛЬ.** Это единственное
 *    место, где причину приходится выводить из ПАРЫ ответов: сервер намеренно не
 *    говорит «такой логин есть, но пароль другой» — иначе он подтверждал бы
 *    существование чужой учётки любому спрашивающему. Клиент складывает два кода
 *    сам: не пустил (401) + «занято» при регистрации (409) = позывной чужой или
 *    пароль не тот. Свернёшь это в «регистрация не удалась» — и игрок с опечаткой в
 *    пароле будет думать, что сломан сервер.
 */

/** Позывной: буквы/цифры/`_`/`-`, 3–24 знака. Зеркало `LOGIN_RE` сервера. */
export const LOGIN_RE = /^[\p{L}\p{N}_-]{3,24}$/u;

/** Минимальная длина пароля — тоже серверное правило, продублированное ради подсказки. */
export const MIN_PASSWORD = 8;

export function validLogin(login: string): boolean {
  return LOGIN_RE.test(login);
}

export function validPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD;
}

/** Чем кончилась попытка входа-или-регистрации — в терминах ПРИЧИНЫ, не кодов. */
export type AuthOutcome =
  | 'ok' // вошли существующей учёткой
  | 'created' // такого позывного не было — завели
  | 'wrong-password' // позывной занят, пароль не подошёл
  | 'mail-taken' // почта уже привязана к другой учётке
  | 'rate-limited' // слишком часто — сервер просит подождать
  | 'register-refused'
  | 'login-refused';

/** Ответ сервера в том виде, в каком его читает клиент. */
export interface AuthReply {
  status: number;
  token?: string;
  error?: string;
}

/**
 * Разобрать пару ответов (вход, затем — если не пустили — регистрация) в причину.
 * `register` отсутствует, когда до неё не дошло: вход или удался, или отказал не 401.
 */
export function authOutcome(login: AuthReply, register?: AuthReply): AuthOutcome {
  if (login.token) return 'ok';
  if (login.status !== 401) return login.status === 429 ? 'rate-limited' : 'login-refused';
  if (!register) return 'login-refused';
  if (register.token) return 'created';
  if (register.error === 'E_EMAIL_TAKEN') return 'mail-taken';
  // Вот та самая пара: 401 на входе + 409 на регистрации (см. шапку модуля).
  if (register.status === 409) return 'wrong-password';
  if (register.status === 429) return 'rate-limited';
  return 'register-refused';
}

/** Нужно ли пробовать регистрацию после отказа входа. */
export function shouldRegister(login: AuthReply): boolean {
  return !login.token && login.status === 401;
}

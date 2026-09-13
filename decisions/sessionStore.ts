/**
 * Хранение сессионного токена: чей он и для какого сервера (REFM-46).
 *
 * Учётка — не просто ник: пароль охраняет её, а в браузере остаётся JWT, который
 * этот пароль заменяет. Отсюда три правила, и каждое существует из-за конкретной
 * неприятности, а не для порядка.
 *
 * 1. **Токен принадлежит ПОЗЫВНОМУ.** Семейный ноутбук: один игрок нажал «Сменить
 *    командира», второй вошёл под своим именем — и если отдать кэш просто «по
 *    серверу», второй молча заходит под первым. Поэтому запись хранит и логин, и
 *    токен, а выдаётся только по совпадению логина.
 * 2. **Ключ включает АДРЕС сервера.** Иначе токен локального dev-сервера уедет на
 *    боевой (и наоборот) — а он там не действует и в лучшем случае даст непонятный
 *    отказ.
 * 3. **Пароль не хранится НИКОГДА.** В записи ровно два поля: логин и токен. Токен
 *    отзываем и истекает, пароль — нет.
 *
 * Старые записи (голый JWT строкой, без логина) не проходят разбор и читаются как
 * «сессии нет»: одна безвредная переавторизация вместо входа под чужим именем.
 */

/** Что хранится про сессию: КОМУ выдан токен и сам токен. */
export interface SessionRec {
  login: string;
  token: string;
}

/** Минимум от `localStorage`, который нужен хранилищу (и который легко подменить). */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Ключ записи: свой на каждый сервер — см. правило 2. */
export function sessionKey(base: string): string {
  return `void.session.${base}`;
}

/** Разобрать запись. Битая, чужой формы или легаси-строка → «сессии нет». */
export function parseSession(raw: string | null): SessionRec | null {
  if (raw === null) return null;
  try {
    const rec = JSON.parse(raw) as { login?: unknown; token?: unknown } | null;
    return rec && typeof rec.login === 'string' && typeof rec.token === 'string'
      ? { login: rec.login, token: rec.token }
      : null;
  } catch {
    return null;
  }
}

/** Запись сессии этого сервера — или `null`, если её нет либо она нечитаема. */
export function readSession(store: KeyValueStore, base: string): SessionRec | null {
  return parseSession(store.getItem(sessionKey(base)));
}

/**
 * Токен ДЛЯ ЭТОГО позывного. Логины сравниваются без учёта регистра — сервер
 * считает «Ivan» и «ivan» одним игроком, и клиент не должен требовать переучёта
 * из-за большой буквы. Чужая запись не отдаётся (правило 1).
 */
export function tokenFor(store: KeyValueStore, base: string, login: string): string | null {
  const rec = readSession(store, base);
  return rec && rec.login.toLowerCase() === login.toLowerCase() ? rec.token : null;
}

/**
 * Токен любой сохранённой сессии этого сервера — для НЕкритичных путей (обновить
 * арсенал, перезвонить). Всё, что решает «кто ты», обязано ходить через `tokenFor`.
 */
export function anyToken(store: KeyValueStore, base: string): string | null {
  return readSession(store, base)?.token ?? null;
}

/** Сохранить сессию: только логин и токен, пароля здесь нет и быть не может. */
export function saveSession(store: KeyValueStore, base: string, rec: SessionRec): void {
  store.setItem(sessionKey(base), JSON.stringify({ login: rec.login, token: rec.token }));
}

/** Забыть сессию ЭТОГО сервера — «Сменить командира» не трогает остальные. */
export function clearSession(store: KeyValueStore, base: string): void {
  store.removeItem(sessionKey(base));
}

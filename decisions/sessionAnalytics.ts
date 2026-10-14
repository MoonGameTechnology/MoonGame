/**
 * События пути от открытия страницы до партии и связи (PTM-1.2,
 * `docs/playtest-telemetry-roadmap.md`) — чистые решения: какое событие словаря уходит и
 * с какими полями. Общие для обоих клиентов, как `runAnalytics.ts`.
 *
 * 1. **Поля — числа и короткие метки, никогда не ввод игрока.** Позывной, почта, адрес
 *    сервера и id партии в событие не попадают: метрике входа нужен исход, а не имя.
 * 2. **Метка приглашения (`?src=`) — только короткий токен `[a-z0-9-]`.** Ссылку тестерам
 *    раздаёт владелец (`?src=tg-oct`), но открыть её может кто угодно с чем угодно в
 *    адресе; всё, что не похоже на метку, отбрасывается, а не чистится.
 * 3. **Исход входа называется тем же словом, что у `authRules.ts`.** Отказ клиента до
 *    запроса (позывной или пароль не по правилам) — тоже исход: на нём воронка и теряет
 *    людей, а сервер его не видит вовсе.
 * 4. **Время — целые миллисекунды.** Дробная часть `performance.now()` — шум, а заодно
 *    отпечаток таймера браузера.
 */
import type { AuthOutcome } from './authRules';
import type { EventProps } from './runAnalytics';

const TAG = /^[a-z0-9-]{1,32}$/;

/** Метка приглашения из запроса страницы (правило 2). */
export function inviteTag(search: string): string | null {
  const raw = new URLSearchParams(search).get('src');
  return raw !== null && TAG.test(raw) ? raw : null;
}

/** Точка входа страницы (`data-entry`) как метка; чужое значение — `other`. */
export function entryTag(entry: string | undefined): string {
  return entry === undefined ? 'main' : TAG.test(entry) ? entry : 'other';
}

const ms = (value: number): number => Math.max(0, Math.round(value));

export function appLoadedProps(input: {
  loadMs: number;
  entry: string | undefined;
  mobile: boolean;
  lang: string;
  search: string;
}): EventProps {
  const src = inviteTag(input.search);
  return {
    loadMs: ms(input.loadMs),
    entry: entryTag(input.entry),
    mobile: input.mobile,
    lang: input.lang,
    ...(src ? { src } : {}),
  };
}

/** Чем кончилась попытка войти — включая отказ до запроса и обрыв (правило 3). */
export type LoginResult = AuthOutcome | 'nick-rule' | 'pass-rule' | 'server-down';

export function loginEvent(
  result: LoginResult,
): { event: 'login_ok' | 'login_failed'; props: EventProps } {
  return result === 'ok' || result === 'created'
    ? { event: 'login_ok', props: { created: result === 'created' } }
    : { event: 'login_failed', props: { code: result } };
}

/** Впустили в партию: `ws_ready` всегда, `match_joined` — только не на переподключении. */
export function admittedEvents(input: {
  connectMs: number;
  reconnect: boolean;
  firstEver: boolean;
}): { event: 'ws_ready' | 'match_joined'; props: EventProps }[] {
  const ready = {
    event: 'ws_ready' as const,
    props: { connectMs: ms(input.connectMs), reconnect: input.reconnect },
  };
  return input.reconnect
    ? [ready]
    : [ready, { event: 'match_joined' as const, props: { firstTime: input.firstEver } }];
}

/** Связь с партией оборвалась: код закрытия сокета и сколько она прожила. */
export function wsClosedProps(code: number, afterMs: number): EventProps {
  return { code: Number.isInteger(code) ? code : 0, afterMs: ms(afterMs) };
}

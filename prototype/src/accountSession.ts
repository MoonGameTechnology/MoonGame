/**
 * Сессия аккаунта — у одного владельца (REFM-215): проба режима сервера, запись и токен
 * сессии, вход-или-регистрация, билет на место, просьба войти и чистка адреса после захвата.
 *
 * Режим {@link authMode} и билет текущего дозвона жили `let`'ами в `main.ts`. Режим пишет
 * только {@link probeAuthMode}, а `main.ts` читает его как живую привязку (`export let`):
 * присвоить мимо владельца не даст компилятор. Билет снаружи не виден вовсе — его кладёт
 * {@link holdJoinToken} и забирает {@link takeJoinToken}, ровно один раз.
 *
 * Строка статуса, сообщения игроку, карточка входа и её пароль живут в `main.ts`; модуль
 * получает их хуками {@link initAccountSession} — импорт оттуда был бы циклом.
 *
 * With AUTH on the server, the playable path runs the full account flow: the nick
 * is a LOGIN, a password guards it, and joining goes register/login → session JWT →
 * GET /matches/:id/join → short-lived join token → WS `?token=`. The client
 * self-configures from GET /auth/status; without accounts the nick+ticket handshake
 * stays exactly as before. The password is never persisted — only the session JWT
 * (a revocable, expiring credential) lands in localStorage, keyed per server.
 */
import { t } from '../../localization/runtime';
import { mintedToken, passwordFrom, registerExtra } from '../../decisions/authRequest';
import {
  authOutcome,
  shouldRegister,
  validLogin,
  validPassword,
  type AuthOutcome,
} from '../../decisions/authRules';
import {
  dropsSession,
  joinOutcome,
  joinQuery,
  parseJoinPass,
  type JoinOutcome,
} from '../../decisions/joinRules';
import { settledAddress } from '../../decisions/matchAddress';
import { httpBase } from '../../decisions/matchQuery';
import {
  anyToken,
  clearSession,
  readSession,
  saveSession,
  tokenFor,
  type SessionRec,
} from '../../decisions/sessionStore';
import { authStatusUrl, identityMode, type IdentityMode } from './identityProbe';
import { createPendingJoin } from './pendingJoin';

/** Что сессии нужно от игры. Строка статуса, лента и карточка входа живут в `main.ts`. */
export interface AccountSessionHost {
  /** Строка статуса экрана подключения: почему не пустили. */
  status(text: string): void;
  note(text: string): void;
  /** Пароль, набранный на приветственной карточке. */
  welcomePassword(): string;
  /** Показать карточку входа; сервер известен — с позывным и строкой пароля. */
  showSignIn(srv: { nick?: string } | null): void;
}

let game: AccountSessionHost;

/** Причина отказа во входе в матч → ключ подписи. Текст живёт в /localization. */
const JOIN_REASON: Record<Exclude<JoinOutcome, 'ok'>, string> = {
  'session-expired': 'acc.session-expired',
  'entry-closed': 'acc.join-closed',
  'seats-full': 'acc.seats-full',
  failed: 'acc.join-failed',
};

/** Причина отказа → ключ подписи в статусной строке. Текст живёт в /localization. */
const AUTH_REASON: Record<AuthOutcome, string> = {
  ok: 'acc.created',
  created: 'acc.created',
  'wrong-password': 'acc.bad-pass',
  'mail-taken': 'acc.mail-taken',
  'rate-limited': 'acc.rate-limited',
  'register-refused': 'acc.register-refused',
  'login-refused': 'acc.login-refused',
};

// Что сервер сказал про аккаунты. НЕ булево: «не знаю» (проба ещё не спрошена или не
// дошла) обязано отличаться от «аккаунтов нет» — иначе незнание читается как разрешение
// (`joinLanding`, правило 5). До ответа сервера — именно «не знаю».
export let authMode: IdentityMode = 'unknown';
/** The join token for the CURRENT dial attempt (auth mode) — consumed by connect(). */
let pendingJoinToken: string | null = null;
/** When a join is attempted without a stored session, we show the welcome card; this
 *  holds the match AND the seat/faction the player already chose, so the sign-in can
 *  resume the join in full. `take()` reads and forgets in one step — see
 *  `pendingJoin.ts` (REFM-51) for why that matters. */
export const pendingJoinAfterAuth = createPendingJoin();

/** Поднять сессию: хуки игры. Зовётся из `main.ts` один раз, до загрузочного блока. */
export function initAccountSession(host: AccountSessionHost): void {
  game = host;
}

// Хранилище сессии — в `sessionStore.ts` (REFM-46): там же три правила, каждое из
// которых стоит за конкретной неприятностью — токен привязан к ПОЗЫВНОМУ (семейный
// ноутбук), ключ включает адрес сервера, пароль не хранится никогда.
export function sessionRecord(base: string): SessionRec | null {
  return readSession(localStorage, base);
}
/** The cached session token for ANY identity on this server (best-effort reads:
 *  arsenal refresh, redial). Auth-critical paths use ensureSession, which checks
 *  the login matches. */
export function sessionToken(base: string): string | null {
  return anyToken(localStorage, base);
}

/** Probe the server's identity mode and show/hide the password field. */
export async function probeAuthMode(base: string): Promise<IdentityMode> {
  // Что означает ответ пробы — `identityProbe.ts` (REFM-154): ответ «не 2xx» это не
  // беда, а «аккаунтов тут нет» (игру часто открывают с обычной раздачи файлов); тело
  // разбирают только у 2xx (голый `res.json()` на HTML-404 бросал SyntaxError в
  // консоль); не дошли до сервера — считаем режим позывных, вход и так выдаст
  // настоящую ошибку. Режим аккаунтов включает ровно живое «да».
  authMode = await identityMode(() => fetch(authStatusUrl(base)));
  const passRow = document.getElementById('cpassrow');
  if (passRow) passRow.style.display = authMode === 'accounts' ? '' : 'none';
  // Возвращаем то же самое, что положили: после `await` компилятор не видит присвоения
  // модульной переменной и сужает её до начального «не знаю», а читать её сразу после
  // пробы нужно именно здесь.
  return authMode;
}

/** A valid session JWT for this server, or null (with the status line explaining).
 *  Zero-friction identity: try LOGIN first; unknown-or-wrong is a uniform 401, so
 *  then try REGISTER — a fresh login creates the account (registration IS the first
 *  login), while a taken one (409) means the password was simply wrong. */
export async function ensureSession(
  base: string,
  login: string,
  passwordArg?: string,
  emailArg?: string,
): Promise<string | null> {
  // Only OUR OWN cached session counts — a token minted for a different callsign
  // (or a legacy unbound one) is ignored and replaced by a fresh login below.
  const mine = tokenFor(localStorage, base, login);
  if (mine) return mine;
  // Правила логина и пароля — в `authRules.ts` (REFM-47): зеркало серверных, чтобы
  // игрок увидел ПРИЧИНУ, а не сухой одинаковый отказ.
  if (!validLogin(login)) {
    game.status(t('acc.nick.rule'));
    return null;
  }
  // Откуда берётся пароль — `authRequest.ts` (REFM-156, правила 1–2): полей ДВА
  // (приветственная карточка и строка браузера матчей), и оба в разметке сразу —
  // берём заполненное. Явно переданный пароль не перебивается полями даже пустой:
  // он обязан дойти до проверки и получить внятную причину.
  const passInput = document.getElementById('cpass') as HTMLInputElement | null;
  const password = passwordFrom(passwordArg, game.welcomePassword(), passInput?.value ?? '');
  if (!validPassword(password)) {
    game.status(t('acc.pass.rule'));
    return null;
  }
  const call = async (
    path: string,
    extra: Record<string, string> = {},
  ): Promise<{ status: number; token?: string; error?: string }> => {
    const res = await fetch(`${httpBase(base)}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login, password, ...extra }),
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
    return { status: res.status, token: body.token, error: body.error };
  };
  try {
    const login1 = await call('/auth/login');
    // Registration carries the optional recovery email (login never needs it).
    // Почта уходит только в регистрацию и только если её ввели (`authRequest.ts`,
    // правило 3): `email: ''` записал бы на учётку пустой адрес.
    const extra = registerExtra(emailArg);
    const reg = shouldRegister(login1) ? await call('/auth/register', extra) : undefined;
    // Причину называет `authRules.ts` — там же правило «401 на входе + 409 на
    // регистрации = неверный пароль», которое иначе свелось бы к «отказу регистрации».
    const outcome = authOutcome(login1, reg);
    // Пропуск — у входа, регистрация вторая (`authRequest.ts`, правило 4).
    const token = mintedToken(login1, reg);
    if (token) {
      saveSession(localStorage, base, { login, token });
      if (outcome === 'created') game.note('✔ ' + t('acc.created'));
      return token;
    }
    game.status(t(AUTH_REASON[outcome]));
    return null;
  } catch {
    game.status(t('acc.server-down'));
    return null;
  }
}

/** Exchange the session for a seat + join token. Клиент запоминает токен для
 *  немедленного коннекта; протухший (15 мин TTL) реконнект просто запрашивает
 *  новый — сессия живёт днями. 401 ⇒ сессия истекла: чистим её и просим пароль. */
export async function fetchJoinToken(
  base: string,
  matchId: string,
  session: string,
  slot?: string,
  faction?: string,
  scientists?: readonly string[],
): Promise<{ token: string; playerId: string } | null> {
  try {
    // REL-7: pass ?slot= to request a specific seat; ?faction= to override the
    // seat's default faction (BF-30: faction decoupled from start point).
    // Сборку запроса и разбор ответа держит `joinRules.ts` (REFM-48) — там же
    // правило «401 стирает сессию», без которого клиент вечно стучится в дверь
    // просроченным пропуском.
    const res = await fetch(
      `${httpBase(base)}/matches/${encodeURIComponent(matchId)}/join${joinQuery(slot, faction, scientists)}`,
      {
        headers: { authorization: `Bearer ${session}` },
      },
    );
    const outcome = joinOutcome(res.status);
    if (outcome !== 'ok') {
      if (dropsSession(outcome)) clearSession(localStorage, base);
      game.status(t(JOIN_REASON[outcome]));
      return null;
    }
    return parseJoinPass(await res.json().catch(() => null));
  } catch {
    game.status(t('acc.server-down'));
    return null;
  }
}

/** Билет получен — отдать его ближайшему дозвону. Кладёт вызывающий, а не
 *  {@link fetchJoinToken}: пока билет шёл по сети, игрок мог выйти, и такой билет
 *  класть нельзя (дозвон проверяет это между получением и выдачей, REFM-205). */
export function holdJoinToken(token: string): void {
  pendingJoinToken = token;
}
/** Билет этого дозвона — и забыть его: one dial per token fetch — a reconnect mints a
 *  fresh one. */
export function takeJoinToken(): string | null {
  const token = pendingJoinToken;
  pendingJoinToken = null;
  return token;
}

/**
 * Захват состоялся — свести строку к адресу партии (ADDR-2 + ADDR-3).
 *
 * В строке остаётся АДРЕС ПАРТИИ (`/game/<id>`), а не просьба занять место: именно её
 * игрок копирует и отдаёт другому, и именно она попадает в закладку. Со `slot`/`faction`
 * внутри отданная ссылка навязывала бы получателю чужой выбор — место ему сервер не
 * отдаст (резолвер откатится на свободное), а вот дом отдаст: для него это НОВЫЙ захват.
 * Чистим ПОСЛЕ захвата, а не до: пока вход не удался, параметры ещё нужны — игрок может
 * уйти логиниться и вернуться доигрывать заход. Тот же приём, что у `?reset=<token>`.
 *
 * `replaceState`, а не `pushState`: аппаратный Back в APK завязан на `history.back()`
 * (см. блок про сигнальную запись в `main.ts`), и лишняя запись в истории превратила бы
 * первый Back из выхода в возврат на то же место.
 */
export function claimDone(matchId: string): void {
  try {
    const settled = settledAddress(location.href, matchId);
    if (settled !== location.href) history.replaceState(null, '', settled);
  } catch {
    /* history/URL недоступны (не браузер) — чистить нечего */
  }
}

/**
 * Отправить игрока на карточку входа, ЗАПОМНИВ его просьбу вступить (`joinGate.ts`,
 * правило 1): после успешного входа `welcomeSignIn` доиграет её сам. Строка пароля
 * показывается только при известном сервере (правило 2) — `srv === null` значит «сначала
 * выбери, куда входишь».
 */
export function askSignIn(
  id: string,
  slot: string | undefined,
  faction: string | undefined,
  srv: { nick?: string } | null,
  scientists: readonly string[] = [],
): void {
  pendingJoinAfterAuth.remember(id, slot, faction, scientists);
  game.showSignIn(srv);
}

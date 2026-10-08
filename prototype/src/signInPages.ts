/**
 * Страницы входа — у одного владельца (REFM-218): приветствие и вход по позывному,
 * регистрация, восстановление доступа, сброс пароля по ссылке из письма и проба режима
 * сервера, которая раскрывает форму новичку. Здесь же переключатель стадий экрана
 * подключения {@link showStage} и позывной для нового командира {@link suggestCallsign}.
 *
 * Поля карточек и замок от двойной отправки — состояние модуля, снаружи его не видно.
 * Загрузочный блок и просьба войти заполняют приветственную карточку дверью
 * {@link fillWelcome}, пароль с неё сессия читает дверью {@link welcomePassword}, ссылку
 * сброса открывает {@link openReset}, пробу на старте запускает {@link startAuthProbe}.
 *
 * Строка статуса, поле позывного обозревателя партий, адрес сервера, хаб, экран
 * подключения и вход в партию живут в `main.ts`; модуль получает их хуками
 * {@link initSignInPages} — импорт оттуда был бы циклом.
 */
import { t } from '../../localization/runtime';
import { httpBase } from '../../decisions/matchQuery';
import { resolveBase } from '../../decisions/serverAddress';
import { saveSession } from '../../decisions/sessionStore';
import { authMode, ensureSession, pendingJoinAfterAuth, probeAuthMode } from './accountSession';
import { detach } from './detach';
import { revealSignup } from './identityProbe';
import { initPasswordReset } from './passwordReset';
import { carryEmail, recoverAnswer, recoverStep } from './recoverForm';
import { callsignFor, checkRegister, nextCallsignNumber, registerPayload } from './registerForm';

/** Что страницам входа нужно от игры. Всё перечисленное живёт в `main.ts`. */
export interface SignInPagesHost {
  /** Строка статуса экрана подключения. */
  status(text: string): void;
  note(text: string): void;
  /** Позывной в поле обозревателя партий: по нему игрока узнают сервер и вход в партию. */
  setNick(nick: string): void;
  /** Адрес сервера и позывной; `null` — строка статуса уже сказала, чего не хватает. */
  resolveServer(): { base: string; nick: string } | null;
  /** Поле адреса сервера, как набрано. */
  serverField(): string;
  showConnect(show: boolean): void;
  showHub(show: boolean): void;
  openHub(note?: string): void;
  connectToMatch(id: string, slot?: string, faction?: string, scientists?: readonly string[]): void;
}

let game: SignInPagesHost;
const $ = (id: string) => document.getElementById(id) as HTMLElement;

/** Архив площадки (`YAG-1.1c`): сброса пароля там нет, ссылка открывает Sector Zero.
 *  Флаг проверяется через `typeof`, потому что модуль читают и тесты, где сборщика с его
 *  `define` нет. Условие стоит прямо в коде, без псевдонима: иначе сборщик не выкинет
 *  сцену сброса из архива (`productCut.test.ts`). */
declare const __SECTOR_ZERO_ONLY__: boolean | undefined;

// --- welcome stage: first-launch identity screen → match browser ------------
// The entry overlay opens on a clean welcome (new commander / sign-in / single-
// player); "Новый командир" and "Вход" reveal the match browser (stage 2). Social
// sign-in is a styled stub until accounts land (docs/accounts-roadmap.md AC-1.1):
// it drops you straight into guest play by callsign, with a "скоро" notice.
let welcomeStageEl: HTMLElement;
let registerStageEl: HTMLElement;
let recoverStageEl: HTMLElement;
let resetStageEl: HTMLElement;
let browseStageEl: HTMLElement;
/** Стадии экрана подключения. Последняя, `browse`, — обозреватель партий: его страница
 *  не здесь, но переключатель у стадий один. */
export function showStage(stage: 'welcome' | 'register' | 'recover' | 'reset' | 'browse'): void {
  welcomeStageEl.style.display = stage === 'welcome' ? '' : 'none';
  registerStageEl.style.display = stage === 'register' ? '' : 'none';
  recoverStageEl.style.display = stage === 'recover' ? '' : 'none';
  resetStageEl.style.display = stage === 'reset' ? '' : 'none';
  browseStageEl.style.display = stage === 'browse' ? '' : 'none';
}

// A fresh callsign for a brand-new commander. Deterministic on purpose (no random/
// time even in UI glue) — the wordlist and the counter arithmetic live in
// `registerForm.ts` (REFM-52); only the storage read/write stays here.
export function suggestCallsign(): string {
  const n = nextCallsignNumber(localStorage.getItem('void.newcount'));
  localStorage.setItem('void.newcount', String(n));
  const pick = callsignFor(n);
  return `${t(pick.key)}-${pick.suffix}`;
}

// «Вход по позывному»: reveal an inline field and enter under a callsign YOU type (vs
// «Новый командир», which auto-suggests one). The chosen callsign is remembered
// (`void.nick`) so the next visit auto-recognises you (the first-run gate above).
// With accounts on the server (authMode) the same form carries a password and the
// welcome card itself registers/logs in (registration IS the first login).
let wLoginEl: HTMLElement;
let wNickInput: HTMLInputElement;
let wPassRowEl: HTMLElement;
let wPassInput: HTMLInputElement;
function signInByCallsign(): void {
  const nick = wNickInput.value.trim();
  if (!nick) {
    wNickInput.focus(); // the empty field IS the message — no status line for it
    return;
  }
  // Same race guard as «Новый командир»: never pick the guest branch while the
  // /auth/status probe is still in flight.
  detach(
    'вход по позывному: ожидание /auth/status',
    authProbe.then(() => {
      if (authMode === 'accounts') {
        detach('вход по позывному: вход', welcomeSignIn(nick));
        return;
      }
      game.setNick(nick);
      localStorage.setItem('void.nick', nick); // remembered — next visit skips the welcome card
      game.openHub();
    }),
  );
}
let signingIn = false; // in-flight guard: Enter + click must not double-register
/** Bytro-style welcome sign-in: register-or-login right on the greeting card, then
 *  land on the hub. Reuses ensureSession (login → 401 → register), so a fresh
 *  callsign creates the account and a known one just logs in. */
async function welcomeSignIn(nick: string): Promise<void> {
  if (signingIn) return; // a second Enter/click while the first runs would double-POST
  signingIn = true;
  try {
    wPassRowEl.style.display = 'flex'; // make sure the password is visible before we demand it
    game.setNick(nick);
    const srv = game.resolveServer();
    if (!srv) return;
    const session = await ensureSession(srv.base, nick);
    if (!session) {
      wPassInput.focus(); // ensureSession already explained why in the status line
      return;
    }
    localStorage.setItem('void.nick', nick);
    wPassInput.value = ''; // the session JWT is stored instead — a password never lingers
    game.status('');
    // If we arrived via `?join=<id>` (or the join button opened the welcome card
    // because no session was cached), resume the join now that we have a JWT — with
    // the seat and faction the player chose, not just the match id.
    const pending = pendingJoinAfterAuth.take();
    if (pending) {
      showStage('browse'); // hide the welcome card
      game.connectToMatch(pending.matchId, pending.slot, pending.faction, pending.scientists);
    } else {
      game.openHub();
    }
  } finally {
    signingIn = false;
  }
}

/** Пароль, набранный на приветственной карточке. */
export function welcomePassword(): string {
  return wPassInput.value;
}

/** Заполнить приветственную карточку: позывной (пустой — придумать новый) и строка пароля.
 *  `focus` — показать и поставить в неё курсор, `show` — только показать, `hide` — спрятать
 *  (сервер без аккаунтов). */
export function fillWelcome(nick: string, password: 'focus' | 'show' | 'hide'): void {
  wNickInput.value = nick || suggestCallsign();
  wPassRowEl.style.display = password === 'hide' ? 'none' : 'flex';
  if (password === 'focus') wPassInput.focus();
}

// --- «Новый командир» → dedicated registration page (its own #connect stage) -------
// Callsign + password + repeat, on a page of its own (no live game behind it). Registration
// IS the first login (ensureSession: login → 401 → register), so a fresh callsign creates
// the account. «Восстановить доступ» is a stub until the accounts backend grows a real reset
// (no email on file yet — docs/accounts-roadmap.md).
let crNickInput: HTMLInputElement;
let crMailInput: HTMLInputElement;
let crPassInput: HTMLInputElement;
let crPass2Input: HTMLInputElement;
function openRegister(): void {
  showStage('register');
  crNickInput.value = crNickInput.value.trim() || suggestCallsign();
  crPassInput.value = '';
  crPass2Input.value = '';
  game.status('');
  crPassInput.focus();
}
async function submitRegister(): Promise<void> {
  // The check ladder and the payload live in `registerForm.ts` (REFM-52): every
  // problem names its own field, and an empty email never reaches the request.
  const form = {
    nick: crNickInput.value,
    pass: crPassInput.value,
    pass2: crPass2Input.value,
    email: crMailInput.value,
  };
  const payload = registerPayload(form);
  if (!payload) {
    const problem = checkRegister(form)!;
    game.status(t(problem.key));
    const focusOn = { nick: crNickInput, pass: crPassInput, pass2: crPass2Input };
    focusOn[problem.field].focus();
    return;
  }
  const nick = payload.nick;
  if (signingIn) return; // Enter + click must not double-register
  signingIn = true;
  try {
    // The callsign the player just typed lives on THIS page (`crnick`), while
    // resolveServer() reads the match browser's field (`cnick`) — empty for a brand-new
    // commander who came straight here from «Новый командир». Without this line the
    // whole registration dead-ended on «введите позывной» and never reached the server.
    game.setNick(nick);
    const srv = game.resolveServer();
    if (!srv) return;
    // Email is OPTIONAL — it exists only so the account can be recovered later; skipping it
    // just means no self-service reset. A malformed one is caught by the server (400).
    const session = await ensureSession(srv.base, nick, payload.pass, payload.email);
    if (!session) {
      crPassInput.focus(); // ensureSession already explained why in the status line
      return;
    }
    localStorage.setItem('void.nick', nick);
    game.setNick(nick);
    crPassInput.value = '';
    crPass2Input.value = '';
    game.status('');
    // Same resume as welcomeSignIn: a `?join=<id>` deep-link (or a «Войти» press with
    // no session yet) routes a BRAND-NEW player through the full registration page —
    // this path used to drop straight into the empty hub, silently abandoning the
    // match they were trying to join (the seat never got claimed).
    const pending = pendingJoinAfterAuth.take();
    if (pending) {
      showStage('browse');
      game.connectToMatch(pending.matchId, pending.slot, pending.faction, pending.scientists);
    } else {
      game.openHub();
    }
  } finally {
    signingIn = false;
  }
}

/** Адрес сервера без позывного — восстановлению и сбросу он не нужен (`serverAddress.ts`,
 *  правило 7): учётку называет почта или токен ссылки, а на новом устройстве позывного ещё
 *  нет. Пустой или битый адрес называется в строке статуса. */
function serverBase(): string | null {
  const step = resolveBase(game.serverField(), location.protocol === 'https:');
  if (step.kind === 'ok') return step.base;
  game.status(t(step.key));
  return null;
}

// --- Password recovery: request a reset link (email → /auth/recover) ------------------
// Anti-enumeration mirrors the server: the confirmation is identical whether or not the
// email is on file. «Восстановить доступ» on the registration page opens this stage.
let crecMailInput: HTMLInputElement;
async function submitRecover(): Promise<void> {
  // Правила формы — `recoverForm.ts` (REFM-161): пустое поле не запрос, а подсказка
  // полю; ответ игроку ОДИН И ТОТ ЖЕ, что бы ни случилось (зеркало анти-перечисления
  // на сервере: разный текст превратил бы форму в проверку «есть ли тут такая учётка»).
  const step = recoverStep(crecMailInput.value);
  if (step.kind === 'need-mail') {
    game.status(t(step.key));
    crecMailInput.focus();
    return;
  }
  const base = serverBase();
  if (!base) return;
  let outcome: 'answered' | 'unreachable' = 'answered';
  try {
    await fetch(`${httpBase(base)}/auth/recover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: step.email }),
    });
  } catch {
    outcome = 'unreachable'; // и это НИЧЕГО не меняет — правило 1
  }
  game.status(t(recoverAnswer(outcome)));
}

// --- Password reset: spend a mailed «?reset=<token>» link (→ /auth/reset) -------------
// Сцена живёт в `passwordReset.ts` (REFM-19); здесь проводка. Сеть и сессии остаются
// тут: модуль не знает ни адреса сервера, ни ключа сессии. Успешный сброс И ЕСТЬ вход —
// сервер отдаёт сессию в ответе, поэтому дальше сразу хаб.
let cresetPassInput: HTMLInputElement;
let cresetPass2Input: HTMLInputElement;
let passwordReset: ReturnType<typeof initPasswordReset> | null = null;

/** Open the reset stage for a «?reset=<token>» deep-link (called from the first-run gate). */
export function openReset(token: string): void {
  // Токен — живая 15-минутная возможность угона аккаунта, поэтому он не должен остаться
  // в адресной строке и истории (referer, «назад», синхронизация между устройствами).
  if (!passwordReset) return;
  const cleaned = passwordReset.open(token, location.href);
  try {
    if (cleaned !== location.href) history.replaceState(null, '', cleaned);
  } catch {
    /* history/URL unavailable (non-browser test env) — nothing to scrub */
  }
}

/** Проба режима сервера: её ждут кнопки приветствия. До старта пробы ждать нечего. */
let authProbe: Promise<void> = Promise.resolve();
// First visit, Bytro-style (SES-2.5 UX): when the server runs accounts, sign-up IS
// the welcome — probe the same-origin default and surface callsign+password on the
// greeting card right away, so a new commander registers before the hub, not deep
// inside the join flow. Probe failure ⇒ nick mode, the card stays as it was.
// The probe ALWAYS runs and is awaited by the welcome buttons (cnew / sign-in), so
// an early tap can't race /auth/status into the guest branch; revealing the form
// applies to first visits only (a remembered nick skipped the welcome card above).
export function startAuthProbe(base: string): void {
  authProbe = (async () => {
    if (!base) return;
    await probeAuthMode(base);
    // Кому раскрывать форму — `identityProbe.ts` (REFM-154, правило 4): только новичку.
    // Запомненный позывной значит, что карточку пропустили: форму никто не увидит, а
    // `suggestCallsign()` затёр бы уже введённое имя. Режим передаётся как есть: прежнее
    // `authMode ? 'accounts' : 'nicks'` осталось с тех пор, когда режим был булевым, а строка
    // истинна всегда — и новичку на сервере без аккаунтов раскрывалось поле пароля.
    if (!revealSignup(authMode, localStorage.getItem('void.nick') ?? '')) {
      return;
    }
    if (!wNickInput.value.trim()) wNickInput.value = suggestCallsign();
    wLoginEl.style.display = 'flex';
    wPassRowEl.style.display = 'flex';
  })();
}

/** Поднять страницы входа: хуки игры, поля карточек, сцена сброса и обработчики. Зовётся
 *  из `main.ts` один раз, до загрузочного блока. */
export function initSignInPages(host: SignInPagesHost): void {
  game = host;
  welcomeStageEl = $('cwelcome');
  registerStageEl = $('cregister');
  recoverStageEl = $('crecover');
  resetStageEl = $('creset');
  browseStageEl = $('cbrowse');
  wLoginEl = $('cwlogin');
  wNickInput = $('cwnick') as HTMLInputElement;
  wPassRowEl = $('cwpassrow');
  wPassInput = $('cwpass') as HTMLInputElement;
  crNickInput = $('crnick') as HTMLInputElement;
  crMailInput = $('crmail') as HTMLInputElement;
  crPassInput = $('crpass') as HTMLInputElement;
  crPass2Input = $('crpass2') as HTMLInputElement;
  crecMailInput = $('crecmail') as HTMLInputElement;
  cresetPassInput = $('cresetpass') as HTMLInputElement;
  cresetPass2Input = $('cresetpass2') as HTMLInputElement;

  passwordReset =
    typeof __SECTOR_ZERO_ONLY__ !== 'undefined' && __SECTOR_ZERO_ONLY__
      ? null
      : initPasswordReset({
          fields: () => ({ pass: cresetPassInput, pass2: cresetPass2Input }),
          status: (msg) => {
            game.status(msg);
          },
          busy: () => signingIn,
          setBusy: (v) => {
            signingIn = v;
          },
          submit: async (token, password) => {
            const base = serverBase();
            if (!base) return null;
            const res = await fetch(`${httpBase(base)}/auth/reset`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ token, password }),
            }).catch(() => null);
            if (!res) return null;
            return { ok: res.ok, body: await res.json().catch(() => ({})) };
          },
          onSuccess: (login, token) => {
            const base = serverBase();
            if (base) saveSession(localStorage, base, { login, token });
            localStorage.setItem('void.nick', login);
            game.setNick(login);
            game.note('✔ ' + t('auth.reset.done'));
            game.openHub();
          },
          showStage: () => {
            game.showConnect(true);
            game.showHub(false);
            showStage('reset');
            // Подсказать менеджеру паролей, К КАКОМУ аккаунту этот новый пароль (скрытое
            // `autocomplete="username"`); без этого запись сохранится ни к чему не привязанной.
            const resetUser = document.getElementById('cresetuser');
            if (resetUser instanceof HTMLInputElement) {
              resetUser.value = (localStorage.getItem('void.nick') ?? '').trim();
            }
          },
        });

  $('cnew').addEventListener('click', () => {
    // «Новый командир» → the dedicated registration PAGE (its own stage of #connect, no live
    // game behind it): callsign + password + repeat. Awaiting the probe closes the race — a
    // tap before /auth/status answers must not take the guest branch on an accounts server.
    // With accounts OFF (nick-only server) there is no password to set, so a new commander
    // just gets a suggested callsign and drops into the hub.
    detach(
      'новый командир: ожидание /auth/status',
      authProbe.then(() => {
        if (authMode === 'accounts') {
          openRegister();
          return;
        }
        game.openHub();
      }),
    );
  });

  wPassInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') signInByCallsign();
  });
  $('clogin').addEventListener('click', () => {
    const show = wLoginEl.style.display === 'none';
    wLoginEl.style.display = show ? 'flex' : 'none';
    game.status('');
    if (show) {
      wNickInput.value = (localStorage.getItem('void.nick') ?? '').trim();
      wNickInput.focus();
    }
  });
  $('cwgo').addEventListener('click', signInByCallsign);
  wNickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') signInByCallsign();
  });
  $('cgoogle').addEventListener('click', () => game.openHub(t('auth.google.soon')));
  $('capple').addEventListener('click', () => game.openHub(t('auth.apple.soon')));

  $('crgo').addEventListener('click', () => detach('регистрация: отправка', submitRegister()));
  crNickInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') crMailInput.focus();
  });
  crMailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') crPassInput.focus();
  });
  crPassInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') crPass2Input.focus();
  });
  crPass2Input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') detach('регистрация: отправка', submitRegister());
  });
  $('crback').addEventListener('click', () => {
    showStage('welcome');
    game.status('');
  });

  $('crrecover').addEventListener('click', () => {
    showStage('recover');
    // Адрес переносим с экрана регистрации (`recoverForm.ts`, правило 3): он его уже
    // вводил строкой выше, а печатать второй раз ровно сейчас — повод бросить.
    crecMailInput.value = carryEmail(crMailInput.value);
    game.status('');
    crecMailInput.focus();
  });
  $('crecgo').addEventListener('click', () =>
    detach('восстановление пароля: отправка', submitRecover()),
  );
  crecMailInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') detach('восстановление пароля: отправка', submitRecover());
  });
  $('crecback').addEventListener('click', () => {
    showStage('welcome');
    game.status('');
  });

  $('cresetgo').addEventListener('click', () => {
    if (passwordReset) detach('сброс пароля: отправка', passwordReset.submit());
  });
  cresetPassInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') cresetPass2Input.focus();
  });
  cresetPass2Input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && passwordReset)
      detach('сброс пароля: отправка', passwordReset.submit());
  });
}

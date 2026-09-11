/**
 * Web-client app shell (Stage 4, CP0.1 — docs/cross-platform-roadmap.md). The first
 * real, buildable entry point: it renders the framework-agnostic welcome-screen
 * view-model into the DOM, binds the shared theme tokens as CSS variables, and drives
 * routing through the pure `resolveWelcomeAction` reducer. It also proves the whole
 * PWA-first bet — the deterministic `@void/shared-core` engine loads and runs in the
 * browser — by building an initial state on launch.
 *
 * This is intentionally thin: map rendering, the network transport and the PWA install
 * layer are later bricks (CP0.2 / CP1.x). No forked copy of the core or its data.
 */
import { createInitialState, type GameState } from '@void/shared-core';
import { t, LOCALE, isLocaleId, setLocale } from '../../../localization/core';
import { theme } from './theme';
import { createWelcomeModel, resolveWelcomeAction, nextCallsign } from './welcomeScreen';
import type { WelcomeModel, WelcomeOutcome, AuthProviderId } from './welcomeScreen';
import { clampCam, zoomAt, type Cam, type Viewport, type Bounds } from './camera';
import { renderMap } from './mapRender';
import { openLiveMatch } from './net';
import { nearestPlanet, myFleetAt, moveAction } from './matchInput';
import { browserIo, createSession, type NetSession } from './session';
import { socketBase } from '../../../decisions/serverAddress';
import { errorTarget, refusalKey } from '../../../decisions/errorRoute';
import { refusalText } from '../../../decisions/refusalText';
import type { MatchSummary } from '@void/protocol';

/** Bind the typed theme tokens to CSS custom properties (docs/main-menu.md §5.4 — one
 *  TS engine → one look). The stylesheet in index.html reads these vars. */
function applyTheme(): void {
  const s = document.documentElement.style;
  const vars: Record<string, string> = {
    '--cyan': theme.cyan,
    '--cyan-dim': theme.cyanDim,
    '--red': theme.red,
    '--amber': theme.amber,
    '--ink': theme.ink,
    '--dim': theme.dim,
    '--line': theme.line,
    '--line-hi': theme.lineHi,
    '--glass': theme.glass,
  };
  for (const [k, v] of Object.entries(vars)) s.setProperty(k, v);
}

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
const esc = (v: string): string => v.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

/** Host owns the callsign sequence (welcomeScreen.ts) — persisted for real later. */
let callsignSeq = 0;

// E_NO_NICK has no entry on purpose: an empty callsign is answered by focusing the
// field, not by a sentence under the card (the reducer still rejects it fail-secure).
const REJECTIONS: Record<string, string> = {
  E_UNKNOWN_PROVIDER: t('err.unknown-provider'),
};

/** Turn a routing outcome into a human status line. Routes are stubbed until the
 *  match browser (CP) lands — this proves the wiring. */
function statusText(outcome: WelcomeOutcome): string {
  if (!outcome.ok) return t('client.status.error', { text: REJECTIONS[outcome.code] ?? outcome.code });
  if (outcome.mode === 'new') {
    const nick = nextCallsign(callsignSeq++);
    const notice =
      outcome.noticeKey === 'guest_stub'
        ? t('client.status.guest-notice', { provider: outcome.provider ?? '—' })
        : '';
    return t('client.status.new-commander', { nick, notice });
  }
  return t('client.status.returning', { nick: outcome.nick ?? t('client.status.returning-fallback') });
}

function render(model: WelcomeModel): void {
  const app = document.getElementById('app');
  if (!app) return;
  // Escaping note: user-facing text (title/tagline/labels/nick) is run through esc();
  // the only unescaped fields (provider id, legal id) are static server config, not input.
  // (excluded from the SEC-2 no-innerhtml-assignment Semgrep rule — see .semgrep/rules/.)
  app.innerHTML =
    `<main class="welcome">` +
    `<div class="crest">◆</div>` +
    `<h1>${esc(model.title)}</h1>` +
    `<p class="tagline">${esc(model.tagline)}</p>` +
    `<button class="btn primary" data-act="newPlayer">${esc(model.newPlayerLabel)}</button>` +
    `<div class="sep"><span>${esc(model.signInWithLabel)}</span></div>` +
    `<div class="providers">` +
    model.providers
      .map(
        (p) =>
          `<button class="btn stub" data-act="signIn" data-provider="${p.id}" title="${p.available ? '' : t('client.provider.soon')}">${esc(p.label)}</button>`,
      )
      .join('') +
    `</div>` +
    `<div class="login"><input id="nick" maxlength="24" placeholder="${esc(model.loginLabel)}" autocomplete="off" />` +
    // Пароль — обычное поле рядом с позывным: у сервера вход ОДИН (`POST /auth/login`),
    // и первый вход им же заводит учётку (`authRules`/`authRequest`, порядок
    // login→register). Отдельного экрана регистрации поэтому нет и не нужно.
    `<input id="pass" type="password" maxlength="72" placeholder="${esc(t('client.auth.password'))}" autocomplete="current-password" />` +
    `<button class="btn" data-act="login">${esc(model.loginLabel)}</button></div>` +
    `<footer>${model.legal.map((l) => `<a data-legal="${l.id}">${esc(l.label)}</a>`).join('<span>·</span>')}</footer>` +
    // Language picker: the ids come from `/localization`, so a new locale file shows up
    // here on its own. Switching persists the choice and reloads — the whole UI is built
    // from `t()` at import time, so a live re-render would leave the old language behind.
    `<div class="langs">` +
    model.languages
      .map(
        (l) =>
          `<button class="lang${l.active ? ' on' : ''}" data-act="lang" data-lang="${l.id}" aria-pressed="${l.active}">${esc(l.label)}</button>`,
      )
      .join('') +
    `</div>` +
    `<div id="status" class="status" role="status" aria-live="polite"></div>` +
    `<div class="engine" id="engine"></div>` +
    `</main>`;
}

function setStatus(text: string): void {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

function loginNick(): string {
  return (document.getElementById('nick') as HTMLInputElement | null)?.value ?? '';
}

function loginPass(): string {
  return (document.getElementById('pass') as HTMLInputElement | null)?.value ?? '';
}

/** Как назвать игроку исход входа. Ключи — на каждую причину своя, потому что ответы
 *  на них РАЗНЫЕ: «пароль не подошёл» чинится паролем, «сервер недоступен» — повтором,
 *  а «слишком часто» — паузой. Слить их в одно «не вышло» значит отправить чинить не то. */
const AUTH_TEXT: Record<string, string> = {
  'wrong-password': 'client.auth.wrong-password',
  'mail-taken': 'client.auth.mail-taken',
  'rate-limited': 'client.auth.rate-limited',
  'register-refused': 'client.auth.refused',
  'login-refused': 'client.auth.refused',
};

/** Вход по-настоящему: `session.signIn` ходит на сервер по правилам `/decisions`
 *  (login → и только неизвестный логин уводит в register), а экран лишь показывает
 *  исход и, если пустили, переключается на список партий. */
async function submitLogin(): Promise<void> {
  const nick = loginNick().trim();
  if (!nick) {
    document.getElementById('nick')?.focus();
    return;
  }
  const res = await session.signIn(nick, loginPass());
  if (res.kind === 'invalid') {
    setStatus(t(res.field === 'login' ? 'client.auth.bad-login' : 'client.auth.bad-password'));
    document.getElementById(res.field === 'login' ? 'nick' : 'pass')?.focus();
    return;
  }
  if (res.kind === 'offline') {
    setStatus(t('client.auth.offline'));
    return;
  }
  if (res.outcome === 'ok' || res.outcome === 'created') {
    setStatus(t(res.outcome === 'created' ? 'client.auth.created' : 'client.auth.hello', { nick }));
    void showMatches();
    return;
  }
  setStatus(t(AUTH_TEXT[res.outcome] ?? 'client.auth.refused'));
}

function wire(model: WelcomeModel): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!target) return;
    switch (target.dataset.act) {
      case 'newPlayer':
        setStatus(statusText(resolveWelcomeAction({ kind: 'newPlayer' }, model)));
        break;
      case 'signIn': {
        const provider = target.dataset.provider;
        if (provider) {
          setStatus(statusText(resolveWelcomeAction({ kind: 'signIn', provider: provider as AuthProviderId }, model)));
        }
        break;
      }
      case 'login':
        void submitLogin();
        break;
      case 'signOut':
        session.signOut();
        location.reload(); // экран строится из t() на импорте — проще перезайти начисто
        break;
      case 'refresh':
        void showMatches();
        break;
      case 'join': {
        const id = target.dataset.match;
        if (id) void joinMatch(id);
        break;
      }
      case 'lang': {
        // Fail-secure: only a known locale id is accepted, and the current one is a no-op
        // (a reload would just throw away what the player typed).
        const id = target.dataset.lang;
        if (isLocaleId(id) && id !== LOCALE) {
          setLocale(id);
          location.reload();
        }
        break;
      }
    }
  });
  app.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    const id = (ke.target as HTMLElement).id;
    if (ke.key === 'Enter' && (id === 'nick' || id === 'pass')) void submitLogin();
  });
}

/** Prove the deterministic core runs in the browser — the whole reason for a web
 *  client (docs/cross-platform-roadmap.md: the client consumes @void/shared-core
 *  directly for its offline preview, no forked copy). */
function showEngine(): void {
  const el = document.getElementById('engine');
  if (!el) return;
  const state = createInitialState({ seed: 'welcome', version: { data: '0.1.0', manifest: '1' } });
  el.textContent = t('client.engine.ready', { time: state.time });
}

let matchStarted = false;

/** Map-space bounding box of a state's planets — the camera's world extent. Guards an
 *  empty map (no planets yet) so the camera math stays finite. */
function boundsOf(state: GameState): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of Object.values(state.planets)) {
    minX = Math.min(minX, p.position.x);
    minY = Math.min(minY, p.position.y);
    maxX = Math.max(maxX, p.position.x);
    maxY = Math.max(maxY, p.position.y);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return { minX, minY, maxX, maxY };
}

/** Optional interaction hooks for the live match: a tap picks a planet, and the current
 *  selection is ringed. Single-player passes none (view-only). */
interface MatchInteract {
  onPickPlanet?: (id: string | null) => void;
  getSelected?: () => string | null;
}

/** Shared map runner: reveals the canvas, wires the shared-camera pan (drag) / zoom
 *  (wheel), and draws `getState()` every frame. A tap (little movement) picks a planet for
 *  the interaction layer. Single-player passes a fixed local state and no interaction; a
 *  live match passes the latest server snapshot + tap→order hooks. */
function runMatch(getState: () => GameState, bounds: Bounds, interact?: MatchInteract): void {
  const canvas = document.getElementById('map') as HTMLCanvasElement | null;
  const g = canvas?.getContext('2d') ?? null;
  if (!canvas || !g) return;
  const app = document.getElementById('app');
  if (app) app.hidden = true;
  canvas.hidden = false;

  let vp: Viewport = { left: 0, top: 0, right: 1, bottom: 1 };
  let cam: Cam = { scale: 1, x: 0, y: 0 };
  let dpr = 1;
  const resize = (): void => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    vp = { left: 0, top: 0, right: w, bottom: h };
    cam = clampCam(cam, vp, bounds);
  };
  resize();
  window.addEventListener('resize', resize);

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      cam = zoomAt(cam, e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12, vp, bounds);
    },
    { passive: false },
  );
  // Drag pans; a tap (little total movement) picks the planet under the pointer.
  let drag: { x: number; y: number } | null = null;
  let down: { x: number; y: number } | null = null;
  let movedPx = 0;
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY };
    down = { x: e.clientX - r.left, y: e.clientY - r.top };
    movedPx = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    movedPx += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
    cam = clampCam({ scale: cam.scale, x: cam.x + (e.clientX - drag.x), y: cam.y + (e.clientY - drag.y) }, vp, bounds);
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', () => {
    if (down && movedPx < 6 && interact?.onPickPlanet) {
      interact.onPickPlanet(nearestPlanet(getState(), down.x, down.y, cam, vp, bounds));
    }
    drag = null;
    down = null;
  });
  canvas.addEventListener('pointercancel', () => {
    drag = null;
    down = null;
  });

  // Планирование следующего кадра ВЫНЕСЕНО из отрисовки намеренно, и это не стиль.
  // Пока `requestAnimationFrame(loop)` стоял последней строкой самого кадра, любое
  // исключение из `renderMap` означало, что следующего кадра не будет НИКОГДА: карта
  // замирала насмерть, а страница оставалась живой (остальное висит на своих
  // обработчиках) — так это и выглядело на первом плейтесте прототипа, где кадр падал
  // на состоянии без RNG. Один плохой кадр — это пропущенная отрисовка, не конец карты.
  let frameErrs = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let lastFrame = 0;
  let visualTime = 0;
  const loop = (frameTime: number): void => {
    const dt = frameTime - lastFrame;
    lastFrame = frameTime;
    if (!document.hidden && !reducedMotion.matches && dt > 0 && dt < 1000) visualTime += dt;
    try {
      const state = getState();
      renderMap(g, state, cam, vp, bounds, {
        now: state.time,
        dpr,
        visualTime,
        selected: interact?.getSelected?.() ?? null,
      });
    } catch (err) {
      // Первые три — со стеком, дальше молчок: падающий кадр иначе забьёт консоль
      // шестьюдесятью строками в секунду и спрячет всё остальное.
      if (frameErrs++ < 3) console.error('frame failed', err);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// No offline-skirmish entry point: the welcome screen is pre-auth, so nothing there may
// start a match. The only way into the map is {@link connectLive} — an authenticated,
// server-hosted session (`?join=`). `gameData.ts` keeps the shipped-map loader for the
// tests and for the match browser to reuse once it lands.

/* ─────────────────────────── Match browser (MIG-2) ─────────────────────────── */

/**
 * Адрес сервера. Клиент отдаётся ТЕМ ЖЕ сервером, с которым говорит, поэтому умолчание —
 * собственный хост страницы; `?server=` оставлен для дев-стенда и чужого хоста. Схему
 * нормализует `socketBase` (решение, общее с прототипом) — в том числе поднимает `ws://`
 * до `wss://` на HTTPS-странице, иначе браузер оборвёт соединение как смешанное
 * содержимое, а выглядело бы это как «сервер не отвечает».
 */
function serverBase(): string {
  const typed = new URLSearchParams(location.search).get('server') ?? location.host;
  return socketBase(typed, location.protocol === 'https:') ?? `ws://${location.host}`;
}

const session: NetSession = createSession(serverBase(), browserIo());

/** Одна строка списка. Всё, что показано, приезжает из read-model сервера
 *  (`@void/protocol`) — клиент ничего про партию не выводит сам. */
function matchRow(m: MatchSummary): string {
  const line = t('client.matches.row', {
    d: m.days + 1,
    seated: m.players.seated,
    capacity: m.players.capacity,
  });
  const badge = m.kind ? `<i class="kind">${esc(m.kind.toUpperCase())}</i>` : '';
  return (
    `<button class="btn row" data-act="join" data-match="${esc(m.matchId)}">` +
    `<b>${esc(m.matchId)}</b>${badge}<span>${esc(line)}</span></button>`
  );
}

/** Список партий вместо приветственной карточки. Свои партии идут первыми: в них уже
 *  есть место, и возврат в свою партию — частый случай, а не поиск новой. */
async function showMatches(): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  const res = await session.matches();
  const nick = session.login() ?? '';
  if (res.outcome !== 'ok' || !res.lists) {
    setStatus(t(res.outcome === 'refused' ? 'client.matches.refused' : 'client.matches.unreachable'));
    return;
  }
  const { active, available } = res.lists;
  const section = (titleKey: string, rows: MatchSummary[]): string =>
    rows.length ? `<h2>${esc(t(titleKey))}</h2>${rows.map(matchRow).join('')}` : '';
  app.innerHTML =
    `<main class="welcome browser">` +
    `<div class="crest">◆</div>` +
    `<p class="tagline">${esc(nick)}</p>` +
    section('client.matches.mine', active) +
    section('client.matches.title', available) +
    (active.length + available.length === 0
      ? `<p class="tagline">${esc(t('client.matches.empty'))}</p>`
      : '') +
    `<div class="login"><button class="btn" data-act="refresh">${esc(t('client.matches.refresh'))}</button>` +
    `<button class="btn stub" data-act="signOut">${esc(t('client.signout'))}</button></div>` +
    `<div id="status" class="status" role="status" aria-live="polite"></div>` +
    `</main>`;
}

/** Взять место и подключиться. Обмен сессии на короткий пропуск и сборку адреса делает
 *  `session.join` по правилам `/decisions`; здесь — только показ причины отказа. */
async function joinMatch(matchId: string): Promise<void> {
  const res = await session.join(matchId);
  if (res.ok) {
    connectLive(res.wsUrl);
    return;
  }
  // Каждая причина названа отдельно: «вход просрочен» чинится повторным входом, «мест
  // нет» — другой партией, «сервер недоступен» — повтором. Общее «не вышло» не помогло бы.
  const TEXT: Record<string, string> = {
    'session-expired': 'client.join.expired',
    'entry-closed': 'net.join-closed',
    'seats-full': 'net.match-full',
    offline: 'client.join.offline',
    failed: 'client.join.failed',
  };
  setStatus(t(TEXT[res.reason] ?? 'client.join.failed'));
  // Сессии больше нет — на карточку входа, иначе игрок жмёт по списку впустую.
  if (res.reason === 'session-expired') {
    render(welcome);
    wire(welcome);
    setStatus(t('client.join.expired'));
  }
}

/** A small fixed overlay for the live-match connection status + a one-line hint (the
 *  welcome-screen #status is hidden once the map canvas takes over). */
function setNetStatus(text: string): void {
  let el = document.getElementById('netstatus');
  if (!el) {
    el = document.createElement('div');
    el.id = 'netstatus';
    el.style.cssText =
      'position:fixed;left:10px;top:10px;z-index:10;max-width:76vw;padding:6px 10px;border-radius:8px;' +
      'font:12px ui-monospace,monospace;color:var(--ink,#bfeee6);pointer-events:none;' +
      'background:rgba(3,14,18,.82);border:1px solid var(--line-hi,#1d6b70);';
    document.body.appendChild(el);
  }
  el.textContent = text;
}

/** CP1.1: connect to a live match over WebSocket, render the server's authoritative
 *  snapshots, AND send orders back — the closed online loop. World extent comes from the
 *  first snapshot; deltas patch the state and the loop always draws the latest. Tap your
 *  fleet's planet to select it, tap another planet to order a move (the server validates,
 *  applies and broadcasts the result). A manual-start lobby WE host is auto-started
 *  (dev/first-cut — a real lobby-wait UI is a later CP). */
function connectLive(url: string): void {
  if (matchStarted) return;
  let live: GameState | null = null;
  let running = false;
  let started = false;
  let me: string | null = null;
  let selectedFleet: string | null = null;
  let seq = 1;
  const hint = (): void => {
    if (me) {
      setNetStatus(
        t('client.net.online', {
          me,
          hint: selectedFleet ? t('client.net.hint-target') : t('client.net.hint-fleet'),
        }),
      );
    }
  };
  setNetStatus(t('client.net.connecting'));
  const { client } = openLiveMatch(url, {
    onStatus: (s) => {
      if (s === 'connecting') setNetStatus(t('client.net.connecting'));
      else if (s === 'closed') setNetStatus(t('client.net.closed'));
    },
    // Отказ рукопожатия. Куда его показать, решает `errorRoute` (общее с прототипом):
    // по устаревшему сокету — никуда, иначе в строку статуса. Причина называется СЛОВАМИ:
    // сервер довёл рукопожатие до конца именно ради объяснения («мест нет», «вход
    // закрыт»), и показать вместо этого `E_MATCH_FULL` значит выбросить объяснение.
    onError: (code) => {
      const where = errorTarget({ current: true, admitted: me !== null, code });
      if (where === 'ignore') return;
      const key = refusalKey(code);
      setNetStatus(`✖ ${key ? t(key) : refusalText(code)}`);
    },
    // ОТКАЗ ПРИКАЗА. До MIG-2 этого обработчика не было вовсе: сервер отвергал приказ,
    // а игрок не видел НИЧЕГО — нажатие просто пропадало. Это и был невыполненный
    // критерий CP1.3 «отказ показывается человеку».
    onRejection: (_actionId, code) => {
      setNetStatus(t('client.rejected', { text: refusalText(code) }));
    },
    onSnapshot: (snap) => {
      live = snap.state;
      if (snap.playerId) me = snap.playerId;
      if (!started && snap.lobby && !snap.lobby.started && snap.lobby.host === snap.playerId) {
        started = true;
        client.start(); // host of an unstarted lobby → run the world
      }
      const waiting = snap.lobby ? !snap.lobby.started : !!snap.waiting;
      if (waiting) {
        setNetStatus(t('client.net.waiting', { suffix: me ? t('client.net.waiting-you', { me }) : '' }));
      }
      else hint();
      if (!running) {
        running = true;
        matchStarted = true;
        const first = live;
        runMatch(() => live ?? first, boundsOf(first), {
          getSelected: () =>
            selectedFleet && live ? (live.fleets[selectedFleet]?.location ?? null) : null,
          onPickPlanet: (planetId) => {
            if (!planetId || !live || !me) {
              selectedFleet = null;
              hint();
              return;
            }
            if (selectedFleet) {
              // second tap → order the selected fleet to move there (server-authoritative)
              const f = live.fleets[selectedFleet];
              if (f && f.location && f.location !== planetId) {
                client.sendAction(moveAction(me, seq++, selectedFleet, planetId));
                setNetStatus(t('client.net.order', { fleet: selectedFleet, planet: planetId }));
                selectedFleet = null;
                return;
              }
              selectedFleet = null;
              hint();
              return;
            }
            // first tap → select one of my fleets at this planet (if any)
            selectedFleet = myFleetAt(live, planetId, me);
            hint();
          },
        });
      }
    },
  });
}

applyTheme();
const welcome = createWelcomeModel();
render(welcome);
wire(welcome);
showEngine();

// CP1.1 deep-link: `?join=<url-encoded ws url>` connects straight to a live match (a shared
// invite, or the dev proto-server). The ws url is encoded so its own ?query survives.
const joinUrl = new URLSearchParams(location.search).get('join');
if (joinUrl) connectLive(joinUrl);

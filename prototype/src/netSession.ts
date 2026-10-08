/**
 * Сетевой жизненный цикл — у одного владельца (REFM-216): дозвон {@link connect},
 * транспортный клиент места с его обработчиками, переподключение после обрыва, пинг и
 * замер производительности и выход из сети {@link leaveNetwork} (REFM-205).
 *
 * Модуль владеет признаком сетевой партии и флагами сокета. То, что читает вся игра, —
 * живые привязки `export let`: признак сети `NET`, впуск `netAdmitted`, клиент `netClient`,
 * цикл переподключения `reconnecting`, часы картинки `netView` и показания служебного
 * наложения. Пишут их только двери модуля: партию для дозвона назначает
 * {@link targetMatch}, кадры для окна замера копит {@link countNetFrame}.
 *
 * Снимок сервера модуль разбирает сам: впуск, свой баннер, часы картинки, таймеры. Мир,
 * выбор, экраны, баннер и строка статуса живут в `main.ts`, и модуль получает их хуками
 * {@link initNetSession}: впуск кладёт дверью `enter`, мир снимка — дверью `takeSnapshot`.
 * Импорт из `main.ts` был бы циклом.
 */
import { t } from '../../localization/runtime';
import {
  MultiplayerClient,
  type MultiplayerChatMessage,
  type MultiplayerPing,
  type MultiplayerSnapshot,
} from '../../packages/client/src/index';
import type { DomainEvent } from '../../packages/shared-core/src/index';
import { errorTarget, refusalKey } from '../../decisions/errorRoute';
import {
  FRAME_WINDOW_EMPTY,
  countFrame,
  framePerfFields,
  noteBlock,
  type LongFrameEntry,
} from '../../decisions/frameTelemetry';
import { joinLanding } from '../../decisions/joinLanding';
import { clientPlan, liveSocket, seatKey } from '../../decisions/netClientReuse';
import { dialIdentity, dialUrl, seatTicketKey } from '../../decisions/netDial';
import { NET_VIEW_IDLE, netViewSnapshot } from '../../decisions/netViewClock';
import { isReconnectBanner, welcomePlan, type WelcomePlan } from '../../decisions/netWelcome';
import { nextCycleStep, redialPlan } from '../../decisions/reconnectCycle';
import { refusalText as errText } from '../../decisions/refusalText';
import { closeAction, isCurrentSocket } from '../../decisions/socketFate';
import {
  authMode,
  fetchJoinToken,
  holdJoinToken,
  sessionRecord,
  sessionToken,
  takeJoinToken,
} from './accountSession';
import { detach } from './detach';
import { dropPing, takeChat, takePing } from './messageLog';
import { showStage } from './signInPages';
import { WAIT_MARK, waitingBanner } from './snapshotIngest';
import type { SoundId } from './sound';

/** Что сетевому циклу нужно от игры. Всё перечисленное живёт в `main.ts`. */
export interface NetSessionHost {
  /** Строка статуса экрана подключения. */
  status(text: string): void;
  /** Что в ней сейчас написано: причину отказа уносят на видимый экран. */
  statusText(): string;
  note(text: string): void;
  sound(id: SoundId): void;
  /** Баннер поверх карты. Свой «переподключение…» модуль ставит и снимает сам. */
  banner(): string | null;
  setBanner(text: string | null): void;
  /** Уйти из локальной игры перед дозвоном: соло и забег. */
  leaveLocal(): void;
  /** Адрес сервера и позывной; `null` — строка статуса уже сказала, чего не хватает. */
  resolveServer(): { base: string; nick: string } | null;
  /** Впуск: место игрока и сброс хвостов прошлой сессии (`netWelcome.ts`, правила 2 и 5). */
  enter(playerId: string | undefined, fanfare: boolean): void;
  /** Мир снимка: состояние, геометрия карты, туман, радар, выбор, пропущенная дипломатия. */
  takeSnapshot(snap: MultiplayerSnapshot, plan: WelcomePlan): void;
  /** События дельты — в тот же конвейер, что у локального мира. */
  events(events: DomainEvent[]): void;
  /** Провинция под меткой на текущей карте. */
  pingProvince(target: MultiplayerPing['target']): string | null;
  closePingPop(): void;
  /** Сглаженный FPS для сэмпла замера. */
  fps(): number;
  showConnect(show: boolean): void;
  connectShown(): boolean;
  openHub(note?: string): void;
  /** Игрок пришёл по ссылке входа. */
  cameFromLink(): boolean;
}

let game: NetSessionHost;

// When connected, the server is authoritative: snapshots replace `s`, orders are
// sent (not applied locally), and the local sim/AI is suspended (see frame()).
export let NET = false;
// BF-30: true once the server's welcome snapshot has been received and ME is set to
// the correct playerId. Until then, the map must NOT render — the default `ME = 'p1'`
// would paint a spawn at p1's start before the server assigns the real seat.
export let netAdmitted = false;
/** The match this client is in / will (re)connect to. Set when joining from the menu
 *  ({@link targetMatch}); `connect()` (and auto-reconnect) dial `/matches/<currentMatchId>`. */
let currentMatchId = 'proto';
export let netClient: MultiplayerClient | null = null;
let netSock: WebSocket | null = null;
/** Место (сервер+матч+позывной), к которому привязан живой `netClient` — `netClientReuse.ts`
 *  (NETA2-5). Клиент переживает дозвоны в ЭТО место вместе со своей очередью приказов;
 *  дозвон в другое начинается с чистого клиента. */
let netSeat: string | null = null;
/** Ключ билета места для текущего клиента: его обработчик `onSeatTicket` живёт дольше
 *  одного сокета, поэтому ключ читается отсюда, а не из замыкания дозвона. */
let netTicketKey = '';
/** Текущий сокет получил приветственный снимок (нас впустили). Было локальной переменной
 *  дозвона; переехало наверх, потому что обработчики клиента теперь переживают сокет. */
let socketAdmitted = false;
// M0 net telemetry (dev overlay): smoothed round-trip ms, and a desync check that
// compares our reconstructed view to the server's hash on the snapshots that carry one.
export let rttEma: number | null = null;
// Часы картинки в сети (`netViewClock.ts`): снимок сервера приходит раз в секунду, и без
// досчёта флоты на карте двигались бы рывками раз в секунду при любом FPS.
export let netView = NET_VIEW_IDLE;
let pingTimer: ReturnType<typeof setInterval> | null = null;
// M2 perf telemetry: a light fps/rtt/mem sample every 30s while in a network match —
// lands in the server's metrics stream (observe → JSONL/сводка), never answered.
let perfTimer: ReturnType<typeof setInterval> | null = null;
const PERF_SAMPLE_MS = 30_000;
// Долгие кадры окна сэмпла (`frameTelemetry.ts`): интервалы копит `frame()` дверью
// `countNetFrame`, самую долгую блокировку главного потока — наблюдатель Long Animation
// Frames; сэмпл забирает окно.
let frameWin = FRAME_WINDOW_EMPTY;
export let netDesync = false; // the last hash verdict was a mismatch (server vs our rebuild)
export let netDesyncCount = 0; // how many mismatches were caught this session (one per resync)
// Auto-reconnect: on an UNEXPECTED drop (not a user action), rejoin our seat with
// backoff — the server keeps the match running and the nick maps us back.
let userClosed = false;
export let reconnecting = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function initNetSession(host: NetSessionHost): void {
  game = host;
  // Long Animation Frames есть только в Chromium; где его нет, полей о блокировке в сэмпле нет.
  if (
    typeof PerformanceObserver !== 'undefined' &&
    (PerformanceObserver.supportedEntryTypes ?? []).includes('long-animation-frame')
  ) {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as LongFrameEntry[]) {
        frameWin = noteBlock(frameWin, e);
      }
    }).observe({ type: 'long-animation-frame' });
  }
}

/** Партия, в которую звонить. Новая цель начинает с чистого цикла: прежний дозвон гаснет,
 *  счётчик попыток обнуляется, а выход игрока из прошлой партии больше не держит. */
export function targetMatch(id: string): void {
  currentMatchId = id;
  reconnecting = false;
  reconnectAttempts = 0;
  userClosed = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

/** Кадр в окно замера: интервалы копит `frame()`, сэмпл забирает окно целиком. */
export function countNetFrame(dt: number): void {
  frameWin = countFrame(frameWin, dt);
}

/** Забыть клиента вместе с его очередью приказов (NETA2-5). Зовётся там, где очередь
 *  становится недоставимой по существу: игрок вышел сам или цикл переподключения
 *  сдался. Копить приказы дальше значило бы доставить их в чужую партию. */
function dropNetClient(): void {
  netClient = null;
  netSeat = null;
}

/** Погасить телеметрию соединения: пинг и замер производительности живут, пока жив сокет. */
function stopNetTimers(): void {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (perfTimer) {
    clearInterval(perfTimer);
    perfTimer = null;
  }
  rttEma = null;
}

/**
 * Уйти из сети — одна дверь для каждого выхода из партии (REFM-205, зовёт её `leaveMatch`).
 * Раньше это были шесть копий трёх флагов, и копии разошлись: три не закрывали сокет, и ни
 * одна не гасила цикл переподключения. На обрыве `NET` уже ложен, а таймер дозвона жив,
 * поэтому ⌂ уводил игрока в хаб, а дозвон через секунду возвращал его в партию, из которой
 * он ушёл (нашёл `smoke:net`). Отсюда три правила:
 *
 * 1. Дверь работает и вне сетевой партии: гасит таймер и счётчик дозвона и снимает СВОЙ
 *    баннер «переподключение…», чужие («ждём хоста», итог матча) не трогает.
 * 2. Сокет забывается ДО закрытия. Его позднее `close` (как и запоздавший снимок) видит
 *    чужой сокет и ничего не трогает, иначе отказ до впуска посадил бы игрока в хаб или на
 *    карточку входа из того места, куда он ушёл (ADDR-5). Телеметрию гасим здесь же:
 *    обработчик закрытия до неё больше не дойдёт.
 * 3. Вместе с клиентом уходит его очередь приказов (NETA2-5): приказ, отданный на обрыве,
 *    не должен догнать игрока, когда тот снова сядет на это место.
 */
export function leaveNetwork(): void {
  userClosed = true;
  NET = false;
  netAdmitted = false;
  reconnecting = false;
  reconnectAttempts = 0;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (isReconnectBanner(game.banner())) game.setBanner(null);
  stopNetTimers();
  const sock = netSock;
  netSock = null;
  sock?.close();
  dropNetClient();
}

/**
 * Транспортный клиент для этого места — прежний со своей очередью или новый
 * (`netClientReuse.ts`, NETA2-5).
 *
 * Обработчики регистрируются ОДИН РАЗ на клиента и переживают дозвоны, поэтому здесь их
 * больше не замыкают на конкретный сокет: устаревший провод отсекается один раз, во
 * входной точке `sock.onmessage`, а «нас впустили» переехало в `socketAdmitted`.
 */
function netClientFor(seat: string): MultiplayerClient {
  const existing = netClient;
  if (existing && clientPlan({ hasClient: true, sameSeat: netSeat === seat }) === 'reuse') {
    return existing;
  }
  netSeat = seat;
  const client = new MultiplayerClient(
    liveSocket(() => netSock),
    {
      onStatus: () => {
        // Intentionally no-op on "open": admission is confirmed by the first
        // welcome snapshot (see onSnapshot), not by the socket opening.
      },
      onSeatTicket: (ticket) => {
        // The server minted our seat ticket (first join of this nick) — persist it;
        // every later join must present it, and the server can't re-issue (hash-only).
        localStorage.setItem(netTicketKey, ticket);
      },
      onPong: (_serverTime, clientTime) => {
        if (clientTime === undefined) return;
        const rtt = performance.now() - clientTime;
        rttEma = rttEma === null ? rtt : rttEma * 0.7 + rtt * 0.3;
      },
      // Desync check (M0): the server tags every full snapshot, and a delta every few
      // seconds, with hashState(view); the transport compares our rebuilt view with it —
      // in slices over the next frames, so a verdict lands a little after its snapshot.
      // Mismatch ⇒ the client and server disagree — the core invariant we most want to
      // catch on a playtest.
      onHashCheck: (_seq, match) => {
        netDesync = !match;
        if (netDesync) netDesyncCount++;
      },
      onSnapshot: (snap) => {
        // Что значит этот снимок — `netWelcome.ts` (REFM-144): вход подтверждает первый
        // снимок и ровно один раз на сокет, переподключение входит молча (это не новый
        // матч), и вход снимает только СВОЙ баннер.
        const plan = welcomePlan({ admitted: socketAdmitted, reconnecting, banner: game.banner() });
        game.setBanner(plan.banner);
        if (plan.admit) {
          // Server accepted us — NOW we're really in the match.
          socketAdmitted = true;
          netAdmitted = true; // BF-30: ME is now the server-assigned seat — safe to render
          reconnecting = false; // a fresh welcome ends any reconnect cycle
          reconnectAttempts = 0;
          NET = true;
          game.enter(snap.playerId, plan.fanfare);
          // Latency probe: ping every 2s with a client timestamp the pong echoes.
          if (pingTimer) clearInterval(pingTimer);
          pingTimer = setInterval(() => netClient?.ping(performance.now()), 2000);
          netClient?.ping(performance.now()); // seed an RTT reading immediately
          // Perf sample (M2): smoothed fps + rtt + JS-heap (Chrome-only field) + the
          // window's long frames, every 30s — cheap enough to never matter, useful on
          // every playtest. The window starts with the match, not with the hub before it.
          if (perfTimer) clearInterval(perfTimer);
          frameWin = FRAME_WINDOW_EMPTY;
          perfTimer = setInterval(() => {
            const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
              ?.usedJSHeapSize;
            netClient?.sendPerf({
              fps: Math.round(game.fps()),
              ...(rttEma !== null ? { rttMs: Math.round(rttEma) } : {}),
              ...(mem !== undefined ? { memMb: Math.round(mem / 1048576) } : {}),
              ...framePerfFields(frameWin),
            });
            frameWin = FRAME_WINDOW_EMPTY;
          }, PERF_SAMPLE_MS);
        }
        netView = netViewSnapshot(
          plan.admit ? NET_VIEW_IDLE : netView,
          snap.state.time,
          performance.now(),
        );
        game.takeSnapshot(snap, plan);
        // No lobby (SES-2.1): sessions run from creation, a join lands in a live
        // world. `waiting` survives only for the transport's waitForPlayers mode
        // (unused by our hosts) — show the banner, clear it once the clock runs.
        const wait = waitingBanner(!!snap.waiting, game.banner());
        if (wait === 'show') game.setBanner(WAIT_MARK + ' ' + t('net.waiting-host'));
        else if (wait === 'clear') game.setBanner(null);
      },
      onRejection: (_id, code) => {
        game.sound('error');
        game.note('✖ ' + errText(code));
      },
      // Fog-filtered domain events ride each delta (the server already cuts what we
      // may not see): feed them to the SAME pipeline the local sim uses, so battle
      // toasts, AA tracers, siege arcs, loss tallies and the victory banner all work
      // in a network match too. Fired after onSnapshot — `s` is already up to date.
      onEvents: (events) => {
        game.events(events);
      },
      // Server-relayed ally pings (own + allies, hidden from enemies): merge them into
      // the coalition channel so they render as map markers + chat lines, same as solo.
      // Ретранслированные строки берёт лента (`messageLog.ts`, разбор — `relayIntake.ts`):
      // личность строки назначает сервер, эхо и повтор при входе её не удваивают.
      onPingAdded: (ping: MultiplayerPing) => {
        takePing(ping, game.pingProvince(ping.target));
      },
      onPingRemoved: (pingId: string) => {
        dropPing(pingId);
        game.closePingPop();
      },
      onChatMessage: (m: MultiplayerChatMessage) => {
        takeChat(m);
      },
      onError: (code) => {
        // Где игрок увидит отказ — `errorRoute.ts` (REFM-149): отказ устаревшего сокета
        // не наш, отказ после входа идёт тостом (экран подключения уже скрыт), отказ до
        // входа — в строку этого экрана, и причина называется словами, а не кодом.
        // Устаревший сокет отсечён раньше — в `sock.onmessage` (клиент теперь один на
        // всё присутствие, и до него доходит только текущий провод), поэтому здесь
        // отказ всегда наш; отказ из самого клиента (`E_OUTBOX_FULL`) — тем более.
        const target = errorTarget({ current: true, admitted: socketAdmitted, code });
        if (target === 'ignore') return;
        if (target === 'toast') {
          game.note('✖ ' + errText(code));
          return;
        }
        // NETA2-1: the server COMPLETED the handshake just to tell us why — a real
        // refusal, not "server down". Say it plainly instead of a generic error.
        const key = socketAdmitted ? null : refusalKey(code);
        game.status(key ? t(key) : t('net.error', { code }));
      },
    },
  );
  netClient = client;
  return client;
}

export function connect(): void {
  game.leaveLocal();
  const srv = game.resolveServer();
  if (!srv) return;
  const { base, nick } = srv;
  // Seat lock (REL-5): the ticket the server minted for this seat on first join —
  // presented back on every reconnect so nobody else can take the seat by typing
  // our nick. Keyed per server+match+nick (the ticket is seat-scoped).
  const ticketKey = seatTicketKey(base, currentMatchId, nick);
  const seatTicket = localStorage.getItem(ticketKey);
  // Чем представляемся и как это ложится в адрес — `netDial.ts` (REFM-142). Там же
  // причины: два способа не смешиваются (в режиме аккаунтов ник и билет сервер
  // отвергнет), билет привязан к тройке «сервер + матч + позывной», а всё уходящее в
  // адрес экранируется — позывной вводит человек.
  const url = dialUrl(
    base,
    currentMatchId,
    dialIdentity(authMode === 'accounts', takeJoinToken(), nick, seatTicket),
  );
  game.status(t('net.connecting', { nick }));
  localStorage.setItem('void.server', base);
  localStorage.setItem('void.nick', nick); // resume this seat next visit

  // WS "open" only means the socket connected, not that the server admitted us — it
  // may still reject (slot taken / unknown player). Flip to "in the match" only on
  // the first welcome snapshot, so a rejected join never flashes the map.
  socketAdmitted = false;
  if (netSock) netSock.close();
  const sock = (netSock = new WebSocket(url));
  // Клиент привязан к МЕСТУ, а не к сокету (NETA2-5): дозвон в то же место берёт прежнего
  // вместе с его очередью приказов, дозвон в другое — заводит чистого.
  netTicketKey = ticketKey;
  const client = netClientFor(seatKey(base, currentMatchId, nick));
  sock.onopen = () => client.open();
  // Устаревший сокет не трогает общее состояние (`socketFate.ts`, REFM-143): его снимок
  // переписал бы игру чужой, уже закрытой сессией. Проверка стоит ЗДЕСЬ, а не в каждом
  // обработчике: клиент теперь один на всё присутствие в матче (NETA2-5), и это
  // единственная дверь, через которую в него входят чужие сообщения.
  sock.onmessage = (ev) => {
    if (!isCurrentSocket(sock, netSock)) return;
    client.receive(String(ev.data));
  };
  sock.onclose = () => {
    // Что значит это закрытие — `socketFate.ts` (REFM-143): устаревший сокет (игрок
    // нажал «Подключиться» ещё раз) НЕ должен рушить свежую сессию — его позднее
    // закрытие погасило бы её таймеры и выбросило оверлей поверх живой игры.
    const fate = closeAction({
      current: isCurrentSocket(sock, netSock),
      inMatch: NET,
      userClosed,
      reconnecting,
      admitted: socketAdmitted,
    });
    if (fate === 'ignore') return;
    stopNetTimers();
    // Закрытие, затеянное игроком, сюда не доходит: выход идёт через `leaveNetwork`, а она
    // забывает сокет до закрытия, и `closeAction` видит чужой сокет (REFM-205).
    if (fate === 'reconnect') {
      NET = false;
      netAdmitted = false;
      // unexpected drop → auto-rejoin our seat (the match keeps running server-side)
      game.note(t('net.reconnecting'));
      // Клиент переживает обрыв (NETA2-5): с этой секунды приказы копятся у него в
      // очереди и уйдут сами на реконнектном `welcome` — под свежей сессией и свежим
      // `clientSeq`, поэтому подделать их обрывом нельзя.
      netClient?.connectionLost();
      reconnecting = true;
      scheduleReconnect();
    } else if (fate === 'retry-admit') {
      scheduleReconnect(); // a reconnect attempt failed to admit → back off and retry
    }
    // `keep-reason`: нас не впустили — ответ сервера уже в строке статуса, и стирать
    // его нечем (правило 4). Пришедшего через экран подключения он там и прочитает. А вот
    // пришедшему ПО ССЫЛКЕ возвращаться некуда: экрана, с которого он начал, у него нет.
    // Его сажаем на видимый экран (ADDR-5) — причина уезжает с ним, а решение о том, куда
    // именно, не зависит от кода отказа: иначе ссылка стала бы оракулом существования
    // партий. Признак берётся из `cameFromLink`, а не из невидимости оверлея: оверлей
    // теперь держится до впуска, чтобы не показывать карту тому, кого могут не пустить.
    // Только для отказа ДО впуска. Впущенный сокет сюда не относится: обрыв в партии
    // переподключается молча, а `keep-reason` у впущенного значит, что игрок ушёл сам
    // (выходы гасят `NET` до закрытия) и уже стоит там, куда просился. Без этой
    // оговорки обрыв выкидывал из партии на карточку входа, а ⌂ вёл не в хаб, а на неё
    // же (нашёл `smoke:net`).
    if (
      fate === 'keep-reason' &&
      !socketAdmitted &&
      (game.cameFromLink() || !game.connectShown())
    ) {
      const reason = game.statusText();
      const srv = game.resolveServer();
      const landing = joinLanding({
        identity: authMode,
        hasSession: srv ? !!sessionRecord(srv.base) : false,
        refused: true,
      });
      if (landing === 'hub') game.openHub(reason);
      else {
        game.showConnect(true);
        showStage('welcome');
      }
    }
  };
  sock.onerror = () => {
    if (!isCurrentSocket(sock, netSock)) return; // ошибка устаревшего сокета — не наша
    // Сокет не открылся: сервер не отвечает или адрес неверный. До REFM-216 здесь стояла
    // английская строка мимо локали, и русский игрок читал её как есть.
    game.status(t('acc.server-down'));
  };
}

// Auto-reconnect after an unexpected drop: rejoin our seat with capped exponential backoff
// (1,2,4,8,8,… s). The budget (`reconnectDelayMs`, NETA2-2) OUTLASTS the server's ~30s
// socket-reap window on purpose — a reconnect within the reap must not give up before the
// old socket frees the seat (else it loses the race with `E_SLOT_TAKEN`). Same saved
// server + nick → same side.
function scheduleReconnect(): void {
  // Политика цикла — `reconnectCycle.ts` (REFM-145): одна назначенная попытка за раз (к
  // одному обрыву приходит несколько сигналов), счётчик растёт сквозь дозвоны, а
  // исчерпанный бюджет заканчивается честной сдачей, а не молчанием.
  const step = nextCycleStep({ timerPending: !!reconnectTimer, attempts: reconnectAttempts });
  if (step.kind === 'busy') return;
  reconnectAttempts++;
  if (step.kind === 'give-up') {
    reconnecting = false;
    reconnectAttempts = 0;
    game.setBanner(null);
    dropNetClient(); // бюджет исчерпан — доставлять очередь больше некуда (NETA2-5)
    game.status(t('acc.reconnect-failed'));
    game.showConnect(true);
    return;
  }
  game.setBanner(t('acc.reconnecting'));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    // Accounts mode (SES-2.5): the join token is short-lived (15 min), so a redial
    // mints a fresh one off the long-lived session first; an expired session drops
    // the redial to the connect screen with «введите пароль» (fail-explicit).
    const accounts = authMode === 'accounts';
    const srv = accounts ? game.resolveServer() : null;
    const session = srv ? sessionToken(srv.base) : null;
    const plan = redialPlan(accounts, !!session);
    if (plan === 'dial') {
      connect(); // reuse the saved server + nick; don't reset the attempt counter
      return;
    }
    if (plan === 'mint-token' && srv && session) {
      detach(
        'переподключение: новый билет',
        (async () => {
          const join = await fetchJoinToken(srv.base, currentMatchId, session);
          // Игрок вышел, пока ждали билет: `leaveNetwork` погасил цикл, и дозвон вернул бы
          // его в партию, из которой он ушёл (REFM-205).
          if (!reconnecting) return;
          if (!join) {
            scheduleReconnect(); // transient (or session expired — status line explains)
            return;
          }
          holdJoinToken(join.token);
          connect();
        })(),
      );
      return;
    }
    reconnecting = false; // сессии нет — на экран входа, а не в новый круг попыток
    game.setBanner(null);
    game.showConnect(true);
  }, step.delayMs);
}

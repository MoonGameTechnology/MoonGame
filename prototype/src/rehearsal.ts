import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { WebSocket, type RawData } from 'ws';
import { ActionGate, createActionEnvelope } from '../../packages/action-layer/src/index';
import {
  CLIENT_ACTION_TYPES,
  applyDelta,
  hashState,
  isValidActionPayload,
  visibleState,
  type GameState,
} from '../../packages/shared-core/src/index';
import {
  createMultiplayerServer,
  hmacSecret,
  signJoinToken,
  SOCKET_FLOOD_MAX,
  SOCKET_FLOOD_WINDOW_MS,
  type ActionReceipt,
  type ServerMessage,
  type ServerWelcomeMessage,
  type StoredReceipt,
} from '../../packages/server/src/index';
import { createDevMatch, loadShippedData } from '../../packages/server/src/scenario';
import { startClockDriver } from '../../packages/server/src/clockDriver';
import type { RoomObservation } from '../../packages/server/src/matchRoom';
import { LazyRoomRegistry } from '../../packages/server/src/roomRegistry';
import { createStores, type Stores } from '../../packages/server/src/persistence';
import type { MatchSnapshot } from '../../packages/server/src/store';
import { aiOrders } from './ai';

export interface RehearsalOptions {
  players: number;
  latencyMs: number;
  persistDelayMs: number;
  timeoutMs: number;
  /** RESIL-5 — сколько ИГРОВЫХ часов прожить «живой» фазой после проверки провода.
   *  `0` (по умолчанию) её выключает: остальные фазы утверждают ТОЧНЫЕ счётчики
   *  действий, и трафик ботов их сдвинул бы. Гоняется отдельным тестом и из CLI
   *  (`GAME_HOURS=24 pnpm run rehearsal`). */
  gameHours: number;
  /** Потолок приказов от одного бота за игровой час. Держит прогон быстрым и не даёт
   *  боту упереться в анти-флуд провода вместо игры. */
  botActionsPerHour: number;
  /** RESIL-6 — строка подключения к НАСТОЯЩЕМУ Postgres. Задана ⇒ durable-путь идёт
   *  через `PostgresMatchStore`/`PostgresReceiptStore`, и перезапуск поднимает мир из
   *  БАЗЫ. Пусто (по умолчанию) ⇒ прежняя память с искусственной задержкой. */
  databaseUrl?: string;
  /** RESIL-6 — прогнать фазу СНА: матч без зрителей засыпает (сохраняется и выгружается
   *  из памяти), просыпается по собственному следующему событию и живёт дальше, пока не
   *  подключён никто. Это обещание круглосуточного мира, и до сих пор его не проверял
   *  ни один сквозной прогон. */
  hibernate: boolean;
  /** RESIL-6 — прогнать фазу НЕВЗГОД СЕТИ: потерянный по дороге приказ, обрыв сокета без
   *  закрывающего рукопожатия, уснувшая вкладка с отложенным разбором дельт. */
  networkTrouble: boolean;
}

export interface RehearsalReport {
  players: number;
  actionsAccepted: number;
  duplicatesPrevented: number;
  reconnects: number;
  serverRestarts: number;
  durableWrites: number;
  wireActionTypes: number;
  wireActionsApplied: number;
  wireActionsRejectedByRules: number;
  hashMismatches: number;
  fogViolations: number;
  finalSequence: number;
  durationMs: number;
  /** RESIL-5, живая фаза. `gameHours` 0 ⇒ она не запускалась и остальные три нули. */
  gameHours: number;
  /** Приказов, отправленных ботами по НАСТОЯЩЕМУ проводу (через гейт и квитанции). */
  botActions: number;
  /** Тик не сдвинул время, пока работа просрочена, — застой часов. Должен быть 0. */
  stalls: number;
  /** У запланированного события бросил обработчик, и его выбросили. Должен быть 0. */
  deadLetters: number;
  /** RESIL-6. `'postgres'` — durable-путь шёл через настоящую базу и мир поднимался из
   *  неё; `'memory'` — подменён задержкой (прежнее поведение). */
  storeKind: 'memory' | 'postgres';
  /** Состояние пережило круг через JSONB без единого расхождения? Только при
   *  `'postgres'`: сравниваются хэши состояния до записи и после чтения. */
  jsonbRoundTripOk: boolean;
  /** Матч засыпал (сохранён и выгружен из памяти) столько раз. */
  hibernations: number;
  /** Спящий матч просыпался по своему событию столько раз. */
  wakes: number;
  /** На сколько игровых мс мир ушёл вперёд, пока не было НИ ОДНОГО подключения. */
  offlineAdvanceMs: number;
  /** Приказов, потерянных по дороге (клиент считает, что отправил). */
  droppedOrders: number;
  /** Отказов `E_OUT_OF_ORDER`: строгий шлюз увидел разрыв в `clientSeq` после потери. */
  sequenceGaps: number;
  /** Обрывов сокета без закрывающего рукопожатия. */
  abruptDrops: number;
  /** Дельт, разобранных пачкой после «пробуждения вкладки». */
  backlogDeltas: number;
}

const DEFAULTS: RehearsalOptions = {
  players: 4,
  latencyMs: 75,
  persistDelayMs: 15,
  timeoutMs: 10_000,
  gameHours: 0,
  botActionsPerHour: 2,
  hibernate: false,
  networkTrouble: false,
};

/** One schema-valid payload for every action type exposed to an untrusted client.
 * The scenarios are intentionally not all legal in the compact dev state: this matrix
 * proves the complete wire path reaches the authoritative reducer (a rule rejection is
 * acceptable), while the modules' focused tests own each mechanic's success semantics.
 * Sibling catalog, different question: `gateparity.test.ts` samples the prototype's REAL
 * builders against the schemas (builder↔schema drift). This one is keyed on the schema
 * catalog itself and is checked for completeness below, so a new action type cannot ship
 * without a wire sample. */
const WIRE_PAYLOADS: Record<string, unknown> = {
  'fleet.move': { fleetId: 'p1_1', to: 'nexus' },
  'fleet.stop': { fleetId: 'p1_1' },
  'fleet.orbit': { fleetId: 'p1_1', orbit: 'near' },
  'fleet.bombard': { fleetId: 'p1_1', on: true },
  'fleet.assault': { fleetId: 'p1_1' },
  'fleet.retreat': { fleetId: 'p1_1' },
  'army.load': { fleetId: 'p1_1', unit: 'militia', count: 1 },
  'army.unload': { fleetId: 'p1_1', unit: 'militia', count: 1 },
  'hero.move': { to: 'home_p1' },
  'planet.annihilate': { planetId: 'nexus' },
  'hero.ability': { heroId: 'hero:p1', abilityId: 'scan', target: 'nexus' },
  'hero.spawn': { heroId: 'hero:p1', at: 'home_p1' },
  'hero.skill.unlock': { heroId: 'hero:p1', node: 'neural_lace' },
  'hero.equip': { heroId: 'hero:p1', abilityId: 'scan' },
  'hero.install': { heroId: 'hero:p1', moduleId: 'ion_engine' },
  'hero.uninstall': { heroId: 'hero:p1', moduleId: 'ion_engine' },
  'hero.unequip': { heroId: 'hero:p1', abilityId: 'scan' },
  'station.deploy': { planetId: 'home_p1' },
  'seat.claim': { faction: 'missing-faction', scientists: [] },
  'building.construct': { planetId: 'home_p1', building: 'mine' },
  'building.upgrade': { planetId: 'home_p1', building: 'spaceport' },
  'unit.build': { planetId: 'home_p1', unit: 'cruiser', count: 1 },
  'construction.cancel': { planetId: 'home_p1', seq: 0 },
  'construction.resume': { planetId: 'home_p1', id: 0 },
  'technology.research': { technology: 'propulsion_1' },
  'technology.boost': { technology: 'propulsion_1' },
  'espionage.spy': { target: 'p2', kind: 'treasury' },
  'market.list': { side: 'sell', resource: 'metal', amount: 1, price: 1 },
  'market.take': { id: 'missing-lot', amount: 1 },
  'market.cancel': { id: 'missing-lot' },
  'diplomacy.declare': { target: 'p2', stance: 'war' },
  'diplomacy.mapshare': { target: 'p2', on: true },
  'fleet.launch': { planetId: 'home_p1' },
  'fleet.merge': { from: 'p1_1', into: 'missing-fleet' },
  'fleet.split': { fleetId: 'p1_1', take: [{ unit: 'scout_drone', count: 1 }] },
  'fleet.engage': { fleetId: 'p1_1', targetId: 'missing-fleet' },
  'shuttle.strike': {
    planetId: 'C0R1',
    unit: 'interceptor',
    count: 1,
    targetFleetId: 'missing-fleet',
  },
  'shuttle.load': { fleetId: 'p1_1', unit: 'interceptor', count: 1 },
  'shuttle.unload': { fleetId: 'p1_1', unit: 'interceptor', count: 1 },
  'capital.designate': { planetId: 'home_p1' },
  'steward.delegate': { posture: 'defend', until: 10_000 },
  'steward.recall': {},
  'steward.holdpoint': { planetId: 'home_p1', on: true },
  'order.auto': { fleetId: 'p1_1', on: true },
  'order.scramble': { fleetId: 'p1_1', on: true },
  'fleet.forcemarch': { fleetId: 'p1_1', on: true },
  'fleet.instantRepair': { fleetId: 'p1_1' },
  'fleet.repair': { fleetId: 'p1_1' },
  'order.chain': { fleetId: 'p1_1', steps: [] },
};

/** Slack left under the server's per-socket cap for the pings and the odd extra message
 *  that share the same window — pacing to the cap exactly would still get clipped. */
const FLOOD_MARGIN = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Дождаться последствия, у которого нет промиса. Реестр запускает гибернацию и
 *  пробуждение как `detach(...)` — намеренно, чтобы сбой стора не ронял процесс, — так
 *  что вернуть их промис наружу нечему. Репетиция ждёт по НАБЛЮДАЕМОМУ признаку и падает
 *  с внятным текстом, если он не наступил, вместо того чтобы виснуть до общего таймаута. */
async function waitFor(check: () => boolean, ms: number, label: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(label);
    await sleep(1);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

class WireClient {
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: Array<(message: ServerMessage) => void> = [];
  readonly socket: WebSocket;
  welcome!: ServerWelcomeMessage;
  state?: GameState;
  clientSeq = 0;
  private sentInWindow = 0;
  private windowSince = Date.now();
  /** RESIL-6, «уснувшая вкладка»: пока `paused`, кадры складываются в `parked` и не
   *  разбираются — сокет при этом жив. Разбор пачкой делает `resume`. */
  private paused = false;
  private readonly parked: RawData[] = [];

  private constructor(
    url: string,
    readonly playerId: string,
    private readonly latencyMs: number,
    private readonly timeoutMs: number,
  ) {
    this.socket = new WebSocket(url);
    this.socket.on('message', (raw: RawData) => {
      if (this.paused) {
        this.parked.push(raw);
        return;
      }
      this.ingest(raw);
    });
  }

  /** Разобрать один кадр: обновить состояние и отдать его ожидающему. Возвращает,
   *  была ли это дельта (счётчик догона после паузы). */
  private ingest(raw: RawData): boolean {
    const message = JSON.parse(String(raw)) as ServerMessage;
    let wasDelta = false;
    if ((message.type === 'welcome' || message.type === 'state') && message.state) {
      this.state = message.state;
    } else if (message.type === 'delta' && this.state) {
      this.state = applyDelta(this.state, message.delta);
      wasDelta = true;
    }
    const waiter = this.waiters.shift();
    if (waiter) waiter(message);
    else this.queue.push(message);
    return wasDelta;
  }

  static async connect(
    url: string,
    playerId: string,
    latencyMs: number,
    timeoutMs: number,
  ): Promise<WireClient> {
    const client = new WireClient(url, playerId, latencyMs, timeoutMs);
    await withTimeout(once(client.socket, 'open'), timeoutMs, `${playerId} connect`);
    const first = await client.next();
    if (first.type !== 'welcome' || !first.sessionId) {
      throw new Error(`${playerId} expected a gated welcome`);
    }
    client.welcome = first;
    return client;
  }

  next(): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return withTimeout(
      new Promise((resolve) => this.waiters.push(resolve)),
      this.timeoutMs,
      `${this.playerId} message`,
    );
  }

  async nextUntil(predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
    for (;;) {
      const message = await this.next();
      if (predicate(message)) return message;
    }
  }

  clearMessages(): void {
    this.queue.length = 0;
  }

  /** «Вкладка уснула»: кадры продолжают приходить, но клиент их НЕ РАЗБИРАЕТ. Именно
   *  так ведёт себя фоновая вкладка — сокет жив, ОС буферизует, а JS не крутится. Важно
   *  не путать с потерей: ничего не пропадает, всё разберётся пачкой на `resume`. */
  pause(): void {
    this.paused = true;
  }

  /** Проснуться и разобрать накопленное В ТОМ ЖЕ ПОРЯДКЕ. Возвращает, сколько дельт
   *  пришлось догонять: цепочка `applyDelta` поверх устаревшей базы — ровно то место,
   *  где живёт десинк, и до сих пор её никто не растягивал. */
  resume(): number {
    this.paused = false;
    const backlog = this.parked.splice(0);
    let deltas = 0;
    for (const raw of backlog) {
      if (this.ingest(raw)) deltas += 1;
    }
    return deltas;
  }

  /** Оборвать соединение БЕЗ закрывающего рукопожатия — как пропавшая связь, а не как
   *  корректный выход. Сервер узнаёт об уходе не из `close`, а из мёртвого сокета. */
  terminate(): void {
    this.socket.terminate();
  }

  /** Wait out the server's flood window when this socket is about to cross its cap.
   *  Over the cap the server drops the message BEFORE parsing it — by design, so there
   *  is no reply, no rejection and no error: the sender just waits until its timeout.
   *  The rehearsal walks the WHOLE action catalogue over one socket, so it is the one
   *  client that legitimately approaches the cap, and it must pace itself the way a real
   *  client's own tempo does. The margin leaves room for the pings sharing the window. */
  private async respectFloodWindow(): Promise<void> {
    const now = Date.now();
    if (now - this.windowSince >= SOCKET_FLOOD_WINDOW_MS) {
      this.windowSince = now;
      this.sentInWindow = 0;
    }
    if (this.sentInWindow >= SOCKET_FLOOD_MAX - FLOOD_MARGIN) {
      await sleep(SOCKET_FLOOD_WINDOW_MS - (now - this.windowSince) + 5);
      this.windowSince = Date.now();
      this.sentInWindow = 0;
    }
    this.sentInWindow += 1;
  }

  async send(type: string, payload: unknown, envelope?: ReturnType<typeof createActionEnvelope>) {
    await this.respectFloodWindow();
    const sent =
      envelope ??
      createActionEnvelope({
        matchId: 'rehearsal',
        playerId: this.playerId,
        sessionId: this.welcome.sessionId!,
        clientSeq: (this.clientSeq += 1),
        issuedAt: 1_000,
        type,
        payload,
      });
    await sleep(this.latencyMs);
    this.socket.send(JSON.stringify({ type: 'action.v1', envelope: sent }));
    return sent;
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = once(this.socket, 'close');
    this.socket.close();
    await withTimeout(closed, this.timeoutMs, `${this.playerId} close`);
  }
}

function baseView(state: GameState, playerId: string, data: ReturnType<typeof loadShippedData>) {
  const {
    signatures: _signatures,
    remembered: _remembered,
    ...view
  } = visibleState(state, playerId, data);
  return view as GameState;
}

/** Дождаться, пока клиент СОЙДЁТСЯ со своей проекцией под туманом.
 *
 *  Мгновенное сравнение хэшей здесь врёт, и это выяснилось прогоном: один и тот же вход
 *  давал то 0 расхождений, то 3. Причина не в тумане и не в редьюсере — дельта
 *  последнего действия ещё летела по проводу, а проверка уже сравнивала. То есть ловила
 *  она собственную гонку, а не десинк.
 *
 *  Сходимость — и есть то, что значит «нет десинка» в живой системе: клиент обязан
 *  ПРИЙТИ к состоянию сервера, а не совпадать с ним в произвольный момент. Настоящий
 *  десинк не сходится никогда, поэтому истечение срока его по-прежнему ловит. */
async function converges(
  client: WireClient,
  expected: () => GameState,
  ms: number,
): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (client.state && hashState(client.state) === hashState(expected())) return true;
    if (Date.now() > deadline) return false;
    await sleep(2);
  }
}

export async function runRehearsal(
  partial: Partial<RehearsalOptions> = {},
): Promise<RehearsalReport> {
  const options = { ...DEFAULTS, ...partial };
  if (!Number.isInteger(options.players) || options.players < 2 || options.players > 10) {
    throw new Error('players must be an integer from 2 to 10');
  }
  const started = performance.now();
  const data = loadShippedData();
  const playerIds = Array.from({ length: options.players }, (_, i) => `p${i + 1}`);
  const secret = hmacSecret('rehearsal-secret-that-is-long-enough');
  const auth = { key: secret, algorithms: ['HS256'], issuer: 'void', audience: 'match' };
  const sign = { key: secret, algorithm: 'HS256' as const, issuer: 'void', audience: 'match' };
  let snapshot: { state: GameState; seq: number } | undefined;
  const receipts = new Map<string, StoredReceipt>();
  // RESIL-6, ось «настоящий Postgres». Прежде durable-путь был ОБЪЕКТОМ В ПАМЯТИ плюс
  // `await sleep(persistDelayMs)` — форма пути была верной (записать до рассылки, поднять
  // из записанного), но сама запись ничего не проверяла. Здесь она настоящая: состояние
  // уходит в JSONB и возвращается оттуда. Это же и единственная исполняемая проверка
  // инварианта «GameState сериализуем в JSON»: класс, Map, Date или NaN внутри состояния
  // переживут `deepClone`, но круг через базу — нет.
  // Стор поднимается ТЕМ ЖЕ `createStores`, которым его поднимает боевой `main.ts`, —
  // включая накат схемы. Своей проводки к базе у репетиции нет: была бы своя — она бы и
  // проверялась вместо настоящей.
  const stores: Stores | null = options.databaseUrl
    ? await createStores({ DATABASE_URL: options.databaseUrl })
    : null;
  let jsonbRoundTripOk = true;
  const toSnapshot = (state: GameState, seq: number, matchId = 'rehearsal'): MatchSnapshot => ({
    matchId,
    dataVersion: state.version.data,
    seq,
    status: state.match.status,
    state,
  });
  // Часы репетиции ПОДВИЖНЫ (были прибиты к 1000). До живой фазы значение не меняется,
  // поэтому все прежние фазы видят ровно тот же мир, что и раньше.
  const clock = { now: 1_000 };
  const observations: RoomObservation[] = [];
  let durableWrites = 0;
  let hashMismatches = 0;
  let fogViolations = 0;
  let duplicatesPrevented = 0;
  let reconnects = 0;
  let serverRestarts = 0;
  const persist = async (next: { state: GameState; seq: number }, receipt: StoredReceipt) => {
    if (stores) {
      // Настоящая запись — она же и есть задержка, изображать её больше нечем.
      await stores.store.save(toSnapshot(next.state, next.seq));
      await stores.receiptStore.save('rehearsal', receipt);
    } else {
      await sleep(options.persistDelayMs);
    }
    // Тем же правилом, что и у настоящего стора: если запись со СТАРШИМ `seq` уже
    // легла, эта — опоздавшая, и затирать ею свежую нельзя. Без этого эталон в памяти
    // расходился с базой: два `persist` идут внахлёст и завершаются НЕ ПО ПОРЯДКУ;
    // база опоздавшую отбрасывает сама (её `save` оптимистичен по `seq`), а эталон
    // послушно откатывался назад. Дефект был ровно в этом зеркале — и это лишний
    // довод к тому, чтобы мир поднимался из БАЗЫ, а зеркало ей только сверялось.
    if (!snapshot || next.seq > snapshot.seq) {
      snapshot = { state: next.state, seq: next.seq };
    }
    receipts.set(receipt.actionId, receipt);
    durableWrites += 1;
  };
  /** Круг состояния через базу — и подъём мира из того, что вернулось.
   *
   *  Это единственная исполняемая проверка инварианта №2 («GameState сериализуем в
   *  JSON»): класс, `Map`, `Date` или `NaN` внутри состояния переживут `deepClone` и все
   *  тесты ядра — круг через базу не переживут.
   *
   *  Здесь ДВА РАЗНЫХ вопроса, и путать их нельзя — на этом я и обжёгся дважды:
   *
   *  1. «Пережило ли состояние круг через JSONB» — задаётся НАПРЯМУЮ и на своём ключе:
   *     прожившее сутки состояние пишется и читается обратно. Ничьи чужие записи в этот
   *     ключ не идут, поэтому сравнение детерминировано.
   *  2. «Поднимется ли мир из базы» — берётся то, что durable-путь В САМОМ ДЕЛЕ оставил
   *     под ключом матча, и мир поднимается ровно из этого; проверяют это утверждения
   *     фазы перезапуска ниже.
   *
   *  Прежние версии сверяли `seq` базы с `seq` комнаты и мигали. Причина оказалась не в
   *  гонке, а в неверном допущении: durable-путь пишет снимок с `seq = this.seq + 1` и
   *  лишь ПОТОМ коммитит шаг (`matchRoom.ts`, commit-before-broadcast). Значит база
   *  ЗАКОННО бывает впереди комнаты, и равенство этих чисел никакой не инвариант. */
  const reloadFromDatabase = async (): Promise<void> => {
    if (!stores) return;

    // (1) Круг через JSONB — на отдельном ключе, чтобы вопрос был чистым.
    //
    // Ключ УНИКАЛЕН НА ПРОГОН, и это не украшение: `save` у стора оптимистичен по `seq`
    // (запись со старшим шагом уже лежит ⇒ эта — опоздавшая и отбрасывается). На
    // постоянном ключе повторный прогон с не бо́льшим шагом молча не перезаписал бы строку
    // и сравнил бы состояние с ЧУЖИМ, прошлого прогона. Тот же приём, что у контрактов
    // сторов (`store.test.ts`, `stamp`).
    const probeId = `rehearsal-jsonb-${process.pid}-${Date.now()}`;
    const lived = room.state;
    await stores.store.save(toSnapshot(lived, room.sequence, probeId));
    const back = await stores.store.load(probeId);
    if (!back) throw new Error('Postgres не отдал состояние, только что в него записанное');
    // `hashState` сортирует ключи и роняет `undefined` — то есть переупорядочивание
    // ключей самим JSONB честно не считается расхождением, а потеря или искажение
    // значения считается.
    if (hashState(back.state) !== hashState(lived)) jsonbRoundTripOk = false;

    // (2) Мир поднимается из того, что durable-путь оставил под ключом матча.
    const stored = await stores.store.load('rehearsal');
    if (!stored) throw new Error('Postgres не отдал снапшот матча');
    snapshot = { state: stored.state, seq: stored.seq };
    receipts.clear();
    for (const receipt of await stores.receiptStore.loadAll('rehearsal')) {
      receipts.set(receipt.actionId, receipt);
    }
  };

  const makeRoom = () =>
    createDevMatch(data, {
      id: 'rehearsal',
      players: playerIds,
      now: () => clock.now,
      time: 1_000,
      gate: new ActionGate({ payloadValidator: isValidActionPayload }),
      persist,
      observe: (e) => observations.push(e),
      actionRateMax: 1_000,
      actionRateWindowMs: 1_000,
      ...(snapshot
        ? {
            initialState: snapshot.state,
            initialSeq: snapshot.seq,
            initialReceipts: [...receipts.values()] as ActionReceipt[],
          }
        : {}),
    });
  const tokenFor = (playerId: string) =>
    signJoinToken({ matchId: 'rehearsal', playerId }, sign, { ttlSeconds: 300 });

  let room = makeRoom();
  let server = createMultiplayerServer({ room, auth });
  let url = await server.listen();
  const clients: WireClient[] = [];
  try {
    for (const playerId of playerIds) {
      clients.push(
        await WireClient.connect(
          `${url}?token=${await tokenFor(playerId)}`,
          playerId,
          options.latencyMs,
          options.timeoutMs,
        ),
      );
    }

    const beforeConcurrency = room.sequence;
    const envelopes = await Promise.all(
      clients.map((client) =>
        client.send('fleet.orbit', { fleetId: `${client.playerId}_1`, orbit: 'near' }),
      ),
    );
    await withTimeout(
      (async () => {
        while (room.sequence < beforeConcurrency + options.players) await sleep(1);
      })(),
      options.timeoutMs,
      'concurrent actions',
    );
    const actionsAccepted = room.sequence - beforeConcurrency;

    const beforeDuplicate = room.sequence;
    await clients[0]!.send('fleet.orbit', { fleetId: 'p1_1', orbit: 'near' }, envelopes[0]);
    const duplicateReply = await clients[0]!.nextUntil((message) => message.type === 'state');
    if (duplicateReply.type !== 'state' || room.sequence !== beforeDuplicate) {
      throw new Error('duplicate action was not replayed idempotently');
    }
    duplicatesPrevented += 1;

    const closedSession = clients[0]!.welcome.sessionId;
    await clients[0]!.close();
    clients[0] = await WireClient.connect(
      `${url}?token=${await tokenFor('p1')}`,
      'p1',
      options.latencyMs,
      options.timeoutMs,
    );
    if (clients[0]!.welcome.sessionId === closedSession) {
      throw new Error('reconnect did not mint a fresh session');
    }
    reconnects += 1;

    const missingPayloads = CLIENT_ACTION_TYPES.filter((type) => !(type in WIRE_PAYLOADS));
    const extraPayloads = Object.keys(WIRE_PAYLOADS).filter(
      (type) => !CLIENT_ACTION_TYPES.includes(type),
    );
    if (missingPayloads.length > 0 || extraPayloads.length > 0) {
      throw new Error(
        `wire payload catalog drift (missing: ${missingPayloads.join(', ') || 'none'}; extra: ${extraPayloads.join(', ') || 'none'})`,
      );
    }
    clients[0]!.clearMessages();
    let wireActionsApplied = 0;
    let wireActionsRejectedByRules = 0;
    for (const type of CLIENT_ACTION_TYPES) {
      const before = room.sequence;
      const envelope = await clients[0]!.send(type, WIRE_PAYLOADS[type]);
      const response = await clients[0]!.nextUntil(
        (message) =>
          message.type === 'delta' ||
          (message.type === 'rejection' && message.actionId === envelope.actionId),
      );
      if (response.type === 'rejection') {
        if (response.code === 'E_BAD_PAYLOAD' || response.code === 'E_UNKNOWN_ACTION') {
          throw new Error(`${type} did not reach its reducer (${response.code})`);
        }
        wireActionsRejectedByRules += 1;
      } else {
        wireActionsApplied += 1;
      }
      if (room.sequence !== before + 1) {
        throw new Error(`${type} stopped before exactly one authoritative reducer step`);
      }
    }

    const expectedSequence = options.players + CLIENT_ACTION_TYPES.length;
    if (room.sequence !== expectedSequence) {
      throw new Error(
        `wire catalog did not consume every action (${room.sequence}/${expectedSequence})`,
      );
    }

    for (const client of clients) {
      const expected = baseView(room.state, client.playerId, data);
      if (!client.state || hashState(client.state) !== hashState(expected)) hashMismatches += 1;
      for (const other of playerIds.filter((id) => id !== client.playerId)) {
        if (client.state?.fleets[`${other}_1`]) fogViolations += 1;
      }
    }

    // --- ФАЗА ЖИЗНИ (RESIL-5) --------------------------------------------------
    //
    // Всё выше проверяет ПРОВОДИМОСТЬ: конверты, дубли, отказы по правилам, туман,
    // квитанции. Это разные вопросы к одной системе, и до сих пор второй не задавался
    // вовсе: мир в репетиции стоял на месте (часы были прибиты к 1000), а трафик был
    // скриптом по одному payload на тип.
    //
    // Здесь мир ЖИВЁТ. Время двигает НАСТОЯЩИЙ `startClockDriver` — с внедрённым
    // таймером, поэтому его собственная логика (взвод, сторож застоя, перевзвод после
    // тика) работает по-честному, а прогон остаётся детерминированным и быстрым.
    // Трафик создают те же `aiOrders`, что водят пустые кресла на сервере, и уходит он
    // по НАСТОЯЩЕМУ проводу: гейт, конверты, `clientSeq`, квитанции, durable-persist.
    //
    // Чего эта фаза сознательно НЕ делает и почему — в `RESIL-5` бэклога: бот решает по
    // состоянию СЕРВЕРА, а не по своей проекции под туманом (решение по проекции сейчас
    // невозможно — `decisionNoise` читает `state.rng`, а его в проекции нет); карта
    // остаётся dev-сценарием; Postgres подменён задержкой.
    let botActions = 0;
    if (options.gameHours > 0) {
      const HOUR = 3_600_000;
      const timer: { fn: (() => void) | null } = { fn: null };
      const driver = startClockDriver(room, {
        schedule: (fn) => {
          timer.fn = fn;
          return {};
        },
        cancel: () => {
          timer.fn = null;
        },
        heartbeatMs: 1_000,
      });
      try {
        for (let hour = 1; hour <= options.gameHours; hour += 1) {
          clock.now = 1_000 + hour * HOUR;
          // ДОВЕСТИ мир до этого часа, а не выстрелить разок и поверить.
          //
          // `MatchRoom.tick()` СОЗНАТЕЛЬНО не двигает время, пока держится незакрытая
          // фиксация (commit-before-broadcast): иначе тик обогнал бы ещё не
          // зафиксированное состояние. С задержкой-заглушкой окно длилось микросекунды и
          // промах был незаметен; с настоящей базой оно реальное, и прогон недосчитался
          // ровно последнего часа. Фиксация сама перевзводит драйвер — отсюда повторные
          // выстрелы, а не один. Срок держит прогон конечным: если мир встал НАСОВСЕМ
          // (застой часов), репетиция обязана сказать это, а не ждать общий таймаут.
          const hourDeadline = Date.now() + options.timeoutMs;
          while (room.state.time < clock.now) {
            if (timer.fn) {
              const fire = timer.fn;
              timer.fn = null;
              fire();
            }
            // Уступать цикл событий НА КАЖДОМ витке, а не только когда стрелять нечем.
            // Тик перевзводит таймер сам, поэтому ветка «выстрелить» бывает бесконечной,
            // и без этой строки виток за витком шёл бы синхронно: запись в базу не могла
            // бы завершиться, фиксация не снялась бы, мир стоял бы до самого срока — а
            // ждали мы именно её. Ровно тот класс, что и весь этот кирпич: ждать, не
            // уступая, значит не дождаться.
            await sleep(1);
            if (Date.now() > hourDeadline) {
              throw new Error(`час ${hour} не наступил: ${room.state.time} < ${clock.now}`);
            }
          }
          for (const client of clients) {
            const orders = aiOrders(room.state, client.playerId).slice(
              0,
              options.botActionsPerHour,
            );
            for (const order of orders) {
              await client.send(order.type, order.payload);
              botActions += 1;
            }
          }
          driver.reschedule(); // действия могли запланировать новое — взвести под них
        }
      } finally {
        driver.stop();
      }

      // Мир обязан был пройти заявленный срок, а не постоять.
      if (room.state.time < 1_000 + options.gameHours * HOUR) {
        throw new Error(
          `живая фаза не довела часы: ${room.state.time} < ${1_000 + options.gameHours * HOUR}`,
        );
      }
      // И каждый клиент обязан по-прежнему СХОДИТЬСЯ СО СВОЕЙ ПРОЕКЦИЕЙ: сутки жизни не
      // должны развести его с сервером.
      //
      // Заметь, чего здесь НЕТ: грубой проверки «клиент не видит чужой флот», которая
      // стоит в статических фазах выше. Она верна только в мире, где никто не двигается
      // (до этой фазы флоты стояли по домам). Стоило им полететь — чужой флот появляется
      // в проекции ЗАКОННО, как только его опознали, и та проверка начала бы врать. А
      // сильная проверка тумана — вот эта: если бы сервер показал лишнее, состояние
      // клиента разошлось бы с `baseView` и хэши не совпали.
      for (const client of clients) {
        const ok = await converges(
          client,
          () => baseView(room.state, client.playerId, data),
          options.timeoutMs,
        );
        if (!ok) hashMismatches += 1;
      }
    }

    // --- ФАЗА НЕВЗГОД СЕТИ (RESIL-6) -------------------------------------------
    //
    // До сих пор из всех бед провода репетиция знала одну — ЗАДЕРЖКУ. Между тем сеть у
    // мобильного игрока рвётся, теряет и засыпает, и каждое из трёх бьёт по СВОЕМУ месту
    // стека. Здесь по одному честному случаю на каждое.
    let droppedOrders = 0;
    let sequenceGaps = 0;
    let abruptDrops = 0;
    let backlogDeltas = 0;
    if (options.networkTrouble) {
      const victim = clients[0]!;

      // (а) ПРИКАЗ ПОТЕРЯЛСЯ ПО ДОРОГЕ. Клиент уверен, что отправил, — сервер не видел
      // ничего. Счётчик `clientSeq` у клиента ушёл вперёд, и следующий приказ приходит с
      // РАЗРЫВОМ. Строгий шлюз обязан его отбить: пропусти он дырку, порядок действий
      // игрока перестал бы быть порядком. Это не теория — так выглядит любой обрыв в
      // момент отправки.
      victim.clientSeq += 1;
      droppedOrders += 1;
      const gapped = await victim.send('fleet.stop', { fleetId: 'p1_1' });
      const gapReply = await victim.nextUntil(
        (message) => message.type === 'rejection' && message.actionId === gapped.actionId,
      );
      if (gapReply.type !== 'rejection' || gapReply.code !== 'E_OUT_OF_ORDER') {
        throw new Error(
          `разрыв в clientSeq прошёл мимо шлюза: ${gapReply.type === 'rejection' ? gapReply.code : gapReply.type}`,
        );
      }
      sequenceGaps += 1;

      // ...и лечится это ровно тем, чем лечится в жизни: переподключением. Новая сессия —
      // новый счётчик, игрок продолжает играть, а не остаётся навсегда заблокированным.
      await victim.close();
      clients[0] = await WireClient.connect(
        `${url}?token=${await tokenFor('p1')}`,
        'p1',
        options.latencyMs,
        options.timeoutMs,
      );
      reconnects += 1;
      const healed = await clients[0]!.send('fleet.stop', { fleetId: 'p1_1' });
      const healedReply = await clients[0]!.nextUntil(
        (message) =>
          message.type === 'delta' ||
          (message.type === 'rejection' && message.actionId === healed.actionId),
      );
      if (healedReply.type === 'rejection' && healedReply.code === 'E_OUT_OF_ORDER') {
        throw new Error('переподключение не вылечило разрыв последовательности');
      }

      // (б) ОБРЫВ БЕЗ ПРОЩАНИЯ. Не `close`, а мёртвый сокет: связь пропала. Сервер должен
      // узнать об уходе сам и отпустить место, а не держать призрака.
      const ghost = clients[1]!;
      const peersBefore = room.peerCount;
      ghost.terminate();
      abruptDrops += 1;
      await waitFor(
        () => room.peerCount < peersBefore,
        options.timeoutMs,
        'сервер не заметил оборванного сокета',
      );
      clients[1] = await WireClient.connect(
        `${url}?token=${await tokenFor(playerIds[1]!)}`,
        playerIds[1]!,
        options.latencyMs,
        options.timeoutMs,
      );
      reconnects += 1;

      // (в) УСНУВШАЯ ВКЛАДКА. Клиент перестаёт разбирать кадры, мир тем временем идёт, а
      // потом вкладка просыпается и разбирает всё пачкой. Проверяется цепочка
      // `applyDelta` поверх УСТАРЕВШЕЙ базы — место, где десинк и заводится. Ждать
      // догона снаружи нечем (`resume` синхронен), поэтому сверка идёт сразу после него.
      const sleeper = clients[2] ?? clients[0]!;
      sleeper.pause();
      // Пока вкладка спит, ЖИЗНЬ НЕ ОСТАНАВЛИВАЕТСЯ: соседи играют, и часы идут. Без
      // второго догонять было бы почти нечего — большинство чужих действий туман до
      // спящего не доносит, и цепочка `applyDelta` вышла бы длиной в один шаг.
      for (const client of clients) {
        if (client === sleeper) continue;
        const orders = aiOrders(room.state, client.playerId).slice(0, options.botActionsPerHour);
        for (const order of orders) await client.send(order.type, order.payload);
      }
      clock.now += 2 * 3_600_000;
      // Довести мир, а не стрельнуть разок: пропущенный из-за фиксации тик оставил бы
      // спящей вкладке нечего догонять, и проверка позеленела бы на пустом месте.
      const napDeadline = Date.now() + options.timeoutMs;
      while (room.state.time < clock.now) {
        room.tick();
        await sleep(1);
        if (Date.now() > napDeadline) throw new Error('мир не пошёл, пока вкладка спала');
      }
      await sleep(options.latencyMs + 20); // дать кадрам доехать до спящей вкладки
      backlogDeltas = sleeper.resume();
      // Разбор пачкой обязан привести ровно туда же, куда привёл бы разбор по одной.
      const awake = await converges(
        sleeper,
        () => baseView(room.state, sleeper.playerId, data),
        options.timeoutMs,
      );
      if (!awake) hashMismatches += 1;
    }

    await Promise.all(clients.map((client) => client.close()));
    await server.close();
    if (!snapshot) throw new Error('durable snapshot was not written');
    // RESIL-6: под настоящей базой мир поднимается из НЕЁ. Снапшот в памяти при этом
    // не выбрасывается, а служит эталоном — с ним сверяется то, что вернул JSONB.
    await reloadFromDatabase();

    room = makeRoom();
    server = createMultiplayerServer({ room, auth });
    url = await server.listen();
    serverRestarts += 1;
    for (let i = 0; i < playerIds.length; i += 1) {
      const playerId = playerIds[i]!;
      clients[i] = await WireClient.connect(
        `${url}?token=${await tokenFor(playerId)}`,
        playerId,
        options.latencyMs,
        options.timeoutMs,
      );
      const client = clients[i]!;
      if (client.welcome.seq < expectedSequence || !room.state.fleets.p1_1) {
        throw new Error(
          `restart did not restore the durable snapshot (minimum seq ${expectedSequence}, got ${client.welcome.seq})`,
        );
      }
      const expected = baseView(room.state, client.playerId, data);
      if (hashState(client.welcome.state) !== hashState(expected)) hashMismatches += 1;
      // Грубая проверка «чужого флота не видно» держится ТОЛЬКО в неподвижном мире, где
      // флоты не успели встретиться. После живой фазы она начинает врать: опознанный
      // чужой флот попадает в проекцию законно. Сильная проверка от этого не страдает —
      // она сравнивает состояние клиента с его же проекцией строкой выше.
      if (options.gameHours === 0) {
        for (const other of playerIds.filter((id) => id !== client.playerId)) {
          if (client.welcome.state.fleets[`${other}_1`]) fogViolations += 1;
        }
      }
      await client.close();
    }

    // --- ФАЗА СНА (RESIL-6) ----------------------------------------------------
    //
    // Обещание игры: мир идёт круглосуточно, даже когда в матче НЕТ НИКОГО. Держит его
    // `LazyRoomRegistry` — без зрителей матч засыпает (сохраняется и выгружается из
    // памяти), но перед сном взводит будильник на своё следующее событие; тот будит его,
    // догоняет мир и укладывает обратно. До сих пор это проверялось только модульно, а
    // сквозной прогон реестра в глаза не видел — при том что в бою он стоит между
    // сокетом и комнатой.
    //
    // Часы и таймеры внедрены, поэтому «сутки сна» проходят мгновенно и одинаково.
    let hibernations = 0;
    let wakes = 0;
    let offlineAdvanceMs = 0;
    if (options.hibernate) {
      await server.close();
      const timers = new Map<number, { fn: () => void; ms: number }>();
      let nextTimerId = 1;
      const fireTimers = (): number => {
        const due = [...timers.values()];
        timers.clear();
        for (const timer of due) timer.fn();
        return due.length;
      };
      // Часы живого матча — настоящий драйвер, как в бою. Его таймер держим отдельно:
      // взводить его в этой фазе не нужно, а вот то, что СОН ЕГО ГАСИТ, проверяется.
      const driverTimer: { fn: (() => void) | null } = { fn: null };
      const registry = new LazyRoomRegistry({
        load: async (matchId) => {
          if (matchId !== 'rehearsal') return null;
          const loaded = makeRoom();
          const driver = startClockDriver(loaded, {
            schedule: (fn) => {
              driverTimer.fn = fn;
              return {};
            },
            cancel: () => {
              driverTimer.fn = null;
            },
            heartbeatMs: 1_000,
          });
          return {
            room: loaded,
            dispose: async () => {
              driver.stop();
              snapshot = { state: loaded.state, seq: loaded.sequence };
              if (stores) await stores.store.save(toSnapshot(loaded.state, loaded.sequence));
              hibernations += 1;
            },
          };
        },
        idleMs: 60_000,
        schedule: (fn, ms) => {
          const id = nextTimerId;
          nextTimerId += 1;
          timers.set(id, { fn, ms });
          return id;
        },
        cancel: (handle) => {
          timers.delete(handle as number);
        },
      });
      server = createMultiplayerServer({ registry, auth });
      url = await server.listen(); // многоматчевый адрес: матч указывается в пути

      // Кто-то заглянул в матч — реестр поднял его из стора.
      const visitor = await WireClient.connect(
        `${url}/rehearsal?token=${await tokenFor('p1')}`,
        'p1',
        options.latencyMs,
        options.timeoutMs,
      );
      const liveRoom = registry.get('rehearsal');
      if (!liveRoom) throw new Error('реестр не поднял матч под подключение');

      // ...и ушёл. Теперь матч никто не смотрит.
      await visitor.close();
      await waitFor(
        () => liveRoom.peerCount === 0,
        options.timeoutMs,
        'реестр не увидел, что зрителей не осталось',
      );
      const timeBeforeSleep = liveRoom.state.time;

      fireTimers(); // окно простоя вышло → гибернация
      await waitFor(() => hibernations === 1, options.timeoutMs, 'матч не заснул');
      if (registry.ids().length !== 0) throw new Error('заснувший матч остался в памяти');
      if (driverTimer.fn !== null) throw new Error('сон не погасил часы матча');

      // Перед сном матч обязан был взвести будильник на своё следующее событие. Если не
      // взвёл — фаза пуста: спать-то он заснул, но проверять нечего, и молча зеленеть
      // такой прогон не должен.
      const wake = [...timers.values()][0];
      if (timers.size !== 1 || !wake) {
        throw new Error(`спящему матчу не за чем просыпаться (будильников: ${timers.size})`);
      }

      // Время идёт, пока все офлайн, и наступает срок события.
      clock.now += wake.ms + 1;
      fireTimers();
      await waitFor(() => hibernations === 2, options.timeoutMs, 'матч не проснулся и не уснул');
      wakes += 1;
      offlineAdvanceMs = (snapshot?.state.time ?? 0) - timeBeforeSleep;
      if (offlineAdvanceMs <= 0) {
        throw new Error('мир не сдвинулся, пока в матче не было никого');
      }

      // И вернувшийся игрок получает мир, прожитый без него, а не тот, что оставил.
      const returning = await WireClient.connect(
        `${url}/rehearsal?token=${await tokenFor('p1')}`,
        'p1',
        options.latencyMs,
        options.timeoutMs,
      );
      const reloaded = registry.get('rehearsal');
      if (!reloaded) throw new Error('реестр не поднял матч вернувшемуся игроку');
      if (reloaded.state.time <= timeBeforeSleep) {
        throw new Error('вернувшийся игрок получил мир, не проживший сон');
      }
      const expected = baseView(reloaded.state, 'p1', data);
      if (hashState(returning.welcome.state) !== hashState(expected)) hashMismatches += 1;
      await returning.close();
    }

    return {
      hibernations,
      wakes,
      offlineAdvanceMs,
      droppedOrders,
      sequenceGaps,
      abruptDrops,
      backlogDeltas,
      storeKind: stores?.kind ?? ('memory' as const),
      jsonbRoundTripOk,
      gameHours: options.gameHours,
      botActions,
      stalls: observations.filter((e) => e.kind === 'advance_overflow').length,
      deadLetters: observations.filter((e) => e.kind === 'dead_letter').length,
      players: options.players,
      actionsAccepted,
      duplicatesPrevented,
      reconnects,
      serverRestarts,
      durableWrites,
      wireActionTypes: CLIENT_ACTION_TYPES.length,
      wireActionsApplied,
      wireActionsRejectedByRules,
      hashMismatches,
      fogViolations,
      finalSequence: room.sequence,
      durationMs: performance.now() - started,
    };
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
    await server.close().catch(() => undefined);
    await stores?.close().catch(() => undefined);
  }
}

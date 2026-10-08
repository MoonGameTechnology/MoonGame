/**
 * Сетевой жизненный цикл (REFM-216) — прямой тест владельца.
 *
 * Сокет, клиент места, таймеры и цикл переподключения снаружи не видны, поэтому здесь
 * проверено то, что видно игре: куда и с чем звонит дозвон, что значит первый и
 * следующий снимок, что уходит в пинг и замер, как ведёт себя обрыв, сдача и выход, куда
 * попадает отказ и что получают лента и мир. Каждый тест — свежая загрузка модуля над
 * своим сокетом, своим хранилищем и своими часами; транспорт настоящий
 * (`MultiplayerClient`), сервер — строки протокола. В конце — стык с `main.ts`.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '../../localization/runtime';
import { refusalText } from '../../decisions/refusalText';
import { saveSession } from '../../decisions/sessionStore';
import {
  createInitialState,
  diffState,
  hashState,
  type GameState,
} from '../../packages/shared-core/src/index';

const BASE = 'ws://srv.test:8080';
const HTTP = 'http://srv.test:8080';

/** Сокет браузера: всё, что трогает модуль. Закрытие не шлёт `close` само — его шлёт тест. */
class FakeWs {
  static all: FakeWs[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: Array<Record<string, unknown>> = [];
  closed = false;
  constructor(readonly url: string) {
    FakeWs.all.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.closed = true;
  }
  /** Сервер прислал сообщение. */
  hear(msg: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  sentOf(type: string): Array<Record<string, unknown>> {
    return this.sent.filter((m) => m.type === type);
  }
}
const lastWs = (): FakeWs => FakeWs.all.at(-1)!;

interface Env {
  status: string;
  notes: string[];
  sounds: string[];
  banner: string | null;
  leftLocal: number;
  srv: { base: string; nick: string } | null;
  enters: Array<[string | undefined, boolean]>;
  snaps: Array<{ seq: number; time: number; admit: boolean; fanfare: boolean; catchUp: boolean }>;
  events: unknown[][];
  pops: number;
  fps: number;
  connect: boolean[];
  connectShown: boolean;
  hubs: Array<string | undefined>;
  link: boolean;
}

let cell: Map<string, string>;
let clock: number;
let server: (url: string) => { ok: boolean; status: number; json(): Promise<unknown> };
let fetched: Array<{ url: string; auth?: string }>;
/** Что ушло владельцам ленты и страниц входа (их модули здесь подменены). */
let log: { pings: Array<[unknown, string | null]>; dropped: string[]; chats: unknown[] };
let stages: string[];

function world(time: number): GameState {
  return {
    ...createInitialState({ seed: 'net-session', version: { data: '1', manifest: '1' } }),
    time,
  };
}
const welcome = (extra: Record<string, unknown> = {}) => ({
  type: 'welcome',
  matchId: 'm1',
  playerId: 'p2',
  seq: 1,
  serverTime: 0,
  state: world(5_000),
  ...extra,
});
/** Полный снимок без приветствия — пересинхронизация, не вход. */
const resync = (seq: number, extra: Record<string, unknown> = {}) => ({
  type: 'state',
  matchId: 'm1',
  seq,
  serverTime: 0,
  state: world(5_000 + seq * 1_000),
  ...extra,
});

beforeEach(() => {
  FakeWs.all = [];
  cell = new Map();
  clock = 10_000;
  fetched = [];
  log = { pings: [], dropped: [], chats: [] };
  stages = [];
  server = () => {
    throw new Error('сервер не должны были спрашивать');
  };
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.stubGlobal('WebSocket', FakeWs);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => cell.get(k) ?? null,
    setItem: (k: string, v: string) => void cell.set(k, v),
    removeItem: (k: string) => void cell.delete(k),
  });
  vi.stubGlobal('performance', { now: () => clock });
  vi.stubGlobal('document', { getElementById: () => null });
  vi.stubGlobal('fetch', async (url: string, init?: { headers?: Record<string, string> }) => {
    fetched.push({ url, auth: init?.headers?.authorization });
    return server(url);
  });
  vi.stubGlobal('requestAnimationFrame', undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock('./messageLog');
  vi.doUnmock('./signInPages');
});

const reply = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

/** Свежая загрузка — как после перезагрузки страницы. */
async function boot(over: Partial<Env> = {}) {
  vi.resetModules();
  vi.doMock('./messageLog', () => ({
    takePing: (ping: unknown, node: string | null) => void log.pings.push([ping, node]),
    dropPing: (id: string) => void log.dropped.push(id),
    takeChat: (m: unknown) => void log.chats.push(m),
  }));
  vi.doMock('./signInPages', () => ({ showStage: (s: string) => void stages.push(s) }));
  const acc = await import('./accountSession');
  const net = await import('./netSession');
  const env: Env = {
    status: '',
    notes: [],
    sounds: [],
    banner: null,
    leftLocal: 0,
    srv: { base: BASE, nick: 'Orion' },
    enters: [],
    snaps: [],
    events: [],
    pops: 0,
    fps: 58.6,
    connect: [],
    connectShown: true,
    hubs: [],
    link: false,
    ...over,
  };
  acc.initAccountSession({
    status: (text) => void (env.status = text),
    note: (text) => void env.notes.push(text),
    welcomePassword: () => '',
    showSignIn: () => undefined,
  });
  net.initNetSession({
    status: (text) => void (env.status = text),
    statusText: () => env.status,
    note: (text) => void env.notes.push(text),
    sound: (id) => void env.sounds.push(id),
    banner: () => env.banner,
    setBanner: (text) => void (env.banner = text),
    leaveLocal: () => void env.leftLocal++,
    resolveServer: () => env.srv,
    enter: (playerId, fanfare) => void env.enters.push([playerId, fanfare]),
    takeSnapshot: (snap, plan) =>
      void env.snaps.push({
        seq: snap.seq,
        time: snap.state.time,
        admit: plan.admit,
        fanfare: plan.fanfare,
        catchUp: plan.catchUp,
      }),
    events: (events) => void env.events.push(events),
    pingProvince: (target) => (target.node ? `prov:${target.node}` : null),
    closePingPop: () => void env.pops++,
    fps: () => env.fps,
    showConnect: (show) => void env.connect.push(show),
    connectShown: () => env.connectShown,
    openHub: (note) => void env.hubs.push(note),
    cameFromLink: () => env.link,
  });
  return { net, acc, env };
}

/** Сервер с аккаунтами: проба ответила «да», сессия этого сервера сохранена (или нет). */
async function accounts(acc: Awaited<ReturnType<typeof boot>>['acc'], session: string | null) {
  server = () => reply(200, { enabled: true });
  await acc.probeAuthMode(BASE);
  if (session) saveSession(localStorage, BASE, { login: 'Orion', token: session });
}

/** Войти в партию: дозвон, открытие, приветствие. */
async function joined(over: Partial<Env> = {}) {
  const b = await boot(over);
  b.net.connect();
  lastWs().onopen?.();
  lastWs().hear(welcome());
  return b;
}

describe('REFM-216 — дозвон', () => {
  it('по позывному: адрес несёт билет места, сервер и позывной запоминаются', async () => {
    const { net, env } = await boot();
    cell.set(`void.ticket.${BASE}|proto|Orion`, 'T1');
    net.connect();
    expect(env.leftLocal).toBe(1);
    expect(lastWs().url).toBe(`${BASE}/matches/proto?nick=Orion&ticket=T1`);
    expect(env.status).toBe(t('net.connecting', { nick: 'Orion' }));
    expect([cell.get('void.server'), cell.get('void.nick')]).toEqual([BASE, 'Orion']);
  });

  it('звонит в назначенную партию, а без адреса не звонит вовсе', async () => {
    const { net, env } = await boot();
    net.targetMatch('m 7');
    net.connect();
    expect(lastWs().url).toBe(`${BASE}/matches/m%207?nick=Orion`);
    env.srv = null;
    net.connect();
    expect(FakeWs.all).toHaveLength(1);
    // Локальная игра гаснет и тогда: дозвон начинается с выхода из неё.
    expect(env.leftLocal).toBe(2);
  });

  it('сервер с аккаунтами звонит по билету, и билет одноразовый', async () => {
    const { net, acc } = await boot();
    await accounts(acc, 'S1');
    acc.holdJoinToken('J1');
    net.connect();
    expect(lastWs().url).toBe(`${BASE}/matches/proto?token=J1`);
    expect(acc.takeJoinToken()).toBeNull();
  });

  it('открытый сокет ещё не впуск: карта не показывается до приветствия', async () => {
    const { net, env } = await boot();
    net.connect();
    lastWs().onopen?.();
    expect([net.NET, net.netAdmitted, env.enters]).toEqual([false, false, []]);
  });

  it('новый дозвон забывает прежний сокет: его снимок, закрытие и ошибка ничего не трогают', async () => {
    const { net, env } = await boot();
    net.connect();
    const old = lastWs();
    net.connect();
    expect(old.closed).toBe(true);
    old.hear(welcome());
    old.onclose?.();
    old.onerror?.();
    expect([net.NET, env.enters, env.notes]).toEqual([false, [], []]);
    expect(env.status).toBe(t('net.connecting', { nick: 'Orion' }));
    lastWs().onerror?.();
    expect(env.status).toBe(t('acc.server-down'));
  });
});

describe('REFM-216 — впуск и снимки', () => {
  it('первый снимок впускает: флаги, место, фанфара, пинг сразу', async () => {
    const { net, env } = await joined();
    expect([net.NET, net.netAdmitted, net.reconnecting]).toEqual([true, true, false]);
    expect(env.enters).toEqual([['p2', true]]);
    expect(env.snaps).toEqual([
      { seq: 1, time: 5_000, admit: true, fanfare: true, catchUp: false },
    ]);
    expect(lastWs().sentOf('ping')).toEqual([{ type: 'ping', clientTime: 10_000 }]);
  });

  it('следующий снимок — обновление мира, а не новый вход', async () => {
    const { net, env } = await joined();
    lastWs().hear(resync(2));
    expect(env.enters).toHaveLength(1);
    expect(env.snaps.at(-1)).toEqual({
      seq: 2,
      time: 7_000,
      admit: false,
      fanfare: false,
      catchUp: false,
    });
    expect(net.NET).toBe(true);
  });

  it('билет места, выданный сервером, ложится под ключ этого места', async () => {
    const { net } = await boot();
    net.targetMatch('m1');
    net.connect();
    lastWs().hear(welcome({ seatTicket: 'T9' }));
    expect(cell.get(`void.ticket.${BASE}|m1|Orion`)).toBe('T9');
  });

  it('часы картинки: вход начинает с нуля, следующий снимок продолжает', async () => {
    const { net } = await boot();
    net.connect();
    expect(net.netView.t).toBeNull();
    lastWs().hear(welcome());
    expect(net.netView).toMatchObject({ t: 5_000, at: 10_000, rate: 0 });
    clock = 11_000;
    lastWs().hear(resync(1)); // мир прошёл секунду за секунду
    expect(net.netView).toMatchObject({ t: 6_000, at: 11_000, rate: 1 });
    // Повторный вход (новый сокет) часы не наследует: прежний темп не тянет картинку.
    clock = 12_000;
    net.connect();
    lastWs().hear(welcome({ state: world(9_000) }));
    expect(net.netView).toMatchObject({ t: 9_000, at: 12_000, rate: 0 });
  });

  it('баннер ожидания ставит и снимает снимок, чужой баннер не трогает', async () => {
    const { net, env } = await boot();
    net.connect();
    lastWs().hear(welcome({ waiting: true }));
    expect(env.banner).toBe('⏳ ' + t('net.waiting-host'));
    lastWs().hear(resync(2));
    expect(env.banner).toBeNull();
    env.banner = 'итог матча';
    lastWs().hear(resync(3));
    expect(env.banner).toBe('итог матча');
  });
});

describe('REFM-216 — пинг и замер', () => {
  it('пинг каждые 2 с, задержка сглаживается по ответам', async () => {
    const { net } = await joined();
    vi.advanceTimersByTime(2_000);
    expect(lastWs().sentOf('ping')).toHaveLength(2);
    expect(net.rttEma).toBeNull();
    lastWs().hear({ type: 'pong', serverTime: 1, clientTime: clock - 100 });
    expect(net.rttEma).toBe(100);
    lastWs().hear({ type: 'pong', serverTime: 2, clientTime: clock - 200 });
    expect(net.rttEma).toBe(130);
  });

  it('замер раз в 30 с несёт FPS, задержку и кадры окна, и окно начинается заново', async () => {
    const { net } = await boot();
    net.connect();
    net.countNetFrame(120); // кадры хаба до входа в окно партии не попадают
    lastWs().hear(welcome());
    lastWs().hear({ type: 'pong', serverTime: 1, clientTime: clock - 40 });
    net.countNetFrame(16);
    net.countNetFrame(75);
    vi.advanceTimersByTime(29_999);
    expect(lastWs().sentOf('perf')).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(lastWs().sentOf('perf')).toEqual([
      { type: 'perf', fps: 59, rttMs: 40, longFrames: 1, worstFrameMs: 75 },
    ]);
    vi.advanceTimersByTime(30_000);
    expect(lastWs().sentOf('perf')[1]).toEqual({ type: 'perf', fps: 59, rttMs: 40 });
  });

  it('самую долгую блокировку окна даёт наблюдатель Long Animation Frames', async () => {
    let observe: ((list: { getEntries(): unknown[] }) => void) | null = null;
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        static supportedEntryTypes = ['long-animation-frame'];
        constructor(cb: (list: { getEntries(): unknown[] }) => void) {
          observe = cb;
        }
        observe(): void {}
      },
    );
    await joined();
    observe!({ getEntries: () => [{ duration: 180, scripts: [] }] });
    vi.advanceTimersByTime(30_000);
    expect(lastWs().sentOf('perf')[0]).toMatchObject({ loafMs: 180 });
  });

  it('несовпадение хеша считается десинком, совпадение его снимает', async () => {
    const { net } = await boot();
    net.connect();
    const s0 = world(5_000);
    lastWs().hear(welcome({ state: s0, hash: hashState(s0) }));
    expect([net.netDesync, net.netDesyncCount]).toEqual([false, 0]);
    const s1 = world(6_000);
    lastWs().hear({
      type: 'delta',
      matchId: 'm1',
      seq: 2,
      serverTime: 0,
      delta: diffState(s0, s1),
      hash: 'чужой',
    });
    vi.advanceTimersByTime(100);
    expect([net.netDesync, net.netDesyncCount]).toEqual([true, 1]);
    lastWs().hear(welcome({ seq: 3, state: s1, hash: hashState(s1) }));
    expect([net.netDesync, net.netDesyncCount]).toEqual([false, 1]);
  });
});

describe('REFM-216 — обрыв и переподключение', () => {
  it('обрыв в партии: сеть гаснет, приказы копятся, дозвон через секунду', async () => {
    const { net, env } = await joined();
    const client = net.netClient;
    lastWs().hear({ type: 'pong', serverTime: 1, clientTime: clock - 30 });
    lastWs().onclose?.();
    expect([net.NET, net.netAdmitted, net.reconnecting, net.rttEma]).toEqual([
      false,
      false,
      true,
      null,
    ]);
    expect(env.notes).toContain(t('net.reconnecting'));
    expect(env.banner).toBe(t('acc.reconnecting'));
    client!.sendAction({ type: 'noop', playerId: 'p2', issuedAt: 0, payload: {} } as never);
    expect(lastWs().sentOf('action')).toEqual([]);
    vi.advanceTimersByTime(999);
    expect(FakeWs.all).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeWs.all).toHaveLength(2);
    expect(lastWs().url).toBe(`${BASE}/matches/proto?nick=Orion`);
    // Пинг и замер погасли вместе с сокетом: до впуска нового провода их нет.
    vi.advanceTimersByTime(30_000);
    expect(FakeWs.all.flatMap((ws) => [...ws.sentOf('ping'), ...ws.sentOf('perf')])).toHaveLength(
      1,
    );
  });

  it('переподключение входит молча, снимает свой баннер и отдаёт очередь', async () => {
    const { net, env } = await joined();
    const client = net.netClient;
    lastWs().onclose?.();
    client!.sendAction({ type: 'noop', playerId: 'p2', issuedAt: 0, payload: {} } as never);
    vi.advanceTimersByTime(1_000);
    lastWs().onopen?.();
    lastWs().hear(welcome({ seq: 5 }));
    expect(net.netClient).toBe(client);
    expect(env.enters).toEqual([
      ['p2', true],
      ['p2', false],
    ]);
    expect(env.snaps.at(-1)).toMatchObject({ admit: true, fanfare: false, catchUp: true });
    expect([env.banner, net.reconnecting, net.NET]).toEqual([null, false, true]);
    expect(lastWs().sentOf('action')).toMatchObject([{ action: { type: 'noop' } }]);
  });

  it('впуск закрывает цикл: следующий обрыв снова начинает с секунды', async () => {
    await joined();
    lastWs().onclose?.();
    vi.advanceTimersByTime(1_000);
    lastWs().onclose?.(); // не впустили — следующая попытка через 2 с
    vi.advanceTimersByTime(2_000);
    lastWs().hear(welcome());
    lastWs().onclose?.();
    vi.advanceTimersByTime(1_000);
    expect(FakeWs.all).toHaveLength(4);
  });

  it('дозвон, который не впустили, ждёт дольше: 1, 2, 4 с', async () => {
    await joined();
    lastWs().onclose?.();
    vi.advanceTimersByTime(1_000);
    lastWs().onclose?.(); // не впустили
    vi.advanceTimersByTime(1_999);
    expect(FakeWs.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWs.all).toHaveLength(3);
    lastWs().onclose?.();
    vi.advanceTimersByTime(3_999);
    expect(FakeWs.all).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeWs.all).toHaveLength(4);
  });

  it('два сигнала об одном обрыве назначают одну попытку', async () => {
    await joined();
    lastWs().onclose?.();
    vi.advanceTimersByTime(1_000);
    lastWs().onclose?.();
    lastWs().onclose?.(); // тот же отказ ещё раз — попытка уже назначена
    vi.advanceTimersByTime(1_999);
    expect(FakeWs.all).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWs.all).toHaveLength(3);
  });

  it('исчерпанный бюджет — честная сдача: клиент с очередью уходит, экран подключения', async () => {
    const { net, env } = await joined();
    lastWs().onclose?.();
    for (let i = 0; i < 8; i++) {
      vi.advanceTimersByTime(8_000);
      lastWs().onclose?.();
    }
    expect(FakeWs.all).toHaveLength(9);
    expect([net.netClient, net.reconnecting, env.banner]).toEqual([null, false, null]);
    expect(env.status).toBe(t('acc.reconnect-failed'));
    expect(env.connect).toEqual([true]);
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.all).toHaveLength(9);
  });

  it('аккаунты: дозвон берёт свежий билет по сессии', async () => {
    const b = await boot();
    await accounts(b.acc, 'S1');
    b.net.targetMatch('m1');
    b.acc.holdJoinToken('J1');
    b.net.connect();
    lastWs().hear(welcome());
    lastWs().onclose?.();
    server = () => reply(200, { token: 'J2', playerId: 'p2' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetched.at(-1)).toEqual({ url: `${HTTP}/matches/m1/join`, auth: 'Bearer S1' });
    expect(lastWs().url).toBe(`${BASE}/matches/m1?token=J2`);
  });

  it('игрок вышел, пока ждали билет, — назад не дозваниваемся', async () => {
    const b = await boot();
    await accounts(b.acc, 'S1');
    b.acc.holdJoinToken('J1');
    b.net.connect();
    lastWs().hear(welcome());
    lastWs().onclose?.();
    let answer: (v: ReturnType<typeof reply>) => void = () => undefined;
    server = () => new Promise((r) => (answer = r)) as never;
    vi.advanceTimersByTime(1_000);
    b.net.leaveNetwork();
    answer(reply(200, { token: 'J2', playerId: 'p2' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeWs.all).toHaveLength(1);
    expect(b.acc.takeJoinToken()).toBeNull();
  });

  it('аккаунты без сессии — на экран входа, а не в новый круг попыток', async () => {
    const b = await boot();
    await accounts(b.acc, null);
    b.acc.holdJoinToken('J1');
    b.net.connect();
    lastWs().hear(welcome());
    lastWs().onclose?.();
    vi.advanceTimersByTime(1_000);
    expect([b.net.reconnecting, b.env.banner, b.env.connect]).toEqual([false, null, [true]]);
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.all).toHaveLength(1);
  });
});

describe('REFM-216 — выход из сети', () => {
  it('выход гасит сеть, сокет, таймеры и очередь; позднее закрытие ничего не трогает', async () => {
    const { net, env } = await joined();
    const ws = lastWs();
    ws.hear({ type: 'pong', serverTime: 1, clientTime: clock - 50 });
    net.leaveNetwork();
    expect([net.NET, net.netAdmitted, net.netClient, net.rttEma, ws.closed]).toEqual([
      false,
      false,
      null,
      null,
      true,
    ]);
    ws.onclose?.();
    expect([env.notes.includes(t('net.reconnecting')), env.banner, env.connect]).toEqual([
      false,
      null,
      [],
    ]);
    // Пинг и замер прежней партии не доживают до следующего дозвона.
    net.connect();
    vi.advanceTimersByTime(60_000);
    expect([lastWs().sentOf('ping'), lastWs().sentOf('perf'), FakeWs.all.length]).toEqual([
      [],
      [],
      2,
    ]);
  });

  it('выход до впуска: позднее закрытие не уводит пришедшего по ссылке ни в хаб, ни на вход', async () => {
    const { net, env } = await boot({ link: true });
    net.connect();
    const ws = lastWs();
    ws.hear({ type: 'error', code: 'E_SLOT_TAKEN' });
    net.leaveNetwork();
    ws.onclose?.();
    expect([env.hubs, env.connect, stages]).toEqual([[], [], []]);
  });

  it('выход на обрыве гасит дозвон и снимает только свой баннер', async () => {
    const { net, env } = await joined();
    lastWs().onclose?.();
    net.leaveNetwork();
    expect(env.banner).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.all).toHaveLength(1);
    env.banner = '⏳ ждём хоста';
    net.leaveNetwork();
    expect(env.banner).toBe('⏳ ждём хоста');
  });

  it('новая цель звонка гасит прежний цикл и звонит туда', async () => {
    const { net } = await joined();
    lastWs().onclose?.();
    net.targetMatch('m2');
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.all).toHaveLength(1);
    net.connect();
    expect(lastWs().url).toBe(`${BASE}/matches/m2?nick=Orion`);
  });

  it('после выхода дозвон в то же место начинается с чистого клиента', async () => {
    const { net } = await joined();
    const first = net.netClient;
    net.leaveNetwork();
    net.connect();
    expect(net.netClient).not.toBe(first);
  });
});

describe('REFM-216 — отказы', () => {
  it('отказ до впуска — словами в строке статуса, неизвестный — кодом', async () => {
    const { net, env } = await boot();
    net.connect();
    lastWs().hear({ type: 'error', code: 'E_SLOT_TAKEN' });
    expect(env.status).toBe(t('net.slot-taken'));
    lastWs().hear({ type: 'error', code: 'E_WHATEVER' });
    expect(env.status).toBe(t('net.error', { code: 'E_WHATEVER' }));
  });

  it('отказ чата после впуска — тостом, отказ приказа — звуком и тостом', async () => {
    const { env } = await joined();
    lastWs().hear({ type: 'error', code: 'E_CHAT_FLOOD' });
    lastWs().hear({ type: 'rejection', actionId: 'a1', code: 'E_NO_CAPACITY' });
    expect(env.notes.slice(-2)).toEqual([
      '✖ ' + refusalText('E_CHAT_FLOOD'),
      '✖ ' + refusalText('E_NO_CAPACITY'),
    ]);
    expect(env.sounds).toEqual(['error']);
  });

  it('пришедшего по ссылке отказ сажает на видимый экран: с сессией — в хаб', async () => {
    const b = await boot({ link: true });
    await accounts(b.acc, 'S1');
    b.net.connect();
    lastWs().hear({ type: 'error', code: 'E_SLOT_TAKEN' });
    lastWs().onclose?.();
    expect(b.env.hubs).toEqual([t('net.slot-taken')]);
    expect(stages).toEqual([]);
  });

  it('без сессии — на карточку входа', async () => {
    const { net, env } = await boot({ link: true });
    net.connect();
    lastWs().hear({ type: 'error', code: 'E_MATCH_FULL' });
    lastWs().onclose?.();
    expect([env.hubs, env.connect, stages]).toEqual([[], [true], ['welcome']]);
  });

  it('пришедший через экран подключения читает причину там же, где стоит', async () => {
    const { net, env } = await boot({ connectShown: true });
    net.connect();
    lastWs().hear({ type: 'error', code: 'E_MATCH_FULL' });
    lastWs().onclose?.();
    expect([env.hubs, env.connect, stages, env.status]).toEqual([[], [], [], t('net.match-full')]);
  });
});

describe('REFM-216 — метки, чат и события', () => {
  it('метки и реплики уходят ленте, провинцию метки даёт карта хоста', async () => {
    const { env } = await joined();
    const ping = { id: 'ping:p1:1', target: { node: 'n7' } };
    lastWs().hear({ type: 'ping.added', ping });
    lastWs().hear({ type: 'ping.removed', pingId: 'ping:p1:1' });
    lastWs().hear({ type: 'chat.msg', message: { id: 'c1', text: 'привет' } });
    expect(log.pings).toEqual([[ping, 'prov:n7']]);
    expect([log.dropped, env.pops]).toEqual([['ping:p1:1'], 1]);
    expect(log.chats).toEqual([{ id: 'c1', text: 'привет' }]);
  });

  it('события дельты идут в общий конвейер после снимка', async () => {
    const { net, env } = await boot();
    net.connect();
    const s0 = world(5_000);
    lastWs().hear(welcome({ state: s0 }));
    const ev = { type: 'battle.resolved', at: 6_000 };
    lastWs().hear({
      type: 'delta',
      matchId: 'm1',
      seq: 2,
      serverTime: 0,
      delta: diffState(s0, world(6_000)),
      events: [ev],
    });
    expect(env.snaps.at(-1)?.time).toBe(6_000);
    expect(env.events).toEqual([[ev]]);
  });
});

describe('REFM-216 — стык с main.ts', () => {
  const MAIN = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const NETS = readFileSync(new URL('./netSession.ts', import.meta.url), 'utf8');
  const hook = (name: string): string =>
    new RegExp(`\\n {2}${name}: \\([^)]*\\) => \\{([\\s\\S]*?)\\n {2}\\},\\n`).exec(MAIN)?.[1] ??
    '';

  it('сокет, клиент, таймеры и дозвон живут только у владельца', () => {
    expect(MAIN).not.toMatch(/new (WebSocket|MultiplayerClient)\(/);
    expect(MAIN).not.toMatch(
      /\b(netSock|netSeat|netTicketKey|socketAdmitted|pingTimer|perfTimer|frameWin|reconnectTimer|reconnectAttempts|userClosed|currentMatchId)\b/,
    );
    expect(MAIN).not.toMatch(/\bfunction (connect|scheduleReconnect|netClientFor|dropNetClient)\(/);
    expect(MAIN).toContain('initNetSession({');
    // Свои присваивания в чужих зонах владелец заменил дверями (правило 2 стыка линий).
    // Вход в партию с тех пор уехал к своему владельцу (`matchJoin.ts`, REFM-217).
    const JOIN = readFileSync(new URL('./matchJoin.ts', import.meta.url), 'utf8');
    expect(MAIN).toContain('countNetFrame(dt);');
    expect(JOIN).toContain('targetMatch(id);');
  });

  it('впуск сбрасывает хвосты прошлой сессии и прячет экраны', () => {
    const enter = hook('enter');
    for (const step of [
      "disarm('match', MOBILE);",
      'endScreen = null;',
      'matchEnd.reset();',
      'if (chainMode) exitChainMode();',
      'chainRouteCache.clear();',
      'showConnect(false);',
      'showHub(false);',
      "setupEl.style.display = 'none';",
    ]) {
      expect(enter, step).toContain(step);
    }
  });

  it('мир снимка: зрение этого снимка, радар, чистка выбора, перерисовка', () => {
    const snap = hook('takeSnapshot');
    // Зрение переписывает дверь тумана (`mapFog.ts`, REFM-231).
    expect(snap).toMatch(/s = snap\.state;[\s\S]*refreshVision\(\);/);
    expect(snap).toContain('netSignatures = [...radarContacts(snap.signatures)];');
    expect(snap).toContain('pruneSelection(s.fleets, ME);');
    expect(snap).toContain('invalidatePanel();');
  });

  it('модуль не тянет `main.ts`', () => {
    expect(NETS).not.toMatch(/from '\.\/main'/);
  });
});

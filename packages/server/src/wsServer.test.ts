import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import { connect, type Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import { constants, deflateRawSync, inflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  createInitialState,
  createKernel,
  parseGameData,
  type GameModule,
  type Player,
} from '@void/shared-core';
import { MatchRoom } from './matchRoom';
import type { RoomRegistry } from './roomRegistry';
import { createMultiplayerServer } from './wsServer';
import { inlineHashes } from './securityHeaders';
import { MemoryAccountStore } from './store';
import type { ServerMessage } from './protocol';

const markerModule: GameModule = {
  id: 'marker-test',
  version: '1.0.0',
  setup(api) {
    api.onAction('marker.set', (action, h) => {
      const player = h.state.players[action.playerId];
      if (!player) return h.reject('E_FORBIDDEN');
      player.resources.marker = (player.resources.marker ?? 0) + 1;
      h.emit('marker.set', { playerId: action.playerId });
    });
  },
};

function player(id: string, name = id): Player {
  return { id, name, faction: id, status: 'active', resources: {} };
}

function makeRoom(p1Name = 'p1'): MatchRoom {
  const base = createInitialState({ seed: 'ws-test', version: { data: 'test', manifest: 'test' } });
  return new MatchRoom({
    id: 'ws-room',
    initialState: { ...base, players: { p1: player('p1', p1Name), p2: player('p2') } },
    kernel: createKernel([markerModule]),
    data: parseGameData({
      version: 'test',
      resources: ['marker'],
      units: {},
      factions: {},
      buildings: {},
      events: {},
      sectors: {},
      planetTypes: {},
    }),
    now: () => 10,
  });
}

function nextMessage(ws: WebSocket): Promise<ServerMessage> {
  return once(ws, 'message').then(([data]) => JSON.parse(data.toString()) as ServerMessage);
}

describe('createMultiplayerServer', () => {
  it('accepts two players and broadcasts authoritative action results', async () => {
    const server = createMultiplayerServer({ room: makeRoom() });
    const url = await server.listen();
    const p1 = new WebSocket(`${url}?player=p1`);
    const p2 = new WebSocket(`${url}?player=p2`);
    try {
      const welcome1 = nextMessage(p1);
      const welcome2 = nextMessage(p2);
      await Promise.all([once(p1, 'open'), once(p2, 'open')]);
      expect(await welcome1).toMatchObject({ type: 'welcome', playerId: 'p1' });
      expect(await welcome2).toMatchObject({ type: 'welcome', playerId: 'p2' });

      const state1 = nextMessage(p1);
      const state2 = nextMessage(p2);
      p1.send(
        JSON.stringify({
          type: 'action',
          action: { id: 'p1:1', type: 'marker.set', playerId: 'p1', issuedAt: 1, payload: {} },
        }),
      );

      const [m1, m2] = await Promise.all([state1, state2]);
      expect(m1).toMatchObject({ type: 'delta', seq: 1 });
      expect(m2).toMatchObject({ type: 'delta', seq: 1 });
      if (m1.type !== 'delta') throw new Error('expected delta');
      const changedP1 = m1.delta.changed.players?.p1 as
        | { resources?: Record<string, number> }
        | undefined;
      expect(changedP1?.resources?.marker).toBe(1);
    } finally {
      p1.close();
      p2.close();
      await server.close();
    }
  });

  it('drops a connection-level message flood before parsing', async () => {
    const server = createMultiplayerServer({ room: makeRoom() });
    const url = await server.listen();
    const ws = new WebSocket(`${url}?player=p1`);
    try {
      await once(ws, 'open');
      let pongs = 0;
      ws.on('message', (data) => {
        if ((JSON.parse(data.toString()) as ServerMessage).type === 'pong') pongs += 1;
      });
      // Pings aren't action-rate-limited, so each one that reaches the room pongs back —
      // a clean probe for the connection flood guard. Burst far past the per-window cap.
      const BURST = 200;
      for (let i = 0; i < BURST; i += 1) ws.send(JSON.stringify({ type: 'ping', clientTime: i }));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(pongs).toBeGreaterThan(0); // the connection still works
      expect(pongs).toBeLessThanOrEqual(100); // ≪ 200 sent ⇒ the flood was dropped, not parsed
    } finally {
      ws.close();
      await server.close();
    }
  });

  it('nick-login: seats a nick and returns the SAME side on reconnect', async () => {
    const server = createMultiplayerServer({ room: makeRoom(), accountStore: new MemoryAccountStore() });
    const url = await server.listen();
    const alice = new WebSocket(`${url}?nick=alice`);
    try {
      const w = await nextMessage(alice);
      expect(w).toMatchObject({ type: 'welcome' });
      const seat = (w as { playerId: string }).playerId;
      expect(['p1', 'p2']).toContain(seat);
      alice.close();

      // a DIFFERENT nick gets the OTHER side
      const bob = new WebSocket(`${url}?nick=bob`);
      const wb = await nextMessage(bob);
      expect((wb as { playerId: string }).playerId).not.toBe(seat);
      bob.close();

      // alice returns → same side as before
      const alice2 = new WebSocket(`${url}?nick=alice`);
      const w2 = await nextMessage(alice2);
      expect((w2 as { playerId: string }).playerId).toBe(seat);
      alice2.close();
    } finally {
      await server.close();
    }
  });

  it('NETA2-1: a full match refuses a newcomer with a READABLE error, not a dead socket', async () => {
    const server = createMultiplayerServer({ room: makeRoom(), accountStore: new MemoryAccountStore() });
    const url = await server.listen();
    try {
      const alice = new WebSocket(`${url}?nick=alice`);
      await nextMessage(alice); // seats p1
      const bob = new WebSocket(`${url}?nick=bob`);
      await nextMessage(bob); // seats p2 — the 2-seat room is now full
      // A third nick finds every seat taken. Before NETA2-1 the upgrade was destroyed
      // (which a browser reads as "server down"); now the handshake COMPLETES and the
      // reason rides an `error` frame the client can actually show.
      const carol = new WebSocket(`${url}?nick=carol`);
      const msg = await nextMessage(carol);
      expect(msg).toMatchObject({ type: 'error', code: 'E_MATCH_FULL' });
      alice.close();
      bob.close();
      carol.close();
    } finally {
      await server.close();
    }
  });
});

describe('адрес партии как путь (ADDR-3)', () => {
  const CLIENT = '<!doctype html><title>client</title>';

  /** http-origin сервера: `listen()` отдаёт ws-адрес матча, здесь нужен корень. */
  const httpBase = (wsUrl: string): string =>
    wsUrl.replace(/^ws/, 'http').replace(/\/matches(\/.*)?$/, '');

  it('КЛИЕНТ ОТДАЁТСЯ И НА /game/<id>: иначе скопированный адрес партии — 404', async () => {
    // Смысл ADDR-3 в том, что адрес копируется целиком и открывается в новой вкладке.
    // Клиентская маршрутизация без серверного маршрута этого не даёт: первая же
    // холодная загрузка по такому адресу упрётся в «страница не найдена».
    const server = createMultiplayerServer({ room: makeRoom(), indexHtml: CLIENT });
    const base = httpBase(await server.listen());
    try {
      for (const path of ['/', '/index.html', '/game/proto', '/game/m-9f2c4b']) {
        const res = await fetch(`${base}${path}`);
        expect([path, res.status]).toEqual([path, 200]);
        expect(await res.text()).toBe(CLIENT);
      }
    } finally {
      await server.close();
    }
  });

  it('без клиента в сборке маршрута нет вовсе — сервер не выдумывает страницу', async () => {
    const server = createMultiplayerServer({ room: makeRoom() });
    const base = httpBase(await server.listen());
    try {
      expect((await fetch(`${base}/game/proto`)).status).toBe(404);
    } finally {
      await server.close();
    }
  });
});

// Регрессия того же класса, что замершая карта и вставшие часы матча: асинхронная работа,
// запущенная как «выстрелил и забыл», обязана содержать своё отклонение. Node с 15-й версии
// убивает процесс на необработанном отклонении промиса — значит одно неудачное сообщение
// одного игрока уносило бы с собой ВСЕ матчи этого процесса. `receive` может отклониться
// по-настоящему: `await this.enqueue(...)` в нём возвращает непойманный промис ящика.
describe('createMultiplayerServer · сбой обработки сообщения не роняет сервер', () => {
  it('отклонение receive() содержится: соединение остаётся живым', async () => {
    const room = makeRoom();
    (room as unknown as { receive: () => Promise<void> }).receive = () =>
      Promise.reject(new Error('boom'));
    const server = createMultiplayerServer({ room });
    const url = await server.listen();
    try {
      const ws = new WebSocket(`${url}?player=p1`);
      const welcome = nextMessage(ws);
      await once(ws, 'open');
      await welcome; // приветствие шлёт сам сервер, оно через receive не идёт
      ws.send(JSON.stringify({ type: 'ping' }));
      await new Promise((r) => setTimeout(r, 50));
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    } finally {
      await server.close();
    }
  });
});

/** Сырой TCP-клиент: просит апгрейд по адресу `url` и сразу за запросом, в той же записи,
 *  шлёт `after` — то, чего клиент `ws` не пошлёт никогда. */
function rawUpgrade(url: string, after: Buffer = Buffer.alloc(0)): Socket {
  const { hostname, port, pathname, search } = new URL(url);
  const socket = connect(Number(port), hostname);
  socket.on('error', () => {
    /* обрыв на стороне клиента — не предмет этих тестов */
  });
  // Ответ сервера здесь никто не читает; без потока не пришли бы и `end`/`close` за ним.
  socket.resume();
  const request =
    `GET ${pathname}${search} HTTP/1.1\r\nHost: ${hostname}:${port}\r\n` +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\n\r\n`;
  socket.write(Buffer.concat([Buffer.from(request), after]));
  return socket;
}

/** Кадр клиента на 40 000 байт, больше `maxPayload`. Маска у него есть, как положено
 *  клиенту; содержимое `ws` не читает: отказ случается на заголовке. */
function oversizedFrame(): Buffer {
  const head = Buffer.alloc(10);
  head[0] = 0x81; // FIN, text
  head[1] = 0x80 | 127; // masked, 64-bit length
  head.writeBigUInt64BE(40_000n, 2);
  return Buffer.concat([head, randomBytes(4), Buffer.alloc(40_000)]);
}

// Тот же класс на уровне сокета. Кадр, который `ws` отвергает (больше `maxPayload`, битый),
// он закрывает сам и потом шлёт сокету событие `error`; сброс соединения посреди асинхронного
// рукопожатия даёт `error` на голом TCP-сокете. Без слушателя это uncaught exception, а фатал
// хостов (`fatal.ts`) на нём завершает процесс со всеми матчами, то есть одному клиенту
// хватало одного кадра. Vitest валит прогон на таком исключении, так что пропавший слушатель
// роняет гейт, даже если сам тест успел пройти.
describe('createMultiplayerServer · один клиент не роняет сервер', () => {
  it('сообщение больше 32 КБ закрывает только свой сокет (1009), оператору остаётся строка', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const server = createMultiplayerServer({ room: makeRoom() });
    const url = await server.listen();
    try {
      const p1 = new WebSocket(`${url}?player=p1`, { perMessageDeflate: false });
      await nextMessage(p1); // приветствие
      const closed = once(p1, 'close');
      p1.send('x'.repeat(40_000));
      expect((await closed)[0]).toBe(1009); // message too big
      expect(write).toHaveBeenCalledWith(
        expect.stringContaining('[ws] socket error for p1 in match ws-room'),
      );
      const p2 = new WebSocket(`${url}?player=p2`);
      expect(await nextMessage(p2)).toMatchObject({ type: 'welcome' });
      p2.close();
    } finally {
      write.mockRestore();
      await server.close();
    }
  });

  it('битый кадр закрывает только свой сокет', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const server = createMultiplayerServer({ room: makeRoom() });
    const url = await server.listen();
    try {
      const p1 = rawUpgrade(`${url}?player=p1`);
      await once(p1, 'data'); // 101 Switching Protocols
      const closed = new Promise((r) => p1.once('close', r));
      p1.write(Buffer.from([0x81, 0x02, 0x68, 0x69])); // «hi» без маски, а кадр клиента обязан её нести
      await closed;
      expect(write).toHaveBeenCalledWith(
        expect.stringContaining('[ws] socket error for p1 in match ws-room'),
      );
      const p2 = new WebSocket(`${url}?player=p2`);
      expect(await nextMessage(p2)).toMatchObject({ type: 'welcome' });
      p2.close();
    } finally {
      write.mockRestore();
      await server.close();
    }
  });

  it('тот же кадр от того, кому отказано во входе, тоже остаётся при его сокете', async () => {
    const server = createMultiplayerServer({
      room: makeRoom(),
      accountStore: new MemoryAccountStore(),
    });
    const url = await server.listen();
    try {
      const alice = new WebSocket(`${url}?nick=alice`);
      const bob = new WebSocket(`${url}?nick=bob`);
      await Promise.all([nextMessage(alice), nextMessage(bob)]); // оба места заняты
      // Кадр едет в одной записи с запросом и потому доходит до сокета, как бы быстро
      // сервер ни закрывал его отказом.
      const carol = rawUpgrade(`${url}?nick=carol`, oversizedFrame());
      await new Promise((r) => carol.once('close', r));
      alice.close();
      bob.close();
    } finally {
      await server.close();
    }
  });

  it('сброс соединения, пока рукопожатие ждёт загрузки матча, процесс не трогает', async () => {
    const room = makeRoom();
    let release = (): void => {};
    const loading = new Promise<void>((r) => (release = r));
    const registry: RoomRegistry = {
      get: (id) => (id === room.id ? room : undefined),
      ids: () => [room.id],
      resolve: async (id) => {
        await loading;
        return id === room.id ? room : undefined;
      },
    };
    const server = createMultiplayerServer({ registry });
    const url = await server.listen();
    try {
      // Слушатель встаёт после серверного, так что к его вызову рукопожатие уже ждёт `resolve`.
      const serverSide = new Promise<Duplex>((r) =>
        server.httpServer.once('upgrade', (_req, socket: Duplex) => r(socket)),
      );
      const client = rawUpgrade(`${url}?player=p1`);
      const socket = await serverSide;
      // Не `once` из node:events: он сам вешает слушатель `error` и спрятал бы ошибку.
      const gone = new Promise((r) => socket.once('close', r));
      client.resetAndDestroy(); // RST, а не FIN: чтение на сервере падает с ECONNRESET
      await gone;
      release();
      const p2 = new WebSocket(`${url}?player=p2`);
      expect(await nextMessage(p2)).toMatchObject({ type: 'welcome' });
      p2.close();
    } finally {
      release();
      await server.close();
    }
  });
});

// SE-7.1 — заголовки доставки. Правило живёт в `securityHeaders.ts` и покрыто там;
// здесь проверяется ПРОВОДКА: что политика правда уезжает с ответом и что её хеш
// совпадает с тем самым документом, а не с абстрактным.
describe('заголовки доставки клиента (SE-7.1)', () => {
  const CLIENT = '<!doctype html><title>c</title><style>b{color:#000}</style><script>go()</script>';
  const httpBase = (wsUrl: string): string =>
    wsUrl.replace(/^ws/, 'http').replace(/\/matches(\/.*)?$/, '');

  it('документ уходит с политикой, построенной по ЕГО инлайновым блокам', async () => {
    const server = createMultiplayerServer({ room: makeRoom(), indexHtml: CLIENT });
    const base = httpBase(await server.listen());
    try {
      const res = await fetch(`${base}/`);
      const csp = res.headers.get('content-security-policy') ?? '';
      const { scripts, styles } = inlineHashes(CLIENT);
      expect(csp).toContain(`script-src ${scripts[0]}`);
      expect(csp).toContain(`style-src ${styles[0]}`);
      // `unsafe-inline` — только у атрибутов `style` (правило 8 `securityHeaders.ts`).
      expect(csp.match(/'unsafe-inline'/g)).toHaveLength(1);
      expect(csp).toContain("style-src-attr 'unsafe-inline'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      // По http HSTS не ставится: он запомнился бы браузером на весь localhost.
      expect(res.headers.get('strict-transport-security')).toBeNull();
    } finally {
      await server.close();
    }
  });

  it('другие документы хоста уходят со СВОЕЙ политикой, а не с политикой для JSON', async () => {
    // Дев-клиент и пульт прото-хоста были обычными маршрутами. Им доставалась базовая
    // политика API (`default-src 'none'`), и скрипт документа не запускался вовсе.
    const DEV = '<!doctype html><title>d</title><style>i{color:red}</style><script>dev()</script>';
    const server = createMultiplayerServer({
      room: makeRoom(),
      indexHtml: CLIENT,
      documents: [{ routes: ['/dev', '/dev/game/:matchId'], html: DEV }],
    });
    const base = httpBase(await server.listen());
    try {
      const { scripts, styles } = inlineHashes(DEV);
      for (const path of ['/dev', '/dev/game/m-9f2c4b']) {
        const res = await fetch(`${base}${path}`);
        expect(await res.text()).toBe(DEV);
        const csp = res.headers.get('content-security-policy') ?? '';
        expect(csp, path).toContain(`script-src ${scripts[0]}`);
        expect(csp, path).toContain(`style-src ${styles[0]}`);
        // Хеш игры сюда не подходит: у каждого документа политика по его же блокам.
        expect(csp, path).not.toContain(inlineHashes(CLIENT).scripts[0]);
        expect(res.headers.get('cache-control'), path).toBe('no-store, must-revalidate');
      }
    } finally {
      await server.close();
    }
  });

  it('площадке-порталу встраивание разрешается параметром, а не снятием заголовка', async () => {
    const server = createMultiplayerServer({
      room: makeRoom(),
      indexHtml: CLIENT,
      frameAncestors: ['https://portal.example'],
    });
    const base = httpBase(await server.listen());
    try {
      const csp = (await fetch(`${base}/`)).headers.get('content-security-policy') ?? '';
      expect(csp).toContain('frame-ancestors https://portal.example');
    } finally {
      await server.close();
    }
  });

  it('JSON-ответ тоже защищён: исполнять там нечего, и тип угадывать не надо', async () => {
    const server = createMultiplayerServer({ room: makeRoom() });
    const base = httpBase(await server.listen());
    try {
      const res = await fetch(`${base}/health`);
      expect(res.headers.get('content-security-policy')).toBe(
        "default-src 'none'; frame-ancestors 'none'",
      );
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    } finally {
      await server.close();
    }
  });
});

/** A WebSocket handshake by hand, offering `extensions` exactly as a browser words it. */
function upgrade(
  url: string,
  extensions?: string,
): Promise<{ status: number; extensions?: string; socket?: Socket; head?: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(url.replace(/^ws/, 'http'), {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        ...(extensions ? { 'Sec-WebSocket-Extensions': extensions } : {}),
      },
    });
    req.on('upgrade', (res, socket, head) => {
      const ext = res.headers['sec-websocket-extensions'];
      resolve({ status: res.statusCode ?? 0, ...(ext ? { extensions: ext } : {}), socket, head });
    });
    req.on('response', (res) => resolve({ status: res.statusCode ?? 0 }));
    req.on('error', reject);
    req.end();
  });
}

interface Frame {
  opcode: number;
  rsv1: boolean;
  payload: Buffer;
}

/** The server's frames off a raw socket, one at a time (a server never masks). */
function frameReader(socket: Socket, head: Buffer): () => Promise<Frame> {
  let buf = head;
  const ready: Frame[] = [];
  let waiting: ((f: Frame) => void) | null = null;
  const parse = (): void => {
    for (;;) {
      if (buf.length < 2) return;
      let len = buf[1]! & 0x7f;
      let at = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        at = 10;
      }
      if (buf.length < at + len) return;
      const frame = {
        opcode: buf[0]! & 0x0f,
        rsv1: (buf[0]! & 0x40) !== 0,
        payload: buf.subarray(at, at + len),
      };
      buf = buf.subarray(at + len);
      if (waiting) {
        const w = waiting;
        waiting = null;
        w(frame);
      } else ready.push(frame);
    }
  };
  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    parse();
  });
  parse();
  return () => {
    const f = ready.shift();
    return f ? Promise.resolve(f) : new Promise((resolve) => (waiting = resolve));
  };
}

/** A permessage-deflate payload back to text: the sender flushed (no final block) and
 *  dropped the 00 00 ff ff tail of the flush. */
const inflate = (payload: Buffer): string =>
  inflateRawSync(Buffer.concat([payload, Buffer.from([0, 0, 0xff, 0xff])]), {
    finishFlush: constants.Z_SYNC_FLUSH,
  }).toString();

/** A client's compressed text frame (RSV1 set, masked) carrying `text`, as a browser
 *  compresses it: raw deflate, flushed, without the 00 00 ff ff tail. */
function compressedFrame(text: string): Buffer {
  const payload = deflateRawSync(text, { finishFlush: constants.Z_SYNC_FLUSH }).subarray(0, -4);
  const mask = randomBytes(4);
  const head =
    payload.length < 126
      ? Buffer.from([0xc1, 0x80 | payload.length])
      : Buffer.from([0xc1, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([head, mask, payload.map((b, i) => b ^ mask[i % 4]!)]);
}

describe('socket compression (permessage-deflate)', () => {
  const AGREED = 'permessage-deflate; server_no_context_takeover; server_max_window_bits=12';

  it('agrees to the offers browsers make: bare from WebKit (every iOS browser), windowed from Chromium', async () => {
    const server = createMultiplayerServer({ room: makeRoom() });
    const url = await server.listen();
    try {
      for (const offer of ['permessage-deflate', 'permessage-deflate; client_max_window_bits']) {
        const r = await upgrade(`${url}?player=p1`, offer);
        expect([offer, r.status, r.extensions]).toEqual([offer, 101, AGREED]);
        r.socket?.destroy();
      }
      const plain = await upgrade(`${url}?player=p2`); // no offer: the socket stays uncompressed
      expect([plain.status, plain.extensions]).toEqual([101, undefined]);
      plain.socket?.destroy();
    } finally {
      await server.close();
    }
  });

  it('sends a full snapshot compressed and whole, a small delta as is', async () => {
    const server = createMultiplayerServer({ room: makeRoom('Империя '.repeat(5_000)) });
    const url = await server.listen();
    const p2 = new WebSocket(`${url}?player=p2`);
    const p2Open = once(p2, 'open');
    try {
      const r = await upgrade(`${url}?player=p1`, 'permessage-deflate'); // as WebKit offers it
      const next = frameReader(r.socket!, r.head!);
      const welcome = await next();
      const json = inflate(welcome.payload);
      expect(welcome.rsv1).toBe(true);
      expect(JSON.parse(json)).toMatchObject({ type: 'welcome', playerId: 'p1' });
      expect(welcome.payload.length * 20).toBeLessThan(Buffer.byteLength(json));

      await p2Open;
      p2.send(
        JSON.stringify({
          type: 'action',
          action: { id: 'p2:1', type: 'marker.set', playerId: 'p2', issuedAt: 1, payload: {} },
        }),
      );
      const delta = await next(); // under the threshold: not worth compressing
      expect(delta.rsv1).toBe(false);
      expect(JSON.parse(delta.payload.toString())).toMatchObject({ type: 'delta', seq: 1 });
      r.socket?.destroy();
    } finally {
      p2.close();
      await server.close();
    }
  });

  it('cuts a compressed client message off at the payload cap, counted inflated', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const server = createMultiplayerServer({ room: makeRoom() });
    const url = await server.listen();
    try {
      const r = await upgrade(`${url}?player=p1`, 'permessage-deflate');
      const next = frameReader(r.socket!, r.head!);
      // 200 KB that deflates to a few hundred bytes: small on the wire, over the cap inflated.
      const bomb = compressedFrame(
        JSON.stringify({ type: 'chat.send', channel: 'session', text: 'a'.repeat(200_000) }),
      );
      expect(bomb.length).toBeLessThan(1_000);
      r.socket!.write(bomb);
      let frame = await next(); // the welcome first
      while (frame.opcode !== 0x8) frame = await next();
      expect(frame.payload.readUInt16BE(0)).toBe(1009); // message too big
      expect(write).toHaveBeenCalledWith(expect.stringContaining('Max payload size exceeded'));
      const p2 = new WebSocket(`${url}?player=p2`);
      expect(await nextMessage(p2)).toMatchObject({ type: 'welcome' });
      p2.close();
      r.socket?.destroy();
    } finally {
      write.mockRestore();
      await server.close();
    }
  });
});

import { once } from 'node:events';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket, type ClientOptions } from 'ws';
import { createInitialState, createKernel, parseGameData, type Player } from '@void/shared-core';
import { MatchRoom } from './matchRoom';
import type { SecurityAudit } from './securityAudit';
import {
  createMultiplayerServer,
  upgradeClientAddress,
  wsLimitsFromEnv,
  WS_HANDSHAKE_RATE_DEFAULT,
} from './wsServer';
import type { ServerMessage } from './protocol';

// Лимиты WS-рукопожатия на адрес клиента: частота попыток и число открытых сокетов.

function player(id: string): Player {
  return { id, name: id, faction: id, status: 'active', resources: {} };
}

function makeRoom(): MatchRoom {
  const base = createInitialState({
    seed: 'ws-limits',
    version: { data: 'test', manifest: 'test' },
  });
  return new MatchRoom({
    id: 'ws-room',
    initialState: { ...base, players: { p1: player('p1'), p2: player('p2') } },
    kernel: createKernel([]),
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
  return once(ws, 'message').then(([data]) => JSON.parse(String(data)) as ServerMessage);
}

/** HTTP-статус отбитого рукопожатия; рукопожатие, которое прошло, — ошибка теста. */
function rejectStatus(target: string, opts?: ClientOptions): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(target, opts);
    ws.on('unexpected-response', (_req, res) => {
      ws.terminate();
      resolve(res.statusCode ?? 0);
    });
    ws.on('open', () => {
      ws.close();
      reject(new Error('expected the handshake to be rejected, but it connected'));
    });
    ws.on('error', () => {
      /* сервер пишет голый статус и рвёт сокет — его несёт 'unexpected-response' */
    });
  });
}

/** Адрес несуществующего матча: рукопожатие, прошедшее лимит, честно получает 404. */
const unknownMatch = (url: string): string => url.replace(/\/matches\/.*$/, '/matches/nope');

/** Заголовки, с которыми рукопожатие приходит от прокси (HTTPS-1.1 требует proto). */
const viaProxy = (forwardedFor: string): ClientOptions => ({
  headers: { 'x-forwarded-proto': 'https', 'x-forwarded-for': forwardedFor },
});

describe('лимит частоты WS-рукопожатий на адрес', () => {
  it('сверх бюджета за окно — 429 и запись в аудит, другой адрес не задет', async () => {
    const record = vi.fn();
    const server = createMultiplayerServer({
      room: makeRoom(),
      wsHandshakeRate: { max: 3, windowMs: 60_000 },
      securityAudit: { record } as unknown as SecurityAudit,
    });
    const url = unknownMatch(await server.listen());
    try {
      for (let i = 0; i < 3; i += 1) expect(await rejectStatus(url)).toBe(404);
      expect(await rejectStatus(url)).toBe(429);
      expect(record).toHaveBeenCalledWith('rate.limit', 'E_RATE_LIMIT');
      // Второй адрес на той же машине: на Linux вся 127.0.0.0/8 — петля.
      if (process.platform === 'linux') {
        expect(await rejectStatus(url, { localAddress: '127.0.0.2' })).toBe(404);
      }
    } finally {
      await server.close();
    }
  });
});

describe('лимит открытых сокетов на адрес', () => {
  it('лишний сокет отбивается 429, после закрытия одного вход снова открыт', async () => {
    const room = makeRoom();
    const server = createMultiplayerServer({ room, wsMaxPerIp: 2 });
    const url = await server.listen();
    const open: WebSocket[] = [];
    try {
      // Отбитые рукопожатия места не занимают.
      for (let i = 0; i < 3; i += 1) expect(await rejectStatus(unknownMatch(url))).toBe(404);
      for (const id of ['p1', 'p2']) {
        const ws = new WebSocket(`${url}?player=${id}`);
        open.push(ws);
        expect(await nextMessage(ws)).toMatchObject({ type: 'welcome', playerId: id });
      }
      expect(await rejectStatus(`${url}?player=p1`)).toBe(429);

      const first = open.shift() as WebSocket;
      first.close();
      // Счётчик падает на серверном 'close' — там же комната отпускает игрока.
      await vi.waitFor(() => expect(room.peerCount).toBe(1));
      const again = new WebSocket(`${url}?player=p1`);
      open.push(again);
      expect(await nextMessage(again)).toMatchObject({ type: 'welcome', playerId: 'p1' });
    } finally {
      for (const ws of open) ws.terminate();
      await server.close();
    }
  });
});

describe('адрес клиента за прокси (trustProxy)', () => {
  it('лимит считается по адресу из X-Forwarded-For, а не по адресу прокси', async () => {
    const server = createMultiplayerServer({
      room: makeRoom(),
      trustProxy: true,
      wsHandshakeRate: { max: 2, windowMs: 60_000 },
    });
    const url = unknownMatch(await server.listen());
    try {
      expect(await rejectStatus(url, viaProxy('203.0.113.1'))).toBe(404);
      expect(await rejectStatus(url, viaProxy('203.0.113.1'))).toBe(404);
      expect(await rejectStatus(url, viaProxy('203.0.113.1'))).toBe(429);
      // Другой клиент за тем же прокси — свой бюджет.
      expect(await rejectStatus(url, viaProxy('203.0.113.2'))).toBe(404);
      // Левую запись цепочки вписывает клиент, правую — прокси: считается правая.
      expect(await rejectStatus(url, viaProxy('203.0.113.9, 203.0.113.1'))).toBe(429);
    } finally {
      await server.close();
    }
  });

  it('WS и HTTP видят один и тот же адрес клиента', async () => {
    const server = createMultiplayerServer({
      room: makeRoom(),
      trustProxy: true,
      httpRoutes: (app) => {
        app.get('/ip', async (request) => ({ ip: request.ip }));
      },
    });
    const port = new URL(await server.listen()).port;
    const httpIp = (forwardedFor?: string): Promise<string> =>
      new Promise((resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port,
            path: '/ip',
            headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
          },
          (res) => {
            let body = '';
            res.on('data', (chunk: Buffer) => (body += String(chunk)));
            res.on('end', () => resolve((JSON.parse(body) as { ip: string }).ip));
          },
        );
        req.on('error', reject);
        req.end();
      });
    const wsIp = (forwardedFor?: string): string =>
      upgradeClientAddress(
        {
          socket: { remoteAddress: '127.0.0.1' },
          headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
        } as unknown as IncomingMessage,
        true,
      );
    try {
      for (const header of [
        undefined,
        '203.0.113.5',
        '198.51.100.7, 203.0.113.5',
        ' 203.0.113.5 ,',
      ]) {
        expect(await httpIp(header)).toBe(wsIp(header));
      }
      expect(wsIp('198.51.100.7, 203.0.113.5')).toBe('203.0.113.5');
      expect(wsIp()).toBe('127.0.0.1');
    } finally {
      await server.close();
    }
  });

  it('без trustProxy заголовок не значит ничего', () => {
    const request = {
      socket: { remoteAddress: '127.0.0.1' },
      headers: { 'x-forwarded-for': '203.0.113.5' },
    } as unknown as IncomingMessage;
    expect(upgradeClientAddress(request, false)).toBe('127.0.0.1');
  });
});

describe('wsLimitsFromEnv', () => {
  it('читает три переменные; мусор оставляет дефолт, а не снимает лимит', () => {
    expect(
      wsLimitsFromEnv({ WS_RATE_MAX: '10', WS_RATE_WINDOW_MS: '1000', WS_MAX_PER_IP: '4' }),
    ).toEqual({
      wsHandshakeRate: { max: 10, windowMs: 1000 },
      wsMaxPerIp: 4,
    });
    expect(wsLimitsFromEnv({ WS_RATE_MAX: '10' })).toEqual({
      wsHandshakeRate: { max: 10, windowMs: WS_HANDSHAKE_RATE_DEFAULT.windowMs },
    });
    expect(
      wsLimitsFromEnv({ WS_RATE_MAX: 'many', WS_RATE_WINDOW_MS: '0', WS_MAX_PER_IP: '-1' }),
    ).toEqual({});
    expect(wsLimitsFromEnv({})).toEqual({});
  });
});

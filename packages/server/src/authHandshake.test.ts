import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createDevMatch, loadShippedData } from './scenario';
import { createMultiplayerServer } from './wsServer';
import { hmacSecret, signJoinToken, type JoinClaim } from './auth';
import type { ServerMessage } from './protocol';

// SE-0.1 — the authenticated WS handshake (closes F-01). When `auth` is configured, a
// verified join token is the SOLE identity: ?player=/?nick= no longer work, the token's
// matchId must match the routed match, and its playerId must be a seat. The Origin
// allowlist (F-06) rejects cross-site upgrades. With no `auth`, the dev handshake is
// unchanged (covered by wsServer.test.ts).

const data = loadShippedData();
const secret = hmacSecret('handshake-test-secret');
const auth = { key: secret, algorithms: ['HS256'], issuer: 'void', audience: 'match' };
const signCfg = { key: secret, algorithm: 'HS256', issuer: 'void', audience: 'match' };

function token(claim: JoinClaim, ttlSeconds = 300): Promise<string> {
  return signJoinToken(claim, signCfg, { ttlSeconds });
}

function nextMessage(ws: WebSocket): Promise<ServerMessage> {
  return once(ws, 'message').then(([data]) => JSON.parse(data.toString()) as ServerMessage);
}

/** Connect expecting the upgrade to be REJECTED; resolves the HTTP status the server sent. */
function rejectStatus(
  target: string,
  opts?: { origin?: string; headers?: Record<string, string> },
): Promise<number> {
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
      /* the server writes a raw 401/403 then destroys — 'unexpected-response' carries it */
    });
  });
}

describe('SE-0.1 · authenticated handshake', () => {
  it('accepts a valid join token and seats its player', async () => {
    const server = createMultiplayerServer({ room: createDevMatch(data), auth });
    const url = await server.listen();
    const t = await token({ matchId: 'dev', playerId: 'green' });
    const ws = new WebSocket(`${url}?token=${t}`);
    try {
      const welcome = await nextMessage(ws);
      expect(welcome).toMatchObject({ type: 'welcome', playerId: 'green' });
    } finally {
      ws.close();
      await server.close();
    }
  });

  it('rejects a missing token (401)', async () => {
    const server = createMultiplayerServer({ room: createDevMatch(data), auth });
    const url = await server.listen();
    try {
      expect(await rejectStatus(url)).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('ignores ?player= when auth is on (no bypass → 401)', async () => {
    const server = createMultiplayerServer({ room: createDevMatch(data), auth });
    const url = await server.listen();
    try {
      expect(await rejectStatus(`${url}?player=green`)).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('rejects an expired token (401)', async () => {
    const server = createMultiplayerServer({ room: createDevMatch(data), auth });
    const url = await server.listen();
    const t = await token({ matchId: 'dev', playerId: 'green' }, -60);
    try {
      expect(await rejectStatus(`${url}?token=${t}`)).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('rejects a token minted for a different match (403)', async () => {
    const server = createMultiplayerServer({ room: createDevMatch(data), auth });
    const url = await server.listen();
    const t = await token({ matchId: 'other-match', playerId: 'green' });
    try {
      expect(await rejectStatus(`${url}?token=${t}`)).toBe(403);
    } finally {
      await server.close();
    }
  });

  it('rejects a token whose player is not a seat in the match (403)', async () => {
    const server = createMultiplayerServer({ room: createDevMatch(data), auth });
    const url = await server.listen();
    const t = await token({ matchId: 'dev', playerId: 'ghost' });
    try {
      expect(await rejectStatus(`${url}?token=${t}`)).toBe(403);
    } finally {
      await server.close();
    }
  });

  it('enforces the Origin allowlist (F-06)', async () => {
    const server = createMultiplayerServer({
      room: createDevMatch(data),
      auth,
      allowedOrigins: ['https://play.example'],
    });
    const url = await server.listen();
    const t = await token({ matchId: 'dev', playerId: 'green' });
    try {
      // off-allowlist Origin → 403, even with a valid token
      expect(await rejectStatus(`${url}?token=${t}`, { origin: 'https://evil.example' })).toBe(403);

      // on-allowlist Origin + valid token → connects
      const ws = new WebSocket(`${url}?token=${t}`, { origin: 'https://play.example' });
      try {
        expect(await nextMessage(ws)).toMatchObject({ type: 'welcome', playerId: 'green' });
      } finally {
        ws.close();
      }
    } finally {
      await server.close();
    }
  });
});

/**
 * SEC-33. `cache-control: no-store` на всём HTTP-периметре. До этого директив кэширования
 * не ставил НИКТО, кроме HTML-индекса, — то есть личный JSON игрока (`/arsenal/me`,
 * `/corps/me`, `/ava/*`) браузер был волен положить на диск и показать после выхода из
 * аккаунта или по кнопке «Назад». Общий кэш такое не хранит сам (сессия в `Authorization`,
 * RFC 9111 §3.5), а private cache — хранит, и именно он здесь дыра. Проверяем на `/health`
 * и `/matches`: хук `onRequest` общий, поэтому поведение видно на любом маршруте.
 */
describe('cache-control на HTTP-маршрутах (SEC-33)', () => {
  // Именно ORIGIN, а не `replace(/\/$/, '')` как у соседей: `listen()` отдаёт URL С ПУТЁМ
  // (`ws://host:port/matches/dev/`), и обрезка одного слэша оставляет префикс `/matches/dev`.
  // Соседним тестам это сходит с рук — хук `onRequest` отрабатывает и на 404, — но здесь
  // проверяется РЕАЛЬНЫЙ обработчик индекса, и до него надо доехать.
  const httpBase = (wsUrl: string): string => new URL(wsUrl.replace(/^ws/, 'http')).origin;

  it('API-ответы приходят с no-store', async () => {
    const server = createMultiplayerServer({ room: createDevMatch(data) });
    const url = httpBase(await server.listen());
    try {
      const health = await fetch(`${url}/health`);
      expect(health.headers.get('cache-control')).toBe('no-store');

      const matches = await fetch(`${url}/matches`);
      expect(matches.headers.get('cache-control')).toBe('no-store');
    } finally {
      await server.close();
    }
  });

  it('HTML-индекс сохраняет свой более строгий заголовок — обработчик перекрывает хук', async () => {
    const server = createMultiplayerServer({
      room: createDevMatch(data),
      indexHtml: '<!doctype html><title>t</title>',
    });
    const url = httpBase(await server.listen());
    try {
      const res = await fetch(`${url}/`);
      // Не просто «no-store»: свежесть клиента держится на must-revalidate, и хук,
      // отработавший РАНЬШЕ обработчика, не должен был его затереть.
      expect(res.headers.get('cache-control')).toBe('no-store, must-revalidate');
    } finally {
      await server.close();
    }
  });
});

/**
 * SEC-21. Origin-allowlist охраняет ТЕПЕРЬ и HTTP-периметр, а не только рукопожатие.
 * До этого `Access-Control-Allow-Origin: *` стоял безусловно на всех маршрутах, то есть
 * одна и та же сессия была защищена на WS и открыта на `/auth/*`, `/matches`, `/corps/*`.
 * Проверяем на `/health` — он не требует ни авторизации, ни состояния, а хук CORS общий
 * для всех маршрутов (`onRequest`), поэтому поведение заголовка виден на нём в чистом виде.
 */
describe('CORS на HTTP-маршрутах (SEC-21)', () => {
  const httpBase = (wsUrl: string): string => wsUrl.replace(/^ws/, 'http').replace(/\/$/, '');

  it('со списком: эхо разрешённого Origin + Vary, чужой Origin остаётся без заголовка', async () => {
    const server = createMultiplayerServer({
      room: createDevMatch(data),
      allowedOrigins: ['https://play.example'],
    });
    const url = httpBase(await server.listen());
    try {
      const ok = await fetch(`${url}/health`, { headers: { origin: 'https://play.example' } });
      expect(ok.headers.get('access-control-allow-origin')).toBe('https://play.example');
      // Без Vary общий кэш отдаст этот ответ чужому origin'у — ограничение обходится.
      expect(ok.headers.get('vary')).toBe('Origin');

      const evil = await fetch(`${url}/health`, { headers: { origin: 'https://evil.example' } });
      // Заголовка НЕТ вовсе: браузер сам заблокирует чтение ответа.
      expect(evil.headers.get('access-control-allow-origin')).toBeNull();
      expect(evil.headers.get('vary')).toBe('Origin');
    } finally {
      await server.close();
    }
  });

  it('без списка: прежний `*` — дев-харнесс и LAN-плейтест не трогаем', async () => {
    const server = createMultiplayerServer({ room: createDevMatch(data) });
    const url = httpBase(await server.listen());
    try {
      const res = await fetch(`${url}/health`, { headers: { origin: 'https://anything.example' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    } finally {
      await server.close();
    }
  });

  it('preflight OPTIONS отвечает 204 и уважает тот же список', async () => {
    const server = createMultiplayerServer({
      room: createDevMatch(data),
      allowedOrigins: ['https://play.example'],
    });
    const url = httpBase(await server.listen());
    try {
      const ok = await fetch(`${url}/matches`, {
        method: 'OPTIONS',
        headers: { origin: 'https://play.example', 'access-control-request-method': 'GET' },
      });
      expect(ok.status).toBe(204);
      expect(ok.headers.get('access-control-allow-origin')).toBe('https://play.example');

      const evil = await fetch(`${url}/matches`, {
        method: 'OPTIONS',
        headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
      });
      expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await server.close();
    }
  });
});

/**
 * HTTPS-1.1 — за прокси принимаем только то, что дошло до него по HTTPS.
 *
 * `TRUST_PROXY=1` — это объявление «передо мной терминирующий прокси». Без проверки
 * протокола оно значило лишь «верь X-Forwarded-For», и запрос, обошедший прокси и
 * пришедший прямо в plain-порт, продолжал бы обслуживаться как защищённый.
 */
describe('доверие прокси: протокол форварда (HTTPS-1.1)', () => {
  const withProxy = { room: createDevMatch(data), auth, trustProxy: true };

  it('за прокси пускает только https-форвард', async () => {
    const server = createMultiplayerServer(withProxy);
    const url = await server.listen();
    const t = await token({ matchId: 'dev', playerId: 'green' });
    try {
      const ws = new WebSocket(`${url}?token=${t}`, {
        headers: { 'x-forwarded-proto': 'https' },
      });
      try {
        expect(await nextMessage(ws)).toMatchObject({ type: 'welcome', playerId: 'green' });
      } finally {
        ws.close();
      }
    } finally {
      await server.close();
    }
  });

  it('за прокси отбивает http-форвард и ОТСУТСТВИЕ заголовка — оба 403', async () => {
    const server = createMultiplayerServer(withProxy);
    const url = await server.listen();
    const t = await token({ matchId: 'dev', playerId: 'green' });
    try {
      // Прокси не терминирует TLS: соединение до него шло открытым текстом.
      expect(
        await rejectStatus(`${url}?token=${t}`, { headers: { 'x-forwarded-proto': 'http' } }),
      ).toBe(403);
      // Заголовка нет вовсе: либо прокси недонастроен, либо запрос обошёл его и
      // стучится прямо в plain-порт. Считать такое соединение защищённым нельзя.
      expect(await rejectStatus(`${url}?token=${t}`)).toBe(403);
    } finally {
      await server.close();
    }
  });

  it('цепочка прокси: смотрим ПЕРВЫЙ хоп — протокол самого клиента', async () => {
    const server = createMultiplayerServer(withProxy);
    const url = await server.listen();
    const t = await token({ matchId: 'dev', playerId: 'green' });
    try {
      // `https, http` — клиент пришёл по HTTPS, дальше внутри периметра открытым
      // текстом. Это норма; отказ здесь ломал бы двухзвенную схему (край + локальный
      // прокси), а не защищал.
      const ws = new WebSocket(`${url}?token=${t}`, {
        headers: { 'x-forwarded-proto': 'https, http' },
      });
      try {
        expect(await nextMessage(ws)).toMatchObject({ type: 'welcome' });
      } finally {
        ws.close();
      }
      // Обратный порядок — клиент пришёл открытым текстом, и это отказ.
      expect(
        await rejectStatus(`${url}?token=${t}`, { headers: { 'x-forwarded-proto': 'http, https' } }),
      ).toBe(403);
    } finally {
      await server.close();
    }
  });

  it('БЕЗ прокси форвард-заголовки игнорируются — иначе клиент решал бы за сервер', async () => {
    const server = createMultiplayerServer({ room: createDevMatch(data), auth });
    const url = await server.listen();
    const t = await token({ matchId: 'dev', playerId: 'green' });
    try {
      // Ни отсутствие заголовка, ни подделанный `http` не мешают: `trustProxy` выключен,
      // значит форвард-заголовкам тут вообще не верят (анти-spoofing).
      const ws = new WebSocket(`${url}?token=${t}`, {
        headers: { 'x-forwarded-proto': 'http' },
      });
      try {
        expect(await nextMessage(ws)).toMatchObject({ type: 'welcome', playerId: 'green' });
      } finally {
        ws.close();
      }
    } finally {
      await server.close();
    }
  });
});
